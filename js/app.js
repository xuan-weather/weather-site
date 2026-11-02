'use strict';

/* =========================================
   Xuan Weather｜即時氣象監測中心
   GPS 定位＋全臺測站互動地圖
   ========================================= */

const DATA_URL = './data/cwa-observations.json';
const REFRESH_MS = 10 * 60 * 1000;

let stations = [];
let selectedId = null;
let gpsPosition = null;
let weatherMap = null;
let stationMarkers = null;
let gpsMarker = null;
let mapMetric = 'temperature';
let locating = false;

const $ = selector => document.querySelector(selector);

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > -90 ? n : null;
}

function fmt(value, digits = 1) {
  const n = number(value);
  return n === null ? '--' : n.toFixed(digits);
}

function safe(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c]);
}

function formatTime(value) {
  if (!value) return '--';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    hour12: false
  });
}

/* 深淺色模式 */

let theme = window.matchMedia(
  '(prefers-color-scheme: light)'
).matches ? 'light' : 'dark';

function applyTheme() {
  document.body.classList.toggle('light', theme === 'light');
  const button = $('#theme');
  if (button) {
    button.textContent = theme === 'light'
      ? '☾　切換深色'
      : '☼　切換淺色';
  }
}

applyTheme();

$('#theme')?.addEventListener('click', () => {
  theme = theme === 'light' ? 'dark' : 'light';
  applyTheme();
});

/* 解析中央氣象署 O-A0003-001 */

function parseStation(raw) {
  const w = raw.WeatherElement || {};

  const coord = raw.GeoInfo?.Coordinates?.find(
    item => item.CoordinateName === 'WGS84'
  );

  return {
    id: raw.StationId || '',
    name: raw.StationName || '未知測站',
    county: raw.GeoInfo?.CountyName || '',
    town: raw.GeoInfo?.TownName || '',
    lat: number(coord?.StationLatitude),
    lon: number(coord?.StationLongitude),
    time: raw.ObsTime?.DateTime || '',
    weather: w.Weather || '無資料',
    temperature: number(w.AirTemperature),
    humidity: number(w.RelativeHumidity),
    wind: number(w.WindSpeed),
    gust: number(w.GustInfo?.PeakGustSpeed),
    rain: number(w.Now?.Precipitation)
  };
}

function average(key) {
  const values = stations
    .map(s => s[key])
    .filter(v => v !== null);

  return values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
}

function maximum(key) {
  const values = stations
    .map(s => s[key])
    .filter(v => v !== null);

  return values.length ? Math.max(...values) : null;
}

/* 建立 GPS 定位介面 */

function setupLocation() {
  const box = $('.location');
  if (!box) return;

  box.innerHTML = `
    📍 <b>所在地天氣</b>
    <span id="location-label">臺灣・位置待選</span>
    <button id="gps-button" type="button">
      📍 定位目前位置
    </button>
  `;

  const button = $('#gps-button');

  button.style.cssText = `
    margin-left:8px;
    padding:7px 11px;
    border:1px solid #8ba5c5;
    border-radius:20px;
    background:transparent;
    color:inherit;
    font-size:12px;
    cursor:pointer;
  `;

  button.addEventListener('click', locateUser);

  const status = document.createElement('div');
  status.id = 'gps-status';
  status.style.cssText =
    'font-size:12px;margin-top:8px;line-height:1.6;';

  box.parentElement.appendChild(status);
}

/* 建立真正的地圖區域 */

function setupMap() {
  const area = $('.map-placeholder');
  if (!area) return;

  area.innerHTML = `
    <div class="xuan-map-controls">
      <button type="button" data-map="temperature">🌡️ 氣溫</button>
      <button type="button" data-map="rain">🌧️ 雨量</button>
      <button type="button" data-map="wind">💨 風速</button>
    </div>

    <div id="xuan-map"
      style="width:100%;height:440px;min-height:340px;background:#e5edf5;">
    </div>

    <div id="map-status"
      style="padding:9px 12px;font-size:12px;">
      正在載入測站地圖…
    </div>
  `;

  area.querySelectorAll('[data-map]').forEach(button => {
    button.style.cssText = `
      padding:7px 12px;
      margin:5px 3px;
      border:1px solid #8ba5c5;
      border-radius:20px;
      background:transparent;
      color:inherit;
      font-size:12px;
    `;

    button.addEventListener('click', () => {
      mapMetric = button.dataset.map;

      area.querySelectorAll('[data-map]').forEach(b => {
        b.style.background =
          b === button ? 'var(--accent,#dce9f8)' : 'transparent';
      });

      drawMarkers();
    });
  });

  area.querySelector('[data-map="temperature"]').style.background =
    'var(--accent,#dce9f8)';
}

