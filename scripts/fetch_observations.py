import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_KEY = os.environ.get("CWA_API_KEY")

# 這三份檔案名稱必須與 Xuan Weather index.html 的 fetchCwaDataset() 一致。
DATASETS = (
    "O-A0001-001",  # 整點觀測
    "O-A0002-001",  # 雨量觀測
    "O-A0003-001",  # 10 分鐘即時觀測
)


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

    # 前端 normalizeCwaPayload() 可直接讀取官方原始 result.records。
    records = (
        payload.get("records")
        or payload.get("result", {}).get("records")
    )
    stations = records.get("Station") if isinstance(records, dict) else None

    if not isinstance(stations, list) or not stations:
        raise ValueError(f"{dataset_id} 沒有取得有效測站資料")

    return payload, stations


def latest_obs_time(stations):
    values = []
    for station in stations:
        obs = station.get("ObsTime")
        if isinstance(obs, dict):
            obs = obs.get("DateTime")
        if obs:
            values.append(str(obs))
    return max(values) if values else "無 ObsTime 欄位"


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


def main():
    if not API_KEY:
        raise ValueError("找不到 CWA_API_KEY，請確認 GitHub Secrets 設定")

    # 先全部抓取並驗證成功，再寫檔，避免其中一個 API 失敗時
    # 留下三份資料只有部分更新的狀態。
    fetched = {}
    for dataset_id in DATASETS:
        print(f"開始取得 {dataset_id}")
        payload, stations = fetch_dataset(dataset_id)
        fetched[dataset_id] = (payload, stations)
        print(
            f"{dataset_id} 成功：{len(stations)} 站；"
            f"最新觀測時間：{latest_obs_time(stations)}"
        )

    for dataset_id in DATASETS:
        payload, stations = fetched[dataset_id]
        output_path = Path("data") / f"cwa-{dataset_id}.json"
        atomic_write_json(output_path, payload)
        print(f"已更新：{output_path}")

    print("--------------------------------")
    print("中央氣象署三份觀測資料更新完成")
    print("抓取完成時間（UTC）：", datetime.now(timezone.utc).isoformat())
    print("注意：抓取完成時間不等於官方觀測時間。")
    print("--------------------------------")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"氣象資料更新失敗：{error}")
        sys.exit(1)
