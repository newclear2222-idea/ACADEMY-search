"""공공데이터 API에서 서울·경기·인천 전체의 학원 목록과 학교별 학생 수를 받아
data/<지역>.json (구·시·군마다 하나)과 data/regions.json 을 새로 만듭니다.

필요한 환경변수 (GitHub 저장소 Secrets에 넣어 둡니다. 코드에는 절대 적지 않습니다):
  NEIS_API_KEY        나이스 교육정보 개방포털 인증키 (학원교습소정보)
  SCHOOLINFO_API_KEY  학교알리미 OpenAPI 인증키 (학교기본정보, 학년별·학급별 학생수)
  SEOUL_API_KEY       서울 열린데이터광장 인증키 (상권분석서비스 추정매출, 없으면 매출은 건너뜁니다)
  DATA_GO_KR_KEY      공공데이터포털 인증키 (국토교통부 아파트 매매 실거래가, 없으면 아파트 가격은 건너뜁니다)

사용 예:
  python3 scripts/update_data.py              # 서울, 경기, 인천 모두
  python3 scripts/update_data.py 서울특별시   # 서울만
"""

import datetime
import xml.etree.ElementTree as ET
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import nearby

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

NEIS_URL = "https://open.neis.go.kr/hub/acaInsTiInfo"
NEIS_SCHOOL_URL = "https://open.neis.go.kr/hub/schoolInfo"
SCHOOLINFO_URL = "https://www.schoolinfo.go.kr/openApi.do"
# 활용신청한 서비스만 열립니다. '상세 자료'를 먼저, 안 되면 기본 자료를 씁니다.
APT_URLS = [
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
    "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
]
PRESALE_URL = "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail"  # 청약홈 분양정보
APT_MONTHS = 6  # 최근 몇 달 거래로 평당가를 낼지
PYEONG = 3.305785  # 1평(m²)
SEOUL_URL = "http://openapi.seoul.go.kr:8088"
SEOUL_SALES_SERVICE = "VwsmAdstrdSelngW"  # 상권분석서비스(추정매출-행정동)
SEOUL_STORE_SERVICE = "VwsmAdstrdStorW"  # 상권분석서비스(점포-행정동): 개업·폐업 점포 수
STORE_QUARTERS = 4  # 개업·폐업을 최근 몇 분기 더할지 (1년)
HISTORY_MIN_MONTHS = 6  # 달마다 쌓은 학원 수가 이만큼 모이면 실제 순증감을 씁니다.

# 상권분석서비스 업종 코드: 일반교습학원, 외국어학원
ACADEMY_INDUSTRIES = {"CS200001", "CS200002"}

# 행정동 코드 앞 5자리 -> 서울 자치구
SEOUL_GU = {
    "11110": "종로구", "11140": "중구", "11170": "용산구", "11200": "성동구", "11215": "광진구",
    "11230": "동대문구", "11260": "중랑구", "11290": "성북구", "11305": "강북구", "11320": "도봉구",
    "11350": "노원구", "11380": "은평구", "11410": "서대문구", "11440": "마포구", "11470": "양천구",
    "11500": "강서구", "11530": "구로구", "11545": "금천구", "11560": "영등포구", "11590": "동작구",
    "11620": "관악구", "11650": "서초구", "11680": "강남구", "11710": "송파구", "11740": "강동구",
}

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
    "인천광역시": {
        "short": "인천",
        "office": "E10",
        "sido": "28",
        # 2026년 행정체제 개편으로 생긴 제물포구·영종구·서해구·검단구와 이전 구 코드를 함께 넣습니다.
        "sgg": [
            "28110", "28125", "28140", "28155", "28177", "28185", "28200", "28237", "28245",
            "28260", "28275", "28290", "28710", "28720",
        ],
    },
}

PROVINCE_ALIASES = {"서울": "서울특별시", "서울시": "서울특별시", "경기": "경기도", "인천": "인천광역시"}

# 옛 이름으로 남은 주소를 지금 이름으로 맞춥니다.
REGION_RENAMES = {"여주군": "여주시", "포천군": "포천시", "남구": "미추홀구"}

# 나뉘거나 합쳐진 구: 옛 구의 동은 같은 이름의 동이 있는 새 구로, 없으면 첫 번째 새 구로 옮깁니다.
# 인천은 2026년 7월 중구·동구가 제물포구·영종구로, 서구가 서해구·검단구로 바뀌었습니다.
SPLIT_REGIONS = {
    "인천광역시": {
        "중구": ["제물포구", "영종구"],
        "동구": ["제물포구"],
        "서구": ["서해구", "검단구"],
    },
}

# 도로명주소 괄호 안의 건물 이름이 동 이름처럼 보이는 경우를 거릅니다. 예: (OO아파트상가동)
# 주소 괄호에 법정동 대신 행정동 이름이 적힌 곳(관악구: 법정동은 봉천동·신림동·남현동뿐)을 법정동으로 바꿉니다.
AREA_ALIASES = {
    ("서울특별시", "관악구"): {
        **{d: "봉천동" for d in ("보라매동", "청림동", "성현동", "행운동", "낙성대동", "청룡동", "은천동", "중앙동", "인헌동")},
        **{d: "신림동" for d in ("서원동", "신원동", "서림동", "신사동", "난향동", "조원동", "대학동", "삼성동", "미성동", "난곡동")},
    },
}
NOT_AREA_WORDS = ("상가", "아파트", "빌딩", "타운", "프라자", "플라자", "센터", "오피스")

