# Agent Notes

## Project Shape

This is a dependency-free static web app:

- `index.html` contains the full DOM structure.
- `styles.css` contains all layout and visual styling.
- `app.js` contains all state, input handling, simulation logic, chart drawing, CSV export, and formatting.
- `data/spy-annual-returns.json` is fetched at runtime and must be served over HTTP.

There is no package manager, build pipeline, framework, backend, or test runner in the repo.

## Main Runtime Flow

On `DOMContentLoaded`, `app.js` caches DOM elements, sets default inputs, binds events, resets Details controls, loads market data, and marks the app dirty.

The simulation path is:

1. `runSimulation()`
2. `readScenario()`
3. `simulateScenario()`
4. `renderResults()`
5. `renderSimulationSelect()`, `renderSimulationPathTable()`, and `renderCharts()`

The Overview tab uses `renderDistributionChart()` and `renderNetWorthChart()`.

The Details tab uses `renderSelectedSimulationChart()` and `renderSimulationPathTable()`. The `#simulationSelect` dropdown controls both the selected net worth plot and the annual rows table.

## Important Implementation Details

- Default inputs are set in `setDefaults()`.
- SPY beta currently defaults to `0.8`.
- Share links use the `p` query parameter to store compact current plan inputs plus a seeded simulation value; shared links restore inputs and auto-run after market data loads.
- Simulation rows are stored in `simulationYearRowsBySimulation` so the Details tab can inspect one simulation without recomputing.
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
- Default SPY beta is `0.8`.
- Click `Run`; progress appears and results render.
- Top metric values stay inside their cards, including large median wealth values.
- Overview charts render and resize correctly.
- Click `Share`; the copied URL restores the same inputs and reruns with the seeded paths.
- Switch to Details.
- The simulation dropdown, CSV button, selected simulation chart, and annual rows table are in one visual section.
- Changing the selected simulation updates both the chart and table.
- `Download CSV` creates a CSV with simulation-year rows.
- Switch to Methodology and back to verify tab state still renders.

Command-line checks available in the current environment:

```bash
curl -I http://127.0.0.1:8000/
git diff --stat
```

At the time this file was written, the environment did not have `node`, `deno`, `bun`, or a headless Chrome binary installed, so JavaScript syntax and browser smoke tests had to be manual.
