import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

CWA_KEY = os.environ.get("CWA_API_KEY", "").strip()
MOENV_KEY = os.environ.get("MOENV_API_KEY", "").strip()
OUT = Path("data/weather-products.json")


def get_json(url, headers=None):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Xuan-Weather/1.0", **(headers or {})},
    )
    with urllib.request.urlopen(req, timeout=90) as response:
        payload = json.loads(response.read().decode("utf-8-sig"))
    if not isinstance(payload, dict):
        raise ValueError("API 回傳格式不是 JSON object")
    return payload


def fetch_cwa_forecast():
    if not CWA_KEY:
        raise ValueError("缺少 GitHub Secret CWA_API_KEY")
    query = urllib.parse.urlencode({"Authorization": CWA_KEY, "format": "JSON"})
    url = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-093?" + query
    payload = get_json(url)
    records = payload.get("records") or payload.get("Records") or {}
    locations = records.get("locations") or records.get("Locations")
    if not isinstance(locations, list) or not locations:
        raise ValueError("CWA F-D0047-093 沒有有效的鄉鎮預報 locations")
    location_count = sum(
        len(group.get("location", []))
        for group in locations if isinstance(group, dict)
        and isinstance(group.get("location", []), list)
    )
    if location_count < 100:
        raise ValueError(f"CWA 鄉鎮預報筆數異常：{location_count}")
    return locations, payload.get("records", {}).get("datasetDescription", "F-D0047-093"), location_count


def extract_rows(payload, dataset_id):
    rows = payload.get("records")
    if rows is None:
        rows = payload.get("Records")
    if isinstance(rows, dict):
        rows = rows.get("data") or rows.get("Data") or rows.get("records")
    if not isinstance(rows, list):
        raise ValueError(f"{dataset_id} records 不是陣列")
    rows = [row for row in rows if isinstance(row, dict)]
    if not rows:
        raise ValueError(f"{dataset_id} 沒有有效資料")
    return rows


def fetch_moenv(dataset_id):
    if not MOENV_KEY:
        raise ValueError("缺少 GitHub Secret MOENV_API_KEY；請在 weather-site repository 設定")
    query = urllib.parse.urlencode({
        "api_key": MOENV_KEY,
        "limit": "1000",
        "format": "JSON",
    })
    url = f"https://data.moenv.gov.tw/api/v2/{dataset_id.lower()}?{query}"
    payload = get_json(url)
    rows = extract_rows(payload, dataset_id)
    return rows


def atomic_write(payload):
    OUT.parent.mkdir(parents=True, exist_ok=True)
    tmp = OUT.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    tmp.replace(OUT)


def main():
    print("下載中央氣象署 F-D0047-093 全臺鄉鎮預報…")
    locations, description, town_count = fetch_cwa_forecast()
    print(f"CWA 預報鄉鎮：{town_count}")

    print("下載環境部 AQX_P_432 空氣品質指標…")
    aqi = fetch_moenv("AQX_P_432")
    print(f"AQI 測站筆數：{len(aqi)}")

    print("下載環境部 UV_S_01 即時紫外線…")
    uv = fetch_moenv("UV_S_01")
    print(f"UV 測站筆數：{len(uv)}")

    output = {
        "success": True,
        "source": {
            "forecast": "中央氣象署 F-D0047-093",
            "aqi": "環境部 AQX_P_432",
            "uv": "環境部 UV_S_01",
        },
        "forecast": {
            "dataset": "F-D0047-093",
            "description": description,
            "locations": locations,
        },
        "aqi": aqi,
        "uv": uv,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    atomic_write(output)
    print(f"已更新 {OUT}；鄉鎮 {town_count}、AQI {len(aqi)}、UV {len(uv)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"天氣預報與環境資料更新失敗：{exc}", file=sys.stderr)
        sys.exit(1)
