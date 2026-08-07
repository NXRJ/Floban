const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Migration = require('../../js/core/migration.js');

const v1Fixture = require('../fixtures/state-v1.json');
const v2Fixture = require('../fixtures/state-v2.json');
const corruptFixture = require('../fixtures/corrupt-state.json');

function makeDeps() {
  let n = 0;
  return {
    uid: () => 'generated-' + (++n),
    now: () => 5000
  };
}

test('a valid version-1 state migrates to version 2', () => {
  const result = Migration.migrateV1(v1Fixture, makeDeps());
  assert.equal(result.version, 2);
  assert.equal(result.boards.length, 1);
  assert.equal(Array.isArray(result.boards[0].columns), true);
  assert.equal(Array.isArray(result.boards[0].archive.cards), true);
  assert.equal(Array.isArray(result.boards[0].archive.columns), true);
});

test('v1 migration preserves the theme', () => {
  const result = Migration.migrateV1(v1Fixture, makeDeps());
  assert.equal(result.theme, 'light');
});

test('v1 migration falls back to dark theme when missing', () => {
  const raw = JSON.parse(JSON.stringify(v1Fixture));
  delete raw.theme;
  const result = Migration.migrateV1(raw, makeDeps());
  assert.equal(result.theme, 'dark');
});

test('the migrated board becomes active', () => {
  const result = Migration.migrateV1(v1Fixture, makeDeps());
  assert.equal(result.activeBoardId, result.boards[0].id);
});

test('v1 migration preserves valid column and card ids', () => {
  const result = Migration.migrateV1(v1Fixture, makeDeps());
  const board = result.boards[0];
  assert.equal(board.columns[0].id, 'col-todo');
  assert.equal(board.columns[0].cards[0].id, 'card-1');
});

test('v1 migration generates missing column ids', () => {
  const result = Migration.migrateV1(v1Fixture, makeDeps());
  const second = result.boards[0].columns[1];
  assert.equal(typeof second.id, 'string');
  assert.ok(second.id.length > 0);
  assert.notEqual(second.id, 'col-todo');
});

test('v1 migration gives new card fields their defaults', () => {
  const result = Migration.migrateV1(v1Fixture, makeDeps());
  const card = result.boards[0].columns[0].cards[0];
  assert.equal(card.due, '');
  assert.deepEqual(card.checklist, []);
  assert.equal(typeof card.movedAt, 'number');
  assert.deepEqual(card.labels, ['l-bug']);
  assert.equal(card.assignee, 'Sam');
});

test('v1 migration sanitizes unsafe label colors and keeps valid labels', () => {
  const result = Migration.migrateV1(v1Fixture, makeDeps());
  const labels = result.boards[0].labels;
  assert.equal(labels.length, 2);
  assert.equal(labels[0].id, 'l-bug');
  assert.equal(labels[0].color, '#c81e14');
  assert.equal(labels[1].id, 'l-feat');
  assert.equal(labels[1].color, '#6d30d6');
});

test('migrated cards preserve string label ids (dangling ids included)', () => {
  const result = Migration.migrateV1(v1Fixture, makeDeps());
  const card = result.boards[0].columns[0].cards[1];
  assert.deepEqual(card.labels, ['l-feat', 'missing-label']);
});

test('v1 migration normalizes archived cards', () => {
  const result = Migration.migrateV1(v1Fixture, makeDeps());
  const archived = result.boards[0].archive.cards[0];
  assert.equal(archived.id, 'archived-card-1');
  assert.equal(archived.columnId, 'col-todo');
  assert.equal(archived.archivedAt, 400);
  assert.equal(typeof archived.movedAt, 'number');
  assert.deepEqual(archived.checklist, []);
});

test('v1 migration normalizes cards inside archived columns', () => {
  const result = Migration.migrateV1(v1Fixture, makeDeps());
  const entry = result.boards[0].archive.columns[0];
  assert.equal(entry.id, 'col-archived');
  const card = entry.cards[0];
  assert.equal(card.id, 'archived-col-card-1');
  assert.equal(card.columnId, 'col-archived');
  assert.equal(card.due, '');
});

test('v1 migration does not mutate the input state', () => {
  const raw = JSON.parse(JSON.stringify(v1Fixture));
  const before = JSON.stringify(raw);
  Migration.migrateV1(raw, makeDeps());
  assert.equal(JSON.stringify(raw), before);
});

