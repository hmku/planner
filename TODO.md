# TODO

Open items first, then a log of what's done. Keep this file current: add new
ideas and follow-ups as they come up, and move items to Done (newest first)
when they ship.

## Open

### Modeling
- Flexible versus crucial expenditures (tag lifestyle lines and manual rows).
- Spending guardrails: when projected wealth runs low, cut flexible spending and keep crucial spending.
- Taxes: gross up portfolio withdrawals (California taxes long-term gains as ordinary income; ~18% effective was a reasonable planning assumption), then richer account modeling (taxable, tax-deferred, Roth).
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
- Automated browser smoke tests: default load, run, tab switching, inspected simulation, CSV download, lifestyle builder, save/restore, share links.

## Done

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
