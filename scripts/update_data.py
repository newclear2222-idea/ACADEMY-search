"""공공데이터 API에서 서울·경기 전체의 학원 목록과 학교별 학생 수를 받아
data/<지역>.json (구·시·군마다 하나)과 data/regions.json 을 새로 만듭니다.

필요한 환경변수 (GitHub 저장소 Secrets에 넣어 둡니다. 코드에는 절대 적지 않습니다):
  NEIS_API_KEY        나이스 교육정보 개방포털 인증키 (학원교습소정보)
  SCHOOLINFO_API_KEY  학교알리미 OpenAPI 인증키 (학교기본정보, 학년별·학급별 학생수)

사용 예:
  python3 scripts/update_data.py              # 서울, 경기 모두
  python3 scripts/update_data.py 서울특별시   # 서울만
"""

import datetime
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

NEIS_URL = "https://open.neis.go.kr/hub/acaInsTiInfo"
NEIS_SCHOOL_URL = "https://open.neis.go.kr/hub/schoolInfo"
SCHOOLINFO_URL = "https://www.schoolinfo.go.kr/openApi.do"

# office: 나이스 시도교육청 코드, sido/sgg: 학교알리미 시도·시군구 코드
# 구가 있는 시는 시 코드와 구 코드를 모두 넣습니다. 같은 학교는 한 번만 셉니다.
PROVINCES = {
    "서울특별시": {
        "short": "서울",
        "office": "B10",
        "sido": "11",
        "sgg": [
            "11110", "11140", "11170", "11200", "11215", "11230", "11260", "11290", "11305",
            "11320", "11350", "11380", "11410", "11440", "11470", "11500", "11530", "11545",
            "11560", "11590", "11620", "11650", "11680", "11710", "11740",
        ],
    },
    "경기도": {
        "short": "경기",
        "office": "J10",
        "sido": "41",
        "sgg": [
            "41110", "41111", "41113", "41115", "41117", "41130", "41131", "41133", "41135",
            "41150", "41170", "41171", "41173", "41190", "41192", "41194", "41196", "41210",
            "41220", "41250", "41270", "41271", "41273", "41280", "41281", "41285", "41287",
            "41290", "41310", "41360", "41370", "41390", "41410", "41430", "41450", "41460",
            "41461", "41463", "41465", "41480", "41500", "41550", "41570", "41590", "41591",
            "41593", "41595", "41597", "41610", "41630", "41650", "41670", "41800", "41820",
            "41830",
        ],
    },
}

PROVINCE_ALIASES = {"서울": "서울특별시", "서울시": "서울특별시", "경기": "경기도"}

# 옛 이름으로 남은 주소를 지금 이름으로 맞춥니다.
REGION_RENAMES = {"여주군": "여주시", "포천군": "포천시"}

# 도로명주소 괄호 안의 건물 이름이 동 이름처럼 보이는 경우를 거릅니다. 예: (OO아파트상가동)
NOT_AREA_WORDS = ("상가", "아파트", "빌딩", "타운", "프라자", "플라자", "센터", "오피스")

# 학교알리미 학교급 코드
SCHOOL_KINDS = {"elem": "02", "middle": "03", "high": "04"}

SUBJECT_KEYWORDS = {
    "math": ["수학"],
    "english": ["영어"],
}


def get_json(url, params, tries=4):
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(f"{url}?{query}", headers={"User-Agent": "academy-search"})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(request, timeout=60) as res:
                return json.loads(res.read().decode("utf-8"))
        except Exception as error:  # 네트워크 오류는 잠시 쉬고 다시 시도
            if attempt == tries - 1:
                raise
            print(f"  다시 시도합니다 ({error})", file=sys.stderr)
            time.sleep(2 ** (attempt + 1))


