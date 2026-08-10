const { test } = require('node:test');
const assert = require('node:assert/strict');
const Worklog = require('../../js/core/worklog.js');

// Fixed injected clock: Wednesday 2026-08-12 10:00 local.
const NOW = new Date(2026, 7, 12, 10, 0).getTime();

function dayStartMs(offsetDays) {
  const d = new Date(NOW);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - offsetDays).getTime();
}

function card(overrides) {
  return Object.assign({
    boardId: 'b1', boardName: 'Client A', columnId: 'col1', cardId: 'c1', title: 'Task',
    labels: [], priority: 'none', size: 'none',
    completedAt: null, startedAt: null, columnRole: 'queue', archived: false
  }, overrides || {});
}

// ---- Week range ------------------------------------------------------------

test('weekRange anchors on Monday and steps weeks', () => {
  const week = Worklog.weekRange(NOW, 0);
  assert.equal(week.fromISO, '2026-08-10'); // Monday of 2026-08-12
  assert.equal(week.toISO, '2026-08-16');
  const prev = Worklog.weekRange(NOW, -1);
  assert.equal(prev.fromISO, '2026-08-03');
  assert.equal(prev.toISO, '2026-08-09');
});

test('weekRange rolls across month and year boundaries', () => {
  const sep = new Date(2026, 8, 2).getTime(); // Wed 2026-09-02
  const w = Worklog.weekRange(sep, 0);
  assert.equal(w.fromISO, '2026-08-31');
  assert.equal(w.toISO, '2026-09-06');
  const jan = new Date(2027, 0, 1).getTime(); // Fri 2027-01-01
  const w2 = Worklog.weekRange(jan, 0);
  assert.equal(w2.fromISO, '2026-12-28');
  assert.equal(w2.toISO, '2027-01-03');
});

test('monthRange covers the containing month', () => {
  const m = Worklog.monthRange(NOW);
  assert.equal(m.fromISO, '2026-08-01');
  assert.equal(m.toISO, '2026-08-31');
});

// ---- Build -----------------------------------------------------------------

const WEEK = Worklog.weekRange(NOW, 0);

function fixture() {
  return [
    card({ cardId: 'a', title: 'Alpha', completedAt: dayStartMs(1), labels: ['Feature'] }), // Tue
    card({ cardId: 'b', title: 'Beta', completedAt: dayStartMs(1), startedAt: dayStartMs(5), labels: ['Bug'] }), // Tue, 4d cycle
    card({ cardId: 'c', title: 'Gamma', completedAt: dayStartMs(2), boardName: 'Client B' }), // Mon
    card({ cardId: 'd', title: 'Old', completedAt: dayStartMs(8) }), // last week
    card({ cardId: 'e', title: 'Open', completedAt: null }),
    card({ cardId: 'f', title: 'In done, unstamped', columnRole: 'done', completedAt: null }),
    card({ cardId: 'g', title: 'Done properly', columnRole: 'done', completedAt: dayStartMs(1) })
  ];
}

test('buildWorkLog groups in-range completions by day, newest first', () => {
  const log = Worklog.buildWorkLog(fixture(), WEEK);
  assert.equal(log.stats.total, 4); // a, b, c, g — d is last week, e/f uncompleted
  assert.deepEqual(log.days.map(d => d.dateISO), ['2026-08-11', '2026-08-10']);
  assert.deepEqual(log.days[0].items.map(i => i.cardId), ['a', 'b', 'g']); // tie-broken by id
  assert.deepEqual(log.days[1].items.map(i => i.cardId), ['c']);
});

test('stats count per board and per label', () => {
  const log = Worklog.buildWorkLog(fixture(), WEEK);
  assert.deepEqual(log.stats.perBoard, [
    { boardName: 'Client A', count: 3 },
    { boardName: 'Client B', count: 1 }
  ]);
  assert.deepEqual(log.stats.perLabel, [
    { label: 'Feature', count: 1 },
    { label: 'Bug', count: 1 }
  ]);
});

test('unstamped band flags done-role cards without completion', () => {
  const log = Worklog.buildWorkLog(fixture(), WEEK);
  assert.deepEqual(log.unstamped.map(c => c.cardId), ['f']);
});

test('empty range yields zero counts without throwing', () => {
  const log = Worklog.buildWorkLog([], { fromISO: '2026-08-10', toISO: '2026-08-16', label: 'X' });
  assert.equal(log.stats.total, 0);
  assert.deepEqual(log.days, []);
  assert.deepEqual(log.unstamped, []);
});

test('buildWorkLog is deterministic and does not mutate inputs', () => {
  const cards = fixture();
  const snapshot = JSON.stringify(cards);
  const a = Worklog.buildWorkLog(cards, WEEK);
  const b = Worklog.buildWorkLog(cards, WEEK);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(cards), snapshot);
});

// ---- Compose ---------------------------------------------------------------

test('composeLog produces a paste-ready narrative', () => {
  const log = Worklog.buildWorkLog(fixture(), WEEK);
  const text = Worklog.composeLog(log, {});
  assert.equal(text, 'WEEK OF AUG 10\u2013AUG 16, 2026 \u2014 4 DONE\n' +
    'TUE \u00B7 3: Alpha \u00B7 Beta (4d) \u00B7 Done properly\n' + // Beta: started 5d ago, completed 1d ago = 4d cycle
    'MON \u00B7 1: Gamma');
});

test('cycle notes appear only at or above the threshold', () => {
  const short = Worklog.buildWorkLog([
    card({ cardId: 'a', title: 'Quick', completedAt: dayStartMs(1), startedAt: dayStartMs(2) }) // 1d cycle
  ], WEEK);
  const quick = Worklog.composeLog(short, {});
  assert.ok(quick.indexOf('Quick') !== -1);
  assert.ok(quick.indexOf('(1d)') === -1);
});

test('groupBy board composes per-board subtotals', () => {
  const log = Worklog.buildWorkLog(fixture(), WEEK);
  const text = Worklog.composeLog(log, { groupBy: 'board' });
  assert.equal(text, 'WEEK OF AUG 10\u2013AUG 16, 2026 \u2014 4 DONE\nClient A \u00B7 3\nClient B \u00B7 1');
});

test('an empty log composes an honest line', () => {
  const log = Worklog.buildWorkLog([], WEEK);
  const text = Worklog.composeLog(log, {});
  assert.ok(text.indexOf('Nothing completed this week.') !== -1);
});

test('cycleDays computes whole days and guards missing timestamps', () => {
  assert.equal(Worklog.cycleDays(card({ completedAt: dayStartMs(1), startedAt: dayStartMs(5) })), 4);
  assert.equal(Worklog.cycleDays(card({ completedAt: dayStartMs(1) })), null);
  assert.equal(Worklog.cycleDays(card({ completedAt: null, startedAt: dayStartMs(5) })), null);
});
