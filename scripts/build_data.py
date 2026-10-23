"""공공데이터 원본 파일을 사이트가 읽는 data/<지역>.json 으로 정리합니다.

입력 파일 두 가지 (data/raw/ 아래에 둡니다):
  1. 학원 목록: 나이스 교육정보 개방포털 '학원교습소정보' 다운로드 (CSV 또는 XLSX)
  2. 학생 수: 행정안전부 주민등록 인구통계 '연령별 인구현황' (행정동, 1세 단위) CSV

사용 예:
  python3 scripts/build_data.py --gu 노원구 \
      --academies data/raw/academies.csv --population data/raw/population.csv
"""

import argparse
import csv
import datetime
import io
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 만 나이 기준 학교급 (3월 입학 기준 근사치)
LEVELS = {
    "elem": range(6, 12),    # 초등학생: 만 6~11세
    "middle": range(12, 15),  # 중학생: 만 12~14세
    "high": range(15, 18),   # 고등학생: 만 15~17세
}

SUBJECT_KEYWORDS = {
    "math": ["수학"],
    "english": ["영어"],
}

# 나이스 파일 다운로드(한글 헤더)와 API(영문 코드) 양쪽 컬럼명을 모두 받습니다.
ACADEMY_COLUMNS = {
    "zone": ["행정구역명", "ADMST_ZONE_NM"],
    "name": ["학원명", "ACA_NM"],
    "kind": ["학원교습소명", "ACA_INSTI_SC_NM"],
    "realm": ["분야명", "REALM_SC_NM"],
    "course_list": ["교습과정목록명", "LE_CRSE_LIST_NM"],
    "course": ["교습과정명", "LE_CRSE_NM"],
    "status": ["등록상태명", "REG_STTUS_NM"],
    "address": ["도로명주소", "FA_RDNMA"],
}


