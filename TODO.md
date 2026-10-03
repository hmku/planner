# TODO

Open items first, then a log of what's done. Keep this file current: add new
ideas and follow-ups as they come up, and move items to Done (newest first)
when they ship.

## Open

### Modeling
- Flexible versus crucial expenditures (tag lifestyle lines and manual rows).
- Spending guardrails: when projected wealth runs low, cut flexible spending and keep crucial spending.
- Leverage cost: betas above 1 (the dynamic grid goes to 1.5) are financed at the T-bill rate, which is optimistic; add a borrowing spread.
- Borrow-instead-of-sell mode (securities-backed line of credit): loan balance at T-bill + spread, LTV cap with forced selling, step-up in basis at death.
- Richer tax modeling: gain share rising over time, brackets (0% federal on gains at low income after quitting), dividends taxed while invested, and account types (taxable, tax-deferred, Roth).
- Real cost growth per category (for example tuition and healthcare rising faster than inflation).
- Mortgage payments are held flat in today's dollars; deflate them by an inflation assumption instead.
- Income presets: salary until a quit year, then a founder salary or other runway scenarios.

### Lifestyle builder
- Avoid double counting when a full-time nanny (childcare) overlaps after-school nanny help.
- Optional second home and charitable giving sections.
- Calibration helper: compare the builder's "everyday" lines against 12 months of actual spending.
- Revisit prices periodically (tuition, fares, charter rates); they live in `js/lifestyle.js`.

### App
- Native App Store / Play Store builds (for example a Capacitor wrapper) if the installable web app isn't enough.
- Sync saved plans across devices (saved plans currently live only in one browser; the installed iPhone app has storage separate from Safari).

## Done

- How much you need chart: dots without labels (hover or tap for details) and finer ticks on zoomed axes.
- Tax on withdrawals: editable plan setting (default 15%) that grosses up spending income doesn't cover; shown in the Spending view, Simulation table, and CSV.
- How much you need is the third Overview pane, labels the net worth needed for 10%, 5%, 1%, and 0.1% risk on a zoomed log-risk chart (no dropdown), and uses 20,000 paths; the metric card shows the 1% amount.
- How much you need: needed starting net worth for a 1%–20% run-out risk (metric card and Overview chart), from per-path survival thresholds.
- Runs execute in a Web Worker; dynamic-beta solver about 1.6x faster with identical results (precomputed growth factors, pooled bucket weights). A 50,000-simulation run went from 4.7s to 1.8s in the test browser.
- Automated tests: `tests/unit.js` (Node) and `tests/smoke.js` (headless browser, includes offline and phone checks).
- "See spending" and "Assumptions" links switch tabs and scroll the target into view (needed on phones, where results sit below the inputs).
- Mobile: zooming disabled (viewport, iOS gesture events, double-tap), 16px fields on touch screens so tapping one doesn't zoom, and the tab row scrolls horizontally only.
- Lifestyle builder assumptions: full tables of prices and rules on the Methodology tab, generated from the builder's constants, with a "Your area" column; linked from the Lifestyle card.
- Lines moved out of the lifestyle builder can be restored (Restore button; removes the manual copy so nothing double counts).
- Default simulation count lowered from 50,000 to 10,000 for faster runs.
- Installable mobile app (PWA): manifest, home-screen icons, offline support via a service worker, safe-area layout, native share sheet on phones.
- Saved plans: autosaved draft in localStorage plus named saves (Save button, Saved plans menu).
- Share links v2: full plan state (including the lifestyle builder) as compressed JSON; address bar follows edits; v1 links still open.
- Spending tab: stacked annual spending by category with income overlaid, plus a per-category table.
- Lifestyle builder: household and area cost tier, kids by birth year (childcare, school, college, activities), housing (rent, buy with cash or a mortgage, already own), household help, travel (economy through private jet, hotel tiers), everyday living tiers, health (employer, private, Medicare). Lines can be overridden, reset, or moved to manual rows.
- Dynamic beta frontier moved onto Overview and computed with every dynamic run (no separate button); the solver shares work across objectives, making the frontier about 6x cheaper.
- Overview order: net worth, frontier, SPX beta over time, depletion distribution.
- Simulation CSV exports only the sampled inspection paths.
- UI revamp, faster simulation engine (stores only sampled row indexes and replays rows), correctness fixes.
- Vercel hosting configuration.
- Dynamic beta: backward dynamic-programming policy, Beta Policy tab (alternatives table, wealth bucket plot, policy path explorer), policy CSV.
- Active tab persisted in the URL; share links with seeded reruns.
- Annual SPX return sampling with T-bill and CPI data; modular `js/` structure with shared section headers and chart helpers.
