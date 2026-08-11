const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');
const Y = require('yjs');
const relay = require('../../sync-relay.js');
const YDoc = require('../../js/core/ydoc.js');
const StateDiff = require('../../js/core/statediff.js');

// End-to-end over a real socket: the relay's RFC 6455 framing, the tagged
// application protocol, and the Y.Doc binding in one path.
//
// The client is hand-rolled rather than Node's built-in WebSocket, which
// cannot be used here: it always requests permessage-deflate and then throws a
// TypeError inside its own failure path when a server declines the extension,
// closing with 1006. A minimal textbook handshake server fails it the same
// way, so it is the client that is strict, not this relay. Masking every
// client frame the way a browser does is the part that matters for coverage.

const GUID = '258EAFA5-E914-47DA-95CA-5AB0DC85B39A';
const TAG_UPDATE = relay.TAG_UPDATE;
const TAG_SNAPSHOT = relay.TAG_SNAPSHOT;
const HEADER_BYTES = 5;

const TEXT = 0x1;
const BINARY = 0x2;
const CLOSE = 0x8;
const PING = 0x9;
const PONG = 0xa;

// ---- a minimal masking WebSocket client ------------------------------------

function clientFrame(opcode, payload) {
  const mask = crypto.randomBytes(4);
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(length, 6);
  }
  header[0] = 0x80 | opcode;
  const body = Buffer.from(payload);
  for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
  return Buffer.concat([header, mask, body]);
}

// Resolves once the handshake completes; rejects with the HTTP status the
// relay refused with, which is what the rejection tests assert on.
function openSocket(port, path) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    const socket = net.connect(port, '127.0.0.1');
    let handshake = Buffer.alloc(0);
    let upgraded = false;
    // The relay writes `ready` and `peers` into the same TCP segment as the
    // handshake response, so those frames are parsed before the caller has had
    // a chance to attach a handler. Queue them rather than lose them.
    const pending = [];
    const client = { socket: socket, handler: null };

    function consumeFrames(buffer) {
      let rest = buffer;
      for (;;) {
        if (rest.length < 2) return rest;
        const fin = (rest[0] & 0x80) !== 0;
        const opcode = rest[0] & 0x0f;
        let length = rest[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (rest.length < 4) return rest;
          length = rest.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (rest.length < 10) return rest;
          length = rest.readUInt32BE(6);
          offset = 10;
        }
        // The server must never mask; catching it here would be a real defect.
        assert.equal((rest[1] & 0x80) === 0, true, 'server frames must be unmasked');
        assert.equal(fin, true, 'the relay never fragments');
        if (rest.length < offset + length) return rest;
        const payload = rest.subarray(offset, offset + length);
        rest = rest.subarray(offset + length);
        if (opcode === PING) {
          socket.write(clientFrame(PONG, payload));
        } else if (opcode !== CLOSE && opcode !== PONG) {
          const copy = Buffer.from(payload);
          if (client.handler) client.handler(opcode, copy);
          else pending.push([opcode, copy]);
        }
      }
    }

    socket.on('connect', () => {
      socket.write(
        'GET ' + path + ' HTTP/1.1\r\n' +
        'Host: 127.0.0.1:' + port + '\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + key + '\r\n' +
        'Sec-WebSocket-Version: 13\r\n\r\n'
      );
    });

    socket.on('data', (chunk) => {
      if (upgraded) {
        handshake = consumeFrames(Buffer.concat([handshake, chunk]));
        return;
      }
      handshake = Buffer.concat([handshake, chunk]);
      const end = handshake.indexOf('\r\n\r\n');
      if (end === -1) return;

      const head = handshake.subarray(0, end).toString('latin1');
      if (head.indexOf('HTTP/1.1 101') !== 0) {
        socket.destroy();
        reject(new Error(head.split('\r\n')[0]));
        return;
      }
      assert.ok(
        head.indexOf('Sec-WebSocket-Accept: ' + accept) !== -1,
        'the relay must return the RFC 6455 accept token'
      );
      upgraded = true;
      handshake = handshake.subarray(end + 4);
      resolve(client);
      handshake = consumeFrames(handshake);
    });

    socket.on('error', (err) => reject(err));
    client.send = (opcode, payload) => socket.write(clientFrame(opcode, payload));
    client.close = () => socket.destroy();
    client.setHandler = (fn) => {
      client.handler = fn;
      while (pending.length > 0) {
        const queued = pending.shift();
        fn(queued[0], queued[1]);
      }
    };
  });
}

