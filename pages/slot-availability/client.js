// Browser code for the Slot Availability page (inlined into public/index.html by render.js).
// Loads the slot files for the chosen dates, applies the toolbar filters, and draws the map, summary card, calendar and provider list.
(async () => {
  const DATA = window.SLOT_DATA;
  const PATHS = window.SLOT_PATHS;
  const OUTLINE = window.SLOT_OUTLINE;
  const W = 1000, H = 940;
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const number = (value) => Number(value || 0).toLocaleString();
  const longDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
  const shortDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
  const monthLabel = (date) => date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const typeLabel = (value) => value.replace(/\b\w/g, (letter) => letter.toUpperCase());
  const slotTypes = (slot) => (slot.ty || []).map((index) => DATA.types[index]).filter(Boolean);
  const slotReasons = (slot) => (slot.rv || []).map((index) => (DATA.reasons || [])[index]).filter(Boolean);
  const origins = DATA.origins || [];
  const originByZip = new Map(origins.map((origin) => [origin.z, origin]));
  const defaultOriginZip = originByZip.has("32804") ? "32804" : origins[0]?.z || "";
  const landingRadius = 140;
  const searchedZipRadius = 50;
  const comparisonThrough = DATA.commonMaxDate || DATA.maxDate;
  const defaultFrom = window.SUITE_DATE.today();
  // The landing view is the next 90 days; the period controls reach every published date, loading days as needed.
  const addDaysIso = (iso, days) => { const date = new Date(`${iso}T12:00:00`); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); };
  const landingThrough = (from) => { const cap = addDaysIso(from, 90); return comparisonThrough < from ? from : (comparisonThrough < cap ? comparisonThrough : cap); };
  const defaultThrough = landingThrough(defaultFrom);
  await window.SLOT_PARTITIONS.load(defaultFrom, defaultThrough);
  const initialSlotDate = DATA.slots.find((slot) => slot.d >= defaultFrom && slot.d <= defaultThrough)?.d || defaultFrom;
  const miles = window.SLOT_RADIUS.miles;

  const state = {
    granularity: "zip", view: "diff", hideTelemedicine: false, physiciansOnly: false, newPatientOnly: false, selected: "", selectedDate: initialSlotDate,
    from: defaultFrom, through: defaultThrough,
    originZip: defaultOriginZip, radius: landingRadius, radiusActive: Boolean(defaultOriginZip), areaQuery: "",
    month: new Date(`${initialSlotDate}T12:00:00`), zoom: { k: 1, x: 0, y: 0 },
  };
  let slotsByArea = { zip: new Map(), county: new Map() };
  let allIndices = [];
  // Rebuilt after every load: the loaded slots are the selected period's days.
  function indexSlots() {
    slotsByArea = { zip: new Map(), county: new Map() };
    allIndices = DATA.slots.map((_, index) => index);
    DATA.slots.forEach((slot, index) => {
      const facility = DATA.facilities[slot.f];
      [["zip", facility.z], ["county", facility.ct]].forEach(([granularity, key]) => {
        if (!key) return;
        if (!slotsByArea[granularity].has(key)) slotsByArea[granularity].set(key, []);
        slotsByArea[granularity].get(key).push(index);
      });
    });
  }
  indexSlots();
  let periodRequest = 0;
  async function refreshPeriod() {
    const request = ++periodRequest;
    $("map-meta").textContent = "Loading appointments for the selected dates…";
    try { await window.SLOT_PARTITIONS.load(state.from, state.through); }
    catch (error) { $("map-meta").textContent = "Could not load the selected dates."; console.error(error); return; }
    if (request !== periodRequest) return;
    indexSlots();
    if (!DATA.slots.some((slot) => slot.d === state.selectedDate)) state.selectedDate = DATA.slots[0]?.d || state.from;
    state.month = new Date(`${state.selectedDate}T12:00:00`);
    refresh();
  }
  let distanceOriginZip = "", distanceCache = [];
  const facilityDistance = (facilityIndex) => {
    if (distanceOriginZip !== state.originZip) {
      const origin = originByZip.get(state.originZip);
      distanceCache = DATA.facilities.map((facility) => {
        const facilityOrigin = originByZip.get(facility.z);
        return origin && facilityOrigin ? miles(origin.a, origin.o, facilityOrigin.a, facilityOrigin.o) : Infinity;
      });
      distanceOriginZip = state.originZip;
    }
    return distanceCache[facilityIndex] ?? Infinity;
  };
  const inRadius = (index) => !state.radiusActive || facilityDistance(DATA.slots[index].f) <= state.radius;
  // The Comparison filters. Everything published is shown by default; each filter narrows both sides the
  // same way: physicians only (Orlando Health publishes only physicians), in person only (Orlando Health
  // publishes no video visits), new patients only (the visit types a new patient can book).
  const visibleVisit = (index) => {
    const slot = DATA.slots[index];
    return (!state.hideTelemedicine || !slot.v) && (!state.physiciansOnly || DATA.providers[slot.p].c === "Physician") && (!state.newPatientOnly || Boolean(slot.np));
  };

  function filteredIndices(key = state.selected) {
    const source = key ? (slotsByArea[state.granularity].get(key) || []) : allIndices;
    return source.filter((index) => {
      const slot = DATA.slots[index];
      return visibleVisit(index) && inRadius(index) && slot.d >= state.from && slot.d <= state.through && (state.view === "diff" || slot.y === state.view);
    });
  }
  function areaCounts(key) {
    const counts = { ah: 0, oh: 0 };
    for (const index of slotsByArea[state.granularity].get(key) || []) {
      const slot = DATA.slots[index];
      if (visibleVisit(index) && inRadius(index) && slot.d >= state.from && slot.d <= state.through) counts[slot.y] += 1;
    }
    return counts;
  }
  function telemedicineInScope() {
    const source = state.selected ? (slotsByArea[state.granularity].get(state.selected) || []) : allIndices;
    let count = 0;
    for (const index of source) {
      const slot = DATA.slots[index];
      if (slot.v && inRadius(index) && slot.d >= state.from && slot.d <= state.through && (state.view === "diff" || slot.y === state.view)) count += 1;
    }
    return count;
  }
  function shades(values, color) {
    if (!values.length) return () => "#e6e2dc";
    const sorted = [...values].sort((a, b) => a - b);
    const breaks = [0.2, 0.4, 0.6, 0.8].map((p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]);
    const blues = ["#d8e7f1", "#a9c9df", "#73a9cd", "#397fac", "#005c99"];
    const reds = ["#f2dce2", "#e3a9b9", "#d37490", "#c33c63", "#9b092f"];
    return (value) => {
      if (!value) return "#e6e2dc";
      let bin = 0;
      while (bin < breaks.length && value >= breaks[bin]) bin += 1;
      return (color === "ah" ? blues : reds)[bin];
    };
  }
  function colorScale() {
    const rows = PATHS[state.granularity].map(({ k }) => areaCounts(k));
    const ah = shades(rows.map((row) => row.ah).filter(Boolean), "ah");
    const oh = shades(rows.map((row) => row.oh).filter(Boolean), "oh");
    const diff = shades(rows.map((row) => Math.abs(row.ah - row.oh)).filter(Boolean), "ah");
    const redDiff = shades(rows.map((row) => Math.abs(row.ah - row.oh)).filter(Boolean), "oh");
    return (key) => {
      const row = areaCounts(key);
      if (!row.ah && !row.oh) return "#e6e2dc";
      if (state.view === "ah") return ah(row.ah);
      if (state.view === "oh") return oh(row.oh);
      if (row.ah === row.oh) return "url(#tie-pattern)";
      return row.ah > row.oh ? diff(row.ah - row.oh) : redDiff(row.oh - row.ah);
    };
  }
  function layerHtml(granularity) {
    return PATHS[granularity].map(({ k, d }) => `<path class="area ${granularity}" data-key="${esc(k)}" d="${d}"></path>`).join("");
  }
  function drawMap() {
    $("map-vp").innerHTML = `<path class="land" d="${OUTLINE}"></path><g id="county-layer">${layerHtml("county")}</g><g id="zip-layer">${layerHtml("zip")}</g><g id="radius-layer"><circle id="radius-ring" class="radius-ring"></circle></g><g id="facility-marker-layer"></g><g id="radius-controls" class="hidden"><circle id="radius-hit" class="radius-hit"></circle><circle id="radius-handle" class="radius-handle"></circle><g id="origin-grip" class="origin-grip"><circle r="10"></circle><path d="M0 -7V7M-7 0H7M-3 -4L0 -7L3 -4M-3 4L0 7L3 4M-4 -3L-7 0L-4 3M4 -3L7 0L4 3"></path></g></g><path class="coast" d="${OUTLINE}"></path>`;
    bindMapAreas();
    paintMap();
  }
  function paintMap() {
    $("county-layer").classList.toggle("hidden", state.granularity !== "county");
    $("zip-layer").classList.toggle("hidden", state.granularity !== "zip");
    const color = colorScale();
    document.querySelectorAll(`#${state.granularity}-layer .area`).forEach((path) => {
      const key = path.dataset.key;
      path.setAttribute("fill", color(key));
      path.classList.toggle("selected", key === state.selected);
    });
    const origin = originByZip.get(state.originZip), radiusLayer = $("radius-layer");
    radiusLayer.classList.toggle("hidden", !state.radiusActive || !origin);
    $("radius-controls").classList.toggle("hidden", !state.radiusActive || !origin);
    if (state.radiusActive && origin) {
      $("radius-ring").setAttribute("cx", origin.x); $("radius-ring").setAttribute("cy", origin.y);
      $("radius-ring").setAttribute("r", (state.radius * origin.m).toFixed(1));
      placeRadiusControls(origin);
    }
    $("map-title").textContent = state.radiusActive ? `Appointments within ${state.radius} miles of ${state.originZip}` : `Physical appointments per ${state.granularity === "zip" ? "ZIP code" : "county"}`;
    $("map-meta").textContent = `${longDate(state.from)} – ${longDate(state.through)}`;
    renderMapMarkers();
    motion.queue();
  }
  function renderMapMarkers() {
    // One dot per facility. Facilities that share a ZIP sit on a small ring around the ZIP point so every location
    // stays visible and clickable; dots keep one screen size at every zoom (sizes and offsets divide by the zoom).
    const perFacility = new Map();
    filteredIndices().forEach((index) => {
      const slot = DATA.slots[index], facility = DATA.facilities[slot.f], origin = originByZip.get(facility.z);
      if (!origin) return;
      const row = perFacility.get(slot.f) || { id: slot.f, system: slot.y, zip: facility.z, origin, slots: 0 };
      row.slots += 1; perFacility.set(slot.f, row);
    });
    const byZip = new Map();
    for (const row of perFacility.values()) { if (!byZip.has(row.zip)) byZip.set(row.zip, []); byZip.get(row.zip).push(row); }
    const markers = [];
    for (const rows of byZip.values()) {
      rows.sort((a, b) => a.system.localeCompare(b.system) || b.slots - a.slots);
      rows.forEach((row, index) => {
        row.radius = 7.5;
        if (rows.length === 1) { row.ox = 0; row.oy = 0; return; }
        const ring = Math.max(row.radius + 9, rows.length * (2 * row.radius + 1.5) / (2 * Math.PI)), angle = -Math.PI / 2 + (2 * Math.PI * index) / rows.length;
        row.ox = Math.cos(angle) * ring; row.oy = Math.sin(angle) * ring;
      });
      markers.push(...rows);
    }
    $("facility-marker-layer").innerHTML = markers.map((row) => `<circle class="facility-marker ${row.system}" cx="${(row.origin.x + row.ox / currentZoom).toFixed(2)}" cy="${(row.origin.y + row.oy / currentZoom).toFixed(2)}" r="${(row.radius / currentZoom).toFixed(2)}" data-r="${row.radius.toFixed(2)}" data-cx="${row.origin.x}" data-cy="${row.origin.y}" data-ox="${row.ox.toFixed(2)}" data-oy="${row.oy.toFixed(2)}" tabindex="0" data-facility="${row.id}" aria-label="${esc(DATA.facilities[row.id].n)} · ${number(row.slots)} appointments"></circle>`).join("");
    $("facility-marker-layer").querySelectorAll(".facility-marker").forEach((marker) => {
      marker.addEventListener("pointerdown", (event) => event.stopPropagation());
      marker.addEventListener("mousemove", (event) => showMarkerTip(event, marker));
      marker.addEventListener("mouseleave", () => { $("tip").style.opacity = "0"; });
      const activate = () => openFacility(Number(marker.dataset.facility));
      marker.addEventListener("click", (event) => { event.stopPropagation(); if (motion.moved()) return; activate(); });
      marker.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } });
    });
  }
  function bindMapAreas() {
    document.querySelectorAll(".area").forEach((path) => {
      path.addEventListener("click", () => { if (motion.moved()) return; selectArea(state.selected === path.dataset.key ? "" : path.dataset.key); });
      path.addEventListener("mousemove", (event) => showTip(event, path.dataset.key));
      path.addEventListener("mouseleave", () => $("tip").style.opacity = "0");
    });
  }
  let currentZoom = 1;
  // The ring can be moved by its centre grip (it snaps to the nearest ZIP) and resized by its edge or the handle on it.
  function placeRadiusControls(origin) {
    const ring = state.radius * origin.m;
    $("radius-hit").setAttribute("cx", origin.x); $("radius-hit").setAttribute("cy", origin.y); $("radius-hit").setAttribute("r", ring.toFixed(1));
    $("radius-handle").setAttribute("cx", (origin.x + ring).toFixed(1)); $("radius-handle").setAttribute("cy", origin.y); $("radius-handle").setAttribute("r", (6 / currentZoom).toFixed(2));
    $("origin-grip").setAttribute("transform", `translate(${origin.x} ${origin.y}) scale(${(1 / currentZoom).toFixed(4)})`);
  }
  function clientToMap(clientX, clientY) {
    const rect = svg.getBoundingClientRect(), s = Math.min(rect.width / W, rect.height / H) || 1;
    const ox = (rect.width - W * s) / 2, oy = (rect.height - H * s) / 2, Z = motion.drawn;
    return [((clientX - rect.left - ox) / s - Z.x) / Z.k, ((clientY - rect.top - oy) / s - Z.y) / Z.k];
  }
  let radiusDrag = null;
  const scheduleRadiusRefresh = () => { clearTimeout(radiusTimer); radiusTimer = setTimeout(() => { radiusTimer = 0; refresh(); }, 150); };
  document.addEventListener("pointerdown", (event) => {
    const target = event.target && event.target.closest ? event.target.closest("#radius-hit, #radius-handle, #origin-grip") : null;
    if (!target || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    radiusDrag = { mode: target.id === "origin-grip" ? "move" : "resize" };
    if (target.setPointerCapture) { try { target.setPointerCapture(event.pointerId); } catch (error) { /* older browsers */ } }
    svg.classList.add("radius-dragging");
  }, true);
  document.addEventListener("pointermove", (event) => {
    if (!radiusDrag) return;
    const [x, y] = clientToMap(event.clientX, event.clientY);
    if (radiusDrag.mode === "move") {
      let best = null, bestDistance = Infinity;
      for (const origin of origins) { const d = (origin.x - x) ** 2 + (origin.y - y) ** 2; if (d < bestDistance) { bestDistance = d; best = origin; } }
      if (!best || best.z === state.originZip) return;
      state.originZip = best.z; state.areaQuery = best.z; state.radiusActive = true; state.selected = ""; $("origin-zip").value = best.z;
    } else {
      const origin = originByZip.get(state.originZip); if (!origin) return;
      const miles = Math.max(5, Math.min(250, Math.round(Math.hypot(x - origin.x, y - origin.y) / origin.m / 5) * 5));
      if (miles === state.radius) return;
      state.radius = miles; state.radiusActive = true; $("radius").value = miles;
    }
    $("clear-area").disabled = false; syncScopeControls(); previewRadius();
  });
  const endRadiusDrag = () => { if (!radiusDrag) return; radiusDrag = null; svg.classList.remove("radius-dragging"); if (radiusTimer) { clearTimeout(radiusTimer); radiusTimer = 0; } refresh(); };
  document.addEventListener("pointerup", endRadiusDrag); document.addEventListener("pointercancel", endRadiusDrag);
  function scaleMarkers(zoom) {
    currentZoom = zoom;
    { const origin = originByZip.get(state.originZip); if (origin && state.radiusActive) placeRadiusControls(origin); }
    document.querySelectorAll("#facility-marker-layer .facility-marker").forEach((marker) => {
      marker.setAttribute("r", (Number(marker.dataset.r) / zoom).toFixed(2));
      marker.setAttribute("cx", (Number(marker.dataset.cx) + Number(marker.dataset.ox) / zoom).toFixed(2));
      marker.setAttribute("cy", (Number(marker.dataset.cy) + Number(marker.dataset.oy) / zoom).toFixed(2));
    });
  }
  // Hover card for a facility dot: name, address, and its slot and provider counts under the active filters.
  function showMarkerTip(event, marker) {
    const id = Number(marker.dataset.facility), facility = DATA.facilities[id], summary = facilitySummary.get(id) || { ah: 0, oh: 0, providers: new Set() };
    const slots = summary.ah + summary.oh, distance = state.radiusActive ? ` · ${facilityDistance(id).toFixed(1)} mi` : "";
    const tip = $("tip");
    tip.innerHTML = `<span class="zh">${esc(facility.n)}</span> <span class="cty">${esc([facility.a, facility.c].filter(Boolean).join(", "))}${esc(distance)}</span><div class="r"><span class="${facility.y}">${facility.y === "ah" ? "AdventHealth" : "Orlando Health"}</span><b>${number(slots)} slot${slots === 1 ? "" : "s"}</b></div><div class="lead">${number(summary.providers.size)} provider${summary.providers.size === 1 ? "" : "s"}</div>`;
    tip.style.left = `${event.clientX + 14}px`; tip.style.top = `${event.clientY + 14}px`; tip.style.opacity = "1";
  }
  function showTip(event, key) {
    const counts = areaCounts(key);
    const title = state.granularity === "county" ? `${key} County` : key, sub = state.granularity === "zip" && DATA.zipCounty?.[key] ? `${DATA.zipCounty[key]} County` : "";
    const lead = counts.ah === counts.oh ? "Even" : counts.ah > counts.oh ? `AdventHealth +${number(counts.ah - counts.oh)}` : `Orlando Health +${number(counts.oh - counts.ah)}`;
    const tip = $("tip");
    tip.innerHTML = `<span class="zh">${esc(title)}</span> <span class="cty">${esc(sub)}</span><div class="r"><span class="ah">AdventHealth</span><b>${number(counts.ah)}</b></div><div class="r"><span class="oh">Orlando Health</span><b>${number(counts.oh)}</b></div><div class="lead">${lead}</div>`;
    tip.style.left = `${event.clientX + 14}px`; tip.style.top = `${event.clientY + 14}px`; tip.style.opacity = "1";
  }
  function areaSearchLabel(key) {
    if (!key) return "";
    return state.granularity === "zip" && DATA.zipCounty?.[key] ? `${key} · ${DATA.zipCounty[key]} County` : key;
  }
  function syncScopeControls(message = "") {
    $("radius-value").textContent = `${state.radius} miles`;
    $("clear-radius").disabled = !state.radiusActive;
    $("origin-zip").setAttribute("aria-invalid", String(Boolean(message)));
    // the line under the radius controls only appears for a problem (an unknown ZIP); the scope itself shows in the summary
    $("radius-status").classList.toggle("error", Boolean(message));
    $("radius-status").textContent = message;
    $("radius-status").hidden = !message;
  }
  function selectArea(key = "") {
    if ($("facility-dialog").open) $("facility-dialog").close();
    if (key) { state.radiusActive = false; state.areaQuery = key; }
    state.selected = key;
    $("area-search").value = key ? areaSearchLabel(key) : state.areaQuery;
    $("clear-area").disabled = !(key || state.radiusActive);
    syncScopeControls();
    const dates = filteredIndices().map((index) => DATA.slots[index].d);
    if (!dates.includes(state.selectedDate)) state.selectedDate = dates[0] || state.from;
    state.month = new Date(`${state.selectedDate}T12:00:00`);
    paintMap(); renderKpis(); renderSummary(); renderAvailabilityProfile(); renderFacilities(); renderCalendar(); renderProviders();
  }
  function selectedLabel() {
    if (state.radiusActive) return `Within ${state.radius} miles of ${state.originZip}`;
    if (!state.selected) return "Florida statewide";
    if (state.granularity === "county") return `${state.selected} County`;
    const county = DATA.zipCounty?.[state.selected];
    return county ? `${state.selected} · ${county} County` : state.selected;
  }
  function renderSummary() {
    const indices = filteredIndices();
    const counts = { ah: 0, oh: 0 }, providers = new Set(), facilities = new Set();
    indices.forEach((index) => { const slot = DATA.slots[index]; counts[slot.y] += 1; providers.add(slot.p); facilities.add(slot.f); });
    $("area-name").textContent = selectedLabel();
    const delta = counts.ah - counts.oh;
    $("area-lead").innerHTML = !indices.length ? `<span>${state.radiusActive ? `No appointments within ${state.radius} miles. Expand the radius to search farther.` : "No appointments under the active filters."}</span>` : delta === 0 ? "<span>Availability is even</span>" : `<span class="system-logo ${delta > 0 ? "ah" : "oh"}" role="img" aria-label="${delta > 0 ? "AdventHealth" : "Orlando Health"}"></span><span>leads by ${number(Math.abs(delta))} appointments</span>`;
  }
  function renderAvailabilityProfile() {
    const counts = new Map();
    filteredIndices().forEach((index) => {
      const slot = DATA.slots[index], row = counts.get(slot.d) || { ah: 0, oh: 0 };
      row[slot.y] += 1; counts.set(slot.d, row);
    });
    const rows = [...counts].sort(([a], [b]) => a.localeCompare(b)).slice(0, 10);
    const maximum = Math.max(1, ...rows.map(([, row]) => row.ah + row.oh));
    $("availability-profile").innerHTML = rows.length ? rows.map(([date, row]) => {
      const total = row.ah + row.oh;
      return `<div class="profile-row"><span class="profile-date">${esc(shortDate(date))}</span><span class="profile-bars" title="${number(row.ah)} AdventHealth · ${number(row.oh)} Orlando Health"><i class="ah" style="width:${(row.ah / maximum * 100).toFixed(2)}%"></i><i class="oh" style="width:${(row.oh / maximum * 100).toFixed(2)}%"></i></span><strong>${number(total)}</strong></div>`;
    }).join("") : `<div class="empty profile-empty">${state.radiusActive ? `No appointments within ${number(state.radius)} miles of ${esc(state.originZip)}. Expand the radius to search farther.` : "No appointments under the active filters."}</div>`;
  }
  let facilitySummary = new Map();
  function renderFacilities() {
    const grouped = new Map();
    filteredIndices().forEach((index) => {
      const slot = DATA.slots[index], facility = DATA.facilities[slot.f];
      if (!grouped.has(slot.f)) grouped.set(slot.f, { facility, facilityIndex: slot.f, ah: 0, oh: 0, providers: new Set() });
      const row = grouped.get(slot.f); row[slot.y] += 1; row.providers.add(slot.p);
    });
    facilitySummary = grouped;
    const rows = [...grouped.values()].sort((a, b) => state.radiusActive
      ? facilityDistance(a.facilityIndex) - facilityDistance(b.facilityIndex) || (b.ah + b.oh) - (a.ah + a.oh)
      : (b.ah + b.oh) - (a.ah + a.oh));
    const query = "";
    const visibleRows = rows.filter(({ facility }) => !query || `${facility.n} ${facility.a} ${facility.c} ${facility.z}`.toLowerCase().includes(query));
    $("facility-title").textContent = state.radiusActive ? "Facilities with availability within the radius" : "Facilities with availability";
    const emptyMessage = !rows.length && state.radiusActive
      ? `<div class="empty radius-empty">No facilities with appointments within ${number(state.radius)} miles of ${esc(state.originZip)}. Expand the radius to search farther.</div>`
      : '<div class="empty">No facilities match the active filters and search.</div>';
    $("facility-list").innerHTML = visibleRows.length ? visibleRows.map(({ facility, facilityIndex, ah, oh, providers }) => {
      const distance = state.radiusActive ? `<strong class="facility-distance">${facilityDistance(facilityIndex).toFixed(1)} mi</strong>` : "";
      const total = ah + oh;
      return `<button type="button" class="facility" data-facility="${facilityIndex}" title="${esc(facility.n)} · click to view"><div class="facility-line"><span class="system-logo ${facility.y}" role="img" aria-label="${facility.y === "ah" ? "AdventHealth" : "Orlando Health"}"></span><span class="facility-name">${esc(facility.n)}</span>${distance}</div><div class="facility-line"><span class="facility-meta">${esc([facility.a, facility.c, facility.z].filter(Boolean).join(", "))}</span><span class="facility-counts"><b>${number(total)}</b> slot${total === 1 ? "" : "s"} · <b>${number(providers.size)}</b> provider${providers.size === 1 ? "" : "s"}</span></div></button>`;
    }).join("") : emptyMessage;
    $("facility-list").querySelectorAll("[data-facility]").forEach((button) => button.addEventListener("click", () => openFacility(Number(button.dataset.facility))));
  }
  function openFacility(facilityIndex) {
    const facility = DATA.facilities[facilityIndex];
    if (!facility) return;
    const indices = filteredIndices().filter((index) => DATA.slots[index].f === facilityIndex);
    const doctors = new Map(), dates = new Set();
    indices.forEach((index) => {
      const slot = DATA.slots[index], provider = DATA.providers[slot.p]; dates.add(slot.d);
      if (!doctors.has(slot.p)) doctors.set(slot.p, { provider, slots: [] });
      doctors.get(slot.p).slots.push(slot);
    });
    const dialog = $("facility-dialog");
    $("dialog-system").textContent = ""; $("dialog-system").className = `system-logo big ${facility.y}`; $("dialog-system").setAttribute("aria-label", facility.y === "ah" ? "AdventHealth" : "Orlando Health");
    $("dialog-title").textContent = facility.n;
    $("dialog-address").textContent = [facility.a, facility.c, "FL", facility.z].filter(Boolean).join(" · ");
    $("dialog-summary").innerHTML = `<span><strong>${number(indices.length)}</strong> appointments</span><span><strong>${number(doctors.size)}</strong> providers</span><span><strong>${number(dates.size)}</strong> bookable dates</span>${state.radiusActive ? `<span><strong>${facilityDistance(facilityIndex).toFixed(1)}</strong> miles from ${esc(state.originZip)}</span>` : ""}`;
    $("doctor-list").innerHTML = doctors.size ? [...doctors.values()].sort((a, b) => a.provider.n.localeCompare(b.provider.n)).map(({ provider, slots }) => {
      slots.sort((a, b) => a.u.localeCompare(b.u));
      const types = [...new Set(slots.flatMap(slotTypes))];
      return `<article class="doctor"><h3>${esc(provider.n)}${provider.c ? `, ${esc(provider.c)}` : ""}</h3><p>${number(slots.length)} appointments${types.length ? ` · ${types.map(typeLabel).map(esc).join(" · ")}` : ""}</p><div class="slot-list">${slots.map((slot, index) => `<span class="slot${index >= 6 ? " extra-slot" : ""}"${index >= 6 ? " hidden" : ""}>${esc(longDate(slot.d))} · ${esc(slot.t)}</span>`).join("")}${slots.length > 6 ? `<button type="button" class="more-slots" data-more="${slots.length - 6}" aria-expanded="false">+${number(slots.length - 6)} more</button>` : ""}</div></article>`;
    }).join("") : '<div class="empty dialog-empty">No appointments for this location under the active filters.</div>';
    $("doctor-list").querySelectorAll(".more-slots").forEach((button) => button.addEventListener("click", () => {
      const expanded = button.getAttribute("aria-expanded") === "true";
      button.closest(".doctor").querySelectorAll(".extra-slot").forEach((slot) => { slot.hidden = expanded; });
      button.setAttribute("aria-expanded", String(!expanded)); button.textContent = expanded ? `+${number(button.dataset.more)} more` : "Show less";
    }));
    if (!dialog.open) dialog.showModal();
  }
  function renderCalendar() {
    $("month-label").textContent = monthLabel(state.month);
    const year = state.month.getFullYear(), month = state.month.getMonth();
    const first = new Date(year, month, 1), start = new Date(year, month, 1 - first.getDay());
    const counts = new Map();
    filteredIndices().forEach((index) => { const slot = DATA.slots[index], row = counts.get(slot.d) || { ah: 0, oh: 0 }; row[slot.y] += 1; counts.set(slot.d, row); });
    let html = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<div class="dow">${day}</div>`).join("");
    for (let i = 0; i < 42; i += 1) {
      const date = new Date(start); date.setDate(start.getDate() + i);
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const row = counts.get(iso), total = row ? row.ah + row.oh : 0, share = total ? Math.round(row.ah / total * 100) : 50;
      html += `<button class="day${date.getMonth() !== month ? " out" : ""}${total ? " has" : ""}${iso === state.selectedDate ? " selected" : ""}" data-date="${iso}" style="--ah-share:${share}%" ${total ? "" : "disabled"}>${date.getDate()}${total ? `<span class="day-count">${number(total)}</span>` : ""}</button>`;
    }
    $("calendar").innerHTML = html;
    $("calendar").querySelectorAll(".day.has").forEach((button) => button.addEventListener("click", () => { state.selectedDate = button.dataset.date; renderCalendar(); renderProviders(); }));
  }
  // The slot-mix ring follows the calendar: it shows the chosen day's AdventHealth and Orlando Health split.
  function renderMix(counts) {
    const total = counts.ah + counts.oh, ahShare = total ? counts.ah / total * 100 : 50;
    $("mix-total").innerHTML = `<span>${number(total)}</span><small>slots</small>`;
    $("mix-ah").textContent = `${number(counts.ah)} · ${total ? Math.round(counts.ah / total * 100) : 0}%`;
    $("mix-oh").textContent = `${number(counts.oh)} · ${total ? Math.round(counts.oh / total * 100) : 0}%`;
    $("mix-donut").style.background = total ? `conic-gradient(var(--ah) 0 ${ahShare}%, var(--oh) ${ahShare}% 100%)` : "#edf0f2";
  }
  function renderProviders() {
    const grouped = new Map(), dayCounts = { ah: 0, oh: 0 };
    filteredIndices().forEach((index) => {
      const slot = DATA.slots[index]; if (slot.d !== state.selectedDate) return;
      dayCounts[slot.y] += 1;
      const provider = DATA.providers[slot.p], facility = DATA.facilities[slot.f];
      const key = `${slot.p}|${slot.f}`;
      if (!grouped.has(key)) grouped.set(key, { provider, facility, system: slot.y, slots: [], types: new Set() });
      const row = grouped.get(key); row.slots.push(slot); slot.ty.forEach((type) => row.types.add(DATA.types[type]));
    });
    const rows = [...grouped.values()].sort((a, b) => a.provider.n.localeCompare(b.provider.n));
    $("provider-date").textContent = longDate(state.selectedDate);
    renderMix(dayCounts);
    $("provider-list").innerHTML = rows.length ? rows.map((row) => {
      const badges = row.system === "ah" ? [...row.types].map((type) => `<span class="badge">${esc(typeLabel(type))}</span>`).join("") : "";
      const more = row.slots.length - 8;
      return `<article class="provider-card"><div class="provider-top"><div><div class="provider-name">${esc(row.provider.n)}${row.provider.c ? `, ${esc(row.provider.c)}` : ""}</div><div class="provider-meta">${esc(row.facility.n)} · ${number(row.slots.length)} appointment${row.slots.length === 1 ? "" : "s"}</div></div><span class="system-logo ${row.system}" role="img" aria-label="${row.system === "ah" ? "AdventHealth" : "Orlando Health"}"></span></div>${badges ? `<div class="badges">${badges}</div>` : ""}<div class="times">${row.slots.map((slot, index) => `<span class="time${index >= 8 ? " extra-time" : ""}"${index >= 8 ? " hidden" : ""}>${esc(slot.t || new Date(slot.u).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }))}</span>`).join("")}${more > 0 ? `<button type="button" class="time more more-times" data-more="${more}" aria-expanded="false">+${number(more)} more</button>` : ""}</div></article>`;
    }).join("") : `<div class="empty">${!filteredIndices().length && state.radiusActive ? `No appointments within ${number(state.radius)} miles of ${esc(state.originZip)}. Expand the radius to see available providers.` : "Choose a highlighted date to see available providers and appointment times."}</div>`;
    $("provider-list").querySelectorAll(".more-times").forEach((button) => button.addEventListener("click", () => {
      const expanded = button.getAttribute("aria-expanded") === "true";
      button.closest(".provider-card").querySelectorAll(".extra-time").forEach((time) => { time.hidden = expanded; });
      button.setAttribute("aria-expanded", String(!expanded)); button.textContent = expanded ? `+${number(button.dataset.more)} more` : "Show less";
    }));
  }
  function renderKpis() {
    const indices = filteredIndices();
    const counts = { ah: 0, oh: 0 }, providers = { ah: new Set(), oh: new Set() }, facilities = { ah: new Set(), oh: new Set() }, dates = new Set();
    indices.forEach((index) => { const slot = DATA.slots[index]; counts[slot.y] += 1; providers[slot.y].add(slot.p); facilities[slot.y].add(slot.f); dates.add(slot.d); });
    $("kpi-ah").textContent = number(counts.ah); $("kpi-oh").textContent = number(counts.oh);
    const noRadiusResults = !indices.length && state.radiusActive;
    const filtered = state.physiciansOnly || state.hideTelemedicine || state.newPatientOnly;
    const slotLabel = filtered ? `${state.physiciansOnly ? "Physician " : ""}${state.hideTelemedicine ? "in-person " : ""}${state.newPatientOnly ? "new-patient " : ""}slots`.replace(/^\w/, (c) => c.toUpperCase()) : "Available appointment slots";
    $("kpi-ah-sub").textContent = noRadiusResults ? `No appointments within ${state.radius} miles — expand radius` : slotLabel;
    $("kpi-oh-sub").textContent = noRadiusResults ? `No appointments within ${state.radius} miles — expand radius` : slotLabel;
    $("kpi-providers-ah").textContent = number(providers.ah.size); $("kpi-providers-oh").textContent = number(providers.oh.size);
    $("kpi-facilities-ah").textContent = number(facilities.ah.size); $("kpi-facilities-oh").textContent = number(facilities.oh.size);
  }
  function refresh() { if (state.selected && !slotsByArea[state.granularity].has(state.selected)) state.selected = ""; selectArea(state.selected); }
  function setPressed(prefix, value, choices) { choices.forEach((choice) => $(`${prefix}-${choice}`)?.setAttribute("aria-pressed", String(choice === value))); }
  ["zip", "county"].forEach((value) => $(`gran-${value}`).addEventListener("click", () => { state.granularity = value; state.selected = ""; state.areaQuery = ""; setPressed("gran", value, ["zip", "county"]); fillSearch(); refresh(); }));
  ["diff", "ah", "oh"].forEach((value) => $(`view-${value}`).addEventListener("click", () => { state.view = value; setPressed("view", value, ["diff", "ah", "oh"]); refresh(); }));
  ["show", "hide"].forEach((value) => $(`tele-${value}`).addEventListener("click", () => { state.hideTelemedicine = value === "hide"; setPressed("tele", value, ["show", "hide"]); refresh(); }));
  ["phys", "all"].forEach((value) => $(`clin-${value}`).addEventListener("click", () => { state.physiciansOnly = value === "phys"; setPressed("clin", value, ["phys", "all"]); refresh(); }));
  ["all", "new"].forEach((value) => $(`vt-${value}`).addEventListener("click", () => { state.newPatientOnly = value === "new"; setPressed("vt", value, ["all", "new"]); refresh(); }));
  // An emptied date field (Backspace clears the segment) falls back to today / the comparison endpoint instead of loading nothing.
  $("from-date").addEventListener("change", (event) => { $("period-preset").value = "custom"; state.from = event.target.value || window.SUITE_DATE.today(); if (state.through < state.from) { state.through = state.from; } $("from-date").value = state.from; $("through-date").value = state.through; refreshPeriod(); });
  $("through-date").addEventListener("change", (event) => { $("period-preset").value = "custom"; state.through = event.target.value || (comparisonThrough < state.from ? state.from : comparisonThrough); if (state.from > state.through) { state.from = state.through; } $("from-date").value = state.from; $("through-date").value = state.through; refreshPeriod(); });
  // Quick periods: today through the next N days (capped at the last published day), or the full comparison window.
  const addDays = (iso, days) => { const date = new Date(`${iso}T12:00:00`); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); };
  $("period-preset").addEventListener("change", (event) => {
    const choice = event.target.value; if (choice === "custom") return;
    const from = window.SUITE_DATE.today(); const last = $("through-date").max || DATA.maxDate;
    let through = choice === "all" ? (comparisonThrough < from ? from : comparisonThrough) : addDays(from, Number(choice));
    if (through > last) through = last; if (through < from) through = from;
    state.from = from; state.through = through; $("from-date").value = from; $("through-date").value = through; refreshPeriod();
  });
  $("reset").addEventListener("click", () => {
    $("period-preset").value = "90";
    const resetFrom = window.SUITE_DATE.today();
    const resetThrough = landingThrough(resetFrom);
    const resetSlotDate = DATA.slots.find((slot) => slot.d >= resetFrom && slot.d <= resetThrough)?.d || resetFrom;
    state.granularity = "zip"; state.selected = ""; state.selectedDate = resetSlotDate;
    state.month = new Date(`${resetSlotDate}T12:00:00`); state.from = resetFrom; state.through = resetThrough; state.view = "diff"; state.hideTelemedicine = false; state.physiciansOnly = false; state.newPatientOnly = false;
    state.originZip = defaultOriginZip; state.radius = landingRadius; state.radiusActive = Boolean(defaultOriginZip); state.areaQuery = "";
    $("from-date").value = state.from; $("through-date").value = state.through;
    $("origin-zip").value = ""; $("radius").value = state.radius; $("area-search").value = "";
setPressed("gran", "zip", ["zip", "county"]); setPressed("view", "diff", ["diff", "ah", "oh"]); setPressed("tele", "show", ["show", "hide"]); setPressed("clin", "all", ["phys", "all"]); setPressed("vt", "all", ["all", "new"]);
    fillSearch(); resetZoom(); refreshPeriod();
  });
  $("area-search").addEventListener("change", (event) => {
    const raw = event.target.value.trim(), key = raw.split(" · ")[0];
    if (!raw) selectArea("");
    else if (state.granularity === "zip" && originByZip.has(key)) {
      state.originZip = key; state.radius = searchedZipRadius; state.radiusActive = true; state.selected = ""; state.areaQuery = key;
      $("origin-zip").value = key;
      $("radius").value = searchedZipRadius;
      refresh();
    }
    else if (slotsByArea[state.granularity].has(key)) selectArea(key);
    else event.target.value = areaSearchLabel(state.selected);
  });
  $("area-search").addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); selectArea(""); } });
  $("clear-area").addEventListener("click", () => { state.radiusActive = false; state.areaQuery = ""; selectArea(""); });
  $("close-dialog").addEventListener("click", () => $("facility-dialog").close());
  $("facility-dialog").addEventListener("click", (event) => { if (event.target === $("facility-dialog")) $("facility-dialog").close(); });
  function applyRadius() {
    const zip = $("origin-zip").value.trim();
    if (!originByZip.has(zip)) { syncScopeControls(`${zip || "ZIP"} is not a Florida ZCTA`); return; }
    state.originZip = zip; state.radius = searchedZipRadius; state.radiusActive = true; state.selected = ""; state.areaQuery = zip;
    $("radius").value = searchedZipRadius;
    refresh();
  }
  $("apply-radius").addEventListener("click", applyRadius);
  $("origin-zip").addEventListener("keydown", (event) => { if (event.key === "Enter") applyRadius(); });
  $("clear-radius").addEventListener("click", () => { state.radiusActive = false; state.areaQuery = ""; $("origin-zip").value = ""; refresh(); });
  let radiusTimer = 0;
  $("radius").addEventListener("input", (event) => {
    const candidate = $("origin-zip").value.trim();
    if (candidate && originByZip.has(candidate)) { state.originZip = candidate; state.areaQuery = candidate; }
    else if (candidate) $("origin-zip").value = "";
    state.radius = Number(event.target.value); state.radiusActive = true; state.selected = "";
    $("clear-area").disabled = false; syncScopeControls();
    previewRadius();
    clearTimeout(radiusTimer); radiusTimer = setTimeout(() => { radiusTimer = 0; refresh(); }, 150);
  });
  $("radius").addEventListener("change", () => { if (radiusTimer) { clearTimeout(radiusTimer); radiusTimer = 0; } refresh(); });
  // While the slider moves only the ring and the title follow it; the full recount over every slot waits until the drag settles.
  function previewRadius() {
    const origin = originByZip.get(state.originZip); if (!origin) return;
    $("radius-layer").classList.remove("hidden"); $("radius-controls").classList.remove("hidden");
    $("radius-ring").setAttribute("cx", origin.x); $("radius-ring").setAttribute("cy", origin.y); $("radius-ring").setAttribute("r", (state.radius * origin.m).toFixed(1));
    placeRadiusControls(origin);
    $("map-title").textContent = `Appointments within ${state.radius} miles of ${state.originZip}`;
  }
  $("month-prev").addEventListener("click", () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); renderCalendar(); });
  $("month-next").addEventListener("click", () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); renderCalendar(); });

  const svg = $("map"), vp = $("map-vp");
  // Canvas snapshot of the current map, used by the shared smooth zoom while the
  // map moves (see pages/shared/map-motion.js). Fills are read from the SVG nodes.
  const rasterPaths = { county: null, zip: null, land: null };
  const pathsFor = (granularity) => { if (!rasterPaths[granularity]) rasterPaths[granularity] = PATHS[granularity].map((path) => new Path2D(path.d)); return rasterPaths[granularity]; };
  function tiePattern(ctx) {
    const tile = document.createElement("canvas"); tile.width = 10; tile.height = 10; const t = tile.getContext("2d");
    t.fillStyle = "#1a75aa"; t.fillRect(0, 0, 5, 10); t.fillStyle = "#b20838"; t.fillRect(5, 0, 5, 10);
    const pattern = ctx.createPattern(tile, "repeat"); if (pattern && pattern.setTransform && typeof DOMMatrix === "function") pattern.setTransform(new DOMMatrix().rotate(45)); return pattern;
  }
  function drawSnapshot(ctx) {
    if (!rasterPaths.land) rasterPaths.land = new Path2D(OUTLINE);
    ctx.fillStyle = "#e6e2dc"; ctx.strokeStyle = "#c6d0d8"; ctx.lineWidth = .55; ctx.fill(rasterPaths.land); ctx.stroke(rasterPaths.land);
    const nodes = document.querySelectorAll(`#${state.granularity}-layer .area`), paths = pathsFor(state.granularity), tie = tiePattern(ctx);
    let selectedPath = null;
    ctx.strokeStyle = "#111"; ctx.lineWidth = state.granularity === "zip" ? .35 : .9;
    paths.forEach((path, index) => {
      const node = nodes[index], fill = node ? node.getAttribute("fill") : "";
      ctx.fillStyle = fill === "url(#tie-pattern)" ? (tie || "#e6e2dc") : (fill || "#e6e2dc"); ctx.fill(path); ctx.stroke(path);
      if (node && node.classList.contains("selected")) selectedPath = path;
    });
    if (selectedPath) { ctx.strokeStyle = "#111"; ctx.lineWidth = 2.4; ctx.stroke(selectedPath); }
    const origin = originByZip.get(state.originZip);
    if (state.radiusActive && origin) {
      ctx.save(); ctx.setLineDash([7, 5]); ctx.strokeStyle = "#005c99"; ctx.lineWidth = 2; ctx.fillStyle = "rgba(31,169,225,.11)";
      ctx.beginPath(); ctx.arc(origin.x, origin.y, state.radius * origin.m, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
    document.querySelectorAll("#facility-marker-layer .facility-marker").forEach((marker) => {
      ctx.fillStyle = marker.classList.contains("ah") ? "#005c99" : "#b20838";
      ctx.beginPath(); ctx.arc(Number(marker.getAttribute("cx")), Number(marker.getAttribute("cy")), Number(marker.getAttribute("r")), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
    if (state.radiusActive && origin) {
      const k = 1 / currentZoom; ctx.save(); ctx.translate(origin.x, origin.y); ctx.scale(k, k);
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "#14233e"; ctx.lineWidth = 2 * currentZoom; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(0, 7); ctx.moveTo(-7, 0); ctx.lineTo(7, 0); ctx.moveTo(-3, -4); ctx.lineTo(0, -7); ctx.lineTo(3, -4); ctx.moveTo(-3, 4); ctx.lineTo(0, 7); ctx.lineTo(3, 4); ctx.moveTo(-4, -3); ctx.lineTo(-7, 0); ctx.lineTo(-4, 3); ctx.moveTo(4, -3); ctx.lineTo(7, 0); ctx.lineTo(4, 3); ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = "#000"; ctx.lineWidth = 2; ctx.stroke(rasterPaths.land);
  }
  const motion = window.SUITE_MAP_MOTION.create({ svg, viewport: vp, raster: $("map-raster"), width: W, height: H, maxZoom: 60, draw: drawSnapshot, tip: $("tip"), onSettle: (Z) => { if (Z.k !== currentZoom) { scaleMarkers(Z.k); motion.queue(); } } });
  function resetZoom() { motion.reset(); }
  $("zoom-in").addEventListener("click", () => motion.zoomBy(1.5)); $("zoom-out").addEventListener("click", () => motion.zoomBy(1 / 1.5)); $("zoom-reset").addEventListener("click", resetZoom);

  function fillSearch() {
    const list = $("area-options");
    const keys = state.granularity === "zip" ? origins.map((origin) => origin.z) : [...slotsByArea.county.keys()];
    list.innerHTML = [...new Set(keys)].sort().map((key) => `<option value="${esc(key)}${state.granularity === "zip" && DATA.zipCounty?.[key] ? ` · ${esc(DATA.zipCounty[key])} County` : ""}"></option>`).join("");
    $("area-search").placeholder = state.granularity === "zip" ? "Find ZIP code" : "Find county";
  }
  $("origin-options").innerHTML = origins.map((origin) => `<option value="${esc(origin.z)}"></option>`).join("");
  $("origin-zip").value = "";
  $("from-date").min = DATA.minDate < defaultFrom ? DATA.minDate : defaultFrom; $("from-date").max = DATA.maxDate > defaultThrough ? DATA.maxDate : defaultThrough; $("from-date").value = defaultFrom;
  $("period-preset").value = "90";
  $("through-date").min = DATA.minDate < defaultFrom ? DATA.minDate : defaultFrom; $("through-date").max = DATA.maxDate > defaultThrough ? DATA.maxDate : defaultThrough; $("through-date").value = defaultThrough;
  fillSearch(); drawMap(); refresh();
})();
