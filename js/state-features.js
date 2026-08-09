(function (KB) {
  var internal = KB.State.internal;
  var deps = internal.deps;
  var now = internal.now;
  var uid = internal.uid;
  var commit = internal.commit;
  var wrapResult = internal.wrapResult;
  function processRecurrences() {
    return wrapResult(function (current) {
      return KB.Core.Recurrence.processDueRecurrences(current, now(), deps());
    })();
  }

  function addRecurrence(definition) {
    return commit(function (current) {
      var next = JSON.parse(JSON.stringify(current));
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
    Object.keys(patch || {}).forEach(function (key) {
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
      var next = JSON.parse(JSON.stringify(current));
      var result = patchEntity(next.recurrences, recurrenceId, patch, 'not-found');
      if (!result.changed) return { changed: false, state: current, value: null, reason: result.reason };
      return { changed: true, state: next, value: result.entity };
    });
  }

  function deleteRecurrence(recurrenceId) {
    return commit(function (current) {
      var next = JSON.parse(JSON.stringify(current));
      var result = removeEntity(next.recurrences, recurrenceId, 'not-found');
      if (!result.changed) return { changed: false, state: current, value: null, reason: result.reason };
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
      var next = JSON.parse(JSON.stringify(current));
      var recurrence = next.recurrences.find(function (r) { return r.id === recurrenceId; });
      if (!recurrence) return { changed: false, state: current, value: null, reason: 'not-found' };
      recurrence.nextRunAt = KB.Core.Recurrence.computeNextRun(recurrence, recurrence.nextRunAt === null ? now() : recurrence.nextRunAt);
      recurrence.updatedAt = now();
      return { changed: true, state: next, value: recurrence };
    });
  }

  function endRecurrence(recurrenceId) {
    return commit(function (current) {
      var next = JSON.parse(JSON.stringify(current));
      var recurrence = next.recurrences.find(function (r) { return r.id === recurrenceId; });
      if (!recurrence) return { changed: false, state: current, value: null, reason: 'not-found' };
      if (recurrence.endAt !== null) return { changed: false, state: current, value: null, reason: 'already-ended' };
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
      var next = JSON.parse(JSON.stringify(current));
      var items = next.inbox && Array.isArray(next.inbox.items) ? next.inbox.items : [];
      var index = items.findIndex(function (it) { return it.id === inboxId; });
      if (index === -1) return { changed: false, state: current, value: null, reason: 'item-not-found' };
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
      var next = JSON.parse(JSON.stringify(current));
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
      var next = JSON.parse(JSON.stringify(current));
      var result = patchEntity(next.lenses, lensId, patch, 'not-found');
      if (!result.changed) return { changed: false, state: current, value: null, reason: result.reason };
      return { changed: true, state: next, value: result.entity };
    });
  }

  function deleteLens(lensId) {
    return commit(function (current) {
      var next = JSON.parse(JSON.stringify(current));
      var result = removeEntity(next.lenses, lensId, 'not-found');
      if (!result.changed) return { changed: false, state: current, value: null, reason: result.reason };
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
})(window.KB = window.KB || {});
