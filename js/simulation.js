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
      hedgeCoverageUsed: "",
      putNotional: "",
      putPremium: "",
      putPayoffReal: "",
      putImpliedVol: "",
      putStrikeVolatility: "",
      putImpliedVolSource: "",
      usedFallbackImpliedVol: "",
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
    const usesPolicy = scenarioNeedsPolicy(scenario);
    const dynamicPolicy = usesPolicy
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
    const coverageSums = new Array(years.length).fill(0);
    const coverageCounts = new Array(years.length).fill(0);

    onProgress(usesPolicy ? Planner.DYNAMIC_POLICY_PROGRESS_SHARE : 0);
    for (let i = 0; i < scenario.simulationCount; i += 1) {
      throwIfCanceled(shouldCancel);
      if (i > 0 && i % Planner.SIMULATION_CHUNK_SIZE === 0) {
        const simulationProgress = i / scenario.simulationCount;
        onProgress(usesPolicy
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
      const coveragePath = [];
      const pathYearRows = [];

      for (let yearIndex = 0; yearIndex < years.length; yearIndex += 1) {
        const year = years[yearIndex];

        if (wealth > 0) {
          const income = cashFlowForYear(scenario.income, year);
          const expenses = cashFlowForYear(scenario.expenses, year);
          const netCashFlow = income - expenses;
          const sampledReturn = buildAnnualSampledReturn(returnRows, random);
          const action = selectDynamicAction(dynamicPolicy, scenario, yearIndex, wealth);
          const spxBetaUsed = action.beta;
          const hedgeCoverageUsed = action.hedgeCoverage;
          const returnMetrics = buildReturnMetrics(sampledReturn.row, spxBetaUsed);
          const putContract = scenario.hedgeEnabled
            ? Planner.buildPutContractMetrics({
              returnRow: sampledReturn.row,
              strikeRatio: 1 - scenario.putStrikeDistance,
              impliedVolByYear: scenario.impliedVolByYear,
              fallbackImpliedVol: scenario.fallbackImpliedVol
            })
            : null;
          const yearResult = scenario.hedgeEnabled
            ? Planner.applyHedgedYear({
              startingWealth: wealth,
              netCashFlow,
              returnMetrics,
              putContract,
              beta: spxBetaUsed,
              hedgeCoverage: hedgeCoverageUsed
            })
            : applyContinuousYear(wealth, netCashFlow, returnMetrics.realGrowthFactor);

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
            hedgeCoverageUsed: scenario.hedgeEnabled ? hedgeCoverageUsed : "",
            putNotional: scenario.hedgeEnabled ? yearResult.putNotional : "",
            putPremium: scenario.hedgeEnabled ? yearResult.putPremium : "",
            putPayoffReal: scenario.hedgeEnabled ? yearResult.putPayoffReal : "",
            putImpliedVol: putContract ? putContract.impliedVol : "",
            putStrikeVolatility: putContract ? putContract.strikeVolatility : "",
            putImpliedVolSource: putContract ? putContract.impliedVolSource : "",
            usedFallbackImpliedVol: putContract ? putContract.usedFallbackImpliedVol : "",
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
        const latestRow = pathYearRows[pathYearRows.length - 1];
        const betaForPath = latestRow?.spxBetaUsed;
        if (Number.isFinite(betaForPath)) {
          betaSums[yearIndex] += betaForPath;
          betaCounts[yearIndex] += 1;
          betaPath.push({ year, beta: betaForPath });
        } else {
          betaPath.push({ year, beta: null });
        }
        const coverageForPath = latestRow?.hedgeCoverageUsed;
        if (Number.isFinite(coverageForPath)) {
          coverageSums[yearIndex] += coverageForPath;
          coverageCounts[yearIndex] += 1;
          coveragePath.push({ year, coverage: coverageForPath });
        } else {
          coveragePath.push({ year, coverage: null });
        }
      }

      const pathResult = {
        simulation: i + 1,
        points: path,
        betaPoints: betaPath,
        coveragePoints: coveragePath,
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
    const expectedTerminalWealth = terminalWealth.reduce((sum, wealth) => sum + wealth, 0) / Math.max(1, terminalWealth.length);
    const expectedPath = years.map((year, index) => ({
      year,
      wealth: wealthSums[index] / scenario.simulationCount
    }));
    const expectedBetaPath = years.map((year, index) => ({
      year,
      beta: betaCounts[index] ? betaSums[index] / betaCounts[index] : null
    }));
    const expectedCoveragePath = years.map((year, index) => ({
      year,
      coverage: coverageCounts[index] ? coverageSums[index] / coverageCounts[index] : null
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
      expectedCoveragePath,
      depletedDistribution,
      notDepletedCount,
      risk: failureYears.length / failures.length,
      earliestFailureYear: failureYears.length ? Math.min(...failureYears) : null,
      worstSurvivingPath,
      expectedTerminalWealth,
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


  function scenarioNeedsPolicy(scenario) {
    return scenario.betaMode === Planner.BETA_MODE_DYNAMIC || Boolean(scenario.hedgeEnabled);
  }


  function getPolicyBetaValues(scenario) {
    return scenario.betaMode === Planner.BETA_MODE_DYNAMIC
      ? Planner.DYNAMIC_BETA_VALUES
      : [Number(scenario.spxBeta)];
  }


  function getPolicyHedgeCoverageValues(scenario) {
    return scenario.hedgeEnabled ? Planner.HEDGE_COVERAGE_VALUES : [0];
  }


  function buildPolicyActions(scenario) {
    const actions = [];
    getPolicyBetaValues(scenario).forEach((beta) => {
      getPolicyHedgeCoverageValues(scenario).forEach((hedgeCoverage) => {
        actions.push({ beta, hedgeCoverage });
      });
    });
    return actions;
  }


  function buildReturnTransitionCache(scenario, returnRows, betaValues) {
    const strikeRatio = 1 - (scenario.putStrikeDistance || 0);
    return returnRows.map((returnRow) => {
      const putContract = scenario.hedgeEnabled
        ? Planner.buildPutContractMetrics({
          returnRow,
          strikeRatio,
          impliedVolByYear: scenario.impliedVolByYear,
          fallbackImpliedVol: scenario.fallbackImpliedVol
        })
        : {
          premiumPerUnit: 0,
          payoffPerUnit: 0,
          inflation: returnRow.inflation ?? 0
        };
      const realGrowthFactorByBeta = new Map();
      betaValues.forEach((beta) => {
        realGrowthFactorByBeta.set(beta, buildReturnMetrics(returnRow, beta).realGrowthFactor);
      });
      return { putContract, realGrowthFactorByBeta };
    });
  }


  async function buildDynamicBetaPolicy(scenario, returnRows, years, onProgress, shouldCancel) {
    const wealthBuckets = buildDynamicWealthBuckets(scenario);
    const actions = buildPolicyActions(scenario);
    let completedYearSteps = 0;
    const onPolicyYearComplete = async (yearIndex) => {
      completedYearSteps += 1;
      onProgress((completedYearSteps / Math.max(1, years.length)) * Planner.DYNAMIC_POLICY_PROGRESS_SHARE);
      if (yearIndex % 4 === 0) {
        await Planner.yieldToBrowser();
      }
    };

    const minRiskPolicy = await buildDynamicBetaPolicyForObjective({
      scenario,
      returnRows,
      years,
      wealthBuckets,
      actions,
      objective: { type: "minRisk", label: "Minimum run-out risk" },
      shouldCancel,
      onPolicyYearComplete
    });
    const frontier = [buildFrontierPoint(minRiskPolicy, scenario, wealthBuckets, "Minimum run-out risk", null, true)];
    return {
      betaValues: getPolicyBetaValues(scenario),
      hedgeCoverageValues: getPolicyHedgeCoverageValues(scenario),
      actions,
      wealthBuckets,
      hedgeEnabled: Boolean(scenario.hedgeEnabled),
      frontier,
      ...minRiskPolicy
    };
  }


  async function buildDynamicBetaFrontier(results, returnRows, onProgress = () => {}, shouldCancel = () => false) {
    const scenario = results.scenario;
    const years = results.years;
    const minRiskPolicy = results.dynamicPolicy;
    if (!minRiskPolicy || !scenarioNeedsPolicy(scenario)) return [];

    const wealthBuckets = minRiskPolicy.wealthBuckets;
    const actions = minRiskPolicy.actions || buildPolicyActions(scenario);
    const policyBuilds = 1 + Planner.DYNAMIC_FRONTIER_RISK_PENALTY_FACTORS.length;
    let completedYearSteps = 0;
    const onPolicyYearComplete = async (yearIndex) => {
      completedYearSteps += 1;
      onProgress(completedYearSteps / Math.max(1, policyBuilds * years.length));
      if (yearIndex % 4 === 0) {
        await Planner.yieldToBrowser();
      }
    };

    const frontier = [buildFrontierPoint(minRiskPolicy, scenario, wealthBuckets, "Minimum run-out risk", null, true)];
    const maxWealthPolicy = await buildDynamicBetaPolicyForObjective({
      scenario,
      returnRows,
      years,
      wealthBuckets,
      actions,
      objective: { type: "riskPenalty", riskPenalty: 0, label: "Maximum expected wealth" },
      shouldCancel,
      onPolicyYearComplete
    });
    const maxWealthPoint = buildFrontierPoint(maxWealthPolicy, scenario, wealthBuckets, maxWealthPolicy.objective.label, 0, false);
    addFrontierPoint(frontier, maxWealthPoint);
    const riskPenaltyScale = calibrateFrontierRiskPenaltyScale(frontier[0], maxWealthPoint, scenario);

    for (const factor of Planner.DYNAMIC_FRONTIER_RISK_PENALTY_FACTORS) {
      const riskPenalty = factor * riskPenaltyScale;
      const policy = await buildDynamicBetaPolicyForObjective({
        scenario,
        returnRows,
        years,
        wealthBuckets,
        actions,
        objective: {
          type: "riskPenalty",
          riskPenalty,
          label: `Risk penalty ${Planner.formatCompactCurrency(riskPenalty)}`
        },
        shouldCancel,
        onPolicyYearComplete
      });
      addFrontierPoint(frontier, buildFrontierPoint(policy, scenario, wealthBuckets, policy.objective.label, riskPenalty, false));
    }

    frontier.sort((a, b) => a.depletionRisk - b.depletionRisk || a.expectedTerminalWealth - b.expectedTerminalWealth);
    minRiskPolicy.frontier = frontier;
    return frontier;
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
    actions,
    objective,
    shouldCancel,
    onPolicyYearComplete
  }) {
    const policyActions = actions || buildPolicyActions(scenario);
    const betaValues = [...new Set(policyActions.map((action) => action.beta))];
    const transitionCache = buildReturnTransitionCache(scenario, returnRows, betaValues);
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
        const actionValues = new Array(policyActions.length);
        const actionExpectedWealthValues = new Array(policyActions.length);
        if (startingWealth <= 0) {
          actionValues.fill(1);
          actionExpectedWealthValues.fill(0);
          currentActionValues[bucketIndex] = actionValues;
          currentActionExpectedWealth[bucketIndex] = actionExpectedWealthValues;
          currentValues[bucketIndex] = 1;
          currentExpectedWealth[bucketIndex] = 0;
          currentPolicy[bucketIndex] = policyActions[0];
          continue;
        }

        let bestDepletionRisk = Number.POSITIVE_INFINITY;
        let bestExpectedWealth = Number.NEGATIVE_INFINITY;
        let bestAction = policyActions[0];

        policyActions.forEach((action, actionIndex) => {
          let totalDepletionRisk = 0;
          let totalExpectedWealth = 0;
          transitionCache.forEach((cached) => {
            const yearResult = scenario.hedgeEnabled
              ? Planner.applyHedgedYear({
                startingWealth,
                netCashFlow,
                returnMetrics: {
                  realGrowthFactor: cached.realGrowthFactorByBeta.get(action.beta),
                  inflation: cached.putContract.inflation
                },
                putContract: cached.putContract,
                beta: action.beta,
                hedgeCoverage: action.hedgeCoverage
              })
              : applyContinuousYear(
                startingWealth,
                netCashFlow,
                cached.realGrowthFactorByBeta.get(action.beta)
              );
            if (yearResult.depleted) {
              totalDepletionRisk += 1;
              return;
            }
            totalDepletionRisk += interpolateBucketValue(wealthBuckets, nextValues, yearResult.endingWealth);
            totalExpectedWealth += interpolateBucketValue(wealthBuckets, nextExpectedWealth, yearResult.endingWealth);
          });
          const actionDepletionRisk = totalDepletionRisk / returnRows.length;
          const actionExpectedWealth = totalExpectedWealth / returnRows.length;
          actionValues[actionIndex] = actionDepletionRisk;
          actionExpectedWealthValues[actionIndex] = actionExpectedWealth;

          if (isBetterDynamicAction(objective, actionDepletionRisk, actionExpectedWealth, bestDepletionRisk, bestExpectedWealth)) {
            bestDepletionRisk = actionDepletionRisk;
            bestExpectedWealth = actionExpectedWealth;
            bestAction = action;
          }
        });

        currentValues[bucketIndex] = bestDepletionRisk;
        currentExpectedWealth[bucketIndex] = bestExpectedWealth;
        currentActionValues[bucketIndex] = actionValues;
        currentActionExpectedWealth[bucketIndex] = actionExpectedWealthValues;
        currentPolicy[bucketIndex] = bestAction;
      }

      valueByYear[yearIndex] = currentValues;
      expectedWealthByYear[yearIndex] = currentExpectedWealth;
      actionValueByYear[yearIndex] = currentActionValues;
      actionExpectedWealthByYear[yearIndex] = currentActionExpectedWealth;
      policyByYear[yearIndex] = currentPolicy;
      nextValues = currentValues;
      nextExpectedWealth = currentExpectedWealth;
      await onPolicyYearComplete(yearIndex);
    }

    return {
      objective,
      actions: policyActions,
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
    const action = policy.policyByYear[0]?.[bucketIndex] || null;
    return {
      label,
      riskPenalty,
      isMinRisk,
      depletionRisk: policy.valueByYear[0]?.[bucketIndex] ?? null,
      expectedTerminalWealth: policy.expectedWealthByYear[0]?.[bucketIndex] ?? null,
      currentBeta: action?.beta ?? null,
      currentHedgeCoverage: action?.hedgeCoverage ?? null
    };
  }


  function addFrontierPoint(frontier, point) {
    if (!Number.isFinite(point.depletionRisk) || !Number.isFinite(point.expectedTerminalWealth)) return;
    const duplicate = frontier.some((existing) => (
      Math.abs(existing.depletionRisk - point.depletionRisk) <= 0.00005 &&
      Math.abs(existing.expectedTerminalWealth - point.expectedTerminalWealth) <= 1 &&
      Math.abs((existing.currentBeta ?? 0) - (point.currentBeta ?? 0)) <= Planner.EPSILON &&
      Math.abs((existing.currentHedgeCoverage ?? 0) - (point.currentHedgeCoverage ?? 0)) <= Planner.EPSILON
    ));
    if (!duplicate) frontier.push(point);
  }


  function buildDynamicWealthBuckets(scenario) {
    const wealthCap = Math.max(Planner.DYNAMIC_MAX_WEALTH_BUCKET, scenario.netWorth);
    const buckets = [0];
    const minPositiveWealth = Planner.DYNAMIC_MIN_POSITIVE_WEALTH_BUCKET;
    const logMax = Math.log(wealthCap);

    for (let index = 0; index < Planner.DYNAMIC_WEALTH_BUCKETS; index += 1) {
      const t = index / Math.max(1, Planner.DYNAMIC_WEALTH_BUCKETS - 1);
      buckets.push(minPositiveWealth * Math.exp(t * (logMax - Math.log(minPositiveWealth))));
    }

    return buckets;
  }


  function selectDynamicAction(policy, scenario, yearIndex, wealth) {
    if (!policy) {
      return {
        beta: scenario.spxBeta,
        hedgeCoverage: scenario.hedgeEnabled ? 0 : 0
      };
    }
    const policyRow = policy.policyByYear[yearIndex];
    const action = policyRow?.[nearestBucketIndex(policy.wealthBuckets, wealth)];
    if (action && Number.isFinite(action.beta)) {
      return {
        beta: action.beta,
        hedgeCoverage: Number.isFinite(action.hedgeCoverage) ? action.hedgeCoverage : 0
      };
    }
    return {
      beta: policy.betaValues?.[0] ?? scenario.spxBeta,
      hedgeCoverage: 0
    };
  }


  function selectDynamicBeta(policy, yearIndex, wealth) {
    if (!policy) return Planner.DYNAMIC_BETA_VALUES[0];
    const policyRow = policy.policyByYear[yearIndex];
    const action = policyRow?.[nearestBucketIndex(policy.wealthBuckets, wealth)];
    if (action && Number.isFinite(action.beta)) return action.beta;
    if (Number.isFinite(action)) return action;
    return policy.betaValues?.[0] ?? Planner.DYNAMIC_BETA_VALUES[0];
  }


  function selectDynamicHedgeCoverage(policy, yearIndex, wealth) {
    if (!policy) return 0;
    const policyRow = policy.policyByYear[yearIndex];
    const action = policyRow?.[nearestBucketIndex(policy.wealthBuckets, wealth)];
    return Number.isFinite(action?.hedgeCoverage) ? action.hedgeCoverage : 0;
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
    buildDynamicBetaFrontier,
    getWorstSurvivingPath,
    applyContinuousYear,
    wealthAtTime,
    addReservoirSample,
    buildAnnualSampledReturn,
    buildReturnMetrics,
    scenarioNeedsPolicy,
    getPolicyBetaValues,
    getPolicyHedgeCoverageValues,
    buildPolicyActions,
    buildDynamicBetaPolicy,
    buildDynamicWealthBuckets,
    selectDynamicAction,
    selectDynamicBeta,
    selectDynamicHedgeCoverage,
    interpolateBucketValue,
    nearestBucketIndex,
    upperBucketIndex,
    cashFlowForYear,
    buildDepletedDistribution,
    compareInspectionPaths,
    depletionSortYear
  });
})(window.Planner = window.Planner || {});
