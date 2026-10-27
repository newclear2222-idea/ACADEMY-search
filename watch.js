// 동네 알림: 동별 카드의 '알림 받기'를 누른 동네를 구글 시트 '알림지역' 탭에 저장합니다.
// 매일 아침 GitHub 자동 작업(scripts/watch.py)이 그 동네의 공매 상가·LH 상가 공고·학원 문 닫음·인수·새 학원을 찾아 시트 '알림' 탭과 Gmail로 보냅니다.
// inbox.js의 ibOwner, ibStore, ibEscape, ibSheetId, IB_CLAUDE, IB_SHEETS를 씁니다. 원장님 화면에서만 보입니다.
const wEls = Object.fromEntries(["box", "towns", "status", "alerts", "reload"].map((k) => [k, document.getElementById(`watch-${k}`)]));
const W_MAX = 60;
let wTowns = [];
let wSaveTimer = null;

const wKey = (t) => `${t.region}|${t.town}`;
const wName = (t) => `${t.region.replace(/^[^-]+-/, "")} ${t.town}`;
function wRemember() { try { localStorage.setItem("watch-towns", JSON.stringify(wTowns)); } catch (e) { /* 이번에는 됩니다 */ } }
try { wTowns = JSON.parse(localStorage.getItem("watch-towns") || "[]").filter((t) => t && t.region && t.town); } catch (e) { wTowns = []; }

// app.js가 동별 카드를 그릴 때 부릅니다.
function watchButton(region, town) {
  if (!ibOwner) return "";
  const on = wTowns.some((t) => t.region === region && t.town === town);
  return `<button type="button" class="watch-btn${on ? " on" : ""}" data-region="${ibEscape(region)}" data-town="${ibEscape(town)}" aria-pressed="${on}">${on ? "🔔 알림 받는 중" : "🔔 알림 받기"}</button>`;
}

function wRender() {
  wEls.towns.innerHTML = wTowns.length
    ? wTowns.map((t, i) => `<li><span>${ibEscape(wName(t))}</span><button type="button" class="watch-del" data-i="${i}" aria-label="${ibEscape(wName(t))} 빼기">빼기</button></li>`).join("")
    : '<li class="rec-note">아직 고른 동네가 없습니다. 아래 동별 카드에서 🔔 알림 받기를 누르세요.</li>';
  document.querySelectorAll(".watch-btn").forEach((b) => {
    const on = wTowns.some((t) => t.region === b.dataset.region && t.town === b.dataset.town);
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on);
    b.textContent = on ? "🔔 알림 받는 중" : "🔔 알림 받기";
  });
}

function wToggle(region, town) {
  const i = wTowns.findIndex((t) => t.region === region && t.town === town);
  if (i >= 0) wTowns.splice(i, 1);
  else if (wTowns.length >= W_MAX) { wEls.status.textContent = `동네는 ${W_MAX}곳까지 고를 수 있어요.`; return; }
  else wTowns.push({ region, town });
  wRemember();
  wRender();
  wEls.box.open = true;
  wEls.status.textContent = "저장하는 중…";
  clearTimeout(wSaveTimer);
  wSaveTimer = setTimeout(wSave, 1200); // 여러 동을 연달아 눌러도 한 번만 저장합니다.
}

const wSheetId = () => ibSheetId(ibStore.get("sheet") || window.INTAKE_SHEET || "");
const wUrl = () => ibStore.get("url") || window.INTAKE_URL || "";

async function wMcp() {
  const mcp = await window.claude.use("mcp").catch(() => null);
  if (!mcp) throw Object.assign(new Error("mcp"), { code: "no_mcp" });
  return mcp;
}

