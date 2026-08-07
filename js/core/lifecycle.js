(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Lifecycle = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function () {
    var MS_PER_DAY = 86400000;
    var TRANSITION_LIMIT = 100;
    var PERIOD_LIMIT = 100;
    var FLOW_STATES = ['normal', 'blocked', 'waiting', 'paused'];
    var COLUMN_ROLES = ['backlog', 'queue', 'active', 'done'];

    function resolveDeps(deps) {
      if (!deps || typeof deps.uid !== 'function' || typeof deps.now !== 'function') {
        throw new Error('core lifecycle functions require { uid, now } dependencies');
      }
      return deps;
    }

    function noop(card, reason) {
      return { changed: false, card: card, reason: reason };
    }

    function cloneCard(card) {
      return JSON.parse(JSON.stringify(card));
    }

    function columnRole(column) {
      var role = column && column.role;
      return COLUMN_ROLES.indexOf(role) !== -1 ? role : 'queue';
    }

    function cappedPush(list, item, limit) {
      list.push(item);
      if (list.length > limit) list.splice(0, list.length - limit);
    }

    function transitionCard(card, fromColumn, toColumn, now) {
      if (!card || !toColumn) return noop(card, 'invalid-card-or-column');
      var fromRole = columnRole(fromColumn);
      var toRole = columnRole(toColumn);
      var cardCopy = cloneCard(card);

      cardCopy.movedAt = now;
      cardCopy.updatedAt = now;
      cardCopy.columnId = toColumn.id;

      var wasDone = cardCopy.completedAt !== null;
      var isDone = toRole === 'done';

      if (isDone && !wasDone) {
        cardCopy.completedAt = now;
      } else if (!isDone && wasDone) {
        cardCopy.completedAt = null;
      }

      if (toRole === 'active' && cardCopy.startedAt === null) {
        cardCopy.startedAt = now;
      }

      cappedPush(cardCopy.transitions, {
        fromColumnId: fromColumn ? fromColumn.id : null,
        toColumnId: toColumn.id,
        fromRole: fromRole,
        toRole: toRole,
        at: now
      }, TRANSITION_LIMIT);

      return { changed: true, card: cardCopy, reason: null };
    }

    function setFlowState(card, nextState, reason, now) {
      if (FLOW_STATES.indexOf(nextState) === -1) return noop(card, 'invalid-flow-state');
      var cardCopy = cloneCard(card);
      if (cardCopy.flow.state === nextState) {
        if (nextState === 'normal' || (reason !== undefined && cardCopy.flow.reason === reason)) {
          return noop(card, 'flow-state-unchanged');
        }
        cardCopy.flow.reason = typeof reason === 'string' ? reason : '';
        return { changed: true, card: cardCopy, reason: null };
      }
      var nowVal = typeof now === 'number' ? now : null;
      if (cardCopy.flow.state !== 'normal' && nowVal !== null) {
        cappedPush(cardCopy.flow.periods, {
          state: cardCopy.flow.state,
          reason: cardCopy.flow.reason,
          startedAt: cardCopy.flow.since,
          endedAt: nowVal
        }, PERIOD_LIMIT);
      }
      cardCopy.flow.state = nextState;
      cardCopy.flow.reason = nextState === 'normal' ? '' : (typeof reason === 'string' ? reason : '');
      cardCopy.flow.since = nextState === 'normal' ? null : nowVal;
      cardCopy.updatedAt = nowVal === null ? cardCopy.updatedAt : nowVal;
      return { changed: true, card: cardCopy, reason: null };
    }

    function clearFlowState(card, now) {
      return setFlowState(card, 'normal', '', now);
    }

    function currentFlowDuration(card, now) {
      if (!card || !card.flow || card.flow.state === 'normal' || card.flow.since === null) return 0;
      return Math.max(0, now - card.flow.since);
    }

    function totalFlowDuration(card, state, now) {
      if (!card || !card.flow) return 0;
      var total = 0;
      (card.flow.periods || []).forEach(function (period) {
        if (!period || period.state !== state || period.startedAt === null || period.endedAt === null) return;
        total += Math.max(0, period.endedAt - period.startedAt);
      });
      if (card.flow.state === state && card.flow.since !== null && typeof now === 'number') {
        total += Math.max(0, now - card.flow.since);
      }
      return total;
    }

    function cycleTimeDays(card) {
      if (!card) return null;
      if (card.startedAt === null || card.completedAt === null) return null;
      return (card.completedAt - card.startedAt) / MS_PER_DAY;
    }

    function workItemAgeDays(card, now) {
      if (!card || card.startedAt === null) return null;
      var end = card.completedAt !== null ? card.completedAt : now;
      return Math.max(0, (end - card.startedAt) / MS_PER_DAY);
    }

    function blockedDurationDays(card, now) {
      if (!card || !card.flow) return 0;
      return totalFlowDuration(card, 'blocked', now) / MS_PER_DAY;
    }

    return {
      TRANSITION_LIMIT: TRANSITION_LIMIT,
      PERIOD_LIMIT: PERIOD_LIMIT,
      columnRole: columnRole,
      transitionCard: transitionCard,
      setFlowState: setFlowState,
      clearFlowState: clearFlowState,
      currentFlowDuration: currentFlowDuration,
      totalFlowDuration: totalFlowDuration,
      cycleTimeDays: cycleTimeDays,
      workItemAgeDays: workItemAgeDays,
      blockedDurationDays: blockedDurationDays
    };
  }
);
