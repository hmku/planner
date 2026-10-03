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
["js/constants.js", "js/util.js", "js/format.js", "js/lifestyle.js", "js/simulation.js"].forEach((file) => {
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
  check(Math.abs(Planner.annualMortgagePayment(1600000, 6.5, 30) / 12 - 10113) < 5, "mortgage amortization");

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
  check(frontier.length > 1 && frontier.some((point) => point.isMinRisk), "frontier is computed with the run and includes the min-risk policy");
  check(frontier.every((point, index) => index === 0 || point.depletionRisk >= frontier[index - 1].depletionRisk), "frontier is sorted by risk");

  const inspected = first.inspectionPaths[0];
  const replayed = Planner.getSimulationYearRows(first, inspected.simulation);
  const lastRow = replayed[replayed.length - 1];
  check(Math.abs(lastRow.endingWealth - inspected.terminalWealth) < 1e-6, "row replay matches the simulated terminal wealth");

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

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll unit checks passed");
  process.exitCode = failures ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
