const { test } = require('node:test');
const assert = require('node:assert/strict');
const Recurrence = require('../../js/core/recurrence.js');

const DAY = 86400000;

function makeDeps() {
  let n = 0;
  return {
    uid: () => 'gen-' + (++n),
    now: () => 1000000
  };
}

function recurrence(overrides) {
  return Object.assign({
    id: 'rec-1',
    enabled: true,
    mode: 'scheduled',
    schedule: { frequency: 'daily', interval: 1, weekdays: [], dayOfMonth: null, delayAfterCompletionDays: null },
    target: { boardId: 'board-1', columnId: 'col-1' },
    template: { title: 'Daily check', description: '', labelIds: [], assignee: '', priority: 'none', size: 'none', checklist: [] },
    dueOffsetDays: null,
    overlapPolicy: 'single-active',
    missedPolicy: 'create-one',
    activeCardRef: null,
    nextRunAt: null,
    lastRunAt: null,
    lastCompletedAt: null,
    endAt: null,
    remainingOccurrences: null,
    pausedReason: '',
    createdAt: 1000,
    updatedAt: 1000
  }, overrides || {});
}

function board(overrides) {
  return Object.assign({
    id: 'board-1',
    name: 'Board',
    flowSettings: {},
    labels: [],
    templates: [],
    columns: [
      { id: 'col-1', title: 'To Do', role: 'queue', isDone: false, cards: [] },
      { id: 'col-d', title: 'Done', role: 'done', isDone: true, cards: [] }
    ],
    archive: { cards: [], columns: [] }
  }, overrides || {});
}

function state(recs, boards) {
  return {
    version: 3,
    theme: 'dark',
    activeBoardId: 'board-1',
    inbox: { items: [] },
    lenses: [],
    recurrences: recs || [],
    boards: boards || [board()]
  };
}

function localDate(y, m, d, h) {
  return new Date(y, m - 1, d, h === undefined ? 12 : h).getTime();
}

test('daily schedule advances one interval day', () => {
  const rec = recurrence();
  const next = Recurrence.computeNextRun(rec, localDate(2026, 8, 7));
  assert.equal(next, localDate(2026, 8, 8, 0));
});

test('daily schedule with interval 3', () => {
  const rec = recurrence({ schedule: { frequency: 'daily', interval: 3 } });
  assert.equal(Recurrence.computeNextRun(rec, localDate(2026, 8, 7)), localDate(2026, 8, 10, 0));
});

test('weekly schedule with no weekdays adds seven days', () => {
  const rec = recurrence({ schedule: { frequency: 'weekly', interval: 1 } });
  assert.equal(Recurrence.computeNextRun(rec, localDate(2026, 8, 7)), localDate(2026, 8, 14, 0));
});

test('weekly schedule picks the next listed weekday', () => {
  const monday = localDate(2026, 8, 3);
  const rec = recurrence({ schedule: { frequency: 'weekly', interval: 1, weekdays: [3, 5] } });
  const next = Recurrence.computeNextRun(rec, monday);
  const date = new Date(next);
  assert.equal(date.getDay(), 3);
  assert.equal(next, localDate(2026, 8, 5, 0));
});

test('monthly schedule respects day of month', () => {
  const aug1 = localDate(2026, 8, 1);
  const rec = recurrence({ schedule: { frequency: 'monthly', interval: 1, dayOfMonth: 15 } });
  const next = Recurrence.computeNextRun(rec, aug1);
  assert.equal(new Date(next).getDate(), 15);
});

test('monthly schedule rolls to the next month when the day passed', () => {
  const aug20 = localDate(2026, 8, 20);
  const rec = recurrence({ schedule: { frequency: 'monthly', interval: 1, dayOfMonth: 15 } });
  const next = Recurrence.computeNextRun(rec, aug20);
  const d = new Date(next);
  assert.equal(d.getMonth(), 8);
  assert.equal(d.getDate(), 15);
});

test('custom frequency behaves like daily intervals', () => {
  const rec = recurrence({ schedule: { frequency: 'custom', interval: 2 } });
  assert.equal(Recurrence.computeNextRun(rec, localDate(2026, 8, 7)), localDate(2026, 8, 9, 0));
});

