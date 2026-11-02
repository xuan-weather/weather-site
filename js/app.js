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

// =====================================
// Xuan Weather｜中央氣象署即時測站資料
// =====================================

const DATA_URL = './data/cwa-observations.json';

let weatherData = [];

function validNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number <= -90) {
    return null;
  }

  return number;
}

function formatValue(value, digits = 1) {
  const number = validNumber(value);
  return number === null ? '--' : number.toFixed(digits);
}

function getStationData(station) {
  const weather = station.WeatherElement || {};
  const coordinates = weather;

  return {
    name: station.StationName || '未知測站',
    id: station.StationId || '',
    county: station.GeoInfo?.CountyName || '',
    town: station.GeoInfo?.TownName || '',
    time: station.ObsTime?.DateTime || '',
    condition: weather.Weather || '無資料',
    temperature: validNumber(weather.AirTemperature),
    humidity: validNumber(weather.RelativeHumidity),
    wind: validNumber(weather.WindSpeed),
    gust: validNumber(weather.GustInfo?.PeakGustSpeed),
    rain: validNumber(weather.Now?.Precipitation)
  };
}

function updateHomepage(data) {
  const stations = data.stations || [];

  const stationCount = document.getElementById('station-count');
  if (stationCount) {
    stationCount.textContent = `${stations.length} 個測站`;
  }

  const updated = document.querySelector('.updated');
  if (updated) {
    const time = new Date(data.updatedAt);
    updated.textContent =
      `●　即時資料已連線｜${time.toLocaleString('zh-TW', {
        timeZone: 'Asia/Taipei',
        hour12: false
      })}`;
  }

  const list = stations
    .map(getStationData)
    .filter(station => station.temperature !== null);

  const avg = list.length
    ? list.reduce((sum, station) => sum + station.temperature, 0) / list.length
    : null;

  const temperature = document.querySelector('.temperature');
  if (temperature && avg !== null) {
    temperature.innerHTML =
      `${avg.toFixed(1)}<small>°C</small>`;
  }

  const condition = document.querySelector('.condition');
  if (condition) {
    condition.textContent =
      `全臺測站平均氣溫｜${list.length} 個有效測站`;
  }

  const metrics = document.querySelectorAll('.metric strong');

  const average = key => {
    const values = list
      .map(station => station[key])
      .filter(value => value !== null);

    return values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : null;
  };

  if (metrics[0]) {
    metrics[0].innerHTML =
      `${formatValue(average('humidity'))}<em>%</em>`;
  }

  if (metrics[1]) {
    metrics[1].innerHTML =
      `${formatValue(average('wind'))}<em>m/s</em>`;
  }

  if (metrics[2]) {
    const gusts = list
      .map(station => station.gust)
      .filter(value => value !== null);

    metrics[2].innerHTML =
      `${formatValue(gusts.length ? Math.max(...gusts) : null)}<em>m/s</em>`;
  }

  if (metrics[3]) {
    const rains = list
      .map(station => station.rain)
      .filter(value => value !== null);

    metrics[3].innerHTML =
      `${formatValue(rains.length ? Math.max(...rains) : null)}<em>mm</em>`;
  }

  renderStationList(list);
}

function renderStationList(stations) {
  const mapPanel = document.querySelector('.map-placeholder');
  if (!mapPanel) return;

  let panel = document.getElementById('station-live-list');

  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'station-live-list';
    panel.style.cssText =
      'margin-top:16px;max-height:420px;overflow:auto;';
    mapPanel.insertAdjacentElement('afterend', panel);
  }

  const search = document.getElementById('station-search');
  const keyword = search?.value.trim().toLowerCase() || '';

  const filtered = stations.filter(station => {
    const text =
      `${station.name} ${station.county} ${station.town}`.toLowerCase();

    return text.includes(keyword);
  });

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <strong>全臺即時測站觀測</strong>
      <span>${filtered.length} 個測站</span>
    </div>
    <input
      id="station-search"
      type="search"
      placeholder="搜尋縣市、鄉鎮或測站名稱"
      value="${keyword.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"
      style="width:100%;box-sizing:border-box;padding:12px;border-radius:10px;margin-bottom:12px"
    >
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px">
      ${filtered.map(station => `
        <div style="padding:12px;border:1px solid var(--border,#8885);border-radius:12px">
          <strong>${escapeHTML(station.name)}</strong>
          <div style="font-size:12px;opacity:.7;margin:4px 0">
            ${escapeHTML(station.county)} ${escapeHTML(station.town)}
          </div>
          <div style="font-size:24px;font-weight:700;margin:8px 0">
            ${formatValue(station.temperature)}°C
          </div>
          <div style="font-size:13px;line-height:1.8">
            ${escapeHTML(station.condition)}<br>
            濕度 ${formatValue(station.humidity, 0)}%　
            風速 ${formatValue(station.wind)} m/s<br>
            陣風 ${formatValue(station.gust)} m/s　
            雨量 ${formatValue(station.rain)} mm
          </div>
          <div style="font-size:11px;opacity:.65;margin-top:6px">
            ${escapeHTML(station.time.replace('T', ' '))}
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

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

async function loadWeatherData() {
  try {
    const response = await fetch(
      `${DATA_URL}?_=${Date.now()}`,
      { cache: 'no-store' }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data.success || !Array.isArray(data.stations)) {
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
  }
}

loadWeatherData();
setInterval(loadWeatherData, 10 * 60 * 1000);
