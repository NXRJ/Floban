const { test } = require('node:test');
const assert = require('node:assert/strict');
const Relations = require('../../js/core/relations.js');

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

function state(overrides) {
  return Object.assign({
    version: 3,
    theme: 'dark',
    activeBoardId: 'board-1',
    inbox: { items: [] },
    lenses: [],
    recurrences: [],
    boards: [
      {
        id: 'board-1',
        name: 'One',
        flowSettings: {},
        labels: [],
        templates: [],
        columns: [
          { id: 'col-a', title: 'Queue', role: 'queue', isDone: false, cards: [
            card('c1', 'col-a'),
            card('c2', 'col-a'),
            card('c3', 'col-a')
          ] },
          { id: 'col-d', title: 'Done', role: 'done', isDone: true, cards: [
            card('done1', 'col-d')
          ] }
        ],
        archive: { cards: [], columns: [] }
      },
      {
        id: 'board-2',
        name: 'Two',
        flowSettings: {},
        labels: [],
        templates: [],
        columns: [
          { id: 'col-b', title: 'Queue', role: 'queue', isDone: false, cards: [
            card('x1', 'col-b')
          ] }
        ],
        archive: { cards: [], columns: [] }
      }
    ]
  }, overrides || {});
}

const ref = (boardId, cardId) => ({ boardId, cardId });

test('addBlocker links a blocker', () => {
  const result = Relations.addBlocker(state(), ref('board-1', 'c1'), ref('board-1', 'c2'));
  assert.equal(result.changed, true);
  assert.deepEqual(result.state.boards[0].columns[0].cards[0].dependencies.blockers, [{ boardId: 'board-1', cardId: 'c2' }]);
});

test('addBlocker rejects self references', () => {
  const result = Relations.addBlocker(state(), ref('board-1', 'c1'), ref('board-1', 'c1'));
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'self-reference');
});

test('addBlocker rejects duplicates', () => {
  const s = state();
  const once = Relations.addBlocker(s, ref('board-1', 'c1'), ref('board-1', 'c2'));
  const twice = Relations.addBlocker(once.state, ref('board-1', 'c1'), ref('board-1', 'c2'));
  assert.equal(twice.changed, false);
  assert.equal(twice.reason, 'duplicate');
});

test('addBlocker rejects missing cards', () => {
  const result = Relations.addBlocker(state(), ref('board-1', 'ghost'), ref('board-1', 'c2'));
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'card-not-found');
});

test('addBlocker rejects direct cycles', () => {
  const s = state();
  const a = Relations.addBlocker(s, ref('board-1', 'c1'), ref('board-1', 'c2'));
  const b = Relations.addBlocker(a.state, ref('board-1', 'c2'), ref('board-1', 'c1'));
  assert.equal(b.changed, false);
  assert.equal(b.reason, 'dependency-cycle');
});

test('addBlocker rejects transitive cycles', () => {
  const s = state();
  const a = Relations.addBlocker(s, ref('board-1', 'c1'), ref('board-1', 'c2'));
  const b = Relations.addBlocker(a.state, ref('board-1', 'c2'), ref('board-1', 'c3'));
  const c = Relations.addBlocker(b.state, ref('board-1', 'c3'), ref('board-1', 'c1'));
  assert.equal(c.changed, false);
  assert.equal(c.reason, 'dependency-cycle');
});

test('addBlocker supports cross-board blockers', () => {
  const result = Relations.addBlocker(state(), ref('board-1', 'c1'), ref('board-2', 'x1'));
  assert.equal(result.changed, true);
  assert.deepEqual(result.state.boards[0].columns[0].cards[0].dependencies.blockers, [{ boardId: 'board-2', cardId: 'x1' }]);
});

test('wouldCreateCycle detects direct and transitive cycles', () => {
  const s = state();
  const a = Relations.addBlocker(s, ref('board-1', 'c1'), ref('board-1', 'c2'));
  const b = Relations.addBlocker(a.state, ref('board-1', 'c2'), ref('board-1', 'c3'));
  assert.equal(Relations.wouldCreateCycle(b.state, ref('board-1', 'c3'), ref('board-1', 'c1')), true);
  assert.equal(Relations.wouldCreateCycle(b.state, ref('board-1', 'c1'), ref('board-1', 'c3')), false);
});