// ---- test peers ------------------------------------------------------------

function tagged(tag, seq, payload) {
  const out = Buffer.alloc(HEADER_BYTES + payload.length);
  out[0] = tag;
  out.writeUInt32BE(seq >>> 0, 1);
  Buffer.from(payload).copy(out, HEADER_BYTES);
  return out;
}

function startServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(404);
    res.end();
  });
  const handle = relay.attach(server, {});
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        handle: handle,
        close: () => new Promise((done) => {
          handle.close();
          server.close(() => done());
        })
      });
    });
  });
}

// The Y.Doc binding wired to a socket, mirroring what js/sync-provider.js and
// js/sync-session.js do in the browser.
async function connect(port, room) {
  const binding = YDoc.create({ Y });
  const client = await openSocket(port, '/sync?room=' + room);

  const peer = {
    binding: binding,
    ready: false,
    peers: 0,
    compacts: 0,
    lastSeq: 0,
    push: (update) => client.send(BINARY, tagged(TAG_UPDATE, 0, update)),
    close: () => client.close()
  };

  binding.onLocalUpdate((update) => peer.push(update));

  client.setHandler((opcode, payload) => {
    if (opcode === TEXT) {
      const message = JSON.parse(payload.toString('utf8'));
      if (message.t === 'ready') peer.ready = true;
      if (message.t === 'peers') peer.peers = message.n;
      if (message.t === 'compact') {
        peer.compacts += 1;
        client.send(BINARY, tagged(TAG_SNAPSHOT, peer.lastSeq, binding.encodeState()));
      }
      return;
    }
    if (payload.length < HEADER_BYTES || payload[0] !== TAG_UPDATE) return;
    const seq = payload.readUInt32BE(1);
    if (seq > peer.lastSeq) peer.lastSeq = seq;
    binding.applyUpdate(new Uint8Array(payload.subarray(HEADER_BYTES)));
  });

  return peer;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, message) {
  for (let i = 0; i < 300; i++) {
    if (predicate()) return;
    await wait(10);
  }
  throw new Error('timed out waiting for ' + message);
}

function boardState(name, cards) {
  return {
    version: 3,
    boards: [{
      id: 'b1',
      name: name,
      labels: [],
      archive: { cards: [], columns: [] },
      columns: [
        { id: 'c1', title: 'To Do', cards: cards.map((id) => ({ id: id, title: 'Card ' + id })) },
        { id: 'c2', title: 'Done', cards: [] }
      ]
    }]
  };
}

function titles(peer) {
  return peer.binding.toState().boards[0].columns[0].cards.map((c) => c.title);
}

// ---- tests -----------------------------------------------------------------

test('two peers converge through the relay', async () => {
  const server = await startServer();
  const a = await connect(server.port, 'room-a');
  const b = await connect(server.port, 'room-a');

  await waitFor(() => a.ready && b.ready, 'both peers ready');

  // A is first in the room, so its board becomes the document.
  a.binding.seed(boardState('Work', ['k1', 'k2']));
  await waitFor(() => b.binding.toState().boards.length === 1, 'B receives the seed');
  assert.deepEqual(titles(b), ['Card k1', 'Card k2']);

  // B edits; the change flows back to A.
  const before = b.binding.toState();
  const after = JSON.parse(JSON.stringify(before));
  after.boards[0].columns[0].cards[0].title = 'Edited by B';
  b.binding.applyOps(StateDiff.diff(before, after));

  await waitFor(() => titles(a)[0] === 'Edited by B', 'A receives the edit');
  assert.deepEqual(a.binding.toState(), b.binding.toState(), 'peers converge');

  a.close();
  b.close();
  await server.close();
});

