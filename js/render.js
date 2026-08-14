(function (KB) {
  var h = KB.Dom.h;
  var icon = KB.Dom.icon;
  var fmtDate = KB.Dom.fmtDate;

  /* A column's accent is a SLOT, not a colour. Painting a literal here would
   * write an inline style, which no world's stylesheet could then override —
   * and every world would wear the Atelier's palette. The slot is resolved by
   * `--ramp-0..8` in the active world's token block. */
  var COLUMN_RAMP_SLOTS = 9;

  var PRIORITY_CLASS = { low: 'p-low', medium: 'p-medium', high: 'p-high', urgent: 'p-urgent' };
  var PRIORITY_LABEL = { low: 'LOW', medium: 'MED', high: 'HIGH', urgent: 'URGENT' };
  var SIZE_LABEL = { xs: 'XS', s: 'S', m: 'M', l: 'L', xl: 'XL' };

  function priorityChip(card) {
    if (!card.priority || card.priority === 'none') return null;
    var chip = h('span', { class: 'chip chip-static priority ' + (PRIORITY_CLASS[card.priority] || '') });
    chip.textContent = PRIORITY_LABEL[card.priority] || String(card.priority).toUpperCase();
    chip.title = 'Priority: ' + card.priority;
    return chip;
  }

  function sizeChip(card) {
    if (!card.size || card.size === 'none') return null;
    var chip = h('span', { class: 'chip chip-static size' });
    chip.textContent = SIZE_LABEL[card.size] || card.size.toUpperCase();
    chip.title = 'Size: ' + card.size;
    return chip;
  }

  function effortChip(card) {
    var effort = card.effort;
    if (!effort || ((effort.minutes || 0) === 0 && (effort.pomodoros || 0) === 0)) return null;
    var chip = h('span', { class: 'chip chip-static effort' });
    chip.innerHTML = icon('clock');
    var parts = [];
    if (effort.minutes) parts.push(KB.Core.Focus.formatEffort(effort.minutes));
    if (effort.pomodoros) parts.push(effort.pomodoros + ' pomo');
    chip.appendChild(document.createTextNode(parts.join(' \u00B7 ')));
    chip.title = 'Focus effort: ' + parts.join(', ');
    return chip;
  }

  function columnAccent(id) {
    var sum = 0;
    for (var i = 0; i < id.length; i++) sum = (sum * 31 + id.charCodeAt(i)) >>> 0;
    return sum % COLUMN_RAMP_SLOTS;
  }

  function staticChip(label) {
    var chip = h('span', { class: 'chip chip-static' });
    var dot = h('span', { class: 'dot' });
    dot.style.background = label.color;
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(label.name));
    KB.Dom.paintChip(chip, label.color);
    return chip;
  }

  function assigneeChip(name) {
    var chip = h('span', { class: 'chip chip-static assignee' });
    chip.innerHTML = icon('person');
    chip.appendChild(document.createTextNode(name));
    return chip;
  }

  function mdLite(text) {
    return KB.Core.Markdown.renderMarkdownLite(text);
  }

  function dueChip(card, isDone) {
    if (!card.due) return null;
    var today = KB.Filters.todayISO();
    var chip = h('span', { class: 'chip chip-static due' });
    chip.innerHTML = icon('calendar');
    if (!isDone) {
      var tomorrow = KB.Dom.isoDaysFromNow(1);
      var state = KB.Core.Date.classifyDueDate(card.due, today, tomorrow);
      if (state === 'overdue') chip.classList.add('overdue');
      else if (state === 'soon') chip.classList.add('soon');
    }
    chip.appendChild(document.createTextNode(KB.Dom.fmtShortDate(card.due)));
    chip.title = 'Due ' + KB.Dom.fmtShortDate(card.due);
    return chip;
  }

  function dependencyChip(card) {
    var blockers = card.dependencies && card.dependencies.blockers ? card.dependencies.blockers : [];
    if (blockers.length === 0) return null;
    var board = KB.State.activeBoard();
    if (!board) return null;
    var ref = { boardId: board.id, cardId: card.id };
    var unresolved = KB.Core.Relations.getUnresolvedBlockers(KB.State.data(), ref);
    var chip = h('span', {
      class: 'chip chip-static dep' + (unresolved.length > 0 ? ' dep-blocked' : ' dep-ready'),
      title: unresolved.length > 0
        ? unresolved.length + ' unresolved blocker' + (unresolved.length === 1 ? '' : 's')
        : 'All blockers complete'
    });
    if (unresolved.length > 0) {
      chip.textContent = unresolved.length + ' BLOCKER' + (unresolved.length === 1 ? '' : 'S');
    } else {
      chip.textContent = 'READY';
    }
    return chip;
  }

  function recurrenceChip(card) {
    if (!card.recurrenceId) return null;
    var chip = h('span', { class: 'chip chip-static rec', title: 'Recurring work' });
    chip.textContent = '\u21BB';
    return chip;
  }

  function flowChip(card) {
    var flow = card.flow;
    if (!flow || flow.state === 'normal') return null;
    var days = 0;
    if (flow.since !== null && typeof flow.since === 'number') {
      var dur = KB.Core.Lifecycle.currentFlowDuration(card, Date.now());
      days = Math.floor(dur / 86400000);
    }
    var chip = h('span', { class: 'chip chip-static flow flow-' + flow.state });
    chip.textContent = flow.state.toUpperCase() + (days > 0 ? ' \u00B7 ' + days + 'D' : '');
    chip.title = flow.reason ? flow.state + ': ' + flow.reason : 'Flow state: ' + flow.state;
    return chip;
  }

  function pingChip(card) {
    if (!card.ping || !KB.Core.Ping) return null;
    var status = KB.Core.Ping.pingStatus(card, Date.now());
    var chip = h('span', { class: 'chip chip-static ping' + (status.state === 'overdue' ? ' ping-overdue' : '') });
    chip.innerHTML = icon('clock');
    if (status.state === 'overdue') {
      chip.appendChild(document.createTextNode('PING OVERDUE ' + status.daysOverdue + 'D'));
    } else {
      chip.appendChild(document.createTextNode('PING +' + status.daysUntil + 'D'));
    }
    var contact = card.ping.contact ? 'Waiting on ' + card.ping.contact + ' \u00B7 ' : '';
    chip.title = contact + 'follow up in ' + status.daysUntil + ' day' + (status.daysUntil === 1 ? '' : 's');
    return chip;
  }

  function agingChip(card, isDone) {
    if (isDone || !card.movedAt) return null;
    var days = KB.Core.Date.ageInDays(card.movedAt, Date.now());
    if (days < 1) return null;
    var chip = h('span', { class: 'chip chip-static aging' });
    var risk = sleRisk(card, days);
    if (risk) chip.classList.add(risk);
    chip.innerHTML = icon('clock');
    chip.appendChild(document.createTextNode(days + 'D'));
    var title = 'In this column for ' + days + (days === 1 ? ' day' : ' days');
    if (risk === 'aging-risk') title += ' — beyond SLE';
    else if (risk === 'aging-warning') title += ' — approaching SLE';
    chip.title = title;
    return chip;
  }

  function sleRisk(card, ageDays) {
    var board = KB.State.activeBoard();
    if (!board) return '';
    var sle = KB.Core.Metrics.calculateSle(board);
    if (sle.sleDays === null || sle.sleDays <= 0) return '';
    var ratio = ageDays / sle.sleDays;
    if (ratio >= 1) return 'aging-risk';
    if (ratio >= 0.8) return 'aging-warning';
    if (ratio >= 0.5) return 'aging-visible';
    return '';
  }

  function checklistProgress(card) {
    var items = card.checklist || [];
    if (items.length === 0) return null;
    var done = items.filter(function (item) { return item.done; }).length;
    var wrap = h('div', { class: 'card-prog' });
    var bar = h('div', { class: 'prog' });
    var fill = h('div', { class: 'prog-fill' + (done === items.length ? ' done' : '') });
    fill.style.width = Math.round(done / items.length * 100) + '%';
    bar.appendChild(fill);
    var label = h('span', { class: 'prog-label' });
    label.textContent = done + '/' + items.length;
    wrap.appendChild(bar);
    wrap.appendChild(label);
    return wrap;
  }

  function cardEl(card, column) {
    // Priority is already a chip, but it is also a property of the card itself:
    // a world may want to set the whole card by it (the Lineup bills a card by
    // priority the way a poster bills an act). Exposed as data, not styling.
    var el = h('article', {
      class: 'card' + (column.isDone ? ' done' : ''),
      draggable: 'true',
      'data-id': card.id,
      'data-priority': card.priority || 'none',
      tabindex: '0'
    });
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
      desc.innerHTML = mdLite(card.description);
      el.appendChild(desc);
    }

    var progress = checklistProgress(card);
    if (progress) el.appendChild(progress);

    var meta = h('div', { class: 'card-meta' });
    var pr = priorityChip(card);
    if (pr) meta.appendChild(pr);
    var sz = sizeChip(card);
    if (sz) meta.appendChild(sz);
    var ef = effortChip(card);
    if (ef) meta.appendChild(ef);
    var fl = flowChip(card);
    if (fl) meta.appendChild(fl);
    var pg = pingChip(card);
    if (pg) meta.appendChild(pg);
    var dep = dependencyChip(card, column);
    if (dep) meta.appendChild(dep);
    var rec = recurrenceChip(card);
    if (rec) meta.appendChild(rec);
    // On mobile the meta wall must stay glanceable: at most three label
    // chips, with the rest collapsed into a +N chip (the card editor shows
    // the full set). Desktop renders every label.
    var validLabels = card.labels.map(function (id) { return KB.State.findLabel(id); }).filter(Boolean);
    var mobile = KB.Dom.isMobile();
    var cap = mobile ? 3 : validLabels.length;
    validLabels.slice(0, cap).forEach(function (label) {
      meta.appendChild(staticChip(label));
    });
    if (validLabels.length > cap) {
      var moreLabels = h('span', { class: 'chip chip-static more-labels', title: (validLabels.length - cap) + ' more label(s)' });
      moreLabels.textContent = '+' + (validLabels.length - cap);
      meta.appendChild(moreLabels);
    }
    if (card.assignee) meta.appendChild(assigneeChip(card.assignee));
    var dateChips = KB.Core.When ? KB.Core.When.dueChips(card, KB.Filters.todayISO()) : [];
    dateChips.forEach(function (dc) {
      var chip = h('span', { class: 'chip chip-static ' + dc.class, title: dc.title });
      chip.innerHTML = icon('calendar');
      chip.appendChild(document.createTextNode(dc.text));
      meta.appendChild(chip);
    });
    var aging = agingChip(card, column.isDone);
    if (aging) meta.appendChild(aging);
    el.appendChild(meta);

    var actions = h('div', { class: 'card-actions' });
    var editBtn = h('button', { type: 'button', class: 'btn icon sm', 'data-action': 'edit-card', title: 'Edit card' });
    editBtn.innerHTML = icon('edit');
    var moveBtn = h('button', { type: 'button', class: 'btn icon sm', 'data-action': 'move-card', title: 'Move to…' });
    moveBtn.innerHTML = icon('board');
    var copyBtn = h('button', { type: 'button', class: 'btn icon sm', 'data-action': 'duplicate-card', title: 'Duplicate card' });
    copyBtn.innerHTML = icon('copy');
    var archiveBtn = h('button', { type: 'button', class: 'btn icon sm', 'data-action': 'archive-card', title: 'Archive card' });
    archiveBtn.innerHTML = icon('archive');
    var sheetBtn = h('button', { type: 'button', class: 'btn icon sm', 'data-action': 'card-sheet', title: 'More actions', 'aria-label': 'More card actions' });
    sheetBtn.innerHTML = icon('more');
    actions.appendChild(editBtn);
    actions.appendChild(moveBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(archiveBtn);
    actions.appendChild(sheetBtn);
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

  function quickAddEl(columnId) {
    var row = h('div', { class: 'qa' });
    var input = h('textarea', {
      rows: 1,
      class: 'qa-input',
      placeholder: 'ADD CARD — ENTER',
      maxlength: 2000,
      'aria-label': 'Add card (paste several lines to add many)'
    });
    var tplBtn = h('button', {
      type: 'button',
      class: 'btn icon sm qa-tpl',
      'data-action': 'qa-templates',
      'data-column-id': columnId,
      title: 'New card from a template'
    });
    tplBtn.innerHTML = icon('doc');
    var preview = h('div', { class: 'qa-preview', hidden: true });
    row.appendChild(input);
    row.appendChild(tplBtn);
    row.appendChild(preview);
    return row;
  }

  // Live smart-capture preview chips ("fix bug in 3 days p2 #launch" shows
  // DUE / PRIO / label chips before anything is committed). Returns an array
  // of { class, text, title } or null when nothing was recognized.
  function qaPreviewChips(parsed) {
    var chips = [];
    if (parsed.when) {
      chips.push({
        class: 'qa-when',
        text: 'DO ' + KB.Dom.fmtShortDate(parsed.when),
        title: 'Do date: ' + parsed.when
      });
    }
    if (parsed.due) {
      chips.push({
        class: 'qa-due',
        text: 'DUE ' + KB.Dom.fmtShortDate(parsed.due),
        title: 'Due ' + KB.Dom.fmtShortDate(parsed.due)
      });
    }
    if (parsed.priority) {
      chips.push({
        class: 'qa-prio',
        text: PRIORITY_LABEL[parsed.priority] || parsed.priority.toUpperCase(),
        title: 'Priority: ' + parsed.priority
      });
    }
    parsed.labelIds.forEach(function (id) {
      var label = KB.State.findLabel(id);
      if (label) {
        chips.push({ class: 'qa-label', text: '#' + label.name, title: 'Label: ' + label.name });
      }
    });
    return chips.length > 0 ? chips : null;
  }

  function columnEl(column, filters) {
    // The slot rides the column, not the header, so anything inside the column
    // that speaks the column's colour (the Quarry's ID plate, for one) inherits
    // it. Only .column-header descendants consume --win-bg, so hoisting it here
    // widens inheritance without repainting anything else.
    var el = h('section', {
      class: 'column' + (column.collapsed ? ' collapsed' : ''),
      draggable: 'true',
      'data-id': column.id,
      'data-accent': String(columnAccent(column.id))
    });

    var header = h('header', { class: 'column-header' });
    var grip = h('span', { class: 'col-grip', title: 'Drag to reorder' });
    grip.innerHTML = icon('grip');
    var title = h('h2', { class: 'col-title' });
    title.textContent = column.title;
    var role = column.role || 'queue';
    var roleBadge = h('span', {
      class: 'col-role role-' + role,
      title: 'Column role: ' + role
    });
    roleBadge.textContent = role.toUpperCase();
    var over = column.wipLimit > 0 && column.cards.length > column.wipLimit;
    var count = h('span', {
      class: 'col-count' + (over ? ' over' : ''),
      title: KB.Dom.plural(column.cards.length, 'card') +
        (column.wipLimit > 0 ? ' · WIP limit ' + column.wipLimit : '')
    });
    count.textContent = column.wipLimit > 0 ? column.cards.length + '/' + column.wipLimit : column.cards.length;
    var addBtn = h('button', { type: 'button', class: 'btn icon sm', 'data-action': 'col-add', title: 'Add card' });
    addBtn.innerHTML = icon('plus');
    var menuBtn = h('button', { type: 'button', class: 'btn icon sm', 'data-action': 'col-menu', title: 'Edit column' });
    menuBtn.innerHTML = icon('more');
    var collapseBtn = h('button', {
      type: 'button',
      class: 'btn icon sm',
      'data-action': 'col-collapse',
      title: column.collapsed ? 'Expand column' : 'Collapse column'
    });
    collapseBtn.innerHTML = icon(column.collapsed ? 'chevronUp' : 'chevronDown');
    header.appendChild(grip);
    header.appendChild(title);
    header.appendChild(roleBadge);
    header.appendChild(count);
    header.appendChild(addBtn);
    header.appendChild(menuBtn);
    header.appendChild(collapseBtn);
    el.appendChild(header);

    var list = h('div', { class: 'card-list', 'data-column-id': column.id });
    var visible = column.cards.filter(function (card) {
      return KB.Filters.matches(card, filters);
    });
    if (KB.Filters.sortActive()) {
      visible = visible.slice().sort(KB.Filters.compare);
    }
    if (!column.collapsed) {
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
      list.appendChild(quickAddEl(column.id));
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
    var boardData = KB.State.activeBoard();
    var columns = boardData.columns;

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
    boardPager();

    // Soft nudge: when today's sheet is not stamped, offer the ritual. Lives
    // in board-area (outside #board) so the column flex/scroll layout — and
    // every .column:nth-child() selector — stays untouched.
    var area = KB.el('board-area');
    var oldBanner = area.querySelector('.day-banner');
    if (oldBanner) oldBanner.remove();
    if (KB.Modal.daySheet && !KB.State.daySheetFor(KB.Core.Date.isoDate(new Date()))) {
      var banner = h('div', { class: 'day-banner' });
      var bannerText = h('span');
      bannerText.textContent = 'TODAY IS UNPLANNED';
      var bannerBtn = h('button', { type: 'button', class: 'btn primary sm' });
      bannerBtn.textContent = 'START MY DAY';
      bannerBtn.addEventListener('click', function () { KB.Modal.daySheet(); });
      banner.appendChild(bannerText);
      banner.appendChild(h('span', { class: 'spacer' }));
      banner.appendChild(bannerBtn);
      area.insertBefore(banner, area.firstChild);
    }
  }

  function isMobilePager() {
    return KB.Dom.isMobile();
  }

  function pagerActiveIndex() {
    var boardEl = KB.el('board');
    var columns = boardEl.querySelectorAll('.column');
    if (columns.length === 0) return -1;
    var mid = boardEl.scrollLeft + boardEl.clientWidth / 2;
    var best = 0;
    for (var i = 0; i < columns.length; i++) {
      var left = columns[i].offsetLeft;
      if (left <= mid) best = i;
    }
    return best;
  }

  // Single-column pager for small screens: one column window at a time with
  // prev/next arrows, dots, and a filters toggle. Desktop keeps the full
  // bench and hides the pager.
  function boardPager() {
    var pager = KB.el('board-pager');
    if (!pager) return;
    if (!isMobilePager() || (KB.Workspaces && KB.Workspaces.current() !== 'board')) {
      pager.hidden = true;
      return;
    }
    var boardEl = KB.el('board');
    var columns = boardEl.querySelectorAll('.column');
    pager.hidden = columns.length === 0;

    var dots = KB.el('bp-dots');
    if (dots) dots.innerHTML = '';
    for (var i = 0; i < columns.length; i++) {
      var column = columns[i];
      var dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'bp-dot';
      dot.setAttribute('aria-label', 'Column ' + (i + 1) + ': ' + (column.querySelector('.col-title') ? column.querySelector('.col-title').textContent : ''));
      dot.dataset.index = String(i);
      dot.addEventListener('click', function () {
        scrollToColumn(Number(this.dataset.index));
      });
      dots.appendChild(dot);
    }
    updatePagerState();
  }

  function scrollToColumn(index) {
    var boardEl = KB.el('board');
    var columns = boardEl.querySelectorAll('.column');
    if (index < 0 || index >= columns.length) return;
    boardEl.scrollLeft = columns[index].offsetLeft - boardEl.clientWidth / 2 + columns[index].clientWidth / 2;
    updatePagerState();
  }

  function updatePagerState() {
    var dots = KB.el('bp-dots');
    if (!dots) return;
    var index = pagerActiveIndex();
    var dotsList = dots.querySelectorAll('.bp-dot');
    for (var i = 0; i < dotsList.length; i++) {
      var active = i === index;
      dotsList[i].classList.toggle('active', active);
      if (active) dotsList[i].setAttribute('aria-current', 'true');
      else dotsList[i].removeAttribute('aria-current');
    }
    var prev = KB.el('board-pager') && KB.el('board-pager').querySelector('.bp-prev');
    var next = KB.el('board-pager') && KB.el('board-pager').querySelector('.bp-next');
    if (prev) prev.disabled = index <= 0;
    if (next) next.disabled = index >= dotsList.length - 1;
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
      if (counts.due) parts.push('due: ' + counts.due);
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
      KB.Dom.paintChip(chip, label.color);
      box.appendChild(chip);
    });

    var datalist = KB.el('assignee-list');
    datalist.innerHTML = '';
    KB.State.assignees().forEach(function (name) {
      datalist.appendChild(new Option(name, name));
    });

    // Every filter select follows the same dance: save the current value,
    // repopulate, restore it. options are [value, label] pairs; valueExpr
    // lets a caller override what is considered the "current" value (the
    // sort select falls back to the saved sort mode when empty).
    function rebuildSelect(selectEl, options, valueExpr) {
      var previous = valueExpr ? valueExpr() : selectEl.value;
      selectEl.innerHTML = '';
      options.forEach(function (pair) {
        selectEl.appendChild(new Option(pair[1], pair[0]));
      });
      selectEl.value = previous;
    }

    var select = KB.el('assignee-filter');
    rebuildSelect(select, [['', 'All assignees'], [KB.Filters.UNASSIGNED, 'Unassigned']].concat(KB.State.assignees().map(function (name) { return [name, name]; })));

    var due = KB.el('due-filter');
    rebuildSelect(due, [['', 'Any due date'], ['overdue', 'Overdue'], ['today', 'Due today'], ['week', 'Due this week'], ['none', 'No due date']]);

    var priority = KB.el('priority-filter');
    rebuildSelect(priority, KB.Filters.PRIORITY_OPTIONS);

    var size = KB.el('size-filter');
    rebuildSelect(size, KB.Filters.SIZE_OPTIONS);

    var flow = KB.el('flow-filter');
    rebuildSelect(flow, [['', 'Any flow state'], ['blocked', 'Blocked'], ['waiting', 'Waiting'], ['paused', 'Paused']]);

    var sort = KB.el('sort-select');
    rebuildSelect(sort, KB.Filters.SORT_OPTIONS.map(function (option) { return [option.value, option.label]; }), function () { return sort.value || KB.Filters.sortModeValue(); });

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
    meta.appendChild(metaText(KB.Dom.plural(entry.cards.length, 'card')));
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
    var due = dueChip(card, false);
    if (due) meta.appendChild(due);
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
    var archive = KB.State.activeBoard().archive;

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
    archivePanel: archivePanel,
    boardPager: boardPager,
    updatePagerState: updatePagerState,
    scrollToColumn: scrollToColumn,
    pagerActiveIndex: pagerActiveIndex,
    qaPreviewChips: qaPreviewChips
  };
})(window.KB = window.KB || {});
