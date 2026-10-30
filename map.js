// 동별 지도: 지금 고른 시·구의 동마다 동그라미를 그립니다. 동 중심(data의 center)은 그 동 학교들의 평균 위치입니다.
// 색은 동별 카드의 표시와 같습니다: 학원 1곳당 학생이 평균의 1.2배 이상이면 초록(경쟁 낮음), 0.8배 이하면 주황(경쟁 높음).
// 크기는 고른 학년 학생 수. 누르면 그 동 카드로 내려갑니다. Leaflet과 OpenStreetMap 지도를 씁니다.
let dmMap = null;
let dmLayer = null;

function dmColor(r, average) {
  const css = getComputedStyle(document.documentElement);
  if (!Number.isFinite(r.ratio)) return r.students > 0 ? css.getPropertyValue("--good").trim() : css.getPropertyValue("--muted").trim();
  if (r.ratio >= average * 1.2) return css.getPropertyValue("--good").trim();
  if (r.ratio <= average * 0.8) return css.getPropertyValue("--warn").trim();
  return css.getPropertyValue("--accent").trim();
}

function renderDongMap(data, rows, average) {
  const box = document.getElementById("dong-map");
  if (!box || !window.L) return;
  const pts = rows.filter((r) => Array.isArray(r.area.center) && r.area.center.length === 2);
  box.closest(".dong-map-wrap").hidden = !pts.length;
  if (!pts.length) return;
  if (!dmMap) {
    dmMap = L.map(box, { scrollWheelZoom: false, attributionControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(dmMap);
    dmLayer = L.layerGroup().addTo(dmMap);
  }
  dmLayer.clearLayers();
  const maxStudents = Math.max(...pts.map((r) => r.students), 1);
  const subject = els.subject.value;
  const level = els.level.value;
  pts.forEach((r) => {
    const color = dmColor(r, average);
    const radius = 8 + 22 * Math.sqrt(r.students / maxStudents);
    const ratio = Number.isFinite(r.ratio) ? `학원 1곳당 <strong>${fmt(Math.round(r.ratio))}명</strong>` : "등록된 학원 없음";
    L.circleMarker(r.area.center, { radius, color, weight: 2, fillColor: color, fillOpacity: 0.35 })
      .bindTooltip(`<strong>${r.area.name}</strong><br>${ratio}<br>${LEVEL_LABELS[level]} ${fmt(r.students)}명 · ${SUBJECT_LABELS[subject]} ${fmt(r.academies)}곳`, { direction: "top" })
      .on("click", () => {
        const item = [...els.ranking.querySelectorAll(".rank-name")].find((n) => n.textContent.replace(/^\d+/, "").startsWith(r.area.name));
        (item?.closest("li") || els.ranking).scrollIntoView({ behavior: "smooth", block: "start" });
      })
      .addTo(dmLayer);
    // 지도 그림이 안 떠도 어느 동인지 알 수 있게 이름을 원 가운데에 적습니다.
    L.marker(r.area.center, { interactive: false, keyboard: false, icon: L.divIcon({ className: "dm-label", html: `<span>${r.area.name}</span>`, iconSize: null }) }).addTo(dmLayer);
  });
  // 숨겨져 있다 보이면 크기를 다시 재야 지도가 제대로 그려집니다.
  setTimeout(() => {
    dmMap.invalidateSize();
    dmMap.fitBounds(L.latLngBounds(pts.map((r) => r.area.center)).pad(0.15), { maxZoom: 15 });
  }, 0);
}
