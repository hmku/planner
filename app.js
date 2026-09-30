/* app.js - bootstrap, inputs, and simulation run orchestration */
(function (Planner) {
  Planner.state = {
    marketData: null,
    results: null,
    activePage: "overview",
    isDirty: true,
    isRunning: false,
    cancelRequested: false,
    isFrontierRunning: false,
    frontierCancelRequested: false,
    frontierRunId: 0,
    inputVersion: 0,
    nextSimulationSeed: null
  };
  Planner.els = {};

  const ELEMENT_IDS = [
    "plannerForm", "runSimulation", "runProgress", "runProgressBar", "runStatus", "sharePlan",
    "currentYear", "deathYear", "netWorth", "betaMode", "fixedBetaControl", "spxBeta", "simulationCount",
    "incomeRows", "expenseRows", "addIncome", "addExpense", "flowRowTemplate",
    "riskMetric", "riskMetricNote", "terminalWealthMetric", "terminalWealthMetricNote",
    "currentBetaMetricLabel", "currentBetaMetric", "currentBetaMetricNote", "dataSpanMetric", "dataSpanMetricNote",
    "scenarioSummary", "netWorthSummary", "betaPathSummary", "frontierSummary", "runFrontier",
    "netWorthZoom", "netWorthZoomLabel", "showDepleted",
    "distributionCanvas", "pathsCanvas", "betaCanvas", "frontierCanvas", "selectedSimulationCanvas",
    "simulationSelect", "simulationPathTable", "selectedSimulationSummary", "downloadCsv",
    "policyEmptyState", "dynamicPolicySection", "dynamicPolicySummary", "policyYearSelect", "policyBucketSelect",
    "policyBucketPlotTitle", "policyMetricSelect", "dynamicPolicyCanvas", "dynamicPolicyActionTable", "downloadPolicyCsv",
    "policyPathSummary", "policyPathBeta", "policyPathYears", "policyPathReturnMode", "policyPathReturnYear",
    "policyPathCanvas", "policyPathTable",
    "overviewPage", "detailsPage", "policyPage", "frontierPage", "methodologyPage"
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
    Planner.els.simulationCount.value = 50000;

    Planner.DEFAULT_INCOME.forEach((flow) => addFlowRow(Planner.els.incomeRows, flow));
    Planner.DEFAULT_EXPENSES.forEach((flow) => addFlowRow(Planner.els.expenseRows, flow));
    Planner.bindFormattedInputs(document);
    Planner.formatAllFormattedInputs(document);
    updateBetaModeControls();
  }

  function rerender(render) {
    return () => {
      if (Planner.state.results) render(Planner.state.results);
    };
  }

  function bindEvents() {
    const { els } = Planner;
    els.runSimulation.addEventListener("click", runSimulation);
    els.runFrontier.addEventListener("click", runFrontier);
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
    els.plannerForm.addEventListener("input", markDirty);
    els.plannerForm.addEventListener("change", markDirty);
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
        if (Planner.state.results) Planner.renderCharts(Planner.state.results);
      });
    });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      Planner.resetChartTheme();
      if (Planner.state.results) Planner.renderCharts(Planner.state.results);
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
    Planner.els.dataSpanMetric.textContent = span;
    Planner.els.dataSpanMetricNote.textContent = `${years.length} annual observations`;
    document.querySelectorAll("[data-data-span]").forEach((element) => {
      element.textContent = span;
    });
    return true;
  }

  function setStatus(text, tone = "") {
    Planner.els.runStatus.textContent = text;
    Planner.els.runStatus.classList.toggle("is-error", tone === "error");
  }

  function markDirty() {
    if (!Planner.state.isRunning) Planner.state.nextSimulationSeed = null;
    if (Planner.state.isFrontierRunning) cancelFrontierRun();
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
    updateFrontierRunState();
  }

  function canRunFrontier() {
    const { state } = Planner;
    return Boolean(state.marketData && Planner.hasDynamicPolicy(state.results) && !state.isDirty && !state.isRunning);
  }

  function updateFrontierRunState() {
    const { state, els } = Planner;
    els.runFrontier.disabled = state.isFrontierRunning ? state.frontierCancelRequested : !canRunFrontier();
    els.runFrontier.textContent = state.isFrontierRunning
      ? (state.frontierCancelRequested ? "Stopping" : "Stop")
      : "Run frontier";
    els.runFrontier.classList.toggle("is-running", state.isFrontierRunning);
  }

  function cancelFrontierRun() {
    Planner.state.frontierRunId += 1;
    Planner.state.isFrontierRunning = false;
    Planner.state.frontierCancelRequested = false;
    updateFrontierRunState();
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
    markDirty();
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
    node.querySelector(".remove-flow").addEventListener("click", () => {
      node.remove();
      markDirty();
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

  function readScenario() {
    const { els } = Planner;
    const scenario = {
      currentYear: Planner.numberFromInput(els.currentYear),
      deathYear: Planner.numberFromInput(els.deathYear),
      netWorth: Planner.numberFromInput(els.netWorth),
      betaMode: Planner.normalizeBetaMode(els.betaMode.value),
      spxBeta: Planner.numberFromInput(els.spxBeta),
      simulationCount: Planner.numberFromInput(els.simulationCount)
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

    scenario.income = readFlowRows(els.incomeRows, scenario);
    scenario.expenses = readFlowRows(els.expenseRows, scenario);
    return scenario;
  }

  // ---------- Runs ----------

  async function runSimulation() {
    const { state, els } = Planner;
    if (state.isRunning) {
      state.cancelRequested = true;
      setStatus("Stopping…");
      updateRunState();
      return;
    }
    if (!state.marketData || !state.isDirty) return;

    const runVersion = state.inputVersion;
    let scenario;
    try {
      scenario = readScenario();
    } catch (error) {
      setStatus(error.message, "error");
      return;
    }

    const seed = Number.isInteger(state.nextSimulationSeed) ? state.nextSimulationSeed : Planner.generateSimulationSeed();
    state.nextSimulationSeed = null;
    state.isRunning = true;
    state.cancelRequested = false;
    if (state.isFrontierRunning) cancelFrontierRun();
    Planner.clearHover();
    els.runProgress.hidden = false;
    setProgress(0);
    updateRunState();
    await Planner.yieldToBrowser();

    const startedAt = performance.now();
    try {
      const results = await Planner.simulateScenario(
        scenario,
        state.marketData.returns,
        Planner.createSeededRandom(seed),
        setProgress,
        () => state.cancelRequested
      );
      results.seed = seed;
      state.results = results;
      state.isDirty = state.inputVersion !== runVersion;
      Planner.updateShareUrl(scenario, seed);
      Planner.renderResults(results);
      setStatus(`${Planner.formatNumber(scenario.simulationCount)} simulations in ${((performance.now() - startedAt) / 1000).toFixed(1)}s`);
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

  async function runFrontier() {
    const { state, els } = Planner;
    if (state.isFrontierRunning) {
      state.frontierCancelRequested = true;
      updateFrontierRunState();
      return;
    }
    if (!canRunFrontier()) return;

    const results = state.results;
    const frontierRunId = state.frontierRunId + 1;
    const isCurrentRun = () => state.frontierRunId === frontierRunId && state.results === results;
    state.frontierRunId = frontierRunId;
    state.isFrontierRunning = true;
    state.frontierCancelRequested = false;
    Planner.clearHover();
    results.dynamicPolicy.frontier = results.dynamicPolicy.frontier.slice(0, 1);
    els.frontierSummary.textContent = "Calculating dynamic beta frontier: 0%.";
    Planner.renderChart("frontier");
    updateFrontierRunState();
    await Planner.yieldToBrowser();

    try {
      await Planner.buildDynamicBetaFrontier(
        results,
        state.marketData.returns,
        (progress) => {
          if (!isCurrentRun()) return;
          els.frontierSummary.textContent = `Calculating dynamic beta frontier: ${Math.round(Planner.clamp(progress, 0, 1) * 100)}%.`;
        },
        () => !isCurrentRun() || state.frontierCancelRequested
      );
      if (!isCurrentRun()) return;
      Planner.updateFrontierSummary(results);
      Planner.renderChart("frontier");
    } catch (error) {
      if (!isCurrentRun()) return;
      els.frontierSummary.textContent = Planner.isCancellationError(error)
        ? "Frontier stopped."
        : `Frontier unavailable: ${error.message}`;
    } finally {
      if (state.frontierRunId === frontierRunId) {
        state.isFrontierRunning = false;
        state.frontierCancelRequested = false;
        updateFrontierRunState();
      }
    }
  }

  Object.assign(Planner, {
    setStatus,
    updateBetaModeControls,
    addFlowRow,
    readScenario
  });

  document.addEventListener("DOMContentLoaded", async () => {
    Planner.mountSectionHeaders();
    cacheElements();
    setDefaults();
    const sharedPlan = Planner.applySharedPlanFromUrl();
    bindEvents();
    Planner.resetDetailsControls();
    Planner.switchPage(Planner.getPageFromUrl());
    updateRunState();
    const loaded = await loadMarketData();
    markDirty();
    if (!loaded) return;

    if (sharedPlan?.error) {
      setStatus(sharedPlan.error, "error");
    } else if (sharedPlan) {
      Planner.state.nextSimulationSeed = sharedPlan.seed;
      setStatus("Shared plan loaded.");
      await runSimulation();
    } else {
      setStatus("Adjust the plan, then press Run.");
    }
  });
})(window.Planner = window.Planner || {});
