const MAX_VISUAL_PATHS = 200;
const RETURN_BLOCK_YEARS = 5;
const SIMULATION_CHUNK_SIZE = 100;
const MIN_PLAN_YEAR = 1900;
const MAX_PLAN_YEAR = 2200;
const MAX_PLAN_LENGTH_YEARS = 120;
const MIN_SIMULATION_COUNT = 100;
const MAX_SIMULATION_COUNT = 200000;
const MAX_SIMULATION_YEAR_ROWS = 12000000;
const MAX_SHARED_FLOWS = 100;
const BETA_MODE_FIXED = "fixed";
const BETA_MODE_DYNAMIC = "dynamic";
const DYNAMIC_BETA_VALUES = Array.from({ length: 16 }, (_, index) => Number((index * 0.1).toFixed(1)));
const DYNAMIC_WEALTH_BUCKETS = 120;
const DYNAMIC_MIN_POSITIVE_WEALTH_BUCKET = 10000;
const DYNAMIC_MAX_WEALTH_BUCKET = 1000000000;
const DYNAMIC_POLICY_PROGRESS_SHARE = 0.25;
const EPSILON = 0.000000001;

const state = {
  marketData: null,
  results: null,
  activePage: "overview",
  hover: null,
  pathHitAreas: [],
  betaPathHitAreas: [],
  detailHover: null,
  detailHitPoints: [],
  isDirty: true,
  isRunning: false,
  cancelRequested: false,
  inputVersion: 0,
  nextSimulationSeed: null,
  shareStatusTimer: null
};

const DEFAULT_INCOME = [
  { name: "Salary", amount: 120000, startMode: "current", startYear: 2026, endMode: "fixed", endYear: 2045 }
];

const DEFAULT_EXPENSES = [
  { name: "Living expenses", amount: 85000, startMode: "current", startYear: 2026, endMode: "death", endYear: 2070 },
  { name: "Healthcare", amount: 22000, startMode: "fixed", startYear: 2046, endMode: "death", endYear: 2070 }
];

const els = {};

document.addEventListener("DOMContentLoaded", async () => {
  cacheElements();
  setDefaults();
  const sharedPlan = applySharedPlanFromUrl();
  bindEvents();
  resetDetailsControls();
  updateRunState();
  await loadMarketData();
  if (sharedPlan && sharedPlan.error) {
    els.scenarioSummary.textContent = sharedPlan.error;
    markDirty();
    return;
  }
  if (sharedPlan) {
    state.nextSimulationSeed = sharedPlan.seed;
    state.isDirty = true;
    updateRunState();
    els.scenarioSummary.textContent = sharedPlan.autorun
      ? "Shared plan loaded. Running simulation..."
      : "Shared plan loaded. Click Run to simulate.";
    if (sharedPlan.autorun) {
      await runSimulation();
    }
    return;
  }
  markDirty();
});

function cacheElements() {
  Object.assign(els, {
    form: document.querySelector("#plannerForm"),
    runSimulation: document.querySelector("#runSimulation"),
    runProgress: document.querySelector("#runProgress"),
    runProgressBar: document.querySelector("#runProgressBar"),
    runProgressLabel: document.querySelector("#runProgressLabel"),
    currentYear: document.querySelector("#currentYear"),
    deathYear: document.querySelector("#deathYear"),
    netWorth: document.querySelector("#netWorth"),
    betaMode: document.querySelector("#betaMode"),
    fixedBetaControl: document.querySelector("#fixedBetaControl"),
    spyBeta: document.querySelector("#spyBeta"),
    simulationCount: document.querySelector("#simulationCount"),
    incomeRows: document.querySelector("#incomeRows"),
    expenseRows: document.querySelector("#expenseRows"),
    addIncome: document.querySelector("#addIncome"),
    addExpense: document.querySelector("#addExpense"),
    sharePlan: document.querySelector("#sharePlan"),
    downloadCsv: document.querySelector("#downloadCsv"),
    template: document.querySelector("#flowRowTemplate"),
    riskMetric: document.querySelector("#riskMetric"),
    medianWealthMetric: document.querySelector("#medianWealthMetric"),
    currentBetaMetricLabel: document.querySelector("#currentBetaMetricLabel"),
    currentBetaMetric: document.querySelector("#currentBetaMetric"),
    dataSpanMetric: document.querySelector("#dataSpanMetric"),
    scenarioSummary: document.querySelector("#scenarioSummary"),
    netWorthSummary: document.querySelector("#netWorthSummary"),
    betaPathSummary: document.querySelector("#betaPathSummary"),
    netWorthZoom: document.querySelector("#netWorthZoom"),
    netWorthZoomLabel: document.querySelector("#netWorthZoomLabel"),
    showDepleted: document.querySelector("#showDepleted"),
    distributionCanvas: document.querySelector("#distributionCanvas"),
    pathsCanvas: document.querySelector("#pathsCanvas"),
    betaCanvas: document.querySelector("#betaCanvas"),
    selectedSimulationCanvas: document.querySelector("#selectedSimulationCanvas"),
    simulationSelect: document.querySelector("#simulationSelect"),
    simulationPathTable: document.querySelector("#simulationPathTable"),
    selectedSimulationSummary: document.querySelector("#selectedSimulationSummary"),
    dynamicPolicySection: document.querySelector("#dynamicPolicySection"),
    dynamicPolicySummary: document.querySelector("#dynamicPolicySummary"),
    policyYearSelect: document.querySelector("#policyYearSelect"),
    dynamicPolicyTable: document.querySelector("#dynamicPolicyTable"),
    downloadPolicyCsv: document.querySelector("#downloadPolicyCsv"),
    pageButtons: document.querySelectorAll("[data-page]"),
    overviewPage: document.querySelector("#overviewPage"),
    detailsPage: document.querySelector("#detailsPage"),
    policyPage: document.querySelector("#policyPage"),
    methodologyPage: document.querySelector("#methodologyPage")
  });
}

function setDefaults() {
  const currentYear = new Date().getFullYear();
  els.currentYear.value = currentYear;
  els.deathYear.value = currentYear + 44;
  els.netWorth.value = 1250000;
  els.betaMode.value = BETA_MODE_DYNAMIC;
  els.spyBeta.value = 0.8;
  els.simulationCount.value = 50000;

  DEFAULT_INCOME.forEach((flow) => addFlowRow(els.incomeRows, flow));
  DEFAULT_EXPENSES.forEach((flow) => addFlowRow(els.expenseRows, flow));
  bindFormattedInputs(document);
  formatAllFormattedInputs(document);
  updateBetaModeControls();
}

function bindEvents() {
  els.runSimulation.addEventListener("click", runSimulation);
  els.sharePlan.addEventListener("click", sharePlan);
  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    runSimulation();
  });
  els.form.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    runSimulation();
  });
  els.form.addEventListener("input", markDirty);
  els.form.addEventListener("change", markDirty);
  els.betaMode.addEventListener("change", updateBetaModeControls);
  [els.currentYear, els.deathYear].forEach((input) => {
    input.addEventListener("change", syncRelativeFlowYears);
  });
  els.addIncome.addEventListener("click", () => {
    addFlowRow(els.incomeRows, {
      name: "Income",
      amount: 25000,
      startMode: "current",
      startYear: Number(els.currentYear.value),
      endMode: "death",
      endYear: Number(els.deathYear.value)
    });
    markDirty();
  });
  els.addExpense.addEventListener("click", () => {
    addFlowRow(els.expenseRows, {
      name: "Expense",
      amount: 25000,
      startMode: "current",
      startYear: Number(els.currentYear.value),
      endMode: "death",
      endYear: Number(els.deathYear.value)
    });
    markDirty();
  });
  els.downloadCsv.addEventListener("click", downloadSimulationCsv);
  els.downloadPolicyCsv.addEventListener("click", downloadPolicyCsv);
  els.pageButtons.forEach((button) => {
    button.addEventListener("click", () => switchPage(button.dataset.page));
  });
  els.pathsCanvas.addEventListener("mousemove", handlePathHover);
  els.pathsCanvas.addEventListener("mouseleave", () => {
    state.hover = null;
    if (state.results) renderNetWorthChart(els.pathsCanvas, state.results);
  });
  els.betaCanvas.addEventListener("mousemove", handleBetaPathHover);
  els.betaCanvas.addEventListener("mouseleave", () => {
    state.hover = null;
    if (state.results) renderBetaChart(els.betaCanvas, state.results);
  });
  els.selectedSimulationCanvas.addEventListener("mousemove", handleDetailChartHover);
  els.selectedSimulationCanvas.addEventListener("mouseleave", () => {
    state.detailHover = null;
    if (state.results) renderSelectedSimulationChart(els.selectedSimulationCanvas, state.results);
  });
  els.netWorthZoom.addEventListener("input", () => {
    updateNetWorthZoomLabel();
    if (state.results) renderNetWorthChart(els.pathsCanvas, state.results);
  });
  els.showDepleted.addEventListener("change", () => {
    if (state.results) {
      updateScenarioSummary(state.results);
      renderDistributionChart(els.distributionCanvas, state.results);
    }
  });
  els.simulationSelect.addEventListener("change", () => {
    if (!state.results) return;
    state.detailHover = null;
    renderSimulationPathTable(state.results);
    renderDynamicPolicyTable(state.results);
    renderSelectedSimulationChart(els.selectedSimulationCanvas, state.results);
  });
  els.policyYearSelect.addEventListener("change", () => {
    if (state.results) renderDynamicPolicyTable(state.results);
  });
  window.addEventListener("resize", () => {
    if (state.results) renderCharts(state.results);
  });
  updateNetWorthZoomLabel();
}

async function loadMarketData() {
  const response = await fetch("data/spy-annual-returns.json");
  state.marketData = await response.json();
  const years = state.marketData.returns.map((entry) => entry.year);
  els.dataSpanMetric.textContent = `${Math.min(...years)}-${Math.max(...years)}`;
}

function markDirty() {
  if (!state.isRunning) {
    state.nextSimulationSeed = null;
  }
  if (!state.isDirty || state.isRunning) {
    state.inputVersion += 1;
  }
  state.isDirty = true;
  updateRunState();
}

function updateRunState() {
  const canRun = Boolean(state.marketData) && state.isDirty && !state.isRunning;
  els.runSimulation.disabled = state.isRunning ? state.cancelRequested : !canRun;
  els.sharePlan.disabled = state.isRunning;
  els.runSimulation.textContent = state.cancelRequested
    ? "Stopping"
    : state.isRunning
      ? "Stop"
      : "Run";
  els.runSimulation.classList.toggle("is-running", state.isRunning);
}

