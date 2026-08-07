const { test } = require('node:test');
const assert = require('node:assert/strict');
const Metrics = require('../../js/core/metrics.js');

const DAY = 86400000;

function card(id, columnId, overrides) {
  return Object.assign({
    id: id,
    columnId: columnId,
    title: 'Task ' + id,
    description: '',
    labels: [],
    assignee: '',
    createdAt: 100,
    updatedAt: 100,
    movedAt: 100,
    due: '',
    checklist: [],
    priority: 'none',
    size: 'none',
    startedAt: null,
    completedAt: null,
    flow: { state: 'normal', reason: '', since: null, periods: [] },
    dependencies: { blockers: [], related: [] },
    recurrenceId: null,
    transitions: []
  }, overrides || {});
}

function board(overrides) {
  return Object.assign({
    id: 'board-1',
    name: 'Board',
    flowSettings: {
      staleAfterDays: 7,
      oversizedChecklistThreshold: 10,
      completedReviewAfterDays: 7,
      slePercentile: 0.85,
      manualSleDays: null
    },
    labels: [],
    templates: [],
    columns: [
      {
        id: 'col-q',
        title: 'Queue',
        role: 'queue',
        isDone: false,
        wipLimit: 0,
        cards: []
      },
      {
        id: 'col-d',
        title: 'Done',
        role: 'done',
        isDone: true,
        wipLimit: 0,
        cards: []
      }
    ],
    archive: { cards: [], columns: [] }
  }, overrides || {});
}

test('median handles odd and even lengths', () => {
  assert.equal(Metrics.median([3, 1, 2]), 2);
  assert.equal(Metrics.median([4, 1, 2, 3]), 2.5);
  assert.equal(Metrics.median([]), null);
});

