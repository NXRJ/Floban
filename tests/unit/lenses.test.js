const { test } = require('node:test');
const assert = require('node:assert/strict');
const Lenses = require('../../js/core/lenses.js');

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

function board(id, name, columns) {
  return {
    id: id,
    name: name,
    flowSettings: {},
    labels: [],
    templates: [],
    columns: columns,
    archive: { cards: [], columns: [] }
  };
}

function state() {
  return {
    version: 3,
    theme: 'dark',
    activeBoardId: 'b1',
    inbox: { items: [] },
    lenses: [],
    recurrences: [],
    boards: [
      board('b1', 'One', [
        { id: 'c1', title: 'Queue', role: 'queue', isDone: false, cards: [
          card('a', 'c1', { priority: 'high', due: '2026-08-10', assignee: 'Sam' }),
          card('b', 'c1', { flow: { state: 'blocked', reason: 'x', since: 100, periods: [] } }),
          card('c', 'c1', { dependencies: { blockers: [{ boardId: 'b1', cardId: 'done1' }], related: [] } })
        ] },
        { id: 'c2', title: 'Done', role: 'done', isDone: true, cards: [
          card('done1', 'c2', { completedAt: 200 })
        ] }
      ]),
      board('b2', 'Two', [
        { id: 'c3', title: 'Queue', role: 'queue', isDone: false, cards: [
          card('x', 'c3', { priority: 'urgent' })
        ] }
      ])
    ]
  };
}

function lens(overrides) {
  return Object.assign({
    id: 'lens-1',
    name: 'Lens',
    scope: 'all-boards',
    boardIds: [],
    query: { search: '', labelIds: [], assignees: [], due: 'any', priorities: [], sizes: [], flowStates: [], blockedOnly: false, readyOnly: false, columnRoles: [], includeCompleted: true },
    sort: { field: 'manual', direction: 'asc' },
    display: { density: 'comfortable', groupBy: 'board' }
  }, overrides || {});
}

const NOW = Date.parse('2026-08-07T12:00:00Z');

test('active-board scope only scans the active board', () => {
  const result = Lenses.applyLens(state(), lens({ scope: 'active-board' }), NOW);
  assert.ok(result.every(r => r.boardId === 'b1'));
});

test('all-board scope scans every board', () => {
  const result = Lenses.applyLens(state(), lens({ scope: 'all-boards' }), NOW);
  assert.ok(result.some(r => r.boardId === 'b2'));
  assert.ok(result.some(r => r.boardId === 'b1'));
});

test('selected-boards scope honors the board list', () => {
  const result = Lenses.applyLens(state(), lens({ scope: 'selected-boards', boardIds: ['b2'] }), NOW);
  assert.ok(result.every(r => r.boardId === 'b2'));
});

test('includeCompleted false hides done columns', () => {
  const result = Lenses.applyLens(state(), lens({ query: { includeCompleted: false } }), NOW);
  assert.ok(result.every(r => r.columnRole !== 'done'));
});

test('results are references, not clones', () => {
  const s = state();
  const result = Lenses.applyLens(s, lens(), NOW);
  const ref = result[0];
  const board = s.boards.find(b => b.id === ref.boardId);
  const column = board.columns.find(c => c.id === ref.columnId);
  const source = column.cards.find(c => c.id === ref.cardId);
  assert.equal(ref.card, source);
});

test('priority filter narrows results', () => {
  const result = Lenses.applyLens(state(), lens({ query: { priorities: ['high'] } }), NOW);
  assert.deepEqual(result.map(r => r.cardId), ['a']);
});

test('flow state filter narrows results', () => {
  const result = Lenses.applyLens(state(), lens({ query: { flowStates: ['blocked'] } }), NOW);
  assert.deepEqual(result.map(r => r.cardId), ['b']);
});

test('readyOnly matches cards whose blockers are all resolved', () => {
  const s = state();
  s.boards[0].columns[0].cards[1].dependencies.blockers = [{ boardId: 'b1', cardId: 'done1' }, { boardId: 'b1', cardId: 'a' }];
  const result = Lenses.applyLens(s, lens({ query: { readyOnly: true, includeCompleted: false } }), NOW);
  assert.ok(result.some(r => r.cardId === 'c'));
  assert.ok(result.every(r => r.cardId !== 'b'));
});

