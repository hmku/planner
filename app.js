const MAX_VISUAL_PATHS = 200;
const RETURN_BLOCK_YEARS = 5;
const SIMULATION_CHUNK_SIZE = 100;
const MIN_PLAN_YEAR = 1900;
const MAX_PLAN_YEAR = 2200;
const MAX_PLAN_LENGTH_YEARS = 120;
const MIN_SIMULATION_COUNT = 100;
const MAX_SIMULATION_COUNT = 200000;
const MAX_SIMULATION_YEAR_ROWS = 12000000;

const state = {
  marketData: null,
  results: null,
  activePage: "overview",
  hover: null,
  pathHitAreas: [],
  isDirty: true,
  isRunning: false,
  cancelRequested: false,
  inputVersion: 0
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
  bindEvents();
  resetDetailsControls();
  updateRunState();
  await loadMarketData();
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
    spyBeta: document.querySelector("#spyBeta"),
    simulationCount: document.querySelector("#simulationCount"),
    incomeRows: document.querySelector("#incomeRows"),
    expenseRows: document.querySelector("#expenseRows"),
    addIncome: document.querySelector("#addIncome"),
    addExpense: document.querySelector("#addExpense"),
    downloadCsv: document.querySelector("#downloadCsv"),
    template: document.querySelector("#flowRowTemplate"),
    riskMetric: document.querySelector("#riskMetric"),
    earliestFailureMetric: document.querySelector("#earliestFailureMetric"),
    medianWealthMetric: document.querySelector("#medianWealthMetric"),
    worstSurvivorReturnMetric: document.querySelector("#worstSurvivorReturnMetric"),
    dataSpanMetric: document.querySelector("#dataSpanMetric"),
    scenarioSummary: document.querySelector("#scenarioSummary"),
    netWorthSummary: document.querySelector("#netWorthSummary"),
    netWorthZoom: document.querySelector("#netWorthZoom"),
    netWorthZoomLabel: document.querySelector("#netWorthZoomLabel"),
    showNotDepleted: document.querySelector("#showNotDepleted"),
    distributionCanvas: document.querySelector("#distributionCanvas"),
    pathsCanvas: document.querySelector("#pathsCanvas"),
    simulationSelect: document.querySelector("#simulationSelect"),
    simulationPathTable: document.querySelector("#simulationPathTable"),
    pageButtons: document.querySelectorAll("[data-page]"),
    overviewPage: document.querySelector("#overviewPage"),
    detailsPage: document.querySelector("#detailsPage"),
    methodologyPage: document.querySelector("#methodologyPage")
  });
}

function setDefaults() {
  const currentYear = new Date().getFullYear();
  els.currentYear.value = currentYear;
  els.deathYear.value = currentYear + 44;
  els.netWorth.value = 1250000;
  els.spyBeta.value = 1.2;
  els.simulationCount.value = 50000;

  DEFAULT_INCOME.forEach((flow) => addFlowRow(els.incomeRows, flow));
  DEFAULT_EXPENSES.forEach((flow) => addFlowRow(els.expenseRows, flow));
  bindFormattedInputs(document);
  formatAllFormattedInputs(document);
}

