# Agent Notes

## Project Shape

This is a dependency-free static web app:

- `index.html` contains the full DOM structure.
- `styles.css` contains all layout and visual styling.
- `js/` contains shared runtime modules attached to the global `Planner` namespace.
- `app.js` bootstraps the app: state, DOM wiring, inputs, and run orchestration.
- `data/spx-annual-returns.json` is fetched at runtime and must be served over HTTP.
- `manifest.webmanifest`, `icons/` (rendered from `icons/icon.svg`), and `sw.js` make the app an installable PWA that works offline.
- `TODO.md` holds open items and a log of shipped work.
- `tests/unit.js` (plain Node) and `tests/smoke.js` (Playwright, serves the repo itself) are the automated checks.

There is no package manager, build pipeline, framework, or backend.

### JavaScript modules (load order matters)

1. `js/constants.js` — limits, defaults, beta-mode constants
2. `js/util.js` — CSV export (chunked, accepts generators), select/table helpers, math, nice axis ticks, canvas sizing
3. `js/format.js` — display formatting and money/integer inputs
4. `js/ui-shell.js` — shared section-header templates (`mountSectionHeaders`)
5. `js/lifestyle.js` — lifestyle builder prices/options and the pure generator (`buildLifestyleItems`, `normalizeLifestyle`), plus `SPENDING_CATEGORIES`
6. `js/engine.js` — engine core: return math, growth-factor cache, cash flows (`buildPlanCashFlows`: owned and after-sale), the one-year path step with the home sale (`stepPathYear`), wealth buckets
7. `js/policy.js` — dynamic-beta solver (`solvePolicyLayer` solves several objectives in one backward sweep; `buildDynamicBetaPolicy` solves an after-sale layer, then the owned layer with the sale fallback) producing the candidate policies (frontier points with their tables), `selectDynamicBeta(policy, year, wealth, sold)`, and `createActionEvaluator()` (per-beta alternatives at one node, computed on demand for the Beta Policy tab and CSV in lockstep with the solver)
8. `js/simulation.js` — Monte Carlo runs, per-simulation row replay (`getSimulationYearRows`), required net worth (`buildRequiredWealth`, `riskAtWealth`, `requiredWealthForRisk`), and the frontier simulation and run-policy choice (`simulateFrontier`, `choosePolicy`), all stepping paths through one `createPathStepper()`. `js/simulation-worker.js` runs `simulateScenario()` in a Web Worker by loading modules 1–3 and 6–8.
9. `js/charts.js` — canvas charts, theme tokens, and a shared hover system (`CHARTS` registry, `bindChartHover`, `renderChart(key)`); see Chart conventions below
10. `js/results.js` — metrics, inspection tables, policy views, Spending view (`renderSpendingView`, `getSpendingModel`), CSV downloads, tab switching
11. `js/share.js` — share-link encode/decode (v2 compressed plan state; v1 decode only), address-bar sync
12. `js/plan-store.js` — plan-state snapshot/apply/normalize, localStorage draft autosave and named saved plans
13. `js/lifestyle-ui.js` — lifestyle builder form binding, kid rows, editable line items
14. `app.js` — `Planner.state`, `Planner.els`, form inputs, `runSimulation()`

Each module exports only what other modules use. Prefer extending shared helpers (`populateSelect`, `renderTableBody`, `downloadCsvFile`, and the chart helpers in `charts.js`) instead of copying UI or chart logic.

### Chart conventions

- Register a chart in `CHARTS` with its canvas, page, hover finder, and optional `padding` overrides or `xTitle: true` (adds bottom room). `renderChart()` builds the frame with the standard `CHART_PADDING`; render functions have the signature `render(data, frame)` and never create frames themselves.
- Register hover targets with `trackHover(frame, items)` (items need a stable `key`) or `trackHoverLookup(frame, fn)` for heatmaps; both return the current hover.
- Legends are HTML lists above the canvas: call `drawLegend(frame, items)` with `{ label, color, shape: "line" | "dot" | "square" | "ramp" }`; never draw legends on the canvas. Single-series charts get no legend.
- Reuse the shared pieces: `drawYearAxis`/`yearScale`, `logAxisTicks`/`spaceTicks` (labels never closer than ~52px horizontally, ~22px vertically), `barLayout`, `drawSamplePaths`, `drawHoverPoint` (crosshair + dot + tooltip), `drawReferenceLine`, `drawLabel` (chart text is always ink, never a series color).
- Color roles: `series` main data, `seriesStrong` average/expected and "You", `highlight` selected/hovered/target points, `critical` where a path depletes, `positive` not depleted, `categorical` spending categories in fixed order.
- Wording: "Run-out risk" for depletion probability everywhere in the UI (CSV column names stay as they are); "Ending wealth" for one path, "Expected terminal wealth" for the average.

