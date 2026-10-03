(function (Planner) {
  // Lifestyle builder: turns a described lifestyle into dated, current-dollar
  // expense items. Prices are annual, in today's dollars, for a very-high-cost
  // area (SF, NYC); `local: true` prices scale by the cost tier. Every price is
  // a starting point the user can override per line item.

  const COST_TIERS = [
    { value: "vhcol", label: "Very high cost (SF, NYC)", factor: 1 },
    { value: "hcol", label: "High cost (Seattle, Boston, LA)", factor: 0.85 },
    { value: "mcol", label: "Medium cost", factor: 0.7 },
    { value: "lcol", label: "Low cost", factor: 0.55 }
  ];

  const ADULTS = [
    { value: 1, label: "Just me" },
    { value: 2, label: "Couple" }
  ];

  // Kid ages are inclusive; age 0 is the birth year.
  const CHILDCARE = [
    { value: "none", label: "None (parent at home)", amount: 0 },
    { value: "daycare", label: "Daycare / preschool", amount: 35000 },
    { value: "nannyShare", label: "Nanny share", amount: 50000 },
    { value: "nanny", label: "Full-time nanny", amount: 100000 }
  ];

  const SCHOOL = [
    { value: "public", label: "Public", amount: 0 },
    { value: "private", label: "Private (typical)", amount: 30000 },
    { value: "elite", label: "Top private", amount: 70000 }
  ];

  const COLLEGE = [
    { value: "none", label: "None", amount: 0 },
    { value: "public", label: "Public, in-state", amount: 38000 },
    { value: "publicOut", label: "Public, out-of-state", amount: 60000 },
    { value: "private", label: "Private", amount: 90000 }
  ];

  const ACTIVITIES = [
    { value: "none", label: "None", amount: 0 },
    { value: "some", label: "Some", amount: 6000 },
    { value: "lots", label: "Lots (camps, tutoring)", amount: 15000 },
    { value: "max", label: "Everything", amount: 30000 }
  ];

  const HELP = [
    { value: "none", label: "None", amount: 0 },
    { value: "housekeeper", label: "Weekly housekeeper", amount: 12000 },
    { value: "nannyHousekeeper", label: "After-school nanny + housekeeper", amount: 65000 },
    { value: "manager", label: "Full-time household manager", amount: 110000 },
    { value: "staff", label: "Full staff", amount: 250000 }
  ];

  const HOUSING_MODES = [
    { value: "rent", label: "Rent" },
    { value: "buyCash", label: "Buy with cash" },
    { value: "buyMortgage", label: "Buy with a mortgage" },
    { value: "own", label: "Already own" },
    { value: "none", label: "Not included" }
  ];

  // Round-trip fares per traveler: [domestic, international]. Private is per
  // trip for the whole aircraft (charter, including repositioning and fees), so
  // it does not grow with the number of travelers.
  const FLIGHT_CLASSES = [
    { value: "economy", label: "Economy", fares: [500, 1400] },
    { value: "premium", label: "Premium economy", fares: [900, 3000] },
    { value: "business", label: "Business", fares: [1500, 7000] },
    { value: "first", label: "First", fares: [2500, 15000] },
    { value: "private", label: "Private jet", perTrip: [80000, 300000] }
  ];

  // Nightly room rate plus daily spending (food, activities, local transport)
  // per traveler.
  const HOTELS = [
    { value: "midrange", label: "Mid-range", nightly: 250, dailySpend: 100 },
    { value: "upscale", label: "Upscale", nightly: 450, dailySpend: 175 },
    { value: "luxury", label: "Luxury", nightly: 900, dailySpend: 300 },
    { value: "ultra", label: "Ultra-luxury", nightly: 2000, dailySpend: 600 }
  ];

  // Household of adults; kids' basics are priced per kid. Single households pay
  // SINGLE_ADULT_FACTOR of these.
  const EVERYDAY_TIERS = [
    { value: "modest", label: "Modest" },
    { value: "comfortable", label: "Comfortable" },
    { value: "affluent", label: "Affluent" },
    { value: "lavish", label: "Lavish" }
  ];
  const EVERYDAY_LINES = [
    { key: "groceries", label: "Groceries & household", amounts: [12000, 18000, 25000, 40000] },
    { key: "dining", label: "Dining out", amounts: [6000, 12000, 25000, 50000] },
    { key: "cars", label: "Cars & transport", amounts: [6000, 12000, 20000, 40000] },
    { key: "utilities", label: "Utilities, phone, subscriptions", amounts: [5000, 7000, 10000, 15000] },
    { key: "personal", label: "Clothes, gifts, personal, misc", amounts: [6000, 12000, 25000, 50000] }
  ];
  const SINGLE_ADULT_FACTOR = 0.6;

  const PRICES = {
    kidBasics: 8000,
    closingCostShare: 0.02,
    privateHealthPerAdult: 9000,
    privateHealthPerKid: 4000,
    privateHealthOutOfPocket: 4000,
    medicarePerAdult: 8000,
    medicareAge: 65,
    childcareEndAge: 4,
    schoolStartAge: 5,
    kidHomeEndAge: 17,
    collegeStartAge: 18,
    collegeEndAge: 21,
    kidHealthEndAge: 21
  };

  const CATEGORIES = [
    { key: "housing", label: "Housing" },
    { key: "kids", label: "Kids & education" },
    { key: "help", label: "Household help" },
    { key: "travel", label: "Travel" },
    { key: "everyday", label: "Everyday living" },
    { key: "health", label: "Health" },
    { key: "other", label: "Other" }
  ];

  const OPTIONS = {
    costTier: COST_TIERS,
    adults: ADULTS,
    childcare: CHILDCARE,
    school: SCHOOL,
    college: COLLEGE,
    activities: ACTIVITIES,
    help: HELP,
    housingMode: HOUSING_MODES,
    flightClass: FLIGHT_CLASSES,
    hotel: HOTELS,
    everydayTier: EVERYDAY_TIERS
  };

  const MAX_KIDS = 8;
  const MAX_OVERRIDES = 200;

  function findOption(options, value) {
    return options.find((option) => option.value === value) || options[0];
  }

  function newKidId() {
    return Math.random().toString(36).slice(2, 8) || "k";
  }

  function createKid(birthYear) {
    return { id: newKidId(), birthYear, childcare: "daycare", school: "private", college: "private", activities: "some" };
  }

  function defaultLifestyle(currentYear) {
    return {
      enabled: true,
      costTier: "vhcol",
      adults: 2,
      birthYear: currentYear - 32,
      kids: [],
      housing: {
        mode: "rent",
        monthlyRent: 5000,
        homePrice: 2000000,
        purchaseYear: currentYear + 3,
        carryingPct: 2.5,
        downPaymentPct: 20,
        mortgageRate: 6.5,
        mortgageYears: 30,
        mortgagePayment: 0,
        mortgageEndYear: currentYear + 25
      },
      help: { withKids: "nannyHousekeeper", otherwise: "none" },
      travel: {
        domesticTrips: 2,
        domesticNights: 4,
        internationalTrips: 1,
        internationalNights: 7,
        flightClass: "economy",
        hotel: "midrange",
        kidsTravel: true
      },
      everyday: { tier: "comfortable" },
      health: { employerUntilYear: currentYear + 19 },
      overrides: {},
      detached: []
    };
  }

  // ---------- Normalization (saved plans and share links are untrusted) ----------

  function pickEnum(value, options, fallback) {
    return options.some((option) => option.value === value) ? value : fallback;
  }

  function pickNumber(value, min, max, fallback) {
    const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    return typeof number === "number" && Number.isFinite(number) ? Planner.clamp(number, min, max) : fallback;
  }

  function pickYear(value, fallback) {
    const year = pickNumber(value, Planner.MIN_PLAN_YEAR, Planner.MAX_PLAN_YEAR, fallback);
    return Number.isFinite(year) ? Math.round(year) : year;
  }

  function pickKey(value) {
    return typeof value === "string" && /^[A-Za-z0-9.:_-]{1,40}$/.test(value) ? value : null;
  }

  function normalizeLifestyle(raw, currentYear) {
    const defaults = defaultLifestyle(currentYear);
    if (!raw || typeof raw !== "object") return defaults;
    const housing = raw.housing && typeof raw.housing === "object" ? raw.housing : {};
    const help = raw.help && typeof raw.help === "object" ? raw.help : {};
    const travel = raw.travel && typeof raw.travel === "object" ? raw.travel : {};
    const everyday = raw.everyday && typeof raw.everyday === "object" ? raw.everyday : {};
    const health = raw.health && typeof raw.health === "object" ? raw.health : {};
    const d = defaults;

    const kids = (Array.isArray(raw.kids) ? raw.kids : []).slice(0, MAX_KIDS)
      .filter((kid) => kid && typeof kid === "object")
      .map((kid) => ({
        id: typeof kid.id === "string" && /^[a-z0-9]{1,8}$/.test(kid.id) ? kid.id : newKidId(),
        birthYear: pickYear(kid.birthYear, null),
        childcare: pickEnum(kid.childcare, CHILDCARE, "daycare"),
        school: pickEnum(kid.school, SCHOOL, "private"),
        college: pickEnum(kid.college, COLLEGE, "private"),
        activities: pickEnum(kid.activities, ACTIVITIES, "some")
      }));
    const seenIds = new Set();
    kids.forEach((kid) => {
      while (seenIds.has(kid.id)) kid.id = newKidId();
      seenIds.add(kid.id);
    });

    const overrides = {};
    if (raw.overrides && typeof raw.overrides === "object") {
      Object.entries(raw.overrides).slice(0, MAX_OVERRIDES).forEach(([key, value]) => {
        const safeKey = pickKey(key);
        const amount = pickNumber(value, 0, 1e12, null);
        if (safeKey && Number.isFinite(amount)) overrides[safeKey] = amount;
      });
    }
    const detached = (Array.isArray(raw.detached) ? raw.detached : []).slice(0, MAX_OVERRIDES).map(pickKey).filter(Boolean);

    return {
      enabled: raw.enabled !== false,
      costTier: pickEnum(raw.costTier, COST_TIERS, d.costTier),
      adults: pickEnum(Number(raw.adults), ADULTS, d.adults),
      birthYear: pickYear(raw.birthYear, null),
      kids,
      housing: {
        mode: pickEnum(housing.mode, HOUSING_MODES, d.housing.mode),
        monthlyRent: pickNumber(housing.monthlyRent, 0, 1e9, null),
        homePrice: pickNumber(housing.homePrice, 0, 1e12, null),
        purchaseYear: pickYear(housing.purchaseYear, null),
        carryingPct: pickNumber(housing.carryingPct, 0, 100, null),
        downPaymentPct: pickNumber(housing.downPaymentPct, 0, 100, null),
        mortgageRate: pickNumber(housing.mortgageRate, 0, 100, null),
        mortgageYears: pickNumber(housing.mortgageYears, 1, 50, null),
        mortgagePayment: pickNumber(housing.mortgagePayment, 0, 1e9, null),
        mortgageEndYear: pickYear(housing.mortgageEndYear, null)
      },
      help: {
        withKids: pickEnum(help.withKids, HELP, d.help.withKids),
        otherwise: pickEnum(help.otherwise, HELP, d.help.otherwise)
      },
      travel: {
        domesticTrips: pickNumber(travel.domesticTrips, 0, 100, null),
        domesticNights: pickNumber(travel.domesticNights, 0, 365, null),
        internationalTrips: pickNumber(travel.internationalTrips, 0, 100, null),
        internationalNights: pickNumber(travel.internationalNights, 0, 365, null),
        flightClass: pickEnum(travel.flightClass, FLIGHT_CLASSES, d.travel.flightClass),
        hotel: pickEnum(travel.hotel, HOTELS, d.travel.hotel),
        kidsTravel: travel.kidsTravel !== false
      },
      everyday: { tier: pickEnum(everyday.tier, EVERYDAY_TIERS, d.everyday.tier) },
      health: { employerUntilYear: pickYear(health.employerUntilYear, null) },
      overrides,
      detached
    };
  }

  // ---------- Item generation ----------

  function annualMortgagePayment(principal, ratePct, years) {
    if (!(principal > 0) || !(years > 0)) return 0;
    const monthlyRate = (ratePct || 0) / 100 / 12;
    const months = Math.round(years * 12);
    if (monthlyRate <= 0) return principal / years;
    return 12 * principal * monthlyRate / (1 - (1 + monthlyRate) ** -months);
  }

  function formatYearRange(startYear, endYear) {
    return startYear === endYear ? String(startYear) : `${startYear}–${endYear}`;
  }

  // Returns items. Each item: { key, category, name, amount,
  // presetAmount, isOverridden, isDetached, oneTime, startYear, endYear }, clipped
  // to the plan window. Items sharing a key (for example household help before
  // kids and after they leave) share one override. Lines moved to manual rows are
  // left out unless includeDetached is set (the builder lists them to restore).
  function buildLifestyleItems(lifestyle, currentYear, deathYear, { includeDetached = false } = {}) {
    const items = [];
    if (!lifestyle || !lifestyle.enabled) return items;
    if (!Number.isInteger(currentYear) || !Number.isInteger(deathYear) || deathYear < currentYear) return items;

    const tierFactor = findOption(COST_TIERS, lifestyle.costTier).factor;
    const local = (amount) => amount * tierFactor;
    const detached = new Set(lifestyle.detached);
    const overrides = lifestyle.overrides || {};
    const num = (value) => (Number.isFinite(value) ? value : 0);

    function add(key, category, name, presetAmount, startYear, endYear, options = {}) {
      const isDetached = detached.has(key);
      if (isDetached && !includeDetached) return;
      if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return;
      const start = Math.max(startYear, currentYear);
      const end = Math.min(endYear, deathYear);
      if (start > end) return;
      const isOverridden = Object.prototype.hasOwnProperty.call(overrides, key);
      const preset = Math.round(presetAmount);
      const amount = isOverridden ? overrides[key] : preset;
      if (!(amount > 0) && !isOverridden) return;
      items.push({ key, category, name, amount, presetAmount: preset, isOverridden, isDetached, oneTime: Boolean(options.oneTime), startYear: start, endYear: end });
    }

    const adults = lifestyle.adults === 1 ? 1 : 2;
    const kids = lifestyle.kids.filter((kid) => Number.isInteger(kid.birthYear));
    const kidLabels = new Map(lifestyle.kids.map((kid, index) => [kid.id, `Kid ${index + 1}`]));

    // Housing.
    const housing = lifestyle.housing;
    const carryingRate = num(housing.carryingPct) / 100;
    const homePrice = num(housing.homePrice);
    const rent = num(housing.monthlyRent) * 12;
    if (housing.mode === "rent") {
      add("housing.rent", "housing", "Rent", rent, currentYear, deathYear);
    } else if (housing.mode === "buyCash" || housing.mode === "buyMortgage") {
      const purchaseYear = Number.isInteger(housing.purchaseYear) ? Math.max(housing.purchaseYear, currentYear) : currentYear;
      add("housing.rentBeforePurchase", "housing", "Rent until purchase", rent, currentYear, purchaseYear - 1);
      const closingCosts = homePrice * PRICES.closingCostShare;
      if (housing.mode === "buyCash") {
        add("housing.purchase", "housing", "Home purchase (price + closing)", homePrice + closingCosts, purchaseYear, purchaseYear, { oneTime: true });
      } else {
        const downPayment = homePrice * num(housing.downPaymentPct) / 100;
        const years = Math.round(num(housing.mortgageYears)) || 30;
        add("housing.downPayment", "housing", "Down payment + closing", downPayment + closingCosts, purchaseYear, purchaseYear, { oneTime: true });
        add("housing.mortgage", "housing", `Mortgage (${years} yr, ${num(housing.mortgageRate)}%)`,
          annualMortgagePayment(homePrice - downPayment, num(housing.mortgageRate), years), purchaseYear, purchaseYear + years - 1);
      }
      add("housing.carrying", "housing", "Property tax, insurance, upkeep", homePrice * carryingRate, purchaseYear, deathYear);
    } else if (housing.mode === "own") {
      add("housing.carrying", "housing", "Property tax, insurance, upkeep", homePrice * carryingRate, currentYear, deathYear);
      if (Number.isInteger(housing.mortgageEndYear)) {
        add("housing.mortgage", "housing", "Mortgage payments", num(housing.mortgagePayment) * 12, currentYear, housing.mortgageEndYear);
      }
    }

    // Kids.
    kids.forEach((kid) => {
      const label = kidLabels.get(kid.id);
      const at = (age) => kid.birthYear + age;
      const childcare = findOption(CHILDCARE, kid.childcare);
      const school = findOption(SCHOOL, kid.school);
      const college = findOption(COLLEGE, kid.college);
      const activities = findOption(ACTIVITIES, kid.activities);
      const prefix = `kid.${kid.id}`;
      add(`${prefix}.basics`, "kids", `${label} · basics (food, clothes, gear)`, local(PRICES.kidBasics), at(0), at(PRICES.kidHomeEndAge));
      add(`${prefix}.childcare`, "kids", `${label} · ${childcare.label.toLowerCase()}`, local(childcare.amount), at(0), at(PRICES.childcareEndAge));
      add(`${prefix}.school`, "kids", `${label} · ${school.label.toLowerCase()} school`, local(school.amount), at(PRICES.schoolStartAge), at(PRICES.kidHomeEndAge));
      add(`${prefix}.activities`, "kids", `${label} · activities & camps`, local(activities.amount), at(PRICES.schoolStartAge), at(PRICES.kidHomeEndAge));
      add(`${prefix}.college`, "kids", `${label} · college (${college.label.toLowerCase()})`, college.amount, at(PRICES.collegeStartAge), at(PRICES.collegeEndAge));
    });

    // Household help: one level while any kid is at home, another otherwise.
    const kidsHomeYears = new Set();
    kids.forEach((kid) => {
      for (let year = kid.birthYear; year <= kid.birthYear + PRICES.kidHomeEndAge; year += 1) kidsHomeYears.add(year);
    });
    const withKidsHelp = findOption(HELP, lifestyle.help.withKids);
    const otherwiseHelp = findOption(HELP, lifestyle.help.otherwise);
    forEachYearRun(currentYear, deathYear, (year) => kidsHomeYears.has(year), (hasKids, startYear, endYear) => {
      const level = hasKids ? withKidsHelp : otherwiseHelp;
      const key = hasKids ? "help.withKids" : "help.otherwise";
      const suffix = kids.length ? (hasKids ? " (kids at home)" : " (no kids at home)") : "";
      add(key, "help", `${level.label}${suffix}`, local(level.amount), startYear, endYear);
    });

    // Travel. Adults pay one room; each kid adds half a room.
    const travel = lifestyle.travel;
    const flight = findOption(FLIGHT_CLASSES, travel.flightClass);
    const hotel = findOption(HOTELS, travel.hotel);
    const tripKinds = [
      { trips: num(travel.domesticTrips), nights: num(travel.domesticNights), index: 0 },
      { trips: num(travel.internationalTrips), nights: num(travel.internationalNights), index: 1 }
    ];
    const travelCost = (travelers, roomShare, includePrivateFlight) => tripKinds.reduce((sum, kind) => {
      const flights = flight.perTrip
        ? (includePrivateFlight ? flight.perTrip[kind.index] : 0)
        : flight.fares[kind.index] * travelers;
      const stay = kind.nights * (hotel.nightly * roomShare + hotel.dailySpend * travelers);
      return sum + kind.trips * (flights + stay);
    }, 0);
    add("travel.adults", "travel", `Travel · ${flight.label.toLowerCase()}, ${hotel.label.toLowerCase()} hotels`,
      travelCost(adults, 1, true), currentYear, deathYear);
    if (travel.kidsTravel) {
      kids.forEach((kid) => {
        add(`kid.${kid.id}.travel`, "travel", `${kidLabels.get(kid.id)} · travel`,
          travelCost(1, 0.5, false), kid.birthYear, kid.birthYear + PRICES.kidHomeEndAge);
      });
    }

    // Everyday living.
    const tierIndex = Math.max(0, EVERYDAY_TIERS.findIndex((tier) => tier.value === lifestyle.everyday.tier));
    const householdFactor = adults === 1 ? SINGLE_ADULT_FACTOR : 1;
    EVERYDAY_LINES.forEach((line) => {
      add(`everyday.${line.key}`, "everyday", line.label, local(line.amounts[tierIndex] * householdFactor), currentYear, deathYear);
    });

    // Health: employer plan (no cost here) until a year, then private insurance,
    // then Medicare at 65 when a birth year is known.
    const employerUntil = Number.isInteger(lifestyle.health.employerUntilYear) ? lifestyle.health.employerUntilYear : currentYear - 1;
    const privateStart = Math.max(currentYear, employerUntil + 1);
    const medicareYear = Number.isInteger(lifestyle.birthYear) ? lifestyle.birthYear + PRICES.medicareAge : deathYear + 1;
    add("health.private", "health", "Private health insurance + out-of-pocket",
      adults * PRICES.privateHealthPerAdult + PRICES.privateHealthOutOfPocket, privateStart, medicareYear - 1);
    add("health.medicare", "health", "Medicare, supplemental + out-of-pocket",
      adults * PRICES.medicarePerAdult, Math.max(privateStart, medicareYear), deathYear);
    kids.forEach((kid) => {
      add(`kid.${kid.id}.health`, "health", `${kidLabels.get(kid.id)} · health insurance`,
        PRICES.privateHealthPerKid, Math.max(privateStart, kid.birthYear), kid.birthYear + PRICES.kidHealthEndAge);
    });

    return items;
  }

  // Calls onRun(value, startYear, endYear) for each run of consecutive years
  // where predicate(year) is constant.
  function forEachYearRun(startYear, endYear, predicate, onRun) {
    let runStart = startYear;
    let runValue = predicate(startYear);
    for (let year = startYear + 1; year <= endYear + 1; year += 1) {
      const value = year <= endYear ? predicate(year) : !runValue;
      if (value !== runValue) {
        onRun(runValue, runStart, year - 1);
        runStart = year;
        runValue = value;
      }
    }
  }

  // Groups items that share a key, for display and editing.
  function groupLifestyleItems(items) {
    const groups = new Map();
    items.forEach((item) => {
      if (!groups.has(item.key)) groups.set(item.key, { ...item, ranges: [] });
      groups.get(item.key).ranges.push([item.startYear, item.endYear]);
    });
    return [...groups.values()].map((group) => ({
      ...group,
      yearsLabel: group.ranges.map(([start, end]) => formatYearRange(start, end)).join(", ")
    }));
  }

  // Lifestyle items as scenario cash flows (fixed years).
  function lifestyleItemsToFlows(items) {
    return items
      .filter((item) => item.amount > 0 && !item.isDetached)
      .map((item) => ({
        name: item.name,
        amount: item.amount,
        startMode: "fixed",
        startYear: item.startYear,
        endMode: "fixed",
        endYear: item.endYear,
        category: item.category,
        oneTime: item.oneTime
      }));
  }

  Object.assign(Planner, {
    LIFESTYLE_OPTIONS: OPTIONS,
    LIFESTYLE_PRICES: PRICES,
    LIFESTYLE_EVERYDAY_LINES: EVERYDAY_LINES,
    LIFESTYLE_SINGLE_ADULT_FACTOR: SINGLE_ADULT_FACTOR,
    SPENDING_CATEGORIES: CATEGORIES,
    LIFESTYLE_MAX_KIDS: MAX_KIDS,
    createKid,
    defaultLifestyle,
    normalizeLifestyle,
    buildLifestyleItems,
    groupLifestyleItems,
    lifestyleItemsToFlows,
    annualMortgagePayment,
    formatYearRange
  });
})(window.Planner = window.Planner || {});
