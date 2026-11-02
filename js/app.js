/* =====================================================
   Xuan Weather｜台灣氣象監測中心
   CWA 即時觀測、GPS 定位、最近測站、深淺色模式
   ===================================================== */

'use strict';

// -----------------------------------------------------
// 1. 全域設定
// -----------------------------------------------------

const DATA_URL = './data/cwa-observations.json';
const REFRESH_INTERVAL = 10 * 60 * 1000;

let weatherData = [];
let selectedStationId = null;
let isLocating = false;

// -----------------------------------------------------
// 2. 深淺色模式
// -----------------------------------------------------

const themeButton = document.getElementById('theme');
const systemTheme = window.matchMedia('(prefers-color-scheme: light)');

let themeMode = systemTheme.matches ? 'light' : 'dark';

function applyTheme(mode) {
  const light = mode === 'light';

  document.body.classList.toggle('light', light);

  if (themeButton) {
    themeButton.textContent = light
      ? '☾　切換深色'
      : '☼　切換淺色';
  }
}

applyTheme(themeMode);

themeButton?.addEventListener('click', () => {
  themeMode = themeMode === 'light' ? 'dark' : 'light';
  applyTheme(themeMode);
});

// -----------------------------------------------------
// 3. 數值處理
// -----------------------------------------------------

function validNumber(value) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return null;
  }

  const number = Number(value);

  // 氣象署缺測或無效資料
  if (!Number.isFinite(number) || number <= -90) {
    return null;
  }

  return number;
}

function formatValue(value, digits = 1) {
  const number = validNumber(value);

  return number === null
    ? '--'
    : number.toFixed(digits);
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

// -----------------------------------------------------
// 4. 解析中央氣象署測站資料
// -----------------------------------------------------

function getStationData(station) {
  const weather = station.WeatherElement || {};

  const wgs84 = station.GeoInfo?.Coordinates?.find(
    coordinate => coordinate.CoordinateName === 'WGS84'
  );

  return {
    name: station.StationName || '未知測站',

    id: station.StationId || '',

    county: station.GeoInfo?.CountyName || '',

    town: station.GeoInfo?.TownName || '',

    lat: validNumber(wgs84?.StationLatitude),

    lon: validNumber(wgs84?.StationLongitude),

    time: station.ObsTime?.DateTime || '',

    condition: weather.Weather || '無資料',

    temperature: validNumber(weather.AirTemperature),

    humidity: validNumber(weather.RelativeHumidity),

    wind: validNumber(weather.WindSpeed),

    gust: validNumber(weather.GustInfo?.PeakGustSpeed),

    rain: validNumber(weather.Now?.Precipitation)
  };
}

// -----------------------------------------------------
// 5. 日期時間
// -----------------------------------------------------

function formatTime(value) {
  if (!value) return '--';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return '--';

  return date.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour12: false
  });
}

// -----------------------------------------------------
// 6. 全臺統計
// -----------------------------------------------------

function getAverage(stations, key) {
  const values = stations
    .map(station => station[key])
    .filter(value => value !== null);

  if (!values.length) return null;

  return values.reduce((a, b) => a + b, 0) / values.length;
}

function getMaximum(stations, key) {
  const values = stations
    .map(station => station[key])
    .filter(value => value !== null);

  return values.length ? Math.max(...values) : null;
}

// -----------------------------------------------------
// 7. 更新首頁摘要
// -----------------------------------------------------

function updateHomepage(data) {
  const stations = data.stations || [];

  const validStations = stations
    .map(getStationData)
    .filter(station => station.temperature !== null);

  const stationCount = document.getElementById('station-count');

  if (stationCount) {
    stationCount.textContent = `${stations.length} 個測站`;
  }

  const updated = document.querySelector('.updated');

  if (updated) {
    updated.textContent =
      `●　即時資料已連線｜${formatTime(data.updatedAt)}`;
  }

  // 若使用者已經 GPS 定位，優先保留所在地測站
  if (selectedStationId) {
    const selected = weatherData.find(
      station => station.id === selectedStationId
    );

    if (selected) {
      updateLocalWeather(selected);
      renderStationList(weatherData);
      return;
    }
  }

  const averageTemperature = getAverage(
    validStations,
    'temperature'
  );

  const temperature = document.querySelector('.temperature');

  if (temperature) {
    temperature.innerHTML =
      `${formatValue(averageTemperature)}<small>°C</small>`;
  }

  const condition = document.querySelector('.condition');

  if (condition) {
    condition.textContent =
      `全臺測站平均氣溫｜${validStations.length} 個有效測站`;
  }

  const metrics = document.querySelectorAll('.metric strong');

  if (metrics[0]) {
    metrics[0].innerHTML =
      `${formatValue(getAverage(validStations, 'humidity'))}<em>%</em>`;
  }

  if (metrics[1]) {
    metrics[1].innerHTML =
      `${formatValue(getAverage(validStations, 'wind'))}<em>m/s</em>`;
  }

  if (metrics[2]) {
    metrics[2].innerHTML =
      `${formatValue(getMaximum(validStations, 'gust'))}<em>m/s</em>`;
  }

  if (metrics[3]) {
    metrics[3].innerHTML =
      `${formatValue(getMaximum(validStations, 'rain'))}<em>mm</em>`;
  }

  const feels = document.querySelector('.feels');

  if (feels) {
    feels.textContent = '全臺平均統計｜非所在地觀測';
  }

  renderStationList(weatherData);
}

