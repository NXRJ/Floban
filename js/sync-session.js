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
  //
  // vendor/yjs.js is fetched on demand rather than shipped in index.html: 93KB
  // should not ride on every boot for a feature that is off by default.

  var CONFIG_KEY = 'kanban.sync.v1';
  var VENDOR_URL = 'vendor/yjs.js';
  // Log replay on connect arrives as a burst of updates. Coalesce them into a
  // single commit rather than re-rendering the board once per message.
  var COMMIT_DEBOUNCE_MS = 60;

  var binding = null;
  var provider = null;
  var baseline = null;
  var ready = false;
  var pendingCommit = null;
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

  function onRemoteUpdate() {
    // Updates arriving before `ready` are the room's history replaying. The
    // handshake below decides what to do with them once the replay is done.
    if (!ready) return;
    scheduleCommit();
  }

  // ---- handshake ------------------------------------------------------------

  function onReady() {
    ready = true;
    if (binding.isEmpty()) {
      // First peer in the room: the document starts as this device's board.
      binding.seed(KB.State.data());
      baseline = clone(KB.State.data());
    } else {
      // The room already has a document; merge it into this device.
      commit();
    }
    // Re-publish everything we hold. Idempotent for peers, and it repopulates a
    // relay that restarted empty or dropped history while we were disconnected.
    provider.push(binding.encodeState());
    notify();
  }

  // ---- lifecycle ------------------------------------------------------------

  function start(config) {
    return loadYjs().then(function (Y) {
      if (binding) return state();

      binding = KB.Core.YDoc.create({ Y: Y });
      baseline = clone(KB.State.data());
      ready = false;

      binding.onLocalUpdate(function (update) {
        if (provider) provider.push(update);
      });
      binding.onRemoteUpdate(onRemoteUpdate);
      unsubscribe = KB.Sync.subscribe(onLocalSave);

      provider = KB.SyncProvider.create({
        room: config.room,
        url: config.url || '',
        onUpdate: function (update) { binding.applyUpdate(update); },
        onReady: onReady,
        onPeers: function (n) { peers = n; notify(); },
        onStatus: function (status) {
          if (status !== 'connected') ready = false;
          notify();
        },
        snapshot: function () { return binding.encodeState(); }
      });

      notify();
      return state();
    });
  }

  function stop() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (pendingCommit) {
      clearTimeout(pendingCommit);
      pendingCommit = null;
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
    ready = false;
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
    stop();
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
