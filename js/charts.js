(function (Planner) {
  // Every chart goes through one lifecycle: renderChart() builds a frame with
  // the standard padding, the chart's render(data, frame) draws with the shared
  // helpers below and registers hover targets with trackHover(), and its legend
  // is an HTML list above the canvas (it wraps on narrow screens).
  //
  // Color roles, the same in every chart: theme.series is the main data,
  // theme.seriesStrong is the average/expected line and "You", theme.highlight
  // marks a selected, hovered, or target point, theme.critical marks where a
  // single path depletes, and theme.positive means not depleted.

  // ---------- Theme ----------

  let themeCache = null;

  function parseHex(hex) {
    const value = hex.replace("#", "");
    return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16));
  }

  function chartTheme() {
    if (themeCache) return themeCache;
    const style = getComputedStyle(document.documentElement);
    const token = (name) => style.getPropertyValue(name).trim();
    themeCache = {
      fontFamily: token("--font-sans") || "system-ui, sans-serif",
      surface: token("--chart-surface"),
      grid: token("--chart-grid"),
      axis: token("--chart-axis"),
      ink: token("--chart-ink"),
      text: token("--chart-text"),
      muted: token("--chart-muted"),
      series: token("--chart-series"),
      seriesStrong: token("--chart-series-strong"),
      path: token("--chart-path"),
      highlight: token("--chart-highlight"),
      critical: token("--chart-critical"),
      positive: token("--chart-positive"),
      tooltipBg: token("--chart-tooltip-bg"),
      tooltipInk: token("--chart-tooltip-ink"),
      ramp: token("--chart-ramp").split(",").map((stop) => parseHex(stop.trim())),
      categorical: Array.from({ length: 8 }, (_, index) => token(`--chart-cat-${index + 1}`))
    };
    return themeCache;
  }

  function resetChartTheme() {
    themeCache = null;
  }

  function rampColor(ramp, t) {
    const position = Planner.clamp(t, 0, 1) * (ramp.length - 1);
    const index = Math.min(ramp.length - 2, Math.floor(position));
    const local = position - index;
    const [r, g, b] = ramp[index].map((channel, i) => Math.round(channel + (ramp[index + 1][i] - channel) * local));
    return `rgb(${r}, ${g}, ${b})`;
  }

  function font(frame, size = 12, weight = 400) {
    return `${weight} ${size}px ${frame.theme.fontFamily}`;
  }

  // ---------- Frame and scales ----------

  const CHART_PADDING = { top: 32, right: 24, bottom: 30, left: 64 };
  // Extra bottom room for charts that title their x-axis.
  const X_TITLE_SPACE = 14;

  function beginChart(chartKey, chart) {
    const canvas = Planner.els[chart.canvas];
    const { ctx, width, height } = Planner.fitCanvas(canvas);
    const theme = chartTheme();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = theme.surface;
    ctx.fillRect(0, 0, width, height);
    const padding = { ...CHART_PADDING, ...chart.padding };
    if (chart.xTitle) padding.bottom += X_TITLE_SPACE;
    const left = padding.left;
    const top = padding.top;
    const right = Math.max(left + 1, width - padding.right);
    const bottom = Math.max(top + 1, height - padding.bottom);
    return {
      key: chartKey,
      canvas,
      ctx,
      theme,
      width,
      height,
      left,
      top,
      right,
      bottom,
      plotWidth: right - left,
      plotHeight: bottom - top,
      legend: []
    };
  }

  function linearScale(domainMin, domainMax, rangeMin, rangeMax) {
    const span = domainMax - domainMin || 1;
    return (value) => rangeMin + ((value - domainMin) / span) * (rangeMax - rangeMin);
  }

  function logScale(domainMin, domainMax, rangeMin, rangeMax) {
    const logMin = Math.log(domainMin);
    const logSpan = Math.log(domainMax) - logMin || 1;
    return (value) => {
      const clamped = Planner.clamp(value, domainMin, domainMax);
      return rangeMin + ((Math.log(clamped) - logMin) / logSpan) * (rangeMax - rangeMin);
    };
  }

  function paddedScale(values, minLimit, maxLimit, paddingShare) {
    const finiteValues = values.filter(Number.isFinite);
    const minValue = finiteValues.length ? Math.min(...finiteValues) : minLimit;
    const maxValue = finiteValues.length ? Math.max(...finiteValues) : minLimit + 1;
    const span = maxValue - minValue > 1e-9 ? maxValue - minValue : Math.max(1e-6, Math.abs(maxValue || 1));
    const min = Math.max(minLimit, minValue - span * paddingShare);
    const max = Math.min(maxLimit, maxValue + span * paddingShare);
    return { min, max: max > min ? max : min + 1e-6 };
  }

  // Drops ticks that would land closer than minGap pixels to the previous kept
  // one, so labels never run together on narrow charts.
  function spaceTicks(ticks, toPixel, minGap) {
    return ticks.reduce((kept, tick) => {
      if (!kept.length || Math.abs(toPixel(tick) - toPixel(kept[kept.length - 1])) >= minGap) kept.push(tick);
      return kept;
    }, []);
  }

  // Ticks for a log axis: the finest regular set (1-1.5-2-3-5-7, 1-2-5, or
  // powers of ten) whose labels all fit at least minGap apart with at most
  // eight ticks; otherwise powers of ten, thinned to fit.
  function logAxisTicks(min, max, toPixel, minGap) {
    const ticksFor = (steps) => {
      const ticks = [];
      for (let power = Math.floor(Math.log10(min)); 10 ** power <= max; power += 1) {
        steps.forEach((step) => {
          const tick = step * 10 ** power;
          if (tick >= min * (1 - 1e-9) && tick <= max * (1 + 1e-9)) ticks.push(tick);
        });
      }
      return ticks;
    };
    const fits = (ticks) => ticks.length <= 8 && ticks.every((tick, index) => (
      index === 0 || Math.abs(toPixel(tick) - toPixel(ticks[index - 1])) >= minGap
    ));
    for (const steps of [[1, 1.5, 2, 3, 5, 7], [1, 2, 5], [1]]) {
      const ticks = ticksFor(steps);
      if (ticks.length >= 2 && fits(ticks)) return ticks;
    }
    return spaceTicks(ticksFor([1]), toPixel, minGap);
  }

  // Even bar slots across the plot, with a small gap once bars are wide enough.
  function barLayout(frame, count) {
    const band = frame.plotWidth / count;
    const gap = band > 6 ? 2 : band > 3 ? 1 : 0;
    return {
      band,
      slot: (index) => ({ x0: frame.left + index * band, x1: frame.left + (index + 1) * band }),
      bar: (index) => ({ x: frame.left + index * band + gap / 2, width: Math.max(1, band - gap) }),
      center: (index) => frame.left + (index + 0.5) * band
    };
  }

  // ---------- Primitives ----------

  function withPlotClip(frame, draw) {
    const { ctx } = frame;
    ctx.save();
    ctx.beginPath();
    ctx.rect(frame.left, frame.top - 1, frame.plotWidth, frame.plotHeight + 2);
    ctx.clip();
    draw();
    ctx.restore();
  }

  function strokePolyline(ctx, points, color, width) {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  }

  function drawDot(frame, x, y, radius, color) {
    const { ctx } = frame;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = frame.theme.surface;
    ctx.stroke();
  }

  function fillRoundedTop(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height);
    ctx.beginPath();
    ctx.moveTo(x, y + height);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.lineTo(x + width - r, y);
    ctx.arcTo(x + width, y, x + width, y + r, r);
    ctx.lineTo(x + width, y + height);
    ctx.closePath();
    ctx.fill();
  }

  // Text in chart ink (never a series color; the mark beside it carries identity).
  function drawLabel(frame, text, x, y, { align = "left", baseline = "alphabetic", size = 12, weight = 500, color } = {}) {
    const { ctx, theme } = frame;
    ctx.font = font(frame, size, weight);
    ctx.fillStyle = color || theme.text;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(text, x, y);
    ctx.textBaseline = "alphabetic";
  }

  // A dashed guide across the plot at a value (vertical with x, horizontal with y).
  function drawReferenceLine(frame, { x, y, color }) {
    const { ctx, theme } = frame;
    ctx.save();
    ctx.strokeStyle = color || theme.muted;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    if (Number.isFinite(x)) {
      ctx.moveTo(x, frame.top);
      ctx.lineTo(x, frame.bottom);
    } else {
      ctx.moveTo(frame.left, y);
      ctx.lineTo(frame.right, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ---------- Axes, legend, empty state, tooltip ----------

  function drawYAxis(frame, ticks, yOf, format) {
    const { ctx, theme } = frame;
    ctx.font = font(frame, 11.5);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ticks.forEach((tick) => {
      const y = Math.round(yOf(tick)) + 0.5;
      if (y < frame.top - 1 || y > frame.bottom + 1) return;
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(frame.left, y);
      ctx.lineTo(frame.right, y);
      ctx.stroke();
      ctx.fillStyle = theme.muted;
      ctx.fillText(format(tick), frame.left - 8, y);
    });
    ctx.textBaseline = "alphabetic";
  }

  function drawXAxis(frame, ticks, xOf, format) {
    const { ctx, theme } = frame;
    ctx.strokeStyle = theme.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(frame.left, Math.round(frame.bottom) + 0.5);
    ctx.lineTo(frame.right, Math.round(frame.bottom) + 0.5);
    ctx.stroke();

    ctx.font = font(frame, 11.5);
    ctx.fillStyle = theme.muted;
    ctx.textAlign = "center";
    ticks.forEach((tick) => {
      const x = xOf(tick);
      if (x < frame.left - 1 || x > frame.right + 1) return;
      ctx.fillText(format(tick), x, frame.bottom + 18);
    });
  }

  // Plan years along the x-axis; xOf maps a year to its pixel (continuous or
  // band centers, as the chart lays them out).
  function drawYearAxis(frame, years, xOf) {
    const count = Math.max(3, Math.min(8, Math.floor(frame.plotWidth / 80)));
    drawXAxis(frame, Planner.niceTicks(years[0], years[years.length - 1], count, { integer: true }), xOf, String);
  }

  function yearScale(frame, years) {
    return linearScale(years[0], years[years.length - 1], frame.left, frame.right);
  }

  function drawAxisTitle(frame, text) {
    drawLabel(frame, text, frame.left - Math.min(frame.left - 8, 56), 16, { weight: 500 });
  }

  function drawXAxisTitle(frame, text) {
    drawLabel(frame, text, frame.right, frame.height - 6, { align: "right", weight: 500 });
  }

  // Items: { label, color, shape: "line" | "dot" | "ramp" }. Collected during
  // render and written to the chart's HTML legend afterwards.
  function drawLegend(frame, items) {
    frame.legend = items;
  }

  function chartLegendElement(canvas) {
    const wrap = canvas.closest(".canvas-wrap");
    let legend = wrap.previousElementSibling;
    if (!legend || !legend.classList.contains("chart-legend")) {
      legend = document.createElement("ul");
      legend.className = "chart-legend";
      legend.setAttribute("aria-label", "Legend");
      wrap.before(legend);
    }
    return legend;
  }

  function syncLegend(frame) {
    const legend = chartLegendElement(frame.canvas);
    const signature = JSON.stringify(frame.legend);
    if (legend.dataset.signature === signature) return;
    legend.dataset.signature = signature;
    legend.replaceChildren(...frame.legend.map((item) => {
      const entry = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = `legend-swatch legend-${item.shape || "dot"}`;
      if (item.color) swatch.style.background = item.color;
      entry.append(swatch, item.label);
      return entry;
    }));
  }

  function drawEmptyState(frame, message) {
    drawLabel(frame, message, frame.width / 2, frame.height / 2, { align: "center", size: 13, weight: 400, color: frame.theme.muted });
  }

  function drawTooltip(frame, anchorX, anchorY, title, lines) {
    const { ctx, theme } = frame;
    const padding = 10;
    const lineHeight = 18;
    ctx.font = font(frame, 12.5, 600);
    let boxWidth = ctx.measureText(title).width;
    ctx.font = font(frame, 12.5);
    lines.forEach((line) => {
      boxWidth = Math.max(boxWidth, ctx.measureText(line).width);
    });
    boxWidth += padding * 2;
    const boxHeight = padding * 2 + lineHeight * (lines.length + 1) - 4;

    let x = anchorX + 14;
    if (x + boxWidth > frame.width - 6) x = anchorX - 14 - boxWidth;
    x = Planner.clamp(x, 6, Math.max(6, frame.width - boxWidth - 6));
    const y = Planner.clamp(anchorY - boxHeight - 10, 6, Math.max(6, frame.height - boxHeight - 6));

    ctx.fillStyle = theme.tooltipBg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, boxWidth, boxHeight, 6);
    else ctx.rect(x, y, boxWidth, boxHeight);
    ctx.fill();

    ctx.fillStyle = theme.tooltipInk;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = font(frame, 12.5, 600);
    ctx.fillText(title, x + padding, y + padding);
    ctx.font = font(frame, 12.5);
    lines.forEach((line, index) => {
      ctx.fillText(line, x + padding, y + padding + lineHeight * (index + 1));
    });
    ctx.textBaseline = "alphabetic";
  }

  function drawCrosshair(frame, x, y) {
    const { ctx, theme } = frame;
    ctx.save();
    ctx.strokeStyle = theme.axis;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, frame.top);
    ctx.lineTo(x, frame.bottom);
    if (Number.isFinite(y)) {
      ctx.moveTo(frame.left, y);
      ctx.lineTo(frame.right, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // The standard hover for point-like items: crosshair, enlarged dot, tooltip.
  function drawHoverPoint(frame, item, { color, title, lines, horizontal = true }) {
    drawCrosshair(frame, item.x, horizontal ? item.y : null);
    drawDot(frame, item.x, item.y, 5.5, color || frame.theme.series);
    drawTooltip(frame, item.x, item.y, title, lines);
  }

  // ---------- Hover ----------

  const hoverByChart = {};
  const hitMetaByChart = {};
  let pendingHoverRender = null;

  // Registers a chart's hover targets and returns the current hover ({ item,
  // x, y }) or null. The hovered item stays stable across re-renders by key.
  function trackHover(frame, items) {
    hitMetaByChart[frame.key] = { items, frame };
    const hover = hoverByChart[frame.key];
    if (!hover) return null;
    const item = items.find((candidate) => candidate.key === hover.item.key);
    if (!item) {
      hoverByChart[frame.key] = null;
      return null;
    }
    hover.item = item;
    return hover;
  }

  // For charts whose targets are computed from the pointer (heatmap cells).
  function trackHoverLookup(frame, lookup) {
    hitMetaByChart[frame.key] = { lookup, frame };
    return hoverByChart[frame.key] || null;
  }

  function clearHover() {
    Object.keys(hoverByChart).forEach((key) => {
      hoverByChart[key] = null;
    });
  }

  function findNearestPath(meta, x, y) {
    let nearest = null;
    let nearestDistance = 10;
    for (const item of meta.items) {
      for (let index = 1; index < item.points.length; index += 1) {
        const distance = Planner.distanceToSegment(x, y, item.points[index - 1], item.points[index]);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = item;
        }
      }
    }
    return nearest;
  }

  function findNearestPoint(meta, x, y) {
    let nearest = null;
    let nearestDistance = 24;
    for (const item of meta.items) {
      const distance = Math.hypot(x - item.x, y - item.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = item;
      }
    }
    return nearest;
  }

  function findNearestX(meta, x, y) {
    if (y < meta.frame.top - 8 || y > meta.frame.bottom + 8) return null;
    if (x < meta.frame.left - 12 || x > meta.frame.right + 12) return null;
    let nearest = null;
    let nearestDistance = Infinity;
    for (const item of meta.items) {
      const distance = Math.abs(x - item.x);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = item;
      }
    }
    return nearest;
  }

  function findBar(meta, x, y) {
    if (y < meta.frame.top || y > meta.frame.bottom) return null;
    return meta.items.find((item) => x >= item.x0 && x <= item.x1) || null;
  }

  function findCell(meta, x, y) {
    return meta.lookup ? meta.lookup(x, y) : null;
  }

  // ---------- Registry ----------

  const CHARTS = {
    netWorth: { canvas: "pathsCanvas", page: "overview", render: renderNetWorthChart, find: findNearestPath, padding: { right: 64 } },
    frontier: { canvas: "frontierCanvas", page: "overview", render: renderFrontierChart, find: findNearestPoint, xTitle: true },
    requiredWealth: { canvas: "requiredWealthCanvas", page: "overview", render: renderRequiredWealthChart, find: findNearestX, xTitle: true },
    beta: { canvas: "betaCanvas", page: "overview", render: renderBetaChart, find: findNearestPath },
    distribution: { canvas: "distributionCanvas", page: "overview", render: renderDistributionChart, find: findBar },
    detail: { canvas: "selectedSimulationCanvas", page: "details", render: renderSelectedSimulationChart, find: findNearestX },
    policyBucket: { canvas: "dynamicPolicyCanvas", page: "policy", render: renderPolicyBucketChart, find: findNearestX },
    policyPath: { canvas: "policyPathCanvas", page: "policy", render: renderPolicyPathChart, find: findCell },
    // Drawn from the current inputs, so it works before any run.
    spending: { canvas: "spendingCanvas", page: "spending", render: renderSpendingChart, find: findBar, fromInputs: true }
  };

  function chartData(chart, results = Planner.state.results) {
    return chart.fromInputs ? Planner.getSpendingModel() : results;
  }

  function drawChart(chartKey, data) {
    const chart = CHARTS[chartKey];
    hitMetaByChart[chartKey] = null;
    const frame = beginChart(chartKey, chart);
    chart.render(data, frame);
    syncLegend(frame);
  }

  function renderChart(chartKey) {
    const data = chartData(CHARTS[chartKey]);
    if (data) drawChart(chartKey, data);
  }

  // Draws the active page's charts; result charts are skipped until a run exists.
  function renderCharts(results) {
    Object.entries(CHARTS).forEach(([chartKey, chart]) => {
      if (chart.page !== Planner.state.activePage) return;
      const data = chartData(chart, results);
      if (data) drawChart(chartKey, data);
    });
  }

  function scheduleHoverRender(chartKey) {
    if (pendingHoverRender) return;
    pendingHoverRender = window.requestAnimationFrame(() => {
      pendingHoverRender = null;
      renderChart(chartKey);
    });
  }

  function bindChartHover() {
    Object.entries(CHARTS).forEach(([chartKey, chart]) => {
      const canvas = Planner.els[chart.canvas];
      canvas.addEventListener("mousemove", (event) => {
        const meta = hitMetaByChart[chartKey];
        if (!chartData(chart) || Planner.state.activePage !== chart.page || !meta) return;
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const item = chart.find(meta, x, y);
        if (!item && !hoverByChart[chartKey]) return;
        hoverByChart[chartKey] = item ? { item, x, y } : null;
        scheduleHoverRender(chartKey);
      });
      canvas.addEventListener("mouseleave", () => {
        if (!hoverByChart[chartKey]) return;
        hoverByChart[chartKey] = null;
        renderChart(chartKey);
      });
    });
  }

  // ---------- Shared chart bodies ----------

  // Sample simulation paths (thin), an expected/average line (strong), and the
  // hovered path highlighted, with the same tooltip wherever paths appear.
  function drawSamplePaths(frame, results, { pointsOf, expected, xOf, yOf, expectedLabel }) {
    const { ctx, theme } = frame;
    const items = results.visualPaths.map((path) => ({
      key: path.simulation,
      path,
      points: pointsOf(path).map((point) => ({ x: xOf(point.year), y: yOf(point.value) }))
    }));
    const hover = trackHover(frame, items);
    const expectedPoints = expected.map((point) => ({ x: xOf(point.year), y: yOf(point.value) }));

    withPlotClip(frame, () => {
      items.forEach((item) => strokePolyline(ctx, item.points, theme.path, 1));
      strokePolyline(ctx, expectedPoints, theme.seriesStrong, 2.5);
      if (hover) strokePolyline(ctx, hover.item.points, theme.highlight, 2);
    });

    drawLegend(frame, [
      { label: expectedLabel, color: theme.seriesStrong, shape: "line" },
      { label: `${results.visualPaths.length} sample paths`, color: theme.series, shape: "line" }
    ]);
    if (hover) {
      const { path } = hover.item;
      drawTooltip(frame, hover.x, hover.y, `Simulation #${Planner.formatNumber(path.simulation)}`, [
        `Ending wealth: ${Planner.formatMoney(path.terminalWealth)}`,
        `Ending percentile: ${Planner.formatPercent(path.endingPercentile)}`,
        `Avg real SPX return: ${Planner.formatPercent(path.averageRealSpxReturn)}`,
        path.failureYear ? `Depleted in ${path.failureYear}` : "Not depleted"
      ]);
    }
  }

  // ---------- Overview: net worth ----------

  function getNetWorthYAxisMax(results) {
    const percentileCap = Number(Planner.els.netWorthZoom.value) / 100;
    if (percentileCap >= 1) {
      return Math.max(
        1,
        results.scenario.netWorth,
        ...results.expectedPath.map((point) => point.wealth),
        ...results.visualPaths.flatMap((path) => path.points.map((point) => point.wealth))
      );
    }
    const cap = Planner.percentileOfSorted(results.terminalWealthSorted, percentileCap);
    return Math.max(1, results.scenario.netWorth, cap || 0);
  }

  function updateNetWorthZoomLabel() {
    Planner.els.netWorthZoomLabel.textContent = `${Number(Planner.els.netWorthZoom.value)}%`;
  }

  function renderNetWorthChart(results, frame) {
    const { years } = results;
    const yScale = Planner.niceZeroScale(getNetWorthYAxisMax(results), 5);
    const xOf = yearScale(frame, years);
    const yOf = linearScale(0, yScale.max, frame.bottom, frame.top);

    drawAxisTitle(frame, "Net worth (current $)");
    drawYAxis(frame, yScale.ticks, yOf, Planner.formatMoney);
    drawYearAxis(frame, years, xOf);
    drawEndingPercentileLabels(frame, results, yOf, yScale.max);
    drawSamplePaths(frame, results, {
      pointsOf: (path) => path.points.map((point) => ({ year: point.year, value: point.wealth })),
      expected: results.expectedPath.map((point) => ({ year: point.year, value: point.wealth })),
      xOf,
      yOf,
      expectedLabel: "Expected"
    });
  }

  function drawEndingPercentileLabels(frame, results, yOf, maxWealth) {
    drawLabel(frame, "End pctl", frame.right + 10, frame.top - 8, { size: 11.5, weight: 400 });
    let lastY = Infinity;
    [0.25, 0.5, 0.75, 0.9, 0.95, 0.99].forEach((p) => {
      const wealth = Planner.percentileOfSorted(results.terminalWealthSorted, p) || 0;
      if (wealth > maxWealth) return;
      const y = yOf(wealth);
      if (lastY - y < 16 || y < frame.top + 4) return;
      drawLabel(frame, `p${Math.round(p * 100)}`, frame.right + 10, y + 4, { size: 11.5, weight: 400, color: frame.theme.muted });
      lastY = y;
    });
  }

  // ---------- Overview: SPX beta ----------

  function renderBetaChart(results, frame) {
    const { years, scenario } = results;
    const isFixed = scenario.betaMode !== Planner.BETA_MODE_DYNAMIC;
    const ticks = Planner.niceTicks(Math.min(0, scenario.spxBeta || 0), Math.max(1.5, scenario.spxBeta || 0), 3);
    const yOf = linearScale(ticks[0], ticks[ticks.length - 1], frame.bottom, frame.top);
    const xOf = yearScale(frame, years);

    Planner.els.betaPathSummary.textContent = isFixed
      ? `Fixed beta ${Planner.formatBeta(scenario.spxBeta)} on every active path.`
      : "Average recommended beta across active paths, with downsampled simulation paths.";

    drawAxisTitle(frame, "SPX beta");
    drawYAxis(frame, ticks, yOf, Planner.formatBeta);
    drawYearAxis(frame, years, xOf);
    const finiteBeta = (points) => points
      .filter((point) => Number.isFinite(point.beta))
      .map((point) => ({ year: point.year, value: point.beta }));
    drawSamplePaths(frame, results, {
      pointsOf: (path) => finiteBeta(path.betaPoints),
      expected: finiteBeta(results.expectedBetaPath),
      xOf,
      yOf,
      expectedLabel: "Average"
    });
  }

  // ---------- Overview: depletion distribution ----------

  function renderDistributionChart(results, frame) {
    const { ctx, theme } = frame;
    const total = results.scenario.simulationCount;
    const rows = Planner.els.showDepleted.checked
      ? results.depletedDistribution
      : [...results.depletedDistribution, { label: "Not depleted", count: results.notDepletedCount, isNotDepleted: true }];

    drawAxisTitle(frame, "Probability");
    if (!rows.length) {
      drawEmptyState(frame, "No simulated paths depleted before the year of death.");
      return;
    }

    const yScale = Planner.niceZeroScale(Math.max(...rows.map((row) => row.count / total), 0.001), 4);
    const yOf = linearScale(0, yScale.max, frame.bottom, frame.top);
    // Probabilities here are often fractions of a percent; keep their precision.
    drawYAxis(frame, yScale.ticks, yOf, Planner.formatPolicyRiskPercent);

    const layout = barLayout(frame, rows.length);
    const items = rows.map((row, index) => ({ key: row.label, row, index, probability: row.count / total, ...layout.slot(index) }));
    const hover = trackHover(frame, items);

    items.forEach((item) => {
      const y = yOf(item.probability);
      const { x, width } = layout.bar(item.index);
      const baseColor = item.row.isNotDepleted ? theme.positive : theme.series;
      ctx.fillStyle = hover && hover.item === item ? theme.highlight : baseColor;
      fillRoundedTop(ctx, x, y, width, frame.bottom - y, 3);
    });

    const labelEvery = Math.max(1, Math.ceil(44 / layout.band));
    drawXAxis(
      frame,
      items.filter((item, index) => item.row.isNotDepleted || index % labelEvery === 0),
      (item) => layout.center(item.index),
      (item) => item.row.label
    );
    // One series needs no legend; with the Not depleted bar there are two.
    if (rows.some((row) => row.isNotDepleted)) {
      drawLegend(frame, [
        { label: "Depleted that year", color: theme.series, shape: "square" },
        { label: "Not depleted", color: theme.positive, shape: "square" }
      ]);
    }

    if (hover) {
      const { row, probability } = hover.item;
      drawTooltip(frame, hover.x, hover.y, row.isNotDepleted ? "Not depleted" : `Depleted in ${row.label}`, [
        `Probability: ${Planner.formatPolicyRiskPercent(probability)}`,
        `${Planner.formatNumber(row.count)} of ${Planner.formatNumber(total)} paths`
      ]);
    }
  }

  // ---------- Simulation detail ----------

  function renderSelectedSimulationChart(results, frame) {
    const { ctx, theme } = frame;
    const rows = Planner.getSelectedSimulationRows(results);
    if (!rows.length) {
      drawEmptyState(frame, "No rows for this simulation.");
      return;
    }

    const { years } = results;
    const yScale = Planner.niceZeroScale(Math.max(1, ...rows.flatMap((row) => [row.startingWealth, row.endingWealth])), 4);
    const xOf = yearScale(frame, years);
    const yOf = linearScale(0, yScale.max, frame.bottom, frame.top);

    drawAxisTitle(frame, "Net worth (current $)");
    drawYAxis(frame, yScale.ticks, yOf, Planner.formatMoney);
    drawYearAxis(frame, years, xOf);

    const items = rows.map((row) => ({ key: row.year, row, x: xOf(row.year), y: yOf(row.endingWealth) }));
    const hover = trackHover(frame, items);
    const depletion = items.find((item) => item.row.depletedThisYear);

    withPlotClip(frame, () => {
      ctx.beginPath();
      ctx.moveTo(items[0].x, frame.bottom);
      items.forEach((item) => ctx.lineTo(item.x, item.y));
      ctx.lineTo(items[items.length - 1].x, frame.bottom);
      ctx.closePath();
      ctx.fillStyle = theme.path;
      ctx.fill();
      strokePolyline(ctx, items, theme.series, 2);
    });
    if (depletion) drawDot(frame, depletion.x, depletion.y, 5.5, theme.critical);
    drawLegend(frame, [
      { label: "Ending wealth", color: theme.series, shape: "line" },
      ...(depletion ? [{ label: "Depleted", color: theme.critical, shape: "dot" }] : [])
    ]);

    if (hover) {
      const { row } = hover.item;
      const lines = [`Ending wealth: ${Planner.formatMoney(row.endingWealth)}`];
      if (row.historicalReturnYear) {
        lines.push(`Sampled ${row.historicalReturnYear}: SPX ${Planner.formatPercent(row.nominalSpxReturn)}`);
        lines.push(`Beta ${Planner.formatBeta(row.spxBetaUsed)} · real ${Planner.formatPercent(row.portfolioRealReturn)}`);
      }
      if (row.depletedThisYear) lines.push("Depleted this year");
      drawHoverPoint(frame, hover.item, { title: String(row.year), lines, horizontal: false });
    }
  }

  // ---------- Beta policy: wealth bucket plot ----------

  const POLICY_METRICS = {
    beta: { label: "Optimal SPX beta", value: (row) => row.beta, format: Planner.formatBeta },
    risk: { label: "Run-out risk", value: (row) => row.estimatedDepletionRisk, format: Planner.formatPolicyRiskPercent },
    terminalWealth: { label: "Expected terminal wealth", value: (row) => row.expectedTerminalWealth, format: Planner.formatMoney }
  };

  function getPolicyMetric(metric) {
    return POLICY_METRICS[metric] || POLICY_METRICS.beta;
  }

  function renderPolicyBucketChart(results, frame) {
    const { ctx, theme } = frame;
    const view = results.dynamicPolicy ? Planner.getPolicyBucketView(results) : null;
    const rows = view ? view.rows.filter((row) => row.wealth > 0) : [];
    if (!rows.length) {
      drawEmptyState(frame, "No visible wealth buckets for this year.");
      return;
    }

    const metric = getPolicyMetric(view.metric);
    const values = rows.map(metric.value);
    let yOf;
    let yTicks;
    if (view.metric === "terminalWealth") {
      const positive = values.filter((value) => value > 0);
      const min = positive.length ? Math.min(...positive) : 1;
      const max = Math.max(min * 10, ...values);
      yOf = logScale(min, max, frame.bottom, frame.top);
      yTicks = logAxisTicks(min, max, yOf, 22);
    } else {
      const scale = Planner.niceZeroScale(Math.max(view.metric === "beta" ? 1.5 : 0.01, ...values), 4);
      yOf = linearScale(0, scale.max, frame.bottom, frame.top);
      yTicks = scale.ticks;
    }
    const minWealth = rows[0].wealth;
    const maxWealth = rows[rows.length - 1].wealth;
    const xOf = logScale(minWealth, maxWealth, frame.left, frame.right);

    drawAxisTitle(frame, metric.label);
    drawYAxis(frame, yTicks, yOf, metric.format);
    drawXAxis(frame, logAxisTicks(minWealth, maxWealth, xOf, 52), xOf, Planner.formatMoney);

    const items = rows.map((row, index) => ({ key: row.bucketIndex, row, x: xOf(row.wealth), y: yOf(Math.max(0, values[index])) }));
    const hover = trackHover(frame, items);

    withPlotClip(frame, () => strokePolyline(ctx, items, theme.series, 2));

    const netWorth = results.scenario.netWorth;
    const showYou = view.isCurrentYear && netWorth >= minWealth && netWorth <= maxWealth;
    if (showYou) {
      drawReferenceLine(frame, { x: xOf(netWorth) });
      const marker = items.find((item) => item.row.bucketIndex === view.currentBucketIndex);
      if (marker) drawDot(frame, marker.x, marker.y, 5.5, theme.seriesStrong);
    }
    drawLegend(frame, [
      { label: metric.label, color: theme.series, shape: "line" },
      ...(showYou ? [{ label: "You", color: theme.seriesStrong, shape: "dot" }] : [])
    ]);

    if (hover) {
      const { row } = hover.item;
      drawHoverPoint(frame, hover.item, {
        title: `Wealth ${Planner.formatMoney(row.wealth)}`,
        lines: [
          `Optimal beta: ${Planner.formatBeta(row.beta)}`,
          `Run-out risk: ${Planner.formatPolicyRiskPercent(row.estimatedDepletionRisk)}`,
          `Expected terminal wealth: ${Planner.formatMoney(row.expectedTerminalWealth)}`
        ]
      });
    }
  }

  // ---------- Beta policy: heatmap with forced path ----------

  function renderPolicyPathChart(results, frame) {
    const { ctx, theme } = frame;
    const policy = results.dynamicPolicy;
    const explorer = results.policyPathExplorer;
    if (!policy || !explorer) {
      drawEmptyState(frame, "Run dynamic beta to inspect a policy path.");
      return;
    }

    const buckets = policy.wealthBuckets
      .map((wealth, bucketIndex) => ({ wealth, bucketIndex }))
      .filter((bucket) => bucket.wealth > 0 && bucket.wealth <= Planner.DYNAMIC_DISPLAY_MAX_WEALTH_BUCKET);
    if (!buckets.length) {
      drawEmptyState(frame, "No visible wealth buckets for this policy.");
      return;
    }

    const { years } = results;
    const cellWidth = frame.plotWidth / years.length;
    const cellHeight = frame.plotHeight / buckets.length;
    const minWealth = buckets[0].wealth;
    const maxWealth = buckets[buckets.length - 1].wealth;
    const maxBeta = Math.max(...policy.betaValues);
    // Buckets are log-spaced, so wealth maps to a fractional bucket position.
    const bucketPosition = logScale(minWealth, maxWealth, 0, buckets.length - 1);
    const yOfWealth = (wealth) => (wealth <= 0 ? frame.bottom : frame.bottom - (bucketPosition(wealth) + 0.5) * cellHeight);
    const xOfYearIndex = (yearIndex) => frame.left + (yearIndex + 0.5) * cellWidth;

    drawAxisTitle(frame, "Wealth");
    years.forEach((year, yearIndex) => {
      const policyRow = policy.policyByYear[yearIndex] || [];
      buckets.forEach((bucket, visibleIndex) => {
        ctx.fillStyle = rampColor(theme.ramp, (policyRow[bucket.bucketIndex] ?? 0) / maxBeta);
        ctx.fillRect(
          frame.left + yearIndex * cellWidth,
          frame.bottom - (visibleIndex + 1) * cellHeight,
          cellWidth + 0.6,
          cellHeight + 0.6
        );
      });
    });
    drawYAxis(frame, logAxisTicks(minWealth, maxWealth, yOfWealth, 22), yOfWealth, Planner.formatMoney);
    drawYearAxis(frame, years, (year) => xOfYearIndex(year - years[0]));

    const pathPoints = explorer.points.map((point) => ({
      x: xOfYearIndex(Planner.clamp(point.year - years[0], 0, years.length - 1)),
      y: yOfWealth(point.wealth)
    }));
    withPlotClip(frame, () => {
      strokePolyline(ctx, pathPoints, theme.surface, 5);
      strokePolyline(ctx, pathPoints, theme.highlight, 2.5);
    });
    pathPoints.forEach((point, index) => {
      drawDot(frame, point.x, point.y, index === pathPoints.length - 1 ? 5 : 4, index === 0 ? theme.seriesStrong : theme.highlight);
    });

    const hover = trackHoverLookup(frame, (x, y) => {
      if (x < frame.left || x > frame.right || y < frame.top || y > frame.bottom) return null;
      const yearIndex = Math.min(years.length - 1, Math.floor((x - frame.left) / cellWidth));
      const visibleIndex = Math.min(buckets.length - 1, Math.floor((frame.bottom - y) / cellHeight));
      const bucket = buckets[visibleIndex];
      return { key: `${yearIndex}:${bucket.bucketIndex}`, yearIndex, bucket, visibleIndex };
    });
    if (hover) {
      const { yearIndex, bucket, visibleIndex } = hover.item;
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(frame.left + yearIndex * cellWidth, frame.bottom - (visibleIndex + 1) * cellHeight, cellWidth, cellHeight);
      drawTooltip(frame, hover.x, hover.y, String(years[yearIndex]), [
        `Wealth ≈ ${Planner.formatMoney(bucket.wealth)}`,
        `Policy beta: ${Planner.formatBeta(policy.policyByYear[yearIndex]?.[bucket.bucketIndex])}`,
        `Run-out risk: ${Planner.formatPolicyRiskPercent(policy.valueByYear[yearIndex]?.[bucket.bucketIndex])}`
      ]);
    }

    drawLegend(frame, [
      { label: "Forced path", color: theme.highlight, shape: "line" },
      { label: "Start", color: theme.seriesStrong, shape: "dot" },
      { label: `Beta 0–${Planner.formatBeta(maxBeta)}`, shape: "ramp" }
    ]);
  }

  // ---------- Overview: frontier ----------

  // Expected and median terminal wealth against run-out risk for each policy,
  // simulated on shared paths. Log wealth axis: the mean and the median of
  // these skewed outcomes can be far apart.
  function renderFrontierChart(results, frame) {
    const { ctx, theme } = frame;
    const rows = results.dynamicPolicy?.frontier || [];
    if (!rows.length) {
      drawEmptyState(frame, "Run dynamic beta to compare risk and expected wealth policies.");
      return;
    }

    const series = [
      { key: "expected", label: "Expected", color: theme.seriesStrong, value: (row) => row.expectedTerminalWealth },
      { key: "median", label: "Median", color: theme.series, value: (row) => row.medianTerminalWealth }
    ];
    const wealthValues = rows.flatMap((row) => series.map((line) => line.value(row))).filter((value) => value > 0);
    const minWealth = wealthValues.length ? Math.min(...wealthValues) / 1.25 : 1;
    const maxWealth = Math.max(minWealth * 10, ...wealthValues) * 1.25;
    const riskScale = paddedScale(rows.map((row) => row.depletionRisk), 0, 1, 0.08);
    const xOf = linearScale(riskScale.min, riskScale.max, frame.left, frame.right);
    const yOf = logScale(minWealth, maxWealth, frame.bottom, frame.top);

    drawAxisTitle(frame, "Terminal wealth");
    drawYAxis(frame, logAxisTicks(minWealth, maxWealth, yOf, 22), yOf, Planner.formatMoney);
    const xTicks = spaceTicks(Planner.niceTicks(riskScale.min, riskScale.max, 5), xOf, 52);
    drawXAxis(frame, xTicks, xOf, Planner.formatPolicyRiskPercent);
    drawXAxisTitle(frame, "Run-out risk");

    const items = series.flatMap((line) => rows.map((row) => ({
      key: `${line.key}:${row.label}`,
      row,
      line,
      x: xOf(row.depletionRisk),
      y: yOf(Math.max(minWealth, line.value(row)))
    })));
    const hover = trackHover(frame, items);
    const colorOf = (item) => (item.row.isChosen ? theme.highlight : item.line.color);

    series.forEach((line) => withPlotClip(frame, () => strokePolyline(ctx, items.filter((item) => item.line === line), line.color, 2)));
    items.forEach((item) => drawDot(frame, item.x, item.y, item.row.isChosen ? 5.5 : 4, colorOf(item)));

    drawLegend(frame, [
      ...series.map((line) => ({ label: line.label, color: line.color, shape: "line" })),
      { label: "Policy the run uses", color: theme.highlight, shape: "dot" }
    ]);
    if (hover) {
      const { row } = hover.item;
      drawHoverPoint(frame, hover.item, {
        color: colorOf(hover.item),
        title: row.isChosen ? `${row.label} (used for the run)` : row.label,
        lines: [
          `Run-out risk: ${Planner.formatPolicyRiskPercent(row.depletionRisk)}`,
          `Expected terminal wealth: ${Planner.formatMoney(row.expectedTerminalWealth)}`,
          `Median terminal wealth: ${Planner.formatMoney(row.medianTerminalWealth)}`,
          `Current beta: ${Planner.formatBeta(row.currentBeta)}`
        ]
      });
    }
  }

  // ---------- Overview: how much you need ----------

  // Run-out risk by starting net worth (from per-path survival thresholds),
  // zoomed to about 10% down to 0.1% risk on a log axis so each step down reads
  // as a distance. Dots mark the net worth needed for each
  // REQUIRED_WEALTH_LABELS risk and you; hovering or tapping near one shows it.
  function renderRequiredWealthChart(results, frame) {
    const { ctx, theme } = frame;
    const { requiredWealth, scenario } = results;

    const needed = Planner.REQUIRED_WEALTH_LABELS
      .map((risk) => ({ risk, wealth: Planner.requiredWealthForRisk(requiredWealth, risk) }))
      .filter((point) => point.wealth > 0 && Number.isFinite(point.wealth));
    if (!needed.length) {
      const anyPositive = requiredWealth.thresholds.some((value) => value > 0 && Number.isFinite(value));
      drawEmptyState(frame, anyPositive
        ? "Run-out risk stays high at every starting net worth the model covers."
        : "Income covers spending on almost every simulated path.");
      return;
    }

    const minRisk = Math.min(...Planner.REQUIRED_WEALTH_LABELS) / 2;
    const maxRisk = Math.max(...Planner.REQUIRED_WEALTH_LABELS) * 1.5;
    const minWealth = Math.max(1000, Math.min(...needed.map((point) => point.wealth)) / 1.3);
    const maxWealth = Math.max(minWealth * 4, Math.max(...needed.map((point) => point.wealth)) * 1.3);
    const xOf = logScale(minWealth, maxWealth, frame.left, frame.right);
    const yOf = logScale(minRisk, maxRisk, frame.bottom, frame.top);

    const samples = 200;
    const items = Array.from({ length: samples }, (_, index) => {
      const wealth = Math.exp(Math.log(minWealth) + (index / (samples - 1)) * (Math.log(maxWealth) - Math.log(minWealth)));
      const risk = Planner.riskAtWealth(requiredWealth, wealth);
      return { key: index, wealth, risk, x: xOf(wealth), y: yOf(Math.max(risk, minRisk)) };
    });
    const hover = trackHover(frame, items);

    drawAxisTitle(frame, "Run-out risk (log scale)");
    drawYAxis(frame, logAxisTicks(minRisk * 2, maxRisk / 1.5, yOf, 22), yOf, Planner.formatPercent);
    drawXAxis(frame, logAxisTicks(minWealth, maxWealth, xOf, 52), xOf, Planner.formatMoney);
    drawXAxisTitle(frame, "Starting net worth (log scale)");

    withPlotClip(frame, () => strokePolyline(ctx, items, theme.series, 2));

    const yourRisk = Planner.riskAtWealth(requiredWealth, scenario.netWorth);
    const youInRange = scenario.netWorth >= minWealth && scenario.netWorth <= maxWealth && yourRisk >= minRisk && yourRisk <= maxRisk;
    const points = needed.map((point) => ({ ...point, kind: "needed", x: xOf(point.wealth), y: yOf(point.risk) }));
    if (youInRange) {
      points.push({ kind: "you", wealth: scenario.netWorth, risk: yourRisk, x: xOf(scenario.netWorth), y: yOf(yourRisk) });
    }
    const hoveredPoint = hover
      ? points.reduce((best, point) => {
        const distance = Math.hypot(point.x - hover.x, point.y - hover.y);
        return distance < 22 && (!best || distance < best.distance) ? { point, distance } : best;
      }, null)?.point
      : null;
    const colorOf = (point) => (point.kind === "you" ? theme.seriesStrong : theme.highlight);
    points.forEach((point) => drawDot(frame, point.x, point.y, point === hoveredPoint ? 7 : 5.5, colorOf(point)));

    if (!youInRange) {
      // Off the zoomed range: a short note in the free corner (the curve runs
      // top-left to bottom-right).
      const below = scenario.netWorth < minWealth || yourRisk > maxRisk;
      const youText = `You: ${Planner.formatMoney(scenario.netWorth)}, ${Planner.formatPolicyRiskPercent(yourRisk)} risk`;
      drawLabel(frame, below ? `◂ ${youText}` : `${youText} ▸`, below ? frame.left + 6 : frame.right - 6, below ? frame.bottom - 12 : frame.top + 10, {
        align: below ? "left" : "right",
        baseline: "middle",
        weight: 600
      });
    }

    drawLegend(frame, [
      { label: "Run-out risk", color: theme.series, shape: "line" },
      { label: "Needed for 10%, 5%, 1%, 0.1%", color: theme.highlight, shape: "dot" },
      { label: "You", color: theme.seriesStrong, shape: "dot" }
    ]);

    if (hoveredPoint) {
      const gap = hoveredPoint.wealth - scenario.netWorth;
      drawTooltip(frame, hoveredPoint.x, hoveredPoint.y, hoveredPoint.kind === "you"
        ? `You: ${Planner.formatMoney(hoveredPoint.wealth)}`
        : `${Planner.formatPercent(hoveredPoint.risk)} run-out risk`, hoveredPoint.kind === "you"
        ? [`Run-out risk: ${Planner.formatPolicyRiskPercent(hoveredPoint.risk)}`]
        : [
          `Starting net worth: ${Planner.formatMoney(hoveredPoint.wealth)}`,
          gap > 0 ? `${Planner.formatMoney(gap)} more than you have` : `${Planner.formatMoney(-gap)} less than you have`
        ]);
    } else if (hover) {
      drawHoverPoint(frame, hover.item, {
        title: `Start with ${Planner.formatMoney(hover.item.wealth)}`,
        lines: [`Run-out risk: ${Planner.formatPolicyRiskPercent(hover.item.risk)}`]
      });
    }
  }

  // ---------- Spending ----------

  // Stacked annual spending by category with income as a step line. The y-axis
  // fits recurring spending and income; one-time spikes (a home purchase) are
  // clipped at the top and labeled so they don't flatten everything else.
  function renderSpendingChart(model, frame) {
    const { ctx, theme } = frame;
    if (model.error) {
      drawEmptyState(frame, model.error);
      return;
    }
    const { years, categories, totals, recurringTotals, income } = model;
    const yScale = Planner.niceZeroScale(Math.max(...recurringTotals, ...income, 1) * 1.04, 4);
    const yOf = linearScale(0, yScale.max, frame.bottom, frame.top);
    drawAxisTitle(frame, "Per year (today's $)");
    drawYAxis(frame, yScale.ticks, yOf, Planner.formatMoney);

    const layout = barLayout(frame, years.length);
    const segmentGap = layout.band > 4 ? 1 : 0;
    const items = years.map((year, index) => ({ key: year, index, ...layout.slot(index) }));
    const hover = trackHover(frame, items);
    const hasIncome = income.some((value) => value > 0);

    withPlotClip(frame, () => {
      items.forEach((item) => {
        let base = 0;
        const { x, width } = layout.bar(item.index);
        const stack = categories.filter((category) => category.values[item.index] > 0);
        stack.forEach((category, stackIndex) => {
          const value = category.values[item.index];
          const y0 = yOf(base);
          const y1 = yOf(base + value);
          base += value;
          ctx.fillStyle = theme.categorical[category.colorIndex];
          const height = Math.max(0, y0 - y1 - (stackIndex > 0 ? segmentGap : 0));
          if (stackIndex === stack.length - 1) fillRoundedTop(ctx, x, y1, width, height, Math.min(3, width / 2));
          else ctx.fillRect(x, y1, width, height);
        });
      });
      if (hover) {
        ctx.fillStyle = theme.path;
        ctx.fillRect(hover.item.x0, frame.top, layout.band, frame.plotHeight);
      }
      if (hasIncome) {
        ctx.beginPath();
        items.forEach((item) => {
          const y = yOf(income[item.index]);
          if (item.index === 0) ctx.moveTo(item.x0, y);
          else ctx.lineTo(item.x0, y);
          ctx.lineTo(item.x1, y);
        });
        ctx.strokeStyle = theme.ink;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.stroke();
      }
    });

    items.forEach((item) => {
      if (totals[item.index] <= yScale.max) return;
      const x = Planner.clamp(layout.center(item.index), frame.left + 24, frame.right - 24);
      drawLabel(frame, `↑ ${Planner.formatMoney(totals[item.index])}`, x, frame.top - 6, { align: "center", size: 11, weight: 600 });
    });

    drawYearAxis(frame, years, (year) => layout.center(year - years[0]));
    drawLegend(frame, [
      ...categories
        .filter((category) => category.values.some((value) => value > 0))
        .map((category) => ({ label: category.label, color: theme.categorical[category.colorIndex], shape: "square" })),
      ...(hasIncome ? [{ label: "Income", color: theme.ink, shape: "line" }] : [])
    ]);

    if (hover) {
      const { index } = hover.item;
      const lines = categories
        .filter((category) => category.values[index] > 0)
        .map((category) => `${category.label}: ${Planner.formatMoney(category.values[index])}`);
      lines.push(`Total: ${Planner.formatMoney(totals[index])}`);
      if (income[index] > 0) lines.push(`Income: ${Planner.formatMoney(income[index])}`);
      drawTooltip(frame, hover.x, hover.y, String(years[index]), lines);
    }
  }

  Object.assign(Planner, {
    resetChartTheme,
    bindChartHover,
    clearHover,
    renderCharts,
    renderChart,
    getPolicyMetric,
    updateNetWorthZoomLabel
  });
})(window.Planner = window.Planner || {});
