const { test } = require('node:test');
const assert = require('node:assert/strict');
const Migration = require('../../js/core/migration.js');
const Lenses = require('../../js/core/lenses.js');
const Metrics = require('../../js/core/metrics.js');
const Relations = require('../../js/core/relations.js');
const Recurrence = require('../../js/core/recurrence.js');

const DAY = 86400000;

let uidCounter = 0;
function uid() { return 'id-' + (++uidCounter); }
function now() { return 1000; }
const deps = { uid, now };

function makeCard(boardId, columnId, i) {
  return {
    id: 'card-' + boardId + '-' + columnId + '-' + i,
    columnId: columnId,
    title: 'Task ' + i,
    description: 'Description for task ' + i,
    labels: ['l-' + (i % 5)],
    assignee: i % 3 === 0 ? 'Sam' : 'Alex',
    createdAt: 100 + i,
    updatedAt: 100 + i,
    movedAt: 100 + i,
    due: i % 4 === 0 ? '2026-08-10' : '',
    checklist: [],
    priority: i % 5 === 0 ? 'urgent' : (i % 3 === 0 ? 'high' : 'none'),
    size: 'none',
    startedAt: i % 2 === 0 ? 200 + i : null,
    completedAt: i % 7 === 0 ? 500 + i : null,
    flow: { state: i % 11 === 0 ? 'blocked' : 'normal', reason: '', since: 300, periods: [] },
    dependencies: { blockers: i % 9 === 0 ? [{ boardId: 'board-' + ((i + 1) % 20 + 1), cardId: 'card-1' }] : [], related: [] },
    recurrenceId: null,
    transitions: i % 13 === 0 ? [{ fromColumnId: null, toColumnId: columnId, fromRole: null, toRole: 'queue', at: 100 }] : []
  };
}

function makeLargeState() {
  const boards = [];
  for (let b = 1; b <= 20; b++) {
    const columns = [];
    for (let c = 1; c <= 20; c++) {
      const cards = [];
      const cardCount = b === 1 ? 1000 : 10;
      for (let i = 1; i <= cardCount; i++) {
        cards.push(makeCard('board-' + b, 'col-' + b + '-' + c, i));
      }
      columns.push({
        id: 'col-' + b + '-' + c,
        title: 'Column ' + c,
        role: c % 4 === 0 ? 'done' : 'queue',
        isDone: c % 4 === 0,
        wipLimit: c % 3 === 0 ? 5 : 0,
        collapsed: false,
        policy: { wipMode: 'off', overrideRequiresReason: false, entryCriteria: [], exitCriteria: [], defaultLabelIds: [], defaultAssignee: '', countsTowardCycleTime: true },
        cards: cards
      });
    }
    boards.push({
      id: 'board-' + b,
      name: 'Board ' + b,
      flowSettings: { staleAfterDays: 7, oversizedChecklistThreshold: 10, completedReviewAfterDays: 7, slePercentile: 0.85, manualSleDays: null },
      labels: [{ id: 'l-0', name: 'Bug', color: '#c81e14' }, { id: 'l-1', name: 'Feature', color: '#2a58c4' }],
      templates: [],
      columns: columns,
      archive: { cards: [], columns: [] }
    });
  }
  return {
    version: 3,
    theme: 'dark',
    activeBoardId: 'board-1',
    inbox: { items: Array.from({ length: 50 }, (_, i) => ({ id: 'in-' + i, title: 'Item ' + i, note: '', url: '', capturedAt: 100 + i, updatedAt: 100 + i })) },
    lenses: [],
    recurrences: Array.from({ length: 10 }, (_, i) => ({
      id: 'rec-' + i,
      enabled: true,
      mode: 'scheduled',
      schedule: { frequency: 'daily', interval: 1, weekdays: [], dayOfMonth: null, delayAfterCompletionDays: null },
      target: { boardId: 'board-' + (i + 1), columnId: 'col-' + (i + 1) + '-1' },
      template: { title: 'Rec ' + i, description: '', labelIds: [], assignee: '', priority: 'none', size: 'none', checklist: [] },
      dueOffsetDays: null,
      overlapPolicy: 'single-active',
      missedPolicy: 'create-one',
      activeCardRef: null,
      nextRunAt: 1e12 + i * DAY,
      lastRunAt: null,
      lastCompletedAt: null,
      endAt: null,
      remainingOccurrences: null,
      pausedReason: '',
      createdAt: 100,
      updatedAt: 100
    })),
    boards: boards
  };
}

function timed(label, fn) {
  const start = Date.now();
  const result = fn();
  const ms = Date.now() - start;
  return { label, ms, result };
}

test('large state normalization stays under budget', () => {
  const large = makeLargeState();
  const { ms } = timed('normalize', () => Migration.normalizeState(large, deps));
  assert.ok(ms < 3000, 'normalization took ' + ms + 'ms');
});

test('large state normalization is reference independent and idempotent', () => {
  const large = makeLargeState();
  const once = Migration.normalizeState(large, deps);
  const twice = Migration.normalizeState(once, deps);
  assert.deepEqual(twice, once);
  assert.notEqual(once, large);
});

test('lens evaluation on large state stays under budget', () => {
  const large = Migration.normalizeState(makeLargeState(), deps);
  const lens = Lenses.builtInLenses()[0];
  const { ms, result } = timed('lens', () => Lenses.applyLens(large, lens, 1000));
  assert.ok(ms < 2000, 'lens took ' + ms + 'ms');
  assert.ok(Array.isArray(result));
});

test('review queue generation on large state stays under budget', () => {
  const large = Migration.normalizeState(makeLargeState(), deps);
  const { ms, result } = timed('review', () => Metrics.reviewQueue(large, 'board-1', 1000, {}));
  assert.ok(ms < 2000, 'review took ' + ms + 'ms');
  assert.ok(Array.isArray(result));
});

test('dependency resolution on large state stays under budget', () => {
  const large = Migration.normalizeState(makeLargeState(), deps);
  const { ms } = timed('relations', () => {
    let count = 0;
    for (let b = 1; b <= 20; b++) {
      for (let i = 1; i <= 100; i++) {
        count += Relations.getUnresolvedBlockers(large, { boardId: 'board-' + b, cardId: 'card-board-' + b + '-col-' + b + '-1-' + i }).length;
      }
    }
    return count;
  });
  assert.ok(ms < 2000, 'relations took ' + ms + 'ms');
});

test('recurrence processing on large state stays under budget', () => {
  const large = Migration.normalizeState(makeLargeState(), deps);
  const { ms, result } = timed('recurrence', () => Recurrence.processDueRecurrences(large, 100000, deps));
  assert.ok(ms < 2000, 'recurrence took ' + ms + 'ms');
  assert.equal(result.changed, false);
});

test('benchmark timings are recorded for the developer note', () => {
  const large = makeLargeState();
  const results = [
    timed('normalizeState (20 boards, 5000 cards)', () => Migration.normalizeState(large, deps)),
    timed('applyLens builtin (5000 cards)', () => Lenses.applyLens(large, Lenses.builtInLenses()[0], 1000)),
    timed('reviewQueue (large board)', () => Metrics.reviewQueue(large, 'board-1', 1000, {}))
  ];
  results.forEach((r) => {
    console.log('PERF ' + r.label + ': ' + r.ms + 'ms');
  });
});
