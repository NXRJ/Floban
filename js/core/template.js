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
    root.KB.Core.Template = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function (Model) {
    // CARTRIDGE: board templates. Save a board's STRUCTURE (columns with
    // workflow roles, WIP policy, entry/exit criteria, default labels and
    // assignee, the label palette, optional starter cards) and stamp fresh
    // boards from it. Pure and deterministic — injected time/IDs, fresh
    // IDs on every materialization, lifecycle data stripped on save.

    var TEMPLATE_VERSION = 1;

    // ---- Snapshot: board -> template payload --------------------------------

    // Explicitly a COPY: starter cards keep only structural fields
    // (title/description/labels/checklist/priority/size), never timestamps,
    // lifecycle state, or activity. The source board is untouched.
    function snapshotBoard(board, opts) {
      var options = opts || {};
      var labelIds = {};
      (board.labels || []).forEach(function (label) {
        labelIds[label.id] = {
          id: label.id,
          name: label.name,
          color: label.color
        };
      });
      var columns = (board.columns || []).map(function (column) {
        var policy = column.policy || {};
        return {
          title: String(column.title || ''),
          role: column.role || 'queue',
          wipLimit: typeof column.wipLimit === 'number' ? column.wipLimit : 0,
          wipMode: policy.wipMode || 'off',
          entryCriteria: (policy.entryCriteria || []).slice(),
          exitCriteria: (policy.exitCriteria || []).slice(),
          defaultLabelIds: (policy.defaultLabelIds || []).slice(),
          defaultAssignee: policy.defaultAssignee || ''
        };
      });
      var starterCards = [];
      if (options.includeStarterCards !== false) {
        (board.columns || []).forEach(function (column) {
          (column.cards || []).forEach(function (card) {
            starterCards.push({
              title: String(card.title || ''),
              description: String(card.description || ''),
              labelIds: (card.labels || []).slice(),
              checklist: (card.checklist || []).map(function (item) {
                return { text: String(item.text || ''), done: Boolean(item.done) };
              }),
              priority: card.priority || 'none',
              size: card.size || 'none',
              columnTitle: String(column.title || '')
            });
          });
        });
      }
      return {
        version: TEMPLATE_VERSION,
        name: String(options.name || board.name || 'Board template'),
        description: String(options.description || ''),
        starred: false,
        createdAt: typeof options.createdAt === 'number' ? options.createdAt : null,
        boardMeta: {
          labels: Object.keys(labelIds).map(function (id) { return labelIds[id]; })
        },
        columns: columns,
        starterCards: starterCards
      };
    }

    // ---- Validate / normalize ----------------------------------------------

    var ROLES = ['queue', 'active', 'done', 'backlog'];
    var WIP_MODES = ['off', 'soft', 'hard'];
    var PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'];
    var SIZES = ['none', 'xs', 's', 'm', 'l', 'xl'];

    function cleanList(value) {
      return Array.isArray(value) ? value.filter(function (x) { return typeof x === 'string'; }) : [];
    }

    // Migration guard: unknown fields dropped, missing fields defaulted.
    function validateTemplate(tpl) {
      if (!tpl || typeof tpl !== 'object') return null;
      var columns = Array.isArray(tpl.columns) ? tpl.columns.filter(function (c) { return c && typeof c === 'object'; }) : [];
      var labels = (tpl.boardMeta && Array.isArray(tpl.boardMeta.labels)) ? tpl.boardMeta.labels : [];
      var out = {
        version: TEMPLATE_VERSION,
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
            role: ROLES.indexOf(c.role) !== -1 ? c.role : 'queue',
            wipLimit: typeof c.wipLimit === 'number' && c.wipLimit >= 0 ? c.wipLimit : 0,
            wipMode: WIP_MODES.indexOf(c.wipMode) !== -1 ? c.wipMode : 'off',
            entryCriteria: cleanList(c.entryCriteria),
            exitCriteria: cleanList(c.exitCriteria),
            defaultLabelIds: cleanList(c.defaultLabelIds),
            defaultAssignee: typeof c.defaultAssignee === 'string' ? c.defaultAssignee : ''
          };
        }),
        starterCards: Array.isArray(tpl.starterCards) ? tpl.starterCards.filter(function (c) { return c && typeof c === 'object'; }).map(function (c) {
          return {
            title: typeof c.title === 'string' ? c.title : '',
            description: typeof c.description === 'string' ? c.description : '',
            labelIds: cleanList(c.labelIds),
            checklist: Array.isArray(c.checklist) ? c.checklist.filter(function (i) { return i && typeof i === 'object'; }).map(function (i) {
              return { text: String(i.text || ''), done: Boolean(i.done) };
            }) : [],
            priority: PRIORITIES.indexOf(c.priority) !== -1 ? c.priority : 'none',
            size: SIZES.indexOf(c.size) !== -1 ? c.size : 'none',
            columnTitle: typeof c.columnTitle === 'string' ? c.columnTitle : ''
          };
        }) : []
      };
      return out;
    }

    // ---- Materialize: template -> fresh board (pure reducer) ----------------

    // Returns { state, board, columns } with fresh IDs; starter cards are
    // plain drafts (no startedAt/completedAt) so the placement pipeline owns
    // their lifecycle. Does NOT mutate the template. The caller wraps the
    // result in ONE commit (one undo entry).
    function materializeTemplate(state, tpl, opts, deps) {
      var d = deps || {};
      var uid = typeof d.uid === 'function' ? d.uid : function () { return 'tpl-' + Math.random().toString(36).slice(2); };
      var now = typeof d.now === 'function' ? d.now() : 0;
      var name = opts && opts.name ? opts.name : tpl.name;
      var board = Model.createBoard(name, { uid: uid, now: function () { return now; } });
      var labelIdMap = {};

      // Labels: template label ids -> fresh ids.
      (tpl.boardMeta.labels || []).forEach(function (tplLabel) {
        var fresh = Model.createLabel(tplLabel.name, tplLabel.color, { uid: uid, now: function () { return now; } });
        labelIdMap[tplLabel.id] = fresh.id;
        board.labels.push(fresh);
      });

      // Columns in template order.
      (tpl.columns || []).forEach(function (col) {
        var fresh = Model.createColumn({
          title: col.title,
          role: col.role,
          isDone: col.role === 'done',
          wipLimit: col.wipLimit,
          policy: {
            wipMode: col.wipMode,
            overrideRequiresReason: false,
            entryCriteria: (col.entryCriteria || []).slice(),
            exitCriteria: (col.exitCriteria || []).slice(),
            defaultLabelIds: (col.defaultLabelIds || []).map(function (id) { return labelIdMap[id] || id; }).filter(Boolean),
            defaultAssignee: col.defaultAssignee || '',
            countsTowardCycleTime: true
          }
        }, { uid: uid, now: function () { return now; } });
        board.columns.push(fresh);
      });

      // Starter cards: drafts resolved to their template column by title.
      var columnByTitle = {};
      board.columns.forEach(function (c) { columnByTitle[c.title] = c; });
      (tpl.starterCards || []).forEach(function (card) {
        var column = columnByTitle[card.columnTitle] || board.columns[0];
        if (!column) return;
        var draft = Model.createCard(column.id, {
          title: card.title,
          description: card.description,
          labels: (card.labelIds || []).map(function (id) { return labelIdMap[id] || id; }).filter(Boolean),
          checklist: (card.checklist || []).map(function (item) {
            return { id: uid(), text: item.text, done: Boolean(item.done) };
          }),
          priority: card.priority,
          size: card.size
        }, { uid: uid, now: function () { return now; } });
        column.cards.push(draft);
      });

      var next = JSON.parse(JSON.stringify(state));
      next.boards.push(board);
      next.activeBoardId = board.id;
      return { changed: true, state: next, board: board, columns: board.columns };
    }

    return {
      TEMPLATE_VERSION: TEMPLATE_VERSION,
      snapshotBoard: snapshotBoard,
      validateTemplate: validateTemplate,
      materializeTemplate: materializeTemplate
    };
  }
);
