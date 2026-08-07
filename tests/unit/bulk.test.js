const { test } = require('node:test');
const assert = require('node:assert/strict');
const Bulk = require('../../js/core/bulk.js');

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

function state() {
  return {
    boards: [
      {
        id: 'board-1',
        name: 'One',
        flowSettings: {},
        labels: [{ id: 'l-1', name: 'Bug', color: '#c81e14' }],
        templates: [],
        columns: [
          { id: 'col-a', title: 'To Do', role: 'queue', isDone: false, wipLimit: 0, policy: {}, cards: [
            card('c1', 'col-a', { priority: 'medium' }),
            card('c2', 'col-a', { priority: 'low' }),
            card('c3', 'col-a', { priority: 'high' })
          ] },
          { id: 'col-b', title: 'In Progress', role: 'active', isDone: false, wipLimit: 0, policy: {}, cards: [
            card('c4', 'col-b', { priority: 'high' })
          ] },
          { id: 'col-d', title: 'Done', role: 'done', isDone: true, wipLimit: 0, policy: {}, cards: [] }
        ],
        archive: { cards: [], columns: [] }
      }
    ]
  };
}

const deps = { uid: () => 'id', now: () => 5000 };
const ref = (boardId, cardId) => ({ boardId, cardId });

test('bulkMove moves multiple cards preserving relative order', () => {
  const result = Bulk.bulkMove(state(), [ref('board-1', 'c1'), ref('board-1', 'c3'), ref('board-1', 'c2')], { boardId: 'board-1', columnId: 'col-b' }, deps);
  assert.equal(result.changed, true);
  const target = result.state.boards[0].columns[1];
  assert.deepEqual(target.cards.map(c => c.id), ['c4', 'c1', 'c3', 'c2']);
  assert.deepEqual(result.state.boards[0].columns[0].cards.map(c => c.id), []);
});

test('bulkMove applies lifecycle transitions', () => {
  const result = Bulk.bulkMove(state(), [ref('board-1', 'c1')], { boardId: 'board-1', columnId: 'col-d' }, deps);
  const moved = result.state.boards[0].columns[2].cards[0];
  assert.equal(moved.completedAt, 5000);
  assert.equal(moved.transitions.length, 1);
});

test('bulkMove reports policy violations without moving anything', () => {
  const s = state();
  s.boards[0].columns[1].wipLimit = 1;
  s.boards[0].columns[1].policy = { wipMode: 'hard' };
  const result = Bulk.bulkMove(s, [ref('board-1', 'c1'), ref('board-1', 'c2')], { boardId: 'board-1', columnId: 'col-b' }, deps);
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'policy-violations');
  assert.ok(result.violations.length >= 1);
  assert.deepEqual(s.boards[0].columns[0].cards.map(c => c.id), ['c1', 'c2', 'c3']);
});

test('bulkMove with a missing card reports the violation', () => {
  const result = Bulk.bulkMove(state(), [ref('board-1', 'c1'), ref('board-1', 'ghost')], { boardId: 'board-1', columnId: 'col-b' }, deps);
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'policy-violations');
});

test('bulkMove never mutates the input state', () => {
  const s = state();
  const before = JSON.stringify(s);
  Bulk.bulkMove(s, [ref('board-1', 'c1')], { boardId: 'board-1', columnId: 'col-b' }, deps);
  Bulk.bulkArchive(s, [ref('board-1', 'c1')], deps);
  Bulk.bulkUpdate(s, [ref('board-1', 'c1')], { priority: 'urgent' }, deps);
  assert.equal(JSON.stringify(s), before);
});

test('bulkUpdate patches all selected cards', () => {
  const result = Bulk.bulkUpdate(state(), [ref('board-1', 'c1'), ref('board-1', 'c2')], { priority: 'urgent', assignee: 'Sam' }, deps);
  assert.equal(result.changed, true);
  const cards = result.state.boards[0].columns[0].cards;
  assert.ok(cards.slice(0, 2).every(c => c.priority === 'urgent' && c.assignee === 'Sam'));
  assert.equal(cards[2].priority, 'high');
});

