(function (KB) {
  var STORAGE_KEY = 'kanban.board.v1';
  var HISTORY_LIMIT = 50;

  var state = null;
  var undoStack = [];
  var redoStack = [];

  function uid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function freshCard(columnId, overrides) {
    return Object.assign({
      id: uid(),
      columnId: columnId,
      title: '',
      description: '',
      labels: [],
      assignee: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      movedAt: Date.now(),
      due: '',
      checklist: [],
      archivedAt: null,
      fromColumn: ''
    }, overrides || {});
  }

  function freshColumn(overrides) {
    return Object.assign({
      id: uid(),
      title: '',
      isDone: false,
      wipLimit: 0,
      collapsed: false,
      cards: []
    }, overrides || {});
  }

  function freshLabel(name, color) {
    return { id: uid(), name: name, color: color };
  }

  function freshBoard(name) {
    return {
      id: uid(),
      name: name || 'New board',
      labels: [],
      templates: [],
      columns: [],
      archive: { cards: [], columns: [] }
    };
  }

  function freshTemplate(overrides) {
    return Object.assign({
      id: uid(),
      title: '',
      description: '',
      labels: [],
      assignee: '',
      checklist: []
    }, overrides || {});
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
    var todo = freshColumn({ title: 'To Do' });
    var progress = freshColumn({ title: 'In Progress' });
    var done = freshColumn({ title: 'Done', isDone: true });

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
      version: 2,
      theme: 'dark',
      activeBoardId: board.id,
      boards: [board]
    };
  }

  function normalizeColumn(column) {
    if (typeof column.wipLimit !== 'number') column.wipLimit = 0;
    if (typeof column.collapsed !== 'boolean') column.collapsed = false;
    if (!Array.isArray(column.cards)) column.cards = [];
    column.cards.forEach(normalizeCard);
    return column;
  }

  function normalizeCard(card) {
    if (typeof card.due !== 'string') card.due = '';
    if (!Array.isArray(card.checklist)) card.checklist = [];
    if (!Array.isArray(card.labels)) card.labels = [];
    card.labels = card.labels.filter(function (id) { return typeof id === 'string'; });
    if (typeof card.assignee !== 'string') card.assignee = '';
    if (typeof card.movedAt !== 'number') card.movedAt = card.createdAt || Date.now();
    return card;
  }

  function normalizeLabel(label) {
    if (!label || typeof label.id !== 'string') return null;
    if (typeof label.name !== 'string') label.name = '';
    if (!/^#[0-9a-fA-F]{6}$/.test(label.color || '')) label.color = '#6d30d6';
    return label;
  }

  function normalizeTemplate(template) {
    if (!template || typeof template !== 'object') return null;
    return {
      id: typeof template.id === 'string' ? template.id : uid(),
      title: typeof template.title === 'string' ? template.title : (typeof template.name === 'string' ? template.name : ''),
      description: typeof template.description === 'string' ? template.description : '',
      labels: Array.isArray(template.labels) ? template.labels.filter(function (id) { return typeof id === 'string'; }) : [],
      assignee: typeof template.assignee === 'string' ? template.assignee : '',
      checklist: Array.isArray(template.checklist) ? template.checklist : []
    };
  }

  function normalizeBoard(board) {
    if (!Array.isArray(board.templates)) board.templates = [];
    board.templates = board.templates.map(normalizeTemplate).filter(Boolean);
    if (!Array.isArray(board.labels)) board.labels = [];
    board.labels = board.labels.map(normalizeLabel).filter(Boolean);
    if (!Array.isArray(board.columns)) board.columns = [];
    if (!board.archive || !Array.isArray(board.archive.cards)) {
      board.archive = { cards: [], columns: [] };
    }
    if (!Array.isArray(board.archive.columns)) board.archive.columns = [];
    board.columns.forEach(normalizeColumn);
    board.archive.cards.forEach(normalizeCard);
    board.archive.columns.forEach(function (entry) {
      (entry.cards || []).forEach(normalizeCard);
    });
    return board;
  }

  function adoptBoardShape(raw, name) {
    var board = freshBoard(name);
    board.labels = (raw.labels || []).map(normalizeLabel).filter(Boolean);
    board.templates = (raw.templates || []).map(normalizeTemplate).filter(Boolean);
    board.columns = (raw.columns || []).map(function (column) {
      return normalizeColumn({
        id: column.id || uid(),
        title: column.title || '',
        isDone: Boolean(column.isDone),
        wipLimit: column.wipLimit || 0,
        collapsed: Boolean(column.collapsed),
        cards: (column.cards || []).map(function (card) {
          return normalizeCard(freshCard(column.id, card));
        })
      });
    });
    board.archive = {
      cards: (raw.archive && raw.archive.cards || []).map(function (card) {
        return normalizeCard(freshCard(card.columnId, card));
      }),
      columns: (raw.archive && raw.archive.columns || []).map(function (entry) {
        var cards = (entry.cards || []).map(function (card) {
          return normalizeCard(freshCard(entry.id, card));
        });
        return Object.assign({}, entry, { id: entry.id || uid(), cards: cards });
      })
    };
    return board;
  }

  function migrateV1(old) {
    var board = adoptBoardShape(old, 'My Board');
    return {
      version: 2,
      theme: old.theme || 'dark',
      activeBoardId: board.id,
      boards: [board]
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1 && Array.isArray(parsed.columns)) {
          state = migrateV1(parsed);
          save();
          return;
        }
        if (parsed && parsed.version === 2 && Array.isArray(parsed.boards) && parsed.boards.length > 0) {
          state = parsed;
          normalize();
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

  function normalize() {
    state.boards.forEach(normalizeBoard);
    if (!state.boards.some(function (b) { return b.id === state.activeBoardId; })) {
      state.activeBoardId = state.boards[0].id;
    }
    if (typeof state.theme !== 'string') state.theme = 'dark';
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Could not persist board', err);
    }
  }

  function pushHistory() {
    redoStack.length = 0;
    undoStack.push(JSON.stringify(state));
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  }

  function undo() {
    if (undoStack.length === 0) return false;
    redoStack.push(JSON.stringify(state));
    state = JSON.parse(undoStack.pop());
    save();
    return true;
  }

  function redo() {
    if (redoStack.length === 0) return false;
    undoStack.push(JSON.stringify(state));
    state = JSON.parse(redoStack.pop());
    save();
    return true;
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
    function uses(cards) {
      return cards.some(function (c) { return c.labels && c.labels.indexOf(labelId) !== -1; });
    }
    if (board.columns.some(function (c) { return uses(c.cards); })) return true;
    if (uses(board.archive.cards)) return true;
    if (board.templates.some(function (t) { return t.labels && t.labels.indexOf(labelId) !== -1; })) return true;
    return board.archive.columns.some(function (c) { return uses(c.cards); });
  }

  function addColumn(title, isDone, skipHistory) {
    if (!skipHistory) pushHistory();
    var column = freshColumn({ title: title, isDone: Boolean(isDone) });
    activeBoard().columns.push(column);
    save();
    return column;
  }

  function updateColumn(id, patch) {
    pushHistory();
    var column = findColumn(id);
    if (!column) return;
    Object.assign(column, patch);
    save();
  }

  function deleteColumn(id) {
    pushHistory();
    var board = activeBoard();
    var column = findColumn(id);
    if (!column) return 0;
    var archivedAt = Date.now();
    column.cards.forEach(function (card) {
      card.archivedAt = archivedAt;
      card.fromColumn = column.title;
    });
    board.archive.columns.push({
      id: column.id,
      title: column.title,
      isDone: column.isDone,
      wipLimit: column.wipLimit,
      cards: column.cards,
      archivedAt: archivedAt
    });
    board.columns = board.columns.filter(function (c) { return c.id !== id; });
    save();
    return column.cards.length;
  }

  function moveColumn(id, toIndex) {
    pushHistory();
    var board = activeBoard();
    var fromIndex = board.columns.findIndex(function (c) { return c.id === id; });
    if (fromIndex === -1) return;
    var column = board.columns.splice(fromIndex, 1)[0];
    var index = toIndex;
    if (fromIndex < index) index -= 1;
    index = Math.max(0, Math.min(index, board.columns.length));
    board.columns.splice(index, 0, column);
    save();
  }

  function addCard(columnId, data) {
    pushHistory();
    var column = findColumn(columnId);
    if (!column) return null;
    var card = freshCard(columnId, data);
    card.movedAt = card.createdAt;
    column.cards.push(card);
    save();
    return card;
  }

  function addCards(columnId, titles) {
    pushHistory();
    var column = findColumn(columnId);
    if (!column) return 0;
    var added = 0;
    titles.forEach(function (title) {
      if (!title || !title.trim()) return;
      var card = freshCard(columnId, { title: title.trim() });
      card.movedAt = card.createdAt;
      column.cards.push(card);
      added += 1;
    });
    save();
    return added;
  }

  function updateCard(columnId, cardId, patch) {
    pushHistory();
    var card = findCard(columnId, cardId);
    if (!card) return;
    Object.assign(card, patch, { updatedAt: Date.now() });
    save();
  }

  function moveCard(columnId, cardId, targetColumnId, toIndex) {
    pushHistory();
    var source = findColumn(columnId);
    var target = findColumn(targetColumnId);
    if (!source || !target) return;
    var fromIndex = source.cards.findIndex(function (c) { return c.id === cardId; });
    if (fromIndex === -1) return;
    var card = source.cards.splice(fromIndex, 1)[0];
    var index = toIndex;
    if (columnId === targetColumnId && fromIndex < index) index -= 1;
    index = Math.max(0, Math.min(index, target.cards.length));
    card.columnId = targetColumnId;
    if (targetColumnId !== columnId) card.movedAt = Date.now();
    target.cards.splice(index, 0, card);
    save();
  }

  function duplicateCard(columnId, cardId) {
    pushHistory();
    var column = findColumn(columnId);
    var card = findCard(columnId, cardId);
    if (!column || !card) return null;
    var copy = freshCard(columnId, Object.assign({}, card, {
      id: uid(),
      title: 'Copy of ' + card.title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      movedAt: Date.now(),
      checklist: (card.checklist || []).map(function (item) {
        return Object.assign({}, item, { id: uid() });
      }),
      archivedAt: null,
      fromColumn: ''
    }));
    var index = column.cards.findIndex(function (c) { return c.id === cardId; });
    column.cards.splice(index + 1, 0, copy);
    save();
    return copy;
  }

  function archiveCard(columnId, cardId) {
    pushHistory();
    var board = activeBoard();
    var column = findColumn(columnId);
    var card = findCard(columnId, cardId);
    if (!column || !card) return;
    column.cards = column.cards.filter(function (c) { return c.id !== cardId; });
    card.archivedAt = Date.now();
    card.fromColumn = column.title;
    board.archive.cards.push(card);
    save();
  }

  function restoreCard(cardId) {
    pushHistory();
    var board = activeBoard();
    var index = board.archive.cards.findIndex(function (c) { return c.id === cardId; });
    if (index === -1) return;
    var card = board.archive.cards.splice(index, 1)[0];
    var column = findColumn(card.columnId) || board.columns[0];
    if (!column) column = addColumn('To Do', false, true);
    delete card.archivedAt;
    delete card.fromColumn;
    card.movedAt = Date.now();
    column.cards.push(card);
    save();
  }

  function restoreColumn(columnId) {
    pushHistory();
    var board = activeBoard();
    var index = board.archive.columns.findIndex(function (c) { return c.id === columnId; });
    if (index === -1) return;
    var entry = board.archive.columns.splice(index, 1)[0];
    delete entry.archivedAt;
    entry.cards.forEach(function (card) {
      delete card.archivedAt;
      delete card.fromColumn;
      card.movedAt = Date.now();
    });
    board.columns.push(entry);
    save();
  }

  function purgeCard(cardId) {
    pushHistory();
    activeBoard().archive.cards = activeBoard().archive.cards.filter(function (c) { return c.id !== cardId; });
    save();
  }

  function purgeColumn(columnId) {
    pushHistory();
    activeBoard().archive.columns = activeBoard().archive.columns.filter(function (c) { return c.id !== columnId; });
    save();
  }

  function addLabel(name, color) {
    pushHistory();
    var label = freshLabel(name, color);
    activeBoard().labels.push(label);
    save();
    return label;
  }

  function removeLabel(labelId) {
    if (anyCardUsesLabel(labelId)) return false;
    pushHistory();
    activeBoard().labels = activeBoard().labels.filter(function (l) { return l.id !== labelId; });
    save();
    return true;
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
    pushHistory();
    var board = state.boards.find(function (b) { return b.id === id; });
    if (!board) return;
    board.name = name;
    save();
  }

  function duplicateBoard(id) {
    pushHistory();
    var source = state.boards.find(function (b) { return b.id === id; });
    if (!source) return null;
    var copy = JSON.parse(JSON.stringify(source));
    copy.id = uid();
    copy.name = source.name + ' copy';
    state.boards.push(copy);
    state.activeBoardId = copy.id;
    save();
    return copy;
  }

  function deleteBoard(id) {
    if (state.boards.length <= 1) return false;
    pushHistory();
    var index = state.boards.findIndex(function (b) { return b.id === id; });
    if (index === -1) return false;
    state.boards.splice(index, 1);
    if (state.activeBoardId === id) {
      state.activeBoardId = state.boards[Math.min(index, state.boards.length - 1)].id;
    }
    save();
    return true;
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
    try {
      var parsed = JSON.parse(text);
      if (!parsed) return false;
      if (Array.isArray(parsed.boards) && parsed.version === 2 && parsed.boards.length > 0) {
        pushHistory();
        state = parsed;
        normalize();
        save();
        return 'all';
      }
      if (Array.isArray(parsed.columns) && Array.isArray(parsed.labels)) {
        var board = adoptBoardShape(parsed, parsed.name || 'Imported board');
        pushHistory();
        state.boards.push(board);
        state.activeBoardId = board.id;
        save();
        return 'board';
      }
      return false;
    } catch (err) {
      return false;
    }
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
