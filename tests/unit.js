// Unit checks for the pure modules (no browser, no dependencies).
//   node tests/unit.js
// Exits non-zero if any check fails.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const context = { console, Math, Date, performance: require("perf_hooks").performance };
context.window = context;
vm.createContext(context);
["js/constants.js", "js/util.js", "js/format.js", "js/lifestyle.js", "js/engine.js", "js/policy.js", "js/simulation.js"].forEach((file) => {
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
});
const { Planner } = context;
Planner.yieldToBrowser = async () => {};
const returnRows = JSON.parse(fs.readFileSync(path.join(root, "data/spx-annual-returns.json"), "utf8")).returns;

let failures = 0;
function check(condition, label) {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}`);
  }
}
const totalFor = (items, year) => items
  .filter((item) => item.startYear <= year && year <= item.endYear)
  .reduce((sum, item) => sum + item.amount, 0);

async function main() {
  const currentYear = 2026;
  const deathYear = 2086;

  console.log("Lifestyle builder");
  const lifestyle = Planner.defaultLifestyle(currentYear);
  lifestyle.housing.monthlyRent = 10000;
  lifestyle.kids = [
    { ...Planner.createKid(2027), school: "elite", childcare: "nanny" },
    { ...Planner.createKid(2029), school: "elite", childcare: "nanny" }
  ];
  Object.assign(lifestyle.travel, { flightClass: "business", hotel: "upscale", internationalNights: 8 });
  lifestyle.health.employerUntilYear = 2025;
  const items = Planner.buildLifestyleItems(lifestyle, currentYear, deathYear);
  const bothInSchool = totalFor(items, 2036);
  check(bothInSchool > 450000 && bothInSchool < 560000, `SF family with two kids in top private school ~$510k/yr in 2036 (got ${Math.round(bothInSchool)})`);
  check(items.every((item) => item.startYear >= currentYear && item.endYear <= deathYear), "items are clipped to the plan window");
  const kidSchool = items.find((item) => item.key.endsWith(".school"));
  check(kidSchool.startYear === 2032 && kidSchool.endYear === 2044, "school runs ages 5-17");

  lifestyle.overrides = { "help.withKids": 80000 };
  lifestyle.detached = ["everyday.dining"];
  const overridden = Planner.buildLifestyleItems(lifestyle, currentYear, deathYear);
  check(overridden.filter((item) => item.key === "help.withKids").every((item) => item.amount === 80000 && item.isOverridden), "override applies to every segment of a key");
  check(!overridden.some((item) => item.key === "everyday.dining"), "detached lines are not generated");
  const withDetached = Planner.buildLifestyleItems(lifestyle, currentYear, deathYear, { includeDetached: true });
  check(withDetached.some((item) => item.key === "everyday.dining" && item.isDetached), "detached lines are listed when asked (for Restore)");
  check(!Planner.lifestyleItemsToFlows(withDetached).some((flow) => flow.name === "Dining out"), "detached lines never become cash flows");

  lifestyle.travel.flightClass = "private";
  const privateItems = Planner.buildLifestyleItems(lifestyle, currentYear, deathYear);
  const kidTravel = privateItems.find((item) => item.key.startsWith("kid.") && item.key.endsWith(".travel"));
  check(kidTravel.amount < 20000, "private jet is priced per trip, not per kid");
  lifestyle.travel.flightClass = "business";
  const kidTravelCost = (travel) => {
    const items = Planner.buildLifestyleItems({ ...lifestyle, travel: { ...lifestyle.travel, ...travel } }, currentYear, deathYear);
    return items.find((item) => item.key.startsWith("kid.") && item.key.endsWith(".travel"))?.amount ?? 0;
  };
  const allTrips = kidTravelCost({});
  check(kidTravelCost({ kidsFlightClass: "economy" }) < allTrips, "kids can fly economy while adults fly business");
  check(kidTravelCost({ kidsDomesticTrips: 1 }) < allTrips && kidTravelCost({ kidsDomesticTrips: 0, kidsInternationalTrips: 0 }) === 0, "kids can join only some trips, or none");
  check(kidTravelCost({ kidsDomesticTrips: 50 }) === allTrips, "kids never join more trips than the adults take");
  const legacy = Planner.normalizeLifestyle({ travel: { domesticTrips: 4, internationalTrips: 2, kidsTravel: true } }, currentYear);
  const legacyOff = Planner.normalizeLifestyle({ travel: { domesticTrips: 4, kidsTravel: false } }, currentYear);
  check(legacy.travel.kidsDomesticTrips === 4 && legacy.travel.kidsInternationalTrips === 2 && legacyOff.travel.kidsDomesticTrips === 0,
    "older plans keep their all-or-none kid travel");
  lifestyle.travel.flightClass = "private";
  check(Math.abs(Planner.annualMortgagePayment(1600000, 6.5, 30) / 12 - 10113) < 5, "mortgage amortization");

  const oddTerm = Planner.defaultLifestyle(currentYear);
  oddTerm.housing = { ...oddTerm.housing, mode: "buyMortgage", purchaseYear: 2020, mortgageYears: 0.3 };
  const oddMortgage = Planner.buildLifestyleItems(oddTerm, currentYear, deathYear).find((item) => item.key === "housing.mortgage");
  const oddHome = Planner.buildHomeModel(oddTerm, currentYear, deathYear);
  const paidOff = oddHome.balances.findIndex((balance) => balance === 0);
  check(oddMortgage.startYear === currentYear && oddHome.ownedFrom === currentYear && oddMortgage.endYear === currentYear + paidOff - 1,
    "mortgage payments and the home's balance share one purchase year and term");

  const normalized = Planner.normalizeLifestyle({
    kids: [{ id: "BAD!", birthYear: "2030", school: "nope" }],
    overrides: { "a b": 1, "ok.key": "5" },
    adults: "1",
    housing: { mode: "nope" }
  }, currentYear);
  check(normalized.kids[0].birthYear === 2030 && normalized.kids[0].school === "private" && /^[a-z0-9]+$/.test(normalized.kids[0].id), "untrusted kids are sanitized");
  check(JSON.stringify(normalized.overrides) === '{"ok.key":5}', "untrusted override keys are dropped");
  check(normalized.adults === 1 && normalized.housing.mode === "rent", "unknown enum values fall back");
  check(Planner.buildLifestyleItems({ ...Planner.defaultLifestyle(currentYear), enabled: false }, currentYear, deathYear).length === 0, "a disabled builder generates nothing");

  console.log("Simulation engine");
  const scenario = {
    currentYear,
    deathYear,
    netWorth: 1000000,
    betaMode: "dynamic",
    spxBeta: 0.8,
    simulationCount: 3000,
    income: [{ amount: 200000, startYear: currentYear, endYear: 2045 }],
    expenses: [{ amount: 133000, startYear: currentYear, endYear: deathYear }]
  };
  const first = await Planner.simulateScenario(scenario, returnRows, Planner.createSeededRandom(42));
  const second = await Planner.simulateScenario(scenario, returnRows, Planner.createSeededRandom(42));
  check(first.risk === second.risk && first.terminalWealthSorted.every((value, index) => value === second.terminalWealthSorted[index]), "same seed, same results (share links rely on this)");

  const frontier = first.dynamicPolicy.frontier;
  check(frontier.length > 1 && frontier.some((point) => point.isMinRisk) && frontier.filter((point) => point.isChosen).length === 1, "frontier is computed with the run, includes the min-risk policy, and marks the one the run uses");
  check(frontier.every((point, index) => index === 0 || point.depletionRisk >= frontier[index - 1].depletionRisk), "frontier is sorted by risk");
  check(frontier.every((point) => point.medianTerminalWealth >= 0 && !("policy" in point)), "frontier points carry a simulated median and no policy tables");
  const chosen = frontier.find((point) => point.isChosen);
  const allowedRisk = Math.max(Planner.ACCEPTABLE_RUN_OUT_RISK, ...frontier.map((point) => point.depletionRisk).slice(0, 1));
  check(chosen.depletionRisk <= allowedRisk + 1e-12 && frontier.every((point) => point.depletionRisk > allowedRisk + 1e-12 || point.medianTerminalWealth <= chosen.medianTerminalWealth),
    "the run uses the most median wealth within the acceptable (or lowest reachable) risk");
  check(Math.abs(chosen.depletionRisk - first.risk) < 0.02, `the chosen frontier point agrees with the run (${(chosen.depletionRisk * 100).toFixed(2)}% vs ${(first.risk * 100).toFixed(2)}%)`);
  const policy = first.dynamicPolicy;
  const evaluate = Planner.createActionEvaluator(policy, scenario, returnRows, first.years);
  const node = { year: 5, bucket: Planner.nearestBucketIndex(policy.wealthBuckets, 2000000) };
  const recommended = evaluate(node.year, policy.wealthBuckets[node.bucket]).find((action) => Math.abs(action.beta - policy.policyByYear[node.year][node.bucket]) < 1e-9);
  check(Math.abs(recommended.risk - policy.valueByYear[node.year][node.bucket]) < 1e-9 && Math.abs(recommended.expectedWealth / policy.expectedWealthByYear[node.year][node.bucket] - 1) < 1e-9,
    "on-demand per-beta alternatives match the solver's tables");

  const inspected = first.inspectionPaths[0];
  const replayed = Planner.getSimulationYearRows(first, inspected.simulation);
  const lastRow = replayed[replayed.length - 1];
  check(Math.abs(lastRow.endingWealth - inspected.terminalWealth) < 1e-6, "row replay matches the simulated terminal wealth");

  console.log("Owned home");
  const owner = Planner.defaultLifestyle(currentYear);
  owner.housing = { ...owner.housing, mode: "buyCash", homePrice: 3000000, purchaseYear: currentYear, appreciationPct: 1 };
  const home = Planner.buildHomeModel(owner, currentYear, deathYear);
  check(Math.abs(home.values[10] - 3000000 * 1.01 ** 10) < 1e-6 && home.balances.every((balance) => balance === 0), "cash purchase: value appreciates, no mortgage");
  const mortgaged = { ...owner, housing: { ...owner.housing, mode: "buyMortgage", downPaymentPct: 20, mortgageRate: 6.5, mortgageYears: 30 } };
  const mortgageHome = Planner.buildHomeModel(mortgaged, currentYear, deathYear);
  check(Math.abs(mortgageHome.balances[0] - 2400000) < 1 && mortgageHome.balances[29] > 0 && mortgageHome.balances[30] === 0, "mortgage balance starts at the loan and is paid off after the term");
  const ownerFlows = Planner.lifestyleItemsToFlows(Planner.buildLifestyleItems(owner, currentYear, deathYear));
  check(ownerFlows.some((flow) => flow.homeCost && /tax, insurance/.test(flow.name)), "ownership costs are tagged so a sale can stop them");
  const ownerScenario = { ...scenario, netWorth: 6000000, income: [], expenses: ownerFlows, withdrawalTaxRate: 0.15 };
  const withHome = await Planner.simulateScenario({ ...ownerScenario, home }, returnRows, Planner.createSeededRandom(9));
  const withoutHome = await Planner.simulateScenario({ ...ownerScenario, home: null }, returnRows, Planner.createSeededRandom(9));
  check(withHome.dynamicPolicy.sold && !withoutHome.dynamicPolicy.sold, "with a home, the beta policy has an after-sale layer");
  check(withHome.risk < withoutHome.risk, `selling the home when needed lowers run-out risk (${(withoutHome.risk * 100).toFixed(2)}% → ${(withHome.risk * 100).toFixed(2)}%)`);
  const fixedWithHome = await Planner.simulateScenario({ ...ownerScenario, betaMode: "fixed", home }, returnRows, Planner.createSeededRandom(9));
  const fixedWithoutHome = await Planner.simulateScenario({ ...ownerScenario, betaMode: "fixed", home: null }, returnRows, Planner.createSeededRandom(9));
  check(fixedWithHome.expectedTerminalWealth > fixedWithoutHome.expectedTerminalWealth, "home equity counts toward terminal wealth");
  const soldPath = withHome.inspectionPaths.find((path) => Planner.getSimulationYearRows(withHome, path.simulation).some((row) => row.homeSoldThisYear));
  check(Boolean(soldPath), "some inspected paths sell the home");
  const anyPath = withHome.inspectionPaths[withHome.inspectionPaths.length - 1];
  const anyRows = Planner.getSimulationYearRows(withHome, anyPath.simulation);
  const lastAny = anyRows[anyRows.length - 1];
  check(Math.abs(lastAny.endingWealth + lastAny.homeEquity - anyPath.terminalWealth) < 1e-6, "row replay matches the run with a home (portfolio + equity)");
  const comparison = Planner.homeOwnershipComparison(owner);
  check(Math.abs(comparison.owning - 3000000 * (0.025 + 0.006 - 0.01)) < 1 && comparison.renting === 120000, "rent-vs-own comparison");

  console.log("Withdrawal tax");
  const taxed = { ...scenario, withdrawalTaxRate: 0.15 };
  const earlyYear = Planner.cashFlowsForYear(taxed, 2030);
  check(earlyYear.withdrawalTax === 0, "no tax while income covers spending");
  const lateYear = Planner.cashFlowsForYear(taxed, 2050);
  check(Math.abs(lateYear.withdrawalTax - 133000 * 0.15 / 0.85) < 1e-6 && Math.abs(lateYear.net + 133000 / 0.85) < 1e-6, "a shortfall S costs S / (1 - t) of withdrawals");
  const taxedRun = await Planner.simulateScenario(taxed, returnRows, Planner.createSeededRandom(42));
  check(taxedRun.risk > first.risk, `withdrawal tax raises run-out risk (${(first.risk * 100).toFixed(2)}% → ${(taxedRun.risk * 100).toFixed(2)}%)`);
  const taxedRows = Planner.getSimulationYearRows(taxedRun, taxedRun.inspectionPaths[0].simulation);
  check(Math.abs(taxedRows[taxedRows.length - 1].endingWealth - taxedRun.inspectionPaths[0].terminalWealth) < 1e-6, "row replay matches with the tax");

  const flows = [{ amount: 100, startYear: 2030, endYear: 2032 }, { amount: 50, startYear: 2031, endYear: 2040, deflateRate: 0.1, deflateFrom: 2031 }];
  check(Planner.flowsTotalForYear(flows, 2029) === 0 && Planner.flowsTotalForYear(flows, 2031) === 150 && Math.abs(Planner.flowsTotalForYear(flows, 2033) - 50 / 1.21) < 1e-9,
    "flow totals respect years and deflating payments");
  const factors = Planner.createGrowthFactorCache(returnRows)(0.7);
  const one = Planner.growthFactorsOf(Planner.buildReturnMetrics(returnRows[3], 0.7).realGrowthFactor);
  check(one.growth === factors.growth[3] && one.cashFactor === factors.cashFactor[3], "one-off growth factors match the cached per-row factors");

  console.log("How much you need");
  const { requiredWealth } = first;
  const samples = [0, 1e4, 1e5, 3e5, 1e6, 3e6, 1e7].map((wealth) => Planner.riskAtWealth(requiredWealth, wealth));
  check(samples.every((risk, index) => index === 0 || risk <= samples[index - 1]), "risk falls as starting net worth rises");
  [0.01, 0.05, 0.2].forEach((target) => {
    const needed = Planner.requiredWealthForRisk(requiredWealth, target);
    check(Number.isFinite(needed) && Planner.riskAtWealth(requiredWealth, needed) <= target + 1e-12, `needed net worth meets the ${target * 100}% target`);
    check(needed === 0 || Planner.riskAtWealth(requiredWealth, needed * 0.97) > target, `needed net worth for ${target * 100}% is (close to) the least that works`);
  });
  const headlineRisk = first.risk;
  const curveRisk = Planner.riskAtWealth(requiredWealth, scenario.netWorth);
  check(Math.abs(headlineRisk - curveRisk) < 0.02, `path curve agrees with the headline run at your net worth (${(curveRisk * 100).toFixed(2)}% vs ${(headlineRisk * 100).toFixed(2)}%)`);

  const fixed = await Planner.simulateScenario({ ...scenario, betaMode: "fixed" }, returnRows, Planner.createSeededRandom(7));
  check(Math.abs(fixed.risk - Planner.riskAtWealth(fixed.requiredWealth, scenario.netWorth)) < 0.02, "fixed beta: path curve agrees with the headline run");

  console.log("Display formatting");
  check(Planner.formatMoney(2140000) === "$2.1M" && Planner.formatMoney(850000) === "$850K" && Planner.formatMoney(450) === "$450" && Planner.formatMoney(NaN) === "--", "formatMoney is compact ($2.1M, $850K, $450)");
  check([0.0004, 0.09996, 0.1234, 0.99966, 1].map(Planner.formatPolicyRiskPercent).join(" ") === "0.04% 10.0% 12.3% 100% 100%", "small risks keep precision without rounding up to 100.0%");
  check(!("formatCurrency" in Planner) && !("formatCompactCurrency" in Planner), "there is only one money formatter");
  // Every number shown in the UI goes through js/format.js: nothing else may
  // build number formats or hand-format amounts. Number(x.toFixed(n)) rounding
  // is allowed.
  const sourceFiles = [...fs.readdirSync(path.join(root, "js")).map((file) => `js/${file}`), "app.js", "index.html"]
    .filter((file) => /\.(js|html)$/.test(file) && file !== "js/format.js");
  const rules = [
    { pattern: /Intl\.NumberFormat|toLocaleString\(/, why: "builds its own number format" },
    { pattern: /\.to(Fixed|Precision)\(/, why: "formats with toFixed/toPrecision", allow: /Number\(/ },
    { pattern: /\* 100\}%/, why: "hand-formats a percent (use formatPercent)" },
    { pattern: /\$\d{1,3}(,\d{3})+|\$\d+(\.\d+)?\s?(k|thousand|million|billion|trillion)\b/, why: "writes a full or lowercase-k dollar amount (write $10K, $2.1M)" }
  ];
  const violations = sourceFiles.flatMap((file) => fs.readFileSync(path.join(root, file), "utf8").split("\n").flatMap((line, index) => rules
    .filter((rule) => rule.pattern.test(line) && !(rule.allow && rule.allow.test(line)))
    .map((rule) => `${file}:${index + 1} ${rule.why}`)));
  check(violations.length === 0, `all display formatting goes through js/format.js${violations.length ? `\n        ${violations.join("\n        ")}` : ""}`);

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll unit checks passed");
  process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
