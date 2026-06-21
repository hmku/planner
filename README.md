# Financial Runway Planner

A static browser-based financial planning simulator. The app estimates portfolio depletion risk by running Monte Carlo simulations built from historical 5-year blocks of S&P 500 total returns, 3-month T-bill returns, and CPI inflation.

The planner lets you enter plan years, current net worth, SPY beta, simulation count, annual income, and annual expenditures. It then shows:

- probability of running out of money before the expected year of death
- median final wealth in current dollars
- historical return span used by the model
- a depletion-year distribution
- simulated current-dollar net worth paths
- a Details view for inspecting one selected simulation's net worth path and annual return/cash-flow rows
- shareable links that restore the plan inputs and rerun the same seeded simulation paths

## How It Works

The app is entirely client-side. `index.html` loads `styles.css`, `app.js`, and `data/spy-annual-returns.json`. There is no build step, package manager, server API, or database.

Each simulation samples contiguous 5-year historical return blocks with replacement. Portfolio nominal return is modeled as:

```text
T-bill return + SPY beta * (S&P 500 return - T-bill return)
```

The simulated portfolio return is converted into current-dollar real returns using that year's inflation observation. Income and expenditures are annual current-dollar cash flows.

## Sharing Plans

Click `Share` to copy a URL containing the current plan inputs and a simulation seed in the `p` query parameter. Opening that link restores the inputs and automatically reruns the seeded simulation, so the shared plan produces the same sampled paths without a backend or database.

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
- Add optimization logic that searches over SPY beta choices and selects the beta that minimizes probability of depletion for the entered income and expenditure plan.
- Add richer tax/account modeling, including taxable, tax-deferred, and Roth accounts.
- Add automated browser smoke tests for default load, running a simulation, switching tabs, changing inspected simulation, and downloading CSV.
