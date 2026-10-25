"""공공데이터포털 키가 실거래가·청약홈에서 열리는지 1건씩만 불러 확인합니다. 키 값은 찍지 않습니다.

    DATA_GO_KR_KEY=... python3 scripts/check_keys.py
"""
import os
import urllib.error
import urllib.parse
import urllib.request

from update_data import APT_URLS, PRESALE_URL

raw = (os.environ.get("DATA_GO_KR_KEY") or "").strip()
key = urllib.parse.unquote(raw)
print(f"키 길이 {len(raw)}자, % 들어 있음(Encoding 키): {'%' in raw}, 앞뒤 공백·따옴표: {raw != raw.strip(chr(34) + chr(39) + ' ')}")
checks = [(u.split("/")[-1], f"{u}?" + urllib.parse.urlencode({"serviceKey": key, "LAWD_CD": "11110", "DEAL_YMD": "202609", "pageNo": 1, "numOfRows": 1})) for u in APT_URLS]
checks.append(("청약홈 분양정보", f"{PRESALE_URL}?" + urllib.parse.urlencode({"page": 1, "perPage": 1, "serviceKey": key})))
for name, url in checks:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "academy-search"}), timeout=30) as res:
            body = res.read().decode("utf-8", "replace")
            print(f"{name}: HTTP {res.status} {body[:200].replace(key, '***')}")
    except urllib.error.HTTPError as e:
        print(f"{name}: HTTP {e.code} {e.read().decode('utf-8', 'replace')[:200].replace(key, '***')}")
    except Exception as e:
        print(f"{name}: 실패 {e}")
