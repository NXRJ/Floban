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

function stateWithChecklist() {
  return {
    version: 2,
    theme: 'dark',
    activeBoardId: 'board-1',
    boards: [{
      id: 'board-1',
      name: 'Board 1',
      labels: [],
      templates: [{
        id: 'tpl-1',
        title: 'Bug',
        description: '',
        labels: [],
        assignee: '',
        checklist: [{ id: 'tpl-item-1', text: 'Steps', done: false }]
      }],
      columns: [{
        id: 'col-1',
        title: 'To Do',
        isDone: false,
        wipLimit: 0,
        collapsed: false,
        cards: [{
          id: 'card-1',
          columnId: 'stale-column',
          title: 'Task',
          description: '',
          labels: [],
          assignee: '',
          createdAt: 100,
          updatedAt: 100,
          movedAt: 100,
          due: '',
          checklist: [{ id: 'item-1', text: 'Sketch', done: false }]
        }]
      }],
      archive: {
        cards: [{
          id: 'arch-1',
          columnId: 'col-1',
          title: 'Old',
          createdAt: 200,
          updatedAt: 200,
          movedAt: 200,
          due: '',
          labels: [],
          assignee: '',
          checklist: [{ id: 'a-item', text: 'x', done: true }],
          archivedAt: 300,
          fromColumn: 'To Do'
        }],
        columns: [{
          id: 'arch-col-1',
          title: 'Parked',
          isDone: false,
          wipLimit: 0,
          archivedAt: 400,
          cards: [{
            id: 'ac-card-1',
            columnId: 'stale',
            title: 'Parked task',
            createdAt: 500,
            updatedAt: 500,
            movedAt: 500,
            due: '',
            labels: [],
            assignee: '',
            checklist: []
          }]
        }]
      }
    }]
  };
}

