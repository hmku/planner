/* app.js - bootstrap, inputs, and simulation run orchestration */
(function (Planner) {
  Planner.state = {
    marketData: null,
    results: null,
    activePage: "overview",
    isDirty: true,
    isRunning: false,
    cancelRequested: false,
    inputVersion: 0,
    nextSimulationSeed: null,
    lifestyle: null,
    openPlanName: null
  };
  Planner.els = {};

  const ELEMENT_IDS = [
    "plannerForm", "runSimulation", "runProgress", "runProgressBar", "runStatus", "sharePlan", "savePlan",
    "planName", "savedPlanSelect", "deletePlan",
    "currentYear", "deathYear", "netWorth", "betaMode", "fixedBetaControl", "spxBeta", "simulationCount", "withdrawalTax",
    "incomeRows", "expenseRows", "addIncome", "addExpense", "flowRowTemplate", "expenseHeading",
    "lifestyleBody", "lifestyleTotal", "kidRows", "addKid", "lifestyleAssumptions", "lifestyleAssumptionsSummary",
    "lifestyleAssumptionsSection",
    "spendingCanvas", "spendingSummary", "spendingTable", "spendingNowHeader",
    "riskMetric", "riskMetricNote", "terminalWealthMetric", "terminalWealthMetricNote",
    "currentBetaMetricLabel", "currentBetaMetric", "currentBetaMetricNote",
    "requiredWealthMetricLabel", "requiredWealthMetric", "requiredWealthMetricNote",
    "requiredWealthSummary", "requiredWealthCanvas",
    "scenarioSummary", "netWorthSummary", "betaPathSummary", "frontierSummary",
    "netWorthZoom", "netWorthZoomLabel", "showDepleted",
    "distributionCanvas", "pathsCanvas", "betaCanvas", "frontierCanvas", "selectedSimulationCanvas",
    "simulationSelect", "simulationPathTable", "selectedSimulationSummary", "downloadCsv",
    "policyEmptyState", "dynamicPolicySection", "dynamicPolicySummary", "policyYearSelect", "policyBucketSelect",
    "policyBucketPlotTitle", "policyMetricSelect", "dynamicPolicyCanvas", "dynamicPolicyActionTable", "downloadPolicyCsv",
    "policyPathSummary", "policyPathBeta", "policyPathYears", "policyPathReturnMode", "policyPathReturnYear",
    "policyPathCanvas", "policyPathTable",
    "overviewPage", "spendingPage", "detailsPage", "policyPage", "methodologyPage"
  ];

  function cacheElements() {
    ELEMENT_IDS.forEach((id) => {
      const element = document.getElementById(id);
      if (!element) throw new Error(`Missing element: #${id}`);
      Planner.els[id] = element;
    });
    Planner.els.pageButtons = document.querySelectorAll("[data-page]");
  }

  function setDefaults() {
    const currentYear = new Date().getFullYear();
    Planner.els.currentYear.value = currentYear;
    Planner.els.deathYear.value = currentYear + 60;
    Planner.els.netWorth.value = 100000;
    Planner.els.betaMode.value = Planner.BETA_MODE_DYNAMIC;
    Planner.els.spxBeta.value = Planner.DEFAULT_SPX_BETA;
    Planner.els.simulationCount.value = 10000;
    Planner.els.withdrawalTax.value = Planner.DEFAULT_WITHDRAWAL_TAX_PCT;

    Planner.DEFAULT_INCOME.forEach((flow) => addFlowRow(Planner.els.incomeRows, flow));
    Planner.DEFAULT_EXPENSES.forEach((flow) => addFlowRow(Planner.els.expenseRows, flow));
    Planner.state.lifestyle = Planner.defaultLifestyle(currentYear);
    Planner.bindFormattedInputs(document);
    Planner.formatAllFormattedInputs(document);
    updateBetaModeControls();
    Planner.renderLifestyleForm();
  }

  function rerender(render) {
    return () => {
      if (Planner.state.results) render(Planner.state.results);
    };
  }

  function bindEvents() {
    const { els } = Planner;
    els.runSimulation.addEventListener("click", runSimulation);
    els.sharePlan.addEventListener("click", Planner.sharePlan);
    els.plannerForm.addEventListener("submit", (event) => {
      event.preventDefault();
      runSimulation();
    });
    // Enter in a field runs the plan; buttons keep their normal Enter behavior.
    els.plannerForm.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.target.closest("button")) return;
      event.preventDefault();
      runSimulation();
    });
    els.plannerForm.addEventListener("input", handleFormEdit);
    els.plannerForm.addEventListener("change", handleFormEdit);
    els.betaMode.addEventListener("change", updateBetaModeControls);
    els.addIncome.addEventListener("click", () => addNewFlow(els.incomeRows, "Income"));
    els.addExpense.addEventListener("click", () => addNewFlow(els.expenseRows, "Expense"));

    els.downloadCsv.addEventListener("click", Planner.downloadSimulationCsv);
    els.downloadPolicyCsv.addEventListener("click", Planner.downloadPolicyCsv);
    els.pageButtons.forEach((button) => {
      button.addEventListener("click", () => Planner.switchPage(button.dataset.page));
    });
    Planner.bindChartHover();

    els.netWorthZoom.addEventListener("input", () => {
      Planner.updateNetWorthZoomLabel();
      Planner.renderChart("netWorth");
    });
    els.showDepleted.addEventListener("change", rerender((results) => {
      Planner.updateScenarioSummary(results);
      Planner.renderChart("distribution");
    }));
    els.simulationSelect.addEventListener("change", rerender((results) => {
      Planner.clearHover();
      Planner.renderSimulationPathTable(results);
      Planner.renderChart("detail");
    }));
    [els.policyYearSelect, els.policyBucketSelect, els.policyMetricSelect].forEach((select) => {
      select.addEventListener("change", rerender((results) => {
        Planner.clearHover();
        Planner.renderDynamicPolicyTable(results);
      }));
    });
    [els.policyPathBeta, els.policyPathYears, els.policyPathReturnMode, els.policyPathReturnYear].forEach((input) => {
      input.addEventListener("change", rerender(Planner.renderPolicyPathExplorer));
    });

    let resizeFrame = null;
    window.addEventListener("resize", () => {
      if (resizeFrame) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        Planner.renderCharts(Planner.state.results);
      });
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      Planner.resetChartTheme();
      Planner.renderCharts(Planner.state.results);
    });
    Planner.updateNetWorthZoomLabel();
  }

  async function loadMarketData() {
    try {
      const response = await fetch("data/spx-annual-returns.json");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.returns) || !data.returns.length) throw new Error("no return rows");
      Planner.state.marketData = data;
    } catch (error) {
      setStatus(`Could not load market data (${error.message}). Serve the app over HTTP and reload.`, "error");
      return false;
    }
    const years = Planner.state.marketData.returns.map((entry) => entry.year);
    const span = `${Math.min(...years)}–${Math.max(...years)}`;
    document.querySelectorAll("[data-data-span]").forEach((element) => {
      element.textContent = span;
    });
    return true;
  }

  function setStatus(text, tone = "") {
    Planner.els.runStatus.textContent = text;
    Planner.els.runStatus.classList.toggle("is-error", tone === "error");
  }

  // Every user edit in the inputs pane: update the lifestyle builder, mark the
  // results stale, and autosave. Renaming the plan doesn't stale the results.
  function handleFormEdit(event) {
    const target = event.target;
    if (target === Planner.els.planName) {
      Planner.noteUserEdit();
      return;
    }
    const isItemAmount = target.classList.contains("ls-item-amount");
    Planner.handleLifestyleInput(event);
    Planner.refreshLifestyle({ keepItemRows: isItemAmount && event.type === "input" });
    noteEdit();
  }

  // Edits that don't come through a form event (adding or removing rows, kid
  // and line-item buttons).
  function noteEdit() {
    markDirty();
    Planner.noteUserEdit();
  }

  function noteLifestyleEdit() {
    Planner.refreshLifestyle();
    noteEdit();
  }

  function markDirty() {
    if (!Planner.state.isRunning) Planner.state.nextSimulationSeed = null;
    Planner.state.inputVersion += 1;
    Planner.state.isDirty = true;
    updateRunState();
  }

  function updateRunState() {
    const { state, els } = Planner;
    const canRun = Boolean(state.marketData) && state.isDirty && !state.isRunning;
    els.runSimulation.disabled = state.isRunning ? state.cancelRequested : !canRun;
    els.runSimulation.textContent = state.cancelRequested ? "Stopping" : state.isRunning ? "Stop" : "Run";
    els.runSimulation.classList.toggle("is-running", state.isRunning);
    els.sharePlan.disabled = state.isRunning || !state.marketData;
  }

  function updateBetaModeControls() {
    const isDynamicBeta = Planner.normalizeBetaMode(Planner.els.betaMode.value) === Planner.BETA_MODE_DYNAMIC;
    Planner.els.fixedBetaControl.hidden = isDynamicBeta;
    Planner.els.spxBeta.disabled = isDynamicBeta;
  }

  function setProgress(value) {
    const percent = Math.round(Planner.clamp(value, 0, 1) * 100);
    Planner.els.runProgressBar.style.width = `${percent}%`;
    Planner.els.runProgress.setAttribute("aria-valuenow", String(percent));
    if (Planner.state.isRunning && !Planner.state.cancelRequested) setStatus(`Simulating… ${percent}%`);
  }

  // ---------- Cash flow rows ----------

  function addNewFlow(container, name) {
    addFlowRow(container, {
      name,
      amount: 25000,
      startMode: "current",
      startYear: Number(Planner.els.currentYear.value),
      endMode: "death",
      endYear: Number(Planner.els.deathYear.value)
    });
    Planner.formatAllFormattedInputs(container.lastElementChild);
    container.lastElementChild.querySelector('[data-field="name"]').focus();
    noteEdit();
  }

  function addFlowRow(container, flow) {
    const node = Planner.els.flowRowTemplate.content.firstElementChild.cloneNode(true);
    const field = (name) => node.querySelector(`[data-field="${name}"]`);
    field("name").value = flow.name;
    field("amount").value = flow.amount;
    field("startMode").value = flow.startMode || "current";
    field("startYear").value = flow.startYear;
    field("endMode").value = flow.endMode || "death";
    field("endYear").value = flow.endYear;
    // Rows moved out of the lifestyle builder remember their line, so restoring
    // the line can remove them.
    if (flow.lifestyleKey) node.dataset.lifestyleKey = flow.lifestyleKey;
    node.querySelector(".remove-row").addEventListener("click", () => {
      node.remove();
      noteEdit();
    });
    [field("startMode"), field("endMode")].forEach((select) => {
      select.addEventListener("change", () => updateFlowYearInputs(node));
    });
    Planner.bindFormattedInputs(node);
    Planner.formatAllFormattedInputs(node);
    updateFlowYearInputs(node);
    container.appendChild(node);
  }

  function updateFlowYearInputs(row) {
    row.querySelector('[data-field="startYear"]').hidden = row.querySelector('[data-field="startMode"]').value !== "fixed";
    row.querySelector('[data-field="endYear"]').hidden = row.querySelector('[data-field="endMode"]').value !== "fixed";
  }

  function resolveFlowYear(mode, fixedInput, scenario) {
    if (mode === "current") return scenario.currentYear;
    if (mode === "death") return scenario.deathYear;
    return Planner.numberFromInput(fixedInput);
  }

  // Rows with no positive amount, or that end before they start, contribute nothing
  // and are skipped.
  function readFlowRows(container, scenario) {
    return [...container.querySelectorAll(".flow-row")]
      .map((row) => {
        const field = (name) => row.querySelector(`[data-field="${name}"]`);
        const name = field("name").value.trim();
        const startMode = field("startMode").value;
        const endMode = field("endMode").value;
        const startYear = resolveFlowYear(startMode, field("startYear"), scenario);
        const endYear = resolveFlowYear(endMode, field("endYear"), scenario);
        const label = name || "Cash flow";
        if (startMode === "fixed") Planner.validatePlanYear(startYear, `${label} start year`);
        if (endMode === "fixed") Planner.validatePlanYear(endYear, `${label} end year`);
        return {
          name,
          amount: Planner.numberFromInput(field("amount")),
          startMode,
          endMode,
          startYear,
          endYear
        };
      })
      .filter((flow) => Number.isFinite(flow.amount) && flow.amount > 0 && flow.startYear <= flow.endYear);
  }

  // Manual expenditure rows count as "other" spending; lifestyle lines carry
  // their own categories.
  function readCashFlows(years) {
    const manualExpenses = readFlowRows(Planner.els.expenseRows, years).map((flow) => ({ ...flow, category: "other" }));
    const lifestyleExpenses = Planner.lifestyleItemsToFlows(Planner.getLifestyleItems(years.currentYear, years.deathYear));
    return {
      income: readFlowRows(Planner.els.incomeRows, years),
      expenses: [...lifestyleExpenses, ...manualExpenses],
      // An owned home counts as an asset and can be sold if the portfolio runs low.
      home: Planner.buildHomeModel(Planner.state.lifestyle, years.currentYear, years.deathYear)
    };
  }

  function readWithdrawalTaxRate() {
    const percent = Planner.numberFromInput(Planner.els.withdrawalTax);
    if (!Number.isFinite(percent) || percent < 0 || percent > Planner.MAX_WITHDRAWAL_TAX_PCT) {
      throw new Error(`Enter a tax on withdrawals between 0% and ${Planner.MAX_WITHDRAWAL_TAX_PCT}%.`);
    }
    return percent / 100;
  }

  // Cash flows for the Spending view, which needs only valid plan years.
  function readCashFlowInputs() {
    const years = {
      currentYear: Planner.numberFromInput(Planner.els.currentYear),
      deathYear: Planner.numberFromInput(Planner.els.deathYear)
    };
    Planner.validatePlanYear(years.currentYear, "Current year");
    Planner.validatePlanYear(years.deathYear, "Year of death");
    if (years.deathYear < years.currentYear) throw new Error("Year of death must not be before the current year.");
    if (years.deathYear - years.currentYear + 1 > Planner.MAX_PLAN_LENGTH_YEARS) {
      throw new Error(`Plan length cannot exceed ${Planner.MAX_PLAN_LENGTH_YEARS} years.`);
    }
    return { ...years, ...readCashFlows(years), withdrawalTaxRate: readWithdrawalTaxRate() };
  }

  function readScenario() {
    const { els } = Planner;
    const scenario = {
      currentYear: Planner.numberFromInput(els.currentYear),
      deathYear: Planner.numberFromInput(els.deathYear),
      netWorth: Planner.numberFromInput(els.netWorth),
      betaMode: Planner.normalizeBetaMode(els.betaMode.value),
      spxBeta: Planner.numberFromInput(els.spxBeta),
      simulationCount: Planner.numberFromInput(els.simulationCount),
      withdrawalTaxRate: readWithdrawalTaxRate()
    };

    Planner.validatePlanYear(scenario.currentYear, "Current year");
    Planner.validatePlanYear(scenario.deathYear, "Year of death");
    if (scenario.deathYear < scenario.currentYear) {
      throw new Error("Year of death must not be before the current year.");
    }
    const planLength = scenario.deathYear - scenario.currentYear + 1;
    if (planLength > Planner.MAX_PLAN_LENGTH_YEARS) {
      throw new Error(`Plan length cannot exceed ${Planner.MAX_PLAN_LENGTH_YEARS} years.`);
    }
    if (!Number.isFinite(scenario.netWorth) || scenario.netWorth < 0) {
      throw new Error("Enter a non-negative current net worth.");
    }
    if (scenario.betaMode === Planner.BETA_MODE_FIXED) {
      if (!Number.isFinite(scenario.spxBeta) || scenario.spxBeta < -3 || scenario.spxBeta > 3) {
        throw new Error("Enter an SPX beta between -3 and 3.");
      }
    } else if (!Number.isFinite(scenario.spxBeta)) {
      scenario.spxBeta = Planner.DEFAULT_SPX_BETA;
    }
    if (!Number.isFinite(scenario.simulationCount) || scenario.simulationCount < Planner.MIN_SIMULATION_COUNT) {
      throw new Error(`Run at least ${Planner.formatNumber(Planner.MIN_SIMULATION_COUNT)} simulations.`);
    }
    scenario.simulationCount = Math.round(scenario.simulationCount);
    if (scenario.simulationCount > Planner.MAX_SIMULATION_COUNT) {
      throw new Error(`Run no more than ${Planner.formatNumber(Planner.MAX_SIMULATION_COUNT)} simulations.`);
    }
    const simulationYearRows = scenario.simulationCount * planLength;
    if (simulationYearRows > Planner.MAX_SIMULATION_YEAR_ROWS) {
      throw new Error(`This run would create ${Planner.formatNumber(simulationYearRows)} simulation-years. Keep simulations × plan years under ${Planner.formatNumber(Planner.MAX_SIMULATION_YEAR_ROWS)}.`);
    }

    Object.assign(scenario, readCashFlows(scenario));
    return scenario;
  }

  // ---------- Runs ----------

  async function runSimulation() {
    const { state, els } = Planner;
    if (state.isRunning) {
      state.cancelRequested = true;
      setStatus("Stopping…");
      updateRunState();
      if (cancelActiveRun) cancelActiveRun();
      return;
    }
    if (!state.marketData || !state.isDirty) return;

    const runVersion = state.inputVersion;
    let scenario;
    let planState;
    try {
      scenario = readScenario();
      planState = Planner.getPlanState();
    } catch (error) {
      setStatus(error.message, "error");
      return;
    }

    const seed = Number.isInteger(state.nextSimulationSeed) ? state.nextSimulationSeed : Planner.generateSimulationSeed();
    state.nextSimulationSeed = null;
    state.isRunning = true;
    state.cancelRequested = false;
    Planner.clearHover();
    els.runProgress.hidden = false;
    setProgress(0);
    updateRunState();
    await Planner.yieldToBrowser();

    const startedAt = performance.now();
    try {
      const results = await runSimulationJob(scenario, state.marketData.returns, seed);
      results.seed = seed;
      state.results = results;
      state.isDirty = state.inputVersion !== runVersion;
      if (state.inputVersion === runVersion) Planner.syncShareUrl(planState, seed);
      Planner.renderResults(results);
      setStatus(`${Planner.formatNumber(scenario.simulationCount)} simulations in ${Planner.formatSeconds(performance.now() - startedAt)}`);
    } catch (error) {
      setStatus(Planner.isCancellationError(error) ? "Simulation stopped." : error.message, Planner.isCancellationError(error) ? "" : "error");
      state.isDirty = true;
    } finally {
      state.isRunning = false;
      state.cancelRequested = false;
      els.runProgress.hidden = true;
      updateRunState();
    }
  }

  // Runs in a Web Worker when possible so the page stays responsive; otherwise
  // inline. Both paths use the same seed and code, so results are identical.
  let cancelActiveRun = null;

  function cancellationError() {
    const error = new Error("Simulation canceled.");
    error.name = "SimulationCanceledError";
    return error;
  }

  function runSimulationJob(scenario, returnRows, seed) {
    const runInline = () => Planner.simulateScenario(
      scenario,
      returnRows,
      Planner.createSeededRandom(seed),
      setProgress,
      () => Planner.state.cancelRequested
    );
    if (typeof Worker !== "function") return runInline();

    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = new Worker("js/simulation-worker.js");
      } catch (error) {
        runInline().then(resolve, reject);
        return;
      }
      let started = false;
      const finish = () => {
        cancelActiveRun = null;
        worker.terminate();
      };
      cancelActiveRun = () => {
        finish();
        reject(cancellationError());
      };
      worker.onmessage = ({ data }) => {
        started = true;
        if (data.type === "progress") {
          setProgress(data.value);
        } else if (data.type === "done") {
          finish();
          resolve({ ...data.results, returnRows });
        } else if (data.type === "error") {
          finish();
          reject(new Error(data.message));
        }
      };
      // A worker that can't load (blocked, offline without cache) falls back.
      worker.onerror = (event) => {
        event.preventDefault();
        finish();
        if (started) reject(new Error(event.message || "The simulation failed."));
        else runInline().then(resolve, reject);
      };
      worker.postMessage({ scenario, returnRows, seed });
    });
  }

  Object.assign(Planner, {
    setStatus,
    updateBetaModeControls,
    addFlowRow,
    readScenario,
    readCashFlowInputs
  });

  // Offline support for the installable app (see sw.js).
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  registerServiceWorker();

  // iOS Safari ignores user-scalable=no, so block its pinch gestures directly.
  ["gesturestart", "gesturechange"].forEach((type) => {
    document.addEventListener(type, (event) => event.preventDefault(), { passive: false });
  });

  document.addEventListener("DOMContentLoaded", async () => {
    Planner.mountSectionHeaders();
    cacheElements();
    Planner.initLifestyleBuilder(noteLifestyleEdit);
    setDefaults();
    bindEvents();
    Planner.bindSavedPlanControls(markDirty);
    const restored = await Planner.restoreInitialPlan();
    Planner.resetDetailsControls();
    Planner.switchPage(Planner.getPageFromUrl());
    updateRunState();
    const loaded = await loadMarketData();
    markDirty();
    if (!loaded) return;

    if (restored?.error) {
      setStatus(restored.error, "error");
    } else if (restored?.source === "share" && Number.isInteger(restored.seed)) {
      Planner.state.nextSimulationSeed = restored.seed;
      setStatus("Plan loaded from the link.");
      await runSimulation();
    } else if (restored?.source === "share") {
      setStatus("Plan loaded from the link. Press Run.");
    } else if (restored?.source === "draft") {
      setStatus("Restored your last session. Press Run.");
    } else {
      setStatus("Describe your plan, then press Run.");
    }
  });
})(window.Planner = window.Planner || {});