# 학교알리미 학교급 코드
SCHOOL_KINDS = {"elem": "02", "middle": "03", "high": "04"}

SUBJECT_KEYWORDS = {
    "math": ["수학"],
    "english": ["영어"],
    "korean": ["국어", "문학", "독서", "논술"],
    "science": ["과학", "물리", "화학", "생명과학", "생물", "지구과학"],
}
SUBJECTS = ("all", *SUBJECT_KEYWORDS)

# 교습과정 이름으로 학교급을 가립니다. 예: '고등수학', '중등부', '영어 초1~3', '국어(중)'
LEVEL_PATTERNS = {
    "elem": re.compile(r"초등|초[0-9]|(^|[(\s])초([)\s~]|$)"),
    "middle": re.compile(r"중등|중학|중[0-9]|(^|[(\s])중([)\s~]|$)"),
    "high": re.compile(r"고등|고교|고[0-9]|(^|[(\s])고([)\s~]|$)|수능"),
}

TOP_ACADEMIES = 5
BRAND_MIN_LEN = 4

# 1인당 교습비로 보기 어려운 값(입력 실수 등)은 뺍니다.
FEE_MIN, FEE_MAX = 30_000, 2_000_000


def parse_fees(text):
    """'고등수학:500000, 중등수학:350000' -> [('고등수학', 500000), ('중등수학', 350000)]"""
    fees = []
    for part in re.split(r",\s*(?=[^,]*:)", text or ""):
        name, sep, amount = part.rpartition(":")
        amount = re.sub(r"[^0-9]", "", amount)
        if sep and amount and FEE_MIN <= int(amount) <= FEE_MAX:
            fees.append((name.strip(), int(amount)))
    return fees


def course_subjects(name, academy_subjects):
    """과정 이름에 과목이 있으면 그 과목, 없으면 학원이 한 과목만 가르칠 때 그 과목."""
    found = {s for s, words in SUBJECT_KEYWORDS.items() if any(w in name for w in words)}
    if found:
        return found
    other_subject = re.search(r"사회|코딩|한자|중국어|일본어", name)
    return set() if other_subject or len(academy_subjects) != 1 else set(academy_subjects)


def course_levels(name):
    return {level for level, pattern in LEVEL_PATTERNS.items() if pattern.search(name)}


def new_fee_table():
    return {subject: {level: [] for level in ("elem", "middle", "high", "total")}
            for subject in SUBJECTS}


def add_fees(table, row, academy_subjects):
    for name, amount in parse_fees(row.get("PSNBY_THCC_CNTNT")):
        levels = course_levels(name) | {"total"}
        for subject in course_subjects(name, academy_subjects) | {"all"}:
            for level in levels:
                table[subject][level].append(amount)


