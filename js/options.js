(function (Planner) {
  function normalCdf(value) {
    if (!Number.isFinite(value)) return value > 0 ? 1 : 0;
    const sign = value < 0 ? -1 : 1;
    const absValue = Math.abs(value) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * absValue);
    const poly = (((((1.061405429 * t) - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592;
    const erfApprox = 1 - poly * t * Math.exp(-absValue * absValue);
    return 0.5 * (1 + sign * erfApprox);
  }


  function continuousRateFromSimpleReturn(simpleReturn) {
    const growth = Math.max(Planner.EPSILON, 1 + (Number.isFinite(simpleReturn) ? simpleReturn : 0));
    return Math.log(growth);
  }


  function blackScholesPutPrice({ spot = 1, strike, rate, volatility, years = 1 }) {
    const safeSpot = Math.max(Planner.EPSILON, spot);
    const safeStrike = Math.max(Planner.EPSILON, strike);
    const safeYears = Math.max(Planner.EPSILON, years);
    const safeVol = Math.max(Planner.EPSILON, volatility);
    const sqrtT = Math.sqrt(safeYears);
    const d1 = (Math.log(safeSpot / safeStrike) + (rate + 0.5 * safeVol * safeVol) * safeYears) / (safeVol * sqrtT);
    const d2 = d1 - safeVol * sqrtT;
    return Math.max(0, safeStrike * Math.exp(-rate * safeYears) * normalCdf(-d2) - safeSpot * normalCdf(-d1));
  }


  function europeanPutPayoff({ spot = 1, strike, terminalSpot }) {
    return Math.max(0, strike - terminalSpot);
  }


  function resolveImpliedVolatility(returnRow, impliedVolByYear, fallbackImpliedVol) {
    const year = returnRow?.year;
    if (Number.isFinite(year) && impliedVolByYear && Number.isFinite(impliedVolByYear.get(year))) {
      return {
        impliedVol: impliedVolByYear.get(year),
        impliedVolSource: "vix",
        usedFallbackImpliedVol: false
      };
    }
    return {
      impliedVol: fallbackImpliedVol,
      impliedVolSource: "fallback",
      usedFallbackImpliedVol: true
    };
  }


  function strikeVolatilityFromAtm({
    atmVolatility,
    strikeRatio,
    forwardRatio,
    years = 1,
    skewSlope = Planner.PUT_SKEW_SLOPE,
    skewCurvature = Planner.PUT_SKEW_CURVATURE
  }) {
    const safeAtm = Math.max(Planner.EPSILON, atmVolatility);
    const safeStrike = Math.max(Planner.EPSILON, strikeRatio);
    const safeForward = Math.max(Planner.EPSILON, forwardRatio);
    const safeYears = Math.max(Planner.EPSILON, years);
    const rawXi = Math.log(safeStrike / safeForward) / (safeAtm * Math.sqrt(safeYears));
    const xi = Math.max(Planner.PUT_SKEW_XI_MIN, Math.min(Planner.PUT_SKEW_XI_MAX, rawXi));
    const strikeVol = safeAtm * (1 + skewSlope * xi + skewCurvature * xi * xi);
    return {
      moneynessXi: xi,
      rawMoneynessXi: rawXi,
      strikeVolatility: Math.max(Planner.MIN_PUT_STRIKE_VOLATILITY, Math.min(Planner.MAX_PUT_STRIKE_VOLATILITY, strikeVol))
    };
  }


  function buildPutContractMetrics({
    returnRow,
    strikeRatio,
    impliedVolByYear,
    fallbackImpliedVol
  }) {
    const riskFreeReturn = returnRow.riskFreeReturn ?? 0;
    const inflation = returnRow.inflation ?? 0;
    const nominalSpxReturn = returnRow.nominalReturn ?? returnRow.return ?? 0;
    const rate = continuousRateFromSimpleReturn(riskFreeReturn);
    const forwardRatio = Math.exp(rate);
    const volLookup = resolveImpliedVolatility(returnRow, impliedVolByYear, fallbackImpliedVol);
    const skew = strikeVolatilityFromAtm({
      atmVolatility: volLookup.impliedVol,
      strikeRatio,
      forwardRatio,
      years: 1
    });
    const premiumPerUnit = blackScholesPutPrice({
      spot: 1,
      strike: strikeRatio,
      rate,
      volatility: skew.strikeVolatility,
      years: 1
    });
    const payoffPerUnit = europeanPutPayoff({
      spot: 1,
      strike: strikeRatio,
      terminalSpot: Math.max(0, 1 + nominalSpxReturn)
    });
    return {
      impliedVol: volLookup.impliedVol,
      impliedVolSource: volLookup.impliedVolSource,
      usedFallbackImpliedVol: volLookup.usedFallbackImpliedVol,
      strikeRatio,
      forwardRatio,
      moneynessXi: skew.moneynessXi,
      strikeVolatility: skew.strikeVolatility,
      premiumPerUnit,
      payoffPerUnit,
      inflation,
      riskFreeReturn,
      nominalSpxReturn
    };
  }


  function putNotionalForAction(startingWealth, beta, hedgeCoverage) {
    return Math.max(0, hedgeCoverage) * Math.max(0, beta) * Math.max(0, startingWealth);
  }


  function applyHedgedYear({
    startingWealth,
    netCashFlow,
    returnMetrics,
    putContract,
    beta,
    hedgeCoverage
  }) {
    const putNotional = putNotionalForAction(startingWealth, beta, hedgeCoverage);
    const putPremium = putNotional * (putContract?.premiumPerUnit || 0);
    if (putPremium > startingWealth + Planner.EPSILON) {
      return {
        startingWealth,
        investableWealth: 0,
        endingWealthBeforePayoff: 0,
        endingWealth: 0,
        depleted: true,
        putNotional,
        putPremium,
        putPayoffNominal: 0,
        putPayoffReal: 0,
        hedgeCoverageUsed: hedgeCoverage,
        rejectedForPremium: true
      };
    }

    const investableWealth = Math.max(0, startingWealth - putPremium);
    const yearResult = Planner.applyContinuousYear(investableWealth, netCashFlow, returnMetrics.realGrowthFactor);
    const inflationFactor = Math.max(Planner.EPSILON, 1 + (returnMetrics.inflation ?? putContract?.inflation ?? 0));
    const putPayoffNominal = putNotional * (putContract?.payoffPerUnit || 0);
    const putPayoffReal = putPayoffNominal / inflationFactor;
    const endingWealth = Math.max(0, yearResult.endingWealth + putPayoffReal);
    return {
      startingWealth,
      investableWealth,
      endingWealthBeforePayoff: yearResult.endingWealth,
      endingWealth,
      depleted: endingWealth <= 0,
      putNotional,
      putPremium,
      putPayoffNominal,
      putPayoffReal,
      hedgeCoverageUsed: hedgeCoverage,
      rejectedForPremium: false
    };
  }


  function emptyHedgeYearFields() {
    return {
      hedgeCoverageUsed: "",
      putNotional: "",
      putPremium: "",
      putPayoffReal: "",
      putImpliedVol: "",
      putStrikeVolatility: "",
      putImpliedVolSource: "",
      usedFallbackImpliedVol: ""
    };
  }


  Object.assign(Planner, {
    normalCdf,
    continuousRateFromSimpleReturn,
    blackScholesPutPrice,
    europeanPutPayoff,
    resolveImpliedVolatility,
    strikeVolatilityFromAtm,
    buildPutContractMetrics,
    putNotionalForAction,
    applyHedgedYear,
    emptyHedgeYearFields
  });
})(window.Planner = window.Planner || {});
