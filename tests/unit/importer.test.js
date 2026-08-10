const { test } = require('node:test');
const assert = require('node:assert/strict');
const Importer = require('../../js/core/importer.js');
const Exporter = require('../../js/core/exporter.js');

function uid(prefix) {
  let n = 0;
  return function () { n += 1; return (prefix || 'id') + '-' + n; };
}
const NOW = new Date(2026, 7, 12, 10, 0).getTime();
const deps = { uid: uid('imp'), now: function () { return NOW; } };

function todoistFixture() {
  return JSON.stringify({
    projects: [{ id: 1, name: 'Work' }],
    sections: [
      { id: 10, project_id: 1, name: 'In Progress' },
      { id: 11, project_id: 1, name: 'Done' }
    ],
    items: [
      { id: 100, project_id: 1, section_id: 10, content: 'Ship release', description: 'Deploy to prod', due: { date: '2026-08-15' }, priority: 1, labels: [1], checked: 0 },
      { id: 101, project_id: 1, section_id: 10, content: 'Fix auth bug', priority: 2, labels: [2], parent_id: 100, checked: 0 },
      { id: 102, project_id: 1, section_id: 11, content: 'Old task done', priority: 4, labels: [], checked: 1 },
      { id: 103, project_id: 1, section_id: null, content: 'Weekly review', due: { is_recurring: true, string: 'every week' }, checked: 0 }
    ],
    labels: [{ id: 1, name: 'Release' }, { id: 2, name: 'Bug' }]
  });
}

function baseState() {
  return {
    version: 3,
    theme: 'dark',
    activeBoardId: '',
    inbox: { items: [] },
    lenses: [],
    recurrences: [],
    dayplans: {},
    focusDays: {},
    focusSession: null,
    streaks: { best: 0, lastSeen: null },
    boards: []
  };
}

// ---- detectFormat ----------------------------------------------------------

test('detectFormat classifies Todoist, Trello, CSV and unknown', () => {
  assert.equal(Importer.detectFormat(todoistFixture(), 'todoist.json').format, 'todoist');
  const trello = JSON.stringify({ lists: [{ id: 'l1', name: 'To Do' }], cards: [{ id: 'c1', name: 'Task', idList: 'l1' }] });
  assert.equal(Importer.detectFormat(trello, 'trello.json').format, 'trello');
  assert.equal(Importer.detectFormat('Title,Due Date\nA,2026-01-01\n', 'tasks.csv').format, 'csv');
  assert.equal(Importer.detectFormat('garbage', 'x.txt').format, 'unknown');
  assert.equal(Importer.detectFormat('', 'x.json').format, 'unknown');
});

// ---- Todoist parsing -------------------------------------------------------

test('Todoist parse maps sections to columns and fields faithfully', () => {
  const inter = Importer.parseSource(todoistFixture(), 'todoist');
  const board = inter.boards[0];
  assert.equal(board.name, 'Work');
  assert.deepEqual(board.columns.map(c => c.name), ['In Progress', 'Done']);
  const ship = board.cards.find(c => c.title === 'Ship release');
  assert.equal(ship.columnName, 'In Progress');
  assert.equal(ship.due, '2026-08-15');
  assert.equal(ship.priority, 'urgent'); // Todoist p1
  assert.deepEqual(ship.labels, ['Release']);
  assert.equal(ship.description, 'Deploy to prod');
  const done = board.cards.find(c => c.title === 'Old task done');
  assert.equal(done.columnName, 'Done');
  assert.equal(done.priority, 'low'); // Todoist p4
});

test('Todoist subtasks fold into a parent checklist with a warning issue', () => {
  const inter = Importer.parseSource(todoistFixture(), 'todoist');
  const board = inter.boards[0];
  const ship = board.cards.find(c => c.title === 'Ship release');
  assert.deepEqual(ship.checklist, [{ text: 'Fix auth bug', done: false }]);
  assert.ok(!board.cards.some(c => c.title === 'Fix auth bug'));
  assert.ok(inter.issues.some(i => i.severity === 'warn' && /Subtask/.test(i.message)));
});

