(function (Planner) {
  // Lifestyle builder form. Planner.state.lifestyle is the source of truth;
  // inputs carry a data-ls path into it (kid rows use data-kid-field), and every
  // change regenerates the line items, section totals, and the Spending view.

  // allItems includes lines moved to manual rows (listed so they can be
  // restored); currentItems is what the plan actually spends.
  let allItems = [];
  let currentItems = [];

  function card() {
    return document.getElementById("lifestyleCard");
  }

  function getPath(object, path) {
    return path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), object);
  }

  function setPath(object, path, value) {
    const keys = path.split(".");
    const last = keys.pop();
    const target = keys.reduce((value, key) => value[key], object);
    target[last] = value;
  }

  function readInputValue(input) {
    if (input.type === "checkbox") return input.checked;
    if (input.dataset.format === "money" || input.type === "number") {
      const value = Planner.numberFromInput(input);
      return Number.isFinite(value) ? value : null;
    }
    if (input.dataset.lsType === "number") return Number(input.value);
    return input.value;
  }

  function writeInputValue(input, value) {
    if (input.type === "checkbox") input.checked = Boolean(value);
    else input.value = value ?? "";
  }

  function populateOptions(root) {
    root.querySelectorAll("select[data-ls-options]").forEach((select) => {
      const options = Planner.LIFESTYLE_OPTIONS[select.dataset.lsOptions];
      Planner.populateSelect(select, options, {
        getValue: (option) => option.value,
        getLabel: (option) => option.label
      });
    });
  }

  function readPlanYears() {
    const currentYear = Planner.numberFromInput(Planner.els.currentYear);
    const deathYear = Planner.numberFromInput(Planner.els.deathYear);
    const valid = (year) => Number.isInteger(year) && year >= Planner.MIN_PLAN_YEAR && year <= Planner.MAX_PLAN_YEAR;
    return valid(currentYear) && valid(deathYear) && deathYear >= currentYear ? { currentYear, deathYear } : null;
  }

  // ---------- Rendering ----------

  function renderLifestyleForm() {
    const lifestyle = Planner.state.lifestyle;
    card().querySelectorAll("[data-ls]").forEach((input) => writeInputValue(input, getPath(lifestyle, input.dataset.ls)));
    renderKidRows();
    Planner.formatAllFormattedInputs(card());
    refreshLifestyle();
  }

  function renderKidRows() {
    const container = Planner.els.kidRows;
    const template = document.getElementById("kidRowTemplate");
    container.replaceChildren(...Planner.state.lifestyle.kids.map((kid, index) => {
      const row = template.content.firstElementChild.cloneNode(true);
      row.dataset.kidId = kid.id;
      row.querySelector(".kid-title").textContent = `Kid ${index + 1}`;
      populateOptions(row);
      row.querySelectorAll("[data-kid-field]").forEach((input) => writeInputValue(input, kid[input.dataset.kidField]));
      return row;
    }));
    Planner.els.addKid.hidden = Planner.state.lifestyle.kids.length >= Planner.LIFESTYLE_MAX_KIDS;
  }

  function matchesCondition(condition, lifestyle) {
    if (condition === "hasKids") return lifestyle.kids.length > 0;
    const [path, values] = condition.split("=");
    return values.split(",").includes(String(getPath(lifestyle, path)));
  }

  function updateConditionalFields() {
    const lifestyle = Planner.state.lifestyle;
    const root = card();
    root.querySelectorAll("[data-ls-show]").forEach((element) => {
      element.hidden = !matchesCondition(element.dataset.lsShow, lifestyle);
    });
    const label = (name) => root.querySelector(`[data-ls-label="${name}"]`);
    const mode = lifestyle.housing.mode;
    label("rent").textContent = mode === "rent" ? "Monthly rent" : "Rent until purchase (mo)";
    label("homePrice").textContent = mode === "own" ? "Home value" : "Home price";
    label("helpOtherwise").textContent = lifestyle.kids.length ? "Before kids / after they leave" : "Help";
    Planner.els.lifestyleBody.hidden = !lifestyle.enabled;
    Planner.els.expenseHeading.textContent = lifestyle.enabled ? "Other expenditures" : "Expenditures";
  }

  function totalForYear(items, year) {
    return items.reduce((sum, item) => (item.startYear <= year && year <= item.endYear ? sum + item.amount : sum), 0);
  }

  function peakOf(items, years) {
    let peak = { year: null, amount: 0 };
    if (!years) return peak;
    for (let year = years.currentYear; year <= years.deathYear; year += 1) {
      const amount = totalForYear(items.filter((item) => !item.oneTime), year);
      if (amount > peak.amount) peak = { year, amount };
    }
    return peak;
  }

  function describeAmounts(items, years) {
    if (!years) return "";
    if (!items.length) return "None";
    const now = totalForYear(items.filter((item) => !item.oneTime), years.currentYear);
    const peak = peakOf(items, years);
    const oneTime = items.filter((item) => item.oneTime).reduce((sum, item) => sum + item.amount, 0);
    const parts = [];
    if (now > 0) parts.push(`${Planner.formatCompactCurrency(now)}/yr`);
    if (peak.amount > now * 1.02) parts.push(`peak ${Planner.formatCompactCurrency(peak.amount)}`);
    if (oneTime > 0) parts.push(`+ ${Planner.formatCompactCurrency(oneTime)} once`);
    return parts.join(" · ") || "$0";
  }

  function describeCategory(category, years) {
    const items = currentItems.filter((item) => item.category === category);
    if (!items.length && allItems.some((item) => item.category === category && item.isDetached)) {
      return "Moved to other expenditures";
    }
    return describeAmounts(items, years);
  }

  function updateSummaries(years) {
    const lifestyle = Planner.state.lifestyle;
    const root = card();
    root.querySelectorAll("[data-ls-section]").forEach((section) => {
      const amount = section.querySelector(".ls-section-amount");
      const key = section.dataset.lsSection;
      if (key === "household") {
        const tier = Planner.LIFESTYLE_OPTIONS.costTier.find((option) => option.value === lifestyle.costTier);
        amount.textContent = `${lifestyle.adults === 1 ? "1 adult" : "2 adults"}, ${tier.label.replace(/ \(.*\)$/, "").toLowerCase()}`;
      } else if (key === "kids") {
        const count = lifestyle.kids.length;
        amount.textContent = count ? `${count} · ${describeCategory("kids", years)}` : "None";
      } else {
        amount.textContent = describeCategory(key, years);
      }
    });

    const total = Planner.els.lifestyleTotal;
    if (!lifestyle.enabled) {
      total.textContent = "Off. Enter expenditures manually below.";
      return;
    }
    if (!years) {
      total.textContent = "Enter a valid current year and year of death to price the lifestyle.";
      return;
    }
    const now = totalForYear(currentItems.filter((item) => !item.oneTime), years.currentYear);
    const peak = peakOf(currentItems, years);
    total.textContent = "";
    const strong = document.createElement("strong");
    strong.textContent = `${Planner.formatCompactCurrency(now)}/yr`;
    total.append(strong, ` in ${years.currentYear}`);
    if (peak.amount > now * 1.02) total.append(`, peaking at ${Planner.formatCompactCurrency(peak.amount)} in ${peak.year}`);
    total.append(". ");
    const link = document.createElement("button");
    link.type = "button";
    link.className = "link-button";
    link.textContent = "See spending";
    link.addEventListener("click", () => Planner.switchPage("spending"));
    total.append(link);
  }

  function renderItems() {
    const template = document.getElementById("lifestyleItemTemplate");
    const groups = Planner.groupLifestyleItems(allItems);
    card().querySelectorAll("[data-ls-items]").forEach((container) => {
      const rows = groups.filter((group) => group.category === container.dataset.lsItems).map((group) => {
        const row = template.content.firstElementChild.cloneNode(true);
        row.dataset.itemKey = group.key;
        row.querySelector(".ls-item-name").textContent = group.name;
        row.querySelector(".ls-item-name").title = group.name;
        row.querySelector(".ls-item-years").textContent = group.oneTime ? `${group.yearsLabel}, one time` : group.yearsLabel;
        const amount = row.querySelector(".ls-item-amount");
        if (group.isDetached) {
          row.classList.add("is-detached");
          row.querySelector(".ls-item-years").textContent = "Moved to other expenditures";
          [amount, row.querySelector(".ls-item-reset"), row.querySelector(".ls-item-detach")].forEach((element) => element.remove());
          return row;
        }
        row.querySelector(".ls-item-restore").remove();
        amount.value = group.amount;
        amount.setAttribute("aria-label", `${group.name} ${group.oneTime ? "amount" : "per year"}`);
        amount.classList.toggle("is-overridden", group.isOverridden);
        amount.title = group.isOverridden ? `Preset: ${Planner.formatCurrency(group.presetAmount)}` : "";
        row.querySelector(".ls-item-reset").hidden = !group.isOverridden;
        return row;
      });
      container.replaceChildren(...rows);
      Planner.bindFormattedInputs(container);
      Planner.formatAllFormattedInputs(container);
    });
  }

  // Recomputes items from state and updates everything derived from them. Pass
  // keepItemRows while a line-item amount is being typed so its input survives.
  function refreshLifestyle({ keepItemRows = false } = {}) {
    const years = readPlanYears();
    allItems = years
      ? Planner.buildLifestyleItems(Planner.state.lifestyle, years.currentYear, years.deathYear, { includeDetached: true })
      : [];
    currentItems = allItems.filter((item) => !item.isDetached);
    updateConditionalFields();
    if (!keepItemRows) renderItems();
    updateSummaries(years);
    Planner.renderSpendingView();
  }

  function getLifestyleItems(currentYear, deathYear) {
    return Planner.buildLifestyleItems(Planner.state.lifestyle, currentYear, deathYear);
  }

  // ---------- Events ----------

  // Returns true when the event belonged to the builder (state updated).
  function handleLifestyleInput(event) {
    const target = event.target;
    const lifestyle = Planner.state.lifestyle;
    if (target.dataset.ls) {
      setPath(lifestyle, target.dataset.ls, readInputValue(target));
      return true;
    }
    if (target.dataset.kidField) {
      const kid = lifestyle.kids.find((candidate) => candidate.id === target.closest(".kid-row").dataset.kidId);
      if (kid) kid[target.dataset.kidField] = readInputValue(target);
      return true;
    }
    if (target.classList.contains("ls-item-amount")) {
      const key = target.closest(".ls-item").dataset.itemKey;
      const value = Planner.numberFromInput(target);
      if (Number.isFinite(value) && value >= 0) lifestyle.overrides[key] = value;
      return true;
    }
    return false;
  }

  function bindLifestyleEvents(onChange) {
    const root = card();
    const { els } = Planner;

    els.addKid.addEventListener("click", () => {
      const kids = Planner.state.lifestyle.kids;
      const years = readPlanYears();
      const lastBirthYear = kids.length ? kids[kids.length - 1].birthYear : null;
      const birthYear = Number.isInteger(lastBirthYear) ? lastBirthYear + 2 : (years ? years.currentYear + 1 : null);
      kids.push(Planner.createKid(birthYear));
      renderKidRows();
      onChange();
      els.kidRows.lastElementChild?.querySelector('[data-kid-field="birthYear"]').focus();
    });

    root.addEventListener("click", (event) => {
      const lifestyle = Planner.state.lifestyle;
      const removeKid = event.target.closest(".kid-row .remove-flow");
      if (removeKid) {
        const kidId = removeKid.closest(".kid-row").dataset.kidId;
        lifestyle.kids = lifestyle.kids.filter((kid) => kid.id !== kidId);
        forgetKeys(lifestyle, (key) => key.startsWith(`kid.${kidId}.`));
        renderKidRows();
        onChange();
        return;
      }
      const item = event.target.closest(".ls-item");
      if (!item) return;
      const key = item.dataset.itemKey;
      if (event.target.closest(".ls-item-reset")) {
        delete lifestyle.overrides[key];
        onChange();
      } else if (event.target.closest(".ls-item-detach")) {
        detachItem(key);
        onChange();
      } else if (event.target.closest(".ls-item-restore")) {
        restoreItem(key);
        onChange();
      }
    });
  }

  function forgetKeys(lifestyle, shouldForget) {
    Object.keys(lifestyle.overrides).filter(shouldForget).forEach((key) => delete lifestyle.overrides[key]);
    lifestyle.detached = lifestyle.detached.filter((key) => !shouldForget(key));
  }

  // Moves a generated line into the manual expenditure list with its current
  // amount and years, and stops generating it.
  function detachItem(key) {
    const lifestyle = Planner.state.lifestyle;
    currentItems.filter((item) => item.key === key).forEach((item) => {
      Planner.addFlowRow(Planner.els.expenseRows, {
        name: item.name,
        amount: item.amount,
        startMode: "fixed",
        startYear: item.startYear,
        endMode: "fixed",
        endYear: item.endYear,
        lifestyleKey: key
      });
    });
    delete lifestyle.overrides[key];
    if (!lifestyle.detached.includes(key)) lifestyle.detached.push(key);
  }

  // Brings a moved line back into the builder and drops its manual copies, if
  // they're still there, so it isn't counted twice.
  function restoreItem(key) {
    const lifestyle = Planner.state.lifestyle;
    lifestyle.detached = lifestyle.detached.filter((detachedKey) => detachedKey !== key);
    Planner.els.expenseRows.querySelectorAll(".flow-row").forEach((row) => {
      if (row.dataset.lifestyleKey === key) row.remove();
    });
  }

  function initLifestyleBuilder(onChange) {
    populateOptions(card());
    bindLifestyleEvents(onChange);
  }

  Object.assign(Planner, {
    initLifestyleBuilder,
    renderLifestyleForm,
    refreshLifestyle,
    handleLifestyleInput,
    getLifestyleItems
  });
})(window.Planner = window.Planner || {});
