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
    // Saturday and Sunday. See isRestDay for why these are skipped, not missed.
    var DEFAULT_REST_DAYS = [0, 6];

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

    function shiftDays(ms, offset) {
      var d = new Date(ms);
      d.setDate(d.getDate() + offset);
      return d;
    }

    function prevDay(dayISO) {
      return DateCore.addDaysISO(new Date(dayISO + 'T00:00:00'), -1);
    }

    // Rest days are the point of the whole design. A personal board is not a
    // language app: the goal is shipping work, not touching the machine daily.
    // A day you were never going to work must not read as a failure, so a rest
    // day with no completions is SKIPPED — it neither extends nor breaks the
    // chain. The rule is deliberately asymmetric: a rest day you DID complete
    // on still counts, so weekend workers are not penalised either way.
    function isRestDay(dayISO, restDays) {
      var d = new Date(dayISO + 'T12:00:00'); // noon: DST-proof weekday read
      return restDays.indexOf(d.getDay()) !== -1;
    }

    function normalizeRestDays(value) {
      if (!Array.isArray(value)) return DEFAULT_REST_DAYS.slice();
      var out = [];
      value.forEach(function (n) {
        if (typeof n === 'number' && n >= 0 && n <= 6 && out.indexOf(n) === -1) out.push(n);
      });
      // Every day off would make the streak meaningless; fall back to default.
      return out.length >= 7 ? DEFAULT_REST_DAYS.slice() : out;
    }

    // Length of the run ending at endISO, walking the calendar backwards.
    // `doneSet` maps 'YYYY-MM-DD' -> true; `earliestISO` bounds the walk so a
    // tail of rest days cannot run past the data.
    function runEndingAt(doneSet, endISO, restDays, earliestISO) {
      if (!endISO) return 0;
      var rest = normalizeRestDays(restDays);
      var run = 0;
      var cursor = endISO;
      while (cursor >= earliestISO) {
        if (doneSet[cursor]) run++;
        else if (!isRestDay(cursor, rest)) break;
        cursor = prevDay(cursor);
      }
      return run;
    }

    function compute(cards, now, opts) {
      var goal = opts && typeof opts.goal === 'number' && opts.goal >= 1 ? opts.goal : DEFAULT_GOAL;
      var restDays = normalizeRestDays(opts && opts.restDays);
      var days = doneDays(cards, goal);
      var doneSet = {};
      days.forEach(function (key) { doneSet[key] = true; });
      var earliest = days.length > 0 ? days[0] : dayKey(now);
      var today = dayKey(now);
      var todayDone = Boolean(doneSet[today]);

      // Today is in progress, not yet missed: when nothing is done yet the
      // chain is measured through yesterday rather than broken.
      var current = runEndingAt(doneSet, todayDone ? today : prevDay(today), restDays, earliest);

      var best = 0;
      days.forEach(function (key) {
        var run = runEndingAt(doneSet, key, restDays, earliest);
        if (run > best) best = run;
      });

      var week = [];
      for (var w = 6; w >= 0; w--) {
        var key = dayKey(shiftDays(now, -w));
        week.push({
          dateISO: key,
          done: Boolean(doneSet[key]),
          rest: isRestDay(key, restDays)
        });
      }

      return {
        current: current,
        best: best,
        todayDone: todayDone,
        week: week,
        goal: goal,
        restDays: restDays
      };
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
      DEFAULT_REST_DAYS: DEFAULT_REST_DAYS,
      MILESTONES: MILESTONES,
      compute: compute,
      milestoneFor: milestoneFor,
      crossed: crossed,
      doneDays: doneDays,
      runEndingAt: runEndingAt,
      isRestDay: isRestDay
    };
  }
);
