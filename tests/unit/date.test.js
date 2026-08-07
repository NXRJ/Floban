const { test } = require('node:test');
const assert = require('node:assert/strict');
const DateCore = require('../../js/core/date.js');

test('isoDate formats a normal date with zero padding', () => {
  assert.equal(DateCore.isoDate(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(DateCore.isoDate(new Date(2026, 7, 7)), '2026-08-07');
});

test('isoDate handles month rollover', () => {
  assert.equal(DateCore.isoDate(new Date(2026, 1, 1)), '2026-02-01');
  assert.equal(DateCore.isoDate(new Date(2026, 0, 31)), '2026-01-31');
});

test('isoDate handles year rollover', () => {
  assert.equal(DateCore.isoDate(new Date(2025, 11, 31)), '2025-12-31');
  assert.equal(DateCore.isoDate(new Date(2026, 0, 1)), '2026-01-01');
});

test('isoDate handles leap-year rollover', () => {
  assert.equal(DateCore.isoDate(new Date(2024, 1, 29)), '2024-02-29');
  assert.equal(DateCore.isoDate(new Date(2024, 1, 29)), '2024-02-29');
});

test('addDaysISO supports negative offsets and does not mutate the input date', () => {
  const input = new Date(2026, 2, 1);
  assert.equal(DateCore.addDaysISO(input, -1), '2026-02-28');
  assert.equal(DateCore.addDaysISO(input, -2), '2026-02-27');
  assert.equal(input.getDate(), 1);
  assert.equal(input.getMonth(), 2);
});

test('addDaysISO rolls over months and years forward', () => {
  assert.equal(DateCore.addDaysISO(new Date(2026, 0, 31), 1), '2026-02-01');
  assert.equal(DateCore.addDaysISO(new Date(2026, 11, 31), 1), '2027-01-01');
});

test('classifyDueDate marks overdue before today', () => {
  assert.equal(DateCore.classifyDueDate('2026-08-06', '2026-08-07', '2026-08-08'), 'overdue');
});

test('classifyDueDate marks today as soon', () => {
  assert.equal(DateCore.classifyDueDate('2026-08-07', '2026-08-07', '2026-08-08'), 'soon');
});

test('classifyDueDate marks tomorrow as soon (inclusive boundary)', () => {
  assert.equal(DateCore.classifyDueDate('2026-08-08', '2026-08-07', '2026-08-08'), 'soon');
});

test('classifyDueDate leaves later dates unclassified', () => {
  assert.equal(DateCore.classifyDueDate('2026-08-09', '2026-08-07', '2026-08-08'), '');
});

test('classifyDueDate handles a missing due date', () => {
  assert.equal(DateCore.classifyDueDate('', '2026-08-07', '2026-08-08'), '');
  assert.equal(DateCore.classifyDueDate(null, '2026-08-07', '2026-08-08'), '');
});

test('isDueMatch overdue requires a due date strictly before today', () => {
  assert.equal(DateCore.isDueMatch('2026-08-06', 'overdue', '2026-08-07', '2026-08-13'), true);
  assert.equal(DateCore.isDueMatch('2026-08-07', 'overdue', '2026-08-07', '2026-08-13'), false);
  assert.equal(DateCore.isDueMatch('', 'overdue', '2026-08-07', '2026-08-13'), false);
});

test('isDueMatch today requires an exact match', () => {
  assert.equal(DateCore.isDueMatch('2026-08-07', 'today', '2026-08-07', '2026-08-13'), true);
  assert.equal(DateCore.isDueMatch('2026-08-06', 'today', '2026-08-07', '2026-08-13'), false);
  assert.equal(DateCore.isDueMatch('', 'today', '2026-08-07', '2026-08-13'), false);
});

test('isDueMatch week includes both boundaries', () => {
  assert.equal(DateCore.isDueMatch('2026-08-07', 'week', '2026-08-07', '2026-08-13'), true);
  assert.equal(DateCore.isDueMatch('2026-08-13', 'week', '2026-08-07', '2026-08-13'), true);
  assert.equal(DateCore.isDueMatch('2026-08-06', 'week', '2026-08-07', '2026-08-13'), false);
  assert.equal(DateCore.isDueMatch('2026-08-14', 'week', '2026-08-07', '2026-08-13'), false);
  assert.equal(DateCore.isDueMatch('', 'week', '2026-08-07', '2026-08-13'), false);
});

test('isDueMatch none matches only missing due dates', () => {
  assert.equal(DateCore.isDueMatch('', 'none', '2026-08-07', '2026-08-13'), true);
  assert.equal(DateCore.isDueMatch(null, 'none', '2026-08-07', '2026-08-13'), true);
  assert.equal(DateCore.isDueMatch('2026-08-07', 'none', '2026-08-07', '2026-08-13'), false);
});

test('isDueMatch with an empty filter matches everything', () => {
  assert.equal(DateCore.isDueMatch('', '', '2026-08-07', '2026-08-13'), true);
  assert.equal(DateCore.isDueMatch('2026-08-07', '', '2026-08-07', '2026-08-13'), true);
  assert.equal(DateCore.isDueMatch(undefined, undefined, '2026-08-07', '2026-08-13'), true);
});

test('ageInDays is zero for the same moment', () => {
  assert.equal(DateCore.ageInDays(1000, 1000), 0);
  assert.equal(DateCore.ageInDays(0, 86399999), 0);
});

test('ageInDays counts one full day', () => {
  assert.equal(DateCore.ageInDays(0, 86400000), 1);
});

test('ageInDays counts multiple days', () => {
  assert.equal(DateCore.ageInDays(0, 3 * 86400000), 3);
});

test('ageInDays floors partial days', () => {
  assert.equal(DateCore.ageInDays(0, 86400000 + 3600000), 1);
  assert.equal(DateCore.ageInDays(0, 2 * 86400000 - 1), 1);
});

test('ageInDays clamps future movedAt values to zero', () => {
  assert.equal(DateCore.ageInDays(Date.now() + 5 * 86400000, Date.now()), 0);
  assert.equal(DateCore.ageInDays(1000000, 1000), 0);
});
