"""공공데이터 API에서 학원 목록과 학교별 학생 수를 받아 data/<지역>.json 을 새로 만듭니다.

필요한 환경변수 (GitHub 저장소 Secrets에 넣어 둡니다. 코드에는 절대 적지 않습니다):
  NEIS_API_KEY        나이스 교육정보 개방포털 인증키 (학원교습소정보)
  SCHOOLINFO_API_KEY  학교알리미 OpenAPI 인증키 (학년별·학급별 학생수)

사용 예:
  python3 scripts/update_data.py --gu 노원구 --office B10 --sido 11 --sgg 11350
"""

import argparse
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

NEIS_URL = "https://open.neis.go.kr/hub/acaInsTiInfo"
SCHOOLINFO_URL = "https://www.schoolinfo.go.kr/openApi.do"

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
            with urllib.request.urlopen(request, timeout=30) as res:
                return json.loads(res.read().decode("utf-8"))
        except Exception as error:  # 네트워크 오류는 잠시 쉬고 다시 시도
            if attempt == tries - 1:
                raise
            print(f"  다시 시도합니다 ({error})", file=sys.stderr)
            time.sleep(2 ** (attempt + 1))


def fetch_academies(key, office, gu):
    """나이스 학원교습소정보에서 해당 구의 학원·교습소 전체를 받습니다."""
    rows = []
    page = 1
    while True:
        data = get_json(NEIS_URL, {
            "KEY": key, "Type": "json", "pIndex": page, "pSize": 1000,
            "ATPT_OFCDC_SC_CODE": office, "ADMST_ZONE_NM": gu,
        })
        if "acaInsTiInfo" not in data:
            result = data.get("RESULT", {})
            if result.get("CODE") == "INFO-200":  # 해당하는 데이터가 없습니다
                break
            sys.exit(f"나이스 API 오류: {result.get('CODE')} {result.get('MESSAGE')}")
        head, body = data["acaInsTiInfo"]
        total = head["head"][0]["list_total_count"]
        rows.extend(body["row"])
        if len(rows) >= total:
            break
        page += 1
    print(f"학원·교습소 {len(rows)}곳을 받았습니다.")
    return rows


def fetch_schools(key, sido, sgg):
    """학교알리미 '학년별·학급별 학생수'(apiType 09)로 학교별 학생 수를 받습니다.

    올해 공시가 아직 없으면 작년 공시를 씁니다.
    """
    # 학교기본정보(apiType 0)의 지번 주소에서 법정동을 얻습니다. 예: 서울특별시 노원구 중계동 123
    dong_of = {}
    for kind in SCHOOL_KINDS.values():
        data = get_json(SCHOOLINFO_URL, {
            "apiKey": key, "apiType": "0",
            "sidoCode": sido, "sggCode": sgg, "schulKndCode": kind,
        })
        for row in data.get("list", []):
            dong_of[row.get("SCHUL_CODE")] = (
                last_dong(row.get("ADRES_BRKDN", ""))
                or academy_dong(row.get("SCHUL_RDNMA", "") + " " + (row.get("SCHUL_RDNDA") or ""), [])
            )

    this_year = datetime.date.today().year
    for year in (this_year, this_year - 1):
        schools = []
        for level, kind in SCHOOL_KINDS.items():
            data = get_json(SCHOOLINFO_URL, {
                "apiKey": key, "apiType": "09", "pbanYr": year,
                "sidoCode": sido, "sggCode": sgg, "schulKndCode": kind,
            })
            if data.get("resultCode") != "success":
                print(f"  {year}년 {level}: {data.get('resultMsg')}", file=sys.stderr)
                continue
            for row in data.get("list", []):
                students = to_int(row.get("COL_S_SUM") or row.get("COL_SUM_S4"))
                if not students:
                    continue
                schools.append({
                    "name": row.get("SCHUL_NM", ""),
                    "level": level,
                    "dong": legal_dong(dong_of.get(row.get("SCHUL_CODE")) or last_dong(row.get("ADRCD_NM", ""))),
                    "students": students,
                })
        if schools:
            located = sum(1 for s in schools if s["dong"])
            print(f"{year}년 공시 기준 학교 {len(schools)}곳을 받았습니다 (동을 찾은 학교 {located}곳).")
            return schools, year
    sys.exit("학교알리미에서 학생 수를 받지 못했습니다. 인증키와 지역 코드를 확인해 주세요.")


def to_int(value):
    value = str(value or "").replace(",", "").strip()
    try:
        return int(float(value))
    except ValueError:
        return 0


def last_dong(text):
    """'서울특별시 노원구 중계동' 같은 주소에서 마지막 동 이름을 꺼냅니다."""
    names = re.findall(r"[가-힣]+[0-9]*가?동(?=[\s\d,)]|$)", text or "")
    return names[-1] if names else ""