function updateBetaModeControls() {
  const isDynamicBeta = normalizeBetaMode(els.betaMode.value) === BETA_MODE_DYNAMIC;
  els.fixedBetaControl.hidden = isDynamicBeta;
  els.spyBeta.disabled = isDynamicBeta;
  els.spyBeta.required = !isDynamicBeta;
}

function showProgress() {
  els.runProgress.hidden = false;
  setProgress(0);
}

function hideProgress() {
  els.runProgress.hidden = true;
  els.runProgressLabel.textContent = "";
  setProgress(0);
}

function setProgress(value) {
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  els.runProgressBar.style.width = `${percent}%`;
  els.runProgress.setAttribute("aria-valuenow", String(percent));
  els.runProgressLabel.textContent = state.isRunning ? `${percent}%` : "";
}

function setProgressLabel(text) {
  els.runProgressLabel.textContent = text;
}

function syncRelativeFlowYears() {
  document.querySelectorAll(".flow-row").forEach(updateFlowYearInputs);
}

function addFlowRow(container, flow) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  node.querySelector('[data-field="name"]').value = flow.name;
  node.querySelector('[data-field="amount"]').value = flow.amount;
  node.querySelector('[data-field="startMode"]').value = flow.startMode || "current";
  node.querySelector('[data-field="startYear"]').value = flow.startYear;
  node.querySelector('[data-field="endMode"]').value = flow.endMode || "death";
  node.querySelector('[data-field="endYear"]').value = flow.endYear;
  node.querySelector(".remove-flow").addEventListener("click", () => {
    node.remove();
    markDirty();
  });
  bindFormattedInputs(node);
  formatAllFormattedInputs(node);
  node.querySelectorAll("input, select").forEach((field) => {
    field.addEventListener("change", () => {
      updateFlowYearInputs(node);
      markDirty();
    });
  });
  updateFlowYearInputs(node);
  container.appendChild(node);
}

function updateFlowYearInputs(row) {
  const startYear = row.querySelector('[data-field="startYear"]');
  const endYear = row.querySelector('[data-field="endYear"]');
  startYear.hidden = row.querySelector('[data-field="startMode"]').value !== "fixed";
  endYear.hidden = row.querySelector('[data-field="endMode"]').value !== "fixed";
}

function readFlowRows(container, scenario) {
  return [...container.querySelectorAll(".flow-row")]
    .map((row) => {
      const name = row.querySelector('[data-field="name"]').value.trim();
      const startMode = row.querySelector('[data-field="startMode"]').value;
      const endMode = row.querySelector('[data-field="endMode"]').value;
      const startYear = resolveFlowYear(startMode, row.querySelector('[data-field="startYear"]'), scenario);
      const endYear = resolveFlowYear(endMode, row.querySelector('[data-field="endYear"]'), scenario);
      if (Number.isFinite(startYear)) validatePlanYear(startYear, `${name || "Cash flow"} start year`);
      if (Number.isFinite(endYear)) validatePlanYear(endYear, `${name || "Cash flow"} end year`);
      return {
        name,
        amount: numberFromInput(row.querySelector('[data-field="amount"]')),
        startMode,
        endMode,
        startYear,
        endYear
      };
    })
    .filter((flow) => (
      Number.isFinite(flow.amount) &&
      Number.isFinite(flow.startYear) &&
      Number.isFinite(flow.endYear) &&
      flow.amount > 0 &&
      flow.startYear <= flow.endYear
    ));
}

function resolveFlowYear(mode, fixedInput, scenario) {
  if (mode === "current") return scenario.currentYear;
  if (mode === "death") return scenario.deathYear;
  return numberFromInput(fixedInput);
}

function readScenario() {
  const scenario = {
    currentYear: numberFromInput(els.currentYear),
    deathYear: numberFromInput(els.deathYear),
    netWorth: numberFromInput(els.netWorth),
    betaMode: normalizeBetaMode(els.betaMode.value),
    spyBeta: numberFromInput(els.spyBeta),
    simulationCount: numberFromInput(els.simulationCount)
  };

  if (!Number.isFinite(scenario.currentYear) || !Number.isFinite(scenario.deathYear)) {
    throw new Error("Enter valid plan years.");
  }
  validatePlanYear(scenario.currentYear, "Current year");
  validatePlanYear(scenario.deathYear, "Expected year of death");
  if (scenario.deathYear < scenario.currentYear) {
    throw new Error("Expected year of death must be after the current year.");
  }
  const planLength = scenario.deathYear - scenario.currentYear + 1;
  if (planLength > MAX_PLAN_LENGTH_YEARS) {
    throw new Error(`Plan length cannot exceed ${MAX_PLAN_LENGTH_YEARS} years.`);
  }
  if (!Number.isFinite(scenario.netWorth) || scenario.netWorth < 0) {
    throw new Error("Enter a non-negative current net worth.");
  }
  if (scenario.betaMode === BETA_MODE_FIXED && !Number.isFinite(scenario.spyBeta)) {
    throw new Error("Enter a valid SPY beta.");
  }
  if (!Number.isFinite(scenario.simulationCount) || scenario.simulationCount < MIN_SIMULATION_COUNT) {
    throw new Error(`Run at least ${formatNumber(MIN_SIMULATION_COUNT)} simulations.`);
  }
  scenario.simulationCount = Math.round(scenario.simulationCount);
  if (scenario.simulationCount > MAX_SIMULATION_COUNT) {
    throw new Error(`Run no more than ${formatNumber(MAX_SIMULATION_COUNT)} simulations.`);
  }
  const simulationYearRows = scenario.simulationCount * planLength;
  if (simulationYearRows > MAX_SIMULATION_YEAR_ROWS) {
    throw new Error(`This run would create ${formatNumber(simulationYearRows)} detail rows. Reduce simulations or plan length below ${formatNumber(MAX_SIMULATION_YEAR_ROWS)} rows.`);
  }

  scenario.income = readFlowRows(els.incomeRows, scenario);
  scenario.expenses = readFlowRows(els.expenseRows, scenario);
  return scenario;
}

function applySharedPlanFromUrl() {
  const encodedPlan = getRawQueryParam("p");
  if (!encodedPlan) return null;

  try {
    const payload = decodeSharePayload(encodedPlan);
    return {
      seed: normalizeSeed(payload.seed),
      autorun: true
    };
  } catch (error) {
    return {
      error: `Could not load the shared plan. ${error.message}`
    };
  }
}

function applySharedScenario(scenario) {
  const sharedScenario = normalizeSharedScenario(scenario);

  els.currentYear.value = sharedScenario.currentYear;
  els.deathYear.value = sharedScenario.deathYear;
  els.netWorth.value = sharedScenario.netWorth;
  els.betaMode.value = sharedScenario.betaMode;
  els.spyBeta.value = sharedScenario.spyBeta;
  els.simulationCount.value = sharedScenario.simulationCount;
  updateBetaModeControls();

  els.incomeRows.replaceChildren();
  els.expenseRows.replaceChildren();
  sharedScenario.income.forEach((flow) => addFlowRow(els.incomeRows, flow));
  sharedScenario.expenses.forEach((flow) => addFlowRow(els.expenseRows, flow));
  formatAllFormattedInputs(document);
}

function normalizeSharedScenario(scenario) {
  if (!scenario || typeof scenario !== "object") {
    throw new Error("The shared scenario is missing.");
  }
  const currentYear = normalizeRequiredNumber(scenario.currentYear, "current year");
  const deathYear = normalizeRequiredNumber(scenario.deathYear, "death year");
  return {
    currentYear,
    deathYear,
    netWorth: normalizeRequiredNumber(scenario.netWorth, "current net worth"),
    betaMode: normalizeBetaMode(scenario.betaMode),
    spyBeta: normalizeRequiredNumber(scenario.spyBeta, "SPY beta"),
    simulationCount: normalizeRequiredNumber(scenario.simulationCount, "simulation count"),
    income: normalizeSharedFlows(scenario.income, "income"),
    expenses: normalizeSharedFlows(scenario.expenses, "expense")
  };
}

function normalizeSharedFlows(flows, type) {
  if (!Array.isArray(flows)) {
    throw new Error(`The shared ${type} rows are missing.`);
  }
  return flows.slice(0, MAX_SHARED_FLOWS).map((flow) => normalizeSharedFlow(flow, type));
}

function normalizeSharedFlow(flow, type) {
  if (!flow || typeof flow !== "object") {
    throw new Error(`A shared ${type} row is invalid.`);
  }
  const nameFallback = type === "income" ? "Income" : "Expense";
  return {
    name: typeof flow.name === "string" ? flow.name.slice(0, 80) : nameFallback,
    amount: normalizeRequiredNumber(flow.amount, `${type} amount`),
    startMode: normalizeSharedMode(flow.startMode, "current"),
    startYear: normalizeRequiredNumber(flow.startYear, `${type} start year`),
    endMode: normalizeSharedMode(flow.endMode, "death"),
    endYear: normalizeRequiredNumber(flow.endYear, `${type} end year`)
  };
}

function normalizeSharedMode(mode, fallback) {
  return ["current", "death", "fixed"].includes(mode) ? mode : fallback;
}

function normalizeBetaMode(mode) {
  return mode === BETA_MODE_DYNAMIC ? BETA_MODE_DYNAMIC : BETA_MODE_FIXED;
}

function normalizeRequiredNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`The shared ${label} is invalid.`);
  }
  return number;
}

async function sharePlan() {
  let seed;
  let url;
  try {
    const scenario = readScenario();
    seed = state.results && !state.isDirty && Number.isInteger(state.results.seed)
      ? state.results.seed
      : generateSimulationSeed();
    url = buildShareUrl(scenario, seed);
  } catch (error) {
    els.scenarioSummary.textContent = `Fix inputs before sharing. ${error.message}`;
    setShareStatus("Fix inputs");
    return;
  }

  try {
    await copyText(url);
    if (state.isDirty) {
      state.nextSimulationSeed = seed;
    }
    setShareStatus("Copied");
  } catch (error) {
    els.scenarioSummary.textContent = `Could not copy the share link. ${error.message}`;
    setShareStatus("Copy failed");
  }
}

function buildShareUrl(scenario, seed) {
  const url = new URL(window.location.href);
  return `${url.origin}${url.pathname}?p=${encodeSharePayload(scenario, seed)}`;
}

function encodeSharePayload(scenario, seed) {
  const plan = [
    scenario.currentYear,
    scenario.deathYear,
    scenario.netWorth,
    scenario.spyBeta,
    scenario.simulationCount
  ].map(formatShareNumber);
  plan.push(encodeBetaMode(scenario.betaMode));

  return [
    formatShareNumber(seed),
    plan.join(","),
    scenario.income.map(encodeSharedFlow).join(";"),
    scenario.expenses.map(encodeSharedFlow).join(";")
  ].join("~");
}

