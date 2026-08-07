const { test } = require('node:test');
const assert = require('node:assert/strict');
const History = require('../../js/core/history.js');

test('undo on an empty stack is safe and returns null', () => {
  const history = History.createHistory(50);
  assert.equal(history.canUndo(), false);
  assert.equal(history.undo({ a: 1 }), null);
});

test('redo on an empty stack is safe and returns null', () => {
  const history = History.createHistory(50);
  assert.equal(history.canRedo(), false);
  assert.equal(history.redo({ a: 1 }), null);
});

test('one-step undo restores the recorded snapshot', () => {
  const history = History.createHistory(50);
  history.record({ n: 1 });
  assert.equal(history.canUndo(), true);
  const restored = history.undo({ n: 2 });
  assert.deepEqual(restored, { n: 1 });
  assert.equal(history.canRedo(), true);
});

test('multi-step undo walks back through every snapshot', () => {
  const history = History.createHistory(50);
  let current = { n: 0 };
  history.record(current); current = { n: 1 };
  history.record(current); current = { n: 2 };
  history.record(current); current = { n: 3 };
  assert.deepEqual(history.undo(current), { n: 2 });
  assert.deepEqual(history.undo({ n: 2 }), { n: 1 });
  assert.deepEqual(history.undo({ n: 1 }), { n: 0 });
  assert.equal(history.undo({ n: 0 }), null);
});

test('redo replays steps that were undone', () => {
  const history = History.createHistory(50);
  let current = { n: 0 };
  history.record(current); current = { n: 1 };
  history.record(current); current = { n: 2 };
  const restored = history.undo(current);
  assert.deepEqual(restored, { n: 1 });
  assert.deepEqual(history.redo(restored), { n: 2 });
  assert.equal(history.redo({ n: 2 }), null);
});

test('recording a new change clears the redo history', () => {
  const history = History.createHistory(50);
  let current = { n: 0 };
  history.record(current); current = { n: 1 };
  history.record(current); current = { n: 2 };
  const restored = history.undo(current);
  assert.equal(history.canRedo(), true);
  history.record(restored);
  assert.equal(history.canRedo(), false);
  assert.equal(history.redo(restored), null);
});

test('history keeps no more than the configured limit', () => {
  const history = History.createHistory(5);
  let current = { n: 0 };
  for (let i = 1; i <= 13; i++) {
    history.record(current);
    current = { n: i };
  }
  const restored = [];
  let snapshot = current;
  while (true) {
    const next = history.undo(snapshot);
    if (next === null) break;
    restored.push(next.n);
    snapshot = next;
  }
  assert.deepEqual(restored, [12, 11, 10, 9, 8]);
});

test('history defaults to a limit of 50', () => {
  const history = History.createHistory();
  let current = { n: 0 };
  for (let i = 1; i <= 60; i++) {
    history.record(current);
    current = { n: i };
  }
  let count = 0;
  let snapshot = current;
  while (history.undo(snapshot) !== null) count++;
  assert.equal(count, 50);
});

test('stored snapshots do not share mutable references with live state', () => {
  const history = History.createHistory(50);
  const state = { cards: [{ id: 'c-1' }] };
  history.record(state);
  state.cards.push({ id: 'c-2' });
  state.cards[0].id = 'mutated';
  const restored = history.undo({ cards: [] });
  assert.deepEqual(restored, { cards: [{ id: 'c-1' }] });
  assert.notEqual(restored, state);
  assert.notEqual(restored.cards, state.cards);
});

test('the current snapshot pushed onto the stacks is cloned', () => {
  const history = History.createHistory(50);
  history.record({ n: 1 });
  const current = { n: 2 };
  const restored = history.undo(current);
  current.n = 99;
  assert.deepEqual(history.redo(restored), { n: 2 });
});

test('board-switch undo and redo restore the right active board', () => {
  const history = History.createHistory(50);
  const stateA = { version: 2, activeBoardId: 'board-a' };
  const stateB = { version: 2, activeBoardId: 'board-b' };
  history.record(stateA);
  const undoResult = history.undo(stateB);
  assert.equal(undoResult.activeBoardId, 'board-a');
  const redoResult = history.redo(undoResult);
  assert.equal(redoResult.activeBoardId, 'board-b');
});

test('theme-state undo restores the previous theme at the data level', () => {
  const history = History.createHistory(50);
  history.record({ theme: 'dark' });
  const restored = history.undo({ theme: 'light' });
  assert.equal(restored.theme, 'dark');
  const redone = history.redo(restored);
  assert.equal(redone.theme, 'light');
});

test('clear empties both stacks', () => {
  const history = History.createHistory(50);
  history.record({ n: 1 });
  history.undo({ n: 2 });
  history.clear();
  assert.equal(history.canUndo(), false);
  assert.equal(history.canRedo(), false);
  assert.equal(history.undo({ n: 3 }), null);
  assert.equal(history.redo({ n: 3 }), null);
});

test('a custom limit of one keeps a single snapshot', () => {
  const history = History.createHistory(1);
  history.record({ n: 1 });
  history.record({ n: 2 });
  const restored = history.undo({ n: 3 });
  assert.deepEqual(restored, { n: 2 });
  assert.equal(history.undo({ n: 2 }), null);
});
