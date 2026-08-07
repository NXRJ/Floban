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

  function activeBoard() {
    return state.boards.find(function (b) { return b.id === state.activeBoardId; }) || state.boards[0] || null;
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

  function addColumn(title, isDone, skipHistory) {
    if (!skipHistory) pushHistory();
    var column = freshColumn({ title: title, isDone: Boolean(isDone) });
    activeBoard().columns.push(column);
    save();
    return column;
  }

  function updateColumn(id, patch) {
    var column = findColumn(id);
    if (!column) return false;

    pushHistory();
    Object.assign(column, patch);
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
    var column = findColumn(columnId);
    if (!column) return null;
    pushHistory();
    var card = freshCard(columnId, data);
    card.movedAt = card.createdAt;
    column.cards.push(card);
    save();
    return card;
  }

  function addCards(columnId, titles) {
    var column = findColumn(columnId);
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
    var card = findCard(columnId, cardId);
    if (!card) return false;
    pushHistory();
    Object.assign(card, patch, { updatedAt: now() });
    save();
    return true;
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

  function duplicateCard(columnId, cardId) {
    return commit(function (current) {
      return KB.Core.Operations.duplicateCard(current, { columnId: columnId, cardId: cardId }, deps());
    });
  }

  function archiveCard(columnId, cardId) {
    return commit(function (current) {
      return KB.Core.Operations.archiveCard(current, { columnId: columnId, cardId: cardId }, deps());
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
    pushHistory();
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

  function addLabel(name, color) {
    pushHistory();
    var label = freshLabel(name, color);
    activeBoard().labels.push(label);
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
      return KB.Core.Operations.deleteBoard(current, { boardId: id });
    });
  }

  function setActiveBoard(id) {
    if (!state.boards.some(function (b) { return b.id === id; })) return false;
    if (state.activeBoardId === id) return true;
    pushHistory();
    state.activeBoardId = id;
    save();
    return true;
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
    return JSON.stringify(activeBoard(), null, 2);
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
    moveCard: moveCard,
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
    setActiveBoard: setActiveBoard,
    setTheme: setTheme,
    exportAll: exportAll,
    exportBoard: exportBoard,
    importAll: importAll,
    undo: undo,
    redo: redo
  };
})(window.KB = window.KB || {});