test('a valid version-1 state migrates to version 3', () => {
  const result = Migration.migrateV1(v1Fixture, makeDeps());
  assert.equal(result.version, 3);
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
  assert.equal(result.version, 3);
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
  assert.equal(result.state.version, 3);
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

test('normalized output shares no nested references with the input', () => {
  const raw = stateWithChecklist();
  const result = Migration.normalizeState(raw, makeDeps());
  const rBoard = result.boards[0];
  const rawBoard = raw.boards[0];
  assert.notEqual(rBoard, rawBoard);
  assert.notEqual(rBoard.archive, rawBoard.archive);
  assert.notEqual(rBoard.archive.cards, rawBoard.archive.cards);
  assert.notEqual(rBoard.archive.columns, rawBoard.archive.columns);
  assert.notEqual(rBoard.columns[0].cards[0].checklist, rawBoard.columns[0].cards[0].checklist);
  assert.notEqual(rBoard.columns[0].cards[0].checklist[0], rawBoard.columns[0].cards[0].checklist[0]);
  assert.notEqual(rBoard.templates[0].checklist, rawBoard.templates[0].checklist);
  assert.notEqual(rBoard.templates[0].checklist[0], rawBoard.templates[0].checklist[0]);
  assert.notEqual(rBoard.archive.cards[0].checklist, rawBoard.archive.cards[0].checklist);
  assert.notEqual(rBoard.archive.cards[0].checklist[0], rawBoard.archive.cards[0].checklist[0]);
  assert.notEqual(rBoard.archive.columns[0], rawBoard.archive.columns[0]);
  assert.notEqual(rBoard.archive.columns[0].cards, rawBoard.archive.columns[0].cards);
  assert.notEqual(rBoard.archive.columns[0].cards[0], rawBoard.archive.columns[0].cards[0]);
  assert.notEqual(rBoard.archive.columns[0].cards[0].checklist, rawBoard.archive.columns[0].cards[0].checklist);
});

test('mutating the normalized result leaves the source untouched', () => {
  const raw = stateWithChecklist();
  const originalArchiveLength = raw.boards[0].archive.cards.length;
  const result = Migration.normalizeState(raw, makeDeps());
  result.boards[0].archive.cards.push({ id: 'new' });
  result.boards[0].columns[0].cards[0].checklist[0].done = true;
  result.boards[0].templates[0].checklist[0].text = 'Mutated';
  result.boards[0].archive.columns[0].cards[0].title = 'Mutated';
  assert.equal(raw.boards[0].archive.cards.length, originalArchiveLength);
  assert.equal(raw.boards[0].columns[0].cards[0].checklist[0].done, false);
  assert.equal(raw.boards[0].templates[0].checklist[0].text, 'Steps');
  assert.equal(raw.boards[0].archive.columns[0].cards[0].title, 'Parked task');
});

test('active cards receive their containing column id', () => {
  const result = Migration.normalizeState(stateWithChecklist(), makeDeps());
  assert.equal(result.boards[0].columns[0].cards[0].columnId, 'col-1');
});

test('cards with a stale columnId are repaired during normalization', () => {
  const raw = stateWithChecklist();
  assert.equal(raw.boards[0].columns[0].cards[0].columnId, 'stale-column');
  const result = Migration.normalizeState(raw, makeDeps());
  assert.equal(result.boards[0].columns[0].cards[0].columnId, 'col-1');
});

test('cards with no columnId are repaired during normalization', () => {
  const raw = stateWithChecklist();
  delete raw.boards[0].columns[0].cards[0].columnId;
  const result = Migration.normalizeState(raw, makeDeps());
  assert.equal(result.boards[0].columns[0].cards[0].columnId, 'col-1');
});

test('cards inside archived columns receive the archived column id', () => {
  const raw = stateWithChecklist();
  assert.equal(raw.boards[0].archive.columns[0].cards[0].columnId, 'stale');
  const result = Migration.normalizeState(raw, makeDeps());
  assert.equal(result.boards[0].archive.columns[0].cards[0].columnId, 'arch-col-1');
});

test('archived cards keep their origin column id', () => {
  const result = Migration.normalizeState(stateWithChecklist(), makeDeps());
  assert.equal(result.boards[0].archive.cards[0].columnId, 'col-1');
});

test('checklist items with malformed fields are normalized', () => {
  const raw = stateWithChecklist();
  raw.boards[0].columns[0].cards[0].checklist = [
    { id: 'ok', text: 'Good', done: true },
    { id: 42, text: 123, done: 'yes' },
    { text: 'no id' },
    null,
    'junk'
  ];
  const result = Migration.normalizeState(raw, makeDeps());
  const checklist = result.boards[0].columns[0].cards[0].checklist;
  assert.equal(checklist.length, 3);
  assert.deepEqual(checklist[0], { id: 'ok', text: 'Good', done: true });
  assert.equal(checklist[1].id, 'generated-1');
  assert.equal(checklist[1].text, '');
  assert.equal(checklist[1].done, true);
  assert.equal(checklist[2].id, 'generated-2');
  assert.equal(checklist[2].text, 'no id');
  assert.equal(checklist[2].done, false);
});

test('checklist items with missing ids receive deterministic generated ids', () => {
  const raw = stateWithChecklist();
  raw.boards[0].archive.cards[0].checklist = [{ text: 'Missing id' }];
  const result = Migration.normalizeState(raw, makeDeps());
  assert.equal(result.boards[0].archive.cards[0].checklist[0].id, 'generated-1');
});

test('template checklist items are deep-cloned and normalized', () => {
  const raw = stateWithChecklist();
  raw.boards[0].templates[0].checklist = [{ id: 't-1', text: 'A', done: 1 }, { text: 'B' }];
  const result = Migration.normalizeState(raw, makeDeps());
  const checklist = result.boards[0].templates[0].checklist;
  assert.equal(checklist.length, 2);
  assert.equal(checklist[0].done, true);
  assert.equal(checklist[1].id, 'generated-1');
});

test('normalization preserves archived card fields', () => {
  const result = Migration.normalizeState(stateWithChecklist(), makeDeps());
  const archived = result.boards[0].archive.cards[0];
  assert.equal(archived.archivedAt, 300);
  assert.equal(archived.fromColumn, 'To Do');
  assert.equal(archived.columnId, 'col-1');
  assert.equal(archived.createdAt, 200);
  assert.equal(archived.updatedAt, 200);
  assert.equal(archived.movedAt, 200);
});

test('normalization remains idempotent with checklists and ownership repair', () => {
  const deps = makeDeps();
  const raw = stateWithChecklist();
  raw.boards[0].columns[0].cards[0].checklist.push({ text: 'No id' });
  raw.boards[0].archive.columns[0].cards[0].columnId = 'stale';
  const once = Migration.normalizeState(raw, deps);
  const twice = Migration.normalizeState(once, deps);
  assert.deepEqual(twice, once);
});

test('adoptBoardShape forces cards inside archived columns to the entry id', () => {
  const raw = {
    labels: [],
    columns: [],
    archive: {
      cards: [],
      columns: [{ id: 'arch-1', title: 'Parked', cards: [{ id: 'c-1', columnId: 'stale', title: 'X' }] }]
    }
  };
  const board = Migration.adoptBoardShape(raw, 'Imported', makeDeps());
  assert.equal(board.archive.columns[0].cards[0].columnId, 'arch-1');
});

test('adoptBoardShape replaces non-string archived entry ids with generated string ids', () => {
  const raw = {
    labels: [],
    columns: [],
    archive: {
      cards: [],
      columns: [{ id: 123, title: 'Parked', cards: [{ id: 'c-1', title: 'X' }] }]
    }
  };
  const board = Migration.adoptBoardShape(raw, 'Imported', makeDeps());
  const entry = board.archive.columns[0];
  assert.equal(typeof entry.id, 'string');
  assert.notEqual(entry.id, 123);
  assert.equal(typeof entry.cards[0].columnId, 'string');
  assert.equal(entry.cards[0].columnId, entry.id);
});

test('adoptBoardShape deep-clones checklist items', () => {
  const raw = {
    labels: [],
    columns: [{
      id: 'col-1',
      title: 'To Do',
      cards: [{
        id: 'c-1',
        title: 'X',
        checklist: [{ id: 'i-1', text: 'Step', done: false }]
      }]
    }]
  };
  const board = Migration.adoptBoardShape(raw, 'Imported', makeDeps());
  const item = board.columns[0].cards[0].checklist[0];
  assert.deepEqual(item, { id: 'i-1', text: 'Step', done: false });
  assert.notEqual(item, raw.columns[0].cards[0].checklist[0]);
});

// ---- Version 3 migration coverage ----

const v3Fixture = require('../fixtures/state-v3.json');
const v3MalformedFixture = require('../fixtures/state-v3-malformed.json');
const v2RichFixture = require('../fixtures/state-v2-rich.json');

test('a clean version-3 payload survives normalization unchanged', () => {
  const result = Migration.normalizeState(v3Fixture, makeDeps());
  assert.equal(result.version, 3);
  assert.equal(result.boards[0].id, 'board-1');
  assert.equal(result.boards[0].columns[0].cards[0].id, 'card-1');
  assert.equal(result.inbox.items[0].id, 'in-1');
  assert.equal(result.lenses[0].id, 'lens-1');
  assert.equal(result.recurrences[0].id, 'rec-1');
});

test('v3 normalization keeps valid identifiers and does not regenerate them', () => {
  const deps = makeDeps();
  const result = Migration.normalizeState(v3Fixture, deps);
  assert.equal(result.boards[0].id, 'board-1');
  assert.equal(result.boards[0].columns[0].id, 'col-1');
  assert.equal(result.boards[0].columns[0].cards[0].id, 'card-1');
  assert.equal(result.inbox.items[0].id, 'in-1');
});

test('v3 normalization adds empty inbox lenses and recurrences to legacy state', () => {
  const result = Migration.normalizeState(v2RichFixture, makeDeps());
  assert.equal(result.version, 3);
  assert.deepEqual(result.inbox, { items: [] });
  assert.deepEqual(result.lenses, []);
  assert.deepEqual(result.recurrences, []);
});

test('v2 rich state gains flow settings, roles and policies', () => {
  const result = Migration.normalizeState(v2RichFixture, makeDeps());
  const board = result.boards[0];
  assert.deepEqual(board.flowSettings, {
    staleAfterDays: 7,
    oversizedChecklistThreshold: 10,
    completedReviewAfterDays: 7,
    slePercentile: 0.85,
    manualSleDays: null
  });
  assert.equal(board.columns[0].role, 'queue');
  assert.equal(board.columns[1].role, 'active');
  assert.equal(board.columns[2].role, 'done');
  assert.equal(board.columns[2].isDone, true);
  assert.equal(board.columns[2].policy.wipMode, 'off');
  assert.equal(board.columns[0].policy.wipMode, 'soft');
  assert.deepEqual(board.columns[0].policy.entryCriteria, []);
  assert.equal(board.columns[0].policy.countsTowardCycleTime, true);
});

test('legacy isDone columns normalize to the done role', () => {
  const raw = JSON.parse(JSON.stringify(v2Fixture));
  const result = Migration.normalizeState(raw, makeDeps());
  assert.equal(result.boards[0].columns[0].role, 'queue');
  assert.equal(result.boards[0].columns[1].role, 'active');
  const rawDone = JSON.parse(JSON.stringify(v2Fixture));
  rawDone.boards[0].columns[0].isDone = true;
  const doneResult = Migration.normalizeState(rawDone, makeDeps());
  assert.equal(doneResult.boards[0].columns[0].role, 'done');
});

test('column role is inferred from the title when missing', () => {
  const raw = JSON.parse(JSON.stringify(v2RichFixture));
  raw.boards[0].columns[0].title = 'Backlog';
  const result = Migration.normalizeState(raw, makeDeps());
  assert.equal(result.boards[0].columns[0].role, 'backlog');
  const rawDone = JSON.parse(JSON.stringify(v2RichFixture));
  rawDone.boards[0].columns[0].title = 'Shipped';
  assert.equal(Migration.normalizeState(rawDone, makeDeps()).boards[0].columns[0].role, 'done');
});

test('v2 cards gain priority size lifecycle flow and dependency defaults', () => {
  const result = Migration.normalizeState(v2RichFixture, makeDeps());
  const card = result.boards[0].columns[0].cards[0];
  assert.equal(card.priority, 'none');
  assert.equal(card.size, 'none');
  assert.equal(card.startedAt, null);
  assert.equal(card.completedAt, null);
  assert.deepEqual(card.flow, { state: 'normal', reason: '', since: null, periods: [] });
  assert.deepEqual(card.dependencies, { blockers: [], related: [] });
  assert.equal(card.recurrenceId, null);
  assert.deepEqual(card.transitions, []);
});

test('v1 migration produces a full version-3 state', () => {
  const result = Migration.migrateV1(v1Fixture, makeDeps());
  assert.equal(result.version, 3);
  assert.deepEqual(result.inbox, { items: [] });
  assert.deepEqual(result.lenses, []);
  assert.deepEqual(result.recurrences, []);
});

test('malformed v3 inbox items are normalized and deduplicated', () => {
  const result = Migration.normalizeState(v3MalformedFixture, makeDeps());
  const items = result.inbox.items;
  assert.equal(items.length, 3);
  assert.equal(items[0].id, 'in-1');
  assert.equal(items[0].title, 'Valid inbox item');
  assert.equal(items[0].url, 'javascript:alert(1)');
  assert.equal(typeof items[1].id, 'string');
  assert.equal(items[1].title, '');
  assert.equal(items[2].title, 'No id here');
});

test('malformed lenses are normalized to safe shapes', () => {
  const result = Migration.normalizeState(v3MalformedFixture, makeDeps());
  assert.equal(result.lenses.length, 2);
  const first = result.lenses[0];
  assert.equal(first.scope, 'selected-boards');
  assert.deepEqual(first.boardIds, ['board-1']);
  assert.deepEqual(first.query.priorities, []);
  assert.equal(first.query.due, 'any');
  assert.equal(first.sort.field, 'manual');
  assert.equal(first.sort.direction, 'desc');
  assert.equal(first.display.density, 'comfortable');
  assert.equal(first.display.groupBy, 'board');
  assert.equal(result.lenses[1].scope, 'all-boards');
  assert.equal(result.lenses[1].name, 'Lens');
});

test('malformed recurrences are normalized to safe shapes', () => {
  const result = Migration.normalizeState(v3MalformedFixture, makeDeps());
  const rec = result.recurrences.find(r => r.id === 'rec-1');
  assert.equal(rec.mode, 'scheduled');
  assert.equal(rec.schedule.frequency, 'weekly');
  assert.equal(rec.schedule.interval, 1);
  assert.deepEqual(rec.schedule.weekdays, []);
  assert.equal(rec.overlapPolicy, 'single-active');
  assert.equal(rec.missedPolicy, 'create-one');
  assert.equal(rec.template.priority, 'none');
  assert.equal(rec.template.checklist.length, 1);
  assert.equal(rec.template.checklist[0].done, true);
  const rec2 = result.recurrences.find(r => r.id === 'rec-2');
  assert.equal(rec2.enabled, false);
  assert.equal(rec2.mode, 'after-completion');
  assert.equal(rec2.schedule.delayAfterCompletionDays, 7);
});

test('broken dependency references are removed during v3 normalization', () => {
  const result = Migration.normalizeState(v3MalformedFixture, makeDeps());
  const card = result.boards[0].columns[0].cards[0];
  assert.deepEqual(card.dependencies.blockers, [
    { boardId: 'board-1', cardId: 'card-2' }
  ]);
  assert.deepEqual(card.dependencies.related, [{ boardId: 'board-1', cardId: 'card-3' }]);
});

test('self references are removed during v3 normalization', () => {
  const result = Migration.normalizeState(v3MalformedFixture, makeDeps());
  const card = result.boards[0].columns[0].cards[0];
  assert.ok(card.dependencies.blockers.every(b => b.cardId !== 'card-1'));
});

test('v3 normalization repairs stale columnId ownership', () => {
  const result = Migration.normalizeState(v3MalformedFixture, makeDeps());
  assert.equal(result.boards[0].columns[0].cards[0].columnId, 'col-1');
});

test('malformed priority size and flow values are clamped', () => {
  const result = Migration.normalizeState(v3MalformedFixture, makeDeps());
  const card = result.boards[0].columns[0].cards[0];
  assert.equal(card.priority, 'urgent');
  assert.equal(card.size, 'none');
  assert.equal(card.startedAt, null);
  assert.equal(card.flow.state, 'normal');
  assert.equal(card.flow.since, 99);
  assert.equal(card.flow.periods.length, 1);
  assert.equal(card.flow.periods[0].reason, 'x');
  assert.equal(card.recurrenceId, 'rec-1');
  assert.equal(card.transitions.length, 1);
  assert.equal(card.transitions[0].toRole, 'backlog');
});

test('invalid flow periods and transitions are dropped', () => {
  const result = Migration.normalizeState(v3MalformedFixture, makeDeps());
  const card = result.boards[0].columns[0].cards[0];
  assert.equal(card.transitions[0].at, 10);
});

test('v3 normalization keeps archived dependency references', () => {
  const result = Migration.normalizeState(v3MalformedFixture, makeDeps());
  const archived = result.boards[0].archive.cards[0];
  assert.deepEqual(archived.dependencies.blockers, [{ boardId: 'board-1', cardId: 'card-2' }]);
});

test('v3 normalization is idempotent on malformed payloads', () => {
  const deps = makeDeps();
  const once = Migration.normalizeState(v3MalformedFixture, deps);
  const twice = Migration.normalizeState(once, deps);
  assert.deepEqual(twice, once);
});

test('v3 normalization never throws on deeply malformed data', () => {
  const nasty = {
    version: 3,
    boards: [null, 'junk', { id: 5, columns: [{ cards: [null] }] }],
    inbox: { items: [null, { title: 5 }] },
    lenses: [null, 5],
    recurrences: [null, { template: null, schedule: null }]
  };
  const result = Migration.normalizeState(nasty, makeDeps());
  assert.equal(result.version, 3);
  assert.ok(Array.isArray(result.boards));
  assert.ok(Array.isArray(result.inbox.items));
});

test('normalizeState produces a usable default board when recovery is impossible', () => {
  const result = Migration.normalizeState(null, makeDeps());
  assert.equal(result.version, 3);
  assert.deepEqual(result.boards, []);
  assert.equal(result.activeBoardId, '');
  const again = Migration.normalizeState(undefined, makeDeps());
  assert.deepEqual(again, result);
});

test('v3 normalization supports missing inbox', () => {
  const raw = JSON.parse(JSON.stringify(v2RichFixture));
  const result = Migration.normalizeState(raw, makeDeps());
  assert.deepEqual(result.inbox, { items: [] });
});

test('recurrence active-card references to deleted cards are cleared', () => {
  const raw = JSON.parse(JSON.stringify(v3Fixture));
  raw.boards[0].columns[0].cards = raw.boards[0].columns[0].cards.filter(c => c.id !== 'card-1');
  const result = Migration.normalizeState(raw, makeDeps());
  assert.equal(result.recurrences[0].activeCardRef, null);
});

test('lens scopes referencing deleted boards are cleaned', () => {
  const raw = JSON.parse(JSON.stringify(v3Fixture));
  raw.boards = raw.boards.filter(b => b.id !== 'board-1');
  const result = Migration.normalizeState(raw, makeDeps());
  assert.equal(result.lenses[0].boardIds.length, 0);
  assert.equal(result.activeBoardId, '');
});

test('v3 board-only import rewrites internal dependency references', () => {
  const boardJson = JSON.stringify({
    id: 'board-1',
    name: 'Board',
    labels: [],
    templates: [],
    columns: [{
      id: 'col-1',
      title: 'To Do',
      isDone: false,
      cards: [
        { id: 'c-1', title: 'A', columnId: 'col-1', dependencies: { blockers: [{ boardId: 'board-1', cardId: 'c-2' }] } },
        { id: 'c-2', title: 'B', columnId: 'col-1', dependencies: { blockers: [{ boardId: 'other-board', cardId: 'x' }] } }
      ]
    }],
    archive: { cards: [], columns: [] }
  });
  const result = Migration.parseImportPayload(boardJson, null, makeDeps());
  assert.equal(result.kind, 'board');
  const board = result.board;
  const cardA = board.columns[0].cards[0];
  assert.deepEqual(cardA.dependencies.blockers, [{ boardId: board.id, cardId: 'c-2' }]);
  assert.deepEqual(board.columns[0].cards[1].dependencies.blockers, []);
});

test('v3 board import preserves flow settings and policies', () => {
  const boardJson = JSON.stringify({
    id: 'b-9',
    name: 'Board',
    flowSettings: { staleAfterDays: 3, manualSleDays: 12 },
    labels: [],
    templates: [],
    columns: [{ id: 'col-1', title: 'To Do', isDone: false, role: 'queue', policy: { wipMode: 'hard', entryCriteria: ['Ready'] } }],
    archive: { cards: [], columns: [] }
  });
  const result = Migration.parseImportPayload(boardJson, null, makeDeps());
  assert.equal(result.board.flowSettings.staleAfterDays, 3);
  assert.equal(result.board.flowSettings.manualSleDays, 12);
  assert.equal(result.board.columns[0].policy.wipMode, 'hard');
  assert.deepEqual(result.board.columns[0].policy.entryCriteria, ['Ready']);
});

test('v3 full-backup import preserves inbox lenses and recurrences', () => {
  const result = Migration.parseImportPayload(JSON.stringify(v3Fixture), null, makeDeps());
  assert.equal(result.kind, 'all');
  assert.equal(result.state.inbox.items.length, 1);
  assert.equal(result.state.lenses.length, 1);
  assert.equal(result.state.recurrences.length, 1);
});

test('board-only import adopts recurrences with fresh ids', () => {
  const boardJson = JSON.stringify({
    id: 'b-9',
    name: 'Board',
    labels: [],
    templates: [],
    columns: [{ id: 'col-1', title: 'To Do', isDone: false }],
    archive: { cards: [], columns: [] },
    recurrences: [{
      id: 'rec-x',
      enabled: true,
      mode: 'scheduled',
      schedule: { frequency: 'daily', interval: 1 },
      target: { boardId: 'b-9', columnId: 'col-1' },
      template: { title: 'Standup', priority: 'none', size: 'none', checklist: [] },
      overlapPolicy: 'single-active',
      missedPolicy: 'create-one',
      activeCardRef: { boardId: 'b-9', cardId: 'card-9' }
    }]
  });
  const result = Migration.parseImportPayload(boardJson, null, makeDeps());
  const board = result.board;
  assert.equal(board.importedRecurrences.length, 1);
  const rec = board.importedRecurrences[0];
  assert.notEqual(rec.id, 'rec-x');
  assert.equal(rec.target.boardId, board.id);
  assert.equal(rec.activeCardRef.boardId, board.id);
});

test('board-only import adopts scoped lenses and skips others', () => {
  const boardJson = JSON.stringify({
    id: 'b-9',
    name: 'Board',
    labels: [],
    templates: [],
    columns: [{ id: 'col-1', title: 'To Do', isDone: false }],
    archive: { cards: [], columns: [] },
    lenses: [
      { id: 'l-1', name: 'Mine', scope: 'active-board' },
      { id: 'l-2', name: 'Selected', scope: 'selected-boards', boardIds: ['b-9'] },
      { id: 'l-3', name: 'Multi', scope: 'selected-boards', boardIds: ['b-9', 'other'] }
    ]
  });
  const result = Migration.parseImportPayload(boardJson, null, makeDeps());
  assert.equal(result.board.importedLenses.length, 2);
  assert.ok(result.board.importedLenses.every(l => l.id !== 'l-1' && l.id !== 'l-2'));
});
