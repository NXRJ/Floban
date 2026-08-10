const { test } = require('node:test');
const assert = require('node:assert/strict');
const Nlparse = require('../../js/core/nlparse.js');
const Operations = require('../../js/core/operations.js');

// Fixed injected clock: Wednesday 2026-08-12 10:00 local.
const NOW = new Date(2026, 7, 12, 10, 0).getTime();
const FRIDAY_NOW = new Date(2026, 7, 14, 9, 0).getTime();
const LABELS = [
  { id: 'l-bug', name: 'Bug' },
  { id: 'l-feat', name: 'Feature' },
  { id: 'l-launch', name: 'launch' }
];

function qa(input, opts) {
  return Nlparse.parseQuickAdd(input, Object.assign({ now: NOW, labels: LABELS }, opts || {}));
}

// ---- Relative and absolute day phrases -------------------------------------

test('today and tomorrow resolve from the injected clock', () => {
  assert.equal(qa('today').due, '2026-08-12');
  assert.equal(qa('tomorrow').due, '2026-08-13');
});

test('bare weekday is strictly in the future', () => {
  assert.equal(qa('fri').due, '2026-08-14'); // Wed -> this coming Friday
  assert.equal(qa('next monday').due, '2026-08-17');
  assert.equal(qa('next wednesday').due, '2026-08-19'); // on the weekday itself: +7
  assert.equal(qa('next friday').due, '2026-08-14'); // "next friday" on a Wednesday = this week's Friday
});

test('weekday on its own day rolls to next week unless prefixed this', () => {
  const onFriday = (input) => Nlparse.parseQuickAdd(input, { now: FRIDAY_NOW, labels: LABELS }).due;
  assert.equal(onFriday('fri'), '2026-08-21'); // bare: strictly future
  assert.equal(onFriday('next friday'), '2026-08-21');
  assert.equal(onFriday('this friday'), '2026-08-14'); // this: today allowed
});

test('relative offsets require an explicit marker', () => {
  assert.equal(qa('in 3 days').due, '2026-08-15');
  assert.equal(qa('in 2 weeks').due, '2026-08-26');
  assert.equal(qa('in 1 month').due, '2026-09-12');
  assert.equal(qa('+5d').due, '2026-08-17');
  assert.equal(qa('+2w').due, '2026-08-26');
  assert.equal(qa('+1m').due, '2026-09-12');
  assert.equal(qa('next week').due, '2026-08-19');
});

test('verb-prefixed offsets reschedule without touching prose', () => {
  assert.equal(qa('snooze 3d').due, '2026-08-15');
  assert.equal(qa('snooze 3d').title, '');
  assert.equal(qa('push 1w').due, '2026-08-19');
  assert.equal(qa('push 1w').title, '');
});

test('explicit month-day dates roll to next year once passed', () => {
  assert.equal(qa('aug 20').due, '2026-08-20');
  assert.equal(qa('25 jul').due, '2027-07-25'); // passed this year
  assert.equal(qa('jul 25').due, '2027-07-25');
  assert.equal(qa('25 dec').due, '2026-12-25');
});

test('ISO dates parse when real, stay in the title when not', () => {
  assert.equal(qa('2026-08-20').due, '2026-08-20');
  const invalid = qa('release 2026-02-30');
  assert.equal(invalid.due, null);
  assert.equal(invalid.title, 'release 2026-02-30');
});

test('eom resolves to the last day of the current month', () => {
  assert.equal(qa('pay rent eom').due, '2026-08-31');
  assert.equal(qa('pay rent eom').title, 'pay rent');
});

test('times are recognized and stripped but not stored (day-granular)', () => {
  const t = qa('call sam tomorrow 5pm');
  assert.equal(t.due, '2026-08-13');
  assert.equal(t.title, 'call sam');
});

// ---- Priority and labels ----------------------------------------------------

test('p1-p4 map onto the four priority levels', () => {
  assert.equal(qa('p1').priority, 'urgent');
  assert.equal(qa('p2').priority, 'high');
  assert.equal(qa('p3').priority, 'medium');
  assert.equal(qa('p4').priority, 'low');
});

test('priority:level forms parse, bare adjectives do not', () => {
  assert.equal(qa('priority:high').priority, 'high');
  assert.equal(qa('prio:low').priority, 'low');
  assert.equal(qa('high five').priority, null); // prose, not priority
  assert.equal(qa('urgent please').priority, null);
});

test('p10 and p5 are not priorities, mon inside a word is not a weekday', () => {
  assert.equal(qa('p10').priority, null);
  assert.equal(qa('p5').priority, null);
  assert.equal(qa('monitoring').due, null);
  assert.equal(qa('monitoring').title, 'monitoring');
});

