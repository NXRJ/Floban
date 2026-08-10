(function (root, factory) {
  var dateCore = (typeof module === 'object' && module.exports)
    ? require('./date.js')
    : root.KB.Core.Date;
  var api = factory(dateCore);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Weekly = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function (DateCore) {
    // CHECKPOINT: a guided weekly review ritual. Pure, deterministic core —
    // the review model is a projection of existing card data (completedAt,
    // due, flow state, aging), injected `now`. The browser layer walks the
    // 5 steps and applies one-key actions through the existing ops (one
    // undo entry per step batch, mirroring applyDayRoll).
    //
    // Card projection shape (built by the browser layer):
    //   { boardId, boardName, columnId, cardId, title, due, priority, size,
    //     labels: [], completedAt, startedAt, columnRole, flowState,
    //     flowSince, archived }

    var MS_PER_DAY = 86400000;
    var PRIORITY_WEIGHT = { urgent: 4, high: 3, medium: 2, low: 1, none: 0 };
    var FLOW_BLOCKED = ['blocked', 'waiting', 'paused'];

    function iso(date) { return DateCore.isoDate(date); }

    function shiftDays(ms, offset) {
      var d = new Date(ms);
      d.setDate(d.getDate() + offset);
      return d;
    }

    // Monday-anchored week containing `now`, shifted by offsetWeeks
    // (negative = previous weeks). { fromISO, toISO, label }.
    function weekRange(now, offsetWeeks) {
      var base = new Date(now);
      var day = base.getDay(); // 0 = Sunday
      var back = (day + 6) % 7; // days back to Monday
      var monday = shiftDays(base.getTime(), -back);
      var start = shiftDays(monday.getTime(), (offsetWeeks || 0) * 7);
      var end = shiftDays(start.getTime(), 6);
      var label = iso(start) + ' \u2013 ' + iso(end);
      return { fromISO: iso(start), toISO: iso(end), label: label };
    }

    function inISO(value, fromISO, toISO) {
      return value >= fromISO && value <= toISO;
    }

    function agingDays(card, now) {
      if (!card || typeof card.movedAt !== 'number') return 0;
      return Math.max(0, Math.floor((now - card.movedAt) / MS_PER_DAY));
    }

    // Build the review model from the card projection.
    // opts: { staleDays } — aging threshold for STUCK (default 7).
    function prepare(cards, now, opts) {
      var options = opts || {};
      var staleDays = typeof options.staleDays === 'number' ? options.staleDays : 7;
      var thisWeek = weekRange(now, 0);
      var lastWeek = weekRange(now, -1);

      var lastWeekCompleted = [];
      var stuck = [];
      var overdue = [];
      var upcoming = [];
      var focusRank = [];

      (cards || []).forEach(function (card) {
        if (!card || card.archived) return;
        var done = typeof card.completedAt === 'number' && card.completedAt > 0;
        if (done) {
          var day = iso(new Date(card.completedAt));
          if (inISO(day, lastWeek.fromISO, lastWeek.toISO)) {
            lastWeekCompleted.push(card);
          }
          return;
        }
        // Live cards below.
        if (card.columnRole === 'done') return;
        var flowBlocked = FLOW_BLOCKED.indexOf(card.flowState) !== -1;
        var stale = agingDays(card, now) >= staleDays;
        if (flowBlocked || stale) {
          var reason = flowBlocked ? String(card.flowState || 'blocked').toUpperCase()
            : 'AGING ' + agingDays(card, now) + 'D';
          if (card.ping && card.ping.followUpAt <= now) {
            var pingDays = Math.ceil((now - card.ping.followUpAt) / MS_PER_DAY);
            reason = 'PING ' + pingDays + 'D' + (card.ping.contact ? ' \u00B7 ' + card.ping.contact : '');
          }
          stuck.push({ card: card, reason: reason });
        }
        if (card.due && card.due < thisWeek.fromISO) {
          overdue.push(card);
        } else if (card.due && inISO(card.due, thisWeek.fromISO, thisWeek.toISO)) {
          upcoming.push(card);
        } else if (card.when && inISO(card.when, thisWeek.fromISO, thisWeek.toISO)) {
          // Do-date lands this week — it's time to start, even if the
          // deadline is further out.
          upcoming.push(card);
        }
        focusRank.push(card);
      });

      overdue.sort(function (a, b) { return a.due < b.due ? -1 : a.due > b.due ? 1 : (a.cardId < b.cardId ? -1 : 1); });
      upcoming.sort(function (a, b) {
        if (a.due !== b.due) return a.due < b.due ? -1 : 1;
        var pa = PRIORITY_WEIGHT[a.priority] || 0;
        var pb = PRIORITY_WEIGHT[b.priority] || 0;
        if (pb !== pa) return pb - pa;
        return a.cardId < b.cardId ? -1 : 1;
      });
      focusRank.sort(function (a, b) {
        var pa = PRIORITY_WEIGHT[a.priority] || 0;
        var pb = PRIORITY_WEIGHT[b.priority] || 0;
        if (pb !== pa) return pb - pa;
        if ((a.due || '') !== (b.due || '')) return (a.due || '') < (b.due || '') ? -1 : 1;
        return a.cardId < b.cardId ? -1 : 1;
      });

      return {
        week: thisWeek,
        lastWeek: { range: lastWeek, completed: lastWeekCompleted },
        stuck: stuck,
        overdue: overdue,
        upcoming: upcoming,
        focusRank: focusRank
      };
    }

    // The 5 fixed steps with their counts.
    function steps(review) {
      return [
        { id: 'wins', title: 'WINS', count: review.lastWeek.completed.length },
        { id: 'stuck', title: 'STUCK', count: review.stuck.length },
        { id: 'overdue', title: 'OVERDUE', count: review.overdue.length },
        { id: 'lookahead', title: 'LOOKAHEAD', count: review.upcoming.length },
        { id: 'focus', title: 'FOCUS', count: review.focusRank.length }
      ];
    }

    // Compose a paste-ready review summary (C copies it).
    function composeSummary(review) {
      var lines = [];
      lines.push('CHECKPOINT \u2014 WEEK OF ' + review.week.label);
      lines.push('WINS \u00B7 ' + review.lastWeek.completed.length + ' DONE');
      review.lastWeek.completed.slice(0, 12).forEach(function (card) {
        lines.push('  \u2713 ' + card.title);
      });
      lines.push('STUCK \u00B7 ' + review.stuck.length);
      review.stuck.slice(0, 6).forEach(function (entry) {
        lines.push('  \u25CF ' + entry.card.title + ' \u2014 ' + entry.reason);
      });
      lines.push('OVERDUE \u00B7 ' + review.overdue.length);
      review.overdue.slice(0, 6).forEach(function (card) {
        lines.push('  \u26A0 ' + card.title + ' (due ' + card.due + ')');
      });
      return lines.join('\n');
    }

    return {
      weekRange: weekRange,
      prepare: prepare,
      steps: steps,
      composeSummary: composeSummary,
      agingDays: agingDays
    };
  }
);
