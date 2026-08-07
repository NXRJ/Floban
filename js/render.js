(function (KB) {
  var h = KB.Dom.h;
  var icon = KB.Dom.icon;
  var fmtDate = KB.Dom.fmtDate;

  var COLUMN_ACCENTS = ['#c81e14', '#a34800', '#ffd60a', '#a9e020', '#13643c', '#3fd7e0', '#2a58c4', '#6d30d6', '#b11f75'];

  function columnAccent(id) {
    var sum = 0;
    for (var i = 0; i < id.length; i++) sum = (sum * 31 + id.charCodeAt(i)) >>> 0;
    return COLUMN_ACCENTS[sum % COLUMN_ACCENTS.length];
  }

  function paintChip(chip, color) {
    chip.style.background = color;
    chip.style.color = KB.Dom.inkOn(color);
    chip.style.borderColor = 'rgba(0, 0, 0, 0.35)';
  }

  function staticChip(label) {
    var chip = h('span', { class: 'chip chip-static' });
    var dot = h('span', { class: 'dot' });
    dot.style.background = label.color;
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(label.name));
    paintChip(chip, label.color);
    return chip;
  }

  function assigneeChip(name) {
    var chip = h('span', { class: 'chip chip-static assignee' });
    chip.innerHTML = icon('person');
    chip.appendChild(document.createTextNode(name));
    return chip;
  }

  function cardEl(card, column) {
    var el = h('article', { class: 'card' + (column.isDone ? ' done' : ''), draggable: 'true', 'data-id': card.id });

    var top = h('div', { class: 'card-top' });
    var title = h('p', { class: 'card-title' });
    title.textContent = card.title;
    top.appendChild(title);
    if (column.isDone) {
      var check = h('span', { class: 'card-check', title: 'Completed' });
      check.innerHTML = icon('check');
      top.appendChild(check);
    }
    el.appendChild(top);

    if (card.description) {
      var desc = h('p', { class: 'card-desc' });
      desc.textContent = card.description;
      el.appendChild(desc);
    }

    var meta = h('div', { class: 'card-meta' });
    card.labels.forEach(function (id) {
      var label = KB.State.findLabel(id);
      if (label) meta.appendChild(staticChip(label));
    });
    if (card.assignee) meta.appendChild(assigneeChip(card.assignee));
    el.appendChild(meta);

    var actions = h('div', { class: 'card-actions' });
    var editBtn = h('button', { type: 'button', class: 'btn icon sm', 'data-action': 'edit-card', title: 'Edit card' });
    editBtn.innerHTML = icon('edit');
    var archiveBtn = h('button', { type: 'button', class: 'btn icon sm', 'data-action': 'archive-card', title: 'Archive card' });
    archiveBtn.innerHTML = icon('archive');
    actions.appendChild(editBtn);
    actions.appendChild(archiveBtn);
    el.appendChild(actions);

    return el;
  }

  function emptyHint(primary, sub) {
    var wrap = h('div', { class: 'list-empty' });
    var p = h('p');
    p.textContent = primary;
    wrap.appendChild(p);
    if (sub) {
      var s = h('p', { class: 'sub' });
      s.textContent = sub;
      wrap.appendChild(s);
    }
    return wrap;
  }

  function columnEl(column, filters) {
    var el = h('section', { class: 'column', draggable: 'true', 'data-id': column.id });

    var header = h('header', { class: 'column-header' });
    var accent = columnAccent(column.id);
    header.style.setProperty('--win-bg', accent);
    header.style.setProperty('--win-ink', KB.Dom.inkOn(accent));
    var grip = h('span', { class: 'col-grip', title: 'Drag to reorder' });
    grip.innerHTML = icon('grip');
    var title = h('h2', { class: 'col-title' });
    title.textContent = column.title;
    var count = h('span', {
      class: 'col-count',
      title: column.cards.length + (column.cards.length === 1 ? ' card' : ' cards')
    });
    count.textContent = column.cards.length;
    var addBtn = h('button', { type: 'button', class: 'btn icon sm', 'data-action': 'col-add', title: 'Add card' });
    addBtn.innerHTML = icon('plus');
    var menuBtn = h('button', { type: 'button', class: 'btn icon sm', 'data-action': 'col-menu', title: 'Edit column' });
    menuBtn.innerHTML = icon('more');
    header.appendChild(grip);
    header.appendChild(title);
    header.appendChild(count);
    header.appendChild(addBtn);
    header.appendChild(menuBtn);
    el.appendChild(header);

    var list = h('div', { class: 'card-list', 'data-column-id': column.id });
    var visible = column.cards.filter(function (card) {
      return KB.Filters.matches(card, filters);
    });
    if (column.cards.length === 0) {
      var empty = emptyHint('No cards yet', 'Drop cards here or add one.');
      var addEmpty = h('button', { type: 'button', class: 'btn ghost sm', 'data-action': 'col-add' });
      addEmpty.innerHTML = icon('plus');
      addEmpty.appendChild(document.createTextNode(' Add card'));
      empty.appendChild(addEmpty);
      list.appendChild(empty);
    } else if (visible.length === 0) {
      list.appendChild(emptyHint('No cards match your filters.'));
    } else {
      visible.forEach(function (card) {
        list.appendChild(cardEl(card, column));
      });
    }
    el.appendChild(list);

    return el;
  }

  function emptyBoardEl() {
    var wrap = h('div', { class: 'empty-board' });
    var iconWrap = h('div', { class: 'empty-board-icon' });
    iconWrap.innerHTML = icon('board');
    var title = h('h2');
    title.textContent = 'Your board is empty';
    var sub = h('p');
    sub.textContent = 'Create a column to start organising your tasks.';
    var btn = h('button', { type: 'button', class: 'btn primary', 'data-action': 'add-column-empty' });
    btn.textContent = 'Add your first column';
    wrap.appendChild(iconWrap);
    wrap.appendChild(title);
    wrap.appendChild(sub);
    wrap.appendChild(btn);
    return wrap;
  }

  function board() {
    var el = KB.el('board');
    el.innerHTML = '';
    var filters = KB.Filters.read();
    var columns = KB.State.data().columns;

    if (columns.length === 0) {
      el.appendChild(emptyBoardEl());
      setNoResults(false);
      return;
    }

    var visibleCount = 0;
    columns.forEach(function (column) {
      visibleCount += column.cards.filter(function (card) {
        return KB.Filters.matches(card, filters);
      }).length;
    });
    setNoResults(visibleCount === 0 && KB.Filters.active(filters));

    columns.forEach(function (column) {
      el.appendChild(columnEl(column, filters));
    });
  }

  function setNoResults(show) {
    var banner = KB.el('no-results');
    banner.hidden = !show;
    if (show) {
      var text = KB.el('no-results').querySelector('.no-results-text');
      var counts = KB.Filters.read();
      var parts = [];
      if (counts.search) parts.push('search "' + counts.search + '"');
      if (counts.labels.size > 0) parts.push('the selected labels');
      if (counts.assignee) parts.push(counts.assignee === KB.Filters.UNASSIGNED ? 'unassigned' : 'assignee "' + counts.assignee + '"');
      text.textContent = 'No cards match ' + parts.join(' and ') + '.';
    }
  }

  function filterBar() {
    var filters = KB.Filters.read();

    var box = KB.el('label-filters');
    box.innerHTML = '';
    KB.State.labels().forEach(function (label) {
      var chip = h('button', {
        type: 'button',
        class: 'chip' + (filters.labels.has(label.id) ? ' active' : ''),
        'data-label-id': label.id,
        title: 'Filter by ' + label.name
      });
      var dot = h('span', { class: 'dot' });
      dot.style.background = label.color;
      chip.appendChild(dot);
      chip.appendChild(document.createTextNode(label.name));
      paintChip(chip, label.color);
      box.appendChild(chip);
    });

    var datalist = KB.el('assignee-list');
    datalist.innerHTML = '';
    KB.State.assignees().forEach(function (name) {
      datalist.appendChild(new Option(name, name));
    });

    var select = KB.el('assignee-filter');
    var previous = select.value;
    select.innerHTML = '';
    select.appendChild(new Option('All assignees', ''));
    select.appendChild(new Option('Unassigned', KB.Filters.UNASSIGNED));
    KB.State.assignees().forEach(function (name) {
      select.appendChild(new Option(name, name));
    });
    select.value = previous;

    KB.el('clear-filters').classList.toggle('show', KB.Filters.active(filters));
  }

  function metaText(text) {
    var span = h('span', { class: 'meta-text' });
    span.textContent = text;
    return span;
  }

  function actionButton(action, id, label, className) {
    var btn = h('button', { type: 'button', class: 'btn ' + className, 'data-action': action, 'data-id': id });
    btn.textContent = label;
    return btn;
  }

  function archiveColumnItem(entry) {
    var meta = h('div', { class: 'archive-item-meta' });
    meta.appendChild(metaText(entry.cards.length + (entry.cards.length === 1 ? ' card' : ' cards')));
    meta.appendChild(metaText('archived ' + fmtDate(entry.archivedAt)));
    var actions = h('div', { class: 'archive-item-actions' });
    actions.appendChild(actionButton('restore-column', entry.id, 'Restore', 'ghost sm'));
    actions.appendChild(actionButton('purge-column', entry.id, 'Delete forever', 'danger-ghost sm'));

    var item = h('div', { class: 'archive-item' });
    var title = h('p', { class: 'archive-item-title' });
    title.textContent = entry.title;
    item.appendChild(title);
    item.appendChild(meta);
    item.appendChild(actions);
    return item;
  }

  function archiveCardItem(card) {
    var meta = h('div', { class: 'archive-item-meta' });
    if (card.fromColumn) meta.appendChild(metaText('from "' + card.fromColumn + '"'));
    meta.appendChild(metaText('archived ' + fmtDate(card.archivedAt)));
    card.labels.forEach(function (id) {
      var label = KB.State.findLabel(id);
      if (label) meta.appendChild(staticChip(label));
    });
    if (card.assignee) meta.appendChild(assigneeChip(card.assignee));
    var actions = h('div', { class: 'archive-item-actions' });
    actions.appendChild(actionButton('restore-card', card.id, 'Restore', 'ghost sm'));
    actions.appendChild(actionButton('purge-card', card.id, 'Delete forever', 'danger-ghost sm'));

    var item = h('div', { class: 'archive-item' });
    var title = h('p', { class: 'archive-item-title' });
    title.textContent = card.title;
    item.appendChild(title);
    item.appendChild(meta);
    item.appendChild(actions);
    return item;
  }

  function sectionTitle(text) {
    var el = h('h3', { class: 'archive-section-title' });
    el.textContent = text;
    return el;
  }

  function archivePanel() {
    var panel = KB.el('archive-panel');
    panel.innerHTML = '';
    var archive = KB.State.data().archive;

    var head = h('div', { class: 'archive-head' });
    var title = h('h2', { class: 'archive-title' });
    title.textContent = 'Archive';
    var closeBtn = h('button', { type: 'button', class: 'btn icon sm', 'data-action': 'close-archive', title: 'Close archive' });
    closeBtn.innerHTML = icon('x');
    head.appendChild(title);
    head.appendChild(h('span', { class: 'header-spacer' }));
    head.appendChild(closeBtn);
    panel.appendChild(head);

    var body = h('div', { class: 'archive-body' });
    if (archive.columns.length === 0 && archive.cards.length === 0) {
      var empty = h('div', { class: 'archive-empty' });
      var p1 = h('p');
      p1.textContent = 'Nothing here yet.';
      var p2 = h('p');
      p2.textContent = 'Archived cards and columns end up here, where you can restore them.';
      empty.appendChild(p1);
      empty.appendChild(p2);
      body.appendChild(empty);
    } else {
      if (archive.columns.length > 0) {
        body.appendChild(sectionTitle('Columns'));
        archive.columns.forEach(function (entry) {
          body.appendChild(archiveColumnItem(entry));
        });
      }
      if (archive.cards.length > 0) {
        body.appendChild(sectionTitle('Cards'));
        archive.cards.forEach(function (card) {
          body.appendChild(archiveCardItem(card));
        });
      }
    }
    panel.appendChild(body);
  }

  KB.Render = {
    board: board,
    filterBar: filterBar,
    archivePanel: archivePanel
  };
})(window.KB = window.KB || {});

