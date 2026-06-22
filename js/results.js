(function (Planner) {
  function renderResults(results) {
    const simulations = results.scenario.simulationCount;
    Planner.els.simulationSelect.disabled = false;
    Planner.els.downloadCsv.disabled = false;
    Planner.els.riskMetric.textContent = Planner.formatPercent(results.risk);
    Planner.els.medianWealthMetric.textContent = Planner.formatCompactCurrency(results.medianTerminalWealth);
    Planner.els.medianWealthMetric.title = Planner.formatCurrency(results.medianTerminalWealth);
    Planner.els.currentBetaMetricLabel.textContent = results.scenario.betaMode === Planner.BETA_MODE_DYNAMIC
      ? "Current recommended SPY beta"
      : "Current SPY beta";
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
    Planner.els.dynamicPolicyBandTable.innerHTML = `<tr><td colspan="5">Run dynamic beta to inspect beta bands.</td></tr>`;
    Planner.els.dynamicPolicyTable.innerHTML = `<tr><td colspan="6">Run dynamic beta to inspect the policy.</td></tr>`;
    Planner.els.dynamicPolicySummary.textContent = "Run dynamic beta to inspect the policy.";
    Planner.els.selectedSimulationSummary.textContent = "Run a simulation to inspect one path.";
  }



  function getCurrentBeta(results) {
    if (results.scenario.betaMode !== Planner.BETA_MODE_DYNAMIC || !results.dynamicPolicy) {
      return results.scenario.spyBeta;
    }
    return Planner.selectDynamicBeta(results.dynamicPolicy, 0, results.scenario.netWorth);
  }



  function updateScenarioSummary(results) {
    const simulations = results.scenario.simulationCount;
    const modeText = results.scenario.betaMode === Planner.BETA_MODE_DYNAMIC
      ? "Dynamic beta used a causal annual bootstrap and year/wealth policy."
      : `Fixed beta ${Planner.formatBeta(results.scenario.spyBeta)} used 5-year historical return blocks.`;
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
    { render: (row) => formatHistoricalBlock(row) },
    { render: (row) => Planner.formatCurrency(row.startingWealth) },
    { render: (row) => Planner.formatCurrency(row.income) },
    { render: (row) => Planner.formatCurrency(row.expenses) },
    { render: (row) => Planner.formatPercent(row.nominalSpyReturn) },
    { render: (row) => Planner.formatPercent(row.nominalRiskFreeReturn) },
    { render: (row) => Planner.formatPercent(row.nominalSpyExcessReturn) },
    { render: (row) => Planner.formatBeta(row.spyBetaUsed) },
    { render: (row) => Planner.formatPercent(row.inflation) },
    { render: (row) => Planner.formatPercent(row.realSpyReturn) },
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
    renderDynamicPolicyTable(results);
  }



  const POLICY_TABLE_COLUMNS = [
    { render: (row) => Planner.formatNumber(row.bucketIndex) },
    { render: (row) => Planner.formatCurrency(row.wealth) },
    { render: (row) => Planner.formatBeta(row.beta) },
    { render: (row) => Planner.formatPercent(row.estimatedDepletionRisk) },
    { render: (row) => Planner.formatCurrency(row.expectedTerminalWealth) },
    { render: (row) => row.markers.join(", ") || "--" }
  ];

  function renderDynamicPolicyTable(results) {
    if (results.scenario.betaMode !== Planner.BETA_MODE_DYNAMIC || !results.dynamicPolicy) return;

    const selectedYear = Number(Planner.els.policyYearSelect.value) || results.scenario.currentYear;
    const yearIndex = results.years.indexOf(selectedYear);
    if (yearIndex < 0) {
      Planner.els.dynamicPolicyBandTable.innerHTML = `<tr><td colspan="5">No policy rows for this year.</td></tr>`;
      Planner.els.dynamicPolicyTable.innerHTML = `<tr><td colspan="6">No policy rows for this year.</td></tr>`;
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
    const bands = getDynamicPolicyBetaBands(rows);

    Planner.els.dynamicPolicySummary.textContent = `${selectedYear} scenario policy · showing wealth buckets through ${Planner.formatCompactCurrency(Planner.DYNAMIC_DISPLAY_MAX_WEALTH_BUCKET)}; DP grid runs through ${Planner.formatCompactCurrency(results.dynamicPolicy.wealthBuckets[results.dynamicPolicy.wealthBuckets.length - 1])}.`;

    Planner.renderTableBody(
      Planner.els.dynamicPolicyBandTable,
      POLICY_BAND_TABLE_COLUMNS,
      bands,
      "No beta bands for this year."
    );

    Planner.renderTableBody(
      Planner.els.dynamicPolicyTable,
      POLICY_TABLE_COLUMNS,
      rows,
      "No policy rows for this year."
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


  function getVisibleDynamicPolicyRows(results, yearIndex) {
    return getDynamicPolicyRows(results, yearIndex)
      .filter((row) => row.wealth <= Planner.DYNAMIC_DISPLAY_MAX_WEALTH_BUCKET);
  }



  const POLICY_BAND_TABLE_COLUMNS = [
    { render: (row) => Planner.formatBeta(row.beta) },
    { render: (row) => Planner.formatNumber(row.bucketCount) },
    { render: (row) => formatRange(row.minWealth, row.maxWealth, Planner.formatCurrency) },
    { render: (row) => formatRange(row.minRisk, row.maxRisk, Planner.formatPercent) },
    { render: (row) => formatRange(row.minExpectedTerminalWealth, row.maxExpectedTerminalWealth, Planner.formatCurrency) }
  ];

  function getDynamicPolicyBetaBands(rows) {
    const bands = [];
    rows.forEach((row) => {
      const previous = bands[bands.length - 1];
      if (!previous || Math.abs(previous.beta - row.beta) > Planner.EPSILON) {
        bands.push({
          beta: row.beta,
          bucketCount: 1,
          minWealth: row.wealth,
          maxWealth: row.wealth,
          minRisk: row.estimatedDepletionRisk,
          maxRisk: row.estimatedDepletionRisk,
          minExpectedTerminalWealth: row.expectedTerminalWealth,
          maxExpectedTerminalWealth: row.expectedTerminalWealth
        });
        return;
      }

      previous.bucketCount += 1;
      previous.maxWealth = row.wealth;
      previous.minRisk = Math.min(previous.minRisk, row.estimatedDepletionRisk);
      previous.maxRisk = Math.max(previous.maxRisk, row.estimatedDepletionRisk);
      previous.minExpectedTerminalWealth = Math.min(previous.minExpectedTerminalWealth, row.expectedTerminalWealth);
      previous.maxExpectedTerminalWealth = Math.max(previous.maxExpectedTerminalWealth, row.expectedTerminalWealth);
    });
    return bands;
  }



  function formatRange(min, max, formatter) {
    if (Math.abs(min - max) <= Planner.EPSILON) return formatter(min);
    return `${formatter(min)} to ${formatter(max)}`;
  }



  function formatHistoricalBlock(row) {
    if (!row.historicalBlockStartYear || !row.historicalBlockEndYear) return "--";
    return `${row.historicalBlockStartYear}-${row.historicalBlockEndYear}`;
  }



  function downloadSimulationCsv() {
    if (!Planner.state.results) return;
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
      Planner.state.results.simulationRows.map((row) => [row.simulation, row])
    );
    const rows = Planner.state.results.simulationYearRows.map((row) => {
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
    Planner.downloadCsvFile(`financial-planner-simulations-${Date.now()}.csv`, headers, rows);
  }



  function downloadPolicyCsv() {
    if (!Planner.state.results || Planner.state.results.scenario.betaMode !== Planner.BETA_MODE_DYNAMIC || !Planner.state.results.dynamicPolicy) return;
    const headers = [
      "year",
      "bucket_index",
      "bucket_wealth_current_dollars",
      "recommended_spy_beta",
      "estimated_depletion_probability",
      "expected_terminal_wealth_current_dollars",
      "shown_in_table"
    ];
    const rows = Planner.state.results.years.flatMap((year, yearIndex) => (
      getDynamicPolicyRows(Planner.state.results, yearIndex).map((row) => [
        year,
        row.bucketIndex,
        row.wealth,
        row.beta,
        row.estimatedDepletionRisk,
        row.expectedTerminalWealth,
        row.wealth <= Planner.DYNAMIC_DISPLAY_MAX_WEALTH_BUCKET ? "yes" : "no"
      ])
    ));
    Planner.downloadCsvFile(`financial-planner-dynamic-beta-policy-${Date.now()}.csv`, headers, rows);
  }



  function switchPage(page) {
    Planner.state.activePage = page;
    Planner.state.hover = null;
    Planner.state.detailHover = null;
    Planner.els.pageButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.page === page);
    });
    Planner.els.overviewPage.hidden = page !== "overview";
    Planner.els.detailsPage.hidden = page !== "details";
    Planner.els.policyPage.hidden = page !== "policy";
    Planner.els.methodologyPage.hidden = page !== "methodology";
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
    getDynamicPolicyRows,
    getVisibleDynamicPolicyRows,
    getDynamicPolicyBetaBands,
    formatHistoricalBlock,
    downloadSimulationCsv,
    downloadPolicyCsv,
    switchPage
  });
})(window.Planner = window.Planner || {});
