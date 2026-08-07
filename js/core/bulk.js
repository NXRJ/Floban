(function (root, factory) {
  var lifecycleCore = (typeof module === 'object' && module.exports)
    ? require('./lifecycle.js')
    : root.KB.Core.Lifecycle;
  var policiesCore = (typeof module === 'object' && module.exports)
    ? require('./policies.js')
    : root.KB.Core.Policies;
  var api = factory(lifecycleCore, policiesCore);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Bulk = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function (Lifecycle, Policies) {
    function cloneState(state) {
      return JSON.parse(JSON.stringify(state));
    }

    function resolveCard(state, ref) {
      var board = state.boards.find(function (b) { return b.id === ref.boardId; });
      if (!board) return null;
      for (var i = 0; i < board.columns.length; i++) {
        var column = board.columns[i];
        var index = column.cards.findIndex(function (c) { return c.id === ref.cardId; });
        if (index !== -1) return { board: board, column: column, card: column.cards[index], index: index };
      }
      return null;
    }

    function bulkMove(state, cardRefs, target, deps, opts) {
      var options = opts || {};
      var now = deps ? deps.now() : 0;
      if (!Array.isArray(cardRefs) || cardRefs.length === 0) {
        return { changed: false, state: state, value: null, reason: 'no-cards' };
      }
      var next = cloneState(state);
      var targetBoard = next.boards.find(function (b) { return b.id === target.boardId; });
      if (!targetBoard) return { changed: false, state: state, value: null, reason: 'board-not-found' };
      var targetColumn = targetBoard.columns.find(function (c) { return c.id === target.columnId; });
      if (!targetColumn) return { changed: false, state: state, value: null, reason: 'column-not-found' };

      var violations = [];
      var moved = 0;
      cardRefs.forEach(function (ref) {
        var located = resolveCard(next, ref);
        if (!located) {
          violations.push({ ref: ref, code: 'card-not-found', message: 'A selected card no longer exists.' });
          return;
        }
        var evaluation = Policies.evaluateMovePolicy(next, ref, { boardId: target.boardId, columnId: target.columnId }, {
          sourceColumn: located.column,
          confirmed: Boolean(options.confirmed),
          overrideReason: options.overrideReason
        });
        if (!evaluation.allowed) {
          violations.push({ ref: ref, code: evaluation.violations[0] ? evaluation.violations[0].code : 'policy', message: 'Policy blocks this card.' });
        }
      });

      if (violations.length > 0) {
        return { changed: false, state: state, value: null, reason: 'policy-violations', violations: violations };
      }

      var order = {};
      cardRefs.forEach(function (ref, index) { order[ref.boardId + ':' + ref.cardId] = index; });
      var sourceEntries = [];
      cardRefs.forEach(function (ref) {
        var located = resolveCard(next, ref);
        if (located) sourceEntries.push({ ref: ref, located: located });
      });
      sourceEntries.sort(function (a, b) {
        return order[a.ref.boardId + ':' + a.ref.cardId] - order[b.ref.boardId + ':' + b.ref.cardId];
      });

      var movedCards = [];
      sourceEntries.forEach(function (entry) {
        var located = resolveCard(next, entry.ref);
        if (!located) return;
        var card = located.column.cards.splice(located.index, 1)[0];
        var sameColumn = located.column.id === targetColumn.id;
        var prevMovedAt = card.movedAt;
        if (!sameColumn) {
          var lifecycle = Lifecycle.transitionCard(card, located.column, targetColumn, now);
          card = lifecycle.card;
        }
        card.columnId = target.columnId;
        if (sameColumn) card.movedAt = prevMovedAt;
        if (!sameColumn) {
          var mappings = options.labelMappings || {};
          var mapped = mappings[entry.ref.boardId + ':' + entry.ref.cardId];
          if (Array.isArray(mapped)) card.labels = mapped.slice();
          card = Policies.applyEntryDefaults(card, targetColumn);
        }
        movedCards.push(card);
      });

      if (target.boardId === sourceEntries[0].located.board.id && target.columnId === sourceEntries[0].located.column.id) {
        var firstIndex = -1;
        sourceEntries.forEach(function (entry) {
          if (entry.located.board.id === targetBoard.id && entry.located.column.id === targetColumn.id) {
            if (firstIndex === -1 || entry.located.index < firstIndex) firstIndex = entry.located.index;
          }
        });
        movedCards.forEach(function (card) {
          targetColumn.cards.splice(Math.max(0, firstIndex), 0, card);
          firstIndex += 1;
        });
      } else {
        movedCards.forEach(function (card) {
          targetColumn.cards.push(card);
        });
      }
      moved = movedCards.length;
      if (moved === 0) return { changed: false, state: state, value: null, reason: 'no-cards' };
      return { changed: true, state: next, value: movedCards };
    }

    function bulkUpdate(state, cardRefs, patch, deps) {
      var next = cloneState(state);
      var changed = false;
      cardRefs.forEach(function (ref) {
        var located = resolveCard(next, ref);
        if (!located) return;
        Object.keys(patch || {}).forEach(function (key) {
          if (key === 'id' || key === 'columnId' || key === 'createdAt') return;
          if (key === 'labels') {
            located.card.labels = Array.isArray(patch.labels) ? patch.labels.slice() : [];
            changed = true;
            return;
          }
          if (located.card[key] !== patch[key]) {
            located.card[key] = patch[key];
            changed = true;
          }
        });
        located.card.updatedAt = deps ? deps.now() : 0;
      });
      if (!changed) return { changed: false, state: state, value: null, reason: 'no-change' };
      return { changed: true, state: next, value: cardRefs.length };
    }

    function bulkArchive(state, cardRefs, deps) {
      var next = cloneState(state);
      var archived = 0;
      cardRefs.forEach(function (ref) {
        var located = resolveCard(next, ref);
        if (!located) return;
        var card = located.column.cards.splice(located.index, 1)[0];
        card.archivedAt = deps ? deps.now() : 0;
        card.fromColumn = located.column.title;
        located.board.archive.cards.push(card);
        archived += 1;
      });
      if (archived === 0) return { changed: false, state: state, value: null, reason: 'no-cards' };
      return { changed: true, state: next, value: archived };
    }

    return {
      bulkMove: bulkMove,
      bulkUpdate: bulkUpdate,
      bulkArchive: bulkArchive
    };
  }
);