test('hashtags resolve against existing labels case-insensitively', () => {
  assert.deepEqual(qa('#Bug').labelIds, ['l-bug']);
  assert.deepEqual(qa('#bug').labelIds, ['l-bug']);
  assert.deepEqual(qa('fix #bug #Feature').labelIds, ['l-bug', 'l-feat']);
  const unknown = qa('talk about #vegan-cuisine');
  assert.deepEqual(unknown.labelIds, []);
  assert.equal(unknown.title, 'talk about #vegan-cuisine'); // unknown tag stays
});

// ---- Combined capture -------------------------------------------------------

test('a full smart-capture line sets title, due, priority and labels', () => {
  const r = qa('deploy v2 next friday p1 #launch');
  assert.equal(r.title, 'deploy v2');
  assert.equal(r.due, '2026-08-14');
  assert.equal(r.priority, 'urgent');
  assert.deepEqual(r.labelIds, ['l-launch']);
});

test('spans cover exactly the recognized tokens', () => {
  const r = qa('deploy v2 next friday p1 #launch');
  assert.deepEqual(r.spans, [
    { start: 10, end: 21, kind: 'due' },
    { start: 22, end: 24, kind: 'priority' },
    { start: 25, end: 32, kind: 'label' }
  ]);
});

test('phrases in the middle of a line are stripped, neighbours preserved', () => {
  const r = qa('fix the in 3 days login bug p2');
  assert.equal(r.title, 'fix the login bug');
  assert.equal(r.due, '2026-08-15');
  assert.equal(r.priority, 'high');
});

// ---- Ambiguity guards (the Trello-failure class) ----------------------------

test('plain prose parses to nothing', () => {
  const r = qa('review the plan');
  assert.equal(r.title, 'review the plan');
  assert.equal(r.due, null);
  assert.equal(r.priority, null);
  assert.deepEqual(r.labelIds, []);
  assert.deepEqual(r.spans, []);
});

test('bare ordinals are never dates', () => {
  const r = qa('finish 1st draft');
  assert.equal(r.due, null);
  assert.equal(r.title, 'finish 1st draft');
});

test('bare number+unit without marker is never a date in quick-add', () => {
  const r = qa('print 3d part');
  assert.equal(r.due, null);
  assert.equal(r.title, 'print 3d part');
  const d = qa('review 3 days'); // "in" is required
  assert.equal(d.due, null);
  assert.equal(d.title, 'review 3 days');
});

test('an empty line yields an empty result', () => {
  const r = qa('');
  assert.equal(r.title, '');
  assert.equal(r.due, null);
  assert.deepEqual(r.spans, []);
});

test('parsing is deterministic for identical input and clock', () => {
  const a = qa('ship release fri p2 #launch');
  const b = qa('ship release fri p2 #launch');
  assert.deepEqual(a, b);
});

// ---- Snooze / reschedule (parseDuePhrase) ----------------------------------

function sn(input, opts) {
  return Nlparse.parseDuePhrase(input, Object.assign({ now: NOW, baseISO: '2026-08-15', bareOffsets: true }, opts || {}));
}

test('snooze relative offsets move the existing due date', () => {
  assert.equal(sn('snooze 3d').due, '2026-08-18'); // base + 3
  assert.equal(sn('+1w').due, '2026-08-22');       // base + 7
  assert.equal(sn('in 3 days').due, '2026-08-18'); // base + 3
  assert.equal(sn('snooze 1m').due, '2026-09-15'); // base + 1 month
});

test('snooze absolute references resolve from today', () => {
  assert.equal(sn('push fri').due, '2026-08-14'); // this coming Friday from now
  assert.equal(sn('push next friday').due, '2026-08-14');
  assert.equal(sn('push next wednesday').due, '2026-08-19'); // strictly future
});

test('bare offsets only work when enabled', () => {
  assert.equal(sn('3d').due, '2026-08-18');
  assert.equal(Nlparse.parseDuePhrase('3d', { now: NOW, baseISO: '2026-08-15' }).due, null);
});

test('snooze reports the consumed phrase and remainder', () => {
  assert.equal(sn('push fri').consumed, 'fri');
  assert.equal(sn('push fri').remainder, 'push');
  assert.equal(sn('snooze 3d').consumed, 'snooze 3d');
  assert.equal(sn('not a date').consumed, '');
  assert.equal(sn('not a date').due, null);
});

test('snooze with no current due date treats today as the base', () => {
  const r = Nlparse.parseDuePhrase('+2d', { now: NOW, bareOffsets: true });
  assert.equal(r.due, '2026-08-14');
});

// ---- Pipeline integration: parsed fields reach the card --------------------

