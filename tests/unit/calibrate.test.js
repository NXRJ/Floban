const { test } = require('node:test');
const assert = require('node:assert/strict');
const Calibrate = require('../../js/core/calibrate.js');

// Fixed injected clock: Wednesday 2026-08-12 10:00 local.
const NOW = new Date(2026, 7, 12, 10, 0).getTime();
const DAY = 86400000;

function card(overrides) {
  return Object.assign({
    size: 'M',
    startedAt: NOW - 10 * DAY,
    completedAt: NOW - 10 * DAY + 2.3 * DAY
  }, overrides || {});
}

// ---- collectSamples --------------------------------------------------------

test('collectSamples keeps only completed, started, sized cards', () => {
  const cards = [
    card({ size: 'M' }),                                    // valid M
    card({ size: 'S', completedAt: null }),                 // incomplete -> excluded
    card({ size: 'L', startedAt: null }),                   // never started -> excluded
    card({ size: 'none' }),                                 // unsized -> excluded
    card({ size: 'XL', archived: true })                    // archived still counts
  ];
  const samples = Calibrate.collectSamples(cards);
  assert.equal(samples.bySize.M.length, 1);
  assert.equal(samples.bySize.S.length, 0);
  assert.equal(samples.bySize.L.length, 0);
  assert.equal(samples.bySize.none, undefined);
  assert.equal(samples.nTotal, 2);
});

test('collectSamples excludes negative or NaN durations', () => {
  const samples = Calibrate.collectSamples([
    card({ size: 'M', startedAt: NOW, completedAt: NOW - 5 * DAY }), // negative
    card({ size: 'M', startedAt: NaN })                               // NaN
  ]);
  assert.equal(samples.nTotal, 0);
});

// ---- calibrate -------------------------------------------------------------

test('calibrate computes per-size medians and p85', () => {
  const cards = [
    card({ size: 'M', startedAt: NOW - 10 * DAY, completedAt: NOW - 10 * DAY + 2.3 * DAY }),
    card({ size: 'M', startedAt: NOW - 8 * DAY, completedAt: NOW - 8 * DAY + 1.9 * DAY }),
    card({ size: 'L', startedAt: NOW - 12 * DAY, completedAt: NOW - 12 * DAY + 4.5 * DAY }),
    card({ size: 'S', startedAt: NOW - 6 * DAY, completedAt: NOW - 6 * DAY + 0.8 * DAY }),
    card({ size: 'XL', startedAt: NOW - 3 * DAY, completedAt: NOW - 3 * DAY + 1.2 * DAY })
  ];
  const cal = Calibrate.calibrate(cards, NOW);
  assert.ok(Math.abs(cal.bySize.M.medianDays - 2.1) < 1e-9);
  assert.ok(Math.abs(cal.bySize.L.medianDays - 4.5) < 1e-9);
  assert.ok(Math.abs(cal.bySize.S.medianDays - 0.8) < 1e-9);
  assert.equal(cal.global.n, 5);
  assert.equal(cal.ready, true);
  assert.equal(cal.asOfISO, '2026-08-12');
  assert.equal(cal.bySize.XS.n, 0);
  assert.equal(cal.bySize.XS.medianDays, null);
});

test('calibrate is deterministic and ready flips at MIN_SAMPLES', () => {
  const few = [card({ size: 'M' }), card({ size: 'M', startedAt: NOW - 9 * DAY, completedAt: NOW - 9 * DAY + 1 * DAY })];
  assert.equal(Calibrate.calibrate(few, NOW).ready, false);
  const a = Calibrate.calibrate([card({ size: 'M' }), card({ size: 'M', startedAt: NOW - 9 * DAY, completedAt: NOW - 9 * DAY + 1 * DAY })], NOW);
  const b = Calibrate.calibrate([card({ size: 'M' }), card({ size: 'M', startedAt: NOW - 9 * DAY, completedAt: NOW - 9 * DAY + 1 * DAY })], NOW);
  assert.deepEqual(a, b);
});

test('even sample count takes the mean of the middle two', () => {
  const cal = Calibrate.calibrate([
    card({ size: 'M', completedAt: NOW - 10 * DAY + 1 * DAY }),
    card({ size: 'M', completedAt: NOW - 10 * DAY + 3 * DAY })
  ], NOW);
  assert.ok(Math.abs(cal.bySize.M.medianDays - 2) < 1e-9);
});

// ---- estimateDays / estimateLabel ------------------------------------------

test('estimateDays uses the per-size median when samples exist', () => {
  const cal = Calibrate.calibrate([card({ size: 'M', completedAt: NOW - 10 * DAY + 2.3 * DAY })], NOW);
  assert.ok(Math.abs(Calibrate.estimateDays('M', cal) - 2.3) < 1e-9);
});

