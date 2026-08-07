(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Policies = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function () {
    var WIP_MODES = ['off', 'soft', 'hard'];

    function findBoard(state, boardId) {
      if (!state || !state.boards) return null;
      for (var i = 0; i < state.boards.length; i++) {
        if (state.boards[i].id === boardId) return state.boards[i];
      }
      return null;
    }

    function findColumn(state, boardId, columnId) {
      var board = findBoard(state, boardId);
      if (!board) return null;
      for (var i = 0; i < board.columns.length; i++) {
        if (board.columns[i].id === columnId) return board.columns[i];
      }
      return null;
    }

    function findCardInColumn(column, cardId) {
      if (!column) return null;
      for (var i = 0; i < column.cards.length; i++) {
        if (column.cards[i].id === cardId) return column.cards[i];
      }
      return null;
    }

    function cardInBoard(board, cardId) {
      if (!board) return null;
      for (var i = 0; i < board.columns.length; i++) {
        var card = findCardInColumn(board.columns[i], cardId);
        if (card) return { column: board.columns[i], card: card };
      }
      return null;
    }

    function isOverrideReasonValid(column, reason) {
      var policy = column && column.policy ? column.policy : {};
      if (!policy.overrideRequiresReason) return true;
      return Boolean(reason && String(reason).trim());
    }

    function wipViolation(column, options) {
      var limit = column && column.wipLimit ? column.wipLimit : 0;
      if (limit <= 0) return null;
      var policy = column && column.policy ? column.policy : {};
      var mode = WIP_MODES.indexOf(policy.wipMode) !== -1 ? policy.wipMode : 'off';
      var count = column.cards ? column.cards.length : 0;
      var atLimit = !options || options.atLimit !== false;
      var breached = atLimit ? count >= limit : count > limit;
      if (!breached) return null;
      return {
        code: 'wip-limit',
        message: column.title + ' holds ' + count + ' cards against a WIP limit of ' + limit + '.',
        mode: mode
      };
    }

    function wipExceeded(column) {
      return wipViolation(column, { atLimit: false });
    }

    function evaluateMovePolicy(state, cardRef, targetColumnRef, opts) {
      var options = opts || {};
      var sourceColumn = options.sourceColumn || null;
      var board = findBoard(state, cardRef.boardId);
      var target = findColumn(state, targetColumnRef.boardId, targetColumnRef.columnId);
      if (!board || !target) {
        return {
          allowed: false,
          requiresOverride: false,
          requiresConfirmation: false,
          blocking: false,
          needsReason: false,
          violations: [{ code: 'column-not-found', message: 'Target column not found.' }]
        };
      }

      var violations = [];
      var requiresOverride = false;
      var requiresConfirmation = false;

      if (sourceColumn && target && sourceColumn.id === target.id) {
        return {
          allowed: true,
          requiresOverride: false,
          requiresConfirmation: false,
          blocking: false,
          needsReason: false,
          violations: []
        };
      }

      var wip = wipViolation(target);
      if (wip) {
        violations.push({ code: 'wip-limit', message: wip.message, mode: wip.mode });
        if (wip.mode === 'hard') {
          requiresOverride = true;
          requiresConfirmation = true;
        } else if (wip.mode === 'soft') {
          requiresConfirmation = true;
        }
      }

      var targetPolicy = target.policy || {};
      if (Array.isArray(targetPolicy.entryCriteria) && targetPolicy.entryCriteria.length > 0) {
        violations.push({
          code: 'entry-criteria',
          message: 'Entry criteria for "' + target.title + '" need confirming.',
          criteria: targetPolicy.entryCriteria.slice()
        });
        requiresOverride = true;
        requiresConfirmation = true;
      }

      if (sourceColumn) {
        var sourcePolicy = sourceColumn.policy || {};
        if (Array.isArray(sourcePolicy.exitCriteria) && sourcePolicy.exitCriteria.length > 0) {
          violations.push({
            code: 'exit-criteria',
            message: 'Exit criteria for "' + sourceColumn.title + '" need confirming.',
            criteria: sourcePolicy.exitCriteria.slice()
          });
          requiresOverride = true;
          requiresConfirmation = true;
        }
      }

      var confirmed = Boolean(options.confirmed);
      var validReason = isOverrideReasonValid(target, options.overrideReason);
      var needsReason = requiresOverride && (targetPolicy.overrideRequiresReason || false) && !validReason;

      var allowed = requiresOverride ? (confirmed && validReason) : true;

      return {
        allowed: allowed,
        requiresOverride: requiresOverride,
        requiresConfirmation: requiresConfirmation,
        blocking: requiresOverride,
        needsReason: needsReason,
        violations: violations
      };
    }

    function canEnterColumn(state, cardRef, columnRef) {
      return evaluateMovePolicy(state, cardRef, columnRef, { sourceColumn: null });
    }

    function canLeaveColumn(state, cardRef, columnRef) {
      var source = null;
      var board = findBoard(state, cardRef.boardId);
      if (board) {
        var found = cardInBoard(board, cardRef.cardId);
        if (found) source = found.column;
      }
      if (!source) {
        return { allowed: true, requiresOverride: false, requiresConfirmation: false, blocking: false, needsReason: false, violations: [] };
      }
      var policy = source.policy || {};
      if (!Array.isArray(policy.exitCriteria) || policy.exitCriteria.length === 0) {
        return { allowed: true, requiresOverride: false, requiresConfirmation: false, blocking: false, needsReason: false, violations: [] };
      }
      return {
        allowed: false,
        requiresOverride: true,
        requiresConfirmation: true,
        blocking: true,
        needsReason: false,
        violations: [{ code: 'exit-criteria', message: 'Exit criteria for "' + source.title + '" need confirming.' }]
      };
    }

    function applyEntryDefaults(card, column) {
      if (!card || !column) return card;
      var policy = column.policy || {};
      var defaultsApplied = { labels: false, assignee: false };
      if (Array.isArray(policy.defaultLabelIds) && policy.defaultLabelIds.length > 0) {
        var labels = Array.isArray(card.labels) ? card.labels.slice() : [];
        var cardLabels = {};
        labels.forEach(function (id) { cardLabels[id] = true; });
        policy.defaultLabelIds.forEach(function (id) {
          if (!cardLabels[id]) {
            labels.push(id);
            cardLabels[id] = true;
            defaultsApplied.labels = true;
          }
        });
        card.labels = labels;
      }
      if (policy.defaultAssignee && !card.assignee) {
        card.assignee = policy.defaultAssignee;
        defaultsApplied.assignee = true;
      }
      Object.defineProperty(card, '_defaultsApplied', {
        value: defaultsApplied,
        enumerable: false,
        writable: true,
        configurable: true
      });
      return card;
    }

    function wipStatus(column) {
      var wip = wipExceeded(column);
      if (!wip) {
        return { over: false, mode: 'ok', message: '' };
      }
      return { over: true, mode: wip.mode, message: wip.message };
    }

    return {
      evaluateMovePolicy: evaluateMovePolicy,
      canEnterColumn: canEnterColumn,
      canLeaveColumn: canLeaveColumn,
      applyEntryDefaults: applyEntryDefaults,
      wipStatus: wipStatus
    };
  }
);
