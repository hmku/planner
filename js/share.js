(function (Planner) {
  // Share payload (the `p` query parameter), sections joined by "~":
  //   seed ~ currentYear,deathYear,netWorth,spxBeta,simulationCount,betaMode ~ income ~ expenses
  // Cash flows are ";"-separated rows of name,amount,startMode,startYear,endMode,endYear,
  // where a year is only written for "fixed" modes.

  const FLOW_MODE_CODES = { current: "c", death: "d", fixed: "f" };

  function applySharedPlanFromUrl() {
    const encodedPlan = getRawQueryParam("p");
    if (!encodedPlan) return null;

    try {
      const { seed, scenario } = decodeSharePayload(encodedPlan);
      applySharedScenario(scenario);
      return { seed: Planner.normalizeSeed(seed) };
    } catch (error) {
      return { error: `Could not load the shared plan. ${error.message}` };
    }
  }


  function applySharedScenario(scenario) {
    Planner.els.currentYear.value = scenario.currentYear;
    Planner.els.deathYear.value = scenario.deathYear;
    Planner.els.netWorth.value = scenario.netWorth;
    Planner.els.betaMode.value = scenario.betaMode;
    Planner.els.spxBeta.value = scenario.spxBeta;
    Planner.els.simulationCount.value = scenario.simulationCount;
    Planner.updateBetaModeControls();

    Planner.els.incomeRows.replaceChildren();
    Planner.els.expenseRows.replaceChildren();
    scenario.income.forEach((flow) => Planner.addFlowRow(Planner.els.incomeRows, flow));
    scenario.expenses.forEach((flow) => Planner.addFlowRow(Planner.els.expenseRows, flow));
    Planner.formatAllFormattedInputs(document);
  }


  function normalizeBetaMode(mode) {
    return mode === Planner.BETA_MODE_DYNAMIC ? Planner.BETA_MODE_DYNAMIC : Planner.BETA_MODE_FIXED;
  }


  function normalizePage(page) {
    return Planner.PAGE_IDS.includes(page) ? page : "overview";
  }


  function getPageFromUrl() {
    return normalizePage(decodeQueryValue(getRawQueryParam("tab")));
  }


  async function sharePlan() {
    let seed;
    let url;
    try {
      const scenario = Planner.readScenario();
      seed = Planner.state.results && !Planner.state.isDirty && Number.isInteger(Planner.state.results.seed)
        ? Planner.state.results.seed
        : Planner.generateSimulationSeed();
      url = buildShareUrl(scenario, seed);
    } catch (error) {
      Planner.setStatus(`Fix inputs before sharing. ${error.message}`, "error");
      return;
    }

    try {
      await copyText(url);
      // The next run should use this seed so it matches what the link reproduces.
      if (Planner.state.isDirty) Planner.state.nextSimulationSeed = seed;
      setShareButtonText("Copied");
    } catch (error) {
      Planner.setStatus(`Could not copy the share link. ${error.message}`, "error");
      setShareButtonText("Copy failed");
    }
  }


  function buildShareUrl(scenario, seed) {
    const url = new URL(window.location.href);
    const parts = [`p=${encodeSharePayload(scenario, seed)}`];
    const page = normalizePage(Planner.state.activePage);
    if (page !== "overview") parts.push(`tab=${encodeURIComponent(page)}`);
    return `${url.origin}${url.pathname}?${parts.join("&")}`;
  }


  function replaceUrl(url) {
    if (window.history && typeof window.history.replaceState === "function") {
      window.history.replaceState(null, "", url);
    }
  }


  function updateShareUrl(scenario, seed) {
    replaceUrl(buildShareUrl(scenario, seed));
  }


  function updatePageUrl(page) {
    const nextPage = normalizePage(page);
    const pairs = getQueryPairs().filter((pair) => getQueryKey(pair) !== "tab");
    if (nextPage !== "overview") pairs.push(`tab=${encodeURIComponent(nextPage)}`);
    const search = pairs.length ? `?${pairs.join("&")}` : "";
    replaceUrl(`${window.location.pathname}${search}${window.location.hash}`);
  }


  function encodeSharePayload(scenario, seed) {
    const plan = [
      scenario.currentYear,
      scenario.deathYear,
      scenario.netWorth,
      Number.isFinite(scenario.spxBeta) ? scenario.spxBeta : 0,
      scenario.simulationCount
    ].map(Planner.formatShareNumber);
    plan.push(scenario.betaMode === Planner.BETA_MODE_DYNAMIC ? "d" : "f");

    return [
      Planner.formatShareNumber(seed),
      plan.join(","),
      scenario.income.map(encodeSharedFlow).join(";"),
      scenario.expenses.map(encodeSharedFlow).join(";")
    ].join("~");
  }


  function decodeSharePayload(payload) {
    const parts = payload.split("~");
    if (parts.length !== 4) {
      throw new Error("The link format is not supported.");
    }
    const plan = parts[1].split(",");
    if (plan.length < 5 || plan.length > 7) {
      throw new Error("The shared scenario is missing.");
    }
    const scenario = {
      currentYear: parseSharedNumber(plan[0], "current year"),
      deathYear: parseSharedNumber(plan[1], "death year"),
      netWorth: parseSharedNumber(plan[2], "current net worth"),
      spxBeta: parseSharedNumber(plan[3], "SPX beta"),
      simulationCount: parseSharedNumber(plan[4], "simulation count"),
      betaMode: plan[5] === "d" ? Planner.BETA_MODE_DYNAMIC : Planner.BETA_MODE_FIXED
    };
    scenario.income = decodeSharedFlows(parts[2], "income", scenario);
    scenario.expenses = decodeSharedFlows(parts[3], "expense", scenario);
    return { seed: parseSharedNumber(parts[0], "simulation seed"), scenario };
  }


  function encodeSharedFlow(flow) {
    return [
      encodeShareText(flow.name),
      Planner.formatShareNumber(flow.amount),
      FLOW_MODE_CODES[flow.startMode] || "f",
      flow.startMode === "fixed" ? Planner.formatShareNumber(flow.startYear) : "",
      FLOW_MODE_CODES[flow.endMode] || "f",
      flow.endMode === "fixed" ? Planner.formatShareNumber(flow.endYear) : ""
    ].join(",");
  }


  function decodeSharedFlows(value, type, scenario) {
    if (value === "") return [];
    return value.split(";").slice(0, Planner.MAX_SHARED_FLOWS).map((flow) => decodeSharedFlow(flow, type, scenario));
  }


  function decodeSharedFlow(value, type, scenario) {
    const flow = value.split(",");
    if (flow.length !== 6) {
      throw new Error("A shared cash flow row is invalid.");
    }
    const startMode = decodeFlowMode(flow[2]);
    const endMode = decodeFlowMode(flow[4]);
    return {
      name: decodeShareText(flow[0]).slice(0, 80),
      amount: parseSharedNumber(flow[1], `${type} amount`),
      startMode,
      startYear: startMode === "fixed" ? parseSharedNumber(flow[3], `${type} start year`) : scenario.currentYear,
      endMode,
      endYear: endMode === "fixed" ? parseSharedNumber(flow[5], `${type} end year`) : scenario.deathYear
    };
  }


  function decodeFlowMode(code) {
    const mode = Object.keys(FLOW_MODE_CODES).find((key) => FLOW_MODE_CODES[key] === code);
    if (!mode) throw new Error("A shared cash flow mode is invalid.");
    return mode;
  }


  function parseSharedNumber(value, label) {
    const number = value === "" ? Number.NaN : Number(value);
    if (!Number.isFinite(number)) {
      throw new Error(`The shared ${label} is invalid.`);
    }
    return number;
  }


  function encodeShareText(text) {
    return encodeURIComponent(text).replace(/%20/g, "+").replace(/~/g, "%7E");
  }


  function decodeShareText(encoded) {
    return decodeURIComponent(encoded.replace(/\+/g, "%20"));
  }


  function getQueryPairs() {
    return window.location.search.replace(/^\?/, "").split("&").filter(Boolean);
  }


  function getQueryKey(pair) {
    const separatorIndex = pair.indexOf("=");
    return decodeQueryValue(separatorIndex === -1 ? pair : pair.slice(0, separatorIndex));
  }


  // Returns the raw (still-encoded) value; the share payload does its own decoding.
  function getRawQueryParam(name) {
    for (const pair of getQueryPairs()) {
      if (getQueryKey(pair) !== name) continue;
      const separatorIndex = pair.indexOf("=");
      return separatorIndex === -1 ? "" : pair.slice(separatorIndex + 1);
    }
    return null;
  }


  function decodeQueryValue(value) {
    if (value === null) return null;
    try {
      return decodeURIComponent(value.replace(/\+/g, "%20"));
    } catch (error) {
      return null;
    }
  }


  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Copy failed.");
  }


  let shareButtonTimer = null;

  function setShareButtonText(text) {
    window.clearTimeout(shareButtonTimer);
    Planner.els.sharePlan.textContent = text;
    shareButtonTimer = window.setTimeout(() => {
      Planner.els.sharePlan.textContent = "Share";
    }, 1800);
  }

  Object.assign(Planner, {
    applySharedPlanFromUrl,
    normalizeBetaMode,
    normalizePage,
    getPageFromUrl,
    sharePlan,
    updateShareUrl,
    updatePageUrl
  });
})(window.Planner = window.Planner || {});
