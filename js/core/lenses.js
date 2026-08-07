(function (root, factory) {
  var filteringCore = (typeof module === 'object' && module.exports)
    ? require('./filtering.js')
    : root.KB.Core.Filtering;
  var relationsCore = (typeof module === 'object' && module.exports)
    ? require('./relations.js')
    : root.KB.Core.Relations;
  var lifecycleCore = (typeof module === 'object' && module.exports)
    ? require('./lifecycle.js')
    : root.KB.Core.Lifecycle;
  var migrationCore = (typeof module === 'object' && module.exports)
    ? require('./migration.js')
    : root.KB.Core.Migration;
  var api = factory(filteringCore, relationsCore, lifecycleCore, migrationCore);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Lenses = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function (Filtering, Relations, Lifecycle, Migration) {
    var PRIORITY_WEIGHT = { none: 0, low: 1, medium: 2, high: 3, urgent: 4 };
    var SORT_FIELDS = ['manual', 'priority', 'due', 'created', 'updated', 'age', 'blocked-duration'];
    var GROUP_FIELDS = ['board', 'column', 'priority', 'assignee', 'none'];

    function builtInLenses() {
      return [
        {
          id: 'builtin-ready-to-pull',
          name: 'Ready to Pull',
          scope: 'all-boards',
          boardIds: [],
          query: { readyOnly: true, includeCompleted: false },
          sort: { field: 'priority', direction: 'desc' },
          display: { density: 'compact', groupBy: 'board' }
        },
        {
          id: 'builtin-blocked',
          name: 'Blocked',
          scope: 'all-boards',
          boardIds: [],
          query: { blockedOnly: true, includeCompleted: false },
          sort: { field: 'blocked-duration', direction: 'desc' },
          display: { density: 'comfortable', groupBy: 'board' }
        },
        {
          id: 'builtin-waiting',
          name: 'Waiting on Others',
          scope: 'all-boards',
          boardIds: [],
          query: { flowStates: ['waiting'], includeCompleted: false },
          sort: { field: 'updated', direction: 'asc' },
          display: { density: 'comfortable', groupBy: 'board' }
        },
        {
          id: 'builtin-aging',
          name: 'Aging',
          scope: 'all-boards',
          boardIds: [],
          query: { includeCompleted: false },
          sort: { field: 'age', direction: 'desc' },
          display: { density: 'comfortable', groupBy: 'board' }
        },
        {
          id: 'builtin-due-soon',
          name: 'Due Soon',
          scope: 'all-boards',
          boardIds: [],
          query: { due: 'week', includeCompleted: false },
          sort: { field: 'due', direction: 'asc' },
          display: { density: 'comfortable', groupBy: 'board' }
        },
        {
          id: 'builtin-overdue',
          name: 'Overdue',
          scope: 'all-boards',
          boardIds: [],
          query: { due: 'overdue', includeCompleted: false },
          sort: { field: 'due', direction: 'asc' },
          display: { density: 'comfortable', groupBy: 'board' }
        },
        {
          id: 'builtin-no-due',
          name: 'No Due Date',
          scope: 'all-boards',
          boardIds: [],
          query: { due: 'none', includeCompleted: false },
          sort: { field: 'created', direction: 'asc' },
          display: { density: 'comfortable', groupBy: 'board' }
        },
        {
          id: 'builtin-recently-completed',
          name: 'Recently Completed',
          scope: 'all-boards',
          boardIds: [],
          query: { includeCompleted: true },
          sort: { field: 'updated', direction: 'desc' },
          display: { density: 'compact', groupBy: 'board' }
        },
        {
          id: 'builtin-needs-triage',
          name: 'Needs Triage',
          scope: 'all-boards',
          boardIds: [],
          query: { includeCompleted: false },
          sort: { field: 'age', direction: 'desc' },
          display: { density: 'compact', groupBy: 'board' }
        }
      ];
    }

    function isBuiltIn(lens) {
      return builtInLenses().some(function (builtin) { return builtin.id === lens.id; });
    }

    function normalizeLens(lens, deps) {
      return Migration.normalizeLens(lens, deps);
    }

    function lensBoards(state, lens) {
      var boards = [];
      state.boards.forEach(function (board) {
        if (lens.scope === 'active-board') {
          if (board.id === state.activeBoardId) boards.push(board);
        } else if (lens.scope === 'selected-boards') {
          if (lens.boardIds.indexOf(board.id) !== -1) boards.push(board);
        } else {
          boards.push(board);
        }
      });
      return boards;
    }

    function cardMatchesQuery(state, board, column, card, lens, now) {
      var query = lens.query || {};
      var ref = { boardId: board.id, cardId: card.id };
      var inDone = column.role === 'done';

      if (inDone && query.includeCompleted === false) return false;
      if (!inDone && query.includeCompleted === true && query.recentlyCompletedOnly) {
        if (typeof card.completedAt !== 'number') return false;
      }

      var filters = {
        search: query.search || '',
        labels: query.labelIds || [],
        assignee: query.assignees && query.assignees.length === 1 ? query.assignees[0] : '',
        due: query.due && query.due !== 'any' ? query.due : '',
        priority: query.priorities && query.priorities.length === 1 ? query.priorities[0] : '',
        size: query.sizes && query.sizes.length === 1 ? query.sizes[0] : '',
        flowStates: query.flowStates || []
      };
      if (query.assignees && query.assignees.length > 1) {
        if (query.assignees.indexOf(card.assignee) === -1) return false;
      }
      if (query.priorities && query.priorities.length > 1) {
        if (query.priorities.indexOf(card.priority) === -1) return false;
      }
      if (query.sizes && query.sizes.length > 1) {
        if (query.sizes.indexOf(card.size) === -1) return false;
      }
      if (query.columnRoles && query.columnRoles.length > 0) {
        if (query.columnRoles.indexOf(column.role) === -1) return false;
      }
      var dateContext = { today: isoToday(now), weekEnd: isoDaysFrom(now, 6) };
      if (!Filtering.matchesCard(card, filters, dateContext)) return false;

      var unresolved = Relations.getUnresolvedBlockers(state, ref);
      if (query.blockedOnly && unresolved.length === 0) return false;
      if (query.readyOnly && unresolved.length > 0) return false;

      if (query.recentlyCompletedOnly) {
        if (typeof card.completedAt !== 'number' || now - card.completedAt > 7 * 86400000) return false;
      }
      if (query.agingOnly) {
        var age = Lifecycle.workItemAgeDays(card, now);
        if (age === null || age < (query.agingDays || 7)) return false;
      }
      return true;
    }

    function isoToday(now) {
      var d = new Date(now);
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return d.getFullYear() + '-' + m + '-' + day;
    }

    function isoDaysFrom(now, offset) {
      var d = new Date(now);
      d.setDate(d.getDate() + offset);
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return d.getFullYear() + '-' + m + '-' + day;
    }

    function compareForSort(a, b, lens, now) {
      var field = SORT_FIELDS.indexOf(lens.sort && lens.sort.field) !== -1 ? lens.sort.field : 'manual';
      var direction = lens.sort && lens.sort.direction === 'asc' ? 1 : -1;
      var cmp = 0;
      switch (field) {
        case 'priority':
          cmp = (PRIORITY_WEIGHT[a.card.priority] || 0) - (PRIORITY_WEIGHT[b.card.priority] || 0);
          break;
        case 'due': {
          var da = a.card.due || '9999-12-31';
          var db = b.card.due || '9999-12-31';
          cmp = da < db ? -1 : (da > db ? 1 : 0);
          break;
        }
        case 'created':
          cmp = (a.card.createdAt || 0) - (b.card.createdAt || 0);
          break;
        case 'updated':
          cmp = (a.card.updatedAt || 0) - (b.card.updatedAt || 0);
          break;
        case 'age':
          cmp = (a.card.startedAt || a.card.movedAt || a.card.createdAt || 0) - (b.card.startedAt || b.card.movedAt || b.card.createdAt || 0);
          break;
        case 'blocked-duration':
          cmp = Lifecycle.totalFlowDuration(a.card, 'blocked', now) - Lifecycle.totalFlowDuration(b.card, 'blocked', now);
          break;
        default:
          cmp = 0;
      }
      return cmp * direction;
    }

    function applyLens(state, lens, now) {
      var ts = typeof now === 'number' ? now : 0;
      var results = [];
      lensBoards(state, lens).forEach(function (board) {
        board.columns.forEach(function (column) {
          column.cards.forEach(function (card) {
            if (cardMatchesQuery(state, board, column, card, lens, ts)) {
              results.push({ boardId: board.id, columnId: column.id, cardId: card.id, card: card, columnRole: column.role });
            }
          });
        });
      });
      results.sort(function (a, b) { return compareForSort(a, b, lens, ts); });
      return results;
    }

    function groupResults(results, lens) {
      var groupBy = GROUP_FIELDS.indexOf(lens.display && lens.display.groupBy) !== -1 ? lens.display.groupBy : 'board';
      var groups = [];
      var index = {};
      results.forEach(function (result) {
        var key;
        switch (groupBy) {
          case 'column': key = result.columnId; break;
          case 'priority': key = result.card.priority || 'none'; break;
          case 'assignee': key = result.card.assignee || 'unassigned'; break;
          case 'none': key = '_all'; break;
          default: key = result.boardId;
        }
        if (!index[key]) {
          index[key] = { key: key, items: [] };
          groups.push(index[key]);
        }
        index[key].items.push(result);
      });
      if (groupBy === 'priority') {
        var order = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
        groups.sort(function (a, b) {
          return (order[a.key] !== undefined ? order[a.key] : 9) - (order[b.key] !== undefined ? order[b.key] : 9);
        });
      }
      return groups;
    }

    function applyLensGrouped(state, lens, now) {
      return groupResults(applyLens(state, lens, now), lens);
    }

    return {
      builtInLenses: builtInLenses,
      isBuiltIn: isBuiltIn,
      normalizeLens: normalizeLens,
      applyLens: applyLens,
      applyLensGrouped: applyLensGrouped
    };
  }
);
