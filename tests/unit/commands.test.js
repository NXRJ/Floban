const { test } = require('node:test');
const assert = require('node:assert/strict');
const Commands = require('../../js/core/commands.js');

function makeRegistry() {
  const registry = Commands.createRegistry();
  const runs = [];
  registry._runs = runs;
  return registry;
}

test('register validates ids and run functions', () => {
  const registry = Commands.createRegistry();
  assert.throws(() => registry.register({ title: 'no id' }), /id/);
  assert.throws(() => registry.register({ id: 'x' }), /run/);
  assert.throws(() => registry.register({ id: 'x', run() {}, category: 'Bogus' }), /category/);
  assert.throws(() => registry.register({ id: 'x', run() {}, scope: 'bogus' }), /scope/);
});

test('register replaces an existing id', () => {
  const registry = makeRegistry();
  registry.register({ id: 'a', title: 'First', run() {} });
  registry.register({ id: 'a', title: 'Second', run() {} });
  assert.equal(registry.all().length, 1);
  assert.equal(registry.get('a').title, 'Second');
});

test('unregister removes a command', () => {
  const registry = makeRegistry();
  registry.register({ id: 'gone', title: 'Gone', run() {} });
  registry.unregister('gone');
  assert.equal(registry.get('gone'), null);
  assert.equal(registry.all().length, 0);
});

test('list sorts by category, order, then title', () => {
  const registry = Commands.createRegistry();
  registry.register({ id: 'b', title: 'Beta', category: 'View', order: 2, run() {} });
  registry.register({ id: 'a', title: 'Alpha', category: 'App', order: 1, run() {} });
  registry.register({ id: 'c', title: 'Gamma', category: 'App', order: 1, run() {} });
  const titles = registry.list().map((c) => c.id);
  assert.deepEqual(titles, ['a', 'c', 'b']); // App: Alpha then Gamma (title), then View: Beta
});

test('search matches title and keywords case-insensitively', () => {
  const registry = Commands.createRegistry();
  registry.register({ id: 'one', title: 'Open Archive', keywords: ['panel', 'trash'], run() {} });
  registry.register({ id: 'two', title: 'New Column', run() {} });
  assert.equal(registry.search('archive').length, 1);
  assert.equal(registry.search('ARCHIVE')[0].id, 'one');
  assert.equal(registry.search('trash')[0].id, 'one');
  assert.equal(registry.search('column')[0].id, 'two');
  assert.equal(registry.search('zzz').length, 0);
  assert.equal(registry.search('').length, 2, 'empty query lists everything');
});

test('hidden commands are listed nowhere but stay dispatchable', () => {
  const registry = Commands.createRegistry();
  registry.register({ id: 'vis', title: 'Visible', run() {} });
  registry.register({ id: 'hid', title: 'Hidden', hidden: true, run() {} });
  assert.equal(registry.list().length, 1);
  assert.equal(registry.search('hidden').length, 0);
  assert.equal(registry.run('hid', null).ok, true);
});

test('shortcut normalization canonicalizes modifiers', () => {
  assert.equal(Commands.normalizeShortcut('Ctrl+K'), 'mod+k');
  assert.equal(Commands.normalizeShortcut('mod+shift+z'), 'mod+shift+z');
  assert.equal(Commands.normalizeShortcut('cmd+y'), 'mod+y');
  assert.equal(Commands.normalizeShortcut('META+Alt+p'), 'mod+alt+p');
  assert.equal(Commands.normalizeShortcut('n'), 'n');
  assert.equal(Commands.normalizeShortcut(''), null);
  assert.equal(Commands.normalizeShortcut(null), null);
  assert.equal(Commands.normalizeShortcut('mod+'), null);
});

test('findByShortcut matches the canonical form and ignores case', () => {
  const registry = Commands.createRegistry();
  registry.register({ id: 'pal', title: 'Palette', shortcut: 'mod+k', run() {} });
  assert.equal(registry.findByShortcut('mod+k').id, 'pal');
  assert.equal(registry.findByShortcut('Ctrl+K').id, 'pal');
  assert.equal(registry.findByShortcut('k'), null);
});

test('availableIn filters by context availability', () => {
  const registry = Commands.createRegistry();
  registry.register({ id: 'global', title: 'Global', run() {} });
  registry.register({
    id: 'card',
    title: 'Card only',
    scope: 'card',
    available: (ctx) => Boolean(ctx && ctx.cardId),
    run() {}
  });
  assert.equal(registry.availableIn(null).length, 1);
  assert.equal(registry.availableIn({ cardId: 'c1' }).length, 2);
});

test('run executes with context and returns ok', () => {
  const registry = Commands.createRegistry();
  let seen = null;
  registry.register({ id: 'ctx', title: 'Ctx', run: (ctx) => { seen = ctx; } });
  const result = registry.run('ctx', { cardId: 'c1' });
  assert.equal(result.ok, true);
  assert.deepEqual(seen, { cardId: 'c1' });
});

test('run refuses unavailable and missing commands without throwing', () => {
  const registry = Commands.createRegistry();
  registry.register({ id: 'gated', title: 'Gated', available: () => false, run() {} });
  assert.equal(registry.run('gated', null).reason, 'unavailable');
  assert.equal(registry.run('missing', null).reason, 'not-found');
});

test('run catches command errors and reports them', () => {
  const registry = Commands.createRegistry();
  registry.register({ id: 'boom', title: 'Boom', run() { throw new Error('kaput'); } });
  const result = registry.run('boom', null);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'error');
});

test('a throwing available() is treated as unavailable', () => {
  const registry = Commands.createRegistry();
  registry.register({ id: 'flaky', title: 'Flaky', available: () => { throw new Error('x'); }, run() {} });
  assert.equal(registry.availableIn(null).length, 0);
  assert.equal(registry.run('flaky', null).reason, 'unavailable');
});
