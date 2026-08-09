(function (KB) {
  // Browser persistence adapter: IndexedDB is the primary store, an atomic
  // localStorage envelope (kanban.mirror.v1 = { savedAt, payload }, one
  // setItem) covers crash recovery — a tab can close before an async IDB
  // write lands, and the single-key envelope keeps state and timestamp from
  // ever diverging. kanban.board.v1 remains as the pre-upgrade legacy
  // payload for first-run migration and the synchronous boot-theme read.
  //
  // All mutation paths in the app call KB.State.save(), which funnels into
  // KB.Storage.save() — serialized writes, throttled auto-backups, and the
  // mirror are all handled here.

  var DB_NAME = 'kanban-store';
  var DB_VERSION = 1;
  var STORES = ['state', 'backups', 'meta'];
  // Pre-upgrade legacy payload (v1/v2 localStorage). Read-only once the
  // current version has written an envelope — kept for first-run migration
  // and the synchronous boot-theme read.
  var STORAGE_KEY = 'kanban.board.v1';
  // Atomic crash mirror: { savedAt, payload } written in a single setItem so
  // state and timestamp can never diverge (a crash between two keys could
  // pair a new state with an old stamp and mislead recovery).
  var MIRROR_KEY = 'kanban.mirror.v1';

  var loadResult = null;
  var idbOk = true;

  // ---- IndexedDB backend (implements the core/store.js backend interface) ----

  function idbBackend() {
    var db = null;
    var opening = null;

    function open() {
      if (db) return Promise.resolve(db);
      if (opening) return opening;
      opening = new Promise(function (resolve, reject) {
        var req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = function () {
          var database = req.result;
          STORES.forEach(function (name) {
            if (!database.objectStoreNames.contains(name)) database.createObjectStore(name);
          });
        };
        req.onsuccess = function () {
          db = req.result;
          db.onclose = function () { db = null; opening = null; };
          resolve(db);
        };
        req.onerror = function () {
          opening = null;
          reject(req.error || new Error('IndexedDB open failed'));
        };
        req.onblocked = function () {
          opening = null;
          reject(new Error('IndexedDB open blocked'));
        };
      });
      return opening;
    }

    function tx(store, mode, fn) {
      return open().then(function (database) {
        return new Promise(function (resolve, reject) {
          var transaction = database.transaction(store, mode);
          var result;
          var request = fn(transaction.objectStore(store));
          // A request can succeed and its transaction still abort afterwards
          // (e.g. quota), so persistence is only guaranteed when the whole
          // transaction commits. Resolve from oncomplete, reject on
          // request/transaction error or abort.
          request.onsuccess = function () { result = request.result; };
          request.onerror = function () {
            reject(request.error || new Error('IndexedDB request failed'));
          };
          transaction.oncomplete = function () { resolve(result); };
          transaction.onerror = function () {
            reject(transaction.error || new Error('IndexedDB transaction failed'));
          };
          transaction.onabort = function () {
            reject(transaction.error || new Error('IndexedDB transaction aborted'));
          };
        });
      });
    }

    return {
      open: open,
      get: function (store, key) { return tx(store, 'readonly', function (s) { return s.get(key); }); },
      put: function (store, key, value) { return tx(store, 'readwrite', function (s) { return s.put(value, key); }); },
      delete: function (store, key) { return tx(store, 'readwrite', function (s) { return s.delete(key); }); },
      getAll: function (store) { return tx(store, 'readonly', function (s) { return s.getAll(); }); },
      clear: function (store) { return tx(store, 'readwrite', function (s) { return s.clear(); }); },
      close: function () {
        if (db) {
          // close() may throw if the connection is already closing — teardown
          // is best-effort either way.
          try { db.close(); } catch (err) {}
          db = null;
          opening = null;
        }
        return Promise.resolve();
      }
    };
  }

  var engine = KB.Core.Store.createEngine({
    backend: idbBackend(),
    now: function () { return Date.now(); },
    maxBackups: 10,
    backupIntervalMs: 60000
  });

  // ---- localStorage mirror ----

  function readMirror() {
    try {
      var raw = localStorage.getItem(MIRROR_KEY);
      if (!raw) return { payload: null, savedAt: 0 };
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.savedAt !== 'number' || parsed.payload === undefined) {
        return { payload: null, savedAt: 0 };
      }
      return { payload: parsed.payload, savedAt: parsed.savedAt };
    } catch (err) {
      return { payload: null, savedAt: 0 };
    }
  }

  function mirror(state, savedAt) {
    // A read-only tab's in-memory state is stale by design; its mirror write
    // would pair a stale payload with a fresh savedAt and could win boot
    // recovery over the owner's real data.
    if (KB.MultiTab && KB.MultiTab.readOnly()) return;
    try {
      localStorage.setItem(MIRROR_KEY, JSON.stringify({
        savedAt: savedAt === undefined ? Date.now() : savedAt,
        payload: state
      }));
    } catch (err) {
      // Quota exceeded or storage disabled — the mirror is best-effort.
    }
  }

  function readLegacy() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      return null;
    }
  }

  function afterLoad(result) {
    loadResult = result;
    if (result.degraded) idbOk = false;
    // Repair the primary store so IDB is authoritative again as soon as
    // possible — but never during a degraded boot (IndexedDB just failed,
    // so the repair would be one wasted retry), and never from a read-only
    // tab (its recovered state must not race the owner's writes).
    if (!result.degraded && !(KB.MultiTab && KB.MultiTab.readOnly()) && (result.source === 'mirror' || result.source === 'legacy' || result.source === 'backup')) {
      // Migrations from legacy first snapshot the incoming payload into the
      // rotating backups so the original data is never overwritten
      // irrecoverably.
      if (result.source === 'legacy' || result.source === 'mirror') {
        engine.backup(result.state, result.source === 'legacy' ? 'legacy-migrated' : 'mirror-recovered')
          .catch(function () { /* backup is best-effort; boot continues */ });
      }
      save(result.state, 'repair');
    }
    return result;
  }

  // A backend that is always empty: the degraded boot reuses the engine's
  // recovery cascade (valid mirror -> valid legacy -> defaults) without
  // IndexedDB, so the two recovery chains can never drift apart.
  function emptyBackend() {
    return {
      open: function () { return Promise.resolve(); },
      get: function () { return Promise.resolve(undefined); },
      put: function () { return Promise.resolve(); },
      delete: function () { return Promise.resolve(); },
      getAll: function () { return Promise.resolve([]); },
      clear: function () { return Promise.resolve(); },
      close: function () { return Promise.resolve(); }
    };
  }

  function load(opts) {
    var mirrorData = readMirror();
    var legacy = opts.legacy !== undefined ? opts.legacy : readLegacy();
    // One cascade invocation for both backends so the normal and degraded
    // recovery chains can never drift apart.
    function loadWith(engineInstance) {
      return engineInstance.load({
        legacy: legacy,
        validate: opts.validate,
        defaults: opts.defaults,
        mirror: {
          payload: mirrorData.payload,
          savedAt: mirrorData.savedAt
        }
      });
    }
    return loadWith(engine).catch(function (err) {
      // IndexedDB is unavailable (private mode, blocked, or storage
      // disabled). Degrade to a localStorage-only session. The recovery
      // result is returned here and handled by the single .then(afterLoad)
      // below — afterLoad must not run twice.
      idbOk = false;
      console.warn('IndexedDB unavailable, using localStorage fallback', err);
      return loadWith(KB.Core.Store.createEngine({ backend: emptyBackend() })).then(function (result) {
        return { state: result.state, source: result.source, degraded: true };
      });
    }).then(afterLoad);
  }

  // Mid-session IndexedDB failure: flip the flag once, warn, and let the
  // caller fall back to its localStorage/memory path.
  function degrade(action, err) {
    if (idbOk) {
      idbOk = false;
      console.warn('IndexedDB ' + action + ' failed — continuing with the localStorage mirror', err);
    }
  }

  function save(state, source) {
    // One timestamp per save, shared by the crash-mirror envelope and the
    // engine's meta stamp: two separate Date.now() calls can land in
    // different milliseconds, and an equal-stamp comparison at boot could
    // then prefer a stale primary over a mirror holding the newer state.
    // The mirror is written BEFORE the degraded-session early return: a
    // localStorage-only session (idbOk false) must still keep the envelope
    // current, or every in-session edit would be lost on reload. mirror()
    // is a no-op in read-only tabs, so this does not weaken the lock gate.
    var stamp = Date.now();
    mirror(state, stamp);
    if (!idbOk) return Promise.resolve(null);
    var write = engine.save(state, { reason: source || 'change', backup: 'auto', savedAt: stamp });
    // Every app save is fire-and-forget; surface IDB write failures by
    // degrading to the localStorage-only session instead of leaving an
    // unhandled rejection on every mutation. The mirror above already holds
    // this exact state, so the degrade is safe.
    write.catch(function (err) {
      degrade('write', err);
    });
    return write;
  }

  function backup(state, reason) {
    mirror(state); // no-op when read-only
    if (KB.MultiTab && KB.MultiTab.readOnly()) return Promise.resolve(null);
    if (!idbOk) return Promise.resolve(null);
    return engine.backup(state, reason || 'manual').catch(function (err) {
      // A mid-session IndexedDB failure must not surface as an unhandled
      // rejection from a fire-and-forget snapshot call — degrade like save()
      // does; the mirror above already holds the state.
      degrade('backup', err);
      return null;
    });
  }

  function listBackups() {
    if (!idbOk) return Promise.resolve([]);
    return engine.listBackups().catch(function (err) {
      degrade('read', err);
      return [];
    });
  }

  function restore(backupId) {
    if (!idbOk) return Promise.resolve(null);
    return engine.restore(backupId).catch(function (err) {
      degrade('read', err);
      return null;
    });
  }

  function clearAll() {
    // A read-only tab must not be able to wipe shared storage.
    if (KB.MultiTab && KB.MultiTab.readOnly()) return Promise.resolve();
    loadResult = null;
    // A factory reset must not resurrect the previous session's crash mirror
    // (or its pre-upgrade legacy payload) on the next boot.
    try {
      localStorage.removeItem(MIRROR_KEY);
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      // Storage disabled/private mode — the keys simply were not removable.
    }
    if (!idbOk) return Promise.resolve();
    return engine.clearAll();
  }

  function lastSavedAt() {
    if (!idbOk) return Promise.resolve(null);
    return engine.lastSavedAt();
  }

  function flush() {
    if (!idbOk) return Promise.resolve();
    return engine.flush();
  }

  function status() {
    return {
      idbAvailable: idbOk,
      source: loadResult ? loadResult.source : null,
      degraded: loadResult ? Boolean(loadResult.degraded) : false,
      lastSavedAt: readMirror().savedAt || null
    };
  }

  KB.Storage = {
    load: load,
    save: save,
    backup: backup,
    listBackups: listBackups,
    restore: restore,
    clearAll: clearAll,
    lastSavedAt: lastSavedAt,
    flush: flush,
    status: status,
    STORAGE_KEY: STORAGE_KEY
  };
})(window.KB = window.KB || {});
