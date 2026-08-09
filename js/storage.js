(function (KB) {
  // Browser persistence adapter: IndexedDB is the primary store, a
  // synchronous localStorage mirror covers crash recovery (a tab can close
  // before an async IDB write lands) and the boot-time theme read, and the
  // legacy localStorage payload feeds the first-run migration.
  //
  // All mutation paths in the app call KB.State.save(), which funnels into
  // KB.Storage.save() — serialized writes, throttled auto-backups, and the
  // mirror are all handled here.

  var DB_NAME = 'kanban-store';
  var DB_VERSION = 1;
  var STORES = ['state', 'backups', 'meta'];
  var STORAGE_KEY = 'kanban.board.v1';
  var SAVED_AT_KEY = 'kanban.savedAt.v1';

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
          var request = fn(transaction.objectStore(store));
          request.onsuccess = function () { resolve(request.result); };
          request.onerror = function () { reject(request.error || new Error('IndexedDB transaction failed')); };
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
      var payload = localStorage.getItem(STORAGE_KEY);
      var savedAt = Number(localStorage.getItem(SAVED_AT_KEY)) || 0;
      return { payload: payload, savedAt: savedAt };
    } catch (err) {
      return { payload: null, savedAt: 0 };
    }
  }

  function mirror(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.setItem(SAVED_AT_KEY, String(Date.now()));
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
    if (result.source === 'mirror' || result.source === 'legacy' || result.source === 'backup') {
      // The mirror/legacy/backup payload wins this boot: repair the primary
      // store so IDB is authoritative again as soon as possible. Migrations
      // from legacy first snapshot the incoming payload into the rotating
      // backups so the original data is never overwritten irrecoverably.
      if (result.source === 'legacy' || result.source === 'mirror') {
        engine.backup(result.state, result.source === 'legacy' ? 'legacy-migrated' : 'mirror-recovered')
          .catch(function () { /* backup is best-effort; boot continues */ });
      }
      save(result.state, 'repair');
    }
    return result;
  }

  function load(opts) {
    var mirrorData = readMirror();
    return engine.load({
      legacy: opts.legacy !== undefined ? opts.legacy : readLegacy(),
      validate: opts.validate,
      defaults: opts.defaults,
      mirror: {
        payload: mirrorData.payload,
        savedAt: mirrorData.savedAt
      }
    }).catch(function (err) {
      // IndexedDB is unavailable (private mode, blocked, or storage
      // disabled). Degrade to a localStorage-only session.
      idbOk = false;
      console.warn('IndexedDB unavailable, using localStorage fallback', err);
      var payload = opts.legacy !== undefined ? opts.legacy : readLegacy();
      if (payload !== null && typeof payload === 'string') {
        try {
          var parsed = JSON.parse(payload);
          var result = opts.validate(parsed);
          if (result && result.ok) {
            return afterLoad({ state: result.state, source: 'legacy', degraded: true });
          }
        } catch (parseErr) {}
      }
      return afterLoad({ state: opts.defaults(), source: 'defaults', degraded: true });
    }).then(afterLoad);
  }

  function save(state, source) {
    mirror(state);
    if (!idbOk) return Promise.resolve(null);
    var write = engine.save(state, { reason: source || 'change', backup: 'auto' });
    // Every app save is fire-and-forget; surface IDB write failures by
    // degrading to the localStorage-only session instead of leaving an
    // unhandled rejection on every mutation. The mirror above already holds
    // this exact state, so the degrade is safe.
    write.catch(function (err) {
      if (idbOk) {
        idbOk = false;
        console.warn('IndexedDB write failed — continuing with the localStorage mirror', err);
      }
    });
    return write;
  }

  function backup(state, reason) {
    mirror(state);
    if (!idbOk) return Promise.resolve(null);
    return engine.backup(state, reason || 'manual');
  }

  function listBackups() {
    if (!idbOk) return Promise.resolve([]);
    return engine.listBackups();
  }

  function restore(backupId) {
    if (!idbOk) return Promise.resolve(null);
    return engine.restore(backupId);
  }

  function clearAll() {
    loadResult = null;
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
      lastSavedAt: Number(localStorage.getItem(SAVED_AT_KEY)) || null
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
