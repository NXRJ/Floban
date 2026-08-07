const { test } = require('node:test');
const assert = require('node:assert/strict');
const Operations = require('../../js/core/operations.js');

function makeCard(overrides) {
  return Object.assign({
    id: 'card-1',
    columnId: 'column-1',
    title: 'Task',
    description: '',
    labels: [],
    assignee: '',
    createdAt: 100,
    updatedAt: 100,
    movedAt: 100,
    due: '',
    checklist: [],
    archivedAt: null,
    fromColumn: ''
  }, overrides || {});
}

function makeState(overrides) {
  return Object.assign({
    version: 2,
    theme: 'dark',
    activeBoardId: 'board-1',
    boards: [
      {
        id: 'board-1',
        name: 'Board 1',
        labels: [{ id: 'label-1', name: 'Bug', color: '#c81e14' }],
        templates: [],
        columns: [
          {
            id: 'column-1',
            title: 'To Do',
            isDone: false,
            wipLimit: 0,
            collapsed: false,
            cards: [
              makeCard({ id: 'card-a', columnId: 'column-1', title: 'Alpha', createdAt: 100, updatedAt: 100, movedAt: 100 }),
              makeCard({ id: 'card-b', columnId: 'column-1', title: 'Beta', createdAt: 200, updatedAt: 200, movedAt: 200 })
            ]
          },
          {
            id: 'column-2',
            title: 'Done',
            isDone: true,
            wipLimit: 0,
            collapsed: false,
            cards: [
              makeCard({ id: 'card-c', columnId: 'column-2', title: 'Gamma', createdAt: 300, updatedAt: 300, movedAt: 300 })
            ]
          }
        ],
        archive: { cards: [], columns: [] }
      }
    ]
  }, overrides || {});
}

function makeDeps() {
  let n = 0;
  return {
    uid: () => 'op-' + (++n),
    now: () => 9000
  };
}

function boardOf(state) {
  return state.boards[0];
}

function columnOf(state, id) {
  return boardOf(state).columns.find((c) => c.id === id);
}

function clone(input) {
  return JSON.parse(JSON.stringify(input));
}

test('moveCard moves a card between columns', () => {
  const result = Operations.moveCard(makeState(), { columnId: 'column-1', cardId: 'card-a', targetColumnId: 'column-2', toIndex: 1 }, makeDeps());
  assert.equal(result.changed, true);
  assert.deepEqual(columnOf(result.state, 'column-1').cards.map((c) => c.id), ['card-b']);
  assert.deepEqual(columnOf(result.state, 'column-2').cards.map((c) => c.id), ['card-c', 'card-a']);
});

test('moveCard reorders within one column', () => {
  const result = Operations.moveCard(makeState(), { columnId: 'column-1', cardId: 'card-a', targetColumnId: 'column-1', toIndex: 2 }, makeDeps());
  assert.deepEqual(columnOf(result.state, 'column-1').cards.map((c) => c.id), ['card-b', 'card-a']);
});

test('moveCard adjusts the index when reordering within the same column', () => {
  const state = makeState();
  state.boards[0].columns[0].cards.push(makeCard({ id: 'card-d', columnId: 'column-1' }));
  const result = Operations.moveCard(state, { columnId: 'column-1', cardId: 'card-a', targetColumnId: 'column-1', toIndex: 3 }, makeDeps());
  assert.deepEqual(columnOf(result.state, 'column-1').cards.map((c) => c.id), ['card-b', 'card-d', 'card-a']);
});

test('moveCard clamps a negative target index to zero', () => {
  const result = Operations.moveCard(makeState(), { columnId: 'column-1', cardId: 'card-b', targetColumnId: 'column-2', toIndex: -5 }, makeDeps());
  assert.deepEqual(columnOf(result.state, 'column-2').cards.map((c) => c.id), ['card-b', 'card-c']);
});

test('moveCard clamps a target index past the end', () => {
  const result = Operations.moveCard(makeState(), { columnId: 'column-1', cardId: 'card-a', targetColumnId: 'column-2', toIndex: 99 }, makeDeps());
  assert.deepEqual(columnOf(result.state, 'column-2').cards.map((c) => c.id), ['card-c', 'card-a']);
});

test('moveCard updates the columnId on the moved card', () => {
  const result = Operations.moveCard(makeState(), { columnId: 'column-1', cardId: 'card-a', targetColumnId: 'column-2', toIndex: 0 }, makeDeps());
  assert.equal(result.state.boards[0].columns[1].cards[0].columnId, 'column-2');
});