def neis_rows(url, service, key, params):
    """나이스 API를 1,000건씩 끝까지 받습니다."""
    rows = []
    page = 1
    while True:
        data = get_json(url, {"KEY": key, "Type": "json", "pIndex": page, "pSize": 1000, **params})
        if service not in data:
            result = data.get("RESULT", {})
            if result.get("CODE") == "INFO-200":  # 해당하는 데이터가 없습니다
                break
            sys.exit(f"나이스 API 오류: {result.get('CODE')} {result.get('MESSAGE')}")
        head, body = data[service]
        total = head["head"][0]["list_total_count"]
        rows.extend(body["row"])
        if len(rows) >= total:
            break
        page += 1
    return rows


def fetch_academies(key, office):
    """나이스 학원교습소정보에서 시도교육청 관할 학원·교습소 전체를 받습니다."""
    rows = neis_rows(NEIS_URL, "acaInsTiInfo", key, {"ATPT_OFCDC_SC_CODE": office})
    print(f"  학원·교습소 {len(rows)}곳을 받았습니다.")
    return rows


def fetch_neis_school_addresses(key, office):
    """나이스 학교기본정보의 학교 주소를 (구·시·군, 학교명)으로 찾을 수 있게 모읍니다.

    학교알리미에 주소가 없는 학교(예: 2026년 새 구가 생긴 화성시)를 채우는 데 씁니다.
    """
    addresses = {}
    for row in neis_rows(NEIS_SCHOOL_URL, "schoolInfo", key, {"ATPT_OFCDC_SC_CODE": office}):
        address = f"{row.get('ORG_RDNMA') or ''} {row.get('ORG_RDNDA') or ''}".strip()
        region = region_of(address)
        if region:
            name = row.get("SCHUL_NM")
            addresses[(region[1], name)] = address
            # 지역을 모를 때를 위해 학교 이름만으로도 찾게 하되, 같은 이름이 여럿이면 쓰지 않습니다.
            addresses[("", name)] = None if ("", name) in addresses else address
    return addresses


def schoolinfo_list(key, params):
    data = get_json(SCHOOLINFO_URL, {"apiKey": key, **params})
    return data.get("list", []) if data.get("resultCode") == "success" else []


def fetch_schools(key, province, neis_addresses):
    """학교알리미에서 학교 주소(apiType 0)와 학교별 학생 수(apiType 09)를 받습니다.

    올해 공시가 아직 없으면 작년 공시를 씁니다.
    """
    config = PROVINCES[province]
    # 시군구 코드 없이 시도 전체도 한 번 요청합니다. 코드가 바뀐 지역(예: 2026년 화성시 구 신설)을 놓치지 않기 위해서입니다.
    sgg_codes = [""] + config["sgg"]
    address_of = {}
    for sgg in sgg_codes:
        for kind in SCHOOL_KINDS.values():
            for row in schoolinfo_list(key, {
                "apiType": "0", "sidoCode": config["sido"], "sggCode": sgg, "schulKndCode": kind,
            }):
                address_of[row.get("SCHUL_CODE")] = row.get("ADRES_BRKDN") or row.get("SCHUL_RDNMA") or ""

    this_year = datetime.date.today().year
    for year in (this_year, this_year - 1):
        schools = {}
        for sgg in sgg_codes:
            before = len(schools)
            for level, kind in SCHOOL_KINDS.items():
                for row in schoolinfo_list(key, {
                    "apiType": "09", "pbanYr": year,
                    "sidoCode": config["sido"], "sggCode": sgg, "schulKndCode": kind,
                }):
                    code = row.get("SCHUL_CODE")
                    students = to_int(row.get("COL_S_SUM") or row.get("COL_SUM_S4"))
                    if code in schools or not students:
                        continue
                    name = row.get("SCHUL_NM", "")
                    address = address_of.get(code)
                    if not address:
                        region = region_of(row.get("ADRCD_NM", ""))
                        address = (neis_addresses.get((region[1] if region else "", name))
                                   or neis_addresses.get(("", name)) or "")
                    schools[code] = {"name": name, "level": level, "address": address, "students": students}
            print(f"    {year}년 {sgg or '시도 전체'}: 새 학교 {len(schools) - before}곳")
        if schools:
            no_address = sum(1 for school in schools.values() if not area_of(school["address"]))
            print(f"  {year}년 공시 기준 학교 {len(schools)}곳을 받았습니다 (동을 못 찾은 학교 {no_address}곳).")
            return list(schools.values()), year
    sys.exit(f"{province}: 학교알리미에서 학생 수를 받지 못했습니다. 인증키를 확인해 주세요.")