test('processDueRecurrences creates one occurrence when due', () => {
  const rec = recurrence({ nextRunAt: 500 });
  const result = Recurrence.processDueRecurrences(state([rec], [board()]), 1000, makeDeps());
  assert.equal(result.changed, true);
  assert.equal(result.created, 1);
  const cards = result.state.boards[0].columns[0].cards;
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, 'Daily check');
  assert.equal(cards[0].recurrenceId, 'rec-1');
  const processed = result.state.recurrences[0];
  assert.equal(processed.nextRunAt, Recurrence.computeNextRun(processed, 1000000));
});

test('processing is idempotent for the same window', () => {
  const deps = makeDeps();
  const rec = recurrence({ nextRunAt: 500 });
  const once = Recurrence.processDueRecurrences(state([rec], [board()]), 1000, deps);
  const twice = Recurrence.processDueRecurrences(once.state, 1000, deps);
  assert.equal(twice.changed, false);
  assert.equal(twice.created, 0);
  assert.equal(once.state.boards[0].columns[0].cards.length, 1);
});

test('nothing is created when nothing is due', () => {
  const rec = recurrence({ nextRunAt: 5000 });
  const result = Recurrence.processDueRecurrences(state([rec], [board()]), 1000, makeDeps());
  assert.equal(result.changed, false);
  assert.equal(result.created, 0);
});

test('single-active policy prevents pile-up', () => {
  const rec = recurrence({ nextRunAt: 500, activeCardRef: { boardId: 'board-1', cardId: 'c-open' } });
  const b = board();
  b.columns[0].cards = [{ id: 'c-open', title: 'Open', columnId: 'col-1', recurrenceId: 'rec-1' }];
  const result = Recurrence.processDueRecurrences(state([rec], [b]), 1000, makeDeps());
  assert.equal(result.created, 0);
  assert.equal(result.skippedWaiting, 1);
});

test('single-active clears completed active refs and creates the next', () => {
  const rec = recurrence({ nextRunAt: 500, activeCardRef: { boardId: 'board-1', cardId: 'c-done' } });
  const b = board();
  b.columns[1].cards = [{ id: 'c-done', title: 'Done instance', columnId: 'col-d', recurrenceId: 'rec-1' }];
  const result = Recurrence.processDueRecurrences(state([rec], [b]), 1000, makeDeps());
  assert.equal(result.created, 1);
  assert.equal(result.state.boards[0].columns[0].cards.length, 1);
  assert.deepEqual(result.state.recurrences[0].activeCardRef, { boardId: 'board-1', cardId: 'gen-1' });
});

test('allow-overlap creates despite an open instance', () => {
  const rec = recurrence({ nextRunAt: 500, overlapPolicy: 'allow-overlap', activeCardRef: { boardId: 'board-1', cardId: 'c-open' } });
  const b = board();
  b.columns[0].cards = [{ id: 'c-open', title: 'Open', columnId: 'col-1', recurrenceId: 'rec-1' }];
  const result = Recurrence.processDueRecurrences(state([rec], [b]), 1000, makeDeps());
  assert.equal(result.created, 1);
});

test('skip missed policy creates nothing and advances the schedule', () => {
  const rec = recurrence({ nextRunAt: 500, missedPolicy: 'skip', lastRunAt: 100 });
  const result = Recurrence.processDueRecurrences(state([rec], [board()]), 10 * DAY, makeDeps());
  assert.equal(result.created, 0);
  const processedSkip = result.state.recurrences[0];
  assert.ok(processedSkip.nextRunAt > 10 * DAY);
});

test('create-one policy creates a single current occurrence', () => {
  const rec = recurrence({ nextRunAt: 500, missedPolicy: 'create-one', lastRunAt: 100 });
  const result = Recurrence.processDueRecurrences(state([rec], [board()]), 10 * DAY, makeDeps());
  assert.equal(result.created, 1);
  assert.equal(result.state.boards[0].columns[0].cards.length, 1);
});