test('moveCard refreshes movedAt only when moving between columns', () => {
  const deps = makeDeps();
  const cross = Operations.moveCard(makeState(), { columnId: 'column-1', cardId: 'card-a', targetColumnId: 'column-2', toIndex: 0 }, deps);
  assert.equal(cross.state.boards[0].columns[1].cards[0].movedAt, 9000);
  const within = Operations.moveCard(makeState(), { columnId: 'column-1', cardId: 'card-a', targetColumnId: 'column-1', toIndex: 2 }, deps);
  assert.equal(within.state.boards[0].columns[0].cards[1].movedAt, 100);
});

test('moveCard with a missing source column is a safe no-op', () => {
  const state = makeState();
  const result = Operations.moveCard(state, { columnId: 'nope', cardId: 'card-a', targetColumnId: 'column-2', toIndex: 0 }, makeDeps());
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'column-not-found');
  assert.equal(result.state, state);
});

test('moveCard with a missing card is a safe no-op', () => {
  const state = makeState();
  const result = Operations.moveCard(state, { columnId: 'column-1', cardId: 'ghost', targetColumnId: 'column-2', toIndex: 0 }, makeDeps());
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'card-not-found');
  assert.equal(result.state, state);
});

test('moveCard with a missing target column is a safe no-op', () => {
  const state = makeState();
  const result = Operations.moveCard(state, { columnId: 'column-1', cardId: 'card-a', targetColumnId: 'nope', toIndex: 0 }, makeDeps());
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'column-not-found');
});

test('moveCard does not mutate the input state', () => {
  const state = makeState();
  const before = JSON.stringify(state);
  Operations.moveCard(state, { columnId: 'column-1', cardId: 'card-a', targetColumnId: 'column-2', toIndex: 0 }, makeDeps());
  assert.equal(JSON.stringify(state), before);
});

test('duplicateCard inserts a copy immediately after the source card', () => {
  const result = Operations.duplicateCard(makeState(), { columnId: 'column-1', cardId: 'card-a' }, makeDeps());
  assert.deepEqual(columnOf(result.state, 'column-1').cards.map((c) => c.id), ['card-a', 'op-1', 'card-b']);
});

test('duplicateCard regenerates the card id', () => {
  const result = Operations.duplicateCard(makeState(), { columnId: 'column-1', cardId: 'card-a' }, makeDeps());
  const copy = columnOf(result.state, 'column-1').cards[1];
  assert.equal(copy.id, 'op-1');
  assert.notEqual(copy.id, 'card-a');
});

test('duplicateCard regenerates checklist item ids', () => {
  const state = makeState();
  state.boards[0].columns[0].cards[0].checklist = [
    { id: 'item-1', text: 'Sketch', done: true },
    { id: 'item-2', text: 'Review', done: false }
  ];
  const result = Operations.duplicateCard(state, { columnId: 'column-1', cardId: 'card-a' }, makeDeps());
  const copy = columnOf(result.state, 'column-1').cards[1];
  assert.deepEqual(copy.checklist.map((i) => i.id), ['op-2', 'op-3']);
  assert.deepEqual(copy.checklist.map((i) => i.text), ['Sketch', 'Review']);
});

test('duplicateCard leaves the original card untouched', () => {
  const result = Operations.duplicateCard(makeState(), { columnId: 'column-1', cardId: 'card-a' }, makeDeps());
  const original = columnOf(result.state, 'column-1').cards[0];
  assert.equal(original.id, 'card-a');
  assert.equal(original.title, 'Alpha');
  assert.equal(original.createdAt, 100);
});

test('duplicateCard prefixes the copy title', () => {
  const result = Operations.duplicateCard(makeState(), { columnId: 'column-1', cardId: 'card-a' }, makeDeps());
  assert.equal(columnOf(result.state, 'column-1').cards[1].title, 'Copy of Alpha');
});

test('duplicateCard refreshes created, updated and moved timestamps', () => {
  const result = Operations.duplicateCard(makeState(), { columnId: 'column-1', cardId: 'card-a' }, makeDeps());
  const copy = columnOf(result.state, 'column-1').cards[1];
  assert.equal(copy.createdAt, 9000);
  assert.equal(copy.updatedAt, 9000);
  assert.equal(copy.movedAt, 9000);
});

