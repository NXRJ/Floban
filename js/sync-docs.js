(function (KB) {
  // Local persistence for the CRDT document itself, one encoded update per
  // room. It is not board data — js/storage.js remains the only owner of that
  // — but it is not optional bookkeeping either.
  //
  // WHY IT IS CORRECTNESS-CRITICAL: a board rebuilt from plain state is a NEW
  // set of Y.Map items even when every application id matches, because Yjs
  // identity is (clientId, clock) and not `board.id`. A device that rejoins a
  // room without the document it left with therefore rejoins as a SECOND
  // lineage, and the peer that still holds the first merges them into
  // duplicates of everything — one board id, two boards. So losing this store
  // is not "sync without a memory", it is "sync that can corrupt the room".
  // js/sync-session.js stops the session rather than continue without it.
  //
  // WHY ITS OWN DATABASE: the board store is at version 1 and its records are
  // the user's data. A separate database keeps a schema bump for sync metadata
  // from ever touching a migration path that matters.

  var DB_NAME = 'kanban-sync';
  var DB_VERSION = 1;
  var STORE = 'docs';

  var db = null;
  var opening = null;
  var available = true;

  // A room name is only unique within one relay: two relays can each host a
  // "work" and they are not the same room, so their documents must not share a
  // record. IndexedDB is already origin-scoped, which is what makes the empty
  // URL — the same-origin default — safe to leave unqualified.
  function key(url, room) {
    return String(url || '').trim().toLowerCase().replace(/\/+$/, '') + '::' + room;
  }

  function open() {
    if (db) return Promise.resolve(db);
    if (opening) return opening;
    opening = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
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

  function tx(mode, fn) {
    if (!available) return Promise.reject(new Error('KB.SyncDocs is unavailable'));
    return open().then(function (database) {
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction(STORE, mode);
        var result = null;
        var request = fn(transaction.objectStore(STORE));
        request.onsuccess = function () { result = request.result; };
        request.onerror = function () {
          reject(request.error || new Error('IndexedDB request failed'));
        };
        // Only a committed transaction is persisted; a request can succeed and
        // its transaction abort afterwards (quota, say).
        transaction.oncomplete = function () { resolve(result); };
        transaction.onerror = function () {
          reject(transaction.error || new Error('IndexedDB transaction failed'));
        };
        transaction.onabort = function () {
          reject(transaction.error || new Error('IndexedDB transaction aborted'));
        };
      });
    }).catch(function (err) {
      // Latch and rethrow. The caller has to know: a write that did not land
      // is a document identity this device can no longer prove it owns.
      available = false;
      throw err;
    });
  }

  // The encoded document for a room, or null if this device has never held one.
  // Rejects — it does not resolve null — when the store itself is unusable, so
  // "no document yet" and "cannot tell" stay distinguishable.
  function load(url, room) {
    return tx('readonly', function (store) { return store.get(key(url, room)); })
      .then(function (value) {
        if (!value) return null;
        // Browsers hand back an ArrayBuffer or a typed array depending on how
        // it went in; Yjs wants a Uint8Array either way.
        return value instanceof Uint8Array ? value : new Uint8Array(value);
      });
  }

  function save(url, room, update) {
    if (!update || update.length === 0) return Promise.resolve(null);
    return tx('readwrite', function (store) { return store.put(update, key(url, room)); });
  }

  function remove(url, room) {
    return tx('readwrite', function (store) { return store.delete(key(url, room)); });
  }

  KB.SyncDocs = {
    key: key,
    load: load,
    save: save,
    remove: remove,
    isAvailable: function () { return available; }
  };
})(window.KB = window.KB || {});
