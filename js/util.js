(function (Planner) {
  function csvCell(value) {
    const text = String(value);
    if (/[",\n]/.test(text)) {
      return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
  }


  function validatePlanYear(year, label) {
    if (!Number.isInteger(year) || year < Planner.MIN_PLAN_YEAR || year > Planner.MAX_PLAN_YEAR) {
      throw new Error(`${label} must be between ${Planner.MIN_PLAN_YEAR} and ${Planner.MAX_PLAN_YEAR}.`);
    }
  }


  function numberFromInput(input) {
    const raw = input.value.trim().replace(/[$,\s]/g, "");
    return raw === "" ? Number.NaN : Number(raw);
  }


  function yieldToBrowser() {
    return new Promise((resolve) => {
      window.setTimeout(resolve, 0);
    });
  }


  function range(start, end) {
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }


  function randomIndex(length, random = Math.random) {
    return Math.floor(random() * length);
  }


  function generateSimulationSeed() {
    if (window.crypto && window.crypto.getRandomValues) {
      const values = new Uint32Array(1);
      window.crypto.getRandomValues(values);
      return values[0];
    }
    return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  }


  function normalizeSeed(seed) {
    const value = Number(seed);
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
      throw new Error("The simulation seed is invalid.");
    }
    return value >>> 0;
  }


  function createSeededRandom(seed) {
    let value = normalizeSeed(seed);
    return () => {
      value = (value + 0x6d2b79f5) >>> 0;
      let next = value;
      next = Math.imul(next ^ (next >>> 15), next | 1);
      next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
      return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
    };
  }


  function percentile(values, p) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  }


  function percentileRank(sortedValues, value) {
    if (!sortedValues.length) return null;
    let low = 0;
    let high = sortedValues.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (sortedValues[mid] <= value) low = mid + 1;
      else high = mid;
    }
    return (low - 1) / Math.max(1, sortedValues.length - 1);
  }


  function distanceToSegment(x, y, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return Math.hypot(x - a.x, y - a.y);
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared));
    const projectionX = a.x + t * dx;
    const projectionY = a.y + t * dy;
    return Math.hypot(x - projectionX, y - projectionY);
  }


  function fitCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const backingWidth = Math.round(width * pixelRatio);
    const backingHeight = Math.round(height * pixelRatio);
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth;
      canvas.height = backingHeight;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    return { width, height };
  }


  function clearCanvas(ctx, width, height) {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#fcfdff";
    ctx.fillRect(0, 0, width, height);
  }


  function downloadCsvFile(filename, headers, rows) {
    const csv = [headers, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }


  function populateSelect(select, items, { getValue, getLabel, previousValue, placeholder = null } = {}) {
    if (placeholder) {
      const option = document.createElement("option");
      option.value = placeholder.value ?? "";
      option.textContent = placeholder.label;
      select.replaceChildren(option);
      select.disabled = Boolean(placeholder.disabled);
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((item, index) => {
      const option = document.createElement("option");
      option.value = String(getValue(item, index));
      option.textContent = getLabel(item, index);
      fragment.appendChild(option);
    });
    select.replaceChildren(fragment);
    select.disabled = false;

    const fallbackValue = String(getValue(items[0], 0));
    const nextValue = String(previousValue ?? fallbackValue);
    select.value = items.some((item, index) => String(getValue(item, index)) === nextValue)
      ? nextValue
      : fallbackValue;
  }


  function renderTableBody(tbody, columns, rows, emptyMessage) {
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${columns.length}">${emptyMessage}</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map((row) => [
      "<tr>",
      ...columns.map((column) => `<td>${column.render(row)}</td>`),
      "</tr>"
    ].join("")).join("");
  }


  function getYearSpan(scenario) {
    return { minYear: scenario.currentYear, maxYear: scenario.deathYear };
  }


  function normalizeRiskThreshold(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(1, number));
  }


  function yearToX(year, minYear, maxYear, padding, chartWidth) {
    return padding.left + ((year - minYear) / Math.max(1, maxYear - minYear)) * chartWidth;
  }


  function drawFloatingTooltip(ctx, lines, anchorX, anchorY, canvasWidth, canvasHeight, boxWidth) {
    const boxHeight = 18 + lines.length * 20;
    const x = Math.min(canvasWidth - boxWidth - 12, Math.max(12, anchorX + 14));
    const y = Math.min(canvasHeight - boxHeight - 12, Math.max(12, anchorY - boxHeight - 12));

    ctx.fillStyle = "rgba(26, 31, 46, 0.92)";
    ctx.fillRect(x, y, boxWidth, boxHeight);
    ctx.fillStyle = "#ffffff";
    ctx.font = "13px system-ui";
    ctx.textAlign = "left";
    lines.forEach((line, index) => {
      ctx.fillText(line, x + 12, y + 24 + index * 20);
    });
  }


  function findNearestSegmentHit(hitAreas, x, y, threshold = 10) {
    let nearest = null;
    let nearestDistance = Infinity;
    for (const area of hitAreas) {
      for (let index = 1; index < area.points.length; index += 1) {
        const distance = distanceToSegment(x, y, area.points[index - 1], area.points[index]);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = area;
        }
      }
    }
    return nearestDistance <= threshold ? nearest : null;
  }

  Object.assign(Planner, {
    csvCell,
    downloadCsvFile,
    populateSelect,
    renderTableBody,
    validatePlanYear,
    numberFromInput,
    yieldToBrowser,
    range,
    randomIndex,
    generateSimulationSeed,
    normalizeSeed,
    createSeededRandom,
    percentile,
    percentileRank,
    distanceToSegment,
    fitCanvas,
    clearCanvas,
    getYearSpan,
    normalizeRiskThreshold,
    yearToX,
    drawFloatingTooltip,
    findNearestSegmentHit
  });
})(window.Planner = window.Planner || {});
