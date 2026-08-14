(function (root, factory) {
  var StateDiff = (typeof module === 'object' && module.exports)
    ? require('./statediff.js')
    : (root.KB && root.KB.Core && root.KB.Core.StateDiff);
  var api = factory(StateDiff);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.YDoc = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function (StateDiff) {
    // StateDiff ops <-> Y.Doc. The half of the sync layer that owns merge
    // semantics; js/sync-provider.js owns the wire, js/sync-session.js owns
    // the glue.
    //
    // WHY A BINDING AND NOT A JSON BLOB IN A Y.MAP: the whole reason to carry
    // a CRDT is that two peers editing different cards — or different fields
    // of the same card — both survive. That only happens if the document's
    // shape matches the granularity of the ops StateDiff produces. So the doc
    // mirrors the state tree:
    //
    //   doc.getMap('state')     -> coarse single-writer slices (inbox, lenses…)
    //   doc.getArray('boards')  -> Y.Array<Y.Map>
    //     board.get('columns')  -> Y.Array<Y.Map>
    //       column.get('cards') -> Y.Array<Y.Map>  (card fields are map keys)
    //
    // A concurrent insert into one column is an Array conflict Yjs resolves
    // without losing either card; a concurrent edit of two fields of one card
    // is two independent Map keys.
    //
    // Yjs is injected rather than imported: vendor/yjs.js is loaded on demand
    // in the browser (93KB should not ride on every boot for a feature that is
    // off by default), and the unit suite passes the npm package instead.

    // Personal to the device, deliberately not synchronized: syncing them
    // would yank the other device's view and repaint its theme mid-edit.
    // js/sync-session.js overlays the local values back before committing.
    var DEVICE_KEYS = ['theme', 'activeBoardId'];

    // Transaction origins. Everything hinges on telling apart "this peer typed
    // it" from "this arrived over the wire": the first must be relayed and not
    // re-applied, the second applied and not relayed.
    var LOCAL_ORIGIN = 'kb-local';
    var REMOTE_ORIGIN = 'kb-remote';
    // Reloading this device's own persisted document: neither typed here nor
    // arrived over the wire, so it must not be relayed OR committed back.
    var RESTORE_ORIGIN = 'kb-restore';

    function isDeviceKey(key) {
      return DEVICE_KEYS.indexOf(key) !== -1;
    }

    // Values in a Y.Map are decoded lazily and cached by Yjs, so a caller that
    // mutated one would corrupt the document. Hand out copies.
    function clone(value) {
      if (value === null || typeof value !== 'object') return value;
      return JSON.parse(JSON.stringify(value));
    }

    function clamp(index, length) {
      var n = typeof index === 'number' && index >= 0 ? index : length;
      return n > length ? length : n;
    }

    function create(options) {
      var Y = options && options.Y;
      if (!Y || typeof Y.Doc !== 'function') {
        throw new Error('KB.Core.YDoc.create requires a Yjs module (options.Y)');
      }

      var doc = (options && options.doc) || new Y.Doc();
      var stateMap = doc.getMap('state');
      var boards = doc.getArray('boards');
      var localHandlers = [];
      var remoteHandlers = [];

      doc.on('update', function (update, origin) {
        if (origin === RESTORE_ORIGIN) return;
        var handlers = origin === REMOTE_ORIGIN ? remoteHandlers : localHandlers;
        var snapshot = handlers.slice();
        for (var i = 0; i < snapshot.length; i++) {
          try {
            snapshot[i](update);
          } catch (err) {
            console.warn('KB.Core.YDoc handler failed', err);
          }
        }
      });

      // ---- Lookup ---------------------------------------------------------

      function boardEntry(boardId) {
        var list = boards.toArray();
        for (var i = 0; i < list.length; i++) {
          if (list[i].get('id') === boardId) return { map: list[i], index: i };
        }
        return null;
      }

      function columnsOf(boardMap) {
        return boardMap.get('columns');
      }

      function columnEntry(boardMap, columnId) {
        var array = columnsOf(boardMap);
        if (!array) return null;
        var list = array.toArray();
        for (var i = 0; i < list.length; i++) {
          if (list[i].get('id') === columnId) {
            return { map: list[i], index: i, array: array };
          }
        }
        return null;
      }

      // Resolve by column id, falling back to a global scan — a concurrent
      // peer may have moved the column to another board and the op still
      // applies. Mirrors StateDiff.apply's forgiveness on purpose: an op that
      // silently no-ops is a lost edit.
      function locateColumn(boardId, columnId) {
        var owner = boardEntry(boardId);
        if (owner) {
          var direct = columnEntry(owner.map, columnId);
          if (direct) return direct;
        }
        var all = boards.toArray();
        for (var i = 0; i < all.length; i++) {
          var found = columnEntry(all[i], columnId);
          if (found) return found;
        }
        return null;
      }

      function cardEntry(cardId) {
        var allBoards = boards.toArray();
        for (var i = 0; i < allBoards.length; i++) {
          var columns = columnsOf(allBoards[i]);
          if (!columns) continue;
          var columnList = columns.toArray();
          for (var j = 0; j < columnList.length; j++) {
            var cards = columnList[j].get('cards');
            if (!cards) continue;
            var cardList = cards.toArray();
            for (var k = 0; k < cardList.length; k++) {
              if (cardList[k].get('id') === cardId) {
                return { map: cardList[k], index: k, array: cards };
              }
            }
          }
        }
        return null;
      }

      // ---- Construction ---------------------------------------------------

      function fillMap(target, source) {
        Object.keys(source || {}).forEach(function (key) {
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
          if (source[key] === undefined) return;
          target.set(key, clone(source[key]));
        });
      }

      function makeCard(cardId, payload) {
        var map = new Y.Map();
        // A card's own list fields (labels, checklist, …) stay opaque JSON:
        // StateDiff already diffs them as whole fields, so giving them CRDT
        // types would buy merge granularity the op stream cannot express.
        fillMap(map, payload);
        map.set('id', cardId);
        return map;
      }

      // Children are passed in rather than read back: a Y.Map that is not yet
      // attached to a document cannot be read from, only written to, so
      // `map.set('cards', new Y.Array())` followed by `map.get('cards')`
      // returns undefined. Build the child, fill it, then hand it over.
      function makeColumn(columnId, fields, cards) {
        var map = new Y.Map();
        fillMap(map, fields);
        map.set('id', columnId);
        var array = new Y.Array();
        if (cards && cards.length > 0) array.insert(0, cards);
        map.set('cards', array);
        return map;
      }

      function makeBoard(boardId, fields, columns) {
        var map = new Y.Map();
        fillMap(map, fields);
        map.set('id', boardId);
        var array = new Y.Array();
        if (columns && columns.length > 0) array.insert(0, columns);
        map.set('columns', array);
        return map;
      }

      // Reorder a Y.Array of Y.Maps to match a list of ids. Yjs 13 has no move
      // primitive, so an element that changes position is deleted and rebuilt
      // from its plain value — it loses its identity, and a peer's concurrent
      // edit to that same element can be lost. Reorders are rare and explicit;
      // card moves take the same route for the same reason.
      function reorder(array, order, toPlain, rebuild) {
        if (!array || !Array.isArray(order)) return;
        for (var target = 0; target < order.length; target++) {
          var list = array.toArray();
          if (target >= list.length) break;
          if (list[target].get('id') === order[target]) continue;
          var at = -1;
          for (var i = target + 1; i < list.length; i++) {
            if (list[i].get('id') === order[target]) { at = i; break; }
          }
          if (at === -1) continue;
          var plain = toPlain(list[at]);
          array.delete(at, 1);
          array.insert(target, [rebuild(plain)]);
        }
      }

      function rebuildColumn(plain) {
        return makeColumn(plain.id, plain, (plain.cards || []).map(function (card) {
          return makeCard(card.id, card);
        }));
      }

      function rebuildBoard(plain) {
        return makeBoard(plain.id, plain, (plain.columns || []).map(rebuildColumn));
      }

      // ---- Materialization ------------------------------------------------

      function mapToPlain(map, skip) {
        var out = {};
        map.forEach(function (value, key) {
          if (skip && key === skip) return;
          out[key] = clone(value);
        });
        return out;
      }

      function cardToPlain(map) {
        return mapToPlain(map, null);
      }

      function columnToPlain(map) {
        var out = mapToPlain(map, 'cards');
        var cards = map.get('cards');
        out.cards = cards ? cards.toArray().map(cardToPlain) : [];
        return out;
      }

      function boardToPlain(map) {
        var out = mapToPlain(map, 'columns');
        var columns = map.get('columns');
        out.columns = columns ? columns.toArray().map(columnToPlain) : [];
        return out;
      }

      // The document as a plain state snapshot. Device-local keys are absent
      // by construction; the caller supplies its own.
      function toState() {
        var out = {};
        stateMap.forEach(function (value, key) {
          out[key] = clone(value);
        });
        out.boards = boards.toArray().map(boardToPlain);
        return out;
      }

      // ---- Ops ------------------------------------------------------------

      function applyOp(op) {
        switch (op.type) {
          case 'board.remove': {
            var doomed = boardEntry(op.boardId);
            if (doomed) boards.delete(doomed.index, 1);
            break;
          }
          case 'board.add': {
            if (boardEntry(op.boardId)) break;
            boards.insert(clamp(op.index, boards.length), [makeBoard(op.boardId, op.board)]);
            break;
          }
          case 'board.set': {
            var setBoard = boardEntry(op.boardId);
            if (setBoard) setBoard.map.set(op.field, clone(op.value));
            break;
          }
          case 'board.order':
            reorder(boards, op.order, boardToPlain, rebuildBoard);
            break;
          case 'column.remove': {
            var removeFrom = locateColumn(op.boardId, op.columnId);
            if (removeFrom) removeFrom.array.delete(removeFrom.index, 1);
            break;
          }
          case 'column.add': {
            var addTo = boardEntry(op.boardId);
            if (!addTo || columnEntry(addTo.map, op.columnId)) break;
            var columns = columnsOf(addTo.map);
            if (!columns) break;
            columns.insert(clamp(op.index, columns.length), [makeColumn(op.columnId, op.column)]);
            break;
          }
          case 'column.set': {
            var setColumn = locateColumn(op.boardId, op.columnId);
            if (setColumn) setColumn.map.set(op.field, clone(op.value));
            break;
          }
          case 'column.order': {
            var orderBoard = boardEntry(op.boardId);
            if (orderBoard) {
              reorder(columnsOf(orderBoard.map), op.order, columnToPlain, rebuildColumn);
            }
            break;
          }
          case 'card.remove': {
            var doomedCard = cardEntry(op.cardId);
            if (doomedCard) doomedCard.array.delete(doomedCard.index, 1);
            break;
          }
          case 'card.add': {
            if (cardEntry(op.cardId)) break;
            var into = locateColumn(op.boardId, op.columnId);
            if (!into) break;
            var intoCards = into.map.get('cards');
            if (!intoCards) break;
            intoCards.insert(clamp(op.index, intoCards.length), [makeCard(op.cardId, op.card)]);
            break;
          }
          case 'card.move': {
            var moving = cardEntry(op.cardId);
            if (!moving) break;
            var dest = locateColumn(op.boardId, op.columnId);
            if (!dest) break;
            var destCards = dest.map.get('cards');
            if (!destCards) break;
            // No move primitive in Yjs 13: lift the card out as plain data and
            // reinsert it as a fresh Y.Map. A peer editing this card in the
            // same instant can lose that edit — the documented cost of a move.
            var payload = cardToPlain(moving.map);
            moving.array.delete(moving.index, 1);
            destCards.insert(clamp(op.index, destCards.length), [makeCard(op.cardId, payload)]);
            break;
          }
          case 'card.set': {
            var card = cardEntry(op.cardId);
            if (card) card.map.set(op.field, clone(op.value));
            break;
          }
          case 'state.set':
            if (isDeviceKey(op.key)) break;
            stateMap.set(op.key, clone(op.value));
            break;
          default:
            break; // unknown op from a newer peer: ignored, never fatal
        }
      }

      // Apply a StateDiff op batch as one local transaction, so peers see one
      // update per save rather than one per field.
      function applyOps(ops) {
        if (!Array.isArray(ops) || ops.length === 0) return;
        doc.transact(function () {
          ops.forEach(applyOp);
        }, LOCAL_ORIGIN);
      }

      // Populate an empty document from a snapshot, reusing the same diff path
      // every later save takes — no second, subtly different writer.
      function seed(state) {
        applyOps(StateDiff.diff({ boards: [] }, state));
      }

      function isEmpty() {
        return boards.length === 0 && stateMap.size === 0;
      }

      // ---- Wire -----------------------------------------------------------

      function applyUpdate(update) {
        Y.applyUpdate(doc, update, REMOTE_ORIGIN);
      }

      // Reload this device's own previously encoded document.
      //
      // WHY THIS EXISTS AT ALL: a board rebuilt from plain state by seed() is a
      // NEW set of Y.Map items even when every application id matches, because
      // Yjs identity is (clientId, clock) and not `board.id`. So a device that
      // reloaded, dropped its in-memory Y.Doc and re-seeded from IndexedDB
      // would hand a peer that never reloaded a SECOND lineage of the same
      // board — and the merge keeps both. Restoring the encoded document
      // instead preserves the identities, and the merge is a no-op.
      //
      // Neither handler fires: this is not a local edit to publish (the peers
      // already have it) and not a remote change to commit (local state is
      // where it came from).
      function restore(update) {
        if (!update || update.length === 0) return;
        Y.applyUpdate(doc, update, RESTORE_ORIGIN);
      }

      function encodeState() {
        return Y.encodeStateAsUpdate(doc);
      }

      function onLocalUpdate(fn) {
        localHandlers.push(fn);
      }

      function onRemoteUpdate(fn) {
        remoteHandlers.push(fn);
      }

      function destroy() {
        localHandlers.length = 0;
        remoteHandlers.length = 0;
        doc.destroy();
      }

      return {
        doc: doc,
        applyOps: applyOps,
        seed: seed,
        toState: toState,
        isEmpty: isEmpty,
        applyUpdate: applyUpdate,
        restore: restore,
        encodeState: encodeState,
        onLocalUpdate: onLocalUpdate,
        onRemoteUpdate: onRemoteUpdate,
        destroy: destroy
      };
    }

    return {
      DEVICE_KEYS: DEVICE_KEYS,
      LOCAL_ORIGIN: LOCAL_ORIGIN,
      REMOTE_ORIGIN: REMOTE_ORIGIN,
      RESTORE_ORIGIN: RESTORE_ORIGIN,
      create: create
    };
  }
);
