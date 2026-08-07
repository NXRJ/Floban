(function (KB) {
  var h = KB.Dom.h;
  var icon = KB.Dom.icon;
  var open = KB.Modal.open;
  var close = KB.Modal.close;
  var fieldBlock = KB.Modal.fieldBlock;
  var labelToggleChip = KB.Modal.labelToggleChip;
  function columnEditor(columnId, opener) {
    var column = columnId ? KB.State.findColumn(columnId) : null;
    var isEdit = Boolean(column);
    var form = h('form', { class: 'card-form' });

    var heading = h('h2');
    heading.textContent = isEdit ? 'Edit column' : 'New column';
    form.appendChild(heading);

    var titleInput = h('input', { type: 'text', maxlength: 60, placeholder: 'Column name', 'aria-label': 'Column name' });
    titleInput.value = column ? column.title : '';
    form.appendChild(fieldBlock('Name', titleInput, true));

    var wipInput = h('input', { type: 'number', id: 'ce-wip', min: 0, max: 99, placeholder: '0 = no limit', 'aria-label': 'WIP limit' });
    wipInput.value = column && column.wipLimit ? column.wipLimit : '';
    form.appendChild(fieldBlock('WIP limit — warn when more cards are here', wipInput));

    var doneCheck = h('input', { type: 'checkbox', id: 'ce-done', 'aria-label': 'Completion column' });
    doneCheck.checked = isEdit ? Boolean(column.isDone) : false;
    var doneLabel = h('label', { class: 'field check' });
    var doneText = h('span');
    doneText.textContent = 'Completion column — cards here show a checkmark';
    doneLabel.appendChild(doneCheck);
    doneLabel.appendChild(doneText);
    form.appendChild(doneLabel);

    var roleInput = h('select', { id: 'ce-role', 'aria-label': 'Column role' });
    [['queue', 'Queue — ready or awaiting pull'], ['active', 'Active — currently being worked'], ['done', 'Done — completed'], ['backlog', 'Backlog — not committed']].forEach(function (pair) {
      roleInput.appendChild(new Option(pair[1], pair[0]));
    });
    roleInput.value = isEdit ? (column.role || 'queue') : 'queue';
    form.appendChild(fieldBlock('Workflow role', roleInput));

    roleInput.addEventListener('change', function () {
      doneCheck.checked = roleInput.value === 'done';
    });
    doneCheck.addEventListener('change', function () {
      if (doneCheck.checked) roleInput.value = 'done';
      else if (roleInput.value === 'done') roleInput.value = 'queue';
    });

    var wipModeInput = h('select', { id: 'ce-wip-mode', 'aria-label': 'WIP mode' });
    [['off', 'Off — no enforcement'], ['soft', 'Soft — warn but allow'], ['hard', 'Hard — require override']].forEach(function (pair) {
      wipModeInput.appendChild(new Option(pair[1], pair[0]));
    });
    wipModeInput.value = isEdit ? (column.policy && column.policy.wipMode ? column.policy.wipMode : 'off') : 'off';
    form.appendChild(fieldBlock('WIP mode', wipModeInput));

    var reasonCheck = h('input', { type: 'checkbox', id: 'ce-reason', 'aria-label': 'Require override reason' });
    reasonCheck.checked = isEdit ? Boolean(column.policy && column.policy.overrideRequiresReason) : false;
    var reasonLabel = h('label', { class: 'field check' });
    var reasonText = h('span');
    reasonText.textContent = 'Require a reason for hard overrides';
    reasonLabel.appendChild(reasonCheck);
    reasonLabel.appendChild(reasonText);
    form.appendChild(reasonLabel);

    function criteriaEditor(labelText, values) {
      var box = h('div', { class: 'criteria-editor' });
      box.appendChild(h('span', { class: 'check-editor-title', textContent: labelText }));
      var list = h('div', { class: 'criteria-list' });
      box.appendChild(list);
      var addRow = h('div', { class: 'check-add-row' });
      var input = h('input', { type: 'text', placeholder: 'Add a criterion…', maxlength: 200 });
      var addBtn = h('button', { type: 'button', class: 'btn ghost sm' });
      addBtn.textContent = 'Add';
      addRow.appendChild(input);
      addRow.appendChild(addBtn);
      box.appendChild(addRow);
      function render() {
        list.innerHTML = '';
        values.forEach(function (text, index) {
          var row = h('div', { class: 'criteria-item' });
          var span = h('span');
          span.textContent = '\u25A2 ' + text;
          var remove = h('button', { type: 'button', class: 'btn icon sm danger-ghost', title: 'Remove criterion' });
          remove.innerHTML = icon('x');
          remove.addEventListener('click', function () {
            values.splice(index, 1);
            render();
          });
          row.appendChild(span);
          row.appendChild(remove);
          list.appendChild(row);
        });
      }
      addBtn.addEventListener('click', function () {
        var text = input.value.trim();
        if (!text) return;
        values.push(text);
        input.value = '';
        render();
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          addBtn.click();
        }
      });
      render();
      return box;
    }

    var entryCriteria = isEdit && Array.isArray(column.policy && column.policy.entryCriteria)
      ? column.policy.entryCriteria.slice()
      : [];
    form.appendChild(criteriaEditor('Entry criteria', entryCriteria));

    var exitCriteria = isEdit && Array.isArray(column.policy && column.policy.exitCriteria)
      ? column.policy.exitCriteria.slice()
      : [];
    form.appendChild(criteriaEditor('Exit criteria', exitCriteria));

    var defaultsBox = h('div', { class: 'label-picker' });
    KB.State.labels().forEach(function (label) {
      var active = isEdit && Array.isArray(column.policy && column.policy.defaultLabelIds) &&
        column.policy.defaultLabelIds.indexOf(label.id) !== -1;
      defaultsBox.appendChild(labelToggleChip(label, active));
    });
    form.appendChild(fieldBlock('Default labels on entry', defaultsBox));

    var defaultAssigneeInput = h('input', { type: 'text', list: 'assignee-list', maxlength: 60, placeholder: 'Assignee set on entry', 'aria-label': 'Default assignee' });
    defaultAssigneeInput.value = isEdit && column.policy ? (column.policy.defaultAssignee || '') : '';
    form.appendChild(fieldBlock('Default assignee on entry', defaultAssigneeInput));

    var actions = h('div', { class: 'modal-actions' });
    if (isEdit) {
      var deleteBtn = h('button', { type: 'button', class: 'btn danger' });
      deleteBtn.textContent = 'Delete column';
      deleteBtn.addEventListener('click', function () {
        var cardCount = column.cards.length;
        var message = cardCount > 0
          ? 'Delete "' + column.title + '"? Its ' + KB.Dom.plural(cardCount, 'card') + ' will move to the archive.'
          : 'Delete "' + column.title + '"?';
        if (!confirm(message)) return;
        KB.State.deleteColumn(columnId);
        KB.UI.toast(cardCount > 0 ? 'Column deleted — ' + KB.Dom.plural(cardCount, 'card') + ' archived' : 'Column deleted', 'info', 'Undo', KB.UI.undoAction);
        close();
        KB.App.refresh();
      });
      actions.appendChild(deleteBtn);
    }
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
      var title = titleInput.value.trim();
      if (!title) {
        KB.UI.toast('Column name is required', 'error');
        titleInput.focus();
        return;
      }
      var wipRaw = parseInt(wipInput.value, 10);
      var wipLimit = isFinite(wipRaw) && wipRaw > 0 ? Math.min(wipRaw, 99) : 0;
      var policy = {
        wipMode: wipModeInput.value,
        overrideRequiresReason: reasonCheck.checked,
        entryCriteria: entryCriteria,
        exitCriteria: exitCriteria,
        defaultLabelIds: Array.prototype.map.call(defaultsBox.querySelectorAll('.chip.active'), function (chip) {
          return chip.dataset.id;
        }),
        defaultAssignee: defaultAssigneeInput.value.trim()
      };
      if (isEdit) {
        KB.State.updateColumn(columnId, { title: title, isDone: doneCheck.checked, role: roleInput.value, wipLimit: wipLimit, policy: policy });
        KB.UI.toast('Column updated', 'success');
      } else {
        KB.State.addColumn(title, doneCheck.checked, false, roleInput.value);
        var fresh = KB.State.activeBoard().columns[KB.State.activeBoard().columns.length - 1];
        KB.State.updateColumn(fresh.id, { policy: policy });
        KB.UI.toast('Column added', 'success');
      }
      close();
      KB.App.refresh();
    });

    open(form, opener);
  }

  KB.Modal.columnEditor = columnEditor;
})(window.KB = window.KB || {});