// -----------------------------------------------------
// 8. GPS 最近測站距離計算
// -----------------------------------------------------

function calculateDistance(lat1, lon1, lat2, lon2) {
  const radians = value => value * Math.PI / 180;

  const earthRadius = 6371;

  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) *
    Math.cos(radians(lat2)) *
    Math.sin(dLon / 2) ** 2;

  return earthRadius * 2 * Math.atan2(
    Math.sqrt(a),
    Math.sqrt(1 - a)
  );
}

function findNearestStation(lat, lon) {
  const candidates = weatherData.filter(station =>
    station.lat !== null &&
    station.lon !== null &&
    station.temperature !== null &&
    station.lat >= -90 &&
    station.lat <= 90 &&
    station.lon >= -180 &&
    station.lon <= 180
  );

  if (!candidates.length) return null;

  return candidates
    .map(station => ({
      ...station,
      distance: calculateDistance(
        lat,
        lon,
        station.lat,
        station.lon
      )
    }))
    .sort((a, b) => a.distance - b.distance)[0];
}

// -----------------------------------------------------
// 9. 所在地天氣卡片
// -----------------------------------------------------

function updateLocalWeather(station) {
  if (!station) return;

  const locationBox = document.querySelector('.location');

  if (locationBox) {
    const title = locationBox.querySelector('b');

    if (title) {
      title.textContent = '所在地最近測站';
    }

    const label = document.getElementById('location-label');

    if (label) {
      label.textContent =
        `${station.county}・${station.town}・${station.name}`;
    }
  }

  const temperature = document.querySelector('.temperature');

  if (temperature) {
    temperature.innerHTML =
      `${formatValue(station.temperature)}<small>°C</small>`;
  }

  const condition = document.querySelector('.condition');

  if (condition) {
    condition.textContent =
      `${station.name}｜${station.condition}`;
  }

  const feels = document.querySelector('.feels');

  if (feels) {
    feels.textContent =
      `最近測站觀測｜${formatTime(station.time)}`;
  }

  const metrics = document.querySelectorAll('.metric strong');

  if (metrics[0]) {
    metrics[0].innerHTML =
      `${formatValue(station.humidity, 0)}<em>%</em>`;
  }

  if (metrics[1]) {
    metrics[1].innerHTML =
      `${formatValue(station.wind)}<em>m/s</em>`;
  }

  if (metrics[2]) {
    metrics[2].innerHTML =
      `${formatValue(station.gust)}<em>m/s</em>`;
  }

  if (metrics[3]) {
    metrics[3].innerHTML =
      `${formatValue(station.rain)}<em>mm</em>`;
  }

  const status = document.getElementById('location-status');

  if (status) {
    status.textContent =
      `GPS 定位成功｜最近測站 ${station.name}｜直線距離 ${station.distance.toFixed(1)} 公里`;
  }
}

// -----------------------------------------------------
// 10. 建立定位介面
// -----------------------------------------------------

function setupLocation() {
  const locationBox = document.querySelector('.location');

  if (!locationBox) return;

  // 建立位置文字
  let label = document.getElementById('location-label');

  if (!label) {
    label = document.createElement('span');
    label.id = 'location-label';
    label.textContent = '臺灣・位置待選';

    locationBox.appendChild(label);
  }

  // 建立 GPS 按鈕
  let button = document.getElementById('gps-location-button');

  if (!button) {
    button = document.createElement('button');

    button.id = 'gps-location-button';
    button.type = 'button';
    button.textContent = '📍 定位目前位置';

    button.style.cssText = `
      margin-left:8px;
      padding:7px 11px;
      border-radius:20px;
      border:1px solid #8ba5c5;
      background:transparent;
      color:inherit;
      font-size:12px;
      cursor:pointer;
    `;

    locationBox.appendChild(button);
  }

  // 定位狀態
  let status = document.getElementById('location-status');

  if (!status) {
    status = document.createElement('div');

    status.id = 'location-status';

    status.style.cssText = `
      font-size:12px;
      margin-top:8px;
      color:var(--muted,#718096);
      line-height:1.6;
    `;

    locationBox.parentElement.appendChild(status);
  }

  button.addEventListener('click', locateUser);
}

// -----------------------------------------------------
// 11. 執行 GPS 定位
// -----------------------------------------------------

