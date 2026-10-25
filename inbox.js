// 받은 상담 신청: 상담 신청 사이트(intake.html)가 구글 시트에 쌓은 신청을 불러와 개원 보고서 만들기 칸에 채우고 바로 보고서를 만듭니다.
// app.js의 rpEls, fmt, LEVEL_LABELS를 씁니다. 시트 주소와 비밀번호는 이 브라우저에만 기억합니다.
// 받은 상담 신청과 맨 아래 계산 근거는 원장님 화면에서만 보입니다. 주소 끝에 #원장을 붙여 한 번 열면 이 브라우저가 기억하고,
// #손님으로 열면 다시 감춥니다. Claude 안에서 연 가이드는 원장님만 볼 수 있어 늘 보입니다.
function ibIsOwner() {
  const hash = decodeURIComponent(location.hash.slice(1));
  try {
    if (hash === "원장") localStorage.setItem("owner", "1");
    if (hash === "손님") localStorage.removeItem("owner");
    if (hash === "원장" || hash === "손님") history.replaceState(null, "", location.pathname + location.search);
    return !!window.claude || localStorage.getItem("owner") === "1";
  } catch (e) { return !!window.claude || hash === "원장"; }
}
let ibOwner = ibIsOwner();
document.querySelectorAll(".owner-only").forEach((el) => { el.hidden = !ibOwner; });
window.addEventListener("hashchange", () => {
  ibOwner = ibIsOwner();
  document.querySelectorAll(".owner-only").forEach((el) => { el.hidden = !ibOwner; });
});
const ibEls = Object.fromEntries(["box", "url", "key", "load", "status", "list", "paste", "apply"].map((k) => [k, document.getElementById(`inbox-${k}`)]));
const IB_SUBJECT = { math: "수학", english: "영어", korean: "국어·논술", science: "과학", all: "입시·보습 전체" };
let ibItems = [];

const ibStore = {
  get(k) { try { return localStorage.getItem(`inbox-${k}`) || ""; } catch (e) { return ""; } },
  set(k, v) { try { localStorage.setItem(`inbox-${k}`, v); } catch (e) { /* 기억 못 해도 이번에는 됩니다 */ } },
};

function ibEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function ibArea(d) {
  const names = [...(d.provinces || []).map((p) => `${p} 전체`), ...(d.regions || []).filter((r) => !(d.provinces || []).some((p) => r.startsWith(p.slice(0, 2)))).map((r) => r.replace(/^[^-]+-/, ""))];
  return (names.length > 4 ? `${names.slice(0, 4).join("·")} 외 ${names.length - 4}곳` : names.join("·") || "서울·경기·인천 전체") + (d.towns ? " 신도시" : "");
}
function ibRender() {
  if (!ibItems.length) { ibEls.list.innerHTML = ""; return; }
  ibEls.list.innerHTML = ibItems.map((it, i) => {
    const d = it.data;
    const when = it.receivedAt ? new Date(it.receivedAt).toLocaleDateString("ko-KR", { month: "long", day: "numeric" }) : "";
    const career = [["대형", d.big], ["중소형", d.small], ["운영", d.own], ["과외", d.tutor]].filter(([, y]) => y > 0).map(([k, y]) => `${k} ${y}년`).join(", ") || "경력 없음";
    return `<li>
      <div class="rec-head"><span>${ibEscape(d.name || "이름 없음")} <span class="rec-note">${ibEscape(d.phone || "")}</span></span><span class="rec-note">${ibEscape(when)}</span></div>
      <p class="rec-note">${IB_SUBJECT[d.subject] || ""} · ${LEVEL_LABELS[d.level] || ""} · 예산 ${fmt(d.budget || 0)}만원${d.rent ? ` · 임대료 ${fmt(d.rent)}만원까지` : ""} · ${ibEscape(career)}${d.record ? " · 실적 있음" : ""}</p>
      <p class="rec-note">지역: ${ibEscape(ibArea(d))}${d.saju ? " · 사주 풀이 원함" : ""}</p>
      ${d.memo ? `<p class="rec-note">메모: ${ibEscape(d.memo)}</p>` : ""}
      ${it.note ? `<p class="rec-note">처리 메모: ${ibEscape(it.note)}</p>` : ""}
      <div class="inbox-actions"><button type="button" class="rec-go inbox-make" data-i="${i}">이 신청으로 보고서 만들기</button>${d.saju && !window.claude ? `<button type="button" class="inbox-copy" data-i="${i}">사주 풀이용으로 복사</button>` : ""}</div>
    </li>`;
  }).join("");
}

