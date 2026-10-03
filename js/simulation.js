(function (Planner) {
  const MIN_GROWTH_FACTOR = 0.000001;

  function isCancellationError(error) {
    return error && error.name === "SimulationCanceledError";
  }


  function throwIfCanceled(shouldCancel) {
    if (!shouldCancel()) return;
    const error = new Error("Simulation canceled.");
    error.name = "SimulationCanceledError";
    throw error;
  }


  function nominalSpxReturnOf(returnRow) {
    return returnRow.nominalReturn ?? returnRow.return;
  }


  function buildReturnMetrics(returnRow, spxBeta) {
    const nominalSpxReturn = nominalSpxReturnOf(returnRow);
    const nominalRiskFreeReturn = returnRow.riskFreeReturn ?? 0;
    const nominalSpxExcessReturn = nominalSpxReturn - nominalRiskFreeReturn;
    const inflation = returnRow.inflation ?? 0;
    const inflationFactor = Math.max(MIN_GROWTH_FACTOR, 1 + inflation);
    const nominalPortfolioReturn = nominalRiskFreeReturn + spxBeta * nominalSpxExcessReturn;
    const realGrowthFactor = Math.max(MIN_GROWTH_FACTOR, 1 + nominalPortfolioReturn) / inflationFactor;
    return {
      nominalSpxReturn,
      nominalRiskFreeReturn,
      nominalSpxExcessReturn,
      nominalPortfolioReturn,
      inflation,
      realSpxReturn: (1 + nominalSpxReturn) / inflationFactor - 1,
      realRiskFreeReturn: (1 + nominalRiskFreeReturn) / inflationFactor - 1,
      realGrowthFactor
    };
  }


  // Log real growth per historical row for one beta. Cached per beta so the hot
  // loops never rebuild return metrics.
  function createLogGrowthLookup(returnRows) {
    const cache = new Map();
    return (beta) => {
      let values = cache.get(beta);
      if (!values) {
        values = Float64Array.from(returnRows, (row) => Math.log(buildReturnMetrics(row, beta).realGrowthFactor));
        cache.set(beta, values);
      }
      return values;
    };
  }


  // Wealth after one year with continuous compounding and a continuous cash flow.
  // May be negative; callers treat <= 0 as depletion.
  function advanceWealth(startingWealth, netCashFlow, logReturn) {
    if (Math.abs(logReturn) < 0.0000001) {
      return startingWealth + netCashFlow;
    }
    const growth = Math.exp(logReturn);
    return startingWealth * growth + netCashFlow * ((growth - 1) / logReturn);
  }


  function applyContinuousYear(startingWealth, netCashFlow, realGrowthFactor) {
    const endingWealth = advanceWealth(startingWealth, netCashFlow, Math.log(realGrowthFactor));
    return {
      startingWealth,
      endingWealth: Math.max(0, endingWealth),
      depleted: endingWealth <= 0
    };
  }


  function cashFlowForYear(flows, year) {
    return flows.reduce((sum, flow) => {
      if (year < flow.startYear || year > flow.endYear) return sum;
      return sum + flow.amount;
    }, 0);
  }


  function netCashFlowsByYear(scenario, years) {
    return years.map((year) => {
      const income = cashFlowForYear(scenario.income, year);
      const expenses = cashFlowForYear(scenario.expenses, year);
      return { income, expenses, net: income - expenses };
    });
  }


  function betaForYear(scenario, dynamicPolicy, yearIndex, wealth) {
    return dynamicPolicy
      ? selectDynamicBeta(dynamicPolicy, yearIndex, wealth)
      : scenario.spxBeta;
  }


  async function simulateScenario(scenario, returnRows, random = Math.random, onProgress = () => {}, shouldCancel = () => false) {
    if (!returnRows.length) {
      throw new Error("No historical market data loaded.");
    }

    const years = Planner.range(scenario.currentYear, scenario.deathYear);
    const yearCount = years.length;
    const simulationCount = scenario.simulationCount;
    const isDynamicBeta = scenario.betaMode === Planner.BETA_MODE_DYNAMIC;
    const dynamicPolicy = isDynamicBeta
      ? await buildDynamicBetaPolicy(scenario, returnRows, years, onProgress, shouldCancel)
      : null;
    const policyShare = isDynamicBeta ? Planner.DYNAMIC_POLICY_PROGRESS_SHARE : 0;
    const cashFlows = netCashFlowsByYear(scenario, years);
    const logGrowthFor = createLogGrowthLookup(returnRows);
    const realSpxReturns = returnRows.map((row) => buildReturnMetrics(row, 0).realSpxReturn);

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
      throwIfCanceled(shouldCancel);

      const offset = i * yearCount;
      let wealth = scenario.netWorth;
      let failureYear = null;
      let sampledCount = 0;
      let realSpxReturnSum = 0;

      for (let yearIndex = 0; yearIndex < yearCount; yearIndex += 1) {
        let beta = null;
        if (wealth > 0) {
          const rowIndex = Planner.randomIndex(returnRows.length, random);
          beta = betaForYear(scenario, dynamicPolicy, yearIndex, wealth);
          const endingWealth = advanceWealth(wealth, cashFlows[yearIndex].net, logGrowthFor(beta)[rowIndex]);
          sampledRowIndexes[offset + yearIndex] = rowIndex;
          sampledCount += 1;
          realSpxReturnSum += realSpxReturns[rowIndex];
          wealth = Math.max(0, endingWealth);
          if (endingWealth <= 0) failureYear = years[yearIndex];
          betaSums[yearIndex] += beta;
          betaCounts[yearIndex] += 1;
        }
        wealthSums[yearIndex] += wealth;
        pathWealth[yearIndex] = wealth;
        pathBeta[yearIndex] = beta;
      }

      const summary = {
        simulation: i + 1,
        failureYear,
        terminalWealth: wealth,
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


  // Rebuilds the annual rows for one simulation from its stored sampled years.
  // Uses the same arithmetic as simulateScenario, so values match the run exactly.
  function getSimulationYearRows(results, simulation) {
    const { scenario, returnRows, dynamicPolicy, years, sampledRowIndexes } = results;
    if (!Number.isInteger(simulation) || simulation < 1 || simulation > scenario.simulationCount) return [];

    const offset = (simulation - 1) * years.length;
    const cashFlows = netCashFlowsByYear(scenario, years);
    const rows = [];
    let wealth = scenario.netWorth;
    let failureYear = null;

    years.forEach((year, yearIndex) => {
      if (wealth <= 0) {
        rows.push(createEmptySimulationYearRow(simulation, year, failureYear));
        return;
      }
      const row = returnRows[sampledRowIndexes[offset + yearIndex]];
      const spxBetaUsed = betaForYear(scenario, dynamicPolicy, yearIndex, wealth);
      const metrics = buildReturnMetrics(row, spxBetaUsed);
      const { income, expenses, net } = cashFlows[yearIndex];
      const endingWealth = advanceWealth(wealth, net, Math.log(metrics.realGrowthFactor));
      const depleted = endingWealth <= 0;
      if (depleted) failureYear = year;

      rows.push({
        simulation,
        year,
        historicalReturnYear: row.year,
        startingWealth: wealth,
        income,
        expenses,
        netCashFlow: net,
        nominalSpxReturn: metrics.nominalSpxReturn,
        nominalRiskFreeReturn: metrics.nominalRiskFreeReturn,
        nominalSpxExcessReturn: metrics.nominalSpxExcessReturn,
        spxBetaUsed,
        nominalPortfolioReturn: metrics.nominalPortfolioReturn,
        inflation: metrics.inflation,
        realSpxReturn: metrics.realSpxReturn,
        realRiskFreeReturn: metrics.realRiskFreeReturn,
        portfolioRealReturn: metrics.realGrowthFactor - 1,
        endingWealth: Math.max(0, endingWealth),
        depletedThisYear: depleted,
        depletionYear: depleted ? year : ""
      });
      wealth = Math.max(0, endingWealth);
    });
    return rows;
  }


  function createEmptySimulationYearRow(simulation, year, failureYear) {
    return {
      simulation,
      year,
      historicalReturnYear: "",
      startingWealth: 0,
      income: 0,
      expenses: 0,
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


  // Solves the min-risk policy (which drives the simulation) and the risk/wealth
  // frontier. The frontier needs two extra sweeps: the min-risk and
  // max-expected-wealth policies are solved together first, which calibrates the
  // risk-penalty scale for one more sweep over every risk-penalty policy.
  async function buildDynamicBetaPolicy(scenario, returnRows, years, onProgress, shouldCancel) {
    const wealthBuckets = buildDynamicWealthBuckets(scenario);
    const penaltyFactors = Planner.DYNAMIC_FRONTIER_RISK_PENALTY_FACTORS;
    // Progress weights approximate sweep cost: shared transitions plus per-objective work.
    const firstSweepWeight = 2 + 2;
    const secondSweepWeight = 2 + penaltyFactors.length;
    const totalWeight = (firstSweepWeight + secondSweepWeight) * years.length;
    let completedWeight = 0;
    const solve = (objectives, sweepWeight, actionTablesFor = -1) => solveDynamicBetaPolicies({
      scenario,
      returnRows,
      years,
      wealthBuckets,
      objectives,
      actionTablesFor,
      shouldCancel,
      onPolicyYearComplete: async (yearIndex) => {
        completedWeight += sweepWeight;
        onProgress((completedWeight / totalWeight) * Planner.DYNAMIC_POLICY_PROGRESS_SHARE);
        if (yearIndex % 4 === 0) await Planner.yieldToBrowser();
      }
    });

    const [minRiskPolicy, maxWealthPolicy] = await solve([
      { type: "minRisk", label: "Minimum run-out risk" },
      { type: "riskPenalty", riskPenalty: 0, label: "Maximum expected wealth" }
    ], firstSweepWeight, 0);
    const minRiskPoint = buildFrontierPoint(minRiskPolicy, scenario, wealthBuckets, true);
    const maxWealthPoint = buildFrontierPoint(maxWealthPolicy, scenario, wealthBuckets, false);
    const riskPenaltyScale = calibrateFrontierRiskPenaltyScale(minRiskPoint, maxWealthPoint, scenario);

    const penaltyPolicies = await solve(penaltyFactors.map((factor) => {
      const riskPenalty = factor * riskPenaltyScale;
      return { type: "riskPenalty", riskPenalty, label: `Risk penalty ${Planner.formatCompactCurrency(riskPenalty)}` };
    }), secondSweepWeight);

    const frontier = [minRiskPoint];
    addFrontierPoint(frontier, maxWealthPoint);
    penaltyPolicies.forEach((policy) => addFrontierPoint(frontier, buildFrontierPoint(policy, scenario, wealthBuckets, false)));
    frontier.sort((a, b) => a.depletionRisk - b.depletionRisk || a.expectedTerminalWealth - b.expectedTerminalWealth);

    return {
      betaValues: Planner.DYNAMIC_BETA_VALUES,
      wealthBuckets,
      frontier,
      ...minRiskPolicy
    };
  }


  function calibrateFrontierRiskPenaltyScale(minRiskPoint, maxWealthPoint, scenario) {
    const riskRange = Math.abs((maxWealthPoint.depletionRisk || 0) - (minRiskPoint.depletionRisk || 0));
    const wealthRange = Math.abs((maxWealthPoint.expectedTerminalWealth || 0) - (minRiskPoint.expectedTerminalWealth || 0));
    if (riskRange > Planner.EPSILON && wealthRange > 1) {
      return wealthRange / riskRange;
    }
    return Math.max(1000000, scenario.netWorth || 0, maxWealthPoint.expectedTerminalWealth || 0);
  }


  // Backward induction over (year, wealth bucket) for several objectives in one
  // sweep. For each node and each beta, every historical return row's ending
  // wealth and bucket interpolation is computed once and shared by all
  // objectives; each objective then averages its own next-year depletion risk
  // and expected terminal wealth and keeps the beta it prefers. Per-beta action
  // tables are kept only for the objective at index actionTablesFor.
  async function solveDynamicBetaPolicies({
    scenario,
    returnRows,
    years,
    wealthBuckets,
    objectives,
    actionTablesFor,
    shouldCancel,
    onPolicyYearComplete
  }) {
    const betaValues = Planner.DYNAMIC_BETA_VALUES;
    const betaCount = betaValues.length;
    const objectiveCount = objectives.length;
    const bucketCount = wealthBuckets.length;
    const lastBucket = bucketCount - 1;
    const topWealth = wealthBuckets[lastBucket];
    const rowCount = returnRows.length;
    const logGrowthFor = createLogGrowthLookup(returnRows);
    const logGrowthByBeta = betaValues.map(logGrowthFor);
    const cashFlows = netCashFlowsByYear(scenario, years);

    const policies = objectives.map((objective, index) => {
      const terminalValues = new Float64Array(bucketCount);
      const terminalExpectedWealth = Float64Array.from(wealthBuckets);
      const valueByYear = new Array(years.length + 1);
      const expectedWealthByYear = new Array(years.length + 1);
      valueByYear[years.length] = terminalValues;
      expectedWealthByYear[years.length] = terminalExpectedWealth;
      return {
        objective,
        valueByYear,
        expectedWealthByYear,
        actionValueByYear: index === actionTablesFor ? new Array(years.length) : null,
        actionExpectedWealthByYear: index === actionTablesFor ? new Array(years.length) : null,
        policyByYear: new Array(years.length)
      };
    });
    let nextValues = policies.map((policy) => policy.valueByYear[years.length]);
    let nextExpectedWealth = policies.map((policy) => policy.expectedWealthByYear[years.length]);

    // Per-beta scratch: interpolation endpoints for each in-range return row.
    const lowerIndexes = new Int32Array(rowCount);
    const weights = new Float64Array(rowCount);
    const riskSums = new Float64Array(objectiveCount);
    const wealthSums = new Float64Array(objectiveCount);
    const bestRisk = new Float64Array(objectiveCount);
    const bestWealth = new Float64Array(objectiveCount);
    const bestBeta = new Float64Array(objectiveCount);

    for (let yearIndex = years.length - 1; yearIndex >= 0; yearIndex -= 1) {
      throwIfCanceled(shouldCancel);
      const netCashFlow = cashFlows[yearIndex].net;
      const currentValues = objectives.map(() => new Float64Array(bucketCount));
      const currentExpectedWealth = objectives.map(() => new Float64Array(bucketCount));
      const currentPolicy = objectives.map(() => new Float64Array(bucketCount));
      const actionValues = actionTablesFor >= 0 ? new Array(bucketCount) : null;
      const actionExpectedWealth = actionTablesFor >= 0 ? new Array(bucketCount) : null;

      for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
        const startingWealth = wealthBuckets[bucketIndex];
        if (actionValues) {
          actionValues[bucketIndex] = new Float64Array(betaCount);
          actionExpectedWealth[bucketIndex] = new Float64Array(betaCount);
        }
        if (startingWealth <= 0) {
          if (actionValues) actionValues[bucketIndex].fill(1);
          for (let k = 0; k < objectiveCount; k += 1) {
            currentValues[k][bucketIndex] = 1;
            currentExpectedWealth[k][bucketIndex] = 0;
            currentPolicy[k][bucketIndex] = 0;
          }
          continue;
        }

        bestRisk.fill(Number.POSITIVE_INFINITY);
        bestWealth.fill(Number.NEGATIVE_INFINITY);
        bestBeta.fill(betaValues[0]);

        for (let betaIndex = 0; betaIndex < betaCount; betaIndex += 1) {
          const logGrowth = logGrowthByBeta[betaIndex];
          let depletedCount = 0;
          let topCount = 0;
          let interpolatedCount = 0;
          for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
            const endingWealth = advanceWealth(startingWealth, netCashFlow, logGrowth[rowIndex]);
            if (endingWealth <= 0) {
              depletedCount += 1;
            } else if (endingWealth >= topWealth) {
              topCount += 1;
            } else {
              const upper = upperBucketIndex(wealthBuckets, endingWealth);
              const lower = upper - 1;
              lowerIndexes[interpolatedCount] = lower;
              weights[interpolatedCount] = (endingWealth - wealthBuckets[lower]) / (wealthBuckets[upper] - wealthBuckets[lower]);
              interpolatedCount += 1;
            }
          }

          for (let k = 0; k < objectiveCount; k += 1) {
            const values = nextValues[k];
            const expectedWealth = nextExpectedWealth[k];
            let totalDepletionRisk = depletedCount + topCount * values[lastBucket];
            let totalExpectedWealth = topCount * expectedWealth[lastBucket];
            for (let i = 0; i < interpolatedCount; i += 1) {
              const lower = lowerIndexes[i];
              const t = weights[i];
              totalDepletionRisk += values[lower] + (values[lower + 1] - values[lower]) * t;
              totalExpectedWealth += expectedWealth[lower] + (expectedWealth[lower + 1] - expectedWealth[lower]) * t;
            }
            const actionDepletionRisk = totalDepletionRisk / rowCount;
            const actionExpectedWealthValue = totalExpectedWealth / rowCount;
            if (k === actionTablesFor) {
              actionValues[bucketIndex][betaIndex] = actionDepletionRisk;
              actionExpectedWealth[bucketIndex][betaIndex] = actionExpectedWealthValue;
            }
            if (isBetterDynamicAction(objectives[k], actionDepletionRisk, actionExpectedWealthValue, bestRisk[k], bestWealth[k])) {
              bestRisk[k] = actionDepletionRisk;
              bestWealth[k] = actionExpectedWealthValue;
              bestBeta[k] = betaValues[betaIndex];
            }
          }
        }

        for (let k = 0; k < objectiveCount; k += 1) {
          currentValues[k][bucketIndex] = bestRisk[k];
          currentExpectedWealth[k][bucketIndex] = bestWealth[k];
          currentPolicy[k][bucketIndex] = bestBeta[k];
        }
      }

      policies.forEach((policy, k) => {
        policy.valueByYear[yearIndex] = currentValues[k];
        policy.expectedWealthByYear[yearIndex] = currentExpectedWealth[k];
        policy.policyByYear[yearIndex] = currentPolicy[k];
        if (k === actionTablesFor) {
          policy.actionValueByYear[yearIndex] = actionValues;
          policy.actionExpectedWealthByYear[yearIndex] = actionExpectedWealth;
        }
      });
      nextValues = currentValues;
      nextExpectedWealth = currentExpectedWealth;
      await onPolicyYearComplete(yearIndex);
    }

    return policies;
  }


  // Lower risk wins; near-ties go to higher expected wealth. Risk-penalty
  // objectives compare wealth minus penalty * risk first.
  function isBetterDynamicAction(objective, risk, wealth, bestRisk, bestWealth) {
    if (!Number.isFinite(bestRisk) || !Number.isFinite(bestWealth)) return true;
    if (objective.type === "riskPenalty") {
      const score = wealth - objective.riskPenalty * risk;
      const bestScore = bestWealth - objective.riskPenalty * bestRisk;
      if (Math.abs(score - bestScore) > Planner.EPSILON) return score > bestScore;
    }
    if (Math.abs(risk - bestRisk) > Planner.EPSILON) return risk < bestRisk;
    return wealth > bestWealth + Planner.EPSILON;
  }


  function buildFrontierPoint(policy, scenario, wealthBuckets, isMinRisk) {
    const bucketIndex = nearestBucketIndex(wealthBuckets, scenario.netWorth);
    return {
      label: policy.objective.label,
      riskPenalty: policy.objective.riskPenalty ?? null,
      isMinRisk,
      depletionRisk: policy.valueByYear[0]?.[bucketIndex] ?? null,
      expectedTerminalWealth: policy.expectedWealthByYear[0]?.[bucketIndex] ?? null,
      currentBeta: policy.policyByYear[0]?.[bucketIndex] ?? null
    };
  }


  function addFrontierPoint(frontier, point) {
    if (!Number.isFinite(point.depletionRisk) || !Number.isFinite(point.expectedTerminalWealth)) return;
    const duplicate = frontier.some((existing) => (
      Math.abs(existing.depletionRisk - point.depletionRisk) <= 0.00005 &&
      Math.abs(existing.expectedTerminalWealth - point.expectedTerminalWealth) <= 1 &&
      Math.abs((existing.currentBeta ?? 0) - (point.currentBeta ?? 0)) <= Planner.EPSILON
    ));
    if (!duplicate) frontier.push(point);
  }


  // A zero bucket followed by log-spaced positive buckets.
  function buildDynamicWealthBuckets(scenario) {
    const wealthCap = Math.max(Planner.DYNAMIC_MAX_WEALTH_BUCKET, scenario.netWorth);
    const minPositiveWealth = Planner.DYNAMIC_MIN_POSITIVE_WEALTH_BUCKET;
    const logMin = Math.log(minPositiveWealth);
    const logSpan = Math.log(wealthCap) - logMin;
    const buckets = [0];
    for (let index = 0; index < Planner.DYNAMIC_WEALTH_BUCKETS; index += 1) {
      const t = index / Math.max(1, Planner.DYNAMIC_WEALTH_BUCKETS - 1);
      buckets.push(minPositiveWealth * Math.exp(t * logSpan));
    }
    return buckets;
  }


  function selectDynamicBeta(policy, yearIndex, wealth) {
    const policyRow = policy.policyByYear[yearIndex];
    if (!policyRow) return Planner.DYNAMIC_BETA_VALUES[0];
    return policyRow[nearestBucketIndex(policy.wealthBuckets, wealth)] ?? Planner.DYNAMIC_BETA_VALUES[0];
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


  // Positive wealth below the first positive bucket maps to that bucket, never
  // to the zero (depleted) bucket.
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


  // First index whose bucket is >= wealth.
  function upperBucketIndex(buckets, wealth) {
    let low = 0;
    let high = buckets.length - 1;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (buckets[mid] < wealth) low = mid + 1;
      else high = mid;
    }
    return low;
  }


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
    isCancellationError,
    nominalSpxReturnOf,
    buildReturnMetrics,
    applyContinuousYear,
    cashFlowForYear,
    simulateScenario,
    getSimulationYearRows,
    selectDynamicBeta,
    interpolateBucketValue,
    nearestBucketIndex
  });
})(window.Planner = window.Planner || {});