test('removeBlocker removes the link', () => {
  const s = state();
  const a = Relations.addBlocker(s, ref('board-1', 'c1'), ref('board-1', 'c2'));
  const b = Relations.removeBlocker(a.state, ref('board-1', 'c1'), ref('board-1', 'c2'));
  assert.equal(b.changed, true);
  assert.deepEqual(b.state.boards[0].columns[0].cards[0].dependencies.blockers, []);
});

test('removeBlocker on an unlinked pair is a no-op', () => {
  const result = Relations.removeBlocker(state(), ref('board-1', 'c1'), ref('board-1', 'c2'));
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'not-linked');
});

test('unresolved blockers exclude completed cards', () => {
  const s = state();
  const a = Relations.addBlocker(s, ref('board-1', 'c1'), ref('board-1', 'done1'));
  const unresolved = Relations.getUnresolvedBlockers(a.state, ref('board-1', 'c1'));
  assert.deepEqual(unresolved, []);
});

test('unresolved blockers include open cards across boards', () => {
  const s = state();
  const a = Relations.addBlocker(s, ref('board-1', 'c1'), ref('board-2', 'x1'));
  const unresolved = Relations.getUnresolvedBlockers(a.state, ref('board-1', 'c1'));
  assert.deepEqual(unresolved, [{ boardId: 'board-2', cardId: 'x1' }]);
});

test('blocker completion flips ready-to-pull', () => {
  const s = state();
  const a = Relations.addBlocker(s, ref('board-1', 'c1'), ref('board-1', 'c2'));
  assert.equal(Relations.isReadyToPull(a.state, ref('board-1', 'c1')), false);
  const moved = JSON.parse(JSON.stringify(a.state));
  moved.boards[0].columns[0].cards[0] = null;
  moved.boards[0].columns[0].cards = moved.boards[0].columns[0].cards.filter(Boolean);
  const doneColumn = moved.boards[0].columns[1];
  const blocker = moved.boards[0].columns[0].cards.find(c => c.id === 'c2');
  moved.boards[0].columns[0].cards = moved.boards[0].columns[0].cards.filter(c => c.id !== 'c2');
  blocker.columnId = doneColumn.id;
  doneColumn.cards.push(blocker);
  assert.equal(Relations.isReadyToPull(moved, ref('board-1', 'c1')), true);
});

test('reopening a blocker makes dependents blocked again', () => {
  const s = state();
  const a = Relations.addBlocker(s, ref('board-1', 'c1'), ref('board-1', 'c2'));
  assert.equal(Relations.isReadyToPull(a.state, ref('board-1', 'c1')), false);
});

test('getCardsBlockedBy performs a reverse lookup', () => {
  const s = state();
  const a = Relations.addBlocker(s, ref('board-1', 'c1'), ref('board-2', 'x1'));
  const a2 = Relations.addBlocker(a.state, ref('board-1', 'c3'), ref('board-2', 'x1'));
  const blocked = Relations.getCardsBlockedBy(a2.state, ref('board-2', 'x1'));
  assert.equal(blocked.length, 2);
  assert.ok(blocked.some(b => b.cardId === 'c1'));
  assert.ok(blocked.some(b => b.cardId === 'c3'));
  assert.ok(blocked.every(b => b.boardId === 'board-1'));
});

test('addRelated links both directions', () => {
  const result = Relations.addRelated(state(), ref('board-1', 'c1'), ref('board-2', 'x1'));
  assert.equal(result.changed, true);
  assert.deepEqual(result.state.boards[0].columns[0].cards[0].dependencies.related, [{ boardId: 'board-2', cardId: 'x1' }]);
  assert.deepEqual(result.state.boards[1].columns[0].cards[0].dependencies.related, [{ boardId: 'board-1', cardId: 'c1' }]);
});

test('addRelated rejects self references and duplicates', () => {
  const s = state();
  assert.equal(Relations.addRelated(s, ref('board-1', 'c1'), ref('board-1', 'c1')).reason, 'self-reference');
  const a = Relations.addRelated(s, ref('board-1', 'c1'), ref('board-1', 'c2'));
  assert.equal(Relations.addRelated(a.state, ref('board-1', 'c1'), ref('board-1', 'c2')).reason, 'duplicate');
  assert.equal(Relations.addRelated(a.state, ref('board-1', 'c2'), ref('board-1', 'c1')).reason, 'duplicate');
});

