(function (Planner) {
  function applySharedPlanFromUrl() {
    const encodedPlan = getRawQueryParam("p");
    if (!encodedPlan) return null;

    try {
      const payload = decodeSharePayload(encodedPlan);
      return {
        seed: Planner.normalizeSeed(payload.seed),
        autorun: true
      };
    } catch (error) {
      return {
        error: `Could not load the shared plan. ${error.message}`
      };
    }
  }



  function applySharedScenario(scenario) {
    const sharedScenario = normalizeSharedScenario(scenario);

    Planner.els.currentYear.value = sharedScenario.currentYear;
    Planner.els.deathYear.value = sharedScenario.deathYear;
    Planner.els.netWorth.value = sharedScenario.netWorth;
    Planner.els.betaMode.value = sharedScenario.betaMode;
    Planner.els.spxBeta.value = sharedScenario.spxBeta;
    Planner.els.dynamicRiskThreshold.value = Planner.formatShareNumber(sharedScenario.dynamicRiskThreshold * 100);
    Planner.els.simulationCount.value = sharedScenario.simulationCount;
    Planner.updateBetaModeControls();

    Planner.els.incomeRows.replaceChildren();
    Planner.els.expenseRows.replaceChildren();
    sharedScenario.income.forEach((flow) => Planner.addFlowRow(Planner.els.incomeRows, flow));
    sharedScenario.expenses.forEach((flow) => Planner.addFlowRow(Planner.els.expenseRows, flow));
    Planner.formatAllFormattedInputs(document);
  }



  function normalizeSharedScenario(scenario) {
    if (!scenario || typeof scenario !== "object") {
      throw new Error("The shared scenario is missing.");
    }
    const currentYear = normalizeRequiredNumber(scenario.currentYear, "current year");
    const deathYear = normalizeRequiredNumber(scenario.deathYear, "death year");
    return {
      currentYear,
      deathYear,
      netWorth: normalizeRequiredNumber(scenario.netWorth, "current net worth"),
      betaMode: normalizeBetaMode(scenario.betaMode),
      spxBeta: normalizeRequiredNumber(scenario.spxBeta, "SPX beta"),
      dynamicRiskThreshold: Planner.normalizeRiskThreshold(scenario.dynamicRiskThreshold),
      simulationCount: normalizeRequiredNumber(scenario.simulationCount, "simulation count"),
      income: normalizeSharedFlows(scenario.income, "income"),
      expenses: normalizeSharedFlows(scenario.expenses, "expense")
    };
  }



  function normalizeSharedFlows(flows, type) {
    if (!Array.isArray(flows)) {
      throw new Error(`The shared ${type} rows are missing.`);
    }
    return flows.slice(0, Planner.MAX_SHARED_FLOWS).map((flow) => normalizeSharedFlow(flow, type));
  }



  function normalizeSharedFlow(flow, type) {
    if (!flow || typeof flow !== "object") {
      throw new Error(`A shared ${type} row is invalid.`);
    }
    const nameFallback = type === "income" ? "Income" : "Expense";
    return {
      name: typeof flow.name === "string" ? flow.name.slice(0, 80) : nameFallback,
      amount: normalizeRequiredNumber(flow.amount, `${type} amount`),
      startMode: normalizeSharedMode(flow.startMode, "current"),
      startYear: normalizeRequiredNumber(flow.startYear, `${type} start year`),
      endMode: normalizeSharedMode(flow.endMode, "death"),
      endYear: normalizeRequiredNumber(flow.endYear, `${type} end year`)
    };
  }



  function normalizeSharedMode(mode, fallback) {
    return ["current", "death", "fixed"].includes(mode) ? mode : fallback;
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



  function normalizeRequiredNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new Error(`The shared ${label} is invalid.`);
    }
    return number;
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
      Planner.els.scenarioSummary.textContent = `Fix inputs before sharing. ${error.message}`;
      setShareStatus("Fix inputs");
      return;
    }

    try {
      await copyText(url);
      if (Planner.state.isDirty) {
        Planner.state.nextSimulationSeed = seed;
      }
      setShareStatus("Copied");
    } catch (error) {
      Planner.els.scenarioSummary.textContent = `Could not copy the share link. ${error.message}`;
      setShareStatus("Copy failed");
    }
  }



  function buildShareUrl(scenario, seed) {
    const url = new URL(window.location.href);
    const parts = [`p=${encodeSharePayload(scenario, seed)}`];
    const page = normalizePage(Planner.state.activePage);
    if (page !== "overview") {
      parts.push(`tab=${encodeURIComponent(page)}`);
    }
    return `${url.origin}${url.pathname}?${parts.join("&")}`;
  }



  function updateShareUrl(scenario, seed) {
    if (!window.history || typeof window.history.replaceState !== "function") return;
    window.history.replaceState(null, "", buildShareUrl(scenario, seed));
  }



  function updatePageUrl(page) {
    if (!window.history || typeof window.history.replaceState !== "function") return;
    window.history.replaceState(null, "", buildCurrentUrlWithPage(page));
  }



  function buildCurrentUrlWithPage(page) {
    const url = new URL(window.location.href);
    const nextPage = normalizePage(page);
    const query = window.location.search.startsWith("?")
      ? window.location.search.slice(1)
      : window.location.search;
    const pairs = query
      ? query.split("&").filter((pair) => pair && getQueryKey(pair) !== "tab")
      : [];
    if (nextPage !== "overview") {
      pairs.push(`tab=${encodeURIComponent(nextPage)}`);
    }
    const search = pairs.length ? `?${pairs.join("&")}` : "";
    return `${url.origin}${url.pathname}${search}${url.hash}`;
  }



  function encodeSharePayload(scenario, seed) {
    const plan = [
      scenario.currentYear,
      scenario.deathYear,
      scenario.netWorth,
      scenario.spxBeta,
      scenario.simulationCount
    ].map(Planner.formatShareNumber);
    plan.push(encodeBetaMode(scenario.betaMode));
    plan.push(Planner.formatShareNumber(Planner.normalizeRiskThreshold(scenario.dynamicRiskThreshold)));

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
    if (plan.length !== 5 && plan.length !== 6 && plan.length !== 7) {
      throw new Error("The shared scenario is missing.");
    }
    const scenario = {
      currentYear: parseSharedNumber(plan[0], "current year"),
      deathYear: parseSharedNumber(plan[1], "death year"),
      netWorth: parseSharedNumber(plan[2], "current net worth"),
      spxBeta: parseSharedNumber(plan[3], "SPX beta"),
      simulationCount: parseSharedNumber(plan[4], "simulation count"),
      betaMode: plan.length >= 6 ? decodeBetaMode(plan[5]) : Planner.BETA_MODE_FIXED,
      dynamicRiskThreshold: plan.length >= 7 ? parseSharedRiskThreshold(plan[6]) : 0
    };
    scenario.income = decodeSharedFlows(parts[2], "income", scenario);
    scenario.expenses = decodeSharedFlows(parts[3], "expense", scenario);
    applySharedScenario(scenario);
    return {
      seed: parseSharedNumber(parts[0], "simulation seed")
    };
  }



  function encodeBetaMode(mode) {
    return normalizeBetaMode(mode) === Planner.BETA_MODE_DYNAMIC ? "d" : "f";
  }



  function decodeBetaMode(value) {
    return value === "d" ? Planner.BETA_MODE_DYNAMIC : Planner.BETA_MODE_FIXED;
  }



  function encodeSharedFlow(flow) {
    return [
      encodeShareText(flow.name),
      Planner.formatShareNumber(flow.amount),
      encodeFlowMode(flow.startMode),
      flow.startMode === "fixed" ? Planner.formatShareNumber(flow.startYear) : "",
      encodeFlowMode(flow.endMode),
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
      name: decodeShareText(flow[0]),
      amount: parseSharedNumber(flow[1], `${type} amount`),
      startMode,
      startYear: startMode === "fixed" ? parseSharedNumber(flow[3], `${type} start year`) : scenario.currentYear,
      endMode,
      endYear: endMode === "fixed" ? parseSharedNumber(flow[5], `${type} end year`) : scenario.deathYear
    };
  }



  function encodeFlowMode(mode) {
    if (mode === "current") return "c";
    if (mode === "death") return "d";
    return "f";
  }



  function decodeFlowMode(mode) {
    if (mode === "c") return "current";
    if (mode === "d") return "death";
    if (mode === "f") return "fixed";
    throw new Error("A shared cash flow mode is invalid.");
  }



  function parseSharedNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new Error(`The shared ${label} is invalid.`);
    }
    return number;
  }



  function parseSharedRiskThreshold(value) {
    const number = parseSharedNumber(value, "acceptable depletion risk");
    if (number < 0 || number > 1) {
      throw new Error("The shared acceptable depletion risk is invalid.");
    }
    return number;
  }



  function encodeShareText(text) {
    return encodeURIComponent(text).replace(/%20/g, "+").replace(/~/g, "%7E");
  }



  function decodeShareText(encoded) {
    return decodeURIComponent(encoded.replace(/\+/g, "%20"));
  }



  function getRawQueryParam(name) {
    const query = window.location.search.startsWith("?")
      ? window.location.search.slice(1)
      : window.location.search;
    for (const pair of query.split("&")) {
      const separatorIndex = pair.indexOf("=");
      const rawKey = separatorIndex === -1 ? pair : pair.slice(0, separatorIndex);
      if (decodeURIComponent(rawKey) === name) {
        return separatorIndex === -1 ? "" : pair.slice(separatorIndex + 1);
      }
    }
    return null;
  }



  function getQueryKey(pair) {
    const separatorIndex = pair.indexOf("=");
    return decodeQueryValue(separatorIndex === -1 ? pair : pair.slice(0, separatorIndex));
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
    fallbackCopyText(text);
  }



  function fallbackCopyText(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) {
      throw new Error("Copy failed.");
    }
  }



  function setShareStatus(text) {
    window.clearTimeout(Planner.state.shareStatusTimer);
    Planner.els.sharePlan.textContent = text;
    Planner.state.shareStatusTimer = window.setTimeout(() => {
      Planner.els.sharePlan.textContent = "Share";
    }, 1800);
  }


  Object.assign(Planner, {
    applySharedPlanFromUrl,
    applySharedScenario,
    normalizeSharedScenario,
    normalizeSharedFlows,
    normalizeSharedFlow,
    normalizeSharedMode,
    normalizeBetaMode,
    normalizePage,
    getPageFromUrl,
    normalizeRequiredNumber,
    sharePlan,
    buildShareUrl,
    updateShareUrl,
    updatePageUrl,
    buildCurrentUrlWithPage,
    encodeSharePayload,
    decodeSharePayload,
    encodeBetaMode,
    decodeBetaMode,
    encodeSharedFlow,
    decodeSharedFlows,
    decodeSharedFlow,
    encodeFlowMode,
    decodeFlowMode,
    parseSharedNumber,
    parseSharedRiskThreshold,
    encodeShareText,
    decodeShareText,
    getRawQueryParam,
    getQueryKey,
    decodeQueryValue,
    copyText,
    fallbackCopyText,
    setShareStatus
  });
})(window.Planner = window.Planner || {});