function decodeSharePayload(payload) {
  const parts = payload.split("~");
  if (parts.length !== 4) {
    throw new Error("The link format is not supported.");
  }
  const plan = parts[1].split(",");
  if (plan.length !== 5 && plan.length !== 6) {
    throw new Error("The shared scenario is missing.");
  }
  const scenario = {
    currentYear: parseSharedNumber(plan[0], "current year"),
    deathYear: parseSharedNumber(plan[1], "death year"),
    netWorth: parseSharedNumber(plan[2], "current net worth"),
    spyBeta: parseSharedNumber(plan[3], "SPY beta"),
    simulationCount: parseSharedNumber(plan[4], "simulation count"),
    betaMode: plan.length === 6 ? decodeBetaMode(plan[5]) : BETA_MODE_FIXED
  };
  scenario.income = decodeSharedFlows(parts[2], "income", scenario);
  scenario.expenses = decodeSharedFlows(parts[3], "expense", scenario);
  applySharedScenario(scenario);
  return {
    seed: parseSharedNumber(parts[0], "simulation seed")
  };
}

function encodeBetaMode(mode) {
  return normalizeBetaMode(mode) === BETA_MODE_DYNAMIC ? "d" : "f";
}

function decodeBetaMode(value) {
  return value === "d" ? BETA_MODE_DYNAMIC : BETA_MODE_FIXED;
}

function encodeSharedFlow(flow) {
  return [
    encodeShareText(flow.name),
    formatShareNumber(flow.amount),
    encodeFlowMode(flow.startMode),
    flow.startMode === "fixed" ? formatShareNumber(flow.startYear) : "",
    encodeFlowMode(flow.endMode),
    flow.endMode === "fixed" ? formatShareNumber(flow.endYear) : ""
  ].join(",");
}

function decodeSharedFlows(value, type, scenario) {
  if (value === "") return [];
  return value.split(";").slice(0, MAX_SHARED_FLOWS).map((flow) => decodeSharedFlow(flow, type, scenario));
}

function decodeSharedFlow(value, type, scenario) {
  const flow = value.split(",");
  if (flow.length !== 6) {
    throw new Error("A shared cash flow row is invalid.");
  }
  const startMode = decodeFlowMode(flow[2]);
  const endMode = decodeFlowMode(flow[4]);
  return {
    name: decodeShareText(flow[0]),
    amount: parseSharedNumber(flow[1], `${type} amount`),
    startMode,
    startYear: startMode === "fixed" ? parseSharedNumber(flow[3], `${type} start year`) : scenario.currentYear,
    endMode,
    endYear: endMode === "fixed" ? parseSharedNumber(flow[5], `${type} end year`) : scenario.deathYear
  };
}

function encodeFlowMode(mode) {
  if (mode === "current") return "c";
  if (mode === "death") return "d";
  return "f";
}

function decodeFlowMode(mode) {
  if (mode === "c") return "current";
  if (mode === "d") return "death";
  if (mode === "f") return "fixed";
  throw new Error("A shared cash flow mode is invalid.");
}

function formatShareNumber(value) {
  const text = String(Number(value));
  return text.startsWith("0.") ? text.slice(1) : text;
}

function parseSharedNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`The shared ${label} is invalid.`);
  }
  return number;
}

function encodeShareText(text) {
  return encodeURIComponent(text).replace(/%20/g, "+").replace(/~/g, "%7E");
}

function decodeShareText(encoded) {
  return decodeURIComponent(encoded.replace(/\+/g, "%20"));
}

function getRawQueryParam(name) {
  const query = window.location.search.startsWith("?")
    ? window.location.search.slice(1)
    : window.location.search;
  for (const pair of query.split("&")) {
    const separatorIndex = pair.indexOf("=");
    const rawKey = separatorIndex === -1 ? pair : pair.slice(0, separatorIndex);
    if (decodeURIComponent(rawKey) === name) {
      return separatorIndex === -1 ? "" : pair.slice(separatorIndex + 1);
    }
  }
  return null;
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  fallbackCopyText(text);
}

function fallbackCopyText(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Copy failed.");
  }
}

function setShareStatus(text) {
  window.clearTimeout(state.shareStatusTimer);
  els.sharePlan.textContent = text;
  state.shareStatusTimer = window.setTimeout(() => {
    els.sharePlan.textContent = "Share";
  }, 1800);
}

function validatePlanYear(year, label) {
  if (!Number.isInteger(year) || year < MIN_PLAN_YEAR || year > MAX_PLAN_YEAR) {
    throw new Error(`${label} must be between ${MIN_PLAN_YEAR} and ${MAX_PLAN_YEAR}.`);
  }
}

function numberFromInput(input) {
  const raw = input.value.trim().replace(/[$,\s]/g, "");
  return raw === "" ? Number.NaN : Number(raw);
}

function bindFormattedInputs(root) {
  root.querySelectorAll("[data-format]").forEach((input) => {
    if (input.dataset.formatBound === "true") return;
    input.dataset.formatBound = "true";
    input.addEventListener("focus", () => {
      input.select();
    });
    input.addEventListener("input", () => {
      formatInputValue(input, { preserveCaret: true, editing: true });
    });
    input.addEventListener("blur", () => {
      formatInputValue(input);
    });
  });
}

function formatAllFormattedInputs(root) {
  root.querySelectorAll("[data-format]").forEach(formatInputValue);
}

function formatInputValue(input, options = {}) {
  const value = numberFromInput(input);
  if (input.value.trim() === "") return;

  if (options.editing) {
    formatInputWhileEditing(input, options);
    return;
  }

  if (!Number.isFinite(value)) {
    input.value = "";
    return;
  }
  if (input.dataset.format === "money") {
    input.value = formatInputCurrency(value);
    return;
  }
  if (input.dataset.format === "integer") {
    input.value = formatNumber(Math.round(value));
  }
}

function formatInputWhileEditing(input, options = {}) {
  const caret = input.selectionStart ?? input.value.length;
  const digitsBeforeCaret = countDigits(input.value.slice(0, caret));
  const formatted = input.dataset.format === "money"
    ? formatEditableMoney(input.value)
    : formatEditableInteger(input.value);

  input.value = formatted;
  if (options.preserveCaret) {
    const nextCaret = caretAfterDigitCount(formatted, digitsBeforeCaret);
    input.setSelectionRange(nextCaret, nextCaret);
  }
}

function formatEditableMoney(raw) {
  const cleaned = raw.replace(/[$,\s]/g, "").replace(/[^\d.]/g, "");
  if (!cleaned) return "";
  const firstDot = cleaned.indexOf(".");
  const wholeRaw = firstDot === -1 ? cleaned : cleaned.slice(0, firstDot);
  const decimalRaw = firstDot === -1 ? "" : cleaned.slice(firstDot + 1).replace(/\./g, "").slice(0, 2);
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const suffix = firstDot === -1 ? "" : `.${decimalRaw}`;
  return `$${formatDigitsWithCommas(whole)}${suffix}`;
}

function formatEditableInteger(raw) {
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits ? formatDigitsWithCommas(digits) : "";
}

function formatDigitsWithCommas(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function countDigits(value) {
  return (value.match(/\d/g) || []).length;
}

function caretAfterDigitCount(value, digitCount) {
  if (digitCount <= 0) {
    const firstDigit = value.search(/\d/);
    return firstDigit === -1 ? value.length : firstDigit;
  }

  let seen = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (/\d/.test(value[index])) {
      seen += 1;
      if (seen === digitCount) return index + 1;
    }
  }
  return value.length;
}

async function runSimulation() {
  if (state.isRunning) {
    requestSimulationCancel();
    return;
  }
  if (!state.marketData || !state.isDirty) return;

  const runVersion = state.inputVersion;
  let scenario;
  try {
    scenario = readScenario();
  } catch (error) {
    els.scenarioSummary.textContent = error.message;
    state.isDirty = true;
    updateRunState();
    return;
  }

  const seed = Number.isInteger(state.nextSimulationSeed)
    ? state.nextSimulationSeed
    : generateSimulationSeed();
  state.nextSimulationSeed = null;
  const random = createSeededRandom(seed);

  state.isRunning = true;
  state.cancelRequested = false;
  state.hover = null;
  state.detailHover = null;
  showProgress();
  updateRunState();
  await yieldToBrowser();

  try {
    const results = await simulateScenario(
      scenario,
      state.marketData.returns,
      random,
      setProgress,
      () => state.cancelRequested
    );
    results.seed = seed;
    state.results = results;
    state.isDirty = state.inputVersion !== runVersion;
    renderResults(results);
  } catch (error) {
    els.scenarioSummary.textContent = isCancellationError(error)
      ? "Simulation stopped. Fix the inputs and run again."
      : error.message;
    state.isDirty = true;
  } finally {
    state.isRunning = false;
    state.cancelRequested = false;
    hideProgress();
    updateRunState();
  }
}

function requestSimulationCancel() {
  state.cancelRequested = true;
  setProgressLabel("Stopping...");
  updateRunState();
}

function isCancellationError(error) {
  return error && error.name === "SimulationCanceledError";
}

function throwIfCanceled(shouldCancel) {
  if (!shouldCancel()) return;
  const error = new Error("Simulation canceled.");
  error.name = "SimulationCanceledError";
  throw error;
}

