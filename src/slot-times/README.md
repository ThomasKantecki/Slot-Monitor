# Slot Times development area

This folder owns the Slot Times view. Work here can proceed independently from
the Provider Map in `src/render.js`.

- Edit `render.js` to build the Slot Times page.
- Keep the main mount point `#slot-times-root` so future code has a stable home.
- Reuse the shared switcher from `../shared/suite-navigation.js`.
- Run `npm run build:slot-times` while developing, then `npm test` before a pull
  request.
- Commit the generated `public/slot-times.html` with source changes.

Only change `src/shared/suite-navigation.js` when both views need the same
navigation update.
