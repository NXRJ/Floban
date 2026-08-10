(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Exporter = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function () {
    // ARRIVAL's exit door: clean one-click exports so users are never locked
    // in. Pure, read-only projections of a board — CSV (spreadsheet/import
    // friendly) and Markdown (Obsidian/paste friendly). JSON export already
    // exists as the backup path. Nothing leaves the machine except what the
    // user explicitly downloads.

    function csvEscape(value) {
      var s = String(value === null || value === undefined ? '' : value);
      if (/[",\n\r]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }

    function labelName(board, id) {
      var label = (board.labels || []).find(function (l) { return l.id === id; });
      return label ? label.name : '';
    }

    function cardLabels(board, card) {
      return (card.labels || []).map(function (id) { return labelName(board, id); }).filter(Boolean);
    }

    // board: { name, labels, columns: [{ title, role, cards: [...] }] }
    // Emits rows grouped by column; Status mirrors the column role so a
    // round-trip import lands completed cards back in Done.
    function exportCsv(board) {
      var lines = ['Title,Do Date,Due Date,Priority,Labels,Assignee,Status,Notes'];
      (board.columns || []).forEach(function (column) {
        (column.cards || []).forEach(function (card) {
          var status = column.role === 'done' || card.completedAt ? 'Completed' : 'In progress';
          var notes = card.description || '';
          if (card.checklist && card.checklist.length > 0) {
            notes = (notes ? notes + '\n' : '') + card.checklist.map(function (item) {
              return (item.done ? '[x] ' : '[ ] ') + item.text;
            }).join('\n');
          }
          lines.push([
            csvEscape(card.title),
            csvEscape(card.when || ''),
            csvEscape(card.due || ''),
            csvEscape(card.priority || 'none'),
            csvEscape(cardLabels(board, card).join(';')),
            csvEscape(card.assignee || ''),
            csvEscape(status),
            csvEscape(notes)
          ].join(','));
        });
      });
      return lines.join('\n') + '\n';
    }

    function exportMarkdown(board) {
      var out = [];
      out.push('# ' + board.name);
      out.push('');
      (board.columns || []).forEach(function (column) {
        out.push('## ' + column.title);
        out.push('');
        var cards = column.cards || [];
        if (cards.length === 0) {
          out.push('_Empty_');
          out.push('');
          return;
        }
        cards.forEach(function (card) {
          var chips = [];
          if (card.when) chips.push('do ' + card.when);
          if (card.due) chips.push('due ' + card.due);
          if (card.priority && card.priority !== 'none') chips.push(card.priority);
          var names = cardLabels(board, card);
          if (names.length > 0) chips.push(names.map(function (n) { return '#' + n; }).join(' '));
          var head = '- ' + card.title + (chips.length > 0 ? ' (' + chips.join(', ') + ')' : '');
          out.push(head);
          if (card.description) {
            out.push(card.description.split('\n').map(function (l) { return '  ' + l; }).join('\n'));
          }
          if (card.checklist && card.checklist.length > 0) {
            card.checklist.forEach(function (item) {
              out.push('  - [' + (item.done ? 'x' : ' ') + '] ' + item.text);
            });
          }
        });
        out.push('');
      });
      return out.join('\n');
    }

    return {
      csvEscape: csvEscape,
      exportCsv: exportCsv,
      exportMarkdown: exportMarkdown
    };
  }
);
