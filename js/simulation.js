(function (Planner) {
  function isCancellationError(error) {
    return error && error.name === "SimulationCanceledError";
  }


  function throwIfCanceled(shouldCancel) {
    if (!shouldCancel()) return;
    const error = new Error("Simulation canceled.");
    error.name = "SimulationCanceledError";
    throw error;
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

  async function simulateScenario(scenario, returnRows, random = Math.random, onProgress = () => {}, shouldCancel = () => false) {
    if (!returnRows.length) {
      throw new Error("No historical market data loaded.");
    }

    const years = Planner.range(scenario.currentYear, scenario.deathYear);
    const isDynamicBeta = scenario.betaMode === Planner.BETA_MODE_DYNAMIC;
    const dynamicPolicy = isDynamicBeta
      ? await buildDynamicBetaPolicy(scenario, returnRows, years, onProgress, shouldCancel)
      : null;
    const failures = [];
    const terminalWealth = [];
    const simulationRows = [];
    const simulationYearRows = [];
    const simulationYearRowsBySimulation = new Map();
    const visualPaths = [];
    const wealthSums = new Array(years.length).fill(0);
    const betaSums = new Array(years.length).fill(0);
    const betaCounts = new Array(years.length).fill(0);

    onProgress(isDynamicBeta ? Planner.DYNAMIC_POLICY_PROGRESS_SHARE : 0);
    for (let i = 0; i < scenario.simulationCount; i += 1) {
      throwIfCanceled(shouldCancel);
      if (i > 0 && i % Planner.SIMULATION_CHUNK_SIZE === 0) {
        const simulationProgress = i / scenario.simulationCount;
        onProgress(isDynamicBeta
          ? Planner.DYNAMIC_POLICY_PROGRESS_SHARE + simulationProgress * (1 - Planner.DYNAMIC_POLICY_PROGRESS_SHARE)
          : simulationProgress);
        await Planner.yieldToBrowser();
        throwIfCanceled(shouldCancel);
      }

      let wealth = scenario.netWorth;
      let failureYear = null;
      let sampledReturnCount = 0;
      let sampledNominalReturnSum = 0;
      let sampledRealReturnSum = 0;
      const path = [];
      const betaPath = [];
      const pathYearRows = [];

      for (let yearIndex = 0; yearIndex < years.length; yearIndex += 1) {
        const year = years[yearIndex];

        if (wealth > 0) {
          const income = cashFlowForYear(scenario.income, year);
          const expenses = cashFlowForYear(scenario.expenses, year);
          const netCashFlow = income - expenses;
          const sampledReturn = buildAnnualSampledReturn(returnRows, random);
          const spxBetaUsed = isDynamicBeta
            ? selectDynamicBeta(dynamicPolicy, yearIndex, wealth)
            : scenario.spxBeta;
          const returnMetrics = buildReturnMetrics(sampledReturn.row, spxBetaUsed);
          const yearResult = applyContinuousYear(wealth, netCashFlow, returnMetrics.realGrowthFactor);

          sampledReturnCount += 1;
          sampledNominalReturnSum += returnMetrics.nominalSpxReturn;
          sampledRealReturnSum += returnMetrics.realSpxReturn;
          wealth = yearResult.endingWealth;

          if (yearResult.depleted) {
            wealth = 0;
            failureYear = year;
          }

          const simulationYearRow = {
            simulation: i + 1,
            year,
            historicalReturnYear: sampledReturn.row.year,
            startingWealth: yearResult.startingWealth,
            income,
            expenses,
            netCashFlow,
            nominalSpxReturn: returnMetrics.nominalSpxReturn,
            nominalRiskFreeReturn: returnMetrics.nominalRiskFreeReturn,
            nominalSpxExcessReturn: returnMetrics.nominalSpxExcessReturn,
            spxBetaUsed,
            nominalPortfolioReturn: returnMetrics.nominalPortfolioReturn,
            inflation: returnMetrics.inflation,
            realSpxReturn: returnMetrics.realSpxReturn,
            realRiskFreeReturn: returnMetrics.realRiskFreeReturn,
            portfolioRealReturn: returnMetrics.realGrowthFactor - 1,
            endingWealth: wealth,
            depletedThisYear: yearResult.depleted,
            depletionYear: yearResult.depleted ? year : ""
          };
          simulationYearRows.push(simulationYearRow);
          pathYearRows.push(simulationYearRow);
        } else {
          const simulationYearRow = createEmptySimulationYearRow(i + 1, year, failureYear);
          simulationYearRows.push(simulationYearRow);
          pathYearRows.push(simulationYearRow);
        }

        wealthSums[yearIndex] += wealth;
        path.push({ year, wealth });
        const betaForPath = pathYearRows[pathYearRows.length - 1]?.spxBetaUsed;
        if (Number.isFinite(betaForPath)) {
          betaSums[yearIndex] += betaForPath;
          betaCounts[yearIndex] += 1;
          betaPath.push({ year, beta: betaForPath });
        } else {
          betaPath.push({ year, beta: null });
        }
      }

      const pathResult = {
        simulation: i + 1,
        points: path,
        betaPoints: betaPath,
        terminalWealth: wealth,
        averageNominalSpxReturn: sampledReturnCount ? sampledNominalReturnSum / sampledReturnCount : null,
        averageRealSpxReturn: sampledReturnCount ? sampledRealReturnSum / sampledReturnCount : null,
        failureYear
      };
      addReservoirSample(visualPaths, pathResult, i, Planner.MAX_VISUAL_PATHS, random);
      failures.push(failureYear);
      terminalWealth.push(wealth);
      simulationRows.push({
        simulation: i + 1,
        failureYear,
        terminalWealth: wealth,
        averageNominalSpxReturn: pathResult.averageNominalSpxReturn,
        averageRealSpxReturn: pathResult.averageRealSpxReturn,
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
    const expectedBetaPath = years.map((year, index) => ({
      year,
      beta: betaCounts[index] ? betaSums[index] / betaCounts[index] : null
    }));
    visualPaths.forEach((path) => {
      path.endingPercentile = Planner.percentileRank(terminalWealthSorted, path.terminalWealth);
    });
    simulationRows.forEach((row) => {
      row.endingPercentile = Planner.percentileRank(terminalWealthSorted, row.terminalWealth);
    });
    const inspectionPaths = [...visualPaths].sort(compareInspectionPaths);

    return {
      scenario,
      dynamicPolicy,
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
      expectedBetaPath,
      depletedDistribution,
      notDepletedCount,
      risk: failureYears.length / failures.length,
      earliestFailureYear: failureYears.length ? Math.min(...failureYears) : null,
      worstSurvivingPath,
      medianTerminalWealth: Planner.percentile(terminalWealth, 0.5)
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


  function addReservoirSample(samples, item, seenIndex, maxSamples, random = Math.random) {
    if (samples.length < maxSamples) {
      samples.push(item);
      return;
    }
    const replacementIndex = Planner.randomIndex(seenIndex + 1, random);
    if (replacementIndex < maxSamples) {
      samples[replacementIndex] = item;
    }
  }


  function buildAnnualSampledReturn(returnRows, random = Math.random) {
    return {
      row: returnRows[Planner.randomIndex(returnRows.length, random)]
    };
  }


  function buildReturnMetrics(returnRow, spxBeta) {
    const nominalSpxReturn = returnRow.nominalReturn ?? returnRow.return;
    const nominalRiskFreeReturn = returnRow.riskFreeReturn ?? 0;
    const nominalSpxExcessReturn = nominalSpxReturn - nominalRiskFreeReturn;
    const inflation = returnRow.inflation ?? 0;
    const realSpxReturn = ((1 + nominalSpxReturn) / Math.max(0.000001, 1 + inflation)) - 1;
    const realRiskFreeReturn = ((1 + nominalRiskFreeReturn) / Math.max(0.000001, 1 + inflation)) - 1;
    const nominalPortfolioReturn = nominalRiskFreeReturn + spxBeta * nominalSpxExcessReturn;
    const nominalGrowthFactor = Math.max(0.000001, 1 + nominalPortfolioReturn);
    const realGrowthFactor = nominalGrowthFactor / Math.max(0.000001, 1 + inflation);
    return {
      nominalSpxReturn,
      nominalRiskFreeReturn,
      nominalSpxExcessReturn,
      spxBeta,
      nominalPortfolioReturn,
      inflation,
      realSpxReturn,
      realRiskFreeReturn,
      realGrowthFactor
    };
  }


  async function buildDynamicBetaPolicy(scenario, returnRows, years, onProgress, shouldCancel) {
    const wealthBuckets = buildDynamicWealthBuckets(scenario);
    const frontierWealthBuckets = buildDynamicWealthBuckets(scenario, Planner.DYNAMIC_FRONTIER_WEALTH_BUCKETS);
    const frontierPolicyBuilds = 1 + Planner.DYNAMIC_FRONTIER_RISK_PENALTY_FACTORS.length;
    const totalPolicyWork = years.length * (wealthBuckets.length + frontierPolicyBuilds * frontierWealthBuckets.length);
    let completedPolicyWork = 0;
    const onPolicyYearComplete = async (yearIndex, bucketCount) => {
      completedPolicyWork += bucketCount;
      onProgress((completedPolicyWork / Math.max(1, totalPolicyWork)) * Planner.DYNAMIC_POLICY_PROGRESS_SHARE);
      if (yearIndex % 4 === 0) {
        await Planner.yieldToBrowser();
      }
    };

    const minRiskPolicy = await buildDynamicBetaPolicyForObjective({
      scenario,
      returnRows,
      years,
      wealthBuckets,
      objective: { type: "minRisk", label: "Minimum run-out risk" },
      shouldCancel,
      onPolicyYearComplete
    });
    const frontier = [buildFrontierPoint(minRiskPolicy, scenario, wealthBuckets, "Minimum run-out risk", null, true)];
    const maxWealthPolicy = await buildDynamicBetaPolicyForObjective({
      scenario,
      returnRows,
      years,
      wealthBuckets: frontierWealthBuckets,
      objective: { type: "riskPenalty", riskPenalty: 0, label: "Maximum expected wealth" },
      shouldCancel,
      onPolicyYearComplete
    });
    const maxWealthPoint = buildFrontierPoint(maxWealthPolicy, scenario, frontierWealthBuckets, maxWealthPolicy.objective.label, 0, false);
    addFrontierPoint(frontier, maxWealthPoint);
    const riskPenaltyScale = calibrateFrontierRiskPenaltyScale(frontier[0], maxWealthPoint, scenario);

    for (const factor of Planner.DYNAMIC_FRONTIER_RISK_PENALTY_FACTORS) {
      const riskPenalty = factor * riskPenaltyScale;
      const policy = await buildDynamicBetaPolicyForObjective({
        scenario,
        returnRows,
        years,
        wealthBuckets: frontierWealthBuckets,
        objective: {
          type: "riskPenalty",
          riskPenalty,
          label: `Risk penalty ${Planner.formatCompactCurrency(riskPenalty)}`
        },
        shouldCancel,
        onPolicyYearComplete
      });
      addFrontierPoint(frontier, buildFrontierPoint(policy, scenario, frontierWealthBuckets, policy.objective.label, riskPenalty, false));
    }

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


  async function buildDynamicBetaPolicyForObjective({
    scenario,
    returnRows,
    years,
    wealthBuckets,
    objective,
    shouldCancel,
    onPolicyYearComplete
  }) {
    const valueByYear = new Array(years.length + 1);
    const expectedWealthByYear = new Array(years.length + 1);
    const actionValueByYear = new Array(years.length);
    const actionExpectedWealthByYear = new Array(years.length);
    const policyByYear = new Array(years.length);
    let nextValues = new Array(wealthBuckets.length).fill(0);
    let nextExpectedWealth = [...wealthBuckets];
    valueByYear[years.length] = nextValues;
    expectedWealthByYear[years.length] = nextExpectedWealth;

    for (let yearIndex = years.length - 1; yearIndex >= 0; yearIndex -= 1) {
      throwIfCanceled(shouldCancel);
      const year = years[yearIndex];
      const netCashFlow = cashFlowForYear(scenario.income, year) - cashFlowForYear(scenario.expenses, year);
      const currentValues = new Array(wealthBuckets.length);
      const currentExpectedWealth = new Array(wealthBuckets.length);
      const currentActionValues = new Array(wealthBuckets.length);
      const currentActionExpectedWealth = new Array(wealthBuckets.length);
      const currentPolicy = new Array(wealthBuckets.length);

      for (let bucketIndex = 0; bucketIndex < wealthBuckets.length; bucketIndex += 1) {
        const startingWealth = wealthBuckets[bucketIndex];
        const actionValues = new Array(Planner.DYNAMIC_BETA_VALUES.length);
        const actionExpectedWealthValues = new Array(Planner.DYNAMIC_BETA_VALUES.length);
        if (startingWealth <= 0) {
          actionValues.fill(1);
          actionExpectedWealthValues.fill(0);
          currentActionValues[bucketIndex] = actionValues;
          currentActionExpectedWealth[bucketIndex] = actionExpectedWealthValues;
          currentValues[bucketIndex] = 1;
          currentExpectedWealth[bucketIndex] = 0;
          currentPolicy[bucketIndex] = 0;
          continue;
        }

        let bestDepletionRisk = Number.POSITIVE_INFINITY;
        let bestExpectedWealth = Number.NEGATIVE_INFINITY;
        let bestBeta = Planner.DYNAMIC_BETA_VALUES[0];

        Planner.DYNAMIC_BETA_VALUES.forEach((beta, betaIndex) => {
          let totalDepletionRisk = 0;
          let totalExpectedWealth = 0;
          returnRows.forEach((returnRow) => {
            const returnMetrics = buildReturnMetrics(returnRow, beta);
            const yearResult = applyContinuousYear(startingWealth, netCashFlow, returnMetrics.realGrowthFactor);
            if (yearResult.depleted) {
              totalDepletionRisk += 1;
              return;
            }
            totalDepletionRisk += interpolateBucketValue(wealthBuckets, nextValues, yearResult.endingWealth);
            totalExpectedWealth += interpolateBucketValue(wealthBuckets, nextExpectedWealth, yearResult.endingWealth);
          });
          const actionDepletionRisk = totalDepletionRisk / returnRows.length;
          const actionExpectedWealth = totalExpectedWealth / returnRows.length;
          actionValues[betaIndex] = actionDepletionRisk;
          actionExpectedWealthValues[betaIndex] = actionExpectedWealth;

          if (isBetterDynamicAction(objective, actionDepletionRisk, actionExpectedWealth, bestDepletionRisk, bestExpectedWealth)) {
            bestDepletionRisk = actionDepletionRisk;
            bestExpectedWealth = actionExpectedWealth;
            bestBeta = beta;
          }
        });

        currentValues[bucketIndex] = bestDepletionRisk;
        currentExpectedWealth[bucketIndex] = bestExpectedWealth;
        currentActionValues[bucketIndex] = actionValues;
        currentActionExpectedWealth[bucketIndex] = actionExpectedWealthValues;
        currentPolicy[bucketIndex] = bestBeta;
      }

      valueByYear[yearIndex] = currentValues;
      expectedWealthByYear[yearIndex] = currentExpectedWealth;
      actionValueByYear[yearIndex] = currentActionValues;
      actionExpectedWealthByYear[yearIndex] = currentActionExpectedWealth;
      policyByYear[yearIndex] = currentPolicy;
      nextValues = currentValues;
      nextExpectedWealth = currentExpectedWealth;
      await onPolicyYearComplete(yearIndex, wealthBuckets.length);
    }

    return {
      objective,
      valueByYear,
      expectedWealthByYear,
      actionValueByYear,
      actionExpectedWealthByYear,
      policyByYear
    };
  }


  function isBetterDynamicAction(objective, actionDepletionRisk, actionExpectedWealth, bestDepletionRisk, bestExpectedWealth) {
    if (!Number.isFinite(bestDepletionRisk) || !Number.isFinite(bestExpectedWealth)) return true;
    if (objective.type === "riskPenalty") {
      const actionScore = actionExpectedWealth - objective.riskPenalty * actionDepletionRisk;
      const bestScore = bestExpectedWealth - objective.riskPenalty * bestDepletionRisk;
      if (actionScore > bestScore + Planner.EPSILON) return true;
      if (Math.abs(actionScore - bestScore) > Planner.EPSILON) return false;
      if (actionDepletionRisk < bestDepletionRisk - Planner.EPSILON) return true;
      return (
        Math.abs(actionDepletionRisk - bestDepletionRisk) <= Planner.EPSILON &&
        actionExpectedWealth > bestExpectedWealth + Planner.EPSILON
      );
    }
    return isLowerRiskAction(actionDepletionRisk, actionExpectedWealth, bestDepletionRisk, bestExpectedWealth);
  }


  function isLowerRiskAction(actionDepletionRisk, actionExpectedWealth, bestDepletionRisk, bestExpectedWealth) {
    if (actionDepletionRisk < bestDepletionRisk - Planner.EPSILON) return true;
    return (
      Math.abs(actionDepletionRisk - bestDepletionRisk) <= Planner.EPSILON &&
      actionExpectedWealth > bestExpectedWealth + Planner.EPSILON
    );
  }


  function buildFrontierPoint(policy, scenario, wealthBuckets, label, riskPenalty, isMinRisk) {
    const bucketIndex = nearestBucketIndex(wealthBuckets, scenario.netWorth);
    return {
      label,
      riskPenalty,
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


  function buildDynamicWealthBuckets(scenario, bucketCount = Planner.DYNAMIC_WEALTH_BUCKETS) {
    const wealthCap = Math.max(Planner.DYNAMIC_MAX_WEALTH_BUCKET, scenario.netWorth);
    const buckets = [0];
    const minPositiveWealth = Planner.DYNAMIC_MIN_POSITIVE_WEALTH_BUCKET;
    const logMax = Math.log(wealthCap);

    for (let index = 0; index < bucketCount; index += 1) {
      const t = index / Math.max(1, bucketCount - 1);
      buckets.push(minPositiveWealth * Math.exp(t * (logMax - Math.log(minPositiveWealth))));
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


  function upperBucketIndex(buckets, wealth) {
    let low = 0;
    let high = buckets.length - 1;

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (buckets[mid] < wealth) low = mid + 1;
      else high = mid;
    }

    return low;
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

    return Planner.range(scenario.currentYear, scenario.deathYear)
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

  Object.assign(Planner, {
    isCancellationError,
    throwIfCanceled,
    simulateScenario,
    getWorstSurvivingPath,
    applyContinuousYear,
    wealthAtTime,
    addReservoirSample,
    buildAnnualSampledReturn,
    buildReturnMetrics,
    buildDynamicBetaPolicy,
    buildDynamicWealthBuckets,
    selectDynamicBeta,
    interpolateBucketValue,
    nearestBucketIndex,
    upperBucketIndex,
    cashFlowForYear,
    buildDepletedDistribution,
    compareInspectionPaths,
    depletionSortYear
  });
})(window.Planner = window.Planner || {});
