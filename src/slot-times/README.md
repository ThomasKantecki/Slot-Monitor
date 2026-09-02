# Cardiology Slot Availability

This folder owns the default Cardiology Slot Availability view. It is built
independently from Provider Index in `src/render.js` and shares only the
top navigation and visual language.

- `data.js` deduplicates physical appointments and creates the compact browser
  model.
- `render.js` projects the existing Slot Monitor ZIP/county geometry and emits
  the self-contained HTML.
- `client.js` owns filters, map interaction, calendar, locations, and provider
  cards; `styles.css` owns responsive presentation.
- Reuse the shared switcher from `../shared/suite-navigation.js`.
- Run `npm run build:slot-times` while developing, then `npm test` before a pull
  request.
- The build writes both `public/index.html` (landing page) and
  `public/slot-times.html` (backward-compatible alias).
- The v3 ZIP-radius workflow opens around ZIP `32804` at 140 miles; searching a
  ZIP resets the center to that ZIP and the radius to 50 miles. It uses the
  local Census ZCTA points in `data/geography` and applies the scope to KPIs,
  map coloring, locations, calendar counts, and provider slots. Selecting a map
  area switches to area scope; **All FL** clears radius scope; **Reset** restores
  the 32804/140-mile landing state.
- The initial and Reset date endpoint is the earlier of the two systems' latest
  dates, providing a common comparison horizon. The full source horizon remains
  selectable in the Through control for system-specific investigation.
- The v3 investigation workflow is also retained: location search, clickable
  location cards and map markers, a provider/slot dialog with expandable slot
  chips, expandable provider cards, and a searchable detailed appointment
  table. All of these intersect the same area/radius, system, and date scope.

Only change `src/shared/suite-navigation.js` when both views need the same
navigation update.
