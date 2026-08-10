(function (root, factory) {
  var modelCore = (typeof module === 'object' && module.exports)
    ? require('./model.js')
    : root.KB.Core.Model;
  var api = factory(modelCore);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Migration = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function (Model) {
    var SAFE_LABEL_COLOR = '#6d30d6';
    var COLOR_RE = /^#[0-9a-fA-F]{6}$/;
    var STATE_VERSION = 3;
    var TRANSITION_LIMIT = 100;
    var PERIOD_LIMIT = 100;

    var PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'];
    var SIZES = ['none', 'xs', 's', 'm', 'l', 'xl'];
    var FLOW_STATES = ['normal', 'blocked', 'waiting', 'paused'];
    var COLUMN_ROLES = ['backlog', 'queue', 'active', 'done'];
    var WIP_MODES = ['off', 'soft', 'hard'];
    var LENS_SCOPES = ['active-board', 'all-boards', 'selected-boards'];
    var RECURRENCE_MODES = ['scheduled', 'after-completion'];
    var RECURRENCE_FREQUENCIES = ['daily', 'weekly', 'monthly', 'custom'];
    var OVERLAP_POLICIES = ['single-active', 'allow-overlap'];
    var MISSED_POLICIES = ['skip', 'create-one', 'catch-up-all'];

    function resolveDeps(deps) {
      if (!deps || typeof deps.uid !== 'function' || typeof deps.now !== 'function') {
        throw new Error('core migration functions require { uid, now } dependencies');
      }
      return deps;
    }

    function cloneShallow(obj) {
      var out = {};
      var key;
      if (!obj || typeof obj !== 'object') return out;
      for (key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          Object.defineProperty(out, key, {
            value: obj[key],
            enumerable: true,
            writable: true,
            configurable: true
          });
        }
      }
      return out;
    }

    function pickIn(values, value, fallback) {
      return values.indexOf(value) !== -1 ? value : fallback;
    }

    function toInt(value, fallback) {
      var n = typeof value === 'number' && isFinite(value) ? Math.floor(value) : (typeof value === 'string' && value !== '' && isFinite(Number(value)) ? Number(value) : null);
      if (n === null) return fallback;
      return n;
    }

    function toNumberOrNull(value) {
      if (typeof value === 'number' && isFinite(value)) return value;
      return null;
    }

    function toNullableInt(value) {
      if (value === null || value === undefined || value === '') return null;
      var n = toInt(value, null);
      return n;
    }

    function normalizeChecklistItem(item, deps) {
      var d = resolveDeps(deps);
      if (!item || typeof item !== 'object') return null;
      return {
        id: typeof item.id === 'string' && item.id ? item.id : d.uid(),
        text: typeof item.text === 'string' ? item.text : '',
        done: Boolean(item.done)
      };
    }

    function normalizeChecklist(checklist, deps) {
      if (!Array.isArray(checklist)) return [];
      return checklist.map(function (item) {
        return normalizeChecklistItem(item, deps);
      }).filter(Boolean);
    }

    function normalizeFlowPeriods(periods) {
      if (!Array.isArray(periods)) return [];
      return periods.map(function (period) {
        if (!period || typeof period !== 'object') return null;
        return {
          state: pickIn(FLOW_STATES, period.state, 'blocked'),
          reason: typeof period.reason === 'string' ? period.reason : '',
          startedAt: toNumberOrNull(period.startedAt),
          endedAt: toNumberOrNull(period.endedAt)
        };
      }).filter(Boolean).slice(-PERIOD_LIMIT);
    }

    function normalizeTransitions(transitions) {
      if (!Array.isArray(transitions)) return [];
      return transitions.map(function (t) {
        if (!t || typeof t !== 'object') return null;
        return {
          fromColumnId: typeof t.fromColumnId === 'string' ? t.fromColumnId : null,
          toColumnId: typeof t.toColumnId === 'string' ? t.toColumnId : '',
          fromRole: typeof t.fromRole === 'string' ? t.fromRole : null,
          toRole: pickIn(COLUMN_ROLES, t.toRole, 'queue'),
          at: toNumberOrNull(t.at)
        };
      }).filter(Boolean).slice(-TRANSITION_LIMIT);
    }

    function normalizeRelationRef(ref) {
      if (!ref || typeof ref !== 'object') return null;
      if (typeof ref.boardId !== 'string' || !ref.boardId) return null;
      if (typeof ref.cardId !== 'string' || !ref.cardId) return null;
      return { boardId: ref.boardId, cardId: ref.cardId };
    }

    function normalizeRelationList(list) {
      if (!Array.isArray(list)) return [];
      var seen = {};
      return list.map(normalizeRelationRef).filter(Boolean).filter(function (ref) {
        var key = ref.boardId + ':' + ref.cardId;
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
    }

    function normalizeDependencies(value) {
      var source = value && typeof value === 'object' ? value : {};
      return {
        blockers: normalizeRelationList(source.blockers),
        related: normalizeRelationList(source.related)
      };
    }

    function normalizeFlow(value) {
      var source = value && typeof value === 'object' ? value : {};
      return {
        state: pickIn(FLOW_STATES, source.state, 'normal'),
        reason: typeof source.reason === 'string' ? source.reason : '',
        since: toNumberOrNull(source.since),
        periods: normalizeFlowPeriods(source.periods)
      };
    }

    function normalizeOwnedCards(cards, ownerId, deps) {
      return (Array.isArray(cards) ? cards : []).map(function (card) {
        var normalized = normalizeCard(card, deps);
        if (normalized) normalized.columnId = ownerId;
        return normalized;
      }).filter(Boolean);
    }

    function normalizeCard(card, deps) {
      var d = resolveDeps(deps);
      if (!card || typeof card !== 'object') return null;
      var out = cloneShallow(card);
      if (typeof out.id !== 'string' || !out.id) out.id = d.uid();
      if (typeof out.columnId !== 'string') out.columnId = '';
      if (typeof out.title !== 'string') out.title = '';
      if (typeof out.due !== 'string') out.due = '';
      out.checklist = normalizeChecklist(out.checklist, deps);
      if (!Array.isArray(out.labels)) out.labels = [];
      out.labels = out.labels.filter(function (id) { return typeof id === 'string'; });
      if (typeof out.assignee !== 'string') out.assignee = '';
      if (typeof out.createdAt !== 'number') out.createdAt = d.now();
      if (typeof out.updatedAt !== 'number') out.updatedAt = out.createdAt;
      if (typeof out.movedAt !== 'number') out.movedAt = out.createdAt;
      out.priority = pickIn(PRIORITIES, out.priority, 'none');
      out.size = pickIn(SIZES, out.size, 'none');
      out.startedAt = toNumberOrNull(out.startedAt);
      out.completedAt = toNumberOrNull(out.completedAt);
      var effort = out.effort && typeof out.effort === 'object' ? out.effort : {};
      out.effort = {
        pomodoros: Math.max(0, toInt(effort.pomodoros, 0)),
        minutes: Math.max(0, toInt(effort.minutes, 0))
      };
      out.flow = normalizeFlow(out.flow);
      out.dependencies = normalizeDependencies(out.dependencies);
      out.recurrenceId = typeof out.recurrenceId === 'string' ? out.recurrenceId : null;
      out.transitions = normalizeTransitions(out.transitions, deps);
      out.ping = normalizePing(out.ping);
      return out;
    }

    // PING follow-up state on a card: tolerant of missing/malformed fields.
    function normalizePing(value) {
      if (!value || typeof value !== 'object') return null;
      var followUpAt = typeof value.followUpAt === 'number' && isFinite(value.followUpAt) ? value.followUpAt : null;
      if (followUpAt === null) return null;
      var logLimit = 20;
      var log = Array.isArray(value.log) ? value.log.filter(function (entry) {
        return entry && typeof entry === 'object' && typeof entry.at === 'number';
      }).slice(-logLimit).map(function (entry) {
        return { at: entry.at, note: typeof entry.note === 'string' ? entry.note : '' };
      }) : [];
      return {
        contact: typeof value.contact === 'string' ? value.contact : '',
        followUpAt: followUpAt,
        cadenceDays: typeof value.cadenceDays === 'number' && value.cadenceDays >= 1 ? value.cadenceDays : 3,
        escalateAfter: typeof value.escalateAfter === 'number' ? value.escalateAfter : 2,
        maxEscalation: typeof value.maxEscalation === 'number' ? value.maxEscalation : 4,
        lastPokedAt: typeof value.lastPokedAt === 'number' && isFinite(value.lastPokedAt) ? value.lastPokedAt : null,
        pokedCount: Math.max(0, typeof value.pokedCount === 'number' ? value.pokedCount : 0),
        log: log
      };
    }

    function inferColumnRole(column) {
      if (column && column.isDone) return 'done';
      var title = String(column && column.title || '').toLowerCase();
      if (/(done|complete|finished|released|shipped|archive)/.test(title)) return 'done';
      if (/(in progress|doing|wip|active|working|dev\b|development|in work)/.test(title)) return 'active';
      if (/(backlog|icebox|later|someday|parked)/.test(title)) return 'backlog';
      return 'queue';
    }

    function normalizePolicy(value, wipLimit) {
      var source = value && typeof value === 'object' ? value : {};
      var wipMode = pickIn(WIP_MODES, source.wipMode, wipLimit > 0 ? 'soft' : 'off');
      return {
        wipMode: wipMode,
        overrideRequiresReason: Boolean(source.overrideRequiresReason),
        entryCriteria: Array.isArray(source.entryCriteria)
          ? source.entryCriteria.filter(function (c) { return typeof c === 'string'; })
          : [],
        exitCriteria: Array.isArray(source.exitCriteria)
          ? source.exitCriteria.filter(function (c) { return typeof c === 'string'; })
          : [],
        defaultLabelIds: Array.isArray(source.defaultLabelIds)
          ? source.defaultLabelIds.filter(function (id) { return typeof id === 'string'; })
          : [],
        defaultAssignee: typeof source.defaultAssignee === 'string' ? source.defaultAssignee : '',
        countsTowardCycleTime: source.countsTowardCycleTime === false ? false : true
      };
    }

    function normalizeColumn(column, deps) {
      var d = resolveDeps(deps);
      if (!column || typeof column !== 'object') return null;
      var out = cloneShallow(column);
      if (typeof out.id !== 'string' || !out.id) out.id = d.uid();
      if (typeof out.title !== 'string') out.title = '';
      var role = pickIn(COLUMN_ROLES, out.role, inferColumnRole(out));
      out.role = role;
      out.isDone = role === 'done';
      if (typeof out.wipLimit !== 'number') out.wipLimit = 0;
      if (typeof out.collapsed !== 'boolean') out.collapsed = false;
      out.policy = normalizePolicy(out.policy, out.wipLimit);
      out.cards = normalizeOwnedCards(out.cards, out.id, deps);
      return out;
    }

    function normalizeLabel(label) {
      if (!label || typeof label !== 'object' || typeof label.id !== 'string' || !label.id) return null;
      return {
        id: label.id,
        name: typeof label.name === 'string' ? label.name : '',
        color: COLOR_RE.test(label.color || '') ? label.color : SAFE_LABEL_COLOR
      };
    }

    function normalizeTemplate(template, deps) {
      var d = resolveDeps(deps);
      if (!template || typeof template !== 'object') return null;
      return {
        id: typeof template.id === 'string' && template.id ? template.id : d.uid(),
        title: typeof template.title === 'string' ? template.title : (typeof template.name === 'string' ? template.name : ''),
        description: typeof template.description === 'string' ? template.description : '',
        labels: Array.isArray(template.labels) ? template.labels.filter(function (id) { return typeof id === 'string'; }) : [],
        assignee: typeof template.assignee === 'string' ? template.assignee : '',
        priority: pickIn(PRIORITIES, template.priority, 'none'),
        size: pickIn(SIZES, template.size, 'none'),
        checklist: normalizeChecklist(template.checklist, deps)
      };
    }

    function normalizeFlowSettings(value) {
      var source = value && typeof value === 'object' ? value : {};
      return {
        staleAfterDays: toInt(source.staleAfterDays, 7),
        oversizedChecklistThreshold: toInt(source.oversizedChecklistThreshold, 10),
        completedReviewAfterDays: toInt(source.completedReviewAfterDays, 7),
        slePercentile: typeof source.slePercentile === 'number' && isFinite(source.slePercentile) ? Math.max(0, Math.min(1, source.slePercentile)) : 0.85,
        manualSleDays: toNullableInt(source.manualSleDays)
      };
    }

    function normalizeBoard(board, deps) {
      var d = resolveDeps(deps);
      if (!board || typeof board !== 'object') return null;
      var out = cloneShallow(board);
      if (typeof out.id !== 'string' || !out.id) out.id = d.uid();
      if (typeof out.name !== 'string') out.name = '';
      out.flowSettings = normalizeFlowSettings(out.flowSettings);
      if (!Array.isArray(out.templates)) out.templates = [];
      out.templates = out.templates.map(function (t) { return normalizeTemplate(t, deps); }).filter(Boolean);
      if (!Array.isArray(out.labels)) out.labels = [];
      out.labels = out.labels.map(normalizeLabel).filter(Boolean);
      if (!Array.isArray(out.columns)) out.columns = [];
      out.columns = out.columns.map(function (c) { return normalizeColumn(c, deps); }).filter(Boolean);
      var archiveSource = out.archive && typeof out.archive === 'object' ? out.archive : {};
      var archiveCards = (Array.isArray(archiveSource.cards) ? archiveSource.cards : [])
        .map(function (card) { return normalizeCard(card, deps); }).filter(Boolean);
      var archiveColumns = (Array.isArray(archiveSource.columns) ? archiveSource.columns : [])
        .map(function (entry) {
          if (!entry || typeof entry !== 'object') return null;
          var e = cloneShallow(entry);
          if (typeof e.id !== 'string' || !e.id) e.id = d.uid();
          if (typeof e.title !== 'string') e.title = '';
          e.cards = normalizeOwnedCards(e.cards, e.id, deps);
          return e;
        }).filter(Boolean);
      out.archive = { cards: archiveCards, columns: archiveColumns };
      return out;
    }

    function normalizeInbox(inbox, deps) {
      var d = resolveDeps(deps);
      var source = inbox && typeof inbox === 'object' ? inbox : {};
      var items = Array.isArray(source.items) ? source.items : [];
      var seen = {};
      return {
        items: items.map(function (item) {
          if (!item || typeof item !== 'object') return null;
          var id = typeof item.id === 'string' && item.id ? item.id : d.uid();
          if (seen[id]) return null;
          seen[id] = true;
          var now = d.now();
          var capturedAt = toNumberOrNull(item.capturedAt);
          return {
            id: id,
            title: typeof item.title === 'string' ? item.title : '',
            note: typeof item.note === 'string' ? item.note : '',
            url: typeof item.url === 'string' ? item.url : '',
            archived: Boolean(item.archived),
            capturedAt: capturedAt === null ? now : capturedAt,
            updatedAt: toNumberOrNull(item.updatedAt) === null ? (capturedAt === null ? now : capturedAt) : toNumberOrNull(item.updatedAt)
          };
        }).filter(Boolean)
      };
    }

    function normalizeLens(lens, deps) {
      var d = resolveDeps(deps);
      if (!lens || typeof lens !== 'object') return null;
      var scope = pickIn(LENS_SCOPES, lens.scope, 'active-board');
      var querySource = lens.query && typeof lens.query === 'object' ? lens.query : {};
      var sortSource = lens.sort && typeof lens.sort === 'object' ? lens.sort : {};
      var displaySource = lens.display && typeof lens.display === 'object' ? lens.display : {};
      var now = d.now();
      return {
        id: typeof lens.id === 'string' && lens.id ? lens.id : d.uid(),
        name: typeof lens.name === 'string' ? lens.name : 'Lens',
        scope: scope,
        boardIds: Array.isArray(lens.boardIds)
          ? lens.boardIds.filter(function (id) { return typeof id === 'string'; })
          : [],
        query: {
          search: typeof querySource.search === 'string' ? querySource.search : '',
          labelIds: Array.isArray(querySource.labelIds) ? querySource.labelIds.filter(function (id) { return typeof id === 'string'; }) : [],
          assignees: Array.isArray(querySource.assignees) ? querySource.assignees.filter(function (a) { return typeof a === 'string'; }) : [],
          due: pickIn(['any', 'overdue', 'today', 'week', 'none'], querySource.due, 'any'),
          priorities: Array.isArray(querySource.priorities) ? querySource.priorities.filter(function (p) { return PRIORITIES.indexOf(p) !== -1; }) : [],
          sizes: Array.isArray(querySource.sizes) ? querySource.sizes.filter(function (s) { return SIZES.indexOf(s) !== -1; }) : [],
          flowStates: Array.isArray(querySource.flowStates) ? querySource.flowStates.filter(function (s) { return FLOW_STATES.indexOf(s) !== -1; }) : [],
          blockedOnly: Boolean(querySource.blockedOnly),
          readyOnly: Boolean(querySource.readyOnly),
          recentlyCompletedOnly: Boolean(querySource.recentlyCompletedOnly),
          agingOnly: Boolean(querySource.agingOnly),
          needsTriageOnly: Boolean(querySource.needsTriageOnly),
          agingDays: Math.max(0, toInt(querySource.agingDays, 7)),
          columnRoles: Array.isArray(querySource.columnRoles) ? querySource.columnRoles.filter(function (r) { return COLUMN_ROLES.indexOf(r) !== -1; }) : [],
          includeCompleted: querySource.includeCompleted === false ? false : true
        },
        sort: {
          field: pickIn(['manual', 'priority', 'due', 'created', 'updated', 'age', 'blocked-duration'], sortSource.field, 'manual'),
          direction: sortSource.direction === 'asc' ? 'asc' : 'desc'
        },
        display: {
          density: pickIn(['comfortable', 'compact'], displaySource.density, 'comfortable'),
          groupBy: pickIn(['board', 'column', 'priority', 'assignee', 'none'], displaySource.groupBy, 'board')
        },
        createdAt: orNow(lens.createdAt, now),
        updatedAt: orNow(lens.updatedAt, now)
      };
    }

    function normalizeRecurrence(recurrence, deps) {
      var d = resolveDeps(deps);
      if (!recurrence || typeof recurrence !== 'object') return null;
      var scheduleSource = recurrence.schedule && typeof recurrence.schedule === 'object' ? recurrence.schedule : {};
      var targetSource = recurrence.target && typeof recurrence.target === 'object' ? recurrence.target : {};
      var templateSource = recurrence.template && typeof recurrence.template === 'object' ? recurrence.template : {};
      var now = d.now();
      var frequency = pickIn(RECURRENCE_FREQUENCIES, scheduleSource.frequency, 'weekly');
      var mode = pickIn(RECURRENCE_MODES, recurrence.mode, 'scheduled');
      return {
        id: typeof recurrence.id === 'string' && recurrence.id ? recurrence.id : d.uid(),
        enabled: recurrence.enabled === false ? false : true,
        mode: mode,
        schedule: {
          frequency: frequency,
          interval: Math.max(1, toInt(scheduleSource.interval, 1)),
          weekdays: Array.isArray(scheduleSource.weekdays)
            ? scheduleSource.weekdays.filter(function (w) { return typeof w === 'number' && w >= 0 && w <= 6; })
            : [],
          dayOfMonth: toNullableInt(scheduleSource.dayOfMonth),
          delayAfterCompletionDays: toNullableInt(scheduleSource.delayAfterCompletionDays)
        },
        target: {
          boardId: typeof targetSource.boardId === 'string' ? targetSource.boardId : '',
          columnId: typeof targetSource.columnId === 'string' ? targetSource.columnId : ''
        },
        template: {
          title: typeof templateSource.title === 'string' ? templateSource.title : '',
          description: typeof templateSource.description === 'string' ? templateSource.description : '',
          labelIds: Array.isArray(templateSource.labelIds) ? templateSource.labelIds.filter(function (id) { return typeof id === 'string'; }) : [],
          assignee: typeof templateSource.assignee === 'string' ? templateSource.assignee : '',
          priority: pickIn(PRIORITIES, templateSource.priority, 'none'),
          size: pickIn(SIZES, templateSource.size, 'none'),
          checklist: normalizeChecklist(templateSource.checklist, deps)
        },
        dueOffsetDays: toNullableInt(recurrence.dueOffsetDays),
        overlapPolicy: pickIn(OVERLAP_POLICIES, recurrence.overlapPolicy, 'single-active'),
        missedPolicy: pickIn(MISSED_POLICIES, recurrence.missedPolicy, 'create-one'),
        activeCardRef: normalizeRelationRef(recurrence.activeCardRef),
        nextRunAt: toNumberOrNull(recurrence.nextRunAt),
        lastRunAt: toNumberOrNull(recurrence.lastRunAt),
        lastCompletedAt: toNumberOrNull(recurrence.lastCompletedAt),
        endAt: toNumberOrNull(recurrence.endAt),
        remainingOccurrences: toNullableInt(recurrence.remainingOccurrences),
        needsAttention: Boolean(recurrence.needsAttention),
        policyBlocked: Boolean(recurrence.policyBlocked),
        pausedReason: typeof recurrence.pausedReason === 'string' ? recurrence.pausedReason : '',
        createdAt: orNow(recurrence.createdAt, now),
        updatedAt: orNow(recurrence.updatedAt, now)
      };
    }

    function columnIndex(state) {
      var index = {};
      state.boards.forEach(function (board) {
        board.columns.forEach(function (column) {
          index[column.id] = { boardId: board.id, column: column };
        });
      });
      return index;
    }

    function locationIndex(state) {
      var index = {};
      state.boards.forEach(function (board) {
        var add = function (card) {
          index[board.id + ':' + card.id] = card;
        };
        board.columns.forEach(function (c) { c.cards.forEach(add); });
        board.archive.cards.forEach(add);
        board.archive.columns.forEach(function (entry) { entry.cards.forEach(add); });
      });
      return index;
    }

    // Timestamps default to "now" when missing or malformed.
    function orNow(value, now) {
      var n = toNumberOrNull(value);
      return n === null ? now : n;
    }

    // Every card in a board: live columns, then archive cards and entries.
    function boardCards(board) {
      var allCards = [];
      board.columns.forEach(function (c) { allCards.push.apply(allCards, c.cards); });
      allCards.push.apply(allCards, board.archive.cards);
      board.archive.columns.forEach(function (entry) { allCards.push.apply(allCards, entry.cards); });
      return allCards;
    }

    function repairDependencies(state) {
      var locations = locationIndex(state);
      state.boards.forEach(function (board) {
        boardCards(board).forEach(function (card) {
          ['blockers', 'related'].forEach(function (side) {
            var list = card.dependencies[side];
            if (!Array.isArray(list)) list = [];
            card.dependencies[side] = list.filter(function (ref) {
              if (!ref || !ref.boardId || !ref.cardId) return false;
              return locations[ref.boardId + ':' + ref.cardId] !== undefined;
            });
          });
          var self = { boardId: board.id, cardId: card.id };
          card.dependencies.blockers = card.dependencies.blockers.filter(function (ref) {
            return !(ref.boardId === self.boardId && ref.cardId === self.cardId);
          });
          card.dependencies.related = card.dependencies.related.filter(function (ref) {
            return !(ref.boardId === self.boardId && ref.cardId === self.cardId);
          });
        });
      });
      return state;
    }

    function repairRecurrences(state) {
      var locations = locationIndex(state);
      var columns = columnIndex(state);
      state.recurrences.forEach(function (recurrence) {
        var target = columns[recurrence.target.columnId];
        if (!target) {
          recurrence.activeCardRef = null;
          return;
        }
        var cardRef = recurrence.activeCardRef;
        if (!cardRef) return;
        if (locations[cardRef.boardId + ':' + cardRef.cardId] === undefined) recurrence.activeCardRef = null;
      });
      return state;
    }

    function repairLenses(state) {
      var boardIds = {};
      state.boards.forEach(function (b) { boardIds[b.id] = true; });
      state.lenses.forEach(function (lens) {
        lens.boardIds = lens.boardIds.filter(function (id) { return boardIds[id]; });
      });
      return state;
    }

    function normalizeFocusDays(value) {
      var out = {};
      if (!value || typeof value !== 'object') return out;
      Object.keys(value).forEach(function (key) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
        var entry = value[key];
        if (!entry || typeof entry !== 'object') return;
        out[key] = {
          minutes: Math.max(0, toInt(entry.minutes, 0)),
          pomodoros: Math.max(0, toInt(entry.pomodoros, 0))
        };
      });
      return out;
    }

    function normalizeFocusSession(value) {
      if (!value || typeof value !== 'object') return null;
      if (typeof value.cardId !== 'string' || !value.cardId) return null;
      if (typeof value.startedAt !== 'number') return null;
      return {
        cardId: value.cardId,
        startedAt: value.startedAt,
        kind: value.kind === 'stopwatch' ? 'stopwatch' : 'pomodoro'
      };
    }

    // HI-SCORE streak bookkeeping: { best, lastSeen }. `best` is the
    // monotonic high score (a stale streak never shrinks it — undoing a
    // completion must not deflate the record). `lastSeen` is the previous
    // observation { streak, dayISO } used to detect milestone crossings
    // across sessions. Tolerant of missing/corrupt values.
    function normalizeStreaks(value) {
      if (!value || typeof value !== 'object') {
        return { best: 0, lastSeen: null };
      }
      var best = Math.max(0, toInt(value.best, 0));
      var lastSeen = null;
      if (value.lastSeen && typeof value.lastSeen === 'object' &&
          typeof value.lastSeen.streak === 'number' &&
          typeof value.lastSeen.dayISO === 'string') {
        lastSeen = {
          streak: Math.max(0, value.lastSeen.streak),
          dayISO: value.lastSeen.dayISO
        };
      }
      return { best: best, lastSeen: lastSeen };
    }

    function normalizeDayplans(value) {
      var out = {};
      if (!value || typeof value !== 'object') return out;
      var DAYPLAN_STATUSES = ['open', 'done', 'kept', 'pushed', 'dropped', 'archived'];
      Object.keys(value).forEach(function (key) {
        var plan = value[key];
        if (!plan || typeof plan !== 'object') return;
        if (typeof plan.dateISO !== 'string' || plan.dateISO !== key) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.dateISO)) return;
        if (!Array.isArray(plan.commitments)) return;
        var commitments = plan.commitments
          .filter(function (c) { return c && typeof c === 'object' && typeof c.cardId === 'string' && c.cardId; })
          .map(function (c, index) {
            return {
              cardId: c.cardId,
              order: typeof c.order === 'number' ? c.order : index,
              status: DAYPLAN_STATUSES.indexOf(c.status) !== -1 ? c.status : 'open'
            };
          });
        out[key] = {
          dateISO: plan.dateISO,
          stampedAt: typeof plan.stampedAt === 'number' ? plan.stampedAt : null,
          rolledAt: typeof plan.rolledAt === 'number' ? plan.rolledAt : null,
          commitments: commitments
        };
      });
      return out;
    }

    function normalizeState(state, deps) {
      var out = cloneShallow(state);
      out.version = STATE_VERSION;
      if (!Array.isArray(out.boards)) out.boards = [];
      out.boards = out.boards.map(function (b) { return normalizeBoard(b, deps); }).filter(Boolean);
      if (typeof out.theme !== 'string') out.theme = 'dark';
      if (out.boards.length > 0) {
        if (!out.boards.some(function (b) { return b.id === out.activeBoardId; })) {
          out.activeBoardId = out.boards[0].id;
        }
      } else {
        out.activeBoardId = '';
      }
      out.inbox = normalizeInbox(out.inbox, deps);
      if (!Array.isArray(out.lenses)) out.lenses = [];
      out.lenses = out.lenses.map(function (l) { return normalizeLens(l, deps); }).filter(Boolean);
      if (!Array.isArray(out.recurrences)) out.recurrences = [];
      out.recurrences = out.recurrences.map(function (r) { return normalizeRecurrence(r, deps); }).filter(Boolean);
      out.dayplans = normalizeDayplans(out.dayplans);
      out.focusDays = normalizeFocusDays(out.focusDays);
      out.focusSession = normalizeFocusSession(out.focusSession);
      out.streaks = normalizeStreaks(out.streaks);
      out.templates = normalizeTemplates(out.templates);
      repairDependencies(out);
      repairRecurrences(out, deps);
      repairLenses(out);
      return out;
    }

    // CARTRIDGE board templates: array of validated payloads. Unknown fields
    // dropped, missing fields defaulted — mirrors validateTemplate in
    // js/core/template.js but lives here so the boot chain has no dependency
    // on load order.
    function normalizeTemplates(value) {
      if (!Array.isArray(value)) return [];
      return value.map(function (tpl) {
        if (!tpl || typeof tpl !== 'object') return null;
        var columns = Array.isArray(tpl.columns) ? tpl.columns.filter(function (c) { return c && typeof c === 'object'; }) : [];
        var labels = (tpl.boardMeta && Array.isArray(tpl.boardMeta.labels)) ? tpl.boardMeta.labels : [];
        return {
          version: 1,
          name: typeof tpl.name === 'string' && tpl.name ? tpl.name : 'Board template',
          description: typeof tpl.description === 'string' ? tpl.description : '',
          starred: Boolean(tpl.starred),
          createdAt: typeof tpl.createdAt === 'number' ? tpl.createdAt : null,
          boardMeta: {
            labels: labels.filter(function (l) {
              return l && typeof l === 'object' && typeof l.id === 'string' && typeof l.name === 'string';
            }).map(function (l) {
              return { id: l.id, name: l.name, color: typeof l.color === 'string' ? l.color : '#6d30d6' };
            })
          },
          columns: columns.map(function (c) {
            return {
              title: typeof c.title === 'string' ? c.title : '',
              role: ['queue', 'active', 'done', 'backlog'].indexOf(c.role) !== -1 ? c.role : 'queue',
              wipLimit: typeof c.wipLimit === 'number' && c.wipLimit >= 0 ? c.wipLimit : 0,
              wipMode: ['off', 'soft', 'hard'].indexOf(c.wipMode) !== -1 ? c.wipMode : 'off',
              entryCriteria: Array.isArray(c.entryCriteria) ? c.entryCriteria.filter(function (x) { return typeof x === 'string'; }) : [],
              exitCriteria: Array.isArray(c.exitCriteria) ? c.exitCriteria.filter(function (x) { return typeof x === 'string'; }) : [],
              defaultLabelIds: Array.isArray(c.defaultLabelIds) ? c.defaultLabelIds.filter(function (x) { return typeof x === 'string'; }) : [],
              defaultAssignee: typeof c.defaultAssignee === 'string' ? c.defaultAssignee : ''
            };
          }),
          starterCards: Array.isArray(tpl.starterCards) ? tpl.starterCards.filter(function (c) { return c && typeof c === 'object'; }).map(function (c) {
            return {
              title: typeof c.title === 'string' ? c.title : '',
              description: typeof c.description === 'string' ? c.description : '',
              labelIds: Array.isArray(c.labelIds) ? c.labelIds.filter(function (x) { return typeof x === 'string'; }) : [],
              checklist: Array.isArray(c.checklist) ? c.checklist.filter(function (i) { return i && typeof i === 'object'; }).map(function (i) {
                return { text: String(i.text || ''), done: Boolean(i.done) };
              }) : [],
              priority: ['none', 'low', 'medium', 'high', 'urgent'].indexOf(c.priority) !== -1 ? c.priority : 'none',
              size: ['none', 'xs', 's', 'm', 'l', 'xl'].indexOf(c.size) !== -1 ? c.size : 'none',
              columnTitle: typeof c.columnTitle === 'string' ? c.columnTitle : ''
            };
          }) : []
        };
      }).filter(Boolean);
    }

    function adoptBoardShape(raw, name, deps) {
      var d = resolveDeps(deps);
      var source = raw && typeof raw === 'object' ? raw : {};
      var originalId = typeof source.id === 'string' && source.id ? source.id : null;
      var board = Model.createBoard(name, deps);
      board.flowSettings = normalizeFlowSettings(source.flowSettings);
      board.labels = (Array.isArray(source.labels) ? source.labels : []).map(normalizeLabel).filter(Boolean);
      board.templates = (Array.isArray(source.templates) ? source.templates : [])
        .map(function (t) { return normalizeTemplate(t, deps); }).filter(Boolean);
      board.columns = (Array.isArray(source.columns) ? source.columns : []).map(function (column) {
        var columnId = column && column.id ? column.id : d.uid();
        return normalizeColumn({
          id: columnId,
          title: column && typeof column.title === 'string' ? column.title : '',
          isDone: Boolean(column && column.isDone),
          role: column && column.role,
          wipLimit: column && column.wipLimit || 0,
          collapsed: Boolean(column && column.collapsed),
          policy: column && column.policy,
          cards: (column && Array.isArray(column.cards) ? column.cards : []).map(function (card) {
            return normalizeCard(Model.createCard(columnId, card, deps), deps);
          })
        }, deps);
      }).filter(Boolean);
      board.archive = {
        cards: ((source.archive && Array.isArray(source.archive.cards)) ? source.archive.cards : []).map(function (card) {
          return normalizeCard(Model.createCard(card && card.columnId, card, deps), deps);
        }),
        columns: ((source.archive && Array.isArray(source.archive.columns)) ? source.archive.columns : []).map(function (entry) {
          var entryId = entry && typeof entry.id === 'string' && entry.id ? entry.id : d.uid();
          var cards = (entry && Array.isArray(entry.cards) ? entry.cards : []).map(function (card) {
            var normalized = normalizeCard(Model.createCard(entryId, card, deps), deps);
            if (normalized) normalized.columnId = entryId;
            return normalized;
          });
          return Object.assign(cloneShallow(entry), { id: entryId, cards: cards });
        })
      };
      if (originalId) {
        rewriteBoardInternalRefs(board, originalId);
        adoptBoardRecurrences(board, source, originalId, deps);
        adoptBoardLenses(board, source, deps);
      }
      return board;
    }

    function adoptBoardRecurrences(board, source, originalId, deps) {
      var d = resolveDeps(deps);
      var out = [];
      (Array.isArray(source.recurrences) ? source.recurrences : []).forEach(function (raw) {
        var rec = normalizeRecurrence(raw, deps);
        if (!rec) return;
        rec.id = d.uid();
        if (rec.target && rec.target.boardId === originalId) rec.target.boardId = board.id;
        if (rec.activeCardRef && rec.activeCardRef.boardId === originalId) rec.activeCardRef.boardId = board.id;
        out.push(rec);
      });
      Object.defineProperty(board, 'importedRecurrences', {
        value: out,
        enumerable: false,
        writable: true,
        configurable: true
      });
    }

    function adoptBoardLenses(board, source, deps) {
      var d = resolveDeps(deps);
      var out = [];
      (Array.isArray(source.lenses) ? source.lenses : []).forEach(function (raw) {
        var lens = normalizeLens(raw, deps);
        if (!lens) return;
        if (lens.scope === 'selected-boards' && lens.boardIds.length !== 1) return;
        lens.id = d.uid();
        out.push(lens);
      });
      Object.defineProperty(board, 'importedLenses', {
        value: out,
        enumerable: false,
        writable: true,
        configurable: true
      });
    }

    function rewriteBoardInternalRefs(board, originalId) {
      var dropped = 0;
      var rewrite = function (ref) {
        if (ref && ref.boardId === originalId) return { boardId: board.id, cardId: ref.cardId };
        return null;
      };
      var rewriteList = function (list) {
        var kept = [];
        (list || []).forEach(function (ref) {
          var mapped = rewrite(ref);
          if (mapped) kept.push(mapped);
          else if (ref && ref.boardId && ref.cardId) dropped += 1;
        });
        return kept;
      };
      var allCards = boardCards(board);
      allCards.forEach(function (card) {
        card.dependencies.blockers = rewriteList(card.dependencies.blockers);
        card.dependencies.related = rewriteList(card.dependencies.related);
      });
      Object.defineProperty(board, 'droppedDependencyRefs', {
        value: dropped,
        enumerable: false,
        writable: true,
        configurable: true
      });
    }

    function migrateV1(stateV1, deps) {
      var board = adoptBoardShape(stateV1, 'My Board', deps);
      return normalizeState({
        version: 1,
        theme: stateV1 && typeof stateV1.theme === 'string' ? stateV1.theme : 'dark',
        activeBoardId: board.id,
        boards: [board]
      }, deps);
    }

    function parseImportPayload(text, currentState, deps) {
      try {
        var parsed = JSON.parse(text);
        if (!parsed) return { kind: null };
        if (Array.isArray(parsed.boards) && parsed.boards.length > 0) {
          return { kind: 'all', state: normalizeState(parsed, deps) };
        }
        if (Array.isArray(parsed.columns) && Array.isArray(parsed.labels)) {
          return {
            kind: 'board',
            board: adoptBoardShape(parsed, parsed.name || 'Imported board', deps)
          };
        }
        return { kind: null };
      } catch (err) {
        return { kind: null };
      }
    }

    return {
      STATE_VERSION: STATE_VERSION,
      PRIORITIES: PRIORITIES,
      SIZES: SIZES,
      FLOW_STATES: FLOW_STATES,
      COLUMN_ROLES: COLUMN_ROLES,
      TRANSITION_LIMIT: TRANSITION_LIMIT,
      normalizeCard: normalizeCard,
      normalizeColumn: normalizeColumn,
      normalizeLabel: normalizeLabel,
      normalizeTemplate: normalizeTemplate,
      normalizeBoard: normalizeBoard,
      normalizeState: normalizeState,
      normalizeLens: normalizeLens,
      normalizeRecurrence: normalizeRecurrence,
      adoptBoardShape: adoptBoardShape,
      migrateV1: migrateV1,
      parseImportPayload: parseImportPayload
    };
  }
);
