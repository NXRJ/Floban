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
    root.KB.Core.Nlparse = api;
  }
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function (DateCore) {
    // Natural-language capture ("Smart Quick Add").
    //
    // A small, deliberate, deterministic grammar for turning phrases inside a
    // quick-add line or a due-date field into card fields. No AI, no network:
    // everything is a pure function of (input, now, base-date, labels).
    //
    // Anti-surprise rules (the opposite of Trello's silent auto-dates):
    //  - Only explicit tokens are recognized; ordinary prose never matches.
    //  - Relative offsets ("in 3 days", "+1w") are always written out; a bare
    //    "3 days" in a title stays in the title.
    //  - Bare ordinals ("25th") are NOT dates here, to avoid rewriting titles
    //    like "finish 1st draft"; month-name forms ("25 jul") are.
    //  - "yesterday" is not a due date; past-due is almost always a mistake.
    //  - Every recognition is visible before commit (preview chips), and the
    //    stripped phrase is removed from the title so nothing is guessed.
    //
    // Day resolution:
    //  - Relative offsets ("in N days", "+Nd", "next week") apply to BASE
    //    (the current due date for snooze, today for quick-add).
    //  - Absolute references (weekday names, explicit dates, eom) resolve from
    //    TODAY. Bare/`next` weekdays are STRICTLY in the future ("fri" on a
    //    Friday means next Friday); `this` weekdays may be today.

    var MS_PER_DAY = 86400000;
    var WEEKDAYS = {
      sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
      friday: 5, saturday: 6
    };
    var WEEKDAY_RE = 'sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|' +
      'sunday|monday|tuesday|wednesday|thursday|friday|saturday';
    var MONTHS = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
      january: 0, february: 1, march: 2, april: 3, june: 5, july: 6,
      august: 7, september: 8, october: 9, november: 10, december: 11
    };
    var MONTH_RE = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|' +
      'january|february|march|april|june|july|august|september|october|november|december';
    var PRIORITY_MAP = { p1: 'urgent', p2: 'high', p3: 'medium', p4: 'low' };
    var PRIORITIES = ['low', 'medium', 'high', 'urgent'];
    var ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

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

    function addMonthsISO(base, months) {
      return new Date(base.getFullYear(), base.getMonth() + months, base.getDate());
    }

    // Collect every non-overlapping match of a regex in the input.
    function collect(input, re) {
      var out = [];
      re.lastIndex = 0;
      var m;
      while ((m = re.exec(input))) {
        out.push({ start: m.index, end: m.index + m[0].length, match: m });
      }
      return out;
    }

    // Resolve a due-token descriptor to a Date (local midnight).
    function resolveDue(desc, today, base) {
      switch (desc.kind) {
        case 'today':
          return new Date(today.getTime());
        case 'tomorrow':
          return new Date(today.getTime() + MS_PER_DAY);
        case 'weekday': {
          var todayDow = today.getDay();
          var offset = (desc.weekday - todayDow + 7) % 7;
          if (desc.prefix !== 'this' && offset === 0) offset = 7; // bare/next: strictly future
          return new Date(today.getTime() + offset * MS_PER_DAY);
        }
        case 'rel': {
          if (desc.unit === 'month') return addMonthsISO(base, desc.amount);
          var days = desc.amount * (desc.unit === 'week' ? 7 : 1);
          return new Date(base.getTime() + days * MS_PER_DAY);
        }
        case 'monthday': {
          var y = today.getFullYear();
          var date = new Date(y, desc.month, desc.day);
          if (DateCore.isoDate(date) < DateCore.isoDate(today)) {
            date = new Date(y + 1, desc.month, desc.day);
          }
          return date;
        }
        case 'iso':
          return new Date(desc.iso.getTime());
        case 'eom':
          return new Date(today.getFullYear(), today.getMonth() + 1, 0);
        default:
          return null;
      }
    }

    // ---- Grammar pass -------------------------------------------------------

    // Every entry: [regex, kind, valueOf(match)]. Kinds: due / priority / label / time.
    var RULES = [
      // Weekday with next/this prefix — try before the bare weekday rule.
      [new RegExp('\\b(?:next|this)[\\s]+(' + WEEKDAY_RE + ')\\b', 'gi'), 'due', function (m) {
        var name = m[1].toLowerCase();
        return { kind: 'weekday', weekday: WEEKDAYS[name], prefix: m[0].toLowerCase().indexOf('next') === 0 ? 'next' : 'this' };
      }],
      // Bare weekday.
      [new RegExp('\\b(' + WEEKDAY_RE + ')\\b', 'gi'), 'due', function (m) {
        return { kind: 'weekday', weekday: WEEKDAYS[m[1].toLowerCase()], prefix: null };
      }],
      [/\btoday\b/gi, 'due', function () { return { kind: 'today' }; }],
      [/\btomorrow\b/gi, 'due', function () { return { kind: 'tomorrow' }; }],
      // Relative offsets — always with an explicit "in" or "+" marker.
      [/\bin\s+(\d+)\s+(day|days|week|weeks|month|months)\b/gi, 'due', function (m) {
        var unit = m[2].toLowerCase();
        return { kind: 'rel', amount: Number(m[1]), unit: unit === 'days' || unit === 'day' ? 'day' : unit === 'weeks' || unit === 'week' ? 'week' : 'month' };
      }],
      // Verb-prefixed offsets ("snooze 3d", "push 1w") — explicit reschedule
      // verbs, so "print 3d part" in a title is never misread as a date.
      [/\b(?:snooze|push|shift|delay|reschedule)\s+(\d+)\s*(d|w|m|days?|weeks?|months?)\b/gi, 'due', function (m) {
        var unit = m[2].toLowerCase();
        return { kind: 'rel', amount: Number(m[1]), unit: unit.indexOf('m') === 0 ? 'month' : unit.indexOf('w') === 0 ? 'week' : 'day' };
      }],
      [/\+\s*(\d+)\s*([dwmy])\b/gi, 'due', function (m) {
        var unitMap = { d: 'day', w: 'week', m: 'month', y: 'year' };
        var unit = unitMap[m[2].toLowerCase()];
        return unit === 'year'
          ? { kind: 'rel', amount: Number(m[1]) * 12, unit: 'month' }
          : { kind: 'rel', amount: Number(m[1]), unit: unit };
      }],
      // Bare offsets ("3d", "1w") — ONLY in a context where the input is a
      // due-date field (opts.bareOffsets), where no title is at risk.
      [null, 'due', function (m) {
        var unitMap = { d: 'day', w: 'week', m: 'month' };
        return { kind: 'rel', amount: Number(m[1]), unit: unitMap[m[2].toLowerCase()] };
      }],
      [/\bnext\s+week\b/gi, 'due', function () { return { kind: 'rel', amount: 7, unit: 'day' }; }],
      [/\beom\b/gi, 'due', function () { return { kind: 'eom' }; }],
      // ISO date, validated as a real calendar day.
      [/\b(\d{4})-(\d{2})-(\d{2})\b/g, 'due', function (m) {
        var date = parseISO(m[1] + '-' + m[2] + '-' + m[3]);
        return date ? { kind: 'iso', iso: date } : null;
      }],
      // "25 jul", "jul 25", "jul 25th" (month-name forms only; no bare ordinals).
      [new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s]+(' + MONTH_RE + ')\\b', 'gi'), 'due', function (m) {
        return { kind: 'monthday', day: Number(m[1]), month: MONTHS[m[2].toLowerCase()] };
      }],
      [new RegExp('\\b(' + MONTH_RE + ')[\\s]+(\\d{1,2})(?:st|nd|rd|th)?\\b', 'gi'), 'due', function (m) {
        return { kind: 'monthday', day: Number(m[2]), month: MONTHS[m[1].toLowerCase()] };
      }],
      // Time of day — recognized and stripped, but not stored (day-granular model).
      [/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi, 'time', null],
      [/\b\d{1,2}:\d{2}\b/g, 'time', null],
      // Priority tokens: p1–p4 or explicit priority:level. Bare adjectives
      // ("high", "urgent") are intentionally NOT recognized — they are prose.
      [/\bp([1-4])(?!\d)\b/gi, 'priority', function (m) { return PRIORITY_MAP['p' + m[1]]; }],
      [/\b(?:priority|prio)\s*:\s*(urgent|high|medium|low)\b/gi, 'priority', function (m) { return m[1].toLowerCase(); }],
      // Labels — only resolved against the caller-supplied label list.
      [/#([a-z0-9_-]+)/gi, 'label', null]
    ];

    function scan(input, opts) {
      var tokens = [];
      var labelsByName = {};
      (opts.labels || []).forEach(function (label) {
        if (label && typeof label.name === 'string') {
          labelsByName[label.name.toLowerCase()] = label.id;
        }
      });

      RULES.forEach(function (rule) {
        var re = rule[0];
        if (!re) {
          // Conditional rule: bare offsets only inside a due-date field.
          if (!opts.bareOffsets) return;
          re = /\b(\d+)(d|w|m)\b/gi;
        }
        var items = collect(input, re);
        items.forEach(function (item) {
          var value = null;
          if (rule[1] === 'label') {
            value = labelsByName[item.match[1].toLowerCase()] || null;
            if (!value) return; // unknown #tag stays in the title
          } else if (rule[2]) {
            value = rule[2](item.match);
            if (value === null) return; // rule rejected the match (e.g. invalid ISO)
          }
          tokens.push({ start: item.start, end: item.end, kind: rule[1], value: value });
        });
      });

      // Sort by start, longer matches first; drop overlaps (e.g. the bare
      // weekday token inside "next friday").
      tokens.sort(function (a, b) {
        return a.start - b.start || b.end - a.end;
      });
      var deduped = [];
      var lastEnd = -1;
      tokens.forEach(function (t) {
        if (t.start >= lastEnd) {
          deduped.push(t);
          lastEnd = t.end;
        }
      });
      return deduped;
    }

    function stripTokens(input, tokens) {
      var parts = [];
      var cursor = 0;
      tokens.forEach(function (t) {
        parts.push(input.slice(cursor, t.start));
        cursor = t.end;
      });
      parts.push(input.slice(cursor));
      return parts.join(' ').replace(/\s+/g, ' ').trim();
    }

    // Shared resolution: opts = { now (ms), baseISO?, labels? }.
    function resolve(input, opts) {
      opts = opts || {};
      var now = typeof opts.now === 'number' ? opts.now : Date.now();
      var tokens = scan(input, opts);
      var today = dayStart(now);
      var base = opts.baseISO ? (parseISO(opts.baseISO) || today) : today;

      var due = null;
      var priority = null;
      var labelIds = [];
      var seenLabels = {};
      var lastDueToken = null;

      tokens.forEach(function (t) {
        if (t.kind === 'due') {
          due = resolveDue(t.value, today, base);
          lastDueToken = t;
        } else if (t.kind === 'priority') {
          priority = t.value;
        } else if (t.kind === 'label') {
          if (!seenLabels[t.value]) {
            seenLabels[t.value] = true;
            labelIds.push(t.value);
          }
        }
      });

      var spans = tokens.map(function (t) {
        return { start: t.start, end: t.end, kind: t.kind };
      });

      return {
        title: stripTokens(input, tokens),
        due: due ? DateCore.isoDate(due) : null,
        dueToken: lastDueToken ? input.slice(lastDueToken.start, lastDueToken.end) : null,
        priority: priority,
        labelIds: labelIds,
        spans: spans
      };
    }

    // Quick-add parsing: "fix api bug in 3 days p2 #launch"
    //   -> { title: 'fix api bug', due: 'YYYY-MM-DD', priority: 'high',
    //        labelIds: ['…'], spans: [...] }
    // Also recognizes a WHEN/DEADLINE do-date: "do fri", "start 08/14"
    //   -> { when: 'YYYY-MM-DD' } with the phrase stripped from the title.
    // opts: { now, labels: [{ id, name }] }
    function parseQuickAdd(input, opts) {
      var text = String(input || '');
      var when = null;
      var mainInput = text;

      // The do-verb must come FIRST and its remainder must parse as a date —
      // so "do laundry" is never mistaken for a do-date, and "do fri ship
      // landing page" treats "fri" as the when-date, not a due date.
      var verb = /^(do|start|begin|work)\s+(.+)$/i.exec(text);
      if (verb) {
        var whenResult = resolve(verb[2], { now: opts && opts.now, bareOffsets: true });
        if (whenResult.due) {
          when = whenResult.due;
          // Drop the matched date phrase from the remainder; keep the rest of
          // the line for the main grammar (due/priority/labels).
          var dueSpan = null;
          whenResult.spans.forEach(function (s) {
            if (s.kind === 'due' && (dueSpan === null || s.start < dueSpan.start)) dueSpan = s;
          });
          if (dueSpan) {
            mainInput = (verb[2].slice(0, dueSpan.start) + ' ' + verb[2].slice(dueSpan.end)).replace(/\s+/g, ' ').trim();
          } else {
            mainInput = '';
          }
        }
      }

      var result = resolve(mainInput, opts);
      return {
        title: result.title,
        due: result.due,
        when: when,
        priority: result.priority,
        labelIds: result.labelIds,
        spans: result.spans
      };
    }

    // Due-field parsing (snooze / reschedule): relative offsets apply to the
    // card's current due date (opts.baseISO), absolute references to today.
    //   "snooze 3d"  -> due = base + 3 days
    //   "push fri"   -> due = next Friday
    //   "+1w"        -> due = base + 7 days
    // Returns { due, consumed, remainder, spans }; consumed is the raw matched
    // phrase so the UI can show what was recognized.
    function parseDuePhrase(input, opts) {
      var result = resolve(String(input || ''), opts);
      return {
        due: result.due,
        consumed: result.dueToken || '',
        remainder: result.title,
        spans: result.spans
      };
    }

    // WHEN/DEADLINE: parse an explicit "do date" phrase. Explicit verbs only —
    //   "do fri"      -> when = next Friday
    //   "start 08/14" -> when = Aug 14 (current year, future)
    //   "begin in 3 days" -> when = today + 3
    // A bare date with no verb still means `due` (backward compatible).
    // Returns { when (ISO|null), consumed, remainder }.
    function parseWhenPhrase(input, opts) {
      opts = opts || {};
      var now = typeof opts.now === 'number' ? opts.now : Date.now();
      var text = String(input || '');

      // "do/start/begin <rest>" — resolve the rest with the due grammar, then
      // re-label it as the when-date. Relative offsets resolve from today.
      var m = /\b(?:do|start|begin|work)\s+(.+)$/i.exec(text);
      if (!m) return { when: null, consumed: '', remainder: text };
      var phrase = m[1];
      var result = resolve(phrase, { now: now, bareOffsets: true });
      if (!result.due) return { when: null, consumed: '', remainder: text };
      return {
        when: result.due,
        consumed: m[0].trim(),
        remainder: stripTokens(text, [{ start: m.index, end: m.index + m[0].length }])
      };
    }

    return {
      parseQuickAdd: parseQuickAdd,
      parseDuePhrase: parseDuePhrase,
      parseWhenPhrase: parseWhenPhrase,
      PRIORITIES: PRIORITIES
    };
  }
);
