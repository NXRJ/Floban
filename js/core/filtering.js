(function (root, factory) {
  var dateCore = (typeof module === 'object' && module.exports)
    ? require('./date.js')
    : root.KB.Core.Date;
  var api = factory(dateCore);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Filtering = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function (DateCore) {
    var UNASSIGNED = '__unassigned__';
    var SORT_MODES = ['manual', 'due', 'created', 'updated'];

    function labelsList(filters) {
      var labels = filters && filters.labels;
      if (!labels || typeof labels.forEach !== 'function') return [];
      var list = [];
      labels.forEach(function (id) { list.push(id); });
      return list;
    }

    function dueMatches(card, dueFilter, todayISO, weekEndISO) {
      var due = card && card.due || '';
      return DateCore.isDueMatch(due, dueFilter, todayISO, weekEndISO);
    }

    function matchesCard(card, filters, dateContext) {
      var filter = filters || {};
      var labels = labelsList(filter);
      var today = dateContext && dateContext.today || '';
      var weekEnd = dateContext && dateContext.weekEnd || '';

      if (filter.search) {
        var haystack = (String(card.title || '') + ' ' + String(card.description || '')).toLowerCase();
        if (haystack.indexOf(String(filter.search).toLowerCase()) === -1) return false;
      }
      if (labels.length > 0) {
        var cardLabels = card.labels || [];
        if (!cardLabels.some(function (id) { return labels.indexOf(id) !== -1; })) return false;
      }
      if (filter.assignee === UNASSIGNED) {
        if (card.assignee && card.assignee.trim()) return false;
      } else if (filter.assignee) {
        if (String(card.assignee || '').trim() !== filter.assignee) return false;
      }
      if (filter.due && !dueMatches(card, filter.due, today, weekEnd)) return false;
      return true;
    }

    function hasActiveFilters(filters) {
      var filter = filters || {};
      return Boolean(filter.search || labelsList(filter).length > 0 || filter.assignee || filter.due);
    }

    function compareCards(cardA, cardB, sortMode) {
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

    function isValidSortMode(sortMode) {
      return SORT_MODES.indexOf(sortMode) !== -1;
    }

    return {
      UNASSIGNED: UNASSIGNED,
      dueMatches: dueMatches,
      matchesCard: matchesCard,
      hasActiveFilters: hasActiveFilters,
      compareCards: compareCards,
      isValidSortMode: isValidSortMode
    };
  }
);
