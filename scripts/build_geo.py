# 동별 지도에 쓰는 행정동 경계(data/geo/서울.json, 경기.json, 인천.json)를 만듭니다. 해마다 한 번쯤 다시 만들면 됩니다.
#   1) https://github.com/vuski/admdongkor 에서 HangJeongDong_ver<날짜>.geojson을 받습니다.
#   2) python3 scripts/build_geo.py HangJeongDong_ver20250401.geojson geo-raw
#   3) 크기를 줄입니다: npx mapshaper geo-raw/서울.raw.json -simplify 8% keep-shapes -o precision=0.0001 data/geo/서울.json (경기, 인천도 같게)
# 경기의 일반구(수원시 영통구 등)는 시 하나로 묶고, 인천은 2026년 7월 바뀐 구(제물포구·영종구·서해구·검단구)로 나눕니다.
src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src, encoding='utf-8'))
SHORT = {'서울특별시': '서울', '경기도': '경기', '인천광역시': '인천'}
YEONGJONG = ('영종', '운서', '용유')
GEOMDAN = ('검단', '불로대곡', '원당', '당하', '오류왕길', '마전', '아라')
groups = {}
for f in d['features']:
    p = f['properties']; short = SHORT.get(p['sidonm'])
    if not short: continue
    gu = re.sub(r'^(.+시).+구$', r'\1', p['sggnm'])
    dong = p['adm_nm'].split()[-1]
    if short == '인천':
        if gu == '중구': gu = '영종구' if dong.startswith(YEONGJONG) else '제물포구'
        elif gu == '동구': gu = '제물포구'
        elif gu == '서구': gu = '검단구' if dong.startswith(GEOMDAN) else '서해구'
        elif gu == '남구': gu = '미추홀구'
    groups.setdefault(short, []).append({'type': 'Feature', 'properties': {'r': f'{short}-{gu}', 'n': dong}, 'geometry': f['geometry']})
os.makedirs(out, exist_ok=True)
for short, feats in groups.items():
    json.dump({'type': 'FeatureCollection', 'features': feats}, open(f'{out}/{short}.raw.json', 'w', encoding='utf-8'), ensure_ascii=False)
    print(short, len(feats), sorted({x['properties']['r'] for x in feats})[:5], len({x['properties']['r'] for x in feats}))
