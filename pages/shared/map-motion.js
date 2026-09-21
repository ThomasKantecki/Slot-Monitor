((root) => {
  // Smooth map zoom and pan, shared by the Slot Availability and Market
  // Opportunities maps and modelled on the Provider Index. Z is what is drawn
  // and T is where we are heading; every frame eases Z toward T, so wheel and
  // trackpad zoom glide and the buttons animate. While anything moves, a canvas
  // snapshot of the map stands in for the ~1,000-path SVG so the browser only
  // transforms one bitmap; the SVG comes back, sharp, when motion stops.
  function create({ svg, viewport, raster, width, height, maxZoom = 20, draw, tip, onSettle }) {
    const ctx = raster && raster.getContext ? raster.getContext("2d", { alpha: true }) : null;
    const usable = Boolean(ctx) && typeof Path2D === "function" && typeof draw === "function";
    const Z = { k: 1, x: 0, y: 0 }, T = { k: 1, x: 0, y: 0 };
    let raf = null, ready = false, queued = false, active = false;
    let frame = { left: 0, top: 0, s: 1, ox: 0, oy: 0, w: 0, h: 0 }, drawnW = 0, drawnH = 0;

    // The svg keeps its aspect ratio (meet), so the viewBox is scaled uniformly
    // and letterboxed. The frame maps screen pixels to viewBox units. The snapshot
    // covers the whole svg box (not just the letterboxed viewBox) and is scaled
    // about the viewBox origin, so panned or zoomed content is never cut at the
    // viewBox edge while the map moves; the svg itself has overflow visible.
    function syncFrame() {
      const r = svg.getBoundingClientRect(), s = Math.min(r.width / width, r.height / height) || 1;
      frame = { left: r.left, top: r.top, s, ox: (r.width - width * s) / 2, oy: (r.height - height * s) / 2, w: r.width, h: r.height };
      if (raster) { raster.style.left = "0px"; raster.style.top = "0px"; raster.style.width = `${r.width}px`; raster.style.height = `${r.height}px`; raster.style.transformOrigin = `${frame.ox}px ${frame.oy}px`; }
      if (drawnW !== r.width || drawnH !== r.height) ready = false;
      if (active) applyRaster();
    }
    const point = (clientX, clientY) => [(clientX - frame.left - frame.ox) / frame.s, (clientY - frame.top - frame.oy) / frame.s];
    const applyRaster = () => { raster.style.transform = `translate(${Z.x * frame.s}px,${Z.y * frame.s}px) scale(${Z.k})`; };
    const applyVector = () => viewport.setAttribute("transform", `translate(${Z.x} ${Z.y}) scale(${Z.k})`);
    const apply = () => { if (active) applyRaster(); else applyVector(); };
    const hideTip = () => { if (tip) tip.style.opacity = "0"; };

    function drawSnapshot() {
      if (!usable) return;
      const dpr = Math.min(2, Math.max(1, root.devicePixelRatio || 1));
      raster.width = Math.round(frame.w * dpr); raster.height = Math.round(frame.h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, frame.w, frame.h);
      ctx.setTransform(dpr * frame.s, 0, 0, dpr * frame.s, dpr * frame.ox, dpr * frame.oy); ctx.lineJoin = "round";
      draw(ctx); drawnW = frame.w; drawnH = frame.h; ready = true;
    }
    // Call after every repaint of the SVG; the snapshot is redrawn when idle.
    function queue() {
      if (!usable) return;
      ready = false; if (active) end(); if (queued) return; queued = true;
      const run = () => { queued = false; drawSnapshot(); };
      if (root.requestIdleCallback) root.requestIdleCallback(run, { timeout: 120 }); else requestAnimationFrame(run);
    }
    function begin() {
      svg.classList.add("zooming");
      if (!ready) return;
      syncFrame(); active = true; raster.style.opacity = "1"; viewport.style.visibility = "hidden"; applyRaster();
    }
    function end() {
      applyVector(); viewport.style.visibility = "";
      if (active) { raster.style.opacity = "0"; active = false; }
      svg.classList.remove("zooming");
      if (onSettle) onSettle(Z);
    }
    function tick() {
      const a = 0.34;
      Z.k += (T.k - Z.k) * a; Z.x += (T.x - Z.x) * a; Z.y += (T.y - Z.y) * a;
      if (Math.abs(T.k - Z.k) < 0.0025 && Math.abs(T.x - Z.x) < 0.12 && Math.abs(T.y - Z.y) < 0.12) { Z.k = T.k; Z.x = T.x; Z.y = T.y; raf = null; end(); return; }
      apply(); raf = requestAnimationFrame(tick);
    }
    function animate() { if (!raf) { begin(); raf = requestAnimationFrame(tick); } }
    function zoomAt(mx, my, factor) {
      const nk = Math.max(1, Math.min(maxZoom, T.k * factor));
      T.x = mx - (mx - T.x) * (nk / T.k); T.y = my - (my - T.y) * (nk / T.k); T.k = nk;
      if (T.k <= 1.001) { T.k = 1; T.x = 0; T.y = 0; }
      animate();
    }
    const zoomBy = (factor) => zoomAt(width / 2, height / 2, factor);
    function panBy(dx, dy) { T.x += dx; T.y += dy; animate(); }
    function reset() { T.k = 1; T.x = 0; T.y = 0; animate(); }

    svg.addEventListener("wheel", (event) => {
      event.preventDefault();
      const [mx, my] = point(event.clientX, event.clientY);
      let dy = event.deltaY; if (event.deltaMode === 1) dy *= 16; else if (event.deltaMode === 2) dy *= 100;
      dy = Math.max(-140, Math.min(140, dy)); hideTip(); zoomAt(mx, my, Math.exp(-dy * 0.0019));
    }, { passive: false });

    // Drag with a small threshold, so a plain click still selects an area or marker.
    let drag = null, moved = false, dragRaf = null, dragEvent = null;
    function moveDrag() {
      dragRaf = null; if (!drag || !dragEvent) return;
      const event = dragEvent; dragEvent = null;
      const dx = event.clientX - drag.cx, dy = event.clientY - drag.cy;
      if (!moved) { if (dx * dx + dy * dy < 32) return; moved = true; begin(); svg.classList.add("dragging"); }
      T.x = Z.x = drag.ox + dx / drag.s; T.y = Z.y = drag.oy + dy / drag.s; apply(); hideTip();
    }
    svg.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.defaultPrevented) return;
      if (raf) { cancelAnimationFrame(raf); raf = null; }
      Z.k = T.k; Z.x = T.x; Z.y = T.y; end(); syncFrame();
      drag = { cx: event.clientX, cy: event.clientY, ox: T.x, oy: T.y, s: frame.s }; dragEvent = null; moved = false;
    }, { capture: true }); // capture: markers stop propagation, and every press must reset `moved`
    root.addEventListener("pointermove", (event) => { if (!drag) return; dragEvent = event; if (!dragRaf) dragRaf = requestAnimationFrame(moveDrag); });
    const release = () => {
      if (!drag) return;
      if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = null; moveDrag(); }
      const didMove = moved; drag = null; dragEvent = null; svg.classList.remove("dragging");
      if (didMove) end();
    };
    root.addEventListener("pointerup", release); root.addEventListener("pointercancel", release);
    const resized = () => { syncFrame(); if (usable && !ready) queue(); };
    if (typeof ResizeObserver === "function") new ResizeObserver(resized).observe(svg); else root.addEventListener("resize", resized);
    syncFrame();
    return Object.freeze({ zoomAt, zoomBy, panBy, reset, queue, sync: syncFrame, moved: () => moved, drawn: Z, target: T });
  }
  root.SUITE_MAP_MOTION = Object.freeze({ create });
})(typeof window === "undefined" ? globalThis : window);
