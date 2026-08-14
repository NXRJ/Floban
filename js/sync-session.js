(function (KB) {
  // The glue between the app's save funnel and the CRDT layer. Owns the
  // lifecycle: nothing here runs unless the user has opted in.
  //
  //   KB.Sync.emit  --diff-->  KB.Core.YDoc  --update-->  KB.SyncProvider
  //   KB.State.applyRemote  <--toState--  KB.Core.YDoc  <--update--  relay
  //
  // Three rules this module exists to enforce, all from docs/SYNC.md:
  //
  //   1. Remote changes never touch KB.State.internal.state. They go through
  //      applyRemote, which normalizes, records undo history, and saves — so
  //      undo, backups and persistence behave the same whether an edit came
  //      from this keyboard or another device.
  //   2. A remote-sourced save must not be diffed back into the document, or
  //      two peers ping-pong the same edit forever.
  //   3. A read-only tab (js/multitab.js) applies nothing. Its in-memory state
  //      may be stale and its saves are dropped anyway; committing a remote
  //      snapshot there would show the user changes that were never persisted.
  //   4. The Y.Doc is persisted (js/sync-docs.js) and reloaded, never rebuilt
  //      from plain state. Rebuilding gives the same board a second CRDT
  //      identity, and two lineages of one board merge into two boards.
  //
  // vendor/yjs.js is fetched on demand rather than shipped in index.html: 93KB
  // should not ride on every boot for a feature that is off by default.

  var CONFIG_KEY = 'kanban.sync.v1';
  var VENDOR_URL = 'vendor/yjs.js';
  // Log replay on connect arrives as a burst of updates. Coalesce them into a
  // single commit rather than re-rendering the board once per message.
  var COMMIT_DEBOUNCE_MS = 60;
  // Persisting the document is bookkeeping, not the save path — the user's
  // board is already durable through KB.Storage before any of this runs.
  var PERSIST_DEBOUNCE_MS = 500;

  var binding = null;
  var provider = null;
  var baseline = null;
  var room = null;
  var ready = false;
  // Set while the relay has granted this peer the right to seed an unseeded
  // room and it has not yet declared the bootstrap complete.
  var holdsSeedingRight = false;
  // `ready` drops on every disconnect; `initialized` latches on the first
  // successful handshake and marks the moment the document became real. Local
  // ops are buffered before that and applied directly after it.
  var initialized = false;
  var pendingOps = [];
  var pendingCommit = null;
  var pendingPersist = null;
  var blockedByReadOnly = false;
  var peers = 0;
  var loading = null;
  var listeners = [];
  var unsubscribe = null;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function state() {
    var config = readConfig();
    return {
      enabled: !!config,
      room: config ? config.room : '',
      status: provider ? provider.status() : 'offline',
      peers: peers
    };
  }

  function notify() {
    var snapshot = listeners.slice();
    for (var i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i](state());
      } catch (err) {
        console.warn('KB.SyncSession listener failed', err);
      }
    }
  }

  // ---- config ---------------------------------------------------------------

  function readConfig() {
    var raw;
    try {
      raw = localStorage.getItem(CONFIG_KEY);
    } catch (err) {
      return null; // storage denied (private mode); sync simply stays off
    }
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.room !== 'string' || !parsed.room) return null;
      return { room: parsed.room, url: typeof parsed.url === 'string' ? parsed.url : '' };
    } catch (err) {
      return null;
    }
  }

  function writeConfig(config) {
    try {
      if (config) localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      else localStorage.removeItem(CONFIG_KEY);
      return true;
    } catch (err) {
      return false;
    }
  }

  // ---- vendored Yjs ---------------------------------------------------------

  function loadYjs() {
    if (window.Y) return Promise.resolve(window.Y);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = VENDOR_URL;
      script.async = true;
      script.onload = function () {
        if (window.Y) resolve(window.Y);
        else reject(new Error('vendor/yjs.js loaded without defining Y'));
      };
      script.onerror = function () {
        reject(new Error('Could not load ' + VENDOR_URL));
      };
      document.head.appendChild(script);
    });
    loading.catch(function () {
      loading = null; // let a later attempt retry rather than fail forever
    });
    return loading;
  }

  // ---- local -> document ----------------------------------------------------

  function onLocalSave(change) {
    if (!binding) return;
    // Rule 2: a save whose source is a remote commit is the echo of a change
    // the document already has. Re-baseline and stop.
    if (change.source === 'remote') {
      baseline = clone(change.state);
      return;
    }
    var ops = KB.Core.StateDiff.diff(baseline, change.state);
    baseline = clone(change.state);

    // Rule 4: until the first handshake completes, the document is an empty
    // Y.Doc — the room's history has not replayed yet. An op like
    // `card.set(title)` against a card the document does not hold silently
    // does nothing (see js/core/ydoc.js), and `baseline` has already moved
    // past the edit, so the delta would be unrecoverable the moment the
    // handshake commits the room's state over the top of it. Hold the ops and
    // replay them once there is a document to apply them to.
    if (!initialized) {
      pendingOps = pendingOps.concat(ops);
      return;
    }
    binding.applyOps(ops);
  }

  // ---- document -> local ----------------------------------------------------

  function canApply() {
    return !KB.MultiTab || KB.MultiTab.canWrite();
  }

  function commit() {
    if (!binding) return;
    // Rule 3: hold the change in the document until this tab can write again.
    // Takeover reloads the tab from storage, so nothing is lost by waiting.
    if (!canApply()) {
      blockedByReadOnly = true;
      return;
    }
    blockedByReadOnly = false;

    var next = binding.toState();
    var local = KB.State.data();
    // Device-local keys are not in the document by design; keep this device's.
    KB.Core.YDoc.DEVICE_KEYS.forEach(function (key) {
      next[key] = local[key];
    });

    if (!KB.State.applyRemote(next)) return;
    baseline = clone(KB.State.data());
    if (KB.App) KB.App.refresh();
  }

  function scheduleCommit() {
    if (pendingCommit) return;
    pendingCommit = setTimeout(function () {
      pendingCommit = null;
      commit();
    }, COMMIT_DEBOUNCE_MS);
  }

  // ---- document memory ------------------------------------------------------

  // Keep this device's copy of the Y.Doc across reloads. Rebuilding it from
  // plain state instead would give the same board a second CRDT identity — see
  // js/sync-docs.js — so this is what makes a reconnect a merge rather than a
  // fork. Debounced, and skipped in a read-only tab: its document may be
  // missing edits the owning tab made offline, and this key is shared.
  function persist() {
    if (pendingPersist || !KB.SyncDocs) return;
    pendingPersist = setTimeout(function () {
      pendingPersist = null;
      if (!binding || !room || !canApply()) return;
      KB.SyncDocs.save(room, binding.encodeState());
    }, PERSIST_DEBOUNCE_MS);
  }

  // Reload the document this device left the room with, then bring it up to
  // date with local state: edits made while sync was off — or while it was
  // offline and buffering — live in KB.State only, and without this the
  // handshake's adopt() would commit the older document over the newer board.
  function restore(saved) {
    if (!saved || saved.length === 0) return;
    binding.restore(saved);
    if (binding.isEmpty()) return;
    binding.applyOps(KB.Core.StateDiff.diff(binding.toState(), KB.State.data()));
    baseline = clone(KB.State.data());
    // There is a real document to diff into from the first save onward — the
    // whole point of having kept it.
    initialized = true;
  }

  function onRemoteUpdate() {
    persist();
    // Updates arriving before `ready` are the room's history replaying. The
    // handshake below decides what to do with them once the replay is done.
    if (!ready) return;
    // A seed for a room that still had nothing in it at handshake time. Adopt
    // it now — which is also what replays the ops buffered while waiting.
    if (!initialized && !binding.isEmpty()) {
      adopt();
      return;
    }
    scheduleCommit();
  }

  // ---- handshake ------------------------------------------------------------

  // The room has a document: merge it into this device, then replay anything
  // edited while connecting ON TOP of the merged document — commit() has just
  // overwritten those edits in local state, and these ops are the only
  // remaining record of them.
  function adopt() {
    commit();
    if (pendingOps.length) {
      binding.applyOps(pendingOps);
      pendingOps = [];
      scheduleCommit();
    }
    // Only now is there a document worth diffing into; later saves apply
    // directly. This stays true across a reconnect: the document survives, so
    // edits made while offline apply locally and republish.
    initialized = true;
  }

  // The relay is holding every other peer in this room until it hears that a
  // document exists, and it cannot tell that from the bytes — an encoded empty
  // Y.Doc is two of them. So say it, once, and only with something behind it.
  function declareSeeded() {
    if (!holdsSeedingRight || !provider || binding.isEmpty()) return;
    holdsSeedingRight = false;
    provider.seeded();
  }

  function onReady(info) {
    ready = true;
    var canSeed = !info || info.canSeed !== false;
    // Granted on an unseeded room whether or not this device is empty: after a
    // relay restart the peer that reconnects first is asked to seed a room it
    // already has the document for, and the push below is that seed.
    holdsSeedingRight = canSeed;

    if (binding.isEmpty() && canSeed) {
      // First peer in an empty room, and the relay confirmed we hold the
      // seeding right. seed() reads current state, so anything edited while
      // the handshake was in flight is already captured — the buffered ops
      // would only re-apply it, and an `add` op would duplicate. Drop them.
      // It publishes through onLocalUpdate, which declares the bootstrap
      // complete on the way out.
      binding.seed(KB.State.data());
      baseline = clone(KB.State.data());
      pendingOps = [];
      initialized = true;
    } else if (binding.isEmpty()) {
      // Told to adopt a room that holds nothing yet. A current relay does not
      // do this — it withholds `ready` until the room is seeded — so this
      // needs a relay from before that rule. Adopting here would apply the
      // buffered ops against an empty document, which drops every op naming a
      // card the document does not have. Stay uninitialized and keep
      // buffering; onRemoteUpdate adopts as soon as the seed arrives.
      initialized = false;
    } else {
      adopt();
    }

    // Re-publish everything we hold. Idempotent for peers, and it repopulates a
    // relay that restarted empty or dropped history while we were disconnected
    // — with the same document identities we left with, because the Y.Doc was
    // persisted rather than rebuilt (see restore above).
    provider.push(binding.encodeState());
    declareSeeded();
    persist();
    notify();
  }

  // ---- lifecycle ------------------------------------------------------------

  function start(config) {
    return loadYjs().then(function (Y) {
      if (binding) return state();

      binding = KB.Core.YDoc.create({ Y: Y });
      baseline = clone(KB.State.data());
      room = config.room;
      ready = false;
      initialized = false;
      holdsSeedingRight = false;
      pendingOps = [];

      binding.onLocalUpdate(function (update) {
        persist();
        if (!provider) return;
        provider.push(update);
        // Covers the one case the handshake cannot: this device held the
        // seeding right with nothing to seed, and has now made its first edit.
        declareSeeded();
      });
      binding.onRemoteUpdate(onRemoteUpdate);
      unsubscribe = KB.Sync.subscribe(onLocalSave);

      // The persisted document has to be in place BEFORE the socket opens, or
      // the handshake would find an empty binding and seed a fresh lineage.
      var loaded = KB.SyncDocs ? KB.SyncDocs.load(room) : Promise.resolve(null);
      return loaded.then(function (saved) {
        // enable()/disable() may have torn the session down while we waited.
        if (!binding || room !== config.room) return state();
        restore(saved);

        provider = KB.SyncProvider.create({
          room: config.room,
          url: config.url || '',
          onUpdate: function (update) { binding.applyUpdate(update); },
          onReady: onReady,
          onPeers: function (n) { peers = n; notify(); },
          onStatus: function (status) {
            if (status !== 'connected') {
              ready = false;
              // A right granted by a relay we are no longer talking to is not
              // a right; the next handshake says whether we still hold it.
              holdsSeedingRight = false;
            }
            notify();
          },
          snapshot: function () { return binding.encodeState(); }
        });

        notify();
        return state();
      });
    });
  }

  function stop(forget) {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (pendingCommit) {
      clearTimeout(pendingCommit);
      pendingCommit = null;
    }
    if (pendingPersist) {
      clearTimeout(pendingPersist);
      pendingPersist = null;
    }
    // Last chance to record where this device got to; the next session rejoins
    // as the same document rather than a second lineage of the same board.
    // `forget` is disable(): writing the document and deleting it in the same
    // turn is a race, and the loser is whichever promise settles second.
    if (!forget && binding && room && KB.SyncDocs && canApply()) {
      KB.SyncDocs.save(room, binding.encodeState());
    }
    if (provider) {
      provider.close();
      provider = null;
    }
    if (binding) {
      binding.destroy();
      binding = null;
    }
    baseline = null;
    room = null;
    ready = false;
    initialized = false;
    holdsSeedingRight = false;
    pendingOps = [];
    peers = 0;
    blockedByReadOnly = false;
  }

  // Turn sync on for a room and remember it across reloads. Rejects if the
  // vendored Yjs bundle cannot be fetched — offline on a cold cache, say.
  function enable(room, url) {
    var id = String(room || '').trim();
    if (!/^[\w.-]{1,64}$/.test(id)) {
      return Promise.reject(
        new Error('A room name may use letters, digits, dot, dash and underscore')
      );
    }
    var config = { room: id, url: String(url || '').trim() };
    stop();
    writeConfig(config);
    return start(config).catch(function (err) {
      stop();
      notify();
      throw err;
    });
  }

  function disable() {
    // Turning sync off ends this device's membership of the room, so the
    // document it was holding is no longer its place in a shared history —
    // just a stale copy of the board it already has in KB.Storage.
    var leaving = room;
    stop(true);
    if (leaving && KB.SyncDocs) KB.SyncDocs.remove(leaving);
    writeConfig(null);
    notify();
  }

  // Called from app boot. Silent when sync was never turned on, which is the
  // default and the whole point.
  function init() {
    var config = readConfig();
    if (!config) return Promise.resolve(state());
    return start(config).catch(function (err) {
      stop();
      notify();
      console.warn('KB.SyncSession could not start', err);
      return state();
    });
  }

  KB.SyncSession = {
    init: init,
    enable: enable,
    disable: disable,
    state: state,
    // True when the document holds changes this tab is not allowed to apply
    // because another tab owns the write lease.
    isHoldingRemote: function () { return blockedByReadOnly; },
    subscribe: function (fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.push(fn);
      return function () {
        var index = listeners.indexOf(fn);
        if (index !== -1) listeners.splice(index, 1);
      };
    }
  };
})(window.KB = window.KB || {});