async function simulateScenario(scenario, returnRows, random = Math.random, onProgress = () => {}, shouldCancel = () => false) {
  if (!returnRows.length) {
    throw new Error("No historical market data loaded.");
  }

  const years = range(scenario.currentYear, scenario.deathYear);
  const isDynamicBeta = scenario.betaMode === BETA_MODE_DYNAMIC;
  const dynamicPolicy = isDynamicBeta
    ? await buildDynamicBetaPolicy(scenario, returnRows, years, onProgress, shouldCancel)
    : null;
  const failures = [];
  const terminalWealth = [];
  const simulationRows = [];
  const simulationYearRows = [];
  const simulationYearRowsBySimulation = new Map();
  const visualPaths = [];
  const wealthSums = new Array(years.length).fill(0);
  const betaSums = new Array(years.length).fill(0);
  const betaCounts = new Array(years.length).fill(0);

  onProgress(isDynamicBeta ? DYNAMIC_POLICY_PROGRESS_SHARE : 0);
  for (let i = 0; i < scenario.simulationCount; i += 1) {
    throwIfCanceled(shouldCancel);
    if (i > 0 && i % SIMULATION_CHUNK_SIZE === 0) {
      const simulationProgress = i / scenario.simulationCount;
      onProgress(isDynamicBeta
        ? DYNAMIC_POLICY_PROGRESS_SHARE + simulationProgress * (1 - DYNAMIC_POLICY_PROGRESS_SHARE)
        : simulationProgress);
      await yieldToBrowser();
      throwIfCanceled(shouldCancel);
    }

    let wealth = scenario.netWorth;
    let failureYear = null;
    let sampledReturnCount = 0;
    let sampledNominalReturnSum = 0;
    let sampledRealReturnSum = 0;
    const sampledReturnPath = isDynamicBeta
      ? null
      : buildSampledReturnPath(returnRows, years.length, RETURN_BLOCK_YEARS, random);
    const path = [];
    const betaPath = [];
    const pathYearRows = [];

    for (let yearIndex = 0; yearIndex < years.length; yearIndex += 1) {
      const year = years[yearIndex];

      if (wealth > 0) {
        const income = cashFlowForYear(scenario.income, year);
        const expenses = cashFlowForYear(scenario.expenses, year);
        const netCashFlow = income - expenses;
        const sampledReturn = isDynamicBeta
          ? buildAnnualSampledReturn(returnRows, random)
          : sampledReturnPath[yearIndex];
        const spyBetaUsed = isDynamicBeta
          ? selectDynamicBeta(dynamicPolicy, yearIndex, wealth)
          : scenario.spyBeta;
        const returnMetrics = buildReturnMetrics(sampledReturn.row, spyBetaUsed);
        const yearResult = applyContinuousYear(wealth, netCashFlow, returnMetrics.realGrowthFactor);

        sampledReturnCount += 1;
        sampledNominalReturnSum += returnMetrics.nominalSpyReturn;
        sampledRealReturnSum += returnMetrics.realSpyReturn;
        wealth = yearResult.endingWealth;

        if (yearResult.depleted) {
          wealth = 0;
          failureYear = year;
        }

        const simulationYearRow = {
          simulation: i + 1,
          year,
          historicalReturnYear: sampledReturn.row.year,
          historicalBlockStartYear: sampledReturn.blockStartYear,
          historicalBlockEndYear: sampledReturn.blockEndYear,
          startingWealth: yearResult.startingWealth,
          income,
          expenses,
          netCashFlow,
          nominalSpyReturn: returnMetrics.nominalSpyReturn,
          nominalRiskFreeReturn: returnMetrics.nominalRiskFreeReturn,
          nominalSpyExcessReturn: returnMetrics.nominalSpyExcessReturn,
          spyBetaUsed,
          nominalPortfolioReturn: returnMetrics.nominalPortfolioReturn,
          inflation: returnMetrics.inflation,
          realSpyReturn: returnMetrics.realSpyReturn,
          realRiskFreeReturn: returnMetrics.realRiskFreeReturn,
          portfolioRealReturn: returnMetrics.realGrowthFactor - 1,
          endingWealth: wealth,
          depletedThisYear: yearResult.depleted,
          depletionYear: yearResult.depleted ? year : ""
        };
        simulationYearRows.push(simulationYearRow);
        pathYearRows.push(simulationYearRow);
      } else {
        const simulationYearRow = {
          simulation: i + 1,
          year,
          historicalReturnYear: "",
          historicalBlockStartYear: "",
          historicalBlockEndYear: "",
          startingWealth: 0,
          income: 0,
          expenses: 0,
          netCashFlow: 0,
          nominalSpyReturn: "",
          nominalRiskFreeReturn: "",
          nominalSpyExcessReturn: "",
          spyBetaUsed: "",
          nominalPortfolioReturn: "",
          inflation: "",
          realSpyReturn: "",
          realRiskFreeReturn: "",
          portfolioRealReturn: "",
          endingWealth: 0,
          depletedThisYear: false,
          depletionYear: failureYear || ""
        };
        simulationYearRows.push(simulationYearRow);
        pathYearRows.push(simulationYearRow);
      }

      wealthSums[yearIndex] += wealth;
      path.push({ year, wealth });
      const betaForPath = pathYearRows[pathYearRows.length - 1]?.spyBetaUsed;
      if (Number.isFinite(betaForPath)) {
        betaSums[yearIndex] += betaForPath;
        betaCounts[yearIndex] += 1;
        betaPath.push({ year, beta: betaForPath });
      } else {
        betaPath.push({ year, beta: null });
      }
    }

    const pathResult = {
      simulation: i + 1,
      points: path,
      betaPoints: betaPath,
      terminalWealth: wealth,
      averageNominalSpyReturn: sampledReturnCount ? sampledNominalReturnSum / sampledReturnCount : null,
      averageRealSpyReturn: sampledReturnCount ? sampledRealReturnSum / sampledReturnCount : null,
      failureYear
    };
    addReservoirSample(visualPaths, pathResult, i, MAX_VISUAL_PATHS, random);
    failures.push(failureYear);
    terminalWealth.push(wealth);
    simulationRows.push({
      simulation: i + 1,
      failureYear,
      terminalWealth: wealth,
      averageNominalSpyReturn: pathResult.averageNominalSpyReturn,
      averageRealSpyReturn: pathResult.averageRealSpyReturn,
      sampledReturnYears: sampledReturnCount
    });
    simulationYearRowsBySimulation.set(i + 1, pathYearRows);
  }
  onProgress(1);

  const failureYears = failures.filter(Boolean);
  const depletedDistribution = buildDepletedDistribution(failureYears, scenario);
  const notDepletedCount = failures.length - failureYears.length;
  const worstSurvivingPath = getWorstSurvivingPath(simulationRows);
  const terminalWealthSorted = [...terminalWealth].sort((a, b) => a - b);
  const expectedPath = years.map((year, index) => ({
    year,
    wealth: wealthSums[index] / scenario.simulationCount
  }));
  const expectedBetaPath = years.map((year, index) => ({
    year,
    beta: betaCounts[index] ? betaSums[index] / betaCounts[index] : null
  }));
  visualPaths.forEach((path) => {
    path.endingPercentile = percentileRank(terminalWealthSorted, path.terminalWealth);
  });
  simulationRows.forEach((row) => {
    row.endingPercentile = percentileRank(terminalWealthSorted, row.terminalWealth);
  });
  const inspectionPaths = [...visualPaths].sort(compareInspectionPaths);

  return {
    scenario,
    dynamicPolicy,
    years,
    failures,
    failureYears,
    simulationRows,
    simulationYearRows,
    simulationYearRowsBySimulation,
    terminalWealth,
    terminalWealthSorted,
    visualPaths,
    inspectionPaths,
    expectedPath,
    expectedBetaPath,
    depletedDistribution,
    notDepletedCount,
    risk: failureYears.length / failures.length,
    earliestFailureYear: failureYears.length ? Math.min(...failureYears) : null,
    worstSurvivingPath,
    medianTerminalWealth: percentile(terminalWealth, 0.5)
  };
}

function getWorstSurvivingPath(simulationRows) {
  return simulationRows
    .filter((row) => !row.failureYear)
    .reduce((worst, row) => {
      if (!worst || row.terminalWealth < worst.terminalWealth) return row;
      return worst;
    }, null);
}

function applyContinuousYear(startingWealth, netCashFlow, realGrowthFactor) {
  const logReturn = Math.log(realGrowthFactor);
  const endingWealth = wealthAtTime(startingWealth, netCashFlow, logReturn, 1);
  return {
    startingWealth,
    endingWealth: Math.max(0, endingWealth),
    depleted: endingWealth <= 0
  };
}

function wealthAtTime(startingWealth, netCashFlow, logReturn, yearsElapsed) {
  if (Math.abs(logReturn) < 0.0000001) {
    return startingWealth + netCashFlow * yearsElapsed;
  }
  const growth = Math.exp(logReturn * yearsElapsed);
  return startingWealth * growth + netCashFlow * ((growth - 1) / logReturn);
}

function addReservoirSample(samples, item, seenIndex, maxSamples, random = Math.random) {
  if (samples.length < maxSamples) {
    samples.push(item);
    return;
  }
  const replacementIndex = randomIndex(seenIndex + 1, random);
  if (replacementIndex < maxSamples) {
    samples[replacementIndex] = item;
  }
}

function buildSampledReturnPath(returnRows, pathLength, blockYears, random = Math.random) {
  const path = [];
  const blockLength = Math.min(blockYears, returnRows.length);
  const maxStartIndex = returnRows.length - blockLength;

  while (path.length < pathLength) {
    const startIndex = randomIndex(maxStartIndex + 1, random);
    const endIndex = startIndex + blockLength - 1;
    const blockStartYear = returnRows[startIndex].year;
    const blockEndYear = returnRows[endIndex].year;

    for (let offset = 0; offset < blockLength && path.length < pathLength; offset += 1) {
      path.push({
        row: returnRows[startIndex + offset],
        blockStartYear,
        blockEndYear
      });
    }
  }

  return path;
}

function buildAnnualSampledReturn(returnRows, random = Math.random) {
  return {
    row: returnRows[randomIndex(returnRows.length, random)],
    blockStartYear: "",
    blockEndYear: ""
  };
}

function buildReturnMetrics(returnRow, spyBeta) {
  const nominalSpyReturn = returnRow.nominalReturn ?? returnRow.return;
  const nominalRiskFreeReturn = returnRow.riskFreeReturn ?? 0;
  const nominalSpyExcessReturn = nominalSpyReturn - nominalRiskFreeReturn;
  const inflation = returnRow.inflation ?? 0;
  const realSpyReturn = ((1 + nominalSpyReturn) / Math.max(0.000001, 1 + inflation)) - 1;
  const realRiskFreeReturn = ((1 + nominalRiskFreeReturn) / Math.max(0.000001, 1 + inflation)) - 1;
  const nominalPortfolioReturn = nominalRiskFreeReturn + spyBeta * nominalSpyExcessReturn;
  const nominalGrowthFactor = Math.max(0.000001, 1 + nominalPortfolioReturn);
  const realGrowthFactor = nominalGrowthFactor / Math.max(0.000001, 1 + inflation);
  return {
    nominalSpyReturn,
    nominalRiskFreeReturn,
    nominalSpyExcessReturn,
    spyBeta,
    nominalPortfolioReturn,
    inflation,
    realSpyReturn,
    realRiskFreeReturn,
    realGrowthFactor
  };
}

