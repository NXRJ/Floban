(function (KB) {
  var h = KB.Dom.h;
  var open = KB.Modal.open;
  var close = KB.Modal.close;
  var fieldBlock = KB.Modal.fieldBlock;
  var labelToggleChip = KB.Modal.labelToggleChip;

  function triageModal(item) {
    var form = h('form', { class: 'card-form' });
    var heading = h('h2');
    heading.textContent = 'Triage';
    form.appendChild(heading);
    var hint = h('p', { class: 'form-hint' });
    hint.textContent = item.title + (item.url ? ' \u2014 ' + item.url : '');
    form.appendChild(hint);

    var boardSelect = h('select', { id: 'tr-board', 'aria-label': 'Destination board' });
    KB.State.boards().forEach(function (board) {
      boardSelect.appendChild(new Option(board.name, board.id));
    });
    var active = KB.State.activeBoard();
    if (active) boardSelect.value = active.id;
    form.appendChild(fieldBlock('Board', boardSelect));

    var columnSelect = h('select', { id: 'tr-column', 'aria-label': 'Destination column' });
    form.appendChild(fieldBlock('Column', columnSelect));

    var dueInput = h('input', { type: 'date', id: 'tr-due', 'aria-label': 'Due date' });
    form.appendChild(fieldBlock('Due date', dueInput));

    var priorityInput = h('select', { id: 'tr-priority', 'aria-label': 'Priority' });
    KB.Filters.PRIORITY_OPTIONS.forEach(function (pair) { priorityInput.appendChild(new Option(pair[1], pair[0])); });
    form.appendChild(fieldBlock('Priority', priorityInput));

    var sizeInput = h('select', { id: 'tr-size', 'aria-label': 'Size' });
    KB.Filters.SIZE_OPTIONS.forEach(function (pair) { sizeInput.appendChild(new Option(pair[1], pair[0])); });
    form.appendChild(fieldBlock('Size', sizeInput));

    var assigneeInput = h('input', { type: 'text', list: 'assignee-list', maxlength: 60, 'aria-label': 'Assignee' });
    form.appendChild(fieldBlock('Assignee', assigneeInput));

    var labelsBox = h('div', { class: 'label-picker' });
    form.appendChild(fieldBlock('Labels', labelsBox));

    function refresh() {
      var board = KB.State.boardById(boardSelect.value);
      columnSelect.innerHTML = '';
      if (!board) return;
      board.columns.forEach(function (column) {
        columnSelect.appendChild(new Option(column.title, column.id));
      });
      labelsBox.innerHTML = '';
      board.labels.forEach(function (label) {
        labelsBox.appendChild(labelToggleChip(label, false));
      });
    }
    boardSelect.addEventListener('change', refresh);
    refresh();

    var actions = h('div', { class: 'modal-actions' });
    var archiveBtn = h('button', { type: 'button', class: 'btn ghost' });
    archiveBtn.textContent = 'Archive as reference';
    archiveBtn.addEventListener('click', function () {
      KB.State.updateInboxItem(item.id, { archived: true });
      KB.UI.toast('Item archived', 'info', 'Undo', KB.UI.undoAction);
      close();
      KB.App.refresh();
    });
    actions.appendChild(archiveBtn);
    var recurBtn = h('button', { type: 'button', class: 'btn ghost' });
    recurBtn.textContent = 'Convert to recurrence';
    recurBtn.addEventListener('click', function () {
      close();
      KB.Modal.recurrenceEditor(null, {
        boardId: boardSelect.value,
        columnId: columnSelect.value,
        title: item.title,
        description: item.note || (item.url ? 'Source: ' + item.url : '')
      }, { inboxId: item.id });
    });
    actions.appendChild(recurBtn);
    var deleteBtn = h('button', { type: 'button', class: 'btn danger-ghost' });
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', function () {
      KB.State.deleteInboxItem(item.id);
      KB.UI.toast('Item deleted', 'info', 'Undo', KB.UI.undoAction);
      close();
      KB.App.refresh();
    });
    actions.appendChild(deleteBtn);
    actions.appendChild(h('span', { class: 'spacer' }));
    var cancelBtn = h('button', { type: 'button', class: 'btn ghost' });
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', close);
    actions.appendChild(cancelBtn);
    var saveBtn = h('button', { type: 'submit', class: 'btn primary' });
    saveBtn.textContent = 'Turn into card';
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var target = {
        boardId: boardSelect.value,
        columnId: columnSelect.value
      };
      var patch = {
        due: dueInput.value || '',
        priority: priorityInput.value,
        size: sizeInput.value,
        assignee: assigneeInput.value.trim(),
        labels: Array.prototype.map.call(labelsBox.querySelectorAll('.chip.active'), function (chip) {
          return chip.dataset.id;
        })
      };
      var result = KB.State.triageInboxItem(item.id, target, patch);
      if (result && result.reason === 'policy') {
        KB.Modal.moveConfirmModal('Triage requires confirmation', result.evaluation, '', function (reason) {
          var confirmed = KB.State.triageInboxItem(item.id, target, patch, { confirmed: true, overrideReason: reason });
          close();
          if (confirmed && confirmed.changed) {
            KB.UI.toast('Card created', 'success', 'Undo', KB.UI.undoAction);
          } else {
            KB.UI.toast('Could not triage that item', 'error');
          }
          KB.App.refresh();
        });
        return;
      }
      close();
      if (result && result.changed) {
        KB.UI.toast('Card created', 'success', 'Undo', KB.UI.undoAction);
      } else {
        KB.UI.toast('Could not triage that item', 'error');
      }
      KB.App.refresh();
    });

    open(form);
  }

  function lensEditor(lens, onSaved) {
    var form = h('form', { class: 'card-form' });
    var heading = h('h2');
    heading.textContent = 'Edit lens';
    form.appendChild(heading);

    var nameInput = h('input', { type: 'text', maxlength: 60, 'aria-label': 'Lens name' });
    nameInput.value = lens.name;
    form.appendChild(fieldBlock('Name', nameInput, true));

    var scopeInput = h('select', { id: 'le-scope', 'aria-label': 'Scope' });
    [['active-board', 'Active board'], ['all-boards', 'All boards'], ['selected-boards', 'Selected boards']].forEach(function (pair) {
      scopeInput.appendChild(new Option(pair[1], pair[0]));
    });
    scopeInput.value = lens.scope;
    form.appendChild(fieldBlock('Scope', scopeInput));

    var boardPick = h('div', { class: 'label-picker' });
    KB.State.boards().forEach(function (board) {
      var chip = labelToggleChip({ id: board.id, name: board.name, color: '#2a58c4' }, lens.boardIds.indexOf(board.id) !== -1);
      boardPick.appendChild(chip);
    });
    form.appendChild(fieldBlock('Boards (selected scope)', boardPick));

    var searchInput = h('input', { type: 'text', maxlength: 120, 'aria-label': 'Search' });
    searchInput.value = lens.query.search || '';
    form.appendChild(fieldBlock('Search', searchInput));

    var dueInput = h('select', { id: 'le-due', 'aria-label': 'Due filter' });
    [['any', 'Any due date'], ['overdue', 'Overdue'], ['today', 'Due today'], ['week', 'Due this week'], ['none', 'No due date']].forEach(function (pair) {
      dueInput.appendChild(new Option(pair[1], pair[0]));
    });
    dueInput.value = lens.query.due || 'any';
    form.appendChild(fieldBlock('Due', dueInput));

    var sortInput = h('select', { id: 'le-sort', 'aria-label': 'Sort field' });
    [['manual', 'Manual'], ['priority', 'Priority'], ['due', 'Due date'], ['created', 'Created'], ['updated', 'Updated'], ['age', 'Age'], ['blocked-duration', 'Blocked duration']].forEach(function (pair) {
      sortInput.appendChild(new Option(pair[1], pair[0]));
    });
    sortInput.value = lens.sort.field;
    form.appendChild(fieldBlock('Sort by', sortInput));

    var groupInput = h('select', { id: 'le-group', 'aria-label': 'Group by' });
    [['board', 'Board'], ['column', 'Column'], ['priority', 'Priority'], ['assignee', 'Assignee'], ['none', 'None']].forEach(function (pair) {
      groupInput.appendChild(new Option(pair[1], pair[0]));
    });
    groupInput.value = lens.display.groupBy;
    form.appendChild(fieldBlock('Group by', groupInput));

    var readyCheck = h('input', { type: 'checkbox', id: 'le-ready', 'aria-label': 'Ready only' });
    readyCheck.checked = Boolean(lens.query.readyOnly);
    var readyLabel = h('label', { class: 'field check' });
    var readyText = h('span');
    readyText.textContent = 'Only ready-to-pull cards';
    readyLabel.appendChild(readyCheck);
    readyLabel.appendChild(readyText);
    form.appendChild(readyLabel);

    var doneCheck = h('input', { type: 'checkbox', id: 'le-done', 'aria-label': 'Include completed' });
    doneCheck.checked = lens.query.includeCompleted !== false;
    var doneLabel = h('label', { class: 'field check' });
    var doneText = h('span');
    doneText.textContent = 'Include completed cards';
    doneLabel.appendChild(doneCheck);
    doneLabel.appendChild(doneText);
    form.appendChild(doneLabel);

    var actions = h('div', { class: 'modal-actions' });
    actions.appendChild(h('span', { class: 'spacer' }));
    var cancelBtn = h('button', { type: 'button', class: 'btn ghost' });
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', close);
    actions.appendChild(cancelBtn);
    var saveBtn = h('button', { type: 'submit', class: 'btn primary' });
    saveBtn.textContent = 'Save';
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = nameInput.value.trim();
      if (!name) {
        KB.UI.toast('A name is required', 'error');
        nameInput.focus();
        return;
      }
      KB.State.updateLens(lens.id, {
        name: name,
        scope: scopeInput.value,
        boardIds: Array.prototype.map.call(boardPick.querySelectorAll('.chip.active'), function (chip) { return chip.dataset.id; }),
        query: {
          search: searchInput.value.trim(),
          labelIds: lens.query.labelIds || [],
          assignees: lens.query.assignees || [],
          due: dueInput.value,
          priorities: lens.query.priorities || [],
          sizes: lens.query.sizes || [],
          flowStates: lens.query.flowStates || [],
          blockedOnly: false,
          readyOnly: readyCheck.checked,
          columnRoles: lens.query.columnRoles || [],
          includeCompleted: doneCheck.checked
        },
        sort: { field: sortInput.value, direction: 'desc' },
        display: { density: lens.display.density, groupBy: groupInput.value }
      });
      KB.UI.toast('Lens updated', 'success', 'Undo', KB.UI.undoAction);
      close();
      if (onSaved) onSaved();
      KB.App.refresh();
    });

    open(form);
  }

  KB.Modal.triageModal = triageModal;
  KB.Modal.lensEditor = lensEditor;
})(window.KB = window.KB || {});
