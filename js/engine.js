(function (Planner) {
  // Engine core shared by the policy solver (policy.js) and the simulation
  // (simulation.js), on the page and in the worker: return math, cash flows,
  // the one-year path step (including selling an owned home), and the wealth
  // bucket grid.

  const MIN_GROWTH_FACTOR = 0.000001;

  // ---------- Cancellation ----------

  function isCancellationError(error) {
    return error && error.name === "SimulationCanceledError";
  }

  function createCancellationError() {
    const error = new Error("Simulation canceled.");
    error.name = "SimulationCanceledError";
    return error;
  }

  function throwIfCanceled(shouldCancel) {
    if (shouldCancel()) throw createCancellationError();
  }

  // ---------- Returns ----------

  function nominalSpxReturnOf(returnRow) {
    return returnRow.nominalReturn ?? returnRow.return;
  }

  // Portfolio return for one historical year at an SPX beta: T-bills plus beta
  // times the S&P 500's excess return, converted to real terms.
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

  // One year with continuous compounding and a continuous cash flow, as two
  // factors: ending = start * growth + netCashFlow * cashFactor. The ending
  // may be negative; callers treat <= 0 as depletion.
  function growthFactorsOf(realGrowthFactor) {
    const logReturn = Math.log(realGrowthFactor);
    if (Math.abs(logReturn) < 0.0000001) return { growth: 1, cashFactor: 1 };
    const growth = Math.exp(logReturn);
    return { growth, cashFactor: (growth - 1) / logReturn };
  }

  // growthFactorsOf() for every historical row at one beta, so hot loops skip
  // Math.exp.
  function createGrowthFactors(returnRows, beta) {
    const growth = new Float64Array(returnRows.length);
    const cashFactor = new Float64Array(returnRows.length);
    returnRows.forEach((row, index) => {
      const factors = growthFactorsOf(buildReturnMetrics(row, beta).realGrowthFactor);
      growth[index] = factors.growth;
      cashFactor[index] = factors.cashFactor;
    });
    return { growth, cashFactor };
  }

  // Growth factors by beta, computed once per beta.
  function createGrowthFactorCache(returnRows) {
    const cache = new Map();
    return (beta) => {
      if (!cache.has(beta)) cache.set(beta, createGrowthFactors(returnRows, beta));
      return cache.get(beta);
    };
  }

  // ---------- Cash flows ----------

  // Covering a shortfall S between spending and income from the portfolio at
  // tax rate t takes S / (1 - t) of withdrawals; this is the tax part.
  function withdrawalTaxFor(expenses, income, rate) {
    return rate > 0 ? Math.max(0, expenses - income) * rate / (1 - rate) : 0;
  }

  // One year's cash flows. Spending that income doesn't cover comes from the
  // portfolio, taxed per withdrawalTaxFor(). After a home sale, its ownership
  // costs stop and rent at its rent-equivalent starts.
  function cashFlowsForYear(scenario, year, { homeSold = false, rent = 0 } = {}) {
    const income = Planner.flowsTotalForYear(scenario.income, year);
    const expenseFlows = homeSold ? scenario.expenses.filter((flow) => !flow.homeCost) : scenario.expenses;
    const expenses = Planner.flowsTotalForYear(expenseFlows, year) + rent;
    const withdrawalTax = withdrawalTaxFor(expenses, income, scenario.withdrawalTaxRate || 0);
    return { income, expenses, withdrawalTax, net: income - expenses - withdrawalTax };
  }

  // Every engine path's cash flows by plan year: as entered (owned), after
  // selling an owned home (sold), net amounts for hot loops, what a sale would
  // raise (value less selling costs and mortgage), and the home equity counted
  // in net worth. Without a home, sold is the same as owned and nothing sells.
  function buildPlanCashFlows(scenario, years) {
    const owned = years.map((year) => cashFlowsForYear(scenario, year));
    const netOf = (flows) => Float64Array.from(flows, (flow) => flow.net);
    const home = scenario.home;
    if (!home) {
      const none = new Float64Array(years.length);
      const ownedNet = netOf(owned);
      return { owned, sold: owned, ownedNet, soldNet: ownedNet, saleProceeds: none, equity: none, hasHome: false };
    }
    const sold = years.map((year, index) => cashFlowsForYear(scenario, year, { homeSold: true, rent: home.values[index] * home.rentYield }));
    return {
      owned,
      sold,
      ownedNet: netOf(owned),
      soldNet: netOf(sold),
      saleProceeds: Float64Array.from(years, (_, index) => Math.max(0, home.values[index] * (1 - home.sellingCost) - home.balances[index])),
      equity: Float64Array.from(years, (_, index) => Math.max(0, home.values[index] - home.balances[index])),
      hasHome: true
    };
  }

  // One year of one path; state is { wealth, sold }. If the portfolio would
  // run out and the home is still owned, the home is sold at the start of the
  // year (once) and the year is replayed on the sold cash flows. Returns the
  // ending portfolio (<= 0 means depleted) and sets state.soldThisYear. The
  // policy solver applies the same rule to its "owned" layer.
  function stepPathYear(cash, state, yearIndex, growth, cashFactor) {
    const net = state.sold ? cash.soldNet : cash.ownedNet;
    let ending = state.wealth * growth + net[yearIndex] * cashFactor;
    state.soldThisYear = false;
    if (ending <= 0 && !state.sold && cash.saleProceeds[yearIndex] > 0) {
      state.wealth += cash.saleProceeds[yearIndex];
      state.sold = true;
      state.soldThisYear = true;
      ending = state.wealth * growth + cash.soldNet[yearIndex] * cashFactor;
    }
    return ending;
  }

  // ---------- Wealth buckets ----------

  // A zero bucket followed by log-spaced positive buckets.
  function buildWealthBuckets(scenario) {
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

  // Positive wealth below the first positive bucket maps to that bucket, never
  // to the zero (depleted) bucket.
  function nearestBucketIndex(buckets, wealth) {
    if (wealth <= buckets[0]) return 0;
    if (wealth < buckets[1]) return 1;
    if (wealth >= buckets[buckets.length - 1]) return buckets.length - 1;
    const upperIndex = upperBucketIndex(buckets, wealth);
    const lowerIndex = Math.max(0, upperIndex - 1);
    return wealth - buckets[lowerIndex] <= buckets[upperIndex] - wealth ? lowerIndex : upperIndex;
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

  Object.assign(Planner, {
    isCancellationError,
    createCancellationError,
    throwIfCanceled,
    nominalSpxReturnOf,
    buildReturnMetrics,
    growthFactorsOf,
    createGrowthFactorCache,
    withdrawalTaxFor,
    cashFlowsForYear,
    buildPlanCashFlows,
    stepPathYear,
    buildWealthBuckets,
    upperBucketIndex,
    nearestBucketIndex,
    interpolateBucketValue
  });
})(window.Planner = window.Planner || {});
