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
        if (Object.prototype.hasOwnProperty.call(obj, key)) out[key] = obj[key];
      }
      return out;
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
      return out;
    }

    function normalizeColumn(column, deps) {
      var d = resolveDeps(deps);
      if (!column || typeof column !== 'object') return null;
      var out = cloneShallow(column);
      if (typeof out.id !== 'string' || !out.id) out.id = d.uid();
      if (typeof out.title !== 'string') out.title = '';
      if (typeof out.isDone !== 'boolean') out.isDone = false;
      if (typeof out.wipLimit !== 'number') out.wipLimit = 0;
      if (typeof out.collapsed !== 'boolean') out.collapsed = false;
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
        checklist: normalizeChecklist(template.checklist, deps)
      };
    }

    function normalizeBoard(board, deps) {
      var d = resolveDeps(deps);
      if (!board || typeof board !== 'object') return null;
      var out = cloneShallow(board);
      if (typeof out.id !== 'string' || !out.id) out.id = d.uid();
      if (typeof out.name !== 'string') out.name = '';
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

    function normalizeState(state, deps) {
      var d = resolveDeps(deps);
      var out = cloneShallow(state);
      out.version = 2;
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
      return out;
    }

    function adoptBoardShape(raw, name, deps) {
      var d = resolveDeps(deps);
      var source = raw && typeof raw === 'object' ? raw : {};
      var board = Model.createBoard(name, deps);
      board.labels = (Array.isArray(source.labels) ? source.labels : []).map(normalizeLabel).filter(Boolean);
      board.templates = (Array.isArray(source.templates) ? source.templates : [])
        .map(function (t) { return normalizeTemplate(t, deps); }).filter(Boolean);
      board.columns = (Array.isArray(source.columns) ? source.columns : []).map(function (column) {
        var columnId = column && column.id ? column.id : d.uid();
        return normalizeColumn({
          id: columnId,
          title: column && typeof column.title === 'string' ? column.title : '',
          isDone: Boolean(column && column.isDone),
          wipLimit: column && column.wipLimit || 0,
          collapsed: Boolean(column && column.collapsed),
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
          return Object.assign({}, entry, { id: entryId, cards: cards });
        })
      };
      return board;
    }

    function migrateV1(stateV1, deps) {
      var board = adoptBoardShape(stateV1, 'My Board', deps);
      return {
        version: 2,
        theme: stateV1 && typeof stateV1.theme === 'string' ? stateV1.theme : 'dark',
        activeBoardId: board.id,
        boards: [board]
      };
    }

    function parseImportPayload(text, currentState, deps) {
      try {
        var parsed = JSON.parse(text);
        if (!parsed) return { kind: null };
        if (Array.isArray(parsed.boards) && parsed.version === 2 && parsed.boards.length > 0) {
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
      normalizeCard: normalizeCard,
      normalizeColumn: normalizeColumn,
      normalizeLabel: normalizeLabel,
      normalizeTemplate: normalizeTemplate,
      normalizeBoard: normalizeBoard,
      normalizeState: normalizeState,
      adoptBoardShape: adoptBoardShape,
      migrateV1: migrateV1,
      parseImportPayload: parseImportPayload
    };
  }
);
