# Optional CRDT Sync

An **optional, opt-in** multi-device sync layer built on Yjs. The app is
local-first and stays fully functional with no network, no accounts, and no
backend; sync is off by default and costs a cold boot nothing until it is
switched on. The contract below is what the implementation respects — it was
written before the code and still governs it.

## The pieces

| File | Role |
|------|------|
| `js/core/statediff.js` | Snapshot → granular ops. Recovers the per-field granularity the `save()` funnel throws away. Pure, no CRDT knowledge. |
| `js/core/ydoc.js` | The binding: StateDiff ops ↔ `Y.Map`/`Y.Array`. Owns merge semantics. |
| `js/sync-provider.js` | The wire: a WebSocket client speaking a tiny tagged protocol. Knows nothing about boards. |
| `js/sync-docs.js` | The document's own memory: one encoded Y.Doc per room in its own IndexedDB database. Sync metadata, never board state. |
| `js/sync-session.js` | The glue and the lifecycle. Subscribes to `KB.Sync`, commits remote changes through `KB.State.applyRemote`. |
| `sync-relay.js` | The server: a dependency-free WebSocket relay that fans opaque updates out per room. |
| `vendor/yjs.js` | Yjs 13.6.20, bundled once by `npm run yjs` and committed. Fetched on demand, never precached. |

## Turning it on

Serve with the relay attached, then pair devices on a shared room name:

```bash
npm run serve:sync
```

```js
// On the device that owns the board today — this ROOM IS NEW:
KB.SyncSession.enable('my-room', '', { create: true })
// On every other device — put me in the room that already exists:
KB.SyncSession.enable('my-room')
KB.SyncSession.state()             // { enabled, room, status, peers, fault }
KB.SyncSession.disable()
```

Join is the default because the two mistakes are not symmetric: joining a room
that does not exist yet waits, while creating a room that already exists forks
the board. `fault` says why an enabled session is not running —
`no-history` (asked to join a room no history-holding device is online for) or
`no-document-store` (see Bootstrap below).

The relay is same-origin by default (`KB_SYNC_ORIGINS` overrides), keeps each
room's update log in memory only, and never parses a Yjs update.

## Document shape

The Y.Doc mirrors the state tree, because merge granularity can only ever be as
fine as the document's structure:

```
doc.getMap('state')      coarse single-writer slices (inbox, lenses, streaks…)
doc.getArray('boards')   Y.Array<Y.Map>
  board.get('columns')   Y.Array<Y.Map>
    column.get('cards')  Y.Array<Y.Map>   card fields are map keys
```

Two peers editing different fields of one card touch independent map keys; two
peers adding cards to one column produce an array conflict Yjs resolves without
losing either. `theme` and `activeBoardId` are deliberately **not** synced —
`js/sync-session.js` overlays this device's values before committing.

## Known limits

- **Moves rebuild.** Yjs 13 has no move primitive, so a moved card (or a
  reordered column/board) is deleted and reinserted as a fresh `Y.Map`. A peer's
  concurrent edit to that same entity in that instant can be lost.
- **Coarse slices are last-writer-wins.** `inbox`, `lenses`, `dayplans` and
  friends are single-writer by nature and are diffed whole.
- **The relay is not a source of truth.** Its log dies with the process; every
  peer holds the full document locally, and reconnecting peers repopulate it.
  That is only safe because they rejoin with the *same* document — see
  Bootstrap below.

## Bootstrap

Two rules, both learned the hard way, both about CRDT identity: a `Y.Map` is
identified by `(clientId, clock)`, never by `board.id`. Two documents that
carry the same board id are still two boards once merged.

**One seeder per empty room.** The relay grants the seeding right to exactly
one client and holds the rest — no `ready` at all — until that client says the
document is published. `ready` therefore means "there is a document here you
may safely edit", never "the history replay has ended". Held peers receive
nothing until they are released, so a bootstrap the seeder abandons can simply
be dropped; the right then moves to the next peer in line.

