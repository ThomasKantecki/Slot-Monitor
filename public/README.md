# public/

The built site, exactly what GitHub Pages publishes. Never edit anything here by hand: change the source
under `pages/` or the data and run `npm run build`.

Cardiology's three pages sit at the root (`index.html`, `market-opportunities.html`, `provider-map.html`);
every other specialty has the same three under its own folder. `data/<specialty>/` holds the published
summary and one JSON file per day of appointment slots, which the slot pages fetch as you change the dates.
`slot-times.html` only forwards an old address to `index.html`.
