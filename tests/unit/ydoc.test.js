const { test } = require('node:test');
const assert = require('node:assert/strict');
const Y = require('yjs');
const YDoc = require('../../js/core/ydoc.js');
const StateDiff = require('../../js/core/statediff.js');
const Migration = require('../../js/core/migration.js');

const NOW = new Date(2026, 7, 12, 10, 0).getTime();

function uid(prefix) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}
const deps = () => ({ uid: uid('x'), now: () => NOW });

function card(id, overrides) {
  return Object.assign({
    id,
    title: 'Card ' + id,
    description: '',
    due: '',
    when: '',
    priority: 'none',
    size: 'none',
    assignee: '',
    labels: [],
    checklist: [],
    startedAt: null,
    completedAt: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    movedAt: NOW,
    fromColumn: '',
    flow: { state: 'normal', reason: '', since: null, periods: [] },
    dependencies: { blockers: [], related: [] },
    recurrenceId: null,
    effort: { pomodoros: 0, minutes: 0 },
    ping: null,
    transitions: []
  }, overrides || {});
}

function baseState() {
  return Migration.normalizeState({
    version: 3,
    theme: 'dark',
    activeBoardId: 'b1',
    boards: [{
      id: 'b1',
      name: 'Work',
      labels: [{ id: 'l1', name: 'Bug', color: '#c81e14' }],
      columns: [
        { id: 'c1', title: 'To Do', role: 'queue', cards: [card('k1'), card('k2')] },
        { id: 'c2', title: 'Doing', role: 'active', cards: [card('k3')] },
        { id: 'c3', title: 'Done', role: 'done', isDone: true, cards: [] }
      ],
      archive: { cards: [], columns: [] }
    }]
  }, deps());
}

const clone = (s) => JSON.parse(JSON.stringify(s));
const EMPTY = { boards: [] };

function binding(doc) {
  return YDoc.create({ Y, doc });
}

// Device-local keys never enter the document, so every comparison against the
// reference implementation has to drop them from both sides.
function withoutDeviceKeys(state) {
  const out = clone(state);
  YDoc.DEVICE_KEYS.forEach((key) => { delete out[key]; });
  return out;
}

// THE CONTRACT: the Y.Doc binding is observationally equivalent to
// StateDiff.apply. If replaying a batch onto a document materializes anything
// other than what the pure reference implementation produces, the CRDT is
// silently diverging from the app's own model — exactly the class of bug that
// never shows up until two people are editing at once.
function assertMatchesReference(prev, next, message) {
  const ops = StateDiff.diff(prev, next);
  const kb = binding();
  kb.seed(prev);
  kb.applyOps(ops);
  assert.deepEqual(
    kb.toState(),
    withoutDeviceKeys(StateDiff.apply(prev, ops)),
    message
  );
  return ops;
}

// ---- seeding ---------------------------------------------------------------

test('a fresh document is empty and seeds from a snapshot', () => {
  const kb = binding();
  assert.equal(kb.isEmpty(), true);

  const state = baseState();
  kb.seed(state);
  assert.equal(kb.isEmpty(), false);
  assert.deepEqual(
    kb.toState(),
    withoutDeviceKeys(StateDiff.apply(EMPTY, StateDiff.diff(EMPTY, state)))
  );
});

test('seeding preserves board, column and card structure', () => {
  const kb = binding();
  kb.seed(baseState());
  const state = kb.toState();

  assert.equal(state.boards.length, 1);
  assert.equal(state.boards[0].id, 'b1');
  assert.equal(state.boards[0].name, 'Work');
  assert.deepEqual(state.boards[0].columns.map((c) => c.id), ['c1', 'c2', 'c3']);
  assert.deepEqual(state.boards[0].columns[0].cards.map((c) => c.id), ['k1', 'k2']);
  assert.equal(state.boards[0].columns[0].cards[0].title, 'Card k1');
  assert.equal(state.boards[0].columns[2].isDone, true);
});

test('device-local keys stay out of the document', () => {
  const kb = binding();
  kb.seed(baseState());
  const state = kb.toState();

  YDoc.DEVICE_KEYS.forEach((key) => {
    assert.equal(key in state, false, key + ' must not be synchronized');
  });
  // …while the coarse slices that ARE shared still ride along.
  assert.equal(state.version, 3);
});

