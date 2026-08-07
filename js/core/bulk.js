(function (root, factory) {
  var pipelineCore = (typeof module === 'object' && module.exports)
    ? require('./pipeline.js')
    : root.KB.Core.Pipeline;
  var lifecycleCore = (typeof module === 'object' && module.exports)
    ? require('./lifecycle.js')
    : root.KB.Core.Lifecycle;
  var policiesCore = (typeof module === 'object' && module.exports)
    ? require('./policies.js')
    : root.KB.Core.Policies;
  var api = factory(pipelineCore, lifecycleCore, policiesCore);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Bulk = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function (Pipeline, Lifecycle, Policies) {
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
          violations.push({ ref: ref, code: 'card-not-found', message: 'A selected card no longer exists.', blocking: true });
          return;
        }
        var evaluation = Policies.evaluateMovePolicy(next, ref, { boardId: target.boardId, columnId: target.columnId }, {
          sourceColumn: located.column,
          confirmed: Boolean(options.confirmed),
          overrideReason: options.overrideReason
        });
        if (!evaluation.allowed) {
          var first = evaluation.violations[0] || { code: 'policy', message: 'Policy blocks this card.' };
          violations.push({ ref: ref, code: first.code, message: first.message, blocking: true, criteria: first.criteria });
        } else if (evaluation.requiresConfirmation && !options.confirmed) {
          var soft = evaluation.violations[0] || { code: 'wip-limit', message: 'A soft WIP limit would be exceeded.' };
          violations.push({ ref: ref, code: soft.code, message: soft.message, blocking: false, criteria: soft.criteria });
        }
      });

      var anyBlocking = violations.some(function (v) { return v.blocking; });
      if (violations.length > 0 && !options.confirmed) {
        return {
          changed: false,
          state: state,
          value: null,
          reason: 'policy-violations',
          violations: violations,
          blocking: anyBlocking
        };
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
        var card = located.column.cards[located.index];
        var sameColumn = located.column.id === targetColumn.id;
        var mappings = options.labelMappings || {};
        var mapped = mappings[entry.ref.boardId + ':' + entry.ref.cardId];
        var placed = Pipeline.placeCard(next, card, located.column, targetBoard, targetColumn, {
          sameColumnMode: sameColumn ? 'preserve' : 'transition',
          labelMapping: Array.isArray(mapped) ? mapped : undefined,
          confirmed: Boolean(options.confirmed),
          overrideReason: options.overrideReason
        }, deps);
        if (!placed.changed) {
          violations.push({ ref: entry.ref, code: placed.reason || 'policy', message: 'Policy blocks this card.', blocking: true });
          return;
        }
        movedCards.push(placed.value);
      });

      if (movedCards.length === 0) {
        if (violations.length > 0) {
          return { changed: false, state: state, value: null, reason: 'policy-violations', violations: violations, blocking: true };
        }
        return { changed: false, state: state, value: null, reason: 'no-cards' };
      }

      var sameTarget = sourceEntries.some(function (entry) {
        return entry.located.board.id === targetBoard.id && entry.located.column.id === targetColumn.id;
      });
      if (sameTarget) {
        var firstIndex = -1;
        sourceEntries.forEach(function (entry) {
          if (entry.located.board.id === targetBoard.id && entry.located.column.id === targetColumn.id) {
            if (firstIndex === -1 || entry.located.index < firstIndex) firstIndex = entry.located.index;
          }
        });
        targetColumn.cards.splice(targetColumn.cards.length - movedCards.length, movedCards.length);
        movedCards.forEach(function (card) {
          targetColumn.cards.splice(Math.max(0, firstIndex), 0, card);
          firstIndex += 1;
        });
      }
      moved = movedCards.length;
      if (violations.length > 0) {
        return { changed: true, state: next, value: movedCards, warnings: violations };
      }
      return { changed: true, state: next, value: movedCards };
    }

    function bulkSetLabels(state, entries, deps) {
      var next = cloneState(state);
      var changed = 0;
      entries.forEach(function (entry) {
        var located = resolveCard(next, entry.ref);
        if (!located) return;
        var labels = Array.isArray(entry.labels) ? entry.labels.slice() : [];
        var same = (located.card.labels || []).length === labels.length &&
          labels.every(function (id) { return (located.card.labels || []).indexOf(id) !== -1; });
        if (!same) {
          located.card.labels = labels;
          located.card.updatedAt = deps ? deps.now() : 0;
          changed += 1;
        }
      });
      if (changed === 0) return { changed: false, state: state, value: null, reason: 'no-change' };
      return { changed: true, state: next, value: changed };
    }

    function bulkSetFlow(state, entries, deps) {
      var next = cloneState(state);
      var changed = 0;
      var now = deps ? deps.now() : 0;
      entries.forEach(function (entry) {
        var located = resolveCard(next, entry.ref);
        if (!located) return;
        var result = Lifecycle.setFlowState(located.card, entry.flow, typeof entry.reason === 'string' ? entry.reason : '', now);
        if (result.changed) {
          located.card.flow = result.card.flow;
          located.card.updatedAt = result.card.updatedAt;
          changed += 1;
        }
      });
      if (changed === 0) return { changed: false, state: state, value: null, reason: 'no-change' };
      return { changed: true, state: next, value: changed };
    }

    function bulkUpdate(state, cardRefs, patch, deps) {
      var next = cloneState(state);
      var changed = false;
      cardRefs.forEach(function (ref) {
        var located = resolveCard(next, ref);
        if (!located) return;
        Object.keys(patch || {}).forEach(function (key) {
          if (key === 'id' || key === 'columnId' || key === 'createdAt' || key === '__proto__' || key === 'constructor' || key === 'prototype') return;
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
      bulkSetLabels: bulkSetLabels,
      bulkSetFlow: bulkSetFlow,
      bulkArchive: bulkArchive
    };
  }
);
