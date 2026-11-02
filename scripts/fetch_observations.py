import copy
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_KEY = os.environ.get("CWA_API_KEY")

DATASETS = {
    "O-A0001-001": "hourly",
    "O-A0002-001": "rainfall",
    "O-A0003-001": "ten_minute",
}


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
        result = json.loads(response.read().decode("utf-8"))

    if not isinstance(result, dict):
        raise ValueError(f"{dataset_id} 回傳格式錯誤")

    stations = result.get("records", {}).get("Station", [])

    if not isinstance(stations, list) or not stations:
        raise ValueError(
            f"{dataset_id} 沒有取得有效測站資料"
        )

    return stations


def deep_merge(base, extra):
    """遞迴合併資料，保留不同來源的欄位。"""
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
    """從巢狀資料中尋找指定欄位。"""
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


def get_station_id(station):
    return (
        station.get("StationId")
        or station.get("StationID")
        or station.get("StationNo")
    )


def merge_datasets(dataset_results):
    merged = {}
    source_counts = {}

    # 先逐時資料，再雨量資料，最後以10分鐘資料優先
    priority = [
        "O-A0001-001",
        "O-A0002-001",
        "O-A0003-001",
    ]

    for dataset_id in priority:
        records = dataset_results[dataset_id]
        source_counts[dataset_id] = len(records)

        for station in records:
            station_id = get_station_id(station)

            if not station_id:
                continue

            station_id = str(station_id)

            if station_id not in merged:
                merged[station_id] = copy.deepcopy(station)
                merged[station_id]["DataSources"] = []
            else:
                merged[station_id] = deep_merge(
                    merged[station_id],
                    station,
                )

            if dataset_id not in merged[station_id]["DataSources"]:
                merged[station_id]["DataSources"].append(dataset_id)

    # 將雨量資料補進前端既有的觀測欄位
    for station in merged.values():
        weather = station.setdefault("WeatherElement", {})
        now = weather.setdefault("Now", {})

        precipitation = now.get("Precipitation")

        if precipitation is None:
            rainfall = find_value(
                station,
                "Precipitation",
            )

            if rainfall is not None:
                now["Precipitation"] = rainfall

    return list(merged.values()), source_counts


def main():
    if not API_KEY:
        raise ValueError("找不到 CWA_API_KEY")

    dataset_results = {}

    for dataset_id in DATASETS:
        print(f"開始取得 {dataset_id}")

        records = fetch_dataset(dataset_id)

        dataset_results[dataset_id] = records

        print(
            f"{dataset_id} 成功取得 {len(records)} 筆"
        )

    stations, source_counts = merge_datasets(
        dataset_results
    )

    if not stations:
        raise ValueError("整合後沒有有效測站")

    output = {
        "success": True,
        "source": "中央氣象署",
        "datasets": list(DATASETS.keys()),
        "sourceCounts": source_counts,
        "stationCount": len(stations),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "stations": stations,
    }

    output_path = Path("data/cwa-observations.json")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    temp_path = output_path.with_suffix(".tmp")

    with temp_path.open("w", encoding="utf-8") as file:
        json.dump(
            output,
            file,
            ensure_ascii=False,
            separators=(",", ":"),
        )

    temp_path.replace(output_path)

    print("--------------------------------")
    print("三個資料來源整合完成")
    print(f"整合後不重複測站：{len(stations)}")
    print(f"各來源筆數：{source_counts}")
    print(f"資料檔案：{output_path}")
    print("--------------------------------")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"氣象資料更新失敗：{error}")
        sys.exit(1)
