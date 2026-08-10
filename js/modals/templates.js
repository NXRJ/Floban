(function (KB) {
  var h = KB.Dom.h;
  var open = KB.Modal.open;
  var close = KB.Modal.close;

  // CARTRIDGE gallery: save the active board's structure as a reusable
  // template, then stamp fresh boards from it. Templates live in state
  // (IndexedDB) and can ride the exporter's JSON path.

  function saveAsTemplate(opener) {
    var board = KB.State.activeBoard();
    if (!board) return;
    var panel = h('div', { class: 'card-form' });
    var heading = h('h2');
    heading.textContent = 'SAVE BOARD AS TEMPLATE';
    panel.appendChild(heading);

    var hint = h('p', { class: 'form-hint' });
    hint.textContent = 'Saves columns, workflow roles, WIP policy, entry/exit criteria, labels and starter cards — not card activity. Reuse the setup on your next project.';
    panel.appendChild(hint);

    var nameInput = h('input', { type: 'text', maxlength: 60, value: board.name, 'aria-label': 'Template name' });
    panel.appendChild(KB.Modal.fieldBlock('Template name', nameInput));

    var descInput = h('input', { type: 'text', maxlength: 120, 'aria-label': 'Description' });
    panel.appendChild(KB.Modal.fieldBlock('Description (optional)', descInput));

    var cardsCheck = h('label', { class: 'field check' });
    var cardsBox = h('input', { type: 'checkbox', checked: true });
    cardsCheck.appendChild(cardsBox);
    cardsCheck.appendChild(h('span', { textContent: 'Include current cards as starter cards' }));
    panel.appendChild(cardsCheck);

    var actions = h('div', { class: 'modal-actions' });
    var cancelBtn = h('button', { type: 'button', class: 'btn ghost' });
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', close);
    actions.appendChild(cancelBtn);
    actions.appendChild(h('span', { class: 'spacer' }));
    var saveBtn = h('button', { type: 'button', class: 'btn primary' });
    saveBtn.textContent = 'SAVE TEMPLATE';
    saveBtn.addEventListener('click', function () {
      var name = nameInput.value.trim();
      if (!name) {
        KB.UI.toast('Enter a template name', 'error');
        return;
      }
      var payload = KB.Core.Template.snapshotBoard(board, {
        name: name,
        description: descInput.value.trim(),
        includeStarterCards: cardsBox.checked
      });
      var saved = KB.State.saveTemplate(payload);
      if (saved) {
        KB.UI.toast('Template saved', 'success');
        close();
      } else {
        KB.UI.toast('Could not save the template', 'error');
      }
    });
    actions.appendChild(saveBtn);
    panel.appendChild(actions);

    open(panel, opener);
  }

  function templateRow(tpl) {
    var wrap = h('div', { class: 'tpl-row' + (tpl.starred ? ' starred' : '') });
    var info = h('div', { class: 'tpl-info' });
    var name = h('span', { class: 'tpl-name' });
    name.textContent = tpl.name + (tpl.starred ? ' \u2605' : '');
    info.appendChild(name);
    var meta = h('span', { class: 'tpl-meta' });
    meta.textContent = tpl.columns.length + ' COL' + (tpl.columns.length === 1 ? '' : 'S') +
      ' \u00B7 ' + tpl.starterCards.length + ' CARD' + (tpl.starterCards.length === 1 ? '' : 'S');
    info.appendChild(meta);
    if (tpl.description) {
      var desc = h('span', { class: 'tpl-desc' });
      desc.textContent = tpl.description;
      info.appendChild(desc);
    }
    wrap.appendChild(info);
    wrap.appendChild(h('span', { class: 'spacer' }));
    var starBtn = h('button', { type: 'button', class: 'btn icon sm', title: tpl.starred ? 'Unstar' : 'Star' });
    starBtn.textContent = tpl.starred ? '\u2605' : '\u2606';
    starBtn.addEventListener('click', function () {
      KB.State.updateTemplate(tpl.name, { starred: !tpl.starred });
      KB.UI.toast(tpl.starred ? 'Unstarred' : 'Starred', 'success');
      close();
      gallery();
    });
    var applyBtn = h('button', { type: 'button', class: 'btn primary sm' });
    applyBtn.textContent = 'USE';
    applyBtn.title = 'Create a new board from this template';
    applyBtn.addEventListener('click', function () {
      KB.Modal.promptModal('New board from template', 'Board name', tpl.name, function (name) {
        var result = KB.State.applyTemplate(tpl.name, name);
        if (result && result.board) {
          KB.UI.toast('Board created from template', 'success', 'Undo', KB.UI.undoAction);
          close();
          KB.App.refresh();
          KB.Workspaces.set('board');
        } else {
          KB.UI.toast('Could not create the board', 'error');
        }
      });
    });
    var deleteBtn = h('button', { type: 'button', class: 'btn danger-ghost sm', title: 'Delete template' });
    deleteBtn.textContent = 'DEL';
    deleteBtn.addEventListener('click', function () {
      if (!window.confirm('Delete the "' + tpl.name + '" template?')) return;
      KB.State.deleteTemplate(tpl.name);
      KB.UI.toast('Template deleted', 'info', 'Undo', KB.UI.undoAction);
      close();
      gallery();
    });
    wrap.appendChild(starBtn);
    wrap.appendChild(applyBtn);
    wrap.appendChild(deleteBtn);
    return wrap;
  }

  function gallery(opener) {
    var list = KB.State.boardTemplates();
    var panel = h('div', { class: 'card-form' });
    var heading = h('h2');
    heading.textContent = 'CARTRIDGES';
    panel.appendChild(heading);

    var hint = h('p', { class: 'form-hint' });
    hint.textContent = 'Board structure you saved for reuse. Pick one to stamp a fresh board with the same columns, WIP policy, labels and starter cards.';
    panel.appendChild(hint);

    if (list.length === 0) {
      var none = h('p', { class: 'form-hint tpl-none' });
      none.textContent = 'No templates yet. Save the current board\u2019s setup first.';
      panel.appendChild(none);
    } else {
      var rows = h('div', { class: 'tpl-list' });
      list.slice().sort(function (a, b) {
        if (Boolean(b.starred) !== Boolean(a.starred)) return b.starred ? 1 : -1;
        return a.name < b.name ? -1 : 1;
      }).forEach(function (tpl) {
        rows.appendChild(templateRow(tpl));
      });
      panel.appendChild(rows);
    }

    var actions = h('div', { class: 'modal-actions' });
    var cancelBtn = h('button', { type: 'button', class: 'btn ghost' });
    cancelBtn.textContent = 'Close';
    cancelBtn.addEventListener('click', close);
    actions.appendChild(cancelBtn);
    actions.appendChild(h('span', { class: 'spacer' }));
    var saveBtn = h('button', { type: 'button', class: 'btn primary' });
    saveBtn.textContent = 'SAVE CURRENT BOARD\u2026';
    saveBtn.addEventListener('click', function () { saveAsTemplate(opener); });
    actions.appendChild(saveBtn);
    panel.appendChild(actions);

    open(panel, opener);
  }

  KB.Modal.templateGallery = gallery;
  KB.Modal.saveBoardTemplate = saveAsTemplate;
})(window.KB = window.KB || {});
