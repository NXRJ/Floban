(function (KB) {
  var UNASSIGNED = '__unassigned__';
  var selectedLabels = new Set();

  var SORT_OPTIONS = [
    { value: 'manual', label: 'Manual order' },
    { value: 'due', label: 'Due date' },
    { value: 'created', label: 'Created' },
    { value: 'updated', label: 'Last updated' }
  ];

  var sortMode = 'manual';

  function todayISO() {
    return KB.Dom.isoToday();
  }

  function weekISO() {
    return KB.Dom.isoDaysFromNow(6);
  }

  function read() {
    return {
      search: KB.el('search-input').value.trim().toLowerCase(),
      labels: selectedLabels,
      assignee: KB.el('assignee-filter').value,
      due: KB.el('due-filter').value
    };
  }

  function dueMatches(card, dueFilter, today, week) {
    var due = card.due || '';
    switch (dueFilter) {
      case 'overdue':
        return Boolean(due) && due < today;
      case 'today':
        return due === today;
      case 'week':
        return Boolean(due) && due >= today && due <= week;
      case 'none':
        return !due;
      default:
        return true;
    }
  }

  function matches(card, filters) {
    if (filters.search) {
      var haystack = (card.title + ' ' + (card.description || '')).toLowerCase();
      if (haystack.indexOf(filters.search) === -1) return false;
    }
    if (filters.labels.size > 0) {
      if (!card.labels.some(function (id) { return filters.labels.has(id); })) return false;
    }
    if (filters.assignee === UNASSIGNED) {
      if (card.assignee && card.assignee.trim()) return false;
    } else if (filters.assignee) {
      if ((card.assignee || '').trim() !== filters.assignee) return false;
    }
    if (filters.due && !dueMatches(card, filters.due, todayISO(), weekISO())) return false;
    return true;
  }

  function active(filters) {
    return Boolean(filters.search || filters.labels.size > 0 || filters.assignee || filters.due);
  }

  function compare(cardA, cardB) {
    switch (sortMode) {
      case 'due': {
        var a = cardA.due || '';
        var b = cardB.due || '';
        if (a === b) return 0;
        if (!a) return 1;
        if (!b) return -1;
        return a < b ? -1 : 1;
      }
      case 'created':
        return (cardA.createdAt || 0) - (cardB.createdAt || 0);
      case 'updated':
        return (cardB.updatedAt || 0) - (cardA.updatedAt || 0);
      default:
        return 0;
    }
  }

  function sortActive() {
    return sortMode !== 'manual';
  }

  function sortModeValue() {
    return sortMode;
  }

  function setSortMode(mode) {
    sortMode = SORT_OPTIONS.some(function (o) { return o.value === mode; }) ? mode : 'manual';
  }

  KB.Filters = {
    UNASSIGNED: UNASSIGNED,
    selected: selectedLabels,
    SORT_OPTIONS: SORT_OPTIONS,
    read: read,
    matches: matches,
    active: active,
    compare: compare,
    sortActive: sortActive,
    sortModeValue: sortModeValue,
    setSortMode: setSortMode,
    todayISO: todayISO
  };
})(window.KB = window.KB || {});
