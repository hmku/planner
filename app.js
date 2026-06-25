/* app.js - bootstrap, inputs, and simulation run orchestration */
(function (Planner) {
  Planner.state = {
    marketData: null,
    results: null,
    activePage: "overview",
    hover: null,
    pathHitAreas: [],
    betaPathHitAreas: [],
    detailHover: null,
    detailHitPoints: [],
    policyBucketHover: null,
    policyBucketHitPoints: [],
    policyBucketPlot: null,
    isDirty: true,
    isRunning: false,
    cancelRequested: false,
    inputVersion: 0,
    nextSimulationSeed: null,
    shareStatusTimer: null
  };
  Planner.els = {};

  function cacheElements() {
    Object.assign(Planner.els, {
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
      spxBeta: document.querySelector("#spxBeta"),
      dynamicRiskThresholdControl: document.querySelector("#dynamicRiskThresholdControl"),
      dynamicRiskThreshold: document.querySelector("#dynamicRiskThreshold"),
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
      policyBucketSelect: document.querySelector("#policyBucketSelect"),
      policyBucketPlotTitle: document.querySelector("#policyBucketPlotTitle"),
      policyMetricSelect: document.querySelector("#policyMetricSelect"),
      dynamicPolicyCanvas: document.querySelector("#dynamicPolicyCanvas"),
      policyPathSummary: document.querySelector("#policyPathSummary"),
      policyPathBeta: document.querySelector("#policyPathBeta"),
      policyPathYears: document.querySelector("#policyPathYears"),
      policyPathReturnMode: document.querySelector("#policyPathReturnMode"),
      policyPathReturnYear: document.querySelector("#policyPathReturnYear"),
      policyPathCanvas: document.querySelector("#policyPathCanvas"),
      policyPathTable: document.querySelector("#policyPathTable"),
      dynamicPolicyActionTable: document.querySelector("#dynamicPolicyActionTable"),
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
    Planner.els.currentYear.value = currentYear;
    Planner.els.deathYear.value = currentYear + 44;
    Planner.els.netWorth.value = 1250000;
    Planner.els.betaMode.value = Planner.BETA_MODE_DYNAMIC;
    Planner.els.spxBeta.value = 0.8;
    Planner.els.dynamicRiskThreshold.value = 0;
    Planner.els.simulationCount.value = 50000;

    Planner.DEFAULT_INCOME.forEach((flow) => addFlowRow(Planner.els.incomeRows, flow));
    Planner.DEFAULT_EXPENSES.forEach((flow) => addFlowRow(Planner.els.expenseRows, flow));
    Planner.bindFormattedInputs(document);
    Planner.formatAllFormattedInputs(document);
    updateBetaModeControls();
  }

  function bindEvents() {
    Planner.els.runSimulation.addEventListener("click", runSimulation);
    Planner.els.sharePlan.addEventListener("click", Planner.sharePlan);
    Planner.els.form.addEventListener("submit", (event) => {
      event.preventDefault();
      runSimulation();
    });
    Planner.els.form.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      runSimulation();
    });
    Planner.els.form.addEventListener("input", markDirty);
    Planner.els.form.addEventListener("change", markDirty);
    Planner.els.betaMode.addEventListener("change", updateBetaModeControls);
    [Planner.els.currentYear, Planner.els.deathYear].forEach((input) => {
      input.addEventListener("change", syncRelativeFlowYears);
    });
    Planner.els.addIncome.addEventListener("click", () => {
      addFlowRow(Planner.els.incomeRows, {
        name: "Income",
        amount: 25000,
        startMode: "current",
        startYear: Number(Planner.els.currentYear.value),
        endMode: "death",
        endYear: Number(Planner.els.deathYear.value)
      });
      markDirty();
    });
    Planner.els.addExpense.addEventListener("click", () => {
      addFlowRow(Planner.els.expenseRows, {
        name: "Expense",
        amount: 25000,
        startMode: "current",
        startYear: Number(Planner.els.currentYear.value),
        endMode: "death",
        endYear: Number(Planner.els.deathYear.value)
      });
      markDirty();
    });
    Planner.els.downloadCsv.addEventListener("click", Planner.downloadSimulationCsv);
    Planner.els.downloadPolicyCsv.addEventListener("click", Planner.downloadPolicyCsv);
    Planner.els.pageButtons.forEach((button) => {
      button.addEventListener("click", () => Planner.switchPage(button.dataset.page));
    });
    Planner.els.pathsCanvas.addEventListener("mousemove", Planner.handlePathHover);
    Planner.els.pathsCanvas.addEventListener("mouseleave", () => {
      Planner.state.hover = null;
      if (Planner.state.results) Planner.renderNetWorthChart(Planner.els.pathsCanvas, Planner.state.results);
    });
    Planner.els.betaCanvas.addEventListener("mousemove", Planner.handleBetaPathHover);
    Planner.els.betaCanvas.addEventListener("mouseleave", () => {
      Planner.state.hover = null;
      if (Planner.state.results) Planner.renderBetaChart(Planner.els.betaCanvas, Planner.state.results);
    });
    Planner.els.selectedSimulationCanvas.addEventListener("mousemove", Planner.handleDetailChartHover);
    Planner.els.selectedSimulationCanvas.addEventListener("mouseleave", () => {
      Planner.state.detailHover = null;
      if (Planner.state.results) Planner.renderSelectedSimulationChart(Planner.els.selectedSimulationCanvas, Planner.state.results);
    });
    Planner.els.dynamicPolicyCanvas.addEventListener("mousemove", Planner.handlePolicyBucketHover);
    Planner.els.dynamicPolicyCanvas.addEventListener("mouseleave", () => {
      Planner.state.policyBucketHover = null;
      if (Planner.state.results && Planner.state.policyBucketPlot) {
        Planner.renderPolicyBucketPlot(
          Planner.els.dynamicPolicyCanvas,
          Planner.state.results,
          Planner.state.policyBucketPlot.rows,
          Planner.state.policyBucketPlot.metric,
          Planner.state.policyBucketPlot.currentBucketIndex
        );
      }
    });
    Planner.els.netWorthZoom.addEventListener("input", () => {
      Planner.updateNetWorthZoomLabel();
      if (Planner.state.results) Planner.renderNetWorthChart(Planner.els.pathsCanvas, Planner.state.results);
    });
    Planner.els.showDepleted.addEventListener("change", () => {
      if (Planner.state.results) {
        Planner.updateScenarioSummary(Planner.state.results);
        Planner.renderDistributionChart(Planner.els.distributionCanvas, Planner.state.results);
      }
    });
    Planner.els.simulationSelect.addEventListener("change", () => {
      if (!Planner.state.results) return;
      Planner.state.detailHover = null;
      Planner.renderSimulationPathTable(Planner.state.results);
      Planner.renderSelectedSimulationChart(Planner.els.selectedSimulationCanvas, Planner.state.results);
    });
    Planner.els.policyYearSelect.addEventListener("change", () => {
      Planner.state.policyBucketHover = null;
      if (Planner.state.results) Planner.renderDynamicPolicyTable(Planner.state.results);
    });
    Planner.els.policyBucketSelect.addEventListener("change", () => {
      Planner.state.policyBucketHover = null;
      if (Planner.state.results) Planner.renderDynamicPolicyTable(Planner.state.results);
    });
    Planner.els.policyMetricSelect.addEventListener("change", () => {
      Planner.state.policyBucketHover = null;
      if (Planner.state.results) Planner.renderDynamicPolicyTable(Planner.state.results);
    });
    [
      Planner.els.policyPathBeta,
      Planner.els.policyPathYears,
      Planner.els.policyPathReturnMode,
      Planner.els.policyPathReturnYear
    ].forEach((input) => {
      input.addEventListener("input", () => {
        if (Planner.state.results) Planner.renderPolicyPathExplorer(Planner.state.results);
      });
      input.addEventListener("change", () => {
        if (Planner.state.results) Planner.renderPolicyPathExplorer(Planner.state.results);
      });
    });
    window.addEventListener("resize", () => {
      if (Planner.state.results) Planner.renderCharts(Planner.state.results);
    });
    Planner.updateNetWorthZoomLabel();
  }

  async function loadMarketData() {
    const response = await fetch("data/spx-annual-returns.json");
    Planner.state.marketData = await response.json();
    const years = Planner.state.marketData.returns.map((entry) => entry.year);
    Planner.els.dataSpanMetric.textContent = `${Math.min(...years)}-${Math.max(...years)}`;
  }

  function markDirty() {
    if (!Planner.state.isRunning) {
      Planner.state.nextSimulationSeed = null;
    }
    if (!Planner.state.isDirty || Planner.state.isRunning) {
      Planner.state.inputVersion += 1;
    }
    Planner.state.isDirty = true;
    updateRunState();
  }

  function updateRunState() {
    const canRun = Boolean(Planner.state.marketData) && Planner.state.isDirty && !Planner.state.isRunning;
    Planner.els.runSimulation.disabled = Planner.state.isRunning ? Planner.state.cancelRequested : !canRun;
    Planner.els.sharePlan.disabled = Planner.state.isRunning;
    Planner.els.runSimulation.textContent = Planner.state.cancelRequested
      ? "Stopping"
      : Planner.state.isRunning
        ? "Stop"
        : "Run";
    Planner.els.runSimulation.classList.toggle("is-running", Planner.state.isRunning);
  }

  function updateBetaModeControls() {
    const isDynamicBeta = Planner.normalizeBetaMode(Planner.els.betaMode.value) === Planner.BETA_MODE_DYNAMIC;
    Planner.els.fixedBetaControl.hidden = isDynamicBeta;
    Planner.els.spxBeta.disabled = isDynamicBeta;
    Planner.els.spxBeta.required = !isDynamicBeta;
    Planner.els.dynamicRiskThresholdControl.hidden = !isDynamicBeta;
    Planner.els.dynamicRiskThreshold.disabled = !isDynamicBeta;
    Planner.els.dynamicRiskThreshold.required = isDynamicBeta;
  }

  function showProgress() {
    Planner.els.runProgress.hidden = false;
    setProgress(0);
  }

  function hideProgress() {
    Planner.els.runProgress.hidden = true;
    Planner.els.runProgressLabel.textContent = "";
    setProgress(0);
  }

  function setProgress(value) {
    const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
    Planner.els.runProgressBar.style.width = `${percent}%`;
    Planner.els.runProgress.setAttribute("aria-valuenow", String(percent));
    Planner.els.runProgressLabel.textContent = Planner.state.isRunning ? `${percent}%` : "";
  }

  function setProgressLabel(text) {
    Planner.els.runProgressLabel.textContent = text;
  }

  function syncRelativeFlowYears() {
    document.querySelectorAll(".flow-row").forEach(updateFlowYearInputs);
  }

  function addFlowRow(container, flow) {
    const node = Planner.els.template.content.firstElementChild.cloneNode(true);
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
    Planner.bindFormattedInputs(node);
    Planner.formatAllFormattedInputs(node);
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
        if (Number.isFinite(startYear)) Planner.validatePlanYear(startYear, `${name || "Cash flow"} start year`);
        if (Number.isFinite(endYear)) Planner.validatePlanYear(endYear, `${name || "Cash flow"} end year`);
        return {
          name,
          amount: Planner.numberFromInput(row.querySelector('[data-field="amount"]')),
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
    return Planner.numberFromInput(fixedInput);
  }

  function readScenario() {
    const scenario = {
      currentYear: Planner.numberFromInput(Planner.els.currentYear),
      deathYear: Planner.numberFromInput(Planner.els.deathYear),
      netWorth: Planner.numberFromInput(Planner.els.netWorth),
      betaMode: Planner.normalizeBetaMode(Planner.els.betaMode.value),
      spxBeta: Planner.numberFromInput(Planner.els.spxBeta),
      dynamicRiskThreshold: Planner.numberFromInput(Planner.els.dynamicRiskThreshold),
      simulationCount: Planner.numberFromInput(Planner.els.simulationCount)
    };

    if (!Number.isFinite(scenario.currentYear) || !Number.isFinite(scenario.deathYear)) {
      throw new Error("Enter valid plan years.");
    }
    Planner.validatePlanYear(scenario.currentYear, "Current year");
    Planner.validatePlanYear(scenario.deathYear, "Expected year of death");
    if (scenario.deathYear < scenario.currentYear) {
      throw new Error("Expected year of death must be after the current year.");
    }
    const planLength = scenario.deathYear - scenario.currentYear + 1;
    if (planLength > Planner.MAX_PLAN_LENGTH_YEARS) {
      throw new Error(`Plan length cannot exceed ${Planner.MAX_PLAN_LENGTH_YEARS} years.`);
    }
    if (!Number.isFinite(scenario.netWorth) || scenario.netWorth < 0) {
      throw new Error("Enter a non-negative current net worth.");
    }
    if (scenario.betaMode === Planner.BETA_MODE_FIXED && !Number.isFinite(scenario.spxBeta)) {
      throw new Error("Enter a valid SPX beta.");
    }
    if (
      scenario.betaMode === Planner.BETA_MODE_DYNAMIC &&
      (!Number.isFinite(scenario.dynamicRiskThreshold) || scenario.dynamicRiskThreshold < 0 || scenario.dynamicRiskThreshold > 1)
    ) {
      throw new Error("Enter an acceptable depletion risk from 0 to 1.");
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
      throw new Error(`This run would create ${Planner.formatNumber(simulationYearRows)} detail rows. Reduce simulations or plan length below ${Planner.formatNumber(Planner.MAX_SIMULATION_YEAR_ROWS)} rows.`);
    }

    scenario.income = readFlowRows(Planner.els.incomeRows, scenario);
    scenario.expenses = readFlowRows(Planner.els.expenseRows, scenario);
    return scenario;
  }

  async function runSimulation() {
    if (Planner.state.isRunning) {
      requestSimulationCancel();
      return;
    }
    if (!Planner.state.marketData || !Planner.state.isDirty) return;

    const runVersion = Planner.state.inputVersion;
    let scenario;
    try {
      scenario = readScenario();
    } catch (error) {
      Planner.els.scenarioSummary.textContent = error.message;
      Planner.state.isDirty = true;
      updateRunState();
      return;
    }

    const seed = Number.isInteger(Planner.state.nextSimulationSeed)
      ? Planner.state.nextSimulationSeed
      : Planner.generateSimulationSeed();
    Planner.state.nextSimulationSeed = null;
    const random = Planner.createSeededRandom(seed);

    Planner.state.isRunning = true;
    Planner.state.cancelRequested = false;
    Planner.state.hover = null;
    Planner.state.detailHover = null;
    Planner.state.policyBucketHover = null;
    showProgress();
    updateRunState();
    await Planner.yieldToBrowser();

    try {
      const results = await Planner.simulateScenario(
        scenario,
        Planner.state.marketData.returns,
        random,
        setProgress,
        () => Planner.state.cancelRequested
      );
      results.seed = seed;
      Planner.state.results = results;
      Planner.state.isDirty = Planner.state.inputVersion !== runVersion;
      Planner.updateShareUrl(scenario, seed);
      Planner.renderResults(results);
    } catch (error) {
      Planner.els.scenarioSummary.textContent = Planner.isCancellationError(error)
        ? "Simulation stopped. Fix the inputs and run again."
        : error.message;
      Planner.state.isDirty = true;
    } finally {
      Planner.state.isRunning = false;
      Planner.state.cancelRequested = false;
      hideProgress();
      updateRunState();
    }
  }

  function requestSimulationCancel() {
    Planner.state.cancelRequested = true;
    setProgressLabel("Stopping...");
    updateRunState();
  }

  Object.assign(Planner, {
    cacheElements,
    setDefaults,
    bindEvents,
    loadMarketData,
    markDirty,
    updateRunState,
    updateBetaModeControls,
    showProgress,
    hideProgress,
    setProgress,
    setProgressLabel,
    syncRelativeFlowYears,
    addFlowRow,
    updateFlowYearInputs,
    readFlowRows,
    resolveFlowYear,
    readScenario,
    runSimulation,
    requestSimulationCancel
  });

  document.addEventListener("DOMContentLoaded", async () => {
    Planner.mountSectionHeaders();
    Planner.cacheElements();
    Planner.setDefaults();
    const sharedPlan = Planner.applySharedPlanFromUrl();
    Planner.bindEvents();
    Planner.resetDetailsControls();
    Planner.switchPage(Planner.getPageFromUrl());
    Planner.updateRunState();
    await Planner.loadMarketData();
    Planner.updateRunState();
    if (sharedPlan && sharedPlan.error) {
      Planner.els.scenarioSummary.textContent = sharedPlan.error;
      Planner.markDirty();
      return;
    }
    if (sharedPlan) {
      Planner.state.nextSimulationSeed = sharedPlan.seed;
      Planner.state.isDirty = true;
      Planner.updateRunState();
      Planner.els.scenarioSummary.textContent = sharedPlan.autorun
        ? "Shared plan loaded. Running simulation..."
        : "Shared plan loaded. Click Run to simulate.";
      if (sharedPlan.autorun) {
        await Planner.runSimulation();
      }
      return;
    }
    Planner.markDirty();
  });
})(window.Planner = window.Planner || {});
