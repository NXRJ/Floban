const { test } = require('node:test');
const assert = require('node:assert/strict');
const Store = require('../../js/core/store.js');

// Deterministic in-memory backend implementing the core/store.js interface.
function memoryBackend() {
  const stores = { state: new Map(), backups: new Map(), meta: new Map() };
  return {
    stores,
    open: () => Promise.resolve(),
    get: (store, key) => Promise.resolve(stores[store].get(key)),
    put: (store, key, value) => { stores[store].set(key, value); return Promise.resolve(); },
    delete: (store, key) => { stores[store].delete(key); return Promise.resolve(); },
    getAll: (store) => Promise.resolve(Array.from(stores[store].values())),
    clear: (store) => { stores[store].clear(); return Promise.resolve(); },
    close: () => Promise.resolve()
  };
}

// A clock the tests control so "now" and backup throttling are deterministic.
function clock() {
  let t = 0;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

function makeEngine(backend, opts) {
  const c = clock();
  const engine = Store.createEngine(Object.assign({ backend, now: c.now, maxBackups: 10, backupIntervalMs: 1000 }, opts));
  engine._clock = c;
  return engine;
}

const validateOk = (parsed) => (parsed && parsed.ok ? { ok: true, state: parsed } : { ok: false });
const state = (n) => ({ ok: true, n, label: 'state-' + n });

test('save then load returns the saved state as primary', async () => {
  const engine = makeEngine(memoryBackend());
  await engine.save(state(1), {});
  const result = await engine.load({ validate: validateOk });
  assert.equal(result.source, 'primary');
  assert.equal(result.state.n, 1);
  assert.equal(result.needsRepair, null);
});

test('load on an empty store returns defaults', async () => {
  const engine = makeEngine(memoryBackend());
  const result = await engine.load({ validate: validateOk, defaults: () => state(99) });
  assert.equal(result.source, 'defaults');
  assert.equal(result.state.n, 99);
});

test('load falls back to legacy payload when nothing else exists', async () => {
  const engine = makeEngine(memoryBackend());
  const result = await engine.load({
    validate: validateOk,
    legacy: JSON.stringify(state(7))
  });
  assert.equal(result.source, 'legacy');
  assert.equal(result.state.n, 7);
  assert.equal(result.needsRepair, 'legacy');
});

test('a corrupt primary falls back to the newest valid backup', async () => {
  const backend = memoryBackend();
  const engine = makeEngine(backend);
  await engine.backup(state(1), 'one');
  engine._clock.advance(10);
  await engine.backup(state(2), 'two');
  // Corrupt the primary record.
  backend.stores.state.set(Store.PRIMARY_KEY, '{not json');
  const result = await engine.load({ validate: validateOk });
  assert.equal(result.source, 'backup');
  assert.equal(result.state.n, 2, 'newest backup wins');
  assert.ok(result.backupId);
});

test('corrupt primary and corrupt backups fall back to legacy then defaults', async () => {
  const backend = memoryBackend();
  const engine = makeEngine(backend);
  await engine.backup(state(1), 'one');
  backend.stores.state.set(Store.PRIMARY_KEY, 'garbage');
  // Corrupt the only backup.
  const backup = Array.from(backend.stores.backups.values())[0];
  backup.payload = '{broken';
  const legacyResult = await engine.load({ validate: validateOk, legacy: JSON.stringify(state(5)) });
  assert.equal(legacyResult.source, 'legacy');
  assert.equal(legacyResult.state.n, 5);
  const defaultsResult = await engine.load({ validate: validateOk, defaults: () => state(8) });
  assert.equal(defaultsResult.source, 'defaults');
  assert.equal(defaultsResult.state.n, 8);
});

test('a payload that fails validation is skipped, not fatal', async () => {
  const engine = makeEngine(memoryBackend());
  await engine.save({ ok: false }, {}); // primary is invalid
  const result = await engine.load({ validate: validateOk, defaults: () => state(3) });
  assert.equal(result.source, 'defaults');
});

test('writes are serialized: fire-and-forget saves land in order', async () => {
  const backend = memoryBackend();
  const engine = makeEngine(backend);
  const order = [];
  const realPut = backend.put;
  backend.put = (store, key, value) => {
    if (store === 'state') order.push(JSON.parse(value).n);
    return realPut(store, key, value);
  };
  // No awaits between saves — the queue must still serialize them.
  engine.save(state(1), {});
  engine.save(state(2), {});
  engine.save(state(3), {});
  await engine.flush();
  assert.deepEqual(order, [1, 2, 3]);
  const result = await engine.load({ validate: validateOk });
  assert.equal(result.state.n, 3);
});

test('a failed write does not poison the queue', async () => {
  const backend = memoryBackend();
  const engine = makeEngine(backend);
  let failNext = true;
  const realPut = backend.put;
  backend.put = (store, key, value) => {
    if (store === 'state' && failNext) {
      failNext = false;
      return Promise.reject(new Error('quota'));
    }
    return realPut(store, key, value);
  };
  await engine.save(state(1), {}).catch(() => {});
  await engine.save(state(2), {});
  const result = await engine.load({ validate: validateOk });
  assert.equal(result.state.n, 2);
});

test('explicit backups rotate and prune to maxBackups', async () => {
  const engine = makeEngine(memoryBackend(), { maxBackups: 3 });
  for (let i = 1; i <= 6; i++) {
    engine._clock.advance(10);
    await engine.backup(state(i), 'manual');
  }
  const list = await engine.listBackups();
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((b) => b.reason), ['manual', 'manual', 'manual']);
  // Newest backup is #6.
  const newest = await engine.restore(list[0].id);
  assert.equal(newest.n, 6);
});

