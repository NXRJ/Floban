(function (root, factory) {
  var lifecycleCore = (typeof module === 'object' && module.exports)
    ? require('./lifecycle.js')
    : root.KB.Core.Lifecycle;
  var relationsCore = (typeof module === 'object' && module.exports)
    ? require('./relations.js')
    : root.KB.Core.Relations;
  var policiesCore = (typeof module === 'object' && module.exports)
    ? require('./policies.js')
    : root.KB.Core.Policies;
  var api = factory(lifecycleCore, relationsCore, policiesCore);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KB = root.KB || {};
    root.KB.Core = root.KB.Core || {};
    root.KB.Core.Metrics = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function (Lifecycle, Relations, Policies) {
    var MS_PER_DAY = 86400000;
    var MIN_SLE_SAMPLES = 10;
    var PRIORITY_WEIGHT = { none: 0, low: 1, medium: 2, high: 3, urgent: 4 };
    var TODAY_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

    function isoToday(now) {
      var d = new Date(now);
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return d.getFullYear() + '-' + m + '-' + day;
    }

    function median(values) {
      var sorted = values.slice().sort(function (a, b) { return a - b; });
      var n = sorted.length;
      if (n === 0) return null;
      var mid = Math.floor(n / 2);
      if (n % 2 === 1) return sorted[mid];
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }

    function percentile(values, p) {
      if (!Array.isArray(values) || values.length === 0) return null;
      var sorted = values.slice().sort(function (a, b) { return a - b; });
      var k = Math.max(0, Math.min(1, p)) * (sorted.length - 1);
      var lower = Math.floor(k);
      var upper = Math.ceil(k);
      if (lower === upper) return sorted[lower];
      var frac = k - lower;
      return sorted[lower] * (1 - frac) + sorted[upper] * frac;
    }

    function allBoardCards(board) {
      var cards = [];
      (board.columns || []).forEach(function (column) {
        (column.cards || []).forEach(function (card) {
          cards.push({ card: card, column: column, archived: false });
        });
      });
      if (board.archive) {
        (board.archive.cards || []).forEach(function (card) {
          cards.push({ card: card, column: null, archived: true });
        });
        (board.archive.columns || []).forEach(function (entry) {
          (entry.cards || []).forEach(function (card) {
            cards.push({ card: card, column: null, archived: true });
          });
        });
      }
      return cards;
    }

    function completedCardsInRange(board, from, to) {
      var out = [];
      allBoardCards(board).forEach(function (entry) {
        var card = entry.card;
        if (!card || typeof card.completedAt !== 'number') return;
        if (card.completedAt >= from && card.completedAt <= to) out.push(card);
      });
      return out;
    }

    function throughput(board, from, to) {
      return completedCardsInRange(board, from, to).length;
    }

    function cycleTimes(board) {
      var times = [];
      allBoardCards(board).forEach(function (entry) {
        var card = entry.card;
        if (!card || typeof card.startedAt !== 'number' || typeof card.completedAt !== 'number') return;
        times.push((card.completedAt - card.startedAt) / MS_PER_DAY);
      });
      return times;
    }

    function calculateSle(board, percentileValue) {
      if (!board) return { sleDays: null, sampleCount: 0 };
      var settings = board.flowSettings || {};
      var manual = settings.manualSleDays;
      if (typeof manual === 'number' && manual > 0) {
        return { sleDays: manual, sampleCount: null, manual: true };
      }
      var times = cycleTimes(board);
      var p = typeof percentileValue === 'number' ? percentileValue : (typeof settings.slePercentile === 'number' ? settings.slePercentile : 0.85);
      if (times.length < MIN_SLE_SAMPLES) return { sleDays: null, sampleCount: times.length };
      return { sleDays: percentile(times, p), sampleCount: times.length };
    }

    function wipByColumn(board, now) {
      if (!board) return [];
      var ts = typeof now === 'number' ? now : 0;
      return (board.columns || []).map(function (column) {
        var count = column.cards ? column.cards.length : 0;
        var limit = column.wipLimit || 0;
        var ages = (column.cards || []).map(function (card) {
          return Lifecycle.workItemAgeDays(card, ts);
        }).filter(function (days) { return days !== null; });
        return {
          columnId: column.id,
          title: column.title,
          count: count,
          limit: limit,
          over: limit > 0 && count > limit,
          medianAgeDays: median(ages)
        };
      });
    }

    function oldestActiveCards(board) {
      var list = [];
      (board.columns || []).forEach(function (column) {
        if (column.role === 'done') return;
        (column.cards || []).forEach(function (card) {
          list.push(card);
        });
      });
      list.sort(function (a, b) {
        var aa = a.startedAt || a.movedAt || a.createdAt || 0;
        var bb = b.startedAt || b.movedAt || b.createdAt || 0;
        return aa - bb;
      });
      return list;
    }

    function overWipColumns(board, now) {
      var ts = typeof now === 'number' ? now : 0;
      return wipByColumn(board, ts).filter(function (entry) {
        return entry.over;
      }).map(function (entry) {
        var explanation = entry.title + ' holds ' + entry.count + ' cards against a limit of ' + entry.limit + '.';
        if (entry.medianAgeDays !== null) {
          explanation += ' Its median card age is ' + Math.round(entry.medianAgeDays) + ' days.';
        }
        return { columnId: entry.columnId, title: entry.title, count: entry.count, limit: entry.limit, medianAgeDays: entry.medianAgeDays, explanation: explanation };
      });
    }

    function flowSummary(board, now) {
      var summary = {
        wip: 0,
        wipByColumn: [],
        completed7d: 0,
        completed30d: 0,
        medianCycleTime: null,
        cycleTimeP85: null,
        sle: { sleDays: null, sampleCount: 0 },
        oldestActive: null,
        blockedTotal: 0,
        blockedRecentlyCompletedMs: 0,
        overWipColumns: []
      };
      if (!board) return summary;
      summary.wipByColumn = wipByColumn(board, now);
      summary.wip = (board.columns || []).reduce(function (n, column) {
        if (column.role === 'done') return n;
        return n + (column.cards ? column.cards.length : 0);
      }, 0);
      summary.completed7d = throughput(board, now - 7 * MS_PER_DAY, now);
      summary.completed30d = throughput(board, now - 30 * MS_PER_DAY, now);
      var times = cycleTimes(board);
      summary.medianCycleTime = median(times);
      summary.cycleTimeP85 = percentile(times, 0.85);
      summary.sle = calculateSle(board);
      var oldest = oldestActiveCards(board, now);
      if (oldest.length > 0) {
        summary.oldestActive = oldest[0];
      }
      var blockedInCols = 0;
      allBoardCards(board).forEach(function (entry) {
        var card = entry.card;
        if (card.flow && card.flow.state === 'blocked') blockedInCols += 1;
      });
      summary.blockedTotal = blockedInCols;
      var recentlyCompleted = completedCardsInRange(board, now - 30 * MS_PER_DAY, now);
      summary.blockedRecentlyCompletedMs = recentlyCompleted.reduce(function (n, card) {
        return n + Lifecycle.totalFlowDuration(card, 'blocked', now);
      }, 0);
      summary.overWipColumns = overWipColumns(board, now);
      return summary;
    }

    function reviewQueue(state, boardId, now, settings) {
      var options = settings || {};
      var board = null;
      (state.boards || []).forEach(function (b) { if (b.id === boardId) board = b; });
      if (!board) return [];
      var flow = board.flowSettings || {};
      var staleAfterDays = options.staleAfterDays !== undefined ? options.staleAfterDays : (flow.staleAfterDays || 7);
      var oversizedThreshold = options.oversizedChecklistThreshold !== undefined ? options.oversizedChecklistThreshold : (flow.oversizedChecklistThreshold || 10);
      var completedReviewAfterDays = options.completedReviewAfterDays !== undefined ? options.completedReviewAfterDays : (flow.completedReviewAfterDays || 7);
      var sle = calculateSle(board, options.percentile);
      var today = isoToday(now);
      var resolved = Relations.resolvedIndex(state);
      var cards = Relations.cardIndex(state);
      var unresolvedLookup = function (ref) {
        return Relations.getUnresolvedBlockers(state, ref, resolved, cards);
      };

      var items = [];
      (board.columns || []).forEach(function (column) {
        (column.cards || []).forEach(function (card) {
          items.push(buildReviewItem(state, board, column, card, now, {
            staleAfterDays: staleAfterDays,
            oversizedThreshold: oversizedThreshold,
            completedReviewAfterDays: completedReviewAfterDays,
            sleDays: sle.sleDays,
            today: today,
            unresolved: unresolvedLookup
          }));
        });
      });

      var prioritized = items.filter(function (item) { return item.score !== null; });
      prioritized.sort(function (a, b) {
        if (a.score !== b.score) return a.score - b.score;
        var pa = PRIORITY_WEIGHT[a.card.priority] || 0;
        var pb = PRIORITY_WEIGHT[b.card.priority] || 0;
        if (pa !== pb) return pb - pa;
        var aa = a.card.createdAt || 0;
        var ab = b.card.createdAt || 0;
        if (aa !== ab) return aa - ab;
        var da = a.card.due || '9999-12-31';
        var db = b.card.due || '9999-12-31';
        return da < db ? -1 : (da > db ? 1 : 0);
      });
      return prioritized;
    }

    function buildReviewItem(state, board, column, card, now, options) {
      var ref = { boardId: board.id, columnId: column.id, cardId: card.id };
      var reasons = [];
      var score = null;

      var manualBlocked = card.flow && card.flow.state === 'blocked';
      // Each reason bumps the review score to its rank when no stronger
      // reason exists yet.
      function addReason(rank, text) {
        reasons.push({ rank: rank, text: text });
        if (score === null || score > rank) score = rank;
      }

      if (manualBlocked) {
        var blockedDays = Lifecycle.currentFlowDuration(card, now) / MS_PER_DAY;
        addReason(1, 'Blocked for ' + fmtDays(blockedDays));
      }

      var unresolved = options.unresolved ? options.unresolved(ref) : Relations.getUnresolvedBlockers(state, ref);
      if (unresolved.length > 0) {
        var depDays = (now - (card.movedAt || card.createdAt || now)) / MS_PER_DAY;
        addReason(2, 'Dependency blocked — ' + unresolved.length + ' unresolved blocker' + (unresolved.length === 1 ? '' : 's') + ' for ' + fmtDays(depDays));
      }

      var waiting = card.flow && card.flow.state === 'waiting';
      if (waiting) {
        var waitingDays = Lifecycle.currentFlowDuration(card, now) / MS_PER_DAY;
        addReason(3, 'Waiting for ' + fmtDays(waitingDays));
        // PING follow-up engine: an armed waiting card past its follow-up
        // date outranks the plain waiting reason.
        if (card.ping && card.ping.followUpAt <= now) {
          var daysOverdue = Math.ceil((now - card.ping.followUpAt) / MS_PER_DAY);
          addReason(2, 'PING overdue ' + daysOverdue + 'D' + (card.ping.contact ? ' \u2014 ' + card.ping.contact : ''));
        }
      }

      if (options.sleDays !== null && options.sleDays > 0) {
        var age = Lifecycle.workItemAgeDays(card, now);
        if (age !== null && age > options.sleDays) {
          addReason(4, 'Beyond SLE of ' + Math.round(options.sleDays) + ' days (' + Math.round(age) + ' days old)');
        }
      }

      var wip = Policies.wipStatus(column);
      if (wip.over) {
        addReason(5, 'In an over-WIP column');
      }

      if (card.due && TODAY_ISO_RE.test(card.due) && card.due < options.today) {
        addReason(6, 'Overdue');
      }

      var staleMs = (now - (card.updatedAt || card.createdAt || now)) / MS_PER_DAY;
      if (staleMs > options.staleAfterDays && column.role !== 'done') {
        addReason(7, 'Stale — no update for ' + Math.round(staleMs) + ' days');
      }

      if ((card.checklist || []).length > options.oversizedThreshold) {
        addReason(8, (card.checklist || []).length + ' checklist items');
      }

      var paused = card.flow && card.flow.state === 'paused';
      if (paused) {
        addReason(9, 'Paused for review');
      }

      if (typeof card.completedAt === 'number' && (now - card.completedAt) / MS_PER_DAY > options.completedReviewAfterDays) {
        addReason(10, 'Completed — ready to archive');
      }

      return {
        ref: ref,
        boardId: board.id,
        columnId: column.id,
        card: card,
        columnTitle: column.title,
        score: score,
        reasons: reasons.map(function (r) { return r.text; })
      };
    }

    function fmtDays(days) {
      return Math.max(0, Math.round(days)) + 'D';
    }

    return {
      MIN_SLE_SAMPLES: MIN_SLE_SAMPLES,
      median: median,
      percentile: percentile,
      completedCardsInRange: completedCardsInRange,
      throughput: throughput,
      cycleTimes: cycleTimes,
      calculateSle: calculateSle,
      wipByColumn: wipByColumn,
      oldestActiveCards: oldestActiveCards,
      overWipColumns: overWipColumns,
      flowSummary: flowSummary,
      reviewQueue: reviewQueue
    };
  }
);
