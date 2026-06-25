window.Planner = window.Planner || {};
Planner.MAX_VISUAL_PATHS = 200;
Planner.SIMULATION_CHUNK_SIZE = 100;
Planner.MIN_PLAN_YEAR = 1900;
Planner.MAX_PLAN_YEAR = 2200;
Planner.MAX_PLAN_LENGTH_YEARS = 120;
Planner.MIN_SIMULATION_COUNT = 100;
Planner.MAX_SIMULATION_COUNT = 200000;
Planner.MAX_SIMULATION_YEAR_ROWS = 12000000;
Planner.MAX_SHARED_FLOWS = 100;
Planner.BETA_MODE_FIXED = "fixed";
Planner.BETA_MODE_DYNAMIC = "dynamic";
Planner.PAGE_IDS = ["overview", "details", "policy", "methodology"];
Planner.DYNAMIC_BETA_VALUES = Array.from({ length: 16 }, (_, index) => Number((index * 0.1).toFixed(1)));
Planner.DYNAMIC_WEALTH_BUCKETS = 180;
Planner.DYNAMIC_FRONTIER_WEALTH_BUCKETS = 30;
Planner.DYNAMIC_MIN_POSITIVE_WEALTH_BUCKET = 10000;
Planner.DYNAMIC_DISPLAY_MAX_WEALTH_BUCKET = 1000000000;
Planner.DYNAMIC_MAX_WEALTH_BUCKET = 1000000000000;
Planner.DYNAMIC_FRONTIER_RISK_PENALTY_FACTORS = [0.1, 0.3, 1, 3, 10];
Planner.DYNAMIC_POLICY_PROGRESS_SHARE = 0.5;
Planner.EPSILON = 0.000000001;
Planner.DEFAULT_INCOME = [
  { name: "Salary", amount: 120000, startMode: "current", startYear: 2026, endMode: "fixed", endYear: 2045 }
];

Planner.DEFAULT_EXPENSES = [
  { name: "Living expenses", amount: 85000, startMode: "current", startYear: 2026, endMode: "death", endYear: 2070 },
  { name: "Healthcare", amount: 22000, startMode: "fixed", startYear: 2046, endMode: "death", endYear: 2070 }
];