def to_int(value):
    value = str(value or "").replace(",", "").strip()
    try:
        return int(float(value))
    except ValueError:
        return 0


def region_of(address):
    """주소 앞부분에서 (시도, 구·시·군)을 꺼냅니다. 예: '경기도 수원시 영통구 ...' -> ('경기도', '수원시')"""
    tokens = (address or "").split()
    if len(tokens) < 2:
        return None
    name = re.sub(r"^(.+시).+구$", r"\1", tokens[1])  # 성남시수정구 -> 성남시
    return PROVINCE_ALIASES.get(tokens[0], tokens[0]), REGION_RENAMES.get(name, name)


def legal_dong(dong):
    """행정동 이름을 법정동 이름으로 묶습니다. 예: 중계2·3동 -> 중계동, 중계본동 -> 중계동"""
    base = re.sub(r"(본동|[0-9·.,제]+동)$", "", dong)
    return base + "동" if base and base != dong else dong


def is_area_name(name):
    return len(name) <= 7 and not any(word in name for word in NOT_AREA_WORDS)


def area_of(address):
    """주소에서 동·읍·면을 꺼냅니다.

    - 읍·면: '경기도 화성시 봉담읍 동화길 1' -> 봉담읍
    - 도로명주소 괄호: '... 2층 (중계동, OO빌딩)' -> 중계동
    - 지번주소: '서울특별시 노원구 중계동 123' -> 중계동
    """
    address = address or ""
    tokens = address.split()
    for token in tokens[2:5]:
        if re.fullmatch(r"[가-힣0-9]+[읍면]", token):
            return token
    paren = re.search(r"\(([가-힣0-9·.]+(?:동|[0-9]가))[,)\s]", address)
    if paren and is_area_name(paren.group(1)):
        return legal_dong(paren.group(1))
    for token in tokens[2:5]:
        if re.fullmatch(r"[가-힣0-9·.]+동|[가-힣]+[0-9]+가", token) and is_area_name(token):
            return legal_dong(token)
    return ""


def is_open_tutoring(row):
    """영업 중인 입시·보습 분야 학원·교습소만 셉니다."""
    status = row.get("REG_STTUS_NM") or ""
    realm = row.get("REALM_SC_NM") or ""
    return status in ("", "개원", "등록") and ("보습" in realm or "입시" in realm)


def new_region(province, name):
    return {"province": province, "name": name, "areas": {}, "unmatched": 0}


def new_area(name):
    return {
        "name": name,
        "students": {"elem": 0, "middle": 0, "high": 0, "total": 0},
        "academies": {"all": 0, "math": 0, "english": 0},
        "schools": [],
    }


