const { test } = require('node:test');
const assert = require('node:assert/strict');
const Pipeline = require('../../js/core/pipeline.js');

const DAY = 86400000;

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

function column(id, role, extra) {
  return Object.assign({
    id: id,
    title: id,
    role: role,
    isDone: role === 'done',
    wipLimit: 0,
    policy: { wipMode: 'off', overrideRequiresReason: false, entryCriteria: [], exitCriteria: [], defaultLabelIds: [], defaultAssignee: '' },
    cards: []
  }, extra || {});
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
        labels: [{ id: 'l-1', name: 'Bug', color: '#c81e14' }],
        templates: [],
        columns: [
          column('col-q', 'queue', { cards: [card('c1', 'col-q')] }),
          column('col-a', 'active'),
          column('col-d', 'done')
        ],
        archive: { cards: [], columns: [] }
      }
    ]
  };
}

const deps = { uid: () => 'id', now: () => 5000 };

test('placeCard initializes lifecycle when inserting into an active column', () => {
  const s = state();
  const board = s.boards[0];
  const target = board.columns.find(c => c.id === 'col-a');
  const fresh = card('new-1', target.id);
  const result = Pipeline.placeCard(s, fresh, null, board, target, {}, deps);
  assert.equal(result.changed, true);
  const placed = result.value;
  assert.equal(placed.startedAt, 5000);
  assert.equal(placed.completedAt, null);
  assert.equal(placed.transitions.length, 1);
  assert.equal(placed.transitions[0].toRole, 'active');
  assert.equal(target.cards[0].id, 'new-1');
});

test('placeCard initializes lifecycle when inserting into a done column', () => {
  const s = state();
  const board = s.boards[0];
  const target = board.columns.find(c => c.id === 'col-d');
  const fresh = card('new-1', target.id);
  const result = Pipeline.placeCard(s, fresh, null, board, target, {}, deps);
  assert.equal(result.value.completedAt, 5000);
});

test('placeCard applies entry defaults on insertion', () => {
  const s = state();
  const board = s.boards[0];
  const target = board.columns.find(c => c.id === 'col-a');
  target.policy = { wipMode: 'off', defaultLabelIds: ['l-1'], defaultAssignee: 'Sam' };
  const fresh = card('new-1', target.id);
  const result = Pipeline.placeCard(s, fresh, null, board, target, {}, deps);
  assert.deepEqual(result.value.labels, ['l-1']);
  assert.equal(result.value.assignee, 'Sam');
});

test('placeCard returns the policy evaluation when a hard WIP limit blocks entry', () => {
  const s = state();
  const board = s.boards[0];
  const target = board.columns.find(c => c.id === 'col-a');
  target.wipLimit = 1;
  target.policy = { wipMode: 'hard' };
  target.cards = [card('existing', target.id)];
  const fresh = card('new-1', target.id);
  const result = Pipeline.placeCard(s, fresh, null, board, target, {}, deps);
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'policy');
  assert.equal(result.evaluation.blocking, true);
  assert.equal(result.evaluation.allowed, false);
  assert.equal(target.cards.length, 1);
});

test('placeCard soft WIP is allowed but flagged for confirmation', () => {
  const Policies = require('../../js/core/policies.js');
  const s = state();
  const board = s.boards[0];
  const target = board.columns.find(c => c.id === 'col-a');
  target.wipLimit = 1;
  target.policy = { wipMode: 'soft' };
  target.cards = [card('existing', target.id)];
  const fresh = card('new-1', target.id);
  const result = Pipeline.placeCard(s, fresh, null, board, target, {}, deps);
  assert.equal(result.changed, true);
  const evaluation = Policies.evaluateMovePolicy(s, { boardId: board.id, cardId: 'new-1' }, { boardId: board.id, columnId: target.id }, { sourceColumn: null });
  assert.equal(evaluation.allowed, true);
  assert.equal(evaluation.requiresConfirmation, true);
  assert.equal(evaluation.blocking, false);
});

test('placeCard hard WIP passes with a confirmed override', () => {
  const s = state();
  const board = s.boards[0];
  const target = board.columns.find(c => c.id === 'col-a');
  target.wipLimit = 1;
  target.policy = { wipMode: 'hard' };
  target.cards = [card('existing', target.id)];
  const fresh = card('new-1', target.id);
  const result = Pipeline.placeCard(s, fresh, null, board, target, { confirmed: true }, deps);
  assert.equal(result.changed, true);
  assert.equal(target.cards.length, 2);
});

test('placeCard checkPolicy false skips policy evaluation', () => {
  const s = state();
  const board = s.boards[0];
  const target = board.columns.find(c => c.id === 'col-a');
  target.wipLimit = 1;
  target.policy = { wipMode: 'hard' };
  target.cards = [card('existing', target.id)];
  const fresh = card('new-1', target.id);
  const result = Pipeline.placeCard(s, fresh, null, board, target, { checkPolicy: false }, deps);
  assert.equal(result.changed, true);
});

test('placeCard same-column preserve skips the transition and keeps movedAt', () => {
  const s = state();
  const board = s.boards[0];
  const source = board.columns.find(c => c.id === 'col-q');
  const target = source;
  const result = Pipeline.placeCard(s, source.cards[0], source, board, target, { sameColumnMode: 'preserve' }, deps);
  assert.equal(result.changed, true);
  assert.equal(result.value.movedAt, 100);
  assert.equal(result.value.transitions.length, 0);
});

