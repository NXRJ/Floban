const { test } = require('node:test');
const assert = require('node:assert/strict');
const When = require('../../js/core/when.js');
const Nlparse = require('../../js/core/nlparse.js');
const Calendar = require('../../js/core/calendar.js');

// Fixed injected clock: Wednesday 2026-08-12 10:00 local.
const NOW = new Date(2026, 7, 12, 10, 0).getTime();
const TODAY = '2026-08-12';

function card(overrides) {
  return Object.assign({
    id: 'c1', title: 'Task', due: '', when: '', completedAt: null, archivedAt: null
  }, overrides || {});
}

// ---- planDay ---------------------------------------------------------------

test('planDay prefers when, falls back to due, else null', () => {
  assert.equal(When.planDay(card({ when: '2026-08-14', due: '2026-08-20' })), '2026-08-14');
  assert.equal(When.planDay(card({ due: '2026-08-20' })), '2026-08-20');
  assert.equal(When.planDay(card({})), null);
  assert.equal(When.planDay(card({ when: 'not-a-date', due: '2026-08-20' })), '2026-08-20');
  assert.equal(When.planDay(null), null);
});

// ---- classifyWhen ----------------------------------------------------------

test('classifyWhen: future when is not yet actionable', () => {
  assert.equal(When.classifyWhen(card({ when: '2026-08-14' }), TODAY), 'future');
});

test('classifyWhen: when today is the do-today signal', () => {
  assert.equal(When.classifyWhen(card({ when: TODAY }), TODAY), 'today');
});

test('classifyWhen: no when, due today is active; due past is active', () => {
  assert.equal(When.classifyWhen(card({ due: TODAY }), TODAY), 'active');
  assert.equal(When.classifyWhen(card({ due: '2026-08-01' }), TODAY), 'active');
});

test('classifyWhen: no when, due future is future', () => {
  assert.equal(When.classifyWhen(card({ due: '2026-08-20' }), TODAY), 'future');
});

test('classifyWhen: no dates is active (actionable now)', () => {
  assert.equal(When.classifyWhen(card({}), TODAY), 'active');
});

test('classifyWhen: done and archived cards are never scheduled', () => {
  assert.equal(When.classifyWhen(card({ completedAt: 100 }), TODAY), null);
  assert.equal(When.classifyWhen(card({ archivedAt: 100 }), TODAY), null);
});

// ---- dueChips --------------------------------------------------------------

test('dueChips renders the DO/DUE pair in order', () => {
  const chips = When.dueChips(card({ when: '2026-08-14', due: '2026-08-20' }), TODAY);
  assert.equal(chips.length, 2);
  assert.match(chips[0].text, /^DO /);
  assert.match(chips[1].text, /^DUE /);
  assert.equal(chips[0].class, 'when');
  assert.equal(chips[1].class, 'due');
});

test('dueChips marks when-today and overdue due', () => {
  const chips = When.dueChips(card({ when: TODAY, due: '2026-08-01' }), TODAY);
  assert.match(chips[0].class, /when-today/);
  assert.match(chips[1].class, /overdue/);
});

test('dueChips with one date renders one chip; none renders none', () => {
  assert.equal(When.dueChips(card({ due: '2026-08-20' }), TODAY).length, 1);
  assert.equal(When.dueChips(card({ when: '2026-08-14' }), TODAY).length, 1);
  assert.equal(When.dueChips(card({}), TODAY).length, 0);
});

test('shortISO formats MM-DD', () => {
  assert.equal(When.shortISO('2026-08-14'), '08-14');
  assert.equal(When.shortISO('garbage'), 'garbage');
});

// ---- nlparse: parseWhenPhrase ----------------------------------------------

test('parseWhenPhrase: do <weekday> resolves to the next occurrence', () => {
  const r = Nlparse.parseWhenPhrase('do fri', { now: NOW });
  assert.equal(r.when, '2026-08-14'); // Wed Aug 12 -> next Friday Aug 14
  assert.equal(r.consumed, 'do fri');
  assert.equal(r.remainder, '');
});

test('parseWhenPhrase: start <month-day> resolves', () => {
  const r = Nlparse.parseWhenPhrase('start 20 aug', { now: NOW });
  assert.equal(r.when, '2026-08-20');
});

test('parseWhenPhrase: begin in N days resolves from today', () => {
  const r = Nlparse.parseWhenPhrase('begin in 3 days', { now: NOW });
  assert.equal(r.when, '2026-08-15');
});

test('parseWhenPhrase: non-date verbs return null', () => {
  const r = Nlparse.parseWhenPhrase('do laundry', { now: NOW });
  assert.equal(r.when, null);
  assert.equal(r.consumed, '');
  assert.equal(r.remainder, 'do laundry');
});

// ---- nlparse: parseQuickAdd when support -----------------------------------

test('parseQuickAdd: do <date> at the start sets when and strips it', () => {
  const r = Nlparse.parseQuickAdd('do fri ship landing page', { now: NOW });
  assert.equal(r.when, '2026-08-14');
  assert.equal(r.title, 'ship landing page');
  assert.equal(r.due, null);
});

test('parseQuickAdd: bare date still means due (backward compatible)', () => {
  const r = Nlparse.parseQuickAdd('fix api bug in 3 days p2', { now: NOW });
  assert.equal(r.when, null);
  assert.equal(r.due, '2026-08-15');
  assert.equal(r.title, 'fix api bug');
});

test('parseQuickAdd: do <date> does not hijack ordinary prose', () => {
  const r = Nlparse.parseQuickAdd('do the dishes', { now: NOW });
  assert.equal(r.when, null);
  assert.equal(r.title, 'do the dishes');
});

// ---- calendar: when-aware grid ---------------------------------------------

test('calendar places cards on their when day, overdue stays due-grounded', () => {
  const grid = Calendar.calendarGrid('2026-08', [
    { id: 'a', boardId: 'b', columnId: 'c', title: 'Planned', due: '2026-08-20', when: '2026-08-14', priority: 'none', completedAt: null },
    { id: 'b', boardId: 'b', columnId: 'c', title: 'Deadline only', due: '2026-08-14', when: '', priority: 'none', completedAt: null },
    { id: 'c', boardId: 'b', columnId: 'c', title: 'Late', due: '2026-08-01', when: '', priority: 'none', completedAt: null }
  ], NOW);
  const day14 = grid.weeks.flat().find(d => d.dateISO === '2026-08-14');
  const day20 = grid.weeks.flat().find(d => d.dateISO === '2026-08-20');
  assert.deepEqual(day14.cards.map(c => c.id).sort(), ['a', 'b']);
  assert.deepEqual(day20.cards.map(c => c.id), []);
  assert.deepEqual(grid.overdue.map(c => c.id), ['c']);
});

test('calendar: a planned card with future due is never overdue', () => {
  const grid = Calendar.calendarGrid('2026-08', [
    { id: 'a', boardId: 'b', columnId: 'c', title: 'Planned', due: '2026-08-20', when: '2026-08-14', priority: 'none', completedAt: null }
  ], NOW);
  assert.equal(grid.overdue.length, 0);
});

test('calendar planDay mirrors When.planDay', () => {
  assert.equal(Calendar.planDay({ due: '2026-08-20', when: '2026-08-14' }), '2026-08-14');
  assert.equal(Calendar.planDay({ due: '2026-08-20' }), '2026-08-20');
  assert.equal(Calendar.planDay({}), null);
});
