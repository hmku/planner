(function (Planner) {
  function hasDynamicPolicy(results) {
    return Boolean(results && results.scenario.betaMode === Planner.BETA_MODE_DYNAMIC && results.dynamicPolicy);
  }


  function renderResults(results) {
    const { scenario } = results;
    const isDynamic = hasDynamicPolicy(results);
    const lastYear = scenario.deathYear;

    Planner.els.downloadCsv.disabled = false;
    Planner.els.riskMetric.textContent = Planner.formatPercent(results.risk);
    Planner.els.riskMetricNote.textContent = `${Planner.formatNumber(results.depletedCount)} of ${Planner.formatNumber(scenario.simulationCount)} paths deplete by ${lastYear}`;
    Planner.els.terminalWealthMetric.textContent = Planner.formatCompactCurrency(results.expectedTerminalWealth);
    Planner.els.terminalWealthMetric.title = Planner.formatCurrency(results.expectedTerminalWealth);
    Planner.els.terminalWealthMetricNote.textContent = `Median ${Planner.formatCompactCurrency(Planner.percentileOfSorted(results.terminalWealthSorted, 0.5))}, current dollars`;
    Planner.els.currentBetaMetricLabel.textContent = isDynamic ? "Recommended SPX beta" : "SPX beta";
    Planner.els.currentBetaMetric.textContent = Planner.formatBeta(getCurrentBeta(results));
    Planner.els.currentBetaMetricNote.textContent = isDynamic
      ? `Min-risk policy at ${Planner.formatCompactCurrency(scenario.netWorth)} in ${scenario.currentYear}`
      : "Fixed for every year";

    updateScenarioSummary(results);
    Planner.els.netWorthSummary.textContent = `Expected current-dollar net worth across ${Planner.formatNumber(scenario.simulationCount)} simulations, with ${Planner.formatNumber(results.visualPaths.length)} randomly sampled paths. Hover a path for details.`;
    updateFrontierSummary(results);

    renderSimulationSelect(results);
    renderSimulationPathTable(results);
    renderDynamicPolicyControls(results);
    Planner.renderCharts(results);
  }


  function updateFrontierSummary(results) {
    let text;
    if (!hasDynamicPolicy(results)) {
      text = "Set beta mode to Dynamic and run a simulation to see the risk/wealth tradeoff.";
    } else {
      text = `Risk/wealth tradeoff across ${Planner.formatNumber(results.dynamicPolicy.frontier.length)} dynamic beta policies. The red point is the min-risk policy used for the simulation.`;
    }
    Planner.els.frontierSummary.textContent = text;
  }


  function resetDetailsControls() {
    Planner.populateSelect(Planner.els.simulationSelect, [], {
      placeholder: { label: "Run a simulation first" }
    });
    Planner.els.downloadCsv.disabled = true;
    Planner.els.downloadPolicyCsv.disabled = true;
    Planner.els.dynamicPolicySection.hidden = true;
    Planner.els.policyEmptyState.hidden = false;
  }


  function getCurrentBeta(results) {
    return hasDynamicPolicy(results)
      ? Planner.selectDynamicBeta(results.dynamicPolicy, 0, results.scenario.netWorth)
      : results.scenario.spxBeta;
  }


  function updateScenarioSummary(results) {
    const total = Planner.formatNumber(results.scenario.simulationCount);
    const modeText = hasDynamicPolicy(results)
      ? "Dynamic beta, minimum run-out risk policy."
      : `Fixed beta ${Planner.formatBeta(results.scenario.spxBeta)}.`;
    const chartText = Planner.els.showDepleted.checked
      ? "Bars show depleted paths only; probabilities use all simulations."
      : "Bars include paths that never deplete.";
    Planner.els.scenarioSummary.textContent = `${modeText} ${Planner.formatNumber(results.depletedCount)} of ${total} paths depleted (${Planner.formatPercent(results.risk)}). ${chartText}`;
  }

  // ---------- Simulation detail ----------

  function renderSimulationSelect(results) {
    Planner.populateSelect(Planner.els.simulationSelect, results.inspectionPaths, {
      previousValue: Number(Planner.els.simulationSelect.value) || null,
      getValue: (path) => path.simulation,
      getLabel: (path, index) => {
        const label = `#${index + 1} · ${Planner.formatCurrency(path.terminalWealth)}`;
        return path.failureYear ? `${label} · depleted ${path.failureYear}` : label;
      }
    });
  }


  function getSelectedSimulation() {
    return Number(Planner.els.simulationSelect.value) || null;
  }


  // Replayed rows for the selected simulation, cached so hover redraws are cheap.
  function getSelectedSimulationRows(results) {
    const simulation = getSelectedSimulation();
    if (!simulation) return [];
    if (results.selectedRowsCache?.simulation !== simulation) {
      results.selectedRowsCache = { simulation, rows: Planner.getSimulationYearRows(results, simulation) };
    }
    return results.selectedRowsCache.rows;
  }


  function describeRowStatus(row) {
    if (row.depletedThisYear) return "Depleted";
    return row.depletionYear ? `After depletion (${row.depletionYear})` : "Active";
  }

  const SIMULATION_PATH_COLUMNS = [
    { render: (row) => row.year },
    { render: (row) => row.historicalReturnYear || "--" },
    { render: (row) => Planner.formatCurrency(row.startingWealth) },
    { render: (row) => Planner.formatCurrency(row.income) },
    { render: (row) => Planner.formatCurrency(row.expenses) },
    { render: (row) => Planner.formatPercent(row.nominalSpxReturn) },
    { render: (row) => Planner.formatPercent(row.nominalRiskFreeReturn) },
    { render: (row) => Planner.formatPercent(row.nominalSpxExcessReturn) },
    { render: (row) => Planner.formatBeta(row.spxBetaUsed) },
    { render: (row) => Planner.formatPercent(row.inflation) },
    { render: (row) => Planner.formatPercent(row.realSpxReturn) },
    { render: (row) => Planner.formatPercent(row.nominalPortfolioReturn) },
    { render: (row) => Planner.formatPercent(row.portfolioRealReturn) },
    { render: (row) => Planner.formatCurrency(row.endingWealth) },
    {
      render: describeRowStatus,
      className: (row) => row.depletedThisYear ? "text status-depleted" : row.depletionYear ? "text status-after" : "text"
    }
  ];

  function renderSimulationPathTable(results) {
    const rows = getSelectedSimulationRows(results);
    const summary = results.simulationRows[getSelectedSimulation() - 1];
    Planner.els.selectedSimulationSummary.textContent = summary
      ? `Simulation #${Planner.formatNumber(summary.simulation)} ends at ${Planner.formatCurrency(summary.terminalWealth)} (${Planner.formatPercent(summary.endingPercentile)} percentile)${summary.failureYear ? `, depleted in ${summary.failureYear}` : ", never depleted"}. The picker lists the ${Planner.formatNumber(results.inspectionPaths.length)} sampled paths, sorted by ending wealth.`
      : "Run a simulation to inspect one path.";
    Planner.renderTableBody(Planner.els.simulationPathTable, SIMULATION_PATH_COLUMNS, rows, "No rows for this simulation.");
  }

  // ---------- Dynamic policy ----------

  function renderDynamicPolicyControls(results) {
    const isDynamic = hasDynamicPolicy(results);
    Planner.els.dynamicPolicySection.hidden = !isDynamic;
    Planner.els.policyEmptyState.hidden = isDynamic;
    Planner.els.downloadPolicyCsv.disabled = !isDynamic;
    if (!isDynamic) return;

    Planner.populateSelect(Planner.els.policyYearSelect, results.years, {
      previousValue: Number(Planner.els.policyYearSelect.value) || results.scenario.currentYear,
      getValue: (year) => year,
      getLabel: String
    });
    renderPolicyPathControls(results);
    renderDynamicPolicyTable(results);
    renderPolicyPathExplorer(results);
  }


  function getSelectedPolicyYearIndex(results) {
    const index = results.years.indexOf(Number(Planner.els.policyYearSelect.value));
    return index >= 0 ? index : 0;
  }


  // Rows for the wealth-bucket plot and bucket picker for the selected plan year.
  function getPolicyBucketView(results) {
    const yearIndex = getSelectedPolicyYearIndex(results);
    const isCurrentYear = yearIndex === 0;
    return {
      yearIndex,
      isCurrentYear,
      metric: Planner.els.policyMetricSelect.value,
      currentBucketIndex: isCurrentYear
        ? Planner.nearestBucketIndex(results.dynamicPolicy.wealthBuckets, results.scenario.netWorth)
        : null,
      rows: getDynamicPolicyRows(results, yearIndex)
        .filter((row) => row.wealth <= Planner.DYNAMIC_DISPLAY_MAX_WEALTH_BUCKET)
    };
  }


  function renderDynamicPolicyTable(results) {
    if (!hasDynamicPolicy(results)) return;

    const view = getPolicyBucketView(results);
    const metricLabel = Planner.getPolicyMetric(view.metric).label;
    const wealthBuckets = results.dynamicPolicy.wealthBuckets;
    Planner.els.policyBucketPlotTitle.textContent = `${metricLabel} vs wealth`;
    Planner.els.dynamicPolicySummary.textContent = `Minimum run-out risk policy for ${results.years[view.yearIndex]}. Plots show wealth buckets up to ${Planner.formatCompactCurrency(Planner.DYNAMIC_DISPLAY_MAX_WEALTH_BUCKET)}; the solver grid extends to ${Planner.formatCompactCurrency(wealthBuckets[wealthBuckets.length - 1])}.`;

    const previousBucket = Planner.els.policyBucketSelect.value;
    Planner.populateSelect(Planner.els.policyBucketSelect, view.rows, {
      previousValue: previousBucket !== "" ? previousBucket : view.currentBucketIndex ?? view.rows[1]?.bucketIndex,
      getValue: (row) => row.bucketIndex,
      getLabel: (row) => row.bucketIndex === view.currentBucketIndex
        ? `${Planner.formatCurrency(row.wealth)} (current)`
        : Planner.formatCurrency(row.wealth)
    });

    const bucketIndex = Number(Planner.els.policyBucketSelect.value);
    Planner.renderTableBody(
      Planner.els.dynamicPolicyActionTable,
      POLICY_ACTION_TABLE_COLUMNS,
      getDynamicPolicyActionRows(results, view.yearIndex, bucketIndex),
      "No beta alternatives for this bucket.",
      (row) => row.isRecommended ? "is-marked" : ""
    );
    Planner.renderChart("policyBucket");
  }

  const POLICY_ACTION_TABLE_COLUMNS = [
    { render: (row) => Planner.formatBeta(row.beta) },
    { render: (row) => Planner.formatPolicyRiskPercent(row.estimatedDepletionRisk) },
    { render: (row) => Planner.formatCurrency(row.expectedTerminalWealth) },
    { render: (row) => row.isRecommended ? "Recommended" : "", className: "text" }
  ];


  function getDynamicPolicyRows(results, yearIndex) {
    const policy = results.dynamicPolicy;
    const policyRow = policy.policyByYear[yearIndex] || [];
    const valueRow = policy.valueByYear[yearIndex] || [];
    const expectedWealthRow = policy.expectedWealthByYear[yearIndex] || [];
    return policy.wealthBuckets.map((wealth, bucketIndex) => ({
      bucketIndex,
      wealth,
      beta: policyRow[bucketIndex],
      estimatedDepletionRisk: valueRow[bucketIndex],
      expectedTerminalWealth: expectedWealthRow[bucketIndex]
    }));
  }


  function getDynamicPolicyActionRows(results, yearIndex, bucketIndex) {
    const policy = results.dynamicPolicy;
    const actionRiskRow = policy.actionValueByYear[yearIndex]?.[bucketIndex] || [];
    const actionExpectedWealthRow = policy.actionExpectedWealthByYear[yearIndex]?.[bucketIndex] || [];
    const recommendedBeta = policy.policyByYear[yearIndex]?.[bucketIndex];
    return policy.betaValues.map((beta, betaIndex) => ({
      bucketIndex,
      wealth: policy.wealthBuckets[bucketIndex],
      beta,
      recommendedBeta,
      estimatedDepletionRisk: actionRiskRow[betaIndex],
      expectedTerminalWealth: actionExpectedWealthRow[betaIndex],
      isRecommended: Math.abs(beta - recommendedBeta) <= Planner.EPSILON
    }));
  }

  // ---------- Policy path explorer ----------

  const RETURN_MODE_LABELS = {
    expected: "Expected",
    p10: "Bad",
    median: "Median",
    p90: "Good",
    best: "Best",
    worst: "Worst",
    specific: "Specific"
  };

  const RETURN_MODE_QUANTILES = { worst: 0, p10: 0.1, median: 0.5, p90: 0.9, best: 1 };

  function renderPolicyPathControls(results) {
    const selectedBeta = Planner.els.policyPathBeta.value;
    Planner.populateSelect(Planner.els.policyPathBeta, results.dynamicPolicy.betaValues, {
      previousValue: selectedBeta !== "" ? selectedBeta : getCurrentBeta(results),
      getValue: (beta) => beta,
      getLabel: Planner.formatBeta
    });

    const returnRows = results.returnRows;
    Planner.populateSelect(Planner.els.policyPathReturnYear, returnRows, {
      previousValue: Number(Planner.els.policyPathReturnYear.value) || returnRows[returnRows.length - 1]?.year,
      getValue: (row) => row.year,
      getLabel: (row) => `${row.year} · ${Planner.formatPercent(Planner.nominalSpxReturnOf(row))}`
    });
  }


  function renderPolicyPathExplorer(results) {
    if (!hasDynamicPolicy(results)) return;

    const explorer = buildPolicyPathExplorer(results);
    results.policyPathExplorer = explorer;
    Planner.els.policyPathReturnYear.disabled = explorer.returnMode !== "specific";
    Planner.els.policyPathSummary.textContent = buildPolicyPathSummary(explorer);
    Planner.renderChart("policyPath");
    Planner.renderTableBody(Planner.els.policyPathTable, POLICY_PATH_TABLE_COLUMNS, explorer.rows, "No path rows for this scenario.");
  }

  const POLICY_PATH_TABLE_COLUMNS = [
    { render: (row) => row.year },
    { render: (row) => Planner.formatCurrency(row.startingWealth) },
    { render: (row) => Planner.formatBeta(row.beta) },
    { render: (row) => row.returnLabel, className: "text" },
    { render: (row) => Planner.formatPercent(row.nominalSpxReturn) },
    { render: (row) => Planner.formatPercent(row.inflation) },
    { render: (row) => Planner.formatCurrency(row.endingWealth) },
    { render: (row) => Planner.formatBeta(row.nextPolicyBeta) },
    { render: (row) => Planner.formatPolicyRiskPercent(row.nodeRisk) }
  ];


  // Deterministic what-if: force one beta for N years under a single return
  // assumption, then read the policy's risk and next beta at the resulting node.
  function buildPolicyPathExplorer(results) {
    const { scenario, years } = results;
    const overrideBeta = Number(Planner.els.policyPathBeta.value);
    const rawYears = Math.round(Number(Planner.els.policyPathYears.value));
    const overrideYears = Planner.clamp(Number.isFinite(rawYears) ? rawYears : 5, 1, Math.min(10, years.length));
    Planner.els.policyPathYears.value = overrideYears;

    const returnMode = Planner.els.policyPathReturnMode.value;
    const returnRow = getPolicyPathReturnRow(results.returnRows, returnMode);
    const returnLabel = returnMode === "expected" ? "Expected" : `${RETURN_MODE_LABELS[returnMode] || "Selected"} ${returnRow.year}`;
    const metrics = Planner.buildReturnMetrics(returnRow, overrideBeta);
    const rows = [];
    const points = [{ year: scenario.currentYear, wealth: scenario.netWorth }];
    let wealth = scenario.netWorth;
    let depleted = false;

    for (let yearIndex = 0; yearIndex < overrideYears; yearIndex += 1) {
      const year = years[yearIndex];
      const startingWealth = wealth;
      if (!depleted) {
        const netCashFlow = Planner.cashFlowForYear(scenario.income, year) - Planner.cashFlowForYear(scenario.expenses, year);
        const yearResult = Planner.applyContinuousYear(wealth, netCashFlow, metrics.realGrowthFactor);
        wealth = yearResult.endingWealth;
        depleted = yearResult.depleted;
      }
      const nodeMetrics = getPolicyNodeMetrics(results, yearIndex + 1, wealth, depleted);
      rows.push({
        year,
        startingWealth,
        beta: overrideBeta,
        returnLabel,
        nominalSpxReturn: metrics.nominalSpxReturn,
        inflation: metrics.inflation,
        endingWealth: wealth,
        nextPolicyBeta: nodeMetrics.nextPolicyBeta,
        nodeRisk: nodeMetrics.risk
      });
      points.push({ year: years[yearIndex + 1] ?? year + 1, wealth });
    }

    const finalMetrics = getPolicyNodeMetrics(results, overrideYears, wealth, depleted);
    return {
      overrideBeta,
      overrideYears,
      returnMode,
      returnLabel,
      rows,
      points,
      finalWealth: wealth,
      finalRisk: finalMetrics.risk,
      finalExpectedTerminalWealth: finalMetrics.expectedTerminalWealth,
      finalPolicyBeta: finalMetrics.nextPolicyBeta
    };
  }


  function getPolicyNodeMetrics(results, yearIndex, wealth, depleted) {
    if (depleted) {
      return { risk: 1, expectedTerminalWealth: 0, nextPolicyBeta: null };
    }
    if (yearIndex >= results.years.length) {
      return { risk: 0, expectedTerminalWealth: wealth, nextPolicyBeta: null };
    }
    const policy = results.dynamicPolicy;
    return {
      risk: Planner.interpolateBucketValue(policy.wealthBuckets, policy.valueByYear[yearIndex], wealth),
      expectedTerminalWealth: Planner.interpolateBucketValue(policy.wealthBuckets, policy.expectedWealthByYear[yearIndex], wealth),
      nextPolicyBeta: Planner.selectDynamicBeta(policy, yearIndex, wealth)
    };
  }


  function getPolicyPathReturnRow(returnRows, mode) {
    if (mode === "expected") {
      const average = (getValue) => returnRows.reduce((sum, row) => sum + (getValue(row) ?? 0), 0) / returnRows.length;
      return {
        year: "Expected",
        nominalReturn: average(Planner.nominalSpxReturnOf),
        riskFreeReturn: average((row) => row.riskFreeReturn),
        inflation: average((row) => row.inflation)
      };
    }
    if (mode === "specific") {
      const selectedYear = Number(Planner.els.policyPathReturnYear.value);
      return returnRows.find((row) => row.year === selectedYear) || returnRows[returnRows.length - 1];
    }
    const sortedRows = [...returnRows].sort((a, b) => Planner.nominalSpxReturnOf(a) - Planner.nominalSpxReturnOf(b));
    const quantile = RETURN_MODE_QUANTILES[mode] ?? 0.5;
    return sortedRows[Math.round((sortedRows.length - 1) * quantile)];
  }


  function buildPolicyPathSummary(explorer) {
    const resume = Number.isFinite(explorer.finalPolicyBeta)
      ? `the policy then resumes at beta ${Planner.formatBeta(explorer.finalPolicyBeta)}`
      : "the plan horizon is reached";
    return `Forcing beta ${Planner.formatBeta(explorer.overrideBeta)} for ${Planner.formatNumber(explorer.overrideYears)} years of ${explorer.returnLabel.toLowerCase()} returns; ${resume}. End node: ${Planner.formatCurrency(explorer.finalWealth)}, ${Planner.formatPolicyRiskPercent(explorer.finalRisk)} depletion risk, ${Planner.formatCurrency(explorer.finalExpectedTerminalWealth)} expected terminal wealth.`;
  }

  // ---------- CSV ----------

  // Exports the sampled inspection paths (the ones in the Simulation picker), in
  // picker order, rather than every simulation-year of the run.
  function downloadSimulationCsv() {
    const results = Planner.state.results;
    if (!results) return;
    const headers = [
      "inspection_rank",
      "simulation",
      "year",
      "historical_return_year",
      "starting_wealth_current_dollars",
      "income_current_dollars",
      "expenses_current_dollars",
      "net_cash_flow_current_dollars",
      "nominal_spx_return",
      "risk_free_return",
      "spx_excess_return",
      "spx_beta_used",
      "portfolio_nominal_return",
      "inflation",
      "real_spx_return",
      "real_risk_free_return",
      "portfolio_real_return",
      "ending_wealth_current_dollars",
      "depleted_this_year",
      "depletion_year",
      "terminal_wealth_current_dollars",
      "ending_percentile"
    ];
    function* rows() {
      for (const [index, path] of results.inspectionPaths.entries()) {
        const summary = results.simulationRows[path.simulation - 1];
        for (const row of Planner.getSimulationYearRows(results, path.simulation)) {
          yield [
            index + 1,
            row.simulation,
            row.year,
            row.historicalReturnYear,
            row.startingWealth,
            row.income,
            row.expenses,
            row.netCashFlow,
            row.nominalSpxReturn,
            row.nominalRiskFreeReturn,
            row.nominalSpxExcessReturn,
            row.spxBetaUsed,
            row.nominalPortfolioReturn,
            row.inflation,
            row.realSpxReturn,
            row.realRiskFreeReturn,
            row.portfolioRealReturn,
            row.endingWealth,
            row.depletedThisYear ? "yes" : "no",
            row.depletionYear,
            summary.terminalWealth,
            summary.endingPercentile
          ];
        }
      }
    }
    Planner.downloadCsvFile(`financial-planner-sampled-paths-${Date.now()}.csv`, headers, rows());
  }


  function downloadPolicyCsv() {
    const results = Planner.state.results;
    if (!hasDynamicPolicy(results)) return;
    const headers = [
      "year",
      "bucket_index",
      "bucket_wealth_current_dollars",
      "evaluated_spx_beta",
      "estimated_depletion_probability",
      "expected_terminal_wealth_current_dollars",
      "is_recommended_beta",
      "recommended_spx_beta",
      "shown_in_ui"
    ];
    const rows = results.years.flatMap((year, yearIndex) => (
      results.dynamicPolicy.wealthBuckets.flatMap((_, bucketIndex) => (
        getDynamicPolicyActionRows(results, yearIndex, bucketIndex).map((row) => [
          year,
          row.bucketIndex,
          row.wealth,
          row.beta,
          row.estimatedDepletionRisk,
          row.expectedTerminalWealth,
          row.isRecommended ? "yes" : "no",
          row.recommendedBeta,
          row.wealth <= Planner.DYNAMIC_DISPLAY_MAX_WEALTH_BUCKET ? "yes" : "no"
        ])
      ))
    ));
    Planner.downloadCsvFile(`financial-planner-dynamic-beta-policy-${Date.now()}.csv`, headers, rows);
  }

  // ---------- Tabs ----------

  function switchPage(page) {
    const nextPage = Planner.normalizePage(page);
    Planner.state.activePage = nextPage;
    Planner.clearHover();
    Planner.updatePageUrl(nextPage);
    Planner.els.pageButtons.forEach((button) => {
      const isActive = button.dataset.page === nextPage;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-current", isActive ? "page" : "false");
    });
    Planner.PAGE_IDS.forEach((pageId) => {
      Planner.els[`${pageId}Page`].hidden = pageId !== nextPage;
    });
    if (Planner.state.results) Planner.renderCharts(Planner.state.results);
  }

  Object.assign(Planner, {
    hasDynamicPolicy,
    renderResults,
    resetDetailsControls,
    updateScenarioSummary,
    getSelectedSimulationRows,
    renderSimulationPathTable,
    renderDynamicPolicyTable,
    getPolicyBucketView,
    renderPolicyPathExplorer,
    downloadSimulationCsv,
    downloadPolicyCsv,
    switchPage
  });
})(window.Planner = window.Planner || {});
