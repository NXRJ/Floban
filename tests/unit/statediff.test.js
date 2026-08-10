const { test } = require('node:test');
const assert = require('node:assert/strict');
const StateDiff = require('../../js/core/statediff.js');
const Migration = require('../../js/core/migration.js');

const NOW = new Date(2026, 7, 12, 10, 0).getTime();

function uid(prefix) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}
const deps = () => ({ uid: uid('x'), now: () => NOW });

function card(id, overrides) {
  return Object.assign({
    id,
    title: 'Card ' + id,
    description: '',
    due: '',
    when: '',
    priority: 'none',
    size: 'none',
    assignee: '',
    labels: [],
    checklist: [],
    startedAt: null,
    completedAt: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    movedAt: NOW,
    fromColumn: '',
    flow: { state: 'normal', reason: '', since: null, periods: [] },
    dependencies: { blockers: [], related: [] },
    recurrenceId: null,
    effort: { pomodoros: 0, minutes: 0 },
    ping: null,
    transitions: []
  }, overrides || {});
}

function baseState() {
  return Migration.normalizeState({
    version: 3,
    theme: 'dark',
    activeBoardId: 'b1',
    boards: [{
      id: 'b1',
      name: 'Work',
      labels: [{ id: 'l1', name: 'Bug', color: '#c81e14' }],
      columns: [
        { id: 'c1', title: 'To Do', role: 'queue', cards: [card('k1'), card('k2')] },
        { id: 'c2', title: 'Doing', role: 'active', cards: [card('k3')] },
        { id: 'c3', title: 'Done', role: 'done', isDone: true, cards: [] }
      ],
      archive: { cards: [], columns: [] }
    }]
  }, deps());
}

// Deep clone so a mutation helper cannot alias the "before" snapshot.
const clone = (s) => JSON.parse(JSON.stringify(s));

// The core contract: replaying a diff reproduces the target state exactly.
function assertRoundTrip(prev, next, message) {
  const ops = StateDiff.diff(prev, next);
  const replayed = StateDiff.apply(prev, ops);
  assert.deepEqual(replayed, next, message);
  return ops;
}

// ---- round-trip over representative mutations ------------------------------

test('no change produces no ops', () => {
  const state = baseState();
  assert.deepEqual(StateDiff.diff(state, clone(state)), []);
});

test('editing one card field emits exactly one set op', () => {
  const prev = baseState();
  const next = clone(prev);
  next.boards[0].columns[0].cards[0].title = 'Renamed';
  const ops = assertRoundTrip(prev, next, 'title edit round-trips');
  assert.equal(ops.length, 1);
  assert.equal(ops[0].type, 'card.set');
  assert.equal(ops[0].field, 'title');
  assert.equal(ops[0].cardId, 'k1');
});

test('two peers editing different fields of one card produce disjoint ops', () => {
  // This is the whole reason the diff exists: a snapshot-level sync would make
  // these two edits overwrite each other.
  const base = baseState();
  const a = clone(base);
  a.boards[0].columns[0].cards[0].title = 'From A';
  const b = clone(base);
  b.boards[0].columns[0].cards[0].priority = 'high';

  const opsA = StateDiff.diff(base, a);
  const opsB = StateDiff.diff(base, b);
  assert.deepEqual(opsA.map(o => o.field), ['title']);
  assert.deepEqual(opsB.map(o => o.field), ['priority']);

  // Applied in either order, both edits survive.
  const merged1 = StateDiff.apply(StateDiff.apply(base, opsA), opsB);
  const merged2 = StateDiff.apply(StateDiff.apply(base, opsB), opsA);
  assert.deepEqual(merged1, merged2);
  assert.equal(merged1.boards[0].columns[0].cards[0].title, 'From A');
  assert.equal(merged1.boards[0].columns[0].cards[0].priority, 'high');
});

test('moving a card across columns round-trips without duplication', () => {
  const prev = baseState();
  const next = clone(prev);
  const moved = next.boards[0].columns[0].cards.splice(0, 1)[0];
  next.boards[0].columns[1].cards.push(moved);
  const ops = assertRoundTrip(prev, next, 'cross-column move round-trips');
  assert.ok(ops.some(o => o.type === 'card.move'));
  const replayed = StateDiff.apply(prev, ops);
  const ids = replayed.boards[0].columns.flatMap(c => c.cards.map(k => k.id));
  assert.equal(ids.filter(id => id === 'k1').length, 1);
});

