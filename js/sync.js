(function (KB) {
  // Mutation observer — the sync seam.
  //
  // Every state change that reaches persistence goes through
  // KB.State.save(source), which emits a change event here. A future
  // optional CRDT sync layer (Yjs / Automerge) subscribes to these events to
  // apply local mutations to its document and to feed remote deltas back
  // through KB.State commits. Today the observer is a no-op passthrough:
  // nothing is synced anywhere.
  //
  // Event shape: { source, at, state }
  //   source: 'change' | 'undo' | 'redo' | 'import' | 'load' | 'repair' | ...
  //   at:     Date.now() when the change was committed
  //   state:  the live state reference (do not mutate; clone to snapshot)

  var subscribers = [];

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    subscribers.push(fn);
    var active = true;
    return function () {
      if (!active) return;
      active = false;
      var index = subscribers.indexOf(fn);
      if (index !== -1) subscribers.splice(index, 1);
    };
  }

  function emit(change) {
    var snapshot = subscribers.slice();
    for (var i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i](change);
      } catch (err) {
        console.warn('KB.Sync subscriber failed', err);
      }
    }
  }

  KB.Sync = {
    subscribe: subscribe,
    emit: emit
  };
})(window.KB = window.KB || {});
