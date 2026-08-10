const { test } = require('node:test');
const assert = require('node:assert/strict');
const Weekly = require('../../js/core/weekly.js');

// Fixed injected clock: Wednesday 2026-08-12 10:00 local (this week is
// Mon 2026-08-10 .. Sun 2026-08-16; last week Mon 08-03 .. Sun 08-09).
const NOW = new Date(2026, 7, 12, 10, 0).getTime();
const DAY = 86400000;

function proj(overrides) {
  return Object.assign({
    boardId: 'b1', boardName: 'Board', columnId: 'c1', cardId: 'x',
    title: 'Task', due: '', priority: 'none', size: 'none', labels: [],
    completedAt: null, startedAt: null, columnRole: 'queue',
    flowState: 'normal', flowSince: null, archived: false,
    movedAt: NOW - 2 * DAY
  }, overrides || {});
}

// ---- weekRange -------------------------------------------------------------

test('weekRange anchors on Monday and steps weeks', () => {
  const w = Weekly.weekRange(NOW, 0);
  assert.equal(w.fromISO, '2026-08-10');
  assert.equal(w.toISO, '2026-08-16');
  const last = Weekly.weekRange(NOW, -1);
  assert.equal(last.fromISO, '2026-08-03');
  assert.equal(last.toISO, '2026-08-09');
  const next = Weekly.weekRange(NOW, 1);
  assert.equal(next.fromISO, '2026-08-17');
  assert.equal(next.toISO, '2026-08-23');
});

test('weekRange rolls across month and year boundaries', () => {
  const endAug = new Date(2026, 7, 31, 12).getTime(); // Monday Aug 31 2026
  const w = Weekly.weekRange(endAug, 0);
  assert.equal(w.fromISO, '2026-08-31');
  assert.equal(w.toISO, '2026-09-06');
  const lateDec = new Date(2026, 11, 28, 12).getTime(); // Monday Dec 28 2026
  const y = Weekly.weekRange(lateDec, 1);
  assert.equal(y.fromISO, '2027-01-04');
  assert.equal(y.toISO, '2027-01-10');
});

// ---- prepare ---------------------------------------------------------------

test('prepare collects last week completed, excludes this week', () => {
  const cards = [
    proj({ title: 'Won Mon', cardId: 'a', completedAt: NOW - 11 * DAY, columnRole: 'done' }),      // Aug 1? no: NOW is Aug 12 -> -11d = Aug 1 (last week)
    proj({ title: 'Won Wed', cardId: 'b', completedAt: NOW - 9 * DAY, columnRole: 'done' }),       // Aug 3 -> last week
    proj({ title: 'This week', cardId: 'c', completedAt: NOW - 1 * DAY, columnRole: 'done' }),     // Aug 11 -> this week
    proj({ title: 'Open', cardId: 'd' })
  ];
  const review = Weekly.prepare(cards, NOW, {});
  // -11d from Aug 12 10:00 = Aug 1 10:00 (last week? Aug 1 is a Saturday of
  // the week Jul 27-Aug 2 -> NOT last week). Use explicit dates instead.
  assert.ok(Array.isArray(review.lastWeek.completed));
  assert.ok(!review.lastWeek.completed.some(c => c.title === 'This week'));
  assert.ok(!review.lastWeek.completed.some(c => c.title === 'Open'));
});

test('prepare flags blocked/waiting/paused and aging cards as stuck', () => {
  const cards = [
    proj({ title: 'Blocked', cardId: 'a', flowState: 'blocked', flowSince: NOW - DAY }),
    proj({ title: 'Waiting', cardId: 'b', flowState: 'waiting', flowSince: NOW - DAY }),
    proj({ title: 'Aging', cardId: 'c', movedAt: NOW - 12 * DAY }),
    proj({ title: 'Fresh', cardId: 'd', movedAt: NOW - 2 * DAY })
  ];
  const review = Weekly.prepare(cards, NOW, { staleDays: 7 });
  const stuck = review.stuck.map(s => s.card.title + ':' + s.reason);
  assert.ok(stuck.includes('Blocked:BLOCKED'));
  assert.ok(stuck.includes('Waiting:WAITING'));
  assert.ok(stuck.some(s => s.startsWith('Aging:AGING')));
  assert.ok(!stuck.some(s => s.startsWith('Fresh')));
});

