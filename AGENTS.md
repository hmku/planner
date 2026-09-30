# Agent Notes

## Project Shape

This is a dependency-free static web app:

- `index.html` contains the full DOM structure.
- `styles.css` contains all layout and visual styling.
- `js/` contains shared runtime modules attached to the global `Planner` namespace.
- `app.js` bootstraps the app: state, DOM wiring, inputs, and run orchestration.
- `data/spx-annual-returns.json` is fetched at runtime and must be served over HTTP.

There is no package manager, build pipeline, framework, backend, or test runner in the repo.

### JavaScript modules (load order matters)

1. `js/constants.js` — limits, defaults, beta-mode constants
2. `js/util.js` — CSV export (chunked, accepts generators), select/table helpers, math, nice axis ticks, canvas sizing
3. `js/format.js` — display formatting and money/integer inputs
4. `js/ui-shell.js` — shared section-header templates (`mountSectionHeaders`)
5. `js/simulation.js` — Monte Carlo engine, per-simulation row replay (`getSimulationYearRows`), and dynamic-beta policy
6. `js/charts.js` — canvas charts, theme tokens, and a shared hover system (`CHARTS` registry, `bindChartHover`, `renderChart(key)`)
7. `js/results.js` — metrics, inspection tables, policy views, CSV downloads, tab switching
8. `js/share.js` — share-link encode/decode
9. `app.js` — `Planner.state`, `Planner.els`, form inputs, `runSimulation()`

Each module exports only what other modules use. Prefer extending shared helpers (`populateSelect`, `renderTableBody`, `downloadCsvFile`, and the chart primitives in `charts.js` such as `beginChart`, `drawYAxis`, `drawXAxis`, `drawLegend`, `drawTooltip`) instead of copying UI or chart logic.

## Main Runtime Flow

On `DOMContentLoaded`, `app.js` mounts shared section headers, caches DOM elements, sets default inputs, binds events, resets Details controls, loads market data, and marks the app dirty.

The simulation path is:

1. `runSimulation()`
2. `readScenario()`
3. `simulateScenario()`
4. `renderResults()`
5. `renderSimulationSelect()`, `renderSimulationPathTable()`, `renderDynamicPolicyControls()`, and `renderCharts()`

`renderCharts(results)` draws every chart registered in `CHARTS` for the active page; `renderChart(key)` redraws one. Chart render functions take only `results` and read any control values from `Planner.els`.

The Simulation tab (`details` page id) uses the `detail` chart and `renderSimulationPathTable()`. The `#simulationSelect` dropdown controls both the selected net worth plot and the annual rows table.

## Important Implementation Details

- Default inputs are set in `setDefaults()`.
- SPX beta currently defaults to `0.8`.
- Share links use the `p` query parameter to store compact current plan inputs plus a seeded simulation value; shared links restore inputs and auto-run after market data loads.
- Runs store only `sampledRowIndexes` (one historical-row index per simulation-year). `getSimulationYearRows(results, simulation)` replays a simulation's annual rows deterministically; keep its arithmetic in lockstep with `simulateScenario()`.
- Keep the random-number call order in `simulateScenario()` stable (one draw per active year, then the reservoir draw); share links depend on it.
- Colors live in CSS custom properties; canvas code reads `--chart-*` tokens through `chartTheme()`. Do not hardcode colors in JS.
- Status and validation messages go to `#runStatus` via `Planner.setStatus(text, tone)`.
- Result panels share one section shell: add `data-section-header` on a `.card.content-section`, optionally `data-summary-id`, `data-summary-text`, `data-picker-id`, `data-picker-label`, `data-download-id`, and `data-download-label`. Custom toolbar controls go in a `[data-section-toolbar]` slot. `mountSectionHeaders()` builds every header from `#sectionHeaderTemplate` on load; the toolbar holds slot content, then the picker, then the CSV button.
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
- Switch to Simulation.
- The simulation dropdown, CSV button, selected simulation chart, and annual rows table are in one visual section.
- Changing the selected simulation updates both the chart and table.
- CSV download creates simulation-year rows for the sampled inspection paths (up to 200 paths × plan years).
- Switch to Methodology and back to verify tab state still renders.
- Check dark mode (OS preference) and a ~390px-wide viewport.

Command-line checks available in the current environment:

```bash
curl -I http://127.0.0.1:8000/
for f in js/*.js app.js; do node --check "$f"; done
git diff --stat
```

Some environments have Playwright and Chromium available (for example `NODE_PATH=$(npm root -g)` with a global `playwright`), which lets you script the smoke test headlessly.

## Cursor Cloud specific instructions

This repo has no package manager or build step — nothing to install beyond Python 3 and Node.js (Node is only used for `node --check` syntax validation).

### Running the app

Serve the project root over HTTP (required so `data/spx-annual-returns.json` can be fetched):

```bash
python3 -m http.server 8000
```

Open `http://127.0.0.1:8000/`. The **Run** button stays disabled until market data loads; once enabled, click **Run** to exercise the core Monte Carlo flow.

### Lint / syntax checks

There is no ESLint config. Use:

```bash
for f in js/*.js app.js; do node --check "$f"; done
```

### Browser testing

Cloud agents can run the manual smoke test via the `computerUse` subagent against `http://127.0.0.1:8000/`. Default runs use 50,000 simulations and take a few seconds while the progress bar advances.

### Gotchas

- Opening `index.html` via `file://` fails because the market-data JSON fetch requires HTTP.
- Start the HTTP server from the repository root, not from a subdirectory.
