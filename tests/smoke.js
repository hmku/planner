// Browser smoke test: serves the repo itself and drives the app headlessly
// through the AGENTS.md checklist. Needs Playwright with Chromium:
//   NODE_PATH=$(npm root -g) node tests/smoke.js
// Set CHROMIUM_PATH to use a specific Chromium build. Exits non-zero on failure.
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function startServer() {
  const server = http.createServer((request, response) => {
    const urlPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = path.join(root, urlPath === "/" ? "index.html" : urlPath);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  return fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
}

let failures = 0;
function check(condition, label, detail = "") {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (page, selector) => page.textContent(selector);

function watchErrors(page, errors, label) {
  page.on("pageerror", (error) => errors.push(`${label}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${label}: ${message.text()}`);
  });
}

async function waitForRun(page) {
  await page.waitForFunction(() => {
    const status = document.querySelector("#runStatus").textContent;
    return /simulations in/.test(status) && !document.querySelector("#runSimulation").classList.contains("is-running");
  }, null, { timeout: 90000 });
}

async function openApp(page, url) {
  await page.goto(url);
  await page.waitForSelector("#runSimulation:not([disabled])", { timeout: 30000 });
}

async function main() {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  const errors = [];

  try {
    console.log("Load and run");
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const page = await context.newPage();
    watchErrors(page, errors, "desktop");
    await openApp(page, base);
    check(await page.inputValue("#simulationCount") === "10,000", "default simulation count is 10,000");
    check(await page.inputValue("#withdrawalTax") === "15", "default tax on withdrawals is 15%");
    await page.selectOption("#betaMode", "fixed");
    check(await page.inputValue("#spxBeta") === "0.8", "default fixed SPX beta is 0.8");
    await page.selectOption("#betaMode", "dynamic");
    await page.click("#runSimulation");
    await waitForRun(page);
    check(/%$/.test(await text(page, "#riskMetric")), "run-out risk renders", await text(page, "#riskMetric"));
    check(/^Needed for 1% risk$/.test(await text(page, "#requiredWealthMetricLabel")) && /\$/.test(await text(page, "#requiredWealthMetric")), "needed net worth renders for the default 1% target");
    check(/dynamic beta policies/.test(await text(page, "#frontierSummary")), "frontier renders with the run");
    check(/10% risk: .* · 5%: .* · 1%: .* · 0\.1%: /.test(await text(page, "#requiredWealthSummary")), "How much you need lists 10%, 5%, 1%, 0.1%");
    const overviewTitles = await page.$$eval("#overviewPage h2", (titles) => titles.map((title) => title.textContent));
    check(overviewTitles[2] === "How much you need", "How much you need is the third Overview section", overviewTitles.join(", "));
    await page.fill("#withdrawalTax", "30");
    await page.click('[data-page="spending"]');
    check(await page.locator("#spendingPage .chart-legend li", { hasText: "Taxes on withdrawals" }).count() === 1, "withdrawal tax shows in the Spending view");
    await page.fill("#withdrawalTax", "15");
    await page.click('[data-page="overview"]');

    console.log("Lifestyle builder");
    await page.click('[data-ls-section="kids"] summary');
    await page.click("#addKid");
    check(await page.locator("#kidRows .kid-row").count() === 1, "adding a kid adds a kid row");
    check(await page.locator('[data-ls-items="kids"] .ls-item').count() > 0, "kid line items appear");
    await page.click('[data-ls-section="housing"] summary');
    await page.selectOption('[data-ls="housing.mode"]', "buyMortgage");
    check(await page.locator('[data-item-key="housing.mortgage"]').count() === 1, "buying with a mortgage adds a mortgage line");
    await page.click('[data-ls-section="everyday"] summary');
    const groceries = page.locator('[data-item-key="everyday.groceries"] .ls-item-amount');
    await groceries.fill("30000");
    await groceries.press("Tab");
    check(await page.locator('[data-item-key="everyday.groceries"] .ls-item-reset').isVisible(), "overriding a line shows Reset");
    const totalBefore = await text(page, "#lifestyleTotal");
    await page.click('[data-item-key="everyday.dining"] .ls-item-detach');
    check(await page.locator('#expenseRows .flow-row[data-lifestyle-key="everyday.dining"]').count() === 1, "moving a line creates a manual row");
    await page.click('[data-item-key="everyday.dining"] .ls-item-restore');
    check(await page.locator("#expenseRows .flow-row").count() === 0 && await text(page, "#lifestyleTotal") === totalBefore, "Restore brings the line back and removes the manual copy");

    console.log("Spending and tabs");
    await page.click('[data-page="spending"]');
    check(await page.locator("#spendingPage .chart-legend li").count() > 2, "Spending legend lists categories");
    check(await page.locator("#spendingTable tr.is-marked").count() === 1, "Spending table has a total row");
    await page.click("#runSimulation");
    await waitForRun(page);
    await page.click('[data-page="details"]');
    const options = await page.$$eval("#simulationSelect option", (items) => items.map((item) => item.value));
    await page.selectOption("#simulationSelect", options[Math.min(3, options.length - 1)]);
    check(await page.locator("#simulationPathTable tr").count() === 61, "Simulation table shows one row per plan year");
    check(await page.locator("#simulationPathTable tr:first-child td").count() === 16, "Simulation table includes the withdrawal tax column");
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#downloadCsv")]);
    const csvLines = fs.readFileSync(await download.path(), "utf8").trim().split("\n").length;
    check(csvLines === options.length * 61 + 1, "CSV has a row per sampled path per year", `${csvLines} lines`);
    await page.click('[data-page="policy"]');
    await page.click('[data-page="methodology"]');
    check(await page.locator("#lifestyleAssumptions table").count() >= 8, "Methodology shows the assumptions tables");
    await page.click('[data-page="overview"]');

    console.log("Save, restore, share");
    await page.fill("#planName", "Smoke test plan");
    await page.click("#savePlan");
    check(await text(page, "#savePlan") === "Saved", "Save stores the plan");
    await page.click('[data-ls-section="travel"] summary');
    await page.fill('[data-ls="travel.domesticTrips"]', "5");
    await sleep(700);
    check(await text(page, "#savePlan") === "Save", "editing marks the plan unsaved");
    await page.reload();
    await page.waitForSelector("#runSimulation:not([disabled])");
    await sleep(500);
    check(await page.inputValue('[data-ls="travel.domesticTrips"]') === "5" && await page.locator("#kidRows .kid-row").count() === 1, "reload keeps the inputs");
    page.once("dialog", (dialog) => dialog.accept());
    await page.selectOption("#savedPlanSelect", "Smoke test plan");
    await sleep(300);
    check(await page.inputValue('[data-ls="travel.domesticTrips"]') === "2", "opening the saved plan restores it");
    await openApp(page, base);
    await sleep(500);
    check(/Restored your last session/.test(await text(page, "#runStatus")), "the bare URL restores the draft");
    await page.click("#runSimulation");
    await waitForRun(page);
    const risk = await text(page, "#riskMetric");
    await page.click("#sharePlan");
    await sleep(500);
    const shareUrl = await page.evaluate(() => navigator.clipboard.readText());
    const fresh = await (await browser.newContext()).newPage();
    watchErrors(fresh, errors, "share");
    await fresh.goto(shareUrl);
    await waitForRun(fresh);
    check(await text(fresh, "#riskMetric") === risk && await fresh.inputValue("#planName") === "Smoke test plan", "a share link restores the plan and reproduces the run", `${risk} vs ${await text(fresh, "#riskMetric")}`);
    await fresh.goto(`${base}?p=123~2026,2086,100000,.8,1000,d~Salary,120000,c,,f,2045~Living+expenses,85000,c,,d,`);
    await waitForRun(fresh);
    check(!(await fresh.isChecked('[data-ls="enabled"]')) && await fresh.locator("#expenseRows .flow-row").count() === 1, "old-format links open with the builder off");

    console.log("Phone");
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" });
    const mobile = await phone.newPage();
    watchErrors(mobile, errors, "phone");
    await openApp(mobile, base);
    check(!(await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), "no sideways page scroll at 390px");
    check(await mobile.$eval(".page-nav", (nav) => nav.scrollHeight <= nav.clientHeight), "the tab row only scrolls sideways");
    check(await mobile.$eval("#netWorth", (input) => getComputedStyle(input).fontSize) === "16px", "fields are 16px so tapping doesn't zoom");
    await mobile.click("#lifestyleTotal .link-button");
    await sleep(900);
    check(await mobile.$eval(".page-nav", (nav) => nav.getBoundingClientRect().top < window.innerHeight * 0.4), "See spending scrolls the tabs into view");

    console.log("Offline");
    await mobile.evaluate(() => navigator.serviceWorker.ready);
    await mobile.reload();
    await mobile.waitForSelector("#runSimulation:not([disabled])");
    await phone.setOffline(true);
    await openApp(mobile, `${base}?tab=spending`);
    await mobile.fill("#simulationCount", "1000");
    await mobile.click("#runSimulation");
    await waitForRun(mobile);
    check(/%$/.test(await text(mobile, "#riskMetric")), "the app loads and runs offline");

    check(errors.length === 0, "no console errors", errors.join("; "));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll smoke checks passed");
  process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
