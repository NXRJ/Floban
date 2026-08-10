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
    root.KB.Core.Calendar = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function (DateCore) {
    // Calendar projection: a pure function of (monthKey, cards, now).
    //
    // Renders every card that carries a due date onto a 6x7 month grid, plus
    // an "overdue" strip for cards whose due date is in the past. The browser
    // layer stays dumb: layout, weekday offsets, leap years, month rollover
    // and today/overdue classification all live here and are unit-tested.
    //
    // Input cards are pre-built refs: { id, boardId, columnId, title, color,
    // priority, due, completedAt }. Nothing is mutated; no IDs are generated.

    var MONTH_NAMES = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
      'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
    var ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

    function pad(n) { return String(n).padStart(2, '0'); }

    function isoFromDate(date) { return DateCore.isoDate(date); }

    function parseMonthKey(monthKey, now) {
      var parts = String(monthKey || '').split('-');
      var year = Number(parts[0]);
      var month = Number(parts[1]) - 1;
      if (!isFinite(year) || month < 0 || month > 11) {
        var d = new Date(now);
        year = d.getFullYear();
        month = d.getMonth();
      }
      return { year: year, month: month };
    }

    function monthKeyOf(year, month) {
      return year + '-' + pad(month + 1);
    }

    function shiftMonth(monthKey, delta, now) {
      var p = parseMonthKey(monthKey, now);
      var d = new Date(p.year, p.month + delta, 1);
      return monthKeyOf(d.getFullYear(), d.getMonth());
    }

    function isPast(dueISO, todayISO) {
      return Boolean(dueISO) && ISO_RE.test(dueISO) && dueISO < todayISO;
    }

    function cardRef(card) {
      return {
        id: card.id,
        boardId: card.boardId,
        columnId: card.columnId,
        title: card.title || '',
        color: card.color || null,
        priority: card.priority || 'none'
      };
    }

    // The day a card sits on in the grid: its do-date (when) when set, else
    // its due date. The deadline stays the overdue driver below.
    function planDay(card) {
      var when = card && card.when;
      if (typeof when === 'string' && ISO_RE.test(when)) return when;
      var due = card && card.due;
      if (typeof due === 'string' && ISO_RE.test(due)) return due;
      return null;
    }

    // grid: { year, month, label, todayISO, overdue: [refs], weeks: [[day]] }
    // day: { dateISO, inMonth, isToday, cards: [refs] }
    function calendarGrid(monthKey, cards, now) {
      var p = parseMonthKey(monthKey, now);
      var todayISO = isoFromDate(new Date(now));
      var grid = {
        year: p.year,
        month: p.month,
        label: MONTH_NAMES[p.month] + ' ' + p.year,
        todayISO: todayISO,
        overdue: [],
        weeks: []
      };

      // Stable 6-week grid; padding cells belong to adjacent months. A cursor
      // date handles month/year rollover without manual day arithmetic.
      var firstDow = new Date(p.year, p.month, 1).getDay();
      var cursor = new Date(p.year, p.month, 1 - firstDow);
      for (var w = 0; w < 6; w++) {
        var week = [];
        for (var d = 0; d < 7; d++) {
          var dateISO = isoFromDate(cursor);
          week.push({
            dateISO: dateISO,
            inMonth: cursor.getMonth() === p.month,
            isToday: dateISO === todayISO,
            cards: []
          });
          cursor.setDate(cursor.getDate() + 1);
        }
        grid.weeks.push(week);
      }

      var byDay = {};
      (cards || []).forEach(function (card) {
        if (!card) return;
        var placed = planDay(card);
        if (placed) {
          if (!byDay[placed]) byDay[placed] = [];
          byDay[placed].push(cardRef(card));
        }
        // Overdue stays deadline-grounded: only a hard due date in the past
        // lands on the strip, and only for cards not yet completed.
        if (!card.completedAt && isPast(card.due, todayISO)) {
          grid.overdue.push(cardRef(card));
        }
      });
      grid.weeks.forEach(function (week) {
        week.forEach(function (day) {
          day.cards = byDay[day.dateISO] || [];
        });
      });
      return grid;
    }

    return {
      calendarGrid: calendarGrid,
      shiftMonth: shiftMonth,
      monthKeyOf: monthKeyOf,
      isPast: isPast,
      planDay: planDay
    };
  }
);
