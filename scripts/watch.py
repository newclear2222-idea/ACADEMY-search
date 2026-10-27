"""동네 알림: 학원 입지 가이드에서 고른 동네의 새 소식을 매일 아침 구글 시트(Apps Script)로 보냅니다.
시트는 '알림' 탭에 쌓고 가이드 '동네 알림' 칸이 보여 줍니다(scripts/intake-sheet.gs, SEND_MAIL이면 Gmail로도).

알려 주는 것
  - 학원 인수: 빠진 학원과 같은 주소에 다른 학원이 있거나 새로 등록함. 인계가 끝나 자리가 비지 않습니다.
  - 학원 문 닫음: 지난번에 있던 학원·교습소가 교육청 목록에서 빠졌고 같은 주소에 다른 학원이 없음. 자리가 빌 수 있습니다.
  - 학원 휴원: 영업 중이던 곳이 휴원으로 바뀜.
  - 새 학원: 지난번에 없던 입시·보습 학원·교습소가 생김(경쟁 상대).
  - LH 상가 공고: 그 시·구나 동 이름이 들어간 LH 상가 분양·임대 공고가 새로 올라옴.
  - 공매 상가: 온비드(캠코)에 입찰 중·예정인 부동산 공매 중 그 동 주소의 상가·근린생활시설·업무시설.

필요한 환경변수 (GitHub 저장소 Secrets)
  NEIS_API_KEY    나이스 교육정보 개방포털 인증키 (학원 목록)
  SHEET_KEY       intake-sheet.gs 맨 위 READ_KEY와 같은 비밀번호
  DATA_GO_KR_KEY  공공데이터포털 인증키. 'LH 분양임대공고문 조회 서비스'와 '차세대 온비드 부동산 물건목록 조회서비스'를
                  활용신청해야 LH 상가 공고와 공매 상가가 옵니다. 없으면 건너뜁니다.
  SHEET_URL       (선택) Apps Script 웹 앱 주소. 없으면 intake-config.js의 INTAKE_URL을 씁니다.

처음 고른 동은 그날 목록만 저장하고 알림은 다음 날부터 보냅니다.
"""

import datetime
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import update_data as ud

ROOT = Path(__file__).resolve().parent.parent
LH_URL = "https://apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1"
LH_AREA_CODES = {"서울특별시": "11", "경기도": "41", "인천광역시": "28"}
ONBID_URL = "https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2"
ONBID_LINK = "https://www.onbid.co.kr"
# 재산유형코드(prptDivCd)는 공개 문서에서 값을 확인하지 못해, 흔한 꼴을 차례로 넣어 보고 받은 것만 씁니다.
# 실제 값이 확인되면 ONBID_PRPT_CODES 환경변수(쉼표로 구분)로 바꿀 수 있습니다.
ONBID_PRPT_CODES = ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010"]
ONBID_PAGES = 5
# 학원을 넣을 수 있는 용도만 남깁니다. 아파트·토지·공장 등은 뺍니다.
ONBID_USES = ("근린생활", "상가", "점포", "업무", "사무", "교육", "판매", "학원")
LH_LINK = "https://apply.lh.or.kr/lhapply/apply/wt/wrtanc/selectWrtancList.do?mi=1026"
OPEN_STATUSES = ("", "개원", "등록")
# 한 번에 이만큼 넘게 사라지면 교육청 자료가 덜 온 것으로 보고 그날은 '문 닫음'을 보내지 않습니다.
MAX_CLOSED_SHARE = 0.3
CLOSED_DAYS = 60
SHORT_TO_PROVINCE = {v["short"]: k for k, v in ud.PROVINCES.items()}


def sheet_url():
    url = (os.environ.get("SHEET_URL") or "").strip()
    if not url:
        m = re.search(r'INTAKE_URL\s*=\s*"([^"]+)"', (ROOT / "intake-config.js").read_text(encoding="utf-8"))
        url = m.group(1) if m else ""
    if not re.fullmatch(r"https://script\.google\.com/macros/s/[\w-]+/exec", url):
        sys.exit("Apps Script 웹 앱 주소를 찾지 못했습니다. intake-config.js의 INTAKE_URL이나 SHEET_URL을 확인해 주세요.")
    return url


def call_sheet(url, key, payload=None):
    """Apps Script는 응답 전에 다른 주소로 한 번 넘깁니다. urllib가 따라가며 GET으로 바꿔 줍니다."""
    if payload is None:
        req = urllib.request.Request(f"{url}?{urllib.parse.urlencode({'key': key, 'what': 'watch'})}")
    else:
        body = json.dumps({**payload, "key": key}, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "text/plain;charset=utf-8"})
    with urllib.request.urlopen(req, timeout=120) as res:
        out = json.loads(res.read().decode("utf-8"))
    if not out.get("ok"):
        sys.exit(f"시트가 거절했습니다: {out.get('error')}")
    return out


