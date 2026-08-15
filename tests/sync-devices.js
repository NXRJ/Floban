// Two real devices, a real relay, a real browser.
//
// NOT part of `npm test`. It needs a browser that can complete a WebSocket
// handshake against a local server, and the sandbox this was written in cannot:
// its Chrome refuses every local upgrade with "Incorrect 'Sec-WebSocket-Accept'
// header value" even though a raw socket client proves the token correct on the
// wire (over IPv4 and IPv6, with and without a proxy, against two independent
// servers). So this file has never been run green. Run it where a browser can
// reach a local WebSocket:
//
//   npm run test:sync
//
// What it covers that nothing else can — every one of these is a policy in
// js/sync-session.js that only exists on a live handshake:
//
//   - write-ahead persistence: the document is on disk before the update that
//     produced it leaves the device
//   - create vs join: a device with no history refuses to seed a dormant room
//     rather than starting a rival lineage
//   - the create right is spent on use
//   - a joining device adopts rather than seeds, and edits flow both ways
//     without either side growing a duplicate board
'use strict';

// Declared rather than configured: the page.evaluate callbacks below run in
// the browser, not here, so the linter has to be told which names are theirs.
/* global KB, window, document, localStorage, navigator */

const path = require('path');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

let failures = 0;
function check(name, cond) {
  if (cond) console.log('PASS  ' + name);
  else { console.log('FAIL  ' + name); failures++; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = process.env.SYNC_TEST_PORT || '8192';
const ORIGIN = 'http://localhost:' + PORT;
const RELAY = 'ws://localhost:' + PORT + '/sync';

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'serve.js'), '--sync'], {
    env: Object.assign({}, process.env, { PORT: PORT }),
    stdio: 'ignore'
  });
  await sleep(900);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: process.env.CI ? ['--no-sandbox'] : []
  });

  // Each "device" is its own browser context, so the two get separate origins
  // and therefore separate IndexedDB — a second tab of one origin would share
  // both the board store and the sync document store and prove nothing.
  const devices = [];
  async function device() {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message));
    await page.goto(ORIGIN + '/index.html?boot=off', { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1', { timeout: 8000 });
    // The service worker would serve a stale shell to later contexts.
    await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    });
    const entry = { page: page, context: context };
    devices.push(entry);
    return entry;
  }
  function connected(page) {
    return page.waitForFunction(
      () => KB.SyncSession.state().status === 'connected',
      { timeout: 8000 }
    );
  }

  try {
    const a = await device();
    await a.page.evaluate((url) => KB.SyncSession.enable('e2e', url, { create: true }), RELAY);
    await connected(a.page);
    await a.page.waitForFunction(() => KB.SyncSession.state().fault === null, { timeout: 5000 });
    check('a created room connects and reports no fault', true);

    // The create right is spent on use: a later session has to earn the right
    // to bootstrap by holding the document, not by remembering it once created
    // this room on a since-wiped store.
    check('creating a room spends the create flag', await a.page.evaluate(
      () => JSON.parse(localStorage.getItem('kanban.sync.v1')).create === false
    ));

    // The document is durable BEFORE the update that produced it goes out, so
    // it is already on disk by the time a peer could have seen the identity.
    const cardTitle = 'Written ahead';
    await a.page.evaluate((title) => {
      const board = KB.State.activeBoard();
      KB.State.addCard(board.columns[0].id, { title: title });
    }, cardTitle);
    const persisted = await a.page.evaluate(async (title) => {
      // No wait, no polling: if persistence were debounced this read would
      // miss, which is exactly the race the ordering exists to close.
      const config = JSON.parse(localStorage.getItem('kanban.sync.v1'));
      const bytes = await KB.SyncDocs.load(config.url, 'e2e');
      if (!bytes) return false;
      const doc = KB.Core.YDoc.create({ Y: window.Y });
      doc.restore(bytes);
      return JSON.stringify(doc.toState()).indexOf(title) !== -1;
    }, cardTitle);
    check('a new card is in the persisted document as soon as it is made', persisted);

    // A second device joins and adopts, rather than seeding a rival board.
    const b = await device();
    await b.page.evaluate((url) => KB.SyncSession.enable('e2e', url), RELAY);
    await connected(b.page);
    await b.page.waitForFunction(
      (title) => JSON.stringify(KB.State.data()).indexOf(title) !== -1,
      { timeout: 8000 }, cardTitle
    );
    const joined = await b.page.evaluate(() => ({
      boards: KB.State.data().boards.length,
      fault: KB.SyncSession.state().fault
    }));
    check('a joining device adopts the room rather than seeding it',
      joined.boards === 1 && joined.fault === null);

    await b.page.evaluate(() => {
      const board = KB.State.activeBoard();
      KB.State.addCard(board.columns[0].id, { title: 'From the second device' });
    });
    await a.page.waitForFunction(
      () => JSON.stringify(KB.State.data()).indexOf('From the second device') !== -1,
      { timeout: 8000 }
    );
    check('an edit on the joining device reaches the first', true);
    check('and neither device grew a duplicate board', await a.page.evaluate(
      () => KB.State.data().boards.length === 1
    ));

    // The dormant-room case: a brand-new device joins a room whose members are
    // all offline. The relay forgets a room when its last peer leaves, so it
    // cannot tell that from a room that never existed — the device must refuse
    // to seed rather than start a rival lineage.
    await a.page.evaluate(() => KB.SyncSession.disable());
    await b.page.evaluate(() => KB.SyncSession.disable());
    await sleep(400);
    const c = await device();
    await c.page.evaluate((url) => KB.SyncSession.enable('e2e', url), RELAY);
    await c.page.waitForFunction(
      () => KB.SyncSession.state().fault === 'no-history',
      { timeout: 8000 }
    );
    const refused = await c.page.evaluate(() => ({
      fault: KB.SyncSession.state().fault,
      status: KB.SyncSession.state().status,
      boards: KB.State.data().boards.length
    }));
    check('a device with no history refuses to seed a dormant room',
      refused.fault === 'no-history' && refused.status === 'error');
    check('and its own board is untouched by the refusal', refused.boards >= 1);
  } finally {
    for (const entry of devices) {
      await entry.page.close().catch(() => {});
      await entry.context.close().catch(() => {});
    }
    await browser.close().catch(() => {});
    if (!server.killed) server.kill('SIGKILL');
  }

  console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECKS FAILED');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('TEST CRASH:', e); process.exit(2); });
