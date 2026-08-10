(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.When = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function () {
    // WHEN/DEADLINE: the dual-date model. `card.due` stays the hard deadline
    // (drives overdue chips, review ranking, lifecycle). `card.when` is the
    // optional "do date" — when you plan to BEGIN working on it. Cards
    // without `when` behave exactly as before (zero regression); cards with
    // `when` get planned on their do-date while the deadline stays the
    // commitment. Pure, deterministic, injected clock.

    var ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

    // The effective planning date: `when` if set, else `due`, else null.
    function planDay(card) {
      if (!card) return null;
      if (typeof card.when === 'string' && ISO_RE.test(card.when)) return card.when;
      if (typeof card.due === 'string' && ISO_RE.test(card.due)) return card.due;
      return null;
    }

    // Scheduling classification for the pick bands:
    //   'future' — has a `when` strictly after today (not yet actionable)
    //   'today'  — `when` is today, OR (no when and due is today)
    //   'active' — no when; due is past or absent (actionable now)
    //   null     — done/archived/blocked (never scheduled)
    function classifyWhen(card, todayISO) {
      if (!card) return null;
      if (card.completedAt || card.archivedAt) return null;
      var when = typeof card.when === 'string' && ISO_RE.test(card.when) ? card.when : null;
      var due = typeof card.due === 'string' && ISO_RE.test(card.due) ? card.due : null;
      if (when) {
        if (when > todayISO) return 'future';
        return 'today';
      }
      if (due) {
        if (due <= todayISO) return 'active';
        return 'future';
      }
      return 'active';
    }

    // Chips for the card render: "DO 08-14" + "DUE 08-20".
    // Returns [{ class, text, title }] in display order.
    function dueChips(card, todayISO) {
      if (!card) return [];
      var chips = [];
      var when = typeof card.when === 'string' && ISO_RE.test(card.when) ? card.when : null;
      var due = typeof card.due === 'string' && ISO_RE.test(card.due) ? card.due : null;
      if (when) {
        var whenClass = 'when' + (when === todayISO ? ' when-today' : (when < todayISO ? ' when-past' : ''));
        chips.push({ class: whenClass, text: 'DO ' + shortISO(when), title: 'Do date — plan to begin work on ' + when });
      }
      if (due) {
        var dueClass = 'due' + (due < todayISO ? ' overdue' : (due === todayISO ? ' today' : ''));
        chips.push({ class: dueClass, text: 'DUE ' + shortISO(due), title: 'Deadline — must finish by ' + due });
      }
      return chips;
    }

    function shortISO(isoString) {
      var parts = isoString.split('-');
      if (parts.length !== 3) return isoString;
      return parts[1] + '-' + parts[2];
    }

    return {
      planDay: planDay,
      classifyWhen: classifyWhen,
      dueChips: dueChips,
      shortISO: shortISO
    };
  }
);