def town_key(region, town):
    return f"{region}|{town}"


def academy_id(row):
    return str(row.get("ACA_ASNUM") or "").strip() or f"{row.get('ACA_NM')}|{row.get('FA_RDNMA')}"


def place_of(province, row):
    """학원 주소 -> ('서울-노원구', '중계동'). 나뉜 구(인천)는 새 구 이름 후보를 모두 돌려줍니다."""
    address = f"{row.get('FA_RDNMA') or ''} {row.get('FA_RDNDA') or ''}".strip()
    found = ud.region_of(address)
    if not found or found[0] != province:
        return [], ""
    short = ud.PROVINCES[province]["short"]
    names = ud.SPLIT_REGIONS.get(province, {}).get(found[1], [found[1]])
    town = ud.area_name_of(province, {"name": found[1]}, address)
    return [f"{short}-{n}" for n in names], town


def same_place(address):
    """띄어쓰기와 괄호(법정동·건물 이름)를 뺀 주소. 같은 건물 같은 호수면 같게 나옵니다."""
    return re.sub(r"\([^)]*\)|[\s,]", "", address or "")


def is_tutoring(row):
    realm = row.get("REALM_SC_NM") or ""
    return "보습" in realm or "입시" in realm


def describe(row):
    kind = "교습소" if "교습소" in (row.get("ACA_INSTI_SC_NM") or "") else "학원"
    realm = (row.get("REALM_SC_NM") or "").strip()
    address = f"{row.get('FA_RDNMA') or ''} {row.get('FA_RDNDA') or ''}".strip()
    return {"n": (row.get("ACA_NM") or "").strip(), "k": kind, "r": realm, "a": address,
            "s": (row.get("REG_STTUS_NM") or "").strip(), "t": 1 if is_tutoring(row) else 0}


def academy_alerts(towns, state, neis_key):
    """동마다 지금 학원 목록을 지난번(state)과 견줘 새 학원·문 닫음·휴원을 찾습니다."""
    items, new_state = [], {}
    by_province = {}
    for t in towns:
        province = SHORT_TO_PROVINCE.get(t["region"].split("-")[0])
        if province:
            by_province.setdefault(province, []).append(t)
        else:
            print(f"  {t['region']}: 지원하지 않는 시도라 건너뜁니다.")
    for province, ts in by_province.items():
        rows = ud.fetch_academies(neis_key, ud.PROVINCES[province]["office"])
        wanted = {town_key(t["region"], t["town"]) for t in ts}
        now = {k: {} for k in wanted}
        for row in rows:
            regions, town = place_of(province, row)
            for region in regions:
                k = town_key(region, town)
                if k in now:
                    now[k][academy_id(row)] = describe(row)
        for t in ts:
            k = town_key(t["region"], t["town"])
            cur, before = now[k], state.get(k)
            print(f"  {t['region']} {t['town']}: 학원·교습소 {len(cur)}곳" + ("" if before is not None else " (처음 저장)"))
            if before is None:
                new_state[k] = cur
                continue
            gone = [before[i] for i in before if i not in cur]
            if before and len(gone) > max(5, len(before) * MAX_CLOSED_SHARE):
                print(f"    {len(gone)}곳이 한꺼번에 빠져 교육청 자료가 덜 온 것 같습니다. 오늘은 지난번 목록을 그대로 둡니다.")
                new_state[k] = before
                continue
            # 학원 인수는 보통 교육청에 옛 학원 폐원과 새 학원 등록이 같은 주소로 함께 들어옵니다.
            # 같은 주소에 다른 학원이 있으면 '인수'로, 없을 때만 '문 닫음(자리 빌 수 있음)'으로 알립니다.
            # 폐원이 먼저 잡히고 새 등록이 며칠 늦게 올 수 있어, 문 닫은 주소를 CLOSED_DAYS일 기억해 둡니다.
            today = datetime.date.today()
            closed = {addr: v for addr, v in (state.get(k + "|closed") or {}).items()
                      if (today - datetime.date.fromisoformat(v[1])).days <= CLOSED_DAYS}
            at = {}
            for i, a in cur.items():
                at.setdefault(same_place(a["a"]), []).append((i, a))
            taken = set()
            for a in gone:
                others = at.get(same_place(a["a"]), [])
                if others:
                    taken.update(i for i, _ in others)
                    items.append(alert(t, "학원 인수", f"{a['n']} → {', '.join(b['n'] for _, b in others)} (같은 자리, 주인이 바뀐 것으로 보여요) · {a['a']}"))
                else:
                    closed[same_place(a["a"])] = [a["n"], today.isoformat()]
                    items.append(alert(t, "학원 문 닫음", f"{a['n']} ({a['k']}, {a['r'] or '분야 모름'}) · {a['a']} · 같은 자리에 새로 등록한 학원은 아직 없어요"))
            for i, a in cur.items():
                if i in taken:
                    continue
                if i not in before and a["s"] in OPEN_STATUSES:
                    place = same_place(a["a"])
                    if place in closed:
                        items.append(alert(t, "학원 인수", f"며칠 전 문 닫은 {closed.pop(place)[0]} 자리에 {a['n']} 등록 (주인이 바뀐 것으로 보여요) · {a['a']}"))
                    elif a["t"]:
                        sharing = [b["n"] for j, b in at.get(place, []) if j != i]
                        items.append(alert(t, "새 학원", f"{a['n']} ({a['k']}) · {a['a']}" + (f" · 같은 자리에 {', '.join(sharing)}이 아직 있어 인수 중일 수 있어요" if sharing else "")))
                elif i in before and before[i].get("s") in OPEN_STATUSES and a["s"] == "휴원":
                    items.append(alert(t, "학원 휴원", f"{a['n']} ({a['k']}, {a['r'] or '분야 모름'}) · {a['a']}"))
            new_state[k + "|closed"] = closed
            new_state[k] = cur
    return items, new_state


