(function (KB) {
  var h = KB.Dom.h;
  var icon = KB.Dom.icon;

  var overlay = null;
  var trigger = null;

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  function open(content, opener) {
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
    var label = h('span');
    label.textContent = labelText;
    wrap.appendChild(label);
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
    chip.style.background = label.color;
    chip.style.color = KB.Dom.inkOn(label.color);
    chip.style.borderColor = 'rgba(0, 0, 0, 0.35)';
    chip.addEventListener('click', function () {
      chip.classList.toggle('active');
    });
    return chip;
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

    var descInput = h('textarea', { id: 'cf-desc', rows: 5, placeholder: 'Details, context, notes…', 'aria-label': 'Description' });
    descInput.value = card ? (card.description || '') : '';
    form.appendChild(fieldBlock('Description', descInput));

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

    var actions = h('div', { class: 'modal-actions' });
    if (isEdit) {
      var archiveBtn = h('button', { type: 'button', class: 'btn danger-ghost' });
      archiveBtn.textContent = 'Archive card';
      archiveBtn.addEventListener('click', function () {
        KB.State.archiveCard(columnId, card.id);
        KB.UI.toast('Card archived', 'info');
        close();
        KB.App.refresh();
      });
      actions.appendChild(archiveBtn);
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
      var title = titleInput.value.trim();
      if (!title) {
        KB.UI.toast('Title is required', 'error');
        titleInput.focus();
        return;
      }
      var data = {
        title: title,
        assignee: assigneeInput.value.trim(),
        description: descInput.value.trim(),
        labels: Array.prototype.map.call(labelsBox.querySelectorAll('.chip.active'), function (chip) {
          return chip.dataset.id;
        })
      };
      if (isEdit) {
        KB.State.updateCard(columnId, card.id, data);
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

    var doneCheck = h('input', { type: 'checkbox', id: 'ce-done', 'aria-label': 'Completion column' });
    doneCheck.checked = isEdit ? Boolean(column.isDone) : false;
    var doneLabel = h('label', { class: 'field check' });
    var doneText = h('span');
    doneText.textContent = 'Completion column — cards here show a checkmark';
    doneLabel.appendChild(doneCheck);
    doneLabel.appendChild(doneText);
    form.appendChild(doneLabel);

    var actions = h('div', { class: 'modal-actions' });
    if (isEdit) {
      var deleteBtn = h('button', { type: 'button', class: 'btn danger' });
      deleteBtn.textContent = 'Delete column';
      deleteBtn.addEventListener('click', function () {
        var cardCount = column.cards.length;
        var message = cardCount > 0
          ? 'Delete "' + column.title + '"? Its ' + cardCount + ' card(s) will be moved to the archive.'
          : 'Delete "' + column.title + '"?';
        if (!confirm(message)) return;
        KB.State.deleteColumn(columnId);
        KB.UI.toast(cardCount > 0 ? 'Column deleted — ' + cardCount + ' card(s) archived' : 'Column deleted', 'info');
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
      if (isEdit) {
        KB.State.updateColumn(columnId, { title: title, isDone: doneCheck.checked });
        KB.UI.toast('Column updated', 'success');
      } else {
        KB.State.addColumn(title, doneCheck.checked);
        KB.UI.toast('Column added', 'success');
      }
      close();
      KB.App.refresh();
    });

    open(form, opener);
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
        chip.style.background = label.color;
        chip.style.color = KB.Dom.inkOn(label.color);
        chip.style.borderColor = 'rgba(0, 0, 0, 0.35)';
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

  KB.Modal = { cardEditor: cardEditor, columnEditor: columnEditor, labelManager: labelManager };
})(window.KB = window.KB || {});