async function buildDynamicBetaPolicy(scenario, returnRows, years, onProgress, shouldCancel) {
  const wealthBuckets = buildDynamicWealthBuckets(scenario);
  const valueByYear = new Array(years.length + 1);
  const expectedWealthByYear = new Array(years.length + 1);
  const policyByYear = new Array(years.length);
  let nextValues = new Array(wealthBuckets.length).fill(0);
  let nextExpectedWealth = [...wealthBuckets];
  valueByYear[years.length] = nextValues;
  expectedWealthByYear[years.length] = nextExpectedWealth;

  for (let yearIndex = years.length - 1; yearIndex >= 0; yearIndex -= 1) {
    throwIfCanceled(shouldCancel);
    const year = years[yearIndex];
    const netCashFlow = cashFlowForYear(scenario.income, year) - cashFlowForYear(scenario.expenses, year);
    const currentValues = new Array(wealthBuckets.length);
    const currentExpectedWealth = new Array(wealthBuckets.length);
    const currentPolicy = new Array(wealthBuckets.length);

    for (let bucketIndex = 0; bucketIndex < wealthBuckets.length; bucketIndex += 1) {
      const startingWealth = wealthBuckets[bucketIndex];
      if (startingWealth <= 0) {
        currentValues[bucketIndex] = 1;
        currentExpectedWealth[bucketIndex] = 0;
        currentPolicy[bucketIndex] = 0;
        continue;
      }

      let bestDepletionRisk = Number.POSITIVE_INFINITY;
      let bestExpectedWealth = Number.NEGATIVE_INFINITY;
      let bestBeta = DYNAMIC_BETA_VALUES[0];

      DYNAMIC_BETA_VALUES.forEach((beta) => {
        let totalDepletionRisk = 0;
        let totalExpectedWealth = 0;
        returnRows.forEach((returnRow) => {
          const returnMetrics = buildReturnMetrics(returnRow, beta);
          const yearResult = applyContinuousYear(startingWealth, netCashFlow, returnMetrics.realGrowthFactor);
          if (yearResult.depleted) {
            totalDepletionRisk += 1;
            return;
          }
          totalDepletionRisk += interpolateBucketValue(wealthBuckets, nextValues, yearResult.endingWealth);
          totalExpectedWealth += interpolateBucketValue(wealthBuckets, nextExpectedWealth, yearResult.endingWealth);
        });
        const actionDepletionRisk = totalDepletionRisk / returnRows.length;
        const actionExpectedWealth = totalExpectedWealth / returnRows.length;

        if (actionDepletionRisk < bestDepletionRisk - EPSILON) {
          bestDepletionRisk = actionDepletionRisk;
          bestExpectedWealth = actionExpectedWealth;
          bestBeta = beta;
        } else if (
          Math.abs(actionDepletionRisk - bestDepletionRisk) <= EPSILON &&
          actionExpectedWealth > bestExpectedWealth + EPSILON
        ) {
          bestExpectedWealth = actionExpectedWealth;
          bestBeta = beta;
        }
      });

      currentValues[bucketIndex] = bestDepletionRisk;
      currentExpectedWealth[bucketIndex] = bestExpectedWealth;
      currentPolicy[bucketIndex] = bestBeta;
    }

    valueByYear[yearIndex] = currentValues;
    expectedWealthByYear[yearIndex] = currentExpectedWealth;
    policyByYear[yearIndex] = currentPolicy;
    nextValues = currentValues;
    nextExpectedWealth = currentExpectedWealth;
    onProgress(((years.length - yearIndex) / years.length) * DYNAMIC_POLICY_PROGRESS_SHARE);
    if (yearIndex % 4 === 0) {
      await yieldToBrowser();
    }
  }

  return {
    betaValues: DYNAMIC_BETA_VALUES,
    wealthBuckets,
    valueByYear,
    expectedWealthByYear,
    policyByYear
  };
}

function buildDynamicWealthBuckets(scenario) {
  const wealthCap = Math.max(DYNAMIC_MAX_WEALTH_BUCKET, scenario.netWorth);
  const buckets = [0];
  const minPositiveWealth = DYNAMIC_MIN_POSITIVE_WEALTH_BUCKET;
  const logMax = Math.log(wealthCap);

  for (let index = 0; index < DYNAMIC_WEALTH_BUCKETS; index += 1) {
    const t = index / Math.max(1, DYNAMIC_WEALTH_BUCKETS - 1);
    buckets.push(minPositiveWealth * Math.exp(t * (logMax - Math.log(minPositiveWealth))));
  }

  return buckets;
}

function selectDynamicBeta(policy, yearIndex, wealth) {
  const policyRow = policy.policyByYear[yearIndex];
  if (!policyRow) return DYNAMIC_BETA_VALUES[0];
  return policyRow[nearestBucketIndex(policy.wealthBuckets, wealth)] ?? DYNAMIC_BETA_VALUES[0];
}

function interpolateBucketValue(buckets, values, wealth) {
  if (wealth <= 0) return 1;
  if (wealth >= buckets[buckets.length - 1]) return values[values.length - 1];

  const upperIndex = upperBucketIndex(buckets, wealth);
  const lowerIndex = Math.max(0, upperIndex - 1);
  const lowerWealth = buckets[lowerIndex];
  const upperWealth = buckets[upperIndex];
  if (upperWealth <= lowerWealth) return values[lowerIndex];

  const t = (wealth - lowerWealth) / (upperWealth - lowerWealth);
  return values[lowerIndex] + (values[upperIndex] - values[lowerIndex]) * t;
}

function nearestBucketIndex(buckets, wealth) {
  if (wealth <= buckets[0]) return 0;
  if (wealth < buckets[1]) return 1;
  if (wealth >= buckets[buckets.length - 1]) return buckets.length - 1;

  const upperIndex = upperBucketIndex(buckets, wealth);
  const lowerIndex = Math.max(0, upperIndex - 1);
  return wealth - buckets[lowerIndex] <= buckets[upperIndex] - wealth
    ? lowerIndex
    : upperIndex;
}

function upperBucketIndex(buckets, wealth) {
  let low = 0;
  let high = buckets.length - 1;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (buckets[mid] < wealth) low = mid + 1;
    else high = mid;
  }

  return low;
}

function yieldToBrowser() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function cashFlowForYear(flows, year) {
  return flows.reduce((sum, flow) => {
    if (year < flow.startYear || year > flow.endYear) return sum;
    return sum + flow.amount;
  }, 0);
}

function buildDepletedDistribution(failureYears, scenario) {
  const counts = new Map();
  for (const failureYear of failureYears) {
    counts.set(String(failureYear), (counts.get(String(failureYear)) || 0) + 1);
  }

  return range(scenario.currentYear, scenario.deathYear)
    .map((year) => ({ label: String(year), count: counts.get(String(year)) || 0 }))
    .filter((row) => row.count > 0);
}

function compareInspectionPaths(a, b) {
  const wealthDifference = a.terminalWealth - b.terminalWealth;
  if (wealthDifference !== 0) return wealthDifference;
  return depletionSortYear(a) - depletionSortYear(b);
}

function depletionSortYear(path) {
  return path.failureYear || Number.POSITIVE_INFINITY;
}

function renderResults(results) {
  const simulations = results.scenario.simulationCount;
  els.simulationSelect.disabled = false;
  els.downloadCsv.disabled = false;
  els.riskMetric.textContent = formatPercent(results.risk);
  els.medianWealthMetric.textContent = formatCompactCurrency(results.medianTerminalWealth);
  els.medianWealthMetric.title = formatCurrency(results.medianTerminalWealth);
  els.currentBetaMetricLabel.textContent = results.scenario.betaMode === BETA_MODE_DYNAMIC
    ? "Current recommended SPY beta"
    : "Current SPY beta";
  els.currentBetaMetric.textContent = formatBeta(getCurrentBeta(results));
  updateScenarioSummary(results);
  els.netWorthSummary.textContent = `Expected current-dollar net worth across all ${formatNumber(simulations)} simulations, with ${formatNumber(results.visualPaths.length)} downsampled paths for hover inspection.`;

  renderSimulationSelect(results);
  renderSimulationPathTable(results);
  renderDynamicPolicyControls(results);
  renderCharts(results);
}

function resetDetailsControls() {
  const option = document.createElement("option");
  option.value = "";
  option.textContent = "Run simulation first";
  els.simulationSelect.replaceChildren(option);
  els.simulationSelect.disabled = true;
  els.downloadCsv.disabled = true;
  els.downloadPolicyCsv.disabled = true;
  els.dynamicPolicySection.hidden = true;
  els.policyYearSelect.replaceChildren();
  els.dynamicPolicyTable.innerHTML = `<tr><td colspan="6">Run dynamic beta to inspect the policy.</td></tr>`;
  els.dynamicPolicySummary.textContent = "Run dynamic beta to inspect the policy.";
  els.selectedSimulationSummary.textContent = "Run a simulation to inspect one path.";
}

function getCurrentBeta(results) {
  if (results.scenario.betaMode !== BETA_MODE_DYNAMIC || !results.dynamicPolicy) {
    return results.scenario.spyBeta;
  }
  return selectDynamicBeta(results.dynamicPolicy, 0, results.scenario.netWorth);
}

function updateScenarioSummary(results) {
  const simulations = results.scenario.simulationCount;
  const modeText = results.scenario.betaMode === BETA_MODE_DYNAMIC
    ? "Dynamic beta used a causal annual bootstrap and year/wealth policy."
    : `Fixed beta ${formatBeta(results.scenario.spyBeta)} used 5-year historical return blocks.`;
  const depletedText = `${formatNumber(results.failureYears.length)} of ${formatNumber(simulations)} paths depleted (${formatPercent(results.risk)}).`;
  const notDepletedText = `${formatNumber(results.notDepletedCount)} paths did not deplete (${formatPercent(1 - results.risk)}).`;
  const chartText = els.showDepleted.checked
    ? "The chart shows only depleted paths, while probabilities still use all simulations as the denominator."
    : "The chart includes both depleted and not-depleted paths.";
  els.scenarioSummary.textContent = `${modeText} ${depletedText} ${notDepletedText} ${chartText}`;
}

function renderSimulationSelect(results) {
  const previousValue = Number(els.simulationSelect.value) || 1;
  const fragment = document.createDocumentFragment();

  results.inspectionPaths.forEach((path, index) => {
    const option = document.createElement("option");
    const rankLabel = `#${formatNumber(index + 1)}`;
    option.value = String(path.simulation);
    option.textContent = path.failureYear
      ? `${rankLabel} · ${formatCurrency(path.terminalWealth)} · dep ${path.failureYear}`
      : `${rankLabel} · ${formatCurrency(path.terminalWealth)}`;
    fragment.appendChild(option);
  });

  els.simulationSelect.replaceChildren(fragment);
  const hasPreviousSelection = results.inspectionPaths.some((path) => path.simulation === previousValue);
  els.simulationSelect.value = hasPreviousSelection
    ? String(previousValue)
    : String(results.inspectionPaths[0]?.simulation || 1);
}

