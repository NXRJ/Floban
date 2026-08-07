(function (KB) {
  var Core = KB.Core.Filtering;
  var UNASSIGNED = Core.UNASSIGNED;
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
      search: KB.el('search-input').value.trim(),
      labels: selectedLabels,
      assignee: KB.el('assignee-filter').value,
      due: KB.el('due-filter').value
    };
  }

  function matches(card, filters) {
    return Core.matchesCard(card, filters, { today: todayISO(), weekEnd: weekISO() });
  }

  function active(filters) {
    return Core.hasActiveFilters(filters);
  }

  function compare(cardA, cardB) {
    return Core.compareCards(cardA, cardB, sortMode);
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
