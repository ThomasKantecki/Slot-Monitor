const PAGES = [
  { id: "slot-times", label: "Slot Availability", href: "./index.html" },
  { id: "provider-map", label: "Provider Index", href: "./provider-map.html" },
];

export const SUITE_NAV_STYLES = String.raw`
.brand-box{width:220px;justify-content:flex-start}
.brand-box{position:relative}
.hdr .hdr-in{display:grid;grid-template-columns:220px minmax(150px,1fr) auto;align-items:center}
.hdr .brand-box{width:220px;justify-content:flex-start}
.hdr .mark{display:flex;flex-direction:column;align-items:flex-start;font-size:17px;line-height:1.05;letter-spacing:.105em;white-space:normal}
.pixel-heart{position:absolute;right:12px;top:50%;margin-top:-7px;width:15px;height:14px;color:#b40046;transform-origin:center;animation:pixel-heartbeat 1.25s steps(2,end) infinite}
.pixel-heart svg{display:block;width:100%;height:100%;filter:drop-shadow(1px 1px 0 rgba(0,0,0,.2))}
.header-health-brand{display:flex;flex:1;min-width:150px;align-items:center;justify-content:center;align-self:stretch}
.header-health-logo{display:block;width:190px;height:40px;background:var(--ah-logo-img) center/contain no-repeat;filter:brightness(0) invert(1);opacity:.96}
@keyframes pixel-heartbeat{0%,64%,100%{transform:scale(1)}14%{transform:scale(1.28)}28%{transform:scale(1)}42%{transform:scale(1.16)}}
@media (prefers-reduced-motion:reduce){.pixel-heart{animation:none}}
.suite-switcher{display:inline-flex;align-items:center;gap:3px;padding:3px;background:#fff;border:3px solid #000;font-family:var(--mono);flex:none}
.suite-switcher a{display:block;padding:6px 12px;color:var(--navy);font-size:11px;font-weight:700;letter-spacing:.065em;line-height:1;text-decoration:none;text-transform:uppercase;white-space:nowrap}
.suite-switcher a:hover{background:var(--accent-tint);color:var(--navy)}
.suite-switcher a[aria-current="page"]{background:var(--navy);color:#fff}
@media (max-width:700px){
 .hdr .hdr-in{grid-template-columns:220px minmax(0,1fr)}
 .header-health-brand{display:none}
 .suite-switcher{grid-column:2;width:100%}
 .suite-switcher a{flex:1;text-align:center}
}
@media (max-width:560px){
 .hdr .hdr-in{grid-template-columns:1fr}
 .hdr .brand-box{justify-self:center}
 .suite-switcher{grid-column:1}
}
@media (max-width:880px),(max-height:520px){
 html{scrollbar-gutter:stable}
}
@media (min-width:881px) and (max-height:680px){
 .hdr-in{min-height:52px;padding:6px 18px}
 .brand-box{padding:5px 12px}
 .mark{font-size:16px}
 .wrap{padding:8px 16px 10px}
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
  return `<nav class="suite-switcher" aria-label="Dashboard views">${links}</nav>`;
}
