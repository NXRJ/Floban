(function (root, factory) {
  var modelCore = (typeof module === 'object' && module.exports)
    ? require('./model.js')
    : root.KB.Core.Model;
  var pipelineCore = (typeof module === 'object' && module.exports)
    ? require('./pipeline.js')
    : root.KB.Core.Pipeline;
  var api = factory(modelCore, pipelineCore);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Importer = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function (Model, Pipeline) {
    // ARRIVAL: a one-shot migration kit. Imports native exports from other
    // task apps (Todoist JSON, Trello JSON, or any CSV) onto this app's
    // model. The pipeline is: detectFormat -> parseSource (canonical
    // intermediate) -> mapStructure (roles, priorities, labels, recurrence)
    // -> applyImport (pure reducer through the placement pipeline).
    //
    // Lossy-path contract: nothing is ever silently dropped. Every field or
    // rule that cannot be mapped produces an entry in issues[] with a
    // severity, and the card still imports.

    var PALETTE = ['#c81e14', '#a34800', '#ffd60a', '#a9e020', '#13643c', '#3fd7e0', '#2a58c4', '#6d30d6', '#b11f75', '#8b5cf6'];

    function cloneState(state) {
      return JSON.parse(JSON.stringify(state));
    }

    // ---- Format detection --------------------------------------------------

    function detectFormat(text, filename) {
      var lower = String(filename || '').toLowerCase();
      var trimmed = String(text || '').replace(/^\uFEFF/, '').trim();
      if (!trimmed) return { format: 'unknown', confidence: 0 };
      if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
        var parsed = null;
        try { parsed = JSON.parse(trimmed); } catch (err) { return { format: 'unknown', confidence: 0 }; }
        if (parsed && typeof parsed === 'object') {
          if (Array.isArray(parsed.projects) && Array.isArray(parsed.items)) {
            return { format: 'todoist', confidence: 1 };
          }
          if (Array.isArray(parsed.lists) && Array.isArray(parsed.cards)) {
            return { format: 'trello', confidence: 1 };
          }
          if (Array.isArray(parsed)) {
            return { format: 'todoist', confidence: 0.5 };
          }
        }
        return { format: 'unknown', confidence: 0 };
      }
      if (lower.indexOf('.csv') !== -1 || /^[^,\n]*,[^,\n]*/.test(trimmed)) {
        return { format: 'csv', confidence: 0.9 };
      }
      return { format: 'unknown', confidence: 0 };
    }

    // ---- CSV parsing (RFC 4180 subset: quotes, escaped quotes, newlines) ---

    function parseCsv(text) {
      var rows = [];
      var row = [];
      var field = '';
      var inQuotes = false;
      var chars = String(text || '');
      for (var i = 0; i < chars.length; i++) {
        var c = chars.charAt(i);
        if (inQuotes) {
          if (c === '"') {
            if (chars.charAt(i + 1) === '"') { field += '"'; i++; }
            else inQuotes = false;
          } else {
            field += c;
          }
        } else if (c === '"') {
          inQuotes = true;
        } else if (c === ',') {
          row.push(field);
          field = '';
        } else if (c === '\n') {
          row.push(field);
          rows.push(row);
          row = [];
          field = '';
        } else if (c !== '\r') {
          field += c;
        }
      }
      if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
      }
      return rows.filter(function (r) { return r.some(function (f) { return f.trim() !== ''; }); });
    }

    // ---- Parsers: emit the canonical intermediate --------------------------
    // Intermediate shape:
    //   { boards: [{ name, columns: [{ name, roleHint }],
    //                cards: [{ title, description, due, priority, labels: [],
    //                          checklist: [{text, done}], assignee, columnName,
    //                          parentId, sourceId, recurrence }] }],
    //     issues: [{ cardIndex, message, severity }] }

    var TODOIST_PRIORITY = { 1: 'urgent', 2: 'high', 3: 'medium', 4: 'low' };

    function parseTodoist(text) {
      var data = JSON.parse(text);
      var projects = Array.isArray(data.projects) ? data.projects : [];
      var sections = Array.isArray(data.sections) ? data.sections : [];
      var items = Array.isArray(data.items) ? data.items : [];
      var labelMap = {};
      (Array.isArray(data.labels) ? data.labels : []).forEach(function (l) {
        if (l && l.id !== undefined && l.name !== undefined) labelMap[l.id] = String(l.name);
      });

      var issues = [];
      var boards = [];
      projects.forEach(function (project) {
        var boardSections = sections.filter(function (s) { return s.project_id === project.id; });
        var columns = boardSections.length > 0
          ? boardSections.map(function (s) { return { name: String(s.name || 'Section'), roleHint: inferRole(String(s.name || '')) }; })
          : [{ name: 'To Do', roleHint: 'queue' }, { name: 'In Progress', roleHint: 'active' }, { name: 'Done', roleHint: 'done' }];
        var projectItems = items.filter(function (it) { return it.project_id === project.id; });
        var cards = projectItems.map(function (it, index) {
          var columnName = '';
          if (boardSections.length > 0) {
            var section = boardSections.find(function (s) { return s.id === it.section_id; });
            columnName = section ? String(section.name || 'Section') : String(boardSections[0].name || 'Section');
          } else if (it.checked) {
            columnName = 'Done';
          } else if (/in progress|doing|active/i.test(String(it.content || '')) || it.in_history) {
            columnName = 'In Progress';
          } else {
            columnName = 'To Do';
          }
          var card = {
            title: String(it.content || '').trim(),
            description: typeof it.description === 'string' ? it.description : '',
            due: dueIso(it.due),
            priority: TODOIST_PRIORITY[it.priority] || 'none',
            labels: (Array.isArray(it.labels) ? it.labels : []).map(function (id) { return labelMap[id]; }).filter(Boolean),
            checklist: [],
            assignee: '',
            columnName: columnName,
            parentId: typeof it.parent_id === 'number' ? it.parent_id : null,
            sourceId: String(it.id),
            recurrence: null
          };
          if (it.due && it.due.is_recurring && it.due.string) {
            var parsed = parseRecurrenceString(String(it.due.string));
            if (parsed) card.recurrence = parsed;
            else {
              issues.push({ cardIndex: index, message: 'Recurrence "' + it.due.string + '" could not be mapped; card imported as one-off.', severity: 'warn' });
            }
          }
          return card;
        });
        boards.push({
          name: String(project.name || 'Imported project'),
          columns: columns,
          cards: cards
        });
      });
      // Todoist subtasks become checklist items on their parent card. The
      // child's own due/priority/labels are dropped — reported, never silent.
      boards.forEach(function (board) {
        var bySource = {};
        board.cards.forEach(function (card, index) {
          if (card.parentId === null) return;
          var parent = board.cards.find(function (c) { return c.sourceId === String(card.parentId); });
          if (!parent) return;
          parent.checklist.push({ text: card.title, done: false });
          if (card.due || card.priority !== 'none' || card.labels.length > 0) {
            issues.push({ cardIndex: index, message: 'Subtask "' + card.title + '" folded into its parent; its due/priority/labels were not carried over.', severity: 'warn' });
          }
          bySource[card.sourceId] = true;
        });
        board.cards = board.cards.filter(function (card) { return !bySource[card.sourceId]; });
      });
      return { boards: boards, issues: issues };
    }

    function parseTrello(text) {
      var data = JSON.parse(text);
      var lists = Array.isArray(data.lists) ? data.lists : [];
      var cards = Array.isArray(data.cards) ? data.cards : [];
      var checklistMap = {};
      (Array.isArray(data.checklists) ? data.checklists : []).forEach(function (cl) {
        checklistMap[cl.id] = Array.isArray(cl.checkItems) ? cl.checkItems : [];
      });
      var issues = [];
      var columns = lists.map(function (l) {
        return { name: String(l.name || 'List'), roleHint: inferRole(String(l.name || '')) };
      });
      // A Trello export can have no Done-shaped list at all. Add the target
      // column BEFORE routing cards, so a closed card actually lands in it
      // rather than in whichever list happened to be last.
      var doneColumn = columns.find(function (c) { return c.roleHint === 'done'; });
      if (!doneColumn) {
        doneColumn = { name: 'Done', roleHint: 'done' };
        columns.push(doneColumn);
      }
      var cardsOut = cards.map(function (c) {
        var list = lists.find(function (l) { return l.id === c.idList; });
        var checklist = [];
        (Array.isArray(c.checklists) ? c.checklists : []).forEach(function (cl) {
          (checklistMap[cl.id] || []).forEach(function (item) {
            checklist.push({ text: String(item.name || ''), done: item.state === 'complete' });
          });
        });
        var card = {
          title: String(c.name || '').trim(),
          description: typeof c.desc === 'string' ? c.desc : '',
          due: dueIso(c.due),
          priority: 'none',
          labels: (Array.isArray(c.labels) ? c.labels : []).map(function (l) { return l.name; }).filter(Boolean),
          checklist: checklist,
          assignee: '',
          columnName: list ? String(list.name || 'List') : (c.closed ? 'Done' : 'To Do'),
          parentId: null,
          sourceId: String(c.id),
          recurrence: null
        };
        // A closed card belongs in Done regardless of which list it sat in.
        if (c.closed) {
          card.columnName = doneColumn.name;
        }
        return card;
      });
      return {
        boards: [{
          name: String(data.name || 'Trello import'),
          columns: columns,
          cards: cardsOut
        }],
        issues: issues
      };
    }

    function parseCsvSource(text) {
      var rows = parseCsv(text);
      if (rows.length < 2) return { boards: [], issues: [{ cardIndex: -1, message: 'CSV needs a header row plus at least one task.', severity: 'error' }] };
      var header = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
      var pick = function (names) {
        for (var i = 0; i < names.length; i++) {
          var idx = header.indexOf(names[i]);
          if (idx !== -1) return idx;
        }
        return -1;
      };
      var titleIdx = pick(['title', 'task', 'name', 'subject', 'content', 'todo']);
      if (titleIdx === -1) {
        return { boards: [], issues: [{ cardIndex: -1, message: 'CSV is missing a Title/Task column.', severity: 'error' }] };
      }
      var dueIdx = pick(['due date', 'due', 'date', 'deadline']);
      var whenIdx = pick(['do date', 'start date', 'when', 'planned']);
      var priorityIdx = pick(['priority', 'importance']);
      var labelsIdx = pick(['labels', 'tags', 'label', 'tag']);
      var notesIdx = pick(['notes', 'description', 'note', 'details']);
      var statusIdx = pick(['status', 'completed', 'done', 'state', 'complete']);
      var assigneeIdx = pick(['assignee', 'owner', 'person']);
      var issues = [];
      var cards = [];
      rows.slice(1).forEach(function (row, index) {
        var title = row[titleIdx] !== undefined ? String(row[titleIdx]).trim() : '';
        if (!title) return;
        var card = {
          title: title,
          description: notesIdx !== -1 && row[notesIdx] !== undefined ? String(row[notesIdx]) : '',
          due: dueIdx !== -1 && row[dueIdx] !== undefined ? dueIso(String(row[dueIdx])) : '',
          when: whenIdx !== -1 && row[whenIdx] !== undefined ? dueIso(String(row[whenIdx])) : '',
          priority: priorityIdx !== -1 && row[priorityIdx] !== undefined ? mapPriorityWord(String(row[priorityIdx])) : 'none',
          labels: labelsIdx !== -1 && row[labelsIdx] !== undefined ? String(row[labelsIdx]).split(/[;|]/).map(function (s) { return s.trim(); }).filter(Boolean) : [],
          checklist: [],
          assignee: assigneeIdx !== -1 && row[assigneeIdx] !== undefined ? String(row[assigneeIdx]).trim() : '',
          columnName: 'To Do',
          parentId: null,
          sourceId: String(index),
          recurrence: null
        };
        var status = statusIdx !== -1 && row[statusIdx] !== undefined ? String(row[statusIdx]).toLowerCase() : '';
        if (/done|completed|complete|closed|finished/.test(status)) {
          card.columnName = 'Done';
        } else if (/progress|doing|active|wip/.test(status)) {
          card.columnName = 'In Progress';
        }
        cards.push(card);
      });
      var columns = [{ name: 'To Do', roleHint: 'queue' }, { name: 'In Progress', roleHint: 'active' }, { name: 'Done', roleHint: 'done' }];
      var hasDone = cards.some(function (c) { return c.columnName === 'Done'; });
      var hasActive = cards.some(function (c) { return c.columnName === 'In Progress'; });
      if (!hasDone) columns = columns.filter(function (c) { return c.roleHint !== 'done'; });
      if (!hasActive) columns = columns.filter(function (c) { return c.roleHint !== 'active'; });
      return {
        boards: [{ name: 'CSV import', columns: columns, cards: cards }],
        issues: issues
      };
    }

    // ---- Shared mapping helpers --------------------------------------------

    function inferRole(name) {
      if (/backlog|todo|to do|queue|someday|inbox/i.test(name)) return 'queue';
      if (/doing|progress|active|wip|working/i.test(name)) return 'active';
      if (/done|complete|delivered|closed|finished|archive/i.test(name)) return 'done';
      return 'queue';
    }

    function dueIso(value) {
      if (!value) return '';
      // Todoist emits due as { date: '2026-08-15', is_recurring, string }.
      var raw = value && typeof value === 'object' ? value.date : value;
      if (!raw) return '';
      var s = String(raw).trim();
      var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return m[1] + '-' + m[2] + '-' + m[3];
      var d = new Date(s);
      if (!isNaN(d.getTime())) {
        var y = d.getFullYear();
        var mo = String(d.getMonth() + 1).padStart(2, '0');
        var da = String(d.getDate()).padStart(2, '0');
        return y + '-' + mo + '-' + da;
      }
      return '';
    }

    function mapPriorityWord(word) {
      var w = String(word).toLowerCase();
      if (/urgent|p1|high.*priority|1/.test(w)) return 'urgent';
      if (/high|important|p2/.test(w)) return 'high';
      if (/medium|med|normal|p3|3/.test(w)) return 'medium';
      if (/low|p4|4/.test(w)) return 'low';
      if (/none|no priority|0/.test(w)) return 'none';
      return 'none';
    }

    var WEEKDAY_NAMES = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

    // Map Todoist-style recurrence strings ("every day", "every 2 weeks",
    // "every monday and thursday") onto this app's schedule model. Returns
    // null when the string is not understood (the caller reports an issue).
    function parseRecurrenceString(s) {
      var text = String(s || '').trim().toLowerCase();
      if (/every\s+day|daily|everyday/.test(text)) {
        return { frequency: 'daily', interval: 1, weekdays: [], dayOfMonth: null };
      }
      var intervalMatch = text.match(/every\s+(\d+)\s+days?/);
      if (intervalMatch) {
        return { frequency: 'daily', interval: Math.max(1, parseInt(intervalMatch[1], 10)), weekdays: [], dayOfMonth: null };
      }
      if (/every\s+week|weekly|every\s+1\s+week/.test(text)) {
        return { frequency: 'weekly', interval: 1, weekdays: [], dayOfMonth: null };
      }
      var weekInterval = text.match(/every\s+(\d+)\s+weeks?/);
      if (weekInterval) {
        return { frequency: 'weekly', interval: Math.max(1, parseInt(weekInterval[1], 10)), weekdays: [], dayOfMonth: null };
      }
      var weekdays = [];
      var plainMatch = text.match(/every\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:\s+and\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday))?/);
      if (plainMatch) {
        [1, 2].forEach(function (g) {
          if (plainMatch[g] && WEEKDAY_NAMES[plainMatch[g]] !== undefined) weekdays.push(WEEKDAY_NAMES[plainMatch[g]]);
        });
        if (weekdays.length > 0) {
          return { frequency: 'weekly', interval: 1, weekdays: weekdays.slice().sort(), dayOfMonth: null };
        }
      }
      if (/every\s+month|monthly/.test(text)) {
        return { frequency: 'monthly', interval: 1, weekdays: [], dayOfMonth: null };
      }
      var monthInterval = text.match(/every\s+(\d+)\s+months?/);
      if (monthInterval) {
        return { frequency: 'monthly', interval: Math.max(1, parseInt(monthInterval[1], 10)), weekdays: [], dayOfMonth: null };
      }
      if (/every\s+year|yearly|annually/.test(text)) {
        return { frequency: 'yearly', interval: 1, weekdays: [], dayOfMonth: null };
      }
      return null;
    }

    // ---- Mapping: canonical intermediate -> applied structure ---------------

    // Pure: intermediate -> { boards: [{ name, columns: [{name, role}],
    //   cards: [{ title, description, due, priority, labels, checklist,
    //   assignee, columnIndex, recurrence }] }], issues }.
    // Column-role inference can be overridden per name via opts.columnRoles.
    function mapStructure(intermediate, opts) {
      var options = opts || {};
      var overrides = options.columnRoles || {};
      var issues = (intermediate.issues || []).slice();
      var boards = (intermediate.boards || []).map(function (board) {
        var columns = (board.columns || []).map(function (col) {
          var role = overrides[String(col.name)] || col.roleHint || inferRole(col.name);
          return { name: String(col.name || 'Column'), role: role };
        });
        var byName = {};
        columns.forEach(function (col) { byName[col.name] = col; });
        var cards = (board.cards || []).map(function (card) {
          var column = byName[card.columnName] || columns[0] || { name: 'To Do', role: 'queue' };
          return {
            title: String(card.title || 'Untitled'),
            description: String(card.description || ''),
            due: String(card.due || ''),
            when: String(card.when || ''),
            priority: card.priority || 'none',
            labels: (card.labels || []).slice(),
            checklist: (card.checklist || []).slice(),
            assignee: String(card.assignee || ''),
            columnIndex: Math.max(0, columns.indexOf(column)),
            recurrence: card.recurrence || null
          };
        });
        return { name: String(board.name || 'Imported board'), columns: columns, cards: cards };
      });
      return { boards: boards, issues: issues };
    }

    // ---- Apply: pure reducer creating the boards through the pipeline -------

    // state -> { state, boards: [{ boardId, name, createdCount }], issues }
    // Deterministic under injected { uid, now }. Every card goes through
    // Pipeline.placeCard (policy check -> lifecycle transition -> entry
    // defaults) with confirmed=true: the user already approved the import in
    // the preview, and a migration must not silently drop cards on a WIP
    // limit. All boards + cards are created inside ONE state transition, so
    // the caller wraps this in a single history entry (one Ctrl+Z reverts
    // the whole import).
    function applyImport(state, mapped, deps) {
      var d = deps || {};
      var uid = typeof d.uid === 'function' ? d.uid : function () { return 'imp-' + Math.random().toString(36).slice(2); };
      var now = typeof d.now === 'function' ? d.now() : 0;
      var next = cloneState(state);
      var issues = (mapped.issues || []).slice();
      // Kept apart deliberately: `createdBoards` is the caller's summary
      // ("imported into X, Y"), `cardCount` is the placement tally. Mixing
      // them into one list made both wrong.
      var createdBoards = [];
      var cardCount = 0;

      (mapped.boards || []).forEach(function (board) {
        var hadActiveBoard = Boolean(next.activeBoardId);
        var newBoard = Model.createBoard(board.name, { uid: uid, now: function () { return now; } });
        var labelIds = {};
        var colorIndex = 0;
        var seenLabels = {};
        var allLabels = [];
        board.cards.forEach(function (card) {
          (card.labels || []).forEach(function (name) {
            if (seenLabels[name]) return;
            seenLabels[name] = true;
            var label = Model.createLabel(name, PALETTE[colorIndex % PALETTE.length], { uid: uid, now: function () { return now; } });
            allLabels.push(label);
            labelIds[name] = label.id;
            colorIndex++;
          });
        });
        newBoard.labels = allLabels;

        var columns = board.columns.map(function (col) {
          return Model.createColumn({ title: col.name, role: col.role, isDone: col.role === 'done' }, { uid: uid, now: function () { return now; } });
        });
        newBoard.columns = columns;
        // The board must be reachable in state BEFORE cards are placed: the
        // pipeline's policy evaluation resolves the target board by id.
        next.boards.push(newBoard);
        if (!next.activeBoardId) next.activeBoardId = newBoard.id;

        board.cards.forEach(function (card) {
          var column = columns[card.columnIndex] || columns[0];
          var overrides = {
            title: card.title,
            description: card.description,
            due: card.due,
            when: card.when || '',
            priority: card.priority,
            assignee: card.assignee,
            checklist: card.checklist.map(function (item) {
              return { id: uid(), text: item.text, done: Boolean(item.done) };
            }),
            labels: card.labels.map(function (name) { return labelIds[name]; }).filter(Boolean)
          };
          var placed = Pipeline.placeCard(next, Model.createCard(column.id, overrides, { uid: uid, now: function () { return now; } }), null, newBoard, column, {
            confirmed: true,
            overrideReason: 'import',
            applyDefaults: false
          }, { uid: uid, now: function () { return now; } });
          if (!placed.changed) {
            issues.push({ cardIndex: cardCount, message: 'Card "' + card.title + '" was not placed (' + (placed.reason || 'unknown') + ').', severity: 'error' });
            return;
          }
          cardCount++;
          if (card.recurrence) {
            var rec = Model.createRecurrence({
              enabled: true,
              mode: 'scheduled',
              schedule: {
                frequency: card.recurrence.frequency,
                interval: card.recurrence.interval,
                weekdays: card.recurrence.weekdays,
                dayOfMonth: card.recurrence.dayOfMonth
              },
              target: { boardId: newBoard.id, columnId: column.id },
              template: {
                title: card.title,
                description: card.description,
                labelIds: card.labels.map(function (name) { return labelIds[name]; }).filter(Boolean),
                assignee: card.assignee,
                priority: card.priority,
                size: 'none',
                checklist: card.checklist.map(function (item) {
                  return { id: uid(), text: item.text, done: false };
                })
              },
              nextRunAt: null
            }, { uid: uid, now: function () { return now; } });
            next.recurrences = next.recurrences || [];
            next.recurrences.push(rec);
          }
        });

        // An empty board (no cards placed) is not an import — don't leave
        // skeleton boards behind or count them as created.
        if (newBoard.columns.every(function (c) { return c.cards.length === 0; })) {
          next.boards = next.boards.filter(function (b) { return b.id !== newBoard.id; });
          // Never leave activeBoardId pointing at a board we just discarded.
          if (!hadActiveBoard && next.activeBoardId === newBoard.id) {
            next.activeBoardId = next.boards.length > 0 ? next.boards[0].id : '';
          }
        } else {
          createdBoards.push({ boardId: newBoard.id, name: newBoard.name });
        }
      });

      if (createdBoards.length === 0) {
        return { changed: false, state: state, value: null, reason: 'nothing-created', issues: issues };
      }
      return { changed: true, state: next, value: createdBoards, cardCount: cardCount, issues: issues };
    }

    return {
      detectFormat: detectFormat,
      parseSource: function (text, format) {
        switch (format) {
          case 'todoist': return parseTodoist(text);
          case 'trello': return parseTrello(text);
          case 'csv': return parseCsvSource(text);
          default: return { boards: [], issues: [{ cardIndex: -1, message: 'Unknown or unsupported file format.', severity: 'error' }] };
        }
      },
      mapStructure: mapStructure,
      applyImport: applyImport,
      parseRecurrenceString: parseRecurrenceString,
      inferRole: inferRole,
      dueIso: dueIso,
      parseCsv: parseCsv,
      PALETTE: PALETTE
    };
  }
);
