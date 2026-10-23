const SUBJECT_LABELS = { math: "수학 학원", english: "영어 학원", all: "입시·보습 학원" };
const LEVEL_LABELS = { total: "초·중·고 학생", elem: "초등학생", middle: "중학생", high: "고등학생" };

const els = {
  region: document.getElementById("region"),
  subject: document.getElementById("subject"),
  level: document.getElementById("level"),
  empty: document.getElementById("empty"),
  result: document.getElementById("result"),
  summary: document.getElementById("summary"),
  ranking: document.getElementById("ranking"),
  dongBody: document.querySelector("#dong-table tbody"),
  sources: document.getElementById("sources"),
};

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

  els.summary.innerHTML = `
    <div><div class="label">${data.region} ${LEVEL_LABELS[level]}</div><div class="value">${fmt(totalStudents)}명</div></div>
    <div><div class="label">${SUBJECT_LABELS[subject]}</div><div class="value">${fmt(totalAcademies)}곳</div></div>
    <div><div class="label">구 평균, 학원 1곳당 학생</div><div class="value">${Number.isFinite(average) ? fmt(Math.round(average)) + "명" : "-"}</div></div>`;

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
      return `<li>
        <div class="rank-head">
          <span class="rank-name"><span class="no">${i + 1}</span>${r.area.name}${tag}</span>
          <span class="rank-metric">${metric}</span>
        </div>
        <div class="bar"><span style="width:${width.toFixed(1)}%"></span></div>
        <div class="rank-sub">${LEVEL_LABELS[level]} ${fmt(r.students)}명 · ${SUBJECT_LABELS[subject]} ${fmt(r.academies)}곳 · 학교 ${schoolCount}곳</div>
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

async function update() {
  const data = await loadRegion(els.region.value);
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
  els.region.innerHTML = regions.map((r) => `<option value="${r.id}">${r.name}</option>`).join("");
  els.result.hidden = false;
  for (const el of [els.region, els.subject, els.level]) el.addEventListener("change", update);
  await update();
}

init();
