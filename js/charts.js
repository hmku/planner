(function (Planner) {
  function beginChart(canvas) {
    const size = Planner.fitCanvas(canvas);
    const ctx = canvas.getContext("2d");
    Planner.clearCanvas(ctx, size.width, size.height);
    return { ctx, width: size.width, height: size.height };
  }


  function drawExpectedSeries(ctx, series, padding, chartWidth, chartHeight, minYear, maxYear, maxValue, getValue) {
    ctx.beginPath();
    ctx.strokeStyle = "#4f46e5";
    ctx.lineWidth = 3;
    let started = false;
    series.forEach((point) => {
      const value = getValue(point);
      if (!Number.isFinite(value)) return;
      const x = Planner.yearToX(point.year, minYear, maxYear, padding, chartWidth);
      const y = padding.top + chartHeight - (value / Math.max(1, maxValue)) * chartHeight;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  }


  function drawDownsampledPaths(ctx, hitAreas, paths, padding, chartWidth, chartHeight, minYear, maxYear, maxValue, getPathPoints, getPointValue, hoverIndex) {
    paths.forEach((path, index) => {
      const points = (getPathPoints(path) || [])
        .map((point) => {
          const value = getPointValue(point);
          if (!Number.isFinite(value)) return null;
          return {
            x: Planner.yearToX(point.year, minYear, maxYear, padding, chartWidth),
            y: padding.top + chartHeight - (value / Math.max(1, maxValue)) * chartHeight,
            year: point.year,
            wealth: point.wealth,
            beta: point.beta
          };
        })
        .filter(Boolean);
      if (points.length < 2) return;

      hitAreas.push({ path, index, points });
      const highlighted = hoverIndex === index;
      ctx.beginPath();
      ctx.strokeStyle = highlighted ? "rgba(225, 29, 72, 0.95)" : "rgba(14, 165, 233, 0.18)";
      ctx.lineWidth = highlighted ? 3 : 1;
      points.forEach((point, pointIndex) => {
        if (pointIndex === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
    });
  }


  function handleSeriesChartHover(event, canvas, pageName, hitAreas, renderChart) {
    if (!Planner.state.results || Planner.state.activePage !== pageName) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const nearest = Planner.findNearestSegmentHit(hitAreas, x, y);
    const nextHover = nearest ? { ...nearest, x, y } : null;
    const currentIndex = Planner.state.hover ? Planner.state.hover.index : null;
    const nextIndex = nextHover ? nextHover.index : null;

    if (currentIndex !== nextIndex || nextHover) {
      Planner.state.hover = nextHover;
      renderChart(canvas, Planner.state.results);
    }
  }

  function renderCharts(results) {
    if (Planner.state.activePage === "overview") {
      renderDistributionChart(Planner.els.distributionCanvas, results);
      renderNetWorthChart(Planner.els.pathsCanvas, results);
      renderBetaChart(Planner.els.betaCanvas, results);
      return;
    }
    if (Planner.state.activePage === "details") {
      renderSelectedSimulationChart(Planner.els.selectedSimulationCanvas, results);
    }
  }



  function renderDistributionChart(canvas, results) {
    const size = Planner.fitCanvas(canvas);
    const ctx = canvas.getContext("2d");
    const width = size.width;
    const height = size.height;
    Planner.clearCanvas(ctx, width, height);

    const padding = { top: 28, right: 24, bottom: 72, left: 70 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const showDepleted = Planner.els.showDepleted.checked;
    const rows = showDepleted
      ? results.depletedDistribution
      : [...results.depletedDistribution, { label: "Not depleted", count: results.notDepletedCount, isNotDepleted: true }];

    drawAxes(ctx, padding, width, height, "Probability");
    if (!rows.length) {
      drawEmptyState(ctx, width, height, "No simulated paths depleted before the expected year of death.");
      return;
    }

    const maxProbability = Math.max(...rows.map((row) => row.count / results.scenario.simulationCount), 0.01);
    const barGap = 3;
    const barWidth = Math.max(3, chartWidth / rows.length - barGap);

    rows.forEach((row, index) => {
      const probability = row.count / results.scenario.simulationCount;
      const x = padding.left + index * (chartWidth / rows.length);
      const barHeight = (probability / maxProbability) * chartHeight;
      const y = padding.top + chartHeight - barHeight;
      ctx.fillStyle = row.isNotDepleted ? "#4f46e5" : "#0ea5e9";
      ctx.fillRect(x, y, barWidth, barHeight);

      const shouldLabel = row.isNotDepleted || index === 0 || index === rows.length - 1 || index % Math.ceil(rows.length / 8) === 0;
      if (shouldLabel) {
        ctx.save();
        ctx.translate(x + barWidth / 2, height - 48);
        ctx.rotate(-Math.PI / 5);
        ctx.fillStyle = "#6b7280";
        ctx.font = "12px system-ui";
        ctx.textAlign = "right";
        ctx.fillText(row.label, 0, 0);
        ctx.restore();
      }
    });

    drawYProbabilityLabels(ctx, padding, chartHeight, maxProbability);
  }



  function renderNetWorthChart(canvas, results) {
    const { ctx, width, height } = beginChart(canvas);
    Planner.state.pathHitAreas = [];

    const padding = { top: 28, right: 72, bottom: 54, left: 82 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const maxWealth = getNetWorthYAxisMax(results);
    const { minYear, maxYear } = Planner.getYearSpan(results.scenario);
    const hoverIndex = Planner.state.hover ? Planner.state.hover.index : null;

    drawAxes(ctx, padding, width, height, "Current-dollar net worth");
    drawYMoneyLabels(ctx, padding, chartHeight, maxWealth);
    drawEndingPercentileLabels(ctx, results, padding, chartHeight, width, maxWealth);
    drawXYearLabels(ctx, padding, chartWidth, height, minYear, maxYear);

    ctx.save();
    ctx.beginPath();
    ctx.rect(padding.left, padding.top, chartWidth, chartHeight);
    ctx.clip();

    drawDownsampledPaths(
      ctx,
      Planner.state.pathHitAreas,
      results.visualPaths,
      padding,
      chartWidth,
      chartHeight,
      minYear,
      maxYear,
      maxWealth,
      (path) => path.points,
      (point) => point.wealth,
      hoverIndex
    );
    drawExpectedSeries(
      ctx,
      results.expectedPath,
      padding,
      chartWidth,
      chartHeight,
      minYear,
      maxYear,
      maxWealth,
      (point) => point.wealth
    );
    ctx.restore();
    drawChartLegend(ctx, width, padding);
    if (Planner.state.hover) drawPathTooltip(ctx, Planner.state.hover, width, height);
  }



  function renderBetaChart(canvas, results) {
    const { ctx, width, height } = beginChart(canvas);
    Planner.state.betaPathHitAreas = [];

    const padding = { top: 28, right: 36, bottom: 54, left: 70 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const { minYear, maxYear } = Planner.getYearSpan(results.scenario);
    const maxBeta = Math.max(1.5, results.scenario.spyBeta || 0, ...Planner.DYNAMIC_BETA_VALUES);
    const hoverIndex = Planner.state.hover ? Planner.state.hover.index : null;

    Planner.els.betaPathSummary.textContent = results.scenario.betaMode === Planner.BETA_MODE_DYNAMIC
      ? "Average recommended beta and downsampled simulation beta paths."
      : `Fixed beta ${Planner.formatBeta(results.scenario.spyBeta)} across every active path.`;

    drawAxes(ctx, padding, width, height, "SPY beta");
    drawYBetaLabels(ctx, padding, chartHeight, maxBeta);
    drawXYearLabels(ctx, padding, chartWidth, height, minYear, maxYear);

    ctx.save();
    ctx.beginPath();
    ctx.rect(padding.left, padding.top, chartWidth, chartHeight);
    ctx.clip();

    drawDownsampledPaths(
      ctx,
      Planner.state.betaPathHitAreas,
      results.visualPaths,
      padding,
      chartWidth,
      chartHeight,
      minYear,
      maxYear,
      maxBeta,
      (path) => path.betaPoints,
      (point) => point.beta,
      hoverIndex
    );
    drawExpectedSeries(
      ctx,
      results.expectedBetaPath,
      padding,
      chartWidth,
      chartHeight,
      minYear,
      maxYear,
      maxBeta,
      (point) => point.beta
    );
    ctx.restore();
    drawBetaChartLegend(ctx, width, padding);
    if (Planner.state.hover) drawBetaPathTooltip(ctx, Planner.state.hover, width, height);
  }



  function renderSelectedSimulationChart(canvas, results) {
    const size = Planner.fitCanvas(canvas);
    const ctx = canvas.getContext("2d");
    const width = size.width;
    const height = size.height;
    Planner.clearCanvas(ctx, width, height);

    const selectedSimulation = Number(Planner.els.simulationSelect.value) || 1;
    const rows = results.simulationYearRowsBySimulation.get(selectedSimulation) || [];
    const summary = results.simulationRows.find((row) => row.simulation === selectedSimulation);
    if (!rows.length) {
      Planner.els.selectedSimulationSummary.textContent = "No rows for this simulation.";
      Planner.state.detailHitPoints = [];
      drawEmptyState(ctx, width, height, "No rows for this simulation.");
      return;
    }

    const padding = { top: 28, right: 24, bottom: 54, left: 82 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const minYear = results.scenario.currentYear;
    const maxYear = results.scenario.deathYear;
    const maxWealth = Math.max(
      1,
      ...rows.flatMap((row) => [row.startingWealth, row.endingWealth])
    );
    const points = rows.map((row) => ({
      year: row.year,
      wealth: row.endingWealth,
      depletedThisYear: row.depletedThisYear
    }));
    Planner.state.detailHitPoints = points.map((point) => ({
      year: point.year,
      wealth: point.wealth,
      x: padding.left + ((point.year - minYear) / Math.max(1, maxYear - minYear)) * chartWidth,
      y: padding.top + chartHeight - (point.wealth / maxWealth) * chartHeight
    }));

    const finalWealth = summary ? summary.terminalWealth : rows[rows.length - 1].endingWealth;
    const status = summary && summary.failureYear ? `Depleted in ${summary.failureYear}` : "Not depleted";
    Planner.els.selectedSimulationSummary.textContent = `Sim ${Planner.formatNumber(selectedSimulation)} · ${Planner.formatCurrency(finalWealth)} · ${status.toLowerCase()}`;

    drawAxes(ctx, padding, width, height, "Current-dollar net worth");
    drawYMoneyLabels(ctx, padding, chartHeight, maxWealth);
    drawXYearLabels(ctx, padding, chartWidth, height, minYear, maxYear);

    ctx.save();
    ctx.beginPath();
    ctx.rect(padding.left, padding.top, chartWidth, chartHeight);
    ctx.clip();

    ctx.beginPath();
    ctx.strokeStyle = "#4f46e5";
    ctx.lineWidth = 3;
    points.forEach((point, index) => {
      const x = padding.left + ((point.year - minYear) / Math.max(1, maxYear - minYear)) * chartWidth;
      const y = padding.top + chartHeight - (point.wealth / maxWealth) * chartHeight;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const depletionPoint = points.find((point) => point.depletedThisYear);
    if (depletionPoint) {
      const x = padding.left + ((depletionPoint.year - minYear) / Math.max(1, maxYear - minYear)) * chartWidth;
      const y = padding.top + chartHeight - (depletionPoint.wealth / maxWealth) * chartHeight;
      ctx.fillStyle = "#e11d48";
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    if (Planner.state.detailHover) {
      drawDetailHover(ctx, Planner.state.detailHover, padding, width, height);
    }
  }



  function getNetWorthYAxisMax(results) {
    const percentileCap = Number(Planner.els.netWorthZoom.value) / 100;
    const visualMax = Math.max(
      results.scenario.netWorth,
      ...results.expectedPath.map((point) => point.wealth),
      ...results.visualPaths.flatMap((path) => path.points.map((point) => point.wealth))
    );

    if (percentileCap >= 1) return visualMax;
    const cap = Planner.percentile(results.terminalWealthSorted, percentileCap);
    return Math.max(results.scenario.netWorth, cap || 1, 1);
  }



  function updateNetWorthZoomLabel() {
    const value = Number(Planner.els.netWorthZoom.value);
    Planner.els.netWorthZoomLabel.textContent = value >= 100 ? "100%" : `${value}%`;
  }



  function drawChartLegend(ctx, width, padding) {
    ctx.font = "12px system-ui";
    ctx.textAlign = "right";
    ctx.fillStyle = "#4f46e5";
    ctx.fillText("Expected net worth", width - padding.right, 18);
    ctx.fillStyle = "#0ea5e9";
    ctx.fillText(`Downsampled paths (${Planner.MAX_VISUAL_PATHS} max)`, width - padding.right - 150, 18);
  }



  function drawBetaChartLegend(ctx, width, padding) {
    ctx.font = "12px system-ui";
    ctx.textAlign = "right";
    ctx.fillStyle = "#4f46e5";
    ctx.fillText("Average beta", width - padding.right, 18);
    ctx.fillStyle = "#0ea5e9";
    ctx.fillText(`Downsampled paths (${Planner.MAX_VISUAL_PATHS} max)`, width - padding.right - 118, 18);
  }



  function drawPathTooltip(ctx, hover, width, height) {
    Planner.drawFloatingTooltip(ctx, [
      `Ending: ${Planner.formatCurrency(hover.path.terminalWealth)}`,
      `Ending rank: ${Planner.formatPercent(hover.path.endingPercentile)}`,
      `Avg real SPY return: ${Planner.formatPercent(hover.path.averageRealSpyReturn)}`,
      hover.path.failureYear ? `Depleted: ${hover.path.failureYear}` : "Not depleted"
    ], hover.x, hover.y, width, height, 218);
  }



  function drawBetaPathTooltip(ctx, hover, width, height) {
    Planner.drawFloatingTooltip(ctx, [
      `Simulation: ${Planner.formatNumber(hover.path.simulation)}`,
      `Ending: ${Planner.formatCurrency(hover.path.terminalWealth)}`,
      hover.path.failureYear ? `Depleted: ${hover.path.failureYear}` : "Not depleted"
    ], hover.x, hover.y, width, height, 218);
  }



  function drawDetailHover(ctx, hover, padding, width, height) {
    ctx.save();
    ctx.strokeStyle = "rgba(79, 70, 229, 0.35)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(hover.point.x, padding.top);
    ctx.lineTo(hover.point.x, height - padding.bottom);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#4f46e5";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hover.point.x, hover.point.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    drawDetailPointTooltip(ctx, hover, width, height);
  }



  function drawDetailPointTooltip(ctx, hover, width, height) {
    Planner.drawFloatingTooltip(ctx, [
      `Year: ${hover.point.year}`,
      `Net worth: ${Planner.formatCurrency(hover.point.wealth)}`
    ], hover.x, hover.y, width, height, 196);
  }



  function handlePathHover(event) {
    handleSeriesChartHover(
      event,
      Planner.els.pathsCanvas,
      "overview",
      Planner.state.pathHitAreas,
      renderNetWorthChart
    );
  }



  function handleBetaPathHover(event) {
    handleSeriesChartHover(
      event,
      Planner.els.betaCanvas,
      "overview",
      Planner.state.betaPathHitAreas,
      renderBetaChart
    );
  }



  function handleDetailChartHover(event) {
    if (!Planner.state.results || Planner.state.activePage !== "details") return;

    const rect = Planner.els.selectedSimulationCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const nearest = findNearestDetailPoint(x, y);
    const nextHover = nearest ? { point: nearest, x, y } : null;
    const currentYear = Planner.state.detailHover ? Planner.state.detailHover.point.year : null;
    const nextYear = nextHover ? nextHover.point.year : null;

    if (currentYear !== nextYear || nextHover) {
      Planner.state.detailHover = nextHover;
      renderSelectedSimulationChart(Planner.els.selectedSimulationCanvas, Planner.state.results);
    }
  }



  function findNearestDetailPoint(x, y) {
    const points = Planner.state.detailHitPoints;
    if (!points.length) return null;

    let nearest = null;
    let nearestDistance = Infinity;
    for (const point of points) {
      const distance = Math.hypot(x - point.x, y - point.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = point;
      }
    }

    for (let i = 1; i < points.length; i += 1) {
      const distance = Planner.distanceToSegment(x, y, points[i - 1], points[i]);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        const distA = Math.hypot(x - points[i - 1].x, y - points[i - 1].y);
        const distB = Math.hypot(x - points[i].x, y - points[i].y);
        nearest = distA <= distB ? points[i - 1] : points[i];
      }
    }

    return nearestDistance <= 18 ? nearest : null;
  }



  function drawAxes(ctx, padding, width, height, yTitle) {
    ctx.strokeStyle = "#dfe3ee";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, height - padding.bottom);
    ctx.lineTo(width - padding.right, height - padding.bottom);
    ctx.stroke();

    ctx.fillStyle = "#6b7280";
    ctx.font = "12px system-ui";
    ctx.textAlign = "left";
    ctx.fillText(yTitle, padding.left, 16);
  }



  function drawEmptyState(ctx, width, height, message) {
    ctx.fillStyle = "#6b7280";
    ctx.font = "14px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(message, width / 2, height / 2);
  }



  function drawYProbabilityLabels(ctx, padding, chartHeight, maxProbability) {
    ctx.fillStyle = "#6b7280";
    ctx.font = "12px system-ui";
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i += 1) {
      const value = (maxProbability / 4) * i;
      const y = padding.top + chartHeight - (chartHeight / 4) * i;
      ctx.fillText(Planner.formatPercent(value), padding.left - 10, y + 4);
    }
  }



  function drawYMoneyLabels(ctx, padding, chartHeight, maxWealth) {
    ctx.fillStyle = "#6b7280";
    ctx.font = "12px system-ui";
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i += 1) {
      const value = (maxWealth / 4) * i;
      const y = padding.top + chartHeight - (chartHeight / 4) * i;
      ctx.fillText(Planner.formatCompactCurrency(value), padding.left - 10, y + 4);
    }
  }



  function drawYBetaLabels(ctx, padding, chartHeight, maxBeta) {
    ctx.fillStyle = "#6b7280";
    ctx.font = "12px system-ui";
    ctx.textAlign = "right";
    for (let i = 0; i <= 3; i += 1) {
      const value = (maxBeta / 3) * i;
      const y = padding.top + chartHeight - (chartHeight / 3) * i;
      ctx.fillText(Planner.formatBeta(value), padding.left - 10, y + 4);
    }
  }



  function drawEndingPercentileLabels(ctx, results, padding, chartHeight, width, maxWealth) {
    const percentiles = [0, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 1];
    ctx.fillStyle = "#6b7280";
    ctx.font = "12px system-ui";
    ctx.textAlign = "left";
    ctx.fillText("Ending rank", width - padding.right + 10, 16);
    let lastY = Infinity;
    percentiles.forEach((p) => {
      const wealth = Planner.percentile(results.terminalWealthSorted, p) || 0;
      if (wealth > maxWealth) return;
      const y = padding.top + chartHeight - (wealth / Math.max(1, maxWealth)) * chartHeight;
      if (lastY - y < 18) return;
      ctx.fillText(Planner.formatPercent(p), width - padding.right + 10, y + 4);
      lastY = y;
    });
  }



  function drawXYearLabels(ctx, padding, chartWidth, height, minYear, maxYear) {
    ctx.fillStyle = "#6b7280";
    ctx.font = "12px system-ui";
    ctx.textAlign = "center";
    for (let i = 0; i <= 4; i += 1) {
      const year = Math.round(minYear + ((maxYear - minYear) / 4) * i);
      const x = padding.left + (chartWidth / 4) * i;
      ctx.fillText(String(year), x, height - 24);
    }
  }


  Object.assign(Planner, {
    renderCharts,
    renderDistributionChart,
    renderNetWorthChart,
    renderBetaChart,
    renderSelectedSimulationChart,
    getNetWorthYAxisMax,
    updateNetWorthZoomLabel,
    handlePathHover,
    handleBetaPathHover,
    handleDetailChartHover
  });
})(window.Planner = window.Planner || {});
