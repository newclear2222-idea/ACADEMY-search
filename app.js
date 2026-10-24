const SUBJECT_LABELS = { math: "수학 학원", english: "영어 학원", all: "입시·보습 학원" };
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

// 숫자에서 읽을 수 있는 이유만 적습니다. 현장 조사나 설문이 아닙니다.
function reasonsFor(r, ctx) {
  const { subject, level } = ctx;
  const label = SUBJECT_LABELS[subject];
  const reasons = [];
  const shareS = ctx.totalStudents ? r.students / ctx.totalStudents : 0;
  const shareA = ctx.totalAcademies ? r.academies / ctx.totalAcademies : 0;

  if (r.students === 0) {
    reasons.push("이 동에는 해당 학교가 없어 학생 수가 0으로 잡힙니다. 학원이 있다면 주변 동 학생들이 찾아오는 곳입니다.");
  } else if (r.academies === 0) {
    reasons.push(`등록된 ${label}이 없습니다. 아직 비어 있는 시장일 수도, 수요가 작아 아무도 들어오지 않은 곳일 수도 있어 현장 확인이 필요합니다.`);
  } else if (shareA >= 0.15 && shareA >= shareS * 1.5) {
    reasons.push(`지역 ${label}의 ${pct(shareA)}가 이 동에 몰린 학원가입니다 (학생은 지역의 ${pct(shareS)}). 다른 동 학생도 찾아와서 실제 경쟁은 숫자보다 덜할 수 있지만, 새 학원이 눈에 띄기는 어렵습니다.`);
  } else if (shareA >= shareS * 1.3) {
    reasons.push(`학원 비중(지역의 ${pct(shareA)})이 학생 비중(${pct(shareS)})보다 높습니다.`);
  } else if (shareS >= shareA * 1.3) {
    reasons.push(`학생은 지역의 ${pct(shareS)}인데 ${label}은 ${pct(shareA)}뿐입니다. 학생들이 근처 학원가로 다니고 있을 수 있으니, 그 학원가와의 거리도 함께 보세요.`);
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

  // 학생 1명당 월 카드매출을 그 동 수강료와 견줍니다. 카드 결제만 잡혀 원래 낮게 나오므로 지역 전체 비율과 비교합니다.
  const flow = flowOf(r.area, ctx.regionFlow);
  if (flow) {
    const base = `학생 1명당 월 학원 카드매출 ${won(flow.spend)}, 보통 수강료 ${won(flow.fee)}`;
    if (flow.relative <= 0.6) reasons.push(`${base}입니다. 수강료에 비해 매출이 적습니다. 이 동 학생들이 다른 동 학원(근처 학원가)으로 많이 다니는 곳일 가능성이 큽니다. 카드 결제만 잡힌 숫자라 지역 평균과 비교해 판단했습니다.`);
    else if (flow.relative >= 1.6) reasons.push(`${base}입니다. 수강료에 비해 매출이 많습니다. 다른 동 학생들이 이 동 학원으로 찾아오는 곳일 가능성이 큽니다.`);
  }

  const change = studentChange(r.area, level);
  if (change !== null && change >= 0.1) reasons.push(`학생 수가 ${ctx.pastYear}년보다 ${signedPct(change)} 늘었습니다. 수요가 커지는 동네입니다.`);
  if (change !== null && change <= -0.1) reasons.push(`학생 수가 ${ctx.pastYear}년보다 ${signedPct(change)} 줄었습니다. 지금 숫자보다 앞으로 수요가 작아질 수 있습니다.`);
  const opened = r.area.opened?.["1y"][subject] || 0;
  if (r.academies >= 5 && opened / r.academies >= 0.2) reasons.push(`지금 ${label} ${fmt(r.academies)}곳 중 ${fmt(opened)}곳이 최근 1년 안에 문을 열었습니다. 새로 들어오는 학원이 많습니다.`);
  const bigApts = (r.area.newApts || []).filter((x) => x.households >= 500 && x.moveIn >= thisMonth());
  if (bigApts.length) reasons.push(`${bigApts.map((x) => `${x.name}(${fmt(x.households)}세대)`).join(", ")} 입주가 예정돼 있어 학생이 늘 수 있습니다.`);

  const areaFee = feeOf(r.area.fees, subject, level);
  if (areaFee && ctx.regionFee) {
    const diff = areaFee.median / ctx.regionFee.median - 1;
    if (Math.abs(diff) >= 0.1) {
      reasons.push(`등록 수강료가 지역 보통(${won(ctx.regionFee.median)})보다 ${pct(Math.abs(diff))} ${diff > 0 ? "높습니다" : "낮습니다"}.`);
    }
  }
  return reasons;
}

// 학생 1명당 월 카드매출 / 보통 수강료. relative는 지역 전체 같은 비율 대비 배수.
function flowOf(area, regionFlow) {
  const fee = area.fees?.all?.total?.[0];
  if (!area.sales || !fee || area.students.total < 500 || !regionFlow) return null;
  const spend = area.sales / 3 / area.students.total;
  return { spend, fee, relative: spend / fee / regionFlow };
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
  if (area.newApts?.length) {
    const items = area.newApts.slice(0, 4).map((x) => `${x.name} ${fmt(x.households)}세대 (${x.moveIn.replace("-", "년 ")}월 입주${x.moveIn < thisMonth() ? "" : " 예정"})`);
    html += `<div class="rank-sub">새 아파트: ${items.join(", ")}${area.newApts.length > 4 ? ` 외 ${area.newApts.length - 4}곳` : ""}</div>`;
  }
  return html;
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
  if (p.fee) bits.push(`보통 수강료 ${won(p.fee[0])}`);
  if (p.spend) bits.push(`학생 1명당 월 학원 카드매출 ${bigWon(p.spend[0])}`);
  return `<div class="rank-sub">교육열 추정 <strong>${fervorLabel(f.score)}</strong> (${f.score}점/100) · ${bits.join(" · ")}</div>`;
}

function flowTag(area, regionFlow) {
  const flow = flowOf(area, regionFlow);
  if (!flow) return "";
  if (flow.relative <= 0.6) return '<span class="tag warn">다른 동으로 다님</span>';
  if (flow.relative >= 1.6) return '<span class="tag good">다른 동에서 찾아옴</span>';
  return "";
}

// 서울 상권분석 추정매출은 분기 합계라 3으로 나눠 한 달로 봅니다. 과목과 상관없이 입시·보습 학원 전체로 나눕니다.
// 학원이 적은 동은 매출 집계(행정동)와 학원 주소(법정동)의 경계 차이에 크게 흔들려 보여주지 않습니다.
const MIN_ACADEMIES_FOR_SALES = 20;
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
  const withSales = data.areas.filter((a) => monthlyPerAcademy(a));
  const regionPerMonth = withSales.length
    ? withSales.reduce((t, a) => t + a.sales, 0) / 3 / withSales.reduce((t, a) => t + a.academies.all, 0)
    : 0;
  const salesAreas = data.areas.filter((a) => a.sales && a.students.total);
  const allFee = data.fees?.all?.total?.[0];
  const regionFlow = salesAreas.length && allFee
    ? salesAreas.reduce((t, a) => t + a.sales, 0) / 3 / salesAreas.reduce((t, a) => t + a.students.total, 0) / allFee
    : 0;
  const ctx = { subject, level, totalStudents, totalAcademies, regionFee, regionFlow, pastYear: data.pastYear };

  els.summary.innerHTML = `
    <div><div class="label">${data.region} ${LEVEL_LABELS[level]}</div><div class="value">${fmt(totalStudents)}명</div></div>
    <div><div class="label">${SUBJECT_LABELS[subject]}</div><div class="value">${fmt(totalAcademies)}곳</div></div>
    <div><div class="label">지역 평균, 학원 1곳당 학생</div><div class="value">${Number.isFinite(average) ? fmt(Math.round(average)) + "명" : "-"}</div></div>
    <div><div class="label">보통 수강료 (1인당, 등록 기준)</div><div class="value">${regionFee ? won(regionFee.median) : "-"}</div></div>${regionPerMonth ? `
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
      const feeText = fee ? ` · 보통 수강료 ${won(fee.median)} (${fmt(fee.count)}개 과정)` : "";
      const perMonth = monthlyPerAcademy(r.area);
      const salesText = data.salesPeriod && r.area.sales
        ? `<div class="rank-sub">학원 카드매출 추정: 동 전체 ${bigWon(r.area.sales)} (${data.salesPeriod})${perMonth ? ` · 학원 1곳당 <strong>월 ${bigWon(perMonth)}</strong>` : ""}${regionPerMonth && perMonth ? ` (지역 평균의 ${pct(perMonth / regionPerMonth)})` : ""}</div>`
        : "";
      const reasons = reasonsFor(r, ctx);
      const why = reasons.length
        ? `<details class="why"><summary>왜 이런 결과일까?</summary><ul>${reasons.map((t) => `<li>${t}</li>`).join("")}</ul></details>`
        : "";
      return `<li>
        <div class="rank-head">
          <span class="rank-name"><span class="no">${i + 1}</span>${r.area.name}${tag}${flowTag(r.area, ctx.regionFlow)}</span>
          <span class="rank-metric">${metric}</span>
        </div>
        <div class="bar"><span style="width:${width.toFixed(1)}%"></span></div>
        <div class="rank-sub">${LEVEL_LABELS[level]} ${fmt(r.students)}명 · ${SUBJECT_LABELS[subject]} ${fmt(r.academies)}곳 · 학교 ${schoolCount}곳${feeText}</div>
        ${salesText}
        ${fervorText(r.area)}
        ${trendText(r.area, data, subject, level)}
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
  els.sources.textContent = `${base}출처: ${data.sources.join(" / ")}.${skipped}`;
}

const COLUMNS = [
  { key: "name", label: "동", value: (r) => r.area.name, text: (r) => r.area.name },
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
    key: "newApts", label: "새 아파트",
    value: (r) => (r.area.newApts || []).reduce((t, x) => t + x.households, 0),
    text: (r) => { const n = (r.area.newApts || []).reduce((t, x) => t + x.households, 0); return n ? `${fmt(n)}세대` : "-"; },
  },
  {
    key: "apt", label: "아파트 평당가", aptOnly: true,
    value: (r) => r.area.apt?.[0] || 0,
    text: (r) => (r.area.apt ? bigWon(r.area.apt[0]) : "-"),
  },
  {
    key: "fee", label: "보통 수강료",
    value: (r) => r.fee?.median || 0,
    text: (r) => (r.fee ? won(r.fee.median) : "-"),
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
  const order = ["name", "sales", "fervor", "apt", "change", "opened", "newApts", "ratio", "fee", "students", "academies"];
  const hasApt = Boolean(data.aptPeriod);
  const hasTrend = Boolean(data.pastYear);
  const hasNewApts = data.areas.some((a) => a.newApts?.length);
  const cols = COLUMNS.filter((c) => (hasSales || !c.salesOnly) && (hasApt || !c.aptOnly)
    && (hasTrend || c.key !== "change") && (data.areas[0]?.opened || c.key !== "opened") && (hasNewApts || c.key !== "newApts")).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  if (!cols.some((c) => c.key === sortKey)) sortKey = "ratio";
  const list = rows.map((r) => ({ ...r, subject, level, fee: feeOf(r.area.fees, subject, level), perMonth: monthlyPerAcademy(r.area) }));
  const col = cols.find((c) => c.key === sortKey);
  list.sort((a, b) => {
    const x = col.value(a), y = col.value(b);
    return typeof x === "string" ? x.localeCompare(y, "ko") : y - x;
  });
  els.compareHead.innerHTML = `<tr>${cols
    .map((c) => `<th scope="col"${c.key === "name" ? "" : ' class="num"'} aria-sort="${c.key === sortKey ? (c.key === "name" ? "ascending" : "descending") : "none"}"><button type="button" data-key="${c.key}">${c.label}${c.key === sortKey ? " ▼" : ""}</button></th>`)
    .join("")}</tr>`;
  els.compareBody.innerHTML = list
    .map((r) => `<tr>${cols.map((c) => `<td${c.key === "name" ? "" : ' class="num"'}>${c.text(r)}</td>`).join("")}</tr>`)
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
  const provinces = [...new Set(regions.map((r) => r.province))];
  els.province.innerHTML = provinces.map((p) => `<option value="${p}">${p}</option>`).join("");
  const fillRegions = () => {
    const p = els.province.value;
    els.region.innerHTML = regions
      .filter((r) => r.province === p)
      .map((r) => `<option value="${r.id}">${r.name.replace(p + " ", "")}</option>`)
      .join("");
  };
  fillRegions();
  els.province.addEventListener("change", () => {
    fillRegions();
    update();
  });
  els.result.hidden = false;
  for (const el of [els.region, els.subject, els.level]) el.addEventListener("change", update);
  els.compareHead.addEventListener("click", (e) => {
    const key = e.target.closest("button")?.dataset.key;
    if (!key || !current) return;
    sortKey = key;
    render(current);
  });
  await update();
}

init();
