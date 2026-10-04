(function (Planner) {
  function csvCell(value) {
    const text = value === null || value === undefined ? "" : String(value);
    if (/[",\n]/.test(text)) {
      return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
  }


  // Columns: [header, value(record)]. Records may be any iterable (including a
  // generator), so large exports are built in chunks rather than as one giant
  // string.
  function downloadCsvFile(filename, columns, records) {
    const parts = [columns.map(([header]) => csvCell(header)).join(",")];
    let chunk = [];
    for (const record of records) {
      chunk.push(columns.map(([, value]) => csvCell(value(record))).join(","));
      if (chunk.length === 5000) {
        parts.push(`\n${chunk.join("\n")}`);
        chunk = [];
      }
    }
    if (chunk.length) parts.push(`\n${chunk.join("\n")}`);

    const url = URL.createObjectURL(new Blob(parts, { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoking immediately can cancel the download before the browser reads the blob.
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }


  function populateSelect(select, items, { getValue, getLabel, previousValue, placeholder = null } = {}) {
    if (placeholder || !items.length) {
      const option = document.createElement("option");
      option.value = placeholder?.value ?? "";
      option.textContent = placeholder?.label ?? "None";
      select.replaceChildren(option);
      select.disabled = true;
      return;
    }

    const fragment = document.createDocumentFragment();
    const values = items.map((item, index) => String(getValue(item, index)));
    items.forEach((item, index) => {
      const option = document.createElement("option");
      option.value = values[index];
      option.textContent = getLabel(item, index);
      fragment.appendChild(option);
    });
    select.replaceChildren(fragment);
    select.disabled = false;

    const nextValue = previousValue === null || previousValue === undefined ? values[0] : String(previousValue);
    select.value = values.includes(nextValue) ? nextValue : values[0];
  }


  // Columns: { render(row) -> string, className? }. Rendered values are app-generated
  // numbers and labels, never free-form user text.
  function renderTableBody(tbody, columns, rows, emptyMessage, getRowClass = () => "") {
    if (!rows.length) {
      tbody.innerHTML = `<tr><td class="empty" colspan="${columns.length}">${emptyMessage}</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map((row) => {
      const rowClass = getRowClass(row);
      const cells = columns.map((column) => {
        const className = typeof column.className === "function" ? column.className(row) : column.className;
        return className ? `<td class="${className}">${column.render(row)}</td>` : `<td>${column.render(row)}</td>`;
      });
      return `<tr${rowClass ? ` class="${rowClass}"` : ""}>${cells.join("")}</tr>`;
    }).join("");
  }


  // A cash flow's amount in a given year, in today's dollars. Fixed-dollar
  // payments (a mortgage) carry deflateRate and shrink with inflation from
  // deflateFrom; everything else is flat in today's dollars.
  function flowAmountForYear(flow, year) {
    return flow.deflateRate ? flow.amount / (1 + flow.deflateRate) ** (year - flow.deflateFrom) : flow.amount;
  }


  // Total of the flows active in a year (startYear..endYear inclusive).
  function flowsTotalForYear(flows, year) {
    return flows.reduce((sum, flow) => (
      year < flow.startYear || year > flow.endYear ? sum : sum + flowAmountForYear(flow, year)
    ), 0);
  }


  function validatePlanYear(year, label) {
    if (!Number.isInteger(year) || year < Planner.MIN_PLAN_YEAR || year > Planner.MAX_PLAN_YEAR) {
      throw new Error(`${label} must be a whole year between ${Planner.MIN_PLAN_YEAR} and ${Planner.MAX_PLAN_YEAR}.`);
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


  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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


  // mulberry32
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


  // Linear-interpolated percentile of an already ascending-sorted array.
  function percentileOfSorted(sorted, p) {
    if (!sorted.length) return null;
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
      const mid = (low + high) >>> 1;
      if (sortedValues[mid] <= value) low = mid + 1;
      else high = mid;
    }
    return (low - 1) / Math.max(1, sortedValues.length - 1);
  }


  // A round step (1, 2, 2.5, 5 x 10^n) giving roughly `count` intervals over `span`.
  function niceStep(span, count) {
    const raw = Math.max(Number.EPSILON, span) / Math.max(1, count);
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const normalized = raw / magnitude;
    const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
    return factor * magnitude;
  }


  function niceTicks(min, max, count = 4, { integer = false } = {}) {
    const upper = max > min ? max : min + 1;
    let step = niceStep(upper - min, count);
    if (integer) step = Math.max(1, Math.round(step));
    const ticks = [];
    for (let value = Math.ceil(min / step) * step; value <= upper + step * 1e-9; value += step) {
      ticks.push(Number(value.toPrecision(12)));
    }
    return ticks;
  }


  // Zero-based axis rounded up to a nice maximum.
  function niceZeroScale(max, count = 4) {
    const step = niceStep(Math.max(max, Number.EPSILON), count);
    const niceMax = Math.max(step, Math.ceil(max / step - 1e-9) * step);
    return { max: niceMax, ticks: niceTicks(0, niceMax, Math.round(niceMax / step)) };
  }


  function distanceToSegment(x, y, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return Math.hypot(x - a.x, y - a.y);
    const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / lengthSquared, 0, 1);
    return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
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
    return { ctx, width, height };
  }

  Object.assign(Planner, {
    flowAmountForYear,
    flowsTotalForYear,
    downloadCsvFile,
    populateSelect,
    renderTableBody,
    validatePlanYear,
    numberFromInput,
    yieldToBrowser,
    range,
    clamp,
    randomIndex,
    generateSimulationSeed,
    normalizeSeed,
    createSeededRandom,
    percentileOfSorted,
    percentileRank,
    niceTicks,
    niceZeroScale,
    distanceToSegment,
    fitCanvas
  });
})(window.Planner = window.Planner || {});
