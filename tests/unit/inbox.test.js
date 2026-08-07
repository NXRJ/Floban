const { test } = require('node:test');
const assert = require('node:assert/strict');
const Inbox = require('../../js/core/inbox.js');

function makeDeps() {
  let n = 0;
  return {
    uid: () => 'in-' + (++n),
    now: () => 1000
  };
}

function state() {
  return {
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
          { id: 'col-1', title: 'To Do', role: 'queue', isDone: false, cards: [] }
        ],
        archive: { cards: [], columns: [] }
      }
    ]
  };
}

test('captureItem stores a title with timestamps', () => {
  const result = Inbox.captureItem(state(), { title: 'Call the dentist' }, makeDeps());
  assert.equal(result.changed, true);
  const item = result.state.inbox.items[0];
  assert.equal(item.title, 'Call the dentist');
  assert.equal(item.capturedAt, 1000);
  assert.equal(item.updatedAt, 1000);
  assert.equal(item.url, '');
});

test('captureItem rejects empty captures', () => {
  const result = Inbox.captureItem(state(), { title: '   ' }, makeDeps());
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'empty-capture');
});

test('captureItem detects safe URLs', () => {
  const result = Inbox.captureItem(state(), { title: 'https://example.com/docs' }, makeDeps());
  const item = result.state.inbox.items[0];
  assert.equal(item.url, 'https://example.com/docs');
  assert.equal(item.title, 'Link: example.com');
});

test('captureItem rejects unsafe URL schemes', () => {
  const result = Inbox.captureItem(state(), { title: 'javascript:alert(1)' }, makeDeps());
  const item = result.state.inbox.items[0];
  assert.equal(item.url, '');
  assert.equal(item.title, 'javascript:alert(1)');
});

test('captureLines splits lines and ignores blanks', () => {
  const result = Inbox.captureLines(state(), 'First\n\n  \nSecond\nThird', makeDeps());
  assert.equal(result.changed, true);
  assert.deepEqual(result.state.inbox.items.map(i => i.title), ['First', 'Second', 'Third']);
});

test('captureLines detects a URL line', () => {
  const result = Inbox.captureLines(state(), 'https://example.com/page\nNote line', makeDeps());
  const items = result.state.inbox.items;
  assert.equal(items[0].url, 'https://example.com/page');
  assert.equal(items[1].title, 'Note line');
});

test('captureLines with only blank lines is a no-op', () => {
  const result = Inbox.captureLines(state(), ' \n\n  ', makeDeps());
  assert.equal(result.changed, false);
});

test('updateInboxItem patches fields and refreshes updatedAt', () => {
  const s = state();
  const captured = Inbox.captureItem(s, { title: 'A' }, makeDeps());
  const updated = Inbox.updateInboxItem(captured.state, captured.value.id, { note: 'Extra' }, makeDeps());
  assert.equal(updated.changed, true);
  assert.equal(updated.state.inbox.items[0].note, 'Extra');
  assert.equal(updated.state.inbox.items[0].updatedAt, 1000);
});

test('updateInboxItem with no changes is a no-op', () => {
  const s = state();
  const captured = Inbox.captureItem(s, { title: 'A' }, makeDeps());
  const updated = Inbox.updateInboxItem(captured.state, captured.value.id, { title: 'A' }, makeDeps());
  assert.equal(updated.changed, false);
});

test('deleteInboxItem removes the item', () => {
  const s = state();
  const captured = Inbox.captureItem(s, { title: 'A' }, makeDeps());
  const deleted = Inbox.deleteInboxItem(captured.state, captured.value.id);
  assert.equal(deleted.changed, true);
  assert.deepEqual(deleted.state.inbox.items, []);
});

test('triageInboxItem is atomic: one card created, one item removed', () => {
  const s = state();
  const captured = Inbox.captureItem(s, { title: 'Triage me', note: 'Context here' }, makeDeps());
  const triaged = Inbox.triageInboxItem(captured.state, captured.value.id, { boardId: 'board-1', columnId: 'col-1' }, {}, makeDeps());
  assert.equal(triaged.changed, true);
  assert.deepEqual(triaged.state.inbox.items, []);
  const card = triaged.state.boards[0].columns[0].cards[0];
  assert.equal(card.title, 'Triage me');
  assert.equal(card.description, 'Context here');
});

test('triage applies card patches', () => {
  const s = state();
  const captured = Inbox.captureItem(s, { title: 'Triage me' }, makeDeps());
  const triaged = Inbox.triageInboxItem(captured.state, captured.value.id, { boardId: 'board-1', columnId: 'col-1' }, {
    title: 'Renamed',
    priority: 'high',
    size: 'l',
    assignee: 'Sam',
    due: '2026-09-01',
    labels: ['l-1']
  }, makeDeps());
  const card = triaged.state.boards[0].columns[0].cards[0];
  assert.equal(card.title, 'Renamed');
  assert.equal(card.priority, 'high');
  assert.equal(card.size, 'l');
  assert.equal(card.assignee, 'Sam');
  assert.equal(card.due, '2026-09-01');
  assert.deepEqual(card.labels, ['l-1']);
});