test('Todoist recurrence strings map onto the schedule model', () => {
  const inter = Importer.parseSource(todoistFixture(), 'todoist');
  const rec = inter.boards[0].cards.find(c => c.title === 'Weekly review');
  assert.deepEqual(rec.recurrence, { frequency: 'weekly', interval: 1, weekdays: [], dayOfMonth: null });
  assert.deepEqual(Importer.parseRecurrenceString('every day'), { frequency: 'daily', interval: 1, weekdays: [], dayOfMonth: null });
  assert.deepEqual(Importer.parseRecurrenceString('every 2 weeks'), { frequency: 'weekly', interval: 2, weekdays: [], dayOfMonth: null });
  assert.deepEqual(Importer.parseRecurrenceString('every monday and thursday'), { frequency: 'weekly', interval: 1, weekdays: [1, 4], dayOfMonth: null });
  assert.deepEqual(Importer.parseRecurrenceString('every month'), { frequency: 'monthly', interval: 1, weekdays: [], dayOfMonth: null });
  assert.equal(Importer.parseRecurrenceString('every other tuesday at noon'), null);
});

// ---- CSV parsing -----------------------------------------------------------

test('CSV parse handles quoted commas, newlines and status mapping', () => {
  const csv = 'Title,Due Date,Priority,Labels,Status,Notes\n' +
    '"Fix, the bug","2026-08-20",High,"bug;ui",Completed,"needs attention"\n' +
    '"Write\nTests",,Medium,,In progress,';
  const inter = Importer.parseSource(csv, 'csv');
  const cards = inter.boards[0].cards;
  assert.equal(cards.length, 2);
  const fixed = cards[0];
  assert.equal(fixed.title, 'Fix, the bug');
  assert.equal(fixed.due, '2026-08-20');
  assert.equal(fixed.priority, 'high');
  assert.deepEqual(fixed.labels, ['bug', 'ui']);
  assert.equal(fixed.columnName, 'Done'); // Completed status
  assert.equal(cards[1].title, 'Write\nTests');
  assert.equal(cards[1].columnName, 'In Progress');
  assert.equal(inter.boards[0].columns.some(c => c.name === 'Done'), true);
});

test('CSV without a title column reports a blocking issue', () => {
  const inter = Importer.parseSource('Widget,Whatever\nA,B\n', 'csv');
  assert.equal(inter.boards.length, 0);
  assert.ok(inter.issues.some(i => i.severity === 'error' && /Title/.test(i.message)));
});

// ---- mapping ---------------------------------------------------------------

test('mapStructure infers roles and honors overrides', () => {
  const inter = Importer.parseSource(todoistFixture(), 'todoist');
  const mapped = Importer.mapStructure(inter, { columnRoles: { Done: 'queue' } });
  const cols = mapped.boards[0].columns;
  assert.equal(cols.find(c => c.name === 'In Progress').role, 'active');
  assert.equal(cols.find(c => c.name === 'Done').role, 'queue'); // override wins
});

test('inferRole maps common kanban column names', () => {
  assert.equal(Importer.inferRole('Backlog'), 'queue');
  assert.equal(Importer.inferRole('To Do'), 'queue');
  assert.equal(Importer.inferRole('In Progress'), 'active');
  assert.equal(Importer.inferRole('Doing'), 'active');
  assert.equal(Importer.inferRole('Done'), 'done');
  assert.equal(Importer.inferRole('Delivered'), 'done');
  assert.equal(Importer.inferRole('Random'), 'queue');
});

// ---- applyImport -----------------------------------------------------------

test('applyImport creates boards through the pipeline atomically', () => {
  const inter = Importer.parseSource(todoistFixture(), 'todoist');
  const mapped = Importer.mapStructure(inter, {});
  const result = Importer.applyImport(baseState(), mapped, deps);
  assert.equal(result.changed, true);
  assert.equal(result.state.boards.length, 1);
  const board = result.state.boards[0];
  assert.equal(board.name, 'Work');
  assert.deepEqual(board.columns.map(c => c.role), ['active', 'done']);
  const allCards = board.columns.reduce((acc, c) => acc.concat(c.cards), []);
  assert.equal(allCards.length, 3); // subtask folded into checklist
  const ship = allCards.find(c => c.title === 'Ship release');
  assert.equal(ship.priority, 'urgent');
  assert.equal(ship.due, '2026-08-15');
  assert.deepEqual(ship.checklist.map(i => i.text), ['Fix auth bug']);
  assert.equal(ship.labels.length, 1);
  // Done column card gets completedAt via the lifecycle transition.
  const done = allCards.find(c => c.title === 'Old task done');
  assert.equal(typeof done.completedAt, 'number');
  // Recurrence entity created for the weekly card.
  assert.equal(result.state.recurrences.length, 1);
  assert.equal(result.state.recurrences[0].schedule.frequency, 'weekly');
});

