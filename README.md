# Financial Runway Planner

A static browser-based financial planning simulator. The app estimates portfolio depletion risk by running Monte Carlo simulations from historical S&P 500 total returns, 3-month T-bill returns, and CPI inflation.

The planner lets you enter plan years, current net worth, beta mode, SPY beta, simulation count, annual income, and annual expenditures. It then shows:

- probability of running out of money before the expected year of death
- median final wealth in current dollars
- current SPY beta for the first plan year
- historical return span used by the model
- a depletion-year distribution
- simulated current-dollar net worth paths
- simulated SPY beta paths
- an Inspect Simulation view for one selected simulation's net worth path and annual return/cash-flow rows
- a scenario-level dynamic-beta policy view with beta bands, visible wealth buckets, recommended beta, estimated depletion probability, and expected terminal wealth
- shareable links that restore the plan inputs and rerun the same seeded simulation paths

## How It Works

The app is entirely client-side. `index.html` loads `styles.css`, the `js/` modules, `app.js`, and `data/spy-annual-returns.json`. There is no build step, package manager, server API, or database.

Fixed-beta simulations sample contiguous 5-year historical return blocks with replacement. Dynamic-beta simulations sample one historical year at a time so the beta decision for a simulation year cannot inspect future sampled returns. Portfolio nominal return is modeled as:

```text
T-bill return + SPY beta * (S&P 500 return - T-bill return)
```

The simulated portfolio return is converted into current-dollar real returns using that year's inflation observation. Income and expenditures are annual current-dollar cash flows.

Dynamic beta is the default mode. It builds a backward dynamic-programming policy over plan year and current wealth before running the simulation paths. The policy is global to the scenario, not to any one simulation path. It uses a zero bucket plus 180 log-spaced positive wealth buckets from `$10,000` to `$1 trillion`, searches beta values from `0.0` to `1.5` in `0.1` steps, chooses the beta with the lowest estimated depletion probability, then breaks ties by highest expected terminal wealth. Inspect Simulation rows and CSV exports include the SPY beta used each year. Dynamic runs also show the scenario-level policy in Inspect Beta Policy: beta bands and visible wealth buckets through `$1 billion`. The policy CSV includes the full internal grid and flags whether each row is shown in the UI.

## Sharing Plans

Click `Share` to copy a URL containing the current plan inputs, beta mode, and a simulation seed in the `p` query parameter. Opening that link restores the inputs and automatically reruns the seeded simulation, so the shared plan produces the same sampled paths without a backend or database.

## Run Locally

Serve the project root with any static HTTP server:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/
```

Opening `index.html` directly may fail in some browsers because the app fetches `data/spy-annual-returns.json`.

## Hosting

This can be hosted on GitHub Pages because it is a static site.

Use the repository's Pages settings and deploy from the root of the publishing branch. This repo currently uses `master`. If the repository is `hmku/planner`, the public URL will usually be:

```text
https://hmku.github.io/planner/
```

## Future TODOs

- Support flexible versus crucial expenditures.
- Add spending guardrail logic: when projected wealth is running low, automatically reduce flexible expenditures and preserve only crucial expenditures.
- Add richer tax/account modeling, including taxable, tax-deferred, and Roth accounts.
- Add automated browser smoke tests for default load, running a simulation, switching tabs, changing inspected simulation, and downloading CSV.
