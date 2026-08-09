(function (KB) {
  var h = KB.Dom.h;
  var icon = KB.Dom.icon;

  var overlay = null;
  var trigger = null;
  // Fired once by close() after teardown so a modal can react to being
  // dismissed through ANY path (Cancel button, Escape, backdrop click).
  // moveConfirmModal uses it to run onCancel while suppressing it on
  // confirm. Cleared before firing so close() never re-fires a hook.
  var closeHook = null;

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  function open(content, opener, onClose) {
    if (KB.UI.clearToasts) KB.UI.clearToasts();
    close();
    trigger = opener || null;
    closeHook = onClose || null;
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
    var hook = closeHook;
    closeHook = null;
    if (trigger) trigger.focus();
    if (hook) hook();
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

  function labelsFor(boardId) {
    var board = boardId ? KB.State.boardById(boardId) : null;
    return board ? (board.labels || []) : (KB.State.labels() || []);
  }


  function buildPromptForm(title, labelText, opts, onSave) {
    // Shared skeleton for single-line prompt dialogs.
    // opts: { maxlength, initial, placeholder, required, submitLabel, hint }
    opts = opts || {};
    var form = h('form', { class: 'card-form' });
    var heading = h('h2');
    heading.textContent = title;
    form.appendChild(heading);

    var input = h('input', { type: 'text', maxlength: opts.maxlength || 60, 'aria-label': labelText });
    input.value = opts.initial || '';
    if (opts.placeholder) input.placeholder = opts.placeholder;
    form.appendChild(fieldBlock(labelText, input, Boolean(opts.required)));

    var actions = h('div', { class: 'modal-actions' });
    actions.appendChild(h('span', { class: 'spacer' }));
    var cancelBtn = h('button', { type: 'button', class: 'btn ghost' });
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', close);
    actions.appendChild(cancelBtn);
    var saveBtn = h('button', { type: 'submit', class: 'btn primary' });
    saveBtn.textContent = opts.submitLabel || 'Save';
    actions.appendChild(saveBtn);
    form.appendChild(actions);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var value = input.value.trim();
      if (opts.required && !value) {
        KB.UI.toast(opts.hint || 'A name is required', 'error');
        input.focus();
        return;
      }
      close();
      onSave(value);
    });

    return form;
  }

  function promptModal(title, labelText, initial, onSave) {
    open(buildPromptForm(title, labelText, { maxlength: 60, initial: initial, required: true }, onSave));
  }

  function promptOptionalModal(title, labelText, placeholder, onSave) {
    // Like promptModal but the value may be left empty.
    open(buildPromptForm(title, labelText, { maxlength: 200, placeholder: placeholder, submitLabel: 'OK' }, onSave));
  }

  function moveConfirmModal(title, evaluation, targetColumnTitle, onConfirm, onCancel) {
    var panel = h('div', { class: 'card-form' });

    var heading = h('h2');
    heading.textContent = title || 'Move requires confirmation';
    panel.appendChild(heading);

    var soft = evaluation && evaluation.allowed === true;
    var violations = evaluation.violations || [];
    var criterionChecks = [];
    violations.forEach(function (violation) {
      var p = h('p', { class: 'policy-violation' });
      p.textContent = '\u25A2 ' + violation.message;
      panel.appendChild(p);
      if (!soft && Array.isArray(violation.criteria) && violation.criteria.length > 0) {
        violation.criteria.forEach(function (criterion) {
          var wrap = h('label', { class: 'field check' });
          var box = h('input', { type: 'checkbox', class: 'mv-criterion', 'aria-label': 'Confirm criterion' });
          var text = h('span');
          text.textContent = criterion;
          wrap.appendChild(box);
          wrap.appendChild(text);
          criterionChecks.push(box);
          panel.appendChild(wrap);
        });
      }
    });

    var reasonInput = null;
    var reasonWrap = null;
    if (!soft && evaluation.needsReason) {
      reasonInput = h('input', { type: 'text', id: 'mv-reason', maxlength: 200, placeholder: 'Why is this override justified?', 'aria-label': 'Override reason' });
      reasonWrap = fieldBlock('Override reason', reasonInput);
      panel.appendChild(reasonWrap);
    }

    var actions = h('div', { class: 'modal-actions' });
    actions.appendChild(h('span', { class: 'spacer' }));
    var confirmed = false;
    var cancelBtn = h('button', { type: 'button', class: 'btn ghost' });
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', close);
    actions.appendChild(cancelBtn);
    var confirmBtn = h('button', { type: 'button', class: 'btn primary' });
    confirmBtn.textContent = soft ? 'Move anyway' : 'Confirm move';
    confirmBtn.addEventListener('click', function () {
      if (!soft) {
        if (criterionChecks.length > 0 && !criterionChecks.every(function (box) { return box.checked; })) {
          KB.UI.toast('Confirm every criterion to continue', 'error');
          return;
        }
        var reason = reasonInput ? reasonInput.value.trim() : '';
        if (evaluation.needsReason && !reason) {
          KB.UI.toast('An override reason is required', 'error');
          reasonInput.focus();
          return;
        }
      }
      confirmed = true;
      close();
      onConfirm(soft ? '' : (reasonInput ? reasonInput.value.trim() : ''));
    });
    actions.appendChild(confirmBtn);
    panel.appendChild(actions);

    open(panel, null, function () {
      if (!confirmed && onCancel) onCancel();
    });
  }

  function isOpen() {
    return overlay !== null;
  }

  KB.Modal = {
    open: open,
    close: close,
    fieldBlock: fieldBlock,
    labelToggleChip: labelToggleChip,
    checklistItem: checklistItem,
    checklistEditor: checklistEditor,
    readChecklist: readChecklist,
    labelsFor: labelsFor,
    promptModal: promptModal,
    promptOptionalModal: promptOptionalModal,
    moveConfirmModal: moveConfirmModal,
    isOpen: isOpen
  };
})(window.KB = window.KB || {});
