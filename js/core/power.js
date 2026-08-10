(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Power = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function () {
    // POWER METER: state-aware "what should I do right now?" task picking.
    // The user declares a power band (FULL / MID / LOW / DRAINED) or a
    // 5-minute window; the board's actionable cards re-rank by state-fit
    // with plain-language reasons. The energy curve is LEARNED from the
    // user's own data (timestamped focus sessions + effort-sized completed
    // cards), never a chronotype quiz. Pure, deterministic, injected clock;
    // derived data never pushes undo history (HI-SCORE pattern).

    var SAMPLE_THRESHOLD = 5; // hours with data before the learned curve wins
    var BANDS = ['full', 'mid', 'low', 'drained'];
    // Demand weight per size: how much energy a card of that size draws.
    var SIZE_DEMAND = { xs: 0.2, s: 0.35, m: 0.55, l: 0.75, xl: 1.0 };
    var DEFAULT_DEMAND = 0.5;
    // Band tolerance: max demand a band can carry. full=1.0 accepts anything.
    var BAND_TOLERANCE = { full: 1.0, mid: 0.75, low: 0.4, drained: 0.25 };
    var PRIORITY_WEIGHT = { urgent: 4, high: 3, medium: 2, low: 1, none: 0 };

    function energyFor(card, cal) {
      if (!card) return DEFAULT_DEMAND;
      var size = String(card.size || 'none').toLowerCase();
      if (SIZE_DEMAND[size] !== undefined) return SIZE_DEMAND[size];
      // Fall back to the TUNING estimate when available (a sized card with
      // no sample still has a documented anchor).
      if (cal && typeof cal.estimateDays === 'function') {
        var days = cal.estimateDays(size, cal.calibration);
        if (typeof days === 'number' && days > 0) {
          return Math.min(1, days / 3); // 3-day XL anchor maps to 1.0
        }
      }
      return DEFAULT_DEMAND;
    }

    // ---- Learned power curve -------------------------------------------------

    // buckets: samples keyed by hour-of-day 0..23, each an array of demands.
    function powerCurve(cards, focusDays, now, opts) {
      var options = opts || {};
      var buckets = [];
      for (var h = 0; h < 24; h++) buckets.push([]);

      // Completed cards: weight by their size demand.
      (cards || []).forEach(function (card) {
        if (!card || typeof card.completedAt !== 'number') return;
        var hour = new Date(card.completedAt).getHours();
        var demand = options.demandFor ? options.demandFor(card) : (SIZE_DEMAND[String(card.size || '').toLowerCase()] || DEFAULT_DEMAND);
        buckets[hour].push(demand);
      });

      // Focus sessions: per-day totals weighted by session count.
      if (focusDays && typeof focusDays === 'object') {
        Object.keys(focusDays).forEach(function (dayKey) {
          var day = focusDays[dayKey];
          if (!day || typeof day !== 'object') return;
          var minutes = typeof day.minutes === 'number' ? day.minutes : 0;
          if (minutes <= 0) return;
          // The day's minutes were spread across the day; attribute them to
          // the day's hours proportionally is overkill — bucket the first
          // hour of the day with a nominal session demand so focus days
          // still shape the curve without fabricating precision.
          var d = new Date(dayKey + 'T09:00:00');
          if (isNaN(d.getTime())) return;
          buckets[d.getHours()].push(Math.min(1, minutes / 120));
        });
      }

      // Smoothed level per hour: 3-hour moving average of median demand.
      var hours = [];
      var peakHour = -1;
      var troughHour = -1;
      var hasData = false;
      for (var h = 0; h < 24; h++) {
        var sample = median(buckets[h]);
        if (sample !== null) hasData = true;
        hours.push(sample); // raw median (null when no samples)
      }
      var levels = [];
      for (var h2 = 0; h2 < 24; h2++) {
        var sum = 0;
        var count = 0;
        for (var off = -1; off <= 1; off++) {
          var idx = (h2 + off + 24) % 24;
          var v = hours[idx];
          if (v !== null) { sum += v; count++; }
        }
        levels.push(count > 0 ? sum / count : null);
      }
      if (hasData) {
        var best = -1;
        var worst = 2;
        levels.forEach(function (v, h3) {
          if (v === null) return;
          if (v > best) { best = v; peakHour = h3; }
          if (v < worst) { worst = v; troughHour = h3; }
        });
      }
      return {
        learned: hasData && sampleCount(cards) >= SAMPLE_THRESHOLD,
        hours: levels,
        peakHour: peakHour,
        troughHour: troughHour,
        levelAtHour: function (h) {
          var idx = ((h % 24) + 24) % 24;
          var v = levels[idx];
          if (v !== null) return v;
          // Default gentle curve before learning: rise through the morning,
          // peak mid-day, taper at night.
          if (idx >= 8 && idx <= 12) return 0.6 + (idx - 8) * 0.05;
          if (idx >= 13 && idx <= 16) return 0.8;
          if (idx >= 17 && idx <= 20) return 0.6 - (idx - 17) * 0.05;
          return 0.3;
        }
      };
    }

    function sampleCount(cards) {
      var n = 0;
      (cards || []).forEach(function (card) {
        if (card && typeof card.completedAt === 'number') n++;
      });
      return n;
    }

    function median(values) {
      var sorted = values.slice().sort(function (a, b) { return a - b; });
      var n = sorted.length;
      if (n === 0) return null;
      var mid = Math.floor(n / 2);
      return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }

    // ---- Classification ------------------------------------------------------

    // 'good-now' | 'too-heavy' | 'wait' (wait = blocked/waiting/paused/
    // done/archived/dependency-blocked — never picked).
    function classify(card, ctx) {
      if (!card) return 'wait';
      if (card.completedAt || card.archivedAt) return 'wait';
      var flow = card.flow && card.flow.state ? card.flow.state : 'normal';
      if (flow === 'blocked' || flow === 'waiting' || flow === 'paused') return 'wait';
      if (card.dependencies && Array.isArray(card.dependencies.blockers) && card.dependencies.blockers.length > 0) {
        return 'wait';
      }
      var demand = ctx && typeof ctx.demandFor === 'function' ? ctx.demandFor(card) : (SIZE_DEMAND[String(card.size || '').toLowerCase()] || DEFAULT_DEMAND);
      var tolerance = ctx && ctx.tolerance !== undefined ? ctx.tolerance : BAND_TOLERANCE.mid;
      return demand <= tolerance ? 'good-now' : 'too-heavy';
    }

    // ---- Ranker ---------------------------------------------------------------

    // pickBest(cards, ctx) -> { top, alternates, reasons }
    // ctx: { band, tolerance, timeBudgetMin, now, cal, levelAtHour }
    function pickBest(cards, ctx) {
      var options = ctx || {};
      var now = typeof options.now === 'number' ? options.now : Date.now();
      var tolerance = options.tolerance !== undefined ? options.tolerance : BAND_TOLERANCE.mid;
      var levelAtHour = typeof options.levelAtHour === 'function' ? options.levelAtHour : function () { return 0.6; };
      var demandFor = typeof options.demandFor === 'function' ? options.demandFor : function (c) {
        return SIZE_DEMAND[String(c.size || '').toLowerCase()] || DEFAULT_DEMAND;
      };
      var todayISO = isoDay(now);
      var minuteBudget = options.timeBudgetMin;

      var actionable = [];
      (cards || []).forEach(function (card) {
        if (classify(card, { demandFor: demandFor, tolerance: tolerance }) !== 'good-now') return;
        if (minuteBudget) {
          // Demand-based estimate: one demand unit ≈ 90 minutes (XS ≈ 20min,
          // M ≈ 50min, XL ≈ 90min). Day-granular TUNING estimates are too
          // coarse for a short window, so the budget maps off the same demand
          // weight the bands use — deterministic and window-honest.
          var demand = demandFor(card);
          var minutes = Math.round(demand * 90);
          if (minutes > minuteBudget) return;
        }
        actionable.push(card);
      });

      var scored = actionable.map(function (card) {
        var urgency = 0;
        if (card.due && /^\d{4}-\d{2}-\d{2}$/.test(card.due)) {
          if (card.due < todayISO) urgency += 10;
          else if (card.due === todayISO) urgency += 7;
        }
        var priority = PRIORITY_WEIGHT[card.priority] || 0;
        var demand = demandFor(card);
        var stateFit = levelAtHour(new Date(now).getHours());
        var score = urgency + priority * 2 + demand * 3 + stateFit;
        return { card: card, score: score, demand: demand };
      });
      scored.sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return a.card.id < b.card.id ? -1 : 1;
      });

      var reasons = {
        deepWork: 'deep-work hour \u2014 tackle the heavy card',
        quickWin: 'low power \u2014 quick win',
        deadline: 'due today \u2014 get it out of the way',
        window: '5-min window \u2014 fits the time budget'
      };
      return {
        top: scored.length > 0 ? scored[0].card : null,
        alternates: scored.slice(1, 4).map(function (s) { return s.card; }),
        scored: scored,
        reasons: reasons
      };
    }

    // ---- LOW POWER MODE ------------------------------------------------------

    // Derived boolean: the user's declared band is at or below 'low'.
    function lowPowerActive(state) {
      var power = state && state.power;
      if (!power || typeof power.band !== 'string') return false;
      return power.band === 'low' || power.band === 'drained';
    }

    function isoDay(ms) {
      var d = new Date(ms);
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return d.getFullYear() + '-' + m + '-' + day;
    }

    return {
      BANDS: BANDS,
      BAND_TOLERANCE: BAND_TOLERANCE,
      SIZE_DEMAND: SIZE_DEMAND,
      SAMPLE_THRESHOLD: SAMPLE_THRESHOLD,
      energyFor: energyFor,
      powerCurve: powerCurve,
      classify: classify,
      pickBest: pickBest,
      lowPowerActive: lowPowerActive
    };
  }
);
