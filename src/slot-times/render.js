// Slot Times is intentionally isolated from the Provider Map renderer. Build
// this page independently while sharing only the top-level suite navigation.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SUITE_NAV_STYLES, suiteNavigation } from "../shared/suite-navigation.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function optionalFile(rel, encoding) {
  try { return readFileSync(join(ROOT, rel), encoding); }
  catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

export function renderSlotTimes() {
  const fontsCss = optionalFile("data/fonts.css", "utf8");
  const ahLogo = optionalFile("assets/adventhealth-logo.png").toString("base64");
  const logoVar = ahLogo ? `--ah-logo-img:url(data:image/png;base64,${ahLogo});` : "";

  return String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Slot Time Availability</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%23005C99'/%3E%3Crect y='12' width='16' height='4' fill='%231FA9E1'/%3E%3C/svg%3E">
<style>
${fontsCss}
:root{${logoVar}--navy:#14233e;--cream:#f5f1e8;--cream-90:#eee9dc;--chrome:#005c99;--accent:#1fa9e1;--accent-tint:rgba(31,169,225,.12);--ink:#14233e;--mute:#41506c;--faint:#63748c;--mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;--display:"Helvetica Neue","Inter",Helvetica,Arial,system-ui,sans-serif}
*,*::before,*::after{box-sizing:border-box;border-radius:0;box-shadow:none}
*{margin:0}
html{height:100%;overflow:hidden}
body{height:100vh;height:100dvh;min-height:0;background:var(--cream);color:var(--ink);font-family:var(--display);font-size:15px;line-height:1.5;display:flex;flex-direction:column;overflow:hidden}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.hdr{background:var(--chrome);border-bottom:1px solid rgba(245,241,232,.14);flex:none}
.hdr-in{max-width:1440px;margin:0 auto;min-height:60px;padding:11px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.brand-box{display:inline-flex;align-items:center;gap:14px;background:#fff;border:3px solid #000;padding:8px 16px}
.mark{font-family:var(--mono);font-size:19px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--navy);white-space:nowrap}
.mark b{color:var(--accent);font-weight:700}
.brand-logo{display:inline-block;width:106px;height:26px;background:var(--ah-logo-img) no-repeat center/contain;flex:none}
.wrap{max-width:1440px;width:100%;margin:0 auto;padding:14px 22px 16px;display:flex;flex:1;min-height:0}
.panel{width:100%;min-height:0;background:#fff;border:3px solid #000;display:flex;flex-direction:column}
.panel-band{background:var(--chrome);padding:8px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.panel-band h1{font-family:var(--mono);font-size:14px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--cream)}
.band-meta{font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.04em;color:#a5d8f3;text-transform:uppercase}
.slot-workspace{flex:1;min-height:0;display:grid;place-items:center;padding:32px}
.empty-state{text-align:center;max-width:440px;color:var(--mute)}
.empty-mark{width:64px;height:64px;margin:0 auto 16px;display:grid;place-items:center;background:var(--accent-tint);border:2px solid var(--chrome);font-family:var(--mono);font-weight:700;letter-spacing:.08em;color:var(--chrome)}
.empty-state h2{font-family:var(--mono);font-size:20px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);margin-bottom:5px}
.empty-state p{font-size:14px}
${SUITE_NAV_STYLES}
@media (max-width:880px),(max-height:520px){
 html{height:auto;min-height:100%;overflow:auto}
 body{height:auto;min-height:100vh;min-height:100dvh;display:block;overflow:visible}
 .wrap{height:auto;display:block;padding:12px}
 .panel{min-height:420px}
}
@media (max-width:480px){
 .hdr-in{padding:8px 10px}
 .brand-box{width:100%;justify-content:center;padding:6px 10px;gap:10px}
 .mark{font-size:16px}.brand-logo{width:88px;height:23px}
 .wrap{padding:10px}
 .slot-workspace{padding:24px 18px}
}
</style>
</head>
<body>
<header class="hdr"><div class="hdr-in">
 <div class="brand-box"><span class="mark">Slot<b> Times</b></span><span class="brand-logo" role="img" aria-label="AdventHealth"></span></div>
 ${suiteNavigation("slot-times")}
</div></header>
<main class="wrap">
 <section class="panel" aria-labelledby="slot-times-title">
  <div class="panel-band"><h1 id="slot-times-title">Slot time availability</h1><span class="band-meta">In development</span></div>
  <div class="slot-workspace" id="slot-times-root" data-page="slot-times">
   <div class="empty-state"><div class="empty-mark" aria-hidden="true">ST</div><h2>Slot Times</h2><p>No slot-time data is connected yet.</p></div>
  </div>
 </section>
</main>
</body>
</html>`;
}

export function writeSlotTimes() {
  const html = renderSlotTimes();
  mkdirSync(join(ROOT, "public"), { recursive: true });
  writeFileSync(join(ROOT, "public", "slot-times.html"), html);
  return { bytes: html.length };
}

function main() {
  const result = writeSlotTimes();
  console.log(`wrote public/slot-times.html — ${(result.bytes / 1e3).toFixed(1)} KB`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
