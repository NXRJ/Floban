(function (KB) {
  var Core = KB.Core.Filtering;
  var UNASSIGNED = Core.UNASSIGNED;
  var selectedLabels = new Set();

  var SORT_OPTIONS = [
    { value: 'manual', label: 'Manual order' },
    { value: 'due', label: 'Due date' },
    { value: 'priority', label: 'Priority' },
    { value: 'size', label: 'Size' },
    { value: 'created', label: 'Created' },
    { value: 'updated', label: 'Last updated' },
    { value: 'blocked-duration', label: 'Longest blocked' }
  ];

  var PRIORITY_OPTIONS = [
    ['', 'Any priority'],
    ['urgent', 'Urgent'],
    ['high', 'High'],
    ['medium', 'Medium'],
    ['low', 'Low'],
    ['none', 'No priority']
  ];

  var SIZE_OPTIONS = [
    ['', 'Any size'],
    ['xl', 'XL'],
    ['l', 'L'],
    ['m', 'M'],
    ['s', 'S'],
    ['xs', 'XS'],
    ['none', 'No size']
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
      search: KB.el('search-input').value.trim(),
      labels: selectedLabels,
      assignee: KB.el('assignee-filter').value,
      due: KB.el('due-filter').value,
      priority: KB.el('priority-filter').value,
      size: KB.el('size-filter').value,
      flowStates: KB.el('flow-filter').value ? [KB.el('flow-filter').value] : [],
      readyOnly: KB.el('ready-filter') ? KB.el('ready-filter').checked : false,
      blockedOnly: KB.el('depblocked-filter') ? KB.el('depblocked-filter').checked : false
    };
  }

  function matches(card, filters) {
    if (!Core.matchesCard(card, filters, { today: todayISO(), weekEnd: weekISO() })) return false;
    if (filters.readyOnly || filters.blockedOnly) {
      var board = KB.State.activeBoard();
      if (!board) return false;
      var ref = { boardId: board.id, cardId: card.id };
      var unresolved = KB.Core.Relations.getUnresolvedBlockers(KB.State.data(), ref);
      if (filters.blockedOnly && unresolved.length === 0) return false;
      if (filters.readyOnly && unresolved.length > 0) return false;
    }
    return true;
  }

  function active(filters) {
    return Core.hasActiveFilters(filters);
  }

  function compare(cardA, cardB) {
    return Core.compareCards(cardA, cardB, sortMode, { now: Date.now() });
  }

  function sortActive() {
    return sortMode !== 'manual';
  }

  function sortModeValue() {
    return sortMode;
  }

  function setSortMode(mode) {
    sortMode = Core.isValidSortMode(mode) ? mode : 'manual';
  }

  KB.Filters = {
    UNASSIGNED: UNASSIGNED,
    selected: selectedLabels,
    SORT_OPTIONS: SORT_OPTIONS,
    PRIORITY_OPTIONS: PRIORITY_OPTIONS,
    SIZE_OPTIONS: SIZE_OPTIONS,
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
