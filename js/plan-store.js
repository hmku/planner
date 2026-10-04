(function (Planner) {
  // A plan state is everything the inputs pane holds: plan fields, income and
  // manual expense rows (raw, as entered), and the lifestyle builder. The same
  // shape is saved to localStorage and carried by share links, and always goes
  // through normalizePlanState() on the way in.

  const DRAFT_KEY = "planner.draft.v1";
  const PLANS_KEY = "planner.plans.v1";
  const MAX_SAVED_PLANS = 100;
  const MAX_NAME_LENGTH = 80;
  const FLOW_MODES = ["current", "death", "fixed"];
  const AUTOSAVE_DELAY_MS = 400;

  let autosaveTimer = null;
  let editedSinceOpen = false;
  let savedPlansCache = null;

  // ---------- Snapshot and restore ----------

  function numberOrNull(input) {
    const value = Planner.numberFromInput(input);
    return Number.isFinite(value) ? value : null;
  }

  function readFlowSpecs(container) {
    return [...container.querySelectorAll(".flow-row")].map((row) => {
      const field = (name) => row.querySelector(`[data-field="${name}"]`);
      return {
        name: field("name").value.trim(),
        amount: numberOrNull(field("amount")),
        startMode: field("startMode").value,
        startYear: numberOrNull(field("startYear")),
        endMode: field("endMode").value,
        endYear: numberOrNull(field("endYear")),
        lifestyleKey: row.dataset.lifestyleKey
      };
    });
  }

  function getPlanState() {
    const { els } = Planner;
    return normalizePlanState({
      name: els.planName.value,
      plan: {
        currentYear: numberOrNull(els.currentYear),
        deathYear: numberOrNull(els.deathYear),
        netWorth: numberOrNull(els.netWorth),
        betaMode: els.betaMode.value,
        spxBeta: numberOrNull(els.spxBeta),
        simulationCount: numberOrNull(els.simulationCount),
        withdrawalTaxPct: numberOrNull(els.withdrawalTax)
      },
      income: readFlowSpecs(els.incomeRows),
      expenses: readFlowSpecs(els.expenseRows),
      lifestyle: Planner.state.lifestyle
    });
  }

  function finiteOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function normalizeFlows(flows) {
    return (Array.isArray(flows) ? flows : [])
      .slice(0, Planner.MAX_SHARED_FLOWS)
      .filter((flow) => flow && typeof flow === "object")
      .map((flow) => ({
        name: typeof flow.name === "string" ? flow.name.slice(0, 80) : "",
        amount: finiteOrNull(flow.amount),
        startMode: FLOW_MODES.includes(flow.startMode) ? flow.startMode : "current",
        startYear: finiteOrNull(flow.startYear),
        endMode: FLOW_MODES.includes(flow.endMode) ? flow.endMode : "death",
        endYear: finiteOrNull(flow.endYear),
        ...(Planner.isLifestyleKey(flow.lifestyleKey) ? { lifestyleKey: flow.lifestyleKey } : {})
      }));
  }

  // Returns a fresh, validated copy; never shares objects with its input.
  // Plans saved before the withdrawal tax existed get missingTaxPct (the
  // default for saved plans; 0 for share links so they reproduce exactly).
  function normalizePlanState(raw, { missingTaxPct = Planner.DEFAULT_WITHDRAWAL_TAX_PCT } = {}) {
    if (!raw || typeof raw !== "object") throw new Error("The plan is empty.");
    const plan = raw.plan && typeof raw.plan === "object" ? raw.plan : {};
    const currentYear = finiteOrNull(plan.currentYear);
    const lifestyleYear = Number.isInteger(currentYear) ? currentYear : new Date().getFullYear();
    return {
      name: typeof raw.name === "string" ? raw.name.trim().slice(0, MAX_NAME_LENGTH) : "",
      plan: {
        currentYear,
        deathYear: finiteOrNull(plan.deathYear),
        netWorth: finiteOrNull(plan.netWorth),
        betaMode: Planner.normalizeBetaMode(plan.betaMode),
        spxBeta: finiteOrNull(plan.spxBeta),
        simulationCount: finiteOrNull(plan.simulationCount),
        withdrawalTaxPct: "withdrawalTaxPct" in plan ? finiteOrNull(plan.withdrawalTaxPct) : missingTaxPct
      },
      income: normalizeFlows(raw.income),
      expenses: normalizeFlows(raw.expenses),
      lifestyle: JSON.parse(JSON.stringify(Planner.normalizeLifestyle(raw.lifestyle, lifestyleYear)))
    };
  }

  function applyPlanState(state) {
    const { els } = Planner;
    els.planName.value = state.name;
    els.currentYear.value = state.plan.currentYear ?? "";
    els.deathYear.value = state.plan.deathYear ?? "";
    els.netWorth.value = state.plan.netWorth ?? "";
    els.betaMode.value = state.plan.betaMode;
    els.spxBeta.value = state.plan.spxBeta ?? Planner.DEFAULT_SPX_BETA;
    els.simulationCount.value = state.plan.simulationCount ?? "";
    els.withdrawalTax.value = state.plan.withdrawalTaxPct ?? "";
    Planner.updateBetaModeControls();

    els.incomeRows.replaceChildren();
    els.expenseRows.replaceChildren();
    state.income.forEach((flow) => Planner.addFlowRow(els.incomeRows, flow));
    state.expenses.forEach((flow) => Planner.addFlowRow(els.expenseRows, flow));
    Planner.formatAllFormattedInputs(document);

    Planner.state.lifestyle = JSON.parse(JSON.stringify(state.lifestyle));
    Planner.renderLifestyleForm();
  }

  function samePlan(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  // ---------- Storage ----------

  function readJson(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  // Cached because the Save button checks against the open plan on every edit;
  // another tab's writes invalidate it through the storage event.
  function readSavedPlans() {
    if (!savedPlansCache) savedPlansCache = loadSavedPlans();
    return savedPlansCache.slice();
  }

  function writeSavedPlans(plans) {
    savedPlansCache = null;
    return writeJson(PLANS_KEY, plans);
  }

  function loadSavedPlans() {
    const plans = readJson(PLANS_KEY);
    if (!Array.isArray(plans)) return [];
    return plans.flatMap((entry) => {
      if (!entry || typeof entry.name !== "string" || !entry.name) return [];
      try {
        return [{ name: entry.name.slice(0, MAX_NAME_LENGTH), savedAt: Number(entry.savedAt) || 0, state: normalizePlanState(entry.state) }];
      } catch (error) {
        return [];
      }
    });
  }

  function findSavedPlan(name) {
    return name ? readSavedPlans().find((plan) => plan.name === name) || null : null;
  }

  function readDraft() {
    const draft = readJson(DRAFT_KEY);
    if (!draft || typeof draft !== "object") return null;
    try {
      return { state: normalizePlanState(draft.state), openPlanName: typeof draft.openPlanName === "string" ? draft.openPlanName : null };
    } catch (error) {
      return null;
    }
  }

  function saveDraftNow() {
    window.clearTimeout(autosaveTimer);
    autosaveTimer = null;
    writeJson(DRAFT_KEY, { state: getPlanState(), openPlanName: Planner.state.openPlanName, savedAt: Date.now() });
  }

  // Called after every user edit: autosaves the draft and keeps the address bar
  // pointing at the current inputs.
  function noteUserEdit() {
    editedSinceOpen = true;
    updateSaveControls();
    window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => {
      saveDraftNow();
      Planner.syncShareUrl(getPlanState(), null);
    }, AUTOSAVE_DELAY_MS);
  }

  function flushPendingAutosave() {
    if (autosaveTimer) saveDraftNow();
  }

  // ---------- Saved plans UI ----------

  const NEW_PLAN_VALUE = "__new__";
  const DRAFT_VALUE = "__draft__";

  // The plan switcher: shows the plan being edited (and whether it is saved),
  // lists the saved plans to open, and starts a new plan.
  function renderSavedPlanSelect() {
    const select = Planner.els.savedPlanSelect;
    const openName = findSavedPlan(Planner.state.openPlanName)?.name || null;
    const isSaved = isSavedAsOpenPlan();
    const option = (value, text) => {
      const element = document.createElement("option");
      element.value = value;
      element.textContent = text;
      return element;
    };
    const options = readSavedPlans()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((plan) => option(plan.name, plan.name === openName && !isSaved ? `${plan.name} (edited)` : plan.name));
    if (!openName) {
      const name = Planner.els.planName.value.trim();
      options.unshift(option(DRAFT_VALUE, name ? `${name} (not saved)` : "Unsaved plan"));
    }
    options.push(option(NEW_PLAN_VALUE, "+ New plan"));
    select.replaceChildren(...options);
    select.value = openName || DRAFT_VALUE;
  }

  function isSavedAsOpenPlan(state = getPlanState()) {
    const saved = findSavedPlan(Planner.state.openPlanName);
    return Boolean(saved && saved.name === state.name && samePlan(saved.state, state));
  }

  function updateSaveControls() {
    const { els } = Planner;
    const isSaved = isSavedAsOpenPlan();
    const openName = findSavedPlan(Planner.state.openPlanName)?.name || null;
    const name = els.planName.value.trim();
    els.savePlan.textContent = isSaved ? "Saved" : "Save";
    els.savePlan.disabled = isSaved;
    els.savePlan.title = isSaved
      ? `“${openName}” is saved in this browser`
      : openName && name && name !== openName
        ? `Save as “${name}” (renames “${openName}”)`
        : "Save this plan in this browser";
    els.deletePlan.disabled = !openName;
    renderSavedPlanSelect();
  }

  function nextUntitledName(plans) {
    const names = new Set(plans.map((plan) => plan.name));
    if (!names.has("Untitled plan")) return "Untitled plan";
    let index = 2;
    while (names.has(`Untitled plan ${index}`)) index += 1;
    return `Untitled plan ${index}`;
  }

  function savePlan() {
    const { els } = Planner;
    const plans = readSavedPlans();
    if (!els.planName.value.trim()) els.planName.value = nextUntitledName(plans);
    const state = getPlanState();
    // Saving an open plan under a new name renames it rather than copying it.
    const renamedFrom = findSavedPlan(Planner.state.openPlanName) && Planner.state.openPlanName !== state.name
      ? Planner.state.openPlanName
      : null;
    const existingIndex = plans.findIndex((plan) => plan.name === state.name);
    if (existingIndex !== -1 && Planner.state.openPlanName !== state.name &&
        !window.confirm(`Replace the saved plan “${state.name}”?`)) {
      return;
    }
    if (existingIndex === -1 && !renamedFrom && plans.length >= MAX_SAVED_PLANS) {
      Planner.setStatus(`You can keep up to ${MAX_SAVED_PLANS} saved plans. Delete one first.`, "error");
      return;
    }
    const entry = { name: state.name, savedAt: Date.now(), state };
    const nextPlans = plans.filter((plan) => plan.name !== state.name && plan.name !== renamedFrom);
    nextPlans.push(entry);
    if (!writeSavedPlans(nextPlans)) {
      Planner.setStatus("Could not save: this browser is blocking or out of local storage.", "error");
      return;
    }
    Planner.state.openPlanName = state.name;
    editedSinceOpen = false;
    saveDraftNow();
    updateSaveControls();
    Planner.setStatus(renamedFrom ? `Renamed “${renamedFrom}” to “${state.name}” and saved it.` : `Saved “${state.name}” in this browser.`);
  }

  function openSavedPlan(name, onOpened) {
    const plan = findSavedPlan(name);
    if (!plan) return;
    if (!confirmDiscard("Open this plan")) return;
    switchToPlan(plan.state, plan.name, onOpened);
    Planner.setStatus(`Opened “${plan.name}”.`);
  }

  // Starts over from the default inputs (captured at startup).
  function startNewPlan(onOpened) {
    if (!confirmDiscard("Start a new plan")) return;
    switchToPlan(defaultPlanState, null, onOpened);
    Planner.setStatus("Started a new plan. Save it to keep it.");
  }

  function confirmDiscard(action) {
    if (!editedSinceOpen || isSavedAsOpenPlan() || window.confirm(`${action} and discard your unsaved changes?`)) return true;
    renderSavedPlanSelect();
    return false;
  }

  function switchToPlan(state, openPlanName, onOpened) {
    applyPlanState(state);
    Planner.state.openPlanName = openPlanName;
    editedSinceOpen = false;
    saveDraftNow();
    updateSaveControls();
    onOpened();
    Planner.syncShareUrl(state, null);
  }

  let defaultPlanState = null;

  function captureDefaultPlan() {
    defaultPlanState = getPlanState();
  }

  function deleteOpenPlan() {
    const name = Planner.state.openPlanName;
    if (!findSavedPlan(name) || !window.confirm(`Delete the saved plan “${name}”? This can't be undone.`)) return;
    writeSavedPlans(readSavedPlans().filter((plan) => plan.name !== name));
    Planner.state.openPlanName = null;
    saveDraftNow();
    updateSaveControls();
    Planner.setStatus(`Deleted “${name}”. The current inputs are unchanged.`);
  }

  function bindSavedPlanControls(onOpened) {
    const { els } = Planner;
    els.savePlan.addEventListener("click", savePlan);
    els.deletePlan.addEventListener("click", deleteOpenPlan);
    els.savedPlanSelect.addEventListener("change", () => {
      const { value } = els.savedPlanSelect;
      if (value === NEW_PLAN_VALUE) startNewPlan(onOpened);
      else if (value !== DRAFT_VALUE) openSavedPlan(value, onOpened);
    });
    window.addEventListener("storage", (event) => {
      if (event.key !== PLANS_KEY) return;
      savedPlansCache = null;
      updateSaveControls();
    });
    window.addEventListener("pagehide", flushPendingAutosave);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushPendingAutosave();
    });
  }

  // Restores the plan to start from: a shared link wins, then the autosaved
  // draft. Returns { source, seed?, error? } or null when nothing was restored.
  async function restoreInitialPlan() {
    const shared = await Planner.readSharedPlanFromUrl();
    if (shared?.error) return { source: "share", error: shared.error };
    let source = null;
    let seed = null;
    if (shared) {
      applyPlanState(shared.state);
      // A refresh reloads the address-bar link, which matches the draft; keep
      // the draft's open plan so unsaved edits still save over that plan.
      const draft = readDraft();
      const saved = findSavedPlan(shared.state.name);
      if (draft && samePlan(draft.state, shared.state) && findSavedPlan(draft.openPlanName)) {
        Planner.state.openPlanName = draft.openPlanName;
      } else {
        Planner.state.openPlanName = saved && samePlan(saved.state, shared.state) ? saved.name : null;
      }
      source = "share";
      seed = shared.seed;
    } else {
      const draft = readDraft();
      if (draft) {
        applyPlanState(draft.state);
        Planner.state.openPlanName = findSavedPlan(draft.openPlanName) ? draft.openPlanName : null;
        source = "draft";
      }
    }
    editedSinceOpen = Boolean(source) && !isSavedAsOpenPlan();
    updateSaveControls();
    return source ? { source, seed } : null;
  }

  Object.assign(Planner, {
    getPlanState,
    normalizePlanState,
    captureDefaultPlan,
    bindSavedPlanControls,
    restoreInitialPlan,
    noteUserEdit
  });
})(window.Planner = window.Planner || {});
