# Financial Runway Planner

A static browser-based financial planning simulator built around dynamic SPX-beta optimization. Rather than assuming one allocation throughout a plan, it uses backward dynamic programming to build candidate SPX-beta policies (a beta for each year and wealth level), simulates each, and runs the one with the most median terminal wealth among those whose run-out risk is at most 0.5% or the lowest any candidate reaches. Its Monte Carlo simulations draw from historical S&P 500 total returns, 3-month T-bill returns, and CPI inflation.

The planner lets you enter plan years, current net worth, beta mode, SPX beta, simulation count, and annual income, then describe spending with a lifestyle builder instead of computing every expense by hand (manual expenditure rows are still available for anything else). It then shows:

- probability of running out of money before the expected year of death
- the starting net worth needed for a 1% run-out risk, and a How much you need chart (third on the Overview) marking the net worth needed for 10%, 5%, 1%, and 0.1% risk
- expected (mean) terminal wealth in current dollars, with the median alongside
- current SPX beta for the first plan year
- historical return span used by the model
- an Overview with, in order: simulated current-dollar net worth paths, the dynamic-beta frontier comparing expected and median terminal wealth against run-out risk, simulated SPX beta paths, and a depletion-year distribution (hover a bar for its probability)
- a Spending view (live from the inputs, no run needed) with stacked annual spending by category, income overlaid, and a per-category table of this year, peak, and lifetime totals
- a Simulation view for one selected simulation's net worth path and annual return/cash-flow rows, with a CSV of all sampled paths
- a Beta Policy view with per-beta alternatives, a visible wealth bucket plot, and a deterministic policy path explorer over a hoverable policy heatmap
- saved plans and an autosaved draft in the browser, plus shareable links that restore the plan inputs and rerun the same seeded simulation paths

By default, the app starts with the current year, an expected year of death 60 years later, a retirement year 20 years out, `$100,000` in current net worth, dynamic beta mode, `0.8` fixed-mode SPX beta, `10,000` simulations, `$200,000` of take-home pay until retirement, and a lifestyle-builder default of a couple renting for `$5,000`/month in a very-high-cost area with comfortable everyday spending and modest economy travel.

## Retirement Year

The Plan card's retirement year is the first year without work income. Income and expense rows can run "Until retirement" (ending the year before) or start "At retirement", and employer health coverage follows it by default, so moving the retirement year moves all of them together. Rows can still use fixed years instead. Plans saved before the retirement year existed open with it set to the year after their employer coverage ended (or 20 years out), and keep their fixed years.

## Lifestyle Builder

The Lifestyle card turns a described lifestyle into dated annual expenses in today's dollars (`js/lifestyle.js` holds every price; `js/lifestyle-ui.js` is the form). It is live: changing a kid's birth year, the housing choice, or a travel setting regenerates every affected line immediately.

- **Household**: area cost tier (very high, high, medium, low; local costs such as childcare, private school, help, and everyday living are priced for SF/NYC and scaled down), one or two adults, and your birth year (for Medicare at 65).
- **Kids**: any number of kids with past or future birth years. Each kid gets childcare for ages 0–4 (none, daycare, nanny share, full-time nanny), school for 5–17 (public, typical private, top private), college for 18–21 (none, public in-state, public out-of-state, private), activities and camps for 5–17, and basics (food, clothes, gear) for 0–17.
- **Housing**: rent (you enter the monthly rent), buy with cash or with a mortgage in a purchase year (rent until then; price plus 2% closing as a one-time cost, or down payment plus closing and an amortized payment), or already own (value plus an optional existing mortgage). Owning adds property tax, insurance, and upkeep as a percent of the home value (2.5% by default).
- **Household help**: one level while any kid is at home and another before kids and after they leave (none, weekly housekeeper, after-school nanny plus housekeeper, household manager, full staff).
- **Travel**: domestic and international trips per year and nights per trip; economy, premium economy, business, first, or private jet; mid-range to ultra-luxury hotels. Commercial fares are per traveler. With kids, you set how many of the domestic and international trips they join (until 18) and how they fly: with you, or in their own class (for example economy while the adults fly business). Private charter is priced per trip for the whole plane, so kids on it add only their hotel share and daily spending.
- **Everyday living**: modest, comfortable, affluent, or lavish, itemized into groceries, dining, cars, utilities, and personal spending.
- **Health**: employer coverage (no cost) until retirement by default (or through a set year, or none), then private insurance, then Medicare at 65.

The Methodology tab lists every price and rule the builder uses (area factors, kids by age, help, everyday living, flights, hotels, housing, health), generated from the same constants as the builder, with a "Your area" column when a cheaper area is selected; the Lifestyle card's "Assumptions" link jumps there.