/* 載入 Leaflet 地圖 */

function loadLeaflet() {
  return new Promise((resolve, reject) => {
    if (window.L) {
      resolve();
      return;
    }

    if (!$('#xuan-leaflet-css')) {
      const css = document.createElement('link');
      css.id = 'xuan-leaflet-css';
      css.rel = 'stylesheet';
      css.href =
        'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';

      document.head.appendChild(css);
    }

    const script = document.createElement('script');
    script.src =
      'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

    script.onload = resolve;
    script.onerror = () => reject(
      new Error('Leaflet 地圖載入失敗')
    );

    document.head.appendChild(script);
  });
}

/* 地圖顏色 */

function getMapValue(station) {
  if (mapMetric === 'rain') return station.rain;
  if (mapMetric === 'wind') return station.wind;
  return station.temperature;
}

function getColor(value) {
  if (value === null) return '#8993a3';

  if (mapMetric === 'rain') {
    if (value >= 20) return '#8438bf';
    if (value >= 10) return '#2867cf';
    if (value > 0) return '#35a7d8';
    return '#78b98b';
  }

  if (mapMetric === 'wind') {
    if (value >= 10) return '#983db5';
    if (value >= 6) return '#e18b35';
    if (value >= 3) return '#3289c9';
    return '#55a987';
  }

  if (value >= 35) return '#d94b3d';
  if (value >= 30) return '#e58a35';
  if (value >= 25) return '#d8b743';
  if (value >= 20) return '#3999c7';

  return '#6576bd';
}

/* 初始化臺灣地圖 */

function initMap() {
  if (!window.L || weatherMap) return;

  weatherMap = L.map('xuan-map', {
    scrollWheelZoom: false
  }).setView([23.7, 120.9], 7);

  L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors'
    }
  ).addTo(weatherMap);

  stationMarkers = L.layerGroup().addTo(weatherMap);

  setTimeout(() => weatherMap.invalidateSize(), 300);
}

/* 測站點位與資訊彈窗 */

function drawMarkers() {
  if (!weatherMap || !stationMarkers) return;

  stationMarkers.clearLayers();

  const valid = stations.filter(s =>
    s.lat !== null &&
    s.lon !== null &&
    s.lat >= 20 &&
    s.lat <= 27 &&
    s.lon >= 117 &&
    s.lon <= 123
  );

  valid.forEach(station => {
    const value = getMapValue(station);

    const marker = L.circleMarker(
      [station.lat, station.lon],
      {
        radius: station.id === selectedId ? 8 : 5,
        color: '#ffffff',
        weight: 1.5,
        fillColor: getColor(value),
        fillOpacity: 0.92
      }
    );

    marker.bindPopup(`
      <div style="min-width:160px">
        <strong>${safe(station.name)}</strong>
        <div>${safe(station.county)} ${safe(station.town)}</div>
        <hr>
        氣溫：${fmt(station.temperature)} °C<br>
        天氣：${safe(station.weather)}<br>
        濕度：${fmt(station.humidity, 0)} %<br>
        風速：${fmt(station.wind)} m/s<br>
        陣風：${fmt(station.gust)} m/s<br>
        雨量：${fmt(station.rain)} mm<br>
        <small>觀測時間：${safe(formatTime(station.time))}</small>
      </div>
    `);

    marker.addTo(stationMarkers);
  });

  const status = $('#map-status');

  if (status) {
    status.textContent =
      `地圖顯示 ${valid.length} 個有效座標測站`;
  }

  if (gpsPosition && gpsMarker) {
    gpsMarker.setLatLng([
      gpsPosition.lat,
      gpsPosition.lon
    ]);
  }
}