function makeState() {
  return {
    version: 3,
    theme: 'dark',
    activeBoardId: 'board-1',
    inbox: { items: [] },
    lenses: [],
    recurrences: [],
    boards: [
      {
        id: 'board-1',
        name: 'Board 1',
        labels: [{ id: 'label-1', name: 'Bug', color: '#c81e14' }],
        templates: [],
        columns: [
          {
            id: 'column-1',
            title: 'To Do',
            isDone: false,
            role: 'queue',
            wipLimit: 0,
            collapsed: false,
            policy: { defaultLabelIds: ['label-1'] },
            cards: []
          }
        ],
        archive: { cards: [], columns: [] }
      }
    ]
  };
}

function deps() {
  let seq = 0;
  return { uid: () => 'id-' + (++seq), now: () => 1000 };
}

test('createCards applies parsed fields and strips tokens from the title', () => {
  // Simulates the app wiring: the quick-add line is parsed first, then the
  // stripped title and parsed fields are dispatched through the pipeline.
  const parsed = Nlparse.parseQuickAdd('Fix bug in 3 days p2', {
    now: NOW,
    labels: [{ id: 'label-1', name: 'Bug' }]
  });
  assert.equal(parsed.title, 'Fix bug');
  assert.equal(parsed.due, '2026-08-15');
  assert.equal(parsed.priority, 'high');
  const result = Operations.createCards(makeState(), {
    columnId: 'column-1',
    titles: [parsed.title],
    fields: [{ due: parsed.due, priority: parsed.priority, labels: parsed.labelIds }]
  }, deps());
  assert.equal(result.changed, true);
  assert.equal(result.value, 1);
  const card = result.state.boards[0].columns[0].cards[0];
  assert.equal(card.title, 'Fix bug');
  assert.equal(card.due, '2026-08-15');
  assert.equal(card.priority, 'high');
  assert.deepEqual(card.labels, ['label-1']); // column default merges, no dupes
});

test('createCards sanitizes malformed fields silently', () => {
  const result = Operations.createCards(makeState(), {
    columnId: 'column-1',
    titles: ['Plain title'],
    fields: [{ due: 'not-a-date', priority: 'extreme', labels: 'nope' }]
  }, deps());
  assert.equal(result.changed, true);
  const card = result.state.boards[0].columns[0].cards[0];
  assert.equal(card.title, 'Plain title');
  assert.equal(card.due, '');
  assert.equal(card.priority, 'none');
  assert.deepEqual(card.labels, ['label-1']); // only the column default remains
});

test('createCards leaves plain lines untouched', () => {
  const result = Operations.createCards(makeState(), {
    columnId: 'column-1',
    titles: ['Plain title'],
    fields: [{}]
  }, deps());
  const card = result.state.boards[0].columns[0].cards[0];
  assert.equal(card.title, 'Plain title');
  assert.equal(card.due, '');
  assert.equal(card.priority, 'none');
});

// ---- Regression: weekday abbreviations and DST-safe day arithmetic ---------

test('every weekday abbreviation the grammar matches also resolves', () => {
  // WEEKDAY_RE accepts tues/thur/thurs; a missing entry in the WEEKDAYS map
  // used to yield due="NaN-NaN-NaN", eating the token and setting no date.
  const cases = {
    sun: '2026-08-16', mon: '2026-08-17', tue: '2026-08-18', tues: '2026-08-18',
    wed: '2026-08-19', thu: '2026-08-13', thur: '2026-08-13', thurs: '2026-08-13',
    fri: '2026-08-14', sat: '2026-08-15'
  };
  Object.keys(cases).forEach((name) => {
    const parsed = qa('ship it ' + name);
    assert.equal(parsed.due, cases[name], name + ' should resolve to ' + cases[name]);
    assert.equal(parsed.title, 'ship it');
  });
});

test('day phrases step calendar days across a DST fall-back boundary', () => {
  // Europe/London 2026-10-25 is 25 hours long. Fixed +86400000ms arithmetic
  // landed at 23:00 the same day, so "tomorrow" resolved to today.
  const original = process.env.TZ;
  process.env.TZ = 'Europe/London';
  try {
    const dstNow = new Date(2026, 9, 25, 12, 0).getTime();
    const at = (input) => Nlparse.parseQuickAdd(input, { now: dstNow }).due;
    assert.equal(at('ship tomorrow'), '2026-10-26');
    assert.equal(at('ship in 1 days'), '2026-10-26');
    assert.equal(at('ship in 3 days'), '2026-10-28');
    assert.equal(at('ship next week'), '2026-11-01');
    // 2026-10-25 is a Sunday; a bare weekday is always strictly in the future.
    assert.equal(at('ship sun'), '2026-11-01');
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
