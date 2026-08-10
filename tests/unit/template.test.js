const { test } = require('node:test');
const assert = require('node:assert/strict');
const Template = require('../../js/core/template.js');

const NOW = new Date(2026, 7, 12, 10, 0).getTime();
let counter = 0;
function uid() { counter += 1; return 'id-' + counter; }
function deps() { return { uid: uid, now: function () { return NOW; } }; }

function sampleBoard() {
  return {
    id: 'b1',
    name: 'Client Kickoff',
    flowSettings: { staleAfterDays: 7 },
    labels: [
      { id: 'l1', name: 'Client', color: '#2a58c4' },
      { id: 'l2', name: 'Urgent', color: '#a34800' }
    ],
    templates: [],
    columns: [
      {
        id: 'c1', title: 'To Do', role: 'queue', isDone: false, wipLimit: 0, collapsed: false,
        policy: { wipMode: 'off', overrideRequiresReason: false, entryCriteria: [], exitCriteria: [], defaultLabelIds: [], defaultAssignee: '', countsTowardCycleTime: true },
        cards: [
          { id: 'k1', columnId: 'c1', title: 'Kickoff call', description: 'Intro', labels: ['l1'], checklist: [{ id: 'x', text: 'Prep agenda', done: true }], priority: 'high', size: 's', startedAt: NOW, completedAt: null, flow: { state: 'normal' } }
        ]
      },
      {
        id: 'c2', title: 'Done', role: 'done', isDone: true, wipLimit: 2, collapsed: false,
        policy: { wipMode: 'hard', overrideRequiresReason: true, entryCriteria: ['Has client sign-off'], exitCriteria: [], defaultLabelIds: ['l2'], defaultAssignee: 'Sam', countsTowardCycleTime: true },
        cards: []
      }
    ],
    archive: { cards: [], columns: [] }
  };
}

function baseState() {
  return {
    version: 3, theme: 'dark', activeBoardId: '', inbox: { items: [] },
    lenses: [], recurrences: [], dayplans: {}, focusDays: {}, focusSession: null,
    streaks: { best: 0, lastSeen: null }, templates: [], boards: []
  };
}

// ---- snapshotBoard ---------------------------------------------------------

test('snapshotBoard captures structure and strips lifecycle data', () => {
  const tpl = Template.snapshotBoard(sampleBoard(), { name: 'My Template', description: 'For new clients', includeStarterCards: true });
  assert.equal(tpl.name, 'My Template');
  assert.equal(tpl.description, 'For new clients');
  assert.equal(tpl.columns.length, 2);
  const done = tpl.columns.find(c => c.title === 'Done');
  assert.equal(done.role, 'done');
  assert.equal(done.wipLimit, 2);
  assert.equal(done.wipMode, 'hard');
  assert.deepEqual(done.entryCriteria, ['Has client sign-off']);
  assert.deepEqual(done.defaultLabelIds, ['l2']);
  assert.equal(done.defaultAssignee, 'Sam');
  assert.equal(tpl.boardMeta.labels.length, 2);
  // Starter card: structural fields only.
  const kickoff = tpl.starterCards.find(c => c.title === 'Kickoff call');
  assert.equal(kickoff.columnTitle, 'To Do');
  assert.equal(kickoff.priority, 'high');
  assert.deepEqual(kickoff.checklist, [{ text: 'Prep agenda', done: true }]);
  assert.equal(kickoff.startedAt, undefined);
  assert.equal(kickoff.completedAt, undefined);
  assert.equal(kickoff.flow, undefined);
});

test('snapshotBoard works with zero cards and honors includeStarterCards=false', () => {
  const board = { id: 'b', name: 'Empty', labels: [], columns: [{ id: 'c', title: 'To Do', role: 'queue', cards: [] }], archive: { cards: [], columns: [] } };
  const tpl = Template.snapshotBoard(board, { includeStarterCards: false });
  assert.equal(tpl.starterCards.length, 0);
  const withCards = Template.snapshotBoard(board, { includeStarterCards: true });
  assert.equal(withCards.starterCards.length, 0);
});

// ---- validateTemplate ------------------------------------------------------