test('blockedOnly matches cards with unresolved blockers', () => {
  const blockedState = state();
  blockedState.boards[0].columns[0].cards[0].dependencies.blockers = [{ boardId: 'b1', cardId: 'done1' }];
  blockedState.boards[0].columns[0].cards[0].dependencies.blockers.push({ boardId: 'b1', cardId: 'b' });
  const result = Lenses.applyLens(blockedState, lens({ query: { blockedOnly: true, includeCompleted: false } }), NOW);
  assert.ok(result.some(r => r.cardId === 'a'));
});

test('due filters reuse the core date logic', () => {
  const result = Lenses.applyLens(state(), lens({ query: { due: 'week', includeCompleted: false } }), NOW);
  assert.deepEqual(result.map(r => r.cardId), ['a']);
  const overdue = Lenses.applyLens(state(), lens({ query: { due: 'overdue', includeCompleted: false } }), NOW);
  assert.equal(overdue.length, 0);
});

test('sort by priority desc places urgent first', () => {
  const result = Lenses.applyLens(state(), lens({ sort: { field: 'priority', direction: 'desc' } }), NOW);
  assert.equal(result[0].cardId, 'x');
});

test('sort by due asc places the earliest due first', () => {
  const result = Lenses.applyLens(state(), lens({ sort: { field: 'due', direction: 'asc' } }), NOW);
  const withDue = result.filter(r => r.card.due);
  assert.ok(withDue.length >= 1);
  assert.equal(withDue[0].cardId, 'a');
});

test('sort by blocked-duration places the longest blocked first', () => {
  const result = Lenses.applyLens(state(), lens({ sort: { field: 'blocked-duration', direction: 'desc' } }), NOW);
  assert.equal(result[0].cardId, 'b');
});

test('grouping by board produces one group per board', () => {
  const groups = Lenses.applyLensGrouped(state(), lens({ display: { groupBy: 'board' } }), NOW);
  assert.equal(groups.length, 2);
  assert.ok(groups.some(g => g.items.some(i => i.boardId === 'b1')));
  assert.ok(groups.some(g => g.items.some(i => i.boardId === 'b2')));
});

test('grouping by priority orders urgent first', () => {
  const groups = Lenses.applyLensGrouped(state(), lens({ display: { groupBy: 'priority' } }), NOW);
  assert.equal(groups[0].key, 'urgent');
});

test('built-in lenses are code-defined and complete', () => {
  const builtins = Lenses.builtInLenses();
  const names = builtins.map(b => b.name);
  ['Ready to Pull', 'Blocked', 'Waiting on Others', 'Aging', 'Due Soon', 'Overdue', 'No Due Date', 'Recently Completed', 'Needs Triage'].forEach(n => {
    assert.ok(names.includes(n), 'missing ' + n);
  });
  assert.ok(builtins.every(b => Lenses.isBuiltIn(b)));
  assert.equal(Lenses.isBuiltIn({ id: 'user-lens' }), false);
});

test('needs-triage built-in matches all open work', () => {
  const builtins = Lenses.builtInLenses();
  const triage = builtins.find(b => b.name === 'Needs Triage');
  const result = Lenses.applyLens(state(), triage, NOW);
  assert.equal(result.length, 4);
});

test('broken board references are ignored', () => {
  const s = state();
  const result = Lenses.applyLens(s, lens({ scope: 'selected-boards', boardIds: ['b1', 'ghost'] }), NOW);
  assert.ok(Array.isArray(result));
});

test('normalizeLens repairs malformed definitions', () => {
  const deps = { uid: () => 'id-1', now: () => 500 };
  const result = Lenses.normalizeLens({ scope: 'warp', query: { due: 'banana' }, sort: { field: 'nope' } }, deps);
  assert.equal(result.scope, 'active-board');
  assert.equal(result.query.due, 'any');
  assert.equal(result.sort.field, 'manual');
});