async function wSave() {
  const done = `동네 ${wTowns.length}곳을 저장했어요. 매일 아침 7시에 새 소식이 있으면 메일로 보내 드려요.`;
  try {
    if (IB_CLAUDE) {
      const id = wSheetId();
      if (!id) { wEls.status.textContent = "위 '받은 상담 신청'에 구글 시트 주소를 먼저 넣어 주세요. 알림 동네도 같은 시트에 저장합니다."; return; }
      const mcp = await wMcp();
      // '알림지역' 탭이 없으면 만듭니다. 이미 있으면 구글이 거절하는데, 그대로 넘어갑니다.
      await mcp.callTool(IB_SHEETS, "update_spreadsheet", { spreadsheetId: id, requests: [{ addSheet: { properties: { title: "알림지역" } } }] }).catch(() => null);
      await mcp.callTool(IB_SHEETS, "batch_clear_values", { spreadsheetId: id, ranges: ["알림지역!A2:C"] });
      const today = new Date().toLocaleDateString("ko-KR");
      await mcp.callTool(IB_SHEETS, "update_values", { spreadsheetId: id, range: `알림지역!A1:C${wTowns.length + 1}`, values: [["지역", "동", "넣은 날"], ...wTowns.map((t) => [t.region, t.town, today])] });
      wEls.status.textContent = done;
      return;
    }
    const key = ibStore.get("key");
    if (!wUrl() || !key) { wEls.status.textContent = "위 '받은 상담 신청'에 시트 주소와 비밀번호를 한 번 넣어 주세요. 같은 비밀번호로 알림 동네를 저장합니다."; return; }
    const out = await (await fetch(wUrl(), { method: "POST", body: JSON.stringify({ action: "watch", key, towns: wTowns }) })).json();
    wEls.status.textContent = out.ok ? done : (out.error === "모르는 요청" || out.error === "이름과 휴대폰 번호가 필요합니다"
      ? "시트의 Apps Script가 예전 버전이에요. README의 '동네 알림' 설정대로 새 버전으로 배포해 주세요."
      : out.error || "저장하지 못했어요.");
  } catch (e) {
    console.warn(e);
    const msg = {
      no_mcp: "이 화면에서는 구글 시트에 쓸 수 없어요. claude.ai에서 가이드를 열어 주세요.",
      not_in_manifest: "이 가이드가 구글 시트에 쓰도록 허용되지 않았어요. 오른쪽 위 메뉴의 권한에서 Google Sheets를 허용해 주세요.",
      approval_required: "구글 시트에 쓰려면 허용이 필요해요. 뜨는 창에서 허용을 누른 뒤 동네를 한 번 더 눌러 주세요.",
      server_not_connected: "Google Sheets가 연결돼 있지 않아요. claude.ai 설정 → 커넥터에서 연결해 주세요.",
      needs_reauth: "Google Sheets 로그인이 풀렸어요. claude.ai 설정 → 커넥터에서 다시 연결해 주세요.",
    }[e && e.code];
    wEls.status.textContent = msg || "시트에 저장하지 못했어요. 고른 동네는 이 브라우저에 기억해 두었으니 잠시 뒤 다시 눌러 주세요.";
  }
}

// 시트에 저장된 알림 동네와 최근 알림을 불러옵니다. 시트 쪽 목록이 기준입니다(시트에서 직접 고쳐도 됩니다).
async function wLoad() {
  let towns = null, alerts = [];
  try {
    if (IB_CLAUDE) {
      const id = wSheetId();
      if (!id) return;
      const mcp = await wMcp();
      const vals = async (range) => {
        const p = (await mcp.callTool(IB_SHEETS, "get_values", { spreadsheetId: id, range }, { cache: false }).catch(() => ({}))).payload;
        return Array.isArray(p) ? p : p && Array.isArray(p.values) ? p.values : null;
      };
      const w = await vals("알림지역!A2:B");
      if (w) towns = w.map((r) => ({ region: String(r[0] || "").trim(), town: String(r[1] || "").trim() }));
      alerts = ((await vals("알림!A2:F")) || []).slice(-100).reverse()
        .map((r) => ({ at: r[0], region: r[1] || "", town: r[2] || "", kind: r[3] || "", text: r[4] || "", link: r[5] || "" }));
    } else {
      const key = ibStore.get("key");
      if (!wUrl() || !key) return;
      const get = async (what) => (await fetch(`${wUrl()}?key=${encodeURIComponent(key)}&what=${what}`)).json();
      const w = await get("watch");
      if (w.ok) towns = w.towns;
      const a = await get("alerts");
      if (a.ok) alerts = a.items || [];
    }
  } catch (e) {
    console.warn(e);
    wEls.status.textContent = "시트에서 알림을 불러오지 못했어요. 고른 동네는 이 브라우저에 기억해 둔 것을 보여 드려요.";
  }
  if (towns) {
    wTowns = towns.filter((t) => /^[가-힣]+-[가-힣]+$/.test(t.region) && t.town);
    wRemember();
    wRender();
  }
  wEls.alerts.innerHTML = alerts.length
    ? alerts.map((a) => {
      const at = String(a.at || "");
      const d = new Date(at);
      const md = at.match(/\d{4}\.\s*(\d{1,2})\.\s*(\d{1,2})/);
      const when = !isNaN(d) && /^\d{4}-/.test(at) ? d.toLocaleDateString("ko-KR", { month: "long", day: "numeric" }) : md ? `${md[1]}월 ${md[2]}일` : at;
      const link = /^https:\/\//.test(a.link) ? ` <a href="${ibEscape(a.link)}" target="_blank" rel="noopener">자세히</a>` : "";
      return `<li><div class="rec-head"><span><span class="tag ${a.kind === "새 학원" ? "warn" : a.kind === "학원 인수" ? "" : "good"}">${ibEscape(a.kind)}</span> ${ibEscape(wName(a))}</span><span class="rec-note">${ibEscape(when)}</span></div><p class="rec-note">${ibEscape(a.text)}${link}</p></li>`;
    }).join("")
    : '<li class="rec-note">아직 받은 알림이 없습니다. 동네를 고른 다음 날 아침부터 새 소식이 오면 여기와 메일에 쌓여요.</li>';
}

if (ibOwner) {
  wEls.box.hidden = false;
  wRender();
  wLoad();
}
wEls.reload.addEventListener("click", () => wLoad());
wEls.towns.addEventListener("click", (e) => {
  const b = e.target.closest(".watch-del");
  if (b) { const t = wTowns[Number(b.dataset.i)]; wToggle(t.region, t.town); }
});
document.addEventListener("click", (e) => {
  const b = e.target.closest(".watch-btn");
  if (b) wToggle(b.dataset.region, b.dataset.town);
});
