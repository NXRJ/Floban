const { test } = require('node:test');
const assert = require('node:assert/strict');
const Filtering = require('../../js/core/filtering.js');

const TODAY = '2026-08-07';
const WEEK_END = '2026-08-13';
const TOMORROW = '2026-08-08';

function makeCard(overrides) {
  return Object.assign({
    id: 'card-1',
    columnId: 'column-1',
    title: 'Task',
    description: '',
    labels: [],
    assignee: '',
    createdAt: 100,
    updatedAt: 100,
    movedAt: 100,
    due: '',
    checklist: []
  }, overrides || {});
}

function makeFilters(overrides) {
  return Object.assign({
    search: '',
    labels: new Set(),
    assignee: '',
    due: ''
  }, overrides || {});
}

function ctx() {
  return { today: TODAY, weekEnd: WEEK_END };
}

test('empty search matches every card', () => {
  const card = makeCard({ title: 'Anything' });
  assert.equal(Filtering.matchesCard(card, makeFilters(), ctx()), true);
});

test('search matches the title', () => {
  const card = makeCard({ title: 'Ship the onboarding flow' });
  assert.equal(Filtering.matchesCard(card, makeFilters({ search: 'onboarding' }), ctx()), true);
});

test('search matches the description', () => {
  const card = makeCard({ title: 'Task', description: 'Fix the pointer events' });
  assert.equal(Filtering.matchesCard(card, makeFilters({ search: 'pointer' }), ctx()), true);
});

test('search is case-insensitive', () => {
  const card = makeCard({ title: 'Fix Card Drag On Touch' });
  assert.equal(Filtering.matchesCard(card, makeFilters({ search: 'card drag' }), ctx()), true);
  assert.equal(Filtering.matchesCard(card, makeFilters({ search: 'CARD' }), ctx()), true);
});

test('search handles a missing description', () => {
  const card = makeCard({ title: 'Task' });
  delete card.description;
  assert.equal(Filtering.matchesCard(card, makeFilters({ search: 'Task' }), ctx()), true);
  assert.equal(Filtering.matchesCard(card, makeFilters({ search: 'missing' }), ctx()), false);
});

test('search with no match fails', () => {
  const card = makeCard({ title: 'Task' });
  assert.equal(Filtering.matchesCard(card, makeFilters({ search: 'nope' }), ctx()), false);
});

test('non-string title and description values do not create false positives', () => {
  const card = makeCard({ title: 'Task' });
  card.title = undefined;
  card.description = undefined;
  assert.equal(Filtering.matchesCard(card, makeFilters({ search: 'undefined' }), ctx()), false);
  assert.equal(Filtering.matchesCard(card, makeFilters({ search: 'null' }), ctx()), false);
});

test('no selected labels matches every card', () => {
  const card = makeCard({ labels: [] });
  const filters = makeFilters();
  filters.labels = new Set();
  assert.equal(Filtering.matchesCard(card, filters, ctx()), true);
  const card2 = makeCard({ labels: ['label-1'] });
  assert.equal(Filtering.matchesCard(card2, filters, ctx()), true);
});

test('one selected label matches cards carrying it', () => {
  const filters = makeFilters();
  filters.labels = new Set(['label-1']);
  assert.equal(Filtering.matchesCard(makeCard({ labels: ['label-1'] }), filters, ctx()), true);
  assert.equal(Filtering.matchesCard(makeCard({ labels: ['label-2'] }), filters, ctx()), false);
});

test('multiple selected labels use OR logic', () => {
  const filters = makeFilters();
  filters.labels = new Set(['label-1', 'label-2']);
  assert.equal(Filtering.matchesCard(makeCard({ labels: ['label-1'] }), filters, ctx()), true);
  assert.equal(Filtering.matchesCard(makeCard({ labels: ['label-2'] }), filters, ctx()), true);
  assert.equal(Filtering.matchesCard(makeCard({ labels: ['label-3'] }), filters, ctx()), false);
});

test('a missing card label array is handled safely', () => {
  const filters = makeFilters();
  filters.labels = new Set(['label-1']);
  const card = makeCard({ labels: undefined });
  delete card.labels;
  assert.equal(Filtering.matchesCard(card, filters, ctx()), false);
  const empty = makeFilters();
  empty.labels = new Set();
  assert.equal(Filtering.matchesCard(card, empty, ctx()), true);
});

