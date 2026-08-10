const { test } = require('node:test');
const assert = require('node:assert/strict');
const Calendar = require('../../js/core/calendar.js');

// Fixed injected clock: Wednesday 2026-08-12 10:00 local.
const NOW = new Date(2026, 7, 12, 10, 0).getTime();

function card(overrides) {
  return Object.assign({
    id: 'c1', boardId: 'b1', columnId: 'col1', title: 'Task', color: '#c81e14',
    priority: 'none', due: '2026-08-20', completedAt: null
  }, overrides || {});
}

test('grid reports year, month label and a stable 6-week shape', () => {
  const g = Calendar.calendarGrid('2026-08', [card()], NOW);
  assert.equal(g.year, 2026);
  assert.equal(g.month, 7);
  assert.equal(g.label, 'AUGUST 2026');
  assert.equal(g.weeks.length, 6);
  assert.equal(g.weeks[0].length, 7);
  assert.equal(g.weeks[5][6].dateISO.length, 10);
});

test('first weekday offset and other-month padding cells', () => {
  // 2026-08-01 is a Saturday -> the grid starts on Sunday 2026-07-26.
  const g = Calendar.calendarGrid('2026-08', [], NOW);
  const first = g.weeks[0][0];
  assert.equal(first.dateISO, '2026-07-26');
  assert.equal(first.inMonth, false);
  assert.equal(g.weeks[0][6].dateISO, '2026-08-01');
  assert.equal(g.weeks[0][6].inMonth, true);
});

test('today is marked from the injected clock', () => {
  const g = Calendar.calendarGrid('2026-08', [], NOW);
  const today = g.weeks.flat().find((d) => d.dateISO === '2026-08-12');
  assert.equal(today.isToday, true);
  assert.equal(g.weeks.flat().filter((d) => d.isToday).length, 1);
});

test('cards group under their due day; no-due cards are excluded', () => {
  const cards = [
    card({ id: 'a', due: '2026-08-14', title: 'Alpha' }),
    card({ id: 'b', due: '2026-08-14', title: 'Beta' }),
    card({ id: 'c', due: '2026-08-20', title: 'Gamma' }),
    card({ id: 'd', due: '', title: 'No due' }),
    card({ id: 'e', due: 'garbage', title: 'Bad due' })
  ];
  const g = Calendar.calendarGrid('2026-08', cards, NOW);
  const day14 = g.weeks.flat().find((d) => d.dateISO === '2026-08-14');
  const day20 = g.weeks.flat().find((d) => d.dateISO === '2026-08-20');
  assert.equal(day14.cards.length, 2);
  assert.deepEqual(day14.cards.map((c) => c.title).sort(), ['Alpha', 'Beta']);
  assert.equal(day20.cards.length, 1);
  assert.equal(g.weeks.flat().reduce((n, d) => n + d.cards.length, 0), 3);
});

test('overdue strip holds past-due open cards only', () => {
  const cards = [
    card({ id: 'a', due: '2026-08-01' }),
    card({ id: 'b', due: '2026-08-01', completedAt: 1000 }),
    card({ id: 'c', due: '2026-08-11' }),
    card({ id: 'd', due: '2026-08-12' }),
    card({ id: 'e', due: '' })
  ];
  const g = Calendar.calendarGrid('2026-08', cards, NOW);
  assert.deepEqual(g.overdue.map((c) => c.id).sort(), ['a', 'c']);
});

test('cards inside a day keep their color and priority', () => {
  const g = Calendar.calendarGrid('2026-08', [
    card({ id: 'a', due: '2026-08-14', color: '#3fd7e0', priority: 'high', title: 'Paint' })
  ], NOW);
  const day14 = g.weeks.flat().find((d) => d.dateISO === '2026-08-14');
  assert.equal(day14.cards[0].color, '#3fd7e0');
  assert.equal(day14.cards[0].priority, 'high');
});

test('leap and non-leap Februaries both lay out', () => {
  const leap = Calendar.calendarGrid('2028-02', [], NOW);
  assert.equal(leap.label, 'FEBRUARY 2028');
  assert.equal(leap.weeks.flat().filter((d) => d.inMonth).length, 29);
  const normal = Calendar.calendarGrid('2026-02', [], NOW);
  assert.equal(normal.weeks.flat().filter((d) => d.inMonth).length, 28);
});

test('December rolls over into January across the year boundary', () => {
  const g = Calendar.calendarGrid('2026-12', [], NOW);
  const last = g.weeks[5][6];
  assert.equal(last.dateISO.slice(0, 4), '2027');
  assert.equal(last.inMonth, false);
  assert.equal(Calendar.shiftMonth('2026-12', 1, NOW), '2027-01');
  assert.equal(Calendar.shiftMonth('2026-01', -1, NOW), '2025-12');
});

test('grid is deterministic and does not mutate inputs', () => {
  const cards = [card({ id: 'a', due: '2026-08-14' })];
  const snapshot = JSON.stringify(cards);
  const a = Calendar.calendarGrid('2026-08', cards, NOW);
  const b = Calendar.calendarGrid('2026-08', cards, NOW);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(cards), snapshot);
});
