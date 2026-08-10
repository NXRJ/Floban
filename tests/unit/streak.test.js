const { test } = require('node:test');
const assert = require('node:assert/strict');
const Streak = require('../../js/core/streak.js');

// Fixed local-day helpers: build timestamps for a given local date at noon
// (noon avoids any midnight/DST boundary weirdness in the local tz).
// Reference day: Wednesday 2026-08-12.
function at(y, m, day, h) {
  return new Date(y, m - 1, day, typeof h === 'number' ? h : 12).getTime();
}
const NOW = at(2026, 8, 12, 9);

function cards(...days) {
  return days.map(function (d) {
    return { completedAt: at(2026, 8, d) };
  });
}

// ---- compute: current / best / todayDone / week ----------------------------

test('compute counts consecutive days ending today', () => {
  const info = Streak.compute(cards(10, 11, 12), NOW, {});
  assert.equal(info.current, 3);
  assert.equal(info.best, 3);
  assert.equal(info.todayDone, true);
});

test('two completions on one day count once', () => {
  const info = Streak.compute(cards(10, 11, 11, 12), NOW, {});
  assert.equal(info.current, 3);
  assert.equal(info.best, 3);
});

test('streak holds through today when yesterday was done', () => {
  const info = Streak.compute(cards(11), NOW, {});
  assert.equal(info.current, 1);
  assert.equal(info.todayDone, false);
  assert.equal(info.best, 1);
});

test('a gap day resets the current streak but keeps best', () => {
  // Days 1..6 done, then a gap at 7, then 8..10.
  const all = [];
  for (let d = 1; d <= 6; d++) all.push({ completedAt: at(2026, 8, d) });
  for (let d = 8; d <= 10; d++) all.push({ completedAt: at(2026, 8, d) });
  const info = Streak.compute(all, at(2026, 8, 10, 9), {});
  assert.equal(info.current, 3); // 8, 9, 10
  assert.equal(info.best, 6);    // 1..6
  assert.equal(info.todayDone, true);
});

test('empty cards yield zero streak', () => {
  const info = Streak.compute([], NOW, {});
  assert.equal(info.current, 0);
  assert.equal(info.best, 0);
  assert.equal(info.todayDone, false);
  assert.deepEqual(info.week, [false, false, false, false, false, false, false]);
});

test('cards with null or missing completedAt are ignored', () => {
  const info = Streak.compute([{ completedAt: null }, {}, { completedAt: at(2026, 8, 12) }], NOW, {});
  assert.equal(info.current, 1);
});

test('month/year boundaries do not break consecutive counting', () => {
  // Aug 31 -> Sep 1 consecutive (2026-08-31 is a Monday, Sep 1 Tuesday).
  const info = Streak.compute(
    [{ completedAt: at(2026, 8, 31) }, { completedAt: at(2026, 9, 1) }],
    at(2026, 9, 1, 9),
    {}
  );
  assert.equal(info.current, 2);
});

test('week strip is oldest-first over the last 7 days', () => {
  // Today Wed 12; done on 8 (Thu last week) and 10 (Sat) and 11 (Sun) and 12.
  const info = Streak.compute(cards(8, 10, 11, 12), NOW, {});
  // [Mon6, Tue7, Wed8, Thu9, Fri10, Sat11, Sun12] -> wait: last 7 days are
  // Wed6..Tue12? No: week is today-6 .. today = 2026-08-06 .. 2026-08-12.
  assert.deepEqual(info.week, [false, false, true, false, true, true, true]);
});

// ---- goal variant ----------------------------------------------------------

test('goal variant rejects days below the goal', () => {
  const info = Streak.compute(
    [{ completedAt: at(2026, 8, 11) }, { completedAt: at(2026, 8, 12) }],
    NOW,
    { goal: 2 }
  );
  assert.equal(info.current, 0);
  assert.equal(info.todayDone, false);
});

test('goal variant counts a day once when it meets the goal', () => {
  const info = Streak.compute(
    [
      { completedAt: at(2026, 8, 11) }, { completedAt: at(2026, 8, 11) },
      { completedAt: at(2026, 8, 12) }, { completedAt: at(2026, 8, 12) }
    ],
    NOW,
    { goal: 2 }
  );
  assert.equal(info.current, 2);
});

// ---- milestone helpers -----------------------------------------------------

test('milestoneFor returns the highest milestone at or below n', () => {
  assert.equal(Streak.milestoneFor(7), 7);
  assert.equal(Streak.milestoneFor(14), 14);
  assert.equal(Streak.milestoneFor(30), 30);
  assert.equal(Streak.milestoneFor(50), 50);
  assert.equal(Streak.milestoneFor(100), 100);
  assert.equal(Streak.milestoneFor(365), 365);
  assert.equal(Streak.milestoneFor(400), 365);
  assert.equal(Streak.milestoneFor(6), null);
  assert.equal(Streak.milestoneFor(1), null);
  assert.equal(Streak.milestoneFor(0), null);
});

test('crossed detects milestone boundaries only', () => {
  assert.equal(Streak.crossed(6, 7), 7);
  assert.equal(Streak.crossed(13, 14), 14);
  assert.equal(Streak.crossed(29, 30), 30);
  assert.equal(Streak.crossed(30, 31), null);
  assert.equal(Streak.crossed(0, 1), null);
  assert.equal(Streak.crossed(undefined, 1), null);
  assert.equal(Streak.crossed(null, 1), null);
  assert.equal(Streak.crossed(6, 14), 14);
  assert.equal(Streak.crossed(undefined, 7), 7);
  assert.equal(Streak.crossed(30, 30), null);
  assert.equal(Streak.crossed(100, 101), null);
});

// ---- determinism / purity --------------------------------------------------

test('compute is deterministic and does not mutate inputs', () => {
  const input = cards(10, 11, 12);
  const snapshot = JSON.stringify(input);
  const a = Streak.compute(input, NOW, {});
  const b = Streak.compute(input, NOW, {});
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(input), snapshot);
});

test('doneDays sorts deterministically and filters below goal', () => {
  const days = Streak.doneDays(cards(12, 10, 11), 1);
  assert.deepEqual(days, ['2026-08-10', '2026-08-11', '2026-08-12']);
});

test('runEndingAt returns 0 for out-of-range indexes', () => {
  assert.equal(Streak.runEndingAt([], 0), 0);
  assert.equal(Streak.runEndingAt(['2026-08-10'], 1), 0);
});
