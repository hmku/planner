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
    Planner.els.terminalWealthMetric.textContent = Planner.formatMoney(results.expectedTerminalWealth);
    Planner.els.terminalWealthMetricNote.textContent = `Median ${Planner.formatMoney(Planner.percentileOfSorted(results.terminalWealthSorted, 0.5))}, current dollars`;
    Planner.els.currentBetaMetricLabel.textContent = isDynamic ? "Recommended SPX beta" : "SPX beta";
    Planner.els.currentBetaMetric.textContent = Planner.formatBeta(getCurrentBeta(results));
    Planner.els.currentBetaMetricNote.textContent = isDynamic
      ? `Dynamic policy at ${Planner.formatMoney(scenario.netWorth)} in ${scenario.currentYear}`
      : "Fixed for every year";

    updateScenarioSummary(results);
    Planner.els.netWorthSummary.textContent = `Expected current-dollar net worth across ${Planner.formatNumber(scenario.simulationCount)} simulations, with ${Planner.formatNumber(results.visualPaths.length)} randomly sampled paths. Hover a path for details.`;
    updateFrontierSummary(results);
    updateRequiredWealth(results);

    renderSimulationSelect(results);
    renderSimulationPathTable(results);
    renderDynamicPolicyControls(results);
    Planner.renderCharts(results);
  }


  // The "Needed for X% risk" metric and the How much you need summary.
  function updateRequiredWealth(results) {
    const { els } = Planner;
    const { scenario, requiredWealth } = results;
    const target = Planner.REQUIRED_WEALTH_TARGET;
    const targetLabel = Planner.formatPercent(target);
    const needed = Planner.requiredWealthForRisk(requiredWealth, target);
    const policyText = hasDynamicPolicy(results)
      ? "the run's dynamic beta policy"
      : `a fixed ${Planner.formatBeta(scenario.spxBeta)} SPX beta`;
    els.requiredWealthMetricLabel.textContent = `Needed for ${targetLabel} risk`;

    if (!Number.isFinite(needed)) {
      els.requiredWealthMetric.textContent = "Out of reach";
      els.requiredWealthMetricNote.textContent = `No starting amount up to ${Planner.formatMoney(Planner.DYNAMIC_MAX_WEALTH_BUCKET)} gets below ${targetLabel}`;
      els.requiredWealthSummary.textContent = describeRequiredWealthLadder(results, policyText);
      return;
    }
    const gap = scenario.netWorth - needed;
    els.requiredWealthMetric.textContent = Planner.formatMoney(needed);
    els.requiredWealthMetricNote.textContent = needed === 0
      ? "Income covers spending on almost every path"
      : gap >= 0
        ? `${Planner.formatMoney(gap)} less than you have`
        : `${Planner.formatMoney(-gap)} more than you have`;
    els.requiredWealthSummary.textContent = describeRequiredWealthLadder(results, policyText);
  }


  // "Needed for 10% risk: $X · 5%: $Y · …", then where you stand.
  function describeRequiredWealthLadder(results, policyText) {
    const { scenario, requiredWealth } = results;
    const steps = Planner.REQUIRED_WEALTH_LABELS.map((risk, index) => {
      const needed = Planner.requiredWealthForRisk(requiredWealth, risk);
      const amount = Number.isFinite(needed) ? Planner.formatMoney(needed) : "out of reach";
      return index === 0 ? `${Planner.formatPercent(risk)} risk: ${amount}` : `${Planner.formatPercent(risk)}: ${amount}`;
    });
    const yourRisk = Planner.riskAtWealth(requiredWealth, scenario.netWorth);
    return `Starting net worth needed with ${policyText}. ${steps.join(" · ")}. ` +
      `Your ${Planner.formatMoney(scenario.netWorth)} has a ${Planner.formatPolicyRiskPercent(yourRisk)} risk ` +
      `(from ${Planner.formatNumber(requiredWealth.pathCount)} simulated paths). Hover or tap a point for details.`;
  }


  function updateFrontierSummary(results) {
    let text;
    if (!hasDynamicPolicy(results)) {
      text = "Set beta mode to Dynamic and run a simulation to see the risk/wealth tradeoff.";
    } else {
      text = `Risk/wealth tradeoff across ${Planner.formatNumber(results.dynamicPolicy.frontier.length)} dynamic beta policies, each simulated on the same ${Planner.formatNumber(Planner.FRONTIER_PATHS)} paths. Highlighted points are the policy the run uses: the most median wealth among policies whose run-out risk is at most ${Planner.formatPercent(Planner.ACCEPTABLE_RUN_OUT_RISK)} or the lowest any policy reaches.`;
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
      ? `Dynamic beta: the most median wealth at run-out risk under ${Planner.formatPercent(Planner.ACCEPTABLE_RUN_OUT_RISK)}, or the lowest risk reachable.`
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
        const label = `#${index + 1} · ${Planner.formatMoney(path.terminalWealth)}`;
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
    if (row.depletedThisYear) return row.homeSoldThisYear ? "Sold home, depleted" : "Depleted";
    if (row.homeSoldThisYear) return `Sold home (+${Planner.formatMoney(row.homeSaleProceeds)})`;
    return row.depletionYear ? `After depletion (${row.depletionYear})` : "Active";
  }

  const SIMULATION_PATH_COLUMNS = [
    { render: (row) => row.year },
    { render: (row) => row.historicalReturnYear || "--" },
    { render: (row) => Planner.formatMoney(row.startingWealth) },
    { render: (row) => Planner.formatMoney(row.income) },
    { render: (row) => Planner.formatMoney(row.expenses) },
    { render: (row) => Planner.formatMoney(row.withdrawalTax) },
    { render: (row) => Planner.formatPercent(row.nominalSpxReturn) },
    { render: (row) => Planner.formatPercent(row.nominalRiskFreeReturn) },
    { render: (row) => Planner.formatPercent(row.nominalSpxExcessReturn) },
    { render: (row) => Planner.formatBeta(row.spxBetaUsed) },
    { render: (row) => Planner.formatPercent(row.inflation) },
    { render: (row) => Planner.formatPercent(row.realSpxReturn) },
    { render: (row) => Planner.formatPercent(row.nominalPortfolioReturn) },
    { render: (row) => Planner.formatPercent(row.portfolioRealReturn) },
    { render: (row) => Planner.formatMoney(row.endingWealth) },
    { render: (row) => Planner.formatMoney(row.homeEquity) },
    {
      render: describeRowStatus,
      className: (row) => row.depletedThisYear ? "text status-depleted" : row.depletionYear ? "text status-after" : "text"
    }
  ];

  function renderSimulationPathTable(results) {
    const rows = getSelectedSimulationRows(results);
    const summary = results.simulationRows[getSelectedSimulation() - 1];
    Planner.els.selectedSimulationSummary.textContent = summary
      ? `Simulation #${Planner.formatNumber(summary.simulation)} ends at ${Planner.formatMoney(summary.terminalWealth)} (${Planner.formatPercent(summary.endingPercentile)} percentile)${summary.failureYear ? `, depleted in ${summary.failureYear}` : ", never depleted"}. The picker lists the ${Planner.formatNumber(results.inspectionPaths.length)} sampled paths, sorted by ending wealth.`
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
    Planner.els.dynamicPolicySummary.textContent = `Policy the run uses (${results.dynamicPolicy.label.charAt(0).toLowerCase()}${results.dynamicPolicy.label.slice(1)}) for ${results.years[view.yearIndex]}. Plots show wealth buckets up to ${Planner.formatMoney(Planner.DYNAMIC_DISPLAY_MAX_WEALTH_BUCKET)}; the solver grid extends to ${Planner.formatMoney(wealthBuckets[wealthBuckets.length - 1])}.`;

    const previousBucket = Planner.els.policyBucketSelect.value;
    Planner.populateSelect(Planner.els.policyBucketSelect, view.rows, {
      previousValue: previousBucket !== "" ? previousBucket : view.currentBucketIndex ?? view.rows[1]?.bucketIndex,
      getValue: (row) => row.bucketIndex,
      getLabel: (row) => row.bucketIndex === view.currentBucketIndex
        ? `${Planner.formatMoney(row.wealth)} (current)`
        : Planner.formatMoney(row.wealth)
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
    { render: (row) => Planner.formatMoney(row.expectedTerminalWealth) },
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


  // Per-beta alternatives are computed on demand (the solver keeps no
  // per-beta tables); one evaluator per run.
  const actionEvaluators = new WeakMap();

  function getDynamicPolicyActionRows(results, yearIndex, bucketIndex) {
    const policy = results.dynamicPolicy;
    if (!actionEvaluators.has(results)) {
      actionEvaluators.set(results, Planner.createActionEvaluator(policy, results.scenario, results.returnRows, results.years));
    }
    const wealth = policy.wealthBuckets[bucketIndex];
    const recommendedBeta = policy.policyByYear[yearIndex]?.[bucketIndex];
    return actionEvaluators.get(results)(yearIndex, wealth).map((action) => ({
      bucketIndex,
      wealth,
      beta: action.beta,
      recommendedBeta,
      estimatedDepletionRisk: action.risk,
      expectedTerminalWealth: action.expectedWealth,
      isRecommended: Math.abs(action.beta - recommendedBeta) <= Planner.EPSILON
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
    { render: (row) => Planner.formatMoney(row.startingWealth) },
    { render: (row) => Planner.formatBeta(row.beta) },
    { render: (row) => row.returnLabel, className: "text" },
    { render: (row) => Planner.formatPercent(row.nominalSpxReturn) },
    { render: (row) => Planner.formatPercent(row.inflation) },
    { render: (row) => Planner.formatMoney(row.endingWealth) },
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
        const netCashFlow = Planner.cashFlowsForYear(scenario, year).net;
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
    return `Forcing beta ${Planner.formatBeta(explorer.overrideBeta)} for ${Planner.formatNumber(explorer.overrideYears)} years of ${explorer.returnLabel.toLowerCase()} returns; ${resume}. End node: ${Planner.formatMoney(explorer.finalWealth)}, ${Planner.formatPolicyRiskPercent(explorer.finalRisk)} run-out risk, ${Planner.formatMoney(explorer.finalExpectedTerminalWealth)} expected terminal wealth.`;
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
      "withdrawal_tax_current_dollars",
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
      "home_equity_current_dollars",
      "home_sale_proceeds_current_dollars",
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
            row.withdrawalTax,
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
            row.homeEquity,
            row.homeSaleProceeds,
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

  // ---------- Spending ----------

  let spendingModel = null;

  // Per-year spending by category and income, from the current inputs.
  function buildSpendingModel() {
    let inputs;
    try {
      inputs = Planner.readCashFlowInputs();
    } catch (error) {
      return { error: error.message };
    }
    const years = Planner.range(inputs.currentYear, inputs.deathYear);
    const first = inputs.currentYear;
    const spread = (flows, onYear) => flows.forEach((flow) => {
      for (let year = Math.max(flow.startYear, first); year <= Math.min(flow.endYear, inputs.deathYear); year += 1) {
        onYear(flow, year - first);
      }
    });
    const categories = Planner.SPENDING_CATEGORIES.map((category, colorIndex) => ({
      ...category,
      colorIndex,
      values: new Float64Array(years.length)
    }));
    const byKey = new Map(categories.map((category) => [category.key, category]));
    const totals = new Float64Array(years.length);
    const recurringTotals = new Float64Array(years.length);
    const income = new Float64Array(years.length);
    spread(inputs.expenses, (flow, index) => {
      const amount = Planner.flowAmountForYear(flow, first + index);
      (byKey.get(flow.category) || byKey.get("other")).values[index] += amount;
      totals[index] += amount;
      if (!flow.oneTime) recurringTotals[index] += amount;
    });
    spread(inputs.income, (flow, index) => {
      income[index] += Planner.flowAmountForYear(flow, first + index);
    });
    // Tax on portfolio withdrawals, same rule as the engine.
    const rate = inputs.withdrawalTaxRate;
    if (rate > 0) {
      const taxes = byKey.get("taxes");
      years.forEach((_, index) => {
        const tax = Math.max(0, totals[index] - income[index]) * rate / (1 - rate);
        taxes.values[index] = tax;
        totals[index] += tax;
        recurringTotals[index] += tax;
      });
    }
    return { years, categories, totals, recurringTotals, income };
  }

  function getSpendingModel() {
    if (!spendingModel) spendingModel = buildSpendingModel();
    return spendingModel;
  }

  function summarizeSeries(values, years) {
    let peakIndex = 0;
    let lifetime = 0;
    values.forEach((value, index) => {
      lifetime += value;
      if (value > values[peakIndex]) peakIndex = index;
    });
    return { now: values[0], peak: values[peakIndex], peakYear: years[peakIndex], lifetime };
  }

  // Rebuilds the model from the inputs and refreshes the Spending view; the
  // chart itself is drawn only while its tab is showing.
  function renderSpendingView() {
    spendingModel = buildSpendingModel();
    const { els } = Planner;
    if (spendingModel.error) {
      els.spendingSummary.textContent = spendingModel.error;
      Planner.renderTableBody(els.spendingTable, SPENDING_COLUMNS, [], "Fix the plan years to see spending.");
    } else {
      const { years, categories, totals, income } = spendingModel;
      const used = categories.filter((category) => category.values.some((value) => value > 0));
      const rows = used.map((category) => ({ label: category.label, ...summarizeSeries(category.values, years) }));
      const total = summarizeSeries(totals, years);
      if (rows.length) rows.push({ label: "Total", isTotal: true, ...total });
      els.spendingNowHeader.textContent = String(years[0]);
      Planner.renderTableBody(els.spendingTable, SPENDING_COLUMNS, rows, "No spending yet.", (row) => (row.isTotal ? "is-marked" : ""));

      const lifetimeIncome = income.reduce((sum, value) => sum + value, 0);
      els.spendingSummary.textContent = rows.length
        ? `${Planner.formatMoney(total.now)} in ${years[0]}, peaking at ${Planner.formatMoney(total.peak)} in ${total.peakYear}. ` +
          `${Planner.formatMoney(total.lifetime)} over ${years.length} years against ${Planner.formatMoney(lifetimeIncome)} of income; the rest comes from the portfolio.`
        : "No spending entered yet.";

    }
    if (Planner.state.activePage === "spending") Planner.renderChart("spending");
  }

  const SPENDING_COLUMNS = [
    { render: (row) => row.label, className: "text" },
    { render: (row) => Planner.formatMoney(row.now) },
    { render: (row) => String(row.peakYear) },
    { render: (row) => Planner.formatMoney(row.peak) },
    { render: (row) => Planner.formatMoney(row.lifetime) }
  ];

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
    Planner.renderCharts(Planner.state.results);
  }

  Object.assign(Planner, {
    getSpendingModel,
    renderSpendingView,
    updateRequiredWealth,
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