function locateUser() {
  const button = document.getElementById('gps-location-button');
  const status = document.getElementById('location-status');

  if (isLocating) return;

  if (!navigator.geolocation) {
    status.textContent = '目前瀏覽器不支援 GPS 定位';
    return;
  }

  if (!window.isSecureContext) {
    status.textContent = '定位需要 HTTPS 安全連線';
    return;
  }

  isLocating = true;

  button.disabled = true;
  button.textContent = '正在取得 GPS 位置…';

  status.textContent = '請允許 Safari 取用你的位置';

  navigator.geolocation.getCurrentPosition(
    position => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;

      const nearest = findNearestStation(lat, lon);

      isLocating = false;
      button.disabled = false;
      button.textContent = '重新定位';

      if (!nearest) {
        status.textContent =
          '目前找不到具有有效座標及氣溫資料的測站';
        return;
      }

      selectedStationId = nearest.id;

      updateLocalWeather(nearest);
    },

    error => {
      isLocating = false;
      button.disabled = false;
      button.textContent = '📍 重新定位';

      const messages = {
        1: '定位權限被拒絕，請允許 Safari 使用位置',
        2: '目前無法取得 GPS 位置，請檢查定位服務',
        3: '定位逾時，請再次嘗試'
      };

      status.textContent =
        messages[error.code] || '定位失敗，請稍後再試';
    },

    {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 60000
    }
  );
}

// -----------------------------------------------------
// 12. 全臺測站搜尋列表
// -----------------------------------------------------

function renderStationList(stations) {
  const mapPanel = document.querySelector('.map-placeholder');

  if (!mapPanel) return;

  let panel = document.getElementById('station-live-list');

  if (!panel) {
    panel = document.createElement('div');

    panel.id = 'station-live-list';

    panel.style.cssText = `
      margin-top:16px;
      max-height:600px;
      overflow:auto;
    `;

    mapPanel.insertAdjacentElement('afterend', panel);
  }

  const previousSearch =
    document.getElementById('station-search');

  const keyword = previousSearch?.value.trim().toLowerCase() || '';

  const filtered = stations.filter(station => {
    const text =
      `${station.name} ${station.county} ${station.town}`.toLowerCase();

    return text.includes(keyword);
  });

  panel.innerHTML = `
    <div style="
      display:flex;
      justify-content:space-between;
      align-items:center;
      gap:8px;
      flex-wrap:wrap;
      margin-bottom:12px;
    ">
      <strong>🌡️ 全臺即時測站觀測</strong>
      <span>${filtered.length} 個測站</span>
    </div>

    <input
      id="station-search"
      type="search"
      placeholder="搜尋縣市、鄉鎮或測站名稱"
      value="${escapeHTML(keyword)}"
      style="
        width:100%;
        box-sizing:border-box;
        padding:12px;
        border-radius:10px;
        margin-bottom:12px;
      "
    >

    <div style="
      display:grid;
      grid-template-columns:repeat(auto-fit,minmax(210px,1fr));
      gap:10px;
    ">
      ${filtered.map(station => `
        <div style="
          padding:12px;
          border:1px solid var(--border,#8885);
          border-radius:12px;
        ">
          <strong>${escapeHTML(station.name)}</strong>

          <div style="font-size:12px;opacity:.7;margin:4px 0">
            ${escapeHTML(station.county)}
            ${escapeHTML(station.town)}
          </div>

          <div style="
            font-size:24px;
            font-weight:700;
            margin:8px 0;
          ">
            ${formatValue(station.temperature)}°C
          </div>

          <div style="font-size:13px;line-height:1.8">
            ${escapeHTML(station.condition)}<br>
            濕度 ${formatValue(station.humidity,0)}%　
            風速 ${formatValue(station.wind)} m/s<br>
            陣風 ${formatValue(station.gust)} m/s　
            雨量 ${formatValue(station.rain)} mm
          </div>

          <div style="font-size:11px;opacity:.65;margin-top:6px">
            ${escapeHTML(formatTime(station.time))}
          </div>
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById('station-search')
    ?.addEventListener('input', () => {
      renderStationList(stations);
    });
}

// -----------------------------------------------------
// 13. 載入中央氣象署資料
// -----------------------------------------------------

async function loadWeatherData() {
  try {
    const response = await fetch(
      `${DATA_URL}?_=${Date.now()}`,
      {
        cache: 'no-store'
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (
      !data.success ||
      !Array.isArray(data.stations) ||
      data.stations.length === 0
    ) {
      throw new Error('測站資料格式不正確');
    }

    weatherData = data.stations.map(getStationData);

    updateHomepage(data);

    console.log(
      `Xuan Weather：成功載入 ${weatherData.length} 個測站`
    );

  } catch (error) {
    console.error('即時氣象資料讀取失敗：', error);

    const updated = document.querySelector('.updated');

    if (updated) {
      updated.textContent = '●　資料讀取失敗，請稍後重試';
    }

    const status = document.getElementById('location-status');

    if (status && !weatherData.length) {
      status.textContent = '目前尚未取得測站資料';
    }
  }
}

// -----------------------------------------------------
// 14. 初始化
// -----------------------------------------------------

setupLocation();

loadWeatherData();

setInterval(
  loadWeatherData,
  REFRESH_INTERVAL
);

console.log('Xuan Weather 氣象監測中心已啟動');