def read_table(path):
    """CSV(UTF-8 또는 CP949) 또는 XLSX 파일을 dict 행 목록으로 읽습니다."""
    path = Path(path)
    if path.suffix.lower() in (".xlsx", ".xlsm"):
        import openpyxl

        sheet = openpyxl.load_workbook(path, read_only=True, data_only=True).active
        rows = list(sheet.iter_rows(values_only=True))
        header = [str(h).strip() if h is not None else "" for h in rows[0]]
        return [
            {h: ("" if v is None else str(v).strip()) for h, v in zip(header, row)}
            for row in rows[1:]
        ]
    raw = path.read_bytes()
    for encoding in ("utf-8-sig", "cp949"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        sys.exit(f"{path}: 파일 인코딩을 읽을 수 없습니다 (UTF-8 또는 CP949 필요)")
    reader = csv.DictReader(io.StringIO(text))
    reader.fieldnames = [f.strip() for f in reader.fieldnames]
    return [{k: (v or "").strip() for k, v in row.items() if k} for row in reader]


def pick(row, field):
    for column in ACADEMY_COLUMNS[field]:
        if column in row:
            return row[column]
    return ""


def area_of(dong):
    """행정동 이름에서 법정동 묶음 이름을 만듭니다. 예: 중계2·3동 -> 중계동, 상계3.4동 -> 상계동"""
    base = re.sub(r"(본동|[\d·.,제]+동)$", "", dong)
    return base + "동" if base and not base.endswith("동") else dong


def to_int(value):
    value = str(value).replace(",", "").strip()
    return int(float(value)) if value else 0


def load_population(path, gu):
    """연령별 인구현황 CSV에서 해당 구의 행정동별 학교급 인구를 뽑습니다."""
    rows = read_table(path)
    dongs = []
    for row in rows:
        region = row.get("행정구역", "")
        # 예: "서울특별시 노원구 중계1동(1135061500)"
        match = re.match(r"(.+?)\s+(\S+구|\S+시|\S+군)\s+(\S+(?:동|읍|면))\s*\(", region)
        if not match or match.group(2) != gu:
            continue
        ages = {}
        for column, value in row.items():
            age_match = re.search(r"_계_(\d+)세$", column)
            if age_match:
                ages[int(age_match.group(1))] = to_int(value)
        if not ages:
            sys.exit("인구 파일에서 '..._계_N세' 형식의 1세 단위 연령 컬럼을 찾지 못했습니다.")
        students = {level: sum(ages.get(a, 0) for a in span) for level, span in LEVELS.items()}
        students["total"] = sum(students.values())
        dongs.append({"name": match.group(3), "province": match.group(1), "students": students})
    if not dongs:
        sys.exit(f"인구 파일에서 '{gu}'의 행정동을 찾지 못했습니다.")
    return dongs


def load_academies(path, gu, area_names):
    """학원 목록에서 해당 구의 영업 중인 입시·보습 학원을 법정동 묶음별로 셉니다."""
    counts = {name: {"all": 0, "math": 0, "english": 0} for name in area_names}
    unmatched = 0
    for row in read_table(path):
        zone = pick(row, "zone")
        address = pick(row, "address")
        if gu not in zone and gu not in address:
            continue
        status = pick(row, "status")
        if status and status not in ("개원", "등록", "영업중"):
            continue
        if "보습" not in pick(row, "realm") and "입시" not in pick(row, "realm"):
            continue
        area = None
        # 도로명주소 끝 괄호 안의 법정동: "... 123, 2층 (중계동, OO빌딩)"
        paren = re.search(r"\(([^,)]+?동)[,)]", address)
        if paren and paren.group(1) in counts:
            area = paren.group(1)
        else:
            area = next((name for name in counts if name in address), None)
        if area is None:
            unmatched += 1
            continue
        text = " ".join(pick(row, f) for f in ("name", "course_list", "course"))
        counts[area]["all"] += 1
        for subject, keywords in SUBJECT_KEYWORDS.items():
            if any(k in text for k in keywords):
                counts[area][subject] += 1
    return counts, unmatched


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gu", required=True, help="구 이름, 예: 노원구")
    parser.add_argument("--academies", required=True, help="학원교습소정보 파일 (CSV/XLSX)")
    parser.add_argument("--population", required=True, help="연령별 인구현황 CSV")
    parser.add_argument("--id", help="출력 파일 이름 (기본: 구 이름)")
    parser.add_argument("--base-date", default="", help="데이터 기준일 표시용, 예: 2026년 9월")
    args = parser.parse_args()

    dongs = load_population(args.population, args.gu)
    areas = {}
    for dong in dongs:
        area = areas.setdefault(area_of(dong["name"]), {"name": area_of(dong["name"]), "dongs": []})
        area["dongs"].append({"name": dong["name"], "students": dong["students"]})
    for area in areas.values():
        area["students"] = {
            key: sum(d["students"][key] for d in area["dongs"]) for key in ("elem", "middle", "high", "total")
        }

    counts, unmatched = load_academies(args.academies, args.gu, list(areas))
    for name, area in areas.items():
        area["academies"] = counts[name]

    region_id = args.id or args.gu
    output = {
        "id": region_id,
        "region": f"{dongs[0]['province']} {args.gu}",
        "baseDate": args.base_date,
        "builtAt": datetime.date.today().isoformat(),
        "sources": [
            "학원: 나이스 교육정보 개방포털 학원교습소정보",
            "학생 수: 행정안전부 주민등록 인구통계 연령별 인구현황 (만 6~17세)",
        ],
        "unmatchedAcademies": unmatched,
        "areas": sorted(areas.values(), key=lambda a: a["name"]),
    }
    out_path = ROOT / "data" / f"{region_id}.json"
    out_path.write_text(json.dumps(output, ensure_ascii=False, indent=1), encoding="utf-8")

    index_path = ROOT / "data" / "regions.json"
    regions = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else []
    regions = [r for r in regions if r["id"] != region_id]
    regions.append({"id": region_id, "name": output["region"]})
    index_path.write_text(json.dumps(regions, ensure_ascii=False, indent=1), encoding="utf-8")

    total = sum(a["academies"]["all"] for a in areas.values())
    print(f"{out_path.relative_to(ROOT)}: 동 묶음 {len(areas)}개, 학원 {total}곳 (주소로 동을 못 찾은 학원 {unmatched}곳)")


if __name__ == "__main__":
    main()
