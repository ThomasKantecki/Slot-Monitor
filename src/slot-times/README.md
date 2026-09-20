# Slot Availability

The main page: how many appointments in the page's specialty AdventHealth and
Orlando Health have open, by ZIP or county, over a chosen period.

- `data.js` turns the scraper's export into the compact slot model.
- `render.js` builds the page for one specialty (`--specialty <id>`, cardiology when absent) from the markup, `styles.css` and `client.js`: `public/index.html` for Cardiology, `public/<id>/index.html` for the others, each reading `public/data/<id>/`.
- `client.js` is the browser code: filters, map, summary card, calendar, provider list.
- `partition-loader.js` fetches the per-day slot files the page needs for the selected dates.
- `radius.js` is the distance helper for the radius ring.

Filters (`src/slot-rules.js`) narrow both systems the same way: physicians only,
in-person only, new patients only. The landing view is the next 90 days.