test('restore returns null for a missing backup', async () => {
  const engine = makeEngine(memoryBackend());
  assert.equal(await engine.restore('nope'), null);
});

test('auto backups are throttled by the interval', async () => {
  const engine = makeEngine(memoryBackend(), { backupIntervalMs: 1000 });
  await engine.save(state(1), { backup: 'auto', reason: 'change' });
  assert.equal((await engine.listBackups()).length, 1, 'first save backs up');
  engine._clock.advance(500);
  await engine.save(state(2), { backup: 'auto', reason: 'change' });
  assert.equal((await engine.listBackups()).length, 1, 'within interval: no new backup');
  engine._clock.advance(600);
  await engine.save(state(3), { backup: 'auto', reason: 'change' });
  assert.equal((await engine.listBackups()).length, 2, 'past interval: new backup');
});

test('a newer mirror wins over the IDB primary and requests repair', async () => {
  const backend = memoryBackend();
  const engine = makeEngine(backend);
  await engine.save(state(1), {}); // IDB primary at t=0
  engine._clock.advance(100);
  const mirror = { payload: JSON.stringify(state(2)), savedAt: engine.now() };
  const result = await engine.load({ validate: validateOk, mirror });
  assert.equal(result.source, 'mirror');
  assert.equal(result.state.n, 2);
  assert.equal(result.needsRepair, 'mirror');
});

test('an older or absent mirror does not override the IDB primary', async () => {
  const backend = memoryBackend();
  const engine = makeEngine(backend);
  await engine.save(state(1), {});
  const result = await engine.load({
    validate: validateOk,
    mirror: { payload: JSON.stringify(state(2)), savedAt: engine.now() - 50 }
  });
  assert.equal(result.source, 'primary');
  assert.equal(result.state.n, 1);
});

test('an invalid mirror is ignored in favor of the primary', async () => {
  const backend = memoryBackend();
  const engine = makeEngine(backend);
  await engine.save(state(1), {});
  const result = await engine.load({
    validate: validateOk,
    mirror: { payload: 'garbage', savedAt: engine.now() + 1000 }
  });
  assert.equal(result.source, 'primary');
});

test('clearAll empties every store', async () => {
  const backend = memoryBackend();
  const engine = makeEngine(backend);
  await engine.save(state(1), { backup: true });
  await engine.clearAll();
  const result = await engine.load({ validate: validateOk, defaults: () => state(0) });
  assert.equal(result.source, 'defaults');
  assert.equal((await engine.listBackups()).length, 0);
});

test('lastSavedAt tracks the last write', async () => {
  const engine = makeEngine(memoryBackend());
  assert.equal(await engine.lastSavedAt(), null);
  await engine.save(state(1), {});
  engine._clock.advance(42);
  await engine.save(state(2), {});
  assert.equal(await engine.lastSavedAt(), 42);
});

test('engine requires a backend', () => {
  assert.throws(() => Store.createEngine({}), /backend/);
});

test('meta.at is stamped at call time so a lagging write cannot mask a newer mirror', async () => {
  // The crash-recovery guarantee: if the newest mutation's IDB write never
  // lands (tab closed mid-write), the mirror must still win at boot. The
  // comparison is only sound when meta.at measures the save CALL, not when
  // the queued write happens to land.
  const backend = memoryBackend();
  const engine = makeEngine(backend);
  let releaseFirst = null;
  let calls = 0;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const realPut = backend.put;
  backend.put = (store, key, value) => {
    if (store === 'state') {
      if (calls++ === 0) return firstGate; // A's write is slow…
      return new Promise(() => {});        // …B's write never lands (crash)
    }
    return realPut(store, key, value);
  };
  const p1 = engine.save(state(1), {}); // called at t=0
  engine._clock.advance(2);             // t=2
  const p2 = engine.save(state(2), {}); // called at t=2 — mirror savedAt=2
  engine._clock.advance(100);           // t=102 — A's write finally lands
  releaseFirst();
  await p1;
  // B's write is still pending; A's meta was stamped with A's CALL time.
  const result = await engine.load({
    validate: validateOk,
    mirror: { payload: JSON.stringify(state(2)), savedAt: 2 }
  });
  assert.equal(result.source, 'mirror', 'newer mirror wins over a lagging primary');
  assert.equal(result.state.n, 2);
  p2.catch(() => {}); // B's write is abandoned by the test; swallow its rejection
});

test('a failing backup write does not fail the primary save', async () => {
  const backend = memoryBackend();
  const engine = makeEngine(backend);
  const realPut = backend.put;
  backend.put = (store, key, value) => {
    if (store === 'backups') return Promise.reject(new Error('quota'));
    return realPut(store, key, value);
  };
  await engine.save(state(7), { backup: true }); // must resolve, not reject
  const result = await engine.load({ validate: validateOk });
  assert.equal(result.source, 'primary');
  assert.equal(result.state.n, 7);
});

test('backup ids come from the injected uid factory', async () => {
  const engine = makeEngine(memoryBackend(), { uid: () => 'fixed-id' });
  await engine.save(state(1), { backup: true });
  const list = await engine.listBackups();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'fixed-id');
});
