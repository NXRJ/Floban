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

  // ---- Focus sessions (task-tied timer + effort logging) ----

  function findCardById(state, cardId) {
    for (var i = 0; i < state.boards.length; i++) {
      var board = state.boards[i];
      for (var j = 0; j < board.columns.length; j++) {
        var column = board.columns[j];
        var card = column.cards.find(function (c) { return c.id === cardId; });
        if (card) return { board: board, column: column, card: card };
      }
    }
    return null;
  }

  function focusSession() {
    return KB.State.data().focusSession || null;
  }

  function focusTotals(sinceISO) {
    return KB.Core.Focus.focusTotals(KB.State.data().focusDays, sinceISO);
  }

  function startFocus(cardId, kind) {
    return commit(function (current) {
      var next = cloneState(current);
      if (next.focusSession) return noop(current, 'session-active');
      var located = findCardById(next, cardId);
      if (!located) return noop(current, 'card-not-found');
      next.focusSession = {
        cardId: cardId,
        startedAt: now(),
        kind: kind === 'stopwatch' ? 'stopwatch' : 'pomodoro'
      };
      return { changed: true, state: next, value: next.focusSession };
    });
  }

  // Ends the running session and stamps card effort + the per-day focus log
  // in ONE atomic transaction (one undo entry reverts the whole stamp).
  function endFocus() {
    return commit(function (current) {
      var next = cloneState(current);
      var session = next.focusSession;
      if (!session) return noop(current, 'no-session');
      var result = KB.Core.Focus.computeEnd(session, now());
      next.focusSession = null;
      if (!result.logged) return { changed: true, state: next, value: { logged: false } };
      var located = findCardById(next, session.cardId);
      if (located) {
        var effort = located.card.effort || { pomodoros: 0, minutes: 0 };
        located.card.effort = {
          pomodoros: (effort.pomodoros || 0) + result.pomodoros,
          minutes: (effort.minutes || 0) + result.minutes
        };
        located.card.updatedAt = now();
      }
      if (!next.focusDays) next.focusDays = {};
      var day = next.focusDays[result.dayISO] || { minutes: 0, pomodoros: 0 };
      next.focusDays[result.dayISO] = {
        minutes: (day.minutes || 0) + result.minutes,
        pomodoros: (day.pomodoros || 0) + result.pomodoros
      };
      return { changed: true, state: next, value: result };
    });
  }

  // ---- HI-SCORE completion streak (derived projection + bookkeeping) ----

  // All cards across every board, live and archived — the streak is a
  // board-wide score, not a per-board one. completedAt is the only input.
  function allCompletedCards(state) {
    var out = [];
    (state.boards || []).forEach(function (board) {
      (board.columns || []).forEach(function (column) {
        (column.cards || []).forEach(function (card) {
          out.push(card);
        });
      });
      var archive = board.archive || {};
      (archive.columns || []).forEach(function (ac) {
        (ac.cards || []).forEach(function (card) { out.push(card); });
      });
      (archive.cards || []).forEach(function (card) { out.push(card); });
    });
    return out;
  }

  // Pure projection: current/best/todayDone/week from completedAt data,
  // with best floored at the persisted high score (undo/delete must never
  // deflate the record).
  function streakSnapshot() {
    var current = KB.State.data();
    var info = KB.Core.Streak.compute(allCompletedCards(current), now(), {});
    var stored = current.streaks || { best: 0, lastSeen: null };
    return {
      current: info.current,
      best: Math.max(info.best, stored.best || 0),
      todayDone: info.todayDone,
      week: info.week,
      goal: info.goal
    };
  }

  // Observe the current streak: bump the persisted high score and record
  // the lastSeen observation (used for milestone crossing detection). This
  // is derived bookkeeping — it deliberately does NOT push history, so
  // Ctrl+Z over a completion never un-writes a high score.
  function observeStreak(observation) {
    var current = KB.State.data();
    if (!current.streaks) current.streaks = { best: 0, lastSeen: null };
    var info = observation || streakSnapshot();
    if (info.current > (current.streaks.best || 0)) {
      current.streaks.best = info.current;
      internal.save('streak-best');
    }
    var todayISO = KB.Core.Date.isoDate(new Date(internal.now()));
    var lastSeen = current.streaks.lastSeen;
    if (!lastSeen || lastSeen.dayISO !== todayISO || lastSeen.streak !== info.current) {
      current.streaks.lastSeen = { streak: info.current, dayISO: todayISO };
      internal.save('streak-seen');
    }
    return current.streaks;
  }

  KB.State.streakSnapshot = streakSnapshot;
  KB.State.observeStreak = observeStreak;

  // ---- ARRIVAL import/export (migration kit) ----

  // Apply a mapped import as ONE atomic state transition — a single history
  // entry, so one Ctrl+Z reverts the whole migration.
  function importTasks(mapped) {
    return commit(function (current) {
      return KB.Core.Importer.applyImport(current, mapped, deps());
    });
  }

  KB.State.importTasks = importTasks;

  // ---- CARTRIDGE: board templates ----

  function boardTemplates() {
    return (KB.State.data().templates || []).slice();
  }

  function saveTemplate(payload) {
    var tpl = KB.Core.Template.validateTemplate(payload);
    if (!tpl) return null;
    return commit(function (current) {
      var next = cloneState(current);
      var existing = (next.templates || []).findIndex(function (t) { return t.name === tpl.name; });
      var saved = Object.assign({}, tpl, { createdAt: tpl.createdAt || now(), starred: false });
      if (existing !== -1) next.templates[existing] = saved;
      else next.templates.push(saved);
      return { changed: true, state: next, value: saved };
    });
  }

  function updateTemplate(name, patch) {
    return commit(function (current) {
      var next = cloneState(current);
      var tpl = (next.templates || []).find(function (t) { return t.name === name; });
      if (!tpl) return noop(current, 'not-found');
      if (patch.starred !== undefined) tpl.starred = Boolean(patch.starred);
      if (typeof patch.description === 'string') tpl.description = patch.description;
      if (typeof patch.name === 'string' && patch.name) tpl.name = patch.name;
      return { changed: true, state: next, value: tpl };
    });
  }

  function deleteTemplate(name) {
    return commit(function (current) {
      var next = cloneState(current);
      var index = (next.templates || []).findIndex(function (t) { return t.name === name; });
      if (index === -1) return noop(current, 'not-found');
      next.templates.splice(index, 1);
      return { changed: true, state: next, value: name };
    });
  }

  // Apply a template: create the board + columns + starter cards in ONE
  // atomic transition (one undo entry reverts the whole instantiation).
  function applyTemplate(name, boardName) {
    return commit(function (current) {
      var tpl = (current.templates || []).find(function (t) { return t.name === name; });
      if (!tpl) return noop(current, 'template-not-found');
      return KB.Core.Template.materializeTemplate(current, tpl, { name: boardName }, deps());
    });
  }

  KB.State.boardTemplates = boardTemplates;
  KB.State.saveTemplate = saveTemplate;
  KB.State.updateTemplate = updateTemplate;
  KB.State.deleteTemplate = deleteTemplate;
  KB.State.applyTemplate = applyTemplate;

  // ---- PING: follow-up engine on the waiting flow state ----

  function locateCardLive(state, cardId) {
    for (var i = 0; i < state.boards.length; i++) {
      var board = state.boards[i];
      for (var j = 0; j < board.columns.length; j++) {
        var column = board.columns[j];
        var card = column.cards.find(function (c) { return c.id === cardId; });
        if (card) return { board: board, column: column, card: card };
      }
    }
    return null;
  }

  // Arm a waiting card with a follow-up date. One undo entry.
  function armPing(cardId, opts) {
    return commit(function (current) {
      var located = locateCardLive(current, cardId);
      if (!located) return noop(current, 'card-not-found');
      var result = KB.Core.Ping.armPing(located.card, opts || {}, now());
      if (!result.changed) return noop(current, result.reason || 'not-waiting');
      var next = cloneState(current);
      var nextCard = findCardById(next, cardId);
      if (!nextCard) return noop(current, 'card-not-found');
      nextCard.card.ping = result.card.ping;
      nextCard.card.updatedAt = now();
      return { changed: true, state: next, value: nextCard.card.ping };
    });
  }

  // Poke: record the follow-up and roll the next date. One undo entry.
  function pokeCard(cardId, note) {
    return commit(function (current) {
      var located = locateCardLive(current, cardId);
      if (!located) return noop(current, 'card-not-found');
      var result = KB.Core.Ping.poke(located.card, now(), note);
      if (!result.changed) return noop(current, result.reason || 'not-armed');
      var next = cloneState(current);
      var nextCard = findCardById(next, cardId);
      if (!nextCard) return noop(current, 'card-not-found');
      nextCard.card.ping = result.card.ping;
      nextCard.card.updatedAt = now();
      return { changed: true, state: next, value: result.card.ping };
    });
  }

  function pingCards() {
    var state = KB.State.data();
    var out = [];
    (state.boards || []).forEach(function (board) {
      (board.columns || []).forEach(function (column) {
        (column.cards || []).forEach(function (card) {
          if (card.ping) {
            out.push(Object.assign({}, card, { _boardId: board.id, _columnId: column.id }));
          }
        });
      });
    });
    return out;
  }

  // Update the contact on an armed ping without recording a poke.
  function setPingContact(cardId, contact) {
    return commit(function (current) {
      var located = locateCardLive(current, cardId);
      if (!located || !located.card.ping) return noop(current, 'not-armed');
      if (located.card.ping.contact === contact) return noop(current, 'no-change');
      var next = cloneState(current);
      var nextCard = findCardById(next, cardId);
      nextCard.card.ping.contact = contact;
      nextCard.card.updatedAt = now();
      return { changed: true, state: next, value: nextCard.card.ping };
    });
  }

  KB.State.armPing = armPing;
  KB.State.pokeCard = pokeCard;
  KB.State.setPingContact = setPingContact;
  KB.State.pingCards = pingCards;

  // ---- POWER METER: state-aware picking ----

  function powerState() {
    var power = KB.State.data().power || { band: 'mid', timeBudgetMin: null };
    return { band: power.band, timeBudgetMin: power.timeBudgetMin };
  }

  function setPowerBand(band) {
    if (KB.Core.Power.BANDS.indexOf(band) === -1) return null;
    return commit(function (current) {
      var next = cloneState(current);
      if (!next.power) next.power = { band: 'mid', timeBudgetMin: null };
      if (next.power.band === band) return noop(current, 'no-change');
      next.power.band = band;
      return { changed: true, state: next, value: next.power };
    });
  }

  function setPowerTimeBudget(minutes) {
    return commit(function (current) {
      var next = cloneState(current);
      if (!next.power) next.power = { band: 'mid', timeBudgetMin: null };
      var value = typeof minutes === 'number' && minutes > 0 ? minutes : null;
      if (next.power.timeBudgetMin === value) return noop(current, 'no-change');
      next.power.timeBudgetMin = value;
      return { changed: true, state: next, value: next.power };
    });
  }

  KB.State.powerState = powerState;
  KB.State.setPowerBand = setPowerBand;
  KB.State.setPowerTimeBudget = setPowerTimeBudget;

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
  KB.State.focusSession = focusSession;
  KB.State.focusTotals = focusTotals;
  KB.State.startFocus = startFocus;
  KB.State.endFocus = endFocus;
})(window.KB = window.KB || {});
