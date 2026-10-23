"""나이스 학원교습소정보의 수강료 글자 형식을 몇 건 찍어 봅니다 (임시 점검용)."""
import json, os, urllib.parse, urllib.request

params = {"KEY": os.environ["NEIS_API_KEY"], "Type": "json", "pIndex": 1, "pSize": 300,
          "ATPT_OFCDC_SC_CODE": "B10", "ADMST_ZONE_NM": "노원구"}
url = "https://open.neis.go.kr/hub/acaInsTiInfo?" + urllib.parse.urlencode(params)
rows = json.load(urllib.request.urlopen(url, timeout=60))["acaInsTiInfo"][1]["row"]
print("fields:", sorted(rows[0].keys()))
shown = 0
for row in rows:
    if row.get("REG_STTUS_NM") != "개원" or "보습" not in (row.get("REALM_SC_NM") or ""):
        continue
    print({k: row.get(k) for k in ("ACA_INSTI_SC_NM", "LE_CRSE_LIST_NM", "LE_CRSE_NM", "PSNBY_THCC_CNTNT", "THCC_OTHBC_YN", "TOFOR_SMTOT")})
    shown += 1
    if shown >= 25:
        break