def summarize_fees(table):
    """과목·학교급별 [중간값, 과정 수]. 과정이 3개 미만이면 중간값을 내지 않습니다."""
    out = {}
    for subject, levels in table.items():
        out[subject] = {}
        for level, amounts in levels.items():
            amounts = sorted(amounts)
            median = amounts[len(amounts) // 2] if len(amounts) >= 3 else None
            out[subject][level] = [median, len(amounts)]
    return out


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
    point_of = {}  # 학교 위치(위도, 경도). 동 사이 거리를 잴 때 씁니다.
    for sgg in sgg_codes:
        for kind in SCHOOL_KINDS.values():
            for row in schoolinfo_list(key, {
                "apiType": "0", "sidoCode": config["sido"], "sggCode": sgg, "schulKndCode": kind,
            }):
                if not point_of:
                    print(f"  학교기본정보 항목: {', '.join(sorted(row))}")
                lat = to_float(row.get("LTTUD") or row.get("LAT") or row.get("LATITUDE"))
                lon = to_float(row.get("LGTUD") or row.get("LOT") or row.get("LON") or row.get("LONGITUDE"))
                if 33 < lat < 39 and 124 < lon < 132:
                    point_of[row.get("SCHUL_CODE")] = (lat, lon)
                address_of[row.get("SCHUL_CODE")] = [
                    row.get("ADRES_BRKDN") or "",
                    f"{row.get('SCHUL_RDNMA') or ''} {row.get('SCHUL_RDNDA') or ''}".strip(),
                ]

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
                    region = region_of(row.get("ADRCD_NM", ""))
                    candidates = address_of.get(code, []) + [
                        neis_addresses.get((region[1] if region else "", name)) or "",
                        neis_addresses.get(("", name)) or "",
                    ]
                    # 동·읍·면까지 읽히는 첫 주소를 씁니다.
                    address = next((a for a in candidates if area_of(a)), "")
                    schools[code] = {
                        "code": code, "name": name, "level": level, "address": address, "students": students, "sgg": sgg,
                        "point": point_of.get(code),
                    }
            print(f"    {year}년 {sgg or '시도 전체'}: 새 학교 {len(schools) - before}곳")
        if schools:
            no_address = sum(1 for school in schools.values() if not area_of(school["address"]))
            print(f"  {year}년 공시 기준 학교 {len(schools)}곳을 받았습니다 (동을 못 찾은 학교 {no_address}곳).")
            return list(schools.values()), year
    sys.exit(f"{province}: 학교알리미에서 학생 수를 받지 못했습니다. 인증키를 확인해 주세요.")


TREND_YEARS = 3  # 학생 수를 몇 년 전과 비교할지


def fetch_past_students(key, province, year):
    """학교알리미에서 몇 년 전 공시의 학교별 학생 수를 받습니다. {학교 코드: 학생 수}"""
    config = PROVINCES[province]
    past = {}
    for sgg in [""] + config["sgg"]:
        for kind in SCHOOL_KINDS.values():
            for row in schoolinfo_list(key, {
                "apiType": "09", "pbanYr": year, "sidoCode": config["sido"], "sggCode": sgg, "schulKndCode": kind,
            }):
                students = to_int(row.get("COL_S_SUM") or row.get("COL_SUM_S4"))
                if students:
                    past[row.get("SCHUL_CODE")] = students
    print(f"  {year}년 공시 학생 수: 학교 {len(past)}곳")
    return past


def to_float(value):
    try:
        return float(str(value or "").strip())
    except ValueError:
        return 0.0


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
    # '201동'처럼 숫자로 시작하면 아파트 동 번호입니다.
    return len(name) <= 7 and not name[:1].isdigit() and not any(word in name for word in NOT_AREA_WORDS)


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


def fetch_seoul_sales(key):
    """서울 행정동별 학원 추정매출(카드 결제 기반)을 가장 최근 분기로 받습니다.

    돌려주는 값: ({(자치구, 행정동): 분기 매출 합계}, '2026년 2분기')
    """
    today = datetime.date.today()
    for back in range(1, 9):
        q = (today.year * 4 + (today.month - 1) // 3) - back
        quarter = f"{q // 4}{q % 4 + 1}"
        sales, start, total = {}, 1, None
        while total is None or start <= total:
            url = f"{SEOUL_URL}/{key}/json/{SEOUL_SALES_SERVICE}/{start}/{start + 999}/{quarter}"
            try:
                data = get_json(url, {}).get(SEOUL_SALES_SERVICE) or {}
            except Exception as e:  # 매출은 덤이라 실패해도 나머지는 그대로 만듭니다.
                print(f"  서울 매출을 받지 못했습니다: {e}")
                return {}, ""
            total = to_int(data.get("list_total_count"))
            rows = data.get("row") or []
            if not rows or total > 200_000:  # 분기 조건이 안 먹으면 전체 기간이 와서 멈춥니다.
                break
            if start == 1:
                print(f"  서울 매출 {quarter}: {total}줄, 항목 {', '.join(sorted(rows[0]))}")
            for row in rows:
                if str(row.get("STDR_YYQU_CD")) != quarter or row.get("SVC_INDUTY_CD") not in ACADEMY_INDUSTRIES:
                    continue
                gu = SEOUL_GU.get(str(row.get("ADSTRD_CD") or "")[:5])
                dong = str(row.get("ADSTRD_CD_NM") or "").strip()  # 행정동. build()에서 법정동에 붙입니다.
                if gu and dong:
                    k = (gu, dong)
                    sales[k] = sales.get(k, 0) + to_int(row.get("THSMON_SELNG_AMT"))
            start += 1000
        if sales:
            label = f"{quarter[:4]}년 {quarter[4]}분기"
            print(f"  서울 학원 매출: {label}, 동 {len(sales)}곳")
            return sales, label
    print("  서울 학원 매출 자료를 찾지 못했습니다.")
    return {}, ""


def fetch_seoul_stores(key):
    """서울 행정동별 학원 개업·폐업 점포 수를 최근 1년(4분기) 더해 받습니다.

    나이스 학원 자료에는 문 닫은 학원이 남지 않아, 폐업은 이 자료로만 셉니다.
    돌려주는 값: ({(자치구, 행정동): {"open", "close", "base"}}, '2025년 3분기~2026년 2분기')
    base는 분기마다 '유사업종 점포 수'의 평균이라, (open - close) / base가 1년 순증가율입니다.
    """
    today = datetime.date.today()
    found, quarters = {}, []
    for back in range(1, 10):
        if len(quarters) == STORE_QUARTERS:
            break
        q = (today.year * 4 + (today.month - 1) // 3) - back
        quarter = f"{q // 4}{q % 4 + 1}"
        rows_of_quarter, start, total = {}, 1, None
        while total is None or start <= total:
            url = f"{SEOUL_URL}/{key}/json/{SEOUL_STORE_SERVICE}/{start}/{start + 999}/{quarter}"
            try:
                data = get_json(url, {}).get(SEOUL_STORE_SERVICE) or {}
            except Exception as e:  # 폐업은 덤이라 실패해도 나머지는 그대로 만듭니다.
                print(f"  서울 학원 개업·폐업을 받지 못했습니다: {e}")
                return {}, ""
            total = to_int(data.get("list_total_count"))
            rows = data.get("row") or []
            if not rows or total > 200_000:
                break
            if start == 1:
                print(f"  서울 점포 {quarter}: {total}줄, 항목 {', '.join(sorted(rows[0]))}")
            for row in rows:
                if str(row.get("STDR_YYQU_CD")) != quarter or row.get("SVC_INDUTY_CD") not in ACADEMY_INDUSTRIES:
                    continue
                gu = SEOUL_GU.get(str(row.get("ADSTRD_CD") or "")[:5])
                dong = str(row.get("ADSTRD_CD_NM") or "").strip()
                if gu and dong:
                    v = rows_of_quarter.setdefault((gu, dong), {"open": 0, "close": 0, "base": 0})
                    v["open"] += to_int(row.get("OPBIZ_STOR_CO"))
                    v["close"] += to_int(row.get("CLSBIZ_STOR_CO"))
                    v["base"] += to_int(row.get("SIMILR_INDUTY_STOR_CO")) or to_int(row.get("STOR_CO"))
            start += 1000
        if rows_of_quarter:
            quarters.append(quarter)
            for k, v in rows_of_quarter.items():
                f = found.setdefault(k, {"open": 0, "close": 0, "base": 0})
                f["open"] += v["open"]
                f["close"] += v["close"]
                f["base"] += v["base"]
    if not quarters:
        print("  서울 학원 개업·폐업 자료를 찾지 못했습니다.")
        return {}, ""
    for v in found.values():
        v["base"] = round(v["base"] / len(quarters))
    first, last = min(quarters), max(quarters)
    label = f"{first[:4]}년 {first[4]}분기~{last[:4]}년 {last[4]}분기"
    opened = sum(v["open"] for v in found.values())
    closed = sum(v["close"] for v in found.values())
    print(f"  서울 학원 개업·폐업: {label} ({len(quarters)}분기), 동 {len(found)}곳, 개업 {opened}, 폐업 {closed}")
    return found, label


def fetch_presales(key):
    """청약홈 아파트 분양 공고 중 아직 입주 전이거나 최근 1년 안에 입주한 단지를 받습니다.

    돌려주는 값: [{"address", "name", "households", "moveIn": "2027-03", "notice": "2025-11-02"}, ...]
    """
    today = datetime.date.today()
    since = f"{today.year - 4}-01-01"
    move_in_from = f"{today.year - 1}{today.month:02d}"
    out, page = [], 1
    while True:
        url = f"{PRESALE_URL}?" + urllib.parse.urlencode({
            "page": page, "perPage": 1000, "serviceKey": key, "cond[RCRIT_PBLANC_DE::GTE]": since,
        })
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "academy-search"}), timeout=60) as res:
                data = json.loads(res.read().decode("utf-8"))
        except Exception as e:  # 활용신청 전이면 401이 옵니다. 분양 소식은 덤이라 건너뜁니다.
            print(f"  청약홈 분양정보를 받지 못했습니다: {e}")
            return []
        rows = data.get("data") or []
        for row in rows:
            move_in = str(row.get("MVN_PREARNGE_YM") or "")
            if len(move_in) != 6 or move_in < move_in_from:
                continue
            out.append({
                "address": str(row.get("HSSPLY_ADRES") or ""),
                "name": str(row.get("HOUSE_NM") or "").strip(),
                "households": to_int(row.get("TOT_SUPLY_HSHLDCO")),
                "moveIn": f"{move_in[:4]}-{move_in[4:]}",
                "notice": str(row.get("RCRIT_PBLANC_DE") or ""),
            })
        if not rows or page * 1000 >= to_int(data.get("totalCount")):
            break
        page += 1
    print(f"  청약홈 분양 단지 {len(out)}곳 (입주 예정 또는 최근 1년 입주)")
    return out


