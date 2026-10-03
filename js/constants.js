window.Planner = window.Planner || {};
Planner.MAX_VISUAL_PATHS = 200;
Planner.REQUIRED_WEALTH_PATHS = 20000;
// Frontier policies are simulated on the first this-many required-wealth paths.
Planner.FRONTIER_PATHS = 10000;
// The run's dynamic policy doesn't trade wealth for run-out risk below this.
Planner.ACCEPTABLE_RUN_OUT_RISK = 0.005;
// Risk levels labeled on the How much you need chart; the metric card uses
// REQUIRED_WEALTH_TARGET.
Planner.REQUIRED_WEALTH_LABELS = [0.1, 0.05, 0.01, 0.001];
Planner.REQUIRED_WEALTH_TARGET = 0.01;
Planner.DEFAULT_WITHDRAWAL_TAX_PCT = 15;
Planner.MAX_WITHDRAWAL_TAX_PCT = 60;
Planner.SIMULATION_CHUNK_SIZE = 100;
Planner.MIN_PLAN_YEAR = 1900;
Planner.MAX_PLAN_YEAR = 2200;
Planner.MAX_PLAN_LENGTH_YEARS = 120;
Planner.MIN_SIMULATION_COUNT = 100;
Planner.MAX_SIMULATION_COUNT = 200000;
Planner.MAX_SIMULATION_YEAR_ROWS = 12000000;
Planner.MAX_SHARED_FLOWS = 100;
Planner.DEFAULT_SPX_BETA = 0.8;
Planner.BETA_MODE_FIXED = "fixed";
Planner.BETA_MODE_DYNAMIC = "dynamic";
Planner.PAGE_IDS = ["overview", "spending", "details", "policy", "methodology"];
Planner.DYNAMIC_BETA_VALUES = Array.from({ length: 16 }, (_, index) => Number((index * 0.1).toFixed(1)));
Planner.DYNAMIC_WEALTH_BUCKETS = 180;
Planner.DYNAMIC_MIN_POSITIVE_WEALTH_BUCKET = 10000;
Planner.DYNAMIC_DISPLAY_MAX_WEALTH_BUCKET = 1000000000;
Planner.DYNAMIC_MAX_WEALTH_BUCKET = 1000000000000;
Planner.DYNAMIC_FRONTIER_RISK_PENALTY_FACTORS = [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30, 100];
Planner.DYNAMIC_POLICY_PROGRESS_SHARE = 0.75;
Planner.EPSILON = 0.000000001;
Planner.DEFAULT_INCOME = [
  { name: "Take-home pay", amount: 200000, startMode: "current", startYear: 2026, endMode: "fixed", endYear: 2045 }
];

// The lifestyle builder supplies default spending; manual rows are for extras.
Planner.DEFAULT_EXPENSES = [];