test('duplicateCard clears archive-only fields', () => {
  const state = makeState();
  state.boards[0].columns[0].cards[0].archivedAt = 123;
  state.boards[0].columns[0].cards[0].fromColumn = 'To Do';
  const result = Operations.duplicateCard(state, { columnId: 'column-1', cardId: 'card-a' }, makeDeps());
  const copy = columnOf(result.state, 'column-1').cards[1];
  assert.equal(copy.archivedAt, null);
  assert.equal(copy.fromColumn, '');
});

test('duplicateCard copies labels without sharing the mutable array', () => {
  const state = makeState();
  state.boards[0].columns[0].cards[0].labels = ['label-1'];
  const result = Operations.duplicateCard(state, { columnId: 'column-1', cardId: 'card-a' }, makeDeps());
  const original = columnOf(result.state, 'column-1').cards[0];
  const copy = columnOf(result.state, 'column-1').cards[1];
  assert.deepEqual(copy.labels, ['label-1']);
  assert.notEqual(original.labels, copy.labels);
  copy.labels.push('label-2');
  assert.deepEqual(original.labels, ['label-1']);
});

test('duplicateCard deep-copies checklist objects', () => {
  const state = makeState();
  state.boards[0].columns[0].cards[0].checklist = [{ id: 'item-1', text: 'Sketch', done: false }];
  const result = Operations.duplicateCard(state, { columnId: 'column-1', cardId: 'card-a' }, makeDeps());
  const original = columnOf(result.state, 'column-1').cards[0];
  const copy = columnOf(result.state, 'column-1').cards[1];
  assert.notEqual(original.checklist[0], copy.checklist[0]);
  copy.checklist[0].done = true;
  assert.equal(original.checklist[0].done, false);
});

test('duplicateCard with a missing card is a safe no-op', () => {
  const state = makeState();
  const result = Operations.duplicateCard(state, { columnId: 'column-1', cardId: 'ghost' }, makeDeps());
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'card-not-found');
  assert.equal(result.state, state);
});

test('duplicateCard does not mutate the input state', () => {
  const state = makeState();
  const before = JSON.stringify(state);
  Operations.duplicateCard(state, { columnId: 'column-1', cardId: 'card-a' }, makeDeps());
  assert.equal(JSON.stringify(state), before);
});

test('archiveCard removes the card from its column and puts it in the archive', () => {
  const result = Operations.archiveCard(makeState(), { columnId: 'column-1', cardId: 'card-a' }, makeDeps());
  assert.deepEqual(columnOf(result.state, 'column-1').cards.map((c) => c.id), ['card-b']);
  assert.deepEqual(boardOf(result.state).archive.cards.map((c) => c.id), ['card-a']);
});

test('archiveCard sets archivedAt and the origin column name', () => {
  const result = Operations.archiveCard(makeState(), { columnId: 'column-1', cardId: 'card-a' }, makeDeps());
  const archived = boardOf(result.state).archive.cards[0];
  assert.equal(archived.archivedAt, 9000);
  assert.equal(archived.fromColumn, 'To Do');
});

test('archiveCard with a missing card is a safe no-op', () => {
  const state = makeState();
  const result = Operations.archiveCard(state, { columnId: 'column-1', cardId: 'ghost' }, makeDeps());
  assert.equal(result.changed, false);
  assert.equal(result.state, state);
});

test('restoreCard returns the card to its original existing column', () => {
  const state = makeState();
  const archived = makeCard({ id: 'card-arch', columnId: 'column-1', title: 'Alpha' });
  archived.archivedAt = 500;
  archived.fromColumn = 'To Do';
  boardOf(state).archive.cards.push(archived);
  const result = Operations.restoreCard(state, { cardId: 'card-arch' }, makeDeps());
  assert.deepEqual(columnOf(result.state, 'column-1').cards.map((c) => c.id), ['card-a', 'card-b', 'card-arch']);
  assert.equal(columnOf(result.state, 'column-1').cards[2].columnId, 'column-1');
  assert.deepEqual(boardOf(result.state).archive.cards, []);
});

test('restoreCard falls back to the first column when the origin is gone', () => {
  const state = makeState();
  const archived = makeCard({ id: 'card-x', columnId: 'gone-column', title: 'Orphan' });
  archived.archivedAt = 500;
  boardOf(state).archive.cards.push(archived);
  const result = Operations.restoreCard(state, { cardId: 'card-x' }, makeDeps());
  assert.deepEqual(columnOf(result.state, 'column-1').cards.map((c) => c.id), ['card-a', 'card-b', 'card-x']);
  assert.equal(columnOf(result.state, 'column-1').cards[2].columnId, 'column-1');
});

