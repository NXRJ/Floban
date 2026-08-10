const { test } = require('node:test');
const assert = require('node:assert/strict');
const DayPlan = require('../../js/core/dayplan.js');
const Migration = require('../../js/core/migration.js');

// Fixed injected clock: Wednesday 2026-08-12 10:00 local.
const NOW = new Date(2026, 7, 12, 10, 0).getTime();
const DAY = '2026-08-12';

function card(overrides) {
  return Object.assign({
    boardId: 'b1', columnId: 'col1', cardId: 'c1', title: 'Task',
    due: '', priority: 'none', completedAt: null
  }, overrides || {});
}

const FIXTURE = [
  card({ cardId: 'ov-old', title: 'Old overdue', due: '2026-08-01' }),
  card({ cardId: 'ov-new', title: 'Recent overdue', due: '2026-08-10' }),
  card({ cardId: 'due-p1', title: 'Urgent today', due: '2026-08-12', priority: 'urgent' }),
  card({ cardId: 'due-p3', title: 'Medium today', due: '2026-08-12', priority: 'medium' }),
  card({ cardId: 'ready', title: 'Ready filler', due: '' }),
  card({ cardId: 'done-card', title: 'Completed', due: '2026-08-01', completedAt: 1000 }),
  card({ cardId: 'future', title: 'Future', due: '2026-08-20' })
];

function opts(overrides) {
  return Object.assign({ now: NOW, dayISO: DAY, slots: 3, cards: FIXTURE, review: [], dayplans: {} }, overrides || {});
}

// ---- Candidate ranking -----------------------------------------------------

test('ranks overdue by age, then due-today by priority', () => {
  const rows = DayPlan.buildCandidates(opts());
  const titles = rows.map((r) => r.title);
  assert.deepEqual(titles, ['Old overdue', 'Recent overdue', 'Urgent today', 'Medium today']);
  assert.equal(rows[0].reason, 'OVERDUE 11D');
  assert.equal(rows[1].reason, 'OVERDUE 2D');
  assert.equal(rows[2].reason, 'DUE TODAY URGENT');
  assert.equal(rows[3].reason, 'DUE TODAY MEDIUM');
});

test('excludes completed cards and future-dated cards', () => {
  const rows = DayPlan.buildCandidates(opts());
  assert.ok(!rows.some((r) => r.cardId === 'done-card'));
  assert.ok(!rows.some((r) => r.cardId === 'future'));
});

test('carry-overs from the prior sheet rank first', () => {
  const dayplans = {
    '2026-08-11': {
      dateISO: '2026-08-11',
      stampedAt: 1,
      rolledAt: null,
      commitments: [
        { cardId: 'ready', order: 0, status: 'kept' },
        { cardId: 'due-p1', order: 1, status: 'open' },
        { cardId: 'done-card', order: 2, status: 'kept' } // completed since -> dropped
      ]
    }
  };
  const rows = DayPlan.buildCandidates(opts({ dayplans: dayplans }));
  assert.deepEqual(rows.slice(0, 3).map((r) => r.cardId), ['ready', 'due-p1', 'ov-old']);
  assert.equal(rows[0].reason, 'CARRIED OVER');
  assert.equal(rows[1].reason, 'CARRIED OVER');
});

test('review queue fills the tail in order', () => {
  const rows = DayPlan.buildCandidates(opts({ review: [{ boardId: 'b1', cardId: 'ready' }] }));
  const idx = rows.findIndex((r) => r.cardId === 'ready');
  assert.ok(idx >= 4, 'ready appears after the ranked bands');
  assert.equal(rows[idx].reason, 'REVIEW');
});

test('candidates cap at slots + 6 and never duplicate', () => {
  const many = [];
  for (let i = 0; i < 30; i++) many.push(card({ cardId: 'c' + i, title: 'C' + i, due: '2026-08-10' }));
  const rows = DayPlan.buildCandidates(opts({ cards: many }));
  assert.ok(rows.length <= 9);
  const ids = new Set(rows.map((r) => r.cardId));
  assert.equal(ids.size, rows.length);
});

