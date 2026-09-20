// The header shared by all three pages: the specialty menu and title box, the page switcher, and the "Data check" info dialog.
import { SPECIALTIES, specialtyHref, specialtyOf } from "./specialties.js";

// `view` is the accent line under the specialty menu; `name` is the plain view name used in document titles.
const PAGES = [
  { id: "slot-times", label: "Slot Availability", href: "./index.html", view: "Slot Availability", name: "Slot Availability" },
  { id: "opportunities", label: "Market Opportunities", href: "./market-opportunities.html", view: "AH Market Opportunities", name: "Market Opportunities" },
  { id: "provider-map", label: "Provider Index", href: "./provider-map.html", view: "Provider Index", name: "Provider Index" },
];
export const SUITE_PAGES = PAGES;
export function suitePage(id) {
  const page = PAGES.find((candidate) => candidate.id === id);
  if (!page) throw new Error(`Unknown suite page: ${id}`);
  return page;
}
const PIXEL_HEART = '<span class="pixel-heart" aria-hidden="true"><svg viewBox="0 0 9 8" shape-rendering="crispEdges"><path fill="currentColor" d="M1 0h3v1h1V0h3v1h1v3H8v1H7v1H6v1H5v1H4V7H3V6H2V5H1V4H0V1h1z"/></svg></span>';
const PIXEL_BONE = '<span class="pixel-bone" aria-hidden="true"><svg viewBox="0 0 15 9" shape-rendering="crispEdges"><path fill="currentColor" d="M1 0h2v1H1zM12 0h2v1h-2zM0 1h4v2H0zM11 1h4v2h-4zM1 3h13v1H1zM2 4h11v1H2zM1 5h13v1H1zM0 6h4v2H0zM11 6h4v2h-4zM1 8h2v1H1zM12 8h2v1h-2z"/></svg></span>';
const EMBLEMS = { heart: PIXEL_HEART, bone: PIXEL_BONE };
const PIXEL_CARET = '<span class="specialty-caret" aria-hidden="true"><svg viewBox="0 0 9 5" shape-rendering="crispEdges"><path fill="currentColor" d="M0 0h9v1H0zM1 1h7v1H1zM2 2h5v1H2zM3 3h3v1H3zM4 4h1v1H4z"/></svg></span>';

