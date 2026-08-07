(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Model = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function () {
    function resolveDeps(deps) {
      if (!deps || typeof deps.uid !== 'function' || typeof deps.now !== 'function') {
        throw new Error('core model operations require { uid, now } dependencies');
      }
      return deps;
    }

    function createCard(columnId, overrides, deps) {
      var d = resolveDeps(deps);
      return Object.assign({
        id: d.uid(),
        columnId: columnId,
        title: '',
        description: '',
        labels: [],
        assignee: '',
        createdAt: d.now(),
        updatedAt: d.now(),
        movedAt: d.now(),
        due: '',
        checklist: [],
        archivedAt: null,
        fromColumn: '',
        priority: 'none',
        size: 'none',
        startedAt: null,
        completedAt: null,
        flow: { state: 'normal', reason: '', since: null, periods: [] },
        dependencies: { blockers: [], related: [] },
        recurrenceId: null,
        transitions: []
      }, overrides || {});
    }

    function createColumn(overrides, deps) {
      var d = resolveDeps(deps);
      return Object.assign({
        id: d.uid(),
        title: '',
        isDone: false,
        role: 'queue',
        wipLimit: 0,
        collapsed: false,
        policy: {
          wipMode: 'off',
          overrideRequiresReason: false,
          entryCriteria: [],
          exitCriteria: [],
          defaultLabelIds: [],
          defaultAssignee: '',
          countsTowardCycleTime: true
        },
        cards: []
      }, overrides || {});
    }

    function createLabel(name, color, deps) {
      var d = resolveDeps(deps);
      return { id: d.uid(), name: name, color: color };
    }

    function createBoard(name, deps) {
      var d = resolveDeps(deps);
      return {
        id: d.uid(),
        name: name || 'New board',
        flowSettings: {
          staleAfterDays: 7,
          oversizedChecklistThreshold: 10,
          completedReviewAfterDays: 7,
          slePercentile: 0.85,
          manualSleDays: null
        },
        labels: [],
        templates: [],
        columns: [],
        archive: { cards: [], columns: [] }
      };
    }

    function createInboxItem(overrides, deps) {
      var d = resolveDeps(deps);
      return Object.assign({
        id: d.uid(),
        title: '',
        note: '',
        url: '',
        capturedAt: d.now(),
        updatedAt: d.now()
      }, overrides || {});
    }

    function createLens(overrides, deps) {
      var d = resolveDeps(deps);
      return Object.assign({
        id: d.uid(),
        name: 'New lens',
        scope: 'active-board',
        boardIds: [],
        query: {
          search: '',
          labelIds: [],
          assignees: [],
          due: 'any',
          priorities: [],
          sizes: [],
          flowStates: [],
          blockedOnly: false,
          readyOnly: false,
          columnRoles: [],
          includeCompleted: true
        },
        sort: { field: 'manual', direction: 'asc' },
        display: { density: 'comfortable', groupBy: 'board' },
        createdAt: d.now(),
        updatedAt: d.now()
      }, overrides || {});
    }

    function createRecurrence(overrides, deps) {
      var d = resolveDeps(deps);
      return Object.assign({
        id: d.uid(),
        enabled: true,
        mode: 'scheduled',
        schedule: {
          frequency: 'weekly',
          interval: 1,
          weekdays: [],
          dayOfMonth: null,
          delayAfterCompletionDays: null
        },
        target: { boardId: '', columnId: '' },
        template: {
          title: '',
          description: '',
          labelIds: [],
          assignee: '',
          priority: 'none',
          size: 'none',
          checklist: []
        },
        dueOffsetDays: null,
        overlapPolicy: 'single-active',
        missedPolicy: 'create-one',
        activeCardRef: null,
        nextRunAt: null,
        lastRunAt: null,
        lastCompletedAt: null,
        endAt: null,
        remainingOccurrences: null,
        needsAttention: false,
        policyBlocked: false,
        pausedReason: '',
        createdAt: d.now(),
        updatedAt: d.now()
      }, overrides || {});
    }

    function createTemplate(overrides, deps) {
      var d = resolveDeps(deps);
      return Object.assign({
        id: d.uid(),
        title: '',
        description: '',
        labels: [],
        assignee: '',
        priority: 'none',
        size: 'none',
        checklist: []
      }, overrides || {});
    }

    function cloneChecklist(checklist, deps) {
      var d = resolveDeps(deps);
      return (checklist || []).map(function (item) {
        return Object.assign({}, item, { id: d.uid() });
      });
    }

    return {
      createCard: createCard,
      createColumn: createColumn,
      createLabel: createLabel,
      createBoard: createBoard,
      createTemplate: createTemplate,
      cloneChecklist: cloneChecklist,
      createInboxItem: createInboxItem,
      createLens: createLens,
      createRecurrence: createRecurrence
    };
  }
);
