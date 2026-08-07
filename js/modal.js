(function (KB) {
  var h = KB.Dom.h;
  var icon = KB.Dom.icon;

  var overlay = null;
  var trigger = null;

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  function open(content, opener) {
    if (KB.UI.clearToasts) KB.UI.clearToasts();
    close();
    trigger = opener || null;
    overlay = h('div', { class: 'modal-backdrop' });
    var panel = h('div', { class: 'modal-panel', role: 'dialog', 'aria-modal': 'true' });
    panel.appendChild(content);
    overlay.appendChild(panel);
    KB.el('modal-root').appendChild(overlay);
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);
    var focusable = panel.querySelector('input, textarea, select, button');
    if (focusable) focusable.focus();
  }

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.removeEventListener('keydown', onKey);
    if (trigger) trigger.focus();
  }

  function fieldBlock(labelText, control, required) {
    var wrap = h('label', { class: 'field' });
    if (labelText) {
      var label = h('span');
      label.textContent = labelText;
      wrap.appendChild(label);
    }
    if (required) control.setAttribute('required', '');
    wrap.appendChild(control);
    return wrap;
  }

  function labelToggleChip(label, active) {
    var chip = h('button', {
      type: 'button',
      class: 'chip' + (active ? ' active' : ''),
      'data-id': label.id,
      title: 'Toggle label'
    });
    var dot = h('span', { class: 'dot' });
    dot.style.background = label.color;
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(label.name));
    KB.Dom.paintChip(chip, label.color);
    chip.addEventListener('click', function () {
      chip.classList.toggle('active');
    });
    return chip;
  }

  function checklistItem(item) {
    var row = h('div', { class: 'check-item', 'data-id': item.id });
    var check = h('input', { type: 'checkbox', 'aria-label': 'Checklist item done' });
    check.checked = Boolean(item.done);
    var text = h('input', { type: 'text', class: 'check-item-text', maxlength: 200, 'aria-label': 'Checklist item text' });
    text.value = item.text;
    var remove = h('button', { type: 'button', class: 'btn icon sm danger-ghost', 'data-action': 'remove-check', title: 'Remove item' });
    remove.innerHTML = icon('x');
    row.appendChild(check);
    row.appendChild(text);
    row.appendChild(remove);
    return row;
  }

  function checklistEditor(items) {
    var box = h('div', { class: 'check-editor' });
    box.appendChild(h('span', { class: 'check-editor-title', textContent: 'Checklist' }));

    var list = h('div', { class: 'check-list' });
    box.appendChild(list);

    function render(items) {
      list.innerHTML = '';
      (items || []).forEach(function (item) {
        list.appendChild(checklistItem(item));
      });
    }

    var addRow = h('div', { class: 'check-add-row' });
    var input = h('input', { type: 'text', placeholder: 'Add a checklist item…', maxlength: 200, 'aria-label': 'New checklist item' });
    var addBtn = h('button', { type: 'button', class: 'btn ghost sm' });
    addBtn.textContent = 'Add';
    addRow.appendChild(input);
    addRow.appendChild(addBtn);
    box.appendChild(addRow);

    addBtn.addEventListener('click', function () {
      var text = input.value.trim();
      if (!text) return;
      input.value = '';
      items.push({ id: KB.Dom.uid('ck'), text: text, done: false });
      render(items);
      input.focus();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addBtn.click();
      }
    });

    list.addEventListener('click', function (e) {
      if (e.target.closest('[data-action="remove-check"]')) {
        var row = e.target.closest('.check-item');
        if (row) row.remove();
      }
    });

    render(items);
    return box;
  }

  function readChecklist(box) {
    return Array.prototype.map.call(box.querySelectorAll('.check-item'), function (row) {
      return {
        id: row.dataset.id,
        text: row.querySelector('.check-item-text').value.trim(),
        done: row.querySelector('input[type="checkbox"]').checked
      };
    }).filter(function (item) { return item.text; });
  }

  function cardEditor(columnId, card, opener) {
    var isEdit = Boolean(card);
    var form = h('form', { class: 'card-form' });

    var heading = h('h2');
    heading.textContent = isEdit ? 'Edit card' : 'New card';
    form.appendChild(heading);

    var titleInput = h('input', { type: 'text', id: 'cf-title', maxlength: 120, placeholder: 'What needs doing?', 'aria-label': 'Card title' });
    titleInput.value = card ? card.title : '';
    form.appendChild(fieldBlock('Title', titleInput, true));

    var assigneeInput = h('input', { type: 'text', id: 'cf-assignee', list: 'assignee-list', placeholder: 'Who is responsible?', 'aria-label': 'Assignee' });
    assigneeInput.value = card ? (card.assignee || '') : '';
    form.appendChild(fieldBlock('Assignee', assigneeInput));

    var dueInput = h('input', { type: 'date', id: 'cf-due', 'aria-label': 'Due date' });
    dueInput.value = card ? (card.due || '') : '';
    form.appendChild(fieldBlock('Due date', dueInput));

    var priorityInput = h('select', { id: 'cf-priority', 'aria-label': 'Priority' });
    KB.Filters.PRIORITY_OPTIONS.forEach(function (pair) {
      priorityInput.appendChild(new Option(pair[1], pair[0]));
    });
    priorityInput.value = card ? (card.priority || 'none') : 'none';
    form.appendChild(fieldBlock('Priority', priorityInput));

    var sizeInput = h('select', { id: 'cf-size', 'aria-label': 'Size' });
    KB.Filters.SIZE_OPTIONS.forEach(function (pair) {
      sizeInput.appendChild(new Option(pair[1], pair[0]));
    });
    sizeInput.value = card ? (card.size || 'none') : 'none';
    form.appendChild(fieldBlock('Size', sizeInput));

    var descInput = h('textarea', { id: 'cf-desc', rows: 5, placeholder: 'Details, context, notes…  **bold**  *italic*  `code`  [link](url)', 'aria-label': 'Description' });
    descInput.value = card ? (card.description || '') : '';
    form.appendChild(fieldBlock('Description', descInput));

    var flowState = card && card.flow && card.flow.state ? card.flow.state : 'normal';
    var flowReason = card && card.flow ? (card.flow.reason || '') : '';
    var flowInput = h('select', { id: 'cf-flow', 'aria-label': 'Flow state' });
    [['normal', 'Normal'], ['blocked', 'Blocked'], ['waiting', 'Waiting'], ['paused', 'Paused']].forEach(function (pair) {
      flowInput.appendChild(new Option(pair[1], pair[0]));
    });
    flowInput.value = flowState;
    form.appendChild(fieldBlock('Flow state', flowInput));

    var flowReasonInput = h('input', {
      type: 'text',
      id: 'cf-flow-reason',
      maxlength: 200,
      placeholder: 'Why? e.g. Waiting for API credentials',
      'aria-label': 'Flow state reason'
    });
    flowReasonInput.value = flowReason;
    var flowReasonWrap = fieldBlock('Reason', flowReasonInput);
    flowReasonWrap.classList.toggle('hidden', flowState === 'normal');
    form.appendChild(flowReasonWrap);

    flowInput.addEventListener('change', function () {
      flowReasonWrap.classList.toggle('hidden', flowInput.value === 'normal');
    });

    var checklistState = card && card.checklist ? card.checklist.map(function (item) {
      return { id: item.id, text: item.text, done: Boolean(item.done) };
    }) : [];
    var checkBox = checklistEditor(checklistState);
    form.appendChild(fieldBlock('', checkBox));

    var labelsBox = h('div', { class: 'label-picker' });
    KB.State.labels().forEach(function (label) {
      labelsBox.appendChild(labelToggleChip(label, isEdit && card.labels.indexOf(label.id) !== -1));
    });
    form.appendChild(fieldBlock('Labels', labelsBox));

    var newName = h('input', { type: 'text', placeholder: 'New label name', maxlength: 24, 'aria-label': 'New label name' });
    var newColor = h('input', { type: 'color', value: '#6d30d6', 'aria-label': 'Label colour' });
    var newAdd = h('button', { type: 'button', class: 'btn ghost sm' });
    newAdd.textContent = 'Add';
    var createRow = h('div', { class: 'label-create-row' });
    createRow.appendChild(newName);
    createRow.appendChild(newColor);
    createRow.appendChild(newAdd);
    form.appendChild(fieldBlock('Create label', createRow));

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
      var label = KB.State.addLabel(name, newColor.value);
      labelsBox.appendChild(labelToggleChip(label, true));
      newName.value = '';
      KB.UI.toast('Label added', 'success');
    });

    function collect() {
      return {
        title: titleInput.value.trim(),
        assignee: assigneeInput.value.trim(),
        due: dueInput.value || '',
        priority: priorityInput.value,
        size: sizeInput.value,
        description: descInput.value.trim(),
        checklist: readChecklist(checkBox),
        labels: Array.prototype.map.call(labelsBox.querySelectorAll('.chip.active'), function (chip) {
          return chip.dataset.id;
        })
      };
    }

    var actions = h('div', { class: 'modal-actions' });
    if (isEdit) {
      var archiveBtn = h('button', { type: 'button', class: 'btn danger-ghost' });
      archiveBtn.textContent = 'Archive';
      archiveBtn.addEventListener('click', function () {
        KB.State.archiveCard(columnId, card.id);
        KB.UI.toast('Card archived', 'info', 'Undo', KB.UI.undoAction);
        close();
        KB.App.refresh();
      });
      actions.appendChild(archiveBtn);

      var duplicateBtn = h('button', { type: 'button', class: 'btn ghost' });
      duplicateBtn.textContent = 'Duplicate';
      duplicateBtn.title = 'Create a copy of this card';
      duplicateBtn.addEventListener('click', function () {
        var copy = KB.State.duplicateCard(columnId, card.id);
        if (copy) {
          KB.UI.toast('Card duplicated', 'success', 'Undo', KB.UI.undoAction);
          close();
          KB.App.refresh();
        }
      });
      actions.appendChild(duplicateBtn);

      var templateBtn = h('button', { type: 'button', class: 'btn ghost' });
      templateBtn.textContent = 'Save as template';
      templateBtn.title = 'Reuse this card later from a column quick-add';
      templateBtn.addEventListener('click', function () {
        var data = collect();
        if (!data.title) {
          KB.UI.toast('Give the card a title first', 'error');
          return;
        }
        KB.State.addTemplate({
          title: data.title,
          description: data.description,
          labels: data.labels,
          assignee: data.assignee,
          priority: data.priority,
          size: data.size,
          checklist: data.checklist
        });
        KB.UI.toast('Template saved', 'success');
      });
      actions.appendChild(templateBtn);
    }
    var spacer = h('span', { class: 'spacer' });
    actions.appendChild(spacer);
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
      var data = collect();
      if (!data.title) {
        KB.UI.toast('Title is required', 'error');
        titleInput.focus();
        return;
      }
      if (isEdit) {
        KB.State.updateCardWithFlow(columnId, card.id, data, flowInput.value, flowReasonInput.value.trim());
        KB.UI.toast('Changes saved', 'success');
      } else {
        KB.State.addCard(columnId, data);
        KB.UI.toast('Card added', 'success');
      }
      close();
      KB.App.refresh();
    });

    open(form, opener);
  }

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
      if (isEdit) {
        KB.State.updateColumn(columnId, { title: title, isDone: doneCheck.checked, role: roleInput.value, wipLimit: wipLimit });
        KB.UI.toast('Column updated', 'success');
      } else {
        KB.State.addColumn(title, doneCheck.checked, false, roleInput.value);
        KB.UI.toast('Column added', 'success');
      }
      close();
      KB.App.refresh();
    });

    open(form, opener);
  }

  function promptModal(title, labelText, initial, onSave) {
    var form = h('form', { class: 'card-form' });
    var heading = h('h2');
    heading.textContent = title;
    form.appendChild(heading);

    var input = h('input', { type: 'text', maxlength: 60, 'aria-label': labelText });
    input.value = initial || '';
    form.appendChild(fieldBlock(labelText, input, true));

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
      var value = input.value.trim();
      if (!value) {
        KB.UI.toast('A name is required', 'error');
        input.focus();
        return;
      }
      close();
      onSave(value);
    });

    open(form);
  }

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

    var actions = h('div', { class: 'modal-actions column-actions' });
    var exportAllBtn = h('button', { type: 'button', class: 'btn' });
    exportAllBtn.textContent = 'Export all boards';
    exportAllBtn.addEventListener('click', function () {
      KB.UI.download('kanban-backup-' + KB.Filters.todayISO() + '.json', KB.State.exportAll());
      KB.UI.toast('Backup downloaded', 'success');
    });
    actions.appendChild(exportAllBtn);

    var exportBoardBtn = h('button', { type: 'button', class: 'btn ghost' });
    exportBoardBtn.textContent = 'Export this board';
    exportBoardBtn.addEventListener('click', function () {
      var name = KB.State.activeBoard().name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      KB.UI.download('kanban-' + name + '-' + KB.Filters.todayISO() + '.json', KB.State.exportBoard());
      KB.UI.toast('Board exported', 'success');
    });
    actions.appendChild(exportBoardBtn);

    var importBtn = h('button', { type: 'button', class: 'btn danger-ghost' });
    importBtn.textContent = 'Import backup…';
    importBtn.addEventListener('click', function () { fileInput.click(); });
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
          KB.UI.toast('That file is not a valid kanban backup', 'error');
        }
      };
      reader.readAsText(file);
    });

    open(panel);
  }

  function isOpen() {
    return overlay !== null;
  }

  KB.Modal = {
    cardEditor: cardEditor,
    columnEditor: columnEditor,
    labelManager: labelManager,
    promptModal: promptModal,
    backupModal: backupModal,
    isOpen: isOpen
  };
})(window.KB = window.KB || {});
