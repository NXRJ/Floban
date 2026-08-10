const { test } = require('node:test');
const assert = require('node:assert/strict');
const Ping = require('../../js/core/ping.js');

const NOW = new Date(2026, 7, 12, 10, 0).getTime(); // Wed Aug 12 2026
const DAY = 86400000;

function waitingCard(overrides) {
  return Object.assign({
    id: 'c1', title: 'Wait on vendor', assignee: 'Sam',
    flow: { state: 'waiting', reason: 'assets', since: NOW - 2 * DAY, periods: [] },
    ping: null
  }, overrides || {});
}

// ---- armPing ---------------------------------------------------------------

test('armPing arms a waiting card with defaults', () => {
  const result = Ping.armPing(waitingCard(), {}, NOW);
  assert.equal(result.changed, true);
  const ping = result.card.ping;
  assert.equal(ping.contact, 'Sam'); // from assignee
  assert.equal(ping.followUpAt, NOW + 3 * DAY);
  assert.equal(ping.cadenceDays, 3);
  assert.equal(ping.pokedCount, 0);
  assert.deepEqual(ping.log, []);
  assert.equal(ping.lastPokedAt, null);
});

test('armPing honors explicit options', () => {
  const result = Ping.armPing(waitingCard(), { contact: 'Client A', followUpAt: NOW + 5 * DAY, cadenceDays: 7 }, NOW);
  assert.equal(result.card.ping.contact, 'Client A');
  assert.equal(result.card.ping.followUpAt, NOW + 5 * DAY);
  assert.equal(result.card.ping.cadenceDays, 7);
});

test('armPing rejects non-waiting cards', () => {
  const result = Ping.armPing(waitingCard({ flow: { state: 'blocked' } }), {}, NOW);
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'not-waiting');
});

test('armPing is deterministic', () => {
  const a = Ping.armPing(waitingCard(), {}, NOW);
  const b = Ping.armPing(waitingCard(), {}, NOW);
  assert.deepEqual(a.card, b.card);
});

// ---- poke ------------------------------------------------------------------

test('poke records the follow-up and rolls the next date at fixed cadence', () => {
  const armed = Ping.armPing(waitingCard(), { cadenceDays: 3, escalateAfter: 0 }, NOW).card;
  const result = Ping.poke(armed, NOW + 3 * DAY, 'chased on email');
  assert.equal(result.changed, true);
  assert.equal(result.card.ping.lastPokedAt, NOW + 3 * DAY);
  assert.equal(result.card.ping.pokedCount, 1);
  assert.equal(result.card.ping.followUpAt, NOW + 3 * DAY + 3 * DAY);
  assert.equal(result.card.ping.log.length, 1);
  assert.equal(result.card.ping.log[0].note, 'chased on email');
  assert.equal(result.card.ping.log[0].at, NOW + 3 * DAY);
});

test('poke escalates the cadence after the threshold and caps escalation', () => {
  const armed = Ping.armPing(waitingCard(), { cadenceDays: 3, escalateAfter: 1, maxEscalation: 2 }, NOW).card;
  // Poke 1: newCount 1, escalation = min(max(0, 1-1), 2) = 0 -> +3d
  let card = Ping.poke(armed, NOW + 3 * DAY).card;
  assert.equal(card.ping.followUpAt, NOW + 3 * DAY + 3 * DAY);
  // Poke 2: newCount 2, escalation = min(max(0, 2-1), 2) = 1 -> +6d
  card = Ping.poke(card, card.ping.followUpAt).card;
  assert.equal(card.ping.followUpAt, card.ping.lastPokedAt + 3 * (1 + 1) * DAY);
  // Poke 3: newCount 3, escalation = 2 -> +9d
  card = Ping.poke(card, card.ping.followUpAt).card;
  assert.equal(card.ping.followUpAt, card.ping.lastPokedAt + 3 * (1 + 2) * DAY);
  // Poke 4: escalation stays capped at 2
  card = Ping.poke(card, card.ping.followUpAt).card;
  assert.equal(card.ping.followUpAt, card.ping.lastPokedAt + 3 * (1 + 2) * DAY);
});

test('poke log is capped at the limit', () => {
  const armed = Ping.armPing(waitingCard(), { cadenceDays: 3, escalateAfter: 0, logLimit: 3 }, NOW).card;
  let card = armed;
  for (let i = 0; i < 5; i++) {
    card = Ping.poke(card, NOW + i * DAY).card;
  }
  assert.equal(card.ping.log.length, 3);
  assert.equal(card.ping.log[0].at, NOW + 2 * DAY); // oldest evicted
});

