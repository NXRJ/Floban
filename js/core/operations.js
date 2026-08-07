(function (root, factory) {
  var modelCore = (typeof module === 'object' && module.exports)
    ? require('./model.js')
    : root.KB.Core.Model;
  var pipelineCore = (typeof module === 'object' && module.exports)
    ? require('./pipeline.js')
    : root.KB.Core.Pipeline;
  var api = factory(modelCore, pipelineCore);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Operations = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function (Model, Pipeline) {
    function resolveDeps(deps) {
      if (!deps || typeof deps.uid !== 'function' || typeof deps.now !== 'function') {
        throw new Error('core operations require { uid, now } dependencies');
      }
      return deps;
    }

    function cloneState(state) {
      return JSON.parse(JSON.stringify(state));
    }

    function noop(state, reason) {
      return { changed: false, state: state, value: null, reason: reason };
    }

    function activeBoard(state) {
      return state.boards.find(function (b) { return b.id === state.activeBoardId; }) || state.boards[0] || null;
    }

    function findColumn(board, id) {
      if (!board) return null;
      return board.columns.find(function (c) { return c.id === id; }) || null;
    }

    function findCard(column, cardId) {
      if (!column) return null;
      return column.cards.find(function (c) { return c.id === cardId; }) || null;
    }

    function labelInUse(board, labelId) {
      function uses(cards) {
        return (cards || []).some(function (c) { return (c.labels || []).indexOf(labelId) !== -1; });
      }
      if (board.columns.some(function (c) { return uses(c.cards); })) return true;
      if (uses(board.archive.cards)) return true;
      if ((board.templates || []).some(function (t) { return (t.labels || []).indexOf(labelId) !== -1; })) return true;
      if (board.archive.columns.some(function (c) { return uses(c.cards); })) return true;
      return false;
    }

    function findBoardForColumn(state, columnId) {
      var active = activeBoard(state);
      if (active && active.columns.some(function (c) { return c.id === columnId; })) return active;
      for (var i = 0; i < state.boards.length; i++) {
        var board = state.boards[i];
        if (board.columns.some(function (c) { return c.id === columnId; })) return board;
      }
      return null;
    }

    function createCard(state, command, deps) {
      var d = resolveDeps(deps);
      var next = cloneState(state);
      var board = findBoardForColumn(next, command.columnId);
      if (!board) return noop(state, 'column-not-found');
      var column = board.columns.find(function (c) { return c.id === command.columnId; });
      var card = Model.createCard(command.columnId, command.data || {}, d);
      var placed = Pipeline.placeCard(next, card, null, board, column, {
        rejectOnConfirmation: true,
        confirmed: Boolean(command.confirmed),
        overrideReason: command.overrideReason
      }, d);
      if (!placed.changed) {
        return { changed: false, state: state, value: null, reason: placed.reason, evaluation: placed.evaluation };
      }
      return { changed: true, state: next, value: placed.value };
    }

    function createCards(state, command, deps) {
      var d = resolveDeps(deps);
      var next = cloneState(state);
      var board = findBoardForColumn(next, command.columnId);
      if (!board) return { changed: false, state: state, value: 0, reason: 'column-not-found' };
      var column = board.columns.find(function (c) { return c.id === command.columnId; });
      var titles = Array.isArray(command.titles) ? command.titles : [];
      var created = [];
      var failed = null;
      titles.forEach(function (title) {
        if (failed) return;
        var card = Model.createCard(command.columnId, { title: title }, d);
        var placed = Pipeline.placeCard(next, card, null, board, column, {
          rejectOnConfirmation: true,
          confirmed: Boolean(command.confirmed),
          overrideReason: command.overrideReason
        }, d);
        if (!placed.changed) {
          failed = placed;
          return;
        }
        created.push(placed.value);
      });
      if (failed || created.length === 0) {
        return { changed: false, state: state, value: 0, reason: 'policy', evaluation: failed && failed.evaluation };
      }
      return { changed: true, state: next, value: created.length };
    }

    function moveCard(state, command, deps) {
      var d = resolveDeps(deps);
      var next = cloneState(state);
      var board = activeBoard(next);
      var source = findColumn(board, command.columnId);
      var target = findColumn(board, command.targetColumnId);
      if (!source || !target) return noop(state, 'column-not-found');
      var fromIndex = source.cards.findIndex(function (c) { return c.id === command.cardId; });
      if (fromIndex === -1) return noop(state, 'card-not-found');
      var index = command.toIndex;
      if (command.columnId === command.targetColumnId && fromIndex < index) index -= 1;
      index = Math.max(0, Math.min(index, target.cards.length));
      if (command.columnId === command.targetColumnId && index === fromIndex) {
        return noop(state, 'no-position-change');
      }
      var card = source.cards[fromIndex];
      var result = Pipeline.placeCard(next, card, source, board, target, {
        toIndex: index,
        sameColumnMode: command.columnId === command.targetColumnId ? 'preserve' : 'transition',
        confirmed: Boolean(command.confirmed),
        overrideReason: command.overrideReason
      }, d);
      if (!result.changed) {
        return noop(state, result.reason);
      }
      return { changed: true, state: next, value: result.value };
    }

    function duplicateCard(state, command, deps) {
      var d = resolveDeps(deps);
      var next = cloneState(state);
      var board = activeBoard(next);
      var column = findColumn(board, command.columnId);
      if (!column) return noop(state, 'column-not-found');
      var index = column.cards.findIndex(function (c) { return c.id === command.cardId; });
      if (index === -1) return noop(state, 'card-not-found');
      var card = column.cards[index];
      var copy = Model.createCard(command.columnId, Object.assign({}, card, {
        id: d.uid(),
        title: 'Copy of ' + card.title,
        createdAt: d.now(),
        updatedAt: d.now(),
        movedAt: d.now(),
        labels: (card.labels || []).slice(),
        checklist: Model.cloneChecklist(card.checklist, deps),
        archivedAt: null,
        fromColumn: '',
        priority: card.priority || 'none',
        size: card.size || 'none',
        startedAt: null,
        completedAt: null,
        flow: { state: 'normal', reason: '', since: null, periods: [] },
        dependencies: { blockers: [], related: [] },
        recurrenceId: null,
        transitions: []
      }), deps);
      column.cards.splice(index + 1, 0, copy);
      return { changed: true, state: next, value: copy };
    }

    function archiveCard(state, command, deps) {
      var d = resolveDeps(deps);
      var next = cloneState(state);
      var board = activeBoard(next);
      var column = findColumn(board, command.columnId);
      if (!column) return noop(state, 'column-not-found');
      var index = column.cards.findIndex(function (c) { return c.id === command.cardId; });
      if (index === -1) return noop(state, 'card-not-found');
      var card = column.cards[index];
      column.cards.splice(index, 1);
      card.archivedAt = d.now();
      card.fromColumn = column.title;
      board.archive.cards.push(card);
      return { changed: true, state: next, value: card };
    }

    function restoreCard(state, command, deps) {
      var d = resolveDeps(deps);
      var next = cloneState(state);
      var board = activeBoard(next);
      var index = board.archive.cards.findIndex(function (c) { return c.id === command.cardId; });
      if (index === -1) return noop(state, 'card-not-found');
      var card = board.archive.cards.splice(index, 1)[0];
      var column = findColumn(board, card.columnId) || board.columns[0] || null;
      if (!column) {
        column = Model.createColumn({ title: 'To Do', isDone: false }, deps);
        board.columns.push(column);
      }
      delete card.archivedAt;
      delete card.fromColumn;
      card.columnId = column.id;
      var result = Pipeline.placeCard(next, card, null, board, column, {
        confirmed: Boolean(command.confirmed),
        overrideReason: command.overrideReason
      }, d);
      if (!result.changed) {
        return noop(state, result.reason);
      }
      return { changed: true, state: next, value: result.value };
    }

    function deleteColumn(state, command, deps) {
      var d = resolveDeps(deps);
      var next = cloneState(state);
      var board = activeBoard(next);
      var index = board.columns.findIndex(function (c) { return c.id === command.columnId; });
      if (index === -1) return noop(state, 'column-not-found');
      var column = board.columns.splice(index, 1)[0];
      var archivedAt = d.now();
      column.cards.forEach(function (card) {
        card.archivedAt = archivedAt;
        card.fromColumn = column.title;
      });
      board.archive.columns.push({
        id: column.id,
        title: column.title,
        isDone: column.isDone,
        role: column.role,
        wipLimit: column.wipLimit,
        collapsed: column.collapsed,
        policy: column.policy,
        cards: column.cards,
        archivedAt: archivedAt
      });
      return { changed: true, state: next, value: column.cards.length };
    }

    function restoreColumn(state, command, deps) {
      var d = resolveDeps(deps);
      var next = cloneState(state);
      var board = activeBoard(next);
      var index = board.archive.columns.findIndex(function (c) { return c.id === command.columnId; });
      if (index === -1) return noop(state, 'column-not-found');
      var entry = board.archive.columns.splice(index, 1)[0];
      delete entry.archivedAt;
      var movedAt = d.now();
      entry.cards.forEach(function (card) {
        delete card.archivedAt;
        delete card.fromColumn;
        card.movedAt = movedAt;
      });
      board.columns.push(entry);
      return { changed: true, state: next, value: entry };
    }

    function duplicateBoard(state, command, deps) {
      var d = resolveDeps(deps);
      var next = cloneState(state);
      var source = next.boards.find(function (b) { return b.id === command.boardId; });
      if (!source) return noop(state, 'board-not-found');
      var copy = JSON.parse(JSON.stringify(source));
      copy.id = d.uid();
      copy.name = source.name + ' copy';
      next.boards.push(copy);
      next.activeBoardId = copy.id;
      return { changed: true, state: next, value: copy };
    }

    function deleteBoard(state, command) {
      var next = cloneState(state);
      if (next.boards.length <= 1) return noop(state, 'last-board');
      var index = next.boards.findIndex(function (b) { return b.id === command.boardId; });
      if (index === -1) return noop(state, 'board-not-found');
      next.boards.splice(index, 1);
      if (next.activeBoardId === command.boardId) {
        next.activeBoardId = next.boards[Math.min(index, next.boards.length - 1)].id;
      }
      return { changed: true, state: next, value: true };
    }

    function removeLabel(state, command) {
      var next = cloneState(state);
      var board = activeBoard(next);
      if (!board) return noop(state, 'board-not-found');
      var index = board.labels.findIndex(function (l) { return l.id === command.labelId; });
      if (index === -1) return noop(state, 'label-not-found');
      if (labelInUse(board, command.labelId)) {
        return { changed: false, state: state, value: false, reason: 'label-in-use' };
      }
      board.labels.splice(index, 1);
      return { changed: true, state: next, value: true };
    }

    return {
      activeBoard: activeBoard,
      findColumn: findColumn,
      findCard: findCard,
      labelInUse: labelInUse,
      createCard: createCard,
      createCards: createCards,
      moveCard: moveCard,
      duplicateCard: duplicateCard,
      archiveCard: archiveCard,
      restoreCard: restoreCard,
      deleteColumn: deleteColumn,
      restoreColumn: restoreColumn,
      duplicateBoard: duplicateBoard,
      deleteBoard: deleteBoard,
      removeLabel: removeLabel
    };
  }
);