test('placeCard same-column transition records the move and restores movedAt', () => {
  const s = state();
  const board = s.boards[0];
  const source = board.columns.find(c => c.id === 'col-q');
  const result = Pipeline.placeCard(s, source.cards[0], source, board, source, { sameColumnMode: 'transition', toIndex: 1 }, deps);
  assert.equal(result.value.movedAt, 100);
  assert.equal(result.value.transitions.length, 1);
});

test('placeCard moves a card out of its source column', () => {
  const s = state();
  const board = s.boards[0];
  const source = board.columns.find(c => c.id === 'col-q');
  const target = board.columns.find(c => c.id === 'col-a');
  const result = Pipeline.placeCard(s, source.cards[0], source, board, target, {}, deps);
  assert.equal(result.changed, true);
  assert.equal(source.cards.length, 0);
  assert.equal(target.cards.length, 1);
  assert.equal(target.cards[0].startedAt, 5000);
});

test('placeCard schedules the next after-completion occurrence for a completed recurring card', () => {
  const s = state();
  const board = s.boards[0];
  const source = board.columns.find(c => c.id === 'col-q');
  const target = board.columns.find(c => c.id === 'col-d');
  s.recurrences.push({
    id: 'rec-1',
    enabled: true,
    mode: 'after-completion',
    schedule: { frequency: 'custom', interval: 1, delayAfterCompletionDays: 2 },
    target: { boardId: 'board-1', columnId: 'col-q' },
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
  });
  source.cards[0].recurrenceId = 'rec-1';
  const result = Pipeline.placeCard(s, source.cards[0], source, board, target, {}, deps);
  assert.equal(result.changed, true);
  assert.equal(result.value.completedAt, 5000);
  const after = s.recurrences.find(r => r.id === 'rec-1');
  assert.equal(after.activeCardRef, null);
  assert.ok(after.nextRunAt !== null);
  const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  assert.equal(after.nextRunAt, startOfDay(5000) + 2 * DAY);
});

test('placeCard reports a missing card in the source column', () => {
  const s = state();
  const board = s.boards[0];
  const source = board.columns.find(c => c.id === 'col-q');
  const target = board.columns.find(c => c.id === 'col-a');
  const ghost = card('ghost', source.id);
  const result = Pipeline.placeCard(s, ghost, source, board, target, {}, deps);
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'card-not-found');
});

test('placeCard clamps toIndex at both ends', () => {
  const s = state();
  const board = s.boards[0];
  const target = board.columns.find(c => c.id === 'col-a');
  target.cards = [card('a', target.id), card('b', target.id)];
  const top = Pipeline.placeCard(s, card('new-1', target.id), null, board, target, { toIndex: -5 }, deps);
  assert.equal(target.cards[0].id, 'new-1');
  const bottom = Pipeline.placeCard(s, card('new-2', target.id), null, board, target, { toIndex: 999 }, deps);
  assert.equal(target.cards[target.cards.length - 1].id, 'new-2');
});

test('placeCard recurrenceSideEffect false leaves the recurrence untouched', () => {
  const s = state();
  const board = s.boards[0];
  const source = board.columns.find(c => c.id === 'col-q');
  const target = board.columns.find(c => c.id === 'col-d');
  s.recurrences.push({
    id: 'rec-1',
    enabled: true,
    mode: 'after-completion',
    schedule: { frequency: 'custom', interval: 1, delayAfterCompletionDays: 2 },
    target: { boardId: 'board-1', columnId: 'col-q' },
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
  });
  source.cards[0].recurrenceId = 'rec-1';
  const result = Pipeline.placeCard(s, source.cards[0], source, board, target, { recurrenceSideEffect: false }, deps);
  assert.equal(result.changed, true);
  const after = s.recurrences.find(r => r.id === 'rec-1');
  assert.equal(after.activeCardRef.cardId, 'c1');
  assert.equal(after.nextRunAt, null);
});

test('placeCard rejectOnConfirmation returns the evaluation for soft WIP until confirmed', () => {
  const s = state();
  const board = s.boards[0];
  const target = board.columns.find(c => c.id === 'col-a');
  target.wipLimit = 1;
  target.policy = { wipMode: 'soft' };
  target.cards = [card('existing', target.id)];
  const fresh = card('new-1', target.id);
  const blocked = Pipeline.placeCard(s, fresh, null, board, target, { rejectOnConfirmation: true }, deps);
  assert.equal(blocked.changed, false);
  assert.equal(blocked.reason, 'policy');
  assert.equal(blocked.evaluation.allowed, true);
  assert.equal(target.cards.length, 1);
  const passed = Pipeline.placeCard(s, card('new-2', target.id), null, board, target, { rejectOnConfirmation: true, confirmed: true }, deps);
  assert.equal(passed.changed, true);
  assert.equal(target.cards.length, 2);
});

test('placeCard does not mutate the caller state when policy blocks', () => {
  const s = state();
  const board = s.boards[0];
  const target = board.columns.find(c => c.id === 'col-a');
  target.wipLimit = 1;
  target.policy = { wipMode: 'hard' };
  target.cards = [card('existing', target.id)];
  const source = board.columns.find(c => c.id === 'col-q');
  const before = JSON.stringify(s);
  const result = Pipeline.placeCard(s, source.cards[0], source, board, target, {}, deps);
  assert.equal(result.changed, false);
  assert.equal(JSON.stringify(s), before);
});
