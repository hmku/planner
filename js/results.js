(function (Planner) {
  function renderResults(results) {
    const simulations = results.scenario.simulationCount;
    Planner.els.simulationSelect.disabled = false;
    Planner.els.downloadCsv.disabled = false;
    Planner.els.riskMetric.textContent = Planner.formatPercent(results.risk);
    Planner.els.medianWealthMetric.textContent = Planner.formatCompactCurrency(results.medianTerminalWealth);
    Planner.els.medianWealthMetric.title = Planner.formatCurrency(results.medianTerminalWealth);
    Planner.els.currentBetaMetricLabel.textContent = results.scenario.betaMode === Planner.BETA_MODE_DYNAMIC
      ? "Current recommended SPX beta"
      : "Current SPX beta";
    Planner.els.currentBetaMetric.textContent = Planner.formatBeta(getCurrentBeta(results));
    updateScenarioSummary(results);
    Planner.els.netWorthSummary.textContent = `Expected current-dollar net worth across all ${Planner.formatNumber(simulations)} simulations, with ${Planner.formatNumber(results.visualPaths.length)} downsampled paths for hover inspection.`;

    renderSimulationSelect(results);
    renderSimulationPathTable(results);
    renderDynamicPolicyControls(results);
    Planner.renderCharts(results);
  }



  function resetDetailsControls() {
    Planner.populateSelect(Planner.els.simulationSelect, [], {
      placeholder: { label: "Run simulation first", value: "", disabled: true }
    });
    Planner.els.downloadCsv.disabled = true;
    Planner.els.downloadPolicyCsv.disabled = true;
    Planner.els.dynamicPolicySection.hidden = true;
    Planner.els.policyYearSelect.replaceChildren();
    Planner.els.policyBucketSelect.replaceChildren();
    Planner.els.policyPathBeta.replaceChildren();
    Planner.els.policyPathReturnYear.replaceChildren();
    Planner.els.policyPathReturnYear.disabled = true;
    Planner.els.policyPathTable.innerHTML = `<tr><td colspan="9">Run dynamic beta to inspect a policy path.</td></tr>`;
    Planner.els.policyPathSummary.textContent = "Run dynamic beta to inspect a policy path.";
    Planner.els.dynamicPolicyActionTable.innerHTML = `<tr><td colspan="4">Run dynamic beta to inspect beta alternatives.</td></tr>`;
    Planner.els.dynamicPolicySummary.textContent = "Run dynamic beta to inspect the policy.";
    Planner.els.selectedSimulationSummary.textContent = "Run a simulation to inspect one path.";
  }



  function getCurrentBeta(results) {
    if (results.scenario.betaMode !== Planner.BETA_MODE_DYNAMIC || !results.dynamicPolicy) {
      return results.scenario.spxBeta;
    }
    return Planner.selectDynamicBeta(results.dynamicPolicy, 0, results.scenario.netWorth);
  }



  function updateScenarioSummary(results) {
    const simulations = results.scenario.simulationCount;
    const modeText = results.scenario.betaMode === Planner.BETA_MODE_DYNAMIC
      ? `Dynamic beta used a causal annual bootstrap and year/wealth policy with ${Planner.formatPolicyRiskPercent(results.scenario.dynamicRiskThreshold)} acceptable depletion risk.`
      : `Fixed beta ${Planner.formatBeta(results.scenario.spxBeta)} used annual historical return sampling.`;
    const depletedText = `${Planner.formatNumber(results.failureYears.length)} of ${Planner.formatNumber(simulations)} paths depleted (${Planner.formatPercent(results.risk)}).`;
    const notDepletedText = `${Planner.formatNumber(results.notDepletedCount)} paths did not deplete (${Planner.formatPercent(1 - results.risk)}).`;
    const chartText = Planner.els.showDepleted.checked
      ? "The chart shows only depleted paths, while probabilities still use all simulations as the denominator."
      : "The chart includes both depleted and not-depleted paths.";
    Planner.els.scenarioSummary.textContent = `${modeText} ${depletedText} ${notDepletedText} ${chartText}`;
  }



  function renderSimulationSelect(results) {
    Planner.populateSelect(Planner.els.simulationSelect, results.inspectionPaths, {
      previousValue: Number(Planner.els.simulationSelect.value) || 1,
      getValue: (path) => path.simulation,
      getLabel: (path, index) => {
        const rankLabel = `#${Planner.formatNumber(index + 1)}`;
        return path.failureYear
          ? `${rankLabel} · ${Planner.formatCurrency(path.terminalWealth)} · dep ${path.failureYear}`
          : `${rankLabel} · ${Planner.formatCurrency(path.terminalWealth)}`;
      }
    });
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
      render: (row) => row.depletedThisYear
        ? "Depleted"
        : row.depletionYear
          ? `After depletion (${row.depletionYear})`
          : "Active"
    }
  ];

  function renderSimulationPathTable(results) {
    const selectedSimulation = Number(Planner.els.simulationSelect.value) || 1;
    const rows = results.simulationYearRowsBySimulation.get(selectedSimulation) || [];
    Planner.renderTableBody(
      Planner.els.simulationPathTable,
      SIMULATION_PATH_COLUMNS,
      rows,
      "No rows for this simulation."
    );
  }



  function renderDynamicPolicyControls(results) {
    const hasDynamicPolicy = results.scenario.betaMode === Planner.BETA_MODE_DYNAMIC && results.dynamicPolicy;
    Planner.els.dynamicPolicySection.hidden = !hasDynamicPolicy;
    Planner.els.downloadPolicyCsv.disabled = !hasDynamicPolicy;
    if (!hasDynamicPolicy) return;

    Planner.populateSelect(Planner.els.policyYearSelect, results.years, {
      previousValue: Number(Planner.els.policyYearSelect.value) || results.scenario.currentYear,
      getValue: (year) => year,
      getLabel: (year) => String(year)
    });
    renderPolicyPathControls(results);
    renderPolicyPathExplorer(results);
    renderDynamicPolicyTable(results);
  }



  function renderDynamicPolicyTable(results) {
    if (results.scenario.betaMode !== Planner.BETA_MODE_DYNAMIC || !results.dynamicPolicy) return;

    const selectedYear = Number(Planner.els.policyYearSelect.value) || results.scenario.currentYear;
    const yearIndex = results.years.indexOf(selectedYear);
    if (yearIndex < 0) {
      Planner.els.dynamicPolicyActionTable.innerHTML = `<tr><td colspan="4">No beta alternatives for this year.</td></tr>`;
      Planner.renderPolicyBucketPlot(Planner.els.dynamicPolicyCanvas, results, [], "beta", null);
      return;
    }

    const currentBucketIndex = selectedYear === results.scenario.currentYear
      ? Planner.nearestBucketIndex(results.dynamicPolicy.wealthBuckets, results.scenario.netWorth)
      : null;
    const rows = getVisibleDynamicPolicyRows(results, yearIndex).map((row) => {
      const markers = [];
      if (row.bucketIndex === currentBucketIndex) markers.push("Current wealth");
      return { ...row, markers };
    });
    const metricLabel = getPolicyMetricLabel(Planner.els.policyMetricSelect.value);
    Planner.els.policyBucketPlotTitle.textContent = `${metricLabel} vs current wealth`;
    Planner.els.dynamicPolicySummary.textContent = `${selectedYear} scenario policy · acceptable depletion risk ${Planner.formatPolicyRiskPercent(results.scenario.dynamicRiskThreshold)} · plotting ${metricLabel.toLowerCase()} across visible wealth buckets through ${Planner.formatCompactCurrency(Planner.DYNAMIC_DISPLAY_MAX_WEALTH_BUCKET)}; DP grid runs through ${Planner.formatCompactCurrency(results.dynamicPolicy.wealthBuckets[results.dynamicPolicy.wealthBuckets.length - 1])}.`;
    renderPolicyBucketSelect(rows, currentBucketIndex);
    renderDynamicPolicyActionTable(results, yearIndex);
    Planner.renderPolicyBucketPlot(
      Planner.els.dynamicPolicyCanvas,
      results,
      rows,
      Planner.els.policyMetricSelect.value,
      currentBucketIndex
    );
  }



  function renderPolicyBucketSelect(rows, preferredBucketIndex) {
    Planner.populateSelect(Planner.els.policyBucketSelect, rows, {
      previousValue: Number(Planner.els.policyBucketSelect.value) || preferredBucketIndex || rows[0]?.bucketIndex,
      getValue: (row) => row.bucketIndex,
      getLabel: (row) => `#${Planner.formatNumber(row.bucketIndex)} · ${Planner.formatCurrency(row.wealth)}`
    });
  }



  function getPolicyMetricLabel(metric) {
    if (metric === "risk") return "Estimated depletion risk";
    if (metric === "terminalWealth") return "Expected terminal wealth";
    return "Optimal SPX beta";
  }



  function renderPolicyPathControls(results) {
    const currentBeta = Planner.selectDynamicBeta(results.dynamicPolicy, 0, results.scenario.netWorth);
    const selectedBeta = Number(Planner.els.policyPathBeta.value);
    Planner.populateSelect(Planner.els.policyPathBeta, results.dynamicPolicy.betaValues, {
      previousValue: Number.isFinite(selectedBeta) ? selectedBeta : currentBeta,
      getValue: (beta) => beta,
      getLabel: (beta) => Planner.formatBeta(beta)
    });

    const returnRows = getMarketReturnRows();
    Planner.populateSelect(Planner.els.policyPathReturnYear, returnRows, {
      previousValue: Number(Planner.els.policyPathReturnYear.value) || returnRows[returnRows.length - 1]?.year,
      getValue: (row) => row.year,
      getLabel: (row) => `${row.year} · ${Planner.formatPercent(row.nominalReturn ?? row.return)}`
    });
    Planner.els.policyPathReturnYear.disabled = Planner.els.policyPathReturnMode.value !== "specific";
  }



  function renderPolicyPathExplorer(results) {
    if (results.scenario.betaMode !== Planner.BETA_MODE_DYNAMIC || !results.dynamicPolicy) return;

    const explorer = buildPolicyPathExplorer(results);
    results.policyPathExplorer = explorer;
    Planner.els.policyPathReturnYear.disabled = explorer.returnMode !== "specific";
    Planner.els.policyPathSummary.textContent = buildPolicyPathSummary(explorer);
    Planner.renderPolicyPathChart(Planner.els.policyPathCanvas, results, explorer);
    Planner.renderTableBody(
      Planner.els.policyPathTable,
      POLICY_PATH_TABLE_COLUMNS,
      explorer.rows,
      "No path rows for this scenario."
    );
  }



  const POLICY_PATH_TABLE_COLUMNS = [
    { render: (row) => row.year },
    { render: (row) => Planner.formatCurrency(row.startingWealth) },
    { render: (row) => Planner.formatBeta(row.beta) },
    { render: (row) => row.returnLabel },
    { render: (row) => Planner.formatPercent(row.nominalSpxReturn) },
    { render: (row) => Planner.formatPercent(row.inflation) },
    { render: (row) => Planner.formatCurrency(row.endingWealth) },
    { render: (row) => Planner.formatBeta(row.nextPolicyBeta) },
    { render: (row) => Planner.formatPolicyRiskPercent(row.nodeRisk) }
  ];



  function buildPolicyPathExplorer(results) {
    const overrideBeta = Number(Planner.els.policyPathBeta.value);
    const rawYears = Math.round(Number(Planner.els.policyPathYears.value));
    const overrideYears = Math.max(1, Math.min(10, Number.isFinite(rawYears) ? rawYears : 5, results.years.length));
    Planner.els.policyPathYears.value = overrideYears;

    const returnMode = Planner.els.policyPathReturnMode.value;
    const returnRow = getPolicyPathReturnRow(returnMode);
    const returnLabel = getPolicyPathReturnLabel(returnMode, returnRow);
    const rows = [];
    const points = [{ year: results.scenario.currentYear, wealth: results.scenario.netWorth }];
    let wealth = results.scenario.netWorth;
    let depleted = false;

    for (let yearIndex = 0; yearIndex < overrideYears; yearIndex += 1) {
      const year = results.years[yearIndex];
      const income = Planner.cashFlowForYear(results.scenario.income, year);
      const expenses = Planner.cashFlowForYear(results.scenario.expenses, year);
      const netCashFlow = income - expenses;
      const returnMetrics = Planner.buildReturnMetrics(returnRow, overrideBeta);
      const yearResult = depleted
        ? { startingWealth: 0, endingWealth: 0, depleted: true }
        : Planner.applyContinuousYear(wealth, netCashFlow, returnMetrics.realGrowthFactor);
      wealth = yearResult.depleted ? 0 : yearResult.endingWealth;
      depleted = depleted || yearResult.depleted;
      const nextYearIndex = yearIndex + 1;
      const nodeMetrics = getPolicyNodeMetrics(results, nextYearIndex, wealth, depleted);

      rows.push({
        year,
        startingWealth: yearResult.startingWealth,
        beta: overrideBeta,
        returnLabel,
        nominalSpxReturn: returnMetrics.nominalSpxReturn,
        inflation: returnMetrics.inflation,
        endingWealth: wealth,
        nextPolicyBeta: nodeMetrics.nextPolicyBeta,
        nodeRisk: nodeMetrics.risk
      });
      points.push({ year: results.years[nextYearIndex] || year, wealth });
    }

    const finalMetrics = getPolicyNodeMetrics(results, overrideYears, wealth, depleted);
    return {
      overrideBeta,
      overrideYears,
      returnMode,
      returnRow,
      returnLabel,
      rows,
      points,
      finalYear: results.years[overrideYears] || results.years[results.years.length - 1],
      finalWealth: wealth,
      finalRisk: finalMetrics.risk,
      finalExpectedTerminalWealth: finalMetrics.expectedTerminalWealth,
      finalPolicyBeta: finalMetrics.nextPolicyBeta,
      depleted
    };
  }



  function getPolicyNodeMetrics(results, yearIndex, wealth, depleted) {
    if (depleted) {
      return {
        risk: 1,
        expectedTerminalWealth: 0,
        nextPolicyBeta: null
      };
    }
    if (yearIndex >= results.years.length) {
      return {
        risk: 0,
        expectedTerminalWealth: wealth,
        nextPolicyBeta: null
      };
    }
    const policy = results.dynamicPolicy;
    return {
      risk: Planner.interpolateBucketValue(policy.wealthBuckets, policy.valueByYear[yearIndex], wealth),
      expectedTerminalWealth: Planner.interpolateBucketValue(policy.wealthBuckets, policy.expectedWealthByYear[yearIndex], wealth),
      nextPolicyBeta: Planner.selectDynamicBeta(policy, yearIndex, wealth)
    };
  }



  function getPolicyPathReturnRow(mode) {
    const returnRows = getMarketReturnRows();
    if (mode === "expected") {
      return {
        year: "Expected",
        nominalReturn: averageReturnField(returnRows, "nominalReturn", "return"),
        riskFreeReturn: averageReturnField(returnRows, "riskFreeReturn"),
        inflation: averageReturnField(returnRows, "inflation")
      };
    }
    if (mode === "specific") {
      const selectedYear = Number(Planner.els.policyPathReturnYear.value);
      return returnRows.find((row) => row.year === selectedYear) || returnRows[returnRows.length - 1];
    }

    const sortedRows = [...returnRows].sort((a, b) => (a.nominalReturn ?? a.return) - (b.nominalReturn ?? b.return));
    const indexByMode = {
      worst: 0,
      p10: Math.round((sortedRows.length - 1) * 0.1),
      median: Math.round((sortedRows.length - 1) * 0.5),
      p90: Math.round((sortedRows.length - 1) * 0.9),
      best: sortedRows.length - 1
    };
    return sortedRows[indexByMode[mode] ?? indexByMode.median];
  }



  function averageReturnField(rows, primaryField, fallbackField) {
    const values = rows
      .map((row) => row[primaryField] ?? (fallbackField ? row[fallbackField] : null))
      .filter(Number.isFinite);
    return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  }



  function getPolicyPathReturnLabel(mode, returnRow) {
    if (mode === "expected") return "Expected";
    const labels = {
      p10: "Bad",
      median: "Median",
      p90: "Good",
      best: "Best",
      worst: "Worst",
      specific: "Specific"
    };
    return `${labels[mode] || "Selected"} ${returnRow.year}`;
  }



  function getMarketReturnRows() {
    return Planner.state.marketData?.returns || [];
  }



  function buildPolicyPathSummary(explorer) {
    const finalBeta = Number.isFinite(explorer.finalPolicyBeta)
      ? `policy resumes at beta ${Planner.formatBeta(explorer.finalPolicyBeta)}`
      : "the plan horizon is reached";
    return `Force beta ${Planner.formatBeta(explorer.overrideBeta)} for ${Planner.formatNumber(explorer.overrideYears)} years using ${explorer.returnLabel.toLowerCase()} returns; ${finalBeta}. Final node: ${Planner.formatCurrency(explorer.finalWealth)}, ${Planner.formatPolicyRiskPercent(explorer.finalRisk)} depletion risk, ${Planner.formatCurrency(explorer.finalExpectedTerminalWealth)} expected terminal wealth.`;
  }



  const POLICY_ACTION_TABLE_COLUMNS = [
    { render: (row) => Planner.formatBeta(row.beta) },
    { render: (row) => Planner.formatPolicyRiskPercent(row.estimatedDepletionRisk) },
    { render: (row) => Planner.formatCurrency(row.expectedTerminalWealth) },
    { render: (row) => row.isRecommended ? "Recommended" : "--" }
  ];

  function renderDynamicPolicyActionTable(results, yearIndex) {
    const bucketIndex = Number(Planner.els.policyBucketSelect.value);
    const rows = getDynamicPolicyActionRows(results, yearIndex, bucketIndex);
    Planner.renderTableBody(
      Planner.els.dynamicPolicyActionTable,
      POLICY_ACTION_TABLE_COLUMNS,
      rows,
      "No beta alternatives for this bucket."
    );
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


  function getDynamicPolicyActionRows(results, yearIndex, bucketIndex) {
    const policy = results.dynamicPolicy;
    const actionRiskRow = policy.actionValueByYear?.[yearIndex]?.[bucketIndex] || [];
    const actionExpectedWealthRow = policy.actionExpectedWealthByYear?.[yearIndex]?.[bucketIndex] || [];
    const recommendedBeta = policy.policyByYear[yearIndex]?.[bucketIndex];
    return policy.betaValues.map((beta, betaIndex) => ({
      year: results.years[yearIndex],
      bucketIndex,
      wealth: policy.wealthBuckets[bucketIndex],
      beta,
      recommendedBeta,
      estimatedDepletionRisk: actionRiskRow[betaIndex],
      expectedTerminalWealth: actionExpectedWealthRow[betaIndex],
      isRecommended: Math.abs(beta - recommendedBeta) <= Planner.EPSILON
    }));
  }



  function getVisibleDynamicPolicyRows(results, yearIndex) {
    return getDynamicPolicyRows(results, yearIndex)
      .filter((row) => row.wealth <= Planner.DYNAMIC_DISPLAY_MAX_WEALTH_BUCKET);
  }



  function downloadSimulationCsv() {
    if (!Planner.state.results) return;
    const headers = [
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
    const summaryBySimulation = new Map(
      Planner.state.results.simulationRows.map((row) => [row.simulation, row])
    );
    const rows = Planner.state.results.simulationYearRows.map((row) => {
      const summary = summaryBySimulation.get(row.simulation);
      return [
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
    });
    Planner.downloadCsvFile(`financial-planner-simulations-${Date.now()}.csv`, headers, rows);
  }



  function downloadPolicyCsv() {
    if (!Planner.state.results || Planner.state.results.scenario.betaMode !== Planner.BETA_MODE_DYNAMIC || !Planner.state.results.dynamicPolicy) return;
    const headers = [
      "year",
      "bucket_index",
      "bucket_wealth_current_dollars",
      "evaluated_spx_beta",
      "estimated_depletion_probability",
      "expected_terminal_wealth_current_dollars",
      "is_recommended_beta",
      "recommended_spx_beta",
      "shown_in_table"
    ];
    const rows = Planner.state.results.years.flatMap((year, yearIndex) => (
      getDynamicPolicyRows(Planner.state.results, yearIndex).flatMap((policyRow) => (
        getDynamicPolicyActionRows(Planner.state.results, yearIndex, policyRow.bucketIndex).map((actionRow) => [
          year,
          actionRow.bucketIndex,
          actionRow.wealth,
          actionRow.beta,
          actionRow.estimatedDepletionRisk,
          actionRow.expectedTerminalWealth,
          actionRow.isRecommended ? "yes" : "no",
          actionRow.recommendedBeta,
          actionRow.wealth <= Planner.DYNAMIC_DISPLAY_MAX_WEALTH_BUCKET ? "yes" : "no"
        ])
      ))
    ));
    Planner.downloadCsvFile(`financial-planner-dynamic-beta-policy-${Date.now()}.csv`, headers, rows);
  }



  function switchPage(page) {
    const nextPage = Planner.normalizePage(page);
    Planner.state.activePage = nextPage;
    Planner.state.hover = null;
    Planner.state.detailHover = null;
    Planner.state.policyBucketHover = null;
    Planner.updatePageUrl(nextPage);
    Planner.els.pageButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.page === nextPage);
    });
    Planner.els.overviewPage.hidden = nextPage !== "overview";
    Planner.els.detailsPage.hidden = nextPage !== "details";
    Planner.els.policyPage.hidden = nextPage !== "policy";
    Planner.els.methodologyPage.hidden = nextPage !== "methodology";
    if (Planner.state.results) Planner.renderCharts(Planner.state.results);
  }


  Object.assign(Planner, {
    renderResults,
    resetDetailsControls,
    getCurrentBeta,
    updateScenarioSummary,
    renderSimulationSelect,
    renderSimulationPathTable,
    renderDynamicPolicyControls,
    renderDynamicPolicyTable,
    renderPolicyPathControls,
    renderPolicyPathExplorer,
    buildPolicyPathExplorer,
    getDynamicPolicyRows,
    getDynamicPolicyActionRows,
    getVisibleDynamicPolicyRows,
    downloadSimulationCsv,
    downloadPolicyCsv,
    switchPage
  });
})(window.Planner = window.Planner || {});