def build(province, academies, schools, year):
    """시도 하나의 학원·학교를 구·시·군 > 동·읍·면으로 묶습니다."""
    regions = {}

    def region(address):
        found = region_of(address)
        if not found or found[0] != province:
            return None
        return regions.setdefault(found[1], new_region(province, found[1]))

    for school in schools:
        r = region(school["address"])
        name = area_of(school["address"])
        if r is None or not name:
            continue
        a = r["areas"].setdefault(name, new_area(name))
        a["students"][school["level"]] += school["students"]
        a["students"]["total"] += school["students"]
        a["schools"].append({k: school[k] for k in ("name", "level", "students")})

    for row in academies:
        if not is_open_tutoring(row):
            continue
        address = f"{row.get('FA_RDNMA') or ''} {row.get('FA_RDNDA') or ''}".strip()
        r = region(address)
        if r is None:
            continue
        name = area_of(address)
        if not name:
            r["unmatched"] += 1
            continue
        a = r["areas"].setdefault(name, new_area(name))
        text = " ".join(row.get(k, "") or "" for k in ("ACA_NM", "LE_CRSE_LIST_NM", "LE_CRSE_NM"))
        a["academies"]["all"] += 1
        for subject, keywords in SUBJECT_KEYWORDS.items():
            if any(k in text for k in keywords):
                a["academies"][subject] += 1

    today = datetime.date.today()
    outputs = []
    for r in regions.values():
        areas = sorted(r["areas"].values(), key=lambda a: a["name"])
        if not any(a["students"]["total"] for a in areas):
            continue
        for a in areas:
            a["schools"].sort(key=lambda s: ("elem", "middle", "high").index(s["level"]))
        outputs.append({
            "id": f"{PROVINCES[province]['short']}-{r['name']}",
            "province": province,
            "region": f"{province} {r['name']}",
            "baseDate": f"학생 수 {year}년 학교알리미 공시, 학원 {today:%Y년 %m월} 기준",
            "builtAt": today.isoformat(),
            "sources": [
                "학원: 나이스 교육정보 개방포털 학원교습소정보",
                "학생 수: 학교알리미 학년별·학급별 학생수",
            ],
            "unmatchedAcademies": r["unmatched"],
            "areas": areas,
        })
    return outputs


def save(outputs, provinces):
    """처리한 시도의 지역 파일만 새로 쓰고, 나머지 시도 파일은 그대로 둡니다."""
    DATA_DIR.mkdir(exist_ok=True)
    index_path = DATA_DIR / "regions.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else []
    index = [r for r in index if r.get("province") in PROVINCES and r["province"] not in provinces]

    keep = {f"{r['id']}.json" for r in index} | {f"{o['id']}.json" for o in outputs} | {"regions.json"}
    for old in DATA_DIR.glob("*.json"):
        if old.name not in keep:
            old.unlink()
    for o in outputs:
        (DATA_DIR / f"{o['id']}.json").write_text(
            json.dumps(o, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    index += [{"id": o["id"], "name": o["region"], "province": o["province"]} for o in outputs]
    order = list(PROVINCES)
    index.sort(key=lambda r: (order.index(r["province"]), r["name"]))
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def main():
    neis_key = os.environ.get("NEIS_API_KEY")
    schoolinfo_key = os.environ.get("SCHOOLINFO_API_KEY")
    if not neis_key or not schoolinfo_key:
        sys.exit("NEIS_API_KEY와 SCHOOLINFO_API_KEY 환경변수가 필요합니다.")

    provinces = [PROVINCE_ALIASES.get(p, p) for p in sys.argv[1:]] or list(PROVINCES)
    outputs = []
    for province in provinces:
        print(f"{province}")
        academies = fetch_academies(neis_key, PROVINCES[province]["office"])
        neis_addresses = fetch_neis_school_addresses(neis_key, PROVINCES[province]["office"])
        schools, year = fetch_schools(schoolinfo_key, province, neis_addresses)
        built = build(province, academies, schools, year)
        if not built:
            sys.exit(f"{province}: 지역별로 묶인 결과가 없어 저장하지 않습니다. 주소 형식을 확인해 주세요.")
        for o in built:
            total = sum(a["academies"]["all"] for a in o["areas"])
            print(f"  {o['region']}: 동·읍·면 {len(o['areas'])}개, 입시·보습 학원 {total}곳, "
                  f"동을 못 찾은 학원 {o['unmatchedAcademies']}곳")
        outputs.extend(built)
    save(outputs, provinces)
    print(f"지역 {len(outputs)}곳을 저장했습니다.")


if __name__ == "__main__":
    main()