### UI conventions

- Every number shown in the UI goes through `js/format.js`. Money is always compact via `Planner.formatMoney` ($2.1M, $850K, $450), in text, tables, tooltips, and axes; there is no full-dollar display formatter. Only editable money inputs show full dollars, and CSVs keep raw numbers. Use `formatPercent`/`formatPolicyRiskPercent`, `formatBeta`, `formatNumber`, `formatSeconds` for the rest; `tests/unit.js` fails if other code builds number formats (`Intl.NumberFormat`, `toLocaleString`, `toFixed` outside `Number(...)`), hand-formats a percent, or writes a literal amount like `$10,000` or `$80k`.

- Icon-only buttons use `.icon-button` (add `.icon-button-danger` for remove/delete; `.remove-row` is the JS hook for row removal).
- Compact controls (cash-flow rows, pickers, kid rows, line items) share one CSS rule and the `--control-font-sm` token, which becomes 16px on touch screens so focusing a field never zooms.

## Main Runtime Flow

On `DOMContentLoaded`, `app.js` mounts shared section headers, caches DOM elements, sets default inputs, binds events, resets Details controls, loads market data, and marks the app dirty.

The simulation path is:

1. `runSimulation()`
2. `readScenario()`
3. `runSimulationJob()` → `simulateScenario()` in `js/simulation-worker.js` (inline fallback when workers are unavailable; Stop terminates the worker)
4. `renderResults()`
5. `renderSimulationSelect()`, `renderSimulationPathTable()`, `renderDynamicPolicyControls()`, and `renderCharts()`

`renderCharts(results)` draws every chart registered in `CHARTS` for the active page; `renderChart(key)` redraws one. Chart render functions take only `results` and read any control values from `Planner.els`. A chart with `fromInputs: true` (the Spending chart) instead takes `Planner.getSpendingModel()`, which is built from the current inputs and renders before any run.