test('concurrent edits from both peers survive the round trip', async () => {
  const server = await startServer();
  const a = await connect(server.port, 'room-concurrent');
  const b = await connect(server.port, 'room-concurrent');
  await waitFor(() => a.ready && b.ready, 'both ready');

  a.binding.seed(boardState('Work', ['k1']));
  await waitFor(() => b.binding.isEmpty() === false, 'B has the board');

  const applyEdit = (peer, mutate) => {
    const before = peer.binding.toState();
    const after = JSON.parse(JSON.stringify(before));
    mutate(after.boards[0].columns[0].cards[0]);
    peer.binding.applyOps(StateDiff.diff(before, after));
  };

  // Different fields of one card, at the same moment, from both devices.
  applyEdit(a, (card) => { card.title = 'From A'; });
  applyEdit(b, (card) => { card.priority = 'high'; });

  await waitFor(
    () => JSON.stringify(a.binding.toState()) === JSON.stringify(b.binding.toState()),
    'peers converge'
  );
  const merged = a.binding.toState().boards[0].columns[0].cards[0];
  assert.equal(merged.title, 'From A');
  assert.equal(merged.priority, 'high');

  a.close();
  b.close();
  await server.close();
});

test('a late joiner is caught up from the room history', async () => {
  const server = await startServer();
  const a = await connect(server.port, 'room-late');
  await waitFor(() => a.ready, 'A ready');

  a.binding.seed(boardState('Work', ['k1']));
  await waitFor(() => server.handle.peers('room-late') === 1, 'A registered');
  await wait(50); // let the seed reach the relay's log

  const c = await connect(server.port, 'room-late');
  await waitFor(() => c.ready, 'C ready');

  // Replay lands before `ready`, which is exactly what lets a joining client
  // tell "empty room, seed my board" from "adopt what is already here".
  assert.equal(c.binding.isEmpty(), false, 'history arrives before ready');
  assert.deepEqual(c.binding.toState(), a.binding.toState());

  a.close();
  c.close();
  await server.close();
});

test('rooms are isolated from each other', async () => {
  const server = await startServer();
  const a = await connect(server.port, 'room-one');
  const b = await connect(server.port, 'room-two');
  await waitFor(() => a.ready && b.ready, 'both ready');

  a.binding.seed(boardState('Private', ['k1']));
  await wait(150); // give a leak every chance to show up

  assert.equal(b.binding.isEmpty(), true, 'nothing crosses between rooms');
  assert.equal(b.peers, 1);

  a.close();
  b.close();
  await server.close();
});

test('peer counts are announced on join and leave', async () => {
  const server = await startServer();
  const a = await connect(server.port, 'room-count');
  await waitFor(() => a.ready, 'A ready');
  assert.equal(a.peers, 1);

  const b = await connect(server.port, 'room-count');
  await waitFor(() => a.peers === 2, 'A sees B join');

  b.close();
  await waitFor(() => a.peers === 1, 'A sees B leave');

  a.close();
  await server.close();
});

test('an empty room is released when the last peer leaves', async () => {
  const server = await startServer();
  const a = await connect(server.port, 'room-gc');
  await waitFor(() => a.ready, 'A ready');
  assert.equal(server.handle.rooms(), 1);

  a.close();
  await waitFor(() => server.handle.rooms() === 0, 'the room is released');

  await server.close();
});

test('an unusable room id is refused before the upgrade', async () => {
  const server = await startServer();

  await assert.rejects(
    () => openSocket(server.port, '/sync?room=not%20a%20room'),
    /400/
  );
  assert.equal(server.handle.rooms(), 0, 'a refused client creates no room');

  await server.close();
});

test('a missing room id is refused', async () => {
  const server = await startServer();
  await assert.rejects(() => openSocket(server.port, '/sync'), /400/);
  await server.close();
});

test('an upgrade on another path is refused', async () => {
  const server = await startServer();
  await assert.rejects(() => openSocket(server.port, '/nope?room=x'), /404/);
  await server.close();
});