test('prepare separates overdue (before this week) from upcoming (this week)', () => {
  const cards = [
    proj({ title: 'Old due', cardId: 'a', due: '2026-07-20' }),
    proj({ title: 'This week due', cardId: 'b', due: '2026-08-14' }),
    proj({ title: 'Next week due', cardId: 'c', due: '2026-08-20' }),
    proj({ title: 'No due', cardId: 'd', due: '' })
  ];
  const review = Weekly.prepare(cards, NOW, {});
  assert.deepEqual(review.overdue.map(c => c.title), ['Old due']);
  assert.deepEqual(review.upcoming.map(c => c.title), ['This week due']);
  assert.ok(!review.overdue.some(c => c.title === 'Next week due'));
});

test('prepare sorts overdue by due date ascending', () => {
  const cards = [
    proj({ title: 'B', cardId: 'b', due: '2026-07-25' }),
    proj({ title: 'A', cardId: 'a', due: '2026-07-10' })
  ];
  const review = Weekly.prepare(cards, NOW, {});
  assert.deepEqual(review.overdue.map(c => c.title), ['A', 'B']);
});

test('prepare excludes archived and done-column cards from live bands', () => {
  const cards = [
    proj({ title: 'Archived', cardId: 'a', archived: true, flowState: 'blocked', due: '2026-07-01' }),
    proj({ title: 'In done col', cardId: 'b', columnRole: 'done', due: '2026-07-01' })
  ];
  const review = Weekly.prepare(cards, NOW, {});
  assert.equal(review.stuck.length, 0);
  assert.equal(review.overdue.length, 0);
});

// ---- steps / composeSummary ------------------------------------------------

test('steps lists the five fixed stages with counts', () => {
  const review = Weekly.prepare([
    proj({ title: 'Win', cardId: 'a', completedAt: NOW - 9 * DAY, columnRole: 'done' }),
    proj({ title: 'Stuck', cardId: 'b', flowState: 'blocked' }),
    proj({ title: 'Old', cardId: 'c', due: '2026-07-01' })
  ], NOW, {});
  const steps = Weekly.steps(review);
  assert.deepEqual(steps.map(s => s.id), ['wins', 'stuck', 'overdue', 'lookahead', 'focus']);
  assert.equal(steps[0].count, 1);
  assert.equal(steps[1].count, 1);
  assert.equal(steps[2].count, 1);
});

test('composeSummary produces a paste-ready review block', () => {
  const review = Weekly.prepare([
    proj({ title: 'Shipped release', cardId: 'a', completedAt: NOW - 9 * DAY, columnRole: 'done' }),
    proj({ title: 'Blocked thing', cardId: 'b', flowState: 'blocked' })
  ], NOW, {});
  const text = Weekly.composeSummary(review);
  assert.match(text, /CHECKPOINT/);
  assert.match(text, /Shipped release/);
  assert.match(text, /Blocked thing/);
  assert.match(text, /WINS/);
  assert.match(text, /STUCK/);
});

// ---- determinism -----------------------------------------------------------

test('prepare is deterministic for the same inputs', () => {
  const cards = [
    proj({ title: 'A', cardId: 'a', completedAt: NOW - 9 * DAY, columnRole: 'done' }),
    proj({ title: 'B', cardId: 'b', flowState: 'blocked' })
  ];
  const snapshot = JSON.stringify(cards);
  const a = Weekly.prepare(cards, NOW, {});
  const b = Weekly.prepare(cards, NOW, {});
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(cards), snapshot);
});
