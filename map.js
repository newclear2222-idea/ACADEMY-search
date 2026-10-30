// 동별 지도: 지금 고른 시·구의 행정동 경계를 그리고, 동별 카드와 같은 색으로 칠합니다.
// 경계는 data/geo/<서울|경기|인천>.json(행정안전부 행정동 경계, 간략화)에 들어 있어 바깥 지도 그림 없이도 보입니다.
// 색은 동별 카드의 표시와 같습니다: 학원 1곳당 학생이 평균의 1.2배 이상이면 초록(경쟁 낮음), 0.8배 이하면 주황(경쟁 높음).
// 행정동(화곡1동)은 이름으로 동별 카드의 법정동(화곡동)에 붙이고, 이름이 다르면 가장 가까운 동에 붙입니다. 누르면 그 동 카드로 내려갑니다.
let dmMap = null;
let dmLayer = null;
const dmGeo = {};

function dmColor(r, average) {
  const css = getComputedStyle(document.documentElement);
  if (!r) return css.getPropertyValue("--muted").trim();
  if (!Number.isFinite(r.ratio)) return r.students > 0 ? css.getPropertyValue("--good").trim() : css.getPropertyValue("--muted").trim();
  if (r.ratio >= average * 1.2) return css.getPropertyValue("--good").trim();
  if (r.ratio <= average * 0.8) return css.getPropertyValue("--warn").trim();
  return css.getPropertyValue("--accent").trim();
}

function dmLoadGeo(province) {
  if (!dmGeo[province]) dmGeo[province] = fetchJson(`data/geo/${encodeURIComponent(province)}.json`).catch((e) => { console.warn(e); delete dmGeo[province]; return null; });
  return dmGeo[province];
}

// 바깥 테두리 꼭짓점의 평균. 동 이름을 붙이고 가까운 동을 찾는 데만 쓰니 이 정도면 됩니다.
function dmMiddle(geom) {
  const ring = geom.type === "Polygon" ? geom.coordinates[0] : geom.coordinates.reduce((a, p) => (p[0].length > a.length ? p[0] : a), []);
  const n = ring.length || 1;
  return [ring.reduce((s, c) => s + c[1], 0) / n, ring.reduce((s, c) => s + c[0], 0) / n];
}

function dmMatch(name, mid, rows) {
  const stem = name.replace(/(제?[\d·,.]+가?|본)동$/, "동");
  const byName = rows.find((r) => r.area.name === name || r.area.name === stem);
  if (byName) return byName;
  // 이름이 다른 행정동(우장산동, 보라매동 등)은 2.5km 안에서 동 중심이 가장 가까운 동에 붙입니다.
  let best = null, bestD = 2.5;
  rows.forEach((r) => {
    if (!Array.isArray(r.area.center)) return;
    const d = Math.hypot((r.area.center[0] - mid[0]) * 111, (r.area.center[1] - mid[1]) * 88);
    if (d < bestD) { best = r; bestD = d; }
  });
  return best;
}

function dmScrollTo(r) {
  const item = [...els.ranking.querySelectorAll(".rank-name")].find((n) => n.textContent.replace(/^\d+/, "").startsWith(r.area.name));
  (item?.closest("li") || els.ranking).scrollIntoView({ behavior: "smooth", block: "start" });
}

