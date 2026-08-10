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
    root.KB.Core.Streak = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function (DateCore) {
    // HI-SCORE: an arcade-style completion streak over the whole board.
    // A local day counts toward the streak when at least `goal` cards have
    // a completedAt timestamp on it (default goal: 1). The streak is a pure
    // projection of completedAt values the placement pipeline already writes
    // on move-to-Done — no new storage writes happen for the streak itself
    // beyond the derived `state.streaks` high-score snapshot.
    //
    // Semantics (day-granular, local time):
    //   current   — consecutive done days ending today; if today is not done
    //               yet the chain holds through yesterday (todayDone=false).
    //   best      — longest chain anywhere in the data.
    //   week      — last 7 days (today-6 .. today) as booleans, oldest first.
    //   milestone — 7/14/30/50/100/365; celebrations fire only when a
    //               milestone is CROSSED (prev < m <= next), never on day 1.

    var MILESTONES = [7, 14, 30, 50, 100, 365];
    var DEFAULT_GOAL = 1;

    function dayKey(ms) {
      return DateCore.isoDate(new Date(ms));
    }

    // Distinct local days with >= goal completions, as a sorted array of
    // 'YYYY-MM-DD' strings. Deterministic: order comes from the sort, ties
    // from date arithmetic, never from object iteration order.
    function doneDays(cards, goal) {
      var counts = {};
      cards.forEach(function (card) {
        if (card && typeof card.completedAt === 'number' && card.completedAt > 0) {
          var key = dayKey(card.completedAt);
          counts[key] = (counts[key] || 0) + 1;
        }
      });
      return Object.keys(counts)
        .filter(function (key) { return counts[key] >= goal; })
        .sort();
    }

    // Length of the consecutive run ending at days[index], walking back.
    function runEndingAt(days, index) {
      if (index < 0 || index >= days.length) return 0;
      var run = 1;
      for (var i = index - 1; i >= 0; i--) {
        if (DateCore.addDaysISO(new Date(days[i + 1] + 'T00:00:00'), -1) === days[i]) {
          run++;
        } else {
          break;
        }
      }
      return run;
    }

    function shiftDays(ms, offset) {
      var d = new Date(ms);
      d.setDate(d.getDate() + offset);
      return d;
    }

    function compute(cards, now, opts) {
      var goal = opts && typeof opts.goal === 'number' && opts.goal >= 1 ? opts.goal : DEFAULT_GOAL;
      var days = doneDays(cards, goal);
      var today = dayKey(now);
      var yesterday = dayKey(shiftDays(now, -1));

      var todayIdx = days.indexOf(today);
      var yesterdayIdx = days.indexOf(yesterday);

      var current = 0;
      var todayDone = false;
      if (todayIdx !== -1) {
        todayDone = true;
        current = runEndingAt(days, todayIdx);
      } else if (yesterdayIdx !== -1) {
        current = runEndingAt(days, yesterdayIdx);
      }

      var best = 0;
      for (var i = 0; i < days.length; i++) {
        var run = runEndingAt(days, i);
        if (run > best) best = run;
      }

      var week = [];
      for (var w = 6; w >= 0; w--) {
        var key = dayKey(shiftDays(now, -w));
        week.push(days.indexOf(key) !== -1);
      }

      return { current: current, best: best, todayDone: todayDone, week: week, goal: goal };
    }

    // Highest milestone at or below n, or null.
    function milestoneFor(n) {
      var reached = null;
      for (var i = 0; i < MILESTONES.length; i++) {
        if (n >= MILESTONES[i]) reached = MILESTONES[i];
        else break;
      }
      return reached;
    }

    // Highest milestone strictly between prev and next (prev < m <= next),
    // or null. Undefined/0 prev never celebrates day one.
    function crossed(prev, next) {
      var p = typeof prev === 'number' ? prev : 0;
      var n = typeof next === 'number' ? next : 0;
      if (n <= p) return null;
      var hit = null;
      for (var i = 0; i < MILESTONES.length; i++) {
        var m = MILESTONES[i];
        if (m > p && m <= n) hit = m;
      }
      return hit;
    }

    return {
      DEFAULT_GOAL: DEFAULT_GOAL,
      MILESTONES: MILESTONES,
      compute: compute,
      milestoneFor: milestoneFor,
      crossed: crossed,
      doneDays: doneDays,
      runEndingAt: runEndingAt
    };
  }
);