test('estimateDays falls back to documented anchors with zero samples', () => {
  const cal = Calibrate.calibrate([card({ size: 'M' })], NOW);
  assert.equal(Calibrate.estimateDays('XS', cal), 0.25);
  assert.equal(Calibrate.estimateDays('S', cal), 0.5);
  assert.equal(Calibrate.estimateDays('L', cal), 2);
  assert.equal(Calibrate.estimateDays('XL', cal), 3);
  assert.equal(Calibrate.estimateDays('none', cal), null);
});

test('estimateLabel formats calibrated vs fallback', () => {
  const cal = Calibrate.calibrate([card({ size: 'M', completedAt: NOW - 10 * DAY + 2.34 * DAY })], NOW);
  assert.equal(Calibrate.estimateLabel('M', cal), 'M≈2.3d (n=1)');
  assert.equal(Calibrate.estimateLabel('XS', cal), 'XS≈0.3d'); // fallback, no n
});

// ---- dayLoad / dailyCapacityDays / planCheck -------------------------------

test('dayLoad sums estimate days per picked card', () => {
  const cal = Calibrate.calibrate([card({ size: 'M', completedAt: NOW - 10 * DAY + 2.3 * DAY })], NOW);
  const byId = {
    a: card({ size: 'M' }),
    b: card({ size: 'M' }),
    c: card({ size: 'S' }),
    d: { size: 'none' }
  };
  const load = Calibrate.dayLoad(['a', 'b', 'c', 'd'], byId, cal);
  assert.ok(Math.abs(load.estimateDays - (2.3 + 2.3 + 0.5 + 0)) < 1e-9);
  assert.equal(load.details.length, 4);
  assert.ok(Math.abs(load.details[0].days - 2.3) < 1e-9);
});

test('dailyCapacityDays medians per-day completed sums over 14 days', () => {
  const cards = [
    // Day A (Aug 8): 1.5d + 0.5d = 2.0d; Day B (Aug 10): 1.0d; Day C (Aug 6): 1.2d.
    card({ size: 'M', startedAt: NOW - 5 * DAY, completedAt: NOW - 5 * DAY + 1.5 * DAY }), // Aug 8 22:00
    card({ size: 'S', startedAt: NOW - 4 * DAY, completedAt: NOW - 4 * DAY + 0.5 * DAY }), // Aug 8 22:00
    card({ size: 'M', startedAt: NOW - 3 * DAY, completedAt: NOW - 3 * DAY + 1.0 * DAY }),  // Aug 10
    card({ size: 'M', startedAt: NOW - 6 * DAY, completedAt: NOW - 6 * DAY + 1.2 * DAY })   // Aug 6
  ];
  // Sorted sums [1.0, 1.2, 2.0] -> median 1.2.
  assert.ok(Math.abs(Calibrate.dailyCapacityDays(cards, NOW) - 1.2) < 1e-9);
});

test('dailyCapacityDays falls back to 1.0 with fewer than 3 sample days', () => {
  const cards = [card({ size: 'M', completedAt: NOW - 5 * DAY + 2 * DAY })];
  assert.equal(Calibrate.dailyCapacityDays(cards, NOW), 1.0);
  assert.equal(Calibrate.dailyCapacityDays([], NOW), 1.0);
});

test('planCheck warns when the load exceeds capacity with headroom', () => {
  const cal = Calibrate.calibrate([
    card({ size: 'M', completedAt: NOW - 10 * DAY + 2.3 * DAY }),
    card({ size: 'M', completedAt: NOW - 8 * DAY + 1.9 * DAY }),
    card({ size: 'S', completedAt: NOW - 6 * DAY + 0.8 * DAY }),
    card({ size: 'L', completedAt: NOW - 12 * DAY + 4.5 * DAY }),
    card({ size: 'XL', completedAt: NOW - 3 * DAY + 1.2 * DAY })
  ], NOW);
  const byId = { a: card({ size: 'M' }), b: card({ size: 'M' }), c: card({ size: 'M' }) };
  const check = Calibrate.planCheck('2026-08-13', ['a', 'b', 'c'], byId, cal, [card({ size: 'S', completedAt: NOW - 1 * DAY + 0.8 * DAY })], NOW);
  // M ≈ 2.1d × 3 = 6.3d vs capacity 0.8d -> warn
  assert.equal(check.warn, true);
  assert.ok(check.estimateDays > check.capacityDays);
});

test('planCheck stays quiet for an empty or light day', () => {
  const cal = Calibrate.calibrate([card({ size: 'M', completedAt: NOW - 10 * DAY + 2.3 * DAY })], NOW);
  const check = Calibrate.planCheck('2026-08-13', [], {}, cal, [], NOW);
  assert.equal(check.estimateDays, 0);
  assert.equal(check.warn, false);
});
