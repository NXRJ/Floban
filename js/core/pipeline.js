(function (root, factory) {
  var lifecycleCore = (typeof module === 'object' && module.exports)
    ? require('./lifecycle.js')
    : root.KB.Core.Lifecycle;
  var policiesCore = (typeof module === 'object' && module.exports)
    ? require('./policies.js')
    : root.KB.Core.Policies;
  var api = factory(lifecycleCore, policiesCore, root);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Pipeline = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function (Lifecycle, Policies, root) {
    function recurrenceCore() {
      // Resolved lazily (not factory-injected) to break the load-time cycle:
      // pipeline.js is loaded before recurrence.js in index.html, and Node
      // require() at call time returns the fully-initialized module.
      if (typeof module === 'object' && module.exports) return require('./recurrence.js');
      return (root.KB.Core && root.KB.Core.Recurrence) || null;
    }

    function placeCard(next, card, fromColumn, targetBoard, targetColumn, opts, deps) {
      var options = opts || {};
      var now = deps && typeof deps.now === 'function' ? deps.now() : 0;
      var sameColumn = fromColumn !== null && fromColumn !== undefined && fromColumn.id === targetColumn.id;

      if (options.checkPolicy !== false) {
        var evaluation = Policies.evaluateMovePolicy(next, { boardId: targetBoard.id, cardId: card.id }, { boardId: targetBoard.id, columnId: targetColumn.id }, {
          sourceColumn: fromColumn,
          confirmed: Boolean(options.confirmed),
          overrideReason: options.overrideReason
        });
        if (!evaluation.allowed) {
          return { changed: false, state: next, value: null, reason: 'policy', evaluation: evaluation };
        }
        if (options.rejectOnConfirmation && evaluation.requiresConfirmation && !options.confirmed) {
          return { changed: false, state: next, value: null, reason: 'policy', evaluation: evaluation };
        }
      }

      if (fromColumn !== null && fromColumn !== undefined) {
        var fromIndex = fromColumn.cards.findIndex(function (c) { return c.id === card.id; });
        if (fromIndex === -1) return { changed: false, state: next, value: null, reason: 'card-not-found' };
        fromColumn.cards.splice(fromIndex, 1);
      }

      var prevMovedAt = card.movedAt;
      if (sameColumn && options.sameColumnMode === 'preserve') {
        card.columnId = targetColumn.id;
      } else {
        var transition = Lifecycle.transitionCard(card, fromColumn, targetColumn, now);
        card = transition.card;
        if (sameColumn && typeof prevMovedAt === 'number') card.movedAt = prevMovedAt;
      }

      if (Array.isArray(options.labelMapping)) {
        card.labels = options.labelMapping.slice();
      }
      if (options.applyDefaults !== false) {
        card = Policies.applyEntryDefaults(card, targetColumn);
      }

      if (typeof options.toIndex === 'number') {
        var index = Math.max(0, Math.min(options.toIndex, targetColumn.cards.length));
        targetColumn.cards.splice(index, 0, card);
      } else {
        targetColumn.cards.push(card);
      }

      if (options.recurrenceSideEffect !== false && card.recurrenceId && typeof card.completedAt === 'number') {
        var recurCore = recurrenceCore();
        if (recurCore) {
          var side = recurCore.handleRecurringCardCompletion(next, { boardId: targetBoard.id, cardId: card.id }, now, deps);
          if (side && side.changed) {
            // Copy the changed recurrence fields back in place so references
            // the caller already holds stay attached to the same objects.
            side.state.recurrences.forEach(function (rec) {
              var existing = next.recurrences.find(function (r) { return r.id === rec.id; });
              if (existing) {
                Object.keys(rec).forEach(function (key) { existing[key] = rec[key]; });
              }
            });
          }
        }
      }

      return { changed: true, state: next, value: card };
    }

    return {
      placeCard: placeCard
    };
  }
);
