// Browser code for the Market Opportunities page (inlined into public/market-opportunities.html by render.js).
// Loads the slot files for the chosen dates, ranks 25-mile markets with scoring.js, and draws the map, summary card, ranked list and dialog.
(async () => {
  const DATA = window.SLOT_DATA;
  const PATHS = window.ZIP_PATHS;
  const OUTLINE = window.FLORIDA_OUTLINE;
  const W = 1000, H = 940;
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const number = (value) => Number(value || 0).toLocaleString();
  const shortDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
  const longDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "No active slots";
  const systemName = (system) => system === "ah" ? "AdventHealth" : "Orlando Health";
  const logo = (system) => `<span class="system-logo ${system}" role="img" aria-label="${systemName(system)}"></span>`;
  const origins = DATA.origins || [];
  const originByZip = new Map(origins.map((origin) => [origin.z, origin]));
  const miles = window.SLOT_RADIUS.miles;
  const defaultOriginZip = originByZip.has("32804") ? "32804" : origins[0]?.z || "";
  const landingRadius = 140, searchedZipRadius = 50;
  const comparisonThrough = DATA.commonMaxDate || DATA.maxDate;
  const defaultFrom = window.SUITE_DATE.today();
  // The landing view is the next 90 days; the period controls reach every published date, loading days as needed.
  const addDaysIso = (iso, days) => { const date = new Date(`${iso}T12:00:00`); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); };
  const landingThrough = (from) => { const cap = addDaysIso(from, 90); return comparisonThrough < from ? from : (comparisonThrough < cap ? comparisonThrough : cap); };
  const defaultThrough = landingThrough(defaultFrom);
  await window.SLOT_PARTITIONS.load(defaultFrom, defaultThrough);
  const counties = [...new Set(Object.values(DATA.zipCounty || {}).filter(Boolean))].sort();
  const state = {
    from: defaultFrom, through: defaultThrough, originZip: defaultOriginZip,
    radius: landingRadius, radiusActive: Boolean(defaultOriginZip), county: "",
    filter: "all", marketMiles: 25, selectedZip: "",
  };
  // A market is every active facility within state.marketMiles of a ZIP that has one. Geography only chooses which markets are in view.
  let allRows = [], exactRows = [], visibleRows = [], rowByZip = new Map(), exactGapByZip = new Map();
  let currentZoom = 1, radiusTimer = 0, radiusDrag = null;

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
    if (state.filter === "lead") return rows.filter((row) => row.oh > row.ah);
    if (state.filter === "gap") return rows.filter((row) => exactGapByZip.has(row.zip));
    if (state.filter === "sooner") return rows.filter((row) => row.booksSooner);
    return rows;
  }

  function selectedLabel() {
    if (state.radiusActive) return `Within ${state.radius} miles of ${state.originZip}`;
    if (state.county) return `${state.county} County`;
    return "Florida statewide";
  }

  // Who leads inside one market, in plain words (text for tooltips and labels, logo markup for the lead line).
  function leadParts(row) {
    const scope = `within ${state.marketMiles} miles`;
    if (row.ah === 0 && row.oh > 0) return { system: "ah", text: `has no slots ${scope}` };
    if (row.slotGap > 0) return { system: "oh", text: `leads by ${number(row.slotGap)} appointments ${scope}` };
    if (row.slotGap < 0) return { system: "ah", text: `leads by ${number(-row.slotGap)} appointments ${scope}` };
    return { system: "", text: `Availability is even ${scope}` };
  }
  const leadLine = (row) => { const part = leadParts(row); return part.system ? `${systemName(part.system)} ${part.text}` : part.text; };
  const leadMarkup = (row) => { const part = leadParts(row); return part.system ? `${logo(part.system)}<span>${esc(part.text)}</span>` : `<span>${esc(part.text)}</span>`; };

  function drawMap() {
    $("map-vp").innerHTML = `<path class="land" d="${OUTLINE}"></path><g id="zip-layer">${PATHS.map((path) => `<path class="op-area" data-zip="${esc(path.k)}" d="${path.d}"></path>`).join("")}</g><g id="radius-layer" class="hidden"><circle id="radius-ring" class="radius-ring"></circle></g><g id="market-marker-layer"></g><g id="radius-controls" class="hidden"><circle id="radius-hit" class="radius-hit"></circle><circle id="radius-handle" class="radius-handle"></circle><g id="origin-grip" class="origin-grip"><circle r="10"></circle><path d="M0 -7V7M-7 0H7M-3 -4L0 -7L3 -4M-3 4L0 7L3 4M-4 -3L-7 0L-4 3M4 -3L7 0L4 3"></path></g></g><path class="coast" d="${OUTLINE}"></path>`;
  }

  function paintMap() {
    document.querySelectorAll(".op-area").forEach((path) => {
      path.setAttribute("fill", "#e6e2dc");
      path.classList.toggle("selected", path.dataset.zip === state.selectedZip);
    });
    const origin = originByZip.get(state.originZip), active = state.radiusActive && Boolean(origin);
    $("radius-layer").classList.toggle("hidden", !active); $("radius-controls").classList.toggle("hidden", !active);
    if (active) {
      $("radius-ring").setAttribute("cx", origin.x); $("radius-ring").setAttribute("cy", origin.y); $("radius-ring").setAttribute("r", (state.radius * origin.m).toFixed(1));
      placeRadiusControls(origin);
    }
    $("map-title").textContent = state.radiusActive ? `Markets within ${state.radius} miles of ${state.originZip}` : state.county ? `Markets in ${state.county} County` : "__LABEL__ markets across Florida";
    $("map-meta").textContent = `${state.marketMiles}-mile markets · ${longDate(state.from)} – ${longDate(state.through)}`;
    renderMapMarkers();
    motion.queue();
  }

  // One dot per market centre. Red wherever Orlando Health has something AdventHealth does not (it leads the market, or the
  // ZIP itself has no AdventHealth slots, shown with a white core); blue where AdventHealth leads. One screen size at every zoom.
  function renderMapMarkers() {
    $("market-marker-layer").innerHTML = visibleRows.map((row) => {
      const origin = originByZip.get(row.zip); if (!origin) return "";
      const gap = exactGapByZip.has(row.zip);
      return `<g class="market-marker ${row.oh > row.ah || gap ? "oh" : "ah"}${gap ? " gap" : ""}${row.zip === state.selectedZip ? " selected" : ""}" data-zip="${esc(row.zip)}" data-cx="${origin.x}" data-cy="${origin.y}" tabindex="0" role="button" aria-label="ZIP ${esc(row.zip)}, ${esc(row.county)} County: ${esc(leadLine(row))}" transform="translate(${origin.x} ${origin.y}) scale(${(1 / currentZoom).toFixed(4)})"><circle class="dot" r="7.5"></circle>${gap ? '<circle class="gap" r="2.6"></circle>' : ""}</g>`;
    }).join("");
    $("market-marker-layer").querySelectorAll(".market-marker").forEach((marker) => {
      marker.addEventListener("pointerdown", (event) => event.stopPropagation());
      marker.addEventListener("mousemove", (event) => showMarkerTip(event, marker));
      marker.addEventListener("mouseleave", () => { $("tip").style.opacity = "0"; });
      marker.addEventListener("click", (event) => { event.stopPropagation(); if (motion.moved()) return; selectMarket(marker.dataset.zip); });
      marker.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectMarket(marker.dataset.zip); } });
    });
  }

  function scaleMarkers(zoom) {
    currentZoom = zoom;
    const scale = (1 / zoom).toFixed(4);
    document.querySelectorAll("#market-marker-layer .market-marker").forEach((marker) => marker.setAttribute("transform", `translate(${marker.dataset.cx} ${marker.dataset.cy}) scale(${scale})`));
    const origin = originByZip.get(state.originZip); if (origin && state.radiusActive) placeRadiusControls(origin);
  }

  // Radius ring drag — keep identical to src/slot-times/client.js.
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
  // While the ring or the slider moves only the ring and the title follow it; the recount runs when the pointer is released.
  function previewRadius() {
    const origin = originByZip.get(state.originZip); if (!origin) return;
    $("radius-layer").classList.remove("hidden"); $("radius-controls").classList.remove("hidden");
    $("radius-ring").setAttribute("cx", origin.x); $("radius-ring").setAttribute("cy", origin.y); $("radius-ring").setAttribute("r", (state.radius * origin.m).toFixed(1));
    placeRadiusControls(origin);
    $("map-title").textContent = `Markets within ${state.radius} miles of ${state.originZip}`;
  }
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
      state.originZip = best.z; state.radiusActive = true; state.county = ""; $("origin-zip").value = best.z;
    } else {
      const origin = originByZip.get(state.originZip); if (!origin) return;
      const stepped = Math.max(5, Math.min(250, Math.round(Math.hypot(x - origin.x, y - origin.y) / origin.m / 5) * 5));
      if (stepped === state.radius) return;
      state.radius = stepped; state.radiusActive = true; $("radius").value = stepped;
    }
    $("radius-value").textContent = `${state.radius} miles`; previewRadius();
  });
  const endRadiusDrag = () => { if (!radiusDrag) return; radiusDrag = null; svg.classList.remove("radius-dragging"); if (radiusTimer) { clearTimeout(radiusTimer); radiusTimer = 0; } refresh(); };
  document.addEventListener("pointerup", endRadiusDrag); document.addEventListener("pointercancel", endRadiusDrag);

  // Hover card for a market dot.
  function showMarkerTip(event, marker) {
    const row = rowByZip.get(marker.dataset.zip); if (!row) return;
    const tip = $("tip");
    tip.innerHTML = `<div class="tip-facility"><strong>${esc(row.zip)} · ${esc(row.county)} County</strong><span class="tip-address">${state.marketMiles}-mile market · #${row.rank} of ${number(allRows.length)}</span><span class="oh">Orlando Health ${number(row.oh)}</span> · <span class="ah">AdventHealth ${number(row.ah)}</span><br>${esc(leadLine(row))}${exactGapByZip.has(row.zip) ? '<br><span class="oh">No AdventHealth slots in this ZIP</span>' : ""}</div><div class="tip-hint">Click to open the market</div>`;
    tip.style.left = `${event.clientX + 14}px`; tip.style.top = `${event.clientY + 14}px`; tip.style.opacity = "1";
  }

  function renderSummary() {
    const row = rowByZip.get(state.selectedZip);
    $("summary-overview").hidden = Boolean(row); $("summary-market").hidden = !row;
    const leaders = allRows.filter((candidate) => candidate.oh > candidate.ah);
    const largest = leaders.reduce((best, candidate) => (!best || candidate.slotGap > best.slotGap ? candidate : best), null);
    $("area-name").textContent = selectedLabel();
    $("kpi-coverage").textContent = number(leaders.length);
    $("kpi-priority").textContent = number(exactGapByZip.size);
    $("kpi-earlier").textContent = number(allRows.filter((candidate) => candidate.booksSooner).length);
    $("kpi-slot-gap").textContent = number(largest ? largest.slotGap : 0);
    $("kpi-slot-gap-sub").textContent = largest ? `ZIP ${largest.zip} · ${largest.county} County` : "No market where Orlando Health leads";
    $("area-lead").innerHTML = !allRows.length ? "No markets in this area for the chosen period" : leaders.length ? `${logo("oh")}<span>leads in ${number(leaders.length)} of ${number(allRows.length)} markets</span>` : `${logo("ah")}<span>leads in all ${number(allRows.length)} markets</span>`;
    if (!row) return;
    const gap = exactGapByZip.has(row.zip), nearest = row.nearestAhFacility == null ? null : DATA.facilities[row.nearestAhFacility];
    $("market-name").textContent = `ZIP ${row.zip} · ${row.county} County`;
    $("market-rank").textContent = `#${row.rank} of ${number(allRows.length)} · ${state.marketMiles}-mile market`;
    $("market-oh").textContent = number(row.oh); $("market-ah").textContent = number(row.ah);
    $("market-oh-sub").textContent = `${number(row.providersOh)} provider${row.providersOh === 1 ? "" : "s"} · ${number(row.facilitiesOh)} location${row.facilitiesOh === 1 ? "" : "s"}`;
    $("market-ah-sub").textContent = `${number(row.providersAh)} provider${row.providersAh === 1 ? "" : "s"} · ${number(row.facilitiesAh)} location${row.facilitiesAh === 1 ? "" : "s"}`;
    $("market-earliest-oh").textContent = shortDate(row.earliestOh); $("market-earliest-ah").textContent = shortDate(row.earliestAh);
    $("market-nearest").textContent = Number.isFinite(row.nearestAhMiles) ? `${row.nearestAhMiles.toFixed(1)} mi` : "None";
    $("market-nearest-sub").textContent = nearest ? nearest.n : "No AdventHealth location with slots in the period";
    $("market-reasons").innerHTML = marketReasons(row, { exactGap: gap }).map((reason) => `<span class="reason ${reason.system}">${esc(reason.text)}</span>`).join("");
    $("market-lead").innerHTML = leadMarkup(row);
  }

  // Ranked markets as compact rows under the summary card: rank, market, who leads by how much, then the numbers.
  function renderTable() {
    const total = allRows.length;
    $("market-count").textContent = `${visibleRows.length === total ? number(total) : `${number(visibleRows.length)} of ${number(total)}`} market${total === 1 ? "" : "s"} · 25-mile markets`;
    if (!visibleRows.length) { $("market-table").innerHTML = `<div class="empty">No markets match the active filters.</div>`; return; }
    const lead = (row) => row.slotGap > 0 ? `${logo("oh")} +${number(row.slotGap)}` : row.slotGap < 0 ? `${logo("ah")} +${number(-row.slotGap)}` : "Even";
    $("market-table").innerHTML = visibleRows.map((row) => `<button type="button" class="facility market-row${row.zip === state.selectedZip ? " selected" : ""}" data-zip="${esc(row.zip)}"><div class="facility-line"><span class="rank">#${row.rank}</span><span class="facility-name">${esc(row.zip)} · ${esc(row.county)} County</span><strong class="facility-distance lead-cell">${lead(row)}</strong></div><div class="facility-line"><span class="facility-meta"><span class="oh">Orlando Health ${number(row.oh)}</span> · <span class="ah">AdventHealth ${number(row.ah)}</span> · earliest ${shortDate(row.earliestOh)} / ${shortDate(row.earliestAh)}${Number.isFinite(row.nearestAhMiles) ? ` · nearest AdventHealth ${row.nearestAhMiles.toFixed(1)} mi` : ""}</span></div></button>`).join("");
  }

  function selectMarket(zip) {
    if (!rowByZip.has(zip)) return;
    state.selectedZip = zip;
    paintMap(); renderSummary(); renderTable();
    $("market-table").querySelector(".market-row.selected")?.scrollIntoView({ block: "nearest" });
  }
  function clearMarket() { state.selectedZip = ""; paintMap(); renderSummary(); renderTable(); }

  function facilityDistanceFrom(zip, facilityIndex) {
    return distanceBetweenZips(zip, DATA.facilities[facilityIndex]?.z);
  }

  // The facilities and providers inside the selected market, nearest first, six times per doctor and a "+N more".
  function openMarket(zip) {
    const row = rowByZip.get(zip); if (!row) return;
    const groups = new Map();
    for (const index of row.slotIndices) { const slot = DATA.slots[index]; if (!groups.has(slot.f)) groups.set(slot.f, []); groups.get(slot.f).push(index); }
    const insideMarket = new Set(groups.keys());
    if (row.nearestAhFacility != null && !groups.has(row.nearestAhFacility)) {
      const nearestIndices = [];
      DATA.slots.forEach((slot, index) => { if (slot.f === row.nearestAhFacility && slot.y === "ah" && slot.d >= state.from && slot.d <= state.through) nearestIndices.push(index); });
      if (nearestIndices.length) groups.set(row.nearestAhFacility, nearestIndices);
    }
    const facilities = [...groups.entries()].sort((a, b) => facilityDistanceFrom(zip, a[0]) - facilityDistanceFrom(zip, b[0]));
    const nearest = row.nearestAhFacility == null ? null : DATA.facilities[row.nearestAhFacility];
    $("dialog-title").textContent = `ZIP ${zip} · ${row.county} County`;
    $("dialog-subtitle").textContent = `${state.marketMiles}-mile market · ${number(row.facilitiesAh + row.facilitiesOh)} location${row.facilitiesAh + row.facilitiesOh === 1 ? "" : "s"} · ${number(row.providersAh + row.providersOh)} provider${row.providersAh + row.providersOh === 1 ? "" : "s"}`;
    $("dialog-summary").innerHTML = `<span>${logo("oh")} <strong>${number(row.oh)}</strong> slots</span><span>${logo("ah")} <strong>${number(row.ah)}</strong> slots</span><span><strong>${shortDate(row.earliestOh)}</strong> earliest Orlando Health</span><span><strong>${shortDate(row.earliestAh)}</strong> earliest AdventHealth</span>${nearest ? `<span>Nearest AdventHealth <strong>${esc(nearest.n)}</strong> · ${row.nearestAhMiles.toFixed(1)} mi</span>` : ""}`;
    $("dialog-facilities").innerHTML = facilities.length ? facilities.map(([facilityIndex, indices]) => {
      const facility = DATA.facilities[facilityIndex], distance = facilityDistanceFrom(zip, facilityIndex);
      const doctors = new Map();
      for (const index of indices) { const slot = DATA.slots[index]; if (!doctors.has(slot.p)) doctors.set(slot.p, []); doctors.get(slot.p).push(slot); }
      const cards = [...doctors.entries()].sort((a, b) => DATA.providers[a[0]].n.localeCompare(DATA.providers[b[0]].n)).map(([providerIndex, slots]) => {
        const provider = DATA.providers[providerIndex]; slots.sort((a, b) => a.u.localeCompare(b.u));
        return `<article class="doctor"><h3>${esc(provider.n)}${provider.c ? `, ${esc(provider.c)}` : ""}</h3><p>${number(slots.length)} appointment${slots.length === 1 ? "" : "s"}</p><div class="slot-list">${slots.map((slot, index) => `<span class="slot${index >= 6 ? " extra-slot" : ""}"${index >= 6 ? " hidden" : ""}>${esc(longDate(slot.d))} · ${esc(slot.t || "")}</span>`).join("")}${slots.length > 6 ? `<button type="button" class="more-slots" data-more="${slots.length - 6}" aria-expanded="false">+${number(slots.length - 6)} more</button>` : ""}</div></article>`;
      }).join("");
      return `<section class="market-facility"><div class="facility-line">${logo(facility.y)}<span class="facility-name">${esc(facility.n)}</span>${!insideMarket.has(facilityIndex) ? '<span class="outside-tag">Nearest AdventHealth · outside the market</span>' : ""}<strong class="facility-distance">${Number.isFinite(distance) ? `${distance.toFixed(1)} mi` : "—"}</strong></div><div class="facility-meta">${esc([facility.a, facility.c, facility.z].filter(Boolean).join(", "))}</div><div class="doctor-list">${cards}</div></section>`;
    }).join("") : `<div class="empty dialog-empty">No appointments in this market for the chosen period.</div>`;
    $("dialog-facilities").querySelectorAll(".more-slots").forEach((button) => button.addEventListener("click", () => {
      const expanded = button.getAttribute("aria-expanded") === "true";
      button.closest(".doctor").querySelectorAll(".extra-slot").forEach((slot) => { slot.hidden = expanded; });
      button.setAttribute("aria-expanded", String(!expanded)); button.textContent = expanded ? `+${number(button.dataset.more)} more` : "Show less";
    }));
    $("market-dialog").showModal();
  }

  function syncControls(message = "") {
    $("radius").value = state.radius; $("radius-value").textContent = `${state.radius} miles`;
    $("radius-status").textContent = message; $("radius-status").hidden = !message;
    $("origin-zip").value = state.radiusActive && state.originZip !== defaultOriginZip ? state.originZip : "";
    $("area-search").value = state.county || "";
    $("clear-area").disabled = !state.county && !$("area-search").value;
    $("from-date").value = state.from; $("through-date").value = state.through; $("opportunity-filter").value = state.filter;
  }

  let periodRequest = 0;
  async function refreshPeriod(message = "") {
    const request = ++periodRequest;
    $("map-meta").textContent = "Loading appointments for the selected dates…";
    try { await window.SLOT_PARTITIONS.load(state.from, state.through); }
    catch (error) { $("map-meta").textContent = "Could not load the selected dates."; console.error(error); return; }
    if (request !== periodRequest) return;
    refresh(message);
  }
  function refresh(message = "") {
    const includeZips = scopedZips();
    exactRows = buildOpportunityRows(DATA, { from: state.from, through: state.through, includeZips, miles });
    exactGapByZip = new Map(exactRows.filter((row) => row.oh > 0 && row.ah === 0).map((row) => [row.zip, row]));
    allRows = buildOpportunityRows(DATA, { from: state.from, through: state.through, includeZips, marketRadiusMiles: state.marketMiles, miles });
    rowByZip = new Map(allRows.map((row) => [row.zip, row]));
    visibleRows = filterRows(allRows);
    if (!visibleRows.some((row) => row.zip === state.selectedZip)) state.selectedZip = "";
    syncControls(message); renderSummary(); paintMap(); renderTable();
  }

  function applyRadius() {
    const zip = $("origin-zip").value.trim() || defaultOriginZip;
    if (!/^\d{5}$/.test(zip) || !originByZip.has(zip)) {
      $("origin-zip").setAttribute("aria-invalid", "true");
      $("radius-status").textContent = "Enter a valid Florida ZIP"; $("radius-status").hidden = false; $("radius-status").classList.add("error");
      return;
    }
    $("origin-zip").removeAttribute("aria-invalid"); $("radius-status").classList.remove("error");
    state.originZip = zip; state.radiusActive = true; state.county = ""; refresh();
  }

  function applyAreaSearch() {
    const value = $("area-search").value.trim();
    const zip = value.match(/^\d{5}/)?.[0];
    if (zip && originByZip.has(zip)) {
      state.originZip = zip; state.radius = searchedZipRadius; state.radiusActive = true; state.county = ""; state.selectedZip = rowByZip.has(zip) ? zip : ""; refresh(); return;
    }
    const county = counties.find((name) => name.toLowerCase() === value.replace(/ county$/i, "").toLowerCase());
    if (county) { state.county = county; state.radiusActive = false; state.selectedZip = ""; refresh(); return; }
    if (!value) { state.county = ""; state.selectedZip = ""; refresh(); }
  }

  function reset() {
    $("period-preset").value = "90";
    state.from = window.SUITE_DATE.today(); state.through = landingThrough(state.from); state.originZip = defaultOriginZip;
    state.radius = landingRadius; state.radiusActive = Boolean(defaultOriginZip); state.county = "";
    state.filter = "all"; state.selectedZip = ""; refreshPeriod();
  }

  function fillOptions() {
    $("origin-options").innerHTML = origins.map((origin) => `<option value="${origin.z}"></option>`).join("");
    const activeZips = [...new Set(DATA.facilities.map((facility) => facility.z).filter(Boolean))].sort();
    $("area-options").innerHTML = activeZips.map((zip) => `<option value="${zip} · ${esc(DATA.zipCounty?.[zip] || "")} County"></option>`).join("") + counties.map((county) => `<option value="${esc(county)} County"></option>`).join("");
  }

  $("apply-radius").addEventListener("click", applyRadius);
  $("origin-zip").addEventListener("keydown", (event) => { if (event.key === "Enter") applyRadius(); });
  $("clear-radius").addEventListener("click", () => { state.radiusActive = false; state.county = ""; state.selectedZip = ""; refresh(); });
  $("radius").addEventListener("input", (event) => {
    state.radius = Number(event.target.value); state.radiusActive = true; $("radius-value").textContent = `${state.radius} miles`;
    previewRadius();
  });
  $("radius").addEventListener("change", () => { if (radiusTimer) { clearTimeout(radiusTimer); radiusTimer = 0; } refresh(); });
  $("area-search").addEventListener("change", applyAreaSearch);
  $("area-search").addEventListener("keydown", (event) => { if (event.key === "Enter") applyAreaSearch(); });
  $("clear-area").addEventListener("click", () => { state.county = ""; state.selectedZip = ""; $("area-search").value = ""; refresh(); });
  $("opportunity-filter").addEventListener("change", (event) => { state.filter = event.target.value; refresh(); });
  // Quick periods: today through the next N days (capped at the last published day), or the full comparison window.
  const addDays = (iso, days) => { const date = new Date(`${iso}T12:00:00`); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); };
  $("period-preset").addEventListener("change", (event) => {
    const choice = event.target.value; if (choice === "custom") return;
    const from = window.SUITE_DATE.today(); const last = $("through-date").max || DATA.maxDate;
    let through = choice === "all" ? (comparisonThrough < from ? from : comparisonThrough) : addDays(from, Number(choice));
    if (through > last) through = last; if (through < from) through = from;
    state.from = from; state.through = through; refreshPeriod();
  });
  $("from-date").addEventListener("change", (event) => { $("period-preset").value = "custom"; state.from = event.target.value || window.SUITE_DATE.today(); if (state.from > state.through) state.through = state.from; refreshPeriod(); });
  $("through-date").addEventListener("change", (event) => { $("period-preset").value = "custom"; state.through = event.target.value || (comparisonThrough < state.from ? state.from : comparisonThrough); if (state.through < state.from) state.from = state.through; refreshPeriod(); });
  $("reset").addEventListener("click", reset);
  $("open-market").addEventListener("click", () => { if (state.selectedZip) openMarket(state.selectedZip); });
  $("back-overview").addEventListener("click", clearMarket);
  $("market-table").addEventListener("click", (event) => { const row = event.target.closest(".market-row"); if (row) selectMarket(row.dataset.zip); });
  $("market-table").addEventListener("keydown", (event) => { const row = event.target.closest(".market-row"); if (row && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); selectMarket(row.dataset.zip); } });
  $("close-dialog").addEventListener("click", () => $("market-dialog").close());
  $("market-dialog").addEventListener("click", (event) => { if (event.target === $("market-dialog")) $("market-dialog").close(); });

  const svg = $("map"), vp = $("map-vp");
  // Canvas snapshot of the current map for the shared smooth zoom (src/shared/map-motion.js).
  const rasterPaths = { zip: null, land: null };
  function drawSnapshot(ctx) {
    if (!rasterPaths.land) rasterPaths.land = new Path2D(OUTLINE);
    if (!rasterPaths.zip) rasterPaths.zip = PATHS.map((path) => new Path2D(path.d));
    ctx.fillStyle = "#e6e2dc"; ctx.fill(rasterPaths.land);
    const nodes = document.querySelectorAll("#zip-layer .op-area");
    ctx.strokeStyle = "#111"; ctx.lineWidth = .35;
    rasterPaths.zip.forEach((path, index) => { const node = nodes[index]; ctx.fillStyle = (node && node.getAttribute("fill")) || "#e6e2dc"; ctx.fill(path); ctx.stroke(path); });
    const origin = originByZip.get(state.originZip);
    if (state.radiusActive && origin) {
      ctx.save(); ctx.setLineDash([7, 5]); ctx.strokeStyle = "#005c99"; ctx.lineWidth = 2; ctx.fillStyle = "rgba(31,169,225,.11)";
      ctx.beginPath(); ctx.arc(origin.x, origin.y, state.radius * origin.m, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    const k = 1 / currentZoom;
    document.querySelectorAll("#market-marker-layer .market-marker").forEach((marker) => {
      const x = Number(marker.dataset.cx), y = Number(marker.dataset.cy), selected = marker.classList.contains("selected");
      ctx.fillStyle = marker.classList.contains("oh") ? "#b20838" : "#005c99"; ctx.strokeStyle = selected ? "#000" : "#fff"; ctx.lineWidth = selected ? 3 : 2;
      ctx.beginPath(); ctx.arc(x, y, 7.5 * k, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (marker.classList.contains("gap")) { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x, y, 2.6 * k, 0, Math.PI * 2); ctx.fill(); }
    });
    if (state.radiusActive && origin) {
      ctx.save(); ctx.translate(origin.x, origin.y); ctx.scale(k, k);
      ctx.fillStyle = "#fff"; ctx.strokeStyle = "#14233e"; ctx.lineWidth = 2 * currentZoom; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(0, 7); ctx.moveTo(-7, 0); ctx.lineTo(7, 0); ctx.moveTo(-3, -4); ctx.lineTo(0, -7); ctx.lineTo(3, -4); ctx.moveTo(-3, 4); ctx.lineTo(0, 7); ctx.lineTo(3, 4); ctx.moveTo(-4, -3); ctx.lineTo(-7, 0); ctx.lineTo(-4, 3); ctx.moveTo(4, -3); ctx.lineTo(7, 0); ctx.lineTo(4, 3); ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = "#000"; ctx.lineWidth = 2; ctx.stroke(rasterPaths.land);
  }
  const motion = window.SUITE_MAP_MOTION.create({ svg, viewport: vp, raster: $("map-raster"), width: W, height: H, maxZoom: 20, draw: drawSnapshot, tip: $("tip"), onSettle: (Z) => { if (Z.k !== currentZoom) { scaleMarkers(Z.k); motion.queue(); } } });
  $("zoom-in").addEventListener("click", () => motion.zoomBy(1.35)); $("zoom-out").addEventListener("click", () => motion.zoomBy(1 / 1.35));
  $("zoom-reset").addEventListener("click", () => motion.reset());
  svg.addEventListener("keydown", (event) => {
    const arrows = { ArrowLeft: [45, 0], ArrowRight: [-45, 0], ArrowUp: [0, 45], ArrowDown: [0, -45] };
    if (!arrows[event.key]) return;
    event.preventDefault(); motion.panBy(arrows[event.key][0], arrows[event.key][1]);
  });

  const periodMin = DATA.minDate < defaultFrom ? DATA.minDate : defaultFrom;
  const periodMax = DATA.maxDate > defaultThrough ? DATA.maxDate : defaultThrough;
  $("from-date").min = periodMin; $("from-date").max = periodMax;
  $("through-date").min = periodMin; $("through-date").max = periodMax;
  fillOptions(); drawMap(); reset();
})();
