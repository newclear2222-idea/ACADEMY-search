const SUBJECT_LABELS = { math: "수학 학원", english: "영어 학원", korean: "국어·논술 학원", science: "과학 학원", all: "입시·보습 학원" };
const LEVEL_LABELS = { total: "초·중·고 학생", elem: "초등학생", middle: "중학생", high: "고등학생" };

const els = {
  province: document.getElementById("province"),
  region: document.getElementById("region"),
  subject: document.getElementById("subject"),
  level: document.getElementById("level"),
  empty: document.getElementById("empty"),
  result: document.getElementById("result"),
  summary: document.getElementById("summary"),
  ranking: document.getElementById("ranking"),
  dongBody: document.querySelector("#dong-table tbody"),
  sources: document.getElementById("sources"),
  compareHead: document.querySelector("#compare thead"),
  compareBody: document.querySelector("#compare tbody"),
};

let current = null;
let sortKey = "ratio";

const cache = {};
const fmt = (n) => n.toLocaleString("ko-KR");

async function fetchJson(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function loadRegion(id) {
  if (!cache[id]) cache[id] = await fetchJson(`data/${encodeURIComponent(id)}.json`);
  return cache[id];
}

const LEVEL_NAMES = { elem: "초등학생", middle: "중학생", high: "고등학생" };
const pct = (x) => `${Math.round(x * 100)}%`;
const won = (n) => `${fmt(Math.round(n / 1000) / 10)}만원`;
const bigWon = (n) => (n >= 1e8 ? `${fmt(Math.round(n / 1e7) / 10)}억원` : `${fmt(Math.round(n / 1e4))}만원`);

function feeOf(fees, subject, level) {
  const cell = fees && fees[subject] && fees[subject][level];
  return cell && cell[0] ? { median: cell[0], count: cell[1] } : null;
}

// 신도시·택지지구 이름. 동은 주소의 법정동이라 '위례', '동탄2'처럼 흔히 부르는 이름을 옆에 붙입니다.
// '일부'는 그 법정동의 일부만 신도시에 들어간다는 뜻입니다.
const NEW_TOWNS = {
  "서울-송파구": {"장지동": "위례", "거여동": "위례 일부"},
  "서울-강서구": {"마곡동": "마곡"},
  "서울-은평구": {"진관동": "은평뉴타운"},
  "서울-강동구": {"강일동": "강일지구", "고덕동": "고덕지구"},
  "경기-성남시": {"창곡동": "위례", "판교동": "판교", "삼평동": "판교", "백현동": "판교"},
  "경기-하남시": {"학암동": "위례", "망월동": "미사", "풍산동": "미사", "선동": "미사", "감일동": "감일"},
  "경기-화성시": {"반송동": "동탄1", "석우동": "동탄1", "능동": "동탄1", "영천동": "동탄2", "청계동": "동탄2", "오산동": "동탄2", "산척동": "동탄2", "목동": "동탄2", "송동": "동탄2", "장지동": "동탄2", "신동": "동탄2"},
  "경기-수원시": {"이의동": "광교", "하동": "광교", "원천동": "광교 일부", "호매실동": "호매실", "금곡동": "호매실"},
  "경기-용인시": {"상현동": "광교 일부"},
  "경기-남양주시": {"다산동": "다산", "별내동": "별내"},
  "경기-고양시": {"삼송동": "삼송", "지축동": "지축", "원흥동": "원흥", "향동동": "향동", "덕은동": "덕은"},
  "경기-김포시": {"장기동": "한강신도시", "운양동": "한강신도시", "구래동": "한강신도시", "마산동": "한강신도시"},
  "경기-파주시": {"목동동": "운정", "야당동": "운정", "와동동": "운정", "동패동": "운정", "다율동": "운정"},
  "경기-평택시": {"고덕동": "고덕국제"},
  "경기-양주시": {"옥정동": "옥정"},
  "경기-시흥시": {"배곧동": "배곧", "장현동": "장현"},
  "경기-의정부시": {"민락동": "민락", "고산동": "고산"},
  "경기-과천시": {"갈현동": "과천지식정보타운"},
  "인천-연수구": {"송도동": "송도"},
  "인천-서해구": {"청라동": "청라"},
  "인천-검단구": {"원당동": "검단", "당하동": "검단", "불로동": "검단", "마전동": "검단 일부"},
  "인천-영종구": {"중산동": "영종하늘도시", "운남동": "영종하늘도시", "운서동": "영종"},
};
const newTown = (regionId, name) => NEW_TOWNS[regionId]?.[name] || "";
const townTag = (regionId, name) => { const t = newTown(regionId, name); return t ? ` <span class="town">${t}</span>` : ""; };

// "강남구"처럼 시·도를 뺀 지역 이름.
const shortRegion = (region) => (region || "").split(" ").slice(-1)[0] || "이 지역";
// "고등학생 수학 등록 수강료"처럼 어떤 수강료인지 밝힌 이름.
const feeName = (subject, level) => `${level === "total" ? "" : `${LEVEL_LABELS[level]} `}${subject === "all" ? "전 과목" : SUBJECT_SHORT[subject]} 등록 수강료`;

// 숫자에서 읽을 수 있는 이유만 적습니다. 현장 조사나 설문이 아닙니다.
function reasonsFor(r, ctx) {
  const { subject, level } = ctx;
  const label = SUBJECT_LABELS[subject];
  const R = ctx.regionName;
  const reasons = [];
  // 매출로 본 흐름. 학원 수로 본 추측과 엇갈리면 매출 쪽을 따릅니다.
  const flow = !boundaryMismatch(r.area) && localUse(r.area, subject, level);
  const kind = flow ? flowKind(flow.use) : null;
  const shareS = ctx.totalStudents ? r.students / ctx.totalStudents : 0;
  const shareA = ctx.totalAcademies ? r.academies / ctx.totalAcademies : 0;

  if (r.students === 0) {
    reasons.push(r.area.students.total && level !== "total"
      ? `이 동에는 ${LEVEL_LABELS[level]}이 다니는 학교가 없어 ${LEVEL_LABELS[level]} 수가 0으로 잡힙니다. 동네 ${LEVEL_LABELS[level]}은 주변 동 학교에 다니므로, 이 동 학원의 ${LEVEL_LABELS[level]} 수요는 그 학교 위치에 달려 있습니다.`
      : "이 동에는 학교가 없어 학생 수가 0으로 잡힙니다. 학원이 있다면 주변 동 학생들이 찾아오는 곳입니다.");
  } else if (r.academies === 0) {
    reasons.push(`등록된 ${label}이 없습니다. 아직 비어 있는 시장일 수도, 수요가 작아 아무도 들어오지 않은 곳일 수도 있어 현장 확인이 필요합니다.`);
  } else if (shareA >= 0.15 && shareA >= shareS * 1.5 && kind !== "out" && kind !== "someOut") {
    reasons.push(`${R} ${label}의 ${pct(shareA)}가 이 동에 몰린 학원가입니다 (${LEVEL_LABELS[level]}은 ${R}의 ${pct(shareS)}). 다른 동 학생도 찾아와서 실제 경쟁은 숫자보다 덜할 수 있지만, 새 학원이 눈에 띄기는 어렵습니다.`);
  } else if (shareA >= shareS * 1.3) {
    reasons.push(`${R} ${label} 가운데 이 동 비중(${pct(shareA)})이 ${LEVEL_LABELS[level]} 비중(${pct(shareS)})보다 높습니다.`);
  } else if (shareS >= shareA * 1.3) {
    const tail = kind === "in" || kind === "local"
      ? "다만 아래 매출을 보면 학원 수에 비해 매출이 커서, 있는 학원들이 규모 있게 운영되는 곳으로 보입니다."
      : kind
        ? "아래 매출을 보면 실제로 많은 학생이 다른 동 학원에 다니는 것으로 보입니다."
        : `학생들이 근처 학원가로 다니고 있을 수 있습니다${r.area.nearby ? "(아래 근처 학원가 참고)" : ""}.`;
    reasons.push(`${LEVEL_LABELS[level]}은 ${R}의 ${pct(shareS)}인데 ${label}은 ${R}의 ${pct(shareA)}뿐입니다. ${tail}`);
  }

  if (r.students > 0 && level === "total") {
    const st = r.area.students;
    const top = ["elem", "middle", "high"].sort((a, b) => st[b] - st[a])[0];
    if (st[top] / st.total >= 0.45) reasons.push(`학생 중 ${LEVEL_NAMES[top]}이 ${pct(st[top] / st.total)}로 가장 많습니다.`);
    if (!r.area.schools.some((sc) => sc.level === "high")) reasons.push("이 동에는 고등학교가 없어 고등부 수요는 다른 동으로 빠질 수 있습니다.");
  }
  if (r.students > 0 && r.area.schools.length === 1) {
    reasons.push("학교가 1곳뿐이라 숫자가 그 학교 하나에 크게 좌우됩니다.");
  }

  const sales = salesReason(r.area, ctx);
  if (sales) reasons.push(sales);
  if (r.area.nearby) reasons.push(hubText(r.area, subject, ctx.regionId));

  const change = level === "total" && riskOf(r.area, ctx.data) ? null : studentChange(r.area, level); // 전체 학생 증감은 아래 학원·학생 문장에 함께 적습니다.
  if (change !== null && change >= 0.1) reasons.push(`학생 수가 ${ctx.pastYear}년보다 ${signedPct(change)} 늘었습니다. 수요가 커지는 동네입니다.`);
  if (change !== null && change <= -0.1) reasons.push(`학생 수가 ${ctx.pastYear}년보다 ${signedPct(change)} 줄었습니다. 지금 숫자보다 앞으로 수요가 작아질 수 있습니다.`);
  const opened = r.area.opened?.["1y"][subject] || 0;
  let risk = riskReason(r.area, ctx.data);
  // '경쟁 낮음'(지금 학원 1곳당 학생이 많음)과 위험·주의(앞으로 줄어듦)가 함께 붙는 동은 둘의 관계를 적습니다.
  const rk = risk && riskOf(r.area, ctx.data);
  if (rk && (rk.risky || rk.caution) && Number.isFinite(r.ratio) && r.ratio >= ctx.average * 1.2) {
    risk += ` 지금은 학원 1곳당 학생이 ${ctx.regionName} 평균보다 많아 '경쟁 낮음'으로 나오지만, 이 속도면 그 여유가 해마다 줄어듭니다.`;
  }
  if (risk) reasons.push(risk);
  else if (r.academies >= 5 && opened / r.academies >= 0.2) reasons.push(`지금 ${label} ${fmt(r.academies)}곳 중 ${fmt(opened)}곳이 최근 1년 안에 문을 열었습니다. 새로 들어오는 학원이 많습니다(문 닫은 학원 수는 이 동 자료가 없습니다).`);
  const bigApts = freshApts(r.area).filter((x) => x.households >= 500 && x.moveIn >= thisMonth());
  if (bigApts.length) reasons.push(`${bigApts.map((x) => `${x.name}(${fmt(x.households)}세대)`).join(", ")} 입주가 예정돼 있어 학생이 늘 수 있습니다.`);

  const areaFee = feeOf(r.area.fees, subject, level);
  // 과정이 2개 이하이거나 월 100만원이 넘는 중간값(여러 달 묶음, 유아 과정 등)은 견주지 않습니다.
  if (areaFee && ctx.regionFee && areaFee.count >= 3 && areaFee.median <= MAX_FEE) {
    const diff = areaFee.median / ctx.regionFee.median - 1;
    if (Math.abs(diff) >= 0.1) {
      reasons.push(`이 동의 ${feeName(subject, level)}(${won(areaFee.median)})는 ${R} 전체 중간값(${won(ctx.regionFee.median)})보다 ${pct(Math.abs(diff))} ${diff > 0 ? "높습니다" : "낮습니다"}.`);
    }
  }
  return reasons;
}

// 2025년 초중고사교육비조사 과목별 사교육 참여율(%). 국어는 국어, 과학은 사회·과학 값입니다.
const PARTICIPATION = {
  total: { korean: 20.9, english: 46.8, math: 47.4, science: 11.2 },
  elem: { korean: 20.3, english: 46.8, math: 44.8, science: 8.9 },
  middle: { korean: 17.6, english: 54.4, math: 56.8, science: 13.1 },
  high: { korean: 25.5, english: 38.6, math: 42.2, science: 13.3 },
};

const SUBJECT_KEYS = ["korean", "english", "math", "science"];

// 2025년 초중고사교육비조사 표8, 참여학생 1인당 월평균 사교육비(만원). 학년별 수강료 자료가 없을 때 보정에 씁니다.
const PARTICIPANT_SPEND = {
  all: { total: 59.5, elem: 45.4, middle: 64.6, high: 81.7 },
  korean: { total: 18.5, elem: 11.0, middle: 18.9, high: 29.1 },
  english: { total: 28.1, elem: 25.1, middle: 29.1, high: 33.0 },
  math: { total: 27.0, elem: 18.7, middle: 29.8, high: 39.0 },
  science: { total: 16.6, elem: 8.9, middle: 15.9, high: 26.8 },
};
const MAX_FEE = 1000000; // 월 100만원이 넘는 중간값은 여러 달 묶음이나 유아 과정이 섞인 것으로 보고 쓰지 않습니다.

// 고른 과목·학년의 수강료. 학년 차이가 커서(초등 수학 18만원, 고등 수학 40만원) 학년을 먼저 맞춥니다.
//   1) 이 동 그 과목·학년(과정 3개 이상) → 2) 구·시 전체 그 과목·학년(3개 이상)
//   3) 학년 구분 없는 그 과목 수강료(이 동 5개 이상, 아니면 구·시) × 전국 학년별 비율로 보정
let regionFees = null;
function subjectFee(area, subject, level) {
  const ok = (fee, min) => fee && fee.count >= min && fee.median <= MAX_FEE;
  for (const [fees, where] of [[area.fees, "dong"], [regionFees, "region"]]) {
    const fee = feeOf(fees, subject, level);
    if (ok(fee, 3)) return { ...fee, where, subject, level };
  }
  for (const [fees, where, min] of [[area.fees, "dong", 5], [regionFees, "region", 1]]) {
    const fee = feeOf(fees, subject, "total");
    if (!ok(fee, min)) continue;
    const spend = PARTICIPANT_SPEND[subject];
    const factor = level === "total" ? 1 : spend[level] / spend.total;
    return { median: Math.round(fee.median * factor / 1000) * 1000, count: fee.count, where, subject, level, base: fee.median, factor };
  }
  // 4) 그 과목 수강료 자료가 아예 없으면(예: 과학 학원이 거의 없는 구) 구·시 전 과목 수강료 × 전국 과목·학년 비율
  const all = feeOf(regionFees, "all", "total");
  if (!ok(all, 1)) return null;
  const factor = PARTICIPANT_SPEND[subject][level] / PARTICIPANT_SPEND.all.total;
  return { median: Math.round(all.median * factor / 1000) * 1000, count: all.count, where: "region", subject, level, base: all.median, factor, baseSubject: "all" };
}
// "강서구 전체 고등학생 수학 등록 수강료 중간값 39만원"처럼 어떤 수강료를 썼는지 밝힙니다.
const feeSource = (fee, regionName) => {
  const where = fee.where === "region" ? `${regionName} 전체` : "이 동";
  if (!fee.factor || fee.factor === 1) return `${where} ${feeName(fee.subject, fee.level)} 중간값 ${won(fee.median)}`;
  if (fee.baseSubject) return `${SUBJECT_SHORT[fee.subject]} 수강료 자료가 없어 ${where} ${feeName("all", "total")} 중간값 ${won(fee.base)}에 전국 사교육비의 과목·학년 비율(×${fee.factor.toFixed(2)})을 곱한 ${won(fee.median)}`;
  return `${where} ${feeName(fee.subject, "total")} 중간값 ${won(fee.base)}에 학년별 자료가 부족해 전국 ${LEVEL_LABELS[fee.level]} 비율(×${fee.factor.toFixed(2)})을 곱한 ${won(fee.median)}`;
};

// 근처 학원가. 원장 기준대로 두 가지를 따로 보여줍니다.
//   ① 가까운 학원 밀집 동: 동 중심 사이 4km 안에서 그 과목 학원이 20곳 이상이고 이 동의 1.5배 이상인 동,
//      끌어당기는 힘(학원 수 ÷ 거리², 1km 미만은 1km로) 큰 순으로 최대 2곳. 없으면 0~1곳.
//   ② 이 일대 최대 학원가: 입시·보습 학원 250곳 이상인 대형 학원가(대치동, 목동, 중계동, 평촌 등) 중
//      가장 가까운 곳(8km 안). ①과 겹치면 ①에서 빼고 ②로만 보여줍니다. 이 동이 대형 학원가면 생략합니다.
// 매출로 '다른 동 학생이 찾아오는 곳'이 확인되면(서울, 학생 1명당 매출이 이 동 기대치의 1.3배 이상) 함께 적습니다.
const HUB_KM = 4;
const BIG_HUB = 250;
const BIG_HUB_KM = 8;
function hubDraws(n, area) {
  if (!n.sales || n.students < 500 || !regionSalesPerAcademy) return false;
  const perAcademy = n.sales / 3 / Math.max(n.academies.all, 1) / regionSalesPerAcademy;
  if (perAcademy > 3 || perAcademy < 0.25) return false; // 매출 구역이 어긋난 동은 판단하지 않습니다.
  const own = localUse(area, "all", "total");
  return Boolean(own) && n.sales / 3 / n.students >= own.expected * FLOW_IN;
}
function nearbyHubs(area, subject) {
  const nearby = area.nearby || [];
  const big = area.academies.all >= BIG_HUB ? null
    : nearby.find((n) => n.academies.all >= BIG_HUB && n.km <= BIG_HUB_KM) || null;
  const own = area.academies[subject] || 0;
  const pull = (n) => (n.academies[subject] || 0) / Math.max(n.km, 1) ** 2;
  const near = nearby
    .filter((n) => n !== big && n.km <= HUB_KM && (n.academies[subject] || 0) >= Math.max(20, own * 1.5))
    .sort((a, b) => pull(b) - pull(a))
    .slice(0, 2);
  return { near, big };
}
function hubText(area, subject, regionId) {
  const { near, big } = nearbyHubs(area, subject);
  const label = SUBJECT_LABELS[subject];
  const show = (n) => `${n.region === regionId ? "" : `${n.region.split("-").slice(1).join("-")} `}${n.name}${newTown(n.region, n.name) ? `·${newTown(n.region, n.name)}` : ""}(약 ${n.km}km, ${label} ${fmt(n.academies[subject] || 0)}곳${hubDraws(n, area) ? ", 매출로 다른 동 학생이 찾아오는 곳" : ""})`;
  const parts = [];
  parts.push(near.length
    ? `4km 안의 가까운 학원 밀집 동은 ${near.map(show).join(", ")}입니다.`
    : `4km 안에는 이 동보다 ${label}이 크게 많은 동이 없습니다.`);
  if (big) parts.push(`이 일대 최대 학원가는 ${show(big)}입니다.`);
  else if (area.academies.all >= BIG_HUB) parts.push(`이 동 자체가 입시·보습 학원 ${fmt(area.academies.all)}곳이 모인 대형 학원가입니다.`);
  return `근처 학원가: ${parts.join(" ")}`;
}

// 동네 학원 이용도(추정).
//   학생 1명당 추정 매출 ÷ 수강료 = 이 동 학원에 등록한 학생 비율(대략)
//   이것을 전국 사교육 참여율(예: 중학생 수학 56.8%)과 견줍니다.
//   1배면 다니는 만큼 동네에서 다니고, 0.3배면 대부분 다른 동으로, 3배면 다른 동 학생이 찾아오는 곳입니다.
// 전 과목은 과목마다 (수강료 × 참여율)을 더한 값과 견줍니다. 학년에 학교가 없으면 초·중·고 전체로 봅니다.
function localUse(area, subject, level) {
  if (!area.sales || !area.students.total) return null;
  const lv = level !== "total" && !area.students[level] ? "total" : level;
  const v = perStudent(area, subject, lv);
  if (!v) return null;
  const parts = [];
  for (const sj of subject === "all" ? SUBJECT_KEYS : [subject]) {
    const fee = subjectFee(area, sj, lv);
    if (!fee) return null;
    parts.push({ subject: sj, fee, join: PARTICIPATION[lv][sj], value: fee.median * PARTICIPATION[lv][sj] / 100 });
  }
  const expected = parts.reduce((t, x) => t + x.value, 0);
  return { v, level: lv, parts, expected, use: v / expected };
}

const FLOW_OUT = 0.5;
const FLOW_IN = 1.3;
function flowKind(raw) {
  const use = Math.round(raw * 100) / 100; // 화면에 보이는 %와 같은 기준으로 나눕니다.
  if (use <= FLOW_OUT) return "out";
  if (use <= 0.8) return "someOut";
  if (use < FLOW_IN) return "local";
  return "in";
}

function salesReason(area, ctx) {
  const { subject, level } = ctx;
  if (!ctx.salesPeriod) return "";
  if (!area.sales) return "이 동은 서울시 상권분석 매출 집계에 학원 매출이 잡히지 않아 매출로는 판단할 수 없습니다.";
  if (!area.students.total) return `이 동에는 학교가 없어 학생 1명당으로는 볼 수 없습니다. 그런데도 학원 매출이 분기 ${bigWon(area.sales)}이라, 이 매출은 모두 다른 동 학생이 쓰는 돈입니다.`;
  if (boundaryMismatch(area)) {
    const perAcademy = area.sales / 3 / Math.max(area.academies.all, 1);
    return `이 동은 매출로 학생 흐름을 판단하지 않았습니다. 서울시 매출은 행정동, 학원·학교 수는 주소의 법정동 기준이라 경계가 어긋나는데, 이 동은 그 차이가 큽니다(등록 학원 ${fmt(area.academies.all)}곳에 월 매출 ${bigWon(area.sales / 3)}, 학원 1곳당 ${bigWon(perAcademy)}으로 ${ctx.regionName} 평균 ${bigWon(regionSalesPerAcademy)}의 ${pct(perAcademy / regionSalesPerAcademy)}). 학생 수와 학원 수 근거로 판단해 주세요.`;
  }
  const f = localUse(area, subject, level);
  if (!f) return "";
  const who = f.level === "total" ? "학생" : LEVEL_LABELS[f.level];
  const pre = f.level !== level ? `이 동에는 ${LEVEL_LABELS[level]}이 다니는 학교가 없어 초·중·고 전체로 봤습니다. ` : "";
  const amount = subject === "all"
    ? `${who} 1명당 학원 카드매출(전 과목 합계)은 월 ${won(Math.round(f.v))}입니다.`
    : `${who} 1명당 ${SUBJECT_SHORT[subject]} 학원 매출(추정)은 월 ${won(Math.round(f.v))}입니다.`;
  // 기대치 = 수강료 × 전국 참여율. 동네 학생이 사교육을 모두 이 동 학원에서 받으면 나올 1명당 매출입니다.
  const formula = f.parts.map((x) => `${SUBJECT_SHORT[x.subject]} ${won(x.fee.median)} × ${x.join}%`).join(" + ");
  const sources = [...new Set(f.parts.map((x) => feeSource(x.fee, ctx.regionName)))];
  const basis = `${amount} 동네 학생이 모두 이 동 학원에 다닌다면 기대되는 값은 수강료 × 전국 ${who} 참여율 = ${formula} = 월 ${won(Math.round(f.expected))}입니다(수강료: ${sources.join(", ")}).`;
  const read = {
    out: `실제는 그 기대치의 ${pct(f.use)}뿐이라, 이 동 학생 대부분이 다른 동 학원에 다니는 것으로 보입니다${area.nearby ? "(아래 근처 학원가 참고)" : ""}. 새 학원은 가까운 거리를 내세워 이 학생들을 붙잡을 여지가 있습니다.`,
    someOut: `실제는 그 기대치의 ${pct(f.use)}라, 일부 학생이 다른 동 학원으로 나가는 것으로 보입니다${area.nearby ? "(아래 근처 학원가 참고)" : ""}.`,
    local: `실제는 그 기대치의 ${pct(f.use)}로, 대체로 동네 학생이 동네 학원에 다니는 곳입니다.`,
    in: `실제는 그 기대치의 ${pct(f.use)}라, 다른 동 학생들이 이 동 학원으로 찾아오는 곳입니다. 수요는 크지만 이름난 학원들과 경쟁해야 합니다.`,
  }[flowKind(f.use)];
  const small = smallSales(area) ? ` 다만 이 동은 ${area.academies.all < MIN_ACADEMIES_FOR_SALES ? `학원이 ${fmt(area.academies.all)}곳` : `학생이 ${fmt(area.students.total)}명`}뿐이라 매출 집계 구역과 경계가 조금만 어긋나도 숫자가 크게 흔들립니다. 참고로만 보세요.` : "";
  return `${pre}${basis} ${read} (카드 결제만 잡힌 매출이라 실제보다 조금 낮게 나옵니다.)${small}`;
}

// 학생 수 변화율 (몇 년 전 공시 대비). 그때 자료가 없으면 null.
function studentChange(area, level) {
  const before = area.studentsPast?.[level];
  return before ? area.students[level] / before - 1 : null;
}

const signedPct = (x) => `${x >= 0 ? "+" : "−"}${Math.round(Math.abs(x) * 100)}%`;

function trendText(area, data, subject, level) {
  const lines = [];
  const change = studentChange(area, level);
  if (change !== null) lines.push(`학생 수 ${data.pastYear}년보다 <strong>${signedPct(change)}</strong>`);
  const o = area.opened;
  if (o) lines.push(`최근 1년 새로 연 ${SUBJECT_LABELS[subject]} <strong>${fmt(o["1y"][subject])}곳</strong> (3년 ${fmt(o["3y"][subject])}곳)`);
  let html = lines.length ? `<div class="rank-sub">${lines.join(" · ")}</div>` : "";
  const apts = freshApts(area);
  if (apts.length) {
    const items = apts.slice(0, 4).map((x) => `${x.name} ${fmt(x.households)}세대 (${x.moveIn.replace("-", "년 ")}월 입주${x.moveIn < thisMonth() ? "" : " 예정"})`);
    html += `<div class="rank-sub">새 아파트: ${items.join(", ")}${apts.length > 4 ? ` 외 ${apts.length - 4}곳` : ""}</div>`;
  }
  return html;
}

// ── 위험지역: 학원은 느는데 학생은 줄어드는 동 ──
// 학원 순증가율(1년, 입시·보습 전체). 쓸 수 있는 자료 중 가장 정확한 것을 씁니다.
//   1순위 교육청 등록 학원 수를 달마다 쌓아 본 실제 변화(6개월 이상 쌓인 뒤부터)
//   2순위 서울시 상권분석 개업 점포 − 폐업 점포 (서울, 최근 4분기)
//   3순위 교육청 '최근 1년 새로 연 학원' − 서울 학원 평균 폐업률 (경기·인천은 폐업 자료가 없어 빌려 씁니다)
// 학원 순증가율 − 학생 증감률(1년)이 8%p 이상이면 위험지역, 4%p 이상이면 주의.
// 서울·경기·인천 동의 가운데값이 약 +4%p(학생은 해마다 3%쯤 줄고 학원은 그대로)라, 그보다 확실히 나쁜 곳만 빨갛게 칠합니다.
const RISK_GAP = 0.08;
const CAUTION_GAP = 0.04;
const RISK_MIN_ACADEMIES = 20;
const RISK_MIN_STUDENTS = 500;
function academyGrowth(area, data) {
  const h = area.historyChange;
  if (h && h.before >= RISK_MIN_ACADEMIES) {
    return { rate: (h.change / h.before) * (12 / h.months), source: "history", ...h };
  }
  const s = area.storeFlow;
  if (s && s.base >= RISK_MIN_ACADEMIES) {
    return { rate: (s.open - s.close) / s.base, source: "store", open: s.open, close: s.close, base: s.base, period: data.storePeriod };
  }
  const c = data.seoulStoreRate?.close;
  const all = area.academies.all;
  if (c != null && all >= RISK_MIN_ACADEMIES && area.opened) {
    const open = area.opened["1y"].all;
    return { rate: open / all - c, source: "estimate", open, close: c * all, base: all, closeRate: c };
  }
  return null;
}
const signedN = (n) => `${n >= 0 ? "+" : "−"}${fmt(Math.abs(Math.round(n)))}`;
// 학원 순증가를 계산 과정까지 한 줄로 적습니다. 추정이면 [추정]을 붙입니다.
function growthLine(g, data) {
  if (g.source === "history") {
    return `학원 ${g.from.replace("-", "년 ")}월 ${fmt(g.before)}곳 → 지금 ${fmt(g.before + g.change)}곳(${g.months}개월, 순증 ${signedN(g.change)}곳) = 1년으로 <strong>${pp(g.rate)}</strong> (교육청 등록 입시·보습 학원 실제 변화)`;
  }
  if (g.source === "store") {
    return `학원 최근 1년 개업 ${fmt(g.open)}곳 − 폐업 ${fmt(g.close)}곳 = 순증 ${signedN(g.open - g.close)}곳, 학원 약 ${fmt(g.base)}곳 대비 <strong>${pp(g.rate)}</strong> (서울시 상권분석 ${g.period}, 실제 집계)`;
  }
  const where = g.source === "region" ? `이 동은 학원이 ${RISK_MIN_ACADEMIES}곳 미만이라 ${shortRegion(data.region)} 전체 값: ` : "";
  if (g.closeRate != null) {
    return `${where}학원 최근 1년 새로 연 곳 ${fmt(g.open)}곳(교육청) − 폐업 추정 약 ${fmt(Math.round(g.close))}곳(${fmt(g.base)}곳 × 서울 학원 평균 폐업률 ${(Math.round(g.closeRate * 1000) / 10).toFixed(1)}%) = 순증 약 ${signedN(g.open - g.close)}곳, ${fmt(g.base)}곳 대비 <strong>${pp(g.rate)}</strong> <span class="caution-text">[추정]</span>`;
  }
  return `${where}학원 최근 1년 개업 ${fmt(g.open)}곳 − 폐업 ${fmt(g.close)}곳 = 순증 ${signedN(g.open - g.close)}곳, 약 ${fmt(g.base)}곳 대비 <strong>${pp(g.rate)}</strong> (서울시 상권분석)`;
}
function studentLine(area, level, st, data) {
  const now = area.students[level], before = area.studentsPast[level];
  const year = Number((data.baseDate || "").match(/(\d{4})년/)?.[1]);
  return `${LEVEL_LABELS[level]} ${data.pastYear}년 ${fmt(before)}명 → ${year}년 ${fmt(now)}명(${signedN(now - before)}명, ${st.years}년 ${pp(st.change)}) = 1년으로 <strong>${pp(st.rate)}</strong>`;
}
// 학생 증감률을 1년 단위로 바꿉니다. 예: 2년에 −6%면 1년 약 −3%.
function studentRate(area, level, data) {
  const change = studentChange(area, level);
  const now = Number((data.baseDate || "").match(/(\d{4})년/)?.[1]);
  const years = now && data.pastYear ? now - data.pastYear : 0;
  if (change === null || years <= 0) return null;
  return { rate: (1 + change) ** (1 / years) - 1, change, years };
}
// 곧(이번 달부터 내년 말까지) 입주하는 새 아파트가 데려올 학생을 어림해 학생 증가율에 더합니다.
// 세대당 학생 수는 신축 아파트에 흔히 쓰는 어림값이고, 교육청이 단지마다 정하는 학생 유발률과 다를 수 있습니다.
const MOVEIN_PER_HOUSEHOLD = { elem: 0.25, middle: 0.12, high: 0.1 };
MOVEIN_PER_HOUSEHOLD.total = MOVEIN_PER_HOUSEHOLD.elem + MOVEIN_PER_HOUSEHOLD.middle + MOVEIN_PER_HOUSEHOLD.high;
const MOVEIN_CAP = 0.3; // 학생이 적은 동에서 가산이 지나치게 커지지 않게 1년 +30%까지만 더합니다.
// 같은 세대를 다시 모집하는 공고(추가입주자·취소분·잔여 세대)와, 본청약이 따로 있는 사전청약은 빼서 두 번 세지 않습니다.
const REOFFER = /추가입주자|취소분|자격상실|당첨취소|잔여|무순위|보류지|재공급/;
function freshApts(area) {
  const list = (area.newApts || []).filter((x) => !REOFFER.test(x.name));
  const base = (n) => n.replace(/\((사전청약|본청약)\)/g, "").trim();
  const main = new Set(list.filter((x) => !/사전청약/.test(x.name)).map((x) => base(x.name)));
  return list.filter((x) => !/사전청약/.test(x.name) || !main.has(base(x.name)));
}
const monthIndex = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
function moveInBoost(area, level) {
  const now = thisMonth();
  const end = `${Number(now.slice(0, 4)) + 1}-12`;
  const list = freshApts(area).filter((x) => x.moveIn >= now && x.moveIn <= end);
  const students = area.students[level];
  if (!list.length || !students) return null;
  const households = list.reduce((t, x) => t + x.households, 0);
  const per = MOVEIN_PER_HOUSEHOLD[level];
  const added = households * per;
  const last = list.reduce((m, x) => (x.moveIn > m ? x.moveIn : m), now);
  const horizon = Math.max(1, (monthIndex(last) - monthIndex(now) + 1) / 12);
  const raw = added / students / horizon;
  return { list, households, per, added, students, horizon, rate: Math.min(MOVEIN_CAP, raw), capped: raw > MOVEIN_CAP, level };
}
function boostLine(b) {
  const names = b.list.slice(0, 3).map((x) => `${x.name} ${fmt(x.households)}세대(${x.moveIn.replace("-", "년 ")}월)`).join(", ") + (b.list.length > 3 ? ` 외 ${b.list.length - 3}곳` : "");
  const L = LEVEL_LABELS[b.level];
  const years = b.horizon > 1 ? `${(Math.round(b.horizon * 10) / 10).toFixed(1)}년에 걸쳐 나눠` : "1년 안에";
  return `입주 예정 가산: ${names} → 합계 ${fmt(b.households)}세대 × 세대당 ${L} ${b.per.toFixed(2)}명 = 약 ${fmt(Math.round(b.added))}명이 지금 ${L} ${fmt(b.students)}명에 더해진다고 보고, ${years} 들어오면 1년 <strong>${pp(b.rate)}</strong>${b.capped ? `(최대 ${pct(MOVEIN_CAP)}로 제한)` : ""} <span class="caution-text">[어림]</span>`;
}
const withBoost = (st, b) => st.rate + (b?.rate || 0);
const studentCalc = (st, b) => (b ? `(학생 ${pp(st.rate)} + 입주 가산 ${pp(b.rate)})` : `학생 ${pp(st.rate)}`);

function riskOf(area, data) {
  if (area.academies.all < RISK_MIN_ACADEMIES || area.students.total < RISK_MIN_STUDENTS) return null;
  const g = academyGrowth(area, data);
  const st = studentRate(area, "total", data);
  if (!g || !st) return null;
  const boost = moveInBoost(area, "total");
  const gap = g.rate - withBoost(st, boost);
  return { growth: g, students: st, boost, gap, risky: gap >= RISK_GAP, caution: gap >= CAUTION_GAP && gap < RISK_GAP };
}
const pp = (x) => `${x >= 0 ? "+" : "−"}${(Math.round(Math.abs(x) * 1000) / 10).toFixed(1)}%`;
function verdictLine(k) {
  const calc = `학원 ${pp(k.growth.rate)} − ${studentCalc(k.students, k.boost)} = <strong>${pp(k.gap)}p</strong>`;
  if (k.risky) return `차이: ${calc} → 위험 기준 ${RISK_GAP * 100}%p 이상이라 <strong class="risk-text">위험지역</strong>. 학원 1곳이 나눠 가질 학생이 해마다 줄어 매출을 유지하거나 올리기 어려워지는 곳입니다.`;
  if (k.caution) return `차이: ${calc} → 주의 기준 ${CAUTION_GAP * 100}%p 이상, 위험 기준 ${RISK_GAP * 100}%p 미만이라 <strong class="caution-text">주의</strong>. 학원 1곳당 학생이 서서히 줄어드는 곳입니다.`;
  return `차이: ${calc} → 주의 기준(${CAUTION_GAP * 100}%p)보다 작습니다. 서울·경기·인천 동의 가운데값은 약 +4%p입니다.`;
}
// 카드에 바로 보이는 근거. 위험·주의 동은 학원·학생·차이를 줄마다 나눠 보여줍니다.
function riskText(area, data) {
  const k = riskOf(area, data);
  if (!k) return "";
  const lines = [growthLine(k.growth, data), studentLine(area, "total", k.students, data), ...(k.boost ? [boostLine(k.boost)] : []), verdictLine(k)];
  const cls = k.risky ? "risk-box" : k.caution ? "risk-box caution" : "risk-box calm";
  const title = k.risky ? "위험지역 판단 근거" : k.caution ? "주의 판단 근거" : "학원·학생 증가 속도";
  return `<div class="${cls}"><div class="risk-title">${title}</div>${lines.map((t) => `<div>${t}</div>`).join("")}</div>`;
}
function riskReason(area, data) {
  const k = riskOf(area, data);
  if (!k) return "";
  const caveat = k.growth.source === "estimate" ? " 경기·인천은 폐업 자료가 없어 폐업 수를 서울 평균으로 추정했습니다. 매달 쌓는 학원 수 기록이 6개월 모이면 실제 값으로 바뀝니다." : "";
  const boost = k.boost ? ` 곧 입주할 새 아파트 ${fmt(k.boost.households)}세대로 학생 1년 ${pp(k.boost.rate)}를 더했습니다.` : "";
  return `학원과 학생 증가 속도(위 판단 근거 참고): 학원 1년 ${pp(k.growth.rate)}, 학생 1년 ${pp(withBoost(k.students, k.boost))}, 차이 ${pp(k.gap)}p입니다.${boost}${caveat}`;
}
function riskTag(area, data) {
  const k = riskOf(area, data);
  return k?.risky ? '<span class="tag risk">위험지역</span>' : k?.caution ? '<span class="tag caution">주의</span>' : "";
}

// 한국부동산원 상권 이름 → 그 상권이 있는 구·시와 법정동. 동을 비워 두면 구·시 전체 값을 낼 때만 씁니다.
const RENT_PLACES = {
  "광화문": [["서울-종로구", []]], "종로": [["서울-종로구", ["관철동", "종로3가", "운니동", "경운동"]]],
  "북촌": [["서울-종로구", ["가회동", "계동", "안국동"]]], "서촌": [["서울-종로구", ["누하동", "통인동", "필운동", "옥인동", "통의동"]]],
  "혜화동": [["서울-종로구", ["혜화동", "명륜1가", "명륜동1가", "동숭동"]]],
  "남대문": [["서울-중구", []]], "명동": [["서울-중구", []]], "방산시장": [["서울-중구", []]], "시청": [["서울-중구", ["정동"]]],
  "을지로": [["서울-중구", ["을지로2가", "수표동"]]], "충무로": [["서울-중구", ["필동1가", "인현동2가", "묵정동"]]],
  "동대문": [["서울-중구", ["황학동", "흥인동"]]], "약수역": [["서울-중구", ["신당동"]]],
  "청담": [["서울-강남구", ["청담동"]]], "압구정": [["서울-강남구", ["압구정동"]]], "신사역": [["서울-강남구", ["신사동"]]],
  "논현역": [["서울-강남구", ["논현동"]]], "도산대로": [["서울-강남구", []]], "테헤란로": [["서울-강남구", ["역삼동", "삼성동"]]],
  "강남대로": [["서울-강남구", []], ["서울-서초구", []]], "학동/강남구청역": [["서울-강남구", []]], "한티역": [["서울-강남구", ["대치동", "도곡동"]]],
  "교대역": [["서울-서초구", ["서초동"]]], "남부터미널": [["서울-서초구", ["서초동"]]], "방배역/내방역": [["서울-서초구", ["방배동"]]],
  "서래마을": [["서울-서초구", ["반포동"]]], "양재말죽거리": [["서울-서초구", ["양재동"]]], "양재역": [["서울-서초구", ["양재동"]]],
  "당산역": [["서울-영등포구", ["당산동", "당산동1가", "당산동2가", "당산동3가", "당산동4가", "당산동5가", "당산동6가"]]],
  "영등포역": [["서울-영등포구", ["영등포동", "영등포동5가", "영등포동6가", "영등포동7가", "영등포동8가"]]], "여의도": [["서울-영등포구", ["여의도동"]]],
  "공덕역": [["서울-마포구", ["공덕동", "아현동"]]], "동교/연남": [["서울-마포구", ["동교동", "연남동"]]], "망원역": [["서울-마포구", ["망원동"]]],
  "홍대/합정": [["서울-마포구", ["서교동", "합정동"]]], "신촌/이대": [["서울-서대문구", ["창천동", "대현동", "신촌동"]]],
  "가락시장": [["서울-송파구", ["가락동"]]], "잠실/송파": [["서울-송파구", ["잠실동", "송파동", "신천동"]]], "잠실새내역": [["서울-송파구", ["잠실동"]]],
  "건대입구": [["서울-광진구", ["화양동"]]], "군자": [["서울-광진구", ["군자동", "능동"]]], "구의역": [["서울-광진구", ["구의동"]]],
  "경희대": [["서울-동대문구", ["회기동"]]], "장안동": [["서울-동대문구", ["장안동"]]], "청량리": [["서울-동대문구", ["청량리동", "전농동"]]],
  "까치산역": [["서울-강서구", ["화곡동"]]], "화곡": [["서울-강서구", ["화곡동"]]],
  "노량진": [["서울-동작구", ["노량진동"]]], "사당": [["서울-동작구", ["사당동"]]], "독산/시흥": [["서울-금천구", ["독산동", "시흥동"]]],
  "뚝섬": [["서울-성동구", ["성수동1가", "성수동2가", "성수1가동", "성수2가동"]]], "왕십리": [["서울-성동구", ["행당동", "하왕십리동", "상왕십리동", "도선동"]]],
  "목동": [["서울-양천구", ["목동", "신정동"]]], "미아사거리": [["서울-강북구", ["미아동"]]], "수유": [["서울-강북구", ["수유동"]]],
  "불광역": [["서울-은평구", ["불광동"]]], "연신내": [["서울-은평구", ["갈현동", "불광동"]]],
  "상계역": [["서울-노원구", ["상계동"]]], "노원역": [["서울-노원구", ["상계동"]]], "쌍문역": [["서울-도봉구", ["쌍문동"]]],
  "상봉역": [["서울-중랑구", ["상봉동", "망우동"]]], "서울대입구역": [["서울-관악구", ["봉천동"]]], "낙성대": [["서울-관악구", ["봉천동"]]],
  "신림역": [["서울-관악구", ["신림동"]]], "성신여대": [["서울-성북구", ["동선동", "돈암동"]]],
  "숙명여대": [["서울-용산구", ["청파동1가", "청파동2가", "청파동3가", "갈월동"]]], "용산역": [["서울-용산구", ["한강로2가", "한강로3가"]]],
  "이태원": [["서울-용산구", ["이태원동", "한남동"]]], "오류동역": [["서울-구로구", ["오류동"]]], "구로디지털단지역": [["서울-구로구", ["구로동"]]],
  "천호": [["서울-강동구", ["천호동"]]], "명일역": [["서울-강동구", ["명일동"]]],
  "고양시청": [["경기-고양시", ["주교동", "성사동"]]], "탄현역": [["경기-고양시", ["탄현동"]]], "일산라페스타": [["경기-고양시", ["장항동", "마두동"]]],
  "행신역": [["경기-고양시", ["행신동"]]], "화정역": [["경기-고양시", ["화정동"]]], "광명철산": [["경기-광명시", ["철산동"]]],
  "광주시가지": [["경기-광주시", ["경안동", "송정동"]]], "광주광남동": [["경기-광주시", ["태전동", "쌍령동"]]], "구리역": [["경기-구리시", ["인창동", "수택동"]]],
  "기흥역": [["경기-용인시", ["구갈동"]]], "김량장동": [["경기-용인시", ["김량장동"]]], "용인수지": [["경기-용인시", ["풍덕천동"]]],
  "동백지구": [["경기-용인시", ["동백동", "중동"]]], "상현역": [["경기-용인시", ["상현동"]]], "죽전카페거리": [["경기-용인시", ["죽전동"]]],
  "동두천중앙로": [["경기-동두천시", ["생연동"]]],
  "모란": [["경기-성남시", ["성남동", "중앙동"]]], "성남구시가지": [["경기-성남시", ["태평동", "수진동", "신흥동"]]], "단대오거리역": [["경기-성남시", ["단대동", "신흥동"]]],
  "분당역세권": [["경기-성남시", ["서현동", "정자동", "수내동"]]], "서판교": [["경기-성남시", ["판교동", "운중동"]]], "야탑역": [["경기-성남시", ["야탑동"]]],
  "위례신도시": [["경기-성남시", ["창곡동"]], ["경기-하남시", ["학암동"]], ["서울-송파구", ["장지동", "거여동"]]],
  "병점역": [["경기-화성시", ["병점동", "진안동"]]], "화성남양읍": [["경기-화성시", ["남양읍", "남양동"]]], "화성봉담읍": [["경기-화성시", ["봉담읍"]]],
  "동탄2신도시": [["경기-화성시", ["영천동", "청계동", "오산동", "산척동", "목동", "송동", "장지동", "신동"]]], "동탄센트럴파크": [["경기-화성시", ["반송동", "석우동"]]],
  "부천역": [["경기-부천시", ["심곡동"]]], "상중동": [["경기-부천시", ["상동", "중동"]]], "송내역": [["경기-부천시", ["송내동"]]], "역곡역": [["경기-부천시", ["역곡동"]]],
  "수원역": [["경기-수원시", ["매산로2가", "매산로3가"]]], "수원파장동": [["경기-수원시", ["파장동"]]], "인계동": [["경기-수원시", ["인계동"]]],
  "팔달문로터리": [["경기-수원시", ["팔달로1가", "남창동"]]], "아주대삼거리": [["경기-수원시", ["원천동", "우만동"]]], "영통역": [["경기-수원시", ["영통동"]]],
  "광교중앙역": [["경기-수원시", ["이의동", "하동"]]],
  "신장/지산/서정": [["경기-평택시", ["신장동", "지산동", "서정동"]]], "평택역": [["경기-평택시", ["평택동"]]], "평택시청": [["경기-평택시", ["비전동"]]],
  "신천역": [["경기-시흥시", ["신천동"]]], "배곧신도시": [["경기-시흥시", ["배곧동"]]], "시흥시립도서관": [["경기-시흥시", []]],
  "안성 서인사거리": [["경기-안성시", ["서인동"]]], "안양역": [["경기-안양시", ["안양동"]]], "인덕원": [["경기-안양시", ["관양동"]]],
  "범계학원가": [["경기-안양시", ["평촌동", "범계동", "호계동"]]], "평촌범계": [["경기-안양시", ["평촌동", "범계동"]]],
  "양주덕정역": [["경기-양주시", ["덕정동"]]], "여주시청": [["경기-여주시", ["홍문동"]]], "오산시청": [["경기-오산시", ["오산동"]]],
  "의정부역": [["경기-의정부시", ["의정부동"]]], "의정부민락": [["경기-의정부시", ["민락동"]]], "이천종합터미널": [["경기-이천시", ["중리동", "창전동"]]],
  "파주시청": [["경기-파주시", ["금촌동"]]], "금릉역": [["경기-파주시", ["금릉동", "금촌동"]]], "파주야당역": [["경기-파주시", ["야당동"]]],
  "파주운정호수": [["경기-파주시", ["와동동", "목동동", "동패동", "다율동"]]], "포천소흘읍": [["경기-포천시", ["소흘읍"]]], "포천시외버스터미널": [["경기-포천시", ["신읍동"]]],
  "하남원도심": [["경기-하남시", ["신장동", "덕풍동"]]], "미사지구": [["경기-하남시", ["망월동", "풍산동", "선동"]]],
  "김포운양역": [["경기-김포시", ["운양동"]]], "김포장기역": [["경기-김포시", ["장기동"]]], "김포한강구래": [["경기-김포시", ["구래동", "마산동"]]],
  "남양주다산": [["경기-남양주시", ["다산동"]]], "남양주별내": [["경기-남양주시", ["별내동"]]],
  "고잔신도시": [["경기-안산시", ["고잔동"]]], "안산중앙역": [["경기-안산시", ["고잔동"]]], "상록수역": [["경기-안산시", ["본오동"]]],
  "선부다이아몬드": [["경기-안산시", ["선부동"]]], "월피다이아몬드": [["경기-안산시", ["월피동"]]], "한대앞역": [["경기-안산시", ["사동"]]],
  "산본역": [["경기-군포시", ["산본동"]]],
  "간석오거리": [["인천-남동구", ["간석동"]]], "구월": [["인천-남동구", ["구월동"]]], "인천논현역": [["인천-남동구", ["논현동"]]], "소래포구역": [["인천-남동구", ["논현동"]]],
  "검단사거리완정역": [["인천-검단구", ["마전동", "왕길동", "당하동"]]], "계양계산": [["인천-계양구", ["계산동"]]], "부평": [["인천-부평구", ["부평동"]]],
  "석남/가정중앙시장": [["인천-서해구", ["석남동", "가정동"]]], "인천서구청": [["인천-서해구", ["심곡동"]]], "청라국제도시": [["인천-서해구", ["청라동"]]],
  "신포동": [["인천-제물포구", ["신생동", "내동", "답동"]]], "주안": [["인천-미추홀구", ["주안동"]]], "인하대앞": [["인천-미추홀구", ["용현동"]]],
  "연수역": [["인천-연수구", ["연수동"]]], "송도": [["인천-연수구", ["송도동"]]], "영종": [["인천-영종구", ["운서동", "중산동", "운남동"]]],
};
const RENT_KINDS = { large: "중대형 상가", complex: "집합 상가", small: "소규모 상가" }; // 학원은 주로 중대형 건물에 들어가 이 순서로 고릅니다.
const RENT_ZONES = { 도심: ["서울-종로구", "서울-중구"], 강남: ["서울-강남구", "서울-서초구"], 영등포신촌: ["서울-영등포구", "서울-마포구", "서울-서대문구"] };
const RENT_SIZES = { small: [50, "15평"], mid: [99, "30평"], large: [198, "60평"] }; // 예산별로 흔한 학원 넓이(전용면적).
// 한국부동산원 임대료는 계약면적(전용+공용) ㎡당이라, 전용면적으로 바꿀 때 나눌 전용률입니다(어림값).
const RENT_NET = { large: 0.6, complex: 0.5, small: 0.7 };
const RENT_LEVELS = ["dong", "region", "zone", "province"];
let rent = null;

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// 상권 값을 동·구시·권역·시도 단위로 묶어 둡니다. 서울은 권역(도심·강남·영등포신촌·기타) 값이 따로 있습니다.
function indexRent(raw) {
  const idx = { period: null, kinds: {} };
  for (const [kind, t] of Object.entries(raw.tables || {})) {
    if (!RENT_KINDS[kind]) continue;
    idx.period ||= t.period;
    const k = idx.kinds[kind] = { dong: {}, region: {}, zone: {}, province: {} };
    for (const row of t.rows) {
      // 학원은 1층을 거의 쓰지 않아 2층 이상(지하·1층 제외) 평균을 씁니다. value는 1층 값입니다.
      if (row.item !== "임대료" || !(row.upper > 0)) continue;
      const path = row.full.split(">");
      if (path.length === 1) { k.province[path[0]] = { value: row.upper, ground: row.value, names: [path[0]] }; continue; }
      if (path[0] === "서울" && path.length === 2) { k.zone[path[1]] = { value: row.upper, ground: row.value, names: [`서울 ${path[1]}권역`] }; continue; }
      for (const [rid, dongs] of RENT_PLACES[path.at(-1)] || []) {
        (k.region[rid] ||= []).push(row);
        for (const d of dongs) (k.dong[`${rid}|${d}`] ||= []).push(row);
      }
    }
    for (const lv of ["dong", "region"]) for (const [key, rows] of Object.entries(k[lv])) {
      k[lv][key] = { value: median(rows.map((r) => r.upper)), ground: median(rows.map((r) => r.value)), names: rows.map((r) => r.full.split(">").at(-1)), count: rows.length };
    }
  }
  return idx;
}

function rentZone(regionId) {
  if (!regionId.startsWith("서울-")) return null;
  return Object.keys(RENT_ZONES).find((z) => RENT_ZONES[z].includes(regionId)) || "기타";
}

// 가장 가까운 단위의 임대료를 고릅니다: 이 동 상권 → 구·시 안 상권들의 중간값 → 서울 권역 → 시·도 평균.
function rentFor(regionId, dong) {
  if (!rent) return null;
  const keys = { dong: `${regionId}|${dong}`, region: regionId, zone: rentZone(regionId), province: regionId.split("-")[0] };
  for (const level of RENT_LEVELS) {
    if (!keys[level]) continue;
    const kinds = Object.keys(RENT_KINDS).filter((kind) => rent.kinds[kind]?.[level][keys[level]]).map((kind) => ({ kind, ...rent.kinds[kind][level][keys[level]] }));
    if (kinds.length) return { level, kinds, main: kinds[0] };
  }
  return null;
}

const rentWon = (thousand) => `${(Math.round(thousand) / 10).toFixed(1)}만원`; // 천원/㎡ → 만원/㎡
const rentMonthly = (thousand, m2) => `${fmt(Math.round(thousand * m2 / 10 / 10) * 10)}만원`; // 10만원 단위
function rentWhere(r, regionName) {
  const names = [...new Set(r.main.names)];
  const list = names.length > 3 ? `${names.slice(0, 3).join("·")} 등 ${names.length}곳` : names.join("·");
  if (r.level === "dong") return `${list} 상권`;
  if (r.level === "region") return `이 동 상권 자료가 없어 ${regionName} 안 ${list} 상권 ${names.length > 1 ? "중간값" : "값"}`;
  return `이 동·${regionName} 상권 자료가 없어 ${names[0]} 평균`;
}

function rentText(area, data, m2 = 99, sizeName = "30평") {
  const r = rentFor(data.id, area.name);
  if (!r) return "";
  const kinds = r.kinds.map((k) => `${RENT_KINDS[k.kind].replace(" 상가", "")} ${rentWon(k.value)}`).join(" · ");
  const net = RENT_NET[r.main.kind];
  return `<div class="rank-sub">2층 이상 상가 임대료 계약면적 ㎡당 월: ${kinds} (${rent.period}, ${rentWhere(r, shortRegion(data.region))}, 지하·1층 제외. ${RENT_KINDS[r.main.kind].replace(" 상가", "")} 1층은 ${rentWon(r.main.ground)}) → 전용 ${sizeName}(${m2}㎡)이면 계약면적 약 ${fmt(Math.round(m2 / net / 3.3058))}평(전용률 ${Math.round(net * 100)}% 가정)이라 <strong>월 약 ${rentMonthly(r.main.value / net, m2)}</strong> (${RENT_KINDS[r.main.kind]} 기준 어림. 보증금을 월세로 환산해 더한 값이고 관리비·부가세 별도)</div>`;
}

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 교육열 추정치: 시·도 안 동들과 비교한 백분위 평균 (scripts/update_data.py add_fervor)
function fervorLabel(score) {
  return score >= 67 ? "높음" : score >= 34 ? "보통" : "낮음";
}

function fervorText(area) {
  const f = area.fervor;
  if (!f) return "";
  const p = f.parts;
  const bits = [];
  if (p.density) bits.push(`학생 100명당 학원 ${p.density[0]}곳`);
  if (p.fee) bits.push(`전 과목 등록 수강료 중간값 ${won(p.fee[0])}`);
  return `<div class="rank-sub">교육열 추정 <strong>${fervorLabel(f.score)}</strong> (${f.score}점/100) · ${bits.join(" · ")}</div>`;
}

// 근거 문장과 같은 계산으로 붙입니다. 오차가 큰 동에는 붙이지 않습니다.
function flowTag(area, subject, level) {
  const f = !boundaryMismatch(area) && localUse(area, subject, level);
  if (!f) return "";
  const kind = flowKind(f.use);
  if (kind === "out") return '<span class="tag warn">다른 동으로 다님</span>';
  if (kind === "in") return '<span class="tag good">다른 동에서 찾아옴</span>';
  return "";
}

// 서울 상권분석 추정매출은 분기 합계라 3으로 나눠 한 달로 봅니다. 과목과 상관없이 입시·보습 학원 전체로 나눕니다.
// 학원이 적은 동은 매출 집계(행정동)와 학원 주소(법정동)의 경계 차이에 크게 흔들려 보여주지 않습니다.
const MIN_ACADEMIES_FOR_SALES = 20;

// 2025년 초중고사교육비조사(국가데이터처·교육부) 표7, 전국 전체학생 1인당 월평균 사교육비(만원).
// 국어는 논술을 더했고, 과학은 조사에서 사회와 묶여 있습니다.
const SPEND_PROFILE = {
  elem: { korean: 4.3, english: 11.8, math: 8.4, science: 0.8 },
  middle: { korean: 4.6, english: 15.8, math: 17.0, science: 2.1 },
  high: { korean: 8.1, english: 12.7, math: 16.5, science: 3.6 },
};
const profileSum = (level, subject) => (subject === "all"
  ? Object.values(SPEND_PROFILE[level]).reduce((t, x) => t + x, 0)
  : SPEND_PROFILE[level][subject] || 0);

// 학생 1명당 월 카드매출. 카드매출은 과목·학년별로 나뉘지 않으므로, 전 과목 합계를 실제 값으로 두고
// 과목·학년을 고르면 동 매출을 전국 사교육비 비율대로 나눈 추정치를 냅니다.
const isEstimate = (subject, level) => subject !== "all" || level !== "total";
function perStudent(area, subject = "all", level = "total") {
  if (!area.sales || !area.students.total || boundaryMismatch(area)) return 0; // 경계가 크게 어긋나면 숫자가 부풀려져 내지 않습니다.
  const monthly = area.sales / 3;
  if (!isEstimate(subject, level)) return monthly / area.students.total;
  const levels = Object.keys(SPEND_PROFILE);
  const weight = levels.reduce((t, l) => t + (area.students[l] || 0) * profileSum(l, "all"), 0);
  if (!weight) return 0;
  const k = monthly / weight; // 이 동이 전국 평균보다 몇 배 쓰는지
  if (level !== "total") return area.students[level] ? k * profileSum(level, subject) : 0;
  return levels.reduce((t, l) => t + (area.students[l] || 0) * k * profileSum(l, subject), 0) / area.students.total;
}
// 매출은 행정동, 학원·학교는 주소의 법정동 기준이라 경계가 어긋나는 동이 있습니다.
// 예: 압구정로데오 학원가는 주소상 신사동이지만 매출은 행정동 '압구정동'으로 잡혀,
//     압구정동은 학원 19곳에 월 84억원(구 평균 1곳당의 10배)으로 나옵니다.
// 학원·학생이 적거나, 학원 1곳당 매출이 구 평균의 3배를 넘거나 1/4에 못 미치면 믿기 어렵다고 봅니다.
let regionSalesPerAcademy = 0;
function boundaryMismatch(area) {
  if (!area.sales || !regionSalesPerAcademy) return false;
  const ratio = area.sales / 3 / Math.max(area.academies.all, 1) / regionSalesPerAcademy;
  return ratio > 3 || ratio < 0.25;
}
// 학원·학생이 적은 동은 숫자가 흔들리기 쉬워 '참고만'을 붙이지만, 결론은 냅니다.
// 경계가 크게 어긋난 동(boundaryMismatch)은 숫자 자체가 틀어져 결론을 내지 않습니다.
const smallSales = (area) => area.academies.all < MIN_ACADEMIES_FOR_SALES || area.students.total < 500;
const roughSales = (area) => smallSales(area) || boundaryMismatch(area);
function studentSalesText(area, subject, level) {
  const v = perStudent(area, subject, level);
  if (!v) {
    return boundaryMismatch(area) && area.students.total
      ? '<div class="rank-sub">학생 1명당 매출: 이 동은 매출 집계 구역(행정동)과 학원 주소의 동(법정동)이 크게 어긋나 계산하지 않았습니다. 아래 \'왜 이런 결과일까?\'를 보세요.</div>'
      : "";
  }
  const note = isEstimate(subject, level) ? "동 전체 매출을 전국 과목·학교급 사교육비 비율로 나눈 값" : "국영수과 등 모든 과목 합계";
  const rough = roughSales(area) ? ' <span class="tag warn">학원·학생 적어 참고만</span>' : "";
  return `<div class="rank-sub">${perStudentLabel(subject, level)}: <strong>${won(Math.round(v))}</strong> (${note})${rough}</div>`;
}
const SUBJECT_SHORT = { all: "전 과목", math: "수학", english: "영어", korean: "국어·논술", science: "과학" };
const perStudentLabel = (subject, level) => (isEstimate(subject, level)
  ? `${level === "total" ? "학생" : LEVEL_LABELS[level]} 1명당 ${SUBJECT_SHORT[subject]} 월매출 (추정)`
  : "학생 1명당 월매출 (전 과목 합계)");
function monthlyPerAcademy(area) {
  return area.sales && area.academies.all >= MIN_ACADEMIES_FOR_SALES ? area.sales / 3 / area.academies.all : 0;
}

// 정원이 큰 순서. 유명도·평판이 아니라 교육청에 등록한 규모입니다.
function topAcademies(area, subject) {
  const list = (area.top || []).filter((x) => subject === "all" || x.subjects.includes(subject)).slice(0, 3);
  if (!list.length) return "";
  const year = new Date().getFullYear();
  const items = list.map((x) => {
    const bits = [];
    if (x.capacity) bits.push(`정원 ${fmt(x.capacity)}명`);
    if (x.since) bits.push(`${Math.max(year - x.since, 0)}년째`);
    if (x.branches >= 2) bits.push(`이름 비슷한 곳 ${fmt(x.branches)}곳`);
    return `<li><strong>${x.name}</strong>${bits.length ? ` <span class="muted">${bits.join(" · ")}</span>` : ""}</li>`;
  });
  return `<div class="top"><span class="top-label">규모 큰 학원</span><ul>${items.join("")}</ul></div>`;
}

// 학원 1곳당 학생 수. 학원이 없으면 Infinity로 두고 맨 위에 보여줍니다.
function perAcademy(students, academies) {
  return academies === 0 ? Infinity : students / academies;
}

// 수강료·매출 판단에 쓰는 구·시 단위 기준값을 그 지역으로 맞춥니다.
function setRegionContext(data) {
  regionFees = data.fees;
  const allSales = data.areas.filter((a) => a.sales && a.academies.all);
  regionSalesPerAcademy = allSales.length
    ? allSales.reduce((t, a) => t + a.sales, 0) / 3 / allSales.reduce((t, a) => t + a.academies.all, 0)
    : 0;
}

function render(data) {
  const subject = els.subject.value;
  const level = els.level.value;

  const rows = data.areas.map((area) => {
    const students = area.students[level];
    const academies = area.academies[subject];
    return { area, students, academies, ratio: perAcademy(students, academies) };
  });
  rows.sort((a, b) => b.ratio - a.ratio || b.students - a.students);

  const totalStudents = rows.reduce((s, r) => s + r.students, 0);
  const totalAcademies = rows.reduce((s, r) => s + r.academies, 0);
  const average = perAcademy(totalStudents, totalAcademies);

  const regionFee = feeOf(data.fees, subject, level);
  setRegionContext(data);
  const withSales = data.areas.filter((a) => monthlyPerAcademy(a));
  const regionPerMonth = withSales.length
    ? withSales.reduce((t, a) => t + a.sales, 0) / 3 / withSales.reduce((t, a) => t + a.academies.all, 0)
    : 0;
  // 다른 동 학생이 가장 많이 찾아오는 곳. 경계 오차가 큰 동은 뺍니다.
  // 비율이 아니라 '기대보다 더 들어온 매출 금액'이 가장 큰 곳입니다. 학생이 적은 동은 비율만 커 보여서입니다.
  const ctx = { subject, level, regionName: shortRegion(data.region), totalStudents, totalAcademies, regionFee, regionId: data.id, salesPeriod: data.salesPeriod, pastYear: data.pastYear, data, average };

  els.summary.innerHTML = `
    <div><div class="label">${data.region} ${LEVEL_LABELS[level]}</div><div class="value">${fmt(totalStudents)}명</div></div>
    <div><div class="label">${SUBJECT_LABELS[subject]}</div><div class="value">${fmt(totalAcademies)}곳</div></div>
    <div><div class="label">${shortRegion(data.region)} 평균, 학원 1곳당 학생</div><div class="value">${Number.isFinite(average) ? fmt(Math.round(average)) + "명" : "-"}</div></div>
    <div><div class="label">${shortRegion(data.region)} ${feeName(subject, level)} (중간값)</div><div class="value">${regionFee ? won(regionFee.median) : "-"}</div></div>${regionPerMonth ? `
    <div><div class="label">학원 1곳당 월 카드매출 (추정, 평균)</div><div class="value">${bigWon(regionPerMonth)}</div></div>` : ""}`;

  renderCompare(rows, data, subject, level);

  const finite = rows.filter((r) => Number.isFinite(r.ratio)).map((r) => r.ratio);
  const max = Math.max(...finite, 1);

  els.ranking.innerHTML = rows
    .map((r, i) => {
      let metric;
      let tag = "";
      let width;
      if (!Number.isFinite(r.ratio)) {
        metric = "등록된 학원 없음";
        tag = r.students > 0 ? '<span class="tag good">학원 없음</span>' : "";
        width = 100;
      } else {
        metric = `학원 1곳당 <strong>${fmt(Math.round(r.ratio))}</strong>명`;
        if (r.ratio >= average * 1.2) tag = '<span class="tag good">경쟁 낮음</span>';
        else if (r.ratio <= average * 0.8) tag = '<span class="tag warn">경쟁 높음</span>';
        width = (r.ratio / max) * 100;
      }
      const schoolCount = r.area.schools.length;
      const fee = feeOf(r.area.fees, subject, level);
      const fallbackFee = !fee && feeOf(data.fees, subject, level);
      const feeText = fee
        ? ` · ${feeName(subject, level)} ${won(fee.median)} (중간값, ${fmt(fee.count)}개 과정${fee.median > MAX_FEE ? ", 여러 달 묶음이나 유아 과정이 섞인 듯" : ""})`
        : fallbackFee ? ` · ${feeName(subject, level)}: 이 동 자료 없음 (${shortRegion(data.region)} 중간값 ${won(fallbackFee.median)})` : "";
      const perMonth = monthlyPerAcademy(r.area);
      const salesText = data.salesPeriod && r.area.sales
        ? `<div class="rank-sub">학원 카드매출 추정: 동 전체 ${bigWon(r.area.sales)} (${data.salesPeriod})${perMonth ? ` · 학원 1곳당 <strong>월 ${bigWon(perMonth)}</strong>` : ""}${regionPerMonth && perMonth ? ` (${shortRegion(data.region)} 평균의 ${pct(perMonth / regionPerMonth)})` : ""}</div>${studentSalesText(r.area, subject, level)}`
        : "";
      const reasons = reasonsFor(r, ctx);
      const why = reasons.length
        ? `<details class="why"><summary>왜 이런 결과일까?</summary><ul>${reasons.map((t) => `<li>${t}</li>`).join("")}</ul></details>`
        : "";
      return `<li>
        <div class="rank-head">
          <span class="rank-name"><span class="no">${i + 1}</span>${r.area.name}${townTag(data.id, r.area.name)}${riskTag(r.area, data)}${tag}${flowTag(r.area, subject, level)}</span>
          <span class="rank-metric">${metric}</span>
        </div>
        <div class="bar"><span style="width:${width.toFixed(1)}%"></span></div>
        <div class="rank-sub">${LEVEL_LABELS[level]} ${fmt(r.students)}명 · ${SUBJECT_LABELS[subject]} ${fmt(r.academies)}곳 · 학교 ${schoolCount}곳${feeText}</div>
        ${salesText}
        ${fervorText(r.area)}
        ${trendText(r.area, data, subject, level)}
        ${riskText(r.area, data)}
        ${rentText(r.area, data)}
        ${r.area.apt ? `<div class="rank-sub">아파트 평당 <strong>${bigWon(r.area.apt[0])}</strong> (${data.aptPeriod} ${fmt(r.area.apt[1])}건의 중간값)</div>` : ""}
        ${why}
      </li>`;
    })
    .join("");

  const levelNames = { elem: "초", middle: "중", high: "고" };
  els.dongBody.innerHTML = data.areas
    .flatMap((area) =>
      area.schools.map(
        (sc) => `<tr><td>${area.name}</td><td>${sc.name} (${levelNames[sc.level]})</td><td>${fmt(sc.students)}</td></tr>`
      )
    )
    .join("");

  const base = data.baseDate ? `${data.baseDate}. ` : "";
  const skipped = data.unmatchedAcademies ? ` 주소에 동 이름이 없어 빠진 학원 ${fmt(data.unmatchedAcademies)}곳.` : "";
  const rentSource = rent ? ` / 한국부동산원 상업용부동산 임대동향(${rent.period})` : "";
  els.sources.textContent = `${base}출처: ${data.sources.join(" / ")}${rentSource}.${skipped}`;
}

const COLUMNS = [
  { key: "name", label: "동", value: (r) => r.area.name, text: (r) => `${r.area.name}${townTag(r.data.id, r.area.name)}` },
  { key: "students", label: "학생", value: (r) => r.students, text: (r) => `${fmt(r.students)}명` },
  { key: "academies", label: "학원", value: (r) => r.academies, text: (r) => `${fmt(r.academies)}곳` },
  {
    key: "ratio", label: "학원 1곳당 학생",
    value: (r) => (Number.isFinite(r.ratio) ? r.ratio : 1e9),
    text: (r) => (Number.isFinite(r.ratio) ? `${fmt(Math.round(r.ratio))}명` : "학원 없음"),
  },
  {
    key: "fervor", label: "교육열(추정)",
    value: (r) => r.area.fervor?.score ?? -1,
    text: (r) => (r.area.fervor ? `${fervorLabel(r.area.fervor.score)} ${r.area.fervor.score}` : "-"),
  },
  {
    key: "change", label: "학생 증감",
    value: (r) => studentChange(r.area, r.level) ?? -9,
    text: (r) => { const c = studentChange(r.area, r.level); return c === null ? "-" : signedPct(c); },
  },
  {
    key: "opened", label: "새 학원(1년)",
    value: (r) => r.area.opened?.["1y"][r.subject] ?? -1,
    text: (r) => (r.area.opened ? `${fmt(r.area.opened["1y"][r.subject])}곳` : "-"),
  },
  {
    key: "risk", label: "학원−학생 증가(1년)",
    value: (r) => riskOf(r.area, r.data)?.gap ?? -9,
    text: (r) => { const k = riskOf(r.area, r.data); return k ? (k.risky ? `<span class="risk-text">${pp(k.gap)}p 위험</span>` : k.caution ? `<span class="caution-text">${pp(k.gap)}p 주의</span>` : `${pp(k.gap)}p`) : "-"; },
  },
  {
    key: "newApts", label: "새 아파트",
    value: (r) => freshApts(r.area).reduce((t, x) => t + x.households, 0),
    text: (r) => { const n = freshApts(r.area).reduce((t, x) => t + x.households, 0); return n ? `${fmt(n)}세대` : "-"; },
  },
  {
    key: "apt", label: "아파트 평당가", aptOnly: true,
    value: (r) => r.area.apt?.[0] || 0,
    text: (r) => (r.area.apt ? bigWon(r.area.apt[0]) : "-"),
  },
  {
    key: "rent", label: "2층 이상 임대료(계약㎡당 월)", rentOnly: true,
    value: (r) => rentFor(r.data.id, r.area.name)?.main.value || 0,
    text: (r) => { const x = rentFor(r.data.id, r.area.name); return x ? `${rentWon(x.main.value)}${x.level === "dong" ? "" : x.level === "region" ? " (구·시)" : " (권역·시도)"}` : "-"; },
  },
  {
    key: "fee", label: (subject, level) => `${feeName(subject, level).replace(" 등록", "")} (중간값)`,
    value: (r) => r.fee?.median || 0,
    text: (r) => (r.fee ? won(r.fee.median) : "-"),
  },
  {
    key: "perStudent", label: perStudentLabel, salesOnly: true,
    value: (r) => perStudent(r.area, r.subject, r.level),
    text: (r) => { const v = perStudent(r.area, r.subject, r.level); if (!v && boundaryMismatch(r.area)) return "구역 불일치"; return v ? `${won(Math.round(v))}${roughSales(r.area) ? " (참고만)" : ""}` : "-"; },
  },
  {
    key: "localUse", label: "동네 학원 이용 (추정)", salesOnly: true,
    value: (r) => localUse(r.area, r.subject, r.level)?.use || 0,
    text: (r) => { const f = localUse(r.area, r.subject, r.level); if (!f && boundaryMismatch(r.area)) return "구역 불일치"; return f ? `${pct(f.use)}${roughSales(r.area) ? " (참고만)" : ""}` : "-"; },
  },
  {
    key: "sales", label: "학원 1곳당 월매출", salesOnly: true,
    value: (r) => r.perMonth,
    text: (r) => (r.perMonth ? bigWon(r.perMonth) : r.area.sales ? "학원 적음" : "-"),
  },
];

function renderCompare(rows, data, subject, level) {
  const hasSales = Boolean(data.salesPeriod);
  // 휴대폰에서도 바로 보이도록 매출과 경쟁 지표를 동 이름 옆에 둡니다.
  const order = ["name", "risk", "localUse", "perStudent", "sales", "fervor", "apt", "rent", "change", "opened", "newApts", "ratio", "fee", "students", "academies"];
  const hasApt = Boolean(data.aptPeriod);
  const hasTrend = Boolean(data.pastYear);
  const hasNewApts = data.areas.some((a) => freshApts(a).length);
  const cols = COLUMNS.filter((c) => (hasSales || !c.salesOnly) && (hasApt || !c.aptOnly) && (rent || !c.rentOnly)
    && (hasTrend || c.key !== "change") && (data.areas[0]?.opened || c.key !== "opened") && (c.key !== "risk" || data.areas.some((a) => riskOf(a, data))) && (hasNewApts || c.key !== "newApts")).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  if (!cols.some((c) => c.key === sortKey)) sortKey = "ratio";
  const list = rows.map((r) => ({ ...r, data, subject, level, fee: feeOf(r.area.fees, subject, level), perMonth: monthlyPerAcademy(r.area) }));
  const col = cols.find((c) => c.key === sortKey);
  list.sort((a, b) => {
    const x = col.value(a), y = col.value(b);
    return typeof x === "string" ? x.localeCompare(y, "ko") : y - x;
  });
  els.compareHead.innerHTML = `<tr>${cols
    .map((c) => `<th scope="col"${c.key === "name" ? "" : ' class="num"'} aria-sort="${c.key === sortKey ? (c.key === "name" ? "ascending" : "descending") : "none"}"><button type="button" data-key="${c.key}">${typeof c.label === "function" ? c.label(subject, level) : c.label}${c.key === sortKey ? " ▼" : ""}</button></th>`)
    .join("")}</tr>`;
  els.compareBody.innerHTML = list
    .map((r) => `<tr>${cols.map((c) => `<td${c.key === "name" ? "" : ' class="num"'}>${c.text(r)}</td>`).join("")}</tr>`)
    .join("");
}

// ── 개원 동네 추천 ──
// 학생이 학원보다 빨리 느는 동(위 위험지역의 반대)을 먼저, 그다음 학원 1곳당 학생이 많은 동을 올립니다.
//   점수 = (학생 1년 증감률 − 학원 1년 순증가율) × 100 + 5 × log2(학원 1곳당 학생 ÷ 범위 평균)
// 경력·예산은 아래 규칙으로 후보를 거릅니다. 예산은 대형 학원가 제외 여부와 임대료 어림 넓이에 씁니다.
const REC_MIN_STUDENTS = 500;
const REC_TOP = 10;
let allRegions = [];
const recEls = {
  form: document.getElementById("rec-form"),
  subject: document.getElementById("rec-subject"),
  level: document.getElementById("rec-level"),
  years: document.getElementById("rec-years"),
  budget: document.getElementById("rec-budget"),
  scope: document.getElementById("rec-scope"),
  result: document.getElementById("rec-result"),
  report: document.getElementById("rec-report"),
};
let lastReport = null;

const HUB_BONUS = 8; // 대형·유명 학원 경력이면 학원가 동에 더하는 점수(%p와 같은 단위)
function recommend(regionsData, opts) {
  const { subject, level, years, budget } = opts;
  const pool = [];
  const skipped = { risk: 0, small: 0, nodata: 0, hub: 0, flowIn: 0, rent: 0 };
  // hubPref: "hub"(대형·유명 경력, 학원가 우대) · "away"(경력 짧음, 학원가 뺌) · 없음(기존 규칙)
  const pref = opts.hubPref;
  for (const data of regionsData) {
    setRegionContext(data);
    for (const area of data.areas) {
      if (opts.townsOnly && !newTown(data.id, area.name)) continue;
      const students = area.students[level];
      if (students < REC_MIN_STUDENTS) { skipped.small += 1; continue; }
      const st = studentRate(area, level, data);
      const g = academyGrowth(area, data) || regionGrowth(data);
      if (!st || !g) { skipped.nodata += 1; continue; }
      const risk = riskOf(area, data);
      if (risk?.risky) { skipped.risk += 1; continue; }
      const bigHub = area.academies.all >= BIG_HUB;
      const flow = !boundaryMismatch(area) && localUse(area, subject, level);
      const kind = flow ? flowKind(flow.use) : null;
      if (bigHub && (pref === "away" || (pref !== "hub" && (years < 3 || budget === "small")))) { skipped.hub += 1; continue; }
      if (kind === "in" && (pref === "away" || (!pref && years < 3))) { skipped.flowIn += 1; continue; }
      const nearby = area.nearby ? hubText(area, subject, data.id) : "";
      const x = { data, area, students, st, g, risk, kind, flow, bigHub, nearby, boost: moveInBoost(area, level), academies: area.academies[subject] };
      if (opts.rentLimit) {
        const r = rentEstimate(x, RENT_SIZES[budget][0]);
        if (r && r > opts.rentLimit) { skipped.rent += 1; continue; }
      }
      x.hubBonus = pref === "hub" && (bigHub || kind === "in") ? HUB_BONUS : 0;
      pool.push(x);
    }
  }
  const sumS = pool.reduce((t, x) => t + x.students, 0);
  const sumA = pool.reduce((t, x) => t + x.academies, 0);
  const avg = sumA ? sumS / sumA : 0;
  for (const x of pool) {
    x.perAcademy = x.students / Math.max(x.academies, 1);
    x.comp = avg ? Math.min(3, Math.max(0.25, x.perAcademy / avg)) : 1;
    x.gap = withBoost(x.st, x.boost) - x.g.rate;
    x.score = x.gap * 100 + 5 * Math.log2(x.comp) + (x.hubBonus || 0);
  }
  pool.sort((a, b) => b.score - a.score);
  return { top: pool.slice(0, REC_TOP), avg, skipped, total: pool.length };
}

// 학원이 20곳 미만인 동은 증가율이 크게 흔들려, 구·시 전체 학원의 증가율을 대신 씁니다.
const regionGrowthCache = new WeakMap();
function regionGrowth(data) {
  if (regionGrowthCache.has(data)) return regionGrowthCache.get(data);
  const sum = (f) => data.areas.reduce((t, a) => t + f(a), 0);
  let g = null;
  const base = sum((a) => a.storeFlow?.base || 0);
  if (base >= RISK_MIN_ACADEMIES) {
    const open = sum((a) => a.storeFlow?.open || 0), close = sum((a) => a.storeFlow?.close || 0);
    g = { rate: (open - close) / base, source: "region", open, close, base };
  } else if (data.seoulStoreRate && sum((a) => a.academies.all) >= RISK_MIN_ACADEMIES) {
    const all = sum((a) => a.academies.all), c = data.seoulStoreRate.close, open = sum((a) => a.opened?.["1y"].all || 0);
    g = { rate: open / all - c, source: "region", open, close: c * all, base: all, closeRate: c };
  }
  regionGrowthCache.set(data, g);
  return g;
}

function recItem(x, i, opts, scopeName) {
  const { subject, level, years, budget } = opts;
  const L = LEVEL_LABELS[level];
  const S = SUBJECT_LABELS[subject];
  const place = `${shortRegion(x.data.region)} ${x.area.name}${townTag(x.data.id, x.area.name)}`;
  const lines = [];
  lines.push(`학생: ${studentLine(x.area, level, x.st, x.data)}`);
  lines.push(`학원(입시·보습 전체): ${growthLine(x.g, x.data).replace(/^학원 /, "")}`);
  if (x.boost) lines.push(boostLine(x.boost));
  lines.push(`차이: ${x.boost ? `(${L} ${pp(x.st.rate)} + 입주 가산 ${pp(x.boost.rate)})` : `${L} ${pp(x.st.rate)}`} − 학원 ${pp(x.g.rate)} = <strong>${pp(x.gap)}p</strong> (클수록 학생이 학원보다 빨리 늚)`);
  lines.push(x.academies
    ? `${S} 1곳당 ${L} <strong>${fmt(Math.round(x.perAcademy))}명</strong> (${scopeName} 후보 평균 ${fmt(Math.round(opts.avg))}명의 ${(Math.round(x.perAcademy / opts.avg * 10) / 10).toFixed(1)}배) · ${S} ${fmt(x.academies)}곳, 최근 1년 새로 연 곳 ${fmt(x.area.opened?.["1y"][subject] || 0)}곳`
    : `등록된 ${S}이 없습니다. 비어 있는 시장일 수도, 수요가 작아 아무도 들어오지 않은 곳일 수도 있어 현장 확인이 필요합니다.`);
  const fee = feeOf(x.area.fees, subject, level);
  if (fee && fee.count >= 3 && fee.median <= MAX_FEE) lines.push(`이 동 ${feeName(subject, level)} 중간값 ${won(fee.median)} (${fmt(fee.count)}개 과정)`);
  if (x.kind === "out" || x.kind === "someOut") lines.push(`매출로 보면 동네 학생이 다른 동 학원으로 많이 다닙니다(기대치의 ${pct(x.flow.use)}). 동네에서 붙잡을 수 있다면 기회지만, 이미 다니는 학원에서 옮겨 오게 만들어야 합니다.`);
  if (x.kind === "in") lines.push(`다른 동 학생이 찾아오는 학원가입니다(기대치의 ${pct(x.flow.use)}). 수요는 크지만 이름난 학원과 경쟁합니다.`);
  if (x.nearby) lines.push(x.nearby);
  if (x.area.apt) lines.push(`아파트 평당 <strong>${bigWon(x.area.apt[0])}</strong> (${x.data.aptPeriod} ${fmt(x.area.apt[1])}건의 중간값)`);
  const later = `${Number(thisMonth().slice(0, 4)) + 1}-12`;
  const comingApts = freshApts(x.area).filter((a) => a.moveIn > later);
  if (comingApts.length) lines.push(`그 뒤 입주 예정 새 아파트(가산에는 넣지 않음): ${comingApts.slice(0, 3).map((a) => `${a.name} ${fmt(a.households)}세대(${a.moveIn})`).join(", ")}${comingApts.length > 3 ? ` 외 ${comingApts.length - 3}곳` : ""}`);
  const [m2, sizeName] = RENT_SIZES[budget];
  const rentLine = rentText(x.area, x.data, m2, sizeName);
  if (rentLine) lines.push(rentLine.replace(/^<div class="rank-sub">|<\/div>$/g, ""));
  const warn = [];
  if (x.bigHub && budget !== "large") warn.push(`입시·보습 학원 ${fmt(x.area.academies.all)}곳이 모인 대형 학원가라 임대료와 시설 경쟁이 셀 수 있습니다. 예산 ${budget === "small" ? "3천만원 미만" : "3천만~1억원"}이면 아래 임대료 어림보다 현장 시세를 먼저 확인하세요.`);
  if (x.hubBonus) lines.push(`대형·유명 학원 경력이 있어 학원가(${x.bigHub ? `입시·보습 학원 ${fmt(x.area.academies.all)}곳이 모인 대형 학원가` : "다른 동 학생이 찾아오는 동"})를 우대해 점수 +${HUB_BONUS}을 더했습니다.`);
  if (x.bigHub && years >= 10 && !opts.hubPref) warn.push("경력이 길어 대형 학원가도 후보에 넣었습니다. 이름난 학원과 겨룰 강점(실적·커리큘럼)이 있는지가 관건입니다.");
  // 주의·위험 표시는 동 전체(초·중·고) 기준이라, 고른 학년과 방향이 다를 수 있어 두 숫자를 함께 적습니다.
  if (x.risk?.caution) {
    const k = x.risk;
    const base = `초·중·고 전체 학생은 1년 ${pp(withBoost(k.students, k.boost))}${k.boost ? "(입주 가산 포함)" : ""}로 학원(${pp(k.growth.rate)})보다 ${pp(k.gap).slice(1)}p 느리게 늘어, 동 전체로는 '주의' 동입니다(주의·위험 표시는 초·중·고 전체 기준).`;
    warn.push(level === "total" ? base
      : x.gap > 0 ? `${L}은 학원보다 빨리 늘지만, ${base} 다른 학년은 덜 늘거나 줄고 있다는 뜻이라, 그 학년을 가르치던 학원들이 ${L} 쪽으로 넘어오면 경쟁이 세질 수 있습니다.`
      : base);
  }
  if (x.area.students[level] < 500) warn.push(`${L}이 ${fmt(x.area.students[level])}명뿐이라 몇 명만 바뀌어도 증감률이 크게 흔들립니다.`);
  return `<li>
    <div class="rec-head"><span>${i + 1}. ${place}</span><span class="score">${L}이 학원보다 1년 ${pp(x.gap)}p</span></div>
    ${lines.map((t) => `<div class="rank-sub">${t}</div>`).join("")}
    ${warn.map((t) => `<div class="rank-sub"><span class="risk-text">주의</span> ${t}</div>`).join("")}
    <button type="button" class="rec-open" data-region="${x.data.id}" data-province="${x.data.province}" data-name="${x.area.name}">이 동 자세히 보기</button>
  </li>`;
}

async function runRecommend(e) {
  e.preventDefault();
  const opts = {
    subject: recEls.subject.value, level: recEls.level.value,
    years: Number(recEls.years.value), budget: recEls.budget.value,
  };
  const scope = recEls.scope.value;
  const townsOnly = scope === "towns";
  const one = scope.startsWith("region:") && allRegions.find((r) => r.id === scope.slice(7));
  const targets = allRegions.filter((r) => (one ? r === one : scope === "all" || r.province === scope || (townsOnly && NEW_TOWNS[r.id])));
  opts.townsOnly = townsOnly;
  recEls.result.innerHTML = `<p class="rec-note">${fmt(targets.length)}개 구·시 자료를 읽는 중…</p>`;
  const regionsData = await Promise.all(targets.map((r) => loadRegion(r.id)));
  const res = recommend(regionsData, opts);
  if (current) setRegionContext(current); // 아래 동별 화면의 기준값을 되돌립니다.
  opts.avg = res.avg;
  const scopeName = one ? one.name : { all: "서울·경기·인천", towns: "신도시" }[scope] || scope;
  const rules = [`${LEVEL_LABELS[opts.level]} ${REC_MIN_STUDENTS}명 미만인 동 ${fmt(res.skipped.small)}곳`, `위험지역 ${fmt(res.skipped.risk)}곳`];
  if (res.skipped.hub) rules.push(`대형 학원가 ${fmt(res.skipped.hub)}곳(${opts.years < 3 ? "경력 3년 미만" : "예산 3천만원 미만"})`);
  if (res.skipped.flowIn) rules.push(`다른 동 학생이 찾아오는 학원가 ${fmt(res.skipped.flowIn)}곳(경력 3년 미만)`);
  if (res.skipped.nodata) rules.push(`학생 증감 비교 자료가 없는 동 ${fmt(res.skipped.nodata)}곳`);
  lastReport = res.top.length ? { res, opts, scopeName, rules } : null;
  recEls.report.hidden = true;
  recEls.result.innerHTML = res.top.length
    ? `<button type="button" class="rec-go rec-report-open">이 결과를 보고서로 보기</button>
       <p class="rec-note"><strong>${scopeName}</strong>에서 ${LEVEL_LABELS[opts.level]} 수가 학원보다 빨리 느는(덜 주는) 순서로 고르고, 학원 1곳당 학생이 많을수록 조금 더 올렸습니다. 후보 ${fmt(res.total)}곳 중 상위 ${res.top.length}곳입니다.</p>
       <ol class="rec-list">${res.top.map((x, i) => recItem(x, i, opts, scopeName)).join("")}</ol>
       <p class="rec-note">뺀 곳: ${rules.join(", ")}. 학원 증가율은 폐업 자료가 과목별로 없어 입시·보습 학원 전체로 봅니다. 예산은 대형 학원가를 뺄지 정하고, 상가 임대료를 그 예산에 흔한 넓이(3천만원 미만 전용 15평, 1억원 미만 전용 30평, 그 이상 전용 60평)로 어림하는 데 썼습니다. 최종 결정 전에 현장 임대료와 상가를 꼭 확인하세요.</p>`
    : `<p class="rec-note">조건에 맞는 동이 없습니다. 범위를 넓히거나 대상을 바꿔 보세요. (뺀 곳: ${rules.join(", ")})</p>`;
}

// 추천 결과를 한 편의 보고서로 엮습니다. 숫자와 근거는 추천 카드와 같은 함수에서 나옵니다.
const YEARS_LABEL = { 0: "3년 미만", 3: "3~10년", 10: "10년 이상" };
const BUDGET_LABEL = { small: "3천만원 미만 (교습소·공부방)", mid: "3천만~1억원 (소형 학원)", large: "1억원 이상 (중대형 학원)" };
function rentEstimate(x, m2) {
  const r = rentFor(x.data.id, x.area.name);
  return r ? Math.round(r.main.value / RENT_NET[r.main.kind] * m2 / 10 / 10) * 10 : null; // 만원, 10만원 단위
}
function showReport(target = recEls.report, report = lastReport) {
  if (!report) return;
  const { res, opts, scopeName, rules, profile, saju } = report;
  const { subject, level, years, budget } = opts;
  const L = LEVEL_LABELS[level], S = SUBJECT_LABELS[subject];
  const [m2, sizeName] = RENT_SIZES[budget];
  const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  const top = res.top;
  const name = (x) => `${shortRegion(x.data.region)} ${x.area.name}${newTown(x.data.id, x.area.name) ? `(${newTown(x.data.id, x.area.name)})` : ""}`;
  const first = top[0];
  const firstRent = rentEstimate(first, m2);
  const summary = [
    `${scopeName}에서 ${L} ${REC_MIN_STUDENTS}명 이상인 동 가운데 위험지역 등을 뺀 후보 ${fmt(res.total)}곳을 비교했고, 상위 ${top.length}곳을 골랐습니다.`,
    `1순위는 <strong>${name(first)}</strong>입니다. ${L}이 학원보다 1년에 ${pp(first.gap).slice(1)}p ${first.gap >= 0 ? "빨리 늘고" : "덜 줄고"}, ${S} 1곳당 ${L}이 ${fmt(Math.round(first.perAcademy))}명으로 후보 평균의 ${(Math.round(first.perAcademy / res.avg * 10) / 10).toFixed(1)}배입니다${firstRent ? `. 전용 ${sizeName} 월 임대료는 약 ${fmt(firstRent)}만원으로 어림됩니다` : ""}.`,
  ];
  const towns = top.filter((x) => newTown(x.data.id, x.area.name)).length;
  const boosted = top.filter((x) => x.boost).length;
  const cautions = top.filter((x) => x.risk?.caution).length;
  if (towns) summary.push(`상위 ${top.length}곳 중 ${towns}곳이 신도시입니다.`);
  if (boosted) summary.push(`${boosted}곳은 곧 입주할 새 아파트의 학생 증가를 가산했습니다(어림).`);
  if (cautions) summary.push(`${cautions}곳은 동 전체(초·중·고)로 보면 '주의' 동이라 상세 내용을 꼭 확인하세요.`);
  const rows = top.map((x, i) => {
    const rent = rentEstimate(x, m2);
    const mark = [x.risk?.caution ? '<span class="caution-text">주의</span>' : "", x.boost ? "입주 가산" : "", x.hubBonus ? "학원가 우대" : ""].filter(Boolean).join(" · ");
    return `<tr><td>${i + 1}</td><td>${name(x)}</td><td class="num">${(Math.round(x.score * 10) / 10).toFixed(1)}</td><td class="num">${pp(x.gap)}p</td><td class="num">${x.academies ? `${fmt(Math.round(x.perAcademy))}명` : "학원 없음"}</td><td class="num">${rent ? `${fmt(rent)}만원` : "-"}</td><td class="num">${x.area.apt ? bigWon(x.area.apt[0]) : "-"}</td><td>${mark}</td></tr>`;
  }).join("");
  const details = top.map((x, i) => {
    const card = recItem(x, i, opts, scopeName).replace(/<button[^]*?<\/button>/, "").replace(/^\s*<li>|<\/li>\s*$/g, "");
    return `<section class="report-dong">${card}${riskText(x.area, x.data)}</section>`;
  }).join("");
  target.innerHTML = `
    <div class="report-tools"><button type="button" class="rec-go report-save" data-kind="pdf">PDF로 저장</button><button type="button" class="report-ghost report-save" data-kind="html">웹 문서(HTML)로 저장</button><button type="button" class="report-ghost report-copy">글 복사</button><button type="button" class="report-close">닫기</button></div>
    <header class="report-head">
      <p class="report-kicker">학원 입지 가이드 · ${today}</p>
      <h2>개원 입지 보고서: ${scopeName} ${L} ${S.replace(" 학원", "")}</h2>
      <dl class="report-cond">
        <div><dt>과목</dt><dd>${S}</dd></div><div><dt>대상</dt><dd>${L}</dd></div>
        <div><dt>경력</dt><dd>${profile ? profile.label : YEARS_LABEL[years]}</dd></div><div><dt>예산</dt><dd>${profile?.budgetText || BUDGET_LABEL[budget]}</dd></div>${opts.rentLimit ? `<div><dt>월 임대료 한도</dt><dd>${fmt(opts.rentLimit)}만원</dd></div>` : ""}
        <div><dt>범위</dt><dd>${scopeName}</dd></div><div><dt>넓이 가정</dt><dd>전용 ${sizeName}(${m2}㎡)</dd></div>
      </dl>
    </header>
    <h3>1. 요약</h3>
    ${summary.map((t) => `<p>${t}</p>`).join("")}
    ${profile ? `<h3>경력으로 본 입지 전략</h3>${profile.strategy.map((t) => `<p>${t}</p>`).join("")}` : ""}
    ${saju ? sajuSection(saju) : ""}
    <h3>2. 추천 동 한눈에 보기</h3>
    <div class="table-wrap"><table class="report-table"><thead><tr><th>순위</th><th>동</th><th class="num">점수</th><th class="num">${L}−학원 증가(1년)</th><th class="num">${S.replace(" 학원", "")} 학원 1곳당 ${L}</th><th class="num">월 임대료 어림(전용 ${sizeName})</th><th class="num">아파트 평당</th><th>표시</th></tr></thead><tbody>${rows}</tbody></table></div>
    <h3>3. 동별 근거</h3>
    ${details}
    <h3>4. 고른 방법</h3>
    <p>${L} 1년 증감률(곧 입주할 새 아파트 가산 포함)에서 학원 1년 순증가율을 뺀 값을 먼저 보고, 학원 1곳당 학생이 후보 평균보다 많으면 조금 더 올렸습니다(점수 = 차이 %p + 5 × log₂(학원 1곳당 학생 ÷ 평균)${opts.hubPref === "hub" ? ` + 학원가 우대 ${HUB_BONUS}` : ""}). 그래서 표의 순위는 차이 %p 순서와 조금 다를 수 있습니다.</p>
    <p>뺀 곳: ${rules.join(", ")}.</p>
    <p>학원 증가율은 폐업 자료가 과목별로 없어 입시·보습 학원 전체로 봅니다. 임대료는 한국부동산원 2층 이상 계약면적 ㎡당 값을 전용률로 나눠 어림했고 관리비·부가세는 빠져 있습니다.</p>
    <h3>5. 현장에서 확인할 것</h3>
    <ul>
      <li>후보 동 상가 2층 이상 매물의 보증금·월세·관리비와 전용면적</li>
      <li>주변 초·중·고등학교 위치와 학원까지 걸어서 오는 길</li>
      <li>같은 과목 학원의 반 구성, 수강료, 원생 규모</li>
      <li>입주 예정 단지의 실제 입주 시기와 세대 구성</li>
    </ul>
    <p class="rec-note">출처: ${(first.data.sources || []).join(" / ")}${rent ? ` / 한국부동산원 상업용부동산 임대동향(${rent.period})` : ""}. 공공데이터로 만든 참고 자료이며 현장 조사를 대신하지 않습니다.</p>`;
  target.hidden = false;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  wireSajuAi(target, report);
}
// 받는 사람이 이 사이트 없이도 열 수 있게 스타일까지 담은 HTML 한 장으로 저장합니다.
// 보고서를 남에게 보낼 문서로 만듭니다. 화면 스타일(style.css) 위에 문서용 스타일을 덧씌웁니다.
const DOC_CSS = `
:root { --bg: #ffffff; --surface: #ffffff; --text: #1b1f2a; --muted: #5d6474; --line: #d9dce3; --accent: #1f3a6b; --accent-soft: #eef2f9; color-scheme: light; }
html, body { background: #fff; }
body { margin: 0; padding: 32px 20px 48px; color: var(--text); font-family: "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", system-ui, sans-serif; font-size: 14px; line-height: 1.7; word-break: keep-all; overflow-wrap: anywhere; }
.doc { max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: 10px; }
.doc-cover { border-bottom: 3px solid var(--accent); padding-bottom: 14px; margin-bottom: 6px; }
.doc-brand { margin: 0; font-size: 12px; letter-spacing: 0.08em; color: var(--accent); font-weight: 700; }
.doc h2 { margin: 6px 0 4px; font-size: 24px; line-height: 1.35; color: var(--text); }
.doc .report-kicker { display: none; }
.doc .report-head { gap: 6px; }
.doc .report-cond { background: var(--accent-soft); border-radius: 8px; padding: 10px 14px; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
.doc h3 { margin: 22px 0 2px; font-size: 17px; color: var(--accent); border-bottom: 1px solid var(--line); padding-bottom: 4px; }
.doc h4 { margin: 14px 0 0; font-size: 15px; }
.doc p, .doc li { margin: 0; }
.doc .table-wrap { overflow: visible; }
.doc .report-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.doc .report-table th { background: var(--accent-soft); color: var(--accent); font-weight: 700; }
.doc .report-table th, .doc .report-table td { border: 1px solid var(--line); padding: 5px 7px; white-space: normal; vertical-align: top; }
.doc .report-table .num, .doc .report-table td:first-child, .doc .report-table th:first-child { white-space: nowrap; }
.doc .report-dong { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; break-inside: avoid; }
.doc .saju-type, .doc .saju-summary { break-inside: avoid; }
.doc .saju-ai-out { border: 1px solid var(--line); background: #fafbfd; }
.doc .rec-note { font-size: 12px; color: var(--muted); }
.doc button, .doc .no-save, .doc .report-tools { display: none !important; }
.doc-foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid var(--line); font-size: 11.5px; color: var(--muted); }
@page { size: A4; margin: 14mm 12mm; }
@media print { body { padding: 0; } .doc { max-width: none; } h3, h4 { break-after: avoid; } tr { break-inside: avoid; } }
`;
async function reportDocument(box) {
  const copy = box.cloneNode(true);
  copy.querySelectorAll(".report-tools, .no-save, .saju-ai-out[hidden], button").forEach((el) => el.remove());
  const title = box.querySelector("h2")?.textContent || "개원 입지 보고서";
  const day = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  let css = "";
  try { css = await (await fetch("style.css")).text(); } catch (e) { console.warn(e); }
  const html = `<!doctype html>
<html lang="ko" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${css}${DOC_CSS}</style></head>
<body><article class="report doc"><div class="doc-cover"><p class="doc-brand">학원 입지 가이드 · 개원 입지 보고서 · ${day}</p></div>${copy.innerHTML}
<p class="doc-foot">공공데이터(교육청·통계청·한국부동산원 등)로 만든 참고 자료이며 현장 조사를 대신하지 않습니다. 사주 풀이는 참고용입니다. 작성일 ${day}.</p></article></body></html>`;
  const base = title.replace(/^개원 입지 보고서:\s*/, "개원입지보고서_").replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "_");
  return { html, base: `${base}_${new Date().toISOString().slice(0, 10)}` };
}
// 외부 라이브러리는 PDF를 만들 때만 불러옵니다.
const PDF_LIBS = ["https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js", "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"];
let pdfLibsReady = null;
function loadPdfLibs() {
  pdfLibsReady ??= Promise.all(PDF_LIBS.map((src) => new Promise((ok, fail) => {
    const tag = document.createElement("script");
    tag.src = src; tag.onload = ok; tag.onerror = () => fail(new Error(`불러오지 못함: ${src}`));
    document.head.append(tag);
  }))).catch((e) => { pdfLibsReady = null; throw e; });
  return pdfLibsReady;
}
// 문서를 A4 폭으로 그린 뒤, 문단·표 줄 경계에서 쪽을 나눠 PDF로 만듭니다.
async function reportPdf(html) {
  await loadPdfLibs();
  const WIDTH = 760;
  const frame = document.createElement("iframe");
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${WIDTH + 40}px;height:1000px;border:0;visibility:hidden`;
  document.body.append(frame);
  try {
    await new Promise((ok) => { frame.onload = ok; frame.srcdoc = html.replace("<body>", '<body style="padding:0 20px">'); });
    const doc = frame.contentDocument;
    await doc.fonts?.ready;
    const root = doc.querySelector(".doc");
    const top0 = root.getBoundingClientRect().top;
    const cuts = new Set();
    root.querySelectorAll(".doc > *, .doc tr, .doc li, .report-dong > *, .saju-type, .doc-cover").forEach((el) => {
      const r = el.getBoundingClientRect();
      cuts.add(Math.round(r.top - top0)); cuts.add(Math.round(r.bottom - top0));
    });
    const total = Math.ceil(root.getBoundingClientRect().height);
    const scale = 2;
    const canvas = await window.html2canvas(root, { scale, backgroundColor: "#ffffff", windowWidth: WIDTH + 40, logging: false });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const margin = 12, pageW = 210 - margin * 2, pageH = 297 - margin * 2 - 8;
    const pxPerMm = root.getBoundingClientRect().width / pageW;
    const pagePx = Math.floor(pageH * pxPerMm);
    const sorted = [...cuts].filter((c) => c > 0 && c <= total).sort((a, b) => a - b);
    let start = 0, page = 0;
    while (start < total) {
      let end = Math.min(start + pagePx, total);
      if (end < total) {
        const fit = sorted.filter((c) => c > start + pagePx * 0.5 && c <= start + pagePx).pop();
        if (fit) end = fit;
      }
      const slice = document.createElement("canvas");
      slice.width = canvas.width; slice.height = Math.ceil((end - start) * scale);
      slice.getContext("2d").drawImage(canvas, 0, Math.floor(start * scale), canvas.width, slice.height, 0, 0, canvas.width, slice.height);
      if (page) pdf.addPage();
      pdf.addImage(slice.toDataURL("image/jpeg", 0.85), "JPEG", margin, margin, pageW, (end - start) / pxPerMm);
      page += 1;
      pdf.setFontSize(8); pdf.setTextColor(140);
      pdf.text(String(page), 105, 297 - 7, { align: "center" });
      start = end;
    }
    return pdf.output("blob");
  } finally {
    frame.remove();
  }
}
// 이 링크(Claude 화면) 안에서는 저장 확인 창을 거치고, 일반 브라우저에서는 바로 내려받습니다. 둘 다 사용하는 컴퓨터에 저장됩니다.
async function saveFile(filename, data, type) {
  const downloads = window.claude?.use ? await window.claude.use("downloads").catch(() => null) : null;
  if (downloads) {
    try { await downloads.save({ filename, data }); return "저장했습니다"; }
    catch (e) { return e?.code === "declined" ? "저장을 취소했습니다" : e?.code === "rate_limited" ? "잠시 뒤 다시 눌러 주세요" : "여기서는 저장할 수 없습니다"; }
  }
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return "저장했습니다";
}
async function saveReport(btn) {
  const kind = btn.dataset.kind || "pdf";
  const label = btn.textContent;
  const say = (t) => { btn.textContent = t; setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 2500); };
  btn.disabled = true;
  try {
    const { html, base } = await reportDocument(btn.closest(".report"));
    if (kind === "html") return say(await saveFile(`${base}.html`, html, "text/html;charset=utf-8"));
    btn.textContent = "PDF 만드는 중…";
    const blob = await reportPdf(html);
    say(await saveFile(`${base}.pdf`, blob, "application/pdf"));
  } catch (e) {
    console.warn(e);
    say(kind === "pdf" ? "PDF를 만들지 못했습니다. 웹 문서로 저장해 보세요" : "저장하지 못했습니다");
  }
}
function copyReport(btn) {
  const box = btn.closest(".report");
  const text = [...box.children].filter((el) => !el.classList.contains("report-tools")).map((el) => el.innerText).join("\n\n");
  const done = () => { btn.textContent = "복사했습니다"; setTimeout(() => { btn.textContent = "글 복사"; }, 2000); };
  navigator.clipboard?.writeText(text).then(done).catch(() => {
    const range = document.createRange(); range.selectNodeContents(box);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    btn.textContent = "선택했습니다. 복사하세요";
  });
}

// 개원 보고서 만들기: 경력을 종류별로 받아 학원가를 우대할지, 뺄지 정합니다.
const rpEls = {
  form: document.getElementById("rp-form"),
  birth: document.getElementById("rp-birth"),
  btime: document.getElementById("rp-btime"),
  cal: document.getElementById("rp-cal"),
  gender: document.getElementById("rp-gender"),
  towns: document.getElementById("rp-towns"),
  subject: document.getElementById("rp-subject"),
  level: document.getElementById("rp-level"),
  budget: document.getElementById("rp-budget"),
  rent: document.getElementById("rp-rent"),
  big: document.getElementById("rp-big"),
  small: document.getElementById("rp-small"),
  own: document.getElementById("rp-own"),
  tutor: document.getElementById("rp-tutor"),
  record: document.getElementById("rp-record"),
  regions: document.getElementById("rp-regions"),
  status: document.getElementById("rp-status"),
  report: document.getElementById("rp-report"),
};
const manwon = (n) => (n >= 10000 ? `${fmt(Math.floor(n / 10000))}억${n % 10000 ? ` ${fmt(n % 10000)}만` : ""}원` : `${fmt(n)}만원`);
function careerProfile(budget) {
  const num = (el) => Math.max(0, Number(el.value) || 0);
  const big = num(rpEls.big), small = num(rpEls.small), own = num(rpEls.own), tutor = num(rpEls.tutor);
  const record = rpEls.record.checked;
  const total = big + small + own + tutor;
  const famous = big >= 3 || (big >= 1 && record);
  const pref = famous ? "hub" : total < 3 ? "away" : null;
  const parts = [["대형·유명 학원", big], ["중소형 학원", small], ["직접 운영", own], ["과외·공부방", tutor]].filter(([, y]) => y).map(([n, y]) => `${n} ${y}년`);
  const label = `${parts.join(", ") || "경력 없음"}${record ? " · 실적·따라올 수강생 있음" : ""}`;
  const strategy = [];
  if (pref === "hub") {
    strategy.push(`대형·유명 학원 경력(${big}년${record ? ", 실적 있음" : ""})이 있어 이름값으로 학생을 모을 수 있다고 보고, <strong>학원가를 우대</strong>했습니다. 입시·보습 학원 ${BIG_HUB}곳 이상이 모인 대형 학원가와, 매출로 보아 다른 동 학생이 찾아오는 동에 점수 +${HUB_BONUS}을 더했습니다(점수 단위는 학생−학원 증가 차이 %p와 같습니다).`);
    strategy.push("학원가는 수요가 크고 학부모가 학원을 고르러 오는 곳이라 경력과 실적이 바로 통하지만, 임대료와 이름난 학원과의 경쟁이 셉니다. 아래 표의 월 임대료와 각 동의 대표 학원을 함께 보세요.");
  } else if (pref === "away") {
    strategy.push(`경력이 모두 합해 ${total}년이라, 이름난 학원과 정면으로 겨뤄야 하는 <strong>학원가는 뺐습니다</strong>(대형 학원가와 다른 동 학생이 찾아오는 동). 동네 학생이 동네 학원에 다니는 곳에서 꼼꼼한 관리로 자리 잡는 쪽이 유리합니다.`);
  } else {
    strategy.push(`대형·유명 학원 경력이 짧아 학원가를 따로 우대하지는 않았고, 비학원가와 학원가를 같은 기준으로 비교했습니다. 경력이 모두 합해 ${total}년이라 학원가를 빼지는 않았습니다.${budget === "small" ? " 다만 예산이 3천만원 미만이라 임대료 부담이 큰 대형 학원가는 뺐습니다." : ""}`);
  }
  if (own >= 3) strategy.push(`직접 운영 경력이 ${own}년이라 신도시처럼 처음부터 학생을 모아야 하는 곳도 무리가 적습니다.`);
  else if (own === 0 && total >= 1) strategy.push("직접 운영해 본 경험이 없으니 첫해에는 상담·홍보·행정에 드는 시간을 넉넉히 잡으세요.");
  return { big, small, own, tutor, record, total, pref, label, strategy };
}
// 사주: 계산은 saju.js(원장일지 만세력 계산기, saju/lib/saju-profile.ts)가 하고, 여기서는 입력 확인과 표시만 합니다.
const ELEMENTS = ["木", "火", "土", "金", "水"];
const ELEMENT_KO = { 木: "목(木)", 火: "화(火)", 土: "토(土)", 金: "금(金)", 水: "수(水)" };
let sajuReady = null;
function loadSaju() {
  sajuReady ??= new Promise((ok, fail) => {
    const tag = document.createElement("script");
    tag.src = "saju.js";
    tag.onload = () => ok(window.Saju);
    tag.onerror = () => { sajuReady = null; fail(new Error("사주 계산기를 불러오지 못했습니다")); };
    document.head.append(tag);
  });
  return sajuReady;
}
// 19850316, 1985.3.16 같은 입력도 1985-03-16 꼴로 맞춥니다. 음력 2월 30일처럼 양력에 없는 날도 넣을 수 있게 글자로 받습니다.
function normalizeBirth() {
  const digits = rpEls.birth.value.trim().match(/^(\d{4})\D*(\d{1,2})\D*(\d{1,2})\D*$/) || rpEls.birth.value.trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  if (digits) rpEls.birth.value = `${digits[1]}-${digits[2].padStart(2, "0")}-${digits[3].padStart(2, "0")}`;
  const t = rpEls.btime.value.trim().match(/^(\d{1,2})\D?(\d{2})$/);
  if (t) rpEls.btime.value = `${t[1].padStart(2, "0")}:${t[2]}`;
}
function sajuInputError() {
  normalizeBirth();
  const date = rpEls.birth.value.trim();
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "생년월일은 1985-03-16처럼 넣어 주세요.";
  const [y, m, d] = date.split("-").map(Number);
  if (!(y >= 1900 && y <= 2050)) return "생년월일은 1900~2050년 사이로 넣어 주세요.";
  if (rpEls.cal.value === "양력") {
    const t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return "없는 날짜입니다. 생년월일을 확인해 주세요.";
  } else if (!(m >= 1 && m <= 12 && d >= 1 && d <= 30)) return "음력 날짜는 1~12월, 1~30일로 넣어 주세요.";
  const time = rpEls.btime.value.trim();
  if (time) {
    const [h, mi] = time.split(":").map(Number);
    if (!/^\d{2}:\d{2}$/.test(time) || h > 23 || mi > 59) return "출생시간은 07:30처럼 24시간제로 넣어 주세요. 모르면 비워 두세요.";
  }
  return "";
}
async function sajuFor() {
  if (!rpEls.birth.value) return null;
  const Saju = await loadSaju();
  const [date, time, cal, gender] = [rpEls.birth.value.trim(), rpEls.btime.value.trim(), rpEls.cal.value, rpEls.gender.value];
  const p = Saju.calculateProfile(date, time, cal, gender);
  let daeun = [];
  try { if (p.daeunStart != null) daeun = Saju.daeunTable(date, time, cal, gender, p.daeunStart); } catch (err) { console.warn(err); }
  const years = Saju.yearFlow(p.chart.day.stem, new Date().getFullYear(), 15);
  return { p, tg: Saju.tenGodProfile(p.chart), daeun, years, birthSolar: Saju.solarBirth(date, cal), input: `${date} ${time || "시간 모름"} ${cal} ${gender}` };
}
// 사주 풀이는 Claude가 씁니다. 여기서는 만세력 계산값을 표로 보여 주고 Claude에게 넘길 자료를 만듭니다.
// [한글 읽기, 오행, 그림, 성향, 학원에서는]
const STEM_INFO = {
  甲: ["갑", "木", "큰 나무", "곧게 위로 자라는 큰 나무처럼 앞장서고 큰 그림을 그리는 성향입니다", "학원의 방향과 커리큘럼을 먼저 크게 세우고 밀고 나갈 때 강합니다. 고집이 세 보일 수 있으니 학부모 의견을 듣는 창구(정기 상담, 설문)를 따로 두세요"],
  乙: ["을", "木", "풀과 덩굴", "어디서든 뿌리내리는 풀처럼 부드럽고 적응력이 좋은 성향입니다", "학생·학부모와 관계를 잘 맺어 오래 다니게 만드는 힘이 있습니다. 결정을 미루기 쉬우니 환불·보강 같은 원칙 몇 가지는 미리 정해 두세요"],
  丙: ["병", "火", "태양", "모두를 비추는 태양처럼 밝고 드러내는 성향입니다", "설명회와 상담에서 말로 사람을 끌어당기는 힘이 큽니다. 열정이 식지 않게 성적표, 후기처럼 성과를 눈에 보이게 보여 주는 장치를 만드세요"],
  丁: ["정", "火", "촛불", "가까운 곳을 오래 밝히는 촛불처럼 섬세하고 집중력 있는 성향입니다", "학생 한 명 한 명을 세심하게 챙기는 소수 정예 관리에 강합니다. 반이 커지면 꼼꼼함이 무너지기 쉬우니 반 정원을 정해 두세요"],
  戊: ["무", "土", "큰 산", "움직이지 않는 산처럼 묵직하게 믿음을 주는 성향입니다", "흔들리지 않는 신뢰감이 강점이라 한 동네에 오래 자리 잡는 학원에 맞습니다. 변화가 느릴 수 있으니 입시 제도와 교재 흐름은 따로 챙기세요"],
  己: ["기", "土", "논밭", "씨앗을 키워 내는 밭처럼 꼼꼼하게 기르는 성향입니다", "기초부터 차근차근 길러 내는 관리형 수업에 강합니다. 모든 일을 혼자 떠안기 쉬우니 맡길 수 있는 일은 조교나 앱에 맡기세요"],
  庚: ["경", "金", "바위와 쇠", "단단한 쇠처럼 원칙과 결단력이 분명한 성향입니다", "규칙과 기준이 분명한 엄격한 관리로 성적을 끌어올리는 데 강합니다. 딱딱하게 느껴질 수 있으니 상담에서는 칭찬을 먼저 하세요"],
  辛: ["신", "金", "보석", "다듬어진 보석처럼 예리하고 완성도를 따지는 성향입니다", "자료와 수업의 완성도가 높아 '깔끔하고 수준 높은 학원' 이미지를 만들기 좋습니다. 완벽주의로 지치지 않게 기준을 현실적으로 잡으세요"],
  壬: ["임", "水", "큰 강", "멀리 흘러가는 큰 강처럼 넓게 보고 흐름을 읽는 성향입니다", "여러 반·여러 과목으로 넓혀 가는 확장에 강합니다. 넓히기 전에 첫 반을 확실히 자리 잡게 하세요"],
  癸: ["계", "水", "비와 이슬", "조용히 스며드는 비처럼 차분하게 분석하고 기획하는 성향입니다", "학생별 데이터로 맞춤 전략을 짜는 데 강합니다. 드러내기를 아끼면 알려지지 않으니 홍보는 의식적으로 챙기세요"],
};
const BRANCH_KO = { 子: "자", 丑: "축", 寅: "인", 卯: "묘", 辰: "진", 巳: "사", 午: "오", 未: "미", 申: "신", 酉: "유", 戌: "술", 亥: "해" };
const hanjaKo = (t) => [...t].map((ch) => STEM_INFO[ch]?.[0] || BRANCH_KO[ch] || ch).join("");
const ganjiKo = hanjaKo;
const ELEMENT_PLAIN = { 木: "나무", 火: "불", 土: "흙", 金: "쇠", 水: "물" };
const GOD_ORDER = ["비견", "겁재", "식신", "상관", "편재", "정재", "편관", "정관", "편인", "정인"];
const GYEOK_NAME = { 비견: "건록격", 겁재: "양인·월겁격", 식신: "식신격", 상관: "상관격", 편재: "편재격", 정재: "정재격", 편관: "편관(칠살)격", 정관: "정관격", 편인: "편인격", 정인: "정인격" };
const fmt1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
// 그 십신이 어디서 왔는지: 년간 을, 월지 진(속 을) 같은 자리 목록
function godWhere(tg, god) {
  const seen = new Set();
  for (const it of tg.items.filter((x) => x.god === god)) seen.add(it.branch ? `${it.pos} ${hanjaKo(it.branch)}(${it.part !== "정기" ? "속 " : ""}${hanjaKo(it.char)})` : `${it.pos} ${hanjaKo(it.char)}`);
  return [...seen].join(", ");
}
function sajuAge(saju) {
  const now = new Date(), b = saju.birthSolar;
  return now.getFullYear() - b.year - ((now.getMonth() + 1 < b.month || (now.getMonth() + 1 === b.month && now.getDate() < b.day)) ? 1 : 0);
}
function sajuSection(saju) {
  const { p, tg } = saju;
  saju.age = sajuAge(saju);
  const cols = [["시주", p.chart.hour, "시"], ["일주", p.chart.day, "일"], ["월주", p.chart.month, "월"], ["년주", p.chart.year, "년"]];
  const stemGod = (k, v) => (k === "일" ? "나(일간)" : tg.items.find((it) => it.pos === `${k}간`)?.god || "");
  const hidden = (k) => tg.items.filter((it) => it.pos === `${k}지`);
  const cell = (v, f) => (v ? f(v) : "모름");
  return `<h3>사주로 본 학원 운영 (Claude 풀이, 참고)</h3>
    <p>입력: ${saju.input}. 아래 여덟 글자는 원장일지 만세력 계산기 그대로이고, 풀이는 이 값과 보정된 대운을 Claude가 읽어 씁니다.</p>
    <div class="table-wrap"><table class="report-table saju-chart"><thead><tr><th></th>${cols.map(([n]) => `<th>${n}</th>`).join("")}</tr></thead><tbody>
      <tr><th>천간</th>${cols.map(([, v, k]) => `<td>${cell(v, () => `<strong>${hanjaKo(v.stem)}(${v.stem})</strong><br>${stemGod(k, v)}`)}</td>`).join("")}</tr>
      <tr><th>지지</th>${cols.map(([, v, k]) => `<td>${cell(v, () => `<strong>${hanjaKo(v.branch)}(${v.branch})</strong><br>${hidden(k).find((it) => it.part === "정기")?.god || ""}`)}</td>`).join("")}</tr>
    </tbody></table></div>
    <div class="saju-ai no-save"><button type="button" class="report-ghost saju-ai-stop" hidden>멈추기</button><button type="button" class="report-ghost saju-ai-go" hidden>다시 풀이 받기</button></div>
    <div class="saju-ai-out">Claude 풀이를 준비하는 중입니다…</div>
    <p class="rec-note">사주 풀이는 참고용이며 입지 추천과 순위에는 쓰지 않습니다.</p>`;
}
// AI 풀이: 계산은 끝난 값만 넘기고, Claude에게는 날짜·나이를 다시 계산하지 말라고 합니다.
function sajuPrompt(saju, opts, profile) {
  const { p, tg } = saju;
  const pillars = [["년주", p.chart.year], ["월주", p.chart.month], ["일주", p.chart.day], ["시주", p.chart.hour]].map(([k, v]) => `${k} ${v ? `${v.korean}(${v.hanja})` : "모름(출생시간 미상)"}`).join(", ");
  const gods = GOD_ORDER.map((g) => `${g} ${fmt1(tg.scores[g] || 0)} [${godWhere(tg, g) || "없음"}]`).join("\n");
  const daeun = saju.daeun.map((d) => `${d.startAge}세(${saju.birthSolar.year + d.startAge}년)~ ${ganjiKo(d.ganji)}(${d.ganji}) 천간 ${d.stemGod}, 지지 ${d.branchGod}${saju.age != null && d.startAge <= saju.age && saju.age < d.startAge + 10 ? " ← 지금" : ""}`).join("\n");
  return `당신은 30년 경력의 사주명리 상담가이며 학원 경영 컨설팅도 해 온 사람입니다. 학원을 개원하려는 원장님의 사주를 보고, 아래 질문에만 현실적이고 구체적으로 답해 주세요. 이론 설명보다 "그래서 어떻게 하라"가 중요합니다.

[반드시 지킬 것]
- [계산값]을 그대로 쓰세요. 생년월일로 원국, 나이, 대운, 연도 간지를 다시 계산하지 마세요. 대운 시작 나이는 정확한 절입 시각으로 보정된 값이고, 연도별 간지와 십신도 아래 표를 쓰세요.
- 시기는 반드시 연도로 말하세요(예: "2027~2028년"). 아래 대운의 시작 연도와 연도별 흐름을 근거로 쓰세요.
- 각 답마다 근거를 한 줄로 붙이세요(예: "근거: 식신이 두 개 있고 재성으로 이어짐"). 근거는 짧게, 결론과 실천 조언은 자세하게.
- 사주를 모르는 사람도 읽게 쉬운 말로 쓰고, 전문 용어는 꼭 필요할 때만 괄호로 풀어 주세요.
- 신강·신약이나 용신을 장황하게 논하지 마세요. 판단이 갈리는 부분은 "이렇게도 볼 수 있다"고 한 줄로만 덧붙이세요.
- 어느 동네인지 같은 입지 추천은 하지 마세요(입지는 데이터로 따로 정합니다). 학원가·비학원가 성향만 답하세요.
- 겁주는 예언 대신 실천할 수 있는 조언으로 쓰세요.
- 마크다운 기호(#, *, |, -)는 쓰지 말고, 질문마다 "■ 제목"으로 시작하세요. 전체 5,000~7,000자.

[답할 질문, 이 순서로]
■ 1. 학원업이 나에게 맞는가 (맞는 점, 힘들 수 있는 점)
■ 2. 나는 어떤 원장인가 (1인형인지 시스템형인지, 직강형인지 관리형인지, 여러 면모가 섞였다면 비중까지)
■ 3. 어울리는 과목과 추가해도 좋은 과목 (지금 과목은 아래 개원 조건 참고. 지금 과목이 맞는지, 함께 넣으면 좋은 과목과 피할 과목, 넣는 시기)
■ 4. 학원가가 좋은가 비학원가가 좋은가 (이유와 각각을 골랐을 때의 운영 요령)
■ 5. 홍보는 입소문형인가 대대적 홍보형인가 (구체적인 홍보 방법 3~5가지)
■ 6. 언제 개원하면 좋은가 (앞으로 몇 년 중 좋은 해와 피할 해, 그해 안에서 준비 순서)
■ 7. 최고의 전성기는 언제 오는가 (연도 범위와 그때 해야 할 일)
■ 8. 확장이나 2관(분원)을 해도 되는 사주인가 (해도 된다면 언제, 어떤 방식으로, 조심할 점)
■ 9. 내가 보완해야 할 것 (구체적인 방법과 함께)
■ 10. 주기적으로 챙길 것 (학부모 상담 주기, 학생 관리 루틴, 나 자신의 관리 등 주간·월간·학기별로)

[계산값]을 그대로 쓰세요. 생년월일로 원국, 지장간, 나이, 대운 시작 나이를 다시 계산하지 마세요. 대운 시작 나이는 정확한 절입 시각으로 보정된 값입니다.
- 합·충·형·파·해, 12운성, 신살 같은 관계는 아래 여덟 글자와 대운 글자를 보고 직접 찾아 설명해도 됩니다(새로 계산하는 것이 아니라 주어진 글자를 읽는 것입니다).
- 신강·신약, 용신은 학파마다 판단이 다르므로 하나로 단정하지 마세요. 억부·조후·통관·병약 등 관점별로 "이 관점에서는 이렇게 본다"를 각각 보여 주고, 관점마다 결론이 다르면 그 차이가 학원 운영에서 무엇을 뜻하는지 설명하세요.
- 한 가지 꼬리표로 좁히지 말고 여러 기운과 조합이 함께 작용하는 모습을 엮어 설명하세요.
- 모든 판단에 근거 글자를 붙이세요. 예: "월지 진(辰) 속 을목(乙) 정인이 년간에 떠 있어…"
- 사주를 잘 모르는 사람도 읽을 수 있게, 전문 용어는 처음 나올 때 괄호로 쉽게 풀어 주세요.
- 학원 입지(어느 동네)는 추천하지 마세요. 입지는 데이터로 따로 정합니다.
- 단정적인 운명 예언이나 불안을 주는 표현은 피하고, 실천할 수 있는 조언으로 바꿔 쓰세요.
- 마크다운 기호(#, *, |, -)는 쓰지 말고, 큰 제목은 "■ 제목", 작은 제목은 "▶ 제목"으로 쓰세요. 전체 7,000~9,000자로 충분히 자세히 쓰세요.

[다룰 내용과 순서]
■ 1. 원국 읽기
  ▶ 네 기둥(년·월·일·시)을 하나씩: 천간과 지지, 지지 속 지장간, 그 자리가 뜻하는 것(조상·사회, 부모·직업 환경, 나와 배우자, 자녀·말년·결과물), 일간에게 어떤 십신인지
  ▶ 오행의 많고 적음과 계절(월지)로 본 사주의 온도와 습도
■ 2. 일간과 십신 배치
  ▶ 일간의 본성
  ▶ 강한 십신과 약한 십신, 천간에 드러난 것과 지지에 숨은 것의 차이
■ 3. 글자 사이의 관계: 천간합, 지지의 합·충·형·파·해(있는 것만), 그것이 성격과 일에 주는 영향
■ 4. 격국과 용신 후보 (관점별)
■ 5. 조합으로 본 해석: 식상생재, 관인상생, 재생관, 식신제살, 상관견관, 비겁탈재 등 이 사주에 실제로 있는 조합만 골라, 각각 학원에서 어떻게 나타나는지 예를 들어
■ 6. 대운별 흐름: 아래 대운을 하나씩 모두, 그 10년의 분위기와 원국과의 합·충, 학원을 하는 사람에게 주는 기회와 주의점. 특히 지금 대운과 다음 대운은 더 자세히
■ 7. 학원 운영에 적용
  ▶ 어떤 원장인가 (여러 면모를 함께)
  ▶ 수업과 학생 관리 스타일
  ▶ 학원가와 비학원가 중 어디서 힘을 내는 성향인가 (장단점)
  ▶ 홍보: 입소문형인가 대대적 홍보형인가, 구체적인 홍보 방법
  ▶ 운영 규모: 1인 원장인가 강사 여럿 시스템인가, 강사·직원과 일하는 법
  ▶ 돈 관리와 조심할 점
  ▶ 개원과 확장에 좋은 시기
■ 8. 이 사주에 맞는 개원 첫해 실천 7가지 (구체적으로)

[계산값]
입력: ${saju.input}
원국: ${pillars}
일간: ${p.chart.day.hanja[0]} (${STEM_INFO[p.chart.day.stem][2]})
오행 개수: ${ELEMENTS.map((e) => `${e} ${p.counts[e]}`).join(", ")}
십신 무게(월지 2배, 일지 1.5배, 지장간은 날수 비율로 나눔) [어디에]:
${gods}
지장간(여기→중기→정기, 각 십신): ${[...new Set(tg.items.filter((it) => it.branch).map((it) => it.pos))].map((pos) => `${pos} ${tg.items.find((it) => it.pos === pos).branch}: ${tg.items.filter((it) => it.pos === pos).map((it) => `${it.char} ${it.god}`).join(", ")}`).join(" / ")}
천간에 뜨고 지지에 뿌리 있는 십신: ${tg.rooted.map((r) => `${r.god}(${r.pos} ${r.char})`).join(", ") || "없음"}
격국 후보(월지 기준, 월지 속 글자 중 천간에 뜬 것 우선): ${GYEOK_NAME[tg.gyeok.god]} — 월지 ${p.chart.month.branch} 속 ${tg.gyeok.char}(${tg.gyeok.god})${tg.gyeok.shown ? ", 천간에 뜸" : ""}
지지 충: ${tg.clashes.map((c) => `${c.a}·${c.b} ${c.pair}`).join(", ") || "없음"}
대운(시작 나이는 보정값, 시작 연도는 양력 생년 + 시작 나이):
${daeun}
연도별 흐름(세운, 연도 간지와 일간 기준 십신):
${saju.years.map((y) => `${y.year}년 ${ganjiKo(y.ganji)}(${y.ganji}) 천간 ${y.stemGod}, 지지 ${y.branchGod}`).join("\n")}
지금 만 나이: ${saju.age ?? "알 수 없음"}

[원장님 개원 조건]
과목 ${SUBJECT_LABELS[opts.subject]}, 대상 ${LEVEL_LABELS[opts.level]}, ${profile ? `경력은 ${profile.label}, 예산 ${profile.budgetText}` : ""}`;
}
async function runSajuAi(box, saju, opts, profile, fresh = false) {
  const go = box.querySelector(".saju-ai-go"), stop = box.querySelector(".saju-ai-stop");
  const out = box.nextElementSibling;
  const sample = await window.claude?.use?.("sample").catch(() => null);
  if (!sample) { out.textContent = "Claude 풀이는 Claude 화면에서 이 보고서를 만들 때 자동으로 써집니다. 지금 화면에서는 Claude에 연결할 수 없어 위 계산값만 보여 드립니다."; return; }
  const ctl = new AbortController();
  go.hidden = true; stop.hidden = false;
  // 첫 글자가 나올 때까지 지난 시간을 보여 줘, 멈춘 것이 아니라 생각 중임을 알립니다.
  const t0 = Date.now();
  let started = false;
  const waiting = () => {
    const sec = Math.round((Date.now() - t0) / 1000);
    out.textContent = `Claude가 사주를 깊이 살펴보는 중입니다… (${sec}초 지남)\n\n아직 끝난 것이 아닙니다. 열 가지 질문에 자세히 답하는 풀이라 첫 글자가 나오기까지 1~3분쯤 걸리고, 그 뒤 몇 분에 걸쳐 이어서 써집니다. 이 화면을 닫지 말고 기다려 주세요.\n처음 한 번은 화면 위쪽에 Claude 사용을 허락할지 묻는 창이 뜹니다. 허락해야 풀이가 시작됩니다.`;
  };
  waiting();
  const timer = setInterval(() => { if (!started) waiting(); }, 1000);
  stop.onclick = () => ctl.abort();
  let finished = false;
  try {
    const { truncated } = await sample(sajuPrompt(saju, opts, profile), { modelTier: "complex", effort: "medium", cache: fresh ? false : { gcTime: 86400000 }, signal: ctl.signal, onText: ({ text }) => { started = true; out.textContent = text; } });
    if (truncated) out.textContent += "\n\n(길이 제한으로 여기서 끊겼습니다.)";
    finished = true;
  } catch (e) {
    out.textContent = e.text ?? "";
    const why = { cancelled: "풀이를 멈췄습니다.", not_granted: "Claude 사용을 허락하지 않아 풀이를 받지 못했습니다.", sampling_disabled: "이 계정에서는 Claude를 쓸 수 없습니다.", rate_limited: "요청이 많아 잠시 뒤 '다시 풀이 받기'를 눌러 주세요.", refused: "Claude가 이 요청에 답하지 않았습니다.", session_expired: "다시 로그인한 뒤 '다시 풀이 받기'를 눌러 주세요." }[e.code];
    out.textContent += `${out.textContent ? "\n\n" : ""}${why || "풀이를 받지 못했습니다. 잠시 뒤 '다시 풀이 받기'를 눌러 주세요."}`;
    if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(e.code)) { stop.hidden = true; return; }
  } finally {
    clearInterval(timer);
    stop.hidden = true;
  }
  go.hidden = false;
  go.textContent = finished ? "새로 풀이 받기" : "다시 풀이 받기";
  go.onclick = () => runSajuAi(box, saju, opts, profile, true);
}
// 보고서가 그려지면 만세력 계산값을 Claude에게 바로 보내 풀이를 받습니다(보고서 만들기 버튼이 요청입니다).
function wireSajuAi(target, report) {
  const box = target.querySelector(".saju-ai");
  if (box && report.saju) runSajuAi(box, report.saju, report.opts, report.profile);
}
function fillReportRegions() {
  const provinces = [...new Set(allRegions.map((r) => r.province))];
  rpEls.regions.innerHTML = provinces.map((p) => `<div class="rp-prov"><p class="rp-prov-name">${p} <label class="rp-check rp-all"><input type="checkbox" data-prov="${p}"> ${p} 전체</label></p><div class="rp-list">${allRegions
    .filter((r) => r.province === p)
    .map((r) => `<label class="rp-check"><input type="checkbox" value="${r.id}"> ${r.name.replace(p + " ", "")}</label>`).join("")}</div></div>`).join("");
}
// 시·도 전체 칸을 누르면 그 아래 구·시를 한꺼번에 고르고, 하나씩 바꾸면 전체 칸도 따라 바뀝니다.
function syncReportRegions(e) {
  const box = e.target.closest(".rp-prov");
  if (!box) return;
  const all = box.querySelector(".rp-all input");
  const items = [...box.querySelectorAll(".rp-list input")];
  if (e.target === all) items.forEach((i) => { i.checked = all.checked; });
  const on = items.filter((i) => i.checked).length;
  all.checked = on === items.length;
  all.indeterminate = on > 0 && on < items.length;
}
async function runReportMaker(e) {
  e.preventDefault();
  const money = Math.max(0, Number(rpEls.budget.value) || 0);
  const budget = money < 3000 ? "small" : money < 10000 ? "mid" : "large";
  const profile = careerProfile(budget);
  profile.budgetText = `${manwon(money)} (${BUDGET_LABEL[budget].replace(/^[^(]*\(/, "").replace(")", "")} 규모로 봄)`;
  const opts = {
    subject: rpEls.subject.value, level: rpEls.level.value, years: profile.total, budget,
    hubPref: profile.pref, rentLimit: Number(rpEls.rent.value) || 0,
  };
  const sajuError = sajuInputError();
  if (sajuError) { rpEls.status.textContent = sajuError; rpEls.birth.focus(); return; }
  const picked = [...rpEls.regions.querySelectorAll(".rp-list input:checked")].map((i) => i.value);
  const townsOnly = rpEls.towns.checked;
  const targets = (picked.length ? allRegions.filter((r) => picked.includes(r.id)) : allRegions).filter((r) => !townsOnly || NEW_TOWNS[r.id]);
  opts.townsOnly = townsOnly;
  if (!targets.length) { rpEls.status.textContent = "고른 시·구 안에 신도시가 없습니다. 시·구를 더 고르거나 '신도시 동만 보기'를 끄세요."; return; }
  const wholeProv = [...rpEls.regions.querySelectorAll(".rp-all input:checked")].map((i) => i.dataset.prov);
  const names = [...wholeProv.map((p) => `${p} 전체`), ...targets.filter((r) => !wholeProv.includes(r.province)).map((r) => shortRegion(r.name))];
  const scopeName = (picked.length ? (names.length > 3 ? `${names.slice(0, 3).join("·")} 외 ${names.length - 3}곳` : names.join("·")) : "서울·경기·인천") + (townsOnly ? " 신도시" : "");
  rpEls.status.textContent = `${fmt(targets.length)}개 구·시 자료를 읽는 중…`;
  rpEls.report.hidden = true;
  const regionsData = await Promise.all(targets.map((r) => loadRegion(r.id)));
  const res = recommend(regionsData, opts);
  if (current) setRegionContext(current);
  opts.avg = res.avg;
  const rules = [`${LEVEL_LABELS[opts.level]} ${REC_MIN_STUDENTS}명 미만인 동 ${fmt(res.skipped.small)}곳`, `위험지역 ${fmt(res.skipped.risk)}곳`];
  if (res.skipped.hub) rules.push(`대형 학원가 ${fmt(res.skipped.hub)}곳(${profile.pref === "away" ? "경력 3년 미만" : "예산 3천만원 미만"})`);
  if (res.skipped.flowIn) rules.push(`다른 동 학생이 찾아오는 학원가 ${fmt(res.skipped.flowIn)}곳(경력 3년 미만)`);
  if (res.skipped.rent) rules.push(`월 임대료 어림이 한도 ${fmt(opts.rentLimit)}만원을 넘는 동 ${fmt(res.skipped.rent)}곳`);
  if (res.skipped.nodata) rules.push(`학생 증감 비교 자료가 없는 동 ${fmt(res.skipped.nodata)}곳`);
  if (!res.top.length) {
    rpEls.status.textContent = `조건에 맞는 동이 없습니다. 지역을 넓히거나 임대료 한도를 올려 보세요. (뺀 곳: ${rules.join(", ")})`;
    return;
  }
  let saju = null;
  rpEls.status.textContent = "";
  try { saju = await sajuFor(); } catch (err) {
    console.warn(err);
    rpEls.status.textContent = "사주를 계산하지 못해 사주 없이 보고서를 만들었습니다. 음력이면 그 달에 그 날짜가 있는지 확인해 주세요.";
  }
  showReport(rpEls.report, { res, opts, scopeName, rules, profile, saju });
}

async function openArea(btn) {
  els.province.value = btn.dataset.province;
  fillRegions();
  els.region.value = btn.dataset.region;
  els.subject.value = recEls.subject.value;
  els.level.value = recEls.level.value;
  await update();
  const item = [...els.ranking.querySelectorAll(".rank-name")].find((n) => n.textContent.replace(/^\d+/, "").startsWith(btn.dataset.name));
  (item?.closest("li") || els.ranking).scrollIntoView({ behavior: "smooth", block: "start" });
}

// 신도시 이름으로 고르면 그 구·시를 열고 해당 동으로 내려갑니다. 위례처럼 여러 구·시에 걸치면 따로 나옵니다.
function fillTowns() {
  const sel = document.getElementById("town");
  const groups = {};
  for (const [regionId, dongs] of Object.entries(NEW_TOWNS)) {
    const region = allRegions.find((r) => r.id === regionId);
    if (!region) continue;
    for (const [dong, label] of Object.entries(dongs)) {
      const town = label.replace(" 일부", "");
      const key = `${town}|${regionId}`;
      (groups[key] ||= { town, region, dongs: [] }).dongs.push(dong);
    }
  }
  const items = Object.entries(groups).sort((a, b) => a[1].town.localeCompare(b[1].town, "ko"));
  sel.innerHTML += items.map(([key, g]) => `<option value="${key}">${g.town} · ${shortRegion(g.region.name)} (${g.dongs.join(", ")})</option>`).join("");
  sel.addEventListener("change", async () => {
    const g = groups[sel.value];
    if (!g) return;
    els.province.value = g.region.province;
    fillRegions();
    els.region.value = g.region.id;
    await update();
    const item = [...els.ranking.querySelectorAll(".rank-name")].find((n) => g.dongs.some((d) => n.textContent.replace(/^\d+/, "").startsWith(d)));
    (item?.closest("li") || els.ranking).scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

// 추천 범위에 구·시 하나만 고르는 항목을 시·도별로 붙입니다.
function fillRecScope() {
  const provinces = [...new Set(allRegions.map((r) => r.province))];
  recEls.scope.insertAdjacentHTML("beforeend", provinces.map((p) => `<optgroup label="${p} 안 구·시 하나">${allRegions
    .filter((r) => r.province === p)
    .map((r) => `<option value="region:${r.id}">${r.name.replace(p + " ", "")}</option>`).join("")}</optgroup>`).join(""));
}

function fillRegions() {
  const p = els.province.value;
  els.region.innerHTML = allRegions
    .filter((r) => r.province === p)
    .map((r) => `<option value="${r.id}">${r.name.replace(p + " ", "")}</option>`)
    .join("");
}

async function update() {
  const data = await loadRegion(els.region.value);
  current = data;
  render(data);
}

async function init() {
  let regions = [];
  try {
    regions = await fetchJson("data/regions.json");
  } catch (e) {
    console.warn(e);
  }
  if (!regions.length) {
    els.empty.hidden = false;
    document.querySelector(".controls").hidden = true;
    return;
  }
  allRegions = regions;
  try {
    rent = indexRent(await fetchJson("data/rent.json"));
  } catch (e) {
    console.warn(e); // 임대료 자료가 없어도 나머지는 그대로 보입니다.
  }
  fillTowns();
  fillRecScope();
  fillReportRegions();
  rpEls.form.addEventListener("submit", runReportMaker);
  rpEls.regions.addEventListener("change", syncReportRegions);
  rpEls.report.addEventListener("click", (e) => {
    if (e.target.closest(".report-close")) { rpEls.report.hidden = true; rpEls.form.scrollIntoView({ block: "start" }); }
    const copy = e.target.closest(".report-copy");
    if (copy) copyReport(copy);
    const save = e.target.closest(".report-save");
    if (save) saveReport(save);
  });
  recEls.form.addEventListener("submit", runRecommend);
  recEls.result.addEventListener("click", (e) => {
    const btn = e.target.closest(".rec-open");
    if (btn) openArea(btn);
    if (e.target.closest(".rec-report-open")) showReport();
  });
  recEls.report.addEventListener("click", (e) => {
    if (e.target.closest(".report-close")) { recEls.report.hidden = true; recEls.result.scrollIntoView({ block: "start" }); }
    const copy = e.target.closest(".report-copy");
    if (copy) copyReport(copy);
    const save = e.target.closest(".report-save");
    if (save) saveReport(save);
  });
  const provinces = [...new Set(regions.map((r) => r.province))];
  els.province.innerHTML = provinces.map((p) => `<option value="${p}">${p}</option>`).join("");
  fillRegions();
  els.province.addEventListener("change", () => {
    fillRegions();
    update();
  });
  els.result.hidden = false;
  for (const el of [els.region, els.subject, els.level]) el.addEventListener("change", update);
  // 위쪽 줄에서 고르면 표는 바로 바뀌지만 화면 아래에 있어서, 보기 버튼으로 그 자리까지 내려갑니다.
  document.getElementById("view-go").addEventListener("click", () => els.result.scrollIntoView({ behavior: "smooth", block: "start" }));
  els.compareHead.addEventListener("click", (e) => {
    const key = e.target.closest("button")?.dataset.key;
    if (!key || !current) return;
    sortKey = key;
    render(current);
  });
  await update();
}

init();