test('label filters combine with other categories using AND logic', () => {
  const filters = makeFilters({ search: 'task' });
  filters.labels = new Set(['label-1']);
  assert.equal(Filtering.matchesCard(makeCard({ title: 'Task', labels: ['label-1'] }), filters, ctx()), true);
  assert.equal(Filtering.matchesCard(makeCard({ title: 'Other', labels: ['label-1'] }), filters, ctx()), false);
  assert.equal(Filtering.matchesCard(makeCard({ title: 'Task', labels: ['label-2'] }), filters, ctx()), false);
});

test('assignee filter matches exactly', () => {
  const filters = makeFilters({ assignee: 'Sam' });
  assert.equal(Filtering.matchesCard(makeCard({ assignee: 'Sam' }), filters, ctx()), true);
  assert.equal(Filtering.matchesCard(makeCard({ assignee: 'sam' }), filters, ctx()), false);
});

test('a different assignee fails the filter', () => {
  const filters = makeFilters({ assignee: 'Sam' });
  assert.equal(Filtering.matchesCard(makeCard({ assignee: 'Alex' }), filters, ctx()), false);
});

test('unassigned filter matches a card without an assignee', () => {
  const filters = makeFilters({ assignee: Filtering.UNASSIGNED });
  assert.equal(Filtering.matchesCard(makeCard({ assignee: '' }), filters, ctx()), true);
  assert.equal(Filtering.matchesCard(makeCard(), filters, ctx()), true);
  assert.equal(Filtering.matchesCard(makeCard({ assignee: 'Sam' }), filters, ctx()), false);
});

test('whitespace-only assignee counts as unassigned', () => {
  const filters = makeFilters({ assignee: Filtering.UNASSIGNED });
  assert.equal(Filtering.matchesCard(makeCard({ assignee: '   ' }), filters, ctx()), true);
});

test('missing assignee counts as unassigned', () => {
  const filters = makeFilters({ assignee: Filtering.UNASSIGNED });
  const card = makeCard();
  delete card.assignee;
  assert.equal(Filtering.matchesCard(card, filters, ctx()), true);
});

test('no assignee filter ignores assignees', () => {
  const filters = makeFilters();
  assert.equal(Filtering.matchesCard(makeCard({ assignee: 'Sam' }), filters, ctx()), true);
  assert.equal(Filtering.matchesCard(makeCard({ assignee: '' }), filters, ctx()), true);
});

test('due filter matches overdue cards', () => {
  const filters = makeFilters({ due: 'overdue' });
  assert.equal(Filtering.matchesCard(makeCard({ due: '2026-08-06' }), filters, ctx()), true);
  assert.equal(Filtering.matchesCard(makeCard({ due: TODAY }), filters, ctx()), false);
  assert.equal(Filtering.matchesCard(makeCard({ due: '' }), filters, ctx()), false);
});

test('due filter matches cards due today', () => {
  const filters = makeFilters({ due: 'today' });
  assert.equal(Filtering.matchesCard(makeCard({ due: TODAY }), filters, ctx()), true);
  assert.equal(Filtering.matchesCard(makeCard({ due: '2026-08-06' }), filters, ctx()), false);
  assert.equal(Filtering.matchesCard(makeCard({ due: TOMORROW }), filters, ctx()), false);
});

test('due filter matches cards due this week', () => {
  const filters = makeFilters({ due: 'week' });
  assert.equal(Filtering.matchesCard(makeCard({ due: TODAY }), filters, ctx()), true);
  assert.equal(Filtering.matchesCard(makeCard({ due: WEEK_END }), filters, ctx()), true);
  assert.equal(Filtering.matchesCard(makeCard({ due: '2026-08-14' }), filters, ctx()), false);
  assert.equal(Filtering.matchesCard(makeCard({ due: '2026-08-06' }), filters, ctx()), false);
  assert.equal(Filtering.matchesCard(makeCard({ due: '' }), filters, ctx()), false);
});

test('due filter matches cards without a due date', () => {
  const filters = makeFilters({ due: 'none' });
  assert.equal(Filtering.matchesCard(makeCard({ due: '' }), filters, ctx()), true);
  assert.equal(Filtering.matchesCard(makeCard({ due: TODAY }), filters, ctx()), false);
});

test('empty due filter matches all due states', () => {
  const filters = makeFilters();
  assert.equal(Filtering.matchesCard(makeCard({ due: '' }), filters, ctx()), true);
  assert.equal(Filtering.matchesCard(makeCard({ due: TODAY }), filters, ctx()), true);
  assert.equal(Filtering.matchesCard(makeCard({ due: '2026-08-06' }), filters, ctx()), true);
});