def alert(t, kind, text, link=""):
    return {"region": t["region"], "town": t["town"], "kind": kind, "text": text, "link": link}


def find_notices(data):
    """LH 응답은 [{dsSch}, {resHeader, dsList:[...]}] 꼴이라, 공고명이 있는 줄을 모두 찾습니다."""
    if isinstance(data, dict):
        if data.get("PAN_NM") or data.get("pan_nm"):
            return [{k.upper(): v for k, v in data.items()}]
        return [n for v in data.values() for n in find_notices(v)]
    if isinstance(data, list):
        return [n for v in data for n in find_notices(v)]
    return []


def stem(name):
    """'노원구' -> '노원', '중계동' -> '중계', '동탄2' 같은 이름은 그대로. 두 글자 미만이면 쓰지 않습니다."""
    s = re.sub(r"(특별시|광역시|시|군|구|동|읍|면)$", "", name)
    return s if len(s) >= 2 else ""


def lh_alerts(towns, state, key):
    """그 시도에 '공고중'인 LH 상가 공고 중 고른 동네의 시·구나 동 이름이 들어간 새 공고."""
    seen = set(state.get("lh", []))
    items, ids = [], set()
    for province, code in LH_AREA_CODES.items():
        ts = [t for t in towns if SHORT_TO_PROVINCE.get(t["region"].split("-")[0]) == province]
        if not ts:
            continue
        try:
            data = ud.get_json(LH_URL, {"serviceKey": key, "PG_SZ": 100, "PAGE": 1, "UPP_AIS_TP_CD": "22", "CNP_CD": code}, tries=2)
        except Exception as e:  # 활용신청 전이거나 잠깐 막혀도 학원 알림은 그대로 보냅니다.
            print(f"  LH 상가 공고를 받지 못했습니다 ({province}): {e}")
            return [], None
        notices = find_notices(data)
        print(f"  LH 상가 공고 {province}: {len(notices)}건")
        for n in notices:
            pid = str(n.get("PAN_ID") or n.get("PAN_NM"))
            ids.add(pid)
            if pid in seen or (n.get("PAN_SS") or "") in ("접수마감", "당첨자발표"):
                continue
            title = str(n.get("PAN_NM") or "")
            for t in ts:
                words = {stem(t["region"].split("-")[1]), stem(t["town"])} - {""}
                if any(w in title for w in words):
                    when = " · ".join(x for x in (f"게시 {n.get('PAN_NT_ST_DT')}" if n.get("PAN_NT_ST_DT") else "",
                                                   f"마감 {n.get('CLSG_DT')}" if n.get("CLSG_DT") else "") if x)
                    link = str(n.get("DTL_URL") or "")
                    items.append(alert(t, "LH 상가 공고", f"{title}{' (' + when + ')' if when else ''}",
                                       link if link.startswith("https://") else LH_LINK))
                    break
    return items, sorted(ids | seen)[-500:]


