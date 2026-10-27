// 개원 상담 신청을 구글 시트에 쌓는 Google Apps Script입니다. 설정 방법은 README의 '개원 상담 신청 사이트'를 보세요.
// - 상담 신청 사이트(intake.html)가 보낸 신청을 시트에 한 줄씩 붙입니다(doPost).
// - 학원 입지 가이드가 아래 READ_KEY를 붙여 부르면 쌓인 신청을 돌려줍니다(doGet). 키가 틀리면 아무것도 주지 않습니다.
// - 동네 알림: 가이드에서 고른 동네를 '알림지역' 탭에 두고, 매일 아침 GitHub 자동 작업(scripts/watch.py)이 새 소식을 보내면
//   '알림' 탭에 쌓고, 가이드의 '동네 알림' 칸이 그걸 보여 줍니다. 메일은 보내지 않습니다. 이것도 READ_KEY가 맞아야 합니다.

// 가이드에서 신청 목록을 불러올 때 쓸 비밀번호입니다. 남이 짐작하기 어려운 12자 이상으로 바꾸세요.
const READ_KEY = "여기에-비밀번호를-넣으세요";
const SHEET_NAME = "상담신청";
const HEADERS = ["번호", "받은 시각", "이름", "휴대폰", "이메일", "과목", "대상", "개원에 쓸 돈(만원)", "월 임대료 한도(만원)",
  "대형·유명 강사(년)", "중소형 강사(년)", "직접 운영(년)", "과외·공부방(년)", "실적·수강생", "신도시만", "원하는 지역", "사주", "더 알려 주실 것", "처리 메모", "원본"];
const SUBJECTS = { math: "수학", english: "영어", korean: "국어·논술", science: "과학", all: "입시·보습 전체" };
const LEVELS = { elem: "초등", middle: "중등", high: "고등", total: "초·중·고 전체" };

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) { sh.appendRow(HEADERS); sh.setFrozenRows(1); }
  return sh;
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
const str_ = (v, max) => String(v == null ? "" : v).slice(0, max);
// =, +, -, @로 시작하는 글은 시트가 수식으로 읽지 않게 글자로 넣습니다.
const text_ = (v) => (/^[=+\-@]/.test(v) ? "'" + v : v);
const num_ = (v) => Math.max(0, Math.min(1e6, Number(v) || 0));

// 들어온 값을 알려진 칸만, 정해진 길이까지만 남깁니다.
function clean_(d) {
  const ids = (a) => (Array.isArray(a) ? a.slice(0, 120).map((x) => str_(x, 40)) : []);
  const s = d.saju && typeof d.saju === "object" ? d.saju : null;
  return {
    v: 1,
    name: str_(d.name, 40), phone: str_(d.phone, 20), email: str_(d.email, 80),
    subject: SUBJECTS[d.subject] ? d.subject : "math",
    level: LEVELS[d.level] ? d.level : "middle",
    budget: num_(d.budget), rent: d.rent === "" || d.rent == null ? "" : num_(d.rent),
    big: num_(d.big), small: num_(d.small), own: num_(d.own), tutor: num_(d.tutor),
    record: d.record === true, towns: d.towns === true,
    regions: ids(d.regions), provinces: ids(d.provinces),
    saju: s ? { birth: str_(s.birth, 10), btime: str_(s.btime, 5), cal: s.cal === "음력" ? "음력" : "양력", gender: s.gender === "여성" ? "여성" : "남성" } : null,
    memo: str_(d.memo, 1000),
  };
}

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: "형식 오류" }); }
  if (d.action) return watchPost_(d);
  if (d.website) return json_({ ok: true }); // 자동 입력(스팸)은 받은 척하고 버립니다.
  const c = clean_(d);
  if (!c.name || c.phone.replace(/\D/g, "").length < 9) return json_({ ok: false, error: "이름과 휴대폰 번호가 필요합니다" });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = sheet_();
    const id = Utilities.getUuid().slice(0, 8);
    const area = [...c.provinces.map((p) => p + " 전체"), ...c.regions.filter((r) => !c.provinces.some((p) => r.startsWith(p.slice(0, 2)))).map((r) => r.replace("-", " "))].join(", ") || "서울·경기·인천 전체";
    const saju = c.saju ? `${c.saju.birth} ${c.saju.btime || "시간 모름"} ${c.saju.cal} ${c.saju.gender}` : "";
    sh.appendRow([id, new Date(), text_(c.name), "'" + c.phone, text_(c.email), SUBJECTS[c.subject], LEVELS[c.level], c.budget, c.rent,
      c.big, c.small, c.own, c.tutor, c.record ? "있음" : "", c.towns ? "예" : "", area, saju, text_(c.memo), "", JSON.stringify(c)]);
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true });
}

const keyOk_ = (key) => READ_KEY.length >= 12 && READ_KEY.indexOf("여기에") !== 0 && key === READ_KEY;

function doGet(e) {
  const key = (e && e.parameter && e.parameter.key) || "";
  if (!keyOk_(key)) return json_({ ok: false, error: "비밀번호가 맞지 않습니다" });
  if (e.parameter.what === "watch") return json_({ ok: true, towns: watchTowns_(), state: watchState_() });
  if (e.parameter.what === "alerts") return json_({ ok: true, items: recentAlerts_() });
  const rows = sheet_().getDataRange().getValues().slice(1);
  const items = rows.map((r) => {
    let data = {};
    try { data = JSON.parse(r[HEADERS.length - 1]); } catch (err) { /* 손으로 고친 줄은 건너뜁니다 */ return null; }
    return { id: String(r[0]), receivedAt: r[1] instanceof Date ? r[1].toISOString() : String(r[1]), note: String(r[HEADERS.length - 2] || ""), data };
  }).filter(Boolean).reverse();
  return json_({ ok: true, items });
}