test('week due filter includes the week boundary date', () => {
  const filters = makeFilters({ due: 'week' });
  assert.equal(Filtering.matchesCard(makeCard({ due: '2026-08-13' }), filters, ctx()), true);
});

test('week due filter excludes dates after the boundary', () => {
  const filters = makeFilters({ due: 'week' });
  assert.equal(Filtering.matchesCard(makeCard({ due: '2026-08-14' }), filters, ctx()), false);
});

test('hasActiveFilters is false when nothing is set', () => {
  assert.equal(Filtering.hasActiveFilters(makeFilters()), false);
});

test('hasActiveFilters detects each filter category', () => {
  assert.equal(Filtering.hasActiveFilters(makeFilters({ search: 'x' })), true);
  const labels = makeFilters();
  labels.labels = new Set(['l']);
  assert.equal(Filtering.hasActiveFilters(labels), true);
  assert.equal(Filtering.hasActiveFilters(makeFilters({ assignee: 'Sam' })), true);
  assert.equal(Filtering.hasActiveFilters(makeFilters({ due: 'today' })), true);
});

test('sort by due places earlier dates first', () => {
  const a = makeCard({ id: 'a', due: '2026-08-10' });
  const b = makeCard({ id: 'b', due: '2026-08-05' });
  assert.equal(Filtering.compareCards(a, b, 'due'), 1);
  assert.equal(Filtering.compareCards(b, a, 'due'), -1);
});

test('cards without a due date sort last', () => {
  const a = makeCard({ id: 'a', due: '2026-08-10' });
  const b = makeCard({ id: 'b', due: '' });
  const c = makeCard({ id: 'c', due: null });
  assert.equal(Filtering.compareCards(a, b, 'due'), -1);
  assert.equal(Filtering.compareCards(b, a, 'due'), 1);
  assert.equal(Filtering.compareCards(b, c, 'due'), 0);
});

test('equal due dates compare equally', () => {
  const a = makeCard({ id: 'a', due: '2026-08-10' });
  const b = makeCard({ id: 'b', due: '2026-08-10' });
  assert.equal(Filtering.compareCards(a, b, 'due'), 0);
});

test('sort by created places oldest first', () => {
  const a = makeCard({ id: 'a', createdAt: 200 });
  const b = makeCard({ id: 'b', createdAt: 100 });
  assert.equal(Filtering.compareCards(a, b, 'created'), 100);
  assert.equal(Filtering.compareCards(b, a, 'created'), -100);
});

test('sort by updated places newest first', () => {
  const a = makeCard({ id: 'a', updatedAt: 200 });
  const b = makeCard({ id: 'b', updatedAt: 100 });
  assert.equal(Filtering.compareCards(a, b, 'updated'), -100);
  assert.equal(Filtering.compareCards(b, a, 'updated'), 100);
});

test('manual mode preserves input order', () => {
  const a = makeCard({ id: 'a', due: '2026-01-01', createdAt: 1, updatedAt: 1 });
  const b = makeCard({ id: 'b', due: '2026-02-02', createdAt: 2, updatedAt: 2 });
  assert.equal(Filtering.compareCards(a, b, 'manual'), 0);
  assert.equal(Filtering.compareCards(b, a, 'manual'), 0);
});

test('invalid sort modes fall back to manual ordering', () => {
  const a = makeCard({ id: 'a' });
  const b = makeCard({ id: 'b' });
  assert.equal(Filtering.compareCards(a, b, 'bogus'), 0);
  assert.equal(Filtering.compareCards(a, b, undefined), 0);
  assert.equal(Filtering.compareCards(a, b, ''), 0);
});

test('isValidSortMode accepts the known modes only', () => {
  assert.equal(Filtering.isValidSortMode('manual'), true);
  assert.equal(Filtering.isValidSortMode('due'), true);
  assert.equal(Filtering.isValidSortMode('created'), true);
  assert.equal(Filtering.isValidSortMode('updated'), true);
  assert.equal(Filtering.isValidSortMode('bogus'), false);
  assert.equal(Filtering.isValidSortMode(''), false);
});

test('the unassigned sentinel matches the browser value', () => {
  assert.equal(Filtering.UNASSIGNED, '__unassigned__');
});

test('filters with labels as an array behave like a Set', () => {
  const filters = makeFilters();
  filters.labels = ['label-1', 'label-2'];
  assert.equal(Filtering.matchesCard(makeCard({ labels: ['label-2'] }), filters, ctx()), true);
  assert.equal(Filtering.matchesCard(makeCard({ labels: ['label-9'] }), filters, ctx()), false);
});
