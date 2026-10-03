(function (Planner) {
  // Dynamic-beta policy: backward induction over (plan year, portfolio wealth
  // bucket), choosing an SPX beta per node. With an owned home the policy has
  // two layers: "sold" (the home is gone, rent is paid) and "owned", where a
  // year that would drain the portfolio instead sells the home and continues in
  // the sold layer, the same rule stepPathYear() applies to simulated paths.
  // So the policy knows the home backs the portfolio and can take more risk.

  // Solves one layer for several objectives in one sweep. For each node and
  // beta, every historical row's ending wealth and bucket interpolation is
  // computed once and pooled into the few buckets it lands in; each objective
  // then sums its own next-year risk and expected terminal wealth over those.
  // fallback ({ saleProceeds, soldNet, soldLayers }) routes draining rows into
  // the sold layer; terminalExtra (home equity at the end) is added to the
  // terminal wealth of every bucket.
  async function solvePolicyLayer({
    returnRows,
    years,
    wealthBuckets,
    objectives,
    net,
    terminalExtra = 0,
    fallback = null,
    shouldCancel,
    onYearComplete
  }) {
    const betaValues = Planner.DYNAMIC_BETA_VALUES;
    const betaCount = betaValues.length;
    const objectiveCount = objectives.length;
    const bucketCount = wealthBuckets.length;
    const lastBucket = bucketCount - 1;
    const topWealth = wealthBuckets[lastBucket];
    const rowCount = returnRows.length;
    const factorsFor = Planner.createGrowthFactorCache(returnRows);
    const factorsByBeta = betaValues.map(factorsFor);

    const policies = objectives.map((objective) => {
      const valueByYear = new Array(years.length + 1);
      const expectedWealthByYear = new Array(years.length + 1);
      valueByYear[years.length] = new Float64Array(bucketCount);
      expectedWealthByYear[years.length] = Float64Array.from(wealthBuckets, (wealth) => wealth + terminalExtra);
      return {
        objective,
        valueByYear,
        expectedWealthByYear,
        policyByYear: new Array(years.length)
      };
    });

    // Per-beta scratch: rows that stay in this layer and rows that move to the
    // sold layer each pool their interpolation weights by bucket. A zero
    // weight always means untouched, so zero weights are never added.
    const weights = new Float64Array(bucketCount);
    const touched = new Int32Array(bucketCount);
    const soldWeights = new Float64Array(bucketCount);
    const soldTouched = new Int32Array(bucketCount);
    const { upperBucketIndex } = Planner; // a local reference keeps the hot loop fast
    const poolWeight = (bucketWeights, touchedBuckets, touchedCount, wealth) => {
      const upper = upperBucketIndex(wealthBuckets, wealth);
      const lower = upper - 1;
      const t = (wealth - wealthBuckets[lower]) / (wealthBuckets[upper] - wealthBuckets[lower]);
      if (t < 1) {
        if (bucketWeights[lower] === 0) touchedBuckets[touchedCount++] = lower;
        bucketWeights[lower] += 1 - t;
      }
      if (t > 0) {
        if (bucketWeights[upper] === 0) touchedBuckets[touchedCount++] = upper;
        bucketWeights[upper] += t;
      }
      return touchedCount;
    };
    const bestRisk = new Float64Array(objectiveCount);
    const bestWealth = new Float64Array(objectiveCount);
    const bestBeta = new Float64Array(objectiveCount);

    for (let yearIndex = years.length - 1; yearIndex >= 0; yearIndex -= 1) {
      Planner.throwIfCanceled(shouldCancel);
      const netCashFlow = net[yearIndex];
      const saleProceeds = fallback ? fallback.saleProceeds[yearIndex] : 0;
      const soldNetCashFlow = fallback ? fallback.soldNet[yearIndex] : 0;
      const nextValues = policies.map((policy) => policy.valueByYear[yearIndex + 1]);
      const nextWealth = policies.map((policy) => policy.expectedWealthByYear[yearIndex + 1]);
      const soldValues = fallback ? fallback.soldLayers.map((layer) => layer.valueByYear[yearIndex + 1]) : null;
      const soldWealth = fallback ? fallback.soldLayers.map((layer) => layer.expectedWealthByYear[yearIndex + 1]) : null;
      const currentValues = objectives.map(() => new Float64Array(bucketCount));
      const currentWealth = objectives.map(() => new Float64Array(bucketCount));
      const currentPolicy = objectives.map(() => new Float64Array(bucketCount));

      for (let bucketIndex = 0; bucketIndex < bucketCount; bucketIndex += 1) {
        const startingWealth = wealthBuckets[bucketIndex];
        if (startingWealth <= 0) {
          for (let k = 0; k < objectiveCount; k += 1) {
            currentValues[k][bucketIndex] = 1;
            currentWealth[k][bucketIndex] = 0;
            currentPolicy[k][bucketIndex] = 0;
          }
          continue;
        }

        bestRisk.fill(Number.POSITIVE_INFINITY);
        bestWealth.fill(Number.NEGATIVE_INFINITY);
        bestBeta.fill(betaValues[0]);

        for (let betaIndex = 0; betaIndex < betaCount; betaIndex += 1) {
          const { growth, cashFactor } = factorsByBeta[betaIndex];
          let depletedCount = 0;
          let topCount = 0;
          let touchedCount = 0;
          let soldTopCount = 0;
          let soldTouchedCount = 0;
          for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
            const endingWealth = startingWealth * growth[rowIndex] + netCashFlow * cashFactor[rowIndex];
            if (endingWealth > 0) {
              if (endingWealth >= topWealth) topCount += 1;
              else touchedCount = poolWeight(weights, touched, touchedCount, endingWealth);
            } else if (saleProceeds > 0) {
              // Sell the home and replay the year on the sold cash flows.
              const afterSale = (startingWealth + saleProceeds) * growth[rowIndex] + soldNetCashFlow * cashFactor[rowIndex];
              if (afterSale <= 0) depletedCount += 1;
              else if (afterSale >= topWealth) soldTopCount += 1;
              else soldTouchedCount = poolWeight(soldWeights, soldTouched, soldTouchedCount, afterSale);
            } else {
              depletedCount += 1;
            }
          }

          for (let k = 0; k < objectiveCount; k += 1) {
            const values = nextValues[k];
            const wealth = nextWealth[k];
            let totalRisk = depletedCount + topCount * values[lastBucket];
            let totalWealth = topCount * wealth[lastBucket];
            for (let i = 0; i < touchedCount; i += 1) {
              const index = touched[i];
              totalRisk += weights[index] * values[index];
              totalWealth += weights[index] * wealth[index];
            }
            if (soldTopCount || soldTouchedCount) {
              const values2 = soldValues[k];
              const wealth2 = soldWealth[k];
              totalRisk += soldTopCount * values2[lastBucket];
              totalWealth += soldTopCount * wealth2[lastBucket];
              for (let i = 0; i < soldTouchedCount; i += 1) {
                const index = soldTouched[i];
                totalRisk += soldWeights[index] * values2[index];
                totalWealth += soldWeights[index] * wealth2[index];
              }
            }
            const risk = totalRisk / rowCount;
            const expectedWealth = totalWealth / rowCount;
            if (isBetterAction(objectives[k], risk, expectedWealth, bestRisk[k], bestWealth[k])) {
              bestRisk[k] = risk;
              bestWealth[k] = expectedWealth;
              bestBeta[k] = betaValues[betaIndex];
            }
          }
          for (let i = 0; i < touchedCount; i += 1) weights[touched[i]] = 0;
          for (let i = 0; i < soldTouchedCount; i += 1) soldWeights[soldTouched[i]] = 0;
        }

        for (let k = 0; k < objectiveCount; k += 1) {
          currentValues[k][bucketIndex] = bestRisk[k];
          currentWealth[k][bucketIndex] = bestWealth[k];
          currentPolicy[k][bucketIndex] = bestBeta[k];
        }
      }

      policies.forEach((policy, k) => {
        policy.valueByYear[yearIndex] = currentValues[k];
        policy.expectedWealthByYear[yearIndex] = currentWealth[k];
        policy.policyByYear[yearIndex] = currentPolicy[k];
      });
      await onYearComplete(yearIndex);
    }

    return policies;
  }


  // Lower risk wins; near-ties go to higher expected wealth. Risk-penalty
  // objectives compare wealth minus penalty * risk first.
  function isBetterAction(objective, risk, wealth, bestRisk, bestWealth) {
    if (!Number.isFinite(bestRisk) || !Number.isFinite(bestWealth)) return true;
    if (objective.type === "riskPenalty") {
      const score = wealth - objective.riskPenalty * risk;
      const bestScore = bestWealth - objective.riskPenalty * bestRisk;
      if (Math.abs(score - bestScore) > Planner.EPSILON) return score > bestScore;
    }
    if (Math.abs(risk - bestRisk) > Planner.EPSILON) return risk < bestRisk;
    return wealth > bestWealth + Planner.EPSILON;
  }


  // Solves the candidate policies in two sweeps: min-risk and
  // max-expected-wealth together (which calibrates the risk-penalty scale),
  // then every risk-penalty policy. Each sweep solves the sold layer first when
  // there is a home. Returns the candidates as frontier points carrying their
  // policy tables; simulateScenario() simulates them, picks the one the run
  // uses, and drops the tables of the rest.
  async function buildDynamicBetaPolicy(scenario, returnRows, years, onProgress, shouldCancel) {
    const wealthBuckets = Planner.buildWealthBuckets(scenario);
    const cash = Planner.buildPlanCashFlows(scenario, years);
    const penaltyFactors = Planner.DYNAMIC_FRONTIER_RISK_PENALTY_FACTORS;
    const layers = cash.hasHome ? 2 : 1;
    // Progress weights approximate sweep cost: shared transitions plus per-objective work.
    const sweepWeight = (objectiveCount) => (2 + objectiveCount) * layers;
    const totalWeight = (sweepWeight(2) + sweepWeight(penaltyFactors.length)) * years.length;
    let completedWeight = 0;

    const solveSweep = async (objectives) => {
      const weight = sweepWeight(objectives.length) / layers;
      const common = {
        returnRows,
        years,
        wealthBuckets,
        objectives,
        shouldCancel,
        onYearComplete: async (yearIndex) => {
          completedWeight += weight;
          onProgress((completedWeight / totalWeight) * Planner.DYNAMIC_POLICY_PROGRESS_SHARE);
          if (yearIndex % 4 === 0) await Planner.yieldToBrowser();
        }
      };
      if (!cash.hasHome) return solvePolicyLayer({ ...common, net: cash.ownedNet });
      const soldLayers = await solvePolicyLayer({ ...common, net: cash.soldNet });
      const ownedLayers = await solvePolicyLayer({
        ...common,
        net: cash.ownedNet,
        terminalExtra: cash.equity[years.length - 1],
        fallback: { saleProceeds: cash.saleProceeds, soldNet: cash.soldNet, soldLayers }
      });
      return ownedLayers.map((policy, k) => ({ ...policy, sold: soldLayers[k] }));
    };

    const [minRiskPolicy, maxWealthPolicy] = await solveSweep([
      { type: "minRisk", label: "Minimum run-out risk" },
      { type: "riskPenalty", riskPenalty: 0, label: "Maximum expected wealth" }
    ]);
    const minRiskPoint = buildFrontierPoint(minRiskPolicy, scenario, wealthBuckets, true);
    const maxWealthPoint = buildFrontierPoint(maxWealthPolicy, scenario, wealthBuckets, false);
    const riskPenaltyScale = calibrateRiskPenaltyScale(minRiskPoint, maxWealthPoint, scenario);

    const penaltyPolicies = await solveSweep(penaltyFactors.map((factor) => {
      const riskPenalty = factor * riskPenaltyScale;
      return { type: "riskPenalty", riskPenalty, label: `Risk penalty ${Planner.formatCompactCurrency(riskPenalty)}` };
    }));

    const candidates = [minRiskPoint];
    addFrontierPoint(candidates, maxWealthPoint);
    penaltyPolicies.forEach((policy) => addFrontierPoint(candidates, buildFrontierPoint(policy, scenario, wealthBuckets, false)));
    return { betaValues: Planner.DYNAMIC_BETA_VALUES, wealthBuckets, candidates };
  }


  function calibrateRiskPenaltyScale(minRiskPoint, maxWealthPoint, scenario) {
    const riskRange = Math.abs((maxWealthPoint.depletionRisk || 0) - (minRiskPoint.depletionRisk || 0));
    const wealthRange = Math.abs((maxWealthPoint.expectedTerminalWealth || 0) - (minRiskPoint.expectedTerminalWealth || 0));
    if (riskRange > Planner.EPSILON && wealthRange > 1) {
      return wealthRange / riskRange;
    }
    return Math.max(1000000, scenario.netWorth || 0, maxWealthPoint.expectedTerminalWealth || 0);
  }


  // A frontier point with the solver's estimates at your net worth (replaced by
  // simulated values later) and the policy's tables: beta, run-out risk, and
  // expected terminal wealth by year and bucket, plus the same for life after
  // a home sale (sold) when there is a home.
  function buildFrontierPoint(policy, scenario, wealthBuckets, isMinRisk) {
    const bucketIndex = Planner.nearestBucketIndex(wealthBuckets, scenario.netWorth);
    const tablesOf = (layer) => ({
      policyByYear: layer.policyByYear,
      valueByYear: layer.valueByYear,
      expectedWealthByYear: layer.expectedWealthByYear
    });
    return {
      label: policy.objective.label,
      riskPenalty: policy.objective.riskPenalty ?? null,
      isMinRisk,
      depletionRisk: policy.valueByYear[0]?.[bucketIndex] ?? null,
      expectedTerminalWealth: policy.expectedWealthByYear[0]?.[bucketIndex] ?? null,
      currentBeta: policy.policyByYear[0]?.[bucketIndex] ?? null,
      policy: { wealthBuckets, ...tablesOf(policy), sold: policy.sold ? tablesOf(policy.sold) : null }
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


  // The policy's beta for a year and portfolio wealth, from the sold layer once
  // the home has been sold.
  function selectDynamicBeta(policy, yearIndex, wealth, sold = false) {
    const policyRow = (sold && policy.sold ? policy.sold : policy).policyByYear[yearIndex];
    if (!policyRow) return Planner.DYNAMIC_BETA_VALUES[0];
    return policyRow[Planner.nearestBucketIndex(policy.wealthBuckets, wealth)] ?? Planner.DYNAMIC_BETA_VALUES[0];
  }

  // Per-beta run-out risk and expected terminal wealth at one node of a
  // policy, for the Beta Policy tab and policy CSV. Same arithmetic as the
  // solver (linear interpolation into next year's tables, home sale fallback),
  // computed on demand so the solver keeps no per-beta tables.
  function createActionEvaluator(policy, scenario, returnRows, years) {
    const cash = Planner.buildPlanCashFlows(scenario, years);
    const factorsFor = Planner.createGrowthFactorCache(returnRows);
    const { wealthBuckets } = policy;
    const { upperBucketIndex } = Planner;
    const lastBucket = wealthBuckets.length - 1;
    const rowCount = returnRows.length;
    // interpolateBucketValue() for both tables with one bucket search.
    let risk = 0;
    let wealth = 0;
    const addNextYear = (values, wealths, ending) => {
      if (ending >= wealthBuckets[lastBucket]) {
        risk += values[lastBucket];
        wealth += wealths[lastBucket];
        return;
      }
      const upper = upperBucketIndex(wealthBuckets, ending);
      const lower = upper - 1;
      const t = (ending - wealthBuckets[lower]) / (wealthBuckets[upper] - wealthBuckets[lower]);
      risk += values[lower] + (values[upper] - values[lower]) * t;
      wealth += wealths[lower] + (wealths[upper] - wealths[lower]) * t;
    };
    return (yearIndex, startingWealth) => Planner.DYNAMIC_BETA_VALUES.map((beta) => {
      if (startingWealth <= 0) return { beta, risk: 1, expectedWealth: 0 };
      const { growth, cashFactor } = factorsFor(beta);
      risk = 0;
      wealth = 0;
      for (let row = 0; row < rowCount; row += 1) {
        let tables = policy;
        let ending = startingWealth * growth[row] + cash.ownedNet[yearIndex] * cashFactor[row];
        if (ending <= 0 && policy.sold && cash.saleProceeds[yearIndex] > 0) {
          tables = policy.sold;
          ending = (startingWealth + cash.saleProceeds[yearIndex]) * growth[row] + cash.soldNet[yearIndex] * cashFactor[row];
        }
        if (ending <= 0) {
          risk += 1;
          continue;
        }
        addNextYear(tables.valueByYear[yearIndex + 1], tables.expectedWealthByYear[yearIndex + 1], ending);
      }
      return { beta, risk: risk / rowCount, expectedWealth: wealth / rowCount };
    });
  }

  Object.assign(Planner, {
    buildDynamicBetaPolicy,
    selectDynamicBeta,
    createActionEvaluator
  });
})(window.Planner = window.Planner || {});
