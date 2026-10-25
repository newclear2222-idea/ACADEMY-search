// 개원 상담 신청: 개원 보고서 만들기와 같은 항목을 받아 구글 시트(scripts/intake-sheet.gs)로 보냅니다.
// 받은 신청은 학원 입지 가이드의 '받은 상담 신청'에서 불러와 그대로 보고서를 만듭니다.
const inEls = Object.fromEntries(["form", "name", "phone", "email", "subject", "level", "budget", "rent", "big", "small", "own", "tutor", "record", "towns", "regions",
  "saju", "saju-fields", "birth", "btime", "cal", "gender", "memo", "agree", "website", "go", "status", "done"].map((k) => [k, document.getElementById(`in-${k}`)]));

async function fillRegions() {
  let regions = [];
  try { regions = await (await fetch("data/regions.json", { cache: "no-cache" })).json(); } catch (e) { console.warn(e); }
  if (!regions.length) { inEls.regions.innerHTML = `<p class="rec-note">지역 목록을 불러오지 못했습니다. 원하는 지역은 아래 '더 알려 주실 것'에 적어 주세요.</p>`; return; }
  const provinces = [...new Set(regions.map((r) => r.province))];
  inEls.regions.innerHTML = provinces.map((p) => `<div class="rp-prov"><p class="rp-prov-name">${p} <label class="rp-check rp-all"><input type="checkbox" data-prov="${p}"> ${p} 전체</label></p><div class="rp-list">${regions
    .filter((r) => r.province === p)
    .map((r) => `<label class="rp-check"><input type="checkbox" value="${r.id}"> ${r.name.replace(p + " ", "")}</label>`).join("")}</div></div>`).join("");
}
// 시·도 전체 칸과 구·시 칸을 서로 맞춥니다(가이드의 보고서 만들기와 같은 동작).
function syncRegions(e) {
  const box = e.target.closest(".rp-prov");
  if (!box) return;
  const all = box.querySelector(".rp-all input");
  const items = [...box.querySelectorAll(".rp-list input")];
  if (e.target === all) items.forEach((i) => { i.checked = all.checked; });
  const on = items.filter((i) => i.checked).length;
  all.checked = on === items.length;
  all.indeterminate = on > 0 && on < items.length;
}

// 19850316, 1985.3.16 같은 입력도 1985-03-16 꼴로 맞춥니다.
function normalizeBirth() {
  const digits = inEls.birth.value.trim().match(/^(\d{4})\D*(\d{1,2})\D*(\d{1,2})\D*$/) || inEls.birth.value.trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  if (digits) inEls.birth.value = `${digits[1]}-${digits[2].padStart(2, "0")}-${digits[3].padStart(2, "0")}`;
  const t = inEls.btime.value.trim().match(/^(\d{1,2})\D?(\d{2})$/);
  if (t) inEls.btime.value = `${t[1].padStart(2, "0")}:${t[2]}`;
}
function inputError() {
  if (!inEls.name.value.trim()) return [inEls.name, "이름을 넣어 주세요."];
  if ((inEls.phone.value.match(/\d/g) || []).length < 9) return [inEls.phone, "연락받을 휴대폰 번호를 넣어 주세요."];
  if (inEls.email.value && !inEls.email.checkValidity()) return [inEls.email, "이메일 주소를 확인해 주세요."];
  if (!inEls.saju.checked) return null;
  normalizeBirth();
  const date = inEls.birth.value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [inEls.birth, "생년월일은 1985-03-16처럼 넣어 주세요. 사주 풀이를 원하지 않으면 사주 칸 체크를 풀어 주세요."];
  const [y, m, d] = date.split("-").map(Number);
  if (!(y >= 1900 && y <= 2050)) return [inEls.birth, "생년월일은 1900~2050년 사이로 넣어 주세요."];
  if (inEls.cal.value === "양력") {
    const t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return [inEls.birth, "없는 날짜입니다. 생년월일을 확인해 주세요."];
  } else if (!(m >= 1 && m <= 12 && d >= 1 && d <= 30)) return [inEls.birth, "음력 날짜는 1~12월, 1~30일로 넣어 주세요."];
  const time = inEls.btime.value.trim();
  if (time) {
    const [h, mi] = time.split(":").map(Number);
    if (!/^\d{2}:\d{2}$/.test(time) || h > 23 || mi > 59) return [inEls.btime, "출생시간은 07:30처럼 24시간제로 넣어 주세요. 모르면 비워 두세요."];
  }
  return null;
}

// 가이드의 보고서 만들기 칸 이름과 같은 이름으로 보냅니다.
function collect() {
  const num = (el) => Math.max(0, Number(el.value) || 0);
  return {
    v: 1,
    name: inEls.name.value.trim(),
    phone: inEls.phone.value.trim(),
    email: inEls.email.value.trim(),
    subject: inEls.subject.value,
    level: inEls.level.value,
    budget: num(inEls.budget),
    rent: inEls.rent.value === "" ? "" : num(inEls.rent),
    big: num(inEls.big), small: num(inEls.small), own: num(inEls.own), tutor: num(inEls.tutor),
    record: inEls.record.checked,
    towns: inEls.towns.checked,
    regions: [...inEls.regions.querySelectorAll(".rp-list input:checked")].map((i) => i.value),
    provinces: [...inEls.regions.querySelectorAll(".rp-all input:checked")].map((i) => i.dataset.prov),
    saju: inEls.saju.checked ? { birth: inEls.birth.value.trim(), btime: inEls.btime.value.trim(), cal: inEls.cal.value, gender: inEls.gender.value } : null,
    memo: inEls.memo.value.trim(),
    website: inEls.website.value,
  };
}

async function submit(e) {
  e.preventDefault();
  const err = inputError();
  if (err) { inEls.status.textContent = err[1]; err[0].focus(); return; }
  if (!inEls.agree.checked) { inEls.status.textContent = "개인정보 수집·이용에 동의해 주셔야 신청할 수 있습니다."; inEls.agree.focus(); return; }
  if (!window.INTAKE_URL) { inEls.status.textContent = "아직 신청을 받을 준비가 되지 않았습니다. 잠시 뒤 다시 시도해 주세요."; return; }
  inEls.go.disabled = true;
  inEls.status.textContent = "보내는 중…";
  try {
    // 글자(text/plain)로 보내야 구글 Apps Script가 다른 사이트의 요청을 받아 줍니다.
    const res = await fetch(window.INTAKE_URL, { method: "POST", body: JSON.stringify(collect()) });
    const out = await res.json();
    if (!out.ok) throw new Error(out.error || "저장 실패");
    inEls.form.hidden = true;
    inEls.done.hidden = false;
    inEls.done.scrollIntoView({ block: "start" });
  } catch (err2) {
    console.warn(err2);
    inEls.status.textContent = "보내지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.";
    inEls.go.disabled = false;
  }
}

inEls.saju.addEventListener("change", () => { inEls["saju-fields"].hidden = !inEls.saju.checked; });
inEls.regions.addEventListener("change", syncRegions);
inEls.form.addEventListener("submit", submit);
fillRegions();
