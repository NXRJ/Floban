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
    root.KB.Core.Worklog = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function (DateCore) {
    // Work Log: a composed, copy-ready ledger of completed work. Pure
    // projection over existing card data (completedAt, startedAt, labels,
    // boards) — no new storage, no insertion paths, nothing leaves the
    // machine except text the user explicitly copies.
    //
    // Input cards (built by the browser layer):
    //   { boardId, boardName, columnId, cardId, title,
    //     labels: [names], priority, size,
    //     completedAt (ms|null), startedAt (ms|null),
    //     columnRole, archived (bool) }

    var DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    var MS_PER_DAY = 86400000;

    function iso(date) { return DateCore.isoDate(date); }

    // Monday-anchored week containing `now`, shifted by offsetWeeks.
    function weekRange(now, offsetWeeks) {
      var offset = typeof offsetWeeks === 'number' ? offsetWeeks : 0;
      var d = new Date(now);
      var dow = (d.getDay() + 6) % 7; // Monday = 0
      var monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow + offset * 7);
      var sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
      return {
        fromISO: iso(monday),
        toISO: iso(sunday),
        label: 'WEEK OF ' + formatRange(monday, sunday)
      };
    }

    function monthRange(now) {
      var d = new Date(now);
      var first = new Date(d.getFullYear(), d.getMonth(), 1);
      var last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return { fromISO: iso(first), toISO: iso(last), label: 'MONTH OF ' + formatRange(first, last) };
    }

    var MONTHS_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    function formatRange(a, b) {
      return MONTHS_SHORT[a.getMonth()] + ' ' + a.getDate() + '\u2013' +
        MONTHS_SHORT[b.getMonth()] + ' ' + b.getDate() + ', ' + b.getFullYear();
    }

    function dayOfMs(ms) { return iso(new Date(ms)); }

    function inRange(isoDay, fromISO, toISO) {
      return isoDay >= fromISO && isoDay <= toISO;
    }

    function cycleDays(card) {
      if (typeof card.startedAt !== 'number' || typeof card.completedAt !== 'number') return null;
      return Math.max(0, Math.round((card.completedAt - card.startedAt) / MS_PER_DAY));
    }

    // worklog: { fromISO, toISO, label, days: [{ dateISO, items }],
    //           stats: { total, perBoard, perLabel }, unstamped: [cards] }
    // opts: { now, fromISO, toISO, label }
    function buildWorkLog(cards, opts) {
      var range = opts || {};
      var fromISO = range.fromISO;
      var toISO = range.toISO;
      var label = range.label || '';
      var all = Array.isArray(cards) ? cards : [];

      var completed = all.filter(function (c) {
        return c && typeof c.completedAt === 'number' && inRange(dayOfMs(c.completedAt), fromISO, toISO);
      }).sort(function (a, b) {
        if (a.completedAt !== b.completedAt) return b.completedAt - a.completedAt;
        return a.cardId < b.cardId ? -1 : 1;
      });

      var byDay = {};
      var order = [];
      completed.forEach(function (card) {
        var key = dayOfMs(card.completedAt);
        if (!byDay[key]) {
          byDay[key] = [];
          order.push(key);
        }
        byDay[key].push(card);
      });
      order.sort(function (a, b) { return a < b ? 1 : -1; }); // newest day first
      var days = order.map(function (key) {
        return { dateISO: key, items: byDay[key] };
      });

      var perBoard = {};
      var perLabel = {};
      completed.forEach(function (card) {
        var boardKey = card.boardName || '(no board)';
        perBoard[boardKey] = (perBoard[boardKey] || 0) + 1;
        (card.labels || []).forEach(function (name) {
          perLabel[name] = (perLabel[name] || 0) + 1;
        });
      });

      var unstamped = all.filter(function (c) {
        return c && c.columnRole === 'done' && !c.archived && c.completedAt === null;
      }).sort(function (a, b) { return a.cardId < b.cardId ? -1 : 1; });

      return {
        fromISO: fromISO,
        toISO: toISO,
        label: label,
        days: days,
        stats: {
          total: completed.length,
          perBoard: Object.keys(perBoard).map(function (name) { return { boardName: name, count: perBoard[name] }; }),
          perLabel: Object.keys(perLabel).map(function (name) { return { label: name, count: perLabel[name] }; })
        },
        unstamped: unstamped
      };
    }

    // Compose a paste-ready text narrative. Deterministic template + join.
    // Cycle notes appear only for cards that took >= minCycleDays (default 3)
    // so the output reads like a human status update, not a data dump.
    function composeLog(worklog, opts) {
      var options = opts || {};
      var minCycleDays = typeof options.minCycleDays === 'number' ? options.minCycleDays : 3;
      var lines = [];
      lines.push((worklog.label || 'WORK LOG') + ' \u2014 ' + worklog.stats.total + ' DONE');

      if (options.groupBy === 'board') {
        worklog.stats.perBoard.forEach(function (b) {
          lines.push(b.boardName + ' \u00B7 ' + b.count);
        });
        return lines.join('\n');
      }

      worklog.days.forEach(function (day) {
        var dayName = DAY_NAMES[new Date(day.dateISO + 'T12:00:00').getDay()];
        var parts = day.items.map(function (card) {
          var text = card.title;
          var cycle = cycleDays(card);
          if (cycle !== null && cycle >= minCycleDays) text += ' (' + cycle + 'd)';
          return text;
        });
        lines.push(dayName + ' \u00B7 ' + day.items.length + ': ' + parts.join(' \u00B7 '));
      });
      if (lines.length === 1) lines.push('Nothing completed this week.');
      return lines.join('\n');
    }

    return {
      weekRange: weekRange,
      monthRange: monthRange,
      buildWorkLog: buildWorkLog,
      composeLog: composeLog,
      cycleDays: cycleDays
    };
  }
);