test('catch-up-all policy creates every missed occurrence', () => {
  const rec = recurrence({ nextRunAt: 500, missedPolicy: 'catch-up-all', lastRunAt: 100 });
  const result = Recurrence.processDueRecurrences(state([rec], [board()]), 500 + 4 * DAY, makeDeps());
  assert.equal(result.created, 5);
  assert.equal(result.state.boards[0].columns[0].cards.length, 5);
});

test('catch-up is capped at one hundred cards per pass', () => {
  const rec = recurrence({ nextRunAt: 500, missedPolicy: 'catch-up-all', lastRunAt: 100 });
  const result = Recurrence.processDueRecurrences(state([rec], [board()]), 500 + 500 * DAY, makeDeps());
  assert.equal(result.created, Recurrence.CATCH_UP_CAP);
});

test('after-completion mode schedules from completion', () => {
  const rec = recurrence({ mode: 'after-completion', schedule: { frequency: 'custom', delayAfterCompletionDays: 7 }, activeCardRef: { boardId: 'board-1', cardId: 'c1' } });
  const b = board();
  b.columns[1].cards = [{ id: 'c1', title: 'Done', columnId: 'col-d', recurrenceId: 'rec-1', completedAt: 2000 }];
  const result = Recurrence.handleRecurringCardCompletion(state([rec], [b]), { boardId: 'board-1', cardId: 'c1' }, 3000, makeDeps());
  assert.equal(result.changed, true);
  const processedCompletion = result.state.recurrences[0];
  assert.equal(processedCompletion.lastCompletedAt, 2000);
  assert.equal(processedCompletion.nextRunAt, localDate(1970, 1, 8, 0));
  assert.equal(processedCompletion.activeCardRef, null);
});

test('re-completing after reopening does not duplicate the schedule', () => {
  const rec = recurrence({ mode: 'after-completion', schedule: { frequency: 'custom', delayAfterCompletionDays: 7 }, lastCompletedAt: 2000, nextRunAt: localDate(1970, 1, 8, 0), activeCardRef: null });
  const b = board();
  b.columns[1].cards = [{ id: 'c1', title: 'Done', columnId: 'col-d', recurrenceId: 'rec-1', completedAt: 2500 }];
  const result = Recurrence.handleRecurringCardCompletion(state([rec], [b]), { boardId: 'board-1', cardId: 'c1' }, 3000, makeDeps());
  assert.equal(result.changed, false);
  assert.equal(result.state.recurrences[0].nextRunAt, localDate(1970, 1, 8, 0));
});

test('scheduled completion clears the active ref and schedules forward', () => {
  const rec = recurrence({ mode: 'scheduled', nextRunAt: 100, activeCardRef: { boardId: 'board-1', cardId: 'c1' } });
  const b = board();
  b.columns[1].cards = [{ id: 'c1', title: 'Done', columnId: 'col-d', recurrenceId: 'rec-1', completedAt: 2000 }];
  const result = Recurrence.handleRecurringCardCompletion(state([rec], [b]), { boardId: 'board-1', cardId: 'c1' }, 3000, makeDeps());
  assert.equal(result.changed, true);
  assert.equal(result.state.recurrences[0].activeCardRef, null);
  assert.ok(result.state.recurrences[0].nextRunAt > 2000);
});

test('pause and resume preserve schedule intent', () => {
  const rec = recurrence({ nextRunAt: 500 });
  const paused = Recurrence.pauseRecurrence(state([rec], [board()]), 'rec-1', 'Busy week', makeDeps());
  assert.equal(paused.changed, true);
  const pausedRec = paused.state.recurrences[0];
  assert.equal(pausedRec.enabled, false);
  assert.equal(pausedRec.pausedReason, 'Busy week');
  const resumed = Recurrence.resumeRecurrence(paused.state, 'rec-1', makeDeps());
  assert.equal(resumed.changed, true);
  const resumedRec = resumed.state.recurrences[0];
  assert.equal(resumedRec.enabled, true);
  assert.equal(resumedRec.pausedReason, '');
});

