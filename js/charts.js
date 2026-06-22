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
    if (Planner.state.activePage === "policy") {
      if (Planner.renderDynamicPolicyTable) Planner.renderDynamicPolicyTable(results);
      renderPolicyPathChart(Planner.els.policyPathCanvas, results, results.policyPathExplorer);
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
    const maxBeta = Math.max(1.5, results.scenario.spxBeta || 0, ...Planner.DYNAMIC_BETA_VALUES);
    const hoverIndex = Planner.state.hover ? Planner.state.hover.index : null;

    Planner.els.betaPathSummary.textContent = results.scenario.betaMode === Planner.BETA_MODE_DYNAMIC
      ? "Average recommended beta and downsampled simulation beta paths."
      : `Fixed beta ${Planner.formatBeta(results.scenario.spxBeta)} across every active path.`;

    drawAxes(ctx, padding, width, height, "SPX beta");
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



  function renderPolicyPathChart(canvas, results, explorer) {
    const { ctx, width, height } = beginChart(canvas);
    if (!results.dynamicPolicy || !explorer) {
      drawEmptyState(ctx, width, height, "Run dynamic beta to inspect a policy path.");
      return;
    }

    const policy = results.dynamicPolicy;
    const visibleBuckets = policy.wealthBuckets
      .map((wealth, bucketIndex) => ({ wealth, bucketIndex }))
      .filter((bucket) => (
        bucket.wealth > 0 && bucket.wealth <= Planner.DYNAMIC_DISPLAY_MAX_WEALTH_BUCKET
      ));
    if (!visibleBuckets.length) {
      drawEmptyState(ctx, width, height, "No visible wealth buckets for this policy.");
      return;
    }

    const padding = { top: 34, right: 118, bottom: 58, left: 88 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const yearCount = results.years.length;
    const cellWidth = chartWidth / Math.max(1, yearCount);
    const cellHeight = chartHeight / visibleBuckets.length;
    const minWealth = visibleBuckets[0].wealth;
    const maxWealth = visibleBuckets[visibleBuckets.length - 1].wealth;

    drawAxes(ctx, padding, width, height, "Wealth bucket");
    drawXYearLabels(ctx, padding, chartWidth, height, results.scenario.currentYear, results.scenario.deathYear);
    drawPolicyWealthLabels(ctx, padding, chartHeight, minWealth, maxWealth);

    ctx.save();
    ctx.beginPath();
    ctx.rect(padding.left, padding.top, chartWidth, chartHeight);
    ctx.clip();

    results.years.forEach((year, yearIndex) => {
      const policyRow = policy.policyByYear[yearIndex] || [];
      visibleBuckets.forEach((bucket, visibleIndex) => {
        const beta = policyRow[bucket.bucketIndex] ?? 0;
        const x = padding.left + yearIndex * cellWidth;
        const y = padding.top + chartHeight - (visibleIndex + 1) * cellHeight;
        ctx.fillStyle = policyBetaColor(beta);
        ctx.fillRect(x, y, Math.ceil(cellWidth) + 0.5, Math.ceil(cellHeight) + 0.5);
      });
    });

    drawPolicyPathOverlay(ctx, explorer, results, padding, chartWidth, chartHeight, minWealth, maxWealth, cellWidth);
    ctx.restore();
    drawPolicyLegend(ctx, width, padding);
  }



  function renderPolicyBucketPlot(canvas, results, rows, metric, currentBucketIndex) {
    const { ctx, width, height } = beginChart(canvas);
    const plotRows = rows.filter((row) => row.wealth > 0);
    if (!plotRows.length) {
      drawEmptyState(ctx, width, height, "No visible wealth buckets for this year.");
      return;
    }

    const padding = { top: 34, right: 34, bottom: 62, left: 86 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const minWealth = plotRows[0].wealth;
    const maxWealth = plotRows[plotRows.length - 1].wealth;
    const yScale = getPolicyMetricScale(plotRows, metric);

    drawAxes(ctx, padding, width, height, getPolicyMetricLabel(metric));
    drawPolicyBucketXLabels(ctx, padding, chartWidth, height, minWealth, maxWealth);
    drawPolicyMetricYLabels(ctx, padding, chartHeight, yScale, metric);

    ctx.save();
    ctx.beginPath();
    ctx.rect(padding.left, padding.top, chartWidth, chartHeight);
    ctx.clip();

    const points = plotRows.map((row) => ({
      row,
      x: policyWealthToX(row.wealth, padding, chartWidth, minWealth, maxWealth),
      y: policyMetricToY(getPolicyMetricValue(row, metric), padding, chartHeight, yScale)
    }));

    ctx.strokeStyle = "#4f46e5";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();

    points.forEach((point) => {
      ctx.fillStyle = "#4f46e5";
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });

    drawCurrentWealthMarker(ctx, results, points, currentBucketIndex, padding, chartWidth, chartHeight, minWealth, maxWealth);
    ctx.restore();
  }



  function drawCurrentWealthMarker(ctx, results, points, currentBucketIndex, padding, chartWidth, chartHeight, minWealth, maxWealth) {
    const currentWealth = results.scenario.netWorth;
    if (currentWealth < minWealth || currentWealth > maxWealth) return;

    const x = policyWealthToX(currentWealth, padding, chartWidth, minWealth, maxWealth);
    ctx.save();
    ctx.strokeStyle = "rgba(249, 115, 22, 0.9)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + chartHeight);
    ctx.stroke();
    ctx.restore();

    if (Number.isFinite(currentBucketIndex)) {
      const markerPoint = points.find((point) => point.row.bucketIndex === currentBucketIndex);
      if (markerPoint) {
        ctx.fillStyle = "#f97316";
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(markerPoint.x, markerPoint.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.fillStyle = "#f97316";
    ctx.font = "12px system-ui";
    ctx.textAlign = x > padding.left + chartWidth - 96 ? "right" : "left";
    ctx.fillText("Current wealth", x + (ctx.textAlign === "right" ? -8 : 8), padding.top + 16);
  }



  function policyWealthToX(wealth, padding, chartWidth, minWealth, maxWealth) {
    const clampedWealth = Math.max(minWealth, Math.min(maxWealth, wealth));
    const t = (Math.log(clampedWealth) - Math.log(minWealth)) / Math.max(0.000001, Math.log(maxWealth) - Math.log(minWealth));
    return padding.left + t * chartWidth;
  }



  function policyMetricToY(value, padding, chartHeight, scale) {
    if (scale.log) {
      if (value <= 0) return padding.top + chartHeight;
      const clampedValue = Math.max(scale.min, Math.min(scale.max, value));
      const t = (Math.log(clampedValue) - Math.log(scale.min)) / Math.max(0.000001, Math.log(scale.max) - Math.log(scale.min));
      return padding.top + chartHeight - t * chartHeight;
    }
    return padding.top + chartHeight - (value / Math.max(0.000001, scale.max)) * chartHeight;
  }



  function getPolicyMetricValue(row, metric) {
    if (metric === "risk") return row.estimatedDepletionRisk;
    if (metric === "terminalWealth") return row.expectedTerminalWealth;
    return row.beta;
  }



  function getPolicyMetricScale(rows, metric) {
    if (metric === "beta") return { min: 0, max: Math.max(1.5, ...rows.map((row) => row.beta || 0)), log: false };
    const maxValue = Math.max(...rows.map((row) => getPolicyMetricValue(row, metric) || 0));
    if (metric === "risk") return { min: 0, max: Math.max(0.01, maxValue), log: false };
    const positiveValues = rows
      .map((row) => getPolicyMetricValue(row, metric))
      .filter((value) => Number.isFinite(value) && value > 0);
    const minValue = Math.min(...positiveValues);
    return {
      min: Number.isFinite(minValue) ? minValue : 1,
      max: Math.max(1, maxValue),
      log: true
    };
  }



  function getPolicyMetricLabel(metric) {
    if (metric === "risk") return "Estimated depletion risk";
    if (metric === "terminalWealth") return "Expected terminal wealth";
    return "Policy beta";
  }



  function formatPolicyMetricValue(value, metric) {
    if (metric === "risk") return Planner.formatPolicyRiskPercent(value);
    if (metric === "terminalWealth") return Planner.formatCompactCurrency(value);
    return Planner.formatBeta(value);
  }



  function drawPolicyBucketXLabels(ctx, padding, chartWidth, height, minWealth, maxWealth) {
    ctx.fillStyle = "#6b7280";
    ctx.font = "12px system-ui";
    ctx.textAlign = "center";
    [minWealth, 100000, 1000000, 10000000, 100000000, maxWealth].forEach((wealth) => {
      if (wealth < minWealth || wealth > maxWealth) return;
      const x = policyWealthToX(wealth, padding, chartWidth, minWealth, maxWealth);
      ctx.fillText(Planner.formatCompactCurrency(wealth), x, height - 24);
    });
  }



  function drawPolicyMetricYLabels(ctx, padding, chartHeight, scale, metric) {
    ctx.fillStyle = "#6b7280";
    ctx.font = "12px system-ui";
    ctx.textAlign = "right";
    const values = scale.log
      ? logScaleLabelValues(scale.min, scale.max)
      : [0, 0.25, 0.5, 0.75, 1].map((share) => scale.max * share);
    values.forEach((value) => {
      const y = policyMetricToY(value, padding, chartHeight, scale);
      ctx.fillText(formatPolicyMetricValue(value, metric), padding.left - 10, y + 4);
    });
  }



  function logScaleLabelValues(minValue, maxValue) {
    if (maxValue <= minValue) return [minValue];
    const values = [];
    for (let i = 0; i <= 4; i += 1) {
      const t = i / 4;
      values.push(Math.exp(Math.log(minValue) + (Math.log(maxValue) - Math.log(minValue)) * t));
    }
    return values;
  }



  function drawPolicyPathOverlay(ctx, explorer, results, padding, chartWidth, chartHeight, minWealth, maxWealth, cellWidth) {
    const points = explorer.points.map((point) => {
      const yearIndex = Math.max(0, Math.min(results.years.length - 1, point.year - results.scenario.currentYear));
      return {
        x: padding.left + yearIndex * cellWidth + cellWidth / 2,
        y: policyWealthToY(point.wealth, padding, chartHeight, minWealth, maxWealth),
        year: point.year,
        wealth: point.wealth
      };
    });
    if (!points.length) return;

    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#f97316";
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();

    points.forEach((point, index) => {
      ctx.fillStyle = index === 0 ? "#1a1f2e" : "#f97316";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(point.x, point.y, index === points.length - 1 ? 5 : 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
  }



  function policyWealthToY(wealth, padding, chartHeight, minWealth, maxWealth) {
    if (wealth <= 0) return padding.top + chartHeight;
    const clampedWealth = Math.max(minWealth, Math.min(maxWealth, wealth));
    const t = (Math.log(clampedWealth) - Math.log(minWealth)) / Math.max(0.000001, Math.log(maxWealth) - Math.log(minWealth));
    return padding.top + chartHeight - t * chartHeight;
  }



  function policyBetaColor(beta) {
    const t = Math.max(0, Math.min(1, beta / 1.5));
    const hue = 205 - t * 175;
    const saturation = 68 + t * 8;
    const lightness = 86 - t * 28;
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }



  function drawPolicyWealthLabels(ctx, padding, chartHeight, minWealth, maxWealth) {
    ctx.fillStyle = "#6b7280";
    ctx.font = "12px system-ui";
    ctx.textAlign = "right";
    [minWealth, 100000, 1000000, 10000000, 100000000, maxWealth].forEach((wealth) => {
      if (wealth < minWealth || wealth > maxWealth) return;
      const y = policyWealthToY(wealth, padding, chartHeight, minWealth, maxWealth);
      ctx.fillText(Planner.formatCompactCurrency(wealth), padding.left - 10, y + 4);
    });
  }



  function drawPolicyLegend(ctx, width, padding) {
    ctx.font = "12px system-ui";
    ctx.textAlign = "right";
    ctx.fillStyle = "#f97316";
    ctx.fillText("Forced path", width - padding.right, 18);
    ctx.fillStyle = "#6b7280";
    ctx.fillText("Color: recommended beta", width - padding.right - 96, 18);
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
      `Avg real SPX return: ${Planner.formatPercent(hover.path.averageRealSpxReturn)}`,
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
    renderPolicyBucketPlot,
    renderPolicyPathChart,
    getNetWorthYAxisMax,
    updateNetWorthZoomLabel,
    handlePathHover,
    handleBetaPathHover,
    handleDetailChartHover
  });
})(window.Planner = window.Planner || {});