/* GPS 距離計算 */

function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = value => value * Math.PI / 180;

  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) *
    Math.cos(rad(lat2)) *
    Math.sin(dLon / 2) ** 2;

  return 6371 * 2 * Math.atan2(
    Math.sqrt(a),
    Math.sqrt(1 - a)
  );
}

function findNearest(lat, lon) {
  return stations
    .filter(s =>
      s.lat !== null &&
      s.lon !== null &&
      s.temperature !== null
    )
    .map(s => ({
      ...s,
      distance: distanceKm(
        lat, lon, s.lat, s.lon
      )
    }))
    .sort((a, b) => a.distance - b.distance)[0] || null;
}

/* 更新所在地天氣 */

function updateLocal(station) {
  if (!station) return;

  selectedId = station.id;

  $('#location-label').textContent =
    `${station.county}・${station.town}・${station.name}`;

  $('.temperature').innerHTML =
    `${fmt(station.temperature)}<small>°C</small>`;

  $('.condition').textContent =
    `${station.name}｜${station.weather}`;

  $('.feels').textContent =
    `最近測站觀測｜${formatTime(station.time)}`;

  const metrics = document.querySelectorAll('.metric strong');

  if (metrics[0]) {
    metrics[0].innerHTML =
      `${fmt(station.humidity, 0)}<em>%</em>`;
  }

  if (metrics[1]) {
    metrics[1].innerHTML =
      `${fmt(station.wind)}<em>m/s</em>`;
  }

  if (metrics[2]) {
    metrics[2].innerHTML =
      `${fmt(station.gust)}<em>m/s</em>`;
  }

  if (metrics[3]) {
    metrics[3].innerHTML =
      `${fmt(station.rain)}<em>mm</em>`;
  }

  $('#gps-status').textContent =
    `定位成功｜最近測站：${station.name}｜直線距離 ${station.distance.toFixed(1)} 公里`;

  drawMarkers();
}

/* 執行 iPhone GPS 定位 */

function locateUser() {
  if (locating) return;

  const button = $('#gps-button');
  const status = $('#gps-status');

  if (!navigator.geolocation) {
    status.textContent = '瀏覽器不支援 GPS 定位';
    return;
  }

  if (!window.isSecureContext) {
    status.textContent = 'GPS 定位需要 HTTPS 安全連線';
    return;
  }

  locating = true;
  button.disabled = true;
  button.textContent = '正在定位…';
  status.textContent = '請允許 Safari 使用你的位置';

  navigator.geolocation.getCurrentPosition(
    position => {
      locating = false;
      button.disabled = false;
      button.textContent = '重新定位';

      gpsPosition = {
        lat: position.coords.latitude,
        lon: position.coords.longitude
      };

      const nearest = findNearest(
        gpsPosition.lat,
        gpsPosition.lon
      );

      if (!nearest) {
        status.textContent =
          '找不到具有有效座標及氣溫的測站';
        return;
      }

      updateLocal(nearest);

      if (weatherMap) {
        if (gpsMarker) gpsMarker.remove();

        gpsMarker = L.marker([
          gpsPosition.lat,
          gpsPosition.lon
        ])
          .addTo(weatherMap)
          .bindPopup('📍 你的 GPS 位置')
          .openPopup();

        weatherMap.setView(
          [gpsPosition.lat, gpsPosition.lon],
          9
        );
      }
    },

    error => {
      locating = false;
      button.disabled = false;
      button.textContent = '重新定位';

      const messages = {
        1: '定位權限遭拒絕，請允許 Safari 使用位置',
        2: '無法取得 GPS 位置，請檢查定位服務',
        3: '定位逾時，請再次嘗試'
      };

      status.textContent =
        messages[error.code] || '定位失敗';
    },

    {
      enableHighAccuracy: true,
      timeout: 25000,
      maximumAge: 60000
    }
  );
}

/* 全臺測站列表 */

