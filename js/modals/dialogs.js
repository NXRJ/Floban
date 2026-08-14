(function (KB) {
  var h = KB.Dom.h;
  var open = KB.Modal.open;
  var close = KB.Modal.close;
  var fieldBlock = KB.Modal.fieldBlock;

  function labelManager(opener) {
    var panel = h('div', { class: 'card-form' });

    var heading = h('h2');
    heading.textContent = 'Manage labels';
    panel.appendChild(heading);

    var hint = h('p', { class: 'form-hint' });
    hint.textContent = 'Labels are shared across all cards. A label in use can only be removed from cards first.';
    panel.appendChild(hint);

    var list = h('div', { class: 'label-manager-list' });
    panel.appendChild(list);

    function renderList() {
      list.innerHTML = '';
      KB.State.labels().forEach(function (label) {
        var row = h('div', { class: 'label-row' });

        var chip = h('span', { class: 'chip chip-static' });
        var dot = h('span', { class: 'dot' });
        dot.style.background = label.color;
        chip.appendChild(dot);
        chip.appendChild(document.createTextNode(label.name));
        KB.Dom.paintChip(chip, label.color);
        row.appendChild(chip);

        row.appendChild(h('span', { class: 'spacer' }));

        var inUse = KB.State.labelInUse(label.id);
        var removeBtn = h('button', { type: 'button', class: 'btn ghost sm' });
        removeBtn.textContent = 'Remove';
        removeBtn.disabled = inUse;
        removeBtn.title = inUse ? 'In use — remove it from cards first' : 'Delete this label';
        removeBtn.addEventListener('click', function () {
          KB.State.removeLabel(label.id);
          KB.UI.toast('Label removed', 'success');
          renderList();
        });
        row.appendChild(removeBtn);

        list.appendChild(row);
      });
    }

    var newName = h('input', { type: 'text', placeholder: 'New label name', maxlength: 24, 'aria-label': 'New label name' });
    var newColor = h('input', { type: 'color', value: '#6d30d6', 'aria-label': 'Label colour' });
    var newAdd = h('button', { type: 'button', class: 'btn ghost sm' });
    newAdd.textContent = 'Add';
    var createRow = h('div', { class: 'label-create-row' });
    createRow.appendChild(newName);
    createRow.appendChild(newColor);
    createRow.appendChild(newAdd);
    panel.appendChild(fieldBlock('Create label', createRow));

    newAdd.addEventListener('click', function () {
      var name = newName.value.trim();
      if (!name) {
        KB.UI.toast('Enter a label name first', 'error');
        newName.focus();
        return;
      }
      var exists = KB.State.labels().some(function (l) {
        return l.name.toLowerCase() === name.toLowerCase();
      });
      if (exists) {
        KB.UI.toast('A label with that name already exists', 'error');
        return;
      }
      KB.State.addLabel(name, newColor.value);
      newName.value = '';
      KB.UI.toast('Label added', 'success');
      renderList();
    });

    var actions = h('div', { class: 'modal-actions' });
    actions.appendChild(h('span', { class: 'spacer' }));
    var doneBtn = h('button', { type: 'button', class: 'btn primary' });
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', close);
    actions.appendChild(doneBtn);
    panel.appendChild(actions);

    renderList();
    open(panel, opener);
  }

  function backupModal() {
    var panel = h('div', { class: 'card-form' });

    var heading = h('h2');
    heading.textContent = 'Backup / restore';
    panel.appendChild(heading);

    var hint = h('p', { class: 'form-hint' });
    hint.textContent = 'Your board lives only in this browser. Export a backup file to keep it safe, and import it again to restore — on this machine or another.';
    panel.appendChild(hint);

    var fileInput = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', 'aria-label': 'Backup file' });
    panel.appendChild(fileInput);

    // Local snapshots: automatic rotating backups plus manual snapshots.
    var snapSection = h('div', { class: 'snapshot-section' });
    var snapTitle = h('h3', { class: 'snapshot-title' });
    snapTitle.textContent = 'Local snapshots';
    snapSection.appendChild(snapTitle);

    var snapHint = h('p', { class: 'form-hint' });
    snapHint.textContent = 'The app keeps the last 10 automatic snapshots in this browser. Restore one to roll the whole app back to that moment (undoable).';
    snapSection.appendChild(snapHint);

    // Every write action in this dialog must refuse politely in a read-only
    // tab (its saves are dropped by the funnel).
    function warnIfReadOnly() {
      if (KB.MultiTab && KB.MultiTab.readOnly()) {
        KB.UI.toast('Read-only — Floban is open in another tab', 'error');
        return true;
      }
      return false;
    }

    var snapActions = h('div', { class: 'snapshot-actions' });
    var snapNowBtn = h('button', { type: 'button', class: 'btn sm' });
    snapNowBtn.textContent = 'Snapshot now';
    snapNowBtn.addEventListener('click', function () {
      if (warnIfReadOnly()) return;
      if (!KB.Storage.status().idbAvailable) {
        KB.UI.toast('Storage unavailable — snapshot not saved', 'error');
        return;
      }
      KB.Storage.backup(KB.State.data(), 'manual').then(function () {
        KB.UI.toast('Snapshot saved', 'success');
        renderSnapshots();
      });
    });
    snapActions.appendChild(snapNowBtn);
    snapSection.appendChild(snapActions);

    var snapList = h('div', { class: 'snapshot-list' });
    snapSection.appendChild(snapList);

    function fmtSnapshotTime(ts) {
      return KB.Dom.fmtDate(ts) + ' \u00B7 ' + new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    function renderSnapshots() {
      KB.Storage.listBackups().then(function (backups) {
        snapList.innerHTML = '';
        if (!backups || backups.length === 0) {
          var empty = h('p', { class: 'snapshot-empty' });
          empty.textContent = 'No snapshots yet — they are taken automatically as you work.';
          snapList.appendChild(empty);
          return;
        }
        backups.forEach(function (backup) {
          var row = h('div', { class: 'snapshot-row' });
          var meta = h('div', { class: 'snapshot-meta' });
          var reason = h('span', { class: 'snapshot-reason' });
          reason.textContent = backup.reason === 'manual' ? 'Manual snapshot' : backup.reason;
          var time = h('span', { class: 'snapshot-time' });
          time.textContent = fmtSnapshotTime(backup.createdAt);
          meta.appendChild(reason);
          meta.appendChild(time);
          row.appendChild(meta);
          var restoreBtn = h('button', { type: 'button', class: 'btn ghost sm' });
          restoreBtn.textContent = 'Restore';
          restoreBtn.addEventListener('click', function () {
            if (warnIfReadOnly()) return;
            if (!KB.Storage.status().idbAvailable) {
              KB.UI.toast('Storage unavailable — restore not possible', 'error');
              return;
            }
            if (!window.confirm('Restore this snapshot? Current data is kept in a new snapshot first.')) return;
            KB.Storage.backup(KB.State.data(), 'pre-restore');
            KB.Storage.restore(backup.id).then(function (payload) {
              if (!payload) {
                KB.UI.toast('Snapshot is unreadable', 'error');
                return;
              }
              var result = KB.State.restoreSnapshot(payload);
              if (result.ok) {
                KB.UI.toast('Snapshot restored', 'success', 'Undo', KB.UI.undoAction);
                close();
                KB.App.refresh();
              } else {
                KB.UI.toast('Snapshot is not a valid state', 'error');
              }
            });
          });
          row.appendChild(restoreBtn);
          snapList.appendChild(row);
        });
      });
    }
    renderSnapshots();
    panel.appendChild(snapSection);

    var actions = h('div', { class: 'modal-actions column-actions' });
    var exportAllBtn = h('button', { type: 'button', class: 'btn' });
    exportAllBtn.textContent = 'Export all boards';
    exportAllBtn.addEventListener('click', function () {
      KB.UI.download('floban-backup-' + KB.Filters.todayISO() + '.json', KB.State.exportAll());
      KB.UI.toast('Backup downloaded', 'success');
    });
    actions.appendChild(exportAllBtn);

    var exportBoardBtn = h('button', { type: 'button', class: 'btn ghost' });
    exportBoardBtn.textContent = 'Export this board';
    exportBoardBtn.addEventListener('click', function () {
      var name = KB.State.activeBoard().name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      KB.UI.download('floban-' + name + '-' + KB.Filters.todayISO() + '.json', KB.State.exportBoard());
      KB.UI.toast('Board exported', 'success');
    });
    actions.appendChild(exportBoardBtn);

    var importBtn = h('button', { type: 'button', class: 'btn danger-ghost' });
    importBtn.textContent = 'Import backup…';
    importBtn.addEventListener('click', function () {
      // Gate before the file picker opens (the change handler also guards).
      if (warnIfReadOnly()) return;
      fileInput.click();
    });
    actions.appendChild(importBtn);

    actions.appendChild(h('span', { class: 'spacer' }));
    var doneBtn = h('button', { type: 'button', class: 'btn primary' });
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', close);
    actions.appendChild(doneBtn);
    panel.appendChild(actions);

    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      // Belt-and-braces: the button gates before the picker; a direct change
      // (e.g. drag-drop onto the input) still refuses politely.
      if (warnIfReadOnly()) return;
      if (!confirm('Importing a full backup replaces ALL boards; a single-board export is added as a new board. Continue?')) return;
      var reader = new FileReader();
      reader.onload = function () {
        var result = KB.State.importAll(String(reader.result));
        if (result === 'all') {
          KB.UI.toast('Backup imported', 'success');
          close();
          KB.App.refresh();
        } else if (result === 'board') {
          KB.UI.toast('Board imported', 'success');
          close();
          KB.App.refresh();
        } else {
          KB.UI.toast('That file is not a valid Floban backup', 'error');
        }
      };
      reader.readAsText(file);
    });

    open(panel);
  }

  function captureModal() {
    var form = h('form', { class: 'card-form' });
    var heading = h('h2');
    heading.textContent = 'Capture';
    form.appendChild(heading);
    var hint = h('p', { class: 'form-hint' });
    hint.textContent = 'One line per item — paste several lines to capture many. URLs are detected automatically.';
    form.appendChild(hint);

    var textInput = h('textarea', { id: 'cap-text', rows: 4, placeholder: 'Call the dentist\nhttps://example.com/docs', 'aria-label': 'Capture text' });
    form.appendChild(fieldBlock('What is on your mind?', textInput, true));

    var noteInput = h('textarea', { id: 'cap-note', rows: 2, placeholder: 'Optional note…', 'aria-label': 'Note' });
    form.appendChild(fieldBlock('Note', noteInput));

    var actions = h('div', { class: 'modal-actions' });
    actions.appendChild(h('span', { class: 'spacer' }));
    var cancelBtn = h('button', { type: 'button', class: 'btn ghost' });
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', close);
    actions.appendChild(cancelBtn);
    var saveBtn = h('button', { type: 'submit', class: 'btn primary' });
    saveBtn.textContent = 'Capture';
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = textInput.value;
      var note = noteInput.value.trim();
      var lines = text.split('\n').map(function (line) { return line.trim(); }).filter(Boolean);
      if (lines.length === 0) {
        KB.UI.toast('Enter something to capture', 'error');
        textInput.focus();
        return;
      }
      var added = 0;
      if (lines.length === 1 && note) {
        var result = KB.State.captureInbox({ title: lines[0], note: note });
        if (result) added = 1;
      } else {
        var multi = KB.State.captureInboxLines(text);
        if (multi) added = multi.length;
      }
      close();
      KB.UI.toast(KB.Dom.plural(added, 'item') + ' captured', 'success', 'Undo', KB.UI.undoAction);
      KB.App.refresh();
    });

    open(form);
    setTimeout(function () { textInput.focus(); }, 0);
  }

  function mergeModal(item) {
    var form = h('form', { class: 'card-form' });
    var heading = h('h2');
    heading.textContent = 'Merge into card';
    form.appendChild(heading);
    var hint = h('p', { class: 'form-hint' });
    hint.textContent = item.title;
    form.appendChild(hint);

    var boardSelect = h('select', { id: 'mg-board', 'aria-label': 'Board' });
    KB.State.boards().forEach(function (board) {
      boardSelect.appendChild(new Option(board.name, board.id));
    });
    var active = KB.State.activeBoard();
    if (active) boardSelect.value = active.id;
    form.appendChild(fieldBlock('Board', boardSelect));

    var cardSelect = h('select', { id: 'mg-card', 'aria-label': 'Card' });
    form.appendChild(fieldBlock('Card', cardSelect));

    function refresh() {
      cardSelect.innerHTML = '';
      var board = KB.State.boardById(boardSelect.value);
      if (!board) return;
      board.columns.forEach(function (column) {
        column.cards.forEach(function (card) {
          cardSelect.appendChild(new Option(column.title + ' \u00B7 ' + card.title, card.id));
        });
      });
    }
    boardSelect.addEventListener('change', refresh);
    refresh();

    var actions = h('div', { class: 'modal-actions' });
    actions.appendChild(h('span', { class: 'spacer' }));
    var cancelBtn = h('button', { type: 'button', class: 'btn ghost' });
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', close);
    actions.appendChild(cancelBtn);
    var saveBtn = h('button', { type: 'submit', class: 'btn primary' });
    saveBtn.textContent = 'Merge';
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var result = KB.State.mergeInboxItem(item.id, {
        boardId: boardSelect.value,
        cardId: cardSelect.value
      });
      close();
      if (result) {
        KB.UI.toast('Merged into card', 'success', 'Undo', KB.UI.undoAction);
      } else {
        KB.UI.toast('Could not merge', 'error');
      }
      KB.App.refresh();
    });

    open(form);
  }

  KB.Modal.labelManager = labelManager;
  KB.Modal.backupModal = backupModal;
  KB.Modal.captureModal = captureModal;
  KB.Modal.mergeModal = mergeModal;
})(window.KB = window.KB || {});