test('percentile returns boundaries and interpolated values', () => {
  assert.equal(Metrics.percentile([1, 2, 3, 4], 0), 1);
  assert.equal(Metrics.percentile([1, 2, 3, 4], 1), 4);
  assert.equal(Metrics.percentile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(Metrics.percentile([10, 20], 0.85), 18.5);
  assert.equal(Metrics.percentile([], 0.85), null);
});

test('completedCardsInRange counts only cards completed in the window', () => {
  const b = board();
  b.columns[1].cards = [
    card('a', 'col-d', { completedAt: 1000 }),
    card('b', 'col-d', { completedAt: 5000 }),
    card('c', 'col-d', { completedAt: 9000 })
  ];
  const inRange = Metrics.completedCardsInRange(b, 2000, 6000);
  assert.deepEqual(inRange.map(c => c.id), ['b']);
});

test('throughput counts latest completions in range', () => {
  const b = board();
  b.columns[1].cards = [
    card('a', 'col-d', { completedAt: 1000 }),
    card('b', 'col-d', { completedAt: 5000 })
  ];
  assert.equal(Metrics.throughput(b, 0, 4000), 1);
  assert.equal(Metrics.throughput(b, 0, 6000), 2);
});

test('reopened cards are not counted as completed', () => {
  const b = board();
  b.columns[0].cards = [
    card('a', 'col-q', { startedAt: 100, completedAt: null })
  ];
  assert.equal(Metrics.throughput(b, 0, DAY * 10), 0);
  assert.deepEqual(Metrics.completedCardsInRange(b, 0, DAY * 10), []);
});

test('cycleTimes uses startedAt to completedAt only', () => {
  const b = board();
  b.columns[1].cards = [
    card('a', 'col-d', { startedAt: 100, completedAt: 100 + DAY }),
    card('b', 'col-d', { startedAt: 100, completedAt: 100 + 3 * DAY }),
    card('c', 'col-d', { completedAt: 100 + DAY })
  ];
  const times = Metrics.cycleTimes(b);
  assert.deepEqual(times, [1, 3]);
});

test('cycle times include archived completed cards', () => {
  const b = board();
  b.archive.cards = [card('z', 'col-q', { startedAt: 0, completedAt: DAY, archivedAt: DAY + 1 })];
  assert.deepEqual(Metrics.cycleTimes(b), [1]);
});

test('automatic SLE requires ten completed samples', () => {
  const b = board();
  b.columns[1].cards = [];
  for (let i = 0; i < 9; i++) {
    b.columns[1].cards.push(card('c' + i, 'col-d', { startedAt: i * DAY, completedAt: (i + 2) * DAY }));
  }
  const result = Metrics.calculateSle(b);
  assert.equal(result.sleDays, null);
  assert.equal(result.sampleCount, 9);

  b.columns[1].cards.push(card('c9', 'col-d', { startedAt: 100 * DAY, completedAt: 102 * DAY }));
  const withTen = Metrics.calculateSle(b);
  assert.ok(withTen.sleDays > 0);
  assert.equal(withTen.sampleCount, 10);
});

test('manual SLE overrides the automatic calculation', () => {
  const b = board();
  b.flowSettings.manualSleDays = 12;
  const result = Metrics.calculateSle(b);
  assert.equal(result.sleDays, 12);
  assert.equal(result.manual, true);
});

test('wipByColumn reports counts and over-limit state', () => {
  const b = board();
  b.columns[0].wipLimit = 1;
  b.columns[0].cards = [card('a', 'col-q'), card('b', 'col-q')];
  const wip = Metrics.wipByColumn(b, 5000);
  assert.equal(wip[0].count, 2);
  assert.equal(wip[0].over, true);
  assert.equal(wip[1].over, false);
});

test('oldestActiveCards orders by start time', () => {
  const b = board();
  b.columns[0].cards = [
    card('a', 'col-q', { startedAt: 300 }),
    card('b', 'col-q', { startedAt: 100 }),
    card('c', 'col-q', { startedAt: 200 })
  ];
  const oldest = Metrics.oldestActiveCards(b, 5000);
  assert.deepEqual(oldest.map(c => c.id), ['b', 'c', 'a']);
});

test('review queue orders blocked work first', () => {
  const s = {
    boards: [board()]
  };
  const b = s.boards[0];
  b.columns[0].cards = [
    card('paused', 'col-q', { flow: { state: 'paused', reason: '', since: 1000, periods: [] } }),
    card('blocked', 'col-q', { flow: { state: 'blocked', reason: '', since: 1000, periods: [] }, createdAt: 300, priority: 'none' }),
    card('normal', 'col-q', { createdAt: 100 })
  ];
  const queue = Metrics.reviewQueue(s, 'board-1', 5000, {});
  assert.equal(queue[0].card.id, 'blocked');
  assert.ok(queue[0].reasons.some(r => r.includes('Blocked')));
});

test('review queue places dependency blocked ahead of waiting', () => {
  const s = { boards: [board()] };
  const b = s.boards[0];
  const blocker = card('blk', 'col-q', {});
  b.columns[0].cards = [blocker];
  b.columns[0].cards.push(card('dep', 'col-q', {
    dependencies: { blockers: [{ boardId: 'board-1', cardId: 'blk' }], related: [] },
    movedAt: 1000,
    createdAt: 100
  }));
  b.columns[0].cards.push(card('wait', 'col-q', { flow: { state: 'waiting', reason: '', since: 1000, periods: [] } }));
  const queue = Metrics.reviewQueue(s, 'board-1', 5000, {});
  assert.equal(queue[0].card.id, 'dep');
  assert.equal(queue[1].card.id, 'wait');
});

test('review queue applies tie-breakers by priority then age', () => {
  const s = { boards: [board()] };
  const b = s.boards[0];
  b.columns[0].cards = [
    card('low', 'col-q', { flow: { state: 'paused', reason: '', since: 1000, periods: [] }, priority: 'low', createdAt: 100 }),
    card('urgent', 'col-q', { flow: { state: 'paused', reason: '', since: 1000, periods: [] }, priority: 'urgent', createdAt: 300 })
  ];
  const queue = Metrics.reviewQueue(s, 'board-1', 5000, {});
  assert.equal(queue[0].card.id, 'urgent');
});

test('review queue flags overdue and stale cards', () => {
  const NOW = Date.parse('2026-08-07T12:00:00Z');
  const s = { boards: [board()] };
  const b = s.boards[0];
  b.columns[0].cards = [
    card('overdue', 'col-q', { due: '2020-01-01', createdAt: NOW - DAY }),
    card('stale', 'col-q', { updatedAt: NOW - 2 * DAY, createdAt: NOW - 3 * DAY, movedAt: NOW - 3 * DAY })
  ];
  const queue = Metrics.reviewQueue(s, 'board-1', NOW, { staleAfterDays: 1 });
  const overdue = queue.find(q => q.card.id === 'overdue');
  const stale = queue.find(q => q.card.id === 'stale');
  assert.ok(overdue.reasons.some(r => r === 'Overdue'));
  assert.ok(stale.reasons.some(r => r.includes('Stale')));
});

test('review queue ignores malformed timestamps', () => {
  const s = { boards: [board()] };
  const b = s.boards[0];
  b.columns[0].cards = [
    card('bad', 'col-q', { startedAt: 'yesterday', completedAt: null, updatedAt: null, createdAt: null, movedAt: null, flow: null })
  ];
  const queue = Metrics.reviewQueue(s, 'board-1', 5000, {});
  assert.ok(Array.isArray(queue));
});

test('review queue surfaces completed cards ready to archive', () => {
  const NOW = Date.parse('2026-08-07T12:00:00Z');
  const s = { boards: [board()] };
  const b = s.boards[0];
  b.columns[1].cards = [
    card('done-old', 'col-d', { completedAt: NOW - 2 * DAY, startedAt: NOW - 3 * DAY })
  ];
  const queue = Metrics.reviewQueue(s, 'board-1', NOW, { completedReviewAfterDays: 1 });
  assert.ok(queue.some(q => q.card.id === 'done-old' && q.reasons.some(r => r.includes('archive'))));
});

test('review queue respects oversized checklist threshold', () => {
  const s = { boards: [board()] };
  const b = s.boards[0];
  const checklist = [];
  for (let i = 0; i < 11; i++) checklist.push({ id: 'i' + i, text: 'x', done: false });
  b.columns[0].cards = [card('big', 'col-q', { checklist })];
  const queue = Metrics.reviewQueue(s, 'board-1', 5000, {});
  assert.ok(queue.some(q => q.card.id === 'big' && q.reasons.some(r => r.includes('checklist'))));
});

test('review queue explains reasons for every item', () => {
  const s = { boards: [board()] };
  const b = s.boards[0];
  b.columns[0].cards = [
    card('blocked', 'col-q', { flow: { state: 'blocked', reason: 'Waiting for API credentials', since: 1000, periods: [] } })
  ];
  const queue = Metrics.reviewQueue(s, 'board-1', 5000, {});
  assert.equal(queue.length, 1);
  assert.ok(queue[0].reasons.length >= 1);
});

test('flowSummary aggregates board health numbers', () => {
  const NOW = Date.parse('2026-08-07T12:00:00Z');
  const s = { boards: [board()] };
  const b = s.boards[0];
  b.columns[0].cards = [
    card('a', 'col-q', { startedAt: NOW - 2 * DAY, flow: { state: 'blocked', reason: '', since: NOW - 2 * DAY, periods: [] } }),
    card('b', 'col-q', { startedAt: NOW - DAY })
  ];
  b.columns[1].cards = [
    card('c', 'col-d', { startedAt: NOW - 5 * DAY, completedAt: NOW - 4 * DAY }),
    card('d', 'col-d', { startedAt: NOW - 6 * DAY, completedAt: NOW - 3 * DAY })
  ];
  const summary = Metrics.flowSummary(b, NOW);
  assert.equal(summary.wip, 2);
  assert.equal(summary.completed30d, 2);
  assert.equal(summary.medianCycleTime, 2);
  assert.equal(summary.blockedTotal, 1);
  assert.equal(summary.oldestActive.id, 'a');
});

test('flowSummary shows empty states for a fresh board', () => {
  const summary = Metrics.flowSummary(board(), 1000);
  assert.equal(summary.wip, 0);
  assert.equal(summary.medianCycleTime, null);
  assert.equal(summary.sle.sleDays, null);
  assert.equal(summary.oldestActive, null);
});

test('overWipColumns explains the bottleneck', () => {
  const b = board();
  b.columns[0].wipLimit = 1;
  b.columns[0].cards = [card('a', 'col-q', { startedAt: 100 }), card('b', 'col-q', { startedAt: 200 })];
  const bottlenecks = Metrics.overWipColumns(b, 1000);
  assert.equal(bottlenecks.length, 1);
  assert.ok(bottlenecks[0].explanation.includes('Queue holds 2 cards'));
});

test('review results are deterministic for identical inputs', () => {
  const build = () => {
    const s = { boards: [board()] };
    s.boards[0].columns[0].cards = [
      card('x', 'col-q', { flow: { state: 'blocked', reason: '', since: 1000, periods: [] } }),
      card('y', 'col-q', { flow: { state: 'waiting', reason: '', since: 1000, periods: [] } })
    ];
    return s;
  };
  const first = Metrics.reviewQueue(build(), 'board-1', 5000, {});
  const second = Metrics.reviewQueue(build(), 'board-1', 5000, {});
  assert.deepEqual(first, second);
});