test('the document hands out copies, so callers cannot corrupt it', () => {
  const kb = binding();
  kb.seed(baseState());

  const first = kb.toState();
  first.boards[0].columns[0].cards[0].labels.push('tampered');
  assert.deepEqual(kb.toState().boards[0].columns[0].cards[0].labels, []);
});

// ---- op replay equivalence -------------------------------------------------

test('editing one card field matches the reference implementation', () => {
  const prev = baseState();
  const next = clone(prev);
  next.boards[0].columns[0].cards[0].title = 'Renamed';
  const ops = assertMatchesReference(prev, next, 'card.set');
  assert.deepEqual(ops.map((o) => o.type), ['card.set']);
});

test('adding a card matches the reference implementation', () => {
  const prev = baseState();
  const next = clone(prev);
  next.boards[0].columns[1].cards.push(card('k9', { title: 'New' }));
  assertMatchesReference(prev, next, 'card.add');
});

test('removing a card matches the reference implementation', () => {
  const prev = baseState();
  const next = clone(prev);
  next.boards[0].columns[0].cards.splice(0, 1);
  assertMatchesReference(prev, next, 'card.remove');
});

test('moving a card across columns matches the reference implementation', () => {
  const prev = baseState();
  const next = clone(prev);
  const moved = next.boards[0].columns[0].cards.splice(0, 1)[0];
  next.boards[0].columns[1].cards.push(moved);
  const ops = assertMatchesReference(prev, next, 'cross-column move');
  assert.ok(ops.some((o) => o.type === 'card.move'));
});

test('reordering cards within a column matches the reference implementation', () => {
  const prev = baseState();
  const next = clone(prev);
  next.boards[0].columns[0].cards.reverse();
  assertMatchesReference(prev, next, 'in-column reorder');
});

test('a moved card is not duplicated in the document', () => {
  const prev = baseState();
  const next = clone(prev);
  const moved = next.boards[0].columns[0].cards.splice(0, 1)[0];
  next.boards[0].columns[1].cards.push(moved);

  const kb = binding();
  kb.seed(prev);
  kb.applyOps(StateDiff.diff(prev, next));

  const ids = kb.toState().boards[0].columns.flatMap((c) => c.cards.map((k) => k.id));
  assert.deepEqual(ids.slice().sort(), ['k1', 'k2', 'k3']);
});

test('column add, edit, remove and reorder match the reference implementation', () => {
  const prev = baseState();

  const added = clone(prev);
  added.boards[0].columns.push({ id: 'c4', title: 'Blocked', role: 'queue', cards: [] });
  assertMatchesReference(prev, added, 'column.add');

  const edited = clone(prev);
  edited.boards[0].columns[0].title = 'Backlog';
  edited.boards[0].columns[0].wipLimit = 4;
  assertMatchesReference(prev, edited, 'column.set');

  const removed = clone(prev);
  removed.boards[0].columns.splice(2, 1);
  assertMatchesReference(prev, removed, 'column.remove');

  const reordered = clone(prev);
  reordered.boards[0].columns.reverse();
  assertMatchesReference(prev, reordered, 'column.order');
});

test('board add, edit, remove and reorder match the reference implementation', () => {
  const prev = baseState();

  const added = clone(prev);
  added.boards.push({
    id: 'b2', name: 'Home', labels: [], columns: [], archive: { cards: [], columns: [] }
  });
  assertMatchesReference(prev, added, 'board.add');

  const edited = clone(prev);
  edited.boards[0].name = 'Work v2';
  assertMatchesReference(prev, edited, 'board.set');

  const two = clone(added);
  const reordered = clone(two);
  reordered.boards.reverse();
  assertMatchesReference(two, reordered, 'board.order');

  const removed = clone(two);
  removed.boards.splice(0, 1);
  assertMatchesReference(two, removed, 'board.remove');
});

test('coarse personal slices ride along as whole values', () => {
  const prev = baseState();
  const next = clone(prev);
  next.inbox = [{ id: 'i1', text: 'Call the bank', createdAt: NOW }];
  const ops = assertMatchesReference(prev, next, 'state.set');
  assert.ok(ops.some((o) => o.type === 'state.set' && o.key === 'inbox'));
});

test('unknown ops from a newer peer are ignored, never fatal', () => {
  const kb = binding();
  kb.seed(baseState());
  const before = kb.toState();
  kb.applyOps([{ type: 'quantum.entangle', cardId: 'k1' }]);
  assert.deepEqual(kb.toState(), before);
});