test('pausing an already-paused recurrence is a no-op', () => {
  const rec = recurrence({ enabled: false });
  const result = Recurrence.pauseRecurrence(state([rec], [board()]), 'rec-1', '', makeDeps());
  assert.equal(result.changed, false);
});

test('a missing target column marks the recurrence as needing attention', () => {
  const rec = recurrence({ nextRunAt: 500, target: { boardId: 'board-1', columnId: 'ghost' } });
  const result = Recurrence.processDueRecurrences(state([rec], [board()]), 1000, makeDeps());
  assert.equal(result.changed, true);
  assert.equal(result.created, 0);
  assert.equal(result.state.recurrences[0].needsAttention, true);
});

test('an existing target column clears the needs-attention mark', () => {
  const rec = recurrence({ nextRunAt: 500, needsAttention: true });
  const result = Recurrence.processDueRecurrences(state([rec], [board()]), 1000, makeDeps());
  assert.equal(result.changed, true);
  assert.equal(result.state.recurrences[0].needsAttention, false);
});

test('a missing target board disables the recurrence with a reason', () => {
  const rec = recurrence({ nextRunAt: 500, target: { boardId: 'ghost', columnId: 'col-1' } });
  const result = Recurrence.processDueRecurrences(state([rec], [board()]), 1000, makeDeps());
  assert.equal(result.changed, true);
  const disabledRec = result.state.recurrences[0];
  assert.equal(disabledRec.enabled, false);
  assert.equal(disabledRec.pausedReason, 'Target board deleted');
});

test('occurrences get fresh ids and reset checklist completion', () => {
  const rec = recurrence({
    nextRunAt: 500,
    template: { title: 'X', checklist: [{ id: 'old-1', text: 'Step', done: true }] }
  });
  const result = Recurrence.processDueRecurrences(state([rec], [board()]), 1000, makeDeps());
  const card = result.state.boards[0].columns[0].cards[0];
  assert.notEqual(card.id, 'old-anything');
  assert.notEqual(card.checklist[0].id, 'old-1');
  assert.equal(card.checklist[0].done, false);
});

test('occurrence due date applies the relative offset', () => {
  const rec = recurrence({ nextRunAt: 500, dueOffsetDays: 3 });
  const result = Recurrence.processDueRecurrences(state([rec], [board()]), localDate(2026, 8, 7), makeDeps());
  const card = result.state.boards[0].columns[0].cards[0];
  assert.equal(card.due, '1970-01-04');
});

test('runNow creates an occurrence immediately', () => {
  const rec = recurrence({ mode: 'scheduled', nextRunAt: 999999 });
  const result = Recurrence.runNow(state([rec], [board()]), 'rec-1', makeDeps());
  assert.equal(result.changed, true);
  assert.equal(result.state.boards[0].columns[0].cards.length, 1);
});

test('runNow respects single-active', () => {
  const rec = recurrence({ activeCardRef: { boardId: 'board-1', cardId: 'c-open' } });
  const b = board();
  b.columns[0].cards = [{ id: 'c-open', title: 'Open', columnId: 'col-1', recurrenceId: 'rec-1' }];
  const result = Recurrence.runNow(state([rec], [b]), 'rec-1', makeDeps());
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'single-active');
});

test('no function relies on the system clock', () => {
  const rec = recurrence({ nextRunAt: 500 });
  const result = Recurrence.processDueRecurrences(state([rec], [board()]), 1000, makeDeps());
  assert.equal(result.changed, true);
  assert.ok(result.state.boards[0].columns[0].cards.length === 1);
});

test('after-completion mode creates the next card once the delay has passed', () => {
  const rec = recurrence({
    mode: 'after-completion',
    schedule: { frequency: 'custom', delayAfterCompletionDays: 7 },
    nextRunAt: localDate(1970, 1, 8, 0)
  });
  const result = Recurrence.processDueRecurrences(state([rec], [board()]), localDate(1970, 1, 9, 0), makeDeps());
  assert.equal(result.changed, true);
  assert.equal(result.created, 1);
  const card = result.state.boards[0].columns[0].cards[0];
  assert.equal(card.title, 'Daily check');
  assert.equal(card.recurrenceId, 'rec-1');
});

