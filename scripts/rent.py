"""한국부동산원 R-ONE 상업용부동산 임대동향조사에서 서울·경기·인천 상가 임대료를 받습니다.

    REB_API_KEY=... python3 scripts/rent.py

상권별 1㎡당 월 임대료(천원, 전용+공용 면적 기준)를 data/rent.json에 씁니다.
동 단위가 아니라 상권 단위라, 화면에서는 동마다 가까운 상권 값을 붙입니다.
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
BASE = "https://www.reb.or.kr/r-one/openapi"
# 통계표 이름에 이 말이 들어간 것을 찾습니다. 이름으로 찾아 ID가 바뀌어도 따라갑니다.
WANT = {"small": "소규모 상가", "large": "중대형 상가", "complex": "집합 상가"}
PROVINCES = ("서울", "경기", "인천")
PAGE = 200


def call(service, key, **params):
    query = urllib.parse.urlencode({"KEY": key, "Type": "json", **params})
    req = urllib.request.Request(f"{BASE}/{service}.do?{query}", headers={"User-Agent": "Mozilla/5.0 academy-search"})
    for attempt in range(5):  # R-ONE은 가끔 응답 없이 연결을 끊어 몇 번 다시 시도합니다.
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                data = json.loads(res.read().decode("utf-8"))
            break
        except Exception as e:
            if attempt == 4:
                raise
            print(f"    {service} 다시 시도 ({e})")
            time.sleep(2 ** attempt)
    parts = data.get(service) or []
    head = next((p["head"] for p in parts if "head" in p), [])
    result = next((h["RESULT"] for h in head if "RESULT" in h), {})
    total = next((h["list_total_count"] for h in head if "list_total_count" in h), 0)
    rows = next((p["row"] for p in parts if "row" in p), [])
    if not rows and result.get("CODE") not in (None, "INFO-000"):
        raise RuntimeError(f"{service}: {result.get('CODE')} {result.get('MESSAGE')} (응답: {str(data)[:300]})")
    return rows, total


def all_rows(service, key, **params):
    out, page = [], 1
    while True:
        rows, total = call(service, key, pIndex=page, pSize=PAGE, **params)
        out += rows
        if not rows or len(out) >= total:
            return out
        page += 1


UPPER = ("2층", "3층", "4층", "5층", "6층이상")


def attach_upper(out, floor_rows):
    """상권마다 2층 이상 임대료(층별 단순 평균)를 붙입니다. 지하와 1층은 뺍니다.

    2층 이상 값이 없는 상권은 위 단계(권역·시도)의 '2층 이상 ÷ 1층' 비율을 그 상권 1층 값에 곱합니다.
    """
    for kind, rows in floor_rows.items():
        floors = {}
        for r in rows:
            if r.get("ITM_NM") == "임대료" and r.get("DTA_VAL") is not None:
                floors.setdefault(r.get("GRP_FULLNM"), {})[r.get("CLS_NM")] = float(r["DTA_VAL"])
        upper = {g: sum(v[f] for f in UPPER if f in v) / n for g, v in floors.items() if (n := sum(f in v for f in UPPER))}
        ratio = {g: upper[g] / v["1층"] for g, v in floors.items() if g in upper and v.get("1층")}
        table = out["tables"].get(kind)
        if not table:
            continue
        filled = borrowed = 0
        for row in table["rows"]:
            g = row["full"]
            if g in upper:
                row["upper"], row["upperFloors"] = round(upper[g], 2), [f for f in UPPER if f in floors[g]]
                filled += 1
                continue
            parts = g.split(">")
            parent = next((">".join(parts[:i]) for i in range(len(parts) - 1, 0, -1) if ">".join(parts[:i]) in ratio), None)
            if parent:
                row["upper"], row["upperFrom"] = round(row["value"] * ratio[parent], 2), parent
                borrowed += 1
        print(f"    {kind}: 2층 이상 값 {filled}곳, 위 단계 비율로 어림 {borrowed}곳, 없음 {len(table['rows']) - filled - borrowed}곳")


def main():
    key = (os.environ.get("REB_API_KEY") or "").strip()
    if not key:
        sys.exit("REB_API_KEY 환경변수가 필요합니다.")
    tables = all_rows("SttsApiTbl", key)
    print(f"R-ONE 통계표 {len(tables)}개")
    rent_tables = [t for t in tables if "임대료" in (t.get("STATBL_NM") or "")]
    for t in rent_tables:
        print(f"  {t.get('STATBL_ID')} | {t.get('STATBL_NM')} | 주기 {t.get('DTACYCLE_CD')} | {t.get('RPSTUI_NM') or ''}")
    out = {"source": "한국부동산원 상업용부동산 임대동향조사 (R-ONE)", "unit": "", "tables": {}}
    for kind, word in WANT.items():
        # 같은 통계가 기간별로 나뉘어 있어(예: '(2022년~)', '(2024년3분기~)') 가장 최근에 시작한 표를 씁니다.
        cands = [t for t in rent_tables if word in t["STATBL_NM"] and "지역별 임대료" in t["STATBL_NM"] and "~)" in t["STATBL_NM"]]
        if not cands:
            print(f"  {word} 임대료 통계표를 찾지 못했습니다.")
            continue
        start = lambda x: re.search(r"\((\d{4})년(\d)?", x["STATBL_NM"])
        t = max(cands, key=lambda x: (int(start(x).group(1)), int(start(x).group(2) or 0)) if start(x) else (0, 0))
        cycle = t.get("DTACYCLE_CD") or "QY"
        rows = all_rows("SttsApiTblData", key, STATBL_ID=t["STATBL_ID"], DTACYCLE_CD=cycle)
        if not rows:
            print(f"  {t['STATBL_NM']}: 자료 없음")
            continue
        latest = max(r["WRTTIME_IDTFR_ID"] for r in rows)
        rows = [r for r in rows if r["WRTTIME_IDTFR_ID"] == latest and r.get("DTA_VAL") is not None]
        items = sorted({r.get("ITM_NM") for r in rows})
        print(f"  {t['STATBL_NM']} ({t['STATBL_ID']}): {latest}, {len(rows)}줄, 항목 {items}, 단위 {rows[0].get('UI_NM')}")
        print(f"    예: {[r.get('CLS_FULLNM') for r in rows[:8]]}")
        keep = [{"name": r.get("CLS_NM"), "full": r.get("CLS_FULLNM"), "item": r.get("ITM_NM"), "value": round(float(r["DTA_VAL"]), 2)}
                for r in rows if any((r.get("CLS_FULLNM") or "").startswith(p) for p in PROVINCES)]
        out["tables"][kind] = {"id": t["STATBL_ID"], "name": t["STATBL_NM"], "period": rows[0].get("WRTTIME_DESC") or latest,
                               "unit": rows[0].get("UI_NM"), "rows": keep}
        print(f"    서울·경기·인천 {len(keep)}곳")
    # 학원은 1층을 거의 쓰지 않아, 층별 임대료 표에서 2층 이상 값을 따로 받습니다.
    # 지역별 임대료 표의 값은 1층 임대료와 같습니다(2026년 2분기 서울 중대형 56.71 = 층별 표 1층 56.7).
    floor_rows, out["floors"] = {}, {}
    for kind, word in WANT.items():
        cands = [t for t in tables if "층별임대료" in (t.get("STATBL_NM") or "") and word in t["STATBL_NM"] and "~)" in t["STATBL_NM"]]
        if not cands:
            print(f"  {word} 층별 임대료 통계표를 찾지 못했습니다.")
            continue
        start = lambda x: re.search(r"\((\d{4})년(\d)?", x["STATBL_NM"])
        t = max(cands, key=lambda x: (int(start(x).group(1)), int(start(x).group(2) or 0)) if start(x) else (0, 0))
        rows = all_rows("SttsApiTblData", key, STATBL_ID=t["STATBL_ID"], DTACYCLE_CD=t.get("DTACYCLE_CD") or "QY")
        if not rows:
            continue
        latest = max(r["WRTTIME_IDTFR_ID"] for r in rows)
        rows = [r for r in rows if r["WRTTIME_IDTFR_ID"] == latest]
        print(f"  {t['STATBL_NM']} ({t['STATBL_ID']}): {latest}, {len(rows)}줄")
        floor_rows[kind] = rows
        out["floors"][kind] = {"id": t["STATBL_ID"], "name": t["STATBL_NM"], "period": rows[0].get("WRTTIME_DESC") or latest}
    attach_upper(out, floor_rows)
    if not out["tables"]:
        sys.exit("임대료 자료를 하나도 받지 못했습니다.")
    (DATA_DIR / "rent.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("data/rent.json 저장")


if __name__ == "__main__":
    main()