// ---- merge semantics -------------------------------------------------------

// Exchange every update each document produced. Yjs updates are commutative
// and idempotent, so a full crosswise exchange is a faithful stand-in for a
// relay that fanned them out in any order.
function sync(a, b) {
  Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), YDoc.REMOTE_ORIGIN);
  Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc), YDoc.REMOTE_ORIGIN);
}

function peers() {
  const base = baseState();
  const a = binding();
  a.seed(base);
  const b = binding();
  Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), YDoc.REMOTE_ORIGIN);
  return { base, a, b };
}

test('two peers editing different fields of one card both survive', () => {
  // The reason the CRDT is here at all. A whole-snapshot sync would make the
  // later save silently erase the earlier one.
  const { base, a, b } = peers();

  const editA = clone(base);
  editA.boards[0].columns[0].cards[0].title = 'From A';
  a.applyOps(StateDiff.diff(base, editA));

  const editB = clone(base);
  editB.boards[0].columns[0].cards[0].priority = 'high';
  b.applyOps(StateDiff.diff(base, editB));

  sync(a, b);

  assert.deepEqual(a.toState(), b.toState(), 'peers converge');
  const merged = a.toState().boards[0].columns[0].cards[0];
  assert.equal(merged.title, 'From A');
  assert.equal(merged.priority, 'high');
});

test('two peers adding cards to the same column keep both cards', () => {
  const { base, a, b } = peers();

  const addA = clone(base);
  addA.boards[0].columns[0].cards.push(card('ka', { title: 'From A' }));
  a.applyOps(StateDiff.diff(base, addA));

  const addB = clone(base);
  addB.boards[0].columns[0].cards.push(card('kb', { title: 'From B' }));
  b.applyOps(StateDiff.diff(base, addB));

  sync(a, b);

  assert.deepEqual(a.toState(), b.toState(), 'peers converge');
  const ids = a.toState().boards[0].columns[0].cards.map((c) => c.id);
  assert.deepEqual(ids.slice().sort(), ['k1', 'k2', 'ka', 'kb']);
});

test('two peers moving different cards, both moves land', () => {
  const { base, a, b } = peers();

  const moveA = clone(base);
  moveA.boards[0].columns[1].cards.push(moveA.boards[0].columns[0].cards.splice(0, 1)[0]);
  a.applyOps(StateDiff.diff(base, moveA));

  const moveB = clone(base);
  moveB.boards[0].columns[2].cards.push(moveB.boards[0].columns[0].cards.splice(1, 1)[0]);
  b.applyOps(StateDiff.diff(base, moveB));

  sync(a, b);

  assert.deepEqual(a.toState(), b.toState(), 'peers converge');
  const home = {};
  a.toState().boards[0].columns.forEach((column) => {
    column.cards.forEach((c) => { home[c.id] = column.id; });
  });
  assert.equal(home.k1, 'c2');
  assert.equal(home.k2, 'c3');
  assert.equal(Object.keys(home).length, 3, 'no card is duplicated or lost');
});

test('one peer deleting a card the other edited converges on the delete', () => {
  const { base, a, b } = peers();

  const removed = clone(base);
  removed.boards[0].columns[0].cards.splice(0, 1);
  a.applyOps(StateDiff.diff(base, removed));

  const edited = clone(base);
  edited.boards[0].columns[0].cards[0].title = 'Still editing';
  b.applyOps(StateDiff.diff(base, edited));

  sync(a, b);

  assert.deepEqual(a.toState(), b.toState(), 'peers converge');
  const ids = a.toState().boards[0].columns[0].cards.map((c) => c.id);
  assert.deepEqual(ids, ['k2'], 'a delete beats a concurrent field edit');
});

// ---- transport plumbing ----------------------------------------------------

test('local edits emit updates to relay; remote updates do not echo', () => {
  const a = binding();
  const local = [];
  const remote = [];
  a.onLocalUpdate((update) => local.push(update));
  a.onRemoteUpdate((update) => remote.push(update));

  a.seed(baseState());
  assert.equal(local.length > 0, true, 'a local seed must be relayed');
  assert.equal(remote.length, 0);

  const other = binding();
  other.seed(baseState());
  const before = local.length;
  a.applyUpdate(Y.encodeStateAsUpdate(other.doc));

  assert.equal(remote.length > 0, true, 'a wire update must be reported as remote');
  assert.equal(local.length, before, 'a wire update must never be relayed back');
});