The declaration is an explicit `{"t":"seeded"}` frame rather than something the
relay works out for itself, because it cannot: it never parses a Yjs update,
and an encoded **empty** `Y.Doc` is two perfectly ordinary bytes. Frames from
one socket are ordered, so the document is in the log by the time the
declaration arrives.

**The Y.Doc is reloaded, never rebuilt.** `js/sync-docs.js` persists the
encoded document alongside the board, keyed by relay *and* room — two relays
can each host a "work" and they are not the same room. A device that reloaded
and rebuilt its document from the plain snapshot would rejoin as a second
lineage of the same board, and a relay restart is enough to make that happen:
peer A reloads, reseeds the empty relay from plain state, and peer B — which
never reloaded — merges it into a duplicate of everything. Restoring the
encoded document keeps the identities, and the merge is the no-op it should be.

**The document is written ahead.** Persisting it is not bookkeeping to be
deferred: plain state is already crash-safe before the sync layer sees a change
(`Storage.save()` writes the localStorage mirror synchronously), so a crash
between "identity created and published" and "identity persisted" leaves a card
that exists in plain state but not in this device's document — and the restore
above then rebuilds it as a *new* identity while a peer holds the original.
That is the same fork on a millisecond fuse. So the document write lands first
and every consequence waits on it: local updates publish after it, remote
updates commit into `KB.State` after it. A write that *fails* is not a write
that landed, so nothing downstream of it runs either — the session stops with
`fault: 'no-document-store'` rather than publishing an identity it cannot
remember. The board itself is untouched and keeps working.

**Asynchronous work belongs to the session that started it.** Sessions are
numbered and `stop()` retires the number, so a pending document load, a queued
write or an update waiting to be published is dropped if the session it was
started under has ended. Comparing the room name is not enough — `enable('work')`
twice in a row is two sessions with the same name, and the first one's leftovers
would pass a name check and then act on the second one's socket. Each queued
write also captures its own destination up front rather than reading the current
room when it eventually runs; otherwise switching rooms mid-write files one
room's document under another room's key.

**A room the relay has forgotten is not a new room.** The relay drops a room
when its last peer leaves, so an empty room there means either "never existed"
or "everyone who has the history is offline" — and it cannot tell which. Only
the user can, which is what `create` is for. A device may bootstrap a room only
if it already holds that room's document (reconnect, or a relay restart) or the
user said the room is new; otherwise it declines the seeding right and leaves,
so the relay can offer it to a peer that does hold the history.

## The mutation boundary

Every user-visible state change flows through exactly one choke point:

```
DOM event / command → KB.State.* → save(source) → KB.Sync.emit({ source, at, state })
```

- `js/core/operations.js` and friends return `{ changed, state, value }` and are
  applied by `KB.State.internal.commit()`, which records undo history, swaps
  the state, and calls `save()`.
- Smaller mutations (`updateCard`, `addColumn`, `setTheme`, …) call
  `pushHistory()` + in-place mutation + `save()` directly — same boundary, same
  `save()` funnel.
- Undo/redo restore a snapshot and call `save('undo')` / `save('redo')`.
- Imports call `save('import')`; first-run migrations call `save('load')`.

`KB.Sync` (`js/sync.js`) is a tiny pub/sub: `KB.Sync.subscribe(fn)` receives
`{ source, at, state }` for every save. `js/sync-session.js` is its only
subscriber, and only while sync is enabled — with it off the observer is a
no-op passthrough, so the sync layer stays purely additive.

## Entity identity

Every entity that can be referenced across boards or synchronized carries a
stable, globally unique id generated by `KB.State.internal.uid()`:
boards, columns, cards, labels, templates, inbox items, lenses, recurrences,
checklist items. Cards are addressed cross-board as `{ boardId, cardId }`
dependency references. A CRDT layer can key its document on these ids without
any id migration.

## What a sync layer must do