test('triage embeds the source URL into the card description', () => {
  const s = state();
  const captured = Inbox.captureItem(s, { title: 'https://example.com/x' }, makeDeps());
  const triaged = Inbox.triageInboxItem(captured.state, captured.value.id, { boardId: 'board-1', columnId: 'col-1' }, {}, makeDeps());
  const card = triaged.state.boards[0].columns[0].cards[0];
  assert.ok(card.description.includes('https://example.com/x'));
});

test('triage with a missing target column is a no-op', () => {
  const s = state();
  const captured = Inbox.captureItem(s, { title: 'Triage me' }, makeDeps());
  const triaged = Inbox.triageInboxItem(captured.state, captured.value.id, { boardId: 'board-1', columnId: 'ghost' }, {}, makeDeps());
  assert.equal(triaged.changed, false);
  assert.equal(triaged.reason, 'column-not-found');
});

test('mergeIntoCard appends note and preserves the original card', () => {
  const s = state();
  s.boards[0].columns[0].cards = [{ id: 'card-1', title: 'Existing', description: 'Original', columnId: 'col-1' }];
  const captured = Inbox.captureItem(s, { title: 'Inbox note', note: 'Extra detail' }, makeDeps());
  const merged = Inbox.mergeIntoCard(captured.state, captured.value.id, { boardId: 'board-1', cardId: 'card-1' }, makeDeps());
  assert.equal(merged.changed, true);
  const card = merged.state.boards[0].columns[0].cards[0];
  assert.ok(card.description.includes('Extra detail'));
  assert.equal(card.id, 'card-1');
  assert.deepEqual(merged.state.inbox.items, []);
});

test('inboxSummary counts items and finds the oldest', () => {
  const s = state();
  s.inbox.items = [
    { id: 'a', title: 'A', capturedAt: 500 },
    { id: 'b', title: 'B', capturedAt: 200 },
    { id: 'c', title: 'C', capturedAt: 800 }
  ];
  const summary = Inbox.inboxSummary(s, 5000);
  assert.equal(summary.count, 3);
  assert.equal(summary.oldestAt, 200);
  assert.equal(summary.oldestDays, Math.floor(4800 / 86400000));
});

test('inboxSummary handles an empty inbox', () => {
  const summary = Inbox.inboxSummary(state(), 5000);
  assert.equal(summary.count, 0);
  assert.equal(summary.oldestAt, null);
  assert.equal(summary.oldestDays, null);
});

test('inbox survives board deletion since it is global', () => {
  const s = state();
  const captured = Inbox.captureItem(s, { title: 'Global item' }, makeDeps());
  const withoutBoards = Object.assign({}, captured.state, { boards: [] });
  assert.equal(Inbox.inboxSummary(withoutBoards, 5000).count, 1);
  assert.equal(Inbox.captureItem(withoutBoards, { title: 'Another' }, makeDeps()).changed, true);
});

test('mergeIntoCard keeps the URL when the item also has a note', () => {
  const s = state();
  s.boards[0].columns[0].cards = [{
    id: 'c1',
    columnId: 'col-1',
    title: 'Existing',
    description: 'Original description',
    labels: [],
    assignee: '',
    createdAt: 100,
    updatedAt: 100,
    movedAt: 100,
    due: '',
    checklist: [],
    priority: 'none',
    size: 'none',
    flow: { state: 'normal', reason: '', since: null, periods: [] },
    dependencies: { blockers: [], related: [] },
    recurrenceId: null,
    transitions: []
  }];
  const captured = Inbox.captureItem(s, { title: 'Link with note', note: 'Context', url: 'https://example.com/doc' }, makeDeps());
  const merged = Inbox.mergeIntoCard(captured.state, captured.value.id, { boardId: 'board-1', cardId: 'c1' }, makeDeps());
  assert.equal(merged.changed, true);
  assert.ok(merged.value.description.includes('Context'));
  assert.ok(merged.value.description.includes('Source: https://example.com/doc'));
  assert.equal(merged.state.inbox.items.length, 0);
});

test('triage through the pipeline initializes lifecycle for active columns', () => {
  const s = state();
  s.boards[0].columns[0].role = 'active';
  const captured = Inbox.captureItem(s, { title: 'Lifecycle triage' }, makeDeps());
  const triaged = Inbox.triageInboxItem(captured.state, captured.value.id, { boardId: 'board-1', columnId: 'col-1' }, {}, makeDeps());
  const card = triaged.state.boards[0].columns[0].cards[0];
  assert.equal(card.startedAt, 1000);
  assert.equal(card.transitions.length, 1);
});

