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
  // record.
  //
  // Canonicalizing the relay URL is not cosmetic in either direction. Only the
  // scheme and host are case-insensitive; the path and query are not, so
  // lowercasing the whole URL would merge `wss://host/Sync` and
  // `wss://host/sync` — two endpoints that may hold two unrelated rooms — into
  // one lineage. And the empty URL is not a relay of its own: it means the
  // same-origin default, so it has to resolve to the endpoint it will actually
  // connect to or `enable(room)` and `enable(room, 'ws://localhost/sync')`
  // would keep two documents for one room.
  function relay(url) {
    var raw = String(url || '').trim();
    if (!raw && KB.SyncProvider && KB.SyncProvider.defaultUrl) {
      raw = KB.SyncProvider.defaultUrl();
    }
    if (!raw) return '';
    var parsed;
    try {
      parsed = new URL(raw, window.location.href);
    } catch (err) {
      // Not a URL the browser will connect to either. Be consistent about it
      // rather than clever: the same bad string keys the same record.
      return raw.toLowerCase();
    }
    // The URL parser has already lowercased the scheme and host and dropped a
    // default port (ws/wss are special schemes), so what is left is the case
    // that carries meaning.
    return parsed.protocol + '//' + parsed.hostname +
      (parsed.port ? ':' + parsed.port : '') +
      parsed.pathname.replace(/\/+$/, '') + parsed.search;
  }

  function key(url, room) {
    return relay(url) + '::' + room;
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
