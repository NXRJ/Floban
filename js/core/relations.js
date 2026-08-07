(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Relations = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function () {
    var COLUMN_ROLES = ['backlog', 'queue', 'active', 'done'];

    function cloneState(state) {
      return JSON.parse(JSON.stringify(state));
    }

    function noop(state, reason) {
      return { changed: false, state: state, value: null, reason: reason };
    }

    function ok(state, value) {
      return { changed: true, state: state, value: value, reason: null };
    }

    function validRef(ref) {
      return Boolean(ref && typeof ref.boardId === 'string' && ref.boardId &&
        typeof ref.cardId === 'string' && ref.cardId);
    }

    function refKey(ref) {
      return ref.boardId + ':' + ref.cardId;
    }

    function findCardInBoard(board, cardId) {
      if (!board) return null;
      for (var i = 0; i < board.columns.length; i++) {
        var column = board.columns[i];
        for (var j = 0; j < column.cards.length; j++) {
          if (column.cards[j].id === cardId) return column.cards[j];
        }
      }
      for (var k = 0; k < board.archive.cards.length; k++) {
        if (board.archive.cards[k].id === cardId) return board.archive.cards[k];
      }
      for (var m = 0; m < board.archive.columns.length; m++) {
        var entry = board.archive.columns[m];
        for (var n = 0; n < entry.cards.length; n++) {
          if (entry.cards[n].id === cardId) return entry.cards[n];
        }
      }
      return null;
    }

    function findCard(state, boardId, cardId) {
      if (!state || !state.boards) return null;
      var board = null;
      for (var i = 0; i < state.boards.length; i++) {
        if (state.boards[i].id === boardId) {
          board = state.boards[i];
          break;
        }
      }
      return findCardInBoard(board, cardId);
    }

    function cardIndex(state) {
      var index = {};
      state.boards.forEach(function (board) {
        board.columns.forEach(function (column) {
          column.cards.forEach(function (card) {
            index[board.id + ':' + card.id] = card;
          });
        });
      });
      return index;
    }

    function resolvedIndex(state) {
      var index = {};
      state.boards.forEach(function (board) {
        board.columns.forEach(function (column) {
          var role = column.role;
          if (COLUMN_ROLES.indexOf(role) === -1) role = column.isDone ? 'done' : 'queue';
          if (role === 'done') {
            column.cards.forEach(function (card) {
              index[board.id + ':' + card.id] = true;
            });
          }
        });
      });
      return index;
    }

    function isCardResolved(state, ref, resolved) {
      if (!validRef(ref)) return false;
      if (resolved) return resolved[ref.boardId + ':' + ref.cardId] === true;
      var board = null;
      for (var i = 0; i < state.boards.length; i++) {
        if (state.boards[i].id === ref.boardId) {
          board = state.boards[i];
          break;
        }
      }
      if (!board) return false;
      for (var j = 0; j < board.columns.length; j++) {
        var column = board.columns[j];
        var role = column.role;
        if (COLUMN_ROLES.indexOf(role) === -1) role = column.isDone ? 'done' : 'queue';
        for (var k = 0; k < column.cards.length; k++) {
          if (column.cards[k].id === ref.cardId) return role === 'done';
        }
      }
      return false;
    }

    function getUnresolvedBlockers(state, cardRef, resolved, cards) {
      if (!validRef(cardRef)) return [];
      var card = cards ? cards[cardRef.boardId + ':' + cardRef.cardId] : findCard(state, cardRef.boardId, cardRef.cardId);
      if (!card) return [];
      var blockers = (card.dependencies && card.dependencies.blockers) || [];
      return blockers.filter(function (blocker) {
        return blocker && !isCardResolved(state, blocker, resolved);
      });
    }

    function getCardsBlockedBy(state, blockerRef) {
      var blocked = [];
      if (!validRef(blockerRef)) return blocked;
      state.boards.forEach(function (board) {
        var scan = function (column, card) {
          var deps = card.dependencies;
          if (!deps || !Array.isArray(deps.blockers)) return;
          var has = deps.blockers.some(function (b) {
            return b && b.boardId === blockerRef.boardId && b.cardId === blockerRef.cardId;
          });
          if (has) blocked.push({ boardId: board.id, columnId: column ? column.id : null, cardId: card.id });
        };
        board.columns.forEach(function (column) {
          column.cards.forEach(function (card) { scan(column, card); });
        });
        board.archive.cards.forEach(function (card) { scan(null, card); });
        board.archive.columns.forEach(function (entry) {
          entry.cards.forEach(function (card) { scan(entry, card); });
        });
      });
      return blocked;
    }

    function wouldCreateCycle(state, targetRef, blockerRef) {
      if (!validRef(targetRef) || !validRef(blockerRef)) return false;
      if (targetRef.boardId === blockerRef.boardId && targetRef.cardId === blockerRef.cardId) return false;
      var visited = {};
      var stack = [blockerRef];
      while (stack.length > 0) {
        var current = stack.pop();
        var key = refKey(current);
        if (visited[key]) continue;
        visited[key] = true;
        var card = findCard(state, current.boardId, current.cardId);
        if (!card) continue;
        var blockers = (card.dependencies && card.dependencies.blockers) || [];
        for (var i = 0; i < blockers.length; i++) {
          var b = blockers[i];
          if (!validRef(b)) continue;
          if (b.boardId === targetRef.boardId && b.cardId === targetRef.cardId) return true;
          stack.push(b);
        }
      }
      return false;
    }

    function addBlocker(state, targetRef, blockerRef) {
      if (!validRef(targetRef) || !validRef(blockerRef)) return noop(state, 'invalid-reference');
      if (targetRef.boardId === blockerRef.boardId && targetRef.cardId === blockerRef.cardId) {
        return noop(state, 'self-reference');
      }
      var target = findCard(state, targetRef.boardId, targetRef.cardId);
      var blocker = findCard(state, blockerRef.boardId, blockerRef.cardId);
      if (!target || !blocker) return noop(state, 'card-not-found');
      var blockers = target.dependencies.blockers || [];
      if (blockers.some(function (b) { return b.boardId === blockerRef.boardId && b.cardId === blockerRef.cardId; })) {
        return noop(state, 'duplicate');
      }
      if (wouldCreateCycle(state, targetRef, blockerRef)) return noop(state, 'dependency-cycle');
      var next = cloneState(state);
      var nextTarget = findCard(next, targetRef.boardId, targetRef.cardId);
      nextTarget.dependencies.blockers.push({ boardId: blockerRef.boardId, cardId: blockerRef.cardId });
      return ok(next, true);
    }

    function removeBlocker(state, targetRef, blockerRef) {
      if (!validRef(targetRef) || !validRef(blockerRef)) return noop(state, 'invalid-reference');
      var target = findCard(state, targetRef.boardId, targetRef.cardId);
      if (!target) return noop(state, 'card-not-found');
      var blockers = target.dependencies.blockers || [];
      if (!blockers.some(function (b) { return b.boardId === blockerRef.boardId && b.cardId === blockerRef.cardId; })) {
        return noop(state, 'not-linked');
      }
      var next = cloneState(state);
      var nextTarget = findCard(next, targetRef.boardId, targetRef.cardId);
      nextTarget.dependencies.blockers = nextTarget.dependencies.blockers.filter(function (b) {
        return !(b.boardId === blockerRef.boardId && b.cardId === blockerRef.cardId);
      });
      return ok(next, true);
    }

    function normalizeRelatedPair(state, leftRef, rightRef) {
      var left = findCard(state, leftRef.boardId, leftRef.cardId);
      var right = findCard(state, rightRef.boardId, rightRef.cardId);
      if (!left || !right) return null;
      var leftList = left.dependencies.related || [];
      var rightList = right.dependencies.related || [];
      if (leftList.some(function (r) { return r.boardId === rightRef.boardId && r.cardId === rightRef.cardId; }) ||
          rightList.some(function (r) { return r.boardId === leftRef.boardId && r.cardId === leftRef.cardId; })) {
        return 'duplicate';
      }
      return null;
    }

    function addRelated(state, leftRef, rightRef) {
      if (!validRef(leftRef) || !validRef(rightRef)) return noop(state, 'invalid-reference');
      if (leftRef.boardId === rightRef.boardId && leftRef.cardId === rightRef.cardId) {
        return noop(state, 'self-reference');
      }
      var status = normalizeRelatedPair(state, leftRef, rightRef);
      if (status === 'duplicate') return noop(state, 'duplicate');
      var next = cloneState(state);
      findCard(next, leftRef.boardId, leftRef.cardId).dependencies.related.push({ boardId: rightRef.boardId, cardId: rightRef.cardId });
      findCard(next, rightRef.boardId, rightRef.cardId).dependencies.related.push({ boardId: leftRef.boardId, cardId: leftRef.cardId });
      return ok(next, true);
    }

    function removeRelated(state, leftRef, rightRef) {
      if (!validRef(leftRef) || !validRef(rightRef)) return noop(state, 'invalid-reference');
      var left = findCard(state, leftRef.boardId, leftRef.cardId);
      var right = findCard(state, rightRef.boardId, rightRef.cardId);
      if (!left || !right) return noop(state, 'card-not-found');
      var next = cloneState(state);
      var nextLeft = findCard(next, leftRef.boardId, leftRef.cardId);
      var nextRight = findCard(next, rightRef.boardId, rightRef.cardId);
      var changed = false;
      var before = nextLeft.dependencies.related.length;
      nextLeft.dependencies.related = nextLeft.dependencies.related.filter(function (r) {
        return !(r.boardId === rightRef.boardId && r.cardId === rightRef.cardId);
      });
      if (nextLeft.dependencies.related.length !== before) changed = true;
      var before2 = nextRight.dependencies.related.length;
      nextRight.dependencies.related = nextRight.dependencies.related.filter(function (r) {
        return !(r.boardId === leftRef.boardId && r.cardId === leftRef.cardId);
      });
      if (nextRight.dependencies.related.length !== before2) changed = true;
      if (!changed) return noop(state, 'not-linked');
      return ok(next, true);
    }

    function isReadyToPull(state, cardRef) {
      return getUnresolvedBlockers(state, cardRef).length === 0;
    }

    function cleanupCardReferences(state, deletedRef) {
      if (!validRef(deletedRef)) return state;
      var next = cloneState(state);
      next.boards.forEach(function (board) {
        var scan = function (card) {
          card.dependencies.blockers = (card.dependencies.blockers || []).filter(function (b) {
            return !(b.boardId === deletedRef.boardId && b.cardId === deletedRef.cardId);
          });
          card.dependencies.related = (card.dependencies.related || []).filter(function (r) {
            return !(r.boardId === deletedRef.boardId && r.cardId === deletedRef.cardId);
          });
        };
        board.columns.forEach(function (column) { column.cards.forEach(scan); });
        board.archive.cards.forEach(scan);
        board.archive.columns.forEach(function (entry) { entry.cards.forEach(scan); });
      });
      next.recurrences = (next.recurrences || []).map(function (rec) {
        if (rec.activeCardRef && rec.activeCardRef.boardId === deletedRef.boardId && rec.activeCardRef.cardId === deletedRef.cardId) {
          rec.activeCardRef = null;
          rec.lastCompletedAt = null;
        }
        return rec;
      });
      return next;
    }

    function cleanupBoardReferences(state, deletedBoardId) {
      var next = cloneState(state);
      next.boards.forEach(function (board) {
        if (board.id === deletedBoardId) return;
        var scan = function (card) {
          card.dependencies.blockers = (card.dependencies.blockers || []).filter(function (b) {
            return b.boardId !== deletedBoardId;
          });
          card.dependencies.related = (card.dependencies.related || []).filter(function (r) {
            return r.boardId !== deletedBoardId;
          });
        };
        board.columns.forEach(function (column) { column.cards.forEach(scan); });
        board.archive.cards.forEach(scan);
        board.archive.columns.forEach(function (entry) { entry.cards.forEach(scan); });
      });
      next.recurrences = (next.recurrences || []).map(function (rec) {
        if (rec.target && rec.target.boardId === deletedBoardId) {
          rec.enabled = false;
          rec.pausedReason = 'Target board deleted';
          rec.activeCardRef = null;
        }
        if (rec.activeCardRef && rec.activeCardRef.boardId === deletedBoardId) {
          rec.activeCardRef = null;
        }
        return rec;
      });
      next.lenses = (next.lenses || []).map(function (lens) {
        if (lens.scope === 'selected-boards') {
          lens.boardIds = lens.boardIds.filter(function (id) { return id !== deletedBoardId; });
        }
        return lens;
      });
      return next;
    }

    return {
      findCard: findCard,
      cardIndex: cardIndex,
      resolvedIndex: resolvedIndex,
      isCardResolved: isCardResolved,
      addBlocker: addBlocker,
      removeBlocker: removeBlocker,
      addRelated: addRelated,
      removeRelated: removeRelated,
      wouldCreateCycle: wouldCreateCycle,
      getUnresolvedBlockers: getUnresolvedBlockers,
      getCardsBlockedBy: getCardsBlockedBy,
      isReadyToPull: isReadyToPull,
      cleanupCardReferences: cleanupCardReferences,
      cleanupBoardReferences: cleanupBoardReferences
    };
  }
);