test('validateTemplate normalizes a full payload and drops unknown fields', () => {
  const tpl = Template.snapshotBoard(sampleBoard(), { name: 'X' });
  const bad = Object.assign({}, tpl, { name: '', bogus: true });
  bad.columns[0].wipMode = 'nope';
  const out = Template.validateTemplate(bad);
  assert.equal(out.name, 'Board template'); // defaulted
  assert.equal(out.bogus, undefined);      // dropped
  assert.equal(out.columns[0].wipMode, 'off');
  assert.equal(out.version, 1);
});

test('validateTemplate round-trips a clean snapshot stably', () => {
  const tpl = Template.snapshotBoard(sampleBoard(), { name: 'Stable' });
  const once = Template.validateTemplate(tpl);
  const twice = Template.validateTemplate(once);
  assert.deepEqual(once, twice);
});

test('validateTemplate rejects non-objects', () => {
  assert.equal(Template.validateTemplate(null), null);
  assert.equal(Template.validateTemplate('x'), null);
});

// ---- materializeTemplate ---------------------------------------------------

test('materializeTemplate builds a fresh board with new IDs and starter cards', () => {
  const tpl = Template.validateTemplate(Template.snapshotBoard(sampleBoard(), { name: 'Stamp' }));
  const state = baseState();
  const result = Template.materializeTemplate(state, tpl, { name: 'New Client' }, deps());
  assert.equal(result.board.name, 'New Client');
  assert.equal(result.columns.length, 2);
  const done = result.columns.find(c => c.role === 'done');
  assert.equal(done.wipLimit, 2);
  assert.equal(done.policy.wipMode, 'hard');
  assert.deepEqual(done.policy.entryCriteria, ['Has client sign-off']);
  assert.equal(done.policy.defaultLabelIds.length, 1); // remapped to a fresh id
  assert.equal(done.policy.defaultAssignee, 'Sam');
  assert.equal(result.board.labels.length, 2);
  const todo = result.columns.find(c => c.role === 'queue');
  assert.equal(todo.cards.length, 1);
  assert.equal(todo.cards[0].title, 'Kickoff call');
  assert.equal(todo.cards[0].startedAt, null);
  assert.equal(todo.cards[0].completedAt, null);
});

test('materializeTemplate remaps label ids to the fresh board', () => {
  const tpl = Template.validateTemplate(Template.snapshotBoard(sampleBoard(), { name: 'Stamp' }));
  const result = Template.materializeTemplate(baseState(), tpl, {}, deps());
  const done = result.columns.find(c => c.role === 'done');
  // The template's defaultLabelIds pointed at the SOURCE board's label ids;
  // materialization must remap them to the fresh board's label ids.
  const freshIds = result.board.labels.map(l => l.id);
  assert.ok(done.policy.defaultLabelIds.every(id => freshIds.indexOf(id) !== -1));
  const todo = result.columns.find(c => c.role === 'queue');
  const cardLabel = todo.cards[0].labels[0];
  assert.ok(freshIds.indexOf(cardLabel) !== -1);
});

test('materializeTemplate is pure: fresh IDs per call, template untouched', () => {
  const tpl = Template.validateTemplate(Template.snapshotBoard(sampleBoard(), { name: 'Stamp' }));
  const tplSnapshot = JSON.stringify(tpl);
  const a = Template.materializeTemplate(baseState(), tpl, {}, deps());
  const b = Template.materializeTemplate(baseState(), tpl, {}, deps());
  assert.notEqual(a.board.id, b.board.id);
  assert.notEqual(a.columns[0].id, b.columns[0].id);
  assert.notEqual(a.columns[0].cards[0].id, b.columns[0].cards[0].id);
  assert.equal(JSON.stringify(tpl), tplSnapshot);
});

test('materializeTemplate pushes the board into the returned state', () => {
  const tpl = Template.validateTemplate(Template.snapshotBoard(sampleBoard(), { name: 'Stamp' }));
  const result = Template.materializeTemplate(baseState(), tpl, {}, deps());
  assert.equal(result.changed, true);
  assert.equal(result.state.boards.length, 1);
  assert.equal(result.state.activeBoardId, result.board.id);
});