function renderSimulationPathTable(results) {
  const selectedSimulation = Number(els.simulationSelect.value) || 1;
  const rows = results.simulationYearRowsBySimulation.get(selectedSimulation) || [];
  if (!rows.length) {
    els.simulationPathTable.innerHTML = `<tr><td colspan="16">No rows for this simulation.</td></tr>`;
    return;
  }

  els.simulationPathTable.innerHTML = rows.map((row) => {
    const status = row.depletedThisYear
      ? "Depleted"
      : row.depletionYear
        ? `After depletion (${row.depletionYear})`
        : "Active";
    return [
      "<tr>",
      `<td>${row.year}</td>`,
      `<td>${row.historicalReturnYear || "--"}</td>`,
      `<td>${formatHistoricalBlock(row)}</td>`,
      `<td>${formatCurrency(row.startingWealth)}</td>`,
      `<td>${formatCurrency(row.income)}</td>`,
      `<td>${formatCurrency(row.expenses)}</td>`,
      `<td>${formatPercent(row.nominalSpyReturn)}</td>`,
      `<td>${formatPercent(row.nominalRiskFreeReturn)}</td>`,
      `<td>${formatPercent(row.nominalSpyExcessReturn)}</td>`,
      `<td>${formatBeta(row.spyBetaUsed)}</td>`,
      `<td>${formatPercent(row.inflation)}</td>`,
      `<td>${formatPercent(row.realSpyReturn)}</td>`,
      `<td>${formatPercent(row.nominalPortfolioReturn)}</td>`,
      `<td>${formatPercent(row.portfolioRealReturn)}</td>`,
      `<td>${formatCurrency(row.endingWealth)}</td>`,
      `<td>${status}</td>`,
      "</tr>"
    ].join("");
  }).join("");
}

function renderDynamicPolicyControls(results) {
  const hasDynamicPolicy = results.scenario.betaMode === BETA_MODE_DYNAMIC && results.dynamicPolicy;
  els.dynamicPolicySection.hidden = !hasDynamicPolicy;
  els.downloadPolicyCsv.disabled = !hasDynamicPolicy;
  if (!hasDynamicPolicy) return;

  const previousYear = Number(els.policyYearSelect.value) || results.scenario.currentYear;
  const fragment = document.createDocumentFragment();
  results.years.forEach((year) => {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    fragment.appendChild(option);
  });
  els.policyYearSelect.replaceChildren(fragment);
  els.policyYearSelect.value = results.years.includes(previousYear)
    ? String(previousYear)
    : String(results.scenario.currentYear);
  renderDynamicPolicyTable(results);
}

function renderDynamicPolicyTable(results) {
  if (results.scenario.betaMode !== BETA_MODE_DYNAMIC || !results.dynamicPolicy) return;

  const selectedYear = Number(els.policyYearSelect.value) || results.scenario.currentYear;
  const yearIndex = results.years.indexOf(selectedYear);
  if (yearIndex < 0) {
    els.dynamicPolicyTable.innerHTML = `<tr><td colspan="6">No policy rows for this year.</td></tr>`;
    return;
  }

  const selectedSimulation = Number(els.simulationSelect.value) || 1;
  const selectedRows = results.simulationYearRowsBySimulation.get(selectedSimulation) || [];
  const selectedPathRow = selectedRows.find((row) => row.year === selectedYear);
  const selectedBucketIndex = selectedPathRow && selectedPathRow.startingWealth > 0
    ? nearestBucketIndex(results.dynamicPolicy.wealthBuckets, selectedPathRow.startingWealth)
    : null;
  const currentBucketIndex = selectedYear === results.scenario.currentYear
    ? nearestBucketIndex(results.dynamicPolicy.wealthBuckets, results.scenario.netWorth)
    : null;
  const rows = getDynamicPolicyRows(results, yearIndex);

  els.dynamicPolicySummary.textContent = selectedPathRow && selectedPathRow.startingWealth > 0
    ? `${selectedYear} · sim ${formatNumber(selectedSimulation)} · ${formatCurrency(selectedPathRow.startingWealth)} · beta ${formatBeta(selectedPathRow.spyBetaUsed)}`
    : `${selectedYear} policy · pick a simulation in Inspect Simulation to mark its bucket`;

  els.dynamicPolicyTable.innerHTML = rows.map((row) => {
    const markers = [];
    if (row.bucketIndex === selectedBucketIndex) markers.push("Selected path");
    if (row.bucketIndex === currentBucketIndex) markers.push("Current wealth");
    return [
      "<tr>",
      `<td>${formatNumber(row.bucketIndex)}</td>`,
      `<td>${formatCurrency(row.wealth)}</td>`,
      `<td>${formatBeta(row.beta)}</td>`,
      `<td>${formatPercent(row.estimatedDepletionRisk)}</td>`,
      `<td>${formatCurrency(row.expectedTerminalWealth)}</td>`,
      `<td>${markers.join(", ") || "--"}</td>`,
      "</tr>"
    ].join("");
  }).join("");
}

function getDynamicPolicyRows(results, yearIndex) {
  const policy = results.dynamicPolicy;
  const policyRow = policy.policyByYear[yearIndex] || [];
  const valueRow = policy.valueByYear[yearIndex] || [];
  const expectedWealthRow = policy.expectedWealthByYear[yearIndex] || [];
  return policy.wealthBuckets.map((wealth, bucketIndex) => ({
    year: results.years[yearIndex],
    bucketIndex,
    wealth,
    beta: policyRow[bucketIndex],
    estimatedDepletionRisk: valueRow[bucketIndex],
    expectedTerminalWealth: expectedWealthRow[bucketIndex]
  }));
}

function formatHistoricalBlock(row) {
  if (!row.historicalBlockStartYear || !row.historicalBlockEndYear) return "--";
  return `${row.historicalBlockStartYear}-${row.historicalBlockEndYear}`;
}

function downloadSimulationCsv() {
  if (!state.results) return;
  const headers = [
    "simulation",
    "year",
    "historical_return_year",
    "historical_return_block_start_year",
    "historical_return_block_end_year",
    "starting_wealth_current_dollars",
    "income_current_dollars",
    "expenses_current_dollars",
    "net_cash_flow_current_dollars",
    "nominal_spy_return",
    "risk_free_return",
    "spy_excess_return",
    "spy_beta_used",
    "portfolio_nominal_return",
    "inflation",
    "real_spy_return",
    "real_risk_free_return",
    "portfolio_real_return",
    "ending_wealth_current_dollars",
    "depleted_this_year",
    "depletion_year",
    "terminal_wealth_current_dollars",
    "ending_percentile"
  ];
  const summaryBySimulation = new Map(
    state.results.simulationRows.map((row) => [row.simulation, row])
  );
  const rows = state.results.simulationYearRows.map((row) => {
    const summary = summaryBySimulation.get(row.simulation);
    return [
      row.simulation,
      row.year,
      row.historicalReturnYear,
      row.historicalBlockStartYear,
      row.historicalBlockEndYear,
      row.startingWealth,
      row.income,
      row.expenses,
      row.netCashFlow,
      row.nominalSpyReturn,
      row.nominalRiskFreeReturn,
      row.nominalSpyExcessReturn,
      row.spyBetaUsed,
      row.nominalPortfolioReturn,
      row.inflation,
      row.realSpyReturn,
      row.realRiskFreeReturn,
      row.portfolioRealReturn,
      row.endingWealth,
      row.depletedThisYear ? "yes" : "no",
      row.depletionYear,
      summary.terminalWealth,
      summary.endingPercentile
    ];
  });
  const csv = [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `financial-planner-simulations-${Date.now()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadPolicyCsv() {
  if (!state.results || state.results.scenario.betaMode !== BETA_MODE_DYNAMIC || !state.results.dynamicPolicy) return;
  const headers = [
    "year",
    "bucket_index",
    "bucket_wealth_current_dollars",
    "recommended_spy_beta",
    "estimated_depletion_probability",
    "expected_terminal_wealth_current_dollars"
  ];
  const rows = state.results.years.flatMap((year, yearIndex) => (
    getDynamicPolicyRows(state.results, yearIndex).map((row) => [
      year,
      row.bucketIndex,
      row.wealth,
      row.beta,
      row.estimatedDepletionRisk,
      row.expectedTerminalWealth
    ])
  ));
  const csv = [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `financial-planner-dynamic-beta-policy-${Date.now()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function switchPage(page) {
  state.activePage = page;
  state.hover = null;
  state.detailHover = null;
  els.pageButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.page === page);
  });
  els.overviewPage.hidden = page !== "overview";
  els.detailsPage.hidden = page !== "details";
  els.policyPage.hidden = page !== "policy";
  els.methodologyPage.hidden = page !== "methodology";
  if (state.results) renderCharts(state.results);
}

function renderCharts(results) {
  if (state.activePage === "overview") {
    renderDistributionChart(els.distributionCanvas, results);
    renderNetWorthChart(els.pathsCanvas, results);
    renderBetaChart(els.betaCanvas, results);
    return;
  }
  if (state.activePage === "details") {
    renderSelectedSimulationChart(els.selectedSimulationCanvas, results);
  }
}

