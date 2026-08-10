const { test } = require('node:test');
const assert = require('node:assert/strict');
const Power = require('../../js/core/power.js');

const NOW = new Date(2026, 7, 12, 10, 0).getTime();

function card(overrides) {
  return Object.assign({
    id: 'c1', title: 'Task', size: 'm', priority: 'none', due: '',
    completedAt: null, archivedAt: null,
    flow: { state: 'normal', reason: '', since: null, periods: [] },
    dependencies: { blockers: [], related: [] }
  }, overrides || {});
}

// ---- energyFor -------------------------------------------------------------

test('energyFor maps sizes to demand weights', () => {
  assert.equal(Power.energyFor(card({ size: 'xs' })), 0.2);
  assert.equal(Power.energyFor(card({ size: 's' })), 0.35);
  assert.equal(Power.energyFor(card({ size: 'm' })), 0.55);
  assert.equal(Power.energyFor(card({ size: 'l' })), 0.75);
  assert.equal(Power.energyFor(card({ size: 'xl' })), 1.0);
});

test('energyFor falls back to estimate days then default', () => {
  assert.equal(Power.energyFor(card({ size: 'none' })), 0.5);
  const cal = { estimateDays: function () { return 2.3; }, calibration: {} };
  assert.ok(Math.abs(Power.energyFor(card({ size: 'none' }), cal) - Math.min(1, 2.3 / 3)) < 1e-9);
});

// ---- classify --------------------------------------------------------------

test('classify: blocked/waiting/paused/done/archived are never picked', () => {
  assert.equal(Power.classify(card({ flow: { state: 'blocked' } }), {}), 'wait');
  assert.equal(Power.classify(card({ flow: { state: 'waiting' } }), {}), 'wait');
  assert.equal(Power.classify(card({ flow: { state: 'paused' } }), {}), 'wait');
  assert.equal(Power.classify(card({ completedAt: 1 }), {}), 'wait');
  assert.equal(Power.classify(card({ archivedAt: 1 }), {}), 'wait');
  assert.equal(Power.classify(card({ dependencies: { blockers: [{ cardId: 'x' }] } }), {}), 'wait');
});

test('classify: demand vs tolerance decides good-now vs too-heavy', () => {
  assert.equal(Power.classify(card({ size: 'xs' }), { tolerance: 0.4 }), 'good-now');
  assert.equal(Power.classify(card({ size: 'xl' }), { tolerance: 0.4 }), 'too-heavy');
  assert.equal(Power.classify(card({ size: 'xl' }), { tolerance: 1.0 }), 'good-now');
});

// ---- pickBest --------------------------------------------------------------

function pickCtx(overrides) {
  return Object.assign({
    now: NOW,
    tolerance: 0.75,
    levelAtHour: function () { return 0.6; },
    demandFor: function (c) { return Power.SIZE_DEMAND[String(c.size).toLowerCase()] || 0.5; },
    timeBudgetMin: null
  }, overrides || {});
}

test('pickBest never returns waiting cards and ranks by state-fit', () => {
  const cards = [
    card({ id: 'a', title: 'Quick win', size: 'xs' }),
    card({ id: 'b', title: 'Heavy lift', size: 'xl' }),
    card({ id: 'c', title: 'Blocked', size: 'xs', flow: { state: 'blocked' } })
  ];
  const result = Power.pickBest(cards, pickCtx({ tolerance: 0.4 }));
  assert.equal(result.top.id, 'a');
  assert.ok(!result.scored.some(s => s.card.id === 'c'));
});

test('pickBest: low power excludes heavy cards entirely', () => {
  const cards = [card({ id: 'a', title: 'XS', size: 'xs' }), card({ id: 'b', title: 'XL', size: 'xl' })];
  const result = Power.pickBest(cards, pickCtx({ tolerance: 0.4 }));
  assert.equal(result.top.id, 'a');
  assert.equal(result.alternates.length, 0);
});