test('restoreCard creates a To Do column when no columns exist', () => {
  const state = makeState();
  state.boards[0].columns = [];
  const archived = makeCard({ id: 'card-x', columnId: 'gone', title: 'Orphan' });
  archived.archivedAt = 500;
  boardOf(state).archive.cards.push(archived);
  const result = Operations.restoreCard(state, { cardId: 'card-x' }, makeDeps());
  const created = result.state.boards[0].columns;
  assert.equal(created.length, 1);
  assert.equal(created[0].title, 'To Do');
  assert.deepEqual(created[0].cards.map((c) => c.id), ['card-x']);
  assert.equal(created[0].cards[0].columnId, created[0].id);
});

test('restoreCard does not mutate the archived card in the input state', () => {
  const state = makeState();
  const archived = makeCard({ id: 'card-arch', columnId: 'column-1' });
  archived.archivedAt = 500;
  archived.fromColumn = 'To Do';
  boardOf(state).archive.cards.push(archived);
  const before = JSON.stringify(state);
  Operations.restoreCard(state, { cardId: 'card-arch' }, makeDeps());
  assert.equal(JSON.stringify(state), before);
  const sourceCard = state.boards[0].archive.cards[0];
  assert.equal(sourceCard.archivedAt, 500);
  assert.equal(sourceCard.fromColumn, 'To Do');
  assert.equal(sourceCard.columnId, 'column-1');
  assert.equal(sourceCard.movedAt, 100);
});

test('restoreCard removes archive-only fields and updates movedAt', () => {
  const state = makeState();
  const archived = makeCard({ id: 'card-arch', columnId: 'column-1' });
  archived.archivedAt = 500;
  archived.fromColumn = 'To Do';
  boardOf(state).archive.cards.push(archived);
  const result = Operations.restoreCard(state, { cardId: 'card-arch' }, makeDeps());
  const restored = columnOf(result.state, 'column-1').cards[2];
  assert.equal(restored.archivedAt, undefined);
  assert.equal(restored.fromColumn, undefined);
  assert.equal(restored.movedAt, 9000);
});

test('restoreCard with a missing card is a safe no-op', () => {
  const state = makeState();
  const result = Operations.restoreCard(state, { cardId: 'ghost' }, makeDeps());
  assert.equal(result.changed, false);
  assert.equal(result.state, state);
});

test('deleteColumn archives its cards without destroying them', () => {
  const result = Operations.deleteColumn(makeState(), { columnId: 'column-1' }, makeDeps());
  assert.equal(boardOf(result.state).columns.length, 1);
  assert.equal(boardOf(result.state).archive.columns.length, 1);
  const entry = boardOf(result.state).archive.columns[0];
  assert.deepEqual(entry.cards.map((c) => c.id), ['card-a', 'card-b']);
  assert.equal(entry.cards[0].archivedAt, 9000);
  assert.equal(entry.cards[0].fromColumn, 'To Do');
});

test('deleteColumn returns the number of archived cards', () => {
  const result = Operations.deleteColumn(makeState(), { columnId: 'column-1' }, makeDeps());
  assert.equal(result.value, 2);
});

test('deleteColumn preserves the column metadata in the archive', () => {
  const result = Operations.deleteColumn(makeState(), { columnId: 'column-2' }, makeDeps());
  const entry = boardOf(result.state).archive.columns[0];
  assert.equal(entry.id, 'column-2');
  assert.equal(entry.title, 'Done');
  assert.equal(entry.isDone, true);
  assert.equal(entry.wipLimit, 0);
});

test('deleteColumn with a missing column is a safe no-op', () => {
  const state = makeState();
  const result = Operations.deleteColumn(state, { columnId: 'ghost' }, makeDeps());
  assert.equal(result.changed, false);
  assert.equal(result.state, state);
});

test('restoreColumn appends the column back to the board', () => {
  const state = makeState();
  const entry = {
    id: 'column-3',
    title: 'Parked',
    isDone: false,
    wipLimit: 0,
    cards: [makeCard({ id: 'card-d', columnId: 'column-3', title: 'Delta', archivedAt: 500, fromColumn: 'Parked' })],
    archivedAt: 500
  };
  boardOf(state).archive.columns.push(entry);
  const result = Operations.restoreColumn(state, { columnId: 'column-3' }, makeDeps());
  assert.equal(boardOf(result.state).columns.length, 3);
  assert.equal(boardOf(result.state).columns[2].id, 'column-3');
  assert.deepEqual(boardOf(result.state).archive.columns, []);
});

