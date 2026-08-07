
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
    return KB.Core.Operations.findBoardForColumn(state, columnId);
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

  function mapLabelsAcrossBoards(sourceBoardId, card, targetBoard) {
    var dropped = [];
    var kept = [];
    var targetLabels = targetBoard.labels || [];
    var byNameColor = {};
    targetLabels.forEach(function (label) {
      byNameColor[label.name.toLowerCase() + '|' + label.color.toLowerCase()] = label.id;
    });
    var sourceBoard = boardById(sourceBoardId);
    var sourceLabels = sourceBoard ? sourceBoard.labels : [];
    var cardLabelIds = card.labels || [];
    cardLabelIds.forEach(function (id) {
      var source = sourceLabels.find(function (l) { return l.id === id; });
      if (!source) return;
      var match = targetLabels.find(function (l) { return l.id === id; });
      if (match) {
        kept.push(match.id);
        return;
      }
      var mapped = byNameColor[source.name.toLowerCase() + '|' + source.color.toLowerCase()];
      if (mapped) kept.push(mapped);
      else dropped.push(source.name);
    });
    return { kept: kept, dropped: dropped };
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


  function recurrences() {
    return state.recurrences || [];
  }

  function inboxItems() {
    return state.inbox && state.inbox.items ? state.inbox.items : [];
  }

  function lenses() {
    return state.lenses || [];
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
    addLabel: addLabel,
    removeLabel: removeLabel,
    labelInUse: labelInUse,
    mapLabelsAcrossBoards: mapLabelsAcrossBoards,
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
    recurrences: recurrences,
    inboxItems: inboxItems,
    lenses: lenses,
    setTheme: setTheme,
    exportAll: exportAll,
    exportBoard: exportBoard,
    importAll: importAll,
    undo: undo,
    redo: redo
  };

  KB.State.internal = {
    state: function () { return state; },
    replaceState: function (next) { state = next; },
    deps: deps,
    now: now,
    uid: uid,
    data: data,
    commit: commit,
    wrapResult: wrapResult,
    pushHistory: pushHistory,
    save: save,
    activeBoard: activeBoard,
    boardForColumn: boardForColumn,
    boardById: boardById,
    findColumn: findColumn,
    findCard: findCard,
    findCardInBoard: findCardInBoard
  };
})(window.KB = window.KB || {});