test('encodeState round-trips a document into a fresh peer', () => {
  const a = binding();
  a.seed(baseState());

  const b = binding();
  b.applyUpdate(a.encodeState());

  assert.deepEqual(b.toState(), a.toState());
});

test('create refuses to run without Yjs', () => {
  assert.throws(() => YDoc.create({}), /requires a Yjs module/);
});

// Regression anchor for the lost-edit path fixed in js/sync-session.js.
//
// Ops that target an object the document does not hold are silently dropped —
// there is nothing to set. That is correct CRDT behaviour, but it is exactly
// why a local edit made between start() and the relay handshake used to
// vanish: the op was applied to a still-empty document, `baseline` had already
// advanced past the edit, and the handshake then committed the room's state
// over the top. sync-session.js now buffers ops until the document is real.
//
// If this test ever fails because applyOps started materialising absent
// objects, that buffering can be reconsidered — but not before.
test('ops against an absent card are dropped by an empty document', () => {
  const empty = binding();
  const before = empty.toState();

  const populated = baseState();
  const edited = JSON.parse(JSON.stringify(populated));
  edited.boards[0].columns[0].cards[0].title = 'Edited while connecting';

  const ops = StateDiff.diff(populated, edited);
  assert.ok(ops.length > 0, 'the edit really does produce ops');

  empty.applyOps(ops);

  assert.deepEqual(empty.toState(), before, 'the empty document absorbed nothing');
  assert.ok(empty.isEmpty(), 'and is still empty, so onReady would seed or adopt');
});

// Regression anchor for the forked-lineage path fixed in js/sync-docs.js.
//
// Yjs identity is (clientId, clock), never `board.id`. Two documents built by
// running seed() over the same plain state are therefore two distinct sets of
// Y.Maps that happen to carry matching application ids, and merging them keeps
// BOTH. That is what a device did when it reloaded, dropped its in-memory
// Y.Doc, and re-seeded a relay whose log had been lost — one board id, two
// boards, on the peer that never reloaded.
test('re-seeding the same state builds a second lineage, restoring does not', () => {
  const state = baseState();

  const original = binding();
  original.seed(state);
  const survivor = binding(); // the peer that never reloads
  survivor.applyUpdate(original.encodeState());
  assert.equal(survivor.toState().boards.length, 1);

  // What the plain snapshot alone can rebuild: a new lineage.
  const rebuilt = binding();
  rebuilt.seed(original.toState());
  const forked = binding();
  forked.applyUpdate(survivor.encodeState());
  forked.applyUpdate(rebuilt.encodeState());
  assert.equal(forked.toState().boards.length, 2, 'the fork this exists to prevent');
  assert.equal(
    forked.toState().boards[0].id,
    forked.toState().boards[1].id,
    'and both boards carry the same application id, so nothing downstream can tell them apart'
  );

  // What the persisted document rebuilds: the same lineage.
  const reloaded = binding();
  reloaded.restore(original.encodeState());
  assert.deepEqual(reloaded.toState(), original.toState(), 'restore reproduces the document');
  const merged = binding();
  merged.applyUpdate(survivor.encodeState());
  merged.applyUpdate(reloaded.encodeState());
  assert.equal(merged.toState().boards.length, 1, 'the merge is the no-op it should be');
  assert.deepEqual(merged.toState(), survivor.toState());
});

// restore() is this device reloading its own document: it must not be relayed
// back out as a local edit, nor committed inward as a remote change.
test('restore notifies neither handler', () => {
  const source = binding();
  source.seed(baseState());

  const target = binding();
  let local = 0;
  let remote = 0;
  target.onLocalUpdate(() => { local += 1; });
  target.onRemoteUpdate(() => { remote += 1; });

  target.restore(source.encodeState());
  assert.equal(target.isEmpty(), false, 'the document really was restored');
  assert.equal(local, 0, 'nothing to publish: the room already has it');
  assert.equal(remote, 0, 'nothing to commit: local state is where it came from');

  target.restore(null);
  target.restore(new Uint8Array(0));
  assert.equal(local + remote, 0, 'and an absent document is simply a no-op');
});