function renderDistributionChart(canvas, results) {
  const size = fitCanvas(canvas);
  const ctx = canvas.getContext("2d");
  const width = size.width;
  const height = size.height;
  clearCanvas(ctx, width, height);

  const padding = { top: 28, right: 24, bottom: 72, left: 70 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const showDepleted = els.showDepleted.checked;
  const rows = showDepleted
    ? results.depletedDistribution
    : [...results.depletedDistribution, { label: "Not depleted", count: results.notDepletedCount, isNotDepleted: true }];

  drawAxes(ctx, padding, width, height, "Probability");
  if (!rows.length) {
    drawEmptyState(ctx, width, height, "No simulated paths depleted before the expected year of death.");
    return;
  }

  const maxProbability = Math.max(...rows.map((row) => row.count / results.scenario.simulationCount), 0.01);
  const barGap = 3;
  const barWidth = Math.max(3, chartWidth / rows.length - barGap);

  rows.forEach((row, index) => {
    const probability = row.count / results.scenario.simulationCount;
    const x = padding.left + index * (chartWidth / rows.length);
    const barHeight = (probability / maxProbability) * chartHeight;
    const y = padding.top + chartHeight - barHeight;
    ctx.fillStyle = row.isNotDepleted ? "#4f46e5" : "#0ea5e9";
    ctx.fillRect(x, y, barWidth, barHeight);

    const shouldLabel = row.isNotDepleted || index === 0 || index === rows.length - 1 || index % Math.ceil(rows.length / 8) === 0;
    if (shouldLabel) {
      ctx.save();
      ctx.translate(x + barWidth / 2, height - 48);
      ctx.rotate(-Math.PI / 5);
      ctx.fillStyle = "#6b7280";
      ctx.font = "12px system-ui";
      ctx.textAlign = "right";
      ctx.fillText(row.label, 0, 0);
      ctx.restore();
    }
  });

  drawYProbabilityLabels(ctx, padding, chartHeight, maxProbability);
}

function renderNetWorthChart(canvas, results) {
  const size = fitCanvas(canvas);
  const ctx = canvas.getContext("2d");
  const width = size.width;
  const height = size.height;
  clearCanvas(ctx, width, height);
  state.pathHitAreas = [];

  const padding = { top: 28, right: 72, bottom: 54, left: 82 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxWealth = getNetWorthYAxisMax(results);
  const minYear = results.scenario.currentYear;
  const maxYear = results.scenario.deathYear;

  drawAxes(ctx, padding, width, height, "Current-dollar net worth");
  drawYMoneyLabels(ctx, padding, chartHeight, maxWealth);
  drawEndingPercentileLabels(ctx, results, padding, chartHeight, width, maxWealth);
  drawXYearLabels(ctx, padding, chartWidth, height, minYear, maxYear);

  ctx.save();
  ctx.beginPath();
  ctx.rect(padding.left, padding.top, chartWidth, chartHeight);
  ctx.clip();

  results.visualPaths.forEach((path, index) => {
    const points = path.points.map((point) => ({
      x: padding.left + ((point.year - minYear) / Math.max(1, maxYear - minYear)) * chartWidth,
      y: padding.top + chartHeight - (point.wealth / Math.max(1, maxWealth)) * chartHeight,
      year: point.year,
      wealth: point.wealth
    }));
    state.pathHitAreas.push({ path, index, points });

    const highlighted = state.hover && state.hover.index === index;
    ctx.beginPath();
    ctx.strokeStyle = highlighted ? "rgba(225, 29, 72, 0.95)" : "rgba(14, 165, 233, 0.18)";
    ctx.lineWidth = highlighted ? 3 : 1;
    points.forEach((point, pointIndex) => {
      if (pointIndex === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  });

  drawExpectedPath(ctx, results.expectedPath, padding, chartWidth, chartHeight, minYear, maxYear, maxWealth);
  ctx.restore();
  drawChartLegend(ctx, width, padding);
  if (state.hover) drawPathTooltip(ctx, state.hover, width, height);
}

function renderBetaChart(canvas, results) {
  const size = fitCanvas(canvas);
  const ctx = canvas.getContext("2d");
  const width = size.width;
  const height = size.height;
  clearCanvas(ctx, width, height);
  state.betaPathHitAreas = [];

  const padding = { top: 28, right: 36, bottom: 54, left: 70 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const minYear = results.scenario.currentYear;
  const maxYear = results.scenario.deathYear;
  const maxBeta = Math.max(1.5, results.scenario.spyBeta || 0, ...DYNAMIC_BETA_VALUES);

  els.betaPathSummary.textContent = results.scenario.betaMode === BETA_MODE_DYNAMIC
    ? "Average recommended beta and downsampled simulation beta paths."
    : `Fixed beta ${formatBeta(results.scenario.spyBeta)} across every active path.`;

  drawAxes(ctx, padding, width, height, "SPY beta");
  drawYBetaLabels(ctx, padding, chartHeight, maxBeta);
  drawXYearLabels(ctx, padding, chartWidth, height, minYear, maxYear);

  ctx.save();
  ctx.beginPath();
  ctx.rect(padding.left, padding.top, chartWidth, chartHeight);
  ctx.clip();

  results.visualPaths.forEach((path, index) => {
    const points = (path.betaPoints || []).filter((point) => Number.isFinite(point.beta)).map((point) => ({
      x: padding.left + ((point.year - minYear) / Math.max(1, maxYear - minYear)) * chartWidth,
      y: padding.top + chartHeight - (point.beta / Math.max(1, maxBeta)) * chartHeight,
      year: point.year,
      beta: point.beta
    }));
    if (points.length < 2) return;
    state.betaPathHitAreas.push({ path, index, points });

    const highlighted = state.hover && state.hover.index === index;
    ctx.beginPath();
    ctx.strokeStyle = highlighted ? "rgba(225, 29, 72, 0.95)" : "rgba(14, 165, 233, 0.18)";
    ctx.lineWidth = highlighted ? 3 : 1;
    points.forEach((point, pointIndex) => {
      if (pointIndex === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  });

  drawExpectedBetaPath(ctx, results.expectedBetaPath, padding, chartWidth, chartHeight, minYear, maxYear, maxBeta);
  ctx.restore();
  drawBetaChartLegend(ctx, width, padding);
  if (state.hover) drawBetaPathTooltip(ctx, state.hover, width, height);
}

function renderSelectedSimulationChart(canvas, results) {
  const size = fitCanvas(canvas);
  const ctx = canvas.getContext("2d");
  const width = size.width;
  const height = size.height;
  clearCanvas(ctx, width, height);

  const selectedSimulation = Number(els.simulationSelect.value) || 1;
  const rows = results.simulationYearRowsBySimulation.get(selectedSimulation) || [];
  const summary = results.simulationRows.find((row) => row.simulation === selectedSimulation);
  if (!rows.length) {
    els.selectedSimulationSummary.textContent = "No rows for this simulation.";
    state.detailHitPoints = [];
    drawEmptyState(ctx, width, height, "No rows for this simulation.");
    return;
  }

  const padding = { top: 28, right: 24, bottom: 54, left: 82 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const minYear = results.scenario.currentYear;
  const maxYear = results.scenario.deathYear;
  const maxWealth = Math.max(
    1,
    ...rows.flatMap((row) => [row.startingWealth, row.endingWealth])
  );
  const points = rows.map((row) => ({
    year: row.year,
    wealth: row.endingWealth,
    depletedThisYear: row.depletedThisYear
  }));
  state.detailHitPoints = points.map((point) => ({
    year: point.year,
    wealth: point.wealth,
    x: padding.left + ((point.year - minYear) / Math.max(1, maxYear - minYear)) * chartWidth,
    y: padding.top + chartHeight - (point.wealth / maxWealth) * chartHeight
  }));

  const finalWealth = summary ? summary.terminalWealth : rows[rows.length - 1].endingWealth;
  const status = summary && summary.failureYear ? `Depleted in ${summary.failureYear}` : "Not depleted";
  els.selectedSimulationSummary.textContent = `Sim ${formatNumber(selectedSimulation)} · ${formatCurrency(finalWealth)} · ${status.toLowerCase()}`;

  drawAxes(ctx, padding, width, height, "Current-dollar net worth");
  drawYMoneyLabels(ctx, padding, chartHeight, maxWealth);
  drawXYearLabels(ctx, padding, chartWidth, height, minYear, maxYear);

  ctx.save();
  ctx.beginPath();
  ctx.rect(padding.left, padding.top, chartWidth, chartHeight);
  ctx.clip();

  ctx.beginPath();
  ctx.strokeStyle = "#4f46e5";
  ctx.lineWidth = 3;
  points.forEach((point, index) => {
    const x = padding.left + ((point.year - minYear) / Math.max(1, maxYear - minYear)) * chartWidth;
    const y = padding.top + chartHeight - (point.wealth / maxWealth) * chartHeight;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  const depletionPoint = points.find((point) => point.depletedThisYear);
  if (depletionPoint) {
    const x = padding.left + ((depletionPoint.year - minYear) / Math.max(1, maxYear - minYear)) * chartWidth;
    const y = padding.top + chartHeight - (depletionPoint.wealth / maxWealth) * chartHeight;
    ctx.fillStyle = "#e11d48";
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  if (state.detailHover) {
    drawDetailHover(ctx, state.detailHover, padding, width, height);
  }
}

function drawExpectedBetaPath(ctx, expectedBetaPath, padding, chartWidth, chartHeight, minYear, maxYear, maxBeta) {
  ctx.beginPath();
  ctx.strokeStyle = "#4f46e5";
  ctx.lineWidth = 3;
  expectedBetaPath.forEach((point, index) => {
    if (!Number.isFinite(point.beta)) return;
    const x = padding.left + ((point.year - minYear) / Math.max(1, maxYear - minYear)) * chartWidth;
    const y = padding.top + chartHeight - (point.beta / Math.max(1, maxBeta)) * chartHeight;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function drawExpectedPath(ctx, expectedPath, padding, chartWidth, chartHeight, minYear, maxYear, maxWealth) {
  ctx.beginPath();
  ctx.strokeStyle = "#4f46e5";
  ctx.lineWidth = 3;
  expectedPath.forEach((point, index) => {
    const x = padding.left + ((point.year - minYear) / Math.max(1, maxYear - minYear)) * chartWidth;
    const y = padding.top + chartHeight - (point.wealth / Math.max(1, maxWealth)) * chartHeight;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function getNetWorthYAxisMax(results) {
  const percentileCap = Number(els.netWorthZoom.value) / 100;
  const visualMax = Math.max(
    results.scenario.netWorth,
    ...results.expectedPath.map((point) => point.wealth),
    ...results.visualPaths.flatMap((path) => path.points.map((point) => point.wealth))
  );

  if (percentileCap >= 1) return visualMax;
  const cap = percentile(results.terminalWealthSorted, percentileCap);
  return Math.max(results.scenario.netWorth, cap || 1, 1);
}

function updateNetWorthZoomLabel() {
  const value = Number(els.netWorthZoom.value);
  els.netWorthZoomLabel.textContent = value >= 100 ? "100%" : `${value}%`;
}

function drawChartLegend(ctx, width, padding) {
  ctx.font = "12px system-ui";
  ctx.textAlign = "right";
  ctx.fillStyle = "#4f46e5";
  ctx.fillText("Expected net worth", width - padding.right, 18);
  ctx.fillStyle = "#0ea5e9";
  ctx.fillText(`Downsampled paths (${MAX_VISUAL_PATHS} max)`, width - padding.right - 150, 18);
}

function drawBetaChartLegend(ctx, width, padding) {
  ctx.font = "12px system-ui";
  ctx.textAlign = "right";
  ctx.fillStyle = "#4f46e5";
  ctx.fillText("Average beta", width - padding.right, 18);
  ctx.fillStyle = "#0ea5e9";
  ctx.fillText(`Downsampled paths (${MAX_VISUAL_PATHS} max)`, width - padding.right - 118, 18);
}

function drawPathTooltip(ctx, hover, width, height) {
  const lines = [
    `Ending: ${formatCurrency(hover.path.terminalWealth)}`,
    `Ending rank: ${formatPercent(hover.path.endingPercentile)}`,
    `Avg real SPY return: ${formatPercent(hover.path.averageRealSpyReturn)}`,
    hover.path.failureYear ? `Depleted: ${hover.path.failureYear}` : "Not depleted"
  ];
  const boxWidth = 218;
  const boxHeight = 102;
  const x = Math.min(width - boxWidth - 12, Math.max(12, hover.x + 14));
  const y = Math.min(height - boxHeight - 12, Math.max(12, hover.y - boxHeight - 12));

  ctx.fillStyle = "rgba(26, 31, 46, 0.92)";
  ctx.fillRect(x, y, boxWidth, boxHeight);
  ctx.fillStyle = "#ffffff";
  ctx.font = "13px system-ui";
  ctx.textAlign = "left";
  lines.forEach((line, index) => {
    ctx.fillText(line, x + 12, y + 24 + index * 20);
  });
}

function drawBetaPathTooltip(ctx, hover, width, height) {
  const lines = [
    `Simulation: ${formatNumber(hover.path.simulation)}`,
    `Ending: ${formatCurrency(hover.path.terminalWealth)}`,
    hover.path.failureYear ? `Depleted: ${hover.path.failureYear}` : "Not depleted"
  ];
  const boxWidth = 218;
  const boxHeight = 78;
  const x = Math.min(width - boxWidth - 12, Math.max(12, hover.x + 14));
  const y = Math.min(height - boxHeight - 12, Math.max(12, hover.y - boxHeight - 12));

  ctx.fillStyle = "rgba(26, 31, 46, 0.92)";
  ctx.fillRect(x, y, boxWidth, boxHeight);
  ctx.fillStyle = "#ffffff";
  ctx.font = "13px system-ui";
  ctx.textAlign = "left";
  lines.forEach((line, index) => {
    ctx.fillText(line, x + 12, y + 24 + index * 20);
  });
}

function drawDetailHover(ctx, hover, padding, width, height) {
  ctx.save();
  ctx.strokeStyle = "rgba(79, 70, 229, 0.35)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(hover.point.x, padding.top);
  ctx.lineTo(hover.point.x, height - padding.bottom);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = "#4f46e5";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(hover.point.x, hover.point.y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  drawDetailPointTooltip(ctx, hover, width, height);
}

function drawDetailPointTooltip(ctx, hover, width, height) {
  const lines = [
    `Year: ${hover.point.year}`,
    `Net worth: ${formatCurrency(hover.point.wealth)}`
  ];
  const boxWidth = 196;
  const boxHeight = 58;
  const x = Math.min(width - boxWidth - 12, Math.max(12, hover.x + 14));
  const y = Math.min(height - boxHeight - 12, Math.max(12, hover.y - boxHeight - 12));

  ctx.fillStyle = "rgba(26, 31, 46, 0.92)";
  ctx.fillRect(x, y, boxWidth, boxHeight);
  ctx.fillStyle = "#ffffff";
  ctx.font = "13px system-ui";
  ctx.textAlign = "left";
  lines.forEach((line, index) => {
    ctx.fillText(line, x + 12, y + 24 + index * 20);
  });
}

function handlePathHover(event) {
  if (!state.results || state.activePage !== "overview") return;

  const rect = els.pathsCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const nearest = findNearestPath(x, y);
  const nextHover = nearest ? { ...nearest, x, y } : null;
  const currentIndex = state.hover ? state.hover.index : null;
  const nextIndex = nextHover ? nextHover.index : null;

  if (currentIndex !== nextIndex || nextHover) {
    state.hover = nextHover;
    renderNetWorthChart(els.pathsCanvas, state.results);
  }
}

function handleBetaPathHover(event) {
  if (!state.results || state.activePage !== "overview") return;

  const rect = els.betaCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const nearest = findNearestBetaPath(x, y);
  const nextHover = nearest ? { ...nearest, x, y } : null;
  const currentIndex = state.hover ? state.hover.index : null;
  const nextIndex = nextHover ? nextHover.index : null;

  if (currentIndex !== nextIndex || nextHover) {
    state.hover = nextHover;
    renderBetaChart(els.betaCanvas, state.results);
  }
}

function findNearestPath(x, y) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const area of state.pathHitAreas) {
    for (let i = 1; i < area.points.length; i += 1) {
      const distance = distanceToSegment(x, y, area.points[i - 1], area.points[i]);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = area;
      }
    }
  }
  return nearestDistance <= 10 ? nearest : null;
}

function findNearestBetaPath(x, y) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const area of state.betaPathHitAreas) {
    for (let i = 1; i < area.points.length; i += 1) {
      const distance = distanceToSegment(x, y, area.points[i - 1], area.points[i]);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = area;
      }
    }
  }
  return nearestDistance <= 10 ? nearest : null;
}

function handleDetailChartHover(event) {
  if (!state.results || state.activePage !== "details") return;

  const rect = els.selectedSimulationCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const nearest = findNearestDetailPoint(x, y);
  const nextHover = nearest ? { point: nearest, x, y } : null;
  const currentYear = state.detailHover ? state.detailHover.point.year : null;
  const nextYear = nextHover ? nextHover.point.year : null;

  if (currentYear !== nextYear || nextHover) {
    state.detailHover = nextHover;
    renderSelectedSimulationChart(els.selectedSimulationCanvas, state.results);
  }
}

function findNearestDetailPoint(x, y) {
  const points = state.detailHitPoints;
  if (!points.length) return null;

  let nearest = null;
  let nearestDistance = Infinity;
  for (const point of points) {
    const distance = Math.hypot(x - point.x, y - point.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = point;
    }
  }

  for (let i = 1; i < points.length; i += 1) {
    const distance = distanceToSegment(x, y, points[i - 1], points[i]);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      const distA = Math.hypot(x - points[i - 1].x, y - points[i - 1].y);
      const distB = Math.hypot(x - points[i].x, y - points[i].y);
      nearest = distA <= distB ? points[i - 1] : points[i];
    }
  }

  return nearestDistance <= 18 ? nearest : null;
}

function distanceToSegment(x, y, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(x - a.x, y - a.y);
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared));
  const projectionX = a.x + t * dx;
  const projectionY = a.y + t * dy;
  return Math.hypot(x - projectionX, y - projectionY);
}

function drawAxes(ctx, padding, width, height, yTitle) {
  ctx.strokeStyle = "#dfe3ee";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, height - padding.bottom);
  ctx.lineTo(width - padding.right, height - padding.bottom);
  ctx.stroke();

  ctx.fillStyle = "#6b7280";
  ctx.font = "12px system-ui";
  ctx.textAlign = "left";
  ctx.fillText(yTitle, padding.left, 16);
}

function drawEmptyState(ctx, width, height, message) {
  ctx.fillStyle = "#6b7280";
  ctx.font = "14px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(message, width / 2, height / 2);
}

function drawYProbabilityLabels(ctx, padding, chartHeight, maxProbability) {
  ctx.fillStyle = "#6b7280";
  ctx.font = "12px system-ui";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i += 1) {
    const value = (maxProbability / 4) * i;
    const y = padding.top + chartHeight - (chartHeight / 4) * i;
    ctx.fillText(formatPercent(value), padding.left - 10, y + 4);
  }
}

function drawYMoneyLabels(ctx, padding, chartHeight, maxWealth) {
  ctx.fillStyle = "#6b7280";
  ctx.font = "12px system-ui";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i += 1) {
    const value = (maxWealth / 4) * i;
    const y = padding.top + chartHeight - (chartHeight / 4) * i;
    ctx.fillText(formatCompactCurrency(value), padding.left - 10, y + 4);
  }
}

function drawYBetaLabels(ctx, padding, chartHeight, maxBeta) {
  ctx.fillStyle = "#6b7280";
  ctx.font = "12px system-ui";
  ctx.textAlign = "right";
  for (let i = 0; i <= 3; i += 1) {
    const value = (maxBeta / 3) * i;
    const y = padding.top + chartHeight - (chartHeight / 3) * i;
    ctx.fillText(formatBeta(value), padding.left - 10, y + 4);
  }
}

function drawEndingPercentileLabels(ctx, results, padding, chartHeight, width, maxWealth) {
  const percentiles = [0, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 1];
  ctx.fillStyle = "#6b7280";
  ctx.font = "12px system-ui";
  ctx.textAlign = "left";
  ctx.fillText("Ending rank", width - padding.right + 10, 16);
  let lastY = Infinity;
  percentiles.forEach((p) => {
    const wealth = percentile(results.terminalWealthSorted, p) || 0;
    if (wealth > maxWealth) return;
    const y = padding.top + chartHeight - (wealth / Math.max(1, maxWealth)) * chartHeight;
    if (lastY - y < 18) return;
    ctx.fillText(formatPercent(p), width - padding.right + 10, y + 4);
    lastY = y;
  });
}

function drawXYearLabels(ctx, padding, chartWidth, height, minYear, maxYear) {
  ctx.fillStyle = "#6b7280";
  ctx.font = "12px system-ui";
  ctx.textAlign = "center";
  for (let i = 0; i <= 4; i += 1) {
    const year = Math.round(minYear + ((maxYear - minYear) / 4) * i);
    const x = padding.left + (chartWidth / 4) * i;
    ctx.fillText(String(year), x, height - 24);
  }
}

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const backingWidth = Math.round(width * pixelRatio);
  const backingHeight = Math.round(height * pixelRatio);
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return { width, height };
}

function clearCanvas(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fcfdff";
  ctx.fillRect(0, 0, width, height);
}

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function randomIndex(length, random = Math.random) {
  return Math.floor(random() * length);
}

function generateSimulationSeed() {
  if (window.crypto && window.crypto.getRandomValues) {
    const values = new Uint32Array(1);
    window.crypto.getRandomValues(values);
    return values[0];
  }
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

function normalizeSeed(seed) {
  const value = Number(seed);
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error("The simulation seed is invalid.");
  }
  return value >>> 0;
}

function createSeededRandom(seed) {
  let value = normalizeSeed(seed);
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function percentileRank(sortedValues, value) {
  if (!sortedValues.length) return null;
  let low = 0;
  let high = sortedValues.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (sortedValues[mid] <= value) low = mid + 1;
    else high = mid;
  }
  return (low - 1) / Math.max(1, sortedValues.length - 1);
}

function formatCurrency(value) {
  if (value === null || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function formatInputCurrency(value) {
  const hasCents = Math.abs(value % 1) > 0.000001;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0
  }).format(value);
}

function formatCompactCurrency(value) {
  if (value === null || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function formatPercent(value) {
  if (value === null || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1
  }).format(value);
}

function formatBeta(value) {
  if (value === null || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(value);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}
