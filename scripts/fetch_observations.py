import copy
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_KEY = os.environ.get("CWA_API_KEY")

# 保留三份官方原始資料，並另外產生 app.js 使用的整合檔。
DATASETS = (
    "O-A0001-001",  # 整點觀測
    "O-A0002-001",  # 雨量觀測
    "O-A0003-001",  # 10 分鐘即時觀測（優先覆蓋較舊觀測欄位）
)


def get_records(payload, dataset_id):
    records = payload.get("records")
    if not isinstance(records, dict):
        records = payload.get("result", {}).get("records")

    stations = records.get("Station") if isinstance(records, dict) else None
    if not isinstance(stations, list) or not stations:
        raise ValueError(f"{dataset_id} 沒有取得有效測站資料")
    return stations


def fetch_dataset(dataset_id):
    base_url = (
        "https://opendata.cwa.gov.tw/api/v1/rest/datastore/"
        + dataset_id
    )
    params = urllib.parse.urlencode({
        "Authorization": API_KEY,
        "format": "JSON",
    })
    request = urllib.request.Request(
        f"{base_url}?{params}",
        headers={"User-Agent": "Xuan-Weather/1.0"},
    )

    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.loads(response.read().decode("utf-8"))

    if not isinstance(payload, dict):
        raise ValueError(f"{dataset_id} 回傳格式錯誤")

    stations = get_records(payload, dataset_id)
    return payload, stations


def get_station_id(station):
    value = (
        station.get("StationId")
        or station.get("StationID")
        or station.get("StationNo")
    )
    return str(value) if value is not None else None


def deep_merge(base, extra):
    """遞迴合併不同資料集欄位；後面資料集的值優先。"""
    if not isinstance(base, dict) or not isinstance(extra, dict):
        return copy.deepcopy(extra)

    result = copy.deepcopy(base)
    for key, value in extra.items():
        if (
            key in result
            and isinstance(result[key], dict)
            and isinstance(value, dict)
        ):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = copy.deepcopy(value)
    return result


def find_value(obj, target):
    if isinstance(obj, dict):
        if target in obj:
            return obj[target]
        for value in obj.values():
            found = find_value(value, target)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for value in obj:
            found = find_value(value, target)
            if found is not None:
                return found
    return None


def merge_datasets(dataset_results):
    merged = {}
    source_counts = {}

    # 先整點，再雨量，最後以 10 分鐘即時觀測優先。
    for dataset_id in DATASETS:
        records = dataset_results[dataset_id]
        source_counts[dataset_id] = len(records)

        for station in records:
            station_id = get_station_id(station)
            if not station_id:
                continue

            if station_id not in merged:
                merged[station_id] = copy.deepcopy(station)
                merged[station_id]["DataSources"] = [dataset_id]
            else:
                merged[station_id] = deep_merge(merged[station_id], station)
                if dataset_id not in merged[station_id]["DataSources"]:
                    merged[station_id]["DataSources"].append(dataset_id)

    # app.js 的 parseStation() 讀取 WeatherElement.Now.Precipitation。
    # 若該欄位不存在，從合併後的雨量資料補入。
    for station in merged.values():
        weather = station.setdefault("WeatherElement", {})
        now = weather.setdefault("Now", {})
        if now.get("Precipitation") is None:
            rainfall = find_value(station.get("RainfallElement", {}), "Precipitation")
            if rainfall is not None:
                now["Precipitation"] = rainfall

    return list(merged.values()), source_counts


def atomic_write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    with temp_path.open("w", encoding="utf-8") as file:
        json.dump(
            payload,
            file,
            ensure_ascii=False,
            separators=(",", ":"),
        )
    temp_path.replace(path)


def latest_obs_time(stations):
    values = []
    for station in stations:
        obs = station.get("ObsTime")
        if isinstance(obs, dict):
            obs = obs.get("DateTime")
        if obs and obs != "-99":
            values.append(str(obs))
    return max(values) if values else "無 ObsTime 欄位"


def main():
    if not API_KEY:
        raise ValueError("找不到 CWA_API_KEY，請確認 GitHub Secrets 設定")

    # 先全部抓取與驗證成功，再一次產生四份檔案。
    fetched_payloads = {}
    dataset_results = {}

    for dataset_id in DATASETS:
        print(f"開始取得 {dataset_id}")
        payload, stations = fetch_dataset(dataset_id)
        fetched_payloads[dataset_id] = payload
        dataset_results[dataset_id] = stations
        print(
            f"{dataset_id} 成功：{len(stations)} 站；"
            f"最新觀測時間：{latest_obs_time(stations)}"
        )

    merged_stations, source_counts = merge_datasets(dataset_results)
    if not merged_stations:
        raise ValueError("整合後沒有有效測站")

    # 1) 保留三份官方原始 JSON，供其他既有前端功能使用。
    for dataset_id in DATASETS:
        output_path = Path("data") / f"cwa-{dataset_id}.json"
        atomic_write_json(output_path, fetched_payloads[dataset_id])
        print(f"已更新：{output_path}")

    # 2) 同時更新 app.js 使用的整合格式，避免它繼續讀取舊檔。
    merged_path = Path("data/cwa-observations.json")
    previous = None
    if merged_path.exists():
        try:
            previous = json.loads(merged_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            previous = None

    merged_output = {
        "success": True,
        "source": "中央氣象署",
        "datasets": list(DATASETS),
        "sourceCounts": source_counts,
        "stationCount": len(merged_stations),
        "stations": merged_stations,
    }

    # 若官方資料內容沒有變動，沿用上次資料更新時間，
    # 避免每 5 分鐘只因時間戳不同就產生一筆無意義 Git commit。
    comparable_keys = (
        "success", "source", "datasets", "sourceCounts",
        "stationCount", "stations",
    )
    unchanged = (
        isinstance(previous, dict)
        and all(previous.get(key) == merged_output.get(key)
                for key in comparable_keys)
    )
    merged_output["updatedAt"] = (
        previous.get("updatedAt")
        if unchanged and previous.get("updatedAt")
        else datetime.now(timezone.utc).isoformat()
    )

    atomic_write_json(merged_path, merged_output)

    print("--------------------------------")
    print("中央氣象署資料更新完成")
    print(f"整合測站：{len(merged_stations)}")
    print(f"各來源筆數：{source_counts}")
    print(f"整合檔最新觀測時間：{latest_obs_time(merged_stations)}")
    print(f"抓取完成時間（UTC）：{merged_output['updatedAt']}")
    print(f"已更新：{merged_path}")
    print("注意：抓取完成時間不等於各測站的官方觀測時間。")
    print("--------------------------------")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"氣象資料更新失敗：{error}")
        sys.exit(1)
