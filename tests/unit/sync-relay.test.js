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
    canSeed: null,
    peers: 0,
    compacts: 0,
    lastSeq: 0,
    // True between "the relay granted me the seeding right" and "I told it the
    // document is on the wire" — js/sync-session.js keeps the same flag.
    holdsSeedingRight: false,
    push: (update) => client.send(BINARY, tagged(TAG_UPDATE, 0, update)),
    declareSeeded: () => client.send(TEXT, Buffer.from(JSON.stringify({ t: 'seeded' }), 'utf8')),
    close: () => client.close()
  };

  // The relay cannot read a Yjs update, and an encoded empty Y.Doc is two
  // ordinary bytes, so publishing a document is not the same as saying one
  // exists. Say it — after the push that carried it.
  function declareIfSeeding() {
    if (!peer.holdsSeedingRight || binding.isEmpty()) return;
    peer.holdsSeedingRight = false;
    peer.declareSeeded();
  }

  binding.onLocalUpdate((update) => {
    peer.push(update);
    declareIfSeeding();
  });

  // Publish this peer's whole document and, if it is holding the seeding
  // right, bootstrap the room with it. What sync-session does on `ready`.
  peer.publish = () => {
    peer.push(binding.encodeState());
    declareIfSeeding();
  };

  client.setHandler((opcode, payload) => {
    if (opcode === TEXT) {
      const message = JSON.parse(payload.toString('utf8'));
      if (message.t === 'ready') {
        peer.ready = true;
        peer.canSeed = message.canSeed;
        if (message.canSeed) peer.holdsSeedingRight = true;
      }
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

// Regression: two cold peers could both be told the room was empty and both
// seed it. Their boards are Y.Arrays of Y.Maps, so matching application ids do
// NOT make them the same CRDT items — merging two seeded documents yields
// duplicate boards/columns/cards sharing one id. The relay now hands out the
// seeding right to exactly one member of an empty room.
test('only one peer of an empty room is granted the seeding right', async () => {
  const server = await startServer();
  const a = await connect(server.port, 'seed-race');
  const b = await connect(server.port, 'seed-race');
  await waitFor(() => a.ready, 'the first peer is ready');
  await wait(50);

  assert.equal(a.canSeed, true, 'the first peer to join is the seeder');
  assert.equal(b.ready, false, 'the second peer is held until a document exists');

  a.binding.seed(boardState('Seeded', ['x']));
  await waitFor(() => b.ready, 'the second peer is released once the room is seeded');
  assert.equal(b.canSeed, false, 'the released peer must adopt, not seed');

  a.close();
  b.close();
  await server.close();
});

// Regression: `ready` used to mean only "the history replay has ended", so a
// second cold peer was told to adopt a room that held nothing yet. It applied
// the ops it had buffered during the connect window against an empty document
// — where an op naming a card the document does not have is silently dropped
// — and then the real seed landed on top. The edit vanished with no error.
// `ready` now means "there is a document you may safely edit".
test('an edit made while waiting for the seed survives', async () => {
  const server = await startServer();
  const a = await connect(server.port, 'boot-race');
  await waitFor(() => a.ready, 'the seeder is ready');

  const b = await connect(server.port, 'boot-race');
  await wait(50);
  assert.equal(b.ready, false, 'B must not be told to adopt an unseeded room');

  // B edits a card it already holds locally while it waits. This is exactly
  // the op that used to be lost.
  const base = boardState('Board', ['x']);
  const edited = boardState('Board', ['x']);
  edited.boards[0].columns[0].cards[0].title = "B's edit";
  const buffered = StateDiff.diff(base, edited);
  assert.equal(buffered.length, 1, 'the edit produces one card.set op');
  assert.equal(buffered[0].type, 'card.set');

  a.binding.seed(base);
  await waitFor(() => b.ready, 'B is released once the room has a document');
  assert.equal(b.canSeed, false);
  assert.equal(titles(b).length, 1, 'B holds the seed before it is released');

  // sync-session replays the buffer on top of the adopted document.
  b.binding.applyOps(buffered);
  await waitFor(() => titles(a)[0] === "B's edit", "A receives B's buffered edit");
  assert.deepEqual(titles(b), ["B's edit"], 'and B kept it too');

  a.close();
  b.close();
  await server.close();
});

// The handshake is only as strong as the rule that bootstraps a room. Whatever
// makes the room seeded releases everyone waiting on it, so a peer that ignores
// the handshake must not be able to trigger it — by writing, by sending nothing
// at all, or by simply claiming the room is seeded.
test('a held peer cannot seed the room it is waiting on', async () => {
  const server = await startServer();
  const a = await connect(server.port, 'held-seed');
  await waitFor(() => a.ready, 'the seeder is ready');

  const b = await connect(server.port, 'held-seed');
  await wait(50);
  assert.equal(b.ready, false, 'B is held behind A');

  b.push(new Uint8Array([1, 2, 3])); // never told `ready`, pushes anyway
  b.push(new Uint8Array(0)); // and a frame with no body at all
  b.declareSeeded(); // and claims the bootstrap it never performed
  await wait(80);
  assert.equal(b.ready, false, 'none of it made the room look seeded');
  assert.equal(a.binding.isEmpty(), true, 'and none of it reached the seeder');

  // The genuine seed still works and releases B.
  a.binding.seed(boardState('Seeded', ['x']));
  await waitFor(() => b.ready, 'B is released by the real seed');
  assert.deepEqual(titles(b), ['Card x'], 'B holds the seeder document');

  a.close();
  b.close();
  await server.close();
});

// Regression: the relay used to infer "this room has a document" from the log
// being non-empty. It cannot — it never parses a Yjs update, and an encoded
// EMPTY Y.Doc is two perfectly ordinary bytes. A seeder that published one
// would have spent the seeding right and released every held peer onto a
// document that does not exist, which is the original bootstrap bug wearing a
// different hat. Only the explicit declaration releases the room now.
test('publishing an empty document does not bootstrap the room', async () => {
  const server = await startServer();
  const a = await connect(server.port, 'empty-seed');
  await waitFor(() => a.ready, 'A holds the seeding right');

  const b = await connect(server.port, 'empty-seed');
  await wait(50);
  assert.equal(b.ready, false, 'B waits behind A');

  const empty = Y.encodeStateAsUpdate(new Y.Doc());
  assert.ok(empty.length > 0, 'an empty Y.Doc still encodes to real bytes');
  a.push(empty);
  await wait(80);
  assert.equal(b.ready, false, 'B is not released by a document with nothing in it');

  // A real seed from the same peer still works.
  a.binding.seed(boardState('Real', ['x']));
  await waitFor(() => b.ready, 'B is released by the real seed');
  assert.deepEqual(titles(b), ['Card x']);

  a.close();
  b.close();
  await server.close();
});

// A bootstrap the seeder never finished must leave nothing behind: a held peer
// that had already applied half of it would carry that fragment into whatever
// it seeds next, as a second lineage of the same ids.
test('an abandoned bootstrap leaves nothing in the room', async () => {
  const server = await startServer();
  const a = await connect(server.port, 'abandoned');
  await waitFor(() => a.ready, 'A holds the seeding right');

  const b = await connect(server.port, 'abandoned');
  await wait(50);
  assert.equal(b.ready, false, 'B waits behind A');

  // A publishes a document but dies before declaring the bootstrap complete.
  a.holdsSeedingRight = false; // suppress the declaration, not the publish
  a.binding.seed(boardState('Half a board', ['x']));
  await wait(50);
  a.close();

  await waitFor(() => b.ready, 'B is promoted');
  assert.equal(b.canSeed, true, 'B inherits the seeding right');
  assert.equal(b.binding.isEmpty(), true, 'and none of the abandoned bootstrap reached it');

  b.binding.seed(boardState('B board', ['y']));
  const c = await connect(server.port, 'abandoned');
  await waitFor(() => c.ready, 'a later joiner is ready');
  await waitFor(() => c.binding.toState().boards.length === 1, 'C adopts one board');
  assert.equal(c.binding.toState().boards.length, 1, 'exactly one lineage survives');

  b.close();
  c.close();
  await server.close();
});

test('the seeding right moves on when the seeder leaves before seeding', async () => {
  const server = await startServer();
  const a = await connect(server.port, 'seeder-drops');
  await waitFor(() => a.ready, 'the first peer holds the right');
  assert.equal(a.canSeed, true);

  const b = await connect(server.port, 'seeder-drops');
  await wait(50);
  assert.equal(b.ready, false, 'B waits behind A');

  a.close(); // A leaves without ever publishing a document
  await waitFor(() => b.ready, 'B is promoted to seeder');
  assert.equal(b.canSeed, true, 'B inherits the right rather than waiting forever');

  b.binding.seed(boardState('B board', ['y']));
  const c = await connect(server.port, 'seeder-drops');
  await waitFor(() => c.ready, 'a later joiner is ready');
  assert.equal(c.canSeed, false, 'the room is seeded now');
  await waitFor(() => titles(c).length === 1, 'and it adopts the promoted seed');

  b.close();
  c.close();
  await server.close();
});

test('three peers joining a cold room produce exactly one board', async () => {
  const server = await startServer();
  const peers = await Promise.all([
    connect(server.port, 'cold-start'),
    connect(server.port, 'cold-start'),
    connect(server.port, 'cold-start')
  ]);

  await waitFor(() => peers.some((p) => p.canSeed === true), 'a seeder is chosen');
  await wait(50);
  const seeders = peers.filter((p) => p.canSeed === true);
  assert.equal(seeders.length, 1, 'exactly one peer may seed a cold room');
  assert.equal(peers.filter((p) => p.ready).length, 1, 'the other two are held');

  seeders[0].binding.seed(boardState('Cold', ['z']));
  await waitFor(() => peers.every((p) => p.ready), 'all three released');
  await waitFor(
    () => peers.every((p) => p.binding.toState().boards.length === 1),
    'all three converge'
  );

  peers.forEach((p, i) => {
    const state = p.binding.toState();
    assert.equal(state.boards.length, 1, 'peer ' + i + ' has one board');
    assert.equal(state.boards[0].columns.length, 2, 'peer ' + i + ' has one column tree');
    assert.equal(state.boards[0].columns[0].cards.length, 1, 'peer ' + i + ' has one card');
  });

  peers.forEach((p) => p.close());
  await server.close();
});

// Regression: the relay's log dies with the process, and the docs said that
// cost nothing because reconnecting peers repopulate it. That is only true if
// they rejoin with the SAME document. A device that reloaded and rebuilt its
// Y.Doc from the plain snapshot in IndexedDB does not: Yjs identity is
// (clientId, clock), not `board.id`, so its board is a second lineage and the
// peer that never reloaded merges it as a second board carrying the same id.
// js/sync-docs.js persists the encoded document so the reload restores it.
test('a reloaded peer reseeding a restarted relay does not fork the board', async () => {
  const first = await startServer();
  const a = await connect(first.port, 'restart');
  await waitFor(() => a.ready, 'A holds the seeding right');
  a.binding.seed(boardState('Work', ['k1']));

  const b = await connect(first.port, 'restart');
  await waitFor(() => b.ready, 'B is released once the room is seeded');
  await waitFor(() => b.binding.toState().boards.length === 1, 'B adopts the board');

  // What a reload keeps: the plain state (KB.Storage) and, since this fix, the
  // encoded document itself (KB.SyncDocs).
  const savedState = a.binding.toState();
  const savedDoc = a.binding.encodeState();
  a.close();
  await first.close(); // the relay process dies, taking its log with it

  // A reloads. Its Y.Doc is gone; it restores the persisted one rather than
  // rebuilding from savedState, which is the whole point.
  const second = await startServer();
  const a2 = await connect(second.port, 'restart');
  a2.binding.restore(savedDoc);
  assert.deepEqual(a2.binding.toState(), savedState, 'the restored document is the same board');

  await waitFor(() => a2.ready, 'A2 is asked to seed the empty relay');
  assert.equal(a2.canSeed, true, 'the restarted relay holds no document');
  a2.publish();

  // B never reloaded, so it still holds the original lineage.
  const b2 = await connect(second.port, 'restart');
  await waitFor(() => b2.ready, 'B reconnects');
  b2.binding.restore(b.binding.encodeState());
  b2.publish();

  await waitFor(() => a2.binding.toState().boards.length > 0, 'the two documents meet');
  await wait(80);

  const merged = a2.binding.toState();
  assert.equal(merged.boards.length, 1, 'one board, not two lineages of one board');
  assert.equal(merged.boards[0].columns.length, 2, 'one column tree');
  assert.equal(merged.boards[0].columns[0].cards.length, 1, 'one card');
  assert.deepEqual(b2.binding.toState().boards.length, 1, 'and the peer that never reloaded agrees');

  a2.close();
  b2.close();
  b.close();
  await second.close();
});

test('a peer joining a room that already has a document may not seed', async () => {
  const server = await startServer();
  const a = await connect(server.port, 'seed-populated');
  await waitFor(() => a.ready, 'first peer ready');
  a.binding.seed(boardState('Seeded', ['x']));
  await wait(50);

  const b = await connect(server.port, 'seed-populated');
  await waitFor(() => b.ready, 'second peer ready');
  assert.equal(b.canSeed, false, 'a populated room grants no seeding right');
  await waitFor(() => titles(b).length === 1, 'second peer adopts the document');

  a.close();
  b.close();
  await server.close();
});

test('two peers converge through the relay', async () => {
  const server = await startServer();
  const a = await connect(server.port, 'room-a');
  const b = await connect(server.port, 'room-a');

  // A is first in the room, so its board becomes the document. B is held at
  // the handshake until that document exists — `ready` means "there is
  // something here you may safely edit".
  await waitFor(() => a.ready, 'the seeder is ready');
  a.binding.seed(boardState('Work', ['k1', 'k2']));
  await waitFor(() => b.ready, 'B is released once the room is seeded');
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
  await waitFor(() => a.ready, 'the seeder is ready');

  a.binding.seed(boardState('Work', ['k1']));
  await waitFor(() => a.ready && b.ready, 'both ready once the room is seeded');
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
