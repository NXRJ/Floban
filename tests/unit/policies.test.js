const { test } = require('node:test');
const assert = require('node:assert/strict');
const Policies = require('../../js/core/policies.js');

function column(id, title, overrides) {
  return Object.assign({
    id: id,
    title: title,
    role: 'queue',
    isDone: false,
    wipLimit: 0,
    collapsed: false,
    policy: {
      wipMode: 'off',
      overrideRequiresReason: false,
      entryCriteria: [],
      exitCriteria: [],
      defaultLabelIds: [],
      defaultAssignee: '',
      countsTowardCycleTime: true
    },
    cards: []
  }, overrides || {});
}

function state() {
  return {
    boards: [
      {
        id: 'board-1',
        name: 'One',
        columns: [
          column('col-a', 'To Do', {
            wipLimit: 2,
            cards: [{ id: 'c1' }, { id: 'c2' }]
          }),
          column('col-b', 'In Progress', {
            role: 'active',
            wipLimit: 0,
            cards: [{ id: 'c3' }]
          })
        ]
      }
    ]
  };
}

const cardRef = { boardId: 'board-1', cardId: 'c1' };

test('a move with no policy is fully allowed', () => {
  const result = Policies.evaluateMovePolicy(state(), cardRef, { boardId: 'board-1', columnId: 'col-b' });
  assert.equal(result.allowed, true);
  assert.equal(result.requiresOverride, false);
  assert.deepEqual(result.violations, []);
});

test('soft WIP warns but does not block', () => {
  const s = state();
  s.boards[0].columns[1].wipLimit = 1;
  s.boards[0].columns[1].policy.wipMode = 'soft';
  const result = Policies.evaluateMovePolicy(s, cardRef, { boardId: 'board-1', columnId: 'col-b' });
  assert.equal(result.allowed, true);
  assert.equal(result.requiresOverride, false);
  assert.ok(result.violations.some(v => v.code === 'wip-limit'));
});

test('hard WIP requires an override', () => {
  const s = state();
  s.boards[0].columns[1].wipLimit = 1;
  s.boards[0].columns[1].policy.wipMode = 'hard';
  const result = Policies.evaluateMovePolicy(s, cardRef, { boardId: 'board-1', columnId: 'col-b' });
  assert.equal(result.allowed, false);
  assert.equal(result.requiresOverride, true);
});

test('hard WIP allows an override with a valid reason', () => {
  const s = state();
  s.boards[0].columns[1].wipLimit = 1;
  s.boards[0].columns[1].policy.wipMode = 'hard';
  s.boards[0].columns[1].policy.overrideRequiresReason = true;
  const result = Policies.evaluateMovePolicy(s, cardRef, { boardId: 'board-1', columnId: 'col-b' }, { overrideReason: 'Critical fix', confirmed: true });
  assert.equal(result.allowed, true);
  assert.equal(result.requiresOverride, true);
  assert.equal(result.needsReason, false);
});

test('hard WIP without a reason demands one', () => {
  const s = state();
  s.boards[0].columns[1].wipLimit = 1;
  s.boards[0].columns[1].policy.wipMode = 'hard';
  s.boards[0].columns[1].policy.overrideRequiresReason = true;
  const result = Policies.evaluateMovePolicy(s, cardRef, { boardId: 'board-1', columnId: 'col-b' });
  assert.equal(result.allowed, false);
  assert.equal(result.needsReason, true);
});

test('entry criteria require confirmation', () => {
  const s = state();
  s.boards[0].columns[1].policy.entryCriteria = ['Acceptance criteria written'];
  const result = Policies.evaluateMovePolicy(s, cardRef, { boardId: 'board-1', columnId: 'col-b' });
  assert.equal(result.allowed, false);
  assert.equal(result.requiresOverride, true);
  assert.ok(result.violations.some(v => v.code === 'entry-criteria'));
});

test('entry criteria pass when confirmed', () => {
  const s = state();
  s.boards[0].columns[1].policy.entryCriteria = ['Acceptance criteria written'];
  const result = Policies.evaluateMovePolicy(s, cardRef, { boardId: 'board-1', columnId: 'col-b' }, { overrideReason: 'confirmed', confirmed: true });
  assert.equal(result.allowed, true);
});