def fetch_apartment_prices(key, province):
    """국토교통부 아파트 매매 실거래가에서 최근 몇 달 거래의 평당가를 받습니다.

    돌려주는 값: [(학교알리미 시군구 코드, 법정동, 평당가(원)), ...]
    """
    today = datetime.date.today()
    months = []
    for back in range(1, APT_MONTHS + 1):
        m = today.year * 12 + today.month - 1 - back
        months.append(f"{m // 12}{m % 12 + 1:02d}")
    rows = []
    apt_url = None
    for candidate in APT_URLS:
        try:
            url = f"{candidate}?" + urllib.parse.urlencode({"serviceKey": key, "LAWD_CD": "11110", "DEAL_YMD": months[0], "pageNo": 1, "numOfRows": 1})
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "academy-search"}), timeout=60) as res:
                code = ET.fromstring(res.read()).findtext(".//resultCode") or ""
            if code in ("000", "00"):
                apt_url = candidate
                break
            print(f"  {candidate.rsplit('/', 1)[-1]}: {code}")
        except urllib.error.HTTPError as e:
            print(f"  {candidate.rsplit('/', 1)[-1]}: HTTP {e.code} {e.read()[:200]!r}")
        except Exception as e:
            print(f"  {candidate.rsplit('/', 1)[-1]}: {e}")
    if not apt_url:
        print("  아파트 실거래가: 쓸 수 있는 서비스가 없습니다 (활용신청 승인 전일 수 있습니다).")
        return rows
    for sgg in PROVINCES[province]["sgg"]:
        for ymd in months:
            page = 1
            while True:
                url = f"{apt_url}?" + urllib.parse.urlencode({
                    "serviceKey": key, "LAWD_CD": sgg, "DEAL_YMD": ymd, "pageNo": page, "numOfRows": 1000,
                })
                try:
                    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "academy-search"}), timeout=60) as res:
                        root = ET.fromstring(res.read())
                except Exception as e:  # 아파트 가격은 덤이라 실패해도 나머지는 그대로 만듭니다.
                    print(f"  아파트 실거래가를 받지 못했습니다 ({sgg} {ymd}): {e}")
                    return rows
                code = root.findtext(".//resultCode") or ""
                if code not in ("000", "00"):
                    print(f"  아파트 실거래가 오류 ({sgg} {ymd}): {code} {root.findtext('.//resultMsg')}")
                    return rows
                items = root.findall(".//item")
                for item in items:
                    if (item.findtext("cdealType") or "").strip():  # 해제된 거래
                        continue
                    area = float((item.findtext("excluUseAr") or "0").strip() or 0)
                    price = to_int(item.findtext("dealAmount")) * 10_000
                    dong = legal_dong((item.findtext("umdNm") or "").strip().split(" ")[0])
                    if area > 0 and price > 0 and dong:
                        rows.append((sgg, dong, round(price / (area / PYEONG))))
                total = to_int(root.findtext(".//totalCount"))
                if page * 1000 >= total or not items:
                    break
                page += 1
    print(f"  아파트 매매 {len(rows)}건 (최근 {APT_MONTHS}개월)")
    return rows


