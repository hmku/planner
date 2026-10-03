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
    root.querySelectorAll("[data-format]").forEach((input) => formatInputValue(input));
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

  // Every number shown in the UI goes through this file (tests/unit.js checks
  // that nothing else formats numbers). Money is always compact ($2.1M,
  // $850K, $450) via formatMoney(); only editable inputs show full dollars.
  const currencyFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const centsFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const moneyFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 });
  const percentFormat = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
  const betaFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const secondsFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  function isMissing(value) {
    return value === null || value === "" || !Number.isFinite(value);
  }

  function formatInputCurrency(value) {
    const hasCents = Math.abs(value % 1) > 0.000001;
    return (hasCents ? centsFormat : currencyFormat).format(value);
  }

  function formatMoney(value) {
    return isMissing(value) ? "--" : moneyFormat.format(value);
  }

  function formatPercent(value) {
    return isMissing(value) ? "--" : percentFormat.format(value);
  }

  // More precision for small probabilities, where 0.4% vs 0.04% matters.
  function formatPolicyRiskPercent(value) {
    if (isMissing(value)) return "--";
    if (value === 0) return "0%";
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
    return isMissing(value) ? "--" : betaFormat.format(value);
  }

  function formatSeconds(milliseconds) {
    return `${secondsFormat.format(milliseconds / 1000)}s`;
  }

  function formatNumber(value) {
    return numberFormat.format(value);
  }

  Object.assign(Planner, {
    bindFormattedInputs,
    formatAllFormattedInputs,
    formatMoney,
    formatPercent,
    formatPolicyRiskPercent,
    formatBeta,
    formatNumber,
    formatSeconds
  });
})(window.Planner = window.Planner || {});
