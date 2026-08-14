(function (KB) {
  var h = KB.Dom.h;
  var open = KB.Modal.open;
  var close = KB.Modal.close;

  // ARRIVAL: the "bring your old tasks" wizard. Step 1 picks or pastes a
  // source file (Todoist JSON, Trello JSON, or CSV), step 2 shows the
  // mapping preview with per-column role overrides and an issue banner, and
  // step 3 commits through KB.State.importTasks — one atomic undo entry.

  var state = null; // { text, filename, format, intermediate, mapped }

  function fileToText(file, onDone, onError) {
    var reader = new FileReader();
    reader.onload = function () { onDone(String(reader.result || '')); };
    reader.onerror = function () { onError('Could not read that file.'); };
    reader.readAsText(file);
  }

  function formatLabel(format) {
    switch (format) {
      case 'todoist': return 'TODOIST JSON';
      case 'trello': return 'TRELLO JSON';
      case 'csv': return 'CSV';
      default: return 'UNKNOWN';
    }
  }

  function reset() {
    state = {
      text: '',
      filename: '',
      format: 'unknown',
      intermediate: null,
      mapped: null,
      roleOverrides: {}
    };
  }

  function parseInto(text, filename) {
    var detected = KB.Core.Importer.detectFormat(text, filename);
    var intermediate = KB.Core.Importer.parseSource(text, detected.format);
    var issues = intermediate.issues || [];
    var hardError = issues.some(function (i) { return i.severity === 'error'; });
    var mapped = hardError ? null : KB.Core.Importer.mapStructure(intermediate, {});
    state.text = text;
    state.filename = filename || '';
    state.format = detected.format;
    state.intermediate = intermediate;
    state.mapped = mapped;
    state.roleOverrides = {};
    return { hardError: hardError };
  }

  function issueBanner(issues) {
    var warns = (issues || []).filter(function (i) { return i.severity === 'warn'; });
    var errors = (issues || []).filter(function (i) { return i.severity === 'error'; });
    if (warns.length === 0 && errors.length === 0) return null;
    var banner = h('div', { class: 'arrival-issues' + (errors.length > 0 ? ' error' : '') });
    var title = h('span', { class: 'arrival-issues-title' });
    title.textContent = errors.length > 0
      ? errors.length + ' BLOCKING ISSUE' + (errors.length === 1 ? '' : 'S')
      : warns.length + ' WARNING' + (warns.length === 1 ? '' : 'S') + ' — DATA MAPS WITH NOTES';
    banner.appendChild(title);
    var list = h('ul', { class: 'arrival-issues-list' });
    (errors.length > 0 ? errors : warns).slice(0, 6).forEach(function (issue) {
      var item = h('li');
      item.textContent = issue.message;
      list.appendChild(item);
    });
    if (issues.length > 6) {
      var more = h('li', { class: 'arrival-issues-more' });
      more.textContent = '…and ' + (issues.length - 6) + ' more';
      list.appendChild(more);
    }
    banner.appendChild(list);
    return banner;
  }

  // ---- Step 1: choose a file or paste ----

  function renderStep1() {
    var panel = h('div', { class: 'card-form arrival' });
    var heading = h('h2');
    heading.textContent = 'ARRIVAL \u00B7 BRING YOUR OLD TASKS';
    panel.appendChild(heading);

    var hint = h('p', { class: 'form-hint' });
    hint.textContent = 'Import a Todoist JSON, Trello JSON, or CSV export. Your tasks are mapped onto boards, columns, labels and due dates \u2014 nothing leaves this machine, and one undo reverts the whole import.';
    panel.appendChild(hint);

    var drop = h('label', { class: 'arrival-drop' });
    drop.textContent = 'DROP A FILE HERE OR CLICK TO BROWSE';
    var fileInput = h('input', {
      type: 'file',
      accept: '.json,.csv,application/json,text/csv,text/plain',
      class: 'arrival-file',
      'aria-label': 'Choose a Todoist, Trello or CSV export'
    });
    drop.appendChild(fileInput);
    drop.addEventListener('click', function (e) {
      if (e.target !== fileInput) fileInput.click();
    });
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file) return;
      fileToText(file, function (text) {
        var result = parseInto(text, file.name);
        if (result.hardError) {
          KB.UI.toast('That file could not be parsed', 'error');
          renderStep1();
          return;
        }
        renderStep2();
      }, function (message) {
        KB.UI.toast(message, 'error');
      });
    });
    panel.appendChild(drop);

    var or = h('p', { class: 'arrival-or' });
    or.textContent = '\u2014 OR PASTE \u2014';
    panel.appendChild(or);

    var ta = h('textarea', {
      class: 'arrival-paste',
      rows: 5,
      placeholder: 'Paste the JSON/CSV export here\u2026',
      'aria-label': 'Paste a Todoist, Trello or CSV export'
    });
    panel.appendChild(ta);

    var actions = h('div', { class: 'modal-actions' });
    actions.appendChild(h('span', { class: 'spacer' }));
    var cancelBtn = h('button', { type: 'button', class: 'btn ghost' });
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', close);
    var parseBtn = h('button', { type: 'button', class: 'btn primary' });
    parseBtn.textContent = 'ANALYZE';
    parseBtn.addEventListener('click', function () {
      var text = ta.value;
      if (!text.trim()) {
        KB.UI.toast('Paste a file’s contents first', 'error');
        ta.focus();
        return;
      }
      var result = parseInto(text, 'pasted.txt');
      if (result.hardError) {
        KB.UI.toast('That text could not be parsed', 'error');
        return;
      }
      renderStep2();
    });
    actions.appendChild(parseBtn);
    panel.appendChild(actions);

    open(panel);
  }

  // ---- Step 2: mapping preview ----

  function roleSelect(current, onPick) {
    var select = h('select', { class: 'arrival-role', 'aria-label': 'Column role' });
    [['queue', 'Backlog/Queue'], ['active', 'Active'], ['done', 'Done']].forEach(function (pair) {
      var opt = h('option', { value: pair[0] });
      opt.textContent = pair[1];
      select.appendChild(opt);
    });
    select.value = current;
    select.addEventListener('change', function () { onPick(select.value); });
    return select;
  }

  function renderStep2() {
    var mapped = state.mapped;
    var panel = h('div', { class: 'card-form arrival' });
    var heading = h('h2');
    heading.textContent = 'ARRIVAL \u00B7 MAPPING PREVIEW';
    panel.appendChild(heading);

    var summary = h('p', { class: 'form-hint' });
    var boardCount = mapped.boards.length;
    var cardCount = mapped.boards.reduce(function (n, b) { return n + b.cards.length; }, 0);
    summary.textContent = 'Detected ' + formatLabel(state.format) + ' \u2014 ' + cardCount + ' card' + (cardCount === 1 ? '' : 's') +
      ' across ' + boardCount + ' board' + (boardCount === 1 ? '' : 's') + '. Adjust column roles if needed, then import.';
    panel.appendChild(summary);

    var issues = state.intermediate.issues || [];
    var banner = issueBanner(issues);
    if (banner) panel.appendChild(banner);

    mapped.boards.forEach(function (board) {
      var wrap = h('div', { class: 'arrival-board' });
      var boardTitle = h('div', { class: 'arrival-board-title' });
      boardTitle.textContent = board.name + ' \u00B7 ' + board.cards.length + ' CARDS';
      wrap.appendChild(boardTitle);
      var cols = h('div', { class: 'arrival-cols' });
      board.columns.forEach(function (col, colIndex) {
        var row = h('div', { class: 'arrival-col' });
        var name = h('span', { class: 'arrival-col-name' });
        name.textContent = col.name;
        row.appendChild(name);
        var count = h('span', { class: 'arrival-col-count' });
        count.textContent = board.cards.filter(function (c) { return c.columnIndex === colIndex; }).length;
        row.appendChild(count);
        row.appendChild(h('span', { class: 'spacer' }));
        var sel = roleSelect(col.role, function (role) {
          board.columns[colIndex].role = role;
          state.roleOverrides[col.name] = role;
        });
        row.appendChild(sel);
        cols.appendChild(row);
      });
      wrap.appendChild(cols);
      // A few sample cards so the user sees what arrives.
      var samples = board.cards.slice(0, 3);
      if (samples.length > 0) {
        var sampleList = h('ul', { class: 'arrival-samples' });
        samples.forEach(function (card) {
          var li = h('li');
          var t = h('span', { class: 'arrival-sample-title' });
          t.textContent = card.title;
          li.appendChild(t);
          if (card.labels.length > 0) {
            var lc = h('span', { class: 'chip chip-static arrival-sample-label' });
            lc.textContent = '#' + card.labels[0];
            li.appendChild(lc);
          }
          if (card.due) {
            var dc = h('span', { class: 'chip chip-static arrival-sample-due' });
            dc.textContent = KB.Dom.fmtShortDate(card.due);
            li.appendChild(dc);
          }
          sampleList.appendChild(li);
        });
        if (board.cards.length > 3) {
          var more = h('li', { class: 'arrival-samples-more' });
          more.textContent = '\u2026and ' + (board.cards.length - 3) + ' more';
          sampleList.appendChild(more);
        }
        wrap.appendChild(sampleList);
      }
      panel.appendChild(wrap);
    });

    var actions = h('div', { class: 'modal-actions' });
    var backBtn = h('button', { type: 'button', class: 'btn ghost' });
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', renderStep1);
    actions.appendChild(backBtn);
    actions.appendChild(h('span', { class: 'spacer' }));
    var importBtn = h('button', { type: 'button', class: 'btn primary' });
    importBtn.textContent = 'IMPORT ' + cardCount + ' CARD' + (cardCount === 1 ? '' : 'S');
    importBtn.addEventListener('click', function () {
      var result = KB.State.importTasks(mapped);
      if (!result) {
        KB.UI.toast('Nothing was imported', 'error');
        return;
      }
      var boards = Array.isArray(result) ? result : [];
      var names = boards.map(function (b) { return b.name; }).filter(Boolean).join(', ');
      KB.UI.toast('Imported ' + cardCount + ' cards into ' + (names || 'the board'), 'success', 'Undo', KB.UI.undoAction);
      close();
      KB.App.refresh();
      KB.Workspaces.set('board');
    });
    actions.appendChild(importBtn);
    panel.appendChild(actions);

    open(panel);
  }

  function openWizard() {
    reset();
    renderStep1();
  }

  // ---- Export: CSV / Markdown (JSON lives in Backup/restore) ----

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportModal(opener) {
    var board = KB.State.activeBoard();
    var panel = h('div', { class: 'card-form arrival' });
    var heading = h('h2');
    heading.textContent = 'EXPORT \u00B7 ' + board.name.toUpperCase();
    panel.appendChild(heading);

    var hint = h('p', { class: 'form-hint' });
    hint.textContent = 'Take your board anywhere: CSV for spreadsheets and other task apps, Markdown for notes/Obsidian. JSON backup lives in Backup / restore.';
    panel.appendChild(hint);

    var today = KB.Filters.todayISO();
    var safe = board.name.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'board';

    function addExport(label, desc, mime, filename, content) {
      var row = h('div', { class: 'arrival-export-row' });
      var info = h('div', { class: 'arrival-export-info' });
      var name = h('span', { class: 'arrival-export-name' });
      name.textContent = label;
      info.appendChild(name);
      var sub = h('span', { class: 'arrival-export-desc' });
      sub.textContent = desc;
      info.appendChild(sub);
      row.appendChild(info);
      row.appendChild(h('span', { class: 'spacer' }));
      var btn = h('button', { type: 'button', class: 'btn primary sm' });
      btn.textContent = 'DOWNLOAD';
      btn.addEventListener('click', function () {
        download(filename, content, mime);
        KB.UI.toast('Exported ' + filename, 'success');
      });
      row.appendChild(btn);
      panel.appendChild(row);
    }

    addExport('CSV', 'Spreadsheet / re-import friendly', 'text/csv;charset=utf-8',
      'floban-' + safe + '-' + today + '.csv', KB.Core.Exporter.exportCsv(board));
    addExport('Markdown', 'Notes, Obsidian, paste anywhere', 'text/markdown;charset=utf-8',
      'floban-' + safe + '-' + today + '.md', KB.Core.Exporter.exportMarkdown(board));

    var actions = h('div', { class: 'modal-actions' });
    actions.appendChild(h('span', { class: 'spacer' }));
    var doneBtn = h('button', { type: 'button', class: 'btn ghost' });
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', close);
    actions.appendChild(doneBtn);
    panel.appendChild(actions);

    open(panel, opener);
  }

  KB.Modal.arrivalWizard = openWizard;
  KB.Modal.exportModal = exportModal;
})(window.KB = window.KB || {});
