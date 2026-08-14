(function (KB) {
  // Local persistence for the CRDT document itself, one encoded update per
  // room. Sync metadata, not application data: js/storage.js remains the only
  // owner of board state, and losing everything here costs a device nothing
  // but its place in the room's document history.
  //
  // WHY IT IS NEEDED: the plain snapshot in IndexedDB is not enough to rejoin
  // a room safely. A reloaded device that rebuilds its Y.Doc from plain state
  // produces a NEW set of Y.Map items, because Yjs identity is (clientId,
  // clock) and not `board.id`. If it then seeds a relay that restarted empty,
  // a peer that never reloaded merges that as a SECOND lineage and keeps both
  // — one board id, two boards. Persisting the encoded document keeps the
  // identities across the reload, and the merge becomes the no-op it should be.
  //
  // WHY ITS OWN DATABASE: the board store is at version 1 and its records are
  // the user's data. A separate database keeps a schema bump for sync metadata
  // from ever touching a migration path that matters, and lets this whole file
  // fail silently — every function resolves rather than rejects, because sync
  // must degrade to "no lineage memory", never to "no sync".

  var DB_NAME = 'kanban-sync';
  var DB_VERSION = 1;
  var STORE = 'docs';

  var db = null;
  var opening = null;
  var available = true;

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
    if (!available) return Promise.resolve(null);
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
      if (available) {
        available = false;
        console.warn('KB.SyncDocs unavailable — sync continues without document memory', err);
      }
      return null;
    });
  }

  // The encoded document for a room, or null if this device has never held one
  // (or storage is unusable, which is the same thing from here).
  function load(room) {
    return tx('readonly', function (store) { return store.get(room); })
      .then(function (value) {
        if (!value) return null;
        // Browsers hand back an ArrayBuffer or a typed array depending on how
        // it went in; Yjs wants a Uint8Array either way.
        return value instanceof Uint8Array ? value : new Uint8Array(value);
      });
  }

  function save(room, update) {
    if (!update || update.length === 0) return Promise.resolve(null);
    return tx('readwrite', function (store) { return store.put(update, room); });
  }

  function remove(room) {
    return tx('readwrite', function (store) { return store.delete(room); });
  }

  KB.SyncDocs = {
    load: load,
    save: save,
    remove: remove,
    isAvailable: function () { return available; }
  };
})(window.KB = window.KB || {});
