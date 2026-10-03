(function (Planner) {
  // Monte Carlo runs over historical years, per-simulation row replay, and the
  // required net worth. All three follow simulated paths through one stepper,
  // so a path's beta, cash flows, and home sale are the same everywhere.

  // Steps a path one year at a time on given historical rows: picks the beta
  // (the dynamic policy's, from its sold layer once the home is sold, or the
  // fixed beta) and advances with stepPathYear().
  function createPathStepper(scenario, returnRows, years, dynamicPolicy) {
    const cash = Planner.buildPlanCashFlows(scenario, years);
    const factorsFor = Planner.createGrowthFactorCache(returnRows);
    const fixedFactors = dynamicPolicy ? null : factorsFor(scenario.spxBeta);
    // Local references: lookups on the large Planner object are slow in hot loops.
    const { stepPathYear, selectDynamicBeta } = Planner;
    return {
      cash,
      newState: (wealth) => ({ wealth, sold: false, soldThisYear: false, beta: null }),
      // Returns the ending portfolio (<= 0 means depleted); sets state.beta.
      step(state, yearIndex, rowIndex) {
        state.beta = dynamicPolicy
          ? selectDynamicBeta(dynamicPolicy, yearIndex, state.wealth, state.sold)
          : scenario.spxBeta;
        const { growth, cashFactor } = fixedFactors || factorsFor(state.beta);
        return stepPathYear(cash, state, yearIndex, growth[rowIndex], cashFactor[rowIndex]);
      },
      // Net worth counts home equity while the home is owned.
      netWorth: (state, yearIndex) => state.wealth + (state.sold ? 0 : cash.equity[yearIndex])
    };
  }


  async function simulateScenario(scenario, returnRows, random = Math.random, onProgress = () => {}, shouldCancel = () => false) {
    if (!returnRows.length) {
      throw new Error("No historical market data loaded.");
    }

    const years = Planner.range(scenario.currentYear, scenario.deathYear);
    const yearCount = years.length;
    const simulationCount = scenario.simulationCount;
    const isDynamicBeta = scenario.betaMode === Planner.BETA_MODE_DYNAMIC;
    // Extra paths (fixed sequences of historical years) serve the frontier and
    // How much you need; they are drawn first, then the main run.
    const extraPaths = drawExtraPaths(Planner.REQUIRED_WEALTH_PATHS, yearCount, returnRows.length, random);
    const dynamicPolicy = isDynamicBeta
      ? choosePolicy(await Planner.buildDynamicBetaPolicy(scenario, returnRows, years, onProgress, shouldCancel), scenario, returnRows, years, extraPaths)
      : null;
    const policyShare = isDynamicBeta ? Planner.DYNAMIC_POLICY_PROGRESS_SHARE : 0;
    const stepper = createPathStepper(scenario, returnRows, years, dynamicPolicy);
    const realSpxReturns = returnRows.map((row) => Planner.buildReturnMetrics(row, 0).realSpxReturn);

    // Only the sampled historical row index per simulation-year is stored; every
    // other per-year value is replayed deterministically on demand.
    const sampledRowIndexes = new Uint16Array(simulationCount * yearCount);
    const simulationRows = new Array(simulationCount);
    const visualPaths = [];
    const wealthSums = new Float64Array(yearCount);
    const betaSums = new Float64Array(yearCount);
    const betaCounts = new Uint32Array(yearCount);
    const pathWealth = new Float64Array(yearCount);
    const pathBeta = new Array(yearCount);
    let depletedCount = 0;

    onProgress(policyShare);
    for (let i = 0; i < simulationCount; i += 1) {
      if (i > 0 && i % Planner.SIMULATION_CHUNK_SIZE === 0) {
        onProgress(policyShare + (i / simulationCount) * (1 - policyShare));
        await Planner.yieldToBrowser();
      }
      Planner.throwIfCanceled(shouldCancel);

      const offset = i * yearCount;
      const state = stepper.newState(scenario.netWorth);
      let failureYear = null;
      let sampledCount = 0;
      let realSpxReturnSum = 0;
      let netWorth = state.wealth;

      for (let yearIndex = 0; yearIndex < yearCount; yearIndex += 1) {
        let beta = null;
        if (state.wealth > 0) {
          const rowIndex = Planner.randomIndex(returnRows.length, random);
          const endingWealth = stepper.step(state, yearIndex, rowIndex);
          beta = state.beta;
          sampledRowIndexes[offset + yearIndex] = rowIndex;
          sampledCount += 1;
          realSpxReturnSum += realSpxReturns[rowIndex];
          state.wealth = Math.max(0, endingWealth);
          if (endingWealth <= 0) failureYear = years[yearIndex];
          betaSums[yearIndex] += beta;
          betaCounts[yearIndex] += 1;
        }
        netWorth = stepper.netWorth(state, yearIndex);
        wealthSums[yearIndex] += netWorth;
        pathWealth[yearIndex] = netWorth;
        pathBeta[yearIndex] = beta;
      }

      const summary = {
        simulation: i + 1,
        failureYear,
        terminalWealth: netWorth,
        averageRealSpxReturn: sampledCount ? realSpxReturnSum / sampledCount : null
      };
      simulationRows[i] = summary;
      if (failureYear) depletedCount += 1;
      addReservoirSample(visualPaths, i, Planner.MAX_VISUAL_PATHS, random, () => ({
        ...summary,
        points: years.map((year, index) => ({ year, wealth: pathWealth[index] })),
        betaPoints: years.map((year, index) => ({ year, beta: pathBeta[index] }))
      }));
    }
    const requiredWealth = buildRequiredWealth(extraPaths, years, stepper);
    onProgress(1);

    const terminalWealthSorted = simulationRows.map((row) => row.terminalWealth).sort((a, b) => a - b);
    const expectedTerminalWealth = terminalWealthSorted.reduce((sum, value) => sum + value, 0) / simulationCount;
    simulationRows.forEach((row) => {
      row.endingPercentile = Planner.percentileRank(terminalWealthSorted, row.terminalWealth);
    });
    visualPaths.forEach((path) => {
      path.endingPercentile = simulationRows[path.simulation - 1].endingPercentile;
    });

    return {
      scenario,
      returnRows,
      dynamicPolicy,
      requiredWealth,
      years,
      sampledRowIndexes,
      simulationRows,
      terminalWealthSorted,
      visualPaths,
      inspectionPaths: [...visualPaths].sort(compareInspectionPaths),
      expectedPath: years.map((year, index) => ({ year, wealth: wealthSums[index] / simulationCount })),
      expectedBetaPath: years.map((year, index) => ({
        year,
        beta: betaCounts[index] ? betaSums[index] / betaCounts[index] : null
      })),
      depletedDistribution: buildDepletedDistribution(simulationRows, years),
      depletedCount,
      notDepletedCount: simulationCount - depletedCount,
      risk: depletedCount / simulationCount,
      expectedTerminalWealth
    };
  }


  // Rebuilds the annual rows for one simulation from its stored sampled years
  // with the same stepper as the run, so values match the run exactly.
  function getSimulationYearRows(results, simulation) {
    const { scenario, returnRows, dynamicPolicy, years, sampledRowIndexes } = results;
    if (!Number.isInteger(simulation) || simulation < 1 || simulation > scenario.simulationCount) return [];

    const offset = (simulation - 1) * years.length;
    const stepper = createPathStepper(scenario, returnRows, years, dynamicPolicy);
    const { cash } = stepper;
    const state = stepper.newState(scenario.netWorth);
    const rows = [];
    let failureYear = null;

    years.forEach((year, yearIndex) => {
      if (state.wealth <= 0) {
        rows.push(createEmptySimulationYearRow(simulation, year, failureYear));
        return;
      }
      const rowIndex = sampledRowIndexes[offset + yearIndex];
      const row = returnRows[rowIndex];
      const startingWealth = state.wealth;
      const endingWealth = stepper.step(state, yearIndex, rowIndex);
      const metrics = Planner.buildReturnMetrics(row, state.beta);
      const { income, expenses, withdrawalTax, net } = (state.sold ? cash.sold : cash.owned)[yearIndex];
      const depleted = endingWealth <= 0;
      if (depleted) failureYear = year;
      state.wealth = Math.max(0, endingWealth);

      rows.push({
        simulation,
        year,
        historicalReturnYear: row.year,
        startingWealth,
        homeSaleProceeds: state.soldThisYear ? cash.saleProceeds[yearIndex] : 0,
        income,
        expenses,
        withdrawalTax,
        netCashFlow: net,
        nominalSpxReturn: metrics.nominalSpxReturn,
        nominalRiskFreeReturn: metrics.nominalRiskFreeReturn,
        nominalSpxExcessReturn: metrics.nominalSpxExcessReturn,
        spxBetaUsed: state.beta,
        nominalPortfolioReturn: metrics.nominalPortfolioReturn,
        inflation: metrics.inflation,
        realSpxReturn: metrics.realSpxReturn,
        realRiskFreeReturn: metrics.realRiskFreeReturn,
        portfolioRealReturn: metrics.realGrowthFactor - 1,
        endingWealth: state.wealth,
        homeEquity: state.sold ? 0 : cash.equity[yearIndex],
        homeSoldThisYear: state.soldThisYear,
        depletedThisYear: depleted,
        depletionYear: depleted ? year : ""
      });
    });
    return rows;
  }


  function createEmptySimulationYearRow(simulation, year, failureYear) {
    return {
      simulation,
      year,
      historicalReturnYear: "",
      startingWealth: 0,
      homeSaleProceeds: 0,
      income: 0,
      expenses: 0,
      withdrawalTax: 0,
      netCashFlow: 0,
      nominalSpxReturn: "",
      nominalRiskFreeReturn: "",
      nominalSpxExcessReturn: "",
      spxBetaUsed: "",
      nominalPortfolioReturn: "",
      inflation: "",
      realSpxReturn: "",
      realRiskFreeReturn: "",
      portfolioRealReturn: "",
      endingWealth: 0,
      homeEquity: 0,
      homeSoldThisYear: false,
      depletedThisYear: false,
      depletionYear: failureYear || ""
    };
  }


  // Reservoir sampling; the random draw happens only once the reservoir is full,
  // which keeps the random stream (and therefore share links) stable.
  function addReservoirSample(samples, seenIndex, maxSamples, random, buildItem) {
    if (samples.length < maxSamples) {
      samples.push(buildItem());
      return;
    }
    const replacementIndex = Planner.randomIndex(seenIndex + 1, random);
    if (replacementIndex < maxSamples) {
      samples[replacementIndex] = buildItem();
    }
  }


  // ---------- Extra paths: required net worth and the frontier ----------

  // pathCount fixed sequences of historical rows, one per plan year.
  function drawExtraPaths(pathCount, yearCount, rowCount, random) {
    const rows = new Uint8Array(pathCount * yearCount);
    for (let index = 0; index < rows.length; index += 1) rows[index] = Planner.randomIndex(rowCount, random);
    return { rows, pathCount };
  }


  // Each extra path is a fixed sequence of historical years; more starting
  // wealth never hurts a path (for the min-risk policy, nearly never), so each
  // has a threshold: the least net worth that survives it, found by bisection
  // in log wealth. Sorted, the thresholds give run-out risk at every starting
  // net worth at once.
  function buildRequiredWealth(extraPaths, years, stepper) {
    const { rows: sampledRows, pathCount } = extraPaths;
    const yearCount = years.length;

    const topWealth = Planner.DYNAMIC_MAX_WEALTH_BUCKET;
    const state = stepper.newState(0);
    const survives = (path, startingWealth) => {
      state.wealth = startingWealth;
      state.sold = false;
      const offset = path * yearCount;
      for (let yearIndex = 0; yearIndex < yearCount; yearIndex += 1) {
        state.wealth = stepper.step(state, yearIndex, sampledRows[offset + yearIndex]);
        if (state.wealth <= 0) return false;
      }
      return true;
    };

    const thresholds = new Float64Array(pathCount);
    for (let path = 0; path < pathCount; path += 1) {
      if (survives(path, 1)) {
        thresholds[path] = 0;
      } else if (!survives(path, topWealth)) {
        thresholds[path] = Number.POSITIVE_INFINITY;
      } else {
        let low = 0;
        let high = Math.log(topWealth);
        for (let step = 0; step < 18; step += 1) {
          const middle = (low + high) / 2;
          if (survives(path, Math.exp(middle))) high = middle;
          else low = middle;
        }
        thresholds[path] = Math.exp(high);
      }
    }
    thresholds.sort();
    return { thresholds, pathCount };
  }


  // Simulates every frontier policy from your net worth on the same extra paths,
  // so differences between policies aren't sampling noise, and replaces the
  // solver's estimates (which overstate risk between wealth buckets) with
  // simulated run-out risk, expected terminal wealth, and median terminal
  // wealth. Terminal wealth includes home equity, as in the main run.
  function simulateFrontier(frontier, scenario, returnRows, years, extraPaths) {
    const yearCount = years.length;
    const pathCount = Math.min(Planner.FRONTIER_PATHS, extraPaths.pathCount);
    const terminal = new Float64Array(pathCount);
    return frontier.map((point) => {
      const stepper = createPathStepper(scenario, returnRows, years, point.policy);
      const state = stepper.newState(0);
      let depletedCount = 0;
      for (let path = 0; path < pathCount; path += 1) {
        state.wealth = scenario.netWorth;
        state.sold = false;
        const offset = path * yearCount;
        for (let yearIndex = 0; yearIndex < yearCount; yearIndex += 1) {
          state.wealth = stepper.step(state, yearIndex, extraPaths.rows[offset + yearIndex]);
          if (state.wealth <= 0) {
            state.wealth = 0;
            depletedCount += 1;
            break;
          }
        }
        terminal[path] = stepper.netWorth(state, yearCount - 1);
      }
      terminal.sort();
      const middle = pathCount >> 1;
      return {
        ...point,
        depletionRisk: depletedCount / pathCount,
        expectedTerminalWealth: terminal.reduce((sum, value) => sum + value, 0) / pathCount,
        medianTerminalWealth: pathCount % 2 ? terminal[middle] : (terminal[middle - 1] + terminal[middle]) / 2
      };
    }).sort((a, b) => a.depletionRisk - b.depletionRisk || a.expectedTerminalWealth - b.expectedTerminalWealth);
  }


  // The run's policy: simulate every candidate, then take the highest median
  // terminal wealth among those whose run-out risk is at most the larger of
  // ACCEPTABLE_RUN_OUT_RISK and the lowest risk any candidate reaches. Below
  // that level, less risk isn't worth giving up wealth for; above it, the run
  // never accepts more risk than the safest policy. Minimizing risk alone would
  // trade large amounts of wealth for risk differences smaller than the
  // solver's own grid error.
  function choosePolicy({ betaValues, wealthBuckets, candidates }, scenario, returnRows, years, extraPaths) {
    const simulated = simulateFrontier(candidates, scenario, returnRows, years, extraPaths);
    const lowestRisk = Math.min(...simulated.map((point) => point.depletionRisk));
    const allowedRisk = Math.max(Planner.ACCEPTABLE_RUN_OUT_RISK, lowestRisk);
    const chosen = simulated
      .filter((point) => point.depletionRisk <= allowedRisk + Planner.EPSILON)
      .reduce((best, point) => (point.medianTerminalWealth > best.medianTerminalWealth ? point : best));
    return {
      ...chosen.policy,
      betaValues,
      wealthBuckets,
      label: chosen.label,
      frontier: simulated.map(({ policy, ...point }) => ({ ...point, isChosen: policy === chosen.policy }))
    };
  }


  // Share of paths that a starting net worth fails to survive (threshold above it).
  function riskAtWealth(requiredWealth, wealth) {
    const { thresholds, pathCount } = requiredWealth;
    let low = 0;
    let high = pathCount;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (thresholds[middle] <= wealth) low = middle + 1;
      else high = middle;
    }
    return (pathCount - low) / pathCount;
  }


  // Least starting net worth with run-out risk at or below the target, or
  // Infinity when no amount up to the model's wealth cap gets there.
  function requiredWealthForRisk(requiredWealth, targetRisk) {
    const { thresholds, pathCount } = requiredWealth;
    const allowedFailures = Math.floor(targetRisk * pathCount + 1e-9);
    const index = pathCount - allowedFailures - 1;
    return index < 0 ? 0 : thresholds[index];
  }


  // ---------- Summaries ----------

  function buildDepletedDistribution(simulationRows, years) {
    const counts = new Map();
    for (const row of simulationRows) {
      if (row.failureYear) counts.set(row.failureYear, (counts.get(row.failureYear) || 0) + 1);
    }
    return years
      .filter((year) => counts.has(year))
      .map((year) => ({ label: String(year), count: counts.get(year) }));
  }


  function compareInspectionPaths(a, b) {
    return (a.terminalWealth - b.terminalWealth) ||
      ((a.failureYear || Number.POSITIVE_INFINITY) - (b.failureYear || Number.POSITIVE_INFINITY));
  }

  Object.assign(Planner, {
    simulateScenario,
    getSimulationYearRows,
    riskAtWealth,
    requiredWealthForRisk
  });
})(window.Planner = window.Planner || {});