1. **Subscribe locally.** `KB.Sync.subscribe(change => doc.applyLocal(change.state))`
   — apply the new state snapshot (or the specific mutation, if tracked) to the
   CRDT document. The `source` field distinguishes user edits from undo/redo and
   imports; undo/redo also produce full snapshots, so they are safe to apply.
2. **Feed remote deltas in as commits.** Remote changes must NOT touch
   `KB.State.internal.state` directly. They must be applied through the same
   public API (e.g. a new `KB.State.applyRemote(nextState)` that runs
   `KB.Core.Migration.normalizeState` for validation, records history, and
   saves) so undo, backup, and persistence semantics stay uniform.
3. **Treat storage as opaque.** `js/storage.js` owns persistence (IndexedDB
   primary + localStorage crash mirror + rotating backups). A sync layer reads
   and writes *state*, never the storage records.
4. **Keep the app usable without sync.** All current behavior — offline
   editing, backups, undo — must work identically with sync disabled, which is
   the default.

## What stays out of scope

- Peer-to-peer transport (WebRTC) and any hosted/multi-user service. The relay
  is a localhost courier for your own devices, with no auth and no persistence.
- Conflict resolution policy beyond CRDT merge semantics, plus the two limits
  listed above (moves rebuild; coarse slices are last-writer-wins).
- Multi-tab same-device editing — protected, not synchronized. Each tab runs
  its own serialized write queue, so simultaneous full-state writes would
  overwrite each other (last-writer-wins data loss). `js/multitab.js` ships
  the guard: the first tab to claim the localStorage edit lock is the editor;
  later tabs run read-only with a takeover banner (their saves are dropped,
  including backup/snapshot/import writes), and takeover or owner-departure
  reloads the surviving tab from storage so it never saves a stale in-memory
  state. Limitations: ownership is time-based as a crash fallback (a dead
  owner's lock is retaken after ~15s), but clean closes release the lease
  instantly (pagehide + owner-left broadcast), takeover settles with a short
  fixed delay before the reload, and the write gate re-checks the live claim
  synchronously (canWrite) at both the state layer and the storage boundary,
  so no save can start after a former owner's lease was lost — none of this
  is conflict-free multi-writer sync. The one residual race is a write that
  was already in flight when ownership changed: the gate decides whether a
  write starts, not whether it lands, so a former owner's save that passed
  both gates microseconds before a takeover can still commit to IndexedDB
  (the mirror gate makes that window a few synchronous instructions). A
  future CRDT layer could lift these limits without touching the guard's UX.

## Testing the seam today

The e2e suite subscribes to `KB.Sync` and asserts that representative mutations
(card create, move, archive, undo, redo, import) each emit exactly one event
with the right `source`. The unit suite verifies the storage engine's
serialization, backup rotation, and recovery order, which are the guarantees a
sync layer would rely on.

- `tests/unit/sync-relay.test.js` drives the relay over real sockets: the
  bootstrap handshake, the seeding right and its promotion, an abandoned
  bootstrap, and a reloaded peer reseeding a restarted relay.
- `tests/unit/ydoc.test.js` pins the identity property the whole design rests
  on — re-seeding the same plain state forks, restoring does not.
- `tests/kanban-smoke.js` tests the document store directly: key isolation per
  relay and per room, round-trip, overwrite, scoped removal, and that an
  unusable store rejects rather than reporting "no document".
- `tests/kanban-smoke.js` also pins the session's ordering and ownership rules
  with the store and the transport stubbed, because they are questions of *when*
  it acts and *on whose behalf* — a real socket would only make them
  timing-dependent. A held write publishes nothing until it lands; a failed one
  publishes nothing at all; two `enable()` calls for one room leave one live
  session; a write queued for one room reaches neither another room's record nor
  its connection.
- `npm run test:sync` (`tests/sync-devices.js`, **not** part of `npm test`, and
  **not** run by CI) drives two browser contexts against a live relay:
  create-vs-join, the dormant-room refusal, and the real IndexedDB path
  end-to-end. It needs a browser that can open a WebSocket to a local server —
  see the file's own header. Until it runs somewhere green it is a
  specification, not evidence.
