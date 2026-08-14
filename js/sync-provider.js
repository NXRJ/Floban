(function (KB) {
  // WebSocket transport for the CRDT layer. Speaks to the relay in
  // sync-relay.js and knows nothing about boards, cards, or Yjs semantics: it
  // moves opaque update bytes and reports connection state.
  //
  // The protocol is deliberately tiny, because the relay is deliberately dumb.
  //
  //   binary  [tag:1][seq:uint32 BE][payload]
  //             tag 1 = a Yjs update (both directions)
  //             tag 2 = a full-document snapshot (client -> relay only), where
  //                     seq acknowledges the last update this peer had applied
  //   text    {"t":"ready"}   there is a document here you may safely edit
  //           {"t":"peers"}   membership changed
  //           {"t":"compact"} the relay's log grew; send a snapshot to replace it
  //           {"t":"seeded"}  client -> relay: the document I was granted the
  //                           right to seed is published. The relay cannot read
  //                           it, and an encoded empty Y.Doc is two ordinary
  //                           bytes, so this is the only thing that can tell it
  //                           the room is bootstrapped.
  //
  // Reconnects re-push the whole local document (js/sync-session.js does it on
  // every `ready`). Yjs updates are idempotent, so the cost is one redundant
  // message; the benefit is that edits made while the socket was down cannot be
  // stranded, and a relay that restarted with an empty log is repopulated by
  // whoever reconnects first. That repopulation is only safe because peers
  // persist the Y.Doc itself (js/sync-docs.js) and so rejoin with the same
  // document identities they left with — see js/core/ydoc.js `restore`.

  var TAG_UPDATE = 1;
  var TAG_SNAPSHOT = 2;
  var HEADER_BYTES = 5;

  var BASE_RETRY_MS = 1000;
  var MAX_RETRY_MS = 30000;
  var JITTER = 0.2;

  function encodeFrame(tag, seq, payload) {
    var out = new Uint8Array(HEADER_BYTES + payload.length);
    var view = new DataView(out.buffer);
    out[0] = tag;
    view.setUint32(1, seq >>> 0, false);
    out.set(payload, HEADER_BYTES);
    return out;
  }

  // ws:// for http://, wss:// for https:// — a mixed-content downgrade would be
  // silently blocked by the browser and look like a dead relay.
  function defaultUrl() {
    var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return protocol + '//' + window.location.host + '/sync';
  }

  function create(options) {
    var settings = options || {};
    var room = settings.room;
    var url = settings.url || defaultUrl();
    var onUpdate = settings.onUpdate || function () {};
    var onReady = settings.onReady || function () {};
    var onPeers = settings.onPeers || function () {};
    var onStatus = settings.onStatus || function () {};
    var snapshot = settings.snapshot || function () { return null; };

    var socket = null;
    var status = 'offline';
    var attempts = 0;
    var retryTimer = null;
    var stopped = false;
    // The highest sequence number this peer has applied. Sent back with a
    // snapshot so the relay knows which updates its log still has to keep.
    var lastSeq = 0;

    function setStatus(next) {
      if (status === next) return;
      status = next;
      onStatus(status);
    }

    function endpoint() {
      return url + '?room=' + encodeURIComponent(room);
    }

    function retryDelay() {
      var base = Math.min(BASE_RETRY_MS * Math.pow(2, attempts), MAX_RETRY_MS);
      // Jitter so several tabs waking from sleep do not stampede the relay.
      return Math.round(base * (1 + (Math.random() * 2 - 1) * JITTER));
    }

    function scheduleRetry() {
      if (stopped || retryTimer) return;
      var delay = retryDelay();
      attempts += 1;
      retryTimer = setTimeout(function () {
        retryTimer = null;
        open();
      }, delay);
    }

    function send(tag, seq, payload) {
      if (!socket || socket.readyState !== 1) return false;
      try {
        socket.send(encodeFrame(tag, seq, payload));
        return true;
      } catch (err) {
        return false;
      }
    }

    function sendText(message) {
      if (!socket || socket.readyState !== 1) return false;
      try {
        socket.send(JSON.stringify(message));
        return true;
      } catch (err) {
        return false;
      }
    }

    function handleText(data) {
      var message;
      try {
        message = JSON.parse(data);
      } catch (err) {
        return; // a control frame we cannot read is not worth dropping the link
      }
      if (!message || typeof message.t !== 'string') return;

      if (message.t === 'ready') {
        setStatus('connected');
        // `canSeed` is the relay's answer to "may I seed this empty room?".
        // An older relay omits it; treat that as permission so a mixed-version
        // deployment still bootstraps rather than sitting on an empty board.
        onReady({ canSeed: message.canSeed !== false });
        return;
      }
      if (message.t === 'peers') {
        onPeers(typeof message.n === 'number' ? message.n : 0);
        return;
      }
      if (message.t === 'compact') {
        var full = snapshot();
        if (full && full.length > 0) send(TAG_SNAPSHOT, lastSeq, full);
      }
    }

    function handleBinary(buffer) {
      var bytes = new Uint8Array(buffer);
      if (bytes.length < HEADER_BYTES) return;
      var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      var tag = bytes[0];
      var seq = view.getUint32(1, false);
      if (tag !== TAG_UPDATE) return;
      if (seq > lastSeq) lastSeq = seq;
      onUpdate(bytes.subarray(HEADER_BYTES));
    }

    function open() {
      if (stopped || socket) return;
      setStatus('connecting');

      var ws;
      try {
        ws = new window.WebSocket(endpoint());
      } catch (err) {
        setStatus('error');
        scheduleRetry();
        return;
      }
      ws.binaryType = 'arraybuffer';
      socket = ws;

      ws.onmessage = function (event) {
        if (typeof event.data === 'string') handleText(event.data);
        else handleBinary(event.data);
      };
      ws.onopen = function () {
        attempts = 0; // the next failure starts its backoff from scratch
      };
      ws.onerror = function () {
        setStatus('error');
      };
      ws.onclose = function () {
        if (socket !== ws) return;
        socket = null;
        // The relay may have restarted or compacted while we were away, so the
        // next `ready` has to be treated as a fresh sync.
        lastSeq = 0;
        if (stopped) {
          setStatus('offline');
          return;
        }
        setStatus('connecting');
        scheduleRetry();
      };
    }

    function push(update) {
      if (!update || update.length === 0) return false;
      return send(TAG_UPDATE, 0, update);
    }

    // "The document I was granted the right to seed is now on the wire."
    // Must follow the push that carried it — the relay releases the peers it
    // is holding on this frame and nothing else.
    function seeded() {
      return sendText({ t: 'seeded' });
    }

    function close() {
      stopped = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      var ws = socket;
      socket = null;
      if (ws) {
        try {
          ws.close();
        } catch (err) {
          // Already closing; its handlers no longer matter.
        }
      }
      setStatus('offline');
    }

    open();

    return {
      push: push,
      seeded: seeded,
      close: close,
      room: function () { return room; },
      status: function () { return status; }
    };
  }

  KB.SyncProvider = {
    create: create,
    TAG_UPDATE: TAG_UPDATE,
    TAG_SNAPSHOT: TAG_SNAPSHOT,
    encodeFrame: encodeFrame
  };
})(window.KB = window.KB || {});