test('ranking is deterministic for identical inputs', () => {
  const a = DayPlan.buildCandidates(opts());
  const b = DayPlan.buildCandidates(opts());
  assert.deepEqual(a, b);
});

// ---- Stamping --------------------------------------------------------------

test('stampDay caps, dedupes and preserves order', () => {
  const plan = DayPlan.stampDay(DAY, ['a', 'b', 'c', 'd'], NOW, 3);
  assert.equal(plan.commitments.length, 3);
  assert.deepEqual(plan.commitments.map((c) => c.cardId), ['a', 'b', 'c']);
  assert.deepEqual(plan.commitments.map((c) => c.status), ['open', 'open', 'open']);
  assert.equal(plan.dateISO, DAY);
  assert.equal(plan.rolledAt, null);
  assert.equal(plan.stampedAt, NOW);

  const deduped = DayPlan.stampDay(DAY, ['a', 'a', 'b'], NOW, 3);
  assert.deepEqual(deduped.commitments.map((c) => c.cardId), ['a', 'b']);
});

// ---- Rolling ---------------------------------------------------------------

function planWith(cardIds, dateISO) {
  return {
    dateISO: dateISO || DAY,
    stampedAt: NOW,
    rolledAt: null,
    commitments: cardIds.map((cardId, i) => ({ cardId: cardId, order: i, status: 'open' }))
  };
}

test('rollPlan maps keep/push/drop/archive to the right ops', () => {
  const plan = planWith(['a', 'b', 'c', 'd']);
  const cards = [
    card({ cardId: 'a', due: '2026-08-15' }),
    card({ cardId: 'b', due: '2026-08-15' }),
    card({ cardId: 'c', due: '2026-08-15' }),
    card({ cardId: 'd', due: '2026-08-15' })
  ];
  const result = DayPlan.rollPlan(plan, [
    { cardId: 'a', kind: 'push' },
    { cardId: 'b', kind: 'drop' },
    { cardId: 'c', kind: 'archive' },
    { cardId: 'd', kind: 'keep' }
  ], cards, NOW);

  assert.equal(result.ops.length, 3); // keep produces no op
  assert.deepEqual(result.ops[0], { type: 'due', boardId: 'b1', columnId: 'col1', cardId: 'a', due: '2026-08-16' });
  assert.deepEqual(result.ops[1], { type: 'due', boardId: 'b1', columnId: 'col1', cardId: 'b', due: '' });
  assert.deepEqual(result.ops[2], { type: 'archive', boardId: 'b1', columnId: 'col1', cardId: 'c' });

  const statuses = {};
  result.plan.commitments.forEach((c) => { statuses[c.cardId] = c.status; });
  assert.deepEqual(statuses, { a: 'pushed', b: 'dropped', c: 'archived', d: 'kept' });
  assert.equal(result.plan.rolledAt, NOW);
});

test('unactioned rows default to keep (no data loss on a partial roll)', () => {
  const plan = planWith(['a', 'b']);
  const cards = [card({ cardId: 'a', due: '2026-08-15' }), card({ cardId: 'b', due: '2026-08-15' })];
  const result = DayPlan.rollPlan(plan, [{ cardId: 'a', kind: 'drop' }], cards, NOW);
  assert.deepEqual(result.ops, [{ type: 'due', boardId: 'b1', columnId: 'col1', cardId: 'a', due: '' }]);
  assert.equal(result.plan.commitments[1].status, 'kept');
});

test('push rolls over month and year boundaries', () => {
  const plan = planWith(['a']);
  const result = DayPlan.rollPlan(plan, [{ cardId: 'a', kind: 'push' }],
    [card({ cardId: 'a', due: '2026-08-31' })], NOW);
  assert.equal(result.ops[0].due, '2026-09-01');
  const yearEnd = DayPlan.rollPlan(planWith(['a']), [{ cardId: 'a', kind: 'push' }],
    [card({ cardId: 'a', due: '2026-12-31' })], NOW);
  assert.equal(yearEnd.ops[0].due, '2027-01-01');
});

