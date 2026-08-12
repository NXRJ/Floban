(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.StateDiff = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function () {
    // Snapshot -> granular ops. The bridge between this app's state model and
    // any CRDT document.
    //
    // WHY THIS EXISTS: KB.Sync.emit hands subscribers a WHOLE state snapshot,
    // not a mutation. Applying snapshots wholesale to a CRDT would make every
    // field last-writer-wins and defeat the entire point of using one — two
    // people editing different cards in the same column would clobber each
    // other. This module recovers the granularity that the save() funnel threw
    // away, by diffing consecutive snapshots into ops keyed on the stable ids
    // that docs/SYNC.md guarantees (board/column/card ids).
    //
    // Pure and deterministic: no clock, no ids generated, nothing mutated.
    // Op order is significant — removals before additions before moves before
    // field sets, so a replayed batch never transiently duplicates a card.

    // Card fields synchronized individually. Anything not listed still rides
    // along inside a card.add payload; it just is not diffed field-by-field.
    var CARD_FIELDS = [
      'title', 'description', 'due', 'when', 'priority', 'size', 'assignee',
      'labels', 'checklist', 'startedAt', 'completedAt', 'archivedAt',
      'flow', 'dependencies', 'recurrenceId', 'effort', 'ping', 'updatedAt',
      'movedAt', 'fromColumn', 'transitions'
    ];
    var COLUMN_FIELDS = ['title', 'role', 'isDone', 'wipLimit', 'policy', 'collapsed'];
    var BOARD_FIELDS = ['name', 'flowSettings', 'labels', 'archive', 'templates'];
    // Single-writer slices: personal, not collaborative. Diffed as a whole so
    // the document still carries them, without pretending they merge per-field.
    var COARSE_KEYS = ['inbox', 'lenses', 'recurrences', 'templates', 'dayplans',
      'focusDays', 'focusSession', 'streaks', 'theme', 'accent', 'activeBoardId', 'version'];

    // Deep value equality via canonical JSON. State values are plain JSON, so
    // this is exact rather than approximate.
    function same(a, b) {
      return stable(a) === stable(b);
    }

    function stable(value) {
      if (value === null || typeof value !== 'object') return JSON.stringify(value);
      if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
      var keys = Object.keys(value).sort();
      return '{' + keys.map(function (k) {
        return JSON.stringify(k) + ':' + stable(value[k]);
      }).join(',') + '}';
    }

    // ---- Indexing -----------------------------------------------------------

    function indexState(state) {
      var boards = {};
      var boardOrder = [];
      var columns = {};
      var cards = {};
      var cardHome = {}; // cardId -> { boardId, columnId, index }

      ((state && state.boards) || []).forEach(function (board) {
        if (!board || typeof board.id !== 'string') return;
        boards[board.id] = board;
        boardOrder.push(board.id);
        (board.columns || []).forEach(function (column) {
          if (!column || typeof column.id !== 'string') return;
          columns[column.id] = { board: board, column: column };
          (column.cards || []).forEach(function (card, index) {
            if (!card || typeof card.id !== 'string') return;
            cards[card.id] = card;
            cardHome[card.id] = { boardId: board.id, columnId: column.id, index: index };
          });
        });
      });

      return {
        boards: boards, boardOrder: boardOrder,
        columns: columns, cards: cards, cardHome: cardHome
      };
    }

    function columnOrder(board) {
      return (board.columns || []).map(function (c) { return c && c.id; }).filter(Boolean);
    }

    function cardPayload(card) {
      var out = {};
      Object.keys(card).forEach(function (key) {
        if (key !== 'id') out[key] = card[key];
      });
      return out;
    }

    function columnFields(column) {
      var out = {};
      COLUMN_FIELDS.forEach(function (field) {
        if (column[field] !== undefined) out[field] = column[field];
      });
      return out;
    }

    // ---- Diff ---------------------------------------------------------------

    // diff(prev, next) -> [op]. Each op is plain and serializable; the CRDT
    // binding decides how it maps onto its document types.
    function diff(prev, next) {
      var a = indexState(prev);
      var b = indexState(next);
      var ops = [];

      // 1. Removals first: a card that changed columns must leave its old
      //    position before it is inserted, or a replay briefly duplicates it.
      Object.keys(a.cards).forEach(function (cardId) {
        if (b.cards[cardId]) return;
        var home = a.cardHome[cardId];
        ops.push({ type: 'card.remove', boardId: home.boardId, columnId: home.columnId, cardId: cardId });
      });
      Object.keys(a.columns).forEach(function (columnId) {
        if (b.columns[columnId]) return;
        ops.push({ type: 'column.remove', boardId: a.columns[columnId].board.id, columnId: columnId });
      });
      a.boardOrder.forEach(function (boardId) {
        if (b.boards[boardId]) return;
        ops.push({ type: 'board.remove', boardId: boardId });
      });

      // 2. Additions, outermost first so their containers exist.
      b.boardOrder.forEach(function (boardId) {
        if (a.boards[boardId]) return;
        var board = b.boards[boardId];
        var payload = {};
        BOARD_FIELDS.forEach(function (field) {
          if (board[field] !== undefined) payload[field] = board[field];
        });
        ops.push({
          type: 'board.add', boardId: boardId,
          index: b.boardOrder.indexOf(boardId), board: payload
        });
      });
      Object.keys(b.columns).forEach(function (columnId) {
        if (a.columns[columnId]) return;
        var entry = b.columns[columnId];
        ops.push({
          type: 'column.add', boardId: entry.board.id, columnId: columnId,
          index: columnOrder(entry.board).indexOf(columnId),
          column: columnFields(entry.column)
        });
      });
      Object.keys(b.cards).forEach(function (cardId) {
        if (a.cards[cardId]) return;
        var home = b.cardHome[cardId];
        ops.push({
          type: 'card.add', boardId: home.boardId, columnId: home.columnId,
          cardId: cardId, index: home.index, card: cardPayload(b.cards[cardId])
        });
      });

      // 3. Moves and reorders for cards present in both snapshots.
      Object.keys(b.cards).forEach(function (cardId) {
        if (!a.cards[cardId]) return;
        var from = a.cardHome[cardId];
        var to = b.cardHome[cardId];
        if (from.columnId === to.columnId && from.index === to.index) return;
        ops.push({
          type: 'card.move', cardId: cardId,
          fromBoardId: from.boardId, fromColumnId: from.columnId,
          boardId: to.boardId, columnId: to.columnId, index: to.index
        });
      });

      // 4. Field-level sets. One op per changed field, so two peers editing
      //    different fields of the same card both survive the merge.
      Object.keys(b.cards).forEach(function (cardId) {
        var before = a.cards[cardId];
        if (!before) return;
        var after = b.cards[cardId];
        CARD_FIELDS.forEach(function (field) {
          if (same(before[field], after[field])) return;
          ops.push({
            type: 'card.set', boardId: b.cardHome[cardId].boardId,
            cardId: cardId, field: field, value: after[field]
          });
        });
      });
      Object.keys(b.columns).forEach(function (columnId) {
        var beforeCol = a.columns[columnId];
        if (!beforeCol) return;
        var afterCol = b.columns[columnId];
        COLUMN_FIELDS.forEach(function (field) {
          if (same(beforeCol.column[field], afterCol.column[field])) return;
          ops.push({
            type: 'column.set', boardId: afterCol.board.id,
            columnId: columnId, field: field, value: afterCol.column[field]
          });
        });
      });
      b.boardOrder.forEach(function (boardId) {
        var beforeBoard = a.boards[boardId];
        if (!beforeBoard) return;
        var afterBoard = b.boards[boardId];
        BOARD_FIELDS.forEach(function (field) {
          if (same(beforeBoard[field], afterBoard[field])) return;
          ops.push({ type: 'board.set', boardId: boardId, field: field, value: afterBoard[field] });
        });
        var beforeOrder = columnOrder(beforeBoard);
        var afterOrder = columnOrder(afterBoard);
        if (!same(beforeOrder, afterOrder)) {
          ops.push({ type: 'column.order', boardId: boardId, order: afterOrder });
        }
      });
      if (!same(a.boardOrder, b.boardOrder)) {
        ops.push({ type: 'board.order', order: b.boardOrder });
      }

      // 5. Personal slices, replaced wholesale. Deliberately coarse: these are
      //    single-writer by nature (your inbox, your day sheets), so per-field
      //    merge would be ceremony without benefit.
      COARSE_KEYS.forEach(function (key) {
        var before = prev ? prev[key] : undefined;
        var after = next ? next[key] : undefined;
        if (same(before, after)) return;
        ops.push({ type: 'state.set', key: key, value: after });
      });

      return ops;
    }

    // ---- Apply --------------------------------------------------------------

    // Replay ops onto a snapshot, returning a NEW state. This is the inverse of
    // diff for the ops it produces: apply(prev, diff(prev, next)) deep-equals
    // next for any two states. That round-trip is the contract the CRDT binding
    // leans on, and it is what the unit tests pin.
    function apply(state, ops) {
      var next = JSON.parse(JSON.stringify(state || {}));
      if (!Array.isArray(next.boards)) next.boards = [];

      (ops || []).forEach(function (op) {
        switch (op.type) {
          case 'board.remove':
            next.boards = next.boards.filter(function (b) { return b.id !== op.boardId; });
            break;
          case 'board.add': {
            if (findBoard(next, op.boardId)) break;
            var board = Object.assign({ id: op.boardId }, op.board || {});
            if (!Array.isArray(board.columns)) board.columns = [];
            if (!board.archive) board.archive = { cards: [], columns: [] };
            next.boards.splice(clamp(op.index, next.boards.length), 0, board);
            break;
          }
          case 'board.set': {
            var setBoard = findBoard(next, op.boardId);
            if (setBoard) setBoard[op.field] = op.value;
            break;
          }
          case 'board.order':
            next.boards = reorder(next.boards, op.order);
            break;
          case 'column.remove': {
            var owner = findBoard(next, op.boardId);
            if (owner) owner.columns = (owner.columns || []).filter(function (c) { return c.id !== op.columnId; });
            break;
          }
          case 'column.add': {
            var addBoard = findBoard(next, op.boardId);
            if (!addBoard || findColumn(addBoard, op.columnId)) break;
            var column = Object.assign({ id: op.columnId }, op.column || {});
            if (!Array.isArray(column.cards)) column.cards = [];
            addBoard.columns.splice(clamp(op.index, addBoard.columns.length), 0, column);
            break;
          }
          case 'column.set': {
            var setColumn = locateColumn(next, op.boardId, op.columnId);
            if (setColumn) setColumn[op.field] = op.value;
            break;
          }
          case 'column.order': {
            var orderBoard = findBoard(next, op.boardId);
            if (orderBoard) orderBoard.columns = reorder(orderBoard.columns, op.order);
            break;
          }
          case 'card.remove': {
            var fromColumn = locateColumn(next, op.boardId, op.columnId);
            if (fromColumn) {
              fromColumn.cards = fromColumn.cards.filter(function (c) { return c.id !== op.cardId; });
            }
            break;
          }
          case 'card.add': {
            var intoColumn = locateColumn(next, op.boardId, op.columnId);
            if (!intoColumn) break;
            if (intoColumn.cards.some(function (c) { return c.id === op.cardId; })) break;
            intoColumn.cards.splice(clamp(op.index, intoColumn.cards.length), 0,
              Object.assign({ id: op.cardId }, op.card || {}));
            break;
          }
          case 'card.move': {
            var moved = takeCardAnywhere(next, op.cardId);
            if (!moved) break;
            var dest = locateColumn(next, op.boardId, op.columnId);
            if (!dest) break;
            dest.cards.splice(clamp(op.index, dest.cards.length), 0, moved);
            break;
          }
          case 'card.set': {
            var card = findCard(next, op.cardId);
            if (card) card[op.field] = op.value;
            break;
          }
          case 'state.set':
            next[op.key] = op.value;
            break;
          default:
            break; // unknown op from a newer peer: ignored, never fatal
        }
      });

      return next;
    }

    function clamp(index, length) {
      var n = typeof index === 'number' && index >= 0 ? index : length;
      return n > length ? length : n;
    }

    function reorder(list, order) {
      if (!Array.isArray(order)) return list;
      var byId = {};
      list.forEach(function (item) { byId[item.id] = item; });
      var out = [];
      order.forEach(function (id) {
        if (byId[id]) { out.push(byId[id]); delete byId[id]; }
      });
      // Anything the peer did not mention keeps its relative order at the end,
      // so an op from an older peer cannot silently drop entities.
      list.forEach(function (item) { if (byId[item.id]) out.push(item); });
      return out;
    }

    function findBoard(state, boardId) {
      return (state.boards || []).find(function (b) { return b.id === boardId; }) || null;
    }

    function findColumn(board, columnId) {
      return (board.columns || []).find(function (c) { return c.id === columnId; }) || null;
    }

    // Resolve by column id, falling back to a global scan: a concurrent peer
    // may have moved the column to another board, and the op still applies.
    function locateColumn(state, boardId, columnId) {
      var board = findBoard(state, boardId);
      if (board) {
        var column = findColumn(board, columnId);
        if (column) return column;
      }
      var found = null;
      (state.boards || []).forEach(function (b) {
        (b.columns || []).forEach(function (c) {
          if (c.id === columnId) found = c;
        });
      });
      return found;
    }

    function findCard(state, cardId) {
      var found = null;
      (state.boards || []).forEach(function (board) {
        (board.columns || []).forEach(function (column) {
          (column.cards || []).forEach(function (card) {
            if (card.id === cardId) found = card;
          });
        });
      });
      return found;
    }

    function takeCardAnywhere(state, cardId) {
      var taken = null;
      (state.boards || []).forEach(function (board) {
        (board.columns || []).forEach(function (column) {
          var at = (column.cards || []).findIndex(function (c) { return c.id === cardId; });
          if (at !== -1) taken = column.cards.splice(at, 1)[0];
        });
      });
      return taken;
    }

    return {
      CARD_FIELDS: CARD_FIELDS,
      COLUMN_FIELDS: COLUMN_FIELDS,
      BOARD_FIELDS: BOARD_FIELDS,
      COARSE_KEYS: COARSE_KEYS,
      diff: diff,
      apply: apply,
      indexState: indexState
    };
  }
);