test('restoreColumn removes archive-only fields and updates movedAt', () => {
  const state = makeState();
  const entry = {
    id: 'column-3',
    title: 'Parked',
    isDone: false,
    wipLimit: 0,
    cards: [makeCard({ id: 'card-d', columnId: 'column-3', title: 'Delta', archivedAt: 500, fromColumn: 'Parked' })],
    archivedAt: 500
  };
  boardOf(state).archive.columns.push(entry);
  const result = Operations.restoreColumn(state, { columnId: 'column-3' }, makeDeps());
  const restored = boardOf(result.state).columns[2];
  assert.equal(restored.archivedAt, undefined);
  assert.equal(restored.cards[0].archivedAt, undefined);
  assert.equal(restored.cards[0].fromColumn, undefined);
  assert.equal(restored.cards[0].movedAt, 9000);
});

test('restoreColumn with a missing column is a safe no-op', () => {
  const state = makeState();
  const result = Operations.restoreColumn(state, { columnId: 'ghost' }, makeDeps());
  assert.equal(result.changed, false);
  assert.equal(result.state, state);
});

test('duplicateBoard gives the copy a new board id and activates it', () => {
  const result = Operations.duplicateBoard(makeState(), { boardId: 'board-1' }, makeDeps());
  assert.equal(result.state.boards.length, 2);
  const copy = result.state.boards[1];
  assert.equal(copy.id, 'op-1');
  assert.equal(copy.name, 'Board 1 copy');
  assert.equal(result.state.activeBoardId, 'op-1');
});

test('duplicated board shares no mutable arrays or objects with the source', () => {
  const result = Operations.duplicateBoard(makeState(), { boardId: 'board-1' }, makeDeps());
  const source = result.state.boards[0];
  const copy = result.state.boards[1];
  assert.notEqual(source, copy);
  assert.notEqual(source.labels, copy.labels);
  assert.notEqual(source.columns, copy.columns);
  assert.notEqual(source.columns[0], copy.columns[0]);
  assert.notEqual(source.columns[0].cards, copy.columns[0].cards);
  assert.notEqual(source.columns[0].cards[0], copy.columns[0].cards[0]);
  assert.notEqual(source.archive, copy.archive);
  copy.columns[0].cards[0].title = 'Mutated';
  assert.equal(source.columns[0].cards[0].title, 'Alpha');
});

test('duplicated board keeps the nested card, column and label ids', () => {
  const result = Operations.duplicateBoard(makeState(), { boardId: 'board-1' }, makeDeps());
  const copy = result.state.boards[1];
  assert.deepEqual(copy.columns.map((c) => c.id), ['column-1', 'column-2']);
  assert.deepEqual(copy.columns[0].cards.map((c) => c.id), ['card-a', 'card-b']);
  assert.deepEqual(copy.labels.map((l) => l.id), ['label-1']);
});

test('duplicateBoard with a missing board is a safe no-op', () => {
  const state = makeState();
  const result = Operations.duplicateBoard(state, { boardId: 'ghost' }, makeDeps());
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'board-not-found');
  assert.equal(result.state, state);
});

test('deleting the final remaining board is prohibited', () => {
  const state = makeState();
  const result = Operations.deleteBoard(state, { boardId: 'board-1' });
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'last-board');
  assert.equal(result.value, null);
  assert.equal(result.state, state);
});

test('deleting the active board selects a deterministic replacement', () => {
  const state = makeState();
  state.boards.push({
    id: 'board-2',
    name: 'Board 2',
    labels: [],
    templates: [],
    columns: [],
    archive: { cards: [], columns: [] }
  });
  state.boards.push({
    id: 'board-3',
    name: 'Board 3',
    labels: [],
    templates: [],
    columns: [],
    archive: { cards: [], columns: [] }
  });
  state.activeBoardId = 'board-2';
  const result = Operations.deleteBoard(state, { boardId: 'board-2' });
  assert.equal(result.changed, true);
  assert.equal(result.value, true);
  assert.deepEqual(result.state.boards.map((b) => b.id), ['board-1', 'board-3']);
  assert.equal(result.state.activeBoardId, 'board-3');
});

test('deleting the last active board selects the previous board', () => {
  const state = makeState();
  state.boards.push({
    id: 'board-2',
    name: 'Board 2',
    labels: [],
    templates: [],
    columns: [],
    archive: { cards: [], columns: [] }
  });
  state.activeBoardId = 'board-2';
  const result = Operations.deleteBoard(state, { boardId: 'board-2' });
  assert.equal(result.state.activeBoardId, 'board-1');
});