test('applyImport is deterministic and does not mutate inputs', () => {
  const inter = Importer.parseSource(todoistFixture(), 'todoist');
  const mapped = Importer.mapStructure(inter, {});
  const snapshot = JSON.stringify(baseState());
  function freshDeps() {
    let counter = 0;
    return { uid: function () { counter += 1; return 'det-' + counter; }, now: function () { return NOW; } };
  }
  const a = Importer.applyImport(baseState(), mapped, freshDeps());
  const b = Importer.applyImport(baseState(), mapped, freshDeps());
  assert.deepEqual(a.state, b.state);
  assert.equal(JSON.stringify(baseState()), snapshot);
});

test('applyImport reports nothing-created when the source is empty', () => {
  const mapped = { boards: [{ name: 'Empty', columns: [{ name: 'To Do', role: 'queue' }], cards: [] }], issues: [] };
  const result = Importer.applyImport(baseState(), mapped, deps);
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'nothing-created');
});

// ---- exporter --------------------------------------------------------------

function sampleBoard() {
  return {
    name: 'My Board',
    labels: [{ id: 'l1', name: 'Bug', color: '#c81e14' }],
    columns: [
      { title: 'To Do', role: 'queue', cards: [
        { title: 'Quoted, "card"', due: '2026-08-15', priority: 'high', labels: ['l1'], assignee: 'Sam', description: 'Line one\nLine two', checklist: [{ text: 'a', done: true }, { text: 'b', done: false }] }
      ] },
      { title: 'Done', role: 'done', cards: [
        { title: 'Shipped', due: '', priority: 'none', labels: [], assignee: '', description: '', checklist: [], completedAt: 100 }
      ] }
    ]
  };
}

test('exportCsv escapes quotes, commas and newlines', () => {
  const csv = Exporter.exportCsv(sampleBoard());
  const records = Importer.parseCsv(csv);
  assert.equal(records.length, 3); // header + 2 cards
  assert.deepEqual(records[0], ['Title', 'Do Date', 'Due Date', 'Priority', 'Labels', 'Assignee', 'Status', 'Notes']);
  const quoted = records[1];
  assert.equal(quoted[0], 'Quoted, "card"');
  assert.equal(quoted[2], '2026-08-15');
  assert.equal(quoted[6], 'In progress'); // queue column role -> status
  assert.match(quoted[7], /\[x\] a/);     // checklist embedded in notes
  assert.match(quoted[7], /Line one\nLine two/);
  const shipped = records[2];
  assert.equal(shipped[0], 'Shipped');
  assert.equal(shipped[6], 'Completed'); // done column role -> status
});

test('exportCsv round-trips through the CSV parser', () => {
  const csv = Exporter.exportCsv(sampleBoard());
  const inter = Importer.parseSource(csv, 'csv');
  const cards = inter.boards[0].cards;
  const quoted = cards.find(c => c.title === 'Quoted, "card"');
  assert.ok(quoted);
  assert.equal(quoted.columnName, 'In Progress'); // status In progress -> active column
  assert.equal(quoted.priority, 'high');
  assert.deepEqual(quoted.labels, ['Bug']);
  const shipped = cards.find(c => c.title === 'Shipped');
  assert.equal(shipped.columnName, 'Done'); // status Completed -> done column
});

test('exportMarkdown renders headings, chips and checklists', () => {
  const md = Exporter.exportMarkdown(sampleBoard());
  assert.match(md, /^# My Board/);
  assert.match(md, /## To Do/);
  assert.match(md, /## Done/);
  assert.match(md, /- Quoted, "card" \(due 2026-08-15, high, #Bug\)/);
  assert.match(md, /- \[x\] a/);
  assert.match(md, /- \[ \] b/);
  assert.match(md, /- Shipped/);
});

test('csvEscape guards nulls and empty values', () => {
  assert.equal(Exporter.csvEscape(null), '');
  assert.equal(Exporter.csvEscape(''), '');
  assert.equal(Exporter.csvEscape('plain'), 'plain');
  assert.equal(Exporter.csvEscape('a,b'), '"a,b"');
  assert.equal(Exporter.csvEscape('say "hi"'), '"say ""hi"""');
});
