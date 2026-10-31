#!/usr/bin/env python3
import json, os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.parse import urlencode
KEY=os.environ.get("CWA_API_KEY","").strip()
if not KEY: raise SystemExit("Missing CWA_API_KEY repository secret")
url="https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-093?"+urlencode({"Authorization":KEY,"format":"JSON"})
req=Request(url,headers={"User-Agent":"TaiwanWeatherMonitorCenter/1.0"})
with urlopen(req,timeout=60) as r: payload=json.loads(r.read().decode("utf-8"))
if payload.get("success") is False: raise SystemExit("CWA F-D0047-093 API success=false")
raw=(payload.get("records") or {}).get("locations") or []
if not raw: raise SystemExit("F-D0047-093 contains no locations")
def number(v):
    try:return float(v)
    except (TypeError,ValueError):return None
def element_map(location):
    result={}
    for e in location.get("weatherElement",[]):
        name=e.get("elementName")
        for t in e.get("time",[]):
            start=t.get("startTime") or t.get("dataTime") or ""
            ev=(t.get("elementValue") or [{}])[0]
            value=ev.get("value")
            result.setdefault(start,{})[name]=value
    return result
county_codes = {
 "63000":"臺北市","65000":"新北市","68000":"桃園市","66000":"臺中市","67000":"臺南市","64000":"高雄市",
 "10002":"宜蘭縣","10004":"新竹縣","10005":"苗栗縣","10007":"彰化縣","10008":"南投縣","10009":"雲林縣",
 "10010":"嘉義縣","10013":"屏東縣","10014":"臺東縣","10015":"花蓮縣","10016":"澎湖縣","10017":"基隆市",
 "10018":"新竹市","10020":"嘉義市","09020":"金門縣","09007":"連江縣"
}
locations=[]
for group in raw:
    group_county=group.get("locationsName") or group.get("locationsname") or ""
    for loc in group.get("location",[]):
        name=loc.get("locationName") or ""
        geocode=str(loc.get("geocode") or "")
        county=loc.get("countyName") or loc.get("CountyName") or group_county
        if county in ("臺灣","台灣","全臺灣","全台灣",""):
            county=next((v for k,v in county_codes.items() if geocode.startswith(k)),county)
        if county in ("臺灣","台灣","全臺灣","全台灣",""):
            county=loc.get("county") or loc.get("administrativeArea") or "未分類縣市"
        tm=element_map(loc)
        hourly=[]
        for t,v in sorted(tm.items()):
            if not t: continue
            wx=v.get("Wx") or v.get("Weather") or v.get("WeatherDescription") or ""
            temp=number(v.get("T"))
            if temp is None and not wx: continue
            hourly.append({"time":t,"temperature":round(temp) if temp is not None else None,"weather":wx,"pop":number(v.get("PoP12h") or v.get("PoP")),"humidity":number(v.get("RH"))})
        # Group the official time periods into calendar-day summaries. Keep actual source periods and do not synthesize missing values.
        byday={}
        for t,v in sorted(tm.items()):
            day=t[:10]
            if not day: continue
            d=byday.setdefault(day,{"date":day,"max":None,"min":None,"pop":None,"weather":""})
            mx=number(v.get("MaxT"));mn=number(v.get("MinT"));pop=number(v.get("PoP12h") or v.get("PoP"))
            if mx is not None:d["max"]=mx if d["max"] is None else max(d["max"],mx)
            if mn is not None:d["min"]=mn if d["min"] is None else min(d["min"],mn)
            if pop is not None:d["pop"]=pop if d["pop"] is None else max(d["pop"],pop)
            if not d["weather"]:d["weather"]=v.get("Wx") or v.get("Weather") or v.get("WeatherDescription") or ""
        # Fallback daily max/min elements often use 12h periods; merge all available periods by date.
        locations.append({"county":county,"town":name,"hourly":hourly[:8],"daily":list(byday.values())[:7]})
if not locations: raise SystemExit("No normalized township forecasts")
now=datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")
Path("data/forecasts.json").write_text(json.dumps({"source":"中央氣象署","dataset_id":"F-D0047-093","fetched_at":now,"locations":locations},ensure_ascii=False,indent=2),encoding="utf-8")
print(f"Saved {len(locations)} township forecast locations")