test('deleting a non-active board preserves the active selection', () => {
  const state = makeState();
  state.boards.push({
    id: 'board-2',
    name: 'Board 2',
    labels: [],
    templates: [],
    columns: [],
    archive: { cards: [], columns: [] }
  });
  const result = Operations.deleteBoard(state, { boardId: 'board-2' });
  assert.equal(result.changed, true);
  assert.equal(result.value, true);
  assert.equal(result.state.activeBoardId, 'board-1');
  assert.deepEqual(result.state.boards.map((b) => b.id), ['board-1']);
});

test('deleteBoard with a missing board is a safe no-op', () => {
  const state = makeState();
  state.boards.push({
    id: 'board-2',
    name: 'Board 2',
    labels: [],
    templates: [],
    columns: [],
    archive: { cards: [], columns: [] }
  });
  const result = Operations.deleteBoard(state, { boardId: 'ghost' });
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'board-not-found');
  assert.equal(result.state, state);
});

test('a label used by an active card cannot be removed', () => {
  const state = makeState();
  state.boards[0].columns[0].cards[0].labels = ['label-1'];
  const result = Operations.removeLabel(state, { labelId: 'label-1' });
  assert.equal(result.changed, false);
  assert.equal(result.value, false);
  assert.equal(result.reason, 'label-in-use');
});

test('a label used by an archived card cannot be removed', () => {
  const state = makeState();
  const archived = makeCard({ id: 'card-x', columnId: 'column-1' });
  archived.labels = ['label-1'];
  state.boards[0].archive.cards.push(archived);
  const result = Operations.removeLabel(state, { labelId: 'label-1' });
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'label-in-use');
});

test('a label used inside an archived column cannot be removed', () => {
  const state = makeState();
  const entry = {
    id: 'column-3',
    title: 'Parked',
    cards: [makeCard({ id: 'card-d', columnId: 'column-3', labels: ['label-1'] })],
    archivedAt: 500
  };
  state.boards[0].archive.columns.push(entry);
  const result = Operations.removeLabel(state, { labelId: 'label-1' });
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'label-in-use');
});

test('a label used by a template cannot be removed', () => {
  const state = makeState();
  state.boards[0].templates.push({
    id: 'tpl-1',
    title: 'Bug report',
    description: '',
    labels: ['label-1'],
    assignee: '',
    checklist: []
  });
  const result = Operations.removeLabel(state, { labelId: 'label-1' });
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'label-in-use');
});

test('an unused label can be removed', () => {
  const state = makeState();
  state.boards[0].labels.push({ id: 'label-2', name: 'Chore', color: '#6d30d6' });
  const result = Operations.removeLabel(state, { labelId: 'label-2' });
  assert.equal(result.changed, true);
  assert.equal(result.value, true);
  assert.deepEqual(state.boards[0].labels.map((l) => l.id), ['label-1', 'label-2']);
  assert.deepEqual(result.state.boards[0].labels.map((l) => l.id), ['label-1']);
});

test('removeLabel with a missing label is a safe no-op', () => {
  const state = makeState();
  const result = Operations.removeLabel(state, { labelId: 'ghost' });
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'label-not-found');
  assert.equal(result.state, state);
});

test('operations never mutate the input state', () => {
  const state = makeState();
  const before = JSON.stringify(state);
  Operations.archiveCard(state, { columnId: 'column-1', cardId: 'card-a' }, makeDeps());
  Operations.deleteColumn(state, { columnId: 'column-2' }, makeDeps());
  Operations.duplicateBoard(state, { boardId: 'board-1' }, makeDeps());
  Operations.deleteBoard(state, { boardId: 'board-1' });
  Operations.removeLabel(state, { labelId: 'label-1' });
  assert.equal(JSON.stringify(state), before);
});

test('helper functions expose active board and column lookups', () => {
  const state = makeState();
  assert.equal(Operations.activeBoard(state).id, 'board-1');
  assert.equal(Operations.findColumn(state.boards[0], 'column-2').title, 'Done');
  assert.equal(Operations.findColumn(state.boards[0], 'ghost'), null);
  assert.equal(Operations.findCard(state.boards[0].columns[0], 'card-a').title, 'Alpha');
  assert.equal(Operations.findCard(state.boards[0].columns[0], 'ghost'), null);
  assert.equal(Operations.labelInUse(state.boards[0], 'label-1'), false);
});
