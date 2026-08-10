(function (root, factory) {
  var lifecycleCore = (typeof module === 'object' && module.exports)
    ? require('./lifecycle.js')
    : root.KB.Core.Lifecycle;
  var metricsCore = (typeof module === 'object' && module.exports)
    ? require('./metrics.js')
    : root.KB.Core.Metrics;
  var dateCore = (typeof module === 'object' && module.exports)
    ? require('./date.js')
    : root.KB.Core.Date;
  var api = factory(lifecycleCore, metricsCore, dateCore);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Calibrate = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function (Lifecycle, Metrics, DateCore) {
    // TUNING: automatic estimate-vs-actual calibration. The app already
    // records every card's size estimate (XS–XL) and its actual duration
    // (startedAt -> completedAt cycle time, plus focus effort). This module
    // derives a personal track record — "your M ≈ 2.3d (n=11)" — and the
    // reality checks injected wherever plans are made.
    //
    // Pure projection of existing lifecycle fields: no new storage, no new
    // insertion paths, no undo entries (derived data, like js/core/streak.js).

    var SIZES = ['XS', 'S', 'M', 'L', 'XL'];
    // Documented fallback when a size has no samples yet. These are the
    // classic relative anchors (XS = quarter day … XL = 3 days).
    var FALLBACK_DAYS = { XS: 0.25, S: 0.5, M: 1, L: 2, XL: 3 };
    // How many sized+completed cards make the calibration "ready" (mirrors
    // MIN_SLE_SAMPLES in metrics.js).
    var MIN_SAMPLES = 5;
    var MS_PER_DAY = 86400000;
    var CAPACITY_WINDOW_DAYS = 14;
    var MIN_CAPACITY_DAYS = 3;
    var PLAN_WARN_FACTOR = 1.25;

    function isoDayOf(ms) {
      return DateCore.isoDate(new Date(ms));
    }

    // Cards must be the same source metrics uses: every board's live and
    // archived cards. Only sized, lifecycle-completed cards count.
    function collectSamples(cards) {
      var bySize = {};
      SIZES.forEach(function (size) { bySize[size] = []; });
      var nTotal = 0;
      (cards || []).forEach(function (card) {
        if (!card) return;
        if (typeof card.completedAt !== 'number') return;
        if (typeof card.startedAt !== 'number') return;
        var size = String(card.size || 'none').toUpperCase();
        if (SIZES.indexOf(size) === -1) return;
        var days = Lifecycle.cycleTimeDays(card);
        if (days === null || !isFinite(days) || days < 0) return;
        bySize[size].push(days);
        nTotal += 1;
      });
      return { bySize: bySize, nTotal: nTotal };
    }

    function medianDays(values) {
      if (!values || values.length === 0) return null;
      return Metrics.median(values);
    }

    function p85Days(values) {
      if (!values || values.length === 0) return null;
      return Metrics.percentile(values, 0.85);
    }

    // Calibrate across the whole personal workflow (all boards).
    // returns { bySize: { S: { n, medianDays, p85Days }, … },
    //           global: { n, medianDays }, ready, asOfISO }
    function calibrate(cards, now) {
      var samples = collectSamples(cards);
      var bySize = {};
      SIZES.forEach(function (size) {
        var values = samples.bySize[size];
        var median = medianDays(values);
        bySize[size] = {
          n: values.length,
          medianDays: median,
          p85Days: p85Days(values),
          drift: median === null ? null : median / 1 // days per "one day" plan
        };
      });
      var all = [];
      SIZES.forEach(function (size) { all = all.concat(samples.bySize[size]); });
      return {
        bySize: bySize,
        global: { n: samples.nTotal, medianDays: medianDays(all) },
        ready: samples.nTotal >= MIN_SAMPLES,
        asOfISO: isoDayOf(typeof now === 'number' ? now : Date.now())
      };
    }

    // Median actual for a size; fallback anchor when no samples exist.
    function estimateDays(size, cal) {
      var key = String(size || 'none').toUpperCase();
      if (SIZES.indexOf(key) === -1) return null;
      var entry = cal && cal.bySize ? cal.bySize[key] : null;
      if (entry && entry.n > 0 && typeof entry.medianDays === 'number') {
        return entry.medianDays;
      }
      return FALLBACK_DAYS[key];
    }

    // "M≈2.3d (n=11)" when calibrated, "M≈2.3d" when on the fallback anchor.
    function estimateLabel(size, cal) {
      var key = String(size || 'none').toUpperCase();
      var days = estimateDays(key, cal);
      if (days === null) return '';
      var entry = cal && cal.bySize ? cal.bySize[key] : null;
      var rounded = String(Math.round(days * 10) / 10);
      if (entry && entry.n > 0) {
        return key + '\u2248' + rounded + 'd (n=' + entry.n + ')';
      }
      return key + '\u2248' + rounded + 'd';
    }

    // Sum of estimateDays over picked cards. details per card.
    function dayLoad(pickCardIds, cardsById, cal) {
      var estimateDaysTotal = 0;
      var details = [];
      (pickCardIds || []).forEach(function (cardId) {
        var card = cardsById[cardId];
        if (!card) return;
        var days = estimateDays(card.size, cal);
        if (days === null) days = 0;
        estimateDaysTotal += days;
        details.push({ cardId: cardId, size: String(card.size || 'none').toUpperCase(), days: days });
      });
      return { estimateDays: estimateDaysTotal, details: details };
    }

    // How much one of the user's days actually holds: median over the last
    // 14 days of the summed cycle times of cards completed that day.
    // Fallback 1.0 when fewer than 3 days have data.
    function dailyCapacityDays(cards, now) {
      var perDay = {};
      (cards || []).forEach(function (card) {
        if (!card) return;
        if (typeof card.completedAt !== 'number') return;
        if (typeof card.startedAt !== 'number') return;
        var key = isoDayOf(card.completedAt);
        var days = Lifecycle.cycleTimeDays(card);
        if (days === null || !isFinite(days) || days < 0) return;
        perDay[key] = (perDay[key] || 0) + days;
      });
      var today = isoDayOf(typeof now === 'number' ? now : Date.now());
      var sums = [];
      Object.keys(perDay).forEach(function (key) {
        var age = daysBetweenISO(key, today);
        if (age === null || age < 0 || age >= CAPACITY_WINDOW_DAYS) return;
        sums.push(perDay[key]);
      });
      if (sums.length < MIN_CAPACITY_DAYS) return 1.0;
      var median = Metrics.median(sums);
      return median === null ? 1.0 : median;
    }

    function daysBetweenISO(fromISO, toISO) {
      var a = new Date(fromISO + 'T00:00:00');
      var b = new Date(toISO + 'T00:00:00');
      if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
      return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
    }

    // Reality check for a planned day: estimated load vs the user's real
    // capacity. warn when the load exceeds capacity * 1.25.
    function planCheck(dayISO, pickCardIds, cardsById, cal, cards, now) {
      var load = dayLoad(pickCardIds, cardsById, cal);
      var capacity = dailyCapacityDays(cards, typeof now === 'number' ? now : Date.now());
      var warn = load.estimateDays > capacity * PLAN_WARN_FACTOR;
      return {
        estimateDays: load.estimateDays,
        capacityDays: capacity,
        warn: warn
      };
    }

    return {
      SIZES: SIZES,
      FALLBACK_DAYS: FALLBACK_DAYS,
      MIN_SAMPLES: MIN_SAMPLES,
      PLAN_WARN_FACTOR: PLAN_WARN_FACTOR,
      collectSamples: collectSamples,
      calibrate: calibrate,
      estimateDays: estimateDays,
      estimateLabel: estimateLabel,
      dayLoad: dayLoad,
      dailyCapacityDays: dailyCapacityDays,
      planCheck: planCheck
    };
  }
);
