(function (root, factory) {
  var pipelineCore = (typeof module === 'object' && module.exports)
    ? require('./pipeline.js')
    : root.KB.Core.Pipeline;
  var api = factory(pipelineCore);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Recurrence = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function (Pipeline) {
    var MS_PER_DAY = 86400000;
    var CATCH_UP_CAP = 100;
    var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

    function resolveDeps(deps) {
      if (!deps || typeof deps.uid !== 'function' || typeof deps.now !== 'function') {
        throw new Error('core recurrence functions require { uid, now } dependencies');
      }
      return deps;
    }

    function isoDaysFromTs(ts, offsetDays) {
      var d = new Date(ts);
      d.setDate(d.getDate() + (offsetDays || 0));
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return d.getFullYear() + '-' + m + '-' + day;
    }

    function startOfDay(ts) {
      var d = new Date(ts);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }

    function computeNextRun(definition, fromTimestamp) {
      var from = typeof fromTimestamp === 'number' ? fromTimestamp : Date.now();
      var schedule = definition && definition.schedule ? definition.schedule : {};
      var frequency = schedule.frequency || 'daily';
      var interval = Math.max(1, schedule.interval || 1);
      var weekdays = Array.isArray(schedule.weekdays) ? schedule.weekdays.filter(function (w) { return w >= 0 && w <= 6; }) : [];
      var dayOfMonth = schedule.dayOfMonth;

      var base = startOfDay(from);

      switch (frequency) {
        case 'monthly': {
          var baseDate = new Date(base);
          var target = typeof dayOfMonth === 'number' && dayOfMonth >= 1 && dayOfMonth <= 31 ? dayOfMonth : baseDate.getDate();
          var monthIndex = baseDate.getFullYear() * 12 + baseDate.getMonth();
          var offset = baseDate.getDate() > target ? interval : 0;
          var candidate = null;
          var attempts = 0;
          do {
            var index = monthIndex + offset;
            var year = Math.floor(index / 12);
            var month = index % 12;
            var maxDay = new Date(year, month + 1, 0).getDate();
            candidate = new Date(year, month, Math.min(target, maxDay));
            offset += interval;
            attempts += 1;
          } while (candidate.getTime() <= base && attempts < 12);
          return candidate.getTime();
        }
        case 'weekly': {
          if (weekdays.length === 0) {
            var wd = new Date(base);
            wd.setDate(wd.getDate() + 7 * interval);
            return wd.getTime();
          }
          for (var i = 1; i <= 7; i++) {
            var candidate = new Date(base);
            candidate.setDate(candidate.getDate() + i);
            if (weekdays.indexOf(candidate.getDay()) !== -1) {
              candidate.setDate(candidate.getDate() + 7 * (interval - 1));
              return candidate.getTime();
            }
          }
          return base + 7 * interval * MS_PER_DAY;
        }
        case 'daily':
        case 'custom':
        default:
          return base + interval * MS_PER_DAY;
      }
    }

    function createOccurrence(state, recurrence, deps) {
      var d = resolveDeps(deps);
      if (typeof recurrence.remainingOccurrences === 'number' && recurrence.remainingOccurrences <= 0) {
        return { changed: false, state: state, reason: 'occurrence-limit' };
      }
      var now = d.now();
      var board = state.boards.find(function (b) { return b.id === recurrence.target.boardId; });
      if (!board) return { changed: false, state: state, reason: 'missing-board' };
      var column = board.columns.find(function (c) { return c.id === recurrence.target.columnId; });
      if (!column) return { changed: false, state: state, reason: 'missing-column' };
      var template = recurrence.template || {};
      var card = {
        id: d.uid(),
        columnId: column.id,
        title: template.title || 'Recurring task',
        description: template.description || '',
        labels: (template.labelIds || []).slice(),
        assignee: template.assignee || '',
        due: recurrence.dueOffsetDays !== null && recurrence.dueOffsetDays !== undefined ? isoDaysFromTs(now, recurrence.dueOffsetDays) : '',
        checklist: (template.checklist || []).map(function (item) {
          return { id: d.uid(), text: item.text || '', done: false };
        }),
        priority: template.priority || 'none',
        size: template.size || 'none',
        createdAt: now,
        updatedAt: now,
        movedAt: now,
        startedAt: null,
        completedAt: null,
        flow: { state: 'normal', reason: '', since: null, periods: [] },
        dependencies: { blockers: [], related: [] },
        recurrenceId: recurrence.id,
        transitions: []
      };
      var placed = Pipeline.placeCard(state, card, null, board, column, {
        recurrenceSideEffect: false
      }, deps);
      if (!placed.changed) {
        return { changed: false, state: state, reason: placed.reason || 'placement-failed', evaluation: placed.evaluation };
      }
      var created = placed.value;
      recurrence.activeCardRef = { boardId: recurrence.target.boardId, cardId: created.id };
      recurrence.lastRunAt = now;
      recurrence.nextRunAt = recurrence.mode === 'after-completion' ? null : computeNextRun(recurrence, now);
      recurrence.lastCompletedAt = null;
      recurrence.policyBlocked = false;
      if (typeof recurrence.remainingOccurrences === 'number') {
        recurrence.remainingOccurrences -= 1;
      }
      return { changed: true, state: state, value: created, reason: null };
    }

    function activeCardIsOpen(state, recurrence) {
      var ref = recurrence.activeCardRef;
      if (!ref) return false;
      var board = state.boards.find(function (b) { return b.id === ref.boardId; });
      if (!board) return false;
      for (var i = 0; i < board.columns.length; i++) {
        var column = board.columns[i];
        for (var j = 0; j < column.cards.length; j++) {
          if (column.cards[j].id === ref.cardId) {
            return column.role !== 'done';
          }
        }
      }
      return false;
    }

    function activeCardIsDone(state, recurrence) {
      var ref = recurrence.activeCardRef;
      if (!ref) return false;
      var board = state.boards.find(function (b) { return b.id === ref.boardId; });
      if (!board) return false;
      for (var i = 0; i < board.columns.length; i++) {
        var column = board.columns[i];
        for (var j = 0; j < column.cards.length; j++) {
          if (column.cards[j].id === ref.cardId) {
            return column.role === 'done';
          }
        }
      }
      return false;
    }

    function occurrencesMissedSince(recurrence, now) {
      var anchor = recurrence.lastRunAt !== null ? recurrence.lastRunAt : (recurrence.createdAt || 0);
      var count = 0;
      var run = recurrence.nextRunAt;
      if (run === null) run = computeNextRun(recurrence, anchor);
      while (run <= now && count <= CATCH_UP_CAP) {
        count += 1;
        run = computeNextRun(recurrence, run);
      }
      return count;
    }

    function markPolicyBlocked(result, recurrence) {
      if (result && result.reason === 'policy' && !recurrence.policyBlocked) {
        recurrence.policyBlocked = true;
        return true;
      }
      return false;
    }

    function processDueRecurrences(state, now, deps) {
      var d = resolveDeps(deps);
      var next = JSON.parse(JSON.stringify(state));
      var created = 0;
      var skippedWaiting = 0;
      var disabled = 0;
      var advanced = 0;
      var attention = 0;

      (next.recurrences || []).forEach(function (recurrence) {
        if (!recurrence.enabled) return;

        if (recurrence.endAt !== null && now >= recurrence.endAt) {
          recurrence.enabled = false;
          recurrence.pausedReason = 'End condition reached';
          disabled += 1;
          return;
        }
        if (typeof recurrence.remainingOccurrences === 'number' && recurrence.remainingOccurrences <= 0) {
          recurrence.enabled = false;
          recurrence.pausedReason = 'Occurrence limit reached';
          disabled += 1;
          return;
        }

        var board = next.boards.find(function (b) { return b.id === recurrence.target.boardId; });
        if (!board) {
          recurrence.enabled = false;
          recurrence.pausedReason = 'Target board deleted';
          disabled += 1;
          return;
        }
        var column = board.columns.find(function (c) { return c.id === recurrence.target.columnId; });
        if (!column) {
          if (!recurrence.needsAttention) {
            recurrence.needsAttention = true;
            attention += 1;
          }
          return;
        }
        if (recurrence.needsAttention) {
          recurrence.needsAttention = false;
          attention += 1;
        }

        if (recurrence.nextRunAt === null) {
          if (recurrence.mode === 'after-completion') {
            if (!recurrence.activeCardRef) {
              var seed = createOccurrence(next, recurrence, deps);
              if (seed.changed) created += 1;
              else if (markPolicyBlocked(seed, recurrence)) attention += 1;
            }
            return;
          }
          recurrence.nextRunAt = computeNextRun(recurrence, recurrence.createdAt || now);
        }

        if (activeCardIsDone(next, recurrence)) {
          recurrence.activeCardRef = null;
        }
        if (recurrence.overlapPolicy === 'single-active' && activeCardIsOpen(next, recurrence)) {
          skippedWaiting += 1;
          return;
        }

        if (recurrence.nextRunAt > now) return;

        if (recurrence.mode === 'after-completion') {
          var result = createOccurrence(next, recurrence, deps);
          if (result.changed) created += 1;
          else if (markPolicyBlocked(result, recurrence)) attention += 1;
          return;
        }

        var missed = occurrencesMissedSince(recurrence, now);
        var toCreate = 1;
        var catchingUp = false;
        if (recurrence.missedPolicy === 'skip') {
          toCreate = 0;
          recurrence.nextRunAt = computeNextRun(recurrence, now);
          recurrence.lastRunAt = now;
          advanced += 1;
        } else if (recurrence.missedPolicy === 'catch-up-all') {
          toCreate = Math.max(0, Math.min(missed, CATCH_UP_CAP - created));
          catchingUp = toCreate > 1;
        }

        for (var i = 0; i < toCreate; i++) {
          if (!catchingUp && recurrence.overlapPolicy === 'single-active' && activeCardIsOpen(next, recurrence)) break;
          var result2 = createOccurrence(next, recurrence, deps);
          if (!result2.changed) {
            if (markPolicyBlocked(result2, recurrence)) attention += 1;
            break;
          }
          created += 1;
        }
      });

      if (created === 0 && disabled === 0 && advanced === 0 && attention === 0) {
        return { changed: false, state: state, created: 0, skippedWaiting: skippedWaiting, disabled: 0, advanced: 0 };
      }
      return { changed: true, state: next, created: created, skippedWaiting: skippedWaiting, disabled: disabled, advanced: advanced };
    }

    function handleRecurringCardCompletion(state, cardRef, now, deps) {
      var d = resolveDeps(deps);
      var next = JSON.parse(JSON.stringify(state));
      var board = next.boards.find(function (b) { return b.id === cardRef.boardId; });
      if (!board) return { changed: false, state: state };
      var card = null;
      board.columns.forEach(function (column) {
        if (card) return;
        card = column.cards.find(function (c) { return c.id === cardRef.cardId; }) || null;
      });
      if (!card || !card.recurrenceId) return { changed: false, state: state };
      var recurrence = next.recurrences.find(function (r) { return r.id === card.recurrenceId; });
      if (!recurrence || !recurrence.enabled) return { changed: false, state: state };

      var completedAt = card.completedAt;
      if (typeof completedAt !== 'number') return { changed: false, state: state };

      var changed = false;
      if (recurrence.mode === 'after-completion') {
        if (recurrence.nextRunAt === null || recurrence.nextRunAt <= completedAt) {
          recurrence.lastCompletedAt = completedAt;
          var delay = recurrence.schedule.delayAfterCompletionDays;
          var delayDays = typeof delay === 'number' && delay > 0 ? delay : 1;
          recurrence.nextRunAt = startOfDay(completedAt) + delayDays * MS_PER_DAY;
          recurrence.lastRunAt = null;
          changed = true;
        }
        if (recurrence.activeCardRef && recurrence.activeCardRef.boardId === cardRef.boardId && recurrence.activeCardRef.cardId === cardRef.cardId) {
          recurrence.activeCardRef = null;
          changed = true;
        }
      } else if (recurrence.mode === 'scheduled') {
        if (recurrence.activeCardRef && recurrence.activeCardRef.boardId === cardRef.boardId && recurrence.activeCardRef.cardId === cardRef.cardId) {
          recurrence.activeCardRef = null;
          changed = true;
        }
        if (recurrence.nextRunAt === null || recurrence.nextRunAt <= completedAt) {
          recurrence.nextRunAt = computeNextRun(recurrence, completedAt);
          changed = true;
        }
      }

      if (!changed) return { changed: false, state: state };
      return { changed: true, state: next, recurrence: recurrence };
    }

    function pauseRecurrence(state, recurrenceId, reason, deps) {
      var d = resolveDeps(deps);
      var next = JSON.parse(JSON.stringify(state));
      var recurrence = next.recurrences.find(function (r) { return r.id === recurrenceId; });
      if (!recurrence) return { changed: false, state: state, reason: 'not-found' };
      if (!recurrence.enabled) return { changed: false, state: state, reason: 'already-paused' };
      recurrence.enabled = false;
      recurrence.pausedReason = typeof reason === 'string' ? reason : 'Paused';
      recurrence.updatedAt = d.now();
      return { changed: true, state: next, recurrence: recurrence };
    }

    function resumeRecurrence(state, recurrenceId, deps) {
      var d = resolveDeps(deps);
      var next = JSON.parse(JSON.stringify(state));
      var recurrence = next.recurrences.find(function (r) { return r.id === recurrenceId; });
      if (!recurrence) return { changed: false, state: state, reason: 'not-found' };
      if (recurrence.enabled) return { changed: false, state: state, reason: 'not-paused' };
      recurrence.enabled = true;
      recurrence.pausedReason = '';
      recurrence.updatedAt = d.now();
      if (recurrence.nextRunAt === null || recurrence.nextRunAt < d.now()) {
        recurrence.nextRunAt = computeNextRun(recurrence, d.now());
      }
      return { changed: true, state: next, recurrence: recurrence };
    }

    function runNow(state, recurrenceId, deps) {
      var d = resolveDeps(deps);
      var next = JSON.parse(JSON.stringify(state));
      var recurrence = next.recurrences.find(function (r) { return r.id === recurrenceId; });
      if (!recurrence) return { changed: false, state: state, reason: 'not-found' };
      if (recurrence.overlapPolicy === 'single-active' && activeCardIsOpen(next, recurrence)) {
        return { changed: false, state: state, reason: 'single-active' };
      }
      if (recurrence.mode === 'after-completion' && recurrence.lastCompletedAt !== null) {
        var delay2 = recurrence.schedule.delayAfterCompletionDays;
        var delayDays2 = typeof delay2 === 'number' && delay2 > 0 ? delay2 : 1;
        if (recurrence.lastCompletedAt + delayDays2 * MS_PER_DAY > d.now()) {
          return { changed: false, state: state, reason: 'too-early' };
        }
      }
      var result = createOccurrence(next, recurrence, deps);
      if (!result.changed) return { changed: false, state: state, reason: result.reason || 'creation-failed' };
      return { changed: true, state: next, value: result.value };
    }

    return {
      CATCH_UP_CAP: CATCH_UP_CAP,
      computeNextRun: computeNextRun,
      createOccurrence: createOccurrence,
      processDueRecurrences: processDueRecurrences,
      handleRecurringCardCompletion: handleRecurringCardCompletion,
      pauseRecurrence: pauseRecurrence,
      resumeRecurrence: resumeRecurrence,
      runNow: runNow,
      activeCardIsOpen: activeCardIsOpen,
      activeCardIsDone: activeCardIsDone,
      isoDaysFromTs: isoDaysFromTs
    };
  }
);