test('after-completion mode does not create before the delay passes', () => {
  const rec = recurrence({
    mode: 'after-completion',
    schedule: { frequency: 'custom', delayAfterCompletionDays: 7 },
    nextRunAt: localDate(1970, 1, 8, 0)
  });
  const result = Recurrence.processDueRecurrences(state([rec], [board()]), localDate(1970, 1, 7, 0), makeDeps());
  assert.equal(result.changed, false);
  assert.equal(result.created, 0);
});

test('after-completion mode seeds the first card when none is active', () => {
  const rec = recurrence({
    mode: 'after-completion',
    schedule: { frequency: 'custom', delayAfterCompletionDays: 7 },
    nextRunAt: null,
    activeCardRef: null
  });
  const result = Recurrence.processDueRecurrences(state([rec], [board()]), 1000, makeDeps());
  assert.equal(result.changed, true);
  assert.equal(result.created, 1);
  const processed = result.state.recurrences[0];
  assert.equal(processed.nextRunAt, null);
  assert.deepEqual(processed.activeCardRef, { boardId: 'board-1', cardId: 'gen-1' });
  const again = Recurrence.processDueRecurrences(result.state, 1000, makeDeps());
  assert.equal(again.created, 0);
});

test('a monthly day-31 schedule never returns the base date', () => {
  const rec = recurrence({ schedule: { frequency: 'monthly', interval: 1, dayOfMonth: 31 } });
  const jan31 = localDate(2026, 1, 31);
  const next = Recurrence.computeNextRun(rec, jan31);
  assert.ok(next > jan31);
  assert.equal(new Date(next).getDate(), 28);
  const feb28 = localDate(2026, 2, 28);
  const afterFeb = Recurrence.computeNextRun(rec, feb28);
  assert.equal(new Date(afterFeb).getDate(), 31);
  assert.equal(new Date(afterFeb).getMonth(), 2);
});

test('a monthly day-31 schedule does not flood occurrences', () => {
  const rec = recurrence({ schedule: { frequency: 'monthly', interval: 1, dayOfMonth: 31 }, nextRunAt: localDate(2026, 1, 31) });
  const result = Recurrence.processDueRecurrences(state([rec], [board()]), localDate(2026, 2, 10), makeDeps());
  assert.equal(result.created, 1);
  assert.equal(result.state.boards[0].columns[0].cards.length, 1);
});

test('weekly schedule with weekdays honours the interval', () => {
  const rec = recurrence({ schedule: { frequency: 'weekly', interval: 2, weekdays: [0] } });
  const monday = localDate(2026, 8, 3);
  const next = Recurrence.computeNextRun(rec, monday);
  assert.equal(new Date(next).getDay(), 0);
  assert.equal(next, localDate(2026, 8, 16, 0));
});

test('an occurrence created from an after-completion run does not schedule forward', () => {
  const rec = recurrence({
    mode: 'after-completion',
    schedule: { frequency: 'custom', delayAfterCompletionDays: 7 },
    nextRunAt: localDate(1970, 1, 8, 0)
  });
  const result = Recurrence.processDueRecurrences(state([rec], [board()]), localDate(1970, 1, 9, 0), makeDeps());
  assert.equal(result.state.recurrences[0].nextRunAt, null);
});







test('occurrence creation initializes lifecycle in the target column', () => {
  const rec = recurrence({ nextRunAt: localDate(2026, 8, 7, 0) });
  const boards = [board()];
  boards[0].columns[0].role = 'active';
  const result = Recurrence.processDueRecurrences(state([rec], boards), localDate(2026, 8, 7, 12), makeDeps());
  const created = result.state.boards[0].columns[0].cards[0];
  assert.equal(created.startedAt, 1000000);
  assert.equal(created.completedAt, null);
  assert.equal(created.transitions.length, 1);
});