Input edits go through `handleFormEdit()` in `app.js`: it updates `Planner.state.lifestyle` (the builder's source of truth, bound by `data-ls` paths), calls `refreshLifestyle()` (line items, section totals, Spending view), marks results dirty, and calls `noteUserEdit()` (debounced draft autosave and address-bar sync). `readScenario()` merges lifestyle lines (`lifestyleItemsToFlows`) with manual rows; every expense flow carries a `category`.

The Overview shows, in order: net worth, dynamic beta frontier, SPX beta over time, depletion year distribution. The frontier is computed as part of every dynamic run (no separate button). The Simulation tab (`details` page id) uses the `detail` chart and `renderSimulationPathTable()`. The `#simulationSelect` dropdown controls both the selected net worth plot and the annual rows table.

## Important Implementation Details

- Default inputs are set in `setDefaults()`.
- SPX beta currently defaults to `0.8`.
- Share links use the `p` query parameter to store the full plan state (`getPlanState()`) as compressed JSON plus an optional seed; links with a seed restore inputs and auto-run after market data loads. Saved plans, the draft, and share links all pass through `normalizePlanState()` because they are untrusted; extend it (and `normalizeLifestyle()`) whenever plan state gains a field.
- On load, a `p` link wins over the localStorage draft; with neither, defaults are used.
- Results cross the worker boundary by structured clone, so keep them plain data (no functions); `returnRows` is reattached on the page.
- The policy solver's hot loop pools each node's return rows into the few buckets they land in; check changes there for agreement with the previous version (policies, frontier, and simulated paths) and time them.
- An owned home sells (once) at the start of the year a path would run out (`stepPathYear`). The policy solver models the same rule with two layers (after-sale, then owned), so a run, the replay, required net worth, and the solver must all use `stepPathYear`/`createPathStepper` semantics; a plan without a home must stay bit-identical to the one-layer solve.
- Required net worth comes from per-path survival thresholds over 20,000 extra paths, not from the policy solver's value table, which overstates risk between wealth buckets.
- Owned homes: `buildHomeModel()` (lifestyle) gives the engine `scenario.home` (value and mortgage balance by year). Every engine path that follows simulated years (main run, `getSimulationYearRows`, required net worth) advances a year with `stepPathYear()` over `buildPathCashFlows()`, which sells the home once when the portfolio would run out; keep them on that one function. Lines tagged `homeCost` stop after a sale; lines with `deflateRate` (mortgages) shrink with inflation via `flowAmountForYear()` (in `util.js` so the worker has it).
- Runs store only `sampledRowIndexes` (one historical-row index per simulation-year). `getSimulationYearRows(results, simulation)` replays a simulation's annual rows deterministically; keep its arithmetic in lockstep with `simulateScenario()`.
- Keep the random-number call order in `simulateScenario()` stable (the 20,000 extra paths first, then one draw per active year and the reservoir draw); share links depend on it.
- The run's dynamic policy is chosen by simulation, not by the solver: every frontier candidate is simulated on the first 10,000 extra paths and `choosePolicy()` takes the highest median terminal wealth among those with run-out risk at most max(`ACCEPTABLE_RUN_OUT_RISK`, the lowest candidate risk). The Beta Policy tab, policy CSV, and How much you need all show that chosen policy.
- Colors live in CSS custom properties; canvas code reads `--chart-*` tokens through `chartTheme()`. Do not hardcode colors in JS.
- Status and validation messages go to `#runStatus` via `Planner.setStatus(text, tone)`.
- Result panels share one section shell: add `data-section-header` on a `.card.content-section`, optionally `data-summary-id`, `data-summary-text`, `data-picker-id`, `data-picker-label`, `data-download-id`, and `data-download-label`. Custom toolbar controls go in a `[data-section-toolbar]` slot. `mountSectionHeaders()` builds every header from `#sectionHeaderTemplate` on load; the toolbar holds slot content, then the picker, then the CSV button.
- Canvas charts use `fitCanvas()` to handle device-pixel-ratio scaling.
- The app uses current-dollar values throughout the UI.
- The Details dropdown only lists downsampled inspection paths, not every simulation.
- Lifestyle builder prices and options live in `js/lifestyle.js`; keep README's Lifestyle Builder section in sync when they change. The Methodology tab's assumptions tables (`renderLifestyleAssumptions()` in `js/lifestyle-ui.js`) read those constants directly; when you add a priced option or rule, add it there too.
- `sw.js` precaches the app shell for offline use. When `index.html` gains or loses a script, stylesheet, data file, or icon, update `APP_SHELL` and bump `CACHE_VERSION`. Fetches are network-first, so ordinary code edits need no version bump.
- Keep edits scoped; this repo often has user changes in progress.

## Workflow

- After making changes, update `README.md` when behavior or workflows change.
- Update `TODO.md` in the same change: add follow-ups and ideas that come up (including ones the user mentions in passing), and move shipped items to Done, newest first.
- Commit and push completed work straight to `master` (no feature branches or PRs) unless the user says otherwise. Pushing `master` deploys the live site (Vercel), so run the checks below before pushing.

## Testing Checklist

Run the app with:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/
```

Automated checks (run both before pushing):

```bash
node tests/unit.js
NODE_PATH=$(npm root -g) node tests/smoke.js
```

`tests/smoke.js` covers the manual list below; extend it when you add behavior. Manual smoke test:

- Page loads without console errors.
- Default SPX beta is `0.8`.
- Click `Run`; progress appears and results render.
- Top metric values stay inside their cards, including large median wealth values.
- Overview charts render and resize correctly.
- Click `Share`; the copied URL restores the same inputs (including the lifestyle builder) and reruns with the seeded paths.
- Lifestyle builder: add kids, switch housing modes, override a line amount (reset appears), move a line to manual rows; section totals and the Spending tab update live.
- `Save` a named plan, edit, reload (inputs persist), reopen the saved plan from the menu, and open the bare URL to restore the draft.
- Switch to Simulation.
- The simulation dropdown, CSV button, selected simulation chart, and annual rows table are in one visual section.
- Changing the selected simulation updates both the chart and table.
- CSV download creates simulation-year rows for the sampled inspection paths (up to 200 paths × plan years).
- Switch to Methodology and back to verify tab state still renders.
- Check dark mode (OS preference) and a ~390px-wide viewport.
- PWA: after one online load, go offline and reload; the app still loads and runs.

Command-line checks available in the current environment:

```bash
curl -I http://127.0.0.1:8000/
for f in js/*.js app.js sw.js tests/*.js; do node --check "$f"; done
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
for f in js/*.js app.js sw.js tests/*.js; do node --check "$f"; done
```

### Browser testing

Cloud agents can run the manual smoke test via the `computerUse` subagent against `http://127.0.0.1:8000/`. Default runs use 10,000 simulations and take a couple of seconds while the progress bar advances.

### Gotchas

- Opening `index.html` via `file://` fails because the market-data JSON fetch requires HTTP.
- Start the HTTP server from the repository root, not from a subdirectory.
