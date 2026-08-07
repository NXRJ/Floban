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
        fromColumn: ''
      }, overrides || {});
    }

    function createColumn(overrides, deps) {
      var d = resolveDeps(deps);
      return Object.assign({
        id: d.uid(),
        title: '',
        isDone: false,
        wipLimit: 0,
        collapsed: false,
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
        labels: [],
        templates: [],
        columns: [],
        archive: { cards: [], columns: [] }
      };
    }

    function createTemplate(overrides, deps) {
      var d = resolveDeps(deps);
      return Object.assign({
        id: d.uid(),
        title: '',
        description: '',
        labels: [],
        assignee: '',
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
      cloneChecklist: cloneChecklist
    };
  }
);
