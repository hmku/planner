(function (Planner) {
  // Share payload (the `p` query parameter):
  //   v2: "z." + base64url(deflate-raw(JSON)) or "j." + base64url(JSON), where the
  //       JSON is a plan state (see plan-store.js) plus an optional `seed`. A seed
  //       means the link reproduces a run, so opening it reruns automatically.
  //   v1 (still read): seed ~ currentYear,deathYear,netWorth,spxBeta,simulationCount,betaMode
  //       ~ income ~ expenses, where cash flows are ";"-separated rows of
  //       name,amount,startMode,startYear,endMode,endYear and a year is only
  //       written for "fixed" modes.

  const FLOW_MODE_CODES = { current: "c", death: "d", fixed: "f" };
  const MAX_PAYLOAD_LENGTH = 50000;

  // Returns { state, seed } | { error } | null.
  async function readSharedPlanFromUrl() {
    const encodedPlan = getRawQueryParam("p");
    if (!encodedPlan) return null;
    try {
      const { state, seed } = await decodeSharePayload(encodedPlan);
      return { state, seed: seed === null ? null : Planner.normalizeSeed(seed) };
    } catch (error) {
      return { error: `Could not load the shared plan. ${error.message}` };
    }
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
      Planner.readScenario();
      const state = Planner.getPlanState();
      seed = Planner.state.results && !Planner.state.isDirty && Number.isInteger(Planner.state.results.seed)
        ? Planner.state.results.seed
        : Planner.generateSimulationSeed();
      url = await buildShareUrl(state, seed);
    } catch (error) {
      Planner.setStatus(`Fix inputs before sharing. ${error.message}`, "error");
      return;
    }

    // Phones get the native share sheet; elsewhere the link is copied.
    if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ title: Planner.getPlanState().name || "Financial Runway Planner", url });
        if (Planner.state.isDirty) Planner.state.nextSimulationSeed = seed;
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
        // Fall back to copying.
      }
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


  async function buildShareUrl(state, seed) {
    const url = new URL(window.location.href);
    const parts = [`p=${await encodeSharePayload(state, seed)}`];
    const page = normalizePage(Planner.state.activePage);
    if (page !== "overview") parts.push(`tab=${encodeURIComponent(page)}`);
    return `${url.origin}${url.pathname}?${parts.join("&")}`;
  }


  function replaceUrl(url) {
    if (window.history && typeof window.history.replaceState === "function") {
      window.history.replaceState(null, "", url);
    }
  }


  // Keeps the address bar on the current inputs (and the last run's seed, when
  // given) so a refresh or a copied address restores the same plan. Encoding is
  // async, so a newer call wins over an older one still in flight.
  let syncVersion = 0;

  async function syncShareUrl(state, seed) {
    const version = ++syncVersion;
    try {
      const url = await buildShareUrl(state, seed);
      if (version === syncVersion) replaceUrl(url);
    } catch (error) {
      // Leave the address bar as is; sharing still works from the button.
    }
  }


  function updatePageUrl(page) {
    const nextPage = normalizePage(page);
    const pairs = getQueryPairs().filter((pair) => getQueryKey(pair) !== "tab");
    if (nextPage !== "overview") pairs.push(`tab=${encodeURIComponent(nextPage)}`);
    const search = pairs.length ? `?${pairs.join("&")}` : "";
    replaceUrl(`${window.location.pathname}${search}${window.location.hash}`);
  }


  async function encodeSharePayload(state, seed) {
    const json = JSON.stringify(Number.isInteger(seed) ? { ...state, seed } : state);
    const bytes = new TextEncoder().encode(json);
    if (typeof CompressionStream === "function") {
      try {
        return `z.${toBase64Url(await pipeBytes(bytes, new CompressionStream("deflate-raw")))}`;
      } catch (error) {
        // Fall through to uncompressed JSON.
      }
    }
    return `j.${toBase64Url(bytes)}`;
  }


  async function decodeSharePayload(payload) {
    if (payload.length > MAX_PAYLOAD_LENGTH) throw new Error("The link is too long.");
    if (payload.includes("~")) return decodeLegacySharePayload(payload);

    const kind = payload.slice(0, 2);
    let bytes = fromBase64Url(payload.slice(2));
    if (kind === "z.") {
      if (typeof DecompressionStream !== "function") throw new Error("This browser can't read compressed links.");
      bytes = await pipeBytes(bytes, new DecompressionStream("deflate-raw"));
    } else if (kind !== "j.") {
      throw new Error("The link format is not supported.");
    }
    let raw;
    try {
      raw = JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      throw new Error("The link is damaged.");
    }
    const seed = Number.isInteger(raw?.seed) ? raw.seed : null;
    return { state: Planner.normalizePlanState(raw), seed };
  }


  async function pipeBytes(bytes, transform) {
    const stream = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }


  function toBase64Url(bytes) {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }


  function fromBase64Url(text) {
    if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("The link is damaged.");
    const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }


  // v1 links predate the lifestyle builder, so they open with it switched off.
  function decodeLegacySharePayload(payload) {
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
    const state = Planner.normalizePlanState({
      name: "",
      plan: scenario,
      income: decodeSharedFlows(parts[2], "income", scenario),
      expenses: decodeSharedFlows(parts[3], "expense", scenario),
      lifestyle: { enabled: false }
    });
    return { seed: parseSharedNumber(parts[0], "simulation seed"), state };
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
    readSharedPlanFromUrl,
    normalizeBetaMode,
    normalizePage,
    getPageFromUrl,
    sharePlan,
    syncShareUrl,
    updatePageUrl
  });
})(window.Planner = window.Planner || {});
