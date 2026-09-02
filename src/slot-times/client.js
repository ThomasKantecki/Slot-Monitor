(() => {
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
  const defaultThrough = comparisonThrough < defaultFrom ? defaultFrom : comparisonThrough;
  const initialSlotDate = DATA.slots.find((slot) => slot.d >= defaultFrom && slot.d <= defaultThrough)?.d || defaultFrom;
  const miles = window.SLOT_RADIUS.miles;

  const state = {
    granularity: "zip", view: "diff", selected: "", selectedDate: initialSlotDate,
    from: defaultFrom, through: defaultThrough,
    originZip: defaultOriginZip, radius: landingRadius, radiusActive: Boolean(defaultOriginZip), areaQuery: "",
    month: new Date(`${initialSlotDate}T12:00:00`), zoom: { k: 1, x: 0, y: 0 },
  };
  const slotsByArea = { zip: new Map(), county: new Map() };
  const allIndices = DATA.slots.map((_, index) => index);
  DATA.slots.forEach((slot, index) => {
    const facility = DATA.facilities[slot.f];
    [["zip", facility.z], ["county", facility.ct]].forEach(([granularity, key]) => {
      if (!key) return;
      if (!slotsByArea[granularity].has(key)) slotsByArea[granularity].set(key, []);
      slotsByArea[granularity].get(key).push(index);
    });
  });
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

  function filteredIndices(key = state.selected) {
    const source = key ? (slotsByArea[state.granularity].get(key) || []) : allIndices;
    return source.filter((index) => {
      const slot = DATA.slots[index];
      return inRadius(index) && slot.d >= state.from && slot.d <= state.through && (state.view === "diff" || slot.y === state.view);
    });
  }
  function areaCounts(key) {
    const counts = { ah: 0, oh: 0 };
    for (const index of slotsByArea[state.granularity].get(key) || []) {
      const slot = DATA.slots[index];
      if (inRadius(index) && slot.d >= state.from && slot.d <= state.through) counts[slot.y] += 1;
    }
    return counts;
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
    $("map-vp").innerHTML = `<path class="land" d="${OUTLINE}"></path><g id="county-layer">${layerHtml("county")}</g><g id="zip-layer">${layerHtml("zip")}</g><g id="radius-layer"><circle id="radius-ring" class="radius-ring"></circle><circle id="origin-marker" class="origin-marker" r="7"></circle></g><g id="facility-marker-layer"></g><path class="coast" d="${OUTLINE}"></path>`;
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
    if (state.radiusActive && origin) {
      $("radius-ring").setAttribute("cx", origin.x); $("radius-ring").setAttribute("cy", origin.y);
      $("radius-ring").setAttribute("r", (state.radius * origin.m).toFixed(1));
      $("origin-marker").setAttribute("cx", origin.x); $("origin-marker").setAttribute("cy", origin.y);
    }
    $("map-title").textContent = state.radiusActive ? `Appointments within ${state.radius} miles of ${state.originZip}` : `Physical appointments per ${state.granularity === "zip" ? "ZIP code" : "county"}`;
    $("map-meta").textContent = `${longDate(state.from)} – ${longDate(state.through)}`;
    renderMapMarkers();
  }
  function renderMapMarkers() {
    const grouped = new Map();
    filteredIndices().forEach((index) => {
      const slot = DATA.slots[index], facility = DATA.facilities[slot.f], origin = originByZip.get(facility.z);
      if (!origin) return;
      const key = `${slot.y}|${facility.z}`, row = grouped.get(key) || { system: slot.y, zip: facility.z, origin, facilities: new Set(), slots: 0 };
      row.facilities.add(slot.f); row.slots += 1; grouped.set(key, row);
    });
    $("facility-marker-layer").innerHTML = [...grouped.values()].map((row) => {
      const count = row.facilities.size, radius = Math.min(12, 4 + Math.sqrt(count) * 2);
      const distance = state.radiusActive ? ` · ${facilityDistance([...row.facilities][0]).toFixed(1)} miles` : "";
      return `<circle class="facility-marker ${row.system}" cx="${row.origin.x}" cy="${row.origin.y}" r="${radius}" tabindex="0" data-facilities="${[...row.facilities].join(",")}"><title>${row.system.toUpperCase()} · ${row.zip} · ${count} ${count === 1 ? "location" : "locations"} · ${number(row.slots)} appointments${distance}</title></circle>`;
    }).join("");
    $("facility-marker-layer").querySelectorAll(".facility-marker").forEach((marker) => {
      marker.addEventListener("pointerdown", (event) => event.stopPropagation());
      const activate = () => {
        const ids = marker.dataset.facilities.split(",").map(Number), facility = DATA.facilities[ids[0]];
        if (ids.length === 1) openFacility(ids[0]); else selectArea(state.granularity === "zip" ? facility.z : facility.ct);
      };
      marker.addEventListener("click", (event) => { event.stopPropagation(); activate(); });
      marker.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(); } });
    });
  }
  function bindMapAreas() {
    document.querySelectorAll(".area").forEach((path) => {
      path.addEventListener("click", () => selectArea(state.selected === path.dataset.key ? "" : path.dataset.key));
      path.addEventListener("mousemove", (event) => showTip(event, path.dataset.key));
      path.addEventListener("mouseleave", () => $("tip").style.opacity = "0");
    });
  }
  function showTip(event, key) {
    const counts = areaCounts(key);
    const label = state.granularity === "county" ? `${key} County` : `${key}${DATA.zipCounty?.[key] ? ` · ${DATA.zipCounty[key]} County` : ""}`;
    const tip = $("tip");
    tip.innerHTML = `<strong>${esc(label)}</strong><span class="ah">AdventHealth ${number(counts.ah)}</span><br><span class="oh">Orlando Health ${number(counts.oh)}</span>`;
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
    $("radius-status").classList.toggle("error", Boolean(message));
    $("radius-status").textContent = message || (state.radiusActive ? `Active around ${state.originZip}${state.originZip === defaultOriginZip && !state.areaQuery ? " · default center" : ""}` : state.selected ? "Area selection active" : "Statewide scope");
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
    paintMap(); renderKpis(); renderSummary(); renderAvailabilityProfile(); renderFacilities(); renderCalendar(); renderProviders(); renderAppointmentTable();
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
    $("area-sub").textContent = `${number(indices.length)} physical appointments · ${number(providers.size)} providers · ${number(facilities.size)} facilities`;
    $("area-ah").textContent = number(counts.ah); $("area-oh").textContent = number(counts.oh);
    const delta = counts.ah - counts.oh;
    $("area-lead").textContent = !indices.length ? (state.radiusActive ? `No appointments within ${state.radius} miles. Expand the radius to search farther.` : "No appointments under the active filters.") : delta === 0 ? "Availability is even" : `${delta > 0 ? "AdventHealth" : "Orlando Health"} leads by ${number(Math.abs(delta))} appointments`;
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
  function renderFacilities() {
    const grouped = new Map();
    filteredIndices().forEach((index) => {
      const slot = DATA.slots[index], facility = DATA.facilities[slot.f];
      if (!grouped.has(slot.f)) grouped.set(slot.f, { facility, facilityIndex: slot.f, ah: 0, oh: 0, providers: new Set() });
      const row = grouped.get(slot.f); row[slot.y] += 1; row.providers.add(slot.p);
    });
    const rows = [...grouped.values()].sort((a, b) => state.radiusActive
      ? facilityDistance(a.facilityIndex) - facilityDistance(b.facilityIndex) || (b.ah + b.oh) - (a.ah + a.oh)
      : (b.ah + b.oh) - (a.ah + a.oh));
    const query = $("facility-search").value.trim().toLowerCase();
    const visibleRows = rows.filter(({ facility }) => !query || `${facility.n} ${facility.a} ${facility.c} ${facility.z}`.toLowerCase().includes(query));
    $("facility-count").textContent = query ? `${number(visibleRows.length)} of ${number(rows.length)} facilities` : state.radiusActive ? `${number(rows.length)} facilities · within ${state.radius} mi of ${state.originZip}` : `${number(rows.length)} facilities`;
    $("facility-title").textContent = state.radiusActive ? "Facilities with availability within the radius" : "Facilities with availability";
    const emptyMessage = !rows.length && state.radiusActive
      ? `<div class="empty radius-empty">No facilities with appointments within ${number(state.radius)} miles of ${esc(state.originZip)}. Expand the radius to search farther.</div>`
      : '<div class="empty">No facilities match the active filters and search.</div>';
    $("facility-list").innerHTML = visibleRows.length ? visibleRows.map(({ facility, facilityIndex, ah, oh, providers }) => {
      const distance = state.radiusActive ? `<strong class="facility-distance">${facilityDistance(facilityIndex).toFixed(1)} mi</strong>` : "";
      const total = ah + oh;
      return `<button type="button" class="facility" data-facility="${facilityIndex}"><div class="facility-top"><span class="system-tag ${facility.y}">${facility.y.toUpperCase()}</span>${distance}</div><div class="facility-name">${esc(facility.n)}</div><div class="facility-meta">${esc([facility.a, facility.c, facility.z].filter(Boolean).join(", "))}</div><div class="facility-counts"><span><b>${number(total)}</b> appointment slot${total === 1 ? "" : "s"}</span><span><b>${number(providers.size)}</b> provider${providers.size === 1 ? "" : "s"} · click to view</span></div></button>`;
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
    $("dialog-system").textContent = facility.y.toUpperCase(); $("dialog-system").className = `system-tag ${facility.y}`;
    $("dialog-title").textContent = facility.n;
    $("dialog-address").textContent = [facility.a, facility.c, "FL", facility.z].filter(Boolean).join(" · ");
    $("dialog-summary").innerHTML = `<span><strong>${number(indices.length)}</strong> appointments</span><span><strong>${number(doctors.size)}</strong> providers</span><span><strong>${number(dates.size)}</strong> bookable dates</span>${state.radiusActive ? `<span><strong>${facilityDistance(facilityIndex).toFixed(1)}</strong> miles from ${esc(state.originZip)}</span>` : ""}`;
    $("doctor-list").innerHTML = doctors.size ? [...doctors.values()].sort((a, b) => a.provider.n.localeCompare(b.provider.n)).map(({ provider, slots }) => {
      slots.sort((a, b) => a.u.localeCompare(b.u));
      const types = [...new Set(slots.flatMap(slotTypes))];
      return `<article class="doctor"><h3>${esc(provider.n)}${provider.c ? `, ${esc(provider.c)}` : ""}</h3><p>${number(slots.length)} appointments${types.length ? ` · ${types.map(typeLabel).map(esc).join(" · ")}` : ""}</p><div class="slot-list">${slots.map((slot, index) => `<span class="slot${index >= 8 ? " extra-slot" : ""}"${index >= 8 ? " hidden" : ""}>${esc(longDate(slot.d))} · ${esc(slot.t)}</span>`).join("")}${slots.length > 8 ? `<button type="button" class="more-slots" data-more="${slots.length - 8}" aria-expanded="false">+${number(slots.length - 8)} more</button>` : ""}</div></article>`;
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
    $("calendar").querySelectorAll(".day.has").forEach((button) => button.addEventListener("click", () => { state.selectedDate = button.dataset.date; renderCalendar(); renderProviders(); renderAppointmentTable(); }));
  }
  function renderProviders() {
    const grouped = new Map();
    filteredIndices().forEach((index) => {
      const slot = DATA.slots[index]; if (slot.d !== state.selectedDate) return;
      const provider = DATA.providers[slot.p], facility = DATA.facilities[slot.f];
      const key = `${slot.p}|${slot.f}`;
      if (!grouped.has(key)) grouped.set(key, { provider, facility, system: slot.y, slots: [], types: new Set() });
      const row = grouped.get(key); row.slots.push(slot); slot.ty.forEach((type) => row.types.add(DATA.types[type]));
    });
    const rows = [...grouped.values()].sort((a, b) => a.provider.n.localeCompare(b.provider.n));
    $("provider-date").textContent = longDate(state.selectedDate);
    $("provider-list").innerHTML = rows.length ? rows.map((row) => {
      const badges = row.system === "ah" ? [...row.types].map((type) => `<span class="badge">${esc(typeLabel(type))}</span>`).join("") : "";
      const more = row.slots.length - 8;
      return `<article class="provider-card"><div class="provider-top"><div><div class="provider-name">${esc(row.provider.n)}${row.provider.c ? `, ${esc(row.provider.c)}` : ""}</div><div class="provider-meta">${esc(row.facility.n)} · ${number(row.slots.length)} appointment${row.slots.length === 1 ? "" : "s"}</div></div><span class="system-tag ${row.system}">${row.system.toUpperCase()}</span></div>${badges ? `<div class="badges">${badges}</div>` : ""}<div class="times">${row.slots.map((slot, index) => `<span class="time${index >= 8 ? " extra-time" : ""}"${index >= 8 ? " hidden" : ""}>${esc(slot.t || new Date(slot.u).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }))}</span>`).join("")}${more > 0 ? `<button type="button" class="time more more-times" data-more="${more}" aria-expanded="false">+${number(more)} more</button>` : ""}</div></article>`;
    }).join("") : `<div class="empty">${!filteredIndices().length && state.radiusActive ? `No appointments within ${number(state.radius)} miles of ${esc(state.originZip)}. Expand the radius to see available providers.` : "Choose a highlighted date to see available providers and appointment times."}</div>`;
    $("provider-list").querySelectorAll(".more-times").forEach((button) => button.addEventListener("click", () => {
      const expanded = button.getAttribute("aria-expanded") === "true";
      button.closest(".provider-card").querySelectorAll(".extra-time").forEach((time) => { time.hidden = expanded; });
      button.setAttribute("aria-expanded", String(!expanded)); button.textContent = expanded ? `+${number(button.dataset.more)} more` : "Show less";
    }));
  }
  function renderAppointmentTable() {
    const query = $("appointment-search").value.trim().toLowerCase();
    let rows = filteredIndices().filter((index) => DATA.slots[index].d === state.selectedDate).map((index) => {
      const slot = DATA.slots[index], provider = DATA.providers[slot.p], facility = DATA.facilities[slot.f];
      return { slot, provider, facility, types: slotTypes(slot), reasons: slotReasons(slot) };
    });
    rows = rows.filter((row) => !query || `${row.slot.y} ${row.slot.t} ${row.provider.n} ${row.provider.c} ${row.facility.n} ${row.facility.c} ${row.facility.z} ${row.types.join(" ")} ${row.reasons.join(" ")}`.toLowerCase().includes(query));
    rows.sort((a, b) => a.slot.u.localeCompare(b.slot.u) || a.provider.n.localeCompare(b.provider.n));
    $("appointment-count").textContent = `${number(rows.length)} on ${longDate(state.selectedDate)}`;
    const shown = rows.slice(0, 250);
    $("appointment-table").innerHTML = shown.length ? `<table><thead><tr><th>System</th><th>Time</th><th>Provider</th><th>Location</th><th>ZIP</th><th>Appointment type</th><th>Reason</th></tr></thead><tbody>${shown.map(({ slot, provider, facility, types, reasons }) => `<tr><td><span class="system-tag ${slot.y}">${slot.y.toUpperCase()}</span></td><td><strong>${esc(slot.t)}</strong>${slot.l ? `<small>${esc(slot.l)} min</small>` : ""}</td><td><strong>${esc(provider.n)}</strong><small>${esc(provider.c || "Credentials not supplied")}</small></td><td><strong>${esc(facility.n)}</strong><small>${esc(facility.c)}, FL</small></td><td>${esc(facility.z)}</td><td>${types.length ? types.map(typeLabel).map(esc).join(" · ") : '<span class="not-supplied">Not supplied by source</span>'}</td><td>${reasons.length ? reasons.map(esc).join(" · ") : '<span class="not-supplied">Not supplied by source</span>'}</td></tr>`).join("")}</tbody></table>${rows.length > shown.length ? `<div class="table-note">Showing the first ${number(shown.length)} of ${number(rows.length)} matching appointments.</div>` : ""}` : `<div class="empty">${!filteredIndices().length && state.radiusActive ? `No appointments within ${number(state.radius)} miles of ${esc(state.originZip)}. Expand the radius to search farther.` : "No appointments match this date, scope, and search."}</div>`;
  }
  function renderKpis() {
    const indices = filteredIndices();
    const counts = { ah: 0, oh: 0 }, providers = new Set(), facilities = { ah: new Set(), oh: new Set() }, dates = new Set();
    indices.forEach((index) => { const slot = DATA.slots[index]; counts[slot.y] += 1; providers.add(slot.p); facilities[slot.y].add(slot.f); dates.add(slot.d); });
    $("kpi-ah").textContent = number(counts.ah); $("kpi-oh").textContent = number(counts.oh);
    const total = counts.ah + counts.oh, ahShare = total ? counts.ah / total * 100 : 50;
    $("mix-total").innerHTML = `<span>${number(total)}</span><small>slots</small>`;
    $("mix-ah").textContent = `${number(counts.ah)} · ${total ? Math.round(counts.ah / total * 100) : 0}%`;
    $("mix-oh").textContent = `${number(counts.oh)} · ${total ? Math.round(counts.oh / total * 100) : 0}%`;
    $("mix-donut").style.background = total ? `conic-gradient(var(--ah) 0 ${ahShare}%, var(--oh) ${ahShare}% 100%)` : "#edf0f2";
    const noRadiusResults = !indices.length && state.radiusActive;
    $("kpi-ah-sub").textContent = noRadiusResults ? `No appointments within ${state.radius} miles — expand radius` : "Available appointment slots";
    $("kpi-oh-sub").textContent = noRadiusResults ? `No appointments within ${state.radius} miles — expand radius` : "Available appointment slots";
    $("kpi-providers").textContent = number(providers.size);
    $("kpi-facilities-ah").textContent = number(facilities.ah.size); $("kpi-facilities-oh").textContent = number(facilities.oh.size);
    $("kpi-dates").textContent = `${number(dates.size)} bookable date${dates.size === 1 ? "" : "s"} represented`;
    const first = indices.length ? DATA.slots[indices[0]].d : ""; $("kpi-period").textContent = first ? `Earliest: ${longDate(first)}` : "No appointments in period";
  }
  function refresh() { if (state.selected && !slotsByArea[state.granularity].has(state.selected)) state.selected = ""; selectArea(state.selected); }
  function setPressed(prefix, value, choices) { choices.forEach((choice) => $(`${prefix}-${choice}`)?.setAttribute("aria-pressed", String(choice === value))); }
  ["zip", "county"].forEach((value) => $(`gran-${value}`).addEventListener("click", () => { state.granularity = value; state.selected = ""; setPressed("gran", value, ["zip", "county"]); fillSearch(); refresh(); }));
  ["diff", "ah", "oh"].forEach((value) => $(`view-${value}`).addEventListener("click", () => { state.view = value; setPressed("view", value, ["diff", "ah", "oh"]); refresh(); }));
  $("from-date").addEventListener("change", (event) => { state.from = event.target.value; if (state.through < state.from) { state.through = state.from; $("through-date").value = state.from; } refresh(); });
  $("through-date").addEventListener("change", (event) => { state.through = event.target.value; if (state.from > state.through) { state.from = state.through; $("from-date").value = state.through; } refresh(); });
  $("reset").addEventListener("click", () => {
    const resetFrom = window.SUITE_DATE.today();
    const resetThrough = comparisonThrough < resetFrom ? resetFrom : comparisonThrough;
    const resetSlotDate = DATA.slots.find((slot) => slot.d >= resetFrom && slot.d <= resetThrough)?.d || resetFrom;
    state.granularity = "zip"; state.selected = ""; state.selectedDate = resetSlotDate;
    state.month = new Date(`${resetSlotDate}T12:00:00`); state.from = resetFrom; state.through = resetThrough; state.view = "diff";
    state.originZip = defaultOriginZip; state.radius = landingRadius; state.radiusActive = Boolean(defaultOriginZip); state.areaQuery = "";
    $("from-date").value = state.from; $("through-date").value = state.through;
    $("origin-zip").value = ""; $("radius").value = state.radius; $("area-search").value = "";
    $("facility-search").value = ""; $("appointment-search").value = "";
    setPressed("gran", "zip", ["zip", "county"]); setPressed("view", "diff", ["diff", "ah", "oh"]);
    fillSearch(); resetZoom(); refresh();
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
  $("facility-search").addEventListener("input", renderFacilities);
  $("appointment-search").addEventListener("input", renderAppointmentTable);
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
  let radiusFrame = 0;
  $("radius").addEventListener("input", (event) => {
    const candidate = $("origin-zip").value.trim();
    if (candidate && originByZip.has(candidate)) { state.originZip = candidate; state.areaQuery = candidate; }
    else if (candidate) $("origin-zip").value = "";
    state.radius = Number(event.target.value); state.radiusActive = true; state.selected = "";
    $("clear-area").disabled = false; syncScopeControls();
    if (!radiusFrame) radiusFrame = requestAnimationFrame(() => { radiusFrame = 0; refresh(); });
  });
  $("month-prev").addEventListener("click", () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); renderCalendar(); });
  $("month-next").addEventListener("click", () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); renderCalendar(); });

  const svg = $("map"), vp = $("map-vp"); let drag = null;
  function applyZoom() { const z = state.zoom; vp.setAttribute("transform", `translate(${z.x} ${z.y}) scale(${z.k})`); }
  function resetZoom() { state.zoom = { k: 1, x: 0, y: 0 }; applyZoom(); }
  function zoomBy(factor) { const z = state.zoom, next = Math.max(1, Math.min(20, z.k * factor)); z.x = W / 2 - (W / 2 - z.x) * next / z.k; z.y = H / 2 - (H / 2 - z.y) * next / z.k; z.k = next; applyZoom(); }
  $("zoom-in").addEventListener("click", () => zoomBy(1.5)); $("zoom-out").addEventListener("click", () => zoomBy(1 / 1.5)); $("zoom-reset").addEventListener("click", resetZoom);
  svg.addEventListener("wheel", (event) => { event.preventDefault(); zoomBy(event.deltaY < 0 ? 1.18 : 1 / 1.18); }, { passive: false });
  svg.addEventListener("pointerdown", (event) => { drag = { x: event.clientX, y: event.clientY, ox: state.zoom.x, oy: state.zoom.y }; svg.setPointerCapture(event.pointerId); });
  svg.addEventListener("pointermove", (event) => { if (!drag) return; svg.classList.add("dragging"); const scale = Math.min(svg.clientWidth / W, svg.clientHeight / H); state.zoom.x = drag.ox + (event.clientX - drag.x) / scale; state.zoom.y = drag.oy + (event.clientY - drag.y) / scale; applyZoom(); });
  svg.addEventListener("pointerup", () => { drag = null; svg.classList.remove("dragging"); });

  function fillSearch() {
    const list = $("area-options");
    const keys = state.granularity === "zip" ? origins.map((origin) => origin.z) : [...slotsByArea.county.keys()];
    list.innerHTML = [...new Set(keys)].sort().map((key) => `<option value="${esc(key)}${state.granularity === "zip" && DATA.zipCounty?.[key] ? ` · ${esc(DATA.zipCounty[key])} County` : ""}"></option>`).join("");
    $("area-search").placeholder = state.granularity === "zip" ? "32804 · default center" : "Search county";
  }
  $("origin-options").innerHTML = origins.map((origin) => `<option value="${esc(origin.z)}"></option>`).join("");
  $("origin-zip").value = "";
  $("from-date").min = DATA.minDate < defaultFrom ? DATA.minDate : defaultFrom; $("from-date").max = DATA.maxDate > defaultThrough ? DATA.maxDate : defaultThrough; $("from-date").value = defaultFrom;
  $("through-date").min = DATA.minDate < defaultFrom ? DATA.minDate : defaultFrom; $("through-date").max = DATA.maxDate > defaultThrough ? DATA.maxDate : defaultThrough; $("through-date").value = defaultThrough;
  $("period-status").textContent = `Common endpoint: ${longDate(comparisonThrough)}`;
  fillSearch(); drawMap(); refresh();
})();
