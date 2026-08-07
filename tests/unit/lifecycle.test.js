const { test } = require('node:test');
const assert = require('node:assert/strict');
const Lifecycle = require('../../js/core/lifecycle.js');

function column(id, role, cards) {
  return { id: id, role: role, cards: cards || [] };
}

function card(overrides) {
  return Object.assign({
    id: 'c-1',
    columnId: 'col-1',
    title: 'Task',
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

test('first entry into an active column sets startedAt', () => {
  const result = Lifecycle.transitionCard(card(), column('col-1', 'queue'), column('col-2', 'active'), 500);
  assert.equal(result.changed, true);
  assert.equal(result.card.startedAt, 500);
  assert.equal(result.card.completedAt, null);
});

test('active-to-active moves do not reset startedAt', () => {
  const result = Lifecycle.transitionCard(card({ startedAt: 200 }), column('col-2', 'active'), column('col-3', 'active'), 600);
  assert.equal(result.card.startedAt, 200);
});

test('entry into done sets completedAt', () => {
  const result = Lifecycle.transitionCard(card({ startedAt: 300 }), column('col-2', 'active'), column('col-4', 'done'), 800);
  assert.equal(result.card.completedAt, 800);
  assert.equal(result.card.startedAt, 300);
});

test('moving out of done clears completedAt', () => {
  const result = Lifecycle.transitionCard(
    card({ startedAt: 300, completedAt: 800 }),
    column('col-4', 'done'),
    column('col-2', 'active'),
    900
  );
  assert.equal(result.card.completedAt, null);
});

test('re-entering done records a fresh completion time', () => {
  const result = Lifecycle.transitionCard(
    card({ startedAt: 300, completedAt: null }),
    column('col-2', 'active'),
    column('col-4', 'done'),
    950
  );
  assert.equal(result.card.completedAt, 950);
});

test('transition history records role snapshots', () => {
  const result = Lifecycle.transitionCard(card(), column('col-1', 'queue'), column('col-2', 'active'), 500);
  assert.deepEqual(result.card.transitions, [{
    fromColumnId: 'col-1',
    toColumnId: 'col-2',
    fromRole: 'queue',
    toRole: 'active',
    at: 500
  }]);
});

test('transition history is capped at 100 entries', () => {
  const transitions = [];
  for (let i = 0; i < 120; i++) {
    transitions.push({ fromColumnId: 'a', toColumnId: 'b', fromRole: 'queue', toRole: 'active', at: i });
  }
  const result = Lifecycle.transitionCard(card({ transitions }), column('col-1', 'queue'), column('col-2', 'active'), 5000);
  assert.equal(result.card.transitions.length, 100);
  assert.equal(result.card.transitions[0].at, 21);
  assert.equal(result.card.transitions[99].at, 5000);
});

test('transitionCard never mutates the input card', () => {
  const source = card({ startedAt: null });
  const before = JSON.stringify(source);
  Lifecycle.transitionCard(source, column('col-1', 'queue'), column('col-2', 'active'), 500);
  assert.equal(JSON.stringify(source), before);
});

test('flow state change records a period on exit', () => {
  const blocked = Lifecycle.setFlowState(card(), 'blocked', 'Waiting on review', 400);
  assert.equal(blocked.changed, true);
  assert.equal(blocked.card.flow.state, 'blocked');
  assert.equal(blocked.card.flow.since, 400);
  assert.equal(blocked.card.flow.reason, 'Waiting on review');
  const resumed = Lifecycle.setFlowState(blocked.card, 'normal', '', 700);
  assert.equal(resumed.card.flow.state, 'normal');
  assert.equal(resumed.card.flow.since, null);
  assert.deepEqual(resumed.card.flow.periods, [{
    state: 'blocked',
    reason: 'Waiting on review',
    startedAt: 400,
    endedAt: 700
  }]);
});

test('setting the same flow state is a no-op', () => {
  const source = card({ flow: { state: 'blocked', reason: 'x', since: 400, periods: [] } });
  const result = Lifecycle.setFlowState(source, 'blocked', 'x', 500);
  assert.equal(result.changed, false);
  assert.equal(result.card, source);
});

test('flow-state periods are capped at 100', () => {
  const periods = [];
  for (let i = 0; i < 105; i++) {
    periods.push({ state: 'blocked', reason: '', startedAt: i, endedAt: i + 1 });
  }
  const source = card({ flow: { state: 'blocked', reason: '', since: 200, periods } });
  const result = Lifecycle.setFlowState(source, 'normal', '', 300);
  assert.equal(result.card.flow.periods.length, 100);
});

test('clearFlowState returns the card to normal without a reason', () => {
  const source = card({ flow: { state: 'waiting', reason: 'For Sam', since: 400, periods: [] } });
  const result = Lifecycle.clearFlowState(source, 900);
  assert.equal(result.card.flow.state, 'normal');
  assert.equal(result.card.flow.reason, '');
  assert.equal(result.card.flow.since, null);
});

test('currentFlowDuration measures the open period', () => {
  const source = card({ flow: { state: 'blocked', reason: '', since: 1000, periods: [] } });
  assert.equal(Lifecycle.currentFlowDuration(source, 1500), 500);
  assert.equal(Lifecycle.currentFlowDuration(card(), 1500), 0);
});

test('totalFlowDuration sums closed and open periods', () => {
  const source = card({
    flow: {
      state: 'blocked',
      reason: '',
      since: 1000,
      periods: [
        { state: 'blocked', reason: '', startedAt: 100, endedAt: 300 },
        { state: 'waiting', reason: '', startedAt: 200, endedAt: 250 },
        { state: 'blocked', reason: '', startedAt: 500, endedAt: 600 }
      ]
    }
  });
  assert.equal(Lifecycle.totalFlowDuration(source, 'blocked', 1500), 200 + 100 + 500);
  assert.equal(Lifecycle.totalFlowDuration(source, 'waiting', 1500), 50);
  assert.equal(Lifecycle.totalFlowDuration(source, 'paused', 1500), 0);
});

test('cycleTimeDays measures startedAt to completedAt', () => {
  assert.equal(Lifecycle.cycleTimeDays(card({ startedAt: 0, completedAt: 86400000 })), 1);
  assert.equal(Lifecycle.cycleTimeDays(card({ startedAt: 0, completedAt: 3 * 86400000 })), 3);
});

test('cycleTimeDays returns null without startedAt or completedAt', () => {
  assert.equal(Lifecycle.cycleTimeDays(card()), null);
  assert.equal(Lifecycle.cycleTimeDays(card({ startedAt: 100 })), null);
});

test('workItemAgeDays uses now for open work', () => {
  assert.equal(Lifecycle.workItemAgeDays(card({ startedAt: 1000, completedAt: null }), 1000 + 2 * 86400000), 2);
});

test('workItemAgeDays uses completedAt for closed work', () => {
  const source = card({ startedAt: 1000, completedAt: 1000 + 5 * 86400000 });
  assert.equal(Lifecycle.workItemAgeDays(source, 1000 + 20 * 86400000), 5);
});

test('workItemAgeDays returns null without startedAt', () => {
  assert.equal(Lifecycle.workItemAgeDays(card(), 5000), null);
});

test('blockedDurationDays converts to days', () => {
  const source = card({
    flow: {
      state: 'blocked',
      reason: '',
      since: 0,
      periods: [{ state: 'blocked', reason: '', startedAt: 0, endedAt: 86400000 }]
    }
  });
  assert.equal(Lifecycle.blockedDurationDays(source, 2 * 86400000), 3);
});

test('invalid flow state is rejected', () => {
  const source = card();
  const result = Lifecycle.setFlowState(source, 'stuck', '', 100);
  assert.equal(result.changed, false);
});

test('transitionCard with no target column is a safe no-op', () => {
  const source = card();
  const result = Lifecycle.transitionCard(source, column('col-1', 'queue'), null, 100);
  assert.equal(result.changed, false);
});

test('columnRole falls back to queue for unknown roles', () => {
  assert.equal(Lifecycle.columnRole(column('x', 'mystery')), 'queue');
  assert.equal(Lifecycle.columnRole(column('x', 'done')), 'done');
  assert.equal(Lifecycle.columnRole(null), 'queue');
});
