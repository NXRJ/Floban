(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Ping = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function () {
    // PING: an active follow-up engine on the waiting flow state. When a
    // card is waiting, PING arms it with a follow-up date, a poke log and
    // an escalation cadence; overdue pings surface in the PING workspace,
    // Review, and CHECKPOINT. Pure, deterministic, injected clock — no
    // notifications infrastructure, works from file://.
    //
    // card.ping = {
    //   contact, followUpAt (ms), cadenceDays,
    //   lastPokedAt (ms|null), pokedCount, log: [{ at, note }]
    // }

    var PING_DEFAULTS = { cadenceDays: 3, escalateAfter: 2, maxEscalation: 4, logLimit: 20 };
    var MS_PER_DAY = 86400000;

    function escalationForCount(ping, count) {
      var escalateAfter = typeof ping.escalateAfter === 'number' ? ping.escalateAfter : PING_DEFAULTS.escalateAfter;
      if (escalateAfter <= 0) return 0; // fixed cadence opt-out
      var maxEscalation = typeof ping.maxEscalation === 'number' ? ping.maxEscalation : PING_DEFAULTS.maxEscalation;
      return Math.min(maxEscalation, Math.max(0, count - escalateAfter));
    }

    function escalationLevel(card) {
      var ping = card && card.ping;
      if (!ping) return 0;
      return escalationForCount(ping, ping.pokedCount || 0);
    }

    function nextFollowUp(fromMs, cadenceDays, escalation) {
      var days = (typeof cadenceDays === 'number' && cadenceDays >= 1 ? cadenceDays : PING_DEFAULTS.cadenceDays);
      var level = typeof escalation === 'number' ? escalation : 0;
      return fromMs + days * (1 + level) * MS_PER_DAY;
    }

    // Arm a waiting card with a follow-up date. Pure: returns a card copy.
    function armPing(card, opts, now) {
      if (!card || card.flow.state !== 'waiting') {
        return { changed: false, card: card, reason: 'not-waiting' };
      }
      var options = opts || {};
      var at = typeof options.followUpAt === 'number' ? options.followUpAt : nextFollowUp(now, options.cadenceDays, 0);
      var out = Object.assign({}, card, {
        ping: {
          contact: typeof options.contact === 'string' ? options.contact : (card.assignee || ''),
          followUpAt: at,
          cadenceDays: typeof options.cadenceDays === 'number' && options.cadenceDays >= 1 ? options.cadenceDays : PING_DEFAULTS.cadenceDays,
          escalateAfter: typeof options.escalateAfter === 'number' ? options.escalateAfter : PING_DEFAULTS.escalateAfter,
          maxEscalation: typeof options.maxEscalation === 'number' ? options.maxEscalation : PING_DEFAULTS.maxEscalation,
          logLimit: typeof options.logLimit === 'number' && options.logLimit >= 1 ? options.logLimit : PING_DEFAULTS.logLimit,
          lastPokedAt: null,
          pokedCount: 0,
          log: []
        }
      });
      return { changed: true, card: out };
    }

    // Disarm: clear the ping (used when a card leaves waiting).
    function disarmPing(card) {
      if (!card || !card.ping) return { changed: false, card: card };
      var out = Object.assign({}, card);
      delete out.ping;
      return { changed: true, card: out };
    }

    // Poke: record the follow-up and roll the next date. The escalation
    // level reflects the count INCLUDING this poke. Pure.
    function poke(card, now, note) {
      if (!card || !card.ping) return { changed: false, card: card, reason: 'not-armed' };
      var ping = card.ping;
      var newCount = (ping.pokedCount || 0) + 1;
      var level = escalationForCount(ping, newCount);
      var logLimit = typeof ping.logLimit === 'number' ? ping.logLimit : PING_DEFAULTS.logLimit;
      var log = (ping.log || []).slice();
      log.push({ at: now, note: typeof note === 'string' ? note : '' });
      if (log.length > logLimit) {
        log.splice(0, log.length - logLimit);
      }
      var out = Object.assign({}, card, {
        ping: Object.assign({}, ping, {
          lastPokedAt: now,
          pokedCount: newCount,
          followUpAt: nextFollowUp(now, ping.cadenceDays, level),
          log: log
        })
      });
      return { changed: true, card: out };
    }

    // { armed, state: 'fresh'|'due'|'overdue', daysUntil, daysOverdue, escalation }
    function pingStatus(card, now) {
      if (!card || !card.ping) return { armed: false, state: 'fresh', daysUntil: null, daysOverdue: null, escalation: 0 };
      var diff = card.ping.followUpAt - now;
      if (diff <= -MS_PER_DAY) {
        // Beyond the 1-day due window: overdue.
        return {
          armed: true,
          state: 'overdue',
          daysUntil: null,
          daysOverdue: Math.ceil(-diff / MS_PER_DAY),
          escalation: escalationLevel(card)
        };
      }
      if (diff <= 0) {
        // Inside [followUpAt, followUpAt + 1d): due.
        return { armed: true, state: 'due', daysUntil: 0, daysOverdue: null, escalation: escalationLevel(card) };
      }
      return { armed: true, state: 'fresh', daysUntil: Math.ceil(diff / MS_PER_DAY), daysOverdue: null, escalation: escalationLevel(card) };
    }

    // Armed waiting cards past their follow-up date, soonest first.
    function duePings(cards, now) {
      return (cards || []).filter(function (card) {
        return card && card.ping && card.flow && card.flow.state === 'waiting' && card.ping.followUpAt <= now;
      }).sort(function (a, b) {
        return a.ping.followUpAt - b.ping.followUpAt;
      });
    }

    // Group by contact; order groups by worst staleness (oldest followUpAt).
    function byContact(cards, now) {
      var groups = {};
      (cards || []).forEach(function (card) {
        if (!card || !card.ping) return;
        var contact = card.ping.contact || '(no contact)';
        if (!groups[contact]) groups[contact] = [];
        groups[contact].push({
          cardId: card.id,
          title: card.title || '',
          status: pingStatus(card, now)
        });
      });
      return Object.keys(groups).map(function (contact) {
        var items = groups[contact];
        var worst = items.reduce(function (acc, item) {
          var od = item.status.daysOverdue;
          return od !== null && (acc === null || od > acc) ? od : acc;
        }, null);
        return {
          contact: contact,
          items: items,
          worstDaysOverdue: worst,
          sortKey: worst !== null ? -worst : (items[0] ? -items[0].status.daysUntil : 0)
        };
      }).sort(function (a, b) { return a.sortKey - b.sortKey; });
    }

    return {
      PING_DEFAULTS: PING_DEFAULTS,
      armPing: armPing,
      disarmPing: disarmPing,
      poke: poke,
      pingStatus: pingStatus,
      duePings: duePings,
      byContact: byContact,
      escalationLevel: escalationLevel,
      escalationForCount: escalationForCount,
      nextFollowUp: nextFollowUp
    };
  }
);
