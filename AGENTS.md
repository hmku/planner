# Agent Notes

## Project Shape

This is a dependency-free static web app:

- `index.html` contains the full DOM structure.
- `styles.css` contains all layout and visual styling.
- `js/` contains shared runtime modules attached to the global `Planner` namespace.
- `app.js` bootstraps the app: state, DOM wiring, inputs, and run orchestration.
- `data/spx-annual-returns.json` and `data/spx-annual-implied-vol.json` are fetched at runtime and must be served over HTTP.

There is no package manager, build pipeline, framework, backend, or test runner in the repo.

### JavaScript modules (load order matters)

1. `js/constants.js` — limits, defaults, beta-mode and hedge constants
2. `js/util.js` — CSV export, select/table helpers, math, canvas sizing, chart geometry
3. `js/format.js` — display formatting and money/integer inputs
4. `js/ui-shell.js` — shared section-header templates (`mountSectionHeaders`)
5. `js/options.js` — Black–Scholes puts, normalized SPX smirk, hedge year transitions
6. `js/simulation.js` — Monte Carlo engine and dynamic beta/coverage policy
7. `js/charts.js` — canvas charts and hover handling
8. `js/results.js` — metrics, inspection tables, CSV downloads, tab switching
9. `js/share.js` — share-link encode/decode
10. `app.js` — `Planner.state`, `Planner.els`, form inputs, `runSimulation()`

Prefer extending shared helpers (`populateSelect`, `renderTableBody`, `downloadCsvFile`, `drawDownsampledPaths`, etc.) instead of copying UI or chart logic into a single file.

## Main Runtime Flow

On `DOMContentLoaded`, `app.js` mounts shared section headers, caches DOM elements, sets default inputs, binds events, resets Details controls, loads market data, and marks the app dirty.

The simulation path is:

1. `runSimulation()`
2. `readScenario()`
3. `simulateScenario()`
4. `renderResults()`
5. `renderSimulationSelect()`, `renderSimulationPathTable()`, and `renderCharts()`

The Overview tab uses `renderDistributionChart()`, `renderNetWorthChart()`, `renderBetaChart()`, and `renderHedgeCoverageChart()` when hedging is enabled.

The Details tab uses `renderSelectedSimulationChart()` and `renderSimulationPathTable()`. The `#simulationSelect` dropdown controls both the selected net worth plot and the annual rows table.

## Important Implementation Details

- Default inputs are set in `setDefaults()`.
- SPX beta currently defaults to `0.8`.
- Downside protection defaults to off. When enabled, put strike distance defaults to `20%` below SPX and coverage is optimized from `0%` to `100%` in `10%` steps.
- Share links use the `p` query parameter to store compact current plan inputs plus a seeded simulation value; shared links restore inputs and auto-run after market data loads. Older links without hedge fields restore with hedging disabled.
- Simulation rows are stored in `simulationYearRowsBySimulation` so the Details tab can inspect one simulation without recomputing.
- Result panels share one section shell: add `data-section-header` on a `.content-section`, optionally `data-summary-id`, `data-summary-text`, `data-picker-id`, `data-picker-label`, `data-download-id`, and `data-download-label`. Custom toolbar controls go in a `[data-section-toolbar]` slot. `mountSectionHeaders()` builds every header from `#sectionHeaderTemplate` on load.
- Canvas charts use `fitCanvas()` to handle device-pixel-ratio scaling.
- The app uses current-dollar values throughout the UI.
- The Details dropdown only lists downsampled inspection paths, not every simulation.
- Keep edits scoped; this repo often has user changes in progress.
- After making changes, update `README.md` when behavior or workflows change, then commit and push the completed work unless the user says not to.

## Testing Checklist

Run the app with:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/
```

Manual smoke test:

- Page loads without console errors.
- Default SPX beta is `0.8`.
- Click `Run`; progress appears and results render.
- Top metric values stay inside their cards, including large median wealth values.
- Overview charts render and resize correctly.
- Click `Share`; the copied URL restores the same inputs and reruns with the seeded paths.
- Enable Downside protection, set a strike distance, and run again; coverage paths and put columns appear.
- Switch to Details.
- The simulation dropdown, CSV button, selected simulation chart, and annual rows table are in one visual section.
- Changing the selected simulation updates both the chart and table.
- CSV download creates simulation-year rows, including hedge fields when enabled.
- Switch to Methodology and back to verify tab state still renders.

Command-line checks available in the current environment:

```bash
curl -I http://127.0.0.1:8000/
for f in js/*.js app.js; do node --check "$f"; done
git diff --stat
```

At the time this file was written, the environment did not have a headless Chrome binary installed, so browser smoke tests had to be manual.

## Cursor Cloud specific instructions

This repo has no package manager or build step — nothing to install beyond Python 3 and Node.js (Node is only used for `node --check` syntax validation).

### Running the app

Serve the project root over HTTP (required so market-data JSON can be fetched):

```bash
python3 -m http.server 8000
```

Open `http://127.0.0.1:8000/`. The **Run** button stays disabled until market data loads; once enabled, click **Run** to exercise the core Monte Carlo flow. Hedged dynamic runs expand the policy action grid substantially, so the first **Run** may take longer than an unhedged run.

### Lint / syntax checks

There is no ESLint config. Use:

```bash
for f in js/*.js app.js; do node --check "$f"; done
```

### Browser testing

Cloud agents can run the manual smoke test via the `computerUse` subagent against `http://127.0.0.1:8000/`. Default runs use 50,000 simulations, so the first **Run** may take several seconds while the progress bar advances.

### Gotchas

- Opening `index.html` via `file://` fails because the market-data JSON fetch requires HTTP.
- Google Fonts load from CDN; offline environments may fall back to system fonts without breaking functionality.
- Start the HTTP server from the repository root, not from a subdirectory.
