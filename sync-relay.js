// Optional CRDT sync relay. Attaches to the static server's HTTP listener and
// fans Yjs updates out between the browsers in a room. Off unless
// KB_SYNC_RELAY=1 (npm run serve:sync) — the app is local-first and must keep
// working with no network, no accounts, and no backend.
//
// WHY IT IS DUMB: the relay never parses a Yjs update. It stores opaque bytes
// and forwards them. That keeps serve.js dependency-free (vendor/yjs.js is an
// IIFE browser bundle, not a Node module) and means a change in the binding
// needs no server change. Yjs updates are commutative and idempotent, so blind
// fanout plus replay of a retained log is a correct sync.
//
// WHY IT IS NOT A DATABASE: the log lives in memory and dies with the process.
// Every peer keeps a full local copy in IndexedDB; the relay is a courier, not
// a source of truth. Losing it costs nothing but a reconnect.
//
// WHY THE WEBSOCKET IS HAND-ROLLED: `ws` would be the project's first runtime
// dependency, and this is ~200 lines of RFC 6455 for a localhost courier.
'use strict';

const crypto = require('crypto');

const GUID = '258EAFA5-E914-47DA-95CA-5AB0DC85B39A';
const PATH = '/sync';

// Opcodes.
const CONTINUATION = 0x0;
const TEXT = 0x1;
const BINARY = 0x2;
const CLOSE = 0x8;
const PING = 0x9;
const PONG = 0xa;

// Application frame tags, first byte of every binary message.
const TAG_UPDATE = 1;
const TAG_SNAPSHOT = 2;

const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const MAX_ROOMS = 64;
const MAX_CLIENTS_PER_ROOM = 16;
const MAX_ROOM_ID = 64;
// Compaction thresholds: past either one the relay asks a peer for a snapshot
// that replaces the history it is holding.
const MAX_LOG_BYTES = 4 * 1024 * 1024;
const MAX_LOG_ENTRIES = 512;
const COMPACT_TIMEOUT_MS = 10000;
const HEARTBEAT_MS = 30000;

// ---- RFC 6455 --------------------------------------------------------------

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

function frame(opcode, payload) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(length, 6);
  }
  header[0] = 0x80 | opcode; // FIN, no RSV, no extensions negotiated
  return Buffer.concat([header, payload]);
}

// A single upgraded socket. Owns framing and nothing else: room membership and
// the update log live in the relay below.
function connection(socket, onMessage, onClose) {
  let buffered = Buffer.alloc(0);
  let fragments = [];
  let fragmentOpcode = 0;
  let fragmentBytes = 0;
  let closed = false;
  let alive = true;

  function destroy(code) {
    if (closed) return;
    closed = true;
    try {
      if (typeof code === 'number') {
        const reason = Buffer.alloc(2);
        reason.writeUInt16BE(code, 0);
        socket.write(frame(CLOSE, reason));
      }
    } catch (err) {
      // The peer is already gone; nothing left to say.
    }
    socket.destroy();
    onClose();
  }

  function send(opcode, payload) {
    if (closed || socket.destroyed) return;
    try {
      socket.write(frame(opcode, payload));
    } catch (err) {
      destroy();
    }
  }

  function handleFrame(fin, opcode, payload) {
    if (opcode === CLOSE) {
      destroy(1000);
      return;
    }
    if (opcode === PING) {
      send(PONG, payload);
      return;
    }
    if (opcode === PONG) {
      alive = true;
      return;
    }

    if (opcode === TEXT || opcode === BINARY) {
      if (fragments.length > 0) {
        destroy(1002); // a new data frame mid-fragment is a protocol error
        return;
      }
      if (fin) {
        onMessage(opcode, payload);
        return;
      }
      fragmentOpcode = opcode;
      fragments = [payload];
      fragmentBytes = payload.length;
      return;
    }

    if (opcode === CONTINUATION) {
      if (fragments.length === 0) {
        destroy(1002);
        return;
      }
      fragmentBytes += payload.length;
      if (fragmentBytes > MAX_MESSAGE_BYTES) {
        destroy(1009);
        return;
      }
      fragments.push(payload);
      if (!fin) return;
      const message = Buffer.concat(fragments);
      fragments = [];
      fragmentBytes = 0;
      onMessage(fragmentOpcode, message);
      return;
    }

    destroy(1002); // reserved opcode
  }

  socket.on('data', (chunk) => {
    if (closed) return;
    buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk]);

    for (;;) {
      if (buffered.length < 2) return;
      if ((buffered[0] & 0x70) !== 0) { destroy(1002); return; } // RSV set
      const fin = (buffered[0] & 0x80) !== 0;
      const opcode = buffered[0] & 0x0f;
      const masked = (buffered[1] & 0x80) !== 0;
      let length = buffered[1] & 0x7f;
      let offset = 2;

      if (opcode >= 0x8 && (!fin || length > 125)) { destroy(1002); return; }

      if (length === 126) {
        if (buffered.length < 4) return;
        length = buffered.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffered.length < 10) return;
        // Anything needing the high word is far past the size cap already.
        if (buffered.readUInt32BE(2) !== 0) { destroy(1009); return; }
        length = buffered.readUInt32BE(6);
        offset = 10;
      }

      // Clients must mask; an unmasked client frame is a protocol violation.
      if (!masked) { destroy(1002); return; }
      if (length > MAX_MESSAGE_BYTES) { destroy(1009); return; }
      if (buffered.length < offset + 4 + length) return;

      const mask = buffered.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.from(buffered.subarray(offset, offset + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buffered = buffered.subarray(offset + length);

      handleFrame(fin, opcode, payload);
      if (closed) return;
    }
  });

  socket.on('error', () => destroy());
  // 'end' matters as much as 'close' here: http.Server hands over upgraded
  // sockets half-open, so a peer that goes away leaves this side writeOnly and
  // undestroyed — 'close' never fires and the room would keep a ghost member.
  socket.on('end', () => destroy());
  socket.on('close', () => {
    if (closed) return;
    closed = true;
    onClose();
  });

  return {
    sendBinary: (payload) => send(BINARY, payload),
    sendText: (text) => send(TEXT, Buffer.from(text, 'utf8')),
    ping: () => {
      if (!alive) { destroy(1001); return; }
      alive = false;
      send(PING, Buffer.alloc(0));
    },
    close: destroy,
    isClosed: () => closed
  };
}

