(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Store = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function () {
    // Persistent storage engine over an injectable, promise-based backend.
    //
    // The backend interface (implemented over IndexedDB in js/storage.js, and
    // over an in-memory map in the unit tests) is:
    //
    //   open()  -> Promise           make the database and stores ready
    //   get(store, key) -> Promise<value | undefined>
    //   put(store, key, value) -> Promise
    //   delete(store, key) -> Promise
    //   getAll(store) -> Promise<value[]>   (backups store records carry .id/.createdAt/.reason/.payload)
    //   clear(store) -> Promise
    //   close() -> Promise
    //
    // Stores used:
    //   'state'   — one record, key 'current', value is the serialized state payload.
    //   'backups' — rotating snapshots, keyed by backup id.
    //   'meta'    — key/value bookkeeping (lastSavedAt).
    //
    // All writes are funneled through a serialized promise queue: callers may
    // fire-and-forget saves from synchronous mutation code and the writes
    // still land in order, one at a time, without interleaving.
    //
    // Recovery order on load() — the newest *valid* copy wins:
    //   1. the IDB primary record, unless a synchronous localStorage mirror
    //      (see `mirror` below) is both newer than the last IDB save AND
    //      passes validation (crash recovery: the tab may have closed
    //      mid-write). Both stamps are measured at save-call time, so they
    //      are comparable. A newer mirror that fails validation falls
    //      through to the primary instead of shadowing it;
    //   2. rotating backups, newest first;
    //   3. the legacy localStorage payload (first-run migration — the mirror
    //      key doubles as the legacy key, so this step only applies when the
    //      savedAt marker is absent or the mirror failed validation);
    //   4. the caller-supplied defaults.
    // A corrupt record is skipped, never fatal.
    //
    // load() reads outside the write queue by design: it runs once at boot,
    // before any save has been queued, so there is nothing to race.

    var PRIMARY_KEY = 'current';
    var LAST_SAVED_KEY = 'lastSavedAt';
    var DEFAULT_MAX_BACKUPS = 10;
    var DEFAULT_BACKUP_INTERVAL_MS = 60000;

    function createEngine(opts) {
      opts = opts || {};
      var backend = opts.backend;
      if (!backend || typeof backend.put !== 'function') {
        throw new Error('core store requires a backend with get/put/delete/getAll/clear');
      }
      var now = opts.now || function () { return Date.now(); };
      var uid = opts.uid || function () {
        return 'bk-' + now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
      };
      var maxBackups = typeof opts.maxBackups === 'number' && opts.maxBackups > 0 ? opts.maxBackups : DEFAULT_MAX_BACKUPS;
      var backupIntervalMs = typeof opts.backupIntervalMs === 'number' && opts.backupIntervalMs > 0 ? opts.backupIntervalMs : DEFAULT_BACKUP_INTERVAL_MS;
      var serialize = opts.serialize || JSON.stringify;
      var parse = opts.parse || JSON.parse;

      var ready = null;
      var queue = Promise.resolve();
      // -Infinity so the first auto-backed-up save always snapshots.
      var lastBackupAt = -Infinity;

      function ensureReady() {
        if (!ready) {
          ready = backend.open().then(function () { return null; }, function (err) {
            ready = null;
            throw err;
          });
        }
        return ready;
      }

      // Serialize every queued operation: each op starts only after the
      // previous one settles (success or failure), so ordering is preserved
      // and one failed write never blocks the queue.
      function enqueue(fn) {
        var run = queue.then(fn, fn);
        queue = run.then(function () {}, function () {});
        return run;
      }

      function tryParse(text) {
        if (text === undefined || text === null) return null;
        // Accept already-parsed values as well as serialized strings: the
        // browser adapter stores the crash-mirror envelope with the state as
        // a nested object, and JSON.parse would coerce that object to
        // "[object Object]" and throw.
        if (typeof text !== 'string') return text;
        try {
          return parse(text);
        } catch (err) {
          return null;
        }
      }

      function validateWith(parsed, validate) {
        if (parsed === null || typeof validate !== 'function') return { ok: false };
        try {
          var result = validate(parsed);
          return result && result.ok ? result : { ok: false };
        } catch (err) {
          return { ok: false };
        }
      }

      function writeBackup(state, payload, reason) {
        var id = uid();
        var record = { id: id, createdAt: now(), reason: reason || 'auto', payload: payload };
        return backend.put('backups', id, record).then(function () {
          lastBackupAt = now();
          return pruneBackups();
        }).then(function () {
          return id;
        });
      }

      function pruneBackups() {
        return backend.getAll('backups').then(function (backups) {
          var sorted = (backups || []).slice().sort(function (a, b) {
            return (b.createdAt || 0) - (a.createdAt || 0);
          });
          var excess = sorted.slice(maxBackups);
          return Promise.all(excess.map(function (record) {
            return backend.delete('backups', record.id);
          })).then(function () {
            return sorted.length;
          });
        });
      }

      function load(loadOpts) {
        loadOpts = loadOpts || {};
        return ensureReady().then(function () {
          return Promise.all([
            backend.get('state', PRIMARY_KEY),
            backend.get('meta', LAST_SAVED_KEY)
          ]);
        }).then(function (results) {
          var primaryPayload = results[0];
          var meta = results[1] || {};
          var idbSavedAt = typeof meta.at === 'number' ? meta.at : 0;

          // Candidates are validated INDEPENDENTLY, so a corrupt newer copy
          // can never shadow a valid older one: a mirror that parses but
          // fails application validation falls through to the primary
          // instead of skipping it. Recovery order is: valid newer mirror,
          // valid primary, valid backups, valid legacy, defaults.
          var mirror = loadOpts.mirror || null;
          var mirrorNewer = Boolean(mirror && typeof mirror.savedAt === 'number' &&
            mirror.savedAt > idbSavedAt && mirror.payload !== undefined);
          if (mirrorNewer) {
            var mirrorResult = validateWith(tryParse(mirror.payload), loadOpts.validate);
            if (mirrorResult.ok) {
              return { state: mirrorResult.state, source: 'mirror', needsRepair: 'mirror' };
            }
          }
          var primaryResult = validateWith(tryParse(primaryPayload), loadOpts.validate);
          if (primaryResult.ok) {
            return { state: primaryResult.state, source: 'primary', needsRepair: null };
          }

          // The primary is corrupt or missing — fall back to backups, then to
          // the legacy localStorage payload, then to defaults.
          return backend.getAll('backups').then(function (backups) {
            var sorted = (backups || []).slice().sort(function (a, b) {
              return (b.createdAt || 0) - (a.createdAt || 0);
            });
            for (var i = 0; i < sorted.length; i++) {
              var parsed = tryParse(sorted[i].payload);
              var backupResult = validateWith(parsed, loadOpts.validate);
              if (backupResult.ok) {
                return { state: backupResult.state, source: 'backup', backupId: sorted[i].id, needsRepair: 'backup' };
              }
            }
            if (loadOpts.legacy !== undefined && loadOpts.legacy !== null) {
              var legacyParsed = tryParse(loadOpts.legacy);
              var legacyResult = validateWith(legacyParsed, loadOpts.validate);
              if (legacyResult.ok) {
                return { state: legacyResult.state, source: 'legacy', needsRepair: 'legacy' };
              }
            }
            if (typeof loadOpts.defaults === 'function') {
              return { state: loadOpts.defaults(), source: 'defaults', needsRepair: 'defaults' };
            }
            return { state: null, source: 'none' };
          });
        });
      }

      function save(state, saveOpts) {
        saveOpts = saveOpts || {};
        var payload = serialize(state);
        // The savedAt stamp is captured at CALL time — the same instant the
        // synchronous localStorage mirror is written — not when the queued
        // write lands. The boot-time mirror comparison (load) is only sound
        // if both timestamps measure the same moment: a mutation whose mirror
        // write happened but whose IDB write never landed must make the
        // mirror look newer than the last LANDED write.
        var savedAt = now();
        return enqueue(function () {
          return ensureReady().then(function () {
            return backend.put('state', PRIMARY_KEY, payload);
          }).then(function () {
            var updates = [backend.put('meta', LAST_SAVED_KEY, { at: savedAt })];
            if (saveOpts.backup === true) {
              // A backup failure must never fail the primary save: the
              // state record already landed, so report the backup error as a
              // swallowed rejection and let the queue continue.
              updates.push(writeBackup(state, payload, saveOpts.reason || 'manual').catch(function () { return null; }));
            } else if (saveOpts.backup === 'auto' && now() - lastBackupAt >= backupIntervalMs) {
              updates.push(writeBackup(state, payload, saveOpts.reason || 'auto').catch(function () { return null; }));
            }
            return Promise.all(updates);
          }).then(function (results) {
            return results.length > 1 ? results[1] : null;
          });
        });
      }

      function backup(state, reason) {
        var payload = serialize(state);
        return enqueue(function () {
          return ensureReady().then(function () {
            return writeBackup(state, payload, reason || 'manual');
          });
        });
      }

      function listBackups() {
        return ensureReady().then(function () {
          return backend.getAll('backups');
        }).then(function (backups) {
          return (backups || []).map(function (record) {
            return { id: record.id, createdAt: record.createdAt, reason: record.reason };
          }).sort(function (a, b) {
            return (b.createdAt || 0) - (a.createdAt || 0);
          });
        });
      }

      function restore(backupId) {
        return ensureReady().then(function () {
          return backend.get('backups', backupId);
        }).then(function (record) {
          if (!record) return null;
          return tryParse(record.payload);
        });
      }

      function lastSavedAt() {
        return ensureReady().then(function () {
          return backend.get('meta', LAST_SAVED_KEY);
        }).then(function (meta) {
          return meta && typeof meta.at === 'number' ? meta.at : null;
        });
      }

      function clearAll() {
        return enqueue(function () {
          return ensureReady().then(function () {
            return Promise.all([
              backend.clear('state'),
              backend.clear('backups'),
              backend.clear('meta')
            ]);
          });
        });
      }

      // Resolves once every queued write has settled — the unit tests and the
      // e2e suite await this instead of racing the queue.
      function flush() {
        return enqueue(function () { return null; });
      }

      return {
        load: load,
        save: save,
        backup: backup,
        listBackups: listBackups,
        restore: restore,
        lastSavedAt: lastSavedAt,
        clearAll: clearAll,
        flush: flush,
        now: now
      };
    }

    return {
      createEngine: createEngine,
      PRIMARY_KEY: PRIMARY_KEY,
      LAST_SAVED_KEY: LAST_SAVED_KEY
    };
  }
);
