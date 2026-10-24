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
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"

NEIS_URL = "https://open.neis.go.kr/hub/acaInsTiInfo"
NEIS_SCHOOL_URL = "https://open.neis.go.kr/hub/schoolInfo"
SCHOOLINFO_URL = "https://www.schoolinfo.go.kr/openApi.do"
APT_URL = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade"
PRESALE_URL = "https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail"  # 청약홈 분양정보
APT_MONTHS = 6  # 최근 몇 달 거래로 평당가를 낼지
PYEONG = 3.305785  # 1평(m²)
SEOUL_URL = "http://openapi.seoul.go.kr:8088"
SEOUL_SALES_SERVICE = "VwsmAdstrdSelngW"  # 상권분석서비스(추정매출-행정동)

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
NOT_AREA_WORDS = ("상가", "아파트", "빌딩", "타운", "프라자", "플라자", "센터", "오피스")

# 학교알리미 학교급 코드
SCHOOL_KINDS = {"elem": "02", "middle": "03", "high": "04"}

SUBJECT_KEYWORDS = {
    "math": ["수학"],
    "english": ["영어"],
}

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
    other_subject = re.search(r"국어|논술|과학|사회|코딩|한자|중국어|일본어|독서", name)
    return set() if other_subject or len(academy_subjects) != 1 else set(academy_subjects)


def course_levels(name):
    return {level for level, pattern in LEVEL_PATTERNS.items() if pattern.search(name)}


def new_fee_table():
    return {subject: {level: [] for level in ("elem", "middle", "high", "total")}
            for subject in ("all", "math", "english")}


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
    for sgg in sgg_codes:
        for kind in SCHOOL_KINDS.values():
            for row in schoolinfo_list(key, {
                "apiType": "0", "sidoCode": config["sido"], "sggCode": sgg, "schulKndCode": kind,
            }):
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

    돌려주는 값: ({(자치구, 법정동): 분기 매출 합계}, '2026년 2분기')
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
                dong = legal_dong(str(row.get("ADSTRD_CD_NM") or "").strip())
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
    for sgg in PROVINCES[province]["sgg"]:
        for ymd in months:
            page = 1
            while True:
                url = f"{APT_URL}?" + urllib.parse.urlencode({
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
    for subject in ("all", "math", "english"):
        pool = [x for x in academies if (subject == "all" or subject in x["subjects"]) and "원격" not in x["name"]]
        pool.sort(key=lambda x: (-x["capacity"], -x["branches"], x["name"]))
        for x in pool[:TOP_ACADEMIES]:
            keep[x["name"] + x["kind"]] = x
    return sorted(keep.values(), key=lambda x: -x["capacity"])


def new_region(province, name):
    return {"province": province, "name": name, "areas": {}, "unmatched": 0, "fees": new_fee_table()}


def new_area(name):
    return {
        "name": name,
        "students": {"elem": 0, "middle": 0, "high": 0, "total": 0},
        "academies": {"all": 0, "math": 0, "english": 0},
        "schools": [],
        "fees": new_fee_table(),
        "top": [],
        "newApts": [],
        "studentsPast": {"elem": 0, "middle": 0, "high": 0, "total": 0},
        # 지금 영업 중인 학원 중 최근 1년, 3년 안에 문을 연 곳
        "opened": {"1y": {"all": 0, "math": 0, "english": 0}, "3y": {"all": 0, "math": 0, "english": 0}},
    }


def build(province, academies, schools, year, sales=None, sales_label="", apt_rows=None, past=None, past_year=None,
          presales=None):
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
        name = area_of(school["address"])
        if r is None or not name:
            continue
        a = r["areas"].setdefault(name, new_area(name))
        a["students"][school["level"]] += school["students"]
        a["students"]["total"] += school["students"]
        a["schools"].append({k: school[k] for k in ("name", "level", "students")})
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
        name = area_of(address)
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
    outputs = []
    for r in regions.values():
        areas = sorted(r["areas"].values(), key=lambda a: a["name"])
        if not any(a["students"]["total"] for a in areas):
            continue
        for a in areas:
            a["schools"].sort(key=lambda s: ("elem", "middle", "high").index(s["level"]))
            a["fees"] = summarize_fees(a["fees"])
            a["top"] = pick_top_academies(a["top"])
            if sales:
                a["sales"] = sales.get((r["name"], a["name"]))
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
              + (["아파트 가격: 국토교통부 아파트 매매 실거래가"] if apt else []),
            "salesPeriod": sales_label if sales else "",
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
        "spend": lambda a: a.get("sales") and a["sales"] / 3 / a["students"]["total"],
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
    neis_key = (os.environ.get("NEIS_API_KEY") or "").strip()
    schoolinfo_key = (os.environ.get("SCHOOLINFO_API_KEY") or "").strip()
    seoul_key = (os.environ.get("SEOUL_API_KEY") or "").strip()
    apt_key = (os.environ.get("DATA_GO_KR_KEY") or "").strip()
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
        past_year = year - TREND_YEARS
        past = fetch_past_students(schoolinfo_key, province, past_year)
        sales, sales_label = {}, ""
        if province == "서울특별시" and seoul_key:
            sales, sales_label = fetch_seoul_sales(seoul_key)
        apt_rows = fetch_apartment_prices(apt_key, province) if apt_key else []
        built = build(province, academies, schools, year, sales, sales_label, apt_rows, past, past_year, presales)
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
