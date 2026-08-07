(function (KB) {
  var UNASSIGNED = '__unassigned__';
  var selectedLabels = new Set();

  function read() {
    return {
      search: KB.el('search-input').value.trim().toLowerCase(),
      labels: selectedLabels,
      assignee: KB.el('assignee-filter').value
    };
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
    return true;
  }

  function active(filters) {
    return Boolean(filters.search || filters.labels.size > 0 || filters.assignee);
  }

  KB.Filters = {
    UNASSIGNED: UNASSIGNED,
    selected: selectedLabels,
    read: read,
    matches: matches,
    active: active
  };
})(window.KB = window.KB || {});