def capacity_of(row):
    """정원합계. 비어 있으면 일시수용능력인원합계를 씁니다."""
    return to_int(row.get("TOFOR_SMTOT")) or to_int(row.get("DTM_RCPTN_ABLTY_NMPR_SMTOT"))


def brand_of(name):
    """괄호와 띄어쓰기, 끝의 '학원'·'교습소'를 뗀 이름. 지점 구분은 count_branches가 앞부분으로 합니다."""
    name = re.sub(r"\([^)]*\)", "", name or "")
    name = re.sub(r"(어학원|학원|교습소)$", "", name.replace(" ", "").strip())
    return name


def count_branches(names):
    """이름 앞부분이 4글자 이상 같은 학원끼리 같은 브랜드로 봅니다.

    예: '눈높이러닝센터마들', '눈높이러닝센터상계' -> '눈높이러닝센터' 2곳
    """
    keys = sorted({brand_of(n) for n in names})
    starts = {}
    for k in keys:
        for i in range(BRAND_MIN_LEN, len(k) + 1):
            starts[k[:i]] = starts.get(k[:i], 0) + 1
    counts = {}
    for k in keys:
        shared = [starts[k[:i]] for i in range(BRAND_MIN_LEN, len(k) + 1) if starts[k[:i]] >= 2]
        counts[k] = shared[-1] if shared else 1
    return counts


def pick_top_academies(academies):
    """과목별로 정원이 큰 학원을 몇 곳씩 남깁니다. 유명도가 아니라 규모 기준입니다."""
    keep = {}
    for subject in SUBJECTS:
        pool = [x for x in academies if (subject == "all" or subject in x["subjects"]) and "원격" not in x["name"]]
        pool.sort(key=lambda x: (-x["capacity"], -x["branches"], x["name"]))
        for x in pool[:TOP_ACADEMIES]:
            keep[x["name"] + x["kind"]] = x
    return sorted(keep.values(), key=lambda x: -x["capacity"])


def new_region(province, name):
    return {"province": province, "name": name, "areas": {}, "unmatched": 0, "fees": new_fee_table()}


def area_name_of(province, r, address):
    name = area_of(address)
    if r is None or not name:
        return name
    return AREA_ALIASES.get((province, r["name"]), {}).get(name, name)


SEOUL_ADM_PATH = DATA_DIR / "seoul_adm.json"


def spread_to_legal(gu, values, areas, adm_shapes):
    """행정동 단위 값(매출, 개업·폐업)을 법정동에 붙입니다.

    1) 행정동 이름을 법정동으로 묶은 이름(가양1동 -> 가양동)이 이 구에 있으면 그 동에 모두 붙입니다.
    2) 없으면(예: 송파 위례동, 관악 청림동) 그 행정동 경계 안에 있는 학교들의 학생 수 비율대로 나눕니다.
    3) 경계 안에 학교가 없으면 붙이지 않습니다.
    돌려주는 값: {법정동: [(값, 비율), ...]}
    """
    out, unplaced = {}, []
    alias = AREA_ALIASES.get(("서울특별시", gu), {})
    for (g, adm), value in values.items():
        if g != gu:
            continue
        legal = alias.get(adm) or alias.get(legal_dong(adm)) or legal_dong(adm)
        if legal in areas:
            out.setdefault(legal, []).append((value, 1.0))
            continue
        rings = adm_shapes.get(gu, {}).get(adm)
        weights = {}
        if rings:
            for name, a in areas.items():
                for pt, students in a.get("_spts", []):
                    if nearby.inside(pt, rings):
                        weights[name] = weights.get(name, 0) + max(students, 1)
        total = sum(weights.values())
        if not total:
            unplaced.append(adm)
            continue
        for name, w in weights.items():
            out.setdefault(name, []).append((value, w / total))
    if unplaced:
        print(f"    {gu}: 법정동을 못 찾은 행정동 {', '.join(unplaced)}")
    return out


def new_area(name):
    return {
        "name": name,
        "students": {"elem": 0, "middle": 0, "high": 0, "total": 0},
        "academies": {subject: 0 for subject in SUBJECTS},
        "schools": [],
        "fees": new_fee_table(),
        "top": [],
        "newApts": [],
        "studentsPast": {"elem": 0, "middle": 0, "high": 0, "total": 0},
        # 지금 영업 중인 학원 중 최근 1년, 3년 안에 문을 연 곳
        "opened": {period: {subject: 0 for subject in SUBJECTS} for period in ("1y", "3y")},
    }


