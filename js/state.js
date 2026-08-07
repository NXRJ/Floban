(function (KB) {
  var STORAGE_KEY = 'kanban.board.v1';
  var HISTORY_LIMIT = 50;

  var state = null;
  var history = KB.Core.History.createHistory(HISTORY_LIMIT);

  function uid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function now() {
    return Date.now();
  }

  function deps() {
    return { uid: uid, now: now };
  }

  function freshCard(columnId, overrides) {
    return KB.Core.Model.createCard(columnId, overrides, deps());
  }

  function freshColumn(overrides) {
    return KB.Core.Model.createColumn(overrides, deps());
  }

  function freshLabel(name, color) {
    return KB.Core.Model.createLabel(name, color, deps());
  }

  function freshBoard(name) {
    return KB.Core.Model.createBoard(name, deps());
  }

  function freshTemplate(overrides) {
    return KB.Core.Model.createTemplate(overrides, deps());
  }

  function defaults() {
    var board = freshBoard('My Board');
    var labels = [
      freshLabel('Bug', '#c81e14'),
      freshLabel('Feature', '#2a58c4'),
      freshLabel('Urgent', '#a34800'),
      freshLabel('Chore', '#6d30d6')
    ];
    board.labels = labels;
    var todo = freshColumn({ title: 'To Do', role: 'queue' });
    var progress = freshColumn({ title: 'In Progress', role: 'active' });
    var done = freshColumn({ title: 'Done', isDone: true, role: 'done' });

    function card(columnId, title, description, labelNames, assignee, extra) {
      return freshCard(columnId, Object.assign({
        title: title,
        description: description,
        labels: labelNames.map(function (name) {
          var label = labels.find(function (l) { return l.name === name; });
          return label ? label.id : null;
        }).filter(Boolean),
        assignee: assignee
      }, extra || {}));
    }

    todo.cards = [
      card(todo.id, 'Plan the weekly sync', 'Prepare the agenda and invite the team.', ['Chore'], 'Sam', { due: KB.Dom.isoDaysFromNow(0) }),
      card(todo.id, 'Redesign the dashboard', 'Sketch a new layout and review it with the design group.', ['Feature'], '', {
        checklist: [
          { id: uid(), text: 'Sketch layout', done: true },
          { id: uid(), text: 'Review with design group', done: false },
          { id: uid(), text: 'Hand off to development', done: false }
        ]
      })
    ];
    progress.cards = [
      card(progress.id, 'Fix card drag on touch screens', 'Pointer events fire twice on mobile browsers.', ['Bug', 'Urgent'], 'Alex', { due: KB.Dom.isoDaysFromNow(-2) }),
      card(progress.id, 'Write tests for the archive flow', 'Cover restore, purge and column delete paths.', ['Feature'], 'Sam', { due: KB.Dom.isoDaysFromNow(3) })
    ];
    done.cards = [
      card(done.id, 'Ship the onboarding flow', 'First-time user experience is live.', ['Feature'], 'Alex'),
      card(done.id, 'Set up CI pipeline', 'Build, lint and deploy on every push.', ['Chore'], '')
    ];

    board.columns = [todo, progress, done];
    board.templates = [
      freshTemplate({
        name: 'Bug report',
        title: 'Fix bug: ',
        description: 'What happened, what was expected, and steps to reproduce.',
        labels: labels.filter(function (l) { return l.name === 'Bug'; }).map(function (l) { return l.id; })
      })
    ];

    return {
      version: 3,
      theme: 'dark',
      activeBoardId: board.id,
      inbox: { items: [] },
      lenses: [],
      recurrences: [],
      boards: [board]
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1 && Array.isArray(parsed.columns)) {
          state = KB.Core.Migration.migrateV1(parsed, deps());
          save();
          return;
        }
        if (parsed && Array.isArray(parsed.boards) && parsed.boards.length > 0) {
          state = KB.Core.Migration.normalizeState(parsed, deps());
          save();
          return;
        }
      }
    } catch (err) {
      console.warn('Could not read saved board', err);
    }
    state = defaults();
    save();
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Could not persist board', err);
    }
  }

  function pushHistory() {
    history.record(state);
  }

  function undo() {
    var restored = history.undo(state);
    if (restored === null) return false;
    state = restored;
    save();
    return true;
  }

  function redo() {
    var restored = history.redo(state);
    if (restored === null) return false;
    state = restored;
    save();
    return true;
  }

  function commit(operation) {
    var result = operation(state);

    if (!result.changed) {
      return result.value;
    }

    pushHistory();
    state = result.state;
    save();

    return result.value;
  }

  function wrapResult(operation) {
    return function () {
      var result = null;
      commit(function (current) {
        result = operation(current);
        return result;
      });
      return result;
    };
  }

  function activeBoard() {
    return state.boards.find(function (b) { return b.id === state.activeBoardId; }) || state.boards[0] || null;
  }

  function boardForColumn(columnId) {
    var active = activeBoard();
    if (active && active.columns.some(function (c) { return c.id === columnId; })) return active;
    for (var i = 0; i < state.boards.length; i++) {
      var board = state.boards[i];
      for (var j = 0; j < board.columns.length; j++) {
        if (board.columns[j].id === columnId) return board;
      }
    }
    return null;
  }

  function boardById(boardId) {
    return state.boards.find(function (b) { return b.id === boardId; }) || null;
  }

  function findCardInBoard(board, columnId, cardId) {
    if (!board) return null;
    var column = board.columns.find(function (c) { return c.id === columnId; });
    if (!column) return null;
    return column.cards.find(function (c) { return c.id === cardId; }) || null;
  }

  function findColumn(id) {
    var board = activeBoard();
    if (!board) return null;
    return board.columns.find(function (c) { return c.id === id; }) || null;
  }

  function findCard(columnId, cardId) {
    var column = findColumn(columnId);
    if (!column) return null;
    return column.cards.find(function (c) { return c.id === cardId; }) || null;
  }

  function findLabel(id) {
    var board = activeBoard();
    if (!board) return null;
    return board.labels.find(function (l) { return l.id === id; }) || null;
  }

  function anyCardUsesLabel(labelId) {
    var board = activeBoard();
    if (!board) return false;
    return KB.Core.Operations.labelInUse(board, labelId);
  }

  function addColumn(title, isDone, skipHistory, role) {
    if (!skipHistory) pushHistory();
    var column = freshColumn({ title: title, isDone: Boolean(isDone), role: role || (isDone ? 'done' : 'queue') });
    activeBoard().columns.push(column);
    save();
    return column;
  }

  function updateColumn(id, patch) {
    var column = findColumn(id);
    if (!column) return false;

    var normalized = Object.assign({}, patch);
    if (patch.role && patch.role !== column.role) {
      normalized.isDone = patch.role === 'done';
    } else if (typeof patch.isDone === 'boolean' && patch.isDone !== column.isDone) {
      normalized.role = patch.isDone ? 'done' : (column.role === 'done' ? 'queue' : column.role);
    }

    pushHistory();
    Object.assign(column, normalized);
    save();
    return true;
  }

  function deleteColumn(id) {
    return commit(function (current) {
      return KB.Core.Operations.deleteColumn(current, { columnId: id }, deps());
    });
  }

  function moveColumn(id, toIndex) {
    var board = activeBoard();
    var fromIndex = board.columns.findIndex(function (c) { return c.id === id; });
    if (fromIndex === -1) return false;
    var index = toIndex;
    if (fromIndex < index) index -= 1;
    index = Math.max(0, Math.min(index, board.columns.length));
    if (index === fromIndex) return false;
    pushHistory();
    var column = board.columns.splice(fromIndex, 1)[0];
    board.columns.splice(index, 0, column);
    save();
    return true;
  }

  function addCard(columnId, data) {
    var board = boardForColumn(columnId);
    var column = board ? board.columns.find(function (c) { return c.id === columnId; }) : null;
    if (!column) return null;
    pushHistory();
    var card = freshCard(columnId, data);
    card.movedAt = card.createdAt;
    column.cards.push(card);
    save();
    return card;
  }

  function addCards(columnId, titles) {
    var board = boardForColumn(columnId);
    var column = board ? board.columns.find(function (c) { return c.id === columnId; }) : null;
    var cleanTitles = (Array.isArray(titles) ? titles : []).filter(function (title) {
      return typeof title === 'string' && title.trim();
    }).map(function (title) {
      return title.trim();
    });
    if (!column || cleanTitles.length === 0) return 0;
    pushHistory();
    var added = 0;
    cleanTitles.forEach(function (title) {
      var card = freshCard(columnId, { title: title });
      card.movedAt = card.createdAt;
      column.cards.push(card);
      added += 1;
    });
    save();
    return added;
  }

  function updateCard(columnId, cardId, patch) {
    var board = boardForColumn(columnId);
    var card = findCardInBoard(board, columnId, cardId);
    if (!card) return false;
    pushHistory();
    Object.assign(card, patch, { updatedAt: now() });
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

  function setFlowState(columnId, cardId, nextState, reason, boardId) {
    return commit(function (current) {
      var located = locateCard(current, columnId, cardId, boardId);
      if (!located) return { changed: false, state: current, value: null, reason: 'card-not-found' };
      var result = KB.Core.Lifecycle.setFlowState(located.card, nextState, reason || '', now());
      if (!result.changed) return { changed: false, state: current, value: null, reason: result.reason };
      var next = JSON.parse(JSON.stringify(current));
      var nextBoard = next.boards.find(function (b) { return b.id === located.board.id; });
      var nextColumn = nextBoard.columns.find(function (c) { return c.id === columnId; });
      var nextCard = nextColumn.cards.find(function (c) { return c.id === cardId; });
      var updated = result.card;
      nextCard.flow = updated.flow;
      nextCard.updatedAt = updated.updatedAt;
      return { changed: true, state: next, value: nextCard.flow };
    });
  }

  function updateCardWithFlow(columnId, cardId, patch, flowState, flowReason, boardId) {
    return commit(function (current) {
      var located = locateCard(current, columnId, cardId, boardId);
      if (!located) return { changed: false, state: current, value: null, reason: 'card-not-found' };
      var next = JSON.parse(JSON.stringify(current));
      var nextBoard = next.boards.find(function (b) { return b.id === located.board.id; });
      var nextColumn = nextBoard.columns.find(function (c) { return c.id === columnId; });
      var nextCard = nextColumn.cards.find(function (c) { return c.id === cardId; });
      var changed = false;
      var flowResult = null;
      if (flowState) {
        var prevState = located.card.flow && located.card.flow.state ? located.card.flow.state : 'normal';
        var prevReason = located.card.flow && located.card.flow.reason ? located.card.flow.reason : '';
        if (flowState !== prevState || (flowState !== 'normal' && flowReason !== prevReason)) {
          flowResult = KB.Core.Lifecycle.setFlowState(located.card, flowState, flowReason || '', now());
          if (flowResult.changed) {
            nextCard.flow = flowResult.card.flow;
            changed = true;
          }
        }
      }
      Object.keys(patch || {}).forEach(function (key) {
        if (nextCard[key] !== patch[key]) {
          nextCard[key] = patch[key];
          changed = true;
        }
      });
      if (!changed) return { changed: false, state: current, value: null, reason: 'no-change' };
      nextCard.updatedAt = now();
      return { changed: true, state: next, value: nextCard };
    });
  }

  function moveCard(columnId, cardId, targetColumnId, toIndex) {
    return commit(function (current) {
      return KB.Core.Operations.moveCard(current, {
        columnId: columnId,
        cardId: cardId,
        targetColumnId: targetColumnId,
        toIndex: toIndex
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
    var value = moveCard(columnId, cardId, targetColumnId, toIndex);
    if (value === null) return { ok: false, reason: 'move-failed' };
    return { ok: true, value: value };
  }

  function evaluateMoveTo(boardId, cardId, targetBoardId, targetColumnId, opts) {
    var current = data();
    var board = null;
    var targetBoard = null;
    var source = null;
    for (var i = 0; i < current.boards.length; i++) {
      if (current.boards[i].id === boardId) {
        board = current.boards[i];
        source = board.columns.find(function (c) {
          return c.cards.some(function (card) { return card.id === cardId; });
        });
      }
      if (current.boards[i].id === targetBoardId) targetBoard = current.boards[i];
    }
    if (!board || !targetBoard || !source) return null;
    var target = targetBoard.columns.find(function (c) { return c.id === targetColumnId; });
    if (!target) return null;
    return KB.Core.Policies.evaluateMovePolicy(current, { boardId: boardId, cardId: cardId }, { boardId: targetBoardId, columnId: targetColumnId }, {
      sourceColumn: source,
      confirmed: opts && opts.confirmed,
      overrideReason: opts && opts.overrideReason
    });
  }

  function moveCardTo(boardId, cardId, targetBoardId, targetColumnId, toIndex, opts) {
    return commit(function (current) {
      var board = null;
      for (var i = 0; i < current.boards.length; i++) {
        if (current.boards[i].id === boardId) { board = current.boards[i]; break; }
      }
      var targetBoard = null;
      for (var j = 0; j < current.boards.length; j++) {
        if (current.boards[j].id === targetBoardId) { targetBoard = current.boards[j]; break; }
      }
      if (!board || !targetBoard) return { changed: false, state: current, value: null, reason: 'board-not-found' };
      var source = board.columns.find(function (c) {
        return c.cards.some(function (card) { return card.id === cardId; });
      });
      if (!source) return { changed: false, state: current, value: null, reason: 'card-not-found' };
      var target = targetBoard.columns.find(function (c) { return c.id === targetColumnId; });
      if (!target) return { changed: false, state: current, value: null, reason: 'column-not-found' };
      var evaluation = KB.Core.Policies.evaluateMovePolicy(current, { boardId: boardId, cardId: cardId }, { boardId: targetBoardId, columnId: targetColumnId }, {
        sourceColumn: source,
        confirmed: opts && opts.confirmed,
        overrideReason: opts && opts.overrideReason
      });
      if (!evaluation.allowed) return { changed: false, state: current, value: null, reason: 'policy', evaluation: evaluation };
      var next = JSON.parse(JSON.stringify(current));
      var nextBoard = next.boards.find(function (b) { return b.id === boardId; });
      var nextTargetBoard = next.boards.find(function (b) { return b.id === targetBoardId; });
      var nextSource = nextBoard.columns.find(function (c) {
        return c.cards.some(function (card) { return card.id === cardId; });
      });
      var nextTarget = nextTargetBoard.columns.find(function (c) { return c.id === targetColumnId; });
      var index = nextSource.cards.findIndex(function (c) { return c.id === cardId; });
      var card = nextSource.cards.splice(index, 1)[0];
      var lifecycle = KB.Core.Lifecycle.transitionCard(card, source, target, now());
      card = lifecycle.card;
      card.columnId = targetColumnId;
      if (opts && Array.isArray(opts.labelMapping)) {
        card.labels = opts.labelMapping.slice();
      }
      card = KB.Core.Policies.applyEntryDefaults(card, target);
      var toIndex2 = Math.max(0, Math.min(typeof toIndex === 'number' ? toIndex : nextTarget.cards.length, nextTarget.cards.length));
      nextTarget.cards.splice(toIndex2, 0, card);
      return { changed: true, state: next, value: card };
    });
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
      if (!evaluation.allowed) return { ok: false, reason: 'policy', evaluation: evaluation };
    }
    return { ok: true, value: restoreCard(cardId) };
  }

  function archiveCard(columnId, cardId, boardId) {
    return commit(function (current) {
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
      if (!board) return { changed: false, state: current, value: null, reason: 'column-not-found' };
      var column = board.columns.find(function (c) { return c.id === columnId; });
      var index = column.cards.findIndex(function (c) { return c.id === cardId; });
      if (index === -1) return { changed: false, state: current, value: null, reason: 'card-not-found' };
      var next = JSON.parse(JSON.stringify(current));
      var nextBoard = next.boards.find(function (b) { return b.id === board.id; });
      var nextColumn = nextBoard.columns.find(function (c) { return c.id === columnId; });
      var nextCard = nextColumn.cards.splice(index, 1)[0];
      nextCard.archivedAt = now();
      nextCard.fromColumn = column.title;
      nextBoard.archive.cards.push(nextCard);
      return { changed: true, state: next, value: nextCard };
    });
  }

  function duplicateCard(columnId, cardId, boardId) {
    return commit(function (current) {
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
      if (!board) return { changed: false, state: current, value: null, reason: 'column-not-found' };
      var column = board.columns.find(function (c) { return c.id === columnId; });
      var index = column.cards.findIndex(function (c) { return c.id === cardId; });
      if (index === -1) return { changed: false, state: current, value: null, reason: 'card-not-found' };
      var next = JSON.parse(JSON.stringify(current));
      var nextBoard = next.boards.find(function (b) { return b.id === board.id; });
      var nextColumn = nextBoard.columns.find(function (c) { return c.id === columnId; });
      var card = nextColumn.cards[index];
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
      nextColumn.cards.splice(index + 1, 0, copy);
      return { changed: true, state: next, value: copy };
    });
  }

  function restoreCard(cardId) {
    return commit(function (current) {
      return KB.Core.Operations.restoreCard(current, { cardId: cardId }, deps());
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
    state = KB.Core.Relations.cleanupCardReferences(state, purgedRef);
    board = activeBoard();
    board.archive.cards.splice(index, 1);
    save();
    return true;
  }

  function purgeColumn(columnId) {
    var board = activeBoard();
    var index = board.archive.columns.findIndex(function (c) { return c.id === columnId; });
    if (index === -1) return false;
    pushHistory();
    board.archive.columns.splice(index, 1);
    save();
    return true;
  }

  function addLabel(name, color, boardId) {
    var board = boardId ? state.boards.find(function (b) { return b.id === boardId; }) : activeBoard();
    if (!board) return null;
    pushHistory();
    var label = freshLabel(name, color);
    board.labels.push(label);
    save();
    return label;
  }

  function removeLabel(labelId) {
    return commit(function (current) {
      return KB.Core.Operations.removeLabel(current, { labelId: labelId });
    });
  }

  function labelInUse(labelId) {
    return anyCardUsesLabel(labelId);
  }

  function labels() {
    return activeBoard().labels || [];
  }

  function assignees() {
    var board = activeBoard();
    var set = new Set();
    board.columns.forEach(function (column) {
      column.cards.forEach(function (card) {
        if (card.assignee) set.add(card.assignee);
      });
    });
    return Array.from(set).sort(function (a, b) { return a.localeCompare(b); });
  }

  function templates() {
    return activeBoard().templates || [];
  }

  function addTemplate(data) {
    pushHistory();
    var template = freshTemplate(data);
    activeBoard().templates.push(template);
    save();
    return template;
  }

  function boards() {
    return state.boards;
  }

  function addBoard(name) {
    pushHistory();
    var board = freshBoard(name);
    state.boards.push(board);
    state.activeBoardId = board.id;
    save();
    return board;
  }

  function renameBoard(id, name) {
    var board = state.boards.find(function (b) { return b.id === id; });
    if (!board) return false;
    if (board.name === name) return false;
    pushHistory();
    board.name = name;
    save();
    return true;
  }

  function duplicateBoard(id) {
    return commit(function (current) {
      return KB.Core.Operations.duplicateBoard(current, { boardId: id }, deps());
    });
  }

  function deleteBoard(id) {
    return commit(function (current) {
      var result = KB.Core.Operations.deleteBoard(current, { boardId: id });
      if (!result.changed) return result;
      return {
        changed: true,
        state: KB.Core.Relations.cleanupBoardReferences(result.state, id),
        value: result.value
      };
    });
  }

  function addBlocker(targetBoardId, targetCardId, blockerBoardId, blockerCardId) {
    return wrapResult(function (current) {
      return KB.Core.Relations.addBlocker(current, { boardId: targetBoardId, cardId: targetCardId }, { boardId: blockerBoardId, cardId: blockerCardId });
    })();
  }

  function removeBlocker(targetBoardId, targetCardId, blockerBoardId, blockerCardId) {
    return wrapResult(function (current) {
      return KB.Core.Relations.removeBlocker(current, { boardId: targetBoardId, cardId: targetCardId }, { boardId: blockerBoardId, cardId: blockerCardId });
    })();
  }

  function addRelated(leftBoardId, leftCardId, rightBoardId, rightCardId) {
    return wrapResult(function (current) {
      return KB.Core.Relations.addRelated(current, { boardId: leftBoardId, cardId: leftCardId }, { boardId: rightBoardId, cardId: rightCardId });
    })();
  }

  function removeRelated(leftBoardId, leftCardId, rightBoardId, rightCardId) {
    return wrapResult(function (current) {
      return KB.Core.Relations.removeRelated(current, { boardId: leftBoardId, cardId: leftCardId }, { boardId: rightBoardId, cardId: rightCardId });
    })();
  }

  function setActiveBoard(id) {
    if (!state.boards.some(function (b) { return b.id === id; })) return false;
    if (state.activeBoardId === id) return true;
    pushHistory();
    state.activeBoardId = id;
    save();
    return true;
  }

  function processRecurrences() {
    return wrapResult(function (current) {
      return KB.Core.Recurrence.processDueRecurrences(current, now(), deps());
    })();
  }

  function handleCardCompleted(boardId, cardId) {
    return commit(function (current) {
      var result = KB.Core.Recurrence.handleRecurringCardCompletion(current, { boardId: boardId, cardId: cardId }, now(), deps());
      return result;
    });
  }

  function addRecurrence(definition) {
    return commit(function (current) {
      var next = JSON.parse(JSON.stringify(current));
      var recurrence = KB.Core.Model.createRecurrence(definition, deps());
      next.recurrences.push(recurrence);
      return { changed: true, state: next, value: recurrence };
    });
  }

  function updateRecurrence(recurrenceId, patch) {
    return commit(function (current) {
      var next = JSON.parse(JSON.stringify(current));
      var recurrence = next.recurrences.find(function (r) { return r.id === recurrenceId; });
      if (!recurrence) return { changed: false, state: current, value: null, reason: 'not-found' };
      var changed = false;
      Object.keys(patch || {}).forEach(function (key) {
        if (JSON.stringify(recurrence[key]) !== JSON.stringify(patch[key])) {
          recurrence[key] = patch[key];
          changed = true;
        }
      });
      if (!changed) return { changed: false, state: current, value: null, reason: 'no-change' };
      recurrence.updatedAt = now();
      return { changed: true, state: next, value: recurrence };
    });
  }

  function deleteRecurrence(recurrenceId) {
    return commit(function (current) {
      var next = JSON.parse(JSON.stringify(current));
      var index = next.recurrences.findIndex(function (r) { return r.id === recurrenceId; });
      if (index === -1) return { changed: false, state: current, value: null, reason: 'not-found' };
      next.recurrences.splice(index, 1);
      return { changed: true, state: next, value: true };
    });
  }

  function pauseRecurrence(recurrenceId, reason) {
    return commit(function (current) {
      return KB.Core.Recurrence.pauseRecurrence(current, recurrenceId, reason, deps());
    });
  }

  function resumeRecurrence(recurrenceId) {
    return commit(function (current) {
      return KB.Core.Recurrence.resumeRecurrence(current, recurrenceId, deps());
    });
  }

  function runRecurrenceNow(recurrenceId) {
    return commit(function (current) {
      return KB.Core.Recurrence.runNow(current, recurrenceId, deps());
    });
  }

  function skipRecurrenceNext(recurrenceId) {
    return commit(function (current) {
      var next = JSON.parse(JSON.stringify(current));
      var recurrence = next.recurrences.find(function (r) { return r.id === recurrenceId; });
      if (!recurrence) return { changed: false, state: current, value: null, reason: 'not-found' };
      if (recurrence.nextRunAt === null) {
        recurrence.nextRunAt = KB.Core.Recurrence.computeNextRun(recurrence, now());
      } else {
        recurrence.nextRunAt = KB.Core.Recurrence.computeNextRun(recurrence, recurrence.nextRunAt);
      }
      recurrence.updatedAt = now();
      return { changed: true, state: next, value: recurrence };
    });
  }

  function endRecurrence(recurrenceId) {
    return commit(function (current) {
      var next = JSON.parse(JSON.stringify(current));
      var recurrence = next.recurrences.find(function (r) { return r.id === recurrenceId; });
      if (!recurrence) return { changed: false, state: current, value: null, reason: 'not-found' };
      if (recurrence.endAt !== null) return { changed: false, state: current, value: null, reason: 'already-ended' };
      recurrence.endAt = now();
      recurrence.updatedAt = now();
      return { changed: true, state: next, value: recurrence };
    });
  }

  function recurrences() {
    return state.recurrences || [];
  }

  function captureInbox(input) {
    return commit(function (current) {
      return KB.Core.Inbox.captureItem(current, input, deps());
    });
  }

  function captureInboxLines(text) {
    return commit(function (current) {
      return KB.Core.Inbox.captureLines(current, text, deps());
    });
  }

  function updateInboxItem(id, patch) {
    return commit(function (current) {
      return KB.Core.Inbox.updateInboxItem(current, id, patch, deps());
    });
  }

  function deleteInboxItem(id) {
    return commit(function (current) {
      return KB.Core.Inbox.deleteInboxItem(current, id);
    });
  }

  function triageInboxItem(id, target, cardPatch) {
    return commit(function (current) {
      return KB.Core.Inbox.triageInboxItem(current, id, target, cardPatch, deps());
    });
  }

  function convertInboxToRecurrence(inboxId, definition) {
    return commit(function (current) {
      var next = JSON.parse(JSON.stringify(current));
      var items = next.inbox && Array.isArray(next.inbox.items) ? next.inbox.items : [];
      var index = items.findIndex(function (it) { return it.id === inboxId; });
      if (index === -1) return { changed: false, state: current, value: null, reason: 'item-not-found' };
      items.splice(index, 1);
      var recurrence = KB.Core.Model.createRecurrence(definition, deps());
      next.recurrences.push(recurrence);
      return { changed: true, state: next, value: recurrence };
    });
  }

  function mergeInboxItem(inboxId, target) {
    return commit(function (current) {
      return KB.Core.Inbox.mergeIntoCard(current, inboxId, target, deps());
    });
  }

  function inboxItems() {
    return state.inbox && state.inbox.items ? state.inbox.items : [];
  }

  function addLens(definition) {
    return commit(function (current) {
      var next = JSON.parse(JSON.stringify(current));
      var lens = KB.Core.Lenses.normalizeLens(definition, deps());
      lens.id = uid();
      lens.createdAt = now();
      lens.updatedAt = now();
      next.lenses.push(lens);
      return { changed: true, state: next, value: lens };
    });
  }

  function updateLens(lensId, patch) {
    return commit(function (current) {
      var next = JSON.parse(JSON.stringify(current));
      var lens = next.lenses.find(function (l) { return l.id === lensId; });
      if (!lens) return { changed: false, state: current, value: null, reason: 'not-found' };
      var changed = false;
      Object.keys(patch || {}).forEach(function (key) {
        if (JSON.stringify(lens[key]) !== JSON.stringify(patch[key])) {
          lens[key] = patch[key];
          changed = true;
        }
      });
      if (!changed) return { changed: false, state: current, value: null, reason: 'no-change' };
      lens.updatedAt = now();
      return { changed: true, state: next, value: lens };
    });
  }

  function deleteLens(lensId) {
    return commit(function (current) {
      var next = JSON.parse(JSON.stringify(current));
      var index = next.lenses.findIndex(function (l) { return l.id === lensId; });
      if (index === -1) return { changed: false, state: current, value: null, reason: 'not-found' };
      next.lenses.splice(index, 1);
      return { changed: true, state: next, value: true };
    });
  }

  function lenses() {
    return state.lenses || [];
  }

  function bulkMove(cardRefs, target, opts) {
    return wrapResult(function (current) {
      return KB.Core.Bulk.bulkMove(current, cardRefs, target, deps(), opts);
    })();
  }

  function bulkUpdate(cardRefs, patch) {
    return wrapResult(function (current) {
      return KB.Core.Bulk.bulkUpdate(current, cardRefs, patch, deps());
    })();
  }

  function bulkArchive(cardRefs) {
    return wrapResult(function (current) {
      return KB.Core.Bulk.bulkArchive(current, cardRefs, deps());
    })();
  }

  function setTheme(theme) {
    pushHistory();
    state.theme = theme;
    save();
  }

  function exportAll() {
    return JSON.stringify(state, null, 2);
  }

  function exportBoard() {
    var board = activeBoard();
    var payload = JSON.parse(JSON.stringify(board));
    payload.recurrences = (state.recurrences || []).filter(function (rec) {
      return rec.target && rec.target.boardId === board.id;
    });
    payload.lenses = (state.lenses || []).filter(function (lens) {
      return lens.scope === 'selected-boards'
        ? lens.boardIds.length === 1 && lens.boardIds[0] === board.id
        : lens.scope === 'active-board';
    });
    return JSON.stringify(payload, null, 2);
  }

  function importAll(text) {
    var result = KB.Core.Migration.parseImportPayload(text, state, deps());
    if (result.kind === 'all') {
      pushHistory();
      state = result.state;
      save();
      return 'all';
    }
    if (result.kind === 'board') {
      pushHistory();
      if (Array.isArray(result.board.importedRecurrences)) {
        state.recurrences = (state.recurrences || []).concat(result.board.importedRecurrences);
      }
      if (Array.isArray(result.board.importedLenses)) {
        state.lenses = (state.lenses || []).concat(result.board.importedLenses);
      }
      state.boards.push(result.board);
      state.activeBoardId = result.board.id;
      save();
      return 'board';
    }
    return false;
  }

  function data() {
    return state;
  }

  KB.State = {
    load: load,
    data: data,
    activeBoard: activeBoard,
    boardById: boardById,
    findCardInBoard: findCardInBoard,
    boards: boards,
    findColumn: findColumn,
    findCard: findCard,
    findLabel: findLabel,
    addColumn: addColumn,
    updateColumn: updateColumn,
    deleteColumn: deleteColumn,
    moveColumn: moveColumn,
    addCard: addCard,
    addCards: addCards,
    updateCard: updateCard,
    setFlowState: setFlowState,
    updateCardWithFlow: updateCardWithFlow,
    moveCard: moveCard,
    evaluateMove: evaluateMove,
    evaluateMoveTo: evaluateMoveTo,
    moveCardChecked: moveCardChecked,
    moveCardTo: moveCardTo,
    restoreCardChecked: restoreCardChecked,
    duplicateCard: duplicateCard,
    archiveCard: archiveCard,
    restoreCard: restoreCard,
    restoreColumn: restoreColumn,
    purgeCard: purgeCard,
    purgeColumn: purgeColumn,
    addLabel: addLabel,
    removeLabel: removeLabel,
    labelInUse: labelInUse,
    labels: labels,
    assignees: assignees,
    templates: templates,
    addTemplate: addTemplate,
    addBoard: addBoard,
    renameBoard: renameBoard,
    duplicateBoard: duplicateBoard,
    deleteBoard: deleteBoard,
    addBlocker: addBlocker,
    removeBlocker: removeBlocker,
    addRelated: addRelated,
    removeRelated: removeRelated,
    setActiveBoard: setActiveBoard,
    processRecurrences: processRecurrences,
    handleCardCompleted: handleCardCompleted,
    addRecurrence: addRecurrence,
    updateRecurrence: updateRecurrence,
    deleteRecurrence: deleteRecurrence,
    pauseRecurrence: pauseRecurrence,
    resumeRecurrence: resumeRecurrence,
    runRecurrenceNow: runRecurrenceNow,
    skipRecurrenceNext: skipRecurrenceNext,
    endRecurrence: endRecurrence,
    recurrences: recurrences,
    captureInbox: captureInbox,
    captureInboxLines: captureInboxLines,
    updateInboxItem: updateInboxItem,
    deleteInboxItem: deleteInboxItem,
    triageInboxItem: triageInboxItem,
    convertInboxToRecurrence: convertInboxToRecurrence,
    mergeInboxItem: mergeInboxItem,
    inboxItems: inboxItems,
    addLens: addLens,
    updateLens: updateLens,
    deleteLens: deleteLens,
    lenses: lenses,
    bulkMove: bulkMove,
    bulkUpdate: bulkUpdate,
    bulkArchive: bulkArchive,
    setTheme: setTheme,
    exportAll: exportAll,
    exportBoard: exportBoard,
    importAll: importAll,
    undo: undo,
    redo: redo
  };
})(window.KB = window.KB || {});
