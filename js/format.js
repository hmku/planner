(function (Planner) {
  function bindFormattedInputs(root) {
    root.querySelectorAll("[data-format]").forEach((input) => {
      if (input.dataset.formatBound === "true") return;
      input.dataset.formatBound = "true";
      input.addEventListener("focus", () => {
        input.select();
      });
      input.addEventListener("input", () => {
        formatInputValue(input, { preserveCaret: true, editing: true });
      });
      input.addEventListener("blur", () => {
        formatInputValue(input);
      });
    });
  }

  function formatAllFormattedInputs(root) {
    root.querySelectorAll("[data-format]").forEach(formatInputValue);
  }

  function formatInputValue(input, options = {}) {
    const value = Planner.numberFromInput(input);
    if (input.value.trim() === "") return;

    if (options.editing) {
      formatInputWhileEditing(input, options);
      return;
    }

    if (!Number.isFinite(value)) {
      input.value = "";
      return;
    }
    if (input.dataset.format === "money") {
      input.value = formatInputCurrency(value);
      return;
    }
    if (input.dataset.format === "integer") {
      input.value = formatNumber(Math.round(value));
    }
  }

  function formatInputWhileEditing(input, options = {}) {
    const caret = input.selectionStart ?? input.value.length;
    const digitsBeforeCaret = countDigits(input.value.slice(0, caret));
    const formatted = input.dataset.format === "money"
      ? formatEditableMoney(input.value)
      : formatEditableInteger(input.value);

    input.value = formatted;
    if (options.preserveCaret) {
      const nextCaret = caretAfterDigitCount(formatted, digitsBeforeCaret);
      input.setSelectionRange(nextCaret, nextCaret);
    }
  }

  function formatEditableMoney(raw) {
    const cleaned = raw.replace(/[$,\s]/g, "").replace(/[^\d.]/g, "");
    if (!cleaned) return "";
    const firstDot = cleaned.indexOf(".");
    const wholeRaw = firstDot === -1 ? cleaned : cleaned.slice(0, firstDot);
    const decimalRaw = firstDot === -1 ? "" : cleaned.slice(firstDot + 1).replace(/\./g, "").slice(0, 2);
    const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
    const suffix = firstDot === -1 ? "" : `.${decimalRaw}`;
    return `$${formatDigitsWithCommas(whole)}${suffix}`;
  }

  function formatEditableInteger(raw) {
    const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    return digits ? formatDigitsWithCommas(digits) : "";
  }

  function formatDigitsWithCommas(digits) {
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function countDigits(value) {
    return (value.match(/\d/g) || []).length;
  }

  function caretAfterDigitCount(value, digitCount) {
    if (digitCount <= 0) {
      const firstDigit = value.search(/\d/);
      return firstDigit === -1 ? value.length : firstDigit;
    }

    let seen = 0;
    for (let index = 0; index < value.length; index += 1) {
      if (/\d/.test(value[index])) {
        seen += 1;
        if (seen === digitCount) return index + 1;
      }
    }
    return value.length;
  }

  function formatCurrency(value) {
    if (value === null || !Number.isFinite(value)) return "--";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0
    }).format(value);
  }

  function formatInputCurrency(value) {
    const hasCents = Math.abs(value % 1) > 0.000001;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: hasCents ? 2 : 0
    }).format(value);
  }

  function formatCompactCurrency(value) {
    if (value === null || !Number.isFinite(value)) return "--";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1
    }).format(value);
  }

  function formatPercent(value) {
    if (value === null || !Number.isFinite(value)) return "--";
    return new Intl.NumberFormat("en-US", {
      style: "percent",
      maximumFractionDigits: 1
    }).format(value);
  }

  function formatPolicyRiskPercent(value) {
    if (value === null || !Number.isFinite(value)) return "--";
    const percent = value * 100;
    const absolutePercent = Math.abs(percent);
    const fractionDigits = absolutePercent > 0 && absolutePercent < 10
      ? 2
      : absolutePercent < 100
        ? 1
        : 0;
    return `${percent.toFixed(fractionDigits)}%`;
  }

  function formatBeta(value) {
    if (value === null || !Number.isFinite(value)) return "--";
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(value);
  }

  function formatShareNumber(value) {
    const text = String(Number(value));
    return text.startsWith("0.") ? text.slice(1) : text;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
  }

  Object.assign(Planner, {
    bindFormattedInputs,
    formatAllFormattedInputs,
    formatInputValue,
    formatInputWhileEditing,
    formatEditableMoney,
    formatEditableInteger,
    formatDigitsWithCommas,
    countDigits,
    caretAfterDigitCount,
    formatShareNumber,
    formatCurrency,
    formatInputCurrency,
    formatCompactCurrency,
    formatPercent,
    formatPolicyRiskPercent,
    formatBeta,
    formatNumber
  });
})(window.Planner = window.Planner || {});