test('push on a card without a due date lands on tomorrow', () => {
  const plan = planWith(['a']);
  const result = DayPlan.rollPlan(plan, [{ cardId: 'a', kind: 'push' }],
    [card({ cardId: 'a', due: '' })], NOW);
  assert.equal(result.ops[0].due, '2026-08-13');
});

test('already-finished commitments are never rolled', () => {
  const plan = {
    dateISO: DAY, stampedAt: NOW, rolledAt: null,
    commitments: [{ cardId: 'a', order: 0, status: 'done' }]
  };
  const result = DayPlan.rollPlan(plan, [{ cardId: 'a', kind: 'archive' }],
    [card({ cardId: 'a', due: '2026-08-15' })], NOW);
  assert.deepEqual(result.ops, []);
  assert.equal(result.plan.commitments[0].status, 'done');
});

test('cards completed outside the sheet exit the roll as done', () => {
  const plan = planWith(['a']);
  const result = DayPlan.rollPlan(plan, [{ cardId: 'a', kind: 'push' }],
    [card({ cardId: 'a', due: '2026-08-15', completedAt: 5 })], NOW);
  assert.deepEqual(result.ops, []);
  assert.equal(result.plan.commitments[0].status, 'done');
});

// ---- Accessors and migration ----------------------------------------------

test('sheetFor and latestPriorPlan round-trip', () => {
  const dayplans = { '2026-08-11': planWith(['x'], '2026-08-11') };
  assert.equal(DayPlan.sheetFor(dayplans, '2026-08-11').commitments.length, 1);
  assert.equal(DayPlan.sheetFor(dayplans, '2026-08-10'), null);
  const prior = DayPlan.latestPriorPlan(dayplans, '2026-08-12');
  assert.equal(prior.dateISO, '2026-08-11');
  assert.equal(DayPlan.latestPriorPlan(dayplans, '2026-08-11'), null); // strictly prior
});

test('v3 state without dayplans normalizes to an empty map', () => {
  const v3 = {
    version: 3, theme: 'dark', activeBoardId: 'b1', inbox: { items: [] },
    lenses: [], recurrences: [], boards: [
      { id: 'b1', name: 'B', labels: [], templates: [], columns: [
        { id: 'c1', title: 'T', role: 'queue', wipLimit: 0, collapsed: false, cards: [] }
      ], archive: { cards: [], columns: [] } }
    ]
  };
  const normalized = Migration.normalizeState(v3, { uid: () => 'x', now: () => 1 });
  assert.deepEqual(normalized.dayplans, {});
});

test('malformed dayplans entries are sanitized, valid ones preserved', () => {
  const v3 = {
    version: 3, theme: 'dark', activeBoardId: 'b1', inbox: { items: [] },
    lenses: [], recurrences: [],
    dayplans: {
      '2026-08-11': { dateISO: '2026-08-11', stampedAt: 1, rolledAt: null,
        commitments: [{ cardId: 'a', order: 0, status: 'kept' }] },
      'not-a-date': { dateISO: 'nope', commitments: [] },
      '2026-08-12': { commitments: [{ cardId: 'b', order: 0, status: 'bogus' }] }
    },
    boards: [
      { id: 'b1', name: 'B', labels: [], templates: [], columns: [
        { id: 'c1', title: 'T', role: 'queue', wipLimit: 0, collapsed: false, cards: [] }
      ], archive: { cards: [], columns: [] } }
    ]
  };
  const normalized = Migration.normalizeState(v3, { uid: () => 'x', now: () => 1 });
  const sheets = normalized.dayplans;
  assert.ok(sheets['2026-08-11']);
  assert.equal(sheets['2026-08-11'].commitments[0].status, 'kept');
  assert.ok(!sheets['not-a-date']);
  assert.ok(!sheets['2026-08-12']); // invalid plan shape dropped
});