test('bulkUpdate with an identical patch is a no-op', () => {
  const s = state();
  s.boards[0].columns[0].cards[0].priority = 'urgent';
  const result = Bulk.bulkUpdate(s, [ref('board-1', 'c1')], { priority: 'urgent' }, deps);
  assert.equal(result.changed, false);
});

test('bulkArchive archives every selected card', () => {
  const result = Bulk.bulkArchive(state(), [ref('board-1', 'c1'), ref('board-1', 'c3')], deps);
  assert.equal(result.changed, true);
  assert.equal(result.value, 2);
  assert.deepEqual(result.state.boards[0].columns[0].cards.map(c => c.id), ['c2']);
  assert.equal(result.state.boards[0].archive.cards.length, 2);
});

test('bulkArchive preserves the origin column name', () => {
  const result = Bulk.bulkArchive(state(), [ref('board-1', 'c1')], deps);
  assert.equal(result.state.boards[0].archive.cards[0].fromColumn, 'To Do');
});

test('bulk operations produce one immutable result', () => {
  const result = Bulk.bulkMove(state(), [ref('board-1', 'c1'), ref('board-1', 'c2')], { boardId: 'board-1', columnId: 'col-b' }, deps);
  assert.notEqual(result.state, state());
  assert.equal(result.state.boards[0].columns[1].cards.length, 3);
});

test('bulkMove across boards preserves order within the selection', () => {
  const s = state();
  s.boards.push({
    id: 'board-2',
    name: 'Two',
    flowSettings: {},
    labels: [],
    templates: [],
    columns: [
      { id: 'col-x', title: 'To Do', role: 'queue', isDone: false, wipLimit: 0, policy: {}, cards: [
        card('x1', 'col-x')
      ] }
    ],
    archive: { cards: [], columns: [] }
  });
  const result = Bulk.bulkMove(s, [ref('board-2', 'x1'), ref('board-1', 'c1')], { boardId: 'board-1', columnId: 'col-b' }, deps);
  assert.equal(result.changed, true);
  assert.deepEqual(result.state.boards[0].columns[1].cards.map(c => c.id), ['c4', 'x1', 'c1']);
});

test('bulkMove with no cards is a clean no-op', () => {
  const result = Bulk.bulkMove(state(), [], { boardId: 'board-1', columnId: 'col-b' }, deps);
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'no-cards');
});

test('same-column bulk reorder does not append a transition', () => {
  const result = Bulk.bulkMove(state(), [ref('board-1', 'c1'), ref('board-1', 'c3')], { boardId: 'board-1', columnId: 'col-a' }, deps);
  assert.equal(result.changed, true);
  const cardA = result.state.boards[0].columns[0].cards.find(c => c.id === 'c1');
  assert.equal(cardA.transitions.length, 0);
});

test('cross-board bulk move applies per-card label mappings', () => {
  const s = state();
  s.boards.push({
    id: 'board-2',
    name: 'Two',
    flowSettings: {},
    labels: [{ id: 'l-2', name: 'Bug', color: '#c81e14' }],
    templates: [],
    columns: [
      { id: 'col-x', title: 'To Do', role: 'queue', isDone: false, wipLimit: 0, policy: {}, cards: [] }
    ],
    archive: { cards: [], columns: [] }
  });
  s.boards[0].columns[0].cards[0].labels = ['l-1'];
  const result = Bulk.bulkMove(s, [ref('board-1', 'c1')], { boardId: 'board-2', columnId: 'col-x' }, deps, {
    labelMappings: { 'board-1:c1': ['l-2'] }
  });
  assert.equal(result.changed, true);
  assert.deepEqual(result.state.boards[1].columns[0].cards[0].labels, ['l-2']);
});

test('bulkSetLabels applies per-card labels in one result', () => {
  const result = Bulk.bulkSetLabels(state(), [
    { ref: ref('board-1', 'c1'), labels: ['l-1', 'l-2'] },
    { ref: ref('board-1', 'c2'), labels: ['l-2'] }
  ], deps);
  assert.equal(result.changed, true);
  assert.equal(result.state.boards[0].columns[0].cards[0].labels.length, 2);
  assert.equal(result.state.boards[0].columns[0].cards[1].labels.length, 1);
});