test('exit criteria on the source column need confirmation', () => {
  const s = state();
  s.boards[0].columns[0].policy.exitCriteria = ['Tests pass'];
  const result = Policies.evaluateMovePolicy(s, cardRef, { boardId: 'board-1', columnId: 'col-b' }, { sourceColumn: s.boards[0].columns[0] });
  assert.equal(result.requiresOverride, true);
  assert.ok(result.violations.some(v => v.code === 'exit-criteria'));
});

test('canLeaveColumn checks exit criteria only', () => {
  const s = state();
  assert.equal(Policies.canLeaveColumn(s, cardRef, { boardId: 'board-1', columnId: 'col-b' }).allowed, true);
  s.boards[0].columns[0].policy.exitCriteria = ['Tests pass'];
  const result = Policies.canLeaveColumn(s, cardRef, { boardId: 'board-1', columnId: 'col-b' });
  assert.equal(result.allowed, false);
  assert.equal(result.requiresOverride, true);
});

test('canEnterColumn ignores the source column', () => {
  const s = state();
  s.boards[0].columns[0].policy.exitCriteria = ['Tests pass'];
  s.boards[0].columns[1].policy.entryCriteria = ['Ready'];
  const result = Policies.canEnterColumn(s, cardRef, { boardId: 'board-1', columnId: 'col-b' });
  assert.ok(result.violations.some(v => v.code === 'entry-criteria'));
  assert.ok(!result.violations.some(v => v.code === 'exit-criteria'));
});

test('applyEntryDefaults only fills missing values', () => {
  const s = state();
  s.boards[0].columns[1].policy.defaultAssignee = 'Sam';
  s.boards[0].columns[1].policy.defaultLabelIds = ['l-1', 'l-2'];
  const card = { id: 'c1', labels: ['l-2'], assignee: '' };
  Policies.applyEntryDefaults(card, s.boards[0].columns[1]);
  assert.deepEqual(card.labels, ['l-2', 'l-1']);
  assert.equal(card.assignee, 'Sam');
  assert.deepEqual(card._defaultsApplied, { labels: true, assignee: true });
});

test('applyEntryDefaults never overwrites existing values', () => {
  const s = state();
  s.boards[0].columns[1].policy.defaultAssignee = 'Sam';
  s.boards[0].columns[1].policy.defaultLabelIds = ['l-1'];
  const card = { id: 'c1', labels: ['l-x'], assignee: 'Alex' };
  Policies.applyEntryDefaults(card, s.boards[0].columns[1]);
  assert.deepEqual(card.labels, ['l-x', 'l-1']);
  assert.equal(card.assignee, 'Alex');
});

test('wipStatus reports only exceeded columns as over', () => {
  const s = state();
  const atLimit = Policies.wipStatus(s.boards[0].columns[0]);
  assert.equal(atLimit.over, false);
  const ok = Policies.wipStatus(s.boards[0].columns[1]);
  assert.equal(ok.over, false);
  s.boards[0].columns[0].cards.push({ id: 'c3' });
  const exceeded = Policies.wipStatus(s.boards[0].columns[0]);
  assert.equal(exceeded.over, true);
  assert.equal(exceeded.mode, 'off');
});

test('a column at its WIP limit still requires override for hard entry', () => {
  const s = state();
  s.boards[0].columns[0].policy.wipMode = 'hard';
  const result = Policies.evaluateMovePolicy(s, cardRef, { boardId: 'board-1', columnId: 'col-a' });
  assert.equal(result.allowed, false);
  assert.equal(result.requiresOverride, true);
  assert.ok(result.violations.some(v => v.code === 'wip-limit'));
});

test('evaluateMovePolicy with a missing target is denied', () => {
  const result = Policies.evaluateMovePolicy(state(), cardRef, { boardId: 'board-1', columnId: 'ghost' });
  assert.equal(result.allowed, false);
});

test('WIP counts are not exceeded when under the limit', () => {
  const s = state();
  s.boards[0].columns[1].wipLimit = 3;
  const result = Policies.evaluateMovePolicy(s, cardRef, { boardId: 'board-1', columnId: 'col-b' });
  assert.equal(result.allowed, true);
  assert.ok(!result.violations.some(v => v.code === 'wip-limit'));
});

