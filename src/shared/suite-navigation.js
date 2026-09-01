const PAGES = [
  { id: "provider-map", label: "Provider Map", href: "./provider-map.html" },
  { id: "slot-times", label: "Slot Times", href: "./slot-times.html" },
];

export const SUITE_NAV_STYLES = String.raw`
.brand-box{width:220px;justify-content:center}
.suite-switcher{display:inline-flex;align-items:center;gap:3px;padding:3px;background:#fff;border:3px solid #000;font-family:var(--mono);flex:none}
.suite-switcher a{display:block;padding:6px 12px;color:var(--navy);font-size:11px;font-weight:700;letter-spacing:.065em;line-height:1;text-decoration:none;text-transform:uppercase;white-space:nowrap}
.suite-switcher a:hover{background:var(--accent-tint);color:var(--navy)}
.suite-switcher a[aria-current="page"]{background:var(--navy);color:#fff}
@media (max-width:700px){
 .suite-switcher{width:100%}
 .suite-switcher a{flex:1;text-align:center}
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
