(function (KB) {
  var h = KB.Dom.h;

  // HI-SCORE scoreboard: a completion-streak readout in the header plus an
  // arcade-style overlay. The streak itself is a pure projection of card
  // completedAt timestamps (js/core/streak.js); this module only renders,
  // celebrates milestone crossings, and persists the observation via
  // KB.State.observeStreak (which never pushes undo history — the streak is
  // derived data, so Ctrl+Z over a completion must not un-write a record).

  function snapshot() {
    return KB.State.streakSnapshot();
  }

  // One-time celebration: fire only when the streak increased on a live
  // chain (lastSeen is today or yesterday) — never replay an old crossing
  // after a long absence, and never shame a reset.
  function celebrate(info) {
    var stored = (KB.State.data() && KB.State.data().streaks) || { best: 0, lastSeen: null };
    var lastSeen = stored.lastSeen;
    if (!lastSeen) return;
    var todayISO = KB.Core.Date.isoDate(new Date());
    var yesterdayISO = KB.Core.Date.addDaysISO(new Date(), -1);
    if (lastSeen.dayISO !== todayISO && lastSeen.dayISO !== yesterdayISO) return;
    var hit = KB.Core.Streak.crossed(lastSeen.streak, info.current);
    if (hit) {
      KB.UI.toast(hit + '-DAY STREAK!', 'success');
    }
  }

  function readoutEl() {
    var info = snapshot();
    var btn = KB.el('streak-readout');
    if (!btn) return;
    btn.innerHTML = '';
    var label = h('span', { class: 'sr-label' });
    label.textContent = 'HI-SCORE';
    btn.appendChild(label);
    var value = h('span', { class: 'sr-value' });
    value.textContent = info.current + (info.best > info.current ? ' / ' + info.best : '');
    btn.appendChild(value);
    var strip = h('span', { class: 'sr-strip', 'aria-hidden': 'true' });
    info.week.forEach(function (done) {
      var dot = h('i', { class: 'sr-dot' + (done ? ' on' : '') });
      strip.appendChild(dot);
    });
    btn.appendChild(strip);
    btn.title = 'Completion streak \u2014 current ' + info.current +
      ', best ' + info.best + '. Click for the scoreboard (H).';
    btn.classList.toggle('live', info.current > 0);
    btn.classList.toggle('at-milestone', KB.Core.Streak.milestoneFor(info.current) === info.current);
  }

  function weekStrip(week) {
    var strip = h('div', { class: 'sb-week', role: 'img', 'aria-label': 'Last 7 days' });
    week.forEach(function (done) {
      var cell = h('span', { class: 'sb-day' + (done ? ' on' : '') });
      cell.textContent = done ? '\u2588' : '\u00B7';
      strip.appendChild(cell);
    });
    return strip;
  }

  function overlayContent() {
    var info = snapshot();
    var stored = (KB.State.data() && KB.State.data().streaks) || { best: 0, lastSeen: null };
    var content = h('div', { class: 'sb-content' });

    var title = h('div', { class: 'sb-title' });
    title.textContent = 'HI-SCORE';
    content.appendChild(title);

    var current = h('div', { class: 'sb-current' + (info.current === 0 ? ' zero' : '') });
    var currentLabel = h('span', { class: 'sb-current-label' });
    currentLabel.textContent = info.current === 0 ? 'GAME OVER' : (info.current + '-DAY STREAK');
    current.appendChild(currentLabel);
    var digits = h('span', { class: 'sb-digits' });
    digits.textContent = String(info.current).padStart(2, '0');
    current.appendChild(digits);
    content.appendChild(current);

    var best = h('div', { class: 'sb-best' });
    best.textContent = 'BEST ' + String(Math.max(info.best, stored.best)).padStart(3, '0');
    content.appendChild(best);

    if (info.current > 0) {
      content.appendChild(weekStrip(info.week));
      var goal = h('div', { class: 'sb-goal' });
      goal.textContent = 'GOAL \u2265 ' + info.goal + ' CARD' + (info.goal === 1 ? '' : 'S') + ' / DAY';
      content.appendChild(goal);
    } else {
      var over = h('div', { class: 'sb-over' });
      over.textContent = 'NO CARD COMPLETED YESTERDAY. COMPLETE ONE TODAY TO LIGHT THE MACHINE AGAIN.';
      content.appendChild(over);
    }

    var milestones = h('div', { class: 'sb-milestones' });
    KB.Core.Streak.MILESTONES.forEach(function (m) {
      var reached = info.best >= m || stored.best >= m;
      var chip = h('span', { class: 'sb-milestone' + (reached ? ' reached' : '') });
      chip.textContent = (reached ? '\u2605 ' : '\u00B7 ') + m;
      chip.title = reached ? 'Reached at ' + m + ' days' : 'Next milestone: ' + m;
      milestones.appendChild(chip);
    });
    content.appendChild(milestones);

    var hint = h('p', { class: 'sb-hint' });
    hint.textContent = 'A day counts when at least one card is completed. Streaks are local to this machine.';
    content.appendChild(hint);

    var closeBtn = h('button', { type: 'button', class: 'btn primary', 'data-sb': 'close' });
    closeBtn.textContent = 'CLOSE (ESC)';
    content.appendChild(closeBtn);

    closeBtn.addEventListener('click', function () { KB.Modal.close(); });
    return content;
  }

  function open() {
    KB.Modal.open(overlayContent(), document.getElementById('streak-readout'), null);
    var panel = document.querySelector('.modal-panel');
    if (panel) panel.classList.add('scoreboard');
  }

  function sync() {
    if (!KB.State || !KB.State.data()) return;
    readoutEl();
    celebrate(snapshot());
    KB.State.observeStreak(snapshot());
  }

  KB.Scoreboard = {
    sync: sync,
    open: open
  };
})(window.KB = window.KB || {});
