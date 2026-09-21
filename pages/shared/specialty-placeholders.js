// Placeholder pages for a specialty whose data is not published yet. Every specialty other than
// Cardiology lives in its own folder (public/<id>/) with the same three page names, so the header's
// specialty menu always has somewhere to go. Until public/data/<id>/slot-times-summary.json exists,
// each address carries the shared header with that specialty selected and a note that the data is
// coming. Once the data is published these files are left alone for the real renders to replace.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SPECIALTIES, specialtyOf } from "./specialties.js";
import { SUITE_INFO_SCRIPT, SUITE_NAV_STYLES, SUITE_PAGES, suiteInfoDialog, suiteNavigation, suitePage, suiteTitle } from "./suite-navigation.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative, encoding = "utf8") => readFileSync(join(ROOT, relative), encoding);
const optional = (relative) => { try { return read(relative); } catch { return ""; } };
const fileOf = (page) => page.href.replace(/^\.\//, "");

export const isPublished = (specialty) => existsSync(join(ROOT, "public", specialty.dataDir, "slot-times-summary.json"));

export function renderSpecialtyPlaceholder(specialtyId, pageId) {
  const specialty = specialtyOf(specialtyId), page = suitePage(pageId);
  const logo = read("assets/adventhealth-logo.png", null).toString("base64");
  const report = { checks: [{ ok: false, text: `${specialty.label} slot data has not been published yet, so this page is a placeholder. It fills in once the ${specialty.label} extraction runs.` }] };
  const fill = (html, token, value) => html.replaceAll(token, () => value);
  let html = PAGE;
  html = fill(html, "__TITLE__", `${specialty.label} ${page.name}`);
  html = fill(html, "__FONTS__", optional("assets/fonts.css"));
  html = fill(html, "__LOGO_VARS__", `:root{--ah-logo-img:url(data:image/png;base64,${logo})}`);
  html = fill(html, "__STYLES__", read("pages/slot-availability/styles.css"));
  html = fill(html, "__NAV_STYLES__", SUITE_NAV_STYLES);
  html = fill(html, "__BRAND__", suiteTitle(pageId, specialtyId));
  html = fill(html, "__NAV__", suiteNavigation(pageId));
  html = fill(html, "__HEADING__", `${specialty.label} · ${page.name}`);
  html = fill(html, "__LABEL__", specialty.label);
  html = fill(html, "__CARDIOLOGY_HREF__", `../${fileOf(page)}`);
  html = fill(html, "__INFO_DIALOG__", suiteInfoDialog("Data check", report));
  html = fill(html, "__INFO_SCRIPT__", SUITE_INFO_SCRIPT);
  return html;
}

export function writeSpecialtyPlaceholders() {
  const written = [];
  for (const specialty of SPECIALTIES) {
    if (!specialty.folder || isPublished(specialty)) continue;
    const folder = join(ROOT, "public", specialty.folder);
    mkdirSync(folder, { recursive: true });
    for (const page of SUITE_PAGES) {
      writeFileSync(join(folder, fileOf(page)), renderSpecialtyPlaceholder(specialty.id, page.id));
      written.push(`public/${specialty.folder}${fileOf(page)}`);
    }
  }
  return written;
}

const PAGE = String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>__TITLE__</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>__FONTS__
__LOGO_VARS__
__STYLES__
__NAV_STYLES__
.coming-soon-body{padding:26px 22px 30px;display:grid;gap:12px;max-width:720px}
.coming-soon-title{font:700 20px/1.2 var(--mono);letter-spacing:.06em;text-transform:uppercase}
.coming-soon-body p{font:15px/1.5 var(--display)}
.coming-soon-link{display:inline-block;margin-top:4px;padding:8px 12px;border:2px solid #000;background:#fff;color:var(--navy);font:700 11px/1 var(--mono);letter-spacing:.065em;text-transform:uppercase;text-decoration:none}
.coming-soon-link:hover,.coming-soon-link:focus-visible{background:var(--pale)}
</style></head><body>
<header class="hdr"><div class="hdr-in">__BRAND__<div class="header-health-brand" aria-label="AdventHealth"><span class="header-health-logo" aria-hidden="true"></span></div>__NAV__</div></header>
<main class="page"><section class="panel"><div class="band"><h2>__HEADING__</h2></div><div class="coming-soon-body"><p class="coming-soon-title">__LABEL__ data is coming soon.</p><p>The __LABEL__ extraction has not been published yet. Once it runs, this view shows the same AdventHealth and Orlando Health comparison as Cardiology.</p><p><a class="coming-soon-link" href="__CARDIOLOGY_HREF__">Open the Cardiology view</a></p></div></section></main>
__INFO_DIALOG__
<script>__INFO_SCRIPT__</script>
</body></html>
`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const written = writeSpecialtyPlaceholders();
  console.log(written.length ? `wrote ${written.length} placeholder page(s): ${written.join(", ")}` : "every specialty has published data; no placeholder pages written");
}
