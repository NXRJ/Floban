(function (KB) {
  var internal = KB.State.internal;
  var state = internal.state;
  var replaceState = internal.replaceState;
  var deps = internal.deps;
  var now = internal.now;
  var uid = internal.uid;
  var data = internal.data;
  var commit = internal.commit;
  var wrapResult = internal.wrapResult;
  var noop = internal.noop;
  var cloneState = internal.cloneState;
  var safePatchKeys = internal.safePatchKeys;
  var pushHistory = internal.pushHistory;
  var save = internal.save;
  var activeBoard = internal.activeBoard;
  var boardForColumn = internal.boardForColumn;
  var findColumn = internal.findColumn;
  var findCard = internal.findCard;
  var findCardInBoard = internal.findCardInBoard;
  function addCard(columnId, data, opts) {
    return commit(function (current) {
      return KB.Core.Operations.createCard(current, {
        columnId: columnId,
        data: data,
        confirmed: opts && opts.confirmed,
        overrideReason: opts && opts.overrideReason
      }, deps());
    });
  }

  function addCards(columnId, titles, opts) {
    var cleanTitles = (Array.isArray(titles) ? titles : []).filter(function (title) {
      return typeof title === 'string' && title.trim();
    }).map(function (title) {
      return title.trim();
    });
    if (cleanTitles.length === 0) return 0;
    return commit(function (current) {
      return KB.Core.Operations.createCards(current, {
        columnId: columnId,
        titles: cleanTitles,
        confirmed: opts && opts.confirmed,
        overrideReason: opts && opts.overrideReason
      }, deps());
    });
  }

  function updateCard(columnId, cardId, patch) {
    var board = boardForColumn(columnId);
    var card = findCardInBoard(board, columnId, cardId);
    if (!card) return false;
    pushHistory();
    var safePatch = {};
    safePatchKeys(patch).forEach(function (key) {
      safePatch[key] = patch[key];
    });
    Object.assign(card, safePatch, { updatedAt: now() });
    save();
    return true;
  }

  function locateCard(current, columnId, cardId, boardId) {
    var board = null;
    var preferred = null;
    for (var i = 0; i < current.boards.length; i++) {
      var b = current.boards[i];
      if (b.id === boardId) preferred = b;
      if (!board && b.columns.some(function (c) { return c.id === columnId; })) board = b;
    }
    if (boardId && preferred && preferred.columns.some(function (c) { return c.id === columnId; })) board = preferred;
    if (!board && preferred) board = preferred;
    if (!board) return null;
    var column = board.columns.find(function (c) { return c.id === columnId; });
    var card = column ? column.cards.find(function (c) { return c.id === cardId; }) : null;
    if (!column || !card) return null;
    return { board: board, column: column, card: card };
  }

  // Board/column/card resolution for card ops that need the card's INDEX
  // (archive, duplicate): prefers the explicit boardId when it actually
  // holds the column, otherwise scans every board. Returns
  // { board, column, index } or { error: 'column-not-found' | 'card-not-found' }.
  function locateColumnCard(current, columnId, cardId, boardId) {
    var board = null;
    if (boardId) {
      var candidate = current.boards.find(function (b) { return b.id === boardId; });
      if (candidate && candidate.columns.some(function (c) { return c.id === columnId; })) board = candidate;
    }
    if (!board) {
      for (var i = 0; i < current.boards.length; i++) {
        if (current.boards[i].columns.some(function (c) { return c.id === columnId; })) {
          board = current.boards[i];
          break;
        }
      }
    }
    if (!board) return { error: 'column-not-found' };
    var column = board.columns.find(function (c) { return c.id === columnId; });
    var index = column ? column.cards.findIndex(function (c) { return c.id === cardId; }) : -1;
    if (index === -1) return { error: 'card-not-found' };
    return { board: board, column: column, index: index };
  }

  // Deep-clone the state and reach the located card inside the clone.
  function cloneLocated(current, located) {
    var next = cloneState(current);
    var nextBoard = next.boards.find(function (b) { return b.id === located.board.id; });
    var nextColumn = nextBoard.columns.find(function (c) { return c.id === located.column.id; });
    var nextCard = nextColumn.cards.find(function (c) { return c.id === located.card.id; });
    return { next: next, nextBoard: nextBoard, nextColumn: nextColumn, nextCard: nextCard };
  }

  function setFlowState(columnId, cardId, nextState, reason, boardId) {
    return commit(function (current) {
      var located = locateCard(current, columnId, cardId, boardId);
      if (!located) return noop(current, 'card-not-found');
      var result = KB.Core.Lifecycle.setFlowState(located.card, nextState, reason || '', now());
      if (!result.changed) return noop(current, result.reason);
      var cloned = cloneLocated(current, located);
      var updated = result.card;
      cloned.nextCard.flow = updated.flow;
      cloned.nextCard.updatedAt = updated.updatedAt;
      return { changed: true, state: cloned.next, value: cloned.nextCard.flow };
    });
  }

  function updateCardWithFlow(columnId, cardId, patch, flowState, flowReason, boardId) {
    return commit(function (current) {
      var located = locateCard(current, columnId, cardId, boardId);
      if (!located) return noop(current, 'card-not-found');
      var cloned = cloneLocated(current, located);
      var changed = false;
      var flowResult = null;
      if (flowState) {
        var prevState = located.card.flow && located.card.flow.state ? located.card.flow.state : 'normal';
        var prevReason = located.card.flow && located.card.flow.reason ? located.card.flow.reason : '';
        if (flowState !== prevState || (flowState !== 'normal' && flowReason !== prevReason)) {
          flowResult = KB.Core.Lifecycle.setFlowState(located.card, flowState, flowReason || '', now());
          if (flowResult.changed) {
            cloned.nextCard.flow = flowResult.card.flow;
            changed = true;
          }
        }
      }
      // Same prototype-pollution hygiene as updateCard: patch keys must not
      // touch __proto__/constructor/prototype. Values are deep-compared —
      // array fields (checklist, labels) get fresh references on every modal
      // save, so a plain !== would mark an unchanged save as dirty.
      safePatchKeys(patch).forEach(function (key) {
        if (JSON.stringify(cloned.nextCard[key]) !== JSON.stringify(patch[key])) {
          cloned.nextCard[key] = patch[key];
          changed = true;
        }
      });
      if (!changed) return noop(current, 'no-change');
      cloned.nextCard.updatedAt = now();
      return { changed: true, state: cloned.next, value: cloned.nextCard };
    });
  }

  function moveCard(columnId, cardId, targetColumnId, toIndex, opts) {
    return commit(function (current) {
      return KB.Core.Operations.moveCard(current, {
        columnId: columnId,
        cardId: cardId,
        targetColumnId: targetColumnId,
        toIndex: toIndex,
        confirmed: opts && opts.confirmed,
        overrideReason: opts && opts.overrideReason
      }, deps());
    });
  }

  function evaluateMove(columnId, cardId, targetColumnId, opts) {
    var board = activeBoard();
    var source = findColumn(columnId);
    var target = findColumn(targetColumnId);
    var card = findCard(columnId, cardId);
    if (!source || !target || !card) return null;
    return KB.Core.Policies.evaluateMovePolicy(data(), { boardId: board.id, cardId: cardId }, { boardId: board.id, columnId: targetColumnId }, {
      sourceColumn: source,
      confirmed: opts && opts.confirmed,
      overrideReason: opts && opts.overrideReason
    });
  }

  function moveCardChecked(columnId, cardId, targetColumnId, toIndex, opts) {
    var evaluation = evaluateMove(columnId, cardId, targetColumnId, opts);
    if (!evaluation) return { ok: false, reason: 'move-unavailable' };
    if (!evaluation.allowed) return { ok: false, reason: 'policy', evaluation: evaluation };
    var value = moveCard(columnId, cardId, targetColumnId, toIndex, opts);
    if (value === null) return { ok: false, reason: 'move-failed' };
    return { ok: true, value: value };
  }

  // Find a board and the column that holds a card (cross-board moves). Both
  // fields can be null independently so callers keep their reason strings.
  function locateBoardCard(current, boardId, cardId) {
    var board = current.boards.find(function (b) { return b.id === boardId; });
    if (!board) return { board: null, source: null };
    var source = board.columns.find(function (c) {
      return c.cards.some(function (card) { return card.id === cardId; });
    });
    return { board: board, source: source || null };
  }

  function evaluateMoveTo(boardId, cardId, targetBoardId, targetColumnId, opts) {
    var current = data();
    var located = locateBoardCard(current, boardId, cardId);
    var targetBoard = current.boards.find(function (b) { return b.id === targetBoardId; });
    if (!located.board || !located.source || !targetBoard) return null;
    var target = targetBoard.columns.find(function (c) { return c.id === targetColumnId; });
    if (!target) return null;
    return KB.Core.Policies.evaluateMovePolicy(current, { boardId: boardId, cardId: cardId }, { boardId: targetBoardId, columnId: targetColumnId }, {
      sourceColumn: located.source,
      confirmed: opts && opts.confirmed,
      overrideReason: opts && opts.overrideReason
    });
  }

  function moveCardTo(boardId, cardId, targetBoardId, targetColumnId, toIndex, opts) {
    var result = wrapResult(function (current) {
      return moveCardToCommit(current, boardId, cardId, targetBoardId, targetColumnId, toIndex, opts);
    })();
    if (!result || !result.changed) {
      return { ok: false, reason: (result && result.reason) || 'move-failed', evaluation: result && result.evaluation };
    }
    return { ok: true, value: result.value };
  }

  function moveCardToCommit(current, boardId, cardId, targetBoardId, targetColumnId, toIndex, opts) {
    var located = locateBoardCard(current, boardId, cardId);
    var targetBoard = current.boards.find(function (b) { return b.id === targetBoardId; });
    if (!located.board || !targetBoard) return noop(current, 'board-not-found');
    if (!located.source) return noop(current, 'card-not-found');
    var target = targetBoard.columns.find(function (c) { return c.id === targetColumnId; });
    if (!target) return noop(current, 'column-not-found');
    var next = cloneState(current);
    var nextBoard = next.boards.find(function (b) { return b.id === boardId; });
    var nextTargetBoard = next.boards.find(function (b) { return b.id === targetBoardId; });
    var nextSource = nextBoard.columns.find(function (c) {
      return c.cards.some(function (card) { return card.id === cardId; });
    });
    var nextTarget = nextTargetBoard.columns.find(function (c) { return c.id === targetColumnId; });
    var index = nextSource.cards.findIndex(function (c) { return c.id === cardId; });
    var card = nextSource.cards[index];
    var result = KB.Core.Pipeline.placeCard(next, card, nextSource, nextTargetBoard, nextTarget, {
      toIndex: typeof toIndex === 'number' ? toIndex : undefined,
      labelMapping: opts && opts.labelMapping,
      confirmed: opts && opts.confirmed,
      overrideReason: opts && opts.overrideReason
    }, deps());
    if (!result.changed) {
      return { changed: false, state: current, value: null, reason: result.reason, evaluation: result.evaluation };
    }
    return { changed: true, state: next, value: result.value };
  }

  function evaluateCreate(columnId, incomingCount) {
    var board = boardForColumn(columnId);
    var column = board ? board.columns.find(function (c) { return c.id === columnId; }) : null;
    if (!board || !column) return null;
    // The evaluator counts the incoming card implicitly (breach when
    // count >= limit), so pass only the cards BEYOND the first one:
    // a batch of N cards over a column with c cards breaches exactly
    // when c + N > limit.
    var extraCards = Math.max(0, (incomingCount || 0) - 1);
    return KB.Core.Policies.evaluateMovePolicy(data(), { boardId: board.id, cardId: '' }, { boardId: board.id, columnId: columnId }, {
      sourceColumn: null,
      pendingCount: extraCards
    });
  }

  function createNeedsConfirmation(columnId, incomingCount) {
    var evaluation = evaluateCreate(columnId, incomingCount);
    if (evaluation && (!evaluation.allowed || evaluation.requiresConfirmation)) return evaluation;
    return null;
  }

  function restoreCardChecked(cardId, opts) {
    var board = activeBoard();
    var index = board.archive.cards.findIndex(function (c) { return c.id === cardId; });
    if (index === -1) return { ok: false, reason: 'card-not-found' };
    var card = board.archive.cards[index];
    var column = findColumn(card.columnId) || board.columns[0] || null;
    if (column) {
      var evaluation = KB.Core.Policies.evaluateMovePolicy(data(), { boardId: board.id, cardId: cardId }, { boardId: board.id, columnId: column.id }, {
        confirmed: opts && opts.confirmed,
        overrideReason: opts && opts.overrideReason
      });
      if (!evaluation.allowed || (evaluation.requiresConfirmation && !(opts && opts.confirmed))) {
        return { ok: false, reason: 'policy', evaluation: evaluation };
      }
    }
    return { ok: true, value: restoreCard(cardId, opts) };
  }

  function archiveCard(columnId, cardId, boardId) {
    return commit(function (current) {
      var located = locateColumnCard(current, columnId, cardId, boardId);
      if (located.error) return noop(current, located.error);
      var next = cloneState(current);
      var nextBoard = next.boards.find(function (b) { return b.id === located.board.id; });
      var nextColumn = nextBoard.columns.find(function (c) { return c.id === columnId; });
      var nextCard = nextColumn.cards.splice(located.index, 1)[0];
      nextCard.archivedAt = now();
      nextCard.fromColumn = located.column.title;
      nextBoard.archive.cards.push(nextCard);
      return { changed: true, state: next, value: nextCard };
    });
  }

  function duplicateCard(columnId, cardId, boardId) {
    return commit(function (current) {
      var located = locateColumnCard(current, columnId, cardId, boardId);
      if (located.error) return noop(current, located.error);
      var next = cloneState(current);
      var nextBoard = next.boards.find(function (b) { return b.id === located.board.id; });
      var nextColumn = nextBoard.columns.find(function (c) { return c.id === columnId; });
      var card = nextColumn.cards[located.index];
      var copy = KB.Core.Model.createCard(columnId, Object.assign({}, card, {
        id: uid(),
        title: 'Copy of ' + card.title,
        createdAt: now(),
        updatedAt: now(),
        movedAt: now(),
        labels: (card.labels || []).slice(),
        checklist: KB.Core.Model.cloneChecklist(card.checklist, deps()),
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
      }), deps());
      nextColumn.cards.splice(located.index + 1, 0, copy);
      return { changed: true, state: next, value: copy };
    });
  }

  function restoreCard(cardId, opts) {
    return commit(function (current) {
      return KB.Core.Operations.restoreCard(current, {
        cardId: cardId,
        confirmed: opts && opts.confirmed,
        overrideReason: opts && opts.overrideReason
      }, deps());
    });
  }

  function restoreColumn(columnId) {
    return commit(function (current) {
      return KB.Core.Operations.restoreColumn(current, { columnId: columnId }, deps());
    });
  }

  function purgeCard(cardId) {
    var board = activeBoard();
    var index = board.archive.cards.findIndex(function (c) { return c.id === cardId; });
    if (index === -1) return false;
    var purgedRef = { boardId: board.id, cardId: cardId };
    pushHistory();
    replaceState(KB.Core.Relations.cleanupCardReferences(state(), purgedRef));
    board = activeBoard();
    board.archive.cards.splice(index, 1);
    save();
    return true;
  }

  function purgeColumn(columnId) {
    var result = commit(function (current) {
      var board = activeBoard();
      return KB.Core.Relations.purgeArchiveColumn(current, board.id, columnId);
    });
    return Boolean(result);
  }


  KB.State.addCard = addCard;
  KB.State.addCards = addCards;
  KB.State.updateCard = updateCard;
  KB.State.setFlowState = setFlowState;
  KB.State.updateCardWithFlow = updateCardWithFlow;
  KB.State.moveCard = moveCard;
  KB.State.evaluateMove = evaluateMove;
  KB.State.evaluateMoveTo = evaluateMoveTo;
  KB.State.createNeedsConfirmation = createNeedsConfirmation;
  KB.State.moveCardChecked = moveCardChecked;
  KB.State.moveCardTo = moveCardTo;
  KB.State.restoreCardChecked = restoreCardChecked;
  KB.State.duplicateCard = duplicateCard;
  KB.State.archiveCard = archiveCard;
  KB.State.restoreCard = restoreCard;
  KB.State.restoreColumn = restoreColumn;
  KB.State.purgeCard = purgeCard;
  KB.State.purgeColumn = purgeColumn;
})(window.KB = window.KB || {});
