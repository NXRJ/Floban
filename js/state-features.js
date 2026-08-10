(function (KB) {
  var internal = KB.State.internal;
  var deps = internal.deps;
  var now = internal.now;
  var uid = internal.uid;
  var commit = internal.commit;
  var wrapResult = internal.wrapResult;
  var noop = internal.noop;
  var cloneState = internal.cloneState;
  var safePatchKeys = internal.safePatchKeys;
  function processRecurrences() {
    return wrapResult(function (current) {
      return KB.Core.Recurrence.processDueRecurrences(current, now(), deps());
    })();
  }

  function addRecurrence(definition) {
    return commit(function (current) {
      var next = cloneState(current);
      var recurrence = KB.Core.Model.createRecurrence(definition, deps());
      next.recurrences.push(recurrence);
      return { changed: true, state: next, value: recurrence };
    });
  }

  // Shared update/delete for the app's entity lists (recurrences, lenses):
  // deep-diff the patch against the current value, bump updatedAt, splice
  // on delete. Returns { changed } plus the entity on success.
  function patchEntity(list, id, patch, notFoundReason) {
    var entity = list.find(function (r) { return r.id === id; });
    if (!entity) return { changed: false, reason: notFoundReason };
    var changed = false;
    // Same prototype-pollution hygiene as updateCard / updateCardWithFlow.
    safePatchKeys(patch).forEach(function (key) {
      if (JSON.stringify(entity[key]) !== JSON.stringify(patch[key])) {
        entity[key] = patch[key];
        changed = true;
      }
    });
    if (!changed) return { changed: false, reason: 'no-change' };
    entity.updatedAt = now();
    return { changed: true, entity: entity };
  }

  function removeEntity(list, id, notFoundReason) {
    var index = list.findIndex(function (r) { return r.id === id; });
    if (index === -1) return { changed: false, reason: notFoundReason };
    list.splice(index, 1);
    return { changed: true };
  }

  function updateRecurrence(recurrenceId, patch) {
    return commit(function (current) {
      var next = cloneState(current);
      var result = patchEntity(next.recurrences, recurrenceId, patch, 'not-found');
      if (!result.changed) return noop(current, result.reason);
      return { changed: true, state: next, value: result.entity };
    });
  }

  function deleteRecurrence(recurrenceId) {
    return commit(function (current) {
      var next = cloneState(current);
      var result = removeEntity(next.recurrences, recurrenceId, 'not-found');
      if (!result.changed) return noop(current, result.reason);
      return { changed: true, state: next, value: true };
    });
  }

  function pauseRecurrence(recurrenceId, reason) {
    return commit(function (current) {
      return KB.Core.Recurrence.pauseRecurrence(current, recurrenceId, reason, deps());
    });
  }

  function resumeRecurrence(recurrenceId) {
    return commit(function (current) {
      return KB.Core.Recurrence.resumeRecurrence(current, recurrenceId, deps());
    });
  }

  function runRecurrenceNow(recurrenceId) {
    return wrapResult(function (current) {
      return KB.Core.Recurrence.runNow(current, recurrenceId, deps());
    })();
  }

  function skipRecurrenceNext(recurrenceId) {
    return commit(function (current) {
      var next = cloneState(current);
      var recurrence = next.recurrences.find(function (r) { return r.id === recurrenceId; });
      if (!recurrence) return noop(current, 'not-found');
      recurrence.nextRunAt = KB.Core.Recurrence.computeNextRun(recurrence, recurrence.nextRunAt === null ? now() : recurrence.nextRunAt);
      recurrence.updatedAt = now();
      return { changed: true, state: next, value: recurrence };
    });
  }

  function endRecurrence(recurrenceId) {
    return commit(function (current) {
      var next = cloneState(current);
      var recurrence = next.recurrences.find(function (r) { return r.id === recurrenceId; });
      if (!recurrence) return noop(current, 'not-found');
      if (recurrence.endAt !== null) return noop(current, 'already-ended');
      recurrence.endAt = now();
      recurrence.updatedAt = now();
      return { changed: true, state: next, value: recurrence };
    });
  }

  function captureInbox(input) {
    return commit(function (current) {
      return KB.Core.Inbox.captureItem(current, input, deps());
    });
  }

  function captureInboxLines(text) {
    return commit(function (current) {
      return KB.Core.Inbox.captureLines(current, text, deps());
    });
  }

  function updateInboxItem(id, patch) {
    return commit(function (current) {
      return KB.Core.Inbox.updateInboxItem(current, id, patch, deps());
    });
  }

  function deleteInboxItem(id) {
    return commit(function (current) {
      return KB.Core.Inbox.deleteInboxItem(current, id);
    });
  }

  function triageInboxItem(id, target, cardPatch, opts) {
    return wrapResult(function (current) {
      return KB.Core.Inbox.triageInboxItem(current, id, target, cardPatch, deps(), opts);
    })();
  }

  function convertInboxToRecurrence(inboxId, definition) {
    return commit(function (current) {
      var next = cloneState(current);
      var items = next.inbox && Array.isArray(next.inbox.items) ? next.inbox.items : [];
      var index = items.findIndex(function (it) { return it.id === inboxId; });
      if (index === -1) return noop(current, 'item-not-found');
      items.splice(index, 1);
      var recurrence = KB.Core.Model.createRecurrence(definition, deps());
      next.recurrences.push(recurrence);
      return { changed: true, state: next, value: recurrence };
    });
  }

  function mergeInboxItem(inboxId, target) {
    return commit(function (current) {
      return KB.Core.Inbox.mergeIntoCard(current, inboxId, target, deps());
    });
  }

  function addLens(definition) {
    return commit(function (current) {
      var next = cloneState(current);
      var lens = KB.Core.Lenses.normalizeLens(definition, deps());
      lens.id = uid();
      lens.createdAt = now();
      lens.updatedAt = now();
      next.lenses.push(lens);
      return { changed: true, state: next, value: lens };
    });
  }

  function updateLens(lensId, patch) {
    return commit(function (current) {
      var next = cloneState(current);
      var result = patchEntity(next.lenses, lensId, patch, 'not-found');
      if (!result.changed) return noop(current, result.reason);
      return { changed: true, state: next, value: result.entity };
    });
  }

  function deleteLens(lensId) {
    return commit(function (current) {
      var next = cloneState(current);
      var result = removeEntity(next.lenses, lensId, 'not-found');
      if (!result.changed) return noop(current, result.reason);
      return { changed: true, state: next, value: true };
    });
  }

  function bulkMove(cardRefs, target, opts) {
    return wrapResult(function (current) {
      return KB.Core.Bulk.bulkMove(current, cardRefs, target, deps(), opts);
    })();
  }

  function bulkUpdate(cardRefs, patch) {
    return wrapResult(function (current) {
      return KB.Core.Bulk.bulkUpdate(current, cardRefs, patch, deps());
    })();
  }

  function bulkSetLabels(entries) {
    return wrapResult(function (current) {
      return KB.Core.Bulk.bulkSetLabels(current, entries, deps());
    })();
  }

  function bulkSetFlow(entries) {
    return wrapResult(function (current) {
      return KB.Core.Bulk.bulkSetFlow(current, entries, deps());
    })();
  }

  function bulkArchive(cardRefs) {
    return wrapResult(function (current) {
      return KB.Core.Bulk.bulkArchive(current, cardRefs, deps());
    })();
  }

  // ---- Day Sheet (daily planning ritual) ----

  function dayplans() {
    return (KB.State.data().dayplans) || {};
  }

  function daySheetFor(dayISO) {
    return KB.Core.DayPlan.sheetFor(dayplans(), dayISO);
  }

  function stampDay(dayISO, cardIds) {
    return commit(function (current) {
      var next = cloneState(current);
      var plan = KB.Core.DayPlan.stampDay(dayISO, cardIds, now(), 3);
      if (!next.dayplans) next.dayplans = {};
      next.dayplans[dayISO] = plan;
      return { changed: true, state: next, value: plan };
    });
  }

  // Live cards flattened with their board/column context (dayplan core needs
  // boardId+columnId to emit reschedule ops). Card ids are globally unique.
  function allLiveCards(state) {
    var out = [];
    (state.boards || []).forEach(function (board) {
      (board.columns || []).forEach(function (column) {
        (column.cards || []).forEach(function (card) {
          out.push({
            boardId: board.id,
            columnId: column.id,
            cardId: card.id,
            title: card.title || '',
            due: card.due || '',
            priority: card.priority || 'none',
            completedAt: card.completedAt || null
          });
        });
      });
    });
    return out;
  }

  // The entire evening roll is ONE transaction: due changes and archives go
  // through the same Bulk machinery as multi-select actions, and the plan
  // update rides along — one undo entry reverts the whole day's roll.
  function applyDayRoll(dayISO, actions) {
    return commit(function (current) {
      var next = cloneState(current);
      var plan = KB.Core.DayPlan.sheetFor(next.dayplans || {}, dayISO);
      if (!plan) return noop(current, 'no-sheet');
      var result = KB.Core.DayPlan.rollPlan(plan, actions, allLiveCards(next), now());

      // Apply due changes grouped by their target value (Bulk applies one
      // patch per call; chaining inside this single commit keeps it atomic).
      var byValue = {};
      result.ops.forEach(function (op) {
        if (op.type !== 'due') return;
        if (!byValue[op.due]) byValue[op.due] = [];
        byValue[op.due].push({ boardId: op.boardId, columnId: op.columnId, cardId: op.cardId });
      });
      Object.keys(byValue).forEach(function (due) {
        next = KB.Core.Bulk.bulkUpdate(next, byValue[due], { due: due }, deps()).state;
      });

      var archiveRefs = result.ops.filter(function (op) { return op.type === 'archive'; })
        .map(function (op) { return { boardId: op.boardId, columnId: op.columnId, cardId: op.cardId }; });
      if (archiveRefs.length > 0) {
        next = KB.Core.Bulk.bulkArchive(next, archiveRefs, deps()).state;
      }

      next.dayplans[dayISO] = result.plan;
      return { changed: true, state: next, value: result.plan };
    });
  }

  KB.State.processRecurrences = processRecurrences;
  KB.State.addRecurrence = addRecurrence;
  KB.State.updateRecurrence = updateRecurrence;
  KB.State.deleteRecurrence = deleteRecurrence;
  KB.State.pauseRecurrence = pauseRecurrence;
  KB.State.resumeRecurrence = resumeRecurrence;
  KB.State.runRecurrenceNow = runRecurrenceNow;
  KB.State.skipRecurrenceNext = skipRecurrenceNext;
  KB.State.endRecurrence = endRecurrence;
  KB.State.captureInbox = captureInbox;
  KB.State.captureInboxLines = captureInboxLines;
  KB.State.updateInboxItem = updateInboxItem;
  KB.State.deleteInboxItem = deleteInboxItem;
  KB.State.triageInboxItem = triageInboxItem;
  KB.State.convertInboxToRecurrence = convertInboxToRecurrence;
  KB.State.mergeInboxItem = mergeInboxItem;
  KB.State.addLens = addLens;
  KB.State.updateLens = updateLens;
  KB.State.deleteLens = deleteLens;
  KB.State.bulkMove = bulkMove;
  KB.State.bulkUpdate = bulkUpdate;
  KB.State.bulkSetLabels = bulkSetLabels;
  KB.State.bulkSetFlow = bulkSetFlow;
  KB.State.bulkArchive = bulkArchive;
  KB.State.dayplans = dayplans;
  KB.State.daySheetFor = daySheetFor;
  KB.State.stampDay = stampDay;
  KB.State.applyDayRoll = applyDayRoll;
})(window.KB = window.KB || {});
