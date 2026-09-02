# Provider Map Extraction Scripts

This folder contains the source-only extraction code used for the Provider Map. It includes no captured provider records, generated map data, logs, Git history, private credentials, or account tokens.

## Included approaches

- `scripts/capture-ah-directory.mjs` — reads AdventHealth's public, server-rendered Medical Group directory pages. Each listing card supplies the provider profile, photo, specialty, and every published practice location.
- `src/sources/directory.js` — queries the same public, search-only Algolia index used by Orlando Health's physician-finder website. It keeps Orlando Health-employed clinicians and their published Florida locations.
- `src/sources/ah-directory.js` — converts the AdventHealth capture into the shared provider/location format.
- `src/specialty.js` — shared specialty normalization required by both source modules.

## Requirements

- Node.js 20 or newer
- Internet access to the two public provider directories
- No third-party npm packages

## Run

Open a terminal in this folder and run:

```text
npm run adventhealth
npm run orlando-health
```

The scripts create these files locally:

```text
data/raw/ah-directory-scrape.json
data/raw/oh-directory.json
```

Those output files are intentionally not included in this share package.

## Source notes

The Orlando Health script contains the public search-only application ID and key that its physician-finder page sends to visitors. It is not a private account credential, but Orlando Health may rotate it. If the request fails with an authorization error, inspect the physician-finder page's current public network request and update the application ID or search-only key.

Both scripts are read-only and collect publicly published provider-directory information. They do not log in, book appointments, or modify either health system.