test('pickBest: time budget caps by demand-scaled minutes', () => {
  const cards = [card({ id: 'a', title: 'XS', size: 'xs' }), card({ id: 'b', title: 'XL', size: 'xl' })];
  const result = Power.pickBest(cards, pickCtx({ tolerance: 1.0, timeBudgetMin: 30 }));
  assert.equal(result.top.id, 'a'); // XS ≈ 18 min fits 30; XL ≈ 90 min does not
  const wide = Power.pickBest(cards, pickCtx({ tolerance: 1.0, timeBudgetMin: 120 }));
  assert.equal(wide.scored.length, 2);
});

test('pickBest: due-today outranks equal-demand cards', () => {
  const today = '2026-08-12';
  const cards = [
    card({ id: 'a', title: 'Due today', size: 'xs', due: today }),
    card({ id: 'b', title: 'No due', size: 'xs' })
  ];
  const result = Power.pickBest(cards, pickCtx({ tolerance: 0.4 }));
  assert.equal(result.top.id, 'a');
});

test('pickBest is deterministic and empty-safe', () => {
  const cards = [card({ id: 'a', title: 'A', size: 's' }), card({ id: 'b', title: 'B', size: 'l' })];
  const a = Power.pickBest(cards, pickCtx({}));
  const b = Power.pickBest(cards, pickCtx({}));
  assert.deepEqual(a, b);
  const empty = Power.pickBest([], pickCtx({}));
  assert.equal(empty.top, null);
});

// ---- powerCurve ------------------------------------------------------------

test('powerCurve learns from completed cards and focus days', () => {
  const cards = [];
  // 5 completions at 10:00 with escalating demand.
  for (let i = 0; i < 5; i++) {
    cards.push(card({ id: 'k' + i, size: 'm', completedAt: new Date(2026, 7, 10, 10, 0).getTime() }));
  }
  const curve = Power.powerCurve(cards, { '2026-08-10': { minutes: 60, pomodoros: 2 } }, NOW, {});
  assert.equal(curve.learned, true);
  // Peak sits in the 10:00-11:00 window (the 09:00 focus sample tugs the
  // smoothing slightly).
  assert.ok(curve.peakHour === 10 || curve.peakHour === 11);
  const level = curve.levelAtHour(10);
  assert.ok(level > 0.5);
});

test('powerCurve falls back to the default gentle curve before learning', () => {
  const curve = Power.powerCurve([], {}, NOW, {});
  assert.equal(curve.learned, false);
  assert.equal(curve.peakHour, -1);
  assert.ok(curve.levelAtHour(10) > curve.levelAtHour(23));
  assert.ok(Math.abs(curve.levelAtHour(15) - 0.8) < 1e-9);
});

test('powerCurve is deterministic', () => {
  const cards = [card({ id: 'a', size: 'm', completedAt: new Date(2026, 7, 10, 9, 0).getTime() })];
  const a = Power.powerCurve(cards, {}, NOW, {});
  const b = Power.powerCurve(cards, {}, NOW, {});
  // Compare the serializable state; levelAtHour closures are new functions.
  assert.deepEqual(
    { learned: a.learned, peakHour: a.peakHour, troughHour: a.troughHour, hours: a.hours },
    { learned: b.learned, peakHour: b.peakHour, troughHour: b.troughHour, hours: b.hours }
  );
  assert.deepEqual(a.hours, b.hours);
});

// ---- lowPowerActive --------------------------------------------------------

test('lowPowerActive is true only at low or drained', () => {
  assert.equal(Power.lowPowerActive({ power: { band: 'low' } }), true);
  assert.equal(Power.lowPowerActive({ power: { band: 'drained' } }), true);
  assert.equal(Power.lowPowerActive({ power: { band: 'full' } }), false);
  assert.equal(Power.lowPowerActive({ power: { band: 'mid' } }), false);
  assert.equal(Power.lowPowerActive({}), false);
});