// ---- Relay -----------------------------------------------------------------

function tagged(tag, seq, payload) {
  const header = Buffer.alloc(5);
  header[0] = tag;
  header.writeUInt32BE(seq >>> 0, 1);
  return Buffer.concat([header, payload]);
}

function attach(server, options) {
  const settings = options || {};
  const log = settings.log || function () {};
  // Same-origin by default: an open relay would let any page the user visits
  // connect and read their board. `origins` overrides for real setups.
  const allowedOrigins = settings.origins || [];
  const rooms = new Map();

  function room(id) {
    let entry = rooms.get(id);
    if (!entry) {
      entry = { id: id, clients: new Set(), updates: [], bytes: 0, seq: 0, compacting: null };
      rooms.set(id, entry);
    }
    return entry;
  }

  function broadcast(entry, payload, except) {
    entry.clients.forEach((client) => {
      if (client === except) return;
      client.socket.sendBinary(payload);
    });
  }

  function announce(entry) {
    const text = JSON.stringify({ t: 'peers', n: entry.clients.size });
    entry.clients.forEach((client) => client.socket.sendText(text));
  }

  // Ask one peer for a snapshot that stands in for the history so far. The
  // reply carries the highest seq that peer had applied, so updates the relay
  // accepted after the snapshot was taken are kept rather than dropped — the
  // difference between bounded memory and silently losing an edit.
  function maybeCompact(entry) {
    if (entry.compacting || entry.clients.size === 0) return;
    if (entry.bytes <= MAX_LOG_BYTES && entry.updates.length <= MAX_LOG_ENTRIES) return;

    const donor = entry.clients.values().next().value;
    entry.compacting = {
      donor: donor,
      timer: setTimeout(() => {
        entry.compacting = null; // the donor never answered; retry on the next update
      }, COMPACT_TIMEOUT_MS)
    };
    if (entry.compacting.timer.unref) entry.compacting.timer.unref();
    donor.socket.sendText(JSON.stringify({ t: 'compact' }));
  }

  function acceptSnapshot(entry, client, ack, update) {
    if (!entry.compacting || entry.compacting.donor !== client) return;
    clearTimeout(entry.compacting.timer);
    entry.compacting = null;

    const retained = entry.updates.filter((item) => item.seq > ack);
    entry.seq += 1;
    const snapshot = { seq: entry.seq, frame: tagged(TAG_UPDATE, entry.seq, update) };
    // The snapshot replays first so a joiner's later updates build on it.
    entry.updates = [snapshot].concat(retained);
    entry.bytes = entry.updates.reduce((sum, item) => sum + item.frame.length, 0);
    log('sync: room ' + entry.id + ' compacted to ' + entry.updates.length + ' entries');
  }

  function record(entry, update) {
    entry.seq += 1;
    const payload = tagged(TAG_UPDATE, entry.seq, update);
    entry.updates.push({ seq: entry.seq, frame: payload });
    entry.bytes += payload.length;
    return payload;
  }

  function join(entry, client) {
    // Decide seeding rights BEFORE adding this client, so exactly one member
    // of an empty room may seed it.
    //
    // Without this, two cold peers can both be told `ready` while the room is
    // still empty and both seed. Their boards are Y.Arrays of Y.Maps, so
    // matching application-level ids do NOT make them the same CRDT items:
    // merging the two documents yields duplicate boards/columns/cards sharing
    // one id, which lookups and toState() then disagree about.
    const canSeed = entry.updates.length === 0 && entry.clients.size === 0;

    entry.clients.add(client);
    // Replay before `ready`: the client uses that marker to decide whether the
    // room is empty (seed my board) or already has a document (adopt it).
    entry.updates.forEach((item) => client.socket.sendBinary(item.frame));
    client.socket.sendText(JSON.stringify({ t: 'ready', canSeed: canSeed }));
    announce(entry);
  }

  function leave(entry, client) {
    entry.clients.delete(client);
    if (entry.compacting && entry.compacting.donor === client) {
      clearTimeout(entry.compacting.timer);
      entry.compacting = null;
    }
    if (entry.clients.size === 0) {
      // Nobody left to serve, and every peer holds the document locally.
      rooms.delete(entry.id);
      return;
    }
    announce(entry);
  }

  function reject(socket, status, message) {
    socket.write('HTTP/1.1 ' + status + ' ' + message + '\r\n' +
      'Connection: close\r\n' +
      'Content-Length: 0\r\n\r\n');
    socket.destroy();
  }

  function originAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return true; // non-browser client; no ambient authority to abuse
    if (allowedOrigins.indexOf(origin) !== -1) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch (err) {
      return false;
    }
  }

  server.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch (err) {
      reject(socket, 400, 'Bad Request');
      return;
    }
    if (url.pathname !== PATH) {
      reject(socket, 404, 'Not Found');
      return;
    }
    if ((req.headers.upgrade || '').toLowerCase() !== 'websocket' ||
        req.headers['sec-websocket-version'] !== '13' ||
        !req.headers['sec-websocket-key']) {
      reject(socket, 400, 'Bad Request');
      return;
    }
    if (!originAllowed(req)) {
      reject(socket, 403, 'Forbidden');
      return;
    }

    const roomId = (url.searchParams.get('room') || '').trim();
    if (!roomId || roomId.length > MAX_ROOM_ID || !/^[\w.-]+$/.test(roomId)) {
      reject(socket, 400, 'Bad Request');
      return;
    }
    if (!rooms.has(roomId) && rooms.size >= MAX_ROOMS) {
      reject(socket, 503, 'Service Unavailable');
      return;
    }
    const entry = room(roomId);
    if (entry.clients.size >= MAX_CLIENTS_PER_ROOM) {
      reject(socket, 503, 'Service Unavailable');
      return;
    }

    socket.setNoDelay(true);
    socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + acceptKey(req.headers['sec-websocket-key']) + '\r\n\r\n');
    if (head && head.length > 0) socket.unshift(head);

    const client = { socket: null, heartbeat: null };
    client.socket = connection(
      socket,
      (opcode, payload) => {
        if (opcode !== BINARY || payload.length < 5) return; // text from a client is unused
        const tag = payload[0];
        const seq = payload.readUInt32BE(1);
        const body = payload.subarray(5);
        if (tag === TAG_UPDATE) {
          broadcast(entry, record(entry, body), client);
          maybeCompact(entry);
          return;
        }
        if (tag === TAG_SNAPSHOT) {
          acceptSnapshot(entry, client, seq, body);
        }
      },
      () => {
        clearInterval(client.heartbeat);
        leave(entry, client);
        log('sync: client left room ' + roomId + ' (' + entry.clients.size + ' remaining)');
      }
    );
    client.heartbeat = setInterval(() => client.socket.ping(), HEARTBEAT_MS);
    if (client.heartbeat.unref) client.heartbeat.unref();

    join(entry, client);
    log('sync: client joined room ' + roomId + ' (' + entry.clients.size + ' total)');
  });

  return {
    rooms: () => rooms.size,
    peers: (id) => (rooms.has(id) ? rooms.get(id).clients.size : 0),
    close: () => {
      rooms.forEach((entry) => {
        entry.clients.forEach((client) => client.socket.close(1001));
      });
      rooms.clear();
    }
  };
}

module.exports = {
  attach: attach,
  PATH: PATH,
  TAG_UPDATE: TAG_UPDATE,
  TAG_SNAPSHOT: TAG_SNAPSHOT
};