async function renderDongMap(data, rows, average) {
  const box = document.getElementById("dong-map");
  if (!box || !window.L) return;
  const wrap = box.closest(".dong-map-wrap");
  const province = data.id.split("-")[0];
  const geo = await dmLoadGeo(province);
  if (current !== data) return; // 불러오는 사이 다른 지역을 골랐으면 그리지 않습니다.
  const pts = rows.filter((r) => Array.isArray(r.area.center) && r.area.center.length === 2);
  const mine = geo ? geo.features.filter((f) => f.properties.r === data.id) : [];
  wrap.hidden = !pts.length && !mine.length;
  if (wrap.hidden) return;
  if (!dmMap) {
    dmMap = L.map(box, { scrollWheelZoom: false, preferCanvas: true, zoomSnap: 0.25 });
    // 바깥 지도 그림은 있으면 깔고, 막혀 있으면(claude.ai 안) 경계만으로 보여 줍니다.
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, opacity: 0.55, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · 경계 행정안전부',
    }).addTo(dmMap);
    dmLayer = L.layerGroup().addTo(dmMap);
  }
  dmLayer.clearLayers();
  const css = getComputedStyle(document.documentElement);
  const line = css.getPropertyValue("--line").trim();
  const text = css.getPropertyValue("--text").trim();
  const subject = els.subject.value;
  const level = els.level.value;
  const info = (r) => {
    const ratio = Number.isFinite(r.ratio) ? `학원 1곳당 <strong>${fmt(Math.round(r.ratio))}명</strong>` : "등록된 학원 없음";
    return `<strong>${r.area.name}</strong><br>${ratio}<br>${LEVEL_LABELS[level]} ${fmt(r.students)}명 · ${SUBJECT_LABELS[subject]} ${fmt(r.academies)}곳`;
  };

  if (geo) {
    // 둘레 시·구: 옅은 회색 경계와 이름만.
    const near = {};
    geo.features.forEach((f) => {
      if (f.properties.r === data.id) return;
      L.geoJSON(f, { interactive: false, style: { color: line, weight: 1, fillColor: line, fillOpacity: 0.25 } }).addTo(dmLayer);
      const m = dmMiddle(f.geometry);
      const g = (near[f.properties.r] ||= { lat: 0, lng: 0, n: 0 });
      g.lat += m[0]; g.lng += m[1]; g.n += 1;
    });
    Object.entries(near).forEach(([id, g]) => {
      L.marker([g.lat / g.n, g.lng / g.n], { interactive: false, keyboard: false, icon: L.divIcon({ className: "dm-label dm-region", html: `<span>${id.replace(/^[^-]+-/, "")}</span>`, iconSize: null }) }).addTo(dmLayer);
    });
  }

  // 이 시·구의 행정동: 동별 카드 색으로 칠합니다.
  const used = new Set();
  mine.forEach((f) => {
    const r = dmMatch(f.properties.n, dmMiddle(f.geometry), rows);
    if (r) used.add(r);
    const color = dmColor(r, average);
    const layer = L.geoJSON(f, { style: { color: text, weight: 1, opacity: 0.6, fillColor: color, fillOpacity: r ? 0.5 : 0.15 } });
    layer.bindTooltip(r ? `${info(r)}${r.area.name !== f.properties.n ? `<br><span class="dm-sub">행정동 ${f.properties.n}</span>` : ""}` : `${f.properties.n}<br>동별 자료 없음`, { sticky: true });
    layer.on("mouseover", (e) => e.layer.setStyle({ weight: 3, opacity: 1 }));
    layer.on("mouseout", (e) => e.layer.setStyle({ weight: 1, opacity: 0.6 }));
    if (r) layer.on("click", () => dmScrollTo(r));
    layer.addTo(dmLayer);
  });

  // 경계에 안 붙은 동(경계 자료가 없는 곳)은 예전처럼 원으로 그립니다.
  const maxStudents = Math.max(...pts.map((r) => r.students), 1);
  pts.filter((r) => !used.has(r)).forEach((r) => {
    const color = dmColor(r, average);
    L.circleMarker(r.area.center, { radius: 8 + 16 * Math.sqrt(r.students / maxStudents), color, weight: 2, fillColor: color, fillOpacity: 0.4 })
      .bindTooltip(info(r), { direction: "top" }).on("click", () => dmScrollTo(r)).addTo(dmLayer);
  });
  pts.forEach((r) => {
    L.marker(r.area.center, { interactive: false, keyboard: false, icon: L.divIcon({ className: "dm-label", html: `<span>${r.area.name}</span>`, iconSize: null }) }).addTo(dmLayer);
  });

  const bounds = mine.length ? L.geoJSON({ type: "FeatureCollection", features: mine }).getBounds() : L.latLngBounds(pts.map((r) => r.area.center));
  // 숨겨져 있다 보이면 크기를 다시 재야 지도가 제대로 그려집니다.
  setTimeout(() => {
    dmMap.invalidateSize();
    dmMap.fitBounds(bounds.pad(0.04), { maxZoom: 15 });
  }, 0);
}
