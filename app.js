/* =========================================================
   Xuan Weather｜app.js
   目的：依照目前 index.html 與 CWA O-A0001-001 JSON 結構
   建立全台即時測站地圖，直接顯示每一個有效測站圓點。
   不使用 MarkerCluster、不修改 GitHub Actions 或資料流程。
   ========================================================= */
(() => {
  "use strict";

  const DATA_URL = "./data/cwa-O-A0001-001.json";
  const MAP_CENTER = [23.7, 120.95];
  const MAP_ZOOM = 7;
  const TAIWAN_BOUNDS = [[20, 117], [27, 123]];

  let map = null;
  let stationLayer = null;
  let stations = [];
  let currentLayer = "temperature";
  let leafletLoading = null;
  let lastUpdatedText = "--";

  const $ = (selector, root = document) => root.querySelector(selector);

  function numberValue(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) && n !== -99 && n !== -999 ? n : null;
  }

  function safeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function formatNumber(value, digits = 1) {
    const n = numberValue(value);
    return n === null ? "--" : n.toFixed(digits);
  }

  function getStationCoordinates(station) {
    const coordinates = station?.GeoInfo?.Coordinates;
    if (!Array.isArray(coordinates)) return null;

    const wgs84 = coordinates.find(item =>
      String(item?.CoordinateName || "").toUpperCase() === "WGS84"
    );
    const coordinate = wgs84 || coordinates[0];
    const lat = numberValue(coordinate?.StationLatitude);
    const lon = numberValue(coordinate?.StationLongitude);

    if (lat === null || lon === null) return null;
    if (lat < TAIWAN_BOUNDS[0][0] || lat > TAIWAN_BOUNDS[1][0]) return null;
    if (lon < TAIWAN_BOUNDS[0][1] || lon > TAIWAN_BOUNDS[1][1]) return null;
    return [lat, lon];
  }

  function normalizeStation(raw) {
    const position = getStationCoordinates(raw);
    if (!position) return null;

    const weather = raw?.WeatherElement || {};
    const obsTime = raw?.ObsTime?.DateTime || "";
    const gust = numberValue(weather?.GustInfo?.PeakGustSpeed);

    return {
      id: String(raw?.StationId || `${raw?.StationName || "station"}-${position.join("-")}`),
      name: raw?.StationName || "未命名測站",
      county: raw?.GeoInfo?.CountyName || "",
      town: raw?.GeoInfo?.TownName || "",
      lat: position[0],
      lon: position[1],
      time: obsTime,
      weather: weather?.Weather || "天氣資料未提供",
      temperature: numberValue(weather?.AirTemperature),
      humidity: numberValue(weather?.RelativeHumidity),
      wind: numberValue(weather?.WindSpeed),
      gust,
      rain: numberValue(weather?.Now?.Precipitation),
      windDirection: numberValue(weather?.WindDirection),
      altitude: numberValue(raw?.GeoInfo?.StationAltitude)
    };
  }

  function getLayerValue(station) {
    if (currentLayer === "rain") return station.rain;
    if (currentLayer === "wind") return station.wind;
    return station.temperature;
  }

  function getColor(value) {
    if (value === null) return "#94a3b8";

    if (currentLayer === "rain") {
      if (value >= 80) return "#7c3aed";
      if (value >= 40) return "#2563eb";
      if (value >= 10) return "#0ea5e9";
      if (value > 0) return "#38bdf8";
      return "#94a3b8";
    }

    if (currentLayer === "wind") {
      if (value >= 20) return "#dc2626";
      if (value >= 14) return "#ea580c";
      if (value >= 10) return "#d97706";
      if (value >= 6) return "#7c3aed";
      if (value >= 3) return "#2563eb";
      return "#0d9488";
    }

    if (value >= 35) return "#dc2626";
    if (value >= 30) return "#f97316";
    if (value >= 25) return "#eab308";
    if (value >= 20) return "#16a34a";
    if (value >= 15) return "#0d9488";
    if (value >= 10) return "#2563eb";
    return "#7c3aed";
  }

  function layerLabel() {
    if (currentLayer === "rain") return "雨量";
    if (currentLayer === "wind") return "風速";
    return "氣溫";
  }

  function layerUnit() {
    if (currentLayer === "rain") return "mm";
    if (currentLayer === "wind") return "m/s";
    return "°C";
  }

  function latestObservationTime(list) {
    const times = list.map(item => Date.parse(item.time)).filter(Number.isFinite);
    if (!times.length) return "--";
    return new Date(Math.max(...times)).toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false
    });
  }

  function addMapStyles() {
    if ($("#xuan-weather-app-style")) return;

    const style = document.createElement("style");
    style.id = "xuan-weather-app-style";
    style.textContent = `
      .map-placeholder.xuan-map-ready {
        position:relative !important;
        display:block !important;
        padding:0 !important;
        min-height:0 !important;
        height:auto !important;
        overflow:hidden;
        background:#dbeafe;
      }
      .xuan-map-toolbar {
        display:flex; gap:8px; flex-wrap:wrap; align-items:center;
        padding:10px 12px; background:var(--panel-bg, #fff);
        position:relative; z-index:500;
      }
      .xuan-map-tab {
        border:1px solid #9aabc0; border-radius:999px;
        padding:8px 16px; background:transparent; color:inherit;
        font:inherit; font-size:13px; font-weight:700; cursor:pointer;
      }
      .xuan-map-tab[aria-pressed="true"] {
        background:#dbeafe; color:#173b63; border-color:#93b4dc;
      }
      #weather-map {
        width:100%; height: min(72vh, 680px); min-height:390px;
        background:#dbeafe; z-index:1;
      }
      .xuan-map-footer {
        display:flex; justify-content:space-between; gap:8px;
        flex-wrap:wrap; padding:9px 12px; font-size:12px;
        color:var(--muted, #64748b); background:var(--panel-bg, #fff);
      }
      .xuan-map-legend {
        display:flex; flex-wrap:wrap; align-items:center; gap:10px;
        padding:7px 12px; font-size:11px;
        color:var(--muted, #64748b); background:var(--panel-bg, #fff);
      }
      .xuan-legend-dot {
        display:inline-block; width:9px; height:9px;
        border-radius:50%; margin-right:4px;
      }
      .xuan-station-popup { min-width:180px; line-height:1.65; }
      .xuan-station-popup strong { font-size:14px; }
      .xuan-map-error {
        padding:22px; color:#b91c1c; background:#fff1f2;
        border-radius:12px; font-size:13px; line-height:1.7;
      }
      .leaflet-container { font-family:inherit; }
      .leaflet-popup-content { margin:11px 13px; }
      @media(max-width:540px) {
        #weather-map { height:64vh; min-height:420px; }
        .xuan-map-toolbar { gap:6px; padding:8px; }
        .xuan-map-tab { flex:1; padding:8px 7px; }
      }
    `;
    document.head.appendChild(style);
  }

  function setStatus(message, isError = false) {
    const status = $(".updated");
    if (!status) return;
    status.textContent = message;
    status.style.color = isError ? "#dc2626" : "";
  }

  function prepareMapContainer() {
    const placeholder = $(".map-placeholder");
    if (!placeholder) return null;

    placeholder.classList.add("xuan-map-ready");
    placeholder.innerHTML = `
      <div class="xuan-map-toolbar" role="group" aria-label="測站地圖圖層">
        <button class="xuan-map-tab" type="button" data-layer="temperature" aria-pressed="true">🌡️ 氣溫</button>
        <button class="xuan-map-tab" type="button" data-layer="rain" aria-pressed="false">🌧️ 雨量</button>
        <button class="xuan-map-tab" type="button" data-layer="wind" aria-pressed="false">💨 風速</button>
      </div>
      <div id="weather-map" aria-label="台灣即時氣象測站地圖"></div>
      <div class="xuan-map-legend" id="xuan-map-legend"></div>
      <div class="xuan-map-footer">
        <span id="xuan-station-count">正在載入測站…</span>
        <span id="xuan-map-time">觀測時間：--</span>
      </div>
    `;

    placeholder.querySelectorAll(".xuan-map-tab").forEach(button => {
      button.addEventListener("click", () => {
        currentLayer = button.dataset.layer;
        placeholder.querySelectorAll(".xuan-map-tab").forEach(tab => {
          tab.setAttribute("aria-pressed", String(tab === button));
        });
        drawMarkers();
        updateLegend();
      });
    });

    return placeholder;
  }

  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletLoading) return leafletLoading;

    leafletLoading = new Promise((resolve, reject) => {
      if (!$("#xuan-leaflet-css")) {
        const css = document.createElement("link");
        css.id = "xuan-leaflet-css";
        css.rel = "stylesheet";
        css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(css);
      }

      const script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.async = true;
      script.onload = () => window.L ? resolve(window.L) : reject(new Error("Leaflet 載入失敗"));
      script.onerror = () => reject(new Error("無法載入 Leaflet 地圖套件，請確認網路連線"));
      document.head.appendChild(script);
    });

    return leafletLoading;
  }

  function createMap() {
    if (map || !window.L) return;

    map = L.map("weather-map", {
      center: MAP_CENTER,
      zoom: MAP_ZOOM,
      minZoom: 5,
      maxZoom: 18,
      preferCanvas: true,
      zoomControl: true,
      scrollWheelZoom: true
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    stationLayer = L.layerGroup().addTo(map);

    window.setTimeout(() => {
      if (map) map.invalidateSize();
    }, 250);

    window.addEventListener("resize", () => {
      if (map) map.invalidateSize();
    }, { passive: true });
  }

  function popupHtml(station) {
    const time = station.time
      ? new Date(station.time).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })
      : "--";

    return `
      <div class="xuan-station-popup">
        <strong>${safeText(station.name)}</strong><br>
        ${safeText(station.county)}${safeText(station.town)}<hr>
        氣溫：${formatNumber(station.temperature)} °C<br>
        天氣：${safeText(station.weather)}<br>
        濕度：${formatNumber(station.humidity, 0)} %<br>
        風速：${formatNumber(station.wind)} m/s<br>
        陣風：${formatNumber(station.gust)} m/s<br>
        雨量：${formatNumber(station.rain)} mm<br>
        <small>觀測時間：${safeText(time)}</small>
      </div>
    `;
  }

  function selectStation(station) {
    const location = $(".location");
    if (location) {
      location.innerHTML = `📍 <b>${safeText(station.name)}</b>　${safeText(station.county)}${safeText(station.town)}`;
    }

    const temperature = $(".temperature");
    if (temperature) {
      temperature.innerHTML = `${formatNumber(station.temperature)}<small>°C</small>`;
    }

    const condition = $(".condition");
    if (condition) condition.textContent = station.weather || "天氣資料未提供";

    const feels = $(".feels");
    if (feels) {
      const time = station.time
        ? new Date(station.time).toLocaleString("zh-TW", {
            timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false
          })
        : "--";
      feels.textContent = `體感溫度 --　｜　觀測時間 ${time}`;
    }

    const metricValues = [
      `${formatNumber(station.humidity, 0)}<em>%</em>`,
      `${formatNumber(station.wind)}<em>m/s</em>`,
      `${formatNumber(station.gust)}<em>m/s</em>`,
      `${formatNumber(station.rain)}<em>mm</em>`
    ];

    document.querySelectorAll(".metrics .metric strong").forEach((element, index) => {
      if (metricValues[index] !== undefined) element.innerHTML = metricValues[index];
    });
  }

  function drawMarkers() {
    if (!map || !stationLayer) return;

    stationLayer.clearLayers();

    const renderer = L.canvas({ padding: 0.5 });
    stations.forEach(station => {
      const value = getLayerValue(station);
      const marker = L.circleMarker([station.lat, station.lon], {
        renderer,
        radius: 5.5,
        color: "#ffffff",
        weight: 1.3,
        opacity: 1,
        fillColor: getColor(value),
        fillOpacity: 0.95
      });

      marker.bindPopup(popupHtml(station), { maxWidth: 260 });
      marker.on("click", () => selectStation(station));
      marker.addTo(stationLayer);
    });

    const validValues = stations.filter(station => getLayerValue(station) !== null).length;
    const count = $("#xuan-station-count");
    if (count) {
      count.textContent = `地圖範圍內有效座標：${stations.length.toLocaleString("zh-TW")} 站｜目前圖層有數值：${validValues.toLocaleString("zh-TW")} 站`;
    }
  }

  function updateLegend() {
    const legend = $("#xuan-map-legend");
    if (!legend) return;

    let items;
    if (currentLayer === "rain") {
      items = [["#94a3b8", "無資料／0"], ["#38bdf8", "0–10"], ["#0ea5e9", "10–40"], ["#2563eb", "40–80"], ["#7c3aed", "80以上"]];
    } else if (currentLayer === "wind") {
      items = [["#0d9488", "0–3"], ["#2563eb", "3–6"], ["#7c3aed", "6–10"], ["#d97706", "10–14"], ["#ea580c", "14–20"], ["#dc2626", "20以上"]];
    } else {
      items = [["#7c3aed", "10以下"], ["#2563eb", "10–15"], ["#0d9488", "15–20"], ["#16a34a", "20–25"], ["#eab308", "25–30"], ["#f97316", "30–35"], ["#dc2626", "35以上"]];
    }

    legend.innerHTML = `<strong>${layerLabel()}（${layerUnit()}）</strong>` + items.map(([color, label]) =>
      `<span><i class="xuan-legend-dot" style="background:${color}"></i>${label}</span>`
    ).join("");
  }

  async function loadWeatherData() {
    const refreshButton = $("#refresh-weather");
    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.textContent = "⏳ 載入中…";
    }

    setStatus("●　正在連線中央氣象署資料");

    try {
      const response = await fetch(`${DATA_URL}?_=${Date.now()}`, {
        cache: "no-store",
        headers: { "Accept": "application/json" }
      });

      if (!response.ok) {
        throw new Error(`資料檔讀取失敗（HTTP ${response.status}）：${DATA_URL}`);
      }

      const json = await response.json();
      const rawStations = json?.records?.Station;

      if (!Array.isArray(rawStations)) {
        throw new Error("JSON 格式不符合 O-A0001-001：找不到 records.Station");
      }

      stations = rawStations.map(normalizeStation).filter(Boolean);
      if (!stations.length) throw new Error("資料檔已讀取，但沒有可用的台灣測站座標");

      lastUpdatedText = latestObservationTime(stations);
      const timeLabel = $("#xuan-map-time");
      if (timeLabel) timeLabel.textContent = `觀測資料時間：${lastUpdatedText}`;

      drawMarkers();
      updateLegend();
      setStatus(`●　已載入中央氣象署測站資料｜${stations.length.toLocaleString("zh-TW")} 站`);

    } catch (error) {
      console.error("[Xuan Weather] 載入測站資料失敗：", error);
      setStatus(`●　測站資料載入失敗：${error.message}`, true);

      const count = $("#xuan-station-count");
      if (count) count.textContent = "測站資料尚未載入";
      const mapElement = $("#weather-map");
      if (mapElement && !stations.length) {
        mapElement.insertAdjacentHTML("beforeend",
          `<div class="xuan-map-error">無法讀取測站資料。<br>${safeText(error.message)}<br><br>請確認 GitHub Pages 中存在 <code>data/cwa-O-A0001-001.json</code>，且檔案已成功部署。</div>`
        );
      }
    } finally {
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.textContent = "🔄 重新整理";
      }
    }
  }

  function setupThemeButton() {
    const button = $("#theme");
    if (!button) return;

    button.addEventListener("click", () => {
      const isLight = document.body.classList.toggle("light");
      try {
        localStorage.setItem("xuan-weather-theme", isLight ? "light" : "dark");
      } catch (_) {}
    });

    try {
      if (localStorage.getItem("xuan-weather-theme") === "light") {
        document.body.classList.add("light");
      }
    } catch (_) {}
  }

  async function init() {
    addMapStyles();
    prepareMapContainer();
    setupThemeButton();

    const refreshButton = $("#refresh-weather");
    if (refreshButton) refreshButton.addEventListener("click", loadWeatherData);

    try {
      await loadLeaflet();
      createMap();
      await loadWeatherData();
    } catch (error) {
      console.error("[Xuan Weather] 地圖初始化失敗：", error);
      setStatus(`●　地圖初始化失敗：${error.message}`, true);
      const mapElement = $("#weather-map");
      if (mapElement) {
        mapElement.innerHTML = `<div class="xuan-map-error">${safeText(error.message)}<br>請確認網路可連線至 Leaflet CDN。</div>`;
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
