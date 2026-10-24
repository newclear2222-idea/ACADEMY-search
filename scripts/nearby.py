"""동 사이 거리로 '가까운 학원 밀집 동'을 찾을 수 있게 각 동에 이웃 동 목록을 붙입니다.

1) 동 중심 좌표 만들기 (한 번만, 행정동 경계가 바뀌면 다시):
   python3 scripts/nearby.py centroids HangJeongDong_ver20250401.geojson
   행정동 경계 자료: https://github.com/vuski/admdongkor (통계청 행정동 경계 기반)
   행정동을 법정동 이름으로 묶어(중계2·3동 -> 중계동) 중심 좌표의 평균을 data/centroids.json에 씁니다.

2) 이웃 동 붙이기 (자료를 새로 만들 때마다 update_data.py가 부릅니다):
   python3 scripts/nearby.py apply
   구·시 경계를 넘어서도 동 중심끼리 3km 안의 동, 7km 안의 학원 20곳 이상인 동,
   12km 안의 대형 학원가(학원 250곳 이상)를 가까운 순으로 붙입니다.
"""
import json
import math
import re
import sys
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CENTROIDS = DATA_DIR / "centroids.json"
PROVINCES = {"서울특별시", "경기도", "인천광역시"}
NEARBY_KM = 7.0  # 학원 20곳 이상인 동은 이 안까지
BIG_HUB = 250   # 대형 학원가(대치동, 목동, 중계동, 평촌 등)는 멀어도 찾아가서
BIG_HUB_KM = 12.0
NEAR_KM = 3.0   # 이 안은 학원이 적은 동도 남깁니다.
NEARBY_MAX = 30


def legal_dong(dong):
    # update_data.py와 같은 규칙입니다. 예: 중계2·3동 -> 중계동, 중계본동 -> 중계동
    base = re.sub(r"(본동|[0-9·.,제]+동)$", "", dong)
    return base + "동" if base and base != dong else dong


def city_of(sggnm):
    # '수원시장안구' -> '수원시'. 서울·인천의 구는 그대로 둡니다.
    m = re.match(r"(.+?시)(.+구)$", sggnm)
    return m.group(1) if m else sggnm


def ring_center(geometry):
    polys = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    ring = max((p[0] for p in polys), key=len)
    return sum(p[1] for p in ring) / len(ring), sum(p[0] for p in ring) / len(ring)


def build_centroids(path):
    features = json.loads(Path(path).read_text(encoding="utf-8"))["features"]
    points = {}
    for f in features:
        p = f["properties"]
        if p["sidonm"] not in PROVINCES:
            continue
        region = f"{p['sidonm']} {city_of(p['sggnm'])}"
        dong = legal_dong(p["adm_nm"].split()[-1])
        points.setdefault(region, {}).setdefault(dong, []).append(ring_center(f["geometry"]))
    out = {
        region: {d: [round(sum(x[0] for x in pts) / len(pts), 5), round(sum(x[1] for x in pts) / len(pts), 5)]
                 for d, pts in sorted(dongs.items())}
        for region, dongs in sorted(points.items())
    }
    CENTROIDS.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"동 중심 좌표 {sum(len(v) for v in out.values())}곳 -> {CENTROIDS}")


def km(a, b):
    dy = (a[0] - b[0]) * 111.0
    dx = (a[1] - b[1]) * 111.0 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(dx, dy)


def apply_nearby():
    if not CENTROIDS.exists():
        print("data/centroids.json이 없어 이웃 동을 붙이지 않습니다.")
        return
    centroids = json.loads(CENTROIDS.read_text(encoding="utf-8"))
    files = [p for p in sorted(DATA_DIR.glob("*-*.json"))]
    regions = [(p, json.loads(p.read_text(encoding="utf-8"))) for p in files]

    # 이름이 바뀐 구(예: 인천 서해구)는 같은 시·도 안에서 이름이 하나뿐인 동으로 찾습니다.
    by_province = {}
    for region, dongs in centroids.items():
        for d, pt in dongs.items():
            by_province.setdefault(region.split()[0], {}).setdefault(d, []).append(pt)

    def point_of(data, area):
        # 1순위: 그 동 학교들의 평균 위치(update_data.py가 학교알리미 좌표로 넣음)
        if area.get("center"):
            return area["center"]
        # 2순위: 행정동 경계 중심. 법정동 '내발산동'은 행정동 '발산1동'처럼 앞 글자가 빠지기도 합니다.
        dong = area["name"]
        for name in (dong, dong[1:] if dong[:1] in "내외상하중" and len(dong) > 2 else None):
            if not name:
                continue
            pt = centroids.get(data["region"], {}).get(name)
            if pt:
                return pt
            same = by_province.get(data["province"], {}).get(name, [])
            if len(same) == 1:
                return same[0]
        return None

    places = []
    for _, data in regions:
        for a in data["areas"]:
            pt = point_of(data, a)
            if pt:
                places.append((pt, data, a))
    missing = sum(len(d["areas"]) for _, d in regions) - len(places)
    for pt, data, a in places:
        near = sorted(
            ((km(pt, pt2), d2, a2) for pt2, d2, a2 in places
             if a2 is not a and (km(pt, pt2) <= NEAR_KM
                                 or (km(pt, pt2) <= NEARBY_KM and a2["academies"]["all"] >= 20)
                                 or (km(pt, pt2) <= BIG_HUB_KM and a2["academies"]["all"] >= BIG_HUB))),
            key=lambda x: x[0],
        )[:NEARBY_MAX]
        a["nearby"] = [{"name": a2["name"], "region": d2["id"], "km": round(dist, 1),
                        "academies": a2["academies"], "students": a2["students"]["total"], "sales": a2.get("sales")}
                       for dist, d2, a2 in near]
    for path, data in regions:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"  이웃 동 붙임: {len(places)}곳 (좌표 없는 동 {missing}곳)")


if __name__ == "__main__":
    if sys.argv[1:2] == ["centroids"]:
        build_centroids(sys.argv[2])
    elif sys.argv[1:2] == ["apply"]:
        apply_nearby()
    else:
        print(__doc__)