test('poke on an unarmed card is a no-op', () => {
  const result = Ping.poke(waitingCard(), NOW, '');
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'not-armed');
});

// ---- pingStatus ------------------------------------------------------------

test('pingStatus classifies fresh, due and overdue', () => {
  const armed = Ping.armPing(waitingCard(), { followUpAt: NOW + 3 * DAY }, NOW).card;
  assert.equal(Ping.pingStatus(armed, NOW).state, 'fresh');
  assert.equal(Ping.pingStatus(armed, NOW + 3 * DAY).state, 'due');          // exactly followUpAt
  assert.equal(Ping.pingStatus(armed, NOW + 3 * DAY + 12 * 3600000).state, 'due'); // within 1d window
  const overdue = Ping.pingStatus(armed, NOW + 5 * DAY);
  assert.equal(overdue.state, 'overdue');
  assert.equal(overdue.daysOverdue, 2);
});

test('pingStatus reports unarmed cards', () => {
  const status = Ping.pingStatus(waitingCard(), NOW);
  assert.equal(status.armed, false);
  assert.equal(status.state, 'fresh');
});

// ---- duePings / byContact --------------------------------------------------

test('duePings returns only armed waiting cards past followUpAt, soonest first', () => {
  const a = Ping.armPing(waitingCard({ id: 'a', title: 'A' }), { followUpAt: NOW + 1 * DAY }, NOW).card;
  const b = Ping.armPing(waitingCard({ id: 'b', title: 'B' }), { followUpAt: NOW - 1 * DAY }, NOW).card;
  const c = Ping.armPing(waitingCard({ id: 'c', title: 'C' }), { followUpAt: NOW + 5 * DAY }, NOW).card;
  const disarmed = Ping.disarmPing(Ping.armPing(waitingCard({ id: 'd', title: 'D' }), { followUpAt: NOW - 2 * DAY }, NOW).card).card;
  const due = Ping.duePings([c, b, a, disarmed], NOW);
  assert.deepEqual(due.map(x => x.id), ['b']);
});

test('byContact groups by contact ordered by worst staleness', () => {
  const samA = Ping.armPing(waitingCard({ id: 'a', title: 'A', assignee: 'Sam' }), { contact: 'Sam', followUpAt: NOW - 5 * DAY }, NOW).card;
  const samB = Ping.armPing(waitingCard({ id: 'b', title: 'B', assignee: 'Sam' }), { contact: 'Sam', followUpAt: NOW - 1 * DAY }, NOW).card;
  const acme = Ping.armPing(waitingCard({ id: 'c', title: 'C', assignee: 'Acme' }), { contact: 'Acme', followUpAt: NOW - 2 * DAY }, NOW).card;
  const groups = Ping.byContact([samA, samB, acme], NOW);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].contact, 'Sam'); // worst staleness (5d)
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[1].contact, 'Acme');
});

test('byContact excludes cards without pings and handles empty contact', () => {
  const plain = waitingCard({ id: 'x', title: 'No ping' });
  const noContact = Ping.armPing(waitingCard({ id: 'y', title: 'Y' }), { contact: '', followUpAt: NOW - 1 * DAY }, NOW).card;
  const groups = Ping.byContact([plain, noContact], NOW);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].contact, '(no contact)');
});

// ---- disarmPing ------------------------------------------------------------

test('disarmPing removes the ping', () => {
  const armed = Ping.armPing(waitingCard(), {}, NOW).card;
  const result = Ping.disarmPing(armed);
  assert.equal(result.changed, true);
  assert.equal(result.card.ping, undefined);
  assert.equal(Ping.disarmPing(waitingCard()).changed, false);
});

// ---- nextFollowUp ----------------------------------------------------------

test('nextFollowUp multiplies cadence by escalation factor', () => {
  assert.equal(Ping.nextFollowUp(NOW, 3, 0), NOW + 3 * DAY);
  assert.equal(Ping.nextFollowUp(NOW, 3, 1), NOW + 6 * DAY);
  assert.equal(Ping.nextFollowUp(NOW, 7, 2), NOW + 21 * DAY);
  assert.equal(Ping.nextFollowUp(NOW, 0, 0), NOW + 3 * DAY); // invalid cadence -> default
});