// ---- 동네 알림 ----
// 알림지역: 지역(예: 서울-노원구) | 동(예: 중계동) | 넣은 날. 시트에서 직접 줄을 더하거나 지워도 됩니다.
// 알림: 받은 날 | 지역 | 동 | 종류 | 내용 | 링크. 최근 것이 맨 아래입니다.
// 알림상태: 동마다 지난번에 본 학원 목록(새로 생기거나 없어진 학원을 가리려고). 손대지 않습니다.
const WATCH_SHEET = "알림지역";
const ALERT_SHEET = "알림";
const STATE_SHEET = "알림상태";
const WATCH_HEADERS = ["지역", "동", "넣은 날"];
const ALERT_HEADERS = ["받은 날", "지역", "동", "종류", "내용", "링크"];

function tab_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) { sh.appendRow(headers); sh.setFrozenRows(1); }
  return sh;
}
const rows_ = (sh) => (sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues());

function watchTowns_() {
  const seen = {};
  return rows_(tab_(WATCH_SHEET, WATCH_HEADERS))
    .map((r) => ({ region: String(r[0]).trim(), town: String(r[1]).trim() }))
    .filter((t) => /^[가-힣]+-[가-힣]+$/.test(t.region) && t.town && !seen[t.region + "|" + t.town] && (seen[t.region + "|" + t.town] = true));
}
// 칸 하나에 5만 글자까지만 들어가서, 학원이 많은 동은 목록을 옆 칸으로 나눠 적습니다.
const STATE_CHUNK = 45000;
function watchState_() {
  const state = {};
  rows_(tab_(STATE_SHEET, ["동", "지난번 목록"])).forEach((r) => {
    try { state[String(r[0])] = JSON.parse(r.slice(1).map((c) => String(c).replace(/^~/, "")).join("")); } catch (err) { /* 깨진 줄은 처음부터 다시 셉니다 */ }
  });
  return state;
}
function recentAlerts_() {
  return rows_(tab_(ALERT_SHEET, ALERT_HEADERS)).slice(-100).reverse().map((r) => ({
    at: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
    region: String(r[1]), town: String(r[2]), kind: String(r[3]), text: String(r[4]), link: String(r[5]),
  }));
}

function watchPost_(d) {
  if (!keyOk_(String(d.key || ""))) return json_({ ok: false, error: "비밀번호가 맞지 않습니다" });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (d.action === "watch") return json_(saveTowns_(d.towns));
    if (d.action === "report") return json_(saveReport_(d));
    return json_({ ok: false, error: "모르는 요청" });
  } finally {
    lock.releaseLock();
  }
}

// 가이드에서 고른 동네 목록으로 '알림지역' 탭을 바꿉니다. 원래 있던 동은 넣은 날을 그대로 둡니다.
function saveTowns_(towns) {
  const sh = tab_(WATCH_SHEET, WATCH_HEADERS);
  const before = {};
  rows_(sh).forEach((r) => { before[r[0] + "|" + r[1]] = r[2]; });
  const list = (Array.isArray(towns) ? towns : []).slice(0, 60)
    .map((t) => [str_(t && t.region, 30), str_(t && t.town, 20)])
    .filter(([region, town]) => /^[가-힣]+-[가-힣]+$/.test(region) && /^[가-힣0-9·.]+$/.test(town));
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  if (list.length) sh.getRange(2, 1, list.length, 3).setValues(list.map(([r, t]) => [r, t, before[r + "|" + t] || new Date()]));
  return { ok: true, count: list.length };
}

// 매일 아침 자동 작업이 보낸 새 소식을 '알림' 탭에 붙이고, 학원 목록을 '알림상태' 탭에 저장합니다.
function saveReport_(d) {
  const items = (Array.isArray(d.items) ? d.items : []).slice(0, 300).map((it) => ({
    region: str_(it.region, 30), town: str_(it.town, 20), kind: str_(it.kind, 20), text: str_(it.text, 500),
    link: /^https:\/\//.test(String(it.link || "")) ? str_(it.link, 500) : "",
  }));
  if (d.state && typeof d.state === "object") {
    const sh = tab_(STATE_SHEET, ["동", "지난번 목록"]);
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
    const rows = Object.keys(d.state).slice(0, 200).map((k) => {
      const text = JSON.stringify(d.state[k]);
      const parts = [];
      for (let i = 0; i < text.length && parts.length < 40; i += STATE_CHUNK) parts.push("~" + text.slice(i, i + STATE_CHUNK)); // ~를 앞에 붙여 시트가 수식이나 숫자로 바꾸지 않게 합니다.
      return [str_(k, 60), ...parts];
    });
    const width = Math.max(2, ...rows.map((r) => r.length));
    if (rows.length) sh.getRange(2, 1, rows.length, width).setValues(rows.map((r) => r.concat(Array(width - r.length).fill(""))));
  }
  if (!items.length) return { ok: true, sent: 0 };
  const now = new Date();
  const log = tab_(ALERT_SHEET, ALERT_HEADERS);
  log.getRange(log.getLastRow() + 1, 1, items.length, 6).setValues(items.map((it) => [now, it.region, it.town, it.kind, text_(it.text), it.link]));
  return { ok: true, sent: items.length };
}