function bindEvents() {
  els.runSimulation.addEventListener("click", runSimulation);
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
  els.pageButtons.forEach((button) => {
    button.addEventListener("click", () => switchPage(button.dataset.page));
  });
  els.pathsCanvas.addEventListener("mousemove", handlePathHover);
  els.pathsCanvas.addEventListener("mouseleave", () => {
    state.hover = null;
    if (state.results) renderNetWorthChart(els.pathsCanvas, state.results);
  });
  els.netWorthZoom.addEventListener("input", () => {
    updateNetWorthZoomLabel();
    if (state.results) renderNetWorthChart(els.pathsCanvas, state.results);
  });
  els.showNotDepleted.addEventListener("change", () => {
    if (state.results) {
      updateScenarioSummary(state.results);
      renderDistributionChart(els.distributionCanvas, state.results);
    }
  });
  els.simulationSelect.addEventListener("change", () => {
    if (state.results) renderSimulationPathTable(state.results);
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
  if (!state.isDirty || state.isRunning) {
    state.inputVersion += 1;
  }
  state.isDirty = true;
  updateRunState();
}

function updateRunState() {
  const canRun = Boolean(state.marketData) && state.isDirty && !state.isRunning;
  els.runSimulation.disabled = state.isRunning ? state.cancelRequested : !canRun;
  els.runSimulation.textContent = state.cancelRequested
    ? "Stopping"
    : state.isRunning
      ? "Stop"
      : "Run";
  els.runSimulation.classList.toggle("is-running", state.isRunning);
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
  if (!Number.isFinite(scenario.spyBeta)) {
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

  state.isRunning = true;
  state.cancelRequested = false;
  state.hover = null;
  showProgress();
  updateRunState();
  await yieldToBrowser();

  try {
    const results = await simulateScenario(
      scenario,
      state.marketData.returns,
      setProgress,
      () => state.cancelRequested
    );
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

async function simulateScenario(scenario, returnRows, onProgress = () => {}, shouldCancel = () => false) {
  if (!returnRows.length) {
    throw new Error("No historical market data loaded.");
  }

  const years = range(scenario.currentYear, scenario.deathYear);
  const failures = [];
  const terminalWealth = [];
  const simulationRows = [];
  const simulationYearRows = [];
  const simulationYearRowsBySimulation = new Map();
  const visualPaths = [];
  const wealthSums = new Array(years.length).fill(0);

  onProgress(0);
  for (let i = 0; i < scenario.simulationCount; i += 1) {
    throwIfCanceled(shouldCancel);
    if (i > 0 && i % SIMULATION_CHUNK_SIZE === 0) {
      onProgress(i / scenario.simulationCount);
      await yieldToBrowser();
      throwIfCanceled(shouldCancel);
    }

    let wealth = scenario.netWorth;
    let failureYear = null;
    let sampledReturnCount = 0;
    let sampledNominalReturnSum = 0;
    let sampledRealReturnSum = 0;
    const sampledReturnPath = buildSampledReturnPath(returnRows, years.length, RETURN_BLOCK_YEARS);
    const path = [];
    const pathYearRows = [];

    for (let yearIndex = 0; yearIndex < years.length; yearIndex += 1) {
      const year = years[yearIndex];

      if (wealth > 0) {
        const income = cashFlowForYear(scenario.income, year);
        const expenses = cashFlowForYear(scenario.expenses, year);
        const netCashFlow = income - expenses;
        const sampledReturn = sampledReturnPath[yearIndex];
        const returnRow = sampledReturn.row;
        const nominalSpyReturn = returnRow.nominalReturn ?? returnRow.return;
        const nominalRiskFreeReturn = returnRow.riskFreeReturn ?? 0;
        const nominalSpyExcessReturn = nominalSpyReturn - nominalRiskFreeReturn;
        const inflation = returnRow.inflation ?? 0;
        const realSpyReturn = ((1 + nominalSpyReturn) / Math.max(0.000001, 1 + inflation)) - 1;
        const realRiskFreeReturn = ((1 + nominalRiskFreeReturn) / Math.max(0.000001, 1 + inflation)) - 1;
        const nominalPortfolioReturn = nominalRiskFreeReturn + scenario.spyBeta * nominalSpyExcessReturn;
        const nominalGrowthFactor = Math.max(0.000001, 1 + nominalPortfolioReturn);
        const realGrowthFactor = nominalGrowthFactor / Math.max(0.000001, 1 + inflation);
        const yearResult = applyContinuousYear(wealth, netCashFlow, realGrowthFactor);

        sampledReturnCount += 1;
        sampledNominalReturnSum += nominalSpyReturn;
        sampledRealReturnSum += realSpyReturn;
        wealth = yearResult.endingWealth;

        if (yearResult.depleted) {
          wealth = 0;
          failureYear = year;
        }

        const simulationYearRow = {
          simulation: i + 1,
          year,
          historicalReturnYear: returnRow.year,
          historicalBlockStartYear: sampledReturn.blockStartYear,
          historicalBlockEndYear: sampledReturn.blockEndYear,
          startingWealth: yearResult.startingWealth,
          income,
          expenses,
          netCashFlow,
          nominalSpyReturn,
          nominalRiskFreeReturn,
          nominalSpyExcessReturn,
          nominalPortfolioReturn,
          inflation,
          realSpyReturn,
          realRiskFreeReturn,
          portfolioRealReturn: realGrowthFactor - 1,
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
    }

    const pathResult = {
      simulation: i + 1,
      points: path,
      terminalWealth: wealth,
      averageNominalSpyReturn: sampledReturnCount ? sampledNominalReturnSum / sampledReturnCount : null,
      averageRealSpyReturn: sampledReturnCount ? sampledRealReturnSum / sampledReturnCount : null,
      failureYear
    };
    addReservoirSample(visualPaths, pathResult, i, MAX_VISUAL_PATHS);
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
  visualPaths.forEach((path) => {
    path.endingPercentile = percentileRank(terminalWealthSorted, path.terminalWealth);
  });
  simulationRows.forEach((row) => {
    row.endingPercentile = percentileRank(terminalWealthSorted, row.terminalWealth);
  });
  const inspectionPaths = [...visualPaths].sort(compareInspectionPaths);

  return {
    scenario,
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

function addReservoirSample(samples, item, seenIndex, maxSamples) {
  if (samples.length < maxSamples) {
    samples.push(item);
    return;
  }
  const replacementIndex = randomIndex(seenIndex + 1);
  if (replacementIndex < maxSamples) {
    samples[replacementIndex] = item;
  }
}

function buildSampledReturnPath(returnRows, pathLength, blockYears) {
  const path = [];
  const blockLength = Math.min(blockYears, returnRows.length);
  const maxStartIndex = returnRows.length - blockLength;

  while (path.length < pathLength) {
    const startIndex = randomIndex(maxStartIndex + 1);
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
  els.earliestFailureMetric.textContent = results.earliestFailureYear ? String(results.earliestFailureYear) : "None";
  els.medianWealthMetric.textContent = formatCurrency(results.medianTerminalWealth);
  els.worstSurvivorReturnMetric.textContent = results.worstSurvivingPath
    ? formatPercent(results.worstSurvivingPath.averageNominalSpyReturn)
    : "None";
  updateScenarioSummary(results);
  els.netWorthSummary.textContent = `Expected current-dollar net worth across all ${formatNumber(simulations)} simulations, with ${formatNumber(results.visualPaths.length)} downsampled paths for hover inspection.`;

  renderSimulationSelect(results);
  renderSimulationPathTable(results);
  renderCharts(results);
}

function resetDetailsControls() {
  const option = document.createElement("option");
  option.value = "";
  option.textContent = "Run simulation first";
  els.simulationSelect.replaceChildren(option);
  els.simulationSelect.disabled = true;
  els.downloadCsv.disabled = true;
}

function updateScenarioSummary(results) {
  const simulations = results.scenario.simulationCount;
  const depletedText = `${formatNumber(results.failureYears.length)} of ${formatNumber(simulations)} paths depleted (${formatPercent(results.risk)}).`;
  const notDepletedText = `${formatNumber(results.notDepletedCount)} paths did not deplete (${formatPercent(1 - results.risk)}).`;
  const chartText = els.showNotDepleted.checked
    ? "The chart includes both depleted and not-depleted paths."
    : "The chart shows only depleted paths, while probabilities still use all simulations as the denominator.";
  els.scenarioSummary.textContent = `${depletedText} ${notDepletedText} ${chartText}`;
}

function renderSimulationSelect(results) {
  const previousValue = Number(els.simulationSelect.value) || 1;
  const fragment = document.createDocumentFragment();

  results.inspectionPaths.forEach((path, index) => {
    const option = document.createElement("option");
    const rankLabel = `${formatNumber(index + 1)} of ${formatNumber(results.inspectionPaths.length)}`;
    option.value = String(path.simulation);
    option.textContent = path.failureYear
      ? `${rankLabel} - ${formatCurrency(path.terminalWealth)} ending wealth - simulation ${formatNumber(path.simulation)} - depleted ${path.failureYear}`
      : `${rankLabel} - ${formatCurrency(path.terminalWealth)} ending wealth - simulation ${formatNumber(path.simulation)}`;
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
    els.simulationPathTable.innerHTML = `<tr><td colspan="15">No rows for this simulation.</td></tr>`;
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
  els.pageButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.page === page);
  });
  els.overviewPage.hidden = page !== "overview";
  els.detailsPage.hidden = page !== "details";
  els.methodologyPage.hidden = page !== "methodology";
  if (state.results) renderCharts(state.results);
}

function renderCharts(results) {
  if (state.activePage !== "overview") return;
  renderDistributionChart(els.distributionCanvas, results);
  renderNetWorthChart(els.pathsCanvas, results);
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
  const showNotDepleted = els.showNotDepleted.checked;
  const rows = showNotDepleted
    ? [...results.depletedDistribution, { label: "Not depleted", count: results.notDepletedCount, isNotDepleted: true }]
    : results.depletedDistribution;

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
    ctx.fillStyle = row.isNotDepleted ? "#437145" : "#237b8f";
    ctx.fillRect(x, y, barWidth, barHeight);

    const shouldLabel = row.isNotDepleted || index === 0 || index === rows.length - 1 || index % Math.ceil(rows.length / 8) === 0;
    if (shouldLabel) {
      ctx.save();
      ctx.translate(x + barWidth / 2, height - 48);
      ctx.rotate(-Math.PI / 5);
      ctx.fillStyle = "#66746f";
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
    ctx.strokeStyle = highlighted ? "rgba(163, 68, 38, 0.95)" : "rgba(35, 123, 143, 0.15)";
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

function drawExpectedPath(ctx, expectedPath, padding, chartWidth, chartHeight, minYear, maxYear, maxWealth) {
  ctx.beginPath();
  ctx.strokeStyle = "#106b5f";
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
  ctx.fillStyle = "#106b5f";
  ctx.fillText("Expected net worth", width - padding.right, 18);
  ctx.fillStyle = "#237b8f";
  ctx.fillText(`Downsampled paths (${MAX_VISUAL_PATHS} max)`, width - padding.right - 150, 18);
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

  ctx.fillStyle = "rgba(23, 33, 29, 0.92)";
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
  ctx.strokeStyle = "#d7dfd9";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, height - padding.bottom);
  ctx.lineTo(width - padding.right, height - padding.bottom);
  ctx.stroke();

  ctx.fillStyle = "#66746f";
  ctx.font = "12px system-ui";
  ctx.textAlign = "left";
  ctx.fillText(yTitle, padding.left, 16);
}

function drawEmptyState(ctx, width, height, message) {
  ctx.fillStyle = "#66746f";
  ctx.font = "14px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(message, width / 2, height / 2);
}

function drawYProbabilityLabels(ctx, padding, chartHeight, maxProbability) {
  ctx.fillStyle = "#66746f";
  ctx.font = "12px system-ui";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i += 1) {
    const value = (maxProbability / 4) * i;
    const y = padding.top + chartHeight - (chartHeight / 4) * i;
    ctx.fillText(formatPercent(value), padding.left - 10, y + 4);
  }
}

function drawYMoneyLabels(ctx, padding, chartHeight, maxWealth) {
  ctx.fillStyle = "#66746f";
  ctx.font = "12px system-ui";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i += 1) {
    const value = (maxWealth / 4) * i;
    const y = padding.top + chartHeight - (chartHeight / 4) * i;
    ctx.fillText(formatCompactCurrency(value), padding.left - 10, y + 4);
  }
}

function drawEndingPercentileLabels(ctx, results, padding, chartHeight, width, maxWealth) {
  const percentiles = [0, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 1];
  ctx.fillStyle = "#66746f";
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
  ctx.fillStyle = "#66746f";
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
  ctx.fillStyle = "#fbfcfa";
  ctx.fillRect(0, 0, width, height);
}

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function randomIndex(length) {
  return Math.floor(Math.random() * length);
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

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}
