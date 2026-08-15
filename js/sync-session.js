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

  var binding = null;
  var provider = null;
  var baseline = null;
  var room = null;
  var relayUrl = '';
  var ready = false;
  // Serializes document writes; every consequence of an update is chained
  // behind the write that records it. See persist().
  var persistChain = Promise.resolve();
  // Sessions are numbered, and every asynchronous continuation carries the
  // number it was started under. stop() bumps it, so work still in flight from
  // a session that has ended — a pending document load, a queued write, an
  // update waiting to be published — finds itself out of date and does
  // nothing. Comparing `room` is not enough: enable('work') twice in a row is
  // two sessions with the same room name, and the first one's leftovers would
  // pass a room check and then act on the second one's provider.
  var epoch = 0;
  // Why this session is not syncing, when it is enabled but not running:
  // 'no-document-store' (lineage cannot be recorded), 'no-history' (asked to
  // join a room nobody with its history is online for), or 'read-only-tab'
  // (another tab holds the write lease). Null when healthy.
  var fault = null;
  var watchingLease = false;
  // True from start()'s first asynchronous instruction until the session is
  // either built or abandoned. It is what makes a half-started session
  // something demotion can retire — see onLeaseLost.
  var starting = false;
  // Set while the relay has granted this peer the right to seed an unseeded
  // room and it has not yet declared the bootstrap complete.
  var holdsSeedingRight = false;
  // `ready` drops on every disconnect; `initialized` latches on the first
  // successful handshake and marks the moment the document became real. Local
  // ops are buffered before that and applied directly after it.
  var initialized = false;
  var pendingOps = [];
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
      status: fault ? 'error' : (provider ? provider.status() : 'offline'),
      peers: peers,
      fault: fault
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
      return {
        room: parsed.room,
        url: typeof parsed.url === 'string' ? parsed.url : '',
        // "This device is bringing this room into existence." Spent on the
        // first successful bootstrap — see onReady.
        create: parsed.create === true
      };
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

  // Losing the write lease ends the session outright rather than leaving a
  // read-only Y.Doc and socket alive. Two reasons, and the second is the one
  // that bites: a demoted tab can no longer record what it publishes, and —
  // if the relay had granted it the seeding right — it would go on holding
  // every other peer in that room behind a bootstrap it can never complete.
  // Closing the socket makes the relay discard the abandoned bootstrap and
  // promote a device that can finish it.
  //
  // The config is deliberately left in place: this device is still a member of
  // the room, and js/multitab.js reloads a tab that takes the lease back, so
  // init() starts the session again on that boot.
  function onLeaseLost() {
    // `starting` counts. A session exists from its first asynchronous
    // instruction, not from the moment a Y.Doc appears: the lease can move
    // while vendor/yjs.js is still being fetched, and a demotion that found
    // only nulls and returned would leave the epoch untouched, so the startup
    // still in flight would go on to build the document and open the socket
    // that this tab is no longer allowed to have.
    if (!binding && !provider && !starting) return;
    stop();
    fault = 'read-only-tab';
    notify();
  }

  function watchLease() {
    if (watchingLease || !KB.MultiTab || !KB.MultiTab.onDemote) return;
    watchingLease = true;
    KB.MultiTab.onDemote(onLeaseLost);
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

  // WRITE-AHEAD, deliberately, and NOT debounced.
  //
  // The consequences of a Yjs update — peers learning the new CRDT identity,
  // local state materialising it — must never outlive the record of it. Plain
  // Floban state is already crash-safe before any of this runs (State.save()
  // writes the localStorage mirror synchronously, then emits), so a crash
  // between "identity created and published" and "identity persisted" leaves
  // this device holding a board whose cards exist in plain state but not in
  // its document. restore() would then rebuild those cards as fresh identities
  // and the peer that received the originals would merge them as duplicates —
  // the lineage bug again, on a 500ms fuse instead of a reload.
  //
  // So the write lands FIRST and everything downstream waits on it. It is one
  // small same-origin IndexedDB put; identity correctness is the entire reason
  // this database exists, and a few milliseconds is not worth trading for it.
  //
  // Resolves TRUE only when the consequences may proceed. It never rejects,
  // because the chain the next write queues behind must stay usable — so the
  // failure is reported in the value, and every caller gates on it. A write
  // that did not land must not be followed by a push: that is exactly the
  // "published an identity this device cannot remember" case the ordering
  // exists to prevent, arriving through the one path that guarantees it.
  function persist() {
    if (!binding || !room) return Promise.resolve(false);
    // A read-only tab must not write the document: the record is shared, and
    // its own in-memory state may be behind the owning tab's. Fail CLOSED —
    // a tab that cannot record an identity must not publish one either. It
    // reaches here only by being demoted mid-session (start() refuses to run
    // sync in a read-only tab at all); takeover reloads it, and sync starts
    // again on that boot.
    if (!canApply()) return Promise.resolve(false);
    // Destination captured HERE, with the snapshot it belongs to. Reading the
    // globals when the queued write finally runs would address whichever room
    // the session had switched to by then, and write room A's document into
    // room B's record.
    var myEpoch = epoch;
    var targetRoom = room;
    var targetUrl = relayUrl;
    var snapshot = binding.encodeState();
    // Serialized, so two updates in flight cannot land out of order and leave
    // an older document on top of a newer one.
    var write = persistChain.then(function () {
      // Re-checked here, not just at the top: this write may have been queued
      // behind another for long enough that the lease moved to a different
      // tab in between. The record is shared, so a late write from a demoted
      // tab can land on top of the new owner's newer document.
      if (myEpoch !== epoch || !canApply()) return false;
      return KB.SyncDocs.save(targetUrl, targetRoom, snapshot).then(function () {
        // And again after it lands. The lease can move while the transaction
        // is open, and a write that finishes into a tab that has since been
        // demoted must not license the publication that would follow it.
        return myEpoch === epoch && canApply();
      });
    }).catch(function (err) {
      if (myEpoch !== epoch) return false;
      onLineageLost(err);
      return false;
    });
    persistChain = write;
    return write;
  }

  // The document store failed. Everything from here would be identity this
  // device cannot prove it owns, so the sync session stops — the board itself
  // is untouched and keeps working exactly as it does with sync switched off.
  function onLineageLost(err) {
    if (fault) return;
    var myEpoch = epoch;
    fault = 'no-document-store';
    console.warn('KB.SyncSession stopped: the sync document store is unusable', err);
    // Asynchronous so this can be called from inside the chain it tears down.
    setTimeout(function () {
      if (myEpoch !== epoch || fault !== 'no-document-store') return;
      stop();
      fault = 'no-document-store';
      notify();
    }, 0);
  }

  // Reload the document this device left the room with, then bring it up to
  // date with local state: edits made while sync was off live in KB.State
  // only, and without this the handshake's adopt() would commit the older
  // document over the newer board.
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
    var myEpoch = epoch;
    // A demoted tab keeps the change in its in-memory document and says so in
    // the banner, exactly as commit() would — but it neither writes the shared
    // record nor commits, so persist() would fail closed and skip the flag.
    if (!canApply()) {
      blockedByReadOnly = true;
      return;
    }
    // Same boundary as the local path, inverted: the document is durable
    // before local state is allowed to depend on it, so a crash leaves either
    // the old world everywhere or the new identities safely recorded.
    persist().then(function (recorded) {
      if (!recorded || myEpoch !== epoch || !binding || !ready) return;
      // A seed for a room that still had nothing in it at handshake time.
      // Adopt it now — which also replays the ops buffered while waiting.
      if (!initialized && !binding.isEmpty()) {
        adopt();
        return;
      }
      scheduleCommit();
    });
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

  // An empty room at the relay means one of two things it cannot tell apart:
  // a room that has never existed, or an established room whose history-holding
  // devices all happen to be offline right now — the relay forgets a room the
  // moment its last peer leaves. Seeding plain state into the second case
  // starts a rival lineage that collides with the real one when a real member
  // returns. So a device may only bootstrap a room it has grounds to:
  //
  //   - it holds the room's document already (reconnect, or a relay restart), or
  //   - the user said this room is new (`enable(room, url, { create: true })`).
  //
  // Anything else is a join, and a join needs somebody to join.
  function mayBootstrap(config) {
    return !binding.isEmpty() || config.create === true;
  }

  function onReady(info) {
    ready = true;
    var myEpoch = epoch;
    var config = readConfig() || {};
    var canSeed = !info || info.canSeed !== false;

    // Demoted between opening the socket and the handshake. Everything below
    // this line either mints identities or takes on an obligation to the room,
    // and a read-only tab can do neither: it cannot record what it would seed,
    // and holding the seeding right it was just granted would leave the relay
    // holding every other peer behind a bootstrap that can never arrive. Leave
    // instead, so the right moves to a device that can use it.
    if (!canApply()) {
      setTimeout(function () {
        if (myEpoch !== epoch) return;
        onLeaseLost();
      }, 0);
      return;
    }

    if (canSeed && !mayBootstrap(config)) {
      // Refuse, and leave: the relay promotes the next peer in line, which may
      // well be a device that does hold the history. Staying connected would
      // only hold the room shut behind a device that cannot open it.
      fault = 'no-history';
      console.warn(
        'KB.SyncSession: no device with room "' + room + '" history is online. ' +
        'Pass { create: true } to enable() only if this room is genuinely new.'
      );
      setTimeout(function () {
        if (myEpoch !== epoch) return;
        stop();
        fault = 'no-history';
        notify();
      }, 0);
      return;
    }

    // Granted on an unseeded room whether or not this device is empty: after a
    // relay restart the peer that reconnects first is asked to seed a room it
    // already has the document for, and the push below is that seed.
    holdsSeedingRight = canSeed;

    if (binding.isEmpty() && canSeed) {
      // First peer in a room the user created. seed() reads current state, so
      // anything edited while the handshake was in flight is already captured
      // — the buffered ops would only re-apply it, and an `add` op would
      // duplicate. Drop them. It publishes through onLocalUpdate, which
      // declares the bootstrap complete on the way out.
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
    persist().then(function (recorded) {
      if (!recorded || myEpoch !== epoch || !provider || !binding) return;
      provider.push(binding.encodeState());
      declareSeeded();
      // The create right is spent HERE — after a document has actually been
      // recorded, not merely after seed() made an in-memory one non-empty. A
      // seed that never reached the store leaves this device with nothing to
      // rejoin on, and spending the right on it would strand the room: the
      // user's one-shot "this room is new" would be gone, and every later
      // attempt would refuse to bootstrap a room that does not exist.
      // A later session must earn the right by holding the document, not by
      // remembering it created the room a year ago on a since-wiped store.
      if (config.create && !binding.isEmpty()) {
        writeConfig({ room: config.room, url: config.url, create: false });
      }
    });
    notify();
  }

  // ---- lifecycle ------------------------------------------------------------

  function start(config) {
    // A read-only tab does not sync. It deliberately persists nothing and
    // applies nothing, so a Y.Doc and a socket would buy it nothing — and the
    // handshake could still hand it the seeding right, at which point it would
    // mint a room's founding identities out of its own possibly-stale state
    // and publish them without ever recording them. That is the lineage fork,
    // reached from the one direction the write-ahead rule cannot cover.
    // js/multitab.js reloads a tab that takes over, so sync starts normally on
    // that boot.
    if (!canApply()) return Promise.resolve(state());
    // From here the session exists, so it needs to hear about a lease it might
    // lose. Registered once per page, not per session.
    watchLease();
    // The session begins HERE, not when the Y.Doc appears. vendor/yjs.js is
    // fetched over the network, and the lease can move while it is in flight.
    starting = true;
    // enable()/init() have already called stop(), so this is the number of the
    // session about to exist. Everything below belongs to it.
    var myEpoch = epoch;
    var run = loadYjs().then(function (Y) {
      if (myEpoch !== epoch || binding) return state();
      // The last moment before a document exists, and possibly the first code
      // to learn the lease is gone: canWrite() demotes synchronously but
      // announces on a task, so this check can beat the announcement to it.
      // Retire the startup HERE, while it still owns `starting` — leaving it to
      // onDemote would mean settled() had already cleared the only evidence
      // that there was a session to retire, and the tab would sit read-only
      // reporting no fault at all.
      if (!canApply()) {
        onLeaseLost();
        return state();
      }

      binding = KB.Core.YDoc.create({ Y: Y });
      baseline = clone(KB.State.data());
      room = config.room;
      relayUrl = config.url || '';
      ready = false;
      initialized = false;
      holdsSeedingRight = false;
      pendingOps = [];

      binding.onLocalUpdate(function (update) {
        // Write-ahead: nobody else learns of this identity until this device
        // can prove it owns it.
        persist().then(function (recorded) {
          if (!recorded || myEpoch !== epoch || !provider) return;
          provider.push(update);
          // Covers the one case the handshake cannot: this device held the
          // seeding right with nothing to seed, and has now made its first edit.
          declareSeeded();
        });
      });
      binding.onRemoteUpdate(onRemoteUpdate);
      unsubscribe = KB.Sync.subscribe(onLocalSave);

      // The persisted document has to be in place BEFORE the socket opens, or
      // the handshake would find an empty binding and seed a fresh lineage.
      // A store that cannot be read is not "no document" — it is "cannot
      // tell", and connecting on that footing is how rooms get forked.
      return KB.SyncDocs.load(relayUrl, room).catch(function (err) {
        if (myEpoch !== epoch) return null;
        onLineageLost(err);
        return null;
      }).then(function (saved) {
        // enable()/disable() may have torn the session down while we waited —
        // or replaced it with another session for the SAME room, which is why
        // this is an epoch and not a room comparison. Getting it wrong leaves
        // a second provider holding an open socket that nothing will close.
        if (myEpoch !== epoch || !binding || fault) return state();
        restore(saved);

        // Pinned to THIS session, not to whatever the globals hold when the
        // callback fires. The provider is closed on stop(), but closing a
        // WebSocket does not un-queue the message events the browser has
        // already scheduled, so a callback from the old room can still arrive
        // after the switch. onUpdate is the one that matters: it applies bytes
        // straight into the document, ahead of any epoch check downstream,
        // and would merge room A's history into room B. onReady is nearly as
        // bad — it reads the epoch when it runs, so a stale one looks current.
        var mySession = binding;
        function isCurrent() {
          return myEpoch === epoch && binding === mySession;
        }

        provider = KB.SyncProvider.create({
          room: config.room,
          url: config.url || '',
          onUpdate: function (update) {
            if (!isCurrent()) return;
            mySession.applyUpdate(update);
          },
          onReady: function (info) {
            if (!isCurrent()) return;
            onReady(info);
          },
          onPeers: function (n) {
            if (!isCurrent()) return;
            peers = n;
            notify();
          },
          onStatus: function (status) {
            if (!isCurrent()) return;
            if (status !== 'connected') {
              ready = false;
              // A right granted by a relay we are no longer talking to is not
              // a right; the next handshake says whether we still hold it.
              holdsSeedingRight = false;
            }
            notify();
          },
          snapshot: function () {
            return isCurrent() ? mySession.encodeState() : null;
          }
        });

        notify();
        return state();
      });
    });

    // The startup is over either way — but only for the session that ran it.
    // If a newer one is already under way, `starting` is now its flag to hold.
    function settled(result) {
      if (myEpoch === epoch) starting = false;
      return result;
    }
    return run.then(settled, function (err) {
      settled();
      throw err;
    });
  }

  function stop() {
    // Retires this session's number first: anything still in flight under it
    // is now a leftover, and every continuation checks before it acts.
    epoch += 1;
    starting = false;
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (pendingCommit) {
      clearTimeout(pendingCommit);
      pendingCommit = null;
    }
    // No final save: persist() is write-ahead, so the document on disk is
    // already at least as current as the one being torn down here.
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
    relayUrl = '';
    ready = false;
    initialized = false;
    holdsSeedingRight = false;
    fault = null;
    pendingOps = [];
    peers = 0;
    blockedByReadOnly = false;
  }

  // Turn sync on for a room and remember it across reloads. Rejects if the
  // vendored Yjs bundle cannot be fetched — offline on a cold cache, say.
  //
  // `options.create` is the difference between "this room is new" and "put me
  // in the room my other device is already using". It matters because the
  // relay forgets a room when its last peer leaves, so an empty room there
  // means either — and only the user knows which. Join is the default: getting
  // it wrong that way waits, getting it wrong the other way forks the board.
  function enable(room, url, options) {
    var id = String(room || '').trim();
    if (!/^[\w.-]{1,64}$/.test(id)) {
      return Promise.reject(
        new Error('A room name may use letters, digits, dot, dash and underscore')
      );
    }
    // Say why, rather than silently accepting a room this tab will not join.
    if (!canApply()) {
      return Promise.reject(
        new Error('This tab is read-only. Take over the board here first, then enable sync.')
      );
    }
    var config = {
      room: id,
      url: String(url || '').trim(),
      create: !!(options && options.create)
    };
    stop();
    // Asking for sync is also asking to retry the document store. A single
    // aborted IndexedDB transaction latches it shut, and without this the only
    // way back from a transient one would be reloading the page. Safe because
    // it clears nothing else: if the store is still broken the first write
    // latches it again and the session stops with the same fault.
    if (KB.SyncDocs && KB.SyncDocs.reopen) KB.SyncDocs.reopen();
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
    // just a stale copy of the board it already has in KB.Storage. Deleting it
    // behind the write chain, not beside it: an in-flight persist landing
    // after the delete would leave the record it was meant to retire.
    var leaving = room;
    var leavingUrl = relayUrl;
    var writes = persistChain;
    stop();
    if (leaving) {
      writes.catch(function () {}).then(function () {
        return KB.SyncDocs.remove(leavingUrl, leaving);
      }).catch(function () {
        // Nothing to recover: the record is stale either way, and the next
        // enable() for this room will overwrite it.
      });
    }
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