// The header box carries the specialty menu (the lead line) over the current view's name (the
// accent line) plus the specialty's pixel emblem; there is no separate page heading below it.
// Each menu entry links to the same view under that specialty, so a choice is a plain navigation.
// The hidden sizer gives the menu the width of the selected name in the page's own type.
export function suiteTitle(activePage, specialtyId = "cardiology") {
  const page = suitePage(activePage);
  const specialty = specialtyOf(specialtyId);
  const file = page.href.replace(/^\.\//, "");
  const options = SPECIALTIES.map((candidate) => `<option value="${candidate.id}" data-href="${specialtyHref(specialty, candidate, file)}"${candidate.id === specialty.id ? " selected" : ""}>${candidate.label}</option>`).join("");
  const menu = `<span class="specialty-pick"><span class="specialty-sizer" aria-hidden="true">${specialty.label}</span><select class="specialty-select" aria-label="Specialty">${options}</select>${PIXEL_CARET}</span>`;
  return `<div class="brand-box"><span class="mark">${menu}<b>${page.view}</b></span>${EMBLEMS[specialty.emblem]}</div>`;
}

export const SUITE_NAV_STYLES = String.raw`
.brand-box{min-width:220px;justify-content:flex-start}
.brand-box{position:relative}
.hdr .hdr-in{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center}
.hdr .brand-box{width:auto;min-width:220px;padding-right:44px;justify-self:start;justify-content:flex-start}
.hdr .mark{display:flex;flex-direction:column;align-items:flex-start;font-size:17px;line-height:1.05;letter-spacing:.105em;white-space:normal}
.pixel-heart{position:absolute;right:12px;top:50%;margin-top:-7px;width:15px;height:14px;color:#b40046;transform-origin:center;animation:pixel-heartbeat 1.25s steps(2,end) infinite}
.pixel-heart svg{display:block;width:100%;height:100%;filter:drop-shadow(1px 1px 0 rgba(0,0,0,.2))}
.pixel-bone{position:absolute;right:11px;top:50%;margin-top:-6px;width:20px;height:12px;color:#14233e}
.pixel-bone svg{display:block;width:100%;height:100%;filter:drop-shadow(1px 1px 0 rgba(0,0,0,.2))}
.specialty-pick{position:relative;display:inline-block;margin-right:.25em;vertical-align:baseline}
.specialty-sizer{display:inline-block;visibility:hidden;padding-right:12px;white-space:nowrap}
.specialty-select{position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0 12px 0 0;border:0;border-radius:0;background:transparent;color:inherit;font:inherit;letter-spacing:inherit;text-transform:inherit;line-height:inherit;white-space:nowrap;cursor:pointer;appearance:none;-webkit-appearance:none}
.specialty-select:focus-visible{outline:2px solid #1fa9e1;outline-offset:3px}
.specialty-caret{position:absolute;right:0;top:50%;width:9px;height:5px;margin-top:-2px;pointer-events:none}
.specialty-caret svg{display:block;width:100%;height:100%}
.header-health-brand{display:flex;align-items:center;justify-content:center;align-self:stretch}
.header-health-logo{display:block;width:228px;height:48px;background:var(--ah-logo-img) center/contain no-repeat;filter:brightness(0) invert(1);opacity:.96}
@keyframes pixel-heartbeat{0%,64%,100%{transform:scale(1)}14%{transform:scale(1.28)}28%{transform:scale(1)}42%{transform:scale(1.16)}}
@media (prefers-reduced-motion:reduce){.pixel-heart{animation:none}}
.hdr-tools{display:flex;align-items:stretch;align-self:stretch;gap:8px;justify-self:end;min-width:0}
.suite-switcher{display:inline-flex;align-items:stretch;justify-content:center;flex-wrap:wrap;gap:3px;min-width:0;padding:3px;background:#fff;border:3px solid #000;font-family:var(--mono);flex:0 1 auto}
@media (min-width:1401px){.hdr .brand-box,.hdr .suite-switcher{width:466px}.hdr .brand-box{height:56px}}
.hdr{position:relative}
.info-button{position:absolute;right:14px;top:50%;transform:translateY(-50%);height:56px;flex:none;width:44px;border:3px solid #000;background:#fff;color:#14233e;font:700 15px/1 var(--mono);cursor:pointer;display:grid;place-items:center}
@media (min-width:701px) and (max-width:1400px){.hdr .hdr-in{padding-right:78px}}
@media (min-width:1401px) and (max-width:1595px){.hdr .hdr-in{padding-left:78px;padding-right:78px}}
.info-button:hover,.info-button:focus-visible{background:#e8f5fb}
.dataset-dialog{margin:auto;width:min(780px,calc(100vw - 28px));max-height:90vh;padding:0;border:3px solid #000;background:#fff;color:#14233e;box-shadow:0 30px 90px rgba(11,35,60,.32);overflow:auto}
.dataset-dialog::backdrop{background:rgba(8,25,42,.62)}
.dataset-head{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 22px;background:#005c99;color:#fff}
.dataset-head h2{margin:0;font:700 16px/1.2 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:#fff}
.dataset-close{width:36px;height:36px;border:2px solid #000;background:#fff;color:#14233e;font:700 22px/1 var(--mono);cursor:pointer}
.info-button.attention::after{content:"";position:absolute;top:-6px;right:-6px;width:14px;height:14px;background:#e0a100;border:2px solid #000}
.check-verdict{display:flex;align-items:center;gap:14px;padding:18px 22px;border-bottom:2px solid #000;font:700 22px/1.2 var(--mono);letter-spacing:.04em;text-transform:uppercase;color:#14233e}
.check-verdict small{font:600 14px/1.3 var(--display,"Helvetica Neue",Arial,sans-serif);letter-spacing:0;text-transform:none;color:#52627b}
.check-dot{flex:none;width:18px;height:18px;border:2px solid #000}
.check-verdict.ok .check-dot{background:#2e9e5b}.check-verdict.warn .check-dot{background:#e0a100}
.check-list{list-style:none;margin:0;padding:6px 22px 10px}
.check-list li{display:flex;align-items:flex-start;gap:14px;padding:13px 0;border-bottom:1px solid #dfe5ec;font:400 16px/1.45 var(--display,"Helvetica Neue",Arial,sans-serif);color:#14233e}
.check-list li:last-child{border-bottom:0}
.check-mark{flex:none;width:26px;height:26px;display:grid;place-items:center;border:2px solid #000;background:#2e9e5b;color:#fff;font:700 14px/1 var(--mono)}
.check-list li.warn .check-mark{background:#e0a100;color:#14233e}
@media (max-width:560px){.check-verdict{padding:14px 16px;font-size:18px}.check-list{padding-inline:16px}.check-list li{font-size:15px}}
.suite-switcher a{display:flex;align-items:center;padding:6px 12px;color:var(--navy);font-size:11px;font-weight:700;letter-spacing:.065em;line-height:1;text-decoration:none;text-transform:uppercase;white-space:nowrap}
.suite-switcher a:hover{background:var(--accent-tint);color:var(--navy)}
.suite-switcher a[aria-current="page"]{background:var(--navy);color:#fff}
@media (max-width:1400px){
 .hdr .hdr-in{grid-template-columns:auto minmax(0,1fr)}
 .header-health-brand{display:none}
 .hdr-tools{grid-column:2;justify-self:end}
}
@media (max-width:700px){
 .hdr .hdr-in{grid-template-columns:auto minmax(0,1fr)}
 .header-health-brand{display:none}
 .hdr-tools{grid-column:2;width:100%;padding-right:0}
 .suite-switcher{flex:1}
 .info-button{position:static;transform:none;height:auto}
 .suite-switcher a{flex:1;justify-content:center;text-align:center}
}
@media (max-width:560px){
 .hdr .hdr-in{grid-template-columns:1fr}
 .hdr .brand-box{justify-self:center}
 .hdr-tools{grid-column:1;width:100%}
 .suite-switcher a{padding-inline:4px;font-size:8.5px;letter-spacing:.035em}
}
@media (max-width:880px),(max-height:520px){
 html{scrollbar-gutter:stable}
}
@media (min-width:881px) and (max-height:680px){
 .hdr-in{min-height:52px;padding:6px 18px}
 .brand-box{padding:5px 12px}
 .info-button{height:50px}
 .mark{font-size:16px}
 .wrap{padding:8px 16px 10px}
 .page{padding:8px 16px 10px}
 .panel-band{padding:5px 12px}
 .panel-band h1,.panel-band h2{font-size:12px}
 .band-meta{font-size:10.5px}
}`;

export function suiteNavigation(activePage) {
  if (!PAGES.some((page) => page.id === activePage)) {
    throw new Error(`Unknown suite page: ${activePage}`);
  }
  const links = PAGES.map((page) => {
    const current = page.id === activePage ? ' aria-current="page"' : "";
    return `<a href="${page.href}"${current}>${page.label}</a>`;
  }).join("");
  return `<div class="hdr-tools"><nav class="suite-switcher" aria-label="Dashboard views">${links}</nav><button id="dataset-info-button" class="info-button" type="button" aria-haspopup="dialog" aria-controls="dataset-info" aria-label="About this data" title="About this data">i</button></div>`;
}

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

// The dialog behind the header info button: a verdict over a short checklist.
// `report` is { pulled: { at, label, freshDays }, checks: [{ ok, text }] }. The
// page is static, so the browser judges freshness and refreshes the verdict.
export function suiteInfoDialog(title, report) {
  const items = [];
  if (report.pulled?.at) items.push(`<li class="ok" data-pulled="${escapeHtml(report.pulled.at)}" data-fresh-days="${Number(report.pulled.freshDays) || 7}"><span class="check-mark">✓</span><span>${escapeHtml(report.pulled.label)}<span data-age></span></span></li>`);
  for (const check of report.checks ?? []) items.push(`<li class="${check.ok ? "ok" : "warn"}"><span class="check-mark">${check.ok ? "✓" : "!"}</span><span>${escapeHtml(check.text)}</span></li>`);
  const warn = (report.checks ?? []).filter((check) => !check.ok).length;
  return `<dialog id="dataset-info" class="dataset-dialog" aria-labelledby="dataset-info-title"><div class="dataset-head"><h2 id="dataset-info-title">${escapeHtml(title)}</h2><button type="button" class="dataset-close" aria-label="Close">×</button></div><div class="check-verdict ${warn ? "warn" : "ok"}"><span class="check-dot"></span><b>${warn ? "Needs attention" : "All good"}</b><small>${warn ? `${warn} of ${items.length} checks need a look` : `${items.length} checks passed`}</small></div><ul class="check-list">${items.join("")}</ul></dialog>`;
}

export const SUITE_INFO_SCRIPT = String.raw`(() => {
  const select = document.querySelector(".specialty-select");
  if (!select) return;
  select.addEventListener("change", () => {
    const chosen = select.options[select.selectedIndex];
    const href = chosen && chosen.dataset.href;
    if (href) location.href = href;
  });
})();
(() => {
  const button = document.getElementById("dataset-info-button"), dialog = document.getElementById("dataset-info");
  if (!button || !dialog || typeof dialog.showModal !== "function") return;
  const pulled = dialog.querySelector("[data-pulled]");
  if (pulled) {
    const days = Math.max(0, Math.floor((Date.now() - new Date(pulled.dataset.pulled).getTime()) / 86400000));
    const limit = Number(pulled.dataset.freshDays) || 7, stale = days > limit;
    const age = days === 0 ? "today" : days === 1 ? "1 day ago" : days + " days ago";
    pulled.querySelector("[data-age]").textContent = ", " + age + (stale ? ". A refresh is due." : ".");
    pulled.classList.toggle("warn", stale); pulled.classList.toggle("ok", !stale);
    pulled.querySelector(".check-mark").textContent = stale ? "!" : "✓";
  }
  const items = dialog.querySelectorAll(".check-list li"), warn = dialog.querySelectorAll(".check-list li.warn").length;
  const verdict = dialog.querySelector(".check-verdict");
  verdict.classList.toggle("ok", warn === 0); verdict.classList.toggle("warn", warn > 0);
  verdict.querySelector("b").textContent = warn ? "Needs attention" : "All good";
  verdict.querySelector("small").textContent = warn ? warn + " of " + items.length + " checks need a look" : items.length + " checks passed";
  button.classList.toggle("attention", warn > 0);
  button.title = warn ? "Data check: needs attention" : "Data check: all good";
  button.addEventListener("click", () => dialog.showModal());
  dialog.querySelector(".dataset-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
})();`;
