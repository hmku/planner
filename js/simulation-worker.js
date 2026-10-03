// Runs simulateScenario() off the main thread so the page stays responsive
// during a run. Same code and seed as the inline path, so results are
// identical. The page cancels a run by terminating the worker.
self.window = self;
importScripts("constants.js", "util.js", "format.js", "engine.js", "policy.js", "simulation.js");

// Nothing to yield to here; progress is posted as messages instead.
Planner.yieldToBrowser = () => Promise.resolve();

self.onmessage = async ({ data }) => {
  const { scenario, returnRows, seed } = data;
  let lastPercent = -1;
  const onProgress = (value) => {
    const percent = Math.floor(value * 100);
    if (percent === lastPercent) return;
    lastPercent = percent;
    self.postMessage({ type: "progress", value });
  };
  try {
    const results = await Planner.simulateScenario(scenario, returnRows, Planner.createSeededRandom(seed), onProgress);
    // The page already has the return rows; it reattaches them.
    delete results.returnRows;
    self.postMessage({ type: "done", results }, [results.sampledRowIndexes.buffer]);
  } catch (error) {
    self.postMessage({ type: "error", message: error.message });
  }
};
