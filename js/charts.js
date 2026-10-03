(function (Planner) {
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
      ramp: token("--chart-ramp").split(",").map((stop) => parseHex(stop.trim()))
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

  // ---------- Frame, scales, and primitives ----------

  function beginChart(canvas, padding) {
    const { ctx, width, height } = Planner.fitCanvas(canvas);
    const theme = chartTheme();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = theme.surface;
    ctx.fillRect(0, 0, width, height);
    // Narrow charts put the legend on its own row below the axis title.
    const compact = width < 560;
    const left = padding.left;
    const top = padding.top + (compact ? 20 : 0);
    const right = Math.max(left + 1, width - padding.right);
    const bottom = Math.max(top + 1, height - padding.bottom);
    return { ctx, theme, width, height, compact, left, top, right, bottom, plotWidth: right - left, plotHeight: bottom - top };
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

  function logTicks(min, max) {
    const ticks = [];
    for (let power = Math.ceil(Math.log10(min)); 10 ** power <= max * (1 + 1e-9); power += 1) {
      ticks.push(10 ** power);
    }
    return ticks.length >= 2 ? ticks : [min, max];
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

  function yearTicks(minYear, maxYear, plotWidth) {
    const count = Math.max(3, Math.min(8, Math.floor(plotWidth / 80)));
    return Planner.niceTicks(minYear, maxYear, count, { integer: true });
  }

  function drawAxisTitle(frame, text) {
    const { ctx, theme } = frame;
    ctx.font = font(frame, 12, 500);
    ctx.fillStyle = theme.text;
    ctx.textAlign = "left";
    ctx.fillText(text, frame.left - Math.min(frame.left - 8, 56), 16);
  }

  function drawXAxisTitle(frame, text) {
    const { ctx, theme } = frame;
    ctx.font = font(frame, 12, 500);
    ctx.fillStyle = theme.text;
    ctx.textAlign = "right";
    ctx.fillText(text, frame.right, frame.height - 6);
  }

  // Items: { label, color, shape: "line" | "dot" | "ramp", ramp? }. Right-aligned.
  function drawLegend(frame, items) {
    const { ctx, theme } = frame;
    ctx.font = font(frame, 12);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const y = frame.compact ? 35 : 15;
    let x = frame.right;
    [...items].reverse().forEach((item) => {
      const labelWidth = ctx.measureText(item.label).width;
      const swatchWidth = item.shape === "ramp" ? 44 : item.shape === "dot" ? 10 : 16;
      x -= labelWidth;
      ctx.fillStyle = theme.text;
      ctx.fillText(item.label, x, y);
      x -= 6 + swatchWidth;
      if (item.shape === "dot") {
        ctx.beginPath();
        ctx.arc(x + 5, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = item.color;
        ctx.fill();
      } else if (item.shape === "ramp") {
        const gradient = ctx.createLinearGradient(x, 0, x + swatchWidth, 0);
        item.ramp.forEach((_, index) => {
          const t = index / (item.ramp.length - 1);
          gradient.addColorStop(t, rampColor(item.ramp, t));
        });
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y - 5, swatchWidth, 10);
      } else {
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x + 1, y);
        ctx.lineTo(x + swatchWidth - 1, y);
        ctx.stroke();
      }
      x -= 18;
    });
    ctx.textBaseline = "alphabetic";
  }

  function drawEmptyState(frame, message) {
    const { ctx, theme } = frame;
    ctx.font = font(frame, 13);
    ctx.fillStyle = theme.muted;
    ctx.textAlign = "center";
    ctx.fillText(message, frame.width / 2, frame.height / 2);
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

  // ---------- Hover ----------

  const hoverByChart = {};
  const hitMetaByChart = {};
  let pendingHoverRender = null;

  // Keeps the hovered item stable across re-renders by matching its key.
  function resolveHover(chartKey, items) {
    const hover = hoverByChart[chartKey];
    if (!hover) return null;
    const item = items.find((candidate) => candidate.key === hover.item.key);
    if (!item) {
      hoverByChart[chartKey] = null;
      return null;
    }
    hover.item = item;
    return hover;
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
    if (!meta.frame || y < meta.frame.top - 8 || y > meta.frame.bottom + 8) return null;
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
    if (!meta.frame || y < meta.frame.top || y > meta.frame.bottom) return null;
    return meta.items.find((item) => x >= item.x0 && x <= item.x1) || null;
  }

  function findCell(meta, x, y) {
    return meta.lookup ? meta.lookup(x, y) : null;
  }

  const CHARTS = {
    netWorth: { canvas: "pathsCanvas", page: "overview", render: renderNetWorthChart, find: findNearestPath },
    distribution: { canvas: "distributionCanvas", page: "overview", render: renderDistributionChart, find: findBar },
    beta: { canvas: "betaCanvas", page: "overview", render: renderBetaChart, find: findNearestPath },
    detail: { canvas: "selectedSimulationCanvas", page: "details", render: renderSelectedSimulationChart, find: findNearestX },
    policyBucket: { canvas: "dynamicPolicyCanvas", page: "policy", render: renderPolicyBucketChart, find: findNearestX },
    policyPath: { canvas: "policyPathCanvas", page: "policy", render: renderPolicyPathChart, find: findCell },
    frontier: { canvas: "frontierCanvas", page: "overview", render: renderFrontierChart, find: findNearestPoint }
  };

  function renderChart(chartKey) {
    const results = Planner.state.results;
    if (results) CHARTS[chartKey].render(results);
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
        if (!Planner.state.results || Planner.state.activePage !== chart.page || !meta) return;
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

  function renderCharts(results) {
    Object.values(CHARTS).forEach((chart) => {
      if (chart.page === Planner.state.activePage) chart.render(results);
    });
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

  function renderNetWorthChart(results) {
    const frame = beginChart(Planner.els.pathsCanvas, { top: 36, right: 64, bottom: 30, left: 60 });
    const { ctx, theme } = frame;
    const { years } = results;
    const yScale = Planner.niceZeroScale(getNetWorthYAxisMax(results), 5);
    const xOf = linearScale(years[0], years[years.length - 1], frame.left, frame.right);
    const yOf = linearScale(0, yScale.max, frame.bottom, frame.top);

    drawAxisTitle(frame, "Net worth (current $)");
    drawYAxis(frame, yScale.ticks, yOf, Planner.formatCompactCurrency);
    drawXAxis(frame, yearTicks(years[0], years[years.length - 1], frame.plotWidth), xOf, String);
    drawEndingPercentileLabels(frame, results, yOf, yScale.max);

    const items = results.visualPaths.map((path) => ({
      key: path.simulation,
      path,
      points: path.points.map((point) => ({ x: xOf(point.year), y: yOf(point.wealth) }))
    }));
    hitMetaByChart.netWorth = { items };
    const hover = resolveHover("netWorth", items);
    const expected = results.expectedPath.map((point) => ({ x: xOf(point.year), y: yOf(point.wealth) }));

    withPlotClip(frame, () => {
      items.forEach((item) => strokePolyline(ctx, item.points, theme.path, 1));
      strokePolyline(ctx, expected, theme.seriesStrong, 2.5);
      if (hover) strokePolyline(ctx, hover.item.points, theme.highlight, 2);
    });

    drawLegend(frame, [
      { label: "Expected", color: theme.seriesStrong, shape: "line" },
      { label: `${results.visualPaths.length} sample paths`, color: theme.series, shape: "line" }
    ]);
    if (hover) {
      const path = hover.item.path;
      drawTooltip(frame, hover.x, hover.y, `Simulation #${Planner.formatNumber(path.simulation)}`, [
        `Ending wealth: ${Planner.formatCurrency(path.terminalWealth)}`,
        `Ending percentile: ${Planner.formatPercent(path.endingPercentile)}`,
        `Avg real SPX return: ${Planner.formatPercent(path.averageRealSpxReturn)}`,
        path.failureYear ? `Depleted in ${path.failureYear}` : "Not depleted"
      ]);
    }
  }

  function drawEndingPercentileLabels(frame, results, yOf, maxWealth) {
    const { ctx, theme } = frame;
    ctx.font = font(frame, 11.5);
    ctx.textAlign = "left";
    ctx.fillStyle = theme.text;
    ctx.fillText("End pctl", frame.right + 10, frame.top - 8);
    ctx.fillStyle = theme.muted;
    let lastY = Infinity;
    [0.25, 0.5, 0.75, 0.9, 0.95, 0.99].forEach((p) => {
      const wealth = Planner.percentileOfSorted(results.terminalWealthSorted, p) || 0;
      if (wealth > maxWealth) return;
      const y = yOf(wealth);
      if (lastY - y < 16 || y < frame.top + 4) return;
      ctx.fillText(`p${Math.round(p * 100)}`, frame.right + 10, y + 4);
      lastY = y;
    });
  }

  // ---------- Overview: beta ----------

  function renderBetaChart(results) {
    const frame = beginChart(Planner.els.betaCanvas, { top: 36, right: 24, bottom: 30, left: 60 });
    const { ctx, theme } = frame;
    const { years, scenario } = results;
    const isFixed = scenario.betaMode !== Planner.BETA_MODE_DYNAMIC;
    const minBeta = Math.min(0, scenario.spxBeta || 0);
    const maxBeta = Math.max(1.5, scenario.spxBeta || 0);
    const ticks = Planner.niceTicks(minBeta, maxBeta, 3);
    const yOf = linearScale(ticks[0], ticks[ticks.length - 1], frame.bottom, frame.top);
    const xOf = linearScale(years[0], years[years.length - 1], frame.left, frame.right);

    Planner.els.betaPathSummary.textContent = isFixed
      ? `Fixed beta ${Planner.formatBeta(scenario.spxBeta)} on every active path.`
      : "Average recommended beta across active paths, with downsampled simulation paths.";

    drawAxisTitle(frame, "SPX beta");
    drawYAxis(frame, ticks, yOf, Planner.formatBeta);
    drawXAxis(frame, yearTicks(years[0], years[years.length - 1], frame.plotWidth), xOf, String);

    const items = results.visualPaths.map((path) => ({
      key: path.simulation,
      path,
      points: path.betaPoints
        .filter((point) => Number.isFinite(point.beta))
        .map((point) => ({ x: xOf(point.year), y: yOf(point.beta) }))
    }));
    hitMetaByChart.beta = { items };
    const hover = resolveHover("beta", items);
    const expected = results.expectedBetaPath
      .filter((point) => Number.isFinite(point.beta))
      .map((point) => ({ x: xOf(point.year), y: yOf(point.beta) }));

    withPlotClip(frame, () => {
      items.forEach((item) => strokePolyline(ctx, item.points, theme.path, 1));
      strokePolyline(ctx, expected, theme.seriesStrong, 2.5);
      if (hover) strokePolyline(ctx, hover.item.points, theme.highlight, 2);
    });

    drawLegend(frame, [
      { label: "Average", color: theme.seriesStrong, shape: "line" },
      { label: `${results.visualPaths.length} sample paths`, color: theme.series, shape: "line" }
    ]);
    if (hover) {
      const path = hover.item.path;
      drawTooltip(frame, hover.x, hover.y, `Simulation #${Planner.formatNumber(path.simulation)}`, [
        `Ending wealth: ${Planner.formatCurrency(path.terminalWealth)}`,
        path.failureYear ? `Depleted in ${path.failureYear}` : "Not depleted"
      ]);
    }
  }

  // ---------- Overview: depletion distribution ----------

  function renderDistributionChart(results) {
    const frame = beginChart(Planner.els.distributionCanvas, { top: 36, right: 24, bottom: 30, left: 60 });
    const { ctx, theme } = frame;
    const total = results.scenario.simulationCount;
    const rows = Planner.els.showDepleted.checked
      ? results.depletedDistribution
      : [...results.depletedDistribution, { label: "Not depleted", count: results.notDepletedCount, isNotDepleted: true }];

    drawAxisTitle(frame, "Probability");
    hitMetaByChart.distribution = { items: [], frame };
    if (!rows.length) {
      drawEmptyState(frame, "No simulated paths depleted before the year of death.");
      return;
    }

    const yScale = Planner.niceZeroScale(Math.max(...rows.map((row) => row.count / total), 0.001), 4);
    const yOf = linearScale(0, yScale.max, frame.bottom, frame.top);
    drawYAxis(frame, yScale.ticks, yOf, Planner.formatPercent);

    const band = frame.plotWidth / rows.length;
    const gap = band > 6 ? 2 : 0;
    const items = rows.map((row, index) => ({
      key: row.label,
      row,
      probability: row.count / total,
      x0: frame.left + index * band,
      x1: frame.left + (index + 1) * band
    }));
    hitMetaByChart.distribution.items = items;
    const hover = resolveHover("distribution", items);

    items.forEach((item) => {
      const y = yOf(item.probability);
      const baseColor = item.row.isNotDepleted ? theme.positive : theme.series;
      ctx.fillStyle = hover && hover.item === item ? theme.seriesStrong : baseColor;
      fillRoundedTop(ctx, item.x0 + gap / 2, y, Math.max(1, band - gap), frame.bottom - y, 3);
    });

    ctx.font = font(frame, 11.5);
    const labelEvery = Math.max(1, Math.ceil(44 / band));
    drawXAxis(
      frame,
      items.filter((item, index) => item.row.isNotDepleted || index % labelEvery === 0),
      (item) => (item.x0 + item.x1) / 2,
      (item) => item.row.label
    );

    if (hover) {
      const { row, probability } = hover.item;
      drawTooltip(frame, hover.x, hover.y, row.isNotDepleted ? "Not depleted" : `Depleted in ${row.label}`, [
        `Probability: ${Planner.formatPolicyRiskPercent(probability)}`,
        `${Planner.formatNumber(row.count)} of ${Planner.formatNumber(total)} paths`
      ]);
    }
  }

  // ---------- Simulation detail ----------

  function renderSelectedSimulationChart(results) {
    const frame = beginChart(Planner.els.selectedSimulationCanvas, { top: 36, right: 24, bottom: 30, left: 60 });
    const { ctx, theme } = frame;
    const rows = Planner.getSelectedSimulationRows(results);
    hitMetaByChart.detail = { items: [], frame };
    if (!rows.length) {
      drawEmptyState(frame, "No rows for this simulation.");
      return;
    }

    const { years } = results;
    const yScale = Planner.niceZeroScale(Math.max(1, ...rows.flatMap((row) => [row.startingWealth, row.endingWealth])), 4);
    const xOf = linearScale(years[0], years[years.length - 1], frame.left, frame.right);
    const yOf = linearScale(0, yScale.max, frame.bottom, frame.top);

    drawAxisTitle(frame, "Net worth (current $)");
    drawYAxis(frame, yScale.ticks, yOf, Planner.formatCompactCurrency);
    drawXAxis(frame, yearTicks(years[0], years[years.length - 1], frame.plotWidth), xOf, String);

    const items = rows.map((row) => ({ key: row.year, row, x: xOf(row.year), y: yOf(row.endingWealth) }));
    hitMetaByChart.detail.items = items;
    const hover = resolveHover("detail", items);
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
    if (depletion) drawDot(frame, depletion.x, depletion.y, 5, theme.critical);

    if (hover) {
      const { row } = hover.item;
      drawCrosshair(frame, hover.item.x, null);
      drawDot(frame, hover.item.x, hover.item.y, 5, theme.series);
      const lines = [`End wealth: ${Planner.formatCurrency(row.endingWealth)}`];
      if (row.historicalReturnYear) {
        lines.push(`Sampled ${row.historicalReturnYear}: SPX ${Planner.formatPercent(row.nominalSpxReturn)}`);
        lines.push(`Beta ${Planner.formatBeta(row.spxBetaUsed)} · real ${Planner.formatPercent(row.portfolioRealReturn)}`);
      }
      if (row.depletedThisYear) lines.push("Depleted this year");
      drawTooltip(frame, hover.item.x, hover.item.y, String(row.year), lines);
    }
  }

  // ---------- Beta policy: wealth bucket plot ----------

  const POLICY_METRICS = {
    beta: { label: "Optimal SPX beta", value: (row) => row.beta, format: Planner.formatBeta },
    risk: { label: "Estimated depletion risk", value: (row) => row.estimatedDepletionRisk, format: Planner.formatPolicyRiskPercent },
    terminalWealth: { label: "Expected terminal wealth", value: (row) => row.expectedTerminalWealth, format: Planner.formatCompactCurrency }
  };

  function getPolicyMetric(metric) {
    return POLICY_METRICS[metric] || POLICY_METRICS.beta;
  }

  function renderPolicyBucketChart(results) {
    const frame = beginChart(Planner.els.dynamicPolicyCanvas, { top: 36, right: 24, bottom: 30, left: 64 });
    const { ctx, theme } = frame;
    const view = results.dynamicPolicy ? Planner.getPolicyBucketView(results) : null;
    const rows = view ? view.rows.filter((row) => row.wealth > 0) : [];
    hitMetaByChart.policyBucket = { items: [], frame };
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
      yTicks = logTicks(min, max);
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
    drawXAxis(frame, logTicks(minWealth, maxWealth), xOf, Planner.formatCompactCurrency);

    const items = rows.map((row, index) => ({ key: row.bucketIndex, row, x: xOf(row.wealth), y: yOf(Math.max(0, values[index])) }));
    hitMetaByChart.policyBucket.items = items;
    const hover = resolveHover("policyBucket", items);

    withPlotClip(frame, () => strokePolyline(ctx, items, theme.series, 2));

    const netWorth = results.scenario.netWorth;
    if (view.isCurrentYear && netWorth >= minWealth && netWorth <= maxWealth) {
      const x = xOf(netWorth);
      ctx.save();
      ctx.strokeStyle = theme.highlight;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, frame.top);
      ctx.lineTo(x, frame.bottom);
      ctx.stroke();
      ctx.restore();
      const marker = items.find((item) => item.row.bucketIndex === view.currentBucketIndex);
      if (marker) drawDot(frame, marker.x, marker.y, 5, theme.highlight);
      ctx.font = font(frame, 12, 500);
      ctx.fillStyle = theme.text;
      const alignRight = x > frame.right - 110;
      ctx.textAlign = alignRight ? "right" : "left";
      ctx.fillText("Current wealth", x + (alignRight ? -8 : 8), frame.top + 12);
    }

    if (hover) {
      const { row } = hover.item;
      drawCrosshair(frame, hover.item.x, hover.item.y);
      drawDot(frame, hover.item.x, hover.item.y, 5, theme.series);
      drawTooltip(frame, hover.item.x, hover.item.y, `Wealth ${Planner.formatCurrency(row.wealth)}`, [
        `Optimal beta: ${Planner.formatBeta(row.beta)}`,
        `Depletion risk: ${Planner.formatPolicyRiskPercent(row.estimatedDepletionRisk)}`,
        `Expected terminal: ${Planner.formatCompactCurrency(row.expectedTerminalWealth)}`
      ]);
    }
  }

  // ---------- Beta policy: heatmap with forced path ----------

  function renderPolicyPathChart(results) {
    const frame = beginChart(Planner.els.policyPathCanvas, { top: 36, right: 24, bottom: 30, left: 64 });
    const { ctx, theme } = frame;
    const policy = results.dynamicPolicy;
    const explorer = results.policyPathExplorer;
    hitMetaByChart.policyPath = {};
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
    drawYAxis(frame, logTicks(minWealth, maxWealth), yOfWealth, Planner.formatCompactCurrency);
    drawXAxis(
      frame,
      yearTicks(years[0], years[years.length - 1], frame.plotWidth),
      (year) => xOfYearIndex(year - years[0]),
      String
    );

    const pathPoints = explorer.points.map((point) => ({
      x: xOfYearIndex(Planner.clamp(point.year - years[0], 0, years.length - 1)),
      y: yOfWealth(point.wealth)
    }));
    withPlotClip(frame, () => {
      strokePolyline(ctx, pathPoints, theme.surface, 5);
      strokePolyline(ctx, pathPoints, theme.highlight, 2.5);
    });
    pathPoints.forEach((point, index) => {
      drawDot(frame, point.x, point.y, index === pathPoints.length - 1 ? 5 : 4, index === 0 ? theme.ink : theme.highlight);
    });

    hitMetaByChart.policyPath.lookup = (x, y) => {
      if (x < frame.left || x > frame.right || y < frame.top || y > frame.bottom) return null;
      const yearIndex = Math.min(years.length - 1, Math.floor((x - frame.left) / cellWidth));
      const visibleIndex = Math.min(buckets.length - 1, Math.floor((frame.bottom - y) / cellHeight));
      const bucket = buckets[visibleIndex];
      return {
        key: `${yearIndex}:${bucket.bucketIndex}`,
        yearIndex,
        bucket,
        visibleIndex
      };
    };
    const hover = hoverByChart.policyPath;
    if (hover) {
      const { yearIndex, bucket, visibleIndex } = hover.item;
      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        frame.left + yearIndex * cellWidth,
        frame.bottom - (visibleIndex + 1) * cellHeight,
        cellWidth,
        cellHeight
      );
      drawTooltip(frame, hover.x, hover.y, String(years[yearIndex]), [
        `Wealth ≈ ${Planner.formatCurrency(bucket.wealth)}`,
        `Policy beta: ${Planner.formatBeta(policy.policyByYear[yearIndex]?.[bucket.bucketIndex])}`,
        `Depletion risk: ${Planner.formatPolicyRiskPercent(policy.valueByYear[yearIndex]?.[bucket.bucketIndex])}`
      ]);
    }

    drawLegend(frame, [
      { label: "Forced path", color: theme.highlight, shape: "line" },
      { label: `Beta 0–${Planner.formatBeta(maxBeta)}`, ramp: theme.ramp, shape: "ramp" }
    ]);
  }

  // ---------- Frontier ----------

  function renderFrontierChart(results) {
    const frame = beginChart(Planner.els.frontierCanvas, { top: 36, right: 24, bottom: 44, left: 64 });
    const { ctx, theme } = frame;
    const rows = results.dynamicPolicy?.frontier || [];
    hitMetaByChart.frontier = { items: [] };
    if (!rows.length) {
      drawEmptyState(frame, "Run dynamic beta to compare risk and expected wealth policies.");
      return;
    }

    const riskScale = paddedScale(rows.map((row) => row.depletionRisk), 0, 1, 0.08);
    const wealthScale = paddedScale(rows.map((row) => row.expectedTerminalWealth), 0, Number.POSITIVE_INFINITY, 0.08);
    const xOf = linearScale(riskScale.min, riskScale.max, frame.left, frame.right);
    const yOf = linearScale(wealthScale.min, wealthScale.max, frame.bottom, frame.top);

    drawAxisTitle(frame, "Expected terminal wealth");
    drawYAxis(frame, Planner.niceTicks(wealthScale.min, wealthScale.max, 4), yOf, Planner.formatCompactCurrency);
    drawXAxis(frame, Planner.niceTicks(riskScale.min, riskScale.max, 5), xOf, Planner.formatPolicyRiskPercent);
    drawXAxisTitle(frame, "Run-out risk");

    const items = rows.map((row) => ({ key: row.label, row, x: xOf(row.depletionRisk), y: yOf(row.expectedTerminalWealth) }));
    hitMetaByChart.frontier.items = items;
    const hover = resolveHover("frontier", items);

    withPlotClip(frame, () => strokePolyline(ctx, items, theme.series, 2));
    items.forEach((item) => {
      drawDot(frame, item.x, item.y, item.row.isMinRisk ? 5.5 : 4.5, item.row.isMinRisk ? theme.critical : theme.series);
    });

    drawLegend(frame, [
      { label: "Min-risk (simulated)", color: theme.critical, shape: "dot" },
      { label: "Risk-penalty", color: theme.series, shape: "dot" }
    ]);
    if (hover) {
      const { row } = hover.item;
      drawCrosshair(frame, hover.item.x, hover.item.y);
      drawDot(frame, hover.item.x, hover.item.y, 6, row.isMinRisk ? theme.critical : theme.series);
      drawTooltip(frame, hover.item.x, hover.item.y, row.label, [
        `Run-out risk: ${Planner.formatPolicyRiskPercent(row.depletionRisk)}`,
        `Expected terminal: ${Planner.formatCurrency(row.expectedTerminalWealth)}`,
        `Current beta: ${Planner.formatBeta(row.currentBeta)}`
      ]);
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