test('reordering within a column round-trips', () => {
  const prev = baseState();
  const next = clone(prev);
  next.boards[0].columns[0].cards.reverse();
  assertRoundTrip(prev, next, 'reorder round-trips');
});

test('adding and removing cards round-trips', () => {
  const prev = baseState();
  const next = clone(prev);
  next.boards[0].columns[0].cards.push(card('k9', { title: 'New' }));
  next.boards[0].columns[1].cards = [];
  assertRoundTrip(prev, next, 'add + remove round-trips');
});

test('adding a column and a board round-trips', () => {
  const prev = baseState();
  const next = clone(prev);
  next.boards[0].columns.push({ id: 'c9', title: 'Review', role: 'queue', cards: [] });
  next.boards.push({
    id: 'b2', name: 'Personal', labels: [], columns: [], archive: { cards: [], columns: [] }
  });
  assertRoundTrip(prev, next, 'structural additions round-trip');
});

test('removing a column takes its cards with it', () => {
  const prev = baseState();
  const next = clone(prev);
  next.boards[0].columns = next.boards[0].columns.filter(c => c.id !== 'c1');
  const ops = assertRoundTrip(prev, next, 'column removal round-trips');
  assert.ok(ops.some(o => o.type === 'column.remove'));
  // Its cards are removed explicitly, never orphaned into another column.
  assert.equal(ops.filter(o => o.type === 'card.remove').length, 2);
});

test('reordering columns and boards round-trips', () => {
  const prev = clone(baseState());
  prev.boards.push({ id: 'b2', name: 'Second', labels: [], columns: [], archive: { cards: [], columns: [] } });
  const next = clone(prev);
  next.boards[0].columns.reverse();
  next.boards.reverse();
  const ops = assertRoundTrip(prev, next, 'reordering round-trips');
  assert.ok(ops.some(o => o.type === 'column.order'));
  assert.ok(ops.some(o => o.type === 'board.order'));
});

test('personal slices are replaced wholesale', () => {
  const prev = baseState();
  const next = clone(prev);
  next.theme = 'light';
  next.dayplans = {
    '2026-08-12': { dateISO: '2026-08-12', stampedAt: NOW, rolledAt: null, commitments: [] }
  };
  const ops = assertRoundTrip(prev, next, 'coarse slices round-trip');
  const keys = ops.filter(o => o.type === 'state.set').map(o => o.key).sort();
  assert.deepEqual(keys, ['dayplans', 'theme']);
});

test('a compound change round-trips', () => {
  const prev = baseState();
  const next = clone(prev);
  next.boards[0].name = 'Renamed board';
  next.boards[0].columns[0].title = 'Backlog';
  next.boards[0].columns[0].cards[1].due = '2026-08-20';
  next.boards[0].columns[2].cards.push(card('k7', { completedAt: NOW }));
  const moved = next.boards[0].columns[0].cards.splice(0, 1)[0];
  next.boards[0].columns[1].cards.unshift(moved);
  assertRoundTrip(prev, next, 'compound change round-trips');
});

// ---- purity ----------------------------------------------------------------

test('diff and apply never mutate their inputs', () => {
  const prev = baseState();
  const next = clone(prev);
  next.boards[0].columns[0].cards[0].title = 'Changed';
  const prevSnapshot = JSON.stringify(prev);
  const nextSnapshot = JSON.stringify(next);
  const ops = StateDiff.diff(prev, next);
  StateDiff.apply(prev, ops);
  assert.equal(JSON.stringify(prev), prevSnapshot);
  assert.equal(JSON.stringify(next), nextSnapshot);
});

test('diff is deterministic', () => {
  const prev = baseState();
  const next = clone(prev);
  next.boards[0].columns[0].cards[0].title = 'Changed';
  next.boards[0].columns[1].cards.push(card('k8'));
  assert.deepEqual(StateDiff.diff(prev, next), StateDiff.diff(prev, next));
});

