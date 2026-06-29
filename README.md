# Financial Runway Planner

A static browser-based financial planning simulator. The app estimates portfolio depletion risk by running Monte Carlo simulations from historical S&P 500 total returns, 3-month T-bill returns, and CPI inflation.

The planner lets you enter plan years, current net worth, beta mode, SPX beta, simulation count, annual income, and annual expenditures. It then shows:

- probability of running out of money before the expected year of death
- median final wealth in current dollars
- current SPX beta for the first plan year
- historical return span used by the model
- a depletion-year distribution
- simulated current-dollar net worth paths
- simulated SPX beta paths
- an on-demand dynamic-beta frontier comparing expected terminal wealth against run-out risk
- an Inspect Simulation view for one selected simulation's net worth path and annual return/cash-flow rows
- a scenario-level dynamic-beta policy view with per-beta alternatives, a visible wealth bucket plot, and a deterministic policy path explorer
- shareable links that restore the plan inputs and rerun the same seeded simulation paths

By default, the app starts with the current year, an expected year of death 60 years later, `$100,000` in current net worth, dynamic beta mode, `0.8` fixed-mode SPX beta, and `50,000` simulations.

## How It Works

The app is entirely client-side. `index.html` loads `styles.css`, the `js/` modules, `app.js`, and `data/spx-annual-returns.json`. There is no build step, package manager, server API, or database.

Fixed-beta and dynamic-beta simulations sample one historical year at a time with replacement. Dynamic beta chooses the beta for a simulation year before that year's sampled return is drawn. Portfolio nominal return is modeled as:

```text
T-bill return + SPX beta * (S&P 500 return - T-bill return)
```

The simulated portfolio return is converted into current-dollar real returns using that year's inflation observation. Income and expenditures are annual current-dollar cash flows.

Dynamic beta is the default mode. It builds a backward dynamic-programming policy over plan year and current wealth before running the simulation paths. The policy is global to the scenario, not to any one simulation path. It uses a zero bucket plus 180 log-spaced positive wealth buckets from `$10,000` to `$1 trillion`, searches beta values from `0.0` to `1.5` in `0.1` steps, chooses the beta with the lowest estimated depletion probability, then breaks ties by highest expected terminal wealth. After a dynamic run completes, the Dynamic Beta Frontier tab can run a separate risk/wealth frontier from scenario-calibrated risk-penalty policies; the frontier plots expected terminal wealth against run-out probability and shows each point's current recommended SPX beta on hover. Inspect Simulation rows and CSV exports include the SPX beta used each year. Dynamic runs also show the scenario-level minimum-risk policy in Inspect Beta Policy: per-beta alternatives for a selected wealth bucket, a hoverable visible wealth bucket plot that can show optimal SPX beta, estimated depletion risk, or expected terminal wealth, and a path explorer that forces one beta for a selected number of years under a selected return assumption. The policy CSV includes every evaluated year/bucket/beta combination and flags the recommended beta and whether the bucket is shown in the UI.

## Sharing Plans

Each successful run updates the browser address bar to a share URL containing the current plan inputs, beta mode, and the run's simulation seed in the `p` query parameter. The active tab is stored separately in the `tab` query parameter so refreshes and copied links reopen the same view. Click `Share` to copy that URL. Opening it restores the inputs and automatically reruns the seeded simulation, so the shared plan produces the same sampled paths without a backend or database.

## Run Locally

Serve the project root with any static HTTP server:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://127.0.0.1:8000/
```

Opening `index.html` directly may fail in some browsers because the app fetches `data/spx-annual-returns.json`.

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