def legal_dong(dong):
    """행정동 이름을 법정동 이름으로 묶습니다. 예: 중계2·3동 -> 중계동, 중계본동 -> 중계동"""
    base = re.sub(r"(본동|[0-9·.,제]+동)$", "", dong)
    return base + "동" if base and base != dong else dong


def academy_dong(address, known):
    """도로명주소 끝 괄호의 법정동을 꺼냅니다. 예: '... 2층 (중계동, OO빌딩)' -> 중계동"""
    paren = re.search(r"\(([가-힣0-9]+동)[,)]", address or "")
    if paren:
        return paren.group(1)
    return next((name for name in known if name in (address or "")), "")


def is_open_tutoring(row):
    """영업 중인 입시·보습 분야 학원·교습소만 셉니다."""
    status = row.get("REG_STTUS_NM", "")
    realm = row.get("REALM_SC_NM", "")
    return status in ("", "개원", "등록") and ("보습" in realm or "입시" in realm)


def build(gu, province, academies, schools, year):
    areas = {}

    def area(name):
        return areas.setdefault(name, {
            "name": name,
            "students": {"elem": 0, "middle": 0, "high": 0, "total": 0},
            "academies": {"all": 0, "math": 0, "english": 0},
            "schools": [],
        })

    for school in schools:
        if not school["dong"]:
            continue
        a = area(school["dong"])
        a["students"][school["level"]] += school["students"]
        a["students"]["total"] += school["students"]
        a["schools"].append({k: school[k] for k in ("name", "level", "students")})

    unmatched = 0
    for row in academies:
        if not is_open_tutoring(row):
            continue
        address = f"{row.get('FA_RDNMA') or ''} {row.get('FA_RDNDA') or ''}"
        dong = legal_dong(academy_dong(address, list(areas)))
        if not dong:
            unmatched += 1
            if unmatched <= 3:
                print(f"  동을 못 찾은 주소 예: {address.strip()}", file=sys.stderr)
            continue
        a = area(dong)
        text = " ".join(row.get(k, "") or "" for k in ("ACA_NM", "LE_CRSE_LIST_NM", "LE_CRSE_NM"))
        a["academies"]["all"] += 1
        for subject, keywords in SUBJECT_KEYWORDS.items():
            if any(k in text for k in keywords):
                a["academies"][subject] += 1

    for a in areas.values():
        a["schools"].sort(key=lambda s: ("elem", "middle", "high").index(s["level"]))

    return {
        "id": gu,
        "region": f"{province} {gu}",
        "baseDate": f"학생 수 {year}년 학교알리미 공시, 학원 {datetime.date.today():%Y년 %m월} 기준",
        "builtAt": datetime.date.today().isoformat(),
        "sources": [
            "학원: 나이스 교육정보 개방포털 학원교습소정보",
            "학생 수: 학교알리미 학년별·학급별 학생수",
        ],
        "unmatchedAcademies": unmatched,
        "areas": sorted(areas.values(), key=lambda a: a["name"]),
    }


def save(output):
    data_dir = ROOT / "data"
    data_dir.mkdir(exist_ok=True)
    (data_dir / f"{output['id']}.json").write_text(
        json.dumps(output, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    index_path = data_dir / "regions.json"
    regions = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else []
    regions = [r for r in regions if r["id"] != output["id"]]
    regions.append({"id": output["id"], "name": output["region"]})
    index_path.write_text(json.dumps(regions, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gu", required=True, help="구 이름, 예: 노원구")
    parser.add_argument("--province", default="서울특별시")
    parser.add_argument("--office", required=True, help="나이스 시도교육청 코드, 서울은 B10")
    parser.add_argument("--sido", required=True, help="학교알리미 시도 코드, 서울은 11")
    parser.add_argument("--sgg", required=True, help="학교알리미 시군구 코드, 노원구는 11350")
    args = parser.parse_args()

    neis_key = os.environ.get("NEIS_API_KEY")
    schoolinfo_key = os.environ.get("SCHOOLINFO_API_KEY")
    if not neis_key or not schoolinfo_key:
        sys.exit("NEIS_API_KEY와 SCHOOLINFO_API_KEY 환경변수가 필요합니다.")

    academies = fetch_academies(neis_key, args.office, args.gu)
    schools, year = fetch_schools(schoolinfo_key, args.sido, args.sgg)
    output = build(args.gu, args.province, academies, schools, year)
    if not output["areas"] or not any(a["students"]["total"] for a in output["areas"]):
        sys.exit("동별로 묶인 결과가 없어 저장하지 않습니다. 주소 형식을 확인해 주세요.")
    save(output)

    total = sum(a["academies"]["all"] for a in output["areas"])
    print(f"data/{args.gu}.json: 동 {len(output['areas'])}개, 입시·보습 학원 {total}곳 "
          f"(주소로 동을 못 찾은 학원 {output['unmatchedAcademies']}곳)")


if __name__ == "__main__":
    main()