Every generated line shows its amount and years. Typing a new amount overrides that line (reset restores the preset), and the move-out button turns a line into a manual expenditure row with fixed years and stops generating it. Moved lines stay listed in their section with a Restore button, which brings the line back and removes its manual copy if it's still there. Above-inflation cost growth (for example tuition) is not modeled. Mortgage payments are fixed in dollars, so they shrink in today's dollars at an assumed 2.5% inflation (shown on the line as "falls with inflation"); a line moved to manual rows keeps its first-year amount flat. Lifestyle lines are added to the scenario's expenditures along with the manual rows, tagged with a category for the Spending view.

## Owning a Home

Buying moves money into an asset instead of spending it. An owned home's value grows at an editable real appreciation rate (default 1%/yr), and its equity (value less the mortgage balance) counts toward net worth paths and terminal wealth. If a simulated path's portfolio would run out, the home is sold at the start of that year for its value less 6% selling costs and the mortgage balance; ownership costs stop and rent at 4% of the home's value starts. Run-out risk is running out even after selling, and How much you need uses the same rule. The dynamic beta policy knows about this fallback: it is solved in two layers, first for life after a sale (renting, no home) and then for owning, where any year that would run out sells the home and continues on the after-sale policy. Because the home backs the portfolio, the policy can hold more stock while the home is owned; once a path sells, it follows the after-sale policy. Mortgage payments and balances are fixed in dollars, so they shrink in today's dollars at an assumed 2.5% inflation.

The Housing section shows a one-line rent-vs-own comparison: owning costs upkeep and tax plus the 0.6% real T-bill return the money would earn, less appreciation, against renting a similar home at 4% of its value. The safe rate is the right comparison because the model's home never loses value, so money in it is like money in T-bills; the stock return it gives up is made up by the beta policy taking more stock risk with the rest of the portfolio. Real homes can fall in value, so the comparison flatters owning somewhat. The Simulation chart plots net worth (portfolio plus home equity, as on the Overview), and its table and CSV show home equity each year and the year a home is sold. The Beta Policy path explorer follows the same rule: a forced path that would run out sells the home and continues on the after-sale policy. "Current net worth" is investments only, so leave the home out of it.

## Saving Plans

The inputs autosave to the browser's local storage as you edit, so closing or refreshing the page never loses work; opening the app again restores the last session. `Save` stores the current inputs under the plan name in local storage; saving an open plan under a new name renames it. The Your plans menu shows the plan you're editing ("(edited)" when it has unsaved changes, "(not saved)" or "Unsaved plan" before its first save), opens a saved plan, or starts a new plan from the defaults; the trash button deletes the open plan. Save reads "Saved" while the open plan matches what's stored. Saved plans live only in that browser; use Share to move a plan elsewhere.

## How It Works

The app is entirely client-side. `index.html` loads `styles.css`, the `js/` modules, `app.js`, and `data/spx-annual-returns.json`; `manifest.webmanifest`, `icons/`, and the `sw.js` service worker make it an installable, offline-capable app. There is no build step, package manager, server API, or database. Money is always shown compactly ($2.1M, $850K) everywhere except editable inputs and CSV exports. The UI follows the system light/dark preference; chart colors are CSS custom properties (`--chart-*` in `styles.css`) that the canvas code reads at render time.

To keep memory small, a run stores only the sampled historical year for each simulation-year (about 2 bytes each). The Simulation table, its chart, and the simulation CSV replay a simulation from those indices with the same arithmetic as the run, so the numbers match exactly. The simulation CSV exports the annual rows of the sampled inspection paths (up to 200, the same paths listed in the Simulation picker, in picker order with an `inspection_rank` column), so it stays small regardless of the simulation count.

Fixed-beta and dynamic-beta simulations sample one historical year at a time with replacement. Dynamic beta chooses the beta for a simulation year before that year's sampled return is drawn. Portfolio nominal return is modeled as:

```text
T-bill return + SPX beta * (S&P 500 return - T-bill return)
```

The simulated portfolio return is converted into current-dollar real returns using that year's inflation observation. Income and expenditures are annual current-dollar cash flows.

