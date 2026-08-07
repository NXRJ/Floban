(function (KB) {
  var STORAGE_KEY = 'kanban.board.v1';

  var state = null;

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
      archivedAt: null,
      fromColumn: ''
    }, overrides || {});
  }

  function freshColumn(overrides) {
    return Object.assign({
      id: uid(),
      title: '',
      isDone: false,
      cards: []
    }, overrides || {});
  }

  function freshLabel(name, color) {
    return { id: uid(), name: name, color: color };
  }

  function defaults() {
    var labels = [
      freshLabel('Bug', '#c81e14'),
      freshLabel('Feature', '#2a58c4'),
      freshLabel('Urgent', '#a34800'),
      freshLabel('Chore', '#6d30d6')
    ];
    var todo = freshColumn({ title: 'To Do' });
    var progress = freshColumn({ title: 'In Progress' });
    var done = freshColumn({ title: 'Done', isDone: true });

    function card(columnId, title, description, labelNames, assignee) {
      return freshCard(columnId, {
        title: title,
        description: description,
        labels: labelNames.map(function (name) {
          var label = labels.find(function (l) { return l.name === name; });
          return label ? label.id : null;
        }).filter(Boolean),
        assignee: assignee
      });
    }

    todo.cards = [
      card(todo.id, 'Plan the weekly sync', 'Prepare the agenda and invite the team.', ['Chore'], 'Sam'),
      card(todo.id, 'Redesign the dashboard', 'Sketch a new layout and review it with the design group.', ['Feature'], '')
    ];
    progress.cards = [
      card(progress.id, 'Fix card drag on touch screens', 'Pointer events fire twice on mobile browsers.', ['Bug', 'Urgent'], 'Alex'),
      card(progress.id, 'Write tests for the archive flow', 'Cover restore, purge and column delete paths.', ['Feature'], 'Sam')
    ];
    done.cards = [
      card(done.id, 'Ship the onboarding flow', 'First-time user experience is live.', ['Feature'], 'Alex'),
      card(done.id, 'Set up CI pipeline', 'Build, lint and deploy on every push.', ['Chore'], '')
    ];

    return {
      version: 1,
      theme: 'dark',
      labels: labels,
      columns: [todo, progress, done],
      archive: { cards: [], columns: [] }
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1 && Array.isArray(parsed.columns)) {
          state = parsed;
          return;
        }
      }
    } catch (err) {
      console.warn('Could not read saved board', err);
    }
    state = defaults();
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Could not persist board', err);
    }
  }

  function findColumn(id) {
    return state.columns.find(function (c) { return c.id === id; }) || null;
  }

  function findCard(columnId, cardId) {
    var column = findColumn(columnId);
    if (!column) return null;
    return column.cards.find(function (c) { return c.id === cardId; }) || null;
  }

  function findLabel(id) {
    return state.labels.find(function (l) { return l.id === id; }) || null;
  }

  function anyCardUsesLabel(labelId) {
    function uses(cards) {
      return cards.some(function (c) { return c.labels && c.labels.indexOf(labelId) !== -1; });
    }
    if (state.columns.some(function (c) { return uses(c.cards); })) return true;
    if (uses(state.archive.cards)) return true;
    return state.archive.columns.some(function (c) { return uses(c.cards); });
  }

  function addColumn(title, isDone) {
    var column = freshColumn({ title: title, isDone: Boolean(isDone) });
    state.columns.push(column);
    save();
    return column;
  }

  function updateColumn(id, patch) {
    var column = findColumn(id);
    if (!column) return;
    Object.assign(column, patch);
    save();
  }

  function deleteColumn(id) {
    var column = findColumn(id);
    if (!column) return 0;
    var archivedAt = Date.now();
    column.cards.forEach(function (card) {
      card.archivedAt = archivedAt;
      card.fromColumn = column.title;
    });
    state.archive.columns.push({
      id: column.id,
      title: column.title,
      isDone: column.isDone,
      cards: column.cards,
      archivedAt: archivedAt
    });
    state.columns = state.columns.filter(function (c) { return c.id !== id; });
    save();
    return column.cards.length;
  }

  function moveColumn(id, toIndex) {
    var fromIndex = state.columns.findIndex(function (c) { return c.id === id; });
    if (fromIndex === -1) return;
    var column = state.columns.splice(fromIndex, 1)[0];
    var index = toIndex;
    if (fromIndex < index) index -= 1;
    index = Math.max(0, Math.min(index, state.columns.length));
    state.columns.splice(index, 0, column);
    save();
  }

  function addCard(columnId, data) {
    var column = findColumn(columnId);
    if (!column) return null;
    var card = freshCard(columnId, data);
    column.cards.push(card);
    save();
    return card;
  }

  function updateCard(columnId, cardId, patch) {
    var card = findCard(columnId, cardId);
    if (!card) return;
    Object.assign(card, patch, { updatedAt: Date.now() });
    save();
  }

  function moveCard(columnId, cardId, targetColumnId, toIndex) {
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
    target.cards.splice(index, 0, card);
    save();
  }

  function archiveCard(columnId, cardId) {
    var column = findColumn(columnId);
    var card = findCard(columnId, cardId);
    if (!column || !card) return;
    column.cards = column.cards.filter(function (c) { return c.id !== cardId; });
    card.archivedAt = Date.now();
    card.fromColumn = column.title;
    state.archive.cards.push(card);
    save();
  }

  function restoreCard(cardId) {
    var index = state.archive.cards.findIndex(function (c) { return c.id === cardId; });
    if (index === -1) return;
    var card = state.archive.cards.splice(index, 1)[0];
    var column = findColumn(card.columnId) || state.columns[0];
    if (!column) column = addColumn('To Do');
    delete card.archivedAt;
    delete card.fromColumn;
    column.cards.push(card);
    save();
  }

  function restoreColumn(columnId) {
    var index = state.archive.columns.findIndex(function (c) { return c.id === columnId; });
    if (index === -1) return;
    var entry = state.archive.columns.splice(index, 1)[0];
    delete entry.archivedAt;
    entry.cards.forEach(function (card) {
      delete card.archivedAt;
      delete card.fromColumn;
    });
    state.columns.push(entry);
    save();
  }

  function purgeCard(cardId) {
    state.archive.cards = state.archive.cards.filter(function (c) { return c.id !== cardId; });
    save();
  }

  function purgeColumn(columnId) {
    state.archive.columns = state.archive.columns.filter(function (c) { return c.id !== columnId; });
    save();
  }

  function addLabel(name, color) {
    var label = freshLabel(name, color);
    state.labels.push(label);
    save();
    return label;
  }

  function removeLabel(labelId) {
    if (anyCardUsesLabel(labelId)) return false;
    state.labels = state.labels.filter(function (l) { return l.id !== labelId; });
    save();
    return true;
  }

  function labelInUse(labelId) {
    return anyCardUsesLabel(labelId);
  }

  function labels() {
    return state.labels;
  }

  function assignees() {
    var set = new Set();
    state.columns.forEach(function (column) {
      column.cards.forEach(function (card) {
        if (card.assignee) set.add(card.assignee);
      });
    });
    return Array.from(set).sort(function (a, b) { return a.localeCompare(b); });
  }

  function setTheme(theme) {
    state.theme = theme;
    save();
  }

  function data() {
    return state;
  }

  KB.State = {
    load: load,
    data: data,
    findColumn: findColumn,
    findCard: findCard,
    findLabel: findLabel,
    addColumn: addColumn,
    updateColumn: updateColumn,
    deleteColumn: deleteColumn,
    moveColumn: moveColumn,
    addCard: addCard,
    updateCard: updateCard,
    moveCard: moveCard,
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
    setTheme: setTheme
  };
})(window.KB = window.KB || {});