test('normalizeState heals a corrupt version-2 payload', () => {
  const result = Migration.normalizeState(corruptFixture, makeDeps());
  assert.equal(result.version, 2);
  assert.equal(result.theme, 'dark');
  assert.equal(result.activeBoardId, 'board-1');
  const board = result.boards[0];
  assert.deepEqual(board.labels.map(l => l.id), ['l-ok', 'l-bad']);
  assert.ok(board.labels.every(l => /^#[0-9a-f]{6}$/.test(l.color)));
  assert.equal(board.templates.length, 2);
  assert.equal(typeof board.templates[1].id, 'string');
  assert.equal(board.columns[0].wipLimit, 0);
  assert.equal(board.columns[0].collapsed, false);
  assert.deepEqual(board.columns[0].cards.map(c => c.id), ['card-1', 'card-2']);
  assert.equal(board.columns[0].cards[0].due, '');
  assert.deepEqual(board.columns[0].cards[0].checklist, []);
  assert.deepEqual(board.columns[0].cards[0].labels, []);
  assert.equal(board.columns[0].cards[0].assignee, '');
  assert.equal(board.columns[0].cards[0].movedAt, 100);
  assert.equal(typeof board.columns[1].id, 'string');
});

test('normalizeState falls back to the first board for an invalid activeBoardId', () => {
  const result = Migration.normalizeState(corruptFixture, makeDeps());
  assert.equal(result.activeBoardId, result.boards[0].id);
});

test('normalizeState falls back to dark for a non-string theme', () => {
  const result = Migration.normalizeState(corruptFixture, makeDeps());
  assert.equal(result.theme, 'dark');
});

test('normalizeState heals a missing archive structure', () => {
  const raw = JSON.parse(JSON.stringify(v2Fixture));
  delete raw.boards[0].archive;
  const result = Migration.normalizeState(raw, makeDeps());
  assert.deepEqual(result.boards[0].archive, { cards: [], columns: [] });
});

test('normalizeState heals missing card arrays in columns', () => {
  const raw = JSON.parse(JSON.stringify(v2Fixture));
  raw.boards[0].columns[0].cards = null;
  const result = Migration.normalizeState(raw, makeDeps());
  assert.deepEqual(result.boards[0].columns[0].cards, []);
});

test('normalizeState generates ids for cards and columns that lack them', () => {
  const raw = JSON.parse(JSON.stringify(v2Fixture));
  delete raw.boards[0].columns[0].cards[0].id;
  delete raw.boards[0].columns[1].id;
  const result = Migration.normalizeState(raw, makeDeps());
  assert.equal(typeof result.boards[0].columns[0].cards[0].id, 'string');
  assert.equal(typeof result.boards[0].columns[1].id, 'string');
  assert.ok(result.boards[0].columns[1].id.length > 0);
});

test('normalizeState generates ids for archived items that lack them', () => {
  const raw = JSON.parse(JSON.stringify(corruptFixture));
  const result = Migration.normalizeState(raw, makeDeps());
  assert.equal(typeof result.boards[0].archive.columns[1].id, 'string');
  assert.ok(result.boards[0].archive.columns[1].id.length > 0);
});

test('normalizeState normalizes archived cards', () => {
  const result = Migration.normalizeState(corruptFixture, makeDeps());
  const archived = result.boards[0].archive.cards[0];
  assert.equal(archived.id, 'archived-1');
  assert.deepEqual(archived.labels, []);
  assert.equal(archived.due, '');
  assert.equal(archived.assignee, '');
});

test('normalizeState normalizes cards inside archived columns', () => {
  const result = Migration.normalizeState(corruptFixture, makeDeps());
  const card = result.boards[0].archive.columns[0].cards[0];
  assert.equal(card.id, 'arch-col-card-1');
  assert.deepEqual(card.checklist, []);
  assert.equal(card.due, '');
});

test('normalizeState does not mutate its input', () => {
  const raw = JSON.parse(JSON.stringify(corruptFixture));
  const before = JSON.stringify(raw);
  Migration.normalizeState(raw, makeDeps());
  assert.equal(JSON.stringify(raw), before);
});

test('normalizeState is idempotent', () => {
  const deps = makeDeps();
  const once = Migration.normalizeState(corruptFixture, deps);
  const twice = Migration.normalizeState(once, deps);
  assert.deepEqual(twice, once);
});

test('normalizeState is idempotent on a clean payload', () => {
  const deps = makeDeps();
  const once = Migration.normalizeState(v2Fixture, deps);
  const twice = Migration.normalizeState(once, deps);
  assert.deepEqual(twice, once);
});

test('a clean version-2 payload survives normalization unchanged', () => {
  const result = Migration.normalizeState(v2Fixture, makeDeps());
  assert.equal(result.theme, 'dark');
  assert.equal(result.activeBoardId, 'board-1');
  assert.equal(result.boards[0].columns[0].cards[0].id, 'card-1');
  assert.equal(result.boards[0].templates[0].title, 'Fix bug: ');
});

test('normalizeLabel drops labels without an id', () => {
  assert.equal(Migration.normalizeLabel(null), null);
  assert.equal(Migration.normalizeLabel({ name: 'x' }), null);
  assert.equal(Migration.normalizeLabel({ id: '', name: 'x' }), null);
});

test('normalizeTemplate falls back to the legacy name field for the title', () => {
  const result = Migration.normalizeTemplate({ name: 'Bug report' }, makeDeps());
  assert.equal(result.title, 'Bug report');
  assert.equal(typeof result.id, 'string');
});

test('adoptBoardShape adopts a raw board payload', () => {
  const deps = makeDeps();
  const raw = {
    name: 'Imported',
    labels: [{ id: 'l-1', name: 'Bug', color: '#c81e14' }],
    columns: [
      { id: 'col-1', title: 'To Do', cards: [{ id: 'c-1', title: 'Task' }] }
    ]
  };
  const board = Migration.adoptBoardShape(raw, 'Imported', deps);
  assert.equal(board.name, 'Imported');
  assert.equal(board.labels[0].id, 'l-1');
  assert.equal(board.columns[0].id, 'col-1');
  assert.equal(board.columns[0].cards[0].id, 'c-1');
  assert.equal(board.columns[0].cards[0].columnId, 'col-1');
  assert.equal(board.columns[0].cards[0].due, '');
  assert.equal(typeof board.columns[0].cards[0].createdAt, 'number');
  assert.equal(board.columns[0].cards[0].movedAt, board.columns[0].cards[0].createdAt);
});

test('adoptBoardShape generates ids when the payload lacks them', () => {
  const deps = makeDeps();
  const raw = {
    labels: [],
    columns: [
      { title: 'No id', cards: [{ title: 'Card without id' }] }
    ]
  };
  const board = Migration.adoptBoardShape(raw, 'Imported', deps);
  const column = board.columns[0];
  assert.equal(typeof column.id, 'string');
  assert.ok(column.id.length > 0);
  assert.equal(column.cards[0].columnId, column.id);
});

test('adoptBoardShape does not mutate its input', () => {
  const raw = { labels: [{ id: 'l-1', name: 'Bug', color: '#c81e14' }], columns: [] };
  const before = JSON.stringify(raw);
  Migration.adoptBoardShape(raw, 'Imported', makeDeps());
  assert.equal(JSON.stringify(raw), before);
});

test('parseImportPayload recognizes a full-backup payload', () => {
  const result = Migration.parseImportPayload(JSON.stringify(v2Fixture), null, makeDeps());
  assert.equal(result.kind, 'all');
  assert.equal(result.state.version, 2);
  assert.equal(result.state.boards[0].id, 'board-1');
});

test('parseImportPayload recognizes a single-board payload', () => {
  const boardJson = JSON.stringify({
    id: 'b-1',
    name: 'Board',
    labels: [],
    templates: [],
    columns: [],
    archive: { cards: [], columns: [] }
  });
  const result = Migration.parseImportPayload(boardJson, null, makeDeps());
  assert.equal(result.kind, 'board');
  assert.equal(typeof result.board.id, 'string');
  assert.notEqual(result.board.id, 'b-1');
  assert.deepEqual(result.board.archive, { cards: [], columns: [] });
});

test('parseImportPayload rejects invalid payloads', () => {
  assert.equal(Migration.parseImportPayload('not json', null, makeDeps()).kind, null);
  assert.equal(Migration.parseImportPayload('null', null, makeDeps()).kind, null);
  assert.equal(Migration.parseImportPayload(JSON.stringify({ foo: 1 }), null, makeDeps()).kind, null);
  assert.equal(Migration.parseImportPayload(JSON.stringify({ version: 2, boards: [] }), null, makeDeps()).kind, null);
});

test('parseImportPayload imports a version-1 shaped payload as a board', () => {
  const result = Migration.parseImportPayload(JSON.stringify({ version: 1, columns: [], labels: [] }), null, makeDeps());
  assert.equal(result.kind, 'board');
});

test('parseImportPayload rejects payloads with no columns or labels', () => {
  const result = Migration.parseImportPayload(JSON.stringify({ version: 2, boards: [], columns: [] }), null, makeDeps());
  assert.equal(result.kind, null);
});

test('fixture files are reachable from the unit test directory', () => {
  assert.ok(path.resolve(__dirname, '../fixtures/state-v1.json').includes('fixtures'));
  assert.equal(typeof v1Fixture.version, 'number');
  assert.equal(v2Fixture.version, 2);
  assert.equal(corruptFixture.version, 2);
});

test('normalization does not share mutable references with the input', () => {
  const raw = JSON.parse(JSON.stringify(corruptFixture));
  const result = Migration.normalizeState(raw, makeDeps());
  assert.notEqual(result.boards[0], raw.boards[0]);
  assert.notEqual(result.boards[0].columns[0], raw.boards[0].columns[0]);
  assert.notEqual(result.boards[0].columns[0].cards[0], raw.boards[0].columns[0].cards[0]);
  assert.notEqual(result.boards[0].labels, raw.boards[0].labels);
});
