"""한국부동산원 R-ONE 상업용부동산 임대동향조사에서 서울·경기·인천 상가 임대료를 받습니다.

    REB_API_KEY=... python3 scripts/rent.py

상권별 1㎡당 월 임대료(천원, 전용+공용 면적 기준)를 data/rent.json에 씁니다.
동 단위가 아니라 상권 단위라, 화면에서는 동마다 가까운 상권 값을 붙입니다.
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
BASE = "https://www.reb.or.kr/r-one/openapi"
# 통계표 이름에 이 말이 들어간 것을 찾습니다. 이름으로 찾아 ID가 바뀌어도 따라갑니다.
WANT = {"small": "소규모상가", "large": "중대형상가", "complex": "집합상가"}
PROVINCES = ("서울", "경기", "인천")


def call(service, key, **params):
    query = urllib.parse.urlencode({"KEY": key, "Type": "json", **params})
    with urllib.request.urlopen(f"{BASE}/{service}.do?{query}", timeout=60) as res:
        data = json.loads(res.read().decode("utf-8"))
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
        rows, total = call(service, key, pIndex=page, pSize=1000, **params)
        out += rows
        if not rows or len(out) >= total:
            return out
        page += 1


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
        cands = [t for t in rent_tables if word in t["STATBL_NM"] and "지역별" in t["STATBL_NM"]] or \
                [t for t in rent_tables if word in t["STATBL_NM"]]
        if not cands:
            print(f"  {word} 임대료 통계표를 찾지 못했습니다.")
            continue
        t = sorted(cands, key=lambda x: (x.get("DTACYCLE_CD") != "QY", len(x["STATBL_NM"])))[0]
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
    if not out["tables"]:
        sys.exit("임대료 자료를 하나도 받지 못했습니다.")
    (DATA_DIR / "rent.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("data/rent.json 저장")


if __name__ == "__main__":
    main()