def build(province, academies, schools, year, sales=None, sales_label="", apt_rows=None, past=None, past_year=None,
          presales=None, stores=None, stores_label=""):
    """시도 하나의 학원·학교를 구·시·군 > 동·읍·면으로 묶습니다."""
    regions = {}
    sgg_regions = {}  # 학교알리미 시군구 코드 -> {구·시·군: 학교 수}. 아파트 거래를 구·시·군에 붙일 때 씁니다.
    if academies:
        print(f"  학원 항목: {', '.join(sorted(academies[0]))}")
    statuses = {}
    for row in academies:
        statuses[row.get("REG_STTUS_NM") or "(없음)"] = statuses.get(row.get("REG_STTUS_NM") or "(없음)", 0) + 1
    print(f"  학원 등록상태: {statuses}")
    brand_counts = count_branches(r.get("ACA_NM") for r in academies if is_open_tutoring(r))

    def region(address):
        found = region_of(address)
        if not found or found[0] != province:
            return None
        return regions.setdefault(found[1], new_region(province, found[1]))

    for school in schools:
        r = region(school["address"])
        name = area_name_of(province, r, school["address"])
        if r is None or not name:
            continue
        a = r["areas"].setdefault(name, new_area(name))
        a["students"][school["level"]] += school["students"]
        a["students"]["total"] += school["students"]
        a["schools"].append({k: school[k] for k in ("name", "level", "students")})
        if school.get("point"):
            a.setdefault("_points", []).append(school["point"])
            a.setdefault("_spts", []).append((school["point"], school["students"]))
        if past:
            before = past.get(school.get("code"), 0)
            a["studentsPast"][school["level"]] += before
            a["studentsPast"]["total"] += before
        if school.get("sgg"):
            sgg_regions.setdefault(school["sgg"], {}).setdefault(r["name"], 0)
            sgg_regions[school["sgg"]][r["name"]] += 1

    for row in academies:
        if not is_open_tutoring(row):
            continue
        address = f"{row.get('FA_RDNMA') or ''} {row.get('FA_RDNDA') or ''}".strip()
        r = region(address)
        if r is None:
            continue
        name = area_name_of(province, r, address)
        if not name:
            r["unmatched"] += 1
            continue
        a = r["areas"].setdefault(name, new_area(name))
        text = " ".join(row.get(k, "") or "" for k in ("ACA_NM", "LE_CRSE_LIST_NM", "LE_CRSE_NM"))
        a["academies"]["all"] += 1
        subjects = {s for s, words in SUBJECT_KEYWORDS.items() if any(w in text for w in words)}
        for subject in subjects:
            a["academies"][subject] += 1
        add_fees(a["fees"], row, subjects)
        add_fees(r["fees"], row, subjects)
        established = str(row.get("ESTBL_YMD") or "")[:4]
        opened_on = str(row.get("ESTBL_YMD") or "")[:8]
        if opened_on.isdigit() and len(opened_on) == 8:
            for period, days in (("1y", 365), ("3y", 365 * 3)):
                if opened_on >= f"{datetime.date.today() - datetime.timedelta(days=days):%Y%m%d}":
                    for k in {"all"} | subjects:
                        a["opened"][period][k] += 1
        a["top"].append({
            "name": (row.get("ACA_NM") or "").strip(),
            "kind": "교습소" if "교습소" in (row.get("ACA_INSTI_SC_NM") or "") else "학원",
            "capacity": capacity_of(row),
            "since": int(established) if established.isdigit() else None,
            "branches": brand_counts.get(brand_of(row.get("ACA_NM")), 1),
            "subjects": sorted(subjects),
        })

    for old, targets in SPLIT_REGIONS.get(province, {}).items():
        if old not in regions:
            continue
        for target in targets:
            regions.setdefault(target, new_region(province, target))
        old_region = regions.pop(old)
        regions[targets[0]]["unmatched"] += old_region["unmatched"]
        for name, area in old_region["areas"].items():
            target = next((t for t in targets if name in regions[t]["areas"]), targets[0])
            merged = regions[target]["areas"].setdefault(name, new_area(name))
            for key in ("students", "academies", "studentsPast"):
                for k, v in area[key].items():
                    merged[key][k] += v
            for period, counts in area["opened"].items():
                for k, v in counts.items():
                    merged["opened"][period][k] += v
            merged["schools"] += area["schools"]
            merged.setdefault("_points", []).extend(area.get("_points", []))
            merged.setdefault("_spts", []).extend(area.get("_spts", []))
            merged["top"] += area["top"]
            for subject, levels in area["fees"].items():
                for level, amounts in levels.items():
                    merged["fees"][subject][level] += amounts
                    regions[target]["fees"][subject][level] += amounts

    for complex_ in presales or []:
        found = region_of(complex_["address"])
        name = area_of(complex_["address"])
        if not found or found[0] != province or not name:
            continue
        region_name = found[1]
        region_name = next((t for t in SPLIT_REGIONS.get(province, {}).get(region_name, []) if name in regions.get(t, {}).get("areas", {})), region_name)
        if region_name in regions and name in regions[region_name]["areas"]:
            regions[region_name]["areas"][name]["newApts"].append({k: complex_[k] for k in ("name", "households", "moveIn")})

    apt = {}
    for sgg, area_name, price in apt_rows or []:
        names = sgg_regions.get(sgg)
        if names:
            region_name = max(names, key=names.get)
            region_name = next((t for t in SPLIT_REGIONS.get(province, {}).get(region_name, []) if area_name in regions.get(t, {}).get("areas", {})), region_name)
            apt.setdefault((region_name, area_name), []).append(price)

    today = datetime.date.today()
    adm_shapes = json.loads(SEOUL_ADM_PATH.read_text(encoding="utf-8")) if (sales or stores) and SEOUL_ADM_PATH.exists() else {}
    outputs = []
    for r in regions.values():
        areas = sorted(r["areas"].values(), key=lambda a: a["name"])
        if not any(a["students"]["total"] for a in areas):
            continue
        by_name = {a["name"]: a for a in areas}
        sales_of = spread_to_legal(r["name"], sales, by_name, adm_shapes) if sales else {}
        stores_of = spread_to_legal(r["name"], stores, by_name, adm_shapes) if stores else {}
        for a in areas:
            a.pop("_spts", None)
            a["schools"].sort(key=lambda s: ("elem", "middle", "high").index(s["level"]))
            points = a.pop("_points", [])
            if points:  # 학교 위치의 평균을 동 중심으로 씁니다.
                a["center"] = [round(sum(p[0] for p in points) / len(points), 5),
                               round(sum(p[1] for p in points) / len(points), 5)]
            a["fees"] = summarize_fees(a["fees"])
            a["top"] = pick_top_academies(a["top"])
            if sales:
                parts = sales_of.get(a["name"])
                a["sales"] = round(sum(v * w for v, w in parts)) if parts else None
            if stores_of.get(a["name"]):
                parts = stores_of[a["name"]]
                a["storeFlow"] = {k: round(sum(v[k] * w for v, w in parts)) for k in ("open", "close", "base")}
            a["newApts"].sort(key=lambda x: x["moveIn"])
            prices = sorted(apt.get((r["name"], a["name"]), []))
            if len(prices) >= 3:
                a["apt"] = [prices[len(prices) // 2], len(prices)]
        outputs.append({
            "id": f"{PROVINCES[province]['short']}-{r['name']}",
            "province": province,
            "region": f"{province} {r['name']}",
            "baseDate": f"학생 수 {year}년 학교알리미 공시, 학원 {today:%Y년 %m월} 기준",
            "builtAt": today.isoformat(),
            "sources": [
                "학원: 나이스 교육정보 개방포털 학원교습소정보",
                "학생 수: 학교알리미 학년별·학급별 학생수",
                "수강료: 학원이 교육청에 등록한 1인당 교습비",
                "대표 학원: 교육청에 등록한 정원이 큰 순서",
            ] + (["학원 매출: 서울시 상권분석서비스 추정매출 (카드 결제 기반)"] if sales else [])
              + (["학원 개업·폐업: 서울시 상권분석서비스 점포 (일반교습학원·외국어학원)"] if stores else [])
              + (["아파트 가격: 국토교통부 아파트 매매 실거래가"] if apt else []),
            "salesPeriod": sales_label if sales else "",
            "storePeriod": stores_label if stores else "",
            "pastYear": past_year if past else None,
            "aptPeriod": f"최근 {APT_MONTHS}개월 매매" if apt else "",
            "unmatchedAcademies": r["unmatched"],
            "fees": summarize_fees(r["fees"]),
            "areas": areas,
        })
    add_fervor(outputs)
    return outputs


# 교육열 지수에 넣을 동의 최소 학생 수. 학생이 너무 적은 동은 비율이 크게 흔들립니다.
FERVOR_MIN_STUDENTS = 500


def add_fervor(outputs):
    """공개 숫자로 만든 '교육열' 추정치. 시도 안 동들과 비교한 백분위의 평균(0~100)입니다.

    재료: 학생 100명당 학원 수, 보통 수강료(입시·보습 전체), 학생 1명당 월 학원 카드매출(서울).
    """
    areas = [a for o in outputs for a in o["areas"] if a["students"]["total"] >= FERVOR_MIN_STUDENTS]
    metrics = {
        "density": lambda a: a["academies"]["all"] / a["students"]["total"] * 100,
        "fee": lambda a: a["fees"]["all"]["total"][0],
        # 학원이 적은 동은 매출(행정동)과 학원·학교(법정동) 경계가 어긋나 값이 크게 틀어져 뺍니다.
        "spend": lambda a: a.get("sales") and a["academies"]["all"] >= 20 and a["sales"] / 3 / a["students"]["total"],
    }
    ranks = {}
    for key, fn in metrics.items():
        values = sorted(v for v in (fn(a) for a in areas) if v)
        if len(values) < 10:
            continue
        for a in areas:
            v = fn(a)
            if v:
                below = sum(1 for x in values if x < v)
                ranks.setdefault(id(a), {})[key] = [round(v, 1), round(below / (len(values) - 1) * 100)]
    for a in areas:
        parts = ranks.get(id(a))
        if parts and len(parts) >= 2:
            a["fervor"] = {"score": round(sum(p[1] for p in parts.values()) / len(parts)), "parts": parts}


def add_close_rate(outputs):
    """서울 밖은 폐업 자료가 없어, 서울 학원의 1년 폐업률(점포 수 대비)을 그대로 빌려 씁니다."""
    seoul = [a for o in outputs if o["province"] == "서울특별시" for a in o["areas"]]
    if not seoul:  # 이번에 서울을 안 받았으면 저장된 서울 파일에서 읽습니다.
        for path in DATA_DIR.glob("서울-*.json"):
            seoul += json.loads(path.read_text(encoding="utf-8"))["areas"]
    flows = [a["storeFlow"] for a in seoul if a.get("storeFlow")]
    base = sum(f["base"] for f in flows)
    if not base:
        return
    rate = {"close": round(sum(f["close"] for f in flows) / base, 4),
            "open": round(sum(f["open"] for f in flows) / base, 4)}
    print(f"  서울 학원 1년 개업률 {rate['open']:.1%}, 폐업률 {rate['close']:.1%}")
    for o in outputs:
        o["seoulStoreRate"] = rate


def add_history_change(outputs, history, month):
    """달마다 쌓은 동별 학원 수로 실제 순증감(개원 - 폐원)을 붙입니다. 6개월 이상 쌓인 뒤부터 나옵니다."""
    y, m = map(int, month.split("-"))
    for past_month in sorted(history):
        py, pm = map(int, past_month.split("-"))
        months = (y - py) * 12 + (m - pm)
        if months < HISTORY_MIN_MONTHS:
            continue
        for o in outputs:
            then = history[past_month].get(o["id"])
            if not then:
                continue
            for a in o["areas"]:
                before = then.get(a["name"])
                if before and before.get("all") and "historyChange" not in a:
                    a["historyChange"] = {"months": months, "from": past_month, "before": before["all"],
                                          "change": a["academies"]["all"] - before["all"]}
        break  # 가장 오래된 기록 한 달만 씁니다.


def save(outputs, provinces):
    """처리한 시도의 지역 파일만 새로 쓰고, 나머지 시도 파일은 그대로 둡니다."""
    DATA_DIR.mkdir(exist_ok=True)
    index_path = DATA_DIR / "regions.json"
    index = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else []
    index = [r for r in index if r.get("province") in PROVINCES and r["province"] not in provinces]

    add_close_rate(outputs)
    keep = {f"{r['id']}.json" for r in index} | {f"{o['id']}.json" for o in outputs} | {"regions.json", "history.json", "centroids.json", "seoul_adm.json"}
    for old in DATA_DIR.glob("*.json"):
        if old.name not in keep:
            old.unlink()

    # 문 닫은 학원은 나이스 자료에 남지 않아, 달마다 동별 학원 수를 쌓아 두고 순증감을 계산합니다.
    history_path = DATA_DIR / "history.json"
    history = json.loads(history_path.read_text(encoding="utf-8")) if history_path.exists() else {}
    month = f"{datetime.date.today():%Y-%m}"
    snapshot = history.setdefault(month, {})
    for o in outputs:
        snapshot[o["id"]] = {a["name"]: a["academies"] for a in o["areas"]}
    add_history_change(outputs, history, month)
    for o in outputs:
        (DATA_DIR / f"{o['id']}.json").write_text(
            json.dumps(o, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    history_path.write_text(json.dumps(dict(sorted(history.items())), ensure_ascii=False) + "\n", encoding="utf-8")

    index += [{"id": o["id"], "name": o["region"], "province": o["province"]} for o in outputs]
    order = list(PROVINCES)
    index.sort(key=lambda r: (order.index(r["province"]), r["name"]))
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    nearby.apply_nearby()  # 구·시 경계를 넘어 가까운 동 목록을 붙입니다.


def main():
    neis_key = (os.environ.get("NEIS_API_KEY") or "").strip()
    schoolinfo_key = (os.environ.get("SCHOOLINFO_API_KEY") or "").strip()
    seoul_key = (os.environ.get("SEOUL_API_KEY") or "").strip()
    # 공공데이터포털 키는 '인코딩' 키(%2B 등)를 넣어도 되도록 한 번 풀어 둡니다. 주소에 넣을 때 다시 인코딩합니다.
    apt_key = urllib.parse.unquote((os.environ.get("DATA_GO_KR_KEY") or "").strip())
    if not neis_key or not schoolinfo_key:
        sys.exit("NEIS_API_KEY와 SCHOOLINFO_API_KEY 환경변수가 필요합니다.")

    provinces = [PROVINCE_ALIASES.get(p, p) for p in sys.argv[1:]] or list(PROVINCES)
    presales = fetch_presales(apt_key) if apt_key else []
    outputs = []
    for province in provinces:
        print(f"{province}")
        academies = fetch_academies(neis_key, PROVINCES[province]["office"])
        neis_addresses = fetch_neis_school_addresses(neis_key, PROVINCES[province]["office"])
        schools, year = fetch_schools(schoolinfo_key, province, neis_addresses)
        # 학교알리미가 오래된 공시를 주지 않을 수 있어, 3년 전부터 차례로 있는 해를 찾습니다.
        past, past_year = {}, None
        for back in range(TREND_YEARS, 0, -1):
            past = fetch_past_students(schoolinfo_key, province, year - back)
            if past:
                past_year = year - back
                break
        sales, sales_label, stores, stores_label = {}, "", {}, ""
        if province == "서울특별시" and seoul_key:
            sales, sales_label = fetch_seoul_sales(seoul_key)
            stores, stores_label = fetch_seoul_stores(seoul_key)
        apt_rows = fetch_apartment_prices(apt_key, province) if apt_key else []
        built = build(province, academies, schools, year, sales, sales_label, apt_rows, past, past_year, presales,
                      stores, stores_label)
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
