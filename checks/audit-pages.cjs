// Functional audit of the three built pages of one specialty in headless Chrome: every figure the pages show is
// recomputed independently in the browser from the same loaded data (day files, embedded rosters) through every
// control: filters, system view, radius, ZIP and county selection, period presets, the facility dialog, the
// sub-specialty menu and primary-only mode. Needs Chrome and the playwright-core package (not a dependency of this
// repo): set PLAYWRIGHT_CORE to that package's folder, or run from a folder where `require("playwright-core")`
// resolves. Without it the audit is skipped with a note.
// Usage: node checks/audit-pages.cjs [--specialty <id>] (default: cardiology)
const { spawn } = require('node:child_process');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const ROOT = join(__dirname, '..');
let chromium;
try { chromium = require(process.env.PLAYWRIGHT_CORE || 'playwright-core').chromium; }
catch { console.log('audit-pages: skipped (playwright-core not found; set PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core)'); process.exit(0); }
const argIndex = process.argv.indexOf('--specialty');
const sp = argIndex >= 0 ? process.argv[argIndex + 1] : (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'cardiology');
const registry = JSON.parse(readFileSync(join(ROOT, 'specialties.json'), 'utf8')).find((s) => s.id === sp);
if (!registry || !existsSync(join(ROOT, 'public', registry.folder || '', 'index.html'))) { console.error(`audit-pages: no built pages for "${sp}"`); process.exit(1); }
const folder = registry.folder || '';
const PORT = 8790 + Math.floor(Math.random() * 50);
let checks = 0, failures = 0;
const report = (ok, label, detail = '') => { checks += 1; if (!ok) failures += 1; console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' | ' + detail : ''}`); };
const num = (s) => Number(String(s ?? '').replace(/[^\d.-]/g, '')) || 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- in-page recompute for the slot page ----------
const slotExpect = (opts) => {
  const D = window.SLOT_DATA, miles = window.SLOT_RADIUS.miles;
  const from = document.querySelector('#from-date').value, through = document.querySelector('#through-date').value;
  const originOf = new Map((D.origins || []).map((o) => [o.z, o]));
  const title = document.querySelector('#map-title').textContent;
  const m = title.match(/within (\d+) miles of (\d{5})/i);
  const center = m ? originOf.get(m[2]) : null, radius = m ? Number(m[1]) : Infinity;
  const distanceOf = new Map();
  const inRadius = (f) => { if (!center) return true; if (!distanceOf.has(f)) { const fo = originOf.get(D.facilities[f].z); distanceOf.set(f, fo ? miles(center.a, center.o, fo.a, fo.o) : Infinity); } return distanceOf.get(f) <= radius; };
  const out = { ah: 0, oh: 0, pAh: new Set(), pOh: new Set(), fAh: new Set(), fOh: new Set(), days: {}, facility: {} };
  for (const s of D.slots) {
    if (s.d < from || s.d > through) continue;
    if (opts.tele === 'hide' && s.v) continue;
    if (opts.clin === 'phys' && D.providers[s.p].c !== 'Physician') continue;
    if (opts.vt === 'new' && !s.np) continue;
    if (opts.view && opts.view !== 'diff' && s.y !== opts.view) continue;
    const f = D.facilities[s.f];
    if (opts.zip && f.z !== opts.zip) continue;
    if (opts.county && f.ct !== opts.county) continue;
    if (!inRadius(s.f)) continue;
    out[s.y] += 1; (s.y === 'ah' ? out.pAh : out.pOh).add(s.p); (s.y === 'ah' ? out.fAh : out.fOh).add(s.f);
    out.days[s.d] = out.days[s.d] || { ah: 0, oh: 0 }; out.days[s.d][s.y] += 1;
    out.facility[s.f] = out.facility[s.f] || new Set(); out.facility[s.f].add(s.p);
  }
  return { ah: out.ah, oh: out.oh, pAh: out.pAh.size, pOh: out.pOh.size, fAh: out.fAh.size, fOh: out.fOh.size, days: out.days, facility: Object.fromEntries(Object.entries(out.facility).map(([k, v]) => [k, v.size])), from, through, title, loaded: D.slots.length };
};
const slotPage = () => { const num = (s) => Number(String(s ?? '').replace(/[^\d.-]/g, '')) || 0; return ({
  ah: num(document.querySelector('#kpi-ah').textContent), oh: num(document.querySelector('#kpi-oh').textContent),
  pAh: num(document.querySelector('#kpi-providers-ah').textContent), pOh: num(document.querySelector('#kpi-providers-oh').textContent),
  fAh: num(document.querySelector('#kpi-facilities-ah').textContent), fOh: num(document.querySelector('#kpi-facilities-oh').textContent),
  area: document.querySelector('#area-name').textContent.trim(),
  profile: [...document.querySelectorAll('#availability-profile .profile-row')].map((r) => ({ label: r.querySelector('.profile-date').textContent.trim(), title: r.querySelector('.profile-bars').getAttribute('title') })),
}); };
const pick = (o) => ({ ah: o.ah, oh: o.oh, pAh: o.pAh, pOh: o.pOh, fAh: o.fAh, fOh: o.fOh });

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', join(ROOT, 'public')], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 900));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const base = `http://127.0.0.1:${PORT}/${folder}`;
  try {
    // ================= Slot Availability =================
    console.log(`== ${sp}: Slot Availability`);
    let page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + 'index.html', { waitUntil: 'load' });
    const settled = async () => { await page.waitForFunction(() => /\d/.test(document.querySelector('#kpi-ah').textContent) && !/Loading/.test(document.querySelector('#map-meta').textContent), null, { timeout: 60000 }); await page.waitForTimeout(350); };
    await settled();
    const compare = async (label, opts) => { const want = await page.evaluate(slotExpect, opts); const got = await page.evaluate(slotPage); const ok = same(pick(want), pick(got)); report(ok, label, ok ? `${want.ah} / ${want.oh} slots, ${want.pAh}+${want.pOh} providers, ${want.fAh}+${want.fOh} facilities (${want.from}..${want.through}, ${want.loaded} loaded)` : `page ${JSON.stringify(pick(got))} expected ${JSON.stringify(pick(want))} title "${want.title}"`); return { want, got }; };
    let r = await compare('landing (default radius, next 90 days, no filters)', {});
    // availability profile rows equal per-day counts
    const days = Object.keys(r.want.days).sort();
    const profileOk = r.got.profile.length > 0 && r.got.profile.every((row, i) => { const d = days[i]; const want = r.want.days[d]; return want && row.title === `${want.ah.toLocaleString('en-US')} AdventHealth · ${want.oh.toLocaleString('en-US')} Orlando Health`; });
    report(profileOk, 'availability profile bars equal the per-day counts of the selection', `${r.got.profile.length} rows, first "${r.got.profile[0]?.label}" ${r.got.profile[0]?.title}`);
    await page.click('#clin-phys'); await page.waitForTimeout(300); await compare('Physicians only', { clin: 'phys' });
    await page.click('#tele-hide'); await page.waitForTimeout(300); await compare('Physicians + in person', { clin: 'phys', tele: 'hide' });
    await page.click('#vt-new'); await page.waitForTimeout(300); await compare('Physicians + in person + new patients', { clin: 'phys', tele: 'hide', vt: 'new' });
    await page.click('#clin-all'); await page.click('#tele-show'); await page.waitForTimeout(300); await compare('New patients only', { vt: 'new' });
    await page.click('#vt-all'); await page.click('#view-ah'); await page.waitForTimeout(300); await compare('AdventHealth view only', { view: 'ah' });
    await page.click('#view-oh'); await page.waitForTimeout(300); await compare('Orlando Health view only', { view: 'oh' });
    await page.click('#view-diff'); await page.click('#clear-radius'); await page.waitForTimeout(400); await compare('All Florida (radius cleared)', {});
    // radius 50 miles around 32804
    await page.fill('#origin-zip', '32804'); await page.click('#apply-radius'); await page.waitForTimeout(400);
    await page.evaluate(() => { const s = document.querySelector('#radius'); s.value = '50'; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(600);
    await compare('50 miles of 32804', {});
    // ZIP selection
    const zipClicked = await page.evaluate(() => { const p = [...document.querySelectorAll('#zip-layer .area')].find((x) => x.dataset.key === '32804'); if (!p) return false; for (const type of ['pointerdown', 'pointerup']) p.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, clientX: 10, clientY: 10 })); p.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; });
    await page.waitForTimeout(400);
    r = await compare('ZIP 32804 selected', { zip: '32804' }); report(zipClicked && /32804/.test(r.got.area), 'selected ZIP is named in the summary band', r.got.area);
    // county mode
    await page.click('#gran-county'); await page.waitForTimeout(500);
    await page.evaluate(() => { const p = [...document.querySelectorAll('#county-layer .area')].find((x) => x.dataset.key === 'Orange'); for (const type of ['pointerdown', 'pointerup']) p.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, clientX: 10, clientY: 10 })); p.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await page.waitForTimeout(400); r = await compare('Orange County selected (county mode, 50 miles)', { county: 'Orange' }); report(/Orange/.test(r.got.area), 'selected county is named in the summary band', r.got.area);
    // period preset: next 7 days (reloads partitions)
    await page.click('#reset'); await page.waitForTimeout(500); await settled();
    await page.selectOption('#period-preset', '7'); await page.waitForTimeout(300); await settled();
    r = await compare('Next 7 days preset', {});
    const span = await page.evaluate(() => [document.querySelector('#from-date').value, document.querySelector('#through-date').value]);
    report((Date.parse(span[1]) - Date.parse(span[0])) / 86400000 <= 7, 'preset set a 7-day window', span.join('..'));
    // facility dialog lists the providers of that facility within the selection
    await page.click('#reset'); await page.waitForTimeout(500); await settled();
    const facility = await page.evaluate(() => { const m = document.querySelector('#facility-marker-layer .facility-marker'); if (!m) return null; const id = Number(m.dataset.facility); m.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); m.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 })); m.dispatchEvent(new MouseEvent('click', { bubbles: true })); return id; });
    await page.waitForTimeout(500);
    const dialog = await page.evaluate(() => ({ open: document.querySelector('#facility-dialog').open, title: document.querySelector('#dialog-title').textContent.trim(), cards: document.querySelectorAll('#doctor-list .doctor').length }));
    const wantFacility = await page.evaluate(slotExpect, {});
    report(facility !== null && dialog.open && dialog.cards === (wantFacility.facility[facility] || 0), 'facility dialog lists exactly the providers with slots at that facility in the selection', `${dialog.title}: ${dialog.cards} cards, expected ${wantFacility.facility[facility]}`);
    await page.click('#close-dialog').catch(() => {});
    await page.click('#dataset-info-button'); await page.waitForTimeout(300);
    const verdict = await page.evaluate(() => ({ verdict: document.querySelector('.check-verdict b')?.textContent, warn: document.querySelectorAll('.check-list li.warn').length, items: document.querySelectorAll('.check-list li').length }));
    report(verdict.verdict === 'All good' && verdict.warn === 0, 'data check dialog', JSON.stringify(verdict));
    report(errors.length === 0, 'no script errors on the slot page', errors.slice(0, 2).join(' | '));
    await page.close();

    // ================= Market Opportunities =================
    console.log(`== ${sp}: Market Opportunities`);
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const merrors = []; page.on('pageerror', (e) => merrors.push(e.message));
    await page.goto(base + 'market-opportunities.html', { waitUntil: 'load' });
    await page.waitForFunction(() => /\d/.test(document.querySelector('#kpi-coverage').textContent) && !/Loading/.test(document.querySelector('#map-meta').textContent), null, { timeout: 60000 }); await page.waitForTimeout(400);
    const marketExpect = () => {
      const D = window.SLOT_DATA, miles = window.SLOT_RADIUS.miles;
      const from = document.querySelector('#from-date').value, through = document.querySelector('#through-date').value;
      const originOf = new Map((D.origins || []).map((o) => [o.z, o]));
      const m = document.querySelector('#map-title').textContent.match(/within (\d+) miles of (\d{5})/i);
      const center = m ? originOf.get(m[2]) : null, radius = m ? Number(m[1]) : Infinity;
      const inScope = (zip) => { if (!center) return true; const o = originOf.get(zip); return o ? miles(center.a, center.o, o.a, o.o) <= radius : false; };
      const perFacility = new Map();
      for (const s of D.slots) { if (s.d < from || s.d > through) continue; const f = D.facilities[s.f]; const row = perFacility.get(s.f) || { z: f.z, ah: 0, oh: 0, eAh: '', eOh: '' }; row[s.y] += 1; const k = s.y === 'ah' ? 'eAh' : 'eOh'; if (!row[k] || s.d < row[k]) row[k] = s.d; perFacility.set(s.f, row); }
      const zips = [...new Set([...perFacility.values()].map((r) => r.z).filter((z) => inScope(z)))];
      const days = (a, b) => (Date.parse(a) - Date.parse(b)) / 86400000;
      const exact = {}, market = {};
      for (const zip of zips) {
        const e = { ah: 0, oh: 0 }, mk = { ah: 0, oh: 0, eAh: '', eOh: '' }; const c = originOf.get(zip);
        for (const row of perFacility.values()) {
          if (row.z === zip && inScope(row.z)) { e.ah += row.ah; e.oh += row.oh; }
          const fo = originOf.get(row.z);
          if (row.z === zip || (c && fo && miles(c.a, c.o, fo.a, fo.o) <= 25)) { mk.ah += row.ah; mk.oh += row.oh; if (row.eAh && (!mk.eAh || row.eAh < mk.eAh)) mk.eAh = row.eAh; if (row.eOh && (!mk.eOh || row.eOh < mk.eOh)) mk.eOh = row.eOh; }
        }
        exact[zip] = e; market[zip] = mk;
      }
      const rows = Object.entries(market);
      const leaders = rows.filter(([, r]) => r.oh > r.ah);
      const sooner = rows.filter(([, r]) => r.oh > 0 && (r.ah === 0 || days(r.eAh, r.eOh) >= 7)).length;
      const largest = leaders.reduce((best, [zip, r]) => (!best || r.oh - r.ah > best.gap ? { zip, gap: r.oh - r.ah } : best), null);
      const exactGaps = Object.values(exact).filter((r) => r.oh > 0 && r.ah === 0).length;
      const listed = [...document.querySelectorAll('#market-table .market-row')].map((el) => { const t = el.textContent.replace(/\s+/g, ' '); const mm = t.match(/Orlando Health ([\d,]+) · AdventHealth ([\d,]+)/); return { zip: el.dataset.zip, oh: mm ? Number(mm[1].replace(/,/g, '')) : null, ah: mm ? Number(mm[2].replace(/,/g, '')) : null }; });
      const mismatches = listed.filter((l) => !(market[l.zip] && market[l.zip].oh === l.oh && market[l.zip].ah === l.ah)).slice(0, 4).map((l) => `${l.zip}: page ${l.oh}/${l.ah} mine ${market[l.zip] ? market[l.zip].oh + '/' + market[l.zip].ah : 'none'}`);
      const listOk = listed.length === rows.length && mismatches.length === 0;
      return { mismatches, markets: rows.length, leaders: leaders.length, sooner, largest: largest ? largest.gap : 0, largestZip: largest ? largest.zip : '', exactGaps, listed: listed.length, listOk,
        page: { coverage: Number(document.querySelector('#kpi-coverage').textContent.replace(/[^\d]/g, '')), priority: Number(document.querySelector('#kpi-priority').textContent.replace(/[^\d]/g, '')), earlier: Number(document.querySelector('#kpi-earlier').textContent.replace(/[^\d]/g, '')), gap: Number(document.querySelector('#kpi-slot-gap').textContent.replace(/[^\d]/g, '')), gapSub: document.querySelector('#kpi-slot-gap-sub').textContent, count: document.querySelector('#market-count').textContent } };
    };
    let mk = await page.evaluate(marketExpect);
    report(mk.page.coverage === mk.leaders && mk.page.priority === mk.exactGaps && mk.page.earlier === mk.sooner && mk.page.gap === mk.largest && (!mk.largestZip || mk.page.gapSub.includes(mk.largestZip)), 'overview figures recompute (markets where OH leads, ZIPs with no AH slots, booking a week sooner, largest lead)', `page ${JSON.stringify(mk.page)} expected leaders ${mk.leaders} exactGaps ${mk.exactGaps} sooner ${mk.sooner} largest ${mk.largest} @${mk.largestZip}`);
    report(mk.listOk && Number((mk.page.count.match(/(\d[\d,]*) markets?/) || [0, '0'])[1].replace(/,/g, '')) === mk.markets, 'ranked list shows every market in scope with recomputed OH/AH counts', `${mk.listed} rows listed, ${mk.markets} markets expected, count text "${mk.page.count}"; mismatches ${mk.mismatches.join(' | ')}`);
    await page.click('#clear-radius'); await page.waitForTimeout(500); mk = await page.evaluate(marketExpect);
    report(mk.page.coverage === mk.leaders && mk.page.priority === mk.exactGaps && mk.page.earlier === mk.sooner && mk.page.gap === mk.largest && mk.listOk, 'overview and list recompute statewide (radius cleared)', `${mk.markets} markets, ${mk.leaders} OH-led, ${mk.exactGaps} exact gaps, largest ${mk.largest}`);
    await page.selectOption('#opportunity-filter', 'lead'); await page.waitForTimeout(300);
    const leadRows = await page.evaluate(() => document.querySelectorAll('#market-table .market-row').length);
    report(leadRows === mk.leaders, 'the "Orlando Health leads" filter lists exactly the OH-led markets', `${leadRows} rows vs ${mk.leaders}`);
    await page.selectOption('#opportunity-filter', 'all');
    const firstZip = await page.evaluate(() => document.querySelector('#market-table .market-row')?.dataset.zip);
    if (firstZip) { await page.click(`#market-table .market-row[data-zip="${firstZip}"]`); await page.waitForTimeout(400); const detail = await page.evaluate(() => ({ name: document.querySelector('#market-name').textContent, oh: document.querySelector('#market-oh').textContent, ah: document.querySelector('#market-ah').textContent, rank: document.querySelector('#market-rank').textContent })); const want = await page.evaluate((zip) => { return null; }, firstZip); report(detail.name.includes(firstZip) && /\d/.test(detail.oh) && /#\s*1\b/.test(detail.rank), 'selecting the top market opens its detail block', JSON.stringify(detail)); }
    await page.click('#dataset-info-button'); await page.waitForTimeout(300);
    const mverdict = await page.evaluate(() => ({ verdict: document.querySelector('.check-verdict b')?.textContent, warn: document.querySelectorAll('.check-list li.warn').length }));
    report(mverdict.verdict === 'All good' && mverdict.warn === 0, 'data check dialog', JSON.stringify(mverdict));
    report(merrors.length === 0, 'no script errors on the market page', merrors.slice(0, 2).join(' | '));
    await page.close();

    // ================= Provider Index =================
    console.log(`== ${sp}: Provider Index`);
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const perrors = []; page.on('pageerror', (e) => perrors.push(e.message));
    await page.goto(base + 'provider-map.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
    const provExpect = (label) => {
      const get = (id) => JSON.parse(document.getElementById(id).textContent);
      const zr = get('zroster'), zrp = get('zroster-primary');
      const matches = (e) => !label || e.s === label || e.sl === label || (e.ls || []).includes(label);
      const assign = { ah: new Set(), oh: new Set() }, people = { ah: new Set(), oh: new Set() };
      for (const es of Object.values(zr)) for (const e of es) if (matches(e)) { people[e.y].add(e.i); for (const l of e.l || []) assign[e.y].add(`${e.i}|${l.z}|${String(l.a || '').toLowerCase()}|${String(l.c || '').toLowerCase()}|${String(l.n || '').toLowerCase()}`); }
      const peopleP = { ah: new Set(), oh: new Set() };
      for (const es of Object.values(zrp)) for (const e of es) if (matches(e)) peopleP[e.y].add(e.i);
      return { assign: { ah: assign.ah.size, oh: assign.oh.size }, people: { ah: people.ah.size, oh: people.oh.size }, primary: { ah: peopleP.ah.size, oh: peopleP.oh.size }, page: { ah: Number(document.getElementById('tot-ah').textContent.replace(/[^\d]/g, '')), oh: Number(document.getElementById('tot-oh').textContent.replace(/[^\d]/g, '')), title: document.getElementById('tot-title').textContent } };
    };
    const group = registry.roster.group;
    const selectValue = await page.evaluate(() => document.getElementById('spec').value);
    const options = await page.evaluate(() => [...document.getElementById('spec').options].map((o) => ({ value: o.value, text: o.textContent })));
    let pe = await page.evaluate(provExpect, group);
    report(pe.page.ah === pe.assign.ah && pe.page.oh === pe.assign.oh, `headline (all locations) = distinct provider-office assignments of ${group}`, `page ${pe.page.ah}/${pe.page.oh} expected ${pe.assign.ah}/${pe.assign.oh} (people ${pe.people.ah}/${pe.people.oh}); menu value "${selectValue}"`);
    await page.click('#m-primary'); await page.waitForTimeout(400); pe = await page.evaluate(provExpect, group);
    report(pe.page.ah === pe.primary.ah && pe.page.oh === pe.primary.oh, 'headline (primary only) = distinct people of the group', `page ${pe.page.ah}/${pe.page.oh} expected ${pe.primary.ah}/${pe.primary.oh}`);
    await page.click('#m-all'); await page.waitForTimeout(300);
    let subOk = 0, subTried = 0;
    for (const opt of options.filter((o) => o.value && o.value !== group).slice(0, 6)) {
      subTried += 1; await page.selectOption('#spec', opt.value); await page.waitForTimeout(400);
      const x = await page.evaluate(provExpect, opt.value); if (x.page.ah === x.assign.ah && x.page.oh === x.assign.oh) subOk += 1; else console.log(`      sub-specialty ${opt.value}: page ${x.page.ah}/${x.page.oh} expected ${x.assign.ah}/${x.assign.oh}`);
    }
    report(subTried > 0 && subOk === subTried, `sub-specialty menu: headline recomputes for each label (${subTried} tried)`, options.slice(0, 5).map((o) => o.text.trim()).join(' · '));
    await page.selectOption('#spec', selectValue || group); await page.waitForTimeout(300);
    // click a ZIP with providers and count the listed cards
    const zipInfo = await page.evaluate((label) => { const zr = JSON.parse(document.getElementById('zroster').textContent); const matches = (e) => e.s === label || e.sl === label || (e.ls || []).includes(label); const zips = Object.entries(zr).map(([z, es]) => [z, es.filter(matches).length]).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]); const [zip, count] = zips[0]; const p = [...document.querySelectorAll('#lay-zip path.z')].find((x) => x.getAttribute('data-k') === zip); if (!p) return { zip, count, clicked: false }; for (const type of ['pointerdown', 'pointerup']) p.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, clientX: 10, clientY: 10 })); p.dispatchEvent(new MouseEvent('click', { bubbles: true })); return { zip, count, clicked: true }; }, group);
    await page.waitForTimeout(500);
    const listed = await page.evaluate(() => ({ cards: document.querySelectorAll('#panel .card, #panel .pcard, #panel [class*=provider]').length, text: document.getElementById('panel').textContent.replace(/\s+/g, ' ').slice(0, 160) }));
    const nameCount = await page.evaluate((zip) => { const zr = JSON.parse(document.getElementById('zroster').textContent); const names = (zr[zip] || []).map((e) => e.n); const text = document.getElementById('panel').textContent; return names.filter((n) => text.includes(n)).length; }, zipInfo.zip);
    report(zipInfo.clicked && nameCount >= zipInfo.count, `clicking ZIP ${zipInfo.zip} lists its ${zipInfo.count} ${group} people by name`, `${nameCount} names found; panel: ${listed.text}`);
    await page.click('#g-county'); await page.waitForTimeout(600); pe = await page.evaluate(provExpect, group);
    report(pe.page.ah === pe.assign.ah && pe.page.oh === pe.assign.oh, 'county view keeps the same statewide headline', `page ${pe.page.ah}/${pe.page.oh}`);
    await page.click('#dataset-info-button'); await page.waitForTimeout(300);
    const pverdict = await page.evaluate(() => ({ verdict: document.querySelector('.check-verdict b')?.textContent, warn: document.querySelectorAll('.check-list li.warn').length, warnText: [...document.querySelectorAll('.check-list li.warn')].map((li) => li.textContent.trim().slice(0, 120)) }));
    report(pverdict.verdict === 'All good' && pverdict.warn === 0, 'data check dialog', JSON.stringify(pverdict));
    report(perrors.length === 0, 'no script errors on the Provider Index', perrors.slice(0, 2).join(' | '));
    await page.close();
  } finally { await browser.close(); srv.kill(); }
  console.log(`\n${sp}: ${checks - failures} of ${checks} page checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
