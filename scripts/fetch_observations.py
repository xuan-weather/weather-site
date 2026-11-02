import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_KEY = os.environ.get("CWA_API_KEY")

if not API_KEY:
    print("錯誤：找不到 CWA_API_KEY")
    sys.exit(1)

API_URL = (
    "https://opendata.cwa.gov.tw/api/v1/rest/datastore/"
    "O-A0003-001"
)

params = urllib.parse.urlencode({
    "Authorization": API_KEY,
    "format": "JSON",
})

url = f"{API_URL}?{params}"

try:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Xuan-Weather/1.0"}
    )

    with urllib.request.urlopen(request, timeout=40) as response:
        result = json.loads(response.read().decode("utf-8"))

    if not isinstance(result, dict):
        raise ValueError("API 回傳格式不是 JSON 物件")

    records = result.get("records", {})
    stations = records.get("Station", [])

    if not isinstance(stations, list) or not stations:
        raise ValueError("API 沒有回傳有效測站資料")

    output = {
        "success": True,
        "source": "中央氣象署 O-A0003-001",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "stationCount": len(stations),
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
            separators=(",", ":")
        )

    temp_path.replace(output_path)

    print(f"成功取得 {len(stations)} 個測站")
    print(f"資料已儲存：{output_path}")

except Exception as error:
    print(f"氣象資料更新失敗：{error}")
    sys.exit(1)
