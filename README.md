# MediPath – indoor hospital navigation (HTML / CSS / vanilla JS)

Run (Windows, VS Code): open the `medipath` folder → install the **Live Server** extension → right-click `index.html` → **Open with Live Server**.
No build step, no backend, no GPS / QR / Bluetooth / Wi-Fi positioning.

- `index.html`, `style.css`, `script.js` – interface (cream/green theme from the reference), map rendering, screens
- `data/map-data.js` – nodes, corridor edges, **rooms/hospital names**, stair links, config (hospital name, distance scale)
- `data/engine.js` – Dijkstra routing, route validation, step-by-step directions
- `data/map-geometry.js` – GENERATED from your two floor-plan PNGs (corridor + room rectangles)
- `assets/maps/` – your original PNGs + generated `*-styled.svg` maps (same coordinates)
- `tools-gen-maps.js` – regenerates the styled maps after you rename rooms: `node tools-gen-maps.js`
- `tests/run-tests.js` – `node tests/run-tests.js` (every edge, all room pairs, stairs routing)
- `tests/ui-test.js` – browser test (needs Playwright + Chromium)

Rename a room: edit its `R('id', 'Name', …)` line in `data/map-data.js`, then run `node tools-gen-maps.js`.
Add `?debug` to the URL (or press Shift+D) to draw every node and edge over the map.