test('removeRelated cleans both directions', () => {
  const s = state();
  const a = Relations.addRelated(s, ref('board-1', 'c1'), ref('board-2', 'x1'));
  const b = Relations.removeRelated(a.state, ref('board-1', 'c1'), ref('board-2', 'x1'));
  assert.equal(b.changed, true);
  assert.deepEqual(b.state.boards[0].columns[0].cards[0].dependencies.related, []);
  assert.deepEqual(b.state.boards[1].columns[0].cards[0].dependencies.related, []);
});

test('cleanupCardReferences removes all references to a deleted card', () => {
  const s = state();
  const a = Relations.addBlocker(s, ref('board-1', 'c1'), ref('board-1', 'c2'));
  const b = Relations.addRelated(a.state, ref('board-1', 'c3'), ref('board-1', 'c2'));
  const c = Relations.cleanupCardReferences(b.state, ref('board-1', 'c2'));
  assert.deepEqual(c.boards[0].columns[0].cards[0].dependencies.blockers, []);
  assert.deepEqual(c.boards[0].columns[0].cards[2].dependencies.related, []);
});

test('cleanupCardReferences clears recurrence active refs', () => {
  const s = state();
  s.recurrences = [{ id: 'rec-1', enabled: true, activeCardRef: ref('board-1', 'c2'), target: { boardId: 'board-1', columnId: 'col-a' } }];
  const c = Relations.cleanupCardReferences(s, ref('board-1', 'c2'));
  assert.equal(c.recurrences[0].activeCardRef, null);
});

test('cleanupBoardReferences removes cross-board references', () => {
  const s = state();
  const a = Relations.addBlocker(s, ref('board-1', 'c1'), ref('board-2', 'x1'));
  const b = Relations.addRelated(a.state, ref('board-1', 'c2'), ref('board-2', 'x1'));
  const c = Relations.cleanupBoardReferences(b.state, 'board-2');
  const cards = c.boards[0].columns[0].cards;
  assert.ok(cards.every(card => card.dependencies.blockers.length === 0 && card.dependencies.related.length === 0));
});

test('cleanupBoardReferences disables recurrences targeting the board', () => {
  const s = state();
  s.recurrences = [{ id: 'rec-1', enabled: true, activeCardRef: ref('board-2', 'x1'), target: { boardId: 'board-2', columnId: 'col-b' } }];
  const c = Relations.cleanupBoardReferences(s, 'board-2');
  assert.equal(c.recurrences[0].enabled, false);
  assert.equal(c.recurrences[0].activeCardRef, null);
  assert.equal(c.recurrences[0].pausedReason, 'Target board deleted');
});

test('cleanupBoardReferences trims lens scopes', () => {
  const s = state();
  s.lenses = [{ id: 'lens-1', scope: 'selected-boards', boardIds: ['board-1', 'board-2'] }];
  const c = Relations.cleanupBoardReferences(s, 'board-2');
  assert.deepEqual(c.lenses[0].boardIds, ['board-1']);
});

test('relations operations never mutate the input state', () => {
  const s = state();
  const before = JSON.stringify(s);
  Relations.addBlocker(s, ref('board-1', 'c1'), ref('board-1', 'c2'));
  Relations.addRelated(s, ref('board-1', 'c1'), ref('board-1', 'c2'));
  Relations.cleanupCardReferences(s, ref('board-1', 'c2'));
  Relations.cleanupBoardReferences(s, 'board-2');
  assert.equal(JSON.stringify(s), before);
});

test('addRelated with a missing card is a no-op, not a crash', () => {
  const s = state();
  const result = Relations.addRelated(s, ref('board-1', 'ghost'), ref('board-1', 'c2'));
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'card-not-found');
});

test('addRelated with a missing card on either side returns card-not-found', () => {
  const s = state();
  const result = Relations.addRelated(s, ref('board-1', 'c1'), ref('ghost-board', 'c2'));
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'card-not-found');
});