async function ibLoad(auto) {
  const url = ibEls.url.value.trim();
  const key = ibEls.key.value.trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) { ibEls.status.textContent = "시트 주소는 https://script.google.com/macros/s/…/exec 꼴입니다."; ibEls.url.focus(); return; }
  if (!key) { ibEls.status.textContent = "비밀번호를 넣어 주세요."; ibEls.key.focus(); return; }
  ibStore.set("url", url);
  ibStore.set("key", key);
  ibEls.status.textContent = "불러오는 중…";
  try {
    const out = await (await fetch(`${url}?key=${encodeURIComponent(key)}`)).json();
    if (!out.ok) { ibEls.status.textContent = out.error || "불러오지 못했습니다."; return; }
    ibItems = out.items || [];
    ibEls.status.textContent = ibItems.length ? `신청 ${fmt(ibItems.length)}건 (최근 순)` : "아직 들어온 신청이 없습니다.";
    ibRender();
  } catch (e) {
    console.warn(e);
    if (auto === true) { ibEls.status.textContent = "이 화면에서는 시트에 바로 연결할 수 없어요. 아래 '직접 붙여넣기'를 쓰세요."; return; }
    ibEls.status.textContent = "시트에 연결하지 못했습니다. 이 화면에서 바깥 주소 연결이 막혀 있을 수 있어요. 시트에서 그 신청 줄의 '원본' 칸을 복사해 아래 '직접 붙여넣기'에 넣어 주세요.";
  }
}

// 시트에서 복사한 '원본' 칸(또는 줄 전체)을 읽습니다. 복사할 때 따옴표가 두 겹으로 붙어도 읽습니다.
function ibParse(text) {
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s < 0 || e < s) return null;
  const raw = text.slice(s, e + 1);
  for (const t of [raw, raw.replace(/""/g, '"')]) {
    try { const d = JSON.parse(t); if (d && typeof d === "object" && d.subject) return d; } catch (err) { /* 다음 방법 */ }
  }
  return null;
}

// 신청 내용을 개원 보고서 만들기 칸에 그대로 넣고 보고서 만들기를 누릅니다.
function ibApply(d) {
  const set = (el, v) => { el.value = v == null ? "" : String(v); };
  set(rpEls.subject, d.subject); set(rpEls.level, d.level);
  set(rpEls.budget, d.budget || 0); set(rpEls.rent, d.rent);
  set(rpEls.big, d.big || 0); set(rpEls.small, d.small || 0); set(rpEls.own, d.own || 0); set(rpEls.tutor, d.tutor || 0);
  rpEls.record.checked = !!d.record;
  rpEls.towns.checked = !!d.towns;
  const want = new Set(d.regions || []);
  rpEls.regions.querySelectorAll(".rp-list input").forEach((i) => { i.checked = want.has(i.value); });
  rpEls.regions.querySelectorAll(".rp-all input").forEach((all) => {
    if ((d.provinces || []).includes(all.dataset.prov)) all.closest(".rp-prov").querySelectorAll(".rp-list input").forEach((i) => { i.checked = true; });
    const first = all.closest(".rp-prov").querySelector(".rp-list input");
    if (first) first.dispatchEvent(new Event("change", { bubbles: true })); // 전체 칸 표시를 맞춥니다.
  });
  const s = d.saju || {};
  set(rpEls.birth, s.birth); set(rpEls.btime, s.btime);
  set(rpEls.cal, s.cal || "양력"); set(rpEls.gender, s.gender || "남성");
  document.getElementById("report-maker").open = true;
  rpEls.form.scrollIntoView({ behavior: "smooth", block: "start" });
  rpEls.form.requestSubmit();
}

ibEls.url.value = ibStore.get("url") || window.INTAKE_URL || "";
ibEls.key.value = ibStore.get("key");
ibEls.load.addEventListener("click", () => ibLoad());
// 비밀번호를 한 번 넣어 두었으면 열 때마다 신청 목록을 바로 불러옵니다.
if (ibOwner && ibEls.url.value && ibEls.key.value) { ibEls.box.open = true; ibLoad(true); }
ibEls.list.addEventListener("click", (e) => {
  const btn = e.target.closest(".inbox-make");
  if (btn) ibApply(ibItems[Number(btn.dataset.i)].data);
  // Claude 밖(GitHub 주소)에서는 사주 풀이가 안 나오니, Claude 가이드의 '직접 붙여넣기'에 넣을 원본을 복사해 줍니다.
  const copy = e.target.closest(".inbox-copy");
  if (copy) {
    const text = JSON.stringify(ibItems[Number(copy.dataset.i)].data);
    const done = (msg) => { copy.textContent = msg; setTimeout(() => { copy.textContent = "사주 풀이용으로 복사"; }, 2500); };
    navigator.clipboard?.writeText(text).then(() => done("복사했습니다. Claude 가이드에 붙여 넣으세요"))
      .catch(() => { ibEls.paste.value = text; ibEls.paste.closest("details").open = true; ibEls.paste.select(); done("아래 칸에 넣었습니다. Ctrl+C로 복사하세요"); });
  }
});
ibEls.apply.addEventListener("click", () => {
  const d = ibParse(ibEls.paste.value);
  if (!d) { ibEls.status.textContent = "붙여 넣은 글에서 신청 내용을 찾지 못했습니다. 시트의 '원본' 칸을 통째로 복사해 주세요."; return; }
  ibEls.status.textContent = `${d.name || "신청자"}님 신청으로 보고서를 만듭니다.`;
  ibApply(d);
});