test('occurrence creation applies entry defaults from the target column', () => {
  const rec = recurrence({ nextRunAt: localDate(2026, 8, 7, 0) });
  const boards = [board()];
  boards[0].labels = [{ id: 'l-1', name: 'Bug', color: '#c81e14' }];
  boards[0].columns[0].policy = { defaultLabelIds: ['l-1'], defaultAssignee: 'Sam' };
  const result = Recurrence.processDueRecurrences(state([rec], boards), localDate(2026, 8, 7, 12), makeDeps());
  const created = result.state.boards[0].columns[0].cards[0];
  assert.deepEqual(created.labels, ['l-1']);
  assert.equal(created.assignee, 'Sam');
});

test('a hard WIP limit blocks occurrence creation and flags the recurrence', () => {
  const rec = recurrence({ nextRunAt: 1 });
  const boards = [board()];
  boards[0].columns[0].wipLimit = 1;
  boards[0].columns[0].policy = { wipMode: 'hard' };
  boards[0].columns[0].cards = [{ id: 'filler', columnId: 'col-1', title: 'Filler', flow: { state: 'normal', reason: '', since: null, periods: [] } }];
  const result = Recurrence.processDueRecurrences(state([rec], boards), 1000000, makeDeps());
  assert.equal(result.created, 0);
  assert.equal(result.state.boards[0].columns[0].cards.length, 1);
  assert.equal(result.state.recurrences[0].policyBlocked, true);
});

test('an occurrence is created once the policy stops blocking', () => {
  const rec = recurrence({ nextRunAt: 1 });
  const boards = [board()];
  boards[0].columns[0].wipLimit = 1;
  boards[0].columns[0].policy = { wipMode: 'hard' };
  boards[0].columns[0].cards = [{ id: 'filler', columnId: 'col-1', title: 'Filler', flow: { state: 'normal', reason: '', since: null, periods: [] } }];
  let result = Recurrence.processDueRecurrences(state([rec], boards), 1000000, makeDeps());
  assert.equal(result.state.recurrences[0].policyBlocked, true);
  const unblockedState = JSON.parse(JSON.stringify(result.state));
  unblockedState.boards[0].columns[0].cards = [];
  const unblocked = Recurrence.processDueRecurrences(unblockedState, 1000002, makeDeps());
  assert.equal(unblocked.created, 1);
  assert.equal(unblocked.state.recurrences[0].policyBlocked, false);
  assert.equal(unblocked.state.boards[0].columns[0].cards.length, 1);
});

test('runNow surfaces a policy block', () => {
  const rec = recurrence({ nextRunAt: null });
  const boards = [board()];
  boards[0].columns[0].wipLimit = 1;
  boards[0].columns[0].policy = { wipMode: 'hard' };
  boards[0].columns[0].cards = [{ id: 'filler', columnId: 'col-1', title: 'Filler', flow: { state: 'normal', reason: '', since: null, periods: [] } }];
  const result = Recurrence.runNow(state([rec], boards), 'rec-1', makeDeps());
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'policy');
});

test('after-completion targeting a done column schedules from the completion instead of stalling', () => {
  const rec = recurrence({
    mode: 'after-completion',
    schedule: { frequency: 'custom', delayAfterCompletionDays: 3 },
    target: { boardId: 'board-1', columnId: 'col-d' },
    nextRunAt: null
  });
  const boards = [board()];
  boards[0].columns[1].role = 'done';
  boards[0].columns[1].isDone = true;
  let result = Recurrence.processDueRecurrences(state([rec], boards), 1000000, makeDeps());
  assert.equal(result.created, 1);
  assert.equal(result.state.boards[0].columns[1].cards.length, 1);
  const created = result.state.boards[0].columns[1].cards[0];
  assert.equal(typeof created.completedAt, 'number');
  const after = result.state.recurrences[0];
  assert.ok(after.nextRunAt !== null);
  assert.ok(after.nextRunAt > 1000000);
  const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
  assert.equal(after.nextRunAt, startOfDay(created.completedAt) + 3 * DAY);
  for (let i = 0; i < 10; i++) {
    result = Recurrence.processDueRecurrences(result.state, 1000000 + i * 1000, makeDeps());
    assert.equal(result.state.boards[0].columns[1].cards.length, 1);
  }
});
