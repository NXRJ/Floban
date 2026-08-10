const { test } = require('node:test');
const assert = require('node:assert/strict');
const Focus = require('../../js/core/focus.js');

// Fixed injected clock: Wednesday 2026-08-12 10:00 local.
const NOW = new Date(2026, 7, 12, 10, 0, 0).getTime();
const POMO = 25 * 60 * 1000;

function session(kind, startedAt) {
  return { cardId: 'c1', startedAt: typeof startedAt === 'number' ? startedAt : NOW, kind: kind || 'pomodoro' };
}

test('a full pomodoro stamps one pomodoro and its minutes', () => {
  const result = Focus.computeEnd(session('pomodoro', NOW - POMO), NOW, POMO);
  assert.equal(result.changed, true);
  assert.equal(result.logged, true);
  assert.equal(result.pomodoros, 1);
  assert.equal(result.minutes, 25);
  assert.equal(result.cardId, 'c1');
  assert.equal(result.dayISO, '2026-08-12');
});

test('a short pomodoro logs minutes but no pomodoro stamp', () => {
  const result = Focus.computeEnd(session('pomodoro', NOW - 24 * 60 * 1000), NOW, POMO);
  assert.equal(result.pomodoros, 0);
  assert.equal(result.minutes, 24);
  assert.equal(result.logged, true);
});

test('a stopwatch logs minutes only', () => {
  const result = Focus.computeEnd(session('stopwatch', NOW - 10 * 60 * 1000), NOW, POMO);
  assert.equal(result.pomodoros, 0);
  assert.equal(result.minutes, 10);
});

test('sessions under a minute log nothing', () => {
  const result = Focus.computeEnd(session('pomodoro', NOW - 30 * 1000), NOW, POMO);
  assert.equal(result.logged, false);
  assert.equal(result.minutes, 0);
  assert.equal(result.pomodoros, 0);
});

test('elapsed is exact across a day boundary', () => {
  const start = new Date(2026, 7, 12, 23, 59, 0).getTime();
  const end = new Date(2026, 7, 13, 0, 1, 0).getTime();
  const result = Focus.computeEnd(session('stopwatch', start), end, POMO);
  assert.equal(result.minutes, 2);
  assert.equal(result.dayISO, '2026-08-13'); // logged against the end day
});

test('elapsed clamps negative clocks and missing sessions', () => {
  assert.equal(Focus.elapsedMinutes(NOW, NOW - 5000), 0);
  const none = Focus.computeEnd(null, NOW, POMO);
  assert.equal(none.changed, false);
  assert.equal(none.reason, 'no-session');
});

test('elapsed minutes rounds to the nearest minute', () => {
  assert.equal(Focus.elapsedMinutes(NOW, NOW + 30 * 1000), 1);
  assert.equal(Focus.elapsedMinutes(NOW, NOW + 90 * 1000), 2);
});

test('a session cannot start while one is active', () => {
  assert.equal(Focus.startable({ focusSession: null }), true);
  assert.equal(Focus.startable({ focusSession: { cardId: 'x', startedAt: 1, kind: 'pomodoro' } }), false);
});

test('focusTotals aggregates with a since filter', () => {
  const days = {
    '2026-08-10': { minutes: 25, pomodoros: 1 },
    '2026-08-12': { minutes: 60, pomodoros: 2 },
    garbage: { minutes: 99 },
    '2026-08-09': { minutes: 10, pomodoros: 0 }
  };
  const all = Focus.focusTotals(days, '');
  assert.equal(all.minutes, 95);
  assert.equal(all.pomodoros, 3);
  const since = Focus.focusTotals(days, '2026-08-10');
  assert.equal(since.minutes, 85);
  assert.equal(Focus.focusTotals(null, '').minutes, 0);
  assert.equal(Focus.focusTotals({}, '2026-08-10').minutes, 0);
});

test('formatEffort renders hours and minutes compactly', () => {
  assert.equal(Focus.formatEffort(0), '0m');
  assert.equal(Focus.formatEffort(45), '45m');
  assert.equal(Focus.formatEffort(120), '2h');
  assert.equal(Focus.formatEffort(125), '2h05m');
});

test('computeEnd is deterministic', () => {
  const a = Focus.computeEnd(session('pomodoro', NOW - POMO), NOW, POMO);
  const b = Focus.computeEnd(session('pomodoro', NOW - POMO), NOW, POMO);
  assert.deepEqual(a, b);
});
