(function () {
  "use strict";

  var state = {
    lang: "ru",
    theme: "auto",
    currency: "KGS",
    horizon: 5,
    cashflows: [],
  };

  var DEFAULT_PATTERN_BASE = [250000, 300000, 350000, 350000, 400000, 400000, 450000, 450000, 500000, 500000];

  var chart = null;

  function loadPrefs() {
    try {
      var saved = JSON.parse(localStorage.getItem("invcalc_prefs") || "{}");
      if (saved.lang) state.lang = saved.lang;
      if (saved.theme) state.theme = saved.theme;
      if (saved.currency) state.currency = saved.currency;
    } catch (e) {
      /* localStorage may be unavailable (private mode) — ignore, defaults stay */
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(
        "invcalc_prefs",
        JSON.stringify({ lang: state.lang, theme: state.theme, currency: state.currency })
      );
    } catch (e) {
      /* ignore */
    }
  }

  function applyTheme() {
    if (state.theme === "auto") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", state.theme);
    }
    document.querySelectorAll("#theme-switch button").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.themeChoice === state.theme);
    });
  }

  function applyLang() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(state.lang, el.getAttribute("data-i18n"));
    });
    document.querySelectorAll("#lang-switch button").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.lang === state.lang);
    });
    document.getElementById("currency").value = state.currency;
    renderResultsShell();
    renderCashflowLabels();
    compute();
  }

  function buildHorizonOptions() {
    var select = document.getElementById("horizon");
    select.innerHTML = "";
    for (var i = 1; i <= 10; i++) {
      var opt = document.createElement("option");
      opt.value = i;
      opt.textContent = i;
      select.appendChild(opt);
    }
    select.value = state.horizon;
  }

  function ensureCashflowsLength() {
    var n = state.horizon;
    while (state.cashflows.length < n) {
      var idx = state.cashflows.length;
      state.cashflows.push(DEFAULT_PATTERN_BASE[idx] || DEFAULT_PATTERN_BASE[DEFAULT_PATTERN_BASE.length - 1]);
    }
    state.cashflows.length = n;
  }

  function renderCashflowInputs() {
    ensureCashflowsLength();
    var grid = document.getElementById("cashflow-grid");
    grid.innerHTML = "";
    for (var i = 0; i < state.horizon; i++) {
      var item = document.createElement("div");
      item.className = "cashflow-item";
      var label = document.createElement("label");
      label.setAttribute("for", "cf-" + i);
      label.textContent = t(state.lang, "yearLabel") + " " + (i + 1);
      var input = document.createElement("input");
      input.type = "text";
      input.inputMode = "numeric";
      input.id = "cf-" + i;
      input.value = formatGroupedDisplay(state.cashflows[i]);
      input.dataset.index = i;
      input.addEventListener("input", function (e) {
        var idx = parseInt(e.target.dataset.index, 10);
        state.cashflows[idx] = formatThousandsInput(e.target);
        compute();
      });
      item.appendChild(label);
      item.appendChild(input);
      grid.appendChild(item);
    }
  }

  function renderCashflowLabels() {
    document.querySelectorAll("#cashflow-grid label").forEach(function (label, i) {
      label.textContent = t(state.lang, "yearLabel") + " " + (i + 1);
    });
  }

  var METRIC_DEFS = [
    { key: "npv", labelKey: "npvLabel", tooltipKey: "npvTooltip" },
    { key: "irr", labelKey: "irrLabel", tooltipKey: "irrTooltip" },
    { key: "payback", labelKey: "paybackLabel", tooltipKey: "paybackTooltip" },
    { key: "discPayback", labelKey: "discPaybackLabel", tooltipKey: "discPaybackTooltip" },
    { key: "pi", labelKey: "piLabel", tooltipKey: "piTooltip" },
  ];

  function renderResultsShell() {
    var grid = document.getElementById("results-grid");
    grid.innerHTML = "";
    METRIC_DEFS.forEach(function (def) {
      var card = document.createElement("div");
      card.className = "metric-card";
      card.id = "metric-" + def.key;

      var head = document.createElement("div");
      head.className = "metric-head";

      var label = document.createElement("span");
      label.className = "label";
      label.textContent = t(state.lang, def.labelKey);

      var tipBtn = document.createElement("button");
      tipBtn.type = "button";
      tipBtn.className = "tooltip-btn";
      tipBtn.appendChild(document.createTextNode("?"));

      var bubble = document.createElement("span");
      bubble.className = "tooltip-bubble";
      bubble.textContent = t(state.lang, def.tooltipKey);
      tipBtn.appendChild(bubble);

      head.appendChild(label);
      head.appendChild(tipBtn);

      var value = document.createElement("div");
      value.className = "metric-value";
      value.id = "value-" + def.key;
      value.textContent = "—";

      card.appendChild(head);
      card.appendChild(value);
      grid.appendChild(card);
    });
  }

  // Не даём подсказке вылезти за правый/левый край экрана (важно на телефоне)
  function keepTooltipInViewport(tipBtn) {
    var bubble = tipBtn.querySelector(".tooltip-bubble");
    if (!bubble) return;
    bubble.style.left = "0";
    var rect = bubble.getBoundingClientRect();
    var overflowRight = rect.right - (window.innerWidth - 8);
    if (overflowRight > 0) {
      bubble.style.left = -overflowRight + "px";
    }
  }

  document.addEventListener("click", function (e) {
    var tipBtn = e.target.closest(".tooltip-btn");
    var wasOpen = tipBtn && tipBtn.classList.contains("open");
    document.querySelectorAll(".tooltip-btn.open").forEach(function (b) {
      b.classList.remove("open");
    });
    if (tipBtn && !wasOpen) {
      tipBtn.classList.add("open");
      keepTooltipInViewport(tipBtn);
    }
  });

  // ===== Финансовые расчёты =====

  function npv(rate, capex, flows) {
    var r = rate / 100;
    var total = -capex;
    for (var i = 0; i < flows.length; i++) {
      total += flows[i] / Math.pow(1 + r, i + 1);
    }
    return total;
  }

  function irr(capex, flows) {
    // Метод бисекции: ищем ставку, при которой NPV = 0
    function npvAtRatePct(ratePct) {
      return npv(ratePct, capex, flows);
    }
    var lo = -99; // -99%
    var hi = 1000; // 1000%
    var fLo = npvAtRatePct(lo);
    var fHi = npvAtRatePct(hi);
    if (isNaN(fLo) || isNaN(fHi) || fLo * fHi > 0) {
      return null; // корень не найден в диапазоне
    }
    for (var iter = 0; iter < 200; iter++) {
      var mid = (lo + hi) / 2;
      var fMid = npvAtRatePct(mid);
      if (Math.abs(fMid) < 1e-6) return mid;
      if (fLo * fMid < 0) {
        hi = mid;
        fHi = fMid;
      } else {
        lo = mid;
        fLo = fMid;
      }
    }
    return (lo + hi) / 2;
  }

  function simplePayback(capex, flows) {
    var remaining = capex;
    for (var i = 0; i < flows.length; i++) {
      if (flows[i] <= 0) {
        remaining -= flows[i];
        continue;
      }
      if (remaining <= flows[i]) {
        return i + remaining / flows[i];
      }
      remaining -= flows[i];
    }
    return null;
  }

  function discountedPayback(rate, capex, flows) {
    var r = rate / 100;
    var remaining = capex;
    for (var i = 0; i < flows.length; i++) {
      var disc = flows[i] / Math.pow(1 + r, i + 1);
      if (disc <= 0) {
        remaining -= disc;
        continue;
      }
      if (remaining <= disc) {
        return i + remaining / disc;
      }
      remaining -= disc;
    }
    return null;
  }

  function profitabilityIndex(rate, capex, flows) {
    var r = rate / 100;
    var pv = 0;
    for (var i = 0; i < flows.length; i++) {
      pv += flows[i] / Math.pow(1 + r, i + 1);
    }
    if (capex === 0) return null;
    return pv / capex;
  }

  // ===== Форматирование =====

  function formatGroupedDisplay(num) {
    var raw = String(Math.round(num || 0));
    var negative = raw.charAt(0) === "-";
    var digits = negative ? raw.slice(1) : raw;
    var grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return (negative ? "-" : "") + grouped;
  }

  function parseGroupedNumber(str) {
    var cleaned = String(str).replace(/[^\d-]/g, "");
    var num = parseInt(cleaned, 10);
    return isNaN(num) ? 0 : num;
  }

  // Переформатирует поле ввода "на лету" (пробелы через каждые 3 цифры), сохраняя позицию курсора
  function formatThousandsInput(input) {
    var raw = input.value;
    var cursorFromEnd = raw.length - input.selectionStart;
    var negative = raw.trim().charAt(0) === "-";
    var digits = raw.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
    var grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    var formatted = (negative && digits.length ? "-" : "") + grouped;
    input.value = formatted;
    var newPos = Math.max(0, formatted.length - cursorFromEnd);
    input.setSelectionRange(newPos, newPos);
    return digits.length ? parseInt(digits, 10) * (negative ? -1 : 1) : 0;
  }

  function currencySymbol() {
    return state.currency === "USD" ? t(state.lang, "currencyUSD") : t(state.lang, "currencyKGS");
  }

  function formatMoney(value) {
    var rounded = Math.round(value);
    return rounded.toLocaleString("ru-RU") + " " + currencySymbol();
  }

  function formatPercent(value) {
    return value.toFixed(1) + "%";
  }

  function formatYears(value) {
    if (value === null) return t(state.lang, "notReached");
    return value.toFixed(1) + " " + t(state.lang, "yearsUnit");
  }

  // ===== Основной пересчёт =====

  function compute() {
    var capex = parseGroupedNumber(document.getElementById("capex").value);
    var rate = parseFloat(document.getElementById("rate").value) || 0;
    var residual = parseGroupedNumber(document.getElementById("residual").value);
    var flows = state.cashflows.slice(0, state.horizon);

    // Остаточная стоимость актива добавляется к доходу последнего года —
    // но только для NPV/IRR/PI, срок окупаемости считаем по чистым операционным потокам
    var flowsWithResidual = flows.slice();
    if (residual && flowsWithResidual.length) {
      flowsWithResidual[flowsWithResidual.length - 1] += residual;
    }

    var npvValue = npv(rate, capex, flowsWithResidual);
    var irrValue = irr(capex, flowsWithResidual);
    var paybackValue = simplePayback(capex, flows);
    var discPaybackValue = discountedPayback(rate, capex, flows);
    var piValue = profitabilityIndex(rate, capex, flowsWithResidual);

    setMetric("npv", formatMoney(npvValue), npvValue >= 0);
    setMetric("irr", irrValue === null ? "—" : formatPercent(irrValue), irrValue !== null && irrValue >= rate);
    setMetric("payback", formatYears(paybackValue), paybackValue !== null);
    setMetric("discPayback", formatYears(discPaybackValue), discPaybackValue !== null);
    setMetric("pi", piValue === null ? "—" : piValue.toFixed(2), piValue !== null && piValue >= 1);

    renderVerdict(npvValue, irrValue, rate, paybackValue);
    renderChart(capex, flows, rate, residual);
  }

  function setMetric(key, text, isGood) {
    var valueEl = document.getElementById("value-" + key);
    var cardEl = document.getElementById("metric-" + key);
    valueEl.textContent = text;
    cardEl.classList.remove("good", "bad");
    if (key === "npv" || key === "irr" || key === "pi") {
      cardEl.classList.add(isGood ? "good" : "bad");
    }
  }

  function renderVerdict(npvValue, irrValue, rate, paybackValue) {
    var el = document.getElementById("verdict-text");
    var cardEl = document.getElementById("verdict-card");
    cardEl.classList.remove("good", "bad");

    if (npvValue >= 0) {
      cardEl.classList.add("good");
      el.textContent = t(state.lang, "verdictGood", {
        npv: formatMoney(npvValue),
        irr: irrValue === null ? "—" : formatPercent(irrValue),
        rate: formatPercent(rate),
        payback: formatYears(paybackValue),
      });
    } else {
      cardEl.classList.add("bad");
      var irrPart = "";
      if (irrValue === null) {
        irrPart = t(state.lang, "verdictNoIrr");
      } else if (irrValue < rate) {
        irrPart = t(state.lang, "verdictIrrBelowRate", {
          irr: formatPercent(irrValue),
          rate: formatPercent(rate),
        });
      }
      el.textContent = t(state.lang, "verdictBad", {
        npv: formatMoney(npvValue),
        irrPart: irrPart,
      });
    }
  }

  function renderChart(capex, flows, rate, residual) {
    var labels = ["0"];
    var cumulative = [-capex];
    var running = -capex;
    for (var i = 0; i < flows.length; i++) {
      running += flows[i];
      cumulative.push(running);
      labels.push(String(i + 1));
    }
    if (residual && cumulative.length > 1) {
      cumulative[cumulative.length - 1] += residual;
    }

    var ctx = document.getElementById("cashflow-chart").getContext("2d");
    var cssVars = getComputedStyle(document.documentElement);
    var accent = cssVars.getPropertyValue("--accent").trim();
    var textColor = cssVars.getPropertyValue("--text-muted").trim();
    var gridColor = cssVars.getPropertyValue("--border").trim();

    var data = {
      labels: labels,
      datasets: [
        {
          label: t(state.lang, "chartLabel"),
          data: cumulative,
          borderColor: accent,
          backgroundColor: accent + "33",
          fill: true,
          tension: 0.25,
          pointRadius: 3,
        },
      ],
    };

    var options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: textColor }, grid: { color: gridColor } },
        y: { ticks: { color: textColor }, grid: { color: gridColor } },
      },
    };

    if (chart) {
      chart.data = data;
      chart.options = options;
      chart.update();
    } else {
      chart = new Chart(ctx, { type: "line", data: data, options: options });
    }
  }

  // ===== Инициализация =====

  function bindControls() {
    document.getElementById("capex").addEventListener("input", function (e) {
      formatThousandsInput(e.target);
      compute();
    });
    document.getElementById("residual").addEventListener("input", function (e) {
      formatThousandsInput(e.target);
      compute();
    });
    document.getElementById("rate").addEventListener("input", compute);
    document.getElementById("currency").addEventListener("change", function (e) {
      state.currency = e.target.value;
      savePrefs();
      compute();
    });
    document.getElementById("horizon").addEventListener("change", function (e) {
      state.horizon = parseInt(e.target.value, 10);
      renderCashflowInputs();
      compute();
    });

    document.getElementById("lang-switch").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-lang]");
      if (!btn) return;
      state.lang = btn.dataset.lang;
      savePrefs();
      applyLang();
    });

    document.getElementById("theme-switch").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-theme-choice]");
      if (!btn) return;
      state.theme = btn.dataset.themeChoice;
      savePrefs();
      applyTheme();
      compute(); // перерисовать график с новыми цветами темы
    });
  }

  function init() {
    loadPrefs();
    applyTheme();
    buildHorizonOptions();
    renderResultsShell();
    renderCashflowInputs();
    bindControls();
    applyLang();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
