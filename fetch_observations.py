#!/usr/bin/env python3
import json, os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlencode

KEY=os.environ.get("CWA_API_KEY","").strip()
if not KEY: raise SystemExit("Missing CWA_API_KEY repository secret")
BASE="https://opendata.cwa.gov.tw/api/v1/rest/datastore/"
def api(dataset):
    url=BASE+dataset+"?"+urlencode({"Authorization":KEY,"format":"JSON"})
    req=Request(url,headers={"User-Agent":"TaiwanWeatherMonitorCenter/1.0"})
    with urlopen(req,timeout=45) as r: data=json.loads(r.read().decode("utf-8"))
    if data.get("success") is False: raise RuntimeError(f"{dataset}: API success=false")
    return data.get("records",{})
def num(v):
    try:
        x=float(v)
        return x if x>-90 else None
    except (TypeError,ValueError): return None
def val(obj,*keys):
    for k in keys:
        cur=obj
        for part in k.split("."):
            cur=cur.get(part) if isinstance(cur,dict) else None
        if cur not in (None,"","-99","-99.0"): return cur
    return None
records=api("O-A0003-001")
stations=records.get("Station") or []
out=[]
for s in stations:
    w=s.get("WeatherElement") or {}
    coords=(s.get("GeoInfo") or {}).get("Coordinates") or []
    lat=lon=None
    for c in coords:
        lat=num(c.get("StationLatitude"));lon=num(c.get("StationLongitude"))
        if lat is not None and lon is not None: break
    if lat is None or lon is None: continue
    obs=s.get("ObsTime") or {}
    out.append({
      "id":s.get("StationId"),"name":s.get("StationName") or s.get("StationId"),
      "county":val(s,"GeoInfo.CountyName"),"town":val(s,"GeoInfo.TownName"),
      "latitude":lat,"longitude":lon,"observation_time":obs.get("DateTime"),
      "weather":val(w,"Weather"),"temperature":num(val(w,"AirTemperature")),
      "humidity":num(val(w,"RelativeHumidity")),"wind_direction":num(val(w,"WindDirection")),
      "wind_speed":num(val(w,"WindSpeed")),"gust":num(val(w,"GustInfo.PeakGustSpeed")),
      "precipitation":num(val(w,"Now.Precipitation","Precipitation")),
      "pressure":num(val(w,"AirPressure"))
    })
if not out: raise SystemExit("O-A0003-001 returned no valid station records")
now=datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
Path("data/observations.json").write_text(json.dumps({"source":"中央氣象署","dataset_id":"O-A0003-001","fetched_at":now,"status":"ok","station_count":len(out),"stations":out},ensure_ascii=False,indent=2),encoding="utf-8")
print(f"Saved {len(out)} actual CWA stations")
