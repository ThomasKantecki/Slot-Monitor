// Layout audit of the built pages in headless Chrome: at twenty viewport widths (browser zoom is the same as a
// different width) and two heights, no two siblings may overlap, nothing may run past the viewport, no text may
// be clipped, and every dialog must fit. Needs Chrome and playwright-core (PLAYWRIGHT_CORE=/path/to/node_modules/
// playwright-core); skipped with a note otherwise. Usage: node checks/audit-layout.cjs [page substring]
const { spawn } = require('node:child_process');
const { join } = require('node:path');
let chromium;
try { chromium = require(process.env.PLAYWRIGHT_CORE || 'playwright-core').chromium; }
catch { console.log('audit-layout: skipped (playwright-core not found; set PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core)'); process.exit(0); }
const ROOT = join(__dirname, '..');
const WIDTHS = [320, 375, 414, 480, 560, 640, 700, 768, 820, 900, 1000, 1100, 1200, 1280, 1366, 1440, 1600, 1920, 2200, 2560];
const HEIGHTS = [600, 1000];
const PAGES = ['index.html', 'market-opportunities.html', 'provider-map.html', 'orthopedics/index.html', 'orthopedics/market-opportunities.html', 'orthopedics/provider-map.html'];
const only = process.argv[2];
const SCAN = () => {
  const out = [];
  const W = document.documentElement.clientWidth;
  const vis = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || el.hidden || el.closest('[hidden]')) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const label = (el) => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '')) + (el.textContent ? ' "' + el.textContent.trim().replace(/\s+/g, ' ').slice(0, 16) + '"' : '');
  const inter = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1.5;
  if (document.documentElement.scrollWidth > W + 1) out.push(`page overflow ${document.documentElement.scrollWidth - W}px`);
  // sibling overlaps in normal flow, everywhere except the map SVGs and their overlays
  const containers = [...document.querySelectorAll('body *')].filter((el) => vis(el) && !el.closest('svg, dialog:not([open])') && el.children.length > 1);
  for (const c of containers) {
    const kids = [...c.children].filter((k) => vis(k) && !['svg', 'canvas', 'script', 'style', 'template'].includes(k.tagName.toLowerCase()) && !['absolute', 'fixed'].includes(getComputedStyle(k).position));
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const ra = kids[i].getBoundingClientRect(), rb = kids[j].getBoundingClientRect();
      if (inter(ra, rb)) out.push(`overlap ${Math.round(Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left))}x${Math.round(Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top))} ${label(kids[i])} <-> ${label(kids[j])} in ${label(c)}`);
    }
  }
  // anything past the right edge of the viewport
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || el.closest('svg') || ['fixed'].includes(getComputedStyle(el).position)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > W + 1 && r.left < W) out.push(`past viewport by ${Math.round(r.right - W)}px ${label(el)}`);
  }
  // clipped text: text-bearing leaf elements with hidden overflow
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || el.closest('svg') || el.children.length || !el.textContent.trim()) continue;
    const cs = getComputedStyle(el);
    if (['INPUT', 'SELECT', 'TEXTAREA', 'OPTION'].includes(el.tagName)) continue;
    if (cs.textOverflow === 'ellipsis') continue; // deliberate
    if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'visible') out.push(`text clipped ${el.scrollWidth - el.clientWidth}px ${label(el)}`);
  }
  // open dialogs must fit the viewport
  for (const d of document.querySelectorAll('dialog[open]')) { const r = d.getBoundingClientRect(); if (r.right > W + 1 || r.left < -1 || r.height > innerHeight + 1) out.push(`dialog exceeds viewport ${label(d)} ${Math.round(r.width)}x${Math.round(r.height)}`); }
  return [...new Set(out)];
};
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8843', '--bind', '127.0.0.1', '--directory', join(ROOT, 'public')], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 900));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const issues = [];
  try {
    for (const path of PAGES) {
      if (only && !path.includes(only)) continue;
      for (const height of HEIGHTS) for (const width of WIDTHS) {
        const page = await browser.newPage({ viewport: { width, height } });
        await page.goto('http://127.0.0.1:8843/' + path, { waitUntil: 'load' });
        await page.waitForTimeout(path.includes('provider') ? 1200 : 2500);
        let found = await page.evaluate(SCAN);
        for (const f of found) issues.push(`${path} @${width}x${height}: ${f}`);
        // dialogs: facility dialog (slot page), market dialog (market page), data check (all)
        if (path.endsWith('index.html') && !path.includes('market')) {
          const opened = await page.evaluate(() => { const m = document.querySelector('#facility-marker-layer .facility-marker'); if (!m) return false; m.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); m.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 })); m.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; });
          if (opened) { await page.waitForTimeout(400); found = await page.evaluate(SCAN); for (const f of found.filter((x) => /dialog|#facility-dialog|#doctor-list|\.doctor/.test(x))) issues.push(`${path} @${width}x${height} [facility dialog]: ${f}`); await page.evaluate(() => document.querySelector('#facility-dialog')?.close()); }
        }
        if (path.includes('market')) {
          const opened = await page.evaluate(() => { const row = document.querySelector('#market-table .market-row'); if (!row) return false; row.click(); return true; });
          if (opened) { await page.waitForTimeout(300); await page.evaluate(() => document.querySelector('#open-market')?.click()); await page.waitForTimeout(400); found = await page.evaluate(SCAN); for (const f of found.filter((x) => /dialog|#market-dialog|#dialog-facilities/.test(x))) issues.push(`${path} @${width}x${height} [market dialog]: ${f}`); await page.evaluate(() => document.querySelector('#market-dialog')?.close()); }
        }
        if (await page.$('#dataset-info-button')) { await page.click('#dataset-info-button'); await page.waitForTimeout(250); found = await page.evaluate(SCAN); for (const f of found.filter((x) => /dialog|dataset|check-/.test(x))) issues.push(`${path} @${width}x${height} [data check]: ${f}`); }
        await page.close();
      }
    }
  } finally { await browser.close(); srv.kill(); }
  console.log(issues.join('\n'));
  console.log(`\n${issues.length} layout issues`);
  process.exit(issues.length ? 1 : 0);
})();
