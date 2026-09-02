(() => {
  const DATA = window.SLOT_DATA;
  const PATHS = window.ZIP_PATHS;
  const OUTLINE = window.FLORIDA_OUTLINE;
  const W = 1000, H = 940;
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const number = (value) => Number(value || 0).toLocaleString();
  const shortDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
  const longDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "No active slots";
  const origins = DATA.origins || [];
  const originByZip = new Map(origins.map((origin) => [origin.z, origin]));
  const miles = window.SLOT_RADIUS.miles;
  const defaultOriginZip = originByZip.has("32804") ? "32804" : origins[0]?.z || "";
  const landingRadius = 140, searchedZipRadius = 50;
  const marketRadiusMiles = 25;
  const comparisonThrough = DATA.commonMaxDate || DATA.maxDate;
  const defaultFrom = window.SUITE_DATE.today();
  const defaultThrough = comparisonThrough < defaultFrom ? defaultFrom : comparisonThrough;
  const counties = [...new Set(Object.values(DATA.zipCounty || {}).filter(Boolean))].sort();
  const state = {
    from: defaultFrom, through: defaultThrough, originZip: defaultOriginZip,
    radius: landingRadius, radiusActive: Boolean(defaultOriginZip), county: "",
    filter: "all", selectedZip: "", zoom: { k: 1, x: 0, y: 0 },
  };
  let allRows = [], exactRows = [], visibleRows = [], rowByZip = new Map(), exactGapByZip = new Map(), visibleExactGapByZip = new Map();

  function distanceBetweenZips(a, b) {
    const first = originByZip.get(a), second = originByZip.get(b);
    return first && second ? miles(first.a, first.o, second.a, second.o) : Infinity;
  }

  function scopedZips() {
    return origins.filter((origin) => {
      if (state.county && DATA.zipCounty?.[origin.z] !== state.county) return false;
      if (!state.radiusActive) return true;
      return distanceBetweenZips(state.originZip, origin.z) <= state.radius;
    }).map((origin) => origin.z);
  }

  function filterRows(rows) {
    if (state.filter === "high") return rows.filter((row) => row.score.total >= 50);
    if (state.filter === "coverage") return rows.filter((row) => exactGapByZip.has(row.zip));
    if (state.filter === "earlier") return rows.filter((row) => row.earliestAh && row.earliestOh && row.earliestOh < row.earliestAh);
    if (state.filter === "slots") return rows.filter((row) => row.slotGap > 0);
    return rows;
  }

  function scoreLabel(score) {
    if (score >= 75) return "Highest";
    if (score >= 50) return "High";
    if (score >= 25) return "Emerging";
    return "Monitor";
  }

  function drawMap() {
    $("map-vp").innerHTML = `<g id="zip-layer">${PATHS.map((path) => `<path class="op-area" data-zip="${esc(path.k)}" d="${path.d}"></path>`).join("")}</g><path class="coast" d="${OUTLINE}"></path><g id="radius-layer"></g><g id="opportunity-marker-layer"></g>`;
    $("opportunity-marker-layer").addEventListener("click", (event) => {
      const marker = event.target.closest(".op-marker");
      if (marker) selectZip(marker.dataset.zip);
    });
    $("opportunity-marker-layer").addEventListener("pointermove", showTip);
    $("opportunity-marker-layer").addEventListener("pointerleave", () => { $("tip").style.opacity = 0; });
  }

  function paintMap() {
    document.querySelectorAll(".op-area").forEach((path) => {
      path.setAttribute("fill", "#e6e2dc");
      path.classList.toggle("selected", path.dataset.zip === state.selectedZip);
      path.setAttribute("aria-hidden", "true");
    });
    const markerZips = new Set([...rowByZip.keys(), ...visibleExactGapByZip.keys()]);
    $("opportunity-marker-layer").innerHTML = [...markerZips].map((zip) => {
      const row = rowByZip.get(zip);
      const exactGap = visibleExactGapByZip.get(zip);
      const origin = originByZip.get(zip);
      if (!origin) return "";
      const localRadius = row ? 5 + Math.min(10, row.score.total / 10) : 0;
      const exactRadius = exactGap ? (row ? Math.max(4.5, localRadius * 0.48) : 5 + Math.min(10, exactGap.score.total / 10)) : 0;
      const selected = zip === state.selectedZip ? " selected" : "";
      const localMarker = row ? `<circle class="op-marker lead${selected}" data-zip="${esc(zip)}" cx="${origin.x}" cy="${origin.y}" r="${localRadius.toFixed(1)}" ${exactGap ? "" : 'tabindex="0"'} role="button" aria-label="ZIP ${esc(zip)}, Orlando Health leads the 25-mile market by ${number(row.slotGap)} slots"></circle>` : "";
      const exactMarker = exactGap ? `<circle class="op-marker coverage${row ? " overlap" : ""}${selected}" data-zip="${esc(zip)}" cx="${origin.x}" cy="${origin.y}" r="${exactRadius.toFixed(1)}" tabindex="0" role="button" aria-label="ZIP ${esc(zip)}, exact ZIP gap with ${number(exactGap.oh)} Orlando Health slots and no AdventHealth slots${row ? ", also an Orlando Health-leading 25-mile market" : ""}"></circle>` : "";
      return localMarker + exactMarker;
    }).join("");
    const radiusLayer = $("radius-layer");
    const origin = originByZip.get(state.originZip);
    radiusLayer.innerHTML = state.radiusActive && origin
      ? `<circle class="radius-ring" cx="${origin.x}" cy="${origin.y}" r="${state.radius * origin.m}"></circle><circle class="origin-marker" cx="${origin.x}" cy="${origin.y}" r="6"></circle>`
      : "";
    const scope = state.radiusActive ? `${number(state.radius)} miles from ${state.originZip}` : "Florida statewide";
    $("map-meta").textContent = `${number(visibleExactGapByZip.size)} exact-ZIP gaps · ${number(rowByZip.size)} OH-leading 25-mile markets · centers within ${scope}`;
  }

  function showTip(event) {
    const marker = event.target.closest(".op-marker");
    if (!marker) return;
    const zip = marker.dataset.zip;
    const row = allRows.find((candidate) => candidate.zip === zip), exactGap = exactGapByZip.get(zip), tip = $("tip");
    if (!row) return;
    const exactLine = exactGap ? `<br><span class="coverage-text">Exact ZIP gap:</span> <span class="ah">AH 0</span> · <span class="oh">OH ${number(exactGap.oh)}</span>` : "";
    const leadLine = row.oh > row.ah ? `<br>25-mile OH lead: ${number(row.slotGap)} slots` : `<br>AH leads the surrounding 25-mile market`;
    tip.innerHTML = `<strong>${esc(row.zip)} · ${esc(row.county)} County</strong><span class="oh">25-mile score ${row.score.total}</span><br>Within 25 miles: <span class="ah">AH ${number(row.ah)}</span> · <span class="oh">OH ${number(row.oh)}</span>${leadLine}${exactLine}`;
    tip.style.left = `${event.clientX + 14}px`; tip.style.top = `${event.clientY + 14}px`; tip.style.opacity = 1;
  }

  function scoreBreakdown(row) {
    const items = [
      ["Coverage gap", row.score.coverageGap, 35],
      ["Timing advantage", row.score.timingAdvantage, 25],
      ["Slot advantage", row.score.slotAdvantage, 20],
      ["Persistent lead", row.score.persistentLead, 10],
      ["AH access distance", row.score.ahDistance, 10],
    ];
    return items.map(([label, value, max]) => `<div class="score-row"><span>${label}</span><i><b style="width:${value / max * 100}%"></b></i><strong>${value}/${max}</strong></div>`).join("");
  }

  function renderEvidence() {
    const row = allRows.find((candidate) => candidate.zip === state.selectedZip);
    if (!row) {
      $("market-evidence").innerHTML = `<div class="evidence-empty">Select a ZIP with opportunity evidence to review its score.</div>`;
      return;
    }
    const nearest = Number.isFinite(row.nearestAhMiles) ? `${row.nearestAhMiles.toFixed(1)} miles` : "No active AH facility";
    const timing = row.oh && !row.ah ? "OH has availability; AH has none" : row.timingGapDays > 0 ? `OH is ${row.timingGapDays} days sooner` : "No OH timing advantage";
    const exactGap = exactGapByZip.get(row.zip);
    const exactFinding = exactGap ? `<div class="finding exact-gap-finding"><b>Exact ZIP gap:</b> OH has ${number(exactGap.oh)} slots in ${esc(row.zip)} while AH has none in that ZIP.</div>` : "";
    $("market-evidence").innerHTML = `<div class="evidence-head"><div><span class="evidence-kicker">25-mile market · ${esc(row.county)} County</span><h3>Centered on ZIP ${esc(row.zip)}</h3></div><div class="score-badge"><b>${row.score.total}</b><span>${scoreLabel(row.score.total)}</span></div></div>${exactFinding}<div class="evidence-compare"><div><span>AH slots</span><b class="ah">${number(row.ah)}</b><small>${longDate(row.earliestAh)} earliest</small></div><div><span>OH slots</span><b class="oh">${number(row.oh)}</b><small>${longDate(row.earliestOh)} earliest</small></div></div><div class="finding">${esc(timing)} within 25 miles. Nearest active AH access: <b>${esc(nearest)}</b>.</div><div class="score-breakdown">${scoreBreakdown(row)}</div><button class="plain review-market" data-review="${esc(row.zip)}">Review facilities and providers</button>`;
  }

  function renderKpis() {
    const localLeaders = [...rowByZip.values()];
    $("kpi-priority").textContent = number(exactGapByZip.size);
    $("kpi-coverage").textContent = number(localLeaders.length);
    $("kpi-earlier").textContent = number(localLeaders.filter((row) => row.earliestAh && row.earliestOh && row.earliestOh < row.earliestAh).length);
    $("kpi-slot-gap").textContent = number(localLeaders.reduce((largest, row) => Math.max(largest, row.slotGap), 0));
  }

  function renderTable() {
    const query = $("table-search").value.trim().toLowerCase();
    const rows = visibleRows.filter((row) => !query || row.zip.includes(query) || row.county.toLowerCase().includes(query));
    $("opportunity-count").textContent = `${number(rows.length)} ZIP${rows.length === 1 ? "" : "s"}`;
    if (!rows.length) {
      $("opportunity-table").innerHTML = `<div class="empty">No opportunity ZIPs match the active filters.</div>`;
      return;
    }
    $("opportunity-table").innerHTML = `<table><thead><tr><th>Rank</th><th>Market center / county</th><th>Priority</th><th>AH slots</th><th>OH slots</th><th>Slot gap</th><th>AH earliest</th><th>OH earliest</th><th>Nearest active AH</th><th></th></tr></thead><tbody>${rows.map((row, index) => `<tr class="opportunity-row${row.zip === state.selectedZip ? " selected" : ""}" data-zip="${esc(row.zip)}"><td>${index + 1}</td><td><strong>${esc(row.zip)}</strong><small>${esc(row.county)} County · 25 mi</small></td><td><span class="table-score">${row.score.total}</span><small>${scoreLabel(row.score.total)}</small></td><td class="ah">${number(row.ah)}</td><td class="oh">${number(row.oh)}</td><td class="${row.slotGap > 0 ? "oh" : "ah"}">${row.slotGap > 0 ? "+" : ""}${number(row.slotGap)}</td><td>${shortDate(row.earliestAh)}</td><td>${shortDate(row.earliestOh)}</td><td>${Number.isFinite(row.nearestAhMiles) ? `${row.nearestAhMiles.toFixed(1)} mi` : "—"}</td><td><button class="plain table-review" data-review="${esc(row.zip)}">Review</button></td></tr>`).join("")}</tbody></table>`;
  }

  function selectZip(zip) {
    if (!allRows.some((row) => row.zip === zip)) return;
    state.selectedZip = zip;
    paintMap(); renderEvidence(); renderTable();
  }

  function facilityDistanceFrom(zip, facilityIndex) {
    return distanceBetweenZips(zip, DATA.facilities[facilityIndex]?.z);
  }

  function providerCards(slotIndices) {
    const groups = new Map();
    for (const index of slotIndices) {
      const slot = DATA.slots[index];
      const key = `${slot.y}|${slot.p}`;
      if (!groups.has(key)) groups.set(key, { slot, indices: [] });
      groups.get(key).indices.push(index);
    }
    return [...groups.values()].sort((a, b) => a.slot.y.localeCompare(b.slot.y) || DATA.providers[a.slot.p].n.localeCompare(DATA.providers[b.slot.p].n)).map((group) => {
      const provider = DATA.providers[group.slot.p];
      const slots = group.indices.map((index) => DATA.slots[index]).sort((a, b) => a.u.localeCompare(b.u));
      return `<article class="market-provider"><div class="provider-top"><div><h4>${esc(provider.n)}</h4><p>${esc(provider.c || "Credentials not supplied")} · ${number(slots.length)} appointment${slots.length === 1 ? "" : "s"}</p></div><span class="system-tag ${group.slot.y}">${group.slot.y.toUpperCase()}</span></div><div class="slot-list">${slots.map((slot, index) => `<span class="slot${index >= 8 ? " extra-market-slot" : ""}"${index >= 8 ? " hidden" : ""}>${shortDate(slot.d)} · ${esc(slot.t || "Time not supplied")}</span>`).join("")}${slots.length > 8 ? `<button class="more-slots" type="button" data-more-slots>+${slots.length - 8} more</button>` : ""}</div></article>`;
    }).join("");
  }

  function openMarket(zip) {
    const row = allRows.find((candidate) => candidate.zip === zip);
    if (!row) return;
    state.selectedZip = zip; paintMap(); renderEvidence(); renderTable();
    const groups = new Map();
    for (const index of row.slotIndices) {
      const slot = DATA.slots[index];
      if (!groups.has(slot.f)) groups.set(slot.f, []);
      groups.get(slot.f).push(index);
    }
    const catchmentFacilities = new Set(groups.keys());
    if (row.nearestAhFacility != null && !groups.has(row.nearestAhFacility)) {
      const nearestIndices = [];
      DATA.slots.forEach((slot, index) => {
        if (slot.f === row.nearestAhFacility && slot.y === "ah" && slot.d >= state.from && slot.d <= state.through) nearestIndices.push(index);
      });
      if (nearestIndices.length) groups.set(row.nearestAhFacility, nearestIndices);
    }
    const facilities = [...groups.entries()].sort((a, b) => facilityDistanceFrom(zip, a[0]) - facilityDistanceFrom(zip, b[0]));
    const nearest = row.nearestAhFacility == null ? null : DATA.facilities[row.nearestAhFacility];
    $("dialog-title").textContent = `25-mile market centered on ZIP ${zip}`;
    $("dialog-subtitle").textContent = `${row.county} County · Opportunity score ${row.score.total} · ${number(row.ah + row.oh)} appointments within the catchment`;
    $("dialog-summary").innerHTML = `<span><strong class="ah">AH ${number(row.ah)}</strong> slots</span><span><strong class="oh">OH ${number(row.oh)}</strong> slots</span><span><strong>${row.providersAh + row.providersOh}</strong> providers</span><span><strong>${row.facilitiesAh + row.facilitiesOh}</strong> facilities</span>${nearest ? `<span>Nearest active AH: <strong>${esc(nearest.n)}</strong> · ${row.nearestAhMiles.toFixed(1)} mi</span>` : ""}`;
    $("dialog-facilities").innerHTML = facilities.length ? facilities.map(([facilityIndex, indices]) => {
      const facility = DATA.facilities[facilityIndex], distance = facilityDistanceFrom(zip, facilityIndex);
      const comparison = facilityIndex === row.nearestAhFacility && !catchmentFacilities.has(facilityIndex);
      return `<section class="market-facility"><div class="market-facility-head"><div><span class="system-tag ${facility.y}">${facility.y.toUpperCase()}</span>${comparison ? `<span class="comparison-tag">Nearest active AH comparison</span>` : ""}<h3>${esc(facility.n)}</h3><p>${esc([facility.a, facility.c, facility.z].filter(Boolean).join(", "))}</p></div><strong>${Number.isFinite(distance) ? `${distance.toFixed(1)} mi` : "—"}</strong></div><div class="market-provider-list">${providerCards(indices)}</div></section>`;
    }).join("") : `<div class="empty">No facility evidence is available in this ZIP for the active period.</div>`;
    $("market-dialog").showModal();
  }

  function syncControls(message = "") {
    $("radius").value = state.radius; $("radius-value").textContent = `${state.radius} miles`;
    $("radius-status").textContent = message || (state.radiusActive ? `Active around ${state.originZip}` : "Florida statewide");
    $("origin-zip").value = state.radiusActive && state.originZip !== defaultOriginZip ? state.originZip : "";
    $("area-search").value = state.county || (state.selectedZip && state.originZip === state.selectedZip ? state.selectedZip : "");
    $("clear-area").disabled = !state.county && !$("area-search").value;
    $("from-date").value = state.from; $("through-date").value = state.through; $("opportunity-filter").value = state.filter;
    $("period-status").textContent = `Common endpoint: ${longDate(comparisonThrough)}`;
  }

  function refresh(message = "") {
    const includeZips = scopedZips();
    exactRows = buildOpportunityRows(DATA, { from: state.from, through: state.through, includeZips, miles });
    exactGapByZip = new Map(exactRows.filter((row) => row.oh > 0 && row.ah === 0).map((row) => [row.zip, row]));
    allRows = buildOpportunityRows(DATA, { from: state.from, through: state.through, includeZips, marketRadiusMiles, miles });
    visibleRows = filterRows(allRows);
    rowByZip = new Map(visibleRows.filter((row) => row.oh > row.ah).map((row) => [row.zip, row]));
    const showExactGap = (row) => state.filter === "all" || state.filter === "coverage" || state.filter === "slots" || (state.filter === "high" && row.score.total >= 50);
    visibleExactGapByZip = new Map([...exactGapByZip].filter(([, row]) => showExactGap(row)));
    if (!visibleRows.some((row) => row.zip === state.selectedZip)) state.selectedZip = visibleRows[0]?.zip || "";
    syncControls(message); renderKpis(); paintMap(); renderEvidence(); renderTable();
  }

  function applyRadius() {
    const zip = $("origin-zip").value.trim() || defaultOriginZip;
    if (!/^\d{5}$/.test(zip) || !originByZip.has(zip)) {
      $("origin-zip").setAttribute("aria-invalid", "true");
      $("radius-status").textContent = "Enter a valid Florida ZIP"; $("radius-status").classList.add("error");
      return;
    }
    $("origin-zip").removeAttribute("aria-invalid"); $("radius-status").classList.remove("error");
    state.originZip = zip; state.radiusActive = true; state.county = ""; refresh();
  }

  function applyAreaSearch() {
    const value = $("area-search").value.trim();
    const zip = value.match(/^\d{5}/)?.[0];
    if (zip && originByZip.has(zip)) {
      state.originZip = zip; state.radius = searchedZipRadius; state.radiusActive = true; state.county = ""; state.selectedZip = zip; refresh(); return;
    }
    const county = counties.find((name) => name.toLowerCase() === value.replace(/ county$/i, "").toLowerCase());
    if (county) { state.county = county; state.selectedZip = ""; refresh(); return; }
    if (!value) { state.county = ""; state.selectedZip = ""; refresh(); }
  }

  function reset() {
    state.from = window.SUITE_DATE.today(); state.through = comparisonThrough < state.from ? state.from : comparisonThrough; state.originZip = defaultOriginZip;
    state.radius = landingRadius; state.radiusActive = Boolean(defaultOriginZip); state.county = "";
    state.filter = "all"; state.selectedZip = ""; $("table-search").value = ""; refresh();
  }

  function fillOptions() {
    $("origin-options").innerHTML = origins.map((origin) => `<option value="${origin.z}"></option>`).join("");
    const activeZips = [...new Set(DATA.facilities.map((facility) => facility.z).filter(Boolean))].sort();
    $("area-options").innerHTML = activeZips.map((zip) => `<option value="${zip} · ${esc(DATA.zipCounty?.[zip] || "")} County"></option>`).join("") + counties.map((county) => `<option value="${esc(county)} County"></option>`).join("");
  }

  $("apply-radius").addEventListener("click", applyRadius);
  $("origin-zip").addEventListener("keydown", (event) => { if (event.key === "Enter") applyRadius(); });
  $("clear-radius").addEventListener("click", () => { state.radiusActive = false; state.county = ""; state.selectedZip = ""; refresh(); });
  $("radius").addEventListener("input", (event) => { state.radius = Number(event.target.value); $("radius-value").textContent = `${state.radius} miles`; });
  $("radius").addEventListener("change", () => { if (!state.radiusActive) state.radiusActive = true; refresh(); });
  $("area-search").addEventListener("change", applyAreaSearch);
  $("area-search").addEventListener("keydown", (event) => { if (event.key === "Enter") applyAreaSearch(); });
  $("clear-area").addEventListener("click", () => { state.county = ""; state.selectedZip = ""; $("area-search").value = ""; refresh(); });
  $("opportunity-filter").addEventListener("change", (event) => { state.filter = event.target.value; refresh(); });
  $("from-date").addEventListener("change", (event) => { state.from = event.target.value || window.SUITE_DATE.today(); if (state.from > state.through) state.through = state.from; refresh(); });
  $("through-date").addEventListener("change", (event) => { state.through = event.target.value || (comparisonThrough < state.from ? state.from : comparisonThrough); if (state.through < state.from) state.from = state.through; refresh(); });
  $("reset").addEventListener("click", reset);
  $("table-search").addEventListener("input", renderTable);
  $("opportunity-table").addEventListener("click", (event) => { const review = event.target.closest("[data-review]"); if (review) { event.stopPropagation(); openMarket(review.dataset.review); return; } const row = event.target.closest("[data-zip]"); if (row) selectZip(row.dataset.zip); });
  $("market-evidence").addEventListener("click", (event) => { const button = event.target.closest("[data-review]"); if (button) openMarket(button.dataset.review); });
  $("close-dialog").addEventListener("click", () => $("market-dialog").close());
  $("market-dialog").addEventListener("click", (event) => { if (event.target === $("market-dialog")) $("market-dialog").close(); });
  $("dialog-facilities").addEventListener("click", (event) => { const button = event.target.closest("[data-more-slots]"); if (!button) return; const card = button.closest(".market-provider"); const hidden = card.querySelector(".extra-market-slot")?.hidden; card.querySelectorAll(".extra-market-slot").forEach((slot) => { slot.hidden = !hidden; }); button.textContent = hidden ? "Show less" : `+${card.querySelectorAll(".extra-market-slot").length} more`; });

  const map = $("map"), vp = $("map-vp");
  let drag = null;
  function applyZoom() { const zoom = state.zoom; vp.setAttribute("transform", `translate(${zoom.x} ${zoom.y}) scale(${zoom.k})`); }
  function zoomBy(factor) { const old = state.zoom.k, next = Math.max(1, Math.min(20, old * factor)); state.zoom.x = W / 2 - (W / 2 - state.zoom.x) * next / old; state.zoom.y = H / 2 - (H / 2 - state.zoom.y) * next / old; state.zoom.k = next; applyZoom(); }
  $("zoom-in").addEventListener("click", () => zoomBy(1.35)); $("zoom-out").addEventListener("click", () => zoomBy(1 / 1.35));
  $("zoom-reset").addEventListener("click", () => { state.zoom = { k: 1, x: 0, y: 0 }; applyZoom(); });
  map.addEventListener("wheel", (event) => { event.preventDefault(); zoomBy(event.deltaY < 0 ? 1.18 : 1 / 1.18); }, { passive: false });
  map.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".op-marker")) return;
    drag = { x: event.clientX, y: event.clientY, ox: state.zoom.x, oy: state.zoom.y };
    map.setPointerCapture(event.pointerId);
  });
  map.addEventListener("pointermove", (event) => {
    if (!drag) return;
    map.classList.add("dragging");
    const scale = Math.min(map.clientWidth / W, map.clientHeight / H) || 1;
    state.zoom.x = drag.ox + (event.clientX - drag.x) / scale;
    state.zoom.y = drag.oy + (event.clientY - drag.y) / scale;
    applyZoom();
  });
  const stopDragging = () => { drag = null; map.classList.remove("dragging"); };
  map.addEventListener("pointerup", stopDragging);
  map.addEventListener("pointercancel", stopDragging);
  map.addEventListener("lostpointercapture", stopDragging);
  map.addEventListener("keydown", (event) => {
    const marker = event.target.closest(".op-marker");
    if (marker && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); selectZip(marker.dataset.zip); return; }
    const arrows = { ArrowLeft: [45, 0], ArrowRight: [-45, 0], ArrowUp: [0, 45], ArrowDown: [0, -45] };
    if (!arrows[event.key]) return;
    event.preventDefault(); state.zoom.x += arrows[event.key][0]; state.zoom.y += arrows[event.key][1]; applyZoom();
  });

  const periodMin = DATA.minDate < defaultFrom ? DATA.minDate : defaultFrom;
  const periodMax = DATA.maxDate > defaultThrough ? DATA.maxDate : defaultThrough;
  $("from-date").min = periodMin; $("from-date").max = periodMax;
  $("through-date").min = periodMin; $("through-date").max = periodMax;
  fillOptions(); drawMap(); reset();
})();