def onbid_items(data):
    """응답 모양을 몰라도 물건번호나 물건명이 있는 줄을 모두 찾습니다."""
    if isinstance(data, dict):
        keys = {k.lower() for k in data}
        if keys & {"cltrmngno", "cltrnm"}:
            return [data]
        return [n for v in data.values() for n in onbid_items(v)]
    if isinstance(data, list):
        return [n for v in data for n in onbid_items(v)]
    return []


def pick(item, *parts):
    """키 이름에 parts 중 하나가 들어간 첫 값. 예: pick(x, 'adrs', 'addr')"""
    for k, v in item.items():
        if v not in (None, "") and any(p in k.lower() for p in parts):
            return str(v).strip()
    return ""


def onbid_alerts(towns, state, key):
    """온비드에 입찰 중·예정인 부동산 공매 중 고른 동네 주소의 상가·근린생활시설·업무시설."""
    seen = set(state.get("onbid", []))
    codes = [c.strip() for c in (os.environ.get("ONBID_PRPT_CODES") or "").split(",") if c.strip()] or ONBID_PRPT_CODES
    found, ok_codes = {}, []
    for code in codes:
        got = 0
        for page in range(1, ONBID_PAGES + 1):
            params = {"serviceKey": key, "prptDivCd": code, "pvctTrgtYn": "N", "pageNo": page, "numOfRows": 1000,
                      "resultType": "json", "_type": "json"}
            try:
                data = ud.get_json(ONBID_URL, params, tries=2)
            except Exception as e:  # 활용신청 전이거나 이 코드가 없으면 다음으로
                if page == 1 and code == codes[0]:
                    print(f"  온비드: {e}")
                break
            rows = onbid_items(data)
            if page == 1 and rows and not ok_codes:
                print(f"  온비드 항목: {', '.join(sorted(rows[0]))}")
            for r in rows:
                found[pick(r, "cltrmngno") + "|" + pick(r, "pbctcdtnno")] = r
            got += len(rows)
            if len(rows) < 1000:
                break
        if got:
            ok_codes.append(code)
    print(f"  온비드 부동산 공매: {len(found)}건 (재산유형코드 {', '.join(ok_codes) or '받은 것 없음'})")
    if not found:
        return [], None
    items = []
    for pid, r in found.items():
        if pid in seen:
            continue
        text = " ".join(str(v) for v in r.values() if isinstance(v, (str, int, float)))
        if not any(u in text for u in ONBID_USES):
            continue
        address = pick(r, "adrs", "addr", "lctn")
        for t in towns:
            gu = t["region"].split("-")[1]
            place = address or text
            if gu in place and t["town"] in place:
                name = pick(r, "cltrnm") or address
                price = pick(r, "minbid", "lowstbid", "lwstbid")
                when = pick(r, "bidbgn", "pbctbegn", "bidstrt")
                until = pick(r, "bidend", "pbctcls", "bidclos")
                extra = " · ".join(x for x in (address if address and address != name else "",
                                                f"최저입찰가 {int(float(price)):,}원" if price.replace(".", "").isdigit() else "",
                                                f"입찰 {when}~{until}" if when or until else "") if x)
                items.append(alert(t, "공매 상가", f"{name}{' · ' + extra if extra else ''}", ONBID_LINK))
                break
    return items, sorted(set(found) | seen)[-3000:]


def main():
    neis_key = (os.environ.get("NEIS_API_KEY") or "").strip()
    key = (os.environ.get("SHEET_KEY") or "").strip()
    lh_key = urllib.parse.unquote((os.environ.get("DATA_GO_KR_KEY") or "").strip())
    if not neis_key or not key:
        sys.exit("NEIS_API_KEY와 SHEET_KEY 환경변수가 필요합니다.")
    url = sheet_url()
    got = call_sheet(url, key)
    towns, state = got.get("towns") or [], got.get("state") or {}
    print(f"알림 받을 동네 {len(towns)}곳: {', '.join(t['region'] + ' ' + t['town'] for t in towns) or '없음'}")
    if not towns:
        return
    items, new_state = academy_alerts(towns, state, neis_key)
    if lh_key:
        lh_items, lh_ids = lh_alerts(towns, state, lh_key)
        items += lh_items
        new_state["lh"] = lh_ids if lh_ids is not None else state.get("lh", [])
        ob_items, ob_ids = onbid_alerts(towns, state, lh_key)
        items += ob_items
        new_state["onbid"] = ob_ids if ob_ids is not None else state.get("onbid", [])
    out = call_sheet(url, key, {"action": "report", "items": items, "state": new_state})
    print(f"새 소식 {len(items)}건을 보냈습니다. (시트 응답: {out})")


if __name__ == "__main__":
    main()