test('triage into a done column records completion', () => {
  const s = state();
  s.boards[0].columns[0].role = 'done';
  s.boards[0].columns[0].isDone = true;
  const captured = Inbox.captureItem(s, { title: 'Done triage' }, makeDeps());
  const triaged = Inbox.triageInboxItem(captured.state, captured.value.id, { boardId: 'board-1', columnId: 'col-1' }, {}, makeDeps());
  const card = triaged.state.boards[0].columns[0].cards[0];
  assert.equal(card.completedAt, 1000);
});

test('triage applies entry defaults from the target column', () => {
  const s = state();
  s.boards[0].labels = [{ id: 'l-1', name: 'Bug', color: '#c81e14' }];
  s.boards[0].columns[0].policy = { defaultLabelIds: ['l-1'], defaultAssignee: 'Sam' };
  const captured = Inbox.captureItem(s, { title: 'Defaulted triage' }, makeDeps());
  const triaged = Inbox.triageInboxItem(captured.state, captured.value.id, { boardId: 'board-1', columnId: 'col-1' }, {}, makeDeps());
  const card = triaged.state.boards[0].columns[0].cards[0];
  assert.deepEqual(card.labels, ['l-1']);
  assert.equal(card.assignee, 'Sam');
});

test('triage blocked by a hard WIP policy keeps the item and reports policy', () => {
  const s = state();
  s.boards[0].columns[0].wipLimit = 1;
  s.boards[0].columns[0].policy = { wipMode: 'hard' };
  s.boards[0].columns[0].cards = [{ id: 'existing', columnId: 'col-1', title: 'Existing' }];
  const captured = Inbox.captureItem(s, { title: 'Blocked triage' }, makeDeps());
  const triaged = Inbox.triageInboxItem(captured.state, captured.value.id, { boardId: 'board-1', columnId: 'col-1' }, {}, makeDeps());
  assert.equal(triaged.changed, false);
  assert.equal(triaged.reason, 'policy');
  assert.equal(triaged.evaluation.blocking, true);
  assert.equal(captured.state.inbox.items.length, 1);
});

test('triage passes once the policy is confirmed', () => {
  const s = state();
  s.boards[0].columns[0].wipLimit = 1;
  s.boards[0].columns[0].policy = { wipMode: 'hard' };
  s.boards[0].columns[0].cards = [{ id: 'existing', columnId: 'col-1', title: 'Existing' }];
  const captured = Inbox.captureItem(s, { title: 'Confirmed triage' }, makeDeps());
  const triaged = Inbox.triageInboxItem(captured.state, captured.value.id, { boardId: 'board-1', columnId: 'col-1' }, {}, makeDeps(), { confirmed: true });
  assert.equal(triaged.changed, true);
  assert.equal(triaged.state.boards[0].columns[0].cards.length, 2);
  assert.equal(triaged.state.inbox.items.length, 0);
});

test('inboxSummary excludes archived reference items from pressure', () => {
  const s = state();
  s.inbox.items = [
    { id: 'a', title: 'A', capturedAt: 500 },
    { id: 'b', title: 'B', capturedAt: 200, archived: true },
    { id: 'c', title: 'C', capturedAt: 800, archived: true }
  ];
  const summary = Inbox.inboxSummary(s, 5000);
  assert.equal(summary.count, 1);
  assert.equal(summary.oldestAt, 500);
  assert.equal(summary.oldestDays, Math.floor(4500 / 86400000));
});

test('inbox operations never mutate the input state', () => {
  const s = state();
  const before = JSON.stringify(s);
  Inbox.captureItem(s, { title: 'X' }, makeDeps());
  Inbox.captureLines(s, 'One\nTwo', makeDeps());
  Inbox.deleteInboxItem(s, 'ghost');
  Inbox.triageInboxItem(s, 'ghost', { boardId: 'board-1', columnId: 'col-1' }, {}, makeDeps());
  assert.equal(JSON.stringify(s), before);
});

test('triage asks for confirmation on soft WIP until confirmed', () => {
  const s = state();
  s.boards[0].columns[0].wipLimit = 1;
  s.boards[0].columns[0].policy = { wipMode: 'soft' };
  s.boards[0].columns[0].cards = [{ id: 'existing', columnId: 'col-1', title: 'Existing' }];
  const captured = Inbox.captureItem(s, { title: 'Soft triage' }, makeDeps());
  const first = Inbox.triageInboxItem(captured.state, captured.value.id, { boardId: 'board-1', columnId: 'col-1' }, {}, makeDeps());
  assert.equal(first.changed, false);
  assert.equal(first.reason, 'policy');
  assert.equal(first.evaluation.allowed, true);
  assert.equal(first.evaluation.requiresConfirmation, true);
  const confirmed = Inbox.triageInboxItem(captured.state, captured.value.id, { boardId: 'board-1', columnId: 'col-1' }, {}, makeDeps(), { confirmed: true });
  assert.equal(confirmed.changed, true);
  assert.equal(confirmed.state.inbox.items.length, 0);
});
