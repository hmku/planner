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
  // Math.exp, plus each row's deflator (1 / (1 + inflation)), which keeps a
  // nominal cost basis in today's dollars.
  function createGrowthFactors(returnRows, beta) {
    const growth = new Float64Array(returnRows.length);
    const cashFactor = new Float64Array(returnRows.length);
    const deflator = new Float64Array(returnRows.length);
    returnRows.forEach((row, index) => {
      const metrics = buildReturnMetrics(row, beta);
      const factors = growthFactorsOf(metrics.realGrowthFactor);
      growth[index] = factors.growth;
      cashFactor[index] = factors.cashFactor;
      deflator[index] = deflatorOf(metrics.inflation);
    });
    return { growth, cashFactor, deflator };
  }

  function deflatorOf(inflation) {
    return 1 / Math.max(MIN_GROWTH_FACTOR, 1 + (inflation ?? 0));
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

  // Tax on withdrawals applies to gains only. Each path tracks its portfolio's
  // cost basis (average cost, in today's dollars): your starting net worth,
  // saved income, and home sale proceeds are all basis. When a fraction g of
  // the portfolio is gain, covering a shortfall S at gains tax rate t takes
  // S / (1 - t g) of withdrawals; this is the tax part. A portfolio below its
  // basis has g = 0: losses are never taxed (nor credited).
  function withdrawalTaxFor(shortfall, rate, gainFraction) {
    const effective = rate * gainFraction;
    return shortfall > 0 && effective > 0 ? shortfall * effective / (1 - effective) : 0;
  }

  function gainFractionOf(wealth, basis) {
    return wealth > 0 && basis < wealth ? 1 - Math.max(0, basis) / wealth : 0;
  }

  // One year's cash flows before the withdrawal tax (which depends on the
  // path's gains). net < 0 is the shortfall the portfolio covers. After a home
  // sale, its ownership costs stop and rent at its rent-equivalent starts.
  function cashFlowsForYear(scenario, year, { homeSold = false, rent = 0 } = {}) {
    const income = Planner.flowsTotalForYear(scenario.income, year);
    const expenseFlows = homeSold ? scenario.expenses.filter((flow) => !flow.homeCost) : scenario.expenses;
    const expenses = Planner.flowsTotalForYear(expenseFlows, year) + rent;
    return { income, expenses, net: income - expenses };
  }

  // Every engine path's cash flows by plan year: as entered (owned), after
  // selling an owned home (sold), net amounts (before tax) for hot loops, what
  // a sale would raise (value less selling costs and mortgage), the home
  // equity counted in net worth, and the tax rate on gains. Without a home,
  // sold is the same as owned and nothing sells.
  function buildPlanCashFlows(scenario, years) {
    const owned = years.map((year) => cashFlowsForYear(scenario, year));
    const netOf = (flows) => Float64Array.from(flows, (flow) => flow.net);
    const home = scenario.home;
    const taxRate = scenario.withdrawalTaxRate || 0;
    if (!home) {
      const none = new Float64Array(years.length);
      const ownedNet = netOf(owned);
      return { owned, sold: owned, ownedNet, soldNet: ownedNet, saleProceeds: none, equity: none, hasHome: false, taxRate };
    }
    const sold = years.map((year, index) => cashFlowsForYear(scenario, year, { homeSold: true, rent: home.values[index] * home.rentYield }));
    return {
      owned,
      sold,
      ownedNet: netOf(owned),
      soldNet: netOf(sold),
      saleProceeds: Float64Array.from(years, (_, index) => Math.max(0, home.values[index] * (1 - home.sellingCost) - home.balances[index])),
      equity: Float64Array.from(years, (_, index) => Math.max(0, home.values[index] - home.balances[index])),
      hasHome: true,
      taxRate
    };
  }

  // The year's withdrawal tax for a path starting the year at wealth with this
  // basis, given the year's pre-tax net cash flow.
  function yearTaxOf(net, rate, wealth, basis) {
    return net < 0 && rate > 0 ? withdrawalTaxFor(-net, rate, gainFractionOf(wealth, basis)) : 0;
  }

  // Next year's basis: withdrawals take their share of the basis (average
  // cost), saved income adds to it, and inflation shrinks it in today's
  // dollars.
  function nextBasisOf(net, tax, wealth, basis, deflator) {
    const withdrawn = net < 0 ? tax - net : 0;
    const kept = wealth > 0 ? Math.max(0, 1 - withdrawn / wealth) : 0;
    return (basis * kept + Math.max(0, net)) * deflator;
  }

  // One year of one path; state is { wealth, basis, sold }. If the portfolio
  // would run out and the home is still owned, the home is sold at the start
  // of the year (once; the proceeds are basis) and the year is replayed on the
  // sold cash flows. Returns the ending portfolio (<= 0 means depleted) and
  // sets state.soldThisYear, state.withdrawalTax, and the next state.basis.
  // The policy solver applies the same rule to its "owned" layer.
  function stepPathYear(cash, state, yearIndex, growth, cashFactor, deflator = 1) {
    const rate = cash.taxRate;
    let net = (state.sold ? cash.soldNet : cash.ownedNet)[yearIndex];
    let tax = rate > 0 ? yearTaxOf(net, rate, state.wealth, state.basis) : 0;
    let ending = state.wealth * growth + (net - tax) * cashFactor;
    state.soldThisYear = false;
    if (ending <= 0 && !state.sold && cash.saleProceeds[yearIndex] > 0) {
      state.wealth += cash.saleProceeds[yearIndex];
      if (rate > 0) state.basis += cash.saleProceeds[yearIndex];
      state.sold = true;
      state.soldThisYear = true;
      net = cash.soldNet[yearIndex];
      tax = rate > 0 ? yearTaxOf(net, rate, state.wealth, state.basis) : 0;
      ending = state.wealth * growth + (net - tax) * cashFactor;
    }
    state.withdrawalTax = tax;
    if (rate > 0) state.basis = nextBasisOf(net, tax, state.wealth, state.basis, deflator);
    return ending;
  }

  // The policy solver's wealth buckets carry no basis, so it uses a reference
  // basis by year: the plan's basis on a path that earns the average
  // historical return and inflation every year at the given beta. A node's
  // gains are its wealth above that basis. Returns null without a tax.
  function buildReferenceBasis(scenario, returnRows, years, cash, beta) {
    if (!(cash.taxRate > 0)) return null;
    const average = (getValue) => returnRows.reduce((sum, row) => sum + (getValue(row) ?? 0), 0) / returnRows.length;
    const metrics = buildReturnMetrics({
      nominalReturn: average(nominalSpxReturnOf),
      riskFreeReturn: average((row) => row.riskFreeReturn),
      inflation: average((row) => row.inflation)
    }, beta);
    const { growth, cashFactor } = growthFactorsOf(metrics.realGrowthFactor);
    const deflator = deflatorOf(metrics.inflation);
    const basis = new Float64Array(years.length);
    const state = { wealth: scenario.netWorth, basis: scenario.netWorth, sold: false };
    for (let yearIndex = 0; yearIndex < years.length; yearIndex += 1) {
      basis[yearIndex] = state.basis;
      if (state.wealth <= 0) continue;
      state.wealth = Math.max(0, stepPathYear(cash, state, yearIndex, growth, cashFactor, deflator));
    }
    return basis;
  }

  // The solver's net cash flow (after tax) for a node: year, wealth, and
  // layer, with the reference basis (plus sale proceeds right after a sale).
  function solverNetOf(cash, referenceBasis, yearIndex, wealth, sold, saleProceeds = 0) {
    const net = (sold ? cash.soldNet : cash.ownedNet)[yearIndex];
    if (!referenceBasis) return net;
    return net - yearTaxOf(net, cash.taxRate, wealth, referenceBasis[yearIndex] + saleProceeds);
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
    gainFractionOf,
    deflatorOf,
    cashFlowsForYear,
    buildPlanCashFlows,
    stepPathYear,
    buildReferenceBasis,
    solverNetOf,
    buildWealthBuckets,
    upperBucketIndex,
    nearestBucketIndex,
    interpolateBucketValue
  });
})(window.Planner = window.Planner || {});