// ---- resilience ------------------------------------------------------------

test('an unknown op from a newer peer is ignored, not fatal', () => {
  const state = baseState();
  const out = StateDiff.apply(state, [{ type: 'quantum.entangle', boardId: 'b1' }]);
  assert.deepEqual(out, state);
});

test('reorder keeps entities the peer never mentioned', () => {
  // An older peer sends an order list missing a column added since.
  const prev = baseState();
  const next = StateDiff.apply(prev, [{ type: 'column.order', boardId: 'b1', order: ['c3', 'c1'] }]);
  assert.deepEqual(next.boards[0].columns.map(c => c.id), ['c3', 'c1', 'c2']);
});

test('ops targeting a missing entity are dropped without throwing', () => {
  const state = baseState();
  const out = StateDiff.apply(state, [
    { type: 'card.set', boardId: 'nope', cardId: 'ghost', field: 'title', value: 'x' },
    { type: 'column.set', boardId: 'nope', columnId: 'ghost', field: 'title', value: 'x' },
    { type: 'card.add', boardId: 'nope', columnId: 'ghost', cardId: 'k5', index: 0, card: {} }
  ]);
  assert.deepEqual(out, state);
});

// ---- fuzz ------------------------------------------------------------------

// Hand-written cases only cover mutations I thought of. The round-trip is a
// property, so assert it over randomly generated edit sequences with a seeded
// PRNG (deterministic: a failure reproduces from the printed seed).
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function mutate(state, rand, counter) {
  const next = clone(state);
  const board = next.boards[Math.floor(rand() * next.boards.length)];
  if (!board || board.columns.length === 0) return next;
  const col = board.columns[Math.floor(rand() * board.columns.length)];
  const roll = rand();

  if (roll < 0.25) {
    col.cards.push(card('gen-' + counter, { title: 'Generated ' + counter }));
  } else if (roll < 0.45 && col.cards.length > 0) {
    col.cards.splice(Math.floor(rand() * col.cards.length), 1);
  } else if (roll < 0.65 && col.cards.length > 0) {
    const target = col.cards[Math.floor(rand() * col.cards.length)];
    target.title = 'Edited ' + counter;
    if (rand() > 0.5) target.priority = ['none', 'low', 'medium', 'high', 'urgent'][Math.floor(rand() * 5)];
    if (rand() > 0.7) target.due = '2026-09-' + String(1 + Math.floor(rand() * 28)).padStart(2, '0');
  } else if (roll < 0.85 && col.cards.length > 0) {
    const dest = board.columns[Math.floor(rand() * board.columns.length)];
    const moved = col.cards.splice(Math.floor(rand() * col.cards.length), 1)[0];
    dest.cards.splice(Math.floor(rand() * (dest.cards.length + 1)), 0, moved);
  } else if (roll < 0.93) {
    col.title = 'Column ' + counter;
  } else {
    board.columns.reverse();
  }
  return next;
}

test('round-trip holds over randomized edit sequences', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rand = rng(seed);
    let prev = baseState();
    for (let step = 0; step < 12; step++) {
      const next = mutate(prev, rand, seed * 100 + step);
      const replayed = StateDiff.apply(prev, StateDiff.diff(prev, next));
      assert.deepEqual(replayed, next, `seed ${seed} step ${step}`);
      prev = next;
    }
  }
});

test('no generated diff ever duplicates or loses a card', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rand = rng(seed);
    let prev = baseState();
    for (let step = 0; step < 12; step++) {
      const next = mutate(prev, rand, seed * 100 + step);
      const replayed = StateDiff.apply(prev, StateDiff.diff(prev, next));
      const ids = replayed.boards.flatMap(b => b.columns.flatMap(c => c.cards.map(k => k.id)));
      assert.equal(new Set(ids).size, ids.length, `duplicate card at seed ${seed} step ${step}`);
      const expected = next.boards.flatMap(b => b.columns.flatMap(c => c.cards.map(k => k.id)));
      assert.deepEqual(ids.slice().sort(), expected.slice().sort(), `card set drift at seed ${seed} step ${step}`);
      prev = next;
    }
  }
});