function renderStations() {
  const mapArea = $('.map-placeholder');
  if (!mapArea) return;

  let panel = $('#station-live-list');

  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'station-live-list';
    panel.style.cssText =
      'margin-top:16px;max-height:600px;overflow:auto;';

    mapArea.insertAdjacentElement('afterend', panel);
  }

  const keyword =
    ($('#station-search')?.value || '').trim().toLowerCase();

  const filtered = stations.filter(s =>
    `${s.name} ${s.county} ${s.town}`
      .toLowerCase()
      .includes(keyword)
  );

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:12px">
      <strong>🌡️ 全臺即時測站觀測</strong>
      <span>${filtered.length} 個測站</span>
    </div>

    <input
      id="station-search"
      type="search"
      placeholder="搜尋縣市、鄉鎮或測站名稱"
      value="${safe(keyword)}"
      style="width:100%;box-sizing:border-box;padding:12px;border-radius:10px;margin-bottom:12px"
    >

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px">
      ${filtered.map(s => `
        <article style="padding:12px;border:1px solid var(--border,#8885);border-radius:12px">
          <strong>${safe(s.name)}</strong>
          <div style="font-size:12px;opacity:.7;margin:4px 0">
            ${safe(s.county)} ${safe(s.town)}
          </div>
          <div style="font-size:24px;font-weight:700;margin:8px 0">
            ${fmt(s.temperature)}°C
          </div>
          <div style="font-size:13px;line-height:1.8">
            ${safe(s.weather)}<br>
            濕度 ${fmt(s.humidity, 0)}%　
            風速 ${fmt(s.wind)} m/s<br>
            陣風 ${fmt(s.gust)} m/s　
            雨量 ${fmt(s.rain)} mm
          </div>
          <small>${safe(formatTime(s.time))}</small>
        </article>
      `).join('')}
    </div>
  `;

  $('#station-search').addEventListener(
    'input',
    renderStations
  );
}

/* 載入官方資料 */

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

    if (
      !data.success ||
      !Array.isArray(data.stations) ||
      !data.stations.length
    ) {
      throw new Error('測站資料格式錯誤');
    }

    stations = data.stations.map(parseStation);

    const valid = stations.filter(
      s => s.temperature !== null
    );

    $('.updated').textContent =
      `●　即時資料已連線｜${formatTime(data.updatedAt)}`;

    if (selectedId) {
      const selected = stations.find(s => s.id === selectedId);

      if (selected) {
        selected.distance = gpsPosition
          ? distanceKm(
              gpsPosition.lat,
              gpsPosition.lon,
              selected.lat,
              selected.lon
            )
          : 0;

        updateLocal(selected);
      }
    } else {
      $('.temperature').innerHTML =
        `${fmt(average('temperature'))}<small>°C</small>`;

      $('.condition').textContent =
        `全臺測站平均氣溫｜${valid.length} 個有效測站`;

      $('.feels').textContent =
        '全臺平均統計｜非所在地觀測';

      const metrics =
        document.querySelectorAll('.metric strong');

      if (metrics[0]) {
        metrics[0].innerHTML =
          `${fmt(average('humidity'))}<em>%</em>`;
      }

      if (metrics[1]) {
        metrics[1].innerHTML =
          `${fmt(average('wind'))}<em>m/s</em>`;
      }

      if (metrics[2]) {
        metrics[2].innerHTML =
          `${fmt(maximum('gust'))}<em>m/s</em>`;
      }

      if (metrics[3]) {
        metrics[3].innerHTML =
          `${fmt(maximum('rain'))}<em>mm</em>`;
      }
    }

    renderStations();
    drawMarkers();

    console.log(
      `Xuan Weather：成功載入 ${stations.length} 個測站`
    );

  } catch (error) {
    console.error('氣象資料讀取失敗：', error);

    $('.updated').textContent =
      '●　即時資料讀取失敗，請稍後重試';
  }
}

/* 啟動 */

async function startWeather() {
  setupLocation();
  setupMap();

  await loadWeatherData();

  try {
    await loadLeaflet();
    initMap();
    drawMarkers();
  } catch (error) {
    console.error(error);

    const status = $('#map-status');
    if (status) {
      status.textContent =
        '地圖載入失敗，請檢查網路連線';
    }
  }

  setInterval(
    loadWeatherData,
    REFRESH_MS
  );
}

startWeather();
