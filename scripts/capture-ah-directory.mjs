// Refresh the AdventHealth Medical Group provider capture from the public,
// server-rendered directory. The listing cards already contain each provider's
// profile photo and every published practice location, so profile pages are not
// needed. No third-party packages are required.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SOURCE = "https://www.adventhealth.com/locations/practices/adventhealth-medical-group/doctors";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const OUTPUT = join(ROOT, "data", "raw", "ah-directory-scrape.json");
const CONCURRENCY = 8;

const decode = (value) => String(value ?? "")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">");

const clean = (html) => decode(String(html ?? "")
  .replace(/<br\s*\/?>/gi, ", ")
  .replace(/<[^>]*>/g, " "))
  .replace(/\s+,/g, ",")
  .replace(/,\s*,+/g, ", ")
  .replace(/\s+/g, " ")
  .replace(/,\s*$/, "")
  .trim();

const attr = (html, name) => {
  const m = new RegExp(`\\b${name}=["']([^"']*)["']`, "i").exec(html);
  return decode(m?.[1] ?? "").trim();
};

const blockByClass = (html, className) => {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<([a-z][\\w:-]*)\\b[^>]*class=["'][^"']*${escaped}[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i");
  return re.exec(html)?.[2] ?? "";
};

const absolute = (value) => {
  if (!value || /^data:/i.test(value)) return "";
  try { return new URL(decode(value), SOURCE).href; } catch { return ""; }
};

function locationChunks(card) {
  return card.split(/(?=<(?:div|li)\b[^>]*class=["'][^"']*ahs-location-selector__list-item[^"']*["'][^>]*>)/i)
    .filter((chunk) => /^<(?:div|li)\b[^>]*class=["'][^"']*ahs-location-selector__list-item/i.test(chunk));
}

export function parseListingPage(html) {
  const text = String(html ?? "");
  const totalMatch = /([\d,]+)\s+providers?\s+match(?:es)?\s+your\s+search/i.exec(clean(text));
  const total = totalMatch ? Number(totalMatch[1].replaceAll(",", "")) : null;
  const cards = text.split(/<li\b[^>]*class=["'][^"']*physicians-search-block__item[^"']*["'][^>]*>/i).slice(1);
  const records = [];

  for (const card of cards) {
    const profileMatch = /href=["']([^"']*\/doctors\/[^"']+)["']/i.exec(card);
    const profile = absolute(profileMatch?.[1]).split("#")[0];
    const npi = /-(\d{10})(?:[/?#]|$)/.exec(profile)?.[1] ?? "";
    if (!npi) continue;

    const imageBlock = blockByClass(card, "physician-block__image");
    const imageTag = /<img\b[^>]*>/i.exec(imageBlock)?.[0] ?? /<img\b[^>]*>/i.exec(card)?.[0] ?? "";
    const rawPhoto = attr(imageTag, "data-src") || attr(imageTag, "src");
    const photo = /default[-_ ]?(?:physician|provider)|placeholder/i.test(rawPhoto) ? "" : absolute(rawPhoto);
    const name = clean(blockByClass(card, "physician-block__name"));
    const spec = clean(blockByClass(card, "physician-block__specialty"));
    const locations = locationChunks(card).map((chunk, i) => {
      const opening = /^<(?:div|li)\b[^>]*>/i.exec(chunk)?.[0] ?? "";
      return {
        locName: clean(blockByClass(chunk, "address-name")),
        street: clean(/<[^>]*property=["']streetAddress["'][^>]*>([\s\S]*?)<\/[^>]+>/i.exec(chunk)?.[1]),
        city: clean(/<[^>]*property=["']addressLocality["'][^>]*>([\s\S]*?)<\/[^>]+>/i.exec(chunk)?.[1]),
        state: clean(/<[^>]*property=["']addressRegion["'][^>]*>([\s\S]*?)<\/[^>]+>/i.exec(chunk)?.[1]),
        zip: clean(/<[^>]*property=["']postalCode["'][^>]*>([\s\S]*?)<\/[^>]+>/i.exec(chunk)?.[1]),
        lat: Number.parseFloat(attr(opening, "data-location-lat")) || null,
        lon: Number.parseFloat(attr(opening, "data-location-lng")) || null,
        primary: i === 0,
      };
    }).filter((l) => l.locName || l.zip);

    records.push({ npi, name, spec, photo, profile, locations });
  }
  return { total, records };
}

const pageUrl = (page) => {
  const url = new URL(SOURCE);
  url.searchParams.set("sort_bef_combine", "provider_sort_name_ASC");
  url.searchParams.set("latlng[distance][from]", "-");
  if (page) url.searchParams.set("page", String(page));
  return url;
};

async function fetchPage(page, attempts = 4) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(pageUrl(page), {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-US,en;q=0.9",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134 Safari/537.36",
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const parsed = parseListingPage(html);
      if (!parsed.records.length) throw new Error("no provider cards found");
      return parsed;
    } catch (error) {
      last = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }
  }
  throw new Error(`page ${page + 1}: ${last?.message ?? last}`);
}

const locationKey = (l) => [l.locName, l.street, l.city, l.state, l.zip].map((v) => String(v ?? "").toLowerCase()).join("|");
function mergeRecords(rows) {
  const byNpi = new Map();
  for (const row of rows) {
    const previous = byNpi.get(row.npi);
    if (!previous) { byNpi.set(row.npi, { ...row, locations: [...row.locations] }); continue; }
    const seen = new Set(previous.locations.map(locationKey));
    for (const location of row.locations) {
      const key = locationKey(location);
      if (!seen.has(key)) { previous.locations.push(location); seen.add(key); }
    }
    if (!previous.photo && row.photo) previous.photo = row.photo;
    if (!previous.profile && row.profile) previous.profile = row.profile;
  }
  return [...byNpi.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function capture({ onProgress = () => {} } = {}) {
  const first = await fetchPage(0);
  const listedTotal = first.total ?? first.records.length;
  const perPage = first.records.length;
  const pages = Math.max(1, Math.ceil(listedTotal / perPage));
  const pageRows = new Array(pages);
  pageRows[0] = first.records;
  let next = 1, done = 1;

  async function worker() {
    while (next < pages) {
      const page = next++;
      pageRows[page] = (await fetchPage(page)).records;
      done += 1;
      onProgress({ done, pages });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages - 1) }, worker));
  const records = mergeRecords(pageRows.flat());
  return {
    fetchedAt: new Date().toISOString(),
    source: SOURCE,
    scope: "adventhealth-medical-group",
    listedTotal,
    pages,
    records,
  };
}

async function main() {
  const result = await capture({ onProgress: ({ done, pages }) => process.stdout.write(`  pages ${done}/${pages}\r`) });
  if (result.records.length < result.listedTotal * 0.98)
    throw new Error(`capture looks incomplete: ${result.records.length} unique records from ${result.listedTotal} listed results`);
  const located = result.records.filter((r) => r.locations.length).length;
  if (located < result.records.length * 0.9)
    throw new Error(`capture looks incomplete: only ${located} of ${result.records.length} records have a location`);
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(result));
  const photos = result.records.filter((r) => r.photo).length;
  const multi = result.records.filter((r) => r.locations.length > 1).length;
  console.log(`\nwrote ${OUTPUT}`);
  console.log(`  ${result.records.length.toLocaleString()} providers · ${photos.toLocaleString()} photos · ${multi.toLocaleString()} with multiple locations`);
}

if (typeof process !== "undefined" && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
