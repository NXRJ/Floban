(function (root, factory) {
  var dateCore = (typeof module === 'object' && module.exports)
    ? require('./date.js')
    : root.KB.Core.Date;
  var api = factory(dateCore);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.DayPlan = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function (DateCore) {
    // Day Sheet: a bounded daily-planning ritual. Pure, deterministic core —
    // time and the review ranking are injected, nothing is mutated, no IDs
    // are generated. The user decides; this module only bounds, ranks and
    // persists the decision.
    //
    // A plan is a per-day record:
    //   { dateISO, stampedAt, rolledAt, commitments: [{ cardId, order, status }] }
    // status: 'open' (active), 'done' (completed via the sheet), 'kept'
    // (carried to the next day), 'pushed' (due +1d), 'dropped' (due cleared),
    // 'archived' (archived).

    var STATUSES = ['open', 'done', 'kept', 'pushed', 'dropped', 'archived'];
    var ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
    var PRIORITY_WEIGHT = { urgent: 4, high: 3, medium: 2, low: 1, none: 0 };

    function dayStart(ms) {
      var d = new Date(ms);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    function parseISO(iso) {
      var m = ISO_RE.exec(iso || '');
      if (!m) return null;
      var y = Number(iso.slice(0, 4));
      var mo = Number(iso.slice(5, 7));
      var d = Number(iso.slice(8, 10));
      var date = new Date(y, mo - 1, d);
      return DateCore.isoDate(date) === iso ? date : null;
    }

    function daysBetween(fromISO, toISO) {
      var a = parseISO(fromISO);
      var b = parseISO(toISO);
      if (!a || !b) return null;
      return Math.round((b.getTime() - a.getTime()) / 86400000);
    }

    function cardKey(card) { return card.boardId + ':' + card.cardId; }

    // ---- Plan accessors -----------------------------------------------------

    function sheetFor(dayplans, dayISO) {
      if (!dayplans || typeof dayplans !== 'object') return null;
      var plan = dayplans[dayISO];
      if (!isValidPlan(plan)) return null;
      return plan.dateISO === dayISO ? plan : null;
    }

    // Most recent plan strictly before dayISO (carry-over source).
    function latestPriorPlan(dayplans, dayISO) {
      if (!dayplans || typeof dayplans !== 'object') return null;
      var best = null;
      Object.keys(dayplans).forEach(function (key) {
        if (!ISO_RE.test(key)) return;
        if (key >= dayISO) return;
        if (!best || key > best) best = key;
      });
      return best ? sheetFor(dayplans, best) : null;
    }

    function isValidPlan(plan) {
      return Boolean(plan && typeof plan === 'object' &&
        typeof plan.dateISO === 'string' && ISO_RE.test(plan.dateISO) &&
        Array.isArray(plan.commitments));
    }

    // ---- Candidate ranking --------------------------------------------------
    //
    // opts: {
    //   now, dayISO, slots,
    //   cards: [{ boardId, columnId, cardId, title, due, priority, completedAt,
    //            flowState, flowSince }],
    //   review: [{ boardId, cardId }]  // ranked Review queue (filler tail)
    // }
    // Returns rows [{ cardId, boardId, columnId, title, reason }], capped at
    // slots + 6 rows. Reasons: CARRIED OVER / OVERDUE Nd / DUE TODAY [P1] /
    // REVIEW.

    function buildCandidates(opts) {
      var now = typeof opts.now === 'number' ? opts.now : Date.now();
      var dayISO = opts.dayISO || DateCore.isoDate(dayStart(now));
      var slots = typeof opts.slots === 'number' ? opts.slots : 3;
      var cap = slots + 6;
      var rows = [];
      var seen = {};
      function add(row) {
        var key = row.boardId + ':' + row.cardId;
        if (seen[key]) return;
        seen[key] = true;
        rows.push(row);
      }

      var cards = (opts.cards || []).filter(function (c) {
        return c && !c.completedAt;
      });
      var byKey = {};
      var byId = {};
      cards.forEach(function (c) {
        byKey[cardKey(c)] = c;
        byId[c.cardId] = c;
      });

      // 1. Carry-overs: yesterday's (latest prior) sheet, entries the user
      //    kept or never rolled. Cards that since got completed or archived
      //    are dropped.
      var prior = latestPriorPlan(opts.dayplans || {}, dayISO);
      if (prior) {
        prior.commitments.slice().sort(function (a, b) { return a.order - b.order; })
          .forEach(function (entry) {
            if (entry.status !== 'kept' && entry.status !== 'open') return;
            var card = byId[entry.cardId];
            if (!card) return;
            add({ cardId: card.cardId, boardId: card.boardId, columnId: card.columnId, title: card.title, reason: 'CARRIED OVER' });
          });
      }

      // 2. Overdue, oldest first. A card with a `when` in the past is due to
      //    be STARTED — still overdue pressure, but deadline-grounded cards
      //    (due past, no when) rank by the harder commitment first.
      cards.filter(function (c) {
        return c.due && ISO_RE.test(c.due) && c.due < dayISO;
      }).sort(function (a, b) {
        return a.due < b.due ? -1 : a.due > b.due ? 1 : (a.cardId < b.cardId ? -1 : 1);
      }).forEach(function (c) {
        var age = daysBetween(c.due, dayISO);
        add({ cardId: c.cardId, boardId: c.boardId, columnId: c.columnId, title: c.title, reason: 'OVERDUE ' + (age === null ? '?' : age) + 'D' });
      });

      // 3. Due today — but a card whose DO-date is today (when === dayISO)
      //    ranks above one whose deadline merely lands today: the do-date is
      //    the "time to start" signal.
      var reviewIndex = {};
      (opts.review || []).forEach(function (r, i) {
        if (r && r.boardId && r.cardId) reviewIndex[cardKey(r)] = i;
      });
      cards.filter(function (c) { return c.due === dayISO || c.when === dayISO; })
        .sort(function (a, b) {
          var aw = a.when === dayISO ? 1 : 0;
          var bw = b.when === dayISO ? 1 : 0;
          if (bw !== aw) return bw - aw;
          var pa = PRIORITY_WEIGHT[a.priority] || 0;
          var pb = PRIORITY_WEIGHT[b.priority] || 0;
          if (pb !== pa) return pb - pa;
          var ra = reviewIndex[cardKey(a)];
          var rb = reviewIndex[cardKey(b)];
          if (ra !== undefined && rb !== undefined && ra !== rb) return ra - rb;
          return a.cardId < b.cardId ? -1 : 1;
        })
        .forEach(function (c) {
          add({
            cardId: c.cardId, boardId: c.boardId, columnId: c.columnId, title: c.title,
            reason: c.when === dayISO ? 'DO TODAY' : 'DUE TODAY' + (c.priority && c.priority !== 'none' ? ' ' + c.priority.toUpperCase() : '')
          });
        });

      // 4. Filler: the top of the Review queue that is not already shown.
      (opts.review || []).forEach(function (r) {
        if (rows.length >= cap) return;
        var card = byKey[cardKey(r)];
        if (!card) return;
        add({ cardId: card.cardId, boardId: card.boardId, columnId: card.columnId, title: card.title, reason: 'REVIEW' });
      });

      return rows.slice(0, cap);
    }

    // ---- Stamping -----------------------------------------------------------

    // cardIds: picked candidate keys in the user's chosen order.
    function stampDay(dayISO, cardIds, now, slots) {
      var list = Array.isArray(cardIds) ? cardIds : [];
      var limit = typeof slots === 'number' ? slots : 3;
      if (list.length > limit) list = list.slice(0, limit);
      var seen = {};
      var commitments = [];
      list.forEach(function (cardId) {
        if (typeof cardId !== 'string' || !cardId || seen[cardId]) return;
        seen[cardId] = true;
        commitments.push({ cardId: cardId, order: commitments.length, status: 'open' });
      });
      return {
        dateISO: dayISO,
        stampedAt: typeof now === 'number' ? now : Date.now(),
        rolledAt: null,
        commitments: commitments
      };
    }

    // ---- Rolling ------------------------------------------------------------

    // actions: [{ cardId, kind }], kind in keep|push|drop|archive. Pure: the
    // ops list is applied by the caller in ONE state transaction (one undo
    // entry). push advances the card's due date by one day (month/year
    // rollover safe); a card without a due date is pushed to tomorrow.
    // Returns { plan, ops } where ops = [{ type, boardId, columnId, cardId, due? }].
    function rollPlan(plan, actions, cards, now) {
      var byId = {};
      (cards || []).forEach(function (c) { byId[c.cardId] = c; });
      var byAction = {};
      (actions || []).forEach(function (a) {
        if (a && a.cardId && a.kind) byAction[a.cardId] = a.kind;
      });

      var ops = [];
      var commitments = (plan.commitments || []).map(function (entry) {
        if (entry.status !== 'open') return entry;
        var card = byId[entry.cardId];
        if (card && card.completedAt) {
          // Completed elsewhere (board move, sheet checkbox, recurrence) —
          // exit the roll as done, never reschedule or archive finished work.
          return { cardId: entry.cardId, order: entry.order, status: 'done' };
        }
        var kind = byAction[entry.cardId] || 'keep'; // unstamped rows default to keep
        var next = { cardId: entry.cardId, order: entry.order, status: entry.status };
        switch (kind) {
          case 'push':
            next.status = 'pushed';
            if (card) {
              var base = card.due && ISO_RE.test(card.due) ? parseISO(card.due) : dayStart(now);
              var pushed = new Date(base.getTime() + 86400000);
              ops.push({
                type: 'due', boardId: card.boardId, columnId: card.columnId, cardId: card.cardId,
                due: DateCore.isoDate(pushed)
              });
            }
            break;
          case 'drop':
            next.status = 'dropped';
            if (card) {
              ops.push({ type: 'due', boardId: card.boardId, columnId: card.columnId, cardId: card.cardId, due: '' });
            }
            break;
          case 'archive':
            next.status = 'archived';
            if (card) {
              ops.push({ type: 'archive', boardId: card.boardId, columnId: card.columnId, cardId: card.cardId });
            }
            break;
          default:
            next.status = 'kept';
            break;
        }
        return next;
      });

      return {
        plan: {
          dateISO: plan.dateISO,
          stampedAt: plan.stampedAt,
          rolledAt: typeof now === 'number' ? now : Date.now(),
          commitments: commitments
        },
        ops: ops
      };
    }

    return {
      buildCandidates: buildCandidates,
      stampDay: stampDay,
      rollPlan: rollPlan,
      sheetFor: sheetFor,
      latestPriorPlan: latestPriorPlan,
      STATUSES: STATUSES
    };
  }
);