Dynamic beta is the default mode. It builds a backward dynamic-programming policy over plan year and current wealth before running the simulation paths. The policy is global to the scenario, not to any one simulation path. It uses a zero bucket plus 180 log-spaced positive wealth buckets from `$10,000` to `$1 trillion`, searches beta values from `0.0` to `1.5` in `0.1` steps, and solves candidate policies: minimum estimated run-out risk (ties broken by expected terminal wealth), maximum expected wealth, and scenario-calibrated risk-penalty policies in between. These make up the risk/wealth frontier shown on the Overview; each frontier policy is simulated from your net worth on the same 10,000 extra paths (the first half of the How much you need paths), and the chart plots expected and median terminal wealth against run-out risk on a log axis, with each point's current recommended SPX beta on hover. Simulating replaces the solver's own estimates, which overstate risk between wealth buckets. The run uses the simulated candidate with the highest median terminal wealth among those whose run-out risk is at most the larger of 0.5% (`ACCEPTABLE_RUN_OUT_RISK`) and the lowest risk any candidate reaches: below 0.5% less risk isn't worth giving up wealth for, and above it the run never accepts more risk than the safest policy. Pure risk minimization was the old default; it gave up large amounts of wealth for risk differences smaller than the solver's own grid error (for example, at $8M renting, 1.13% risk with a $47M median versus 1.09% with $74M now). Simulation rows and CSV exports include the SPX beta used each year. Dynamic runs also show the policy the run uses in the Beta Policy tab: per-beta alternatives for a selected wealth bucket, a hoverable visible wealth bucket plot that can show optimal SPX beta, estimated depletion risk, or expected terminal wealth, and a path explorer that forces one beta for a selected number of years under a selected return assumption. The policy CSV includes every evaluated year/bucket/beta combination and flags the recommended beta and whether the bucket is shown in the UI.

The frontier costs two extra backward sweeps rather than one per policy: the min-risk and max-expected-wealth policies are solved together (which calibrates the risk-penalty scale), then all risk-penalty policies are solved together. Within a sweep, each node's ending wealth and bucket interpolation for every beta and historical return row is computed once and shared by all objectives. The frontier's cost does not depend on the simulation count.

## How Much You Need

After each run, 20,000 extra paths of historical years are drawn. For each path, a bisection finds the least starting net worth that survives it under the same beta policy and cash flows. Sorted, those thresholds give the run-out risk at every starting net worth at once: the risk at an amount is the share of paths whose threshold is above it, and the net worth needed for a target risk is a percentile of the thresholds. The "Needed for 1% risk" metric and the How much you need chart read from this. The chart is zoomed to roughly 10% down to 0.1% risk with a log risk axis, so each step (5% → 1% → 0.1%) reads as a distance. It marks the net worth needed at 10%, 5%, 1%, and 0.1% and your own position with unlabeled dots; hovering or tapping one shows its amount and how far it is from what you have, and the summary above the chart lists the amounts. (The policy solver's own value table is not used here because its grid interpolation overstates risk.)

## Taxes

Income is entered after tax. Spending that income doesn't cover is withdrawn from the portfolio, and selling costs tax on the gains. The plan's "Tax on withdrawals" (default 15%, editable from 0% to 60%) turns a shortfall S into S / (1 − t) of withdrawals; the extra shows as "Taxes on withdrawals" in the Spending view and as a Withdrawal tax column in the Simulation table and CSV. 15% approximates California taxes on a taxable account where about 60% of each sale is gain; use less for recent money or a no-income-tax state, more for decades-old gains at top California rates. Plans saved before this setting existed open at 15%; share links made before it open at 0% so they reproduce the original run.

## Performance

Runs execute in a Web Worker (`js/simulation-worker.js`), so the page stays responsive and Stop is immediate. The dynamic-beta solver precomputes each beta's growth factors and pools return rows into the few wealth buckets they land in before scoring each objective; a default dynamic run takes about 1 to 2 seconds on a laptop.

## Tests

```bash
node tests/unit.js                              # pure modules: lifestyle builder, engine, required net worth
NODE_PATH=$(npm root -g) node tests/smoke.js    # headless browser end to end (needs Playwright + Chromium)
```

## Sharing Plans

The `p` query parameter carries the whole plan state (name, plan inputs, income and manual expense rows, and the lifestyle builder) as deflate-compressed JSON in base64url (`z.` prefix; `j.` for uncompressed JSON when the browser lacks `CompressionStream`), plus the run's seed when there is one. The address bar follows your edits and each completed run, and the active tab is stored separately in the `tab` query parameter, so refreshes and copied addresses reopen the same plan and view. Click `Share` to copy a link with a seed; opening a link with a seed restores the inputs and automatically reruns the seeded simulation, so the shared plan produces the same sampled paths without a backend or database. A shared link never overwrites the recipient's saved plans or draft until they edit or save it. Older `seed~plan~income~expenses` links still open, with the lifestyle builder switched off.

## Install on Your Phone

The planner is an installable web app (PWA), so there is no app store step:

- **iPhone (Safari):** open the site, tap the Share button, then **Add to Home Screen**.
- **Android (Chrome):** open the site, tap the menu, then **Install app** (or accept the install prompt).

It opens full screen from its own icon, behaves like an app (no pinch or double-tap zoom, and fields don't zoom the page when tapped), and works offline (the service worker caches the app and market data; when online it always fetches the latest deploy first). Share opens the phone's native share sheet. On iPhone, the installed app keeps its own storage, separate from Safari, so saved plans don't carry over between them; send a plan across with a Share link and save it there.

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

## TODO

Open items and a log of shipped work live in [`TODO.md`](TODO.md).
