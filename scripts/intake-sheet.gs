// 개원 상담 신청을 구글 시트에 쌓는 Google Apps Script입니다. 설정 방법은 README의 '개원 상담 신청 사이트'를 보세요.
// - 상담 신청 사이트(intake.html)가 보낸 신청을 시트에 한 줄씩 붙입니다(doPost).
// - 학원 입지 가이드가 아래 READ_KEY를 붙여 부르면 쌓인 신청을 돌려줍니다(doGet). 키가 틀리면 아무것도 주지 않습니다.

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

function doGet(e) {
  const key = (e && e.parameter && e.parameter.key) || "";
  if (READ_KEY.length < 12 || READ_KEY.indexOf("여기에") === 0 || key !== READ_KEY) return json_({ ok: false, error: "비밀번호가 맞지 않습니다" });
  const rows = sheet_().getDataRange().getValues().slice(1);
  const items = rows.map((r) => {
    let data = {};
    try { data = JSON.parse(r[HEADERS.length - 1]); } catch (err) { /* 손으로 고친 줄은 건너뜁니다 */ return null; }
    return { id: String(r[0]), receivedAt: r[1] instanceof Date ? r[1].toISOString() : String(r[1]), note: String(r[HEADERS.length - 2] || ""), data };
  }).filter(Boolean).reverse();
  return json_({ ok: true, items });
}