test('bulkSetLabels with identical labels is a clean no-op', () => {
  const s = state();
  s.boards[0].columns[0].cards[0].labels = ['l-1'];
  const result = Bulk.bulkSetLabels(s, [{ ref: ref('board-1', 'c1'), labels: ['l-1'] }], deps);
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'no-change');
});

test('bulkSetFlow applies flow states to every selected card in one result', () => {
  const result = Bulk.bulkSetFlow(state(), [
    { ref: ref('board-1', 'c1'), flow: 'blocked', reason: 'API down' },
    { ref: ref('board-1', 'c2'), flow: 'waiting', reason: 'Other team' }
  ], deps);
  assert.equal(result.changed, true);
  const c1 = result.state.boards[0].columns[0].cards[0];
  const c2 = result.state.boards[0].columns[0].cards[1];
  assert.equal(c1.flow.state, 'blocked');
  assert.equal(c1.flow.reason, 'API down');
  assert.equal(c2.flow.state, 'waiting');
  assert.equal(c2.flow.reason, 'Other team');
});

test('bulkSetFlow with no changes is a clean no-op', () => {
  const s = state();
  s.boards[0].columns[0].cards[0].flow = { state: 'blocked', reason: 'same', since: 100, periods: [] };
  const result = Bulk.bulkSetFlow(s, [{ ref: ref('board-1', 'c1'), flow: 'blocked', reason: 'same' }], deps);
  assert.equal(result.changed, false);
});

test('soft WIP bulk move warns without blocking, then proceeds when confirmed', () => {
  const s = state();
  s.boards[0].columns[1].wipLimit = 1;
  s.boards[0].columns[1].policy = { wipMode: 'soft' };
  s.boards[0].columns[1].cards = [card('c4', 'col-b')];
  const warned = Bulk.bulkMove(s, [ref('board-1', 'c1'), ref('board-1', 'c2')], { boardId: 'board-1', columnId: 'col-b' }, deps);
  assert.equal(warned.changed, false);
  assert.equal(warned.reason, 'policy-violations');
  assert.equal(warned.blocking, false);
  const confirmed = Bulk.bulkMove(s, [ref('board-1', 'c1'), ref('board-1', 'c2')], { boardId: 'board-1', columnId: 'col-b' }, deps, { confirmed: true });
  assert.equal(confirmed.changed, true);
  assert.equal(confirmed.state.boards[0].columns[1].cards.length, 3);
});

test('bulk move into a done column schedules the next after-completion occurrence', () => {
  const s = state();
  s.recurrences = [{
    id: 'rec-1',
    enabled: true,
    mode: 'after-completion',
    schedule: { frequency: 'custom', interval: 1, delayAfterCompletionDays: 1 },
    target: { boardId: 'board-1', columnId: 'col-a' },
    template: { title: 'Recurring', priority: 'none', size: 'none', checklist: [] },
    dueOffsetDays: null,
    overlapPolicy: 'single-active',
    missedPolicy: 'create-one',
    activeCardRef: { boardId: 'board-1', cardId: 'c1' },
    nextRunAt: null,
    lastRunAt: null,
    lastCompletedAt: null,
    endAt: null,
    remainingOccurrences: null,
    pausedReason: ''
  }];
  s.boards[0].columns[0].cards[0].recurrenceId = 'rec-1';
  const result = Bulk.bulkMove(s, [ref('board-1', 'c1')], { boardId: 'board-1', columnId: 'col-d' }, deps);
  assert.equal(result.changed, true);
  const moved = result.state.boards[0].columns[2].cards[0];
  assert.equal(moved.completedAt, 5000);
  const rec = result.state.recurrences.find(r => r.id === 'rec-1');
  assert.equal(rec.activeCardRef, null);
  assert.ok(rec.nextRunAt !== null);
});
