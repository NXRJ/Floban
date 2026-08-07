const { test } = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../../js/core/model.js');

function makeDeps() {
  let n = 0;
  return {
    uid: () => 'id-' + (++n),
    now: () => 1000
  };
}

test('createCard fills defaults and uses injected id and timestamp', () => {
  const deps = makeDeps();
  const card = Model.createCard('column-1', null, deps);
  assert.equal(card.id, 'id-1');
  assert.equal(card.columnId, 'column-1');
  assert.equal(card.title, '');
  assert.equal(card.description, '');
  assert.deepEqual(card.labels, []);
  assert.equal(card.assignee, '');
  assert.equal(card.createdAt, 1000);
  assert.equal(card.updatedAt, 1000);
  assert.equal(card.movedAt, 1000);
  assert.equal(card.due, '');
  assert.deepEqual(card.checklist, []);
  assert.equal(card.archivedAt, null);
  assert.equal(card.fromColumn, '');
});

test('createCard applies overrides on top of defaults', () => {
  const deps = makeDeps();
  const card = Model.createCard('column-1', { title: 'Task', due: '2026-08-07', id: 'kept-id' }, deps);
  assert.equal(card.id, 'kept-id');
  assert.equal(card.title, 'Task');
  assert.equal(card.due, '2026-08-07');
  assert.equal(card.columnId, 'column-1');
});

test('createCard does not mutate the overrides object', () => {
  const deps = makeDeps();
  const overrides = { title: 'Task', labels: ['a'] };
  const before = JSON.stringify(overrides);
  Model.createCard('column-1', overrides, deps);
  assert.equal(JSON.stringify(overrides), before);
});

test('createCard gives every card a fresh labels and checklist array', () => {
  const deps = makeDeps();
  const a = Model.createCard('column-1', null, deps);
  const b = Model.createCard('column-1', null, deps);
  assert.notEqual(a.labels, b.labels);
  assert.notEqual(a.checklist, b.checklist);
});

test('createCard throws when dependencies are missing', () => {
  assert.throws(() => Model.createCard('column-1', null, {}), /dependencies/);
  assert.throws(() => Model.createCard('column-1', null, null), /dependencies/);
  assert.throws(() => Model.createCard('column-1', null, { uid: () => 'x' }), /dependencies/);
});

test('createColumn fills defaults and applies overrides', () => {
  const deps = makeDeps();
  const column = Model.createColumn(null, deps);
  assert.equal(column.id, 'id-1');
  assert.equal(column.title, '');
  assert.equal(column.isDone, false);
  assert.equal(column.wipLimit, 0);
  assert.equal(column.collapsed, false);
  assert.deepEqual(column.cards, []);
  const done = Model.createColumn({ title: 'Done', isDone: true }, deps);
  assert.equal(done.title, 'Done');
  assert.equal(done.isDone, true);
});

test('createLabel returns a new label with generated id', () => {
  const deps = makeDeps();
  const label = Model.createLabel('Bug', '#c81e14', deps);
  assert.equal(label.id, 'id-1');
  assert.equal(label.name, 'Bug');
  assert.equal(label.color, '#c81e14');
});

test('createBoard defaults the name and initializes empty structures', () => {
  const deps = makeDeps();
  const board = Model.createBoard(null, deps);
  assert.equal(board.name, 'New board');
  assert.deepEqual(board.labels, []);
  assert.deepEqual(board.templates, []);
  assert.deepEqual(board.columns, []);
  assert.deepEqual(board.archive, { cards: [], columns: [] });
  const named = Model.createBoard('Sprint', deps);
  assert.equal(named.name, 'Sprint');
});

test('createTemplate fills defaults and applies overrides', () => {
  const deps = makeDeps();
  const template = Model.createTemplate(null, deps);
  assert.equal(template.id, 'id-1');
  assert.equal(template.title, '');
  assert.equal(template.description, '');
  assert.deepEqual(template.labels, []);
  assert.equal(template.assignee, '');
  assert.deepEqual(template.checklist, []);
  const full = Model.createTemplate({ title: 'Fix bug: ', labels: ['l-1'] }, deps);
  assert.equal(full.title, 'Fix bug: ');
  assert.deepEqual(full.labels, ['l-1']);
});

test('cloneChecklist copies items with fresh ids and no shared references', () => {
  const deps = makeDeps();
  const source = [
    { id: 'item-1', text: 'Sketch', done: true },
    { id: 'item-2', text: 'Review', done: false }
  ];
  const copy = Model.cloneChecklist(source, deps);
  assert.equal(copy.length, 2);
  assert.equal(copy[0].id, 'id-1');
  assert.equal(copy[1].id, 'id-2');
  assert.equal(copy[0].text, 'Sketch');
  assert.equal(copy[0].done, true);
  assert.notEqual(copy[0], source[0]);
  copy[0].text = 'Mutated';
  assert.equal(source[0].text, 'Sketch');
});

test('cloneChecklist handles a missing checklist', () => {
  const deps = makeDeps();
  assert.deepEqual(Model.cloneChecklist(null, deps), []);
  assert.deepEqual(Model.cloneChecklist(undefined, deps), []);
});
