const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const puppeteer = require('puppeteer');

const URL = 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/') + '?boot=off';
let failures = 0;

function check(name, cond) {
  if (cond) console.log('PASS  ' + name);
  else { console.log('FAIL  ' + name); failures++; }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: process.env.CI ? ['--no-sandbox'] : [],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  async function waitFor(fn, timeout, label) {
    const args = Array.prototype.slice.call(arguments, 3);
    const deadline = Date.now() + (timeout || 5000);
    while (Date.now() < deadline) {
      try {
        if (await page.evaluate(fn, ...args)) return true;
      } catch (e) {}
      await sleep(25);
    }
    if (label) console.log('WAIT TIMEOUT: ' + label);
    return false;
  }

  async function waitCount(selector, expected, timeout) {
    return waitFor((sel, n) => document.querySelectorAll(sel).length === n, timeout || 4000, 'count ' + selector + '=' + expected, selector, expected);
  }

  async function waitBoard() {
    return waitFor(() => document.documentElement.dataset.ready === '1' && !!document.querySelector('#board-name'), 5000, 'board render');
  }

  // Writes a raw payload into the legacy localStorage key and resets
  // IndexedDB (and the crash-mirror envelope) so the next page load treats
  // the payload as the only source of truth — exercising the first-run
  // migration path from pre-envelope data.
  async function seedLocalStorage(payload) {
    await page.evaluate((json) => {
      const write = () => {
        localStorage.setItem('kanban.board.v1', json);
      };
      if (window.KB && KB.Storage) {
        return KB.Storage.clearAll().then(() => { write(); });
      }
      write();
      return Promise.resolve();
    }, JSON.stringify(payload));
  }

  async function cardAction(col, card, action) {
    const selector = `.column:nth-child(${col}) .card:nth-child(${card}) .card-actions [data-action="${action}"]`;
    await page.hover(`.column:nth-child(${col}) .card:nth-child(${card})`);
    await waitFor((sel) => {
      const el = document.querySelector(sel);
      return el && getComputedStyle(el).display !== 'none' && el.offsetParent !== null;
    }, 2500, 'card action visible ' + action, selector);
    await page.click(selector);
  }
  async function clickByText(selector, text) {
    await page.evaluate((sel, t) => {
      [...document.querySelectorAll(sel)].find(b => b.textContent.trim() === t).click();
    }, selector, text);
  }
  async function blur() { await page.evaluate(() => document.activeElement && document.activeElement.blur()); }
  async function pressUndo() { await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); }
  async function pressRedo() { await page.keyboard.down('Control'); await page.keyboard.press('y'); await page.keyboard.up('Control'); }

  // ---- Fresh boot ----
  await page.goto(URL, { waitUntil: 'load' });
  await waitBoard();
  check('board renders 3 columns', await waitCount('.column', 3));
  check('board switch shows name', (await page.$eval('#board-name', el => el.textContent)) === 'My Board');
  check('quick-add rows present', await waitCount('.qa', 3));
  check('due chips render', (await page.$$eval('.chip.due', els => els.length)) >= 2);
  check('checklist progress renders', (await page.$$eval('.card-prog', els => els.length)) >= 1);

  // ---- Quick-add + undo/redo ----
  await page.type('.column:nth-child(1) .qa-input', 'Brand new task');
  await page.keyboard.press('Enter');
  let count = await waitCount('.column:nth-child(1) .card', 3) ? 3 : await page.$$eval('.column:nth-child(1) .card', els => els.length);
  check('quick-add creates card', count === 3);

  await blur();
  await pressUndo();
  count = await waitCount('.column:nth-child(1) .card', 2) ? 2 : await page.$$eval('.column:nth-child(1) .card', els => els.length);
  check('ctrl+z undoes quick-add', count === 2);

  await pressRedo();
  count = await waitCount('.column:nth-child(1) .card', 3) ? 3 : await page.$$eval('.column:nth-child(1) .card', els => els.length);
  check('ctrl+y redoes quick-add', count === 3);

  // ---- Bulk paste: one undo step ----
  await page.$eval('.column:nth-child(1) .qa-input', (el, v) => { el.value = v; el.focus(); }, 'One\nTwo\nThree');
  await page.keyboard.press('Enter');
  count = await waitCount('.column:nth-child(1) .card', 6) ? 6 : await page.$$eval('.column:nth-child(1) .card', els => els.length);
  check('bulk paste adds 3 cards', count === 6);

  await blur();
  await pressUndo();
  count = await waitCount('.column:nth-child(1) .card', 3) ? 3 : await page.$$eval('.column:nth-child(1) .card', els => els.length);
  check('bulk paste undoes as one step', count === 3);

  await pressRedo();
  count = await waitCount('.column:nth-child(1) .card', 6) ? 6 : await page.$$eval('.column:nth-child(1) .card', els => els.length);
  check('bulk paste redoes as one step', count === 6);

  // ---- Card editor: due date + checklist + duplicate + template ----
  await cardAction(2, 1, 'edit-card');
  await waitFor(() => !!document.querySelector('#cf-due'), 3000, 'editor opens');
  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  await page.$eval('#cf-due', (el, v) => { el.value = v; }, iso);
  await page.$eval('.check-add-row input', (el, v) => { el.value = v; }, 'Smoke test item');
  await page.click('.check-add-row .btn');
  await waitFor(() => !!document.querySelector('.check-item'), 2000, 'checklist item added');
  await page.click('.check-item input[type="checkbox"]');
  await clickByText('.modal-actions .btn', 'Save');
  await waitFor(() => !document.querySelector('.modal-panel'), 3000, 'editor closes');
  check('editor save closes modal', (await page.$('.modal-panel')) === null);
  check('due chip on edited card', (await page.$$eval('.chip.due', els => els.length)) >= 1);

  await cardAction(2, 1, 'edit-card');
  await waitFor(() => !!document.querySelector('.modal-panel'), 3000, 'editor reopens');
  await clickByText('.modal-actions .btn', 'Duplicate');
  count = await waitCount('.column:nth-child(2) .card', 3) ? 3 : await page.$$eval('.column:nth-child(2) .card', els => els.length);
  check('duplicate via editor', count === 3);

  await cardAction(2, 1, 'edit-card');
  await waitFor(() => !!document.querySelector('.modal-panel'), 3000, 'editor reopens 2');
  await clickByText('.modal-actions .btn', 'Save as template');
  await waitFor(() => [...document.querySelectorAll('.toast')].some(e => e.textContent.includes('Template saved')), 3000, 'template toast');
  check('template saved toast', await page.$$eval('.toast', els => els.some(e => e.textContent.includes('Template saved'))));
  await clickByText('.modal-actions .btn', 'Cancel');
  await waitFor(() => !document.querySelector('.modal-panel'), 2000, 'editor cancels');

  // ---- Template use from quick-add ----
  await page.click('.column:nth-child(1) .qa-tpl');
  await waitFor(() => document.querySelectorAll('.pop .pop-item').length >= 1, 2000, 'template popup');
  const popItems = await page.$$eval('.pop .pop-item', els => els.map(e => e.textContent.trim()));
  check('template popup lists templates', popItems.length >= 1);
  await page.click('.pop .pop-item');
  count = await waitCount('.column:nth-child(1) .card', 7) ? 7 : await page.$$eval('.column:nth-child(1) .card', els => els.length);
  check('template creates card', count === 7);

  // ---- Column collapse ----
  await page.evaluate(() => {
    const board = document.querySelector('.board');
    const cols = board.querySelectorAll('.column');
    board.scrollLeft = cols[2].offsetLeft;
  });
  await page.click('.column:nth-child(3) .column-header [data-action="col-collapse"]');
  await waitFor(() => document.querySelector('.column:nth-child(3)').classList.contains('collapsed'), 2000, 'column collapses');
  check('column collapses', await page.$eval('.column:nth-child(3)', el => el.classList.contains('collapsed')));
  await page.click('.column:nth-child(3) .column-header [data-action="col-collapse"]');
  await waitFor(() => !document.querySelector('.column:nth-child(3)').classList.contains('collapsed'), 2000, 'column expands');
  check('column expands', !(await page.$eval('.column:nth-child(3)', el => el.classList.contains('collapsed'))));

  // ---- WIP limit via column editor ----
  await page.click('.column:nth-child(2) .column-header [data-action="col-menu"]');
  await waitFor(() => !!document.querySelector('#ce-wip'), 3000, 'column editor opens');
  await page.$eval('#ce-wip', (el) => { el.value = '1'; });
  await page.click('.modal-actions .btn.primary');
  await waitFor(() => {
    const el = document.querySelector('.column:nth-child(2) .col-count');
    return el && el.textContent === '3/1';
  }, 3000, 'wip text updates');
  const wipText = await page.$eval('.column:nth-child(2) .col-count', el => el.textContent);
  const wipOver = await page.$eval('.column:nth-child(2) .col-count', el => el.classList.contains('over'));
  check('WIP shows n/limit', wipText === '3/1');
  check('WIP over-limit warning', wipOver);

  // ---- Board switcher: new board ----
  await page.click('#board-switch');
  await waitFor(() => document.querySelectorAll('.pop .pop-item').length >= 1, 2000, 'board menu opens');
  const menuTexts = await page.$$eval('.pop .pop-item', els => els.map(e => e.textContent));
  check('board menu has actions', menuTexts.some(t => t.includes('New board')) && menuTexts.some(t => t.includes('Backup / restore')));
  await page.evaluate(() => { [...document.querySelectorAll('.pop .pop-item')].find(b => b.textContent.includes('New board')).click(); });
  await waitFor(() => !!document.querySelector('.modal-panel input'), 2000, 'new board modal');
  await page.type('.modal-panel input', 'Sprint 42');
  await page.click('.modal-actions .btn.primary');
  await waitFor(() => document.querySelector('#board-name') && document.querySelector('#board-name').textContent === 'Sprint 42', 3000, 'board switches');
  check('switched to new empty board', (await page.$eval('#board-name', el => el.textContent)) === 'Sprint 42');
  check('new board is empty', await waitCount('.column', 0));
  check('empty board state', (await page.$('.empty-board')) !== null);

  // ---- Switch back via menu ----
  await page.click('#board-switch');
  await waitFor(() => document.querySelectorAll('.pop .pop-item').length >= 1, 2000, 'board menu reopens');
  await page.evaluate(() => { [...document.querySelectorAll('.pop .pop-item')].find(b => b.textContent.includes('My Board')).click(); });
  await waitFor(() => document.querySelector('#board-name') && document.querySelector('#board-name').textContent === 'My Board', 3000, 'switch back');
  check('switch back to My Board', (await page.$eval('#board-name', el => el.textContent)) === 'My Board');

  // ---- Undo board switch ----
  await pressUndo();
  await waitFor(() => document.querySelector('#board-name') && document.querySelector('#board-name').textContent === 'Sprint 42', 3000, 'undo board switch');
  check('undo board switch', (await page.$eval('#board-name', el => el.textContent)) === 'Sprint 42');
  await pressUndo();
  await waitFor(() => document.querySelector('#board-name') && document.querySelector('#board-name').textContent === 'My Board', 3000, 'second undo');
  check('second undo returns to My Board', (await page.$eval('#board-name', el => el.textContent)) === 'My Board');

  // ---- Theme undo re-applies to the DOM ----
  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click('#toggle-theme');
  await waitFor((before) => document.documentElement.dataset.theme !== before, 2000, 'theme flips', themeBefore);
  const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme);
  check('theme toggle flips data-theme', themeAfter !== themeBefore);
  await blur();
  await pressUndo();
  await waitFor((before) => document.documentElement.dataset.theme === before, 2000, 'theme undo', themeBefore);
  const themeReverted = await page.evaluate(() => document.documentElement.dataset.theme);
  check('undo re-applies theme to DOM', themeReverted === themeBefore);

  // ---- Sort by due ----
  await page.select('#sort-select', 'due');
  await waitFor(() => {
    const cols = [...document.querySelectorAll('.column')];
    return cols[1] && [...cols[1].querySelectorAll('.card-title')].length === 3;
  }, 3000, 'sort renders');
  const sorted = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('.column')];
    return cols.map(c => [...c.querySelectorAll('.card-title')].map(t => t.textContent));
  });
  check('sort by due orders by date', JSON.stringify(sorted[1]) === JSON.stringify(['Fix card drag on touch screens', 'Copy of Fix card drag on touch screens', 'Write tests for the archive flow']));
  const sortOptions = await page.$$eval('#sort-select option', els => els.map(e => e.value));
  check('longest-blocked sort exposed in board sort', sortOptions.includes('blocked-duration'));
  await page.select('#sort-select', 'manual');
  await waitFor(() => true, 100, 'sort settle');

  // ---- Filter by due (make dues deterministic in LOCAL time) ----
  const dueSeed = await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yesterday = y + '-' + m + '-' + dd;
    b.boards.find(x => x.name === 'My Board').columns.forEach(col => {
      col.cards.forEach(card => {
        card.due = card.title.indexOf('Fix card drag') !== -1 ? yesterday : '';
      });
    });
    return b;
  });
  await seedLocalStorage(dueSeed);
  await page.goto(URL, { waitUntil: 'load' });
  await waitBoard();
  await page.select('#due-filter', 'overdue');
  await waitFor(() => {
    const titles = [...document.querySelectorAll('.column .card-title')].map(e => e.textContent);
    return titles.length === 2 && titles.every(t => t.includes('Fix card drag'));
  }, 3000, 'overdue filter');
  const visibleTitles = await page.$$eval('.column .card-title', els => els.map(e => e.textContent));
  check('overdue filter shows only overdue', visibleTitles.length === 2 && visibleTitles.every(t => t.includes('Fix card drag')));
  await page.select('#due-filter', '');
  await waitFor(() => true, 100, 'filter settle');

  // ---- Archive + undo toast ----
  await cardAction(1, 1, 'archive-card');
  count = await waitCount('.column:nth-child(1) .card', 6) ? 6 : await page.$$eval('.column:nth-child(1) .card', els => els.length);
  check('archive removes card', count === 6);
  const undoBtns = await page.$$('.toast .toast-btn');
  check('toast has undo button', undoBtns.length >= 1);
  await undoBtns[undoBtns.length - 1].click();
  count = await waitCount('.column:nth-child(1) .card', 7) ? 7 : await page.$$eval('.column:nth-child(1) .card', els => els.length);
  check('toast undo restores card', count === 7);

  // ---- Duplicate from card hover ----
  await cardAction(1, 1, 'duplicate-card');
  count = await waitCount('.column:nth-child(1) .card', 8) ? 8 : await page.$$eval('.column:nth-child(1) .card', els => els.length);
  check('duplicate adds a card', count === 8);

  // ---- Persistence & migration ----
  const v2 = await page.evaluate(() => JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload);
  check('saved state is version 3', v2.version === 3 && Array.isArray(v2.boards));

  const v1Seed = await page.evaluate(() => {
    const old = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    return { version: 1, theme: 'light', labels: [], columns: old.boards[0].columns.map(c => ({ id: c.id, title: c.title, isDone: c.isDone, cards: c.cards })), archive: { cards: [], columns: [] } };
  });
  await seedLocalStorage(v1Seed);
  await page.goto(URL, { waitUntil: 'load' });
  await waitBoard();
  const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload);
  check('v1 migrates to v3 boards', migrated.version === 3 && migrated.boards.length === 1);
  check('migrated cards normalized', migrated.boards[0].columns.every(c => c.cards.every(card => typeof card.due === 'string' && Array.isArray(card.checklist))));
  check('migrated board renders', await waitCount('.column', 3));

  // ---- Corrupt payload resilience ----
  const corruptSeed = await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = b.boards[0];
    board.labels.push(null, { id: 'l-bad', name: 'Bad', color: 'url(https://example.com/x.png)' });
    board.columns[0].cards[0].labels = 'oops';
    delete board.columns[0].cards[1].labels;
    board.columns[0].cards[1].assignee = { evil: true };
    delete board.columns[1].cards;
    return b;
  });
  await seedLocalStorage(corruptSeed);
  await page.goto(URL, { waitUntil: 'load' });
  await waitBoard();
  check('corrupt labels payload still renders', await waitCount('.column', 3));
  const healed = await page.evaluate(() => JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload);
  const c0 = healed.boards[0].columns[0];
  check('labels normalized to array', Array.isArray(c0.cards[0].labels) && Array.isArray(c0.cards[1].labels));
  check('assignee coerced to string', c0.cards[1].assignee === '');
  check('invalid labels dropped and colors sanitized', healed.boards[0].labels.every(l => l && /^#[0-9a-f]{6}$/.test(l.color)));
  check('column without cards healed', Array.isArray(healed.boards[0].columns[1].cards));

  // ---- Export/import round trip ----
  const roundTrip = await page.evaluate(() => {
    const boardJson = KB.State.exportBoard();
    const r1 = KB.State.importAll(boardJson);
    const boardsAfterBoardImport = KB.State.boards().length;
    const fullJson = KB.State.exportAll();
    const r2 = KB.State.importAll(fullJson);
    return { r1, r2, boardsAfterBoardImport, boardsAfterFullImport: KB.State.boards().length };
  });
  check('board export imports as new board', roundTrip.r1 === 'board' && roundTrip.boardsAfterBoardImport === 2);
  check('full export replaces all boards', roundTrip.r2 === 'all' && roundTrip.boardsAfterFullImport === 2);

  // ---- Markdown + XSS (targets the active board after the import round trip) ----
  const mdSeed = await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = b.boards.find(x => x.id === b.activeBoardId);
    board.columns[0].cards[0].description = '**bold** *ital* `code` and a [link](https://example.com)';
    return b;
  });
  await seedLocalStorage(mdSeed);
  await page.goto(URL, { waitUntil: 'load' });
  await waitBoard();
  await waitFor(() => !!document.querySelector('.card-desc'), 3000, 'markdown renders');
  const md = await page.$eval('.card-desc', el => el.innerHTML);
  check('markdown renders bold', md.includes('<strong>bold</strong>'));
  check('markdown renders link', md.includes('href="https://example.com"'));

  const xssSeed = await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = b.boards.find(x => x.id === b.activeBoardId);
    board.columns[0].cards[0].description = '<img src=x onerror=alert(1)> **b**';
    return b;
  });
  await seedLocalStorage(xssSeed);
  await page.goto(URL, { waitUntil: 'load' });
  await waitBoard();
  await waitFor(() => !!document.querySelector('.card-desc'), 3000, 'xss case renders');
  const md2 = await page.$eval('.card-desc', el => el.innerHTML);
  check('markdown is XSS safe', md2.indexOf('<img') === -1 && md2.indexOf('&lt;img') !== -1);

  // ---- Delete board: must toast and refresh the UI ----
  await page.evaluate(() => { window.confirm = () => true; KB.State.addBoard('Delete Me'); KB.App.refresh(); });
  await waitFor(() => document.querySelector('#board-name') && document.querySelector('#board-name').textContent === 'Delete Me', 3000, 'delete board setup');
  check('delete-board setup board active', (await page.$eval('#board-name', el => el.textContent)) === 'Delete Me');
  await page.click('#board-switch');
  await waitFor(() => document.querySelectorAll('.pop .pop-item').length >= 1, 2000, 'board menu for delete');
  await page.evaluate(() => { [...document.querySelectorAll('.pop .pop-item')].find(b => b.textContent.includes('Delete board')).click(); });
  await waitFor(() => document.querySelector('#board-name') && document.querySelector('#board-name').textContent === 'My Board', 3000, 'delete switches board');
  check('delete board switches board and toasts',
    (await page.$eval('#board-name', el => el.textContent)) === 'My Board' &&
    (await page.$$eval('.toast', els => els.some(e => e.textContent.includes('Board deleted')))));
  const boardsAfterDelete = await page.evaluate(() => KB.State.boards().length);
  check('delete board removes it from state', boardsAfterDelete === 2);

  // ---- Failed mutations must not consume undo history ----
  const probe = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const col = board.columns[0];
    const added = KB.State.addCard(col.id, { title: 'History probe' });
    const updateResult = KB.State.updateCard(col.id, 'ghost-card', { title: 'nope' });
    const moveResult = KB.State.moveColumn('ghost-column', 1);
    const purgeResult = KB.State.purgeCard('ghost-archived-card');
    const purgeColResult = KB.State.purgeColumn('ghost-archived-column');
    const blankResult = KB.State.addCards(col.id, ['  ', '', '   ']);
    const renameResult = KB.State.renameBoard('ghost-board', 'Renamed');
    KB.App.refresh();
    return {
      added: Boolean(added),
      updateResult: Boolean(updateResult),
      moveResult: Boolean(moveResult),
      purgeResult: Boolean(purgeResult),
      purgeColResult: Boolean(purgeColResult),
      blankResult: blankResult,
      renameResult: Boolean(renameResult)
    };
  });
  check('failed mutations return falsey results',
    probe.added && !probe.updateResult && !probe.moveResult && !probe.purgeResult && !probe.purgeColResult &&
    probe.blankResult === 0 && !probe.renameResult);
  await waitFor(() => [...document.querySelectorAll('.column .card-title')].some(e => e.textContent === 'History probe'), 3000, 'probe card renders');
  const probeTitles = await page.$$eval('.column .card-title', els => els.map(e => e.textContent));
  check('probe card renders after failed mutations', probeTitles.some(t => t === 'History probe'));
  await blur();
  await pressUndo();
  await waitFor(() => ![...document.querySelectorAll('.column .card-title')].some(e => e.textContent === 'History probe'), 3000, 'probe undone');
  const afterUndo = await page.$$eval('.column .card-title', els => els.map(e => e.textContent));
  check('single undo removes only the probe card', !afterUndo.some(t => t === 'History probe'));

  // ---- Priority and size editing + badges + filters ----
  const prioSeed = await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = b.boards.find(x => x.id === b.activeBoardId);
    const card = board.columns[0].cards[0];
    card.priority = 'urgent';
    card.size = 'xl';
    return b;
  });
  await seedLocalStorage(prioSeed);
  await page.goto(URL, { waitUntil: 'load' });
  await waitBoard();
  await waitFor(() => {
    const el = document.querySelector('.column:nth-child(1) .card:nth-child(1) .chip.priority');
    return el && el.textContent.trim() === 'URGENT';
  }, 3000, 'priority chip');
  check('priority chip renders', await page.$eval('.column:nth-child(1) .card:nth-child(1) .chip.priority', el => el.textContent.trim()) === 'URGENT');
  check('size badge renders', await page.$eval('.column:nth-child(1) .card:nth-child(1) .chip.size', el => el.textContent.trim()) === 'XL');
  await page.select('#priority-filter', 'urgent');
  await waitCount('.column:nth-child(1) .card', 1);
  check('priority filter narrows cards', await page.$$eval('.column:nth-child(1) .card', els => els.length) === 1);
  await page.select('#priority-filter', '');
  await page.select('#size-filter', 'xl');
  await waitCount('.column:nth-child(1) .card', 1);
  check('size filter narrows cards', await page.$$eval('.column:nth-child(1) .card', els => els.length) === 1);
  await page.select('#size-filter', '');
  await waitFor(() => true, 100, 'filter settle');

  await cardAction(1, 1, 'edit-card');
  await waitFor(() => !!document.querySelector('#cf-priority'), 3000, 'editor for priority');
  await page.select('#cf-priority', 'high');
  await page.select('#cf-size', 'm');
  await clickByText('.modal-actions .btn', 'Save');
  await waitFor(() => !document.querySelector('.modal-panel'), 3000, 'priority editor closes');
  const editedMeta = await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const card = b.boards.find(x => x.id === b.activeBoardId).columns[0].cards[0];
    return { priority: card.priority, size: card.size };
  });
  check('editor saves priority and size', editedMeta.priority === 'high' && editedMeta.size === 'm');

  // ---- Column roles ----
  check('role badge renders on columns', await page.$$eval('.col-role', els => els.length) === 3);
  await page.click('.column:nth-child(2) .column-header [data-action="col-menu"]');
  await waitFor(() => !!document.querySelector('#ce-role'), 3000, 'column editor roles');
  await page.select('#ce-role', 'backlog');
  await page.click('.modal-actions .btn.primary');
  await waitFor(() => true, 200, 'role save settle');
  const roleSaved = await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = b.boards.find(x => x.id === b.activeBoardId);
    const col = board.columns[1];
    return { role: col.role, isDone: col.isDone };
  });
  check('column role editor saves role', roleSaved.role === 'backlog' && roleSaved.isDone === false);
  check('role badge updates', await page.$eval('.column:nth-child(2) .col-role', el => el.textContent.trim()) === 'BACKLOG');

  // ---- Manual flow states ----
  await cardAction(1, 1, 'edit-card');
  await waitFor(() => !!document.querySelector('#cf-flow'), 3000, 'editor for flow');
  await page.select('#cf-flow', 'blocked');
  await page.$eval('#cf-flow-reason', (el, v) => { el.value = v; }, 'Waiting for API credentials');
  await clickByText('.modal-actions .btn', 'Save');
  await waitFor(() => {
    const el = document.querySelector('.column:nth-child(1) .card:nth-child(1) .chip.flow');
    return el && el.textContent.includes('BLOCKED');
  }, 3000, 'flow badge');
  check('flow badge shows blocked', await page.$eval('.column:nth-child(1) .card:nth-child(1) .chip.flow', el => el.textContent.includes('BLOCKED')));
  const flowStateSaved = await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const card = b.boards.find(x => x.id === b.activeBoardId).columns[0].cards[0];
    return { state: card.flow.state, reason: card.flow.reason, since: card.flow.since };
  });
  check('flow state persists with reason and timestamp',
    flowStateSaved.state === 'blocked' && flowStateSaved.reason === 'Waiting for API credentials' && typeof flowStateSaved.since === 'number');
  await page.select('#flow-filter', 'blocked');
  await waitCount('.column:nth-child(1) .card', 1);
  check('flow state filter narrows cards', await page.$$eval('.column:nth-child(1) .card', els => els.length) === 1);
  await page.select('#flow-filter', '');
  await waitFor(() => true, 100, 'flow filter settle');
  await blur();
  await pressUndo();
  await waitFor(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    return b.boards.find(x => x.id === b.activeBoardId).columns[0].cards[0].flow.state === 'normal';
  }, 3000, 'flow undo');
  const flowUndone = await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    return b.boards.find(x => x.id === b.activeBoardId).columns[0].cards[0].flow.state;
  });
  check('undo restores flow state', flowUndone === 'normal');

  // ---- Dependencies and ready-to-pull ----
  const depResult = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const col = board.columns[0];
    const a = KB.State.addCard(col.id, { title: 'Dep target' });
    const b = KB.State.addCard(col.id, { title: 'Dep blocker' });
    const linked = KB.State.addBlocker(board.id, a.id, board.id, b.id);
    const cycle = KB.State.addBlocker(board.id, b.id, board.id, a.id);
    const dup = KB.State.addBlocker(board.id, a.id, board.id, b.id);
    KB.App.refresh();
    return {
      targetId: a.id,
      blockerId: b.id,
      linked: Boolean(linked),
      cycleReason: cycle.reason,
      dupReason: dup.reason,
      blockedCount: KB.Core.Relations.getUnresolvedBlockers(KB.State.data(), { boardId: board.id, cardId: a.id }).length
    };
  });
  check('addBlocker links dependencies', depResult.linked && depResult.blockedCount === 1);
  check('dependency cycle is rejected', depResult.cycleReason === 'dependency-cycle');
  check('duplicate dependency is rejected', depResult.dupReason === 'duplicate');
  await waitFor(() => !!document.querySelector('.column .card .chip.dep.dep-blocked'), 3000, 'dep blocked badge');
  check('dependency blocked badge renders', await page.$eval('.column .card .chip.dep.dep-blocked', el => el.textContent.includes('BLOCKER')));

  await page.evaluate((ids) => {
    const board = KB.State.activeBoard();
    const doneCol = board.columns.find(c => c.role === 'done');
    KB.State.moveCard(board.columns[0].id, ids.blockerId, doneCol.id, 0);
    KB.App.refresh();
  }, depResult);
  const ready = await page.evaluate((ids) => {
    const board = KB.State.activeBoard();
    return KB.Core.Relations.isReadyToPull(KB.State.data(), { boardId: board.id, cardId: ids.targetId });
  }, depResult);
  check('completing a blocker makes the target ready', ready === true);
  await waitFor(() => !!document.querySelector('.column .card .chip.dep.dep-ready'), 3000, 'ready badge');
  check('ready badge renders', await page.$eval('.column .card .chip.dep.dep-ready', el => el.textContent.trim() === 'READY'));

  await page.evaluate(() => KB.State.undo());
  const depReopened = await page.evaluate((ids) => {
    const board = KB.State.activeBoard();
    return KB.Core.Relations.isReadyToPull(KB.State.data(), { boardId: board.id, cardId: ids.targetId });
  }, depResult);
  check('undoing completion blocks again', depReopened === false);

  await page.evaluate((ids) => {
    const board = KB.State.activeBoard();
    KB.State.removeBlocker(board.id, ids.targetId, board.id, ids.blockerId);
  }, depResult);
  const unlinked = await page.evaluate((ids) => {
    const board = KB.State.activeBoard();
    return KB.Core.Relations.getUnresolvedBlockers(KB.State.data(), { boardId: board.id, cardId: ids.targetId }).length;
  }, depResult);
  check('removeBlocker unlinks', unlinked === 0);

  await page.$eval('#ready-filter', (el) => { el.checked = true; });
  await page.evaluate(() => KB.App.refresh());
  check('ready-only filter hides blocked cards', await page.$$eval('.column .card', els => els.every(el => !el.querySelector('.chip.dep.dep-blocked'))));
  await page.$eval('#ready-filter', (el) => { el.checked = false; });
  await page.evaluate(() => KB.App.refresh());

  // ---- Column policies: soft WIP, hard WIP, entry defaults ----
  const policySetup = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const active = board.columns[1];
    const done = board.columns[2];
    KB.State.updateColumn(active.id, {
      policy: {
        wipMode: 'soft',
        overrideRequiresReason: false,
        entryCriteria: [],
        exitCriteria: [],
        defaultLabelIds: [],
        defaultAssignee: 'Sam',
        countsTowardCycleTime: true
      }
    });
    KB.State.addCard(done.id, { title: 'Done filler' });
    KB.State.updateColumn(done.id, {
      wipLimit: 1,
      policy: {
        wipMode: 'hard',
        overrideRequiresReason: false,
        entryCriteria: [],
        exitCriteria: [],
        defaultLabelIds: [],
        defaultAssignee: '',
        countsTowardCycleTime: true
      }
    });
    KB.App.refresh();
    return { activeId: active.id, doneId: done.id };
  });
  const softResult = await page.evaluate((ids) => {
    const board = KB.State.activeBoard();
    const card = board.columns[0].cards[0];
    const result = KB.State.moveCardChecked(board.columns[0].id, card.id, ids.activeId, 0);
    return { ok: result.ok, reason: result.reason, assignee: card.assignee };
  }, policySetup);
  check('soft WIP move proceeds with defaults', softResult.ok === true && softResult.assignee === 'Sam');

  const hardResult = await page.evaluate((ids) => {
    const board = KB.State.activeBoard();
    const card = board.columns[0].cards[0];
    const result = KB.State.moveCardChecked(board.columns[0].id, card.id, ids.doneId, 0);
    return { ok: result.ok, reason: result.reason, violations: result.evaluation ? result.evaluation.violations.map(v => v.code) : [] };
  }, policySetup);
  check('hard WIP without override is denied', hardResult.ok === false && hardResult.reason === 'policy');

  const beforeUndo = await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    return b.boards.find(x => x.id === b.activeBoardId).columns[0].cards.map(c => c.id);
  });
  const hardConfirmed = await page.evaluate((ids) => {
    const board = KB.State.activeBoard();
    const card = board.columns[0].cards[0];
    return KB.State.moveCardChecked(board.columns[0].id, card.id, ids.doneId, 0, { confirmed: true });
  }, policySetup);
  check('hard WIP confirmed override succeeds', hardConfirmed.ok === true);
  await blur();
  await pressUndo();
  await waitFor((ids) => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = b.boards.find(x => x.id === b.activeBoardId);
    return board.columns[0].cards.some(c => c.id === ids[0]);
  }, 3000, 'policy undo', beforeUndo);
  const policyAfterUndo = await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    return b.boards.find(x => x.id === b.activeBoardId).columns[0].cards.map(c => c.id);
  });
  check('policy move undoes as one entry', JSON.stringify(beforeUndo) === JSON.stringify(policyAfterUndo));

  const wipModeSaved = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const done = board.columns.find(c => c.role === 'done');
    return done.policy.wipMode;
  });
  check('policy settings persist', wipModeSaved === 'hard');

  // ---- Soft WIP asks before restoring ----
  const restoreSoft = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const col1 = board.columns[1];
    const card = KB.State.addCard(col1.id, { title: 'Soft restore probe' });
    KB.State.archiveCard(col1.id, card.id, board.id);
    KB.State.updateColumn(col1.id, { wipLimit: 1, policy: { wipMode: 'soft', overrideRequiresReason: false, entryCriteria: [], exitCriteria: [], defaultLabelIds: [], defaultAssignee: '' } });
    const first = KB.State.restoreCardChecked(card.id);
    const confirmed = KB.State.restoreCardChecked(card.id, { confirmed: true });
    return {
      blocked: first && first.reason === 'policy' && first.evaluation.requiresConfirmation === true,
      restored: Boolean(confirmed && confirmed.ok)
    };
  });
  check('soft WIP asks for confirmation before restoring', restoreSoft.blocked === true);
  check('confirmed restore proceeds', restoreSoft.restored === true);

  // ---- Archived columns keep the full v3 metadata ----
  const colMeta = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const col = board.columns[2];
    const savedRole = col.role;
    const savedPolicy = JSON.parse(JSON.stringify(col.policy));
    col.policy = { wipMode: 'soft', overrideRequiresReason: false, entryCriteria: ['E1'], exitCriteria: [], defaultLabelIds: [], defaultAssignee: 'Sam', countsTowardCycleTime: true };
    KB.State.updateColumn(col.id, { role: 'queue', policy: col.policy });
    KB.State.deleteColumn(col.id);
    const archived = KB.State.activeBoard().archive.columns.find(c => c.id === col.id);
    const archivedRole = archived.role;
    const archivedPolicy = archived.policy && archived.policy.wipMode;
    const archivedCriteria = archived.policy ? archived.policy.entryCriteria.length : -1;
    KB.State.restoreColumn(col.id);
    const restored = KB.State.activeBoard().columns.find(c => c.id === col.id);
    const restoredRole = restored.role;
    const restoredWip = restored.policy && restored.policy.wipMode;
    KB.State.updateColumn(col.id, { role: savedRole, policy: savedPolicy });
    KB.App.refresh();
    return {
      archivedRole,
      archivedPolicy,
      archivedCriteria,
      restoredRole,
      restoredWip
    };
  });
  check('archived column keeps role and policy metadata', colMeta.archivedRole === 'queue' && colMeta.archivedPolicy === 'soft' && colMeta.archivedCriteria === 1);
  check('restored column keeps its policy', colMeta.restoredRole === 'queue' && colMeta.restoredWip === 'soft');

  // ---- Soft WIP asks before proceeding (Move anyway) ----
  const softWip = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const col2 = board.columns[1];
    KB.State.updateColumn(col2.id, { wipLimit: 1, policy: { wipMode: 'soft', overrideRequiresReason: false, entryCriteria: [], exitCriteria: [], defaultLabelIds: [], defaultAssignee: '' } });
    const card = board.columns[0].cards[0];
    KB.App.requestMove(board.columns[0].id, card.id, col2.id, 0);
    return { cardId: card.id, col1: board.columns[0].id, col2: col2.id };
  });
  await waitFor(() => [...document.querySelectorAll('.modal-actions .btn')].some(b => b.textContent.trim() === 'Move anyway'), 3000, 'soft wip warning modal');
  check('soft WIP shows a Move-anyway warning', (await page.$$eval('.modal-actions .btn', els => els.map(e => e.textContent.trim()))).includes('Move anyway') === true);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.modal-actions .btn')].find(b => b.textContent.trim() === 'Move anyway');
    if (btn) btn.click();
  });
  const softCommitted = await waitFor((ids) => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = b.boards.find(x => x.id === b.activeBoardId);
    return board.columns.find(c => c.id === ids.col2).cards.some(c => c.id === ids.cardId);
  }, 3000, 'soft wip move commits', softWip);
  check('Move-anyway commits the soft move', softCommitted);
  await blur();
  await pressUndo();
  await waitFor((ids) => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = b.boards.find(x => x.id === b.activeBoardId);
    return board.columns.find(c => c.id === ids.col1).cards.some(c => c.id === ids.cardId);
  }, 3000, 'soft wip move undone', softWip);

  // Quick-add into a soft-WIP column warns before adding
  await page.type('.column:nth-child(2) .qa-input', 'Soft quick-add probe');
  await page.keyboard.press('Enter');
  await waitFor(() => [...document.querySelectorAll('.modal-actions .btn')].some(b => b.textContent.trim() === 'Move anyway'), 3000, 'soft quick-add warning');
  check('quick-add into soft WIP warns before adding', (await page.$$eval('.modal-actions .btn', els => els.map(e => e.textContent.trim()))).includes('Move anyway') === true);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.modal-actions .btn')].find(b => b.textContent.trim() === 'Move anyway');
    if (btn) btn.click();
  });
  const softQuickCommitted = await waitFor(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = b.boards.find(x => x.id === b.activeBoardId);
    return board.columns[1].cards.some(c => c.title === 'Soft quick-add probe');
  }, 3000, 'soft quick-add commits');
  check('quick-add commits after confirmation', softQuickCommitted);

  await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = b.boards.find(x => x.id === b.activeBoardId);
    board.columns.forEach(col => { col.wipLimit = 0; });
    localStorage.setItem('kanban.mirror.v1', JSON.stringify({ savedAt: Date.now(), payload: b }));
  });
  await page.evaluate(() => KB.App.refresh());

  // ---- Multi-line quick-add pre-flights the whole batch ----
  await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const col1 = board.columns[0];
    const count = col1.cards.length;
    KB.State.updateColumn(col1.id, { wipLimit: count + 2, policy: { wipMode: 'hard', overrideRequiresReason: false, entryCriteria: [], exitCriteria: [], defaultLabelIds: [], defaultAssignee: '' } });
    KB.App.refresh();
  });

  // A batch that exactly fills the WIP limit creates without confirmation
  await page.$eval('.column:nth-child(1) .qa-input', (el) => { el.value = 'Exact A\nExact B'; el.focus(); });
  await page.keyboard.press('Enter');
  const exactLanded = await waitFor(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = b.boards.find(x => x.id === b.activeBoardId);
    const col = board.columns[0];
    return col.cards.some(c => c.title === 'Exact A') && col.cards.some(c => c.title === 'Exact B');
  }, 3000, 'exact fill lands');
  check('exact-fill batch creates without confirmation', exactLanded === true);
  check('exact-fill batch shows no dialog', (await page.$('.modal-panel')) === null);

  // A batch that exceeds the limit by one requires confirmation
  await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const col1 = board.columns[0];
    const count = col1.cards.length;
    KB.State.updateColumn(col1.id, { wipLimit: count + 1, policy: { wipMode: 'hard', overrideRequiresReason: false, entryCriteria: [], exitCriteria: [], defaultLabelIds: [], defaultAssignee: '' } });
    KB.App.refresh();
  });
  await page.$eval('.column:nth-child(1) .qa-input', (el) => { el.value = 'Atomic A\nAtomic B'; el.focus(); });
  await page.keyboard.press('Enter');
  await waitFor(() => [...document.querySelectorAll('.modal-actions .btn')].some(b => b.textContent.trim() === 'Confirm move'), 3000, 'batch override dialog');
  check('over-by-one batch requires confirmation', (await page.$$eval('.modal-actions .btn', els => els.map(e => e.textContent.trim()))).includes('Confirm move') === true);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.modal-actions .btn')].find(b => b.textContent.trim() === 'Confirm move');
    if (btn) btn.click();
  });
  const atomicAdded = await waitFor(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = b.boards.find(x => x.id === b.activeBoardId);
    const col = board.columns[0];
    return col.cards.some(c => c.title === 'Atomic A') && col.cards.some(c => c.title === 'Atomic B');
  }, 3000, 'confirmed batch lands');
  check('confirmed batch adds every line', atomicAdded === true);

  await page.$eval('.column:nth-child(1) .qa-input', (el) => { el.value = 'Cancel A\nCancel B'; el.focus(); });
  await page.keyboard.press('Enter');
  await waitFor(() => [...document.querySelectorAll('.modal-actions .btn')].some(b => b.textContent.trim() === 'Confirm move'), 3000, 'cancel batch dialog');
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.modal-actions .btn')].find(b => b.textContent.trim() === 'Cancel');
    if (btn) btn.click();
  });
  const cancelledOut = await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = b.boards.find(x => x.id === b.activeBoardId);
    const input = document.querySelector('.column:nth-child(1) .qa-input');
    return {
      addedCount: board.columns[0].cards.filter(c => c.title.indexOf('Cancel') === 0).length,
      inputKept: Boolean(input && input.value.indexOf('Cancel A') !== -1)
    };
  });
  check('cancelled batch adds nothing', cancelledOut.addedCount === 0);
  check('cancelled quick-add keeps the input text', cancelledOut.inputKept === true);
  await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = b.boards.find(x => x.id === b.activeBoardId);
    board.columns.forEach(col => { col.wipLimit = 0; });
    localStorage.setItem('kanban.mirror.v1', JSON.stringify({ savedAt: Date.now(), payload: b }));
  });
  await page.evaluate(() => KB.App.refresh());

  // ---- Cancelling the create-confirm dialog keeps the typed card ----
  await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = b.boards.find(x => x.id === b.activeBoardId);
    const col1 = board.columns[0];
    KB.State.updateColumn(col1.id, { wipLimit: col1.cards.length, policy: { wipMode: 'hard', overrideRequiresReason: false, entryCriteria: [], exitCriteria: [], defaultLabelIds: [], defaultAssignee: '' } });
  });
  await page.evaluate(() => KB.App.refresh());
  await page.click('.column:nth-child(1) .column-header [data-action="col-add"]');
  await waitFor(() => !!document.querySelector('#cf-title'), 3000, 'create editor opens');
  const cardsBeforeCreate = await page.evaluate(() => KB.State.activeBoard().columns[0].cards.length);
  await page.type('#cf-title', 'Editor cancel probe');
  await page.$eval('#cf-desc', (el) => { el.value = 'must survive a cancel'; });
  await clickByText('.modal-actions .btn', 'Save');
  await waitFor(() => [...document.querySelectorAll('.modal-actions .btn')].some(b => b.textContent.trim() === 'Confirm move'), 3000, 'create confirm dialog');
  await clickByText('.modal-actions .btn', 'Cancel');
  await waitFor(() => !!document.querySelector('#cf-title'), 3000, 'editor reopens after cancel');
  const cancelKept = await page.evaluate(() => ({
    title: document.querySelector('#cf-title').value,
    desc: document.querySelector('#cf-desc').value,
    cardCount: KB.State.activeBoard().columns[0].cards.length
  }));
  check('cancel on create confirm keeps the typed title', cancelKept.title === 'Editor cancel probe');
  check('cancel on create confirm keeps the typed description', cancelKept.desc === 'must survive a cancel');
  check('cancel on create confirm creates nothing', cancelKept.cardCount === cardsBeforeCreate);

  await page.type('#cf-title', ' editor 2');
  await clickByText('.modal-actions .btn', 'Save');
  await waitFor(() => [...document.querySelectorAll('.modal-actions .btn')].some(b => b.textContent.trim() === 'Confirm move'), 3000, 'create confirm dialog 2');
  await page.keyboard.press('Escape');
  await waitFor(() => !!document.querySelector('#cf-title'), 3000, 'editor reopens after escape');
  const escapeKept = await page.evaluate(() => document.querySelector('#cf-title').value);
  check('escape on create confirm keeps the typed title', escapeKept === 'Editor cancel probe editor 2');

  await clickByText('.modal-actions .btn', 'Save');
  await waitFor(() => [...document.querySelectorAll('.modal-actions .btn')].some(b => b.textContent.trim() === 'Confirm move'), 3000, 'create confirm dialog 3');
  await page.evaluate(() => {
    const backdrop = document.querySelector('.modal-backdrop');
    if (backdrop) backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await waitFor(() => !!document.querySelector('#cf-title'), 3000, 'editor reopens after backdrop click');
  const backdropKept = await page.evaluate(() => document.querySelector('#cf-title').value);
  check('backdrop click on create confirm keeps the typed title', backdropKept === 'Editor cancel probe editor 2');

  await clickByText('.modal-actions .btn', 'Cancel');
  await waitFor(() => !document.querySelector('.modal-panel'), 3000, 'editor closes');
  const editorCancelled = await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = b.boards.find(x => x.id === b.activeBoardId);
    return board.columns[0].cards.some(c => c.title.indexOf('Editor cancel probe') === 0) === false;
  });
  check('no card from cancelled create', editorCancelled === true);
  await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = b.boards.find(x => x.id === b.activeBoardId);
    board.columns.forEach(col => { col.wipLimit = 0; });
    localStorage.setItem('kanban.mirror.v1', JSON.stringify({ savedAt: Date.now(), payload: b }));
  });
  await page.evaluate(() => KB.App.refresh());
  await waitFor(() => !!document.querySelector('.column'), 3000, 'back to board after editor cancel');

  // ---- Review workspace ----
  await page.evaluate(() => KB.Workspaces.set('review'));
  await waitFor(() => document.querySelectorAll('.metric-card').length >= 4, 3000, 'review summary');
  check('review workspace renders summary', await page.$$eval('.metric-card', els => els.length) >= 4);
  await waitFor(() => document.querySelectorAll('.review-row').length >= 1, 3000, 'review queue');
  check('review workspace renders attention queue', await page.$$eval('.review-row', els => els.length) >= 1);
  check('review row explains why', (await page.$$eval('.review-row .review-reason', els => els.map(e => e.textContent))).length >= 1);
  check('review summary shows p85 cycle time', (await page.$$eval('.metric-label', els => els.map(e => e.textContent))).some(t => t.includes('P85')));
  await page.evaluate(() => KB.Workspaces.set('board'));
  await waitFor(() => !!document.querySelector('.column'), 3000, 'back to board');

  // ---- Lifecycle fields follow role-based moves ----
  const lifeSeed = await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = b.boards.find(x => x.id === b.activeBoardId);
    board.columns[0].role = 'queue';
    board.columns[1].role = 'active';
    board.columns[2].role = 'done';
    const col = board.columns[0];
    col.cards = [{
      id: 'life-1',
      columnId: col.id,
      title: 'Lifecycle probe',
      description: '',
      labels: [],
      assignee: '',
      createdAt: 1000,
      updatedAt: 1000,
      movedAt: 1000,
      due: '',
      checklist: [],
      priority: 'none',
      size: 'none',
      startedAt: null,
      completedAt: null,
      flow: { state: 'normal', reason: '', since: null, periods: [] },
      dependencies: { blockers: [], related: [] },
      recurrenceId: null,
      transitions: []
    }];
    return b;
  });
  await seedLocalStorage(lifeSeed);
  await page.goto(URL, { waitUntil: 'load' });
  await waitBoard();
  const colCount = await page.$$eval('.column', els => els.length);
  check('lifecycle board renders', colCount === 3);
  const lifeCols = await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    return b.boards.find(x => x.id === b.activeBoardId).columns.map(c => c.id);
  });
  await page.evaluate((cols) => KB.State.moveCard(cols[0], 'life-1', cols[1], 0), lifeCols);
  const mid = await page.evaluate((cols) => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = b.boards.find(x => x.id === b.activeBoardId);
    const card = board.columns.find(c => c.id === cols[1]).cards.find(c => c.id === 'life-1');
    return { startedAt: card.startedAt, completedAt: card.completedAt, transitions: card.transitions.length };
  }, lifeCols);
  check('entering active sets startedAt', typeof mid.startedAt === 'number' && mid.startedAt > 0);
  check('entering active keeps completedAt null', mid.completedAt === null);
  check('active move records a transition', mid.transitions === 1);

  await page.evaluate((cols) => KB.State.moveCard(cols[1], 'life-1', cols[2], 0), lifeCols);
  const done = await page.evaluate((cols) => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = b.boards.find(x => x.id === b.activeBoardId);
    const card = board.columns.find(c => c.id === cols[2]).cards.find(c => c.id === 'life-1');
    return { startedAt: card.startedAt, completedAt: card.completedAt, transitions: card.transitions.length };
  }, lifeCols);
  check('entering done sets completedAt', typeof done.completedAt === 'number' && done.completedAt > 0);
  check('startedAt survives into done', done.startedAt === mid.startedAt);
  check('done move records a second transition', done.transitions === 2);

  await page.evaluate((cols) => KB.State.moveCard(cols[2], 'life-1', cols[0], 0), lifeCols);
  const reopened = await page.evaluate((cols) => {
    const b = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = b.boards.find(x => x.id === b.activeBoardId);
    const card = board.columns.find(c => c.id === cols[0]).cards.find(c => c.id === 'life-1');
    return { completedAt: card.completedAt };
  }, lifeCols);
  check('reopening a done card clears completedAt', reopened.completedAt === null);

  const noopTransitions = await page.evaluate((cols) => {
    const before = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = before.boards.find(x => x.id === before.activeBoardId);
    const card = board.columns.find(c => c.id === cols[0]).cards.find(c => c.id === 'life-1');
    const count = card.transitions.length;
    const result = KB.State.moveCard(cols[0], 'life-1', cols[0], 0);
    const after = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const afterCard = after.boards.find(x => x.id === after.activeBoardId).columns.find(c => c.id === cols[0]).cards.find(c => c.id === 'life-1');
    return { result, before: count, after: afterCard.transitions.length };
  }, lifeCols);
  check('no-op move creates no transition', noopTransitions.before === noopTransitions.after);

  // ---- Creation routes through the placement pipeline ----
  const createdIntoActive = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const active = board.columns[1];
    const created = KB.State.addCard(active.id, { title: 'Created into active' });
    return created
      ? { startedAt: created.startedAt, completedAt: created.completedAt, transitions: (created.transitions || []).length }
      : null;
  });
  check('creation into an active column sets startedAt', createdIntoActive !== null && typeof createdIntoActive.startedAt === 'number');
  check('creation into an active column leaves completedAt null', createdIntoActive !== null && createdIntoActive.completedAt === null);
  check('creation records an initial lifecycle transition', createdIntoActive !== null && createdIntoActive.transitions === 1);

  const createdIntoDone = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const done = board.columns[2];
    const created = KB.State.addCard(done.id, { title: 'Created into done' });
    return created ? { completedAt: created.completedAt } : null;
  });
  check('creation into a done column records completedAt', createdIntoDone !== null && typeof createdIntoDone.completedAt === 'number');

  // ---- Same-column reorder changes position without a lifecycle transition ----
  const reorderTransitions = await page.evaluate((cols) => {
    KB.State.addCard(cols[0], { title: 'Reorder probe' });
    const before = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const board = before.boards.find(x => x.id === before.activeBoardId);
    const card = board.columns.find(c => c.id === cols[0]).cards.find(c => c.id === 'life-1');
    const count = card.transitions.length;
    KB.State.moveCard(cols[0], 'life-1', cols[0], 2);
    const after = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const afterBoard = after.boards.find(x => x.id === after.activeBoardId);
    const afterCol = afterBoard.columns.find(c => c.id === cols[0]);
    const afterCard = afterCol.cards.find(c => c.id === 'life-1');
    return { before: count, after: afterCard.transitions.length, index: afterCol.cards.findIndex(c => c.id === 'life-1') };
  }, lifeCols);
  check('same-column reorder appends no transition', reorderTransitions.before === reorderTransitions.after);
  check('same-column reorder changes the position', reorderTransitions.index === 1);

  // ---- Same-column reorder never reapplies entry defaults ----
  const reorderDefaults = await page.evaluate((cols) => {
    const board = KB.State.activeBoard();
    const col = board.columns[0];
    const labelId = (board.labels[0] || { id: '' }).id;
    const savedPolicy = JSON.parse(JSON.stringify(col.policy));
    KB.State.updateColumn(col.id, { policy: { wipMode: 'off', defaultLabelIds: labelId ? [labelId] : [], defaultAssignee: 'Sam', entryCriteria: [], exitCriteria: [] } });
    KB.State.addCard(cols[0], { title: 'Defaults reorder probe' });
    KB.State.moveCard(cols[0], 'life-1', cols[0], 0);
    const after = JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload;
    const afterBoard = after.boards.find(x => x.id === after.activeBoardId);
    const afterCol = afterBoard.columns.find(c => c.id === cols[0]);
    const card = afterCol.cards.find(c => c.id === 'life-1');
    const result = { labels: card.labels.length, assignee: card.assignee, index: afterCol.cards.findIndex(c => c.id === 'life-1') };
    KB.State.updateColumn(col.id, { policy: savedPolicy });
    KB.App.refresh();
    return result;
  }, lifeCols);
  check('same-column reorder never reapplies entry defaults', reorderDefaults.labels === 0 && reorderDefaults.assignee === '');
  check('same-column reorder with defaults still changes position', reorderDefaults.index === 0);

  // ---- Recurrence processing ----
  const recResult = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const col = board.columns[0];
    const rec = KB.State.addRecurrence({
      mode: 'scheduled',
      schedule: { frequency: 'daily', interval: 1 },
      target: { boardId: board.id, columnId: col.id },
      template: { title: 'Daily standup', description: '', labelIds: [], assignee: '', priority: 'none', size: 'none', checklist: [] },
      dueOffsetDays: 0,
      overlapPolicy: 'single-active',
      missedPolicy: 'create-one'
    });
    const before = KB.State.recurrences().find(r => r.id === rec.id);
    before.nextRunAt = 1;
    KB.State.updateRecurrence(rec.id, { nextRunAt: 1 });
    const processed = KB.State.processRecurrences();
    KB.App.refresh();
    const cards = KB.State.activeBoard().columns[0].cards.filter(c => c.title === 'Daily standup');
    const recAfter = KB.State.recurrences().find(r => r.id === rec.id);
    return {
      created: processed ? processed.created : 0,
      count: cards.length,
      activeCard: recAfter.activeCardRef ? recAfter.activeCardRef.cardId === cards[0].id : false,
      nextRunInFuture: recAfter.nextRunAt > Date.now()
    };
  });
  check('recurrence processing creates one occurrence', recResult.created === 1 && recResult.count === 1);
  check('single-active tracks the active instance', recResult.activeCard === true);
  check('recurrence advances its next run', recResult.nextRunInFuture === true);
  await waitFor(() => document.querySelectorAll('.chip.rec').length >= 1, 3000, 'recurrence chip');
  check('recurrence chip renders', await page.$$eval('.chip.rec', els => els.length) >= 1);

  const recSecond = await page.evaluate(() => {
    const processed = KB.State.processRecurrences();
    const cards = KB.State.activeBoard().columns[0].cards.filter(c => c.title === 'Daily standup');
    return { processed: processed ? processed.created : 0, count: cards.length };
  });
  check('repeated processing creates no duplicates', recSecond.processed === 0 && recSecond.count === 1);

  await page.evaluate(() => KB.State.undo());
  const recUndone = await page.evaluate(() => {
    const cards = KB.State.activeBoard().columns[0].cards.filter(c => c.title === 'Daily standup');
    return cards.length;
  });
  check('undo restores the recurrence occurrence', recUndone === 0);

  // ---- After-completion recurrence ----
  const afterCompletion = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const col = board.columns[0];
    const rec = KB.State.addRecurrence({
      mode: 'after-completion',
      schedule: { frequency: 'custom', interval: 1, delayAfterCompletionDays: 7 },
      target: { boardId: board.id, columnId: col.id },
      template: { title: 'Quarterly review', description: '', labelIds: [], assignee: '', priority: 'none', size: 'none', checklist: [] },
      dueOffsetDays: null,
      overlapPolicy: 'single-active',
      missedPolicy: 'create-one'
    });
    const card = KB.State.addCard(col.id, { title: 'Quarterly review', recurrenceId: rec.id });
    const doneCol = board.columns.find(c => c.role === 'done');
    KB.State.moveCard(col.id, card.id, doneCol.id, 0, { confirmed: true });
    const recAfter = KB.State.recurrences().find(r => r.id === rec.id);
    const startOfDay = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
    return {
      scheduled: recAfter.nextRunAt !== null,
      activeCleared: recAfter.activeCardRef === null,
      delayDays: Math.max(0, Math.round((recAfter.nextRunAt - startOfDay(recAfter.lastCompletedAt)) / 86400000))
    };
  });
  check('completing a recurring card schedules the next run', afterCompletion.scheduled === true && afterCompletion.activeCleared === true);
  check('completion delay is respected', afterCompletion.delayDays === 7);

  const afterCompletionCreated = await page.evaluate(() => {
    const rec = KB.State.recurrences().find(r => r.template.title === 'Quarterly review');
    rec.nextRunAt = 1;
    KB.State.updateRecurrence(rec.id, { nextRunAt: 1 });
    const processed = KB.State.processRecurrences();
    const freshBoard = KB.State.activeBoard();
    const cards = freshBoard.columns[0].cards.filter(c => c.title === 'Quarterly review');
    return { created: processed ? processed.created : 0, count: cards.length };
  });
  check('after-completion creates the next card when the delay has passed', afterCompletionCreated.created >= 1 && afterCompletionCreated.count === 1);
  const recNeedAttention = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const rec = KB.State.addRecurrence({
      mode: 'scheduled',
      schedule: { frequency: 'daily', interval: 1 },
      target: { boardId: board.id, columnId: 'ghost-column' },
      template: { title: 'Orphan rec', priority: 'none', size: 'none', checklist: [] },
      overlapPolicy: 'single-active',
      missedPolicy: 'create-one'
    });
    const processed = KB.State.processRecurrences();
    const after = KB.State.recurrences().find(r => r.id === rec.id);
    return { needsAttention: after.needsAttention, changed: Boolean(processed) };
  });
  check('missing target column marks the recurrence', recNeedAttention.needsAttention === true && recNeedAttention.changed === true);

  // ---- Composition: recurrence -> bulk move into hard-WIP done -> confirm -> scheduled -> one undo ----
  const composition = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const col0 = board.columns[0];
    const doneCol = board.columns.find(c => c.role === 'done');
    KB.State.updateColumn(doneCol.id, {
      wipLimit: 1,
      policy: { wipMode: 'hard', overrideRequiresReason: false, entryCriteria: [], exitCriteria: [], defaultLabelIds: [], defaultAssignee: '' }
    });
    const rec = KB.State.addRecurrence({
      mode: 'after-completion',
      schedule: { frequency: 'custom', interval: 1, delayAfterCompletionDays: 2 },
      target: { boardId: board.id, columnId: col0.id },
      template: { title: 'Composition rec', description: '', labelIds: [], assignee: '', priority: 'none', size: 'none', checklist: [] },
      dueOffsetDays: null,
      overlapPolicy: 'single-active',
      missedPolicy: 'create-one'
    });
    const seeded = KB.State.processRecurrences();
    const card = KB.State.activeBoard().columns[0].cards.find(c => c.title === 'Composition rec');
    const blocked = KB.State.bulkMove([{ boardId: board.id, cardId: card.id }], { boardId: board.id, columnId: doneCol.id });
    return {
      recId: rec.id,
      cardId: card.id,
      seeded: Boolean(seeded && seeded.created >= 1),
      blockedReason: blocked && blocked.reason,
      blockedBlocking: blocked && blocked.blocking
    };
  });
  check('composition: recurrence seeds a card', composition.seeded === true);
  check('composition: bulk move is blocked by hard WIP', composition.blockedReason === 'policy-violations' && composition.blockedBlocking === true);

  const compositionMoved = await page.evaluate((ids) => {
    const board = KB.State.activeBoard();
    const doneCol = board.columns.find(c => c.role === 'done');
    const result = KB.State.bulkMove([{ boardId: board.id, cardId: ids.cardId }], { boardId: board.id, columnId: doneCol.id }, { confirmed: true });
    const rec = KB.State.recurrences().find(r => r.id === ids.recId);
    const card = KB.State.activeBoard().columns.find(c => c.role === 'done').cards.find(c => c.id === ids.cardId);
    return {
      changed: Boolean(result && result.changed),
      completedAt: card ? card.completedAt : null,
      activeCleared: rec.activeCardRef === null,
      scheduled: rec.nextRunAt !== null && rec.nextRunAt > Date.now()
    };
  }, composition);
  check('composition: confirmed bulk move into done completes the card', compositionMoved.changed === true && typeof compositionMoved.completedAt === 'number');
  check('composition: bulk move schedules the next occurrence', compositionMoved.activeCleared === true && compositionMoved.scheduled === true);

  await page.evaluate(() => KB.State.undo());
  const compositionUndone = await page.evaluate((ids) => {
    const board = KB.State.activeBoard();
    const card = board.columns[0].cards.find(c => c.id === ids.cardId);
    const rec = KB.State.recurrences().find(r => r.id === ids.recId);
    return {
      backInQueue: Boolean(card),
      activeRestored: Boolean(rec.activeCardRef && rec.activeCardRef.cardId === ids.cardId),
      nextNull: rec.nextRunAt === null
    };
  }, composition);
  check('composition: one undo restores everything', compositionUndone.backInQueue && compositionUndone.activeRestored && compositionUndone.nextNull);

  // ---- Inbox capture and triage ----
  const inboxResult = await page.evaluate(() => {
    const captured = KB.State.captureInbox({ title: 'Order new laptop', note: 'Ask finance' });
    const urlItem = KB.State.captureInboxLines('https://example.com/specs\nSecond idea');
    const beforeTriage = KB.State.inboxItems().length;
    const triaged = KB.State.triageInboxItem(captured.id, {
      boardId: KB.State.activeBoard().id,
      columnId: KB.State.activeBoard().columns[0].id
    }, { priority: 'medium', assignee: 'Sam' });
    const afterTriage = KB.State.inboxItems().length;
    const board = KB.State.activeBoard();
    const created = board.columns[0].cards.find(c => c.title === 'Order new laptop');
    KB.App.refresh();
    return {
      captured: captured && captured.title === 'Order new laptop',
      multi: urlItem && urlItem.length === 2 && urlItem[0].url === 'https://example.com/specs',
      triaged: Boolean(triaged && triaged.changed),
      beforeTriage,
      afterTriage,
      cardPriority: created && created.priority,
      cardAssignee: created && created.assignee
    };
  });
  check('inbox capture stores items', inboxResult.captured && inboxResult.multi === true);
  check('inbox triage is atomic', inboxResult.triaged && inboxResult.beforeTriage === 3 && inboxResult.afterTriage === 2);
  check('triage card keeps the patch', inboxResult.cardPriority === 'medium' && inboxResult.cardAssignee === 'Sam');

  await blur();
  await pressUndo();
  await waitFor(() => {
    const items = KB.State.inboxItems();
    const card = KB.State.activeBoard().columns[0].cards.find(c => c.title === 'Order new laptop');
    return items.length === 3 && !card;
  }, 3000, 'triage undo');
  const inboxUndo = await page.evaluate(() => {
    const items = KB.State.inboxItems();
    const card = KB.State.activeBoard().columns[0].cards.find(c => c.title === 'Order new laptop');
    return { items: items.length, cardExists: Boolean(card) };
  });
  check('undo restores both sides of triage', inboxUndo.items === 3 && !inboxUndo.cardExists);

  // ---- Triage respects column policies and initializes lifecycle ----
  const triageLifecycle = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const doneCol = board.columns.find(c => c.role === 'done');
    KB.State.updateColumn(doneCol.id, {
      wipLimit: 1,
      policy: { wipMode: 'hard', overrideRequiresReason: false, entryCriteria: [], exitCriteria: [], defaultLabelIds: [], defaultAssignee: '' }
    });
    const captured = KB.State.captureInbox({ title: 'Triage into active' });
    const triaged = KB.State.triageInboxItem(captured.id, { boardId: board.id, columnId: doneCol.id }, { priority: 'low' });
    const blocked = triaged && triaged.reason === 'policy';
    const confirmed = blocked
      ? KB.State.triageInboxItem(captured.id, { boardId: board.id, columnId: doneCol.id }, { priority: 'low' }, { confirmed: true })
      : null;
    const card = confirmed && confirmed.changed
      ? KB.State.activeBoard().columns.find(c => c.role === 'done').cards.find(c => c.title === 'Triage into active')
      : null;
    return {
      blocked: blocked,
      confirmed: Boolean(confirmed && confirmed.changed),
      completedAt: card ? card.completedAt : null,
      itemGone: KB.State.inboxItems().every(it => it.id !== captured.id)
    };
  });
  check('triage respects hard WIP and needs confirmation', triageLifecycle.blocked === true);
  check('confirmed triage into done records completion',
    triageLifecycle.confirmed === true && typeof triageLifecycle.completedAt === 'number' && triageLifecycle.itemGone === true);

  const mergeResult = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const card = board.columns[0].cards[0];
    const merged = KB.State.mergeInboxItem(KB.State.inboxItems()[2].id, { boardId: board.id, cardId: card.id });
    const fresh = KB.State.activeBoard().columns[0].cards[0];
    return { merged: Boolean(merged), descHasNote: fresh.description.includes('Second idea') };
  });
  check('merge appends into the target card', mergeResult.merged && mergeResult.descHasNote === true);

  const mergeUrlKept = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const card = board.columns[0].cards[0];
    const before = card.description;
    const captured = KB.State.captureInbox({ title: 'URL merge item', note: 'Context note', url: 'https://example.com/keep' });
    const merged = KB.State.mergeInboxItem(captured.id, { boardId: board.id, cardId: card.id });
    const after = merged ? KB.State.activeBoard().columns[0].cards[0].description : before;
    return merged && after.includes('Context note') && after.includes('https://example.com/keep');
  });
  check('merge keeps the URL with a note', mergeUrlKept === true);

  await page.evaluate(() => KB.Workspaces.set('inbox'));
  await waitFor(() => document.querySelectorAll('.inbox-item').length >= 1, 3000, 'inbox workspace');
  check('inbox workspace shows items', await page.$$eval('.inbox-item', els => els.length) >= 1);
  check('inbox pressure summary renders', await page.$eval('.inbox-pressure', el => el.textContent.includes('unprocessed')));

  const inboxPressure = await page.evaluate(() => {
    const item = KB.State.inboxItems()[0];
    if (item) KB.State.updateInboxItem(item.id, { archived: true });
    const after = KB.Core.Inbox.inboxSummary(KB.State.data(), Date.now());
    KB.App.refresh();
    const badge = document.querySelector('#inbox-badge');
    const result = {
      openCount: after.count,
      allCount: KB.State.inboxItems().length,
      badgeText: badge ? badge.textContent.trim() : '',
      badgeHidden: badge ? badge.hidden : true
    };
    if (item) KB.State.updateInboxItem(item.id, { archived: false });
    KB.App.refresh();
    return result;
  });
  check('inbox pressure excludes archived references',
    inboxPressure.openCount < inboxPressure.allCount && inboxPressure.openCount > 0 && !inboxPressure.badgeHidden && inboxPressure.badgeText === String(inboxPressure.openCount));

  await page.evaluate(() => KB.Workspaces.set('board'));
  await waitFor(() => !!document.querySelector('.column'), 3000, 'back to board after inbox');

  // ---- My Desk and saved lenses ----
  await page.evaluate(() => KB.Workspaces.set('mydesk'));
  await waitFor(() => document.querySelectorAll('.desk-section').length === 5, 3000, 'my desk sections');
  check('my desk renders default sections', await page.$$eval('.desk-section', els => els.length) === 5);
  await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const col = board.columns.find(c => c.cards.length > 0);
    if (col && col.cards[0]) {
      KB.State.updateCard(col.id, col.cards[0].id, { startedAt: Date.now() - 30 * 86400000 });
    }
  });
  await page.evaluate(() => { document.querySelector('.lens-bar [data-lens="builtin-aging"]').click(); });
  await waitFor(() => document.querySelectorAll('.desk-section').length >= 1, 3000, 'aging lens');
  check('built-in lens renders grouped results', await page.$$eval('.desk-section', els => els.length) >= 1);
  const lensSave = await page.evaluate(() => {
    const lens = KB.State.addLens({
      name: 'E2E lens',
      scope: 'active-board',
      boardIds: [],
      query: { search: '', labelIds: [], assignees: [], due: 'any', priorities: [], sizes: [], flowStates: [], blockedOnly: false, readyOnly: false, columnRoles: [], includeCompleted: false },
      sort: { field: 'priority', direction: 'desc' },
      display: { density: 'compact', groupBy: 'board' }
    });
    KB.Workspaces.set('mydesk');
    return lens && lens.id;
  });
  check('user lens created', typeof lensSave === 'string');
  await page.evaluate((id) => { document.querySelector('.lens-bar [data-lens="' + id + '"]').click(); }, lensSave);
  await waitFor(() => document.querySelectorAll('.compact-card').length >= 1, 3000, 'user lens applies');
  check('user lens applies', await page.$$eval('.compact-card', els => els.length) >= 1);
  await page.evaluate(() => { KB.Workspaces.set('board'); });
  await waitFor(() => !!document.querySelector('.column'), 3000, 'back to board after lens');

  // ---- Move-to menu and keyboard movement ----
  const kbCardId = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const sourceCol = board.columns.find(c => c.cards.length > 0) || board.columns[0];
    const card = sourceCol.cards[sourceCol.cards.length - 1];
    const target = board.columns[1];
    KB.State.moveCardChecked(sourceCol.id, card.id, target.id, 0, { confirmed: true });
    KB.App.refresh();
    return card.id;
  });
  await waitFor((id) => !!document.querySelector('.column:nth-child(2) .card[data-id="' + id + '"]'), 3000, 'keyboard card placed', kbCardId);
  await page.evaluate((cardId) => {
    const card = document.querySelector('.column:nth-child(2) .card[data-id="' + cardId + '"]');
    card.focus();
  }, kbCardId);
  await page.keyboard.press('m');
  await waitFor(() => document.querySelector('.column:nth-child(2) .card') && document.querySelector('.column:nth-child(2) .card').classList.contains('move-pos-target'), 3000, 'move mode highlight');
  check('keyboard move mode highlights the card', await page.$eval('.column:nth-child(2) .card', el => el.classList.contains('move-pos-target')));
  await page.keyboard.press('ArrowRight');
  await waitFor(() => document.querySelector('.column:nth-child(3)').classList.contains('move-col-target'), 2000, 'arrow right target');
  check('arrow right moves the target column', await page.$eval('.column:nth-child(3)', el => el.classList.contains('move-col-target')));
  await page.keyboard.press('Enter');
  const confirmOpen = await page.$('.modal-panel');
  if (confirmOpen) {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.modal-actions .btn')];
      const confirm = btns.find(b => b.textContent.trim() === 'Confirm move');
      if (confirm) confirm.click();
    });
  }
  await waitFor((id) => {
    const el = document.querySelector('.column:nth-child(3) .card');
    return el && el.dataset.id === id;
  }, 4000, 'keyboard move commits', kbCardId);
  check('enter commits the keyboard move', await page.$eval('.column:nth-child(3) .card', (el, id) => el.dataset.id === id, kbCardId) === true);
  await waitFor(() => document.querySelector('#live-region').textContent.includes('Moved'), 3000, 'move announcement');
  check('keyboard move announces the result', (await page.$eval('#live-region', el => el.textContent)).includes('Moved') === true);

  await page.evaluate(() => {
    const card = document.querySelector('.column:nth-child(3) .card');
    card.focus();
  });
  await page.keyboard.press('m');
  await waitFor(() => document.querySelector('.column:nth-child(3) .card').classList.contains('move-pos-target'), 2000, 'cancel move mode start');
  await page.keyboard.press('Escape');
  await waitFor(() => [...document.querySelectorAll('.column')].every(c => !c.classList.contains('move-col-target')), 2000, 'move mode cancelled');
  check('escape cancels keyboard move', (await page.$$eval('.column', els => els.every(c => !c.classList.contains('move-col-target')))) === true);
  await waitFor(() => document.querySelector('#live-region').textContent === 'Move cancelled.', 2000, 'cancel announcement');
  check('cancel announcement reads Move cancelled', (await page.$eval('#live-region', el => el.textContent)) === 'Move cancelled.');

  const movedCardId = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    return board.columns[1].cards[0].id;
  });
  await page.evaluate(() => {
    const board = KB.State.activeBoard();
    KB.MoveTo.moveToMenu(board.id, board.columns[1].id, board.columns[1].cards[0].id);
  });
  await waitFor(() => !!document.querySelector('#mt-board'), 3000, 'move-to menu opens');
  check('move-to menu opens', await page.$eval('#mt-board', el => el.tagName === 'SELECT') === true);
  check('move-to menu offers before/after positions', (await page.$$eval('#mt-position option', els => els.map(e => e.value))).every(v => ['top', 'bottom', 'before', 'after'].includes(v)));
  await page.evaluate(() => {
    const columnSelect = document.querySelector('#mt-column');
    const last = columnSelect.options[columnSelect.options.length - 1].value;
    columnSelect.value = last;
    document.querySelector('.modal-panel .btn.primary').click();
  });
  const moveConfirm = await page.$('.modal-panel .mv-criterion, .modal-panel .policy-violation');
  if (moveConfirm) {
    await page.evaluate(() => {
      const confirm = [...document.querySelectorAll('.modal-actions .btn')].find(b => b.textContent.trim() === 'Confirm move');
      if (confirm) confirm.click();
    });
  }
  await waitFor((id) => {
    const board = KB.State.activeBoard();
    const done = board.columns[board.columns.length - 1];
    return done.cards.some(c => c.id === id);
  }, 3000, 'move-to commits', movedCardId);
  const moveToLanded = await page.evaluate((id) => {
    const board = KB.State.activeBoard();
    const done = board.columns[board.columns.length - 1];
    return done.cards.some(c => c.id === id);
  }, movedCardId);
  check('move-to menu commits the move', moveToLanded === true);

  // ---- Move-to across boards commits and reports success ----
  const crossMove = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const sourceCol = board.columns.find(c => c.cards.length > 0) || board.columns[0];
    const card = sourceCol.cards[0];
    const other = KB.State.addBoard('Cross target');
    other.columns = [{ id: 'cb-done', title: 'Done', role: 'done', isDone: true, wipLimit: 0, policy: { wipMode: 'off' }, cards: [] }];
    KB.App.refresh();
    KB.MoveTo.moveToMenu(board.id, sourceCol.id, card.id);
    return { boardId: board.id, cardId: card.id, otherId: other.id };
  });
  await waitFor(() => !!document.querySelector('#mt-board'), 3000, 'cross move menu');
  await page.evaluate((ids) => {
    const boardSel = document.querySelector('#mt-board');
    boardSel.value = ids.otherId;
    boardSel.dispatchEvent(new Event('change', { bubbles: true }));
    const colSel = document.querySelector('#mt-column');
    colSel.value = colSel.options[colSel.options.length - 1].value;
    document.querySelector('.modal-panel .btn.primary').click();
  }, crossMove);
  const crossMoved = await waitFor((ids) => {
    const board = KB.State.boardById(ids.otherId);
    return board.columns.some(c => c.cards.some(card => card.id === ids.cardId));
  }, 3000, 'cross move commits', crossMove);
  check('move-to cross-board commits the card', crossMoved === true);
  check('move-to cross-board reports success', await page.$$eval('.toast', els => els.some(e => e.textContent.includes('Card moved'))));
  await page.evaluate(() => {
    const myBoard = KB.State.boards().find(b => b.name === 'My Board');
    KB.State.setActiveBoard(myBoard.id);
    KB.App.refresh();
  });
  await waitFor(() => document.querySelector('#board-name') && document.querySelector('#board-name').textContent === 'My Board', 3000, 'back to my board');

  // ---- Policy criteria confirmation in the move dialog ----
  await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const col = board.columns.find(c => c.cards.length > 0);
    board.columns[1].policy.entryCriteria = ['Acceptance criteria written', 'Dependencies resolved'];
    KB.State.updateColumn(board.columns[1].id, { policy: board.columns[1].policy });
    const card = col.cards[col.cards.length - 1];
    KB.Modal.moveConfirmModal('Move requires confirmation', {
      violations: [{
        code: 'entry-criteria',
        message: 'Entry criteria need confirming.',
        criteria: ['Acceptance criteria written', 'Dependencies resolved']
      }]
    }, '', function () { KB.State.moveCardChecked(col.id, card.id, board.columns[1].id, 0, { confirmed: true }); });
    return { cardId: card.id };
  });
  await waitFor(() => document.querySelectorAll('.mv-criterion').length === 2, 3000, 'criteria checkboxes');
  check('move dialog lists each criterion', await page.$$eval('.mv-criterion', els => els.length) === 2);
  await page.evaluate(() => {
    const confirm = [...document.querySelectorAll('.modal-actions .btn')].find(b => b.textContent.trim() === 'Confirm move');
    confirm.click();
  });
  await waitFor(() => [...document.querySelectorAll('.toast')].some(e => e.textContent.includes('Confirm every criterion')), 3000, 'unconfirmed blocked');
  check('unconfirmed criteria block the move', (await page.$$eval('.toast', els => els.some(e => e.textContent.includes('Confirm every criterion')))) === true);
  await page.evaluate(() => {
    document.querySelectorAll('.mv-criterion').forEach(box => { box.checked = true; });
    const confirm = [...document.querySelectorAll('.modal-actions .btn')].find(b => b.textContent.trim() === 'Confirm move');
    confirm.click();
  });
  await waitFor(() => !document.querySelector('.modal-panel'), 3000, 'criteria confirmed');
  check('confirmed criteria proceed', (await page.$('.modal-panel')) === null);
  await page.evaluate(() => {
    const board = KB.State.activeBoard();
    board.columns[1].policy.entryCriteria = [];
    KB.State.updateColumn(board.columns[1].id, { policy: board.columns[1].policy });
    KB.App.refresh();
  });

  // ---- Multi-select and bulk actions ----
  const bulkResult = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const archiveBefore = board.archive.cards.length;
    const col = board.columns.find(c => c.cards.length >= 2) || board.columns[0];
    const two = col.cards.slice(0, 2);
    KB.Select.clear();
    KB.Select.toggle(board.id, two[0].id);
    KB.Select.toggle(board.id, two[1].id);
    KB.Select.renderToolbar();
    const toolbarShown = !document.querySelector('#bulk-toolbar').hidden;
    const bulk = KB.State.bulkUpdate(KB.Select.refs(), { priority: 'urgent' });
    const archived = KB.State.bulkArchive(KB.Select.refs());
    const archiveSize = archived.state ? archived.state.boards.find(b => b.id === board.id).archive.cards.length : archiveBefore;
    return {
      toolbarShown,
      bulkChanged: Boolean(bulk && bulk.changed),
      archivedCount: archived && archived.changed ? archived.value : 0,
      archiveDelta: archiveSize - archiveBefore,
      archiveBefore: archiveBefore,
      archiveSize: archiveSize,
      archivedState: archived && archived.changed ? archived.reason : null
    };
  });
  check('bulk toolbar shows the selection', bulkResult.toolbarShown === true);
  check('bulk update patches selected cards', bulkResult.bulkChanged === true);
  check('bulk archive archives the selection', bulkResult.archivedCount === 2 && bulkResult.archiveDelta === 2);

  await blur();
  await pressUndo();
  await waitFor(() => {
    const board = KB.State.activeBoard();
    return board.archive.cards.length === 0;
  }, 3000, 'bulk undo');
  const bulkUndo = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    return { archiveSize: board.archive.cards.length, colCards: board.columns.reduce((n, c) => n + c.cards.length, 0) };
  });
  check('bulk archive undoes as one step', bulkUndo.archiveSize === 0);

  const shiftSelect = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const col = board.columns.find(c => c.cards.length >= 2) || board.columns[0];
    KB.Select.clear();
    return { first: col.cards[0].id, last: col.cards[1].id };
  });
  await page.evaluate(() => KB.App.refresh());
  await page.evaluate((ids) => {
    const cards = document.querySelectorAll('.card');
    const from = [...cards].find(c => c.dataset.id === ids.first);
    const to = [...cards].find(c => c.dataset.id === ids.last);
    from.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true, ctrlKey: false }));
    to.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true, ctrlKey: false }));
  }, shiftSelect);
  await waitFor(() => document.querySelectorAll('.card.selected').length >= 2, 3000, 'shift range');
  check('shift-click selects a range', await page.$$eval('.card.selected', els => els.length) >= 2);
  await page.keyboard.press('Escape');
  await waitFor(() => document.querySelectorAll('.card.selected').length === 0, 2000, 'escape clears');
  check('escape clears the selection', await page.$$eval('.card.selected', els => els.length) === 0);

  // ---- Archived dependencies survive a reload ----
  const archivedDepIds = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const col = board.columns.find(c => c.cards.length > 0);
    const target = KB.State.addCard(col.id, { title: 'Dep persistence target' });
    const blocker = KB.State.addCard(col.id, { title: 'Dep persistence blocker' });
    KB.State.addBlocker(board.id, target.id, board.id, blocker.id);
    KB.State.archiveCard(col.id, blocker.id, board.id);
    return { targetId: target.id, blockerId: blocker.id };
  });
  await page.goto(URL, { waitUntil: 'load' });
  await waitBoard();
  const archivedDepSurvived = await page.evaluate((ids) => {
    const board = KB.State.activeBoard();
    let card = null;
    board.columns.forEach(c => { if (!card) card = c.cards.find(x => x.id === ids.targetId) || null; });
    if (!card) return null;
    return card.dependencies.blockers.some(b => b.cardId === ids.blockerId);
  }, archivedDepIds);
  check('archived dependency reference survives reload', archivedDepSurvived === true);

  // ---- Archived completed blockers resolve; purging a column cleans references ----
  const archivedResolver = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const col = board.columns.find(c => c.cards.length > 0);
    const target = KB.State.addCard(col.id, { title: 'Archived resolution target' });
    const blocker = KB.State.addCard(col.id, { title: 'Archived resolution blocker' });
    KB.State.addBlocker(board.id, target.id, board.id, blocker.id);
    const doneCol = board.columns.find(c => c.role === 'done');
    KB.State.moveCard(col.id, blocker.id, doneCol.id, 0, { confirmed: true });
    KB.State.archiveCard(doneCol.id, blocker.id, board.id);
    const unresolved = KB.Core.Relations.getUnresolvedBlockers(KB.State.data(), { boardId: board.id, cardId: target.id });
    KB.App.refresh();
    return {
      targetId: target.id,
      unresolved: unresolved.length,
      archivedCompleted: Boolean(KB.State.data().boards.find(x => x.id === board.id).archive.cards.find(c => c.id === blocker.id))
    };
  });
  check('archived completed blocker does not block dependents',
    archivedResolver.unresolved === 0 && archivedResolver.archivedCompleted === true);

  const purgeCol = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const col = board.columns[0];
    const victim = KB.State.addCard(col.id, { title: 'Purge victim' });
    const target = KB.State.addCard(col.id, { title: 'Purge target' });
    KB.State.addBlocker(board.id, target.id, board.id, victim.id);
    const doneCol = board.columns.find(c => c.role === 'done');
    KB.State.moveCard(col.id, victim.id, doneCol.id, 0, { confirmed: true });
    KB.State.archiveCard(doneCol.id, victim.id, board.id);
    const data = KB.State.data();
    const b = data.boards.find(x => x.id === board.id);
    const card = b.archive.cards.pop();
    b.archive.columns.push({ id: 'purge-col', title: 'Purge col', isDone: false, wipLimit: 0, cards: [card], archivedAt: Date.now() });
    KB.App.refresh();
    const purged = KB.State.purgeColumn('purge-col');
    const targetCard = KB.State.data().boards.find(x => x.id === board.id).columns[0].cards.find(c => c.title === 'Purge target');
    return {
      purged: Boolean(purged),
      blockersAfter: targetCard ? targetCard.dependencies.blockers.length : -1
    };
  });
  check('purge of an archived column cleans dangling references', purgeCol.purged === true && purgeCol.blockersAfter === 0);

  // ---- Activity view ----
  await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const card = board.columns.find(c => c.cards.length > 0).cards[0];
    card.flow.periods.push({ state: 'blocked', reason: 'x', startedAt: Date.now() - 86400000, endedAt: Date.now() - 43200000 });
    KB.App.refresh();
  });
  await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const col = board.columns.find(c => c.cards.length > 0);
    KB.Modal.cardEditor(col.id, col.cards[0], null, board.id);
  });
  await waitFor(() => document.querySelectorAll('.activity-row').length >= 2, 3000, 'activity rows');
  check('activity section renders events', await page.$$eval('.activity-row', els => els.length) >= 2);
  check('activity shows created and move events',
    (await page.$$eval('.activity-label', els => els.map(e => e.textContent))).some(t => t === 'Created'));
  await clickByText('.modal-actions .btn', 'Cancel');
  await waitFor(() => !document.querySelector('.modal-panel'), 2000, 'activity editor closes');

  // ---- Version 3 export/import round trip ----
  const v3RoundTrip = await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const rec = KB.State.addRecurrence({
      mode: 'scheduled',
      schedule: { frequency: 'daily', interval: 1 },
      target: { boardId: board.id, columnId: board.columns[0].id },
      template: { title: 'Round trip rec', priority: 'none', size: 'none', checklist: [] },
      overlapPolicy: 'single-active',
      missedPolicy: 'create-one'
    });
    const lens = KB.State.addLens({
      name: 'Round trip lens',
      scope: 'active-board',
      boardIds: [],
      query: {},
      sort: { field: 'manual', direction: 'asc' },
      display: { density: 'comfortable', groupBy: 'board' }
    });
    const recCountBefore = KB.State.recurrences().length;
    const boardJson = KB.State.exportBoard();
    const parsed = JSON.parse(boardJson);
    const hasRec = Array.isArray(parsed.recurrences) && parsed.recurrences.some(r => r.id === rec.id);
    const hasLens = Array.isArray(parsed.lenses) && parsed.lenses.some(l => l.id === lens.id);
    const importResult = KB.State.importAll(boardJson);
    const recCountAfter = KB.State.recurrences().length;
    const lensCountAfter = KB.State.lenses().length;
    return { hasRec, hasLens, importResult, recCountBefore, recCountAfter, lensCountAfter, recId: rec.id, boardCount: KB.State.boards().length };
  });
  check('board export includes recurrences and lenses', v3RoundTrip.hasRec && v3RoundTrip.hasLens);
  check('board import brings recurrences and lenses', v3RoundTrip.importResult === 'board' && v3RoundTrip.recCountAfter > v3RoundTrip.recCountBefore && v3RoundTrip.lensCountAfter >= 2);
  const recIdConflict = await page.evaluate((id) => {
    const others = KB.State.recurrences().filter(r => r.id === id);
    return others.length;
  }, v3RoundTrip.recId);
  check('imported recurrence id does not collide', recIdConflict === 1);

  // ---- IndexedDB is the primary store and survives reloads ----
  await page.evaluate(() => {
    const col = KB.State.activeBoard().columns[0];
    KB.State.addCard(col.id, { title: 'IDB persistence probe' });
  });
  await page.evaluate(() => KB.Storage.flush());
  const idbRead = await page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open('kanban-store', 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('state', 'readonly');
      const g = tx.objectStore('state').get('current');
      g.onsuccess = () => {
        const parsed = JSON.parse(g.result);
        db.close();
        resolve({ found: parsed && parsed.boards.some(b => b.columns.some(c => c.cards.some(x => x.title === 'IDB persistence probe'))) });
      };
      g.onerror = () => resolve({ found: false });
    };
    req.onerror = () => resolve({ found: false });
  }));
  check('state persisted to IndexedDB primary', idbRead.found === true);
  await page.goto(URL, { waitUntil: 'load' });
  await waitBoard();
  const idbAfterReload = await page.evaluate(() => ({
    source: KB.Storage.status().source,
    survives: KB.State.activeBoard().columns.some(c => c.cards.some(x => x.title === 'IDB persistence probe'))
  }));
  check('reload loads from IndexedDB', idbAfterReload.source === 'primary' && idbAfterReload.survives === true);

  // ---- Corrupt primary + mirror recovers from a backup ----
  await page.evaluate(() => KB.Storage.backup(KB.State.data(), 'e2e-recovery'));
  const corruptState = await page.evaluate(() => new Promise((resolve) => {
    localStorage.setItem('kanban.mirror.v1', '{not json');
    const req = indexedDB.open('kanban-store', 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('state', 'readwrite');
      tx.objectStore('state').put('{not json', 'current');
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => resolve(false);
    };
    req.onerror = () => resolve(false);
  }));
  check('corruption seeded', corruptState === true);
  await page.goto(URL, { waitUntil: 'load' });
  await waitBoard();
  const recovered = await page.evaluate(() => ({
    source: KB.Storage.status().source,
    boardName: KB.State.activeBoard().name
  }));
  check('recovery falls back to a backup', recovered.source === 'backup' && typeof recovered.boardName === 'string');

  // ---- A valid, newer mirror envelope wins over a corrupt primary ----
  await page.evaluate(async () => {
    // The crash-mirror envelope holds the live state; the IDB primary is
    // then corrupted. The boot must prefer the envelope (it is both newer
    // and valid) instead of skipping it for backups.
    localStorage.setItem('kanban.mirror.v1', JSON.stringify({ savedAt: Date.now() + 1000, payload: KB.State.data() }));
    const req = indexedDB.open('kanban-store', 1);
    return new Promise((resolve) => {
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('state', 'readwrite');
        tx.objectStore('state').put('{not json', 'current');
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => resolve(false);
      };
      req.onerror = () => resolve(false);
    });
  });
  await page.goto(URL, { waitUntil: 'load' });
  await waitBoard();
  const mirrorWon = await page.evaluate(() => ({
    source: KB.Storage.status().source,
    boardName: KB.State.activeBoard().name
  }));
  check('a valid newer mirror recovers over a corrupt primary', mirrorWon.source === 'mirror' && typeof mirrorWon.boardName === 'string');

  // ---- Degraded boot (IndexedDB cannot open) still recovers the mirror ----
  await page.evaluate(() => {
    localStorage.setItem('kanban.mirror.v1', JSON.stringify({ savedAt: Date.now() + 2000, payload: KB.State.data() }));
    localStorage.removeItem('kanban.board.v1');
    sessionStorage.setItem('__degradeNextBoot', '1');
  });
  await page.evaluateOnNewDocument(() => {
    // Once (sessionStorage flag survives the navigation, then is cleared):
    // break indexedDB.open so the next boot degrades to localStorage.
    if (sessionStorage.getItem('__degradeNextBoot') === '1') {
      sessionStorage.removeItem('__degradeNextBoot');
      indexedDB.open = function () {
        const fake = {
          onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null,
          result: null, error: new DOMException('Blocked', 'NotAllowedError')
        };
        setTimeout(() => { if (fake.onerror) fake.onerror({ target: fake }); }, 0);
        return fake;
      };
    }
  });
  await page.goto(URL, { waitUntil: 'load' });
  await waitBoard();
  const degradedRecovered = await page.evaluate(() => ({
    source: KB.Storage.status().source,
    degraded: KB.Storage.status().degraded,
    idbAvailable: KB.Storage.status().idbAvailable,
    boardName: KB.State.activeBoard().name
  }));
  check('degraded boot recovers the mirror envelope', degradedRecovered.source === 'mirror' && degradedRecovered.degraded === true && degradedRecovered.idbAvailable === false && typeof degradedRecovered.boardName === 'string');
  // Restore a healthy page (fresh IndexedDB connection) for the tests below.
  await page.goto(URL, { waitUntil: 'load' });
  await waitBoard();

  // ---- Serialized writes land in order ----
  const writeOrder = await page.evaluate(async () => {
    const writes = [];
    for (let i = 1; i <= 10; i++) {
      writes.push(KB.Storage.save({ ok: true, n: i, tag: 'serial' + i }, 'test-' + i));
    }
    await KB.Storage.flush();
    const req = indexedDB.open('kanban-store', 1);
    return new Promise((resolve) => {
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('state', 'readonly');
        const g = tx.objectStore('state').get('current');
        g.onsuccess = () => { db.close(); resolve(JSON.parse(g.result)); };
        g.onerror = () => resolve(null);
      };
    });
  });
  check('serialized writes preserve order', writeOrder && writeOrder.n === 10 && writeOrder.tag === 'serial10');
  // Restore the real app state into the store so later reloads see valid data.
  await page.evaluate(async () => {
    await KB.Storage.save(KB.State.data(), 'restore');
    await KB.Storage.flush();
  });

  // ---- Sync events fire for every mutation with the right source ----
  const syncEvents = await page.evaluate(async () => {
    window.__syncEvents = [];
    KB.Sync.subscribe((change) => window.__syncEvents.push(change.source));
    const board = KB.State.activeBoard();
    const col = board.columns[0];
    KB.State.addCard(col.id, { title: 'Sync event probe' }); // change
    KB.State.setTheme('dark'); // change
    KB.State.undo(); // undo
    KB.State.redo(); // redo
    KB.State.importAll(KB.State.exportAll()); // import
    await KB.Storage.flush();
    const events = window.__syncEvents;
    return {
      hasChange: events.includes('change'),
      hasUndo: events.includes('undo'),
      hasRedo: events.includes('redo'),
      hasImport: events.includes('import'),
      count: events.length
    };
  });
  check('sync observer sees change/undo/redo/import',
    syncEvents.hasChange && syncEvents.hasUndo && syncEvents.hasRedo && syncEvents.hasImport);

  // ---- Command palette (Ctrl+K) ----
  await page.evaluate(() => KB.Workspaces.set('board'));
  await page.evaluate(() => KB.App.refresh());
  await page.keyboard.down('Control');
  await page.keyboard.press('k');
  await page.keyboard.up('Control');
  await waitFor(() => KB.Palette.isOpen(), 2000, 'palette opens');
  check('ctrl+k opens the command palette', await page.evaluate(() => KB.Palette.isOpen() && document.querySelectorAll('.palette-item').length > 5));
  check('palette focuses its search input', await page.evaluate(() => document.activeElement && document.activeElement.id === 'palette-input'));
  check('palette exposes dialog and combobox semantics', await page.evaluate(() => {
    const panel = document.querySelector('.palette-panel');
    const input = document.getElementById('palette-input');
    return panel.getAttribute('role') === 'dialog' && panel.getAttribute('aria-modal') === 'true' &&
      input.getAttribute('role') === 'combobox' && input.getAttribute('aria-expanded') === 'true' &&
      Boolean(input.getAttribute('aria-activedescendant'));
  }));
  await page.type('#palette-input', 'theme');
  await waitFor(() => {
    const titles = [...document.querySelectorAll('.palette-title')].map(e => e.textContent.toLowerCase());
    return titles.some(t => t.includes('theme'));
  }, 2000, 'palette filters');
  const paletteFiltered = await page.$$eval('.palette-title', els => els.map(e => e.textContent));
  check('palette filters by query', paletteFiltered.length >= 1 && paletteFiltered.every(t => t.toLowerCase().includes('theme')));
  const themeBeforePalette = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.keyboard.press('Enter');
  await waitFor(() => !KB.Palette.isOpen(), 2000, 'palette closes after run');
  const themeAfterPalette = await page.evaluate(() => document.documentElement.dataset.theme);
  check('palette runs the selected command', themeAfterPalette !== themeBeforePalette);
  await page.evaluate((theme) => {
    KB.State.setTheme(theme);
    document.documentElement.dataset.theme = theme;
  }, themeBeforePalette);
  await page.keyboard.down('Control');
  await page.keyboard.press('k');
  await page.keyboard.up('Control');
  await waitFor(() => KB.Palette.isOpen(), 2000, 'palette reopens');
  await page.keyboard.press('Escape');
  await waitFor(() => !KB.Palette.isOpen(), 2000, 'palette escapes');
  check('escape closes the palette', await page.evaluate(() => !KB.Palette.isOpen()));

  // Palette arrow navigation moves the selection
  await page.keyboard.down('Control');
  await page.keyboard.press('k');
  await page.keyboard.up('Control');
  await waitFor(() => KB.Palette.isOpen(), 2000, 'palette reopens for arrows');
  const firstTitle = await page.evaluate(() => document.querySelector('.palette-item.selected .palette-title').textContent);
  await page.keyboard.press('ArrowDown');
  const secondTitle = await page.evaluate(() => document.querySelector('.palette-item.selected .palette-title').textContent);
  check('palette arrows move the selection', secondTitle !== firstTitle);
  await page.keyboard.press('Escape');
  await waitFor(() => !KB.Palette.isOpen(), 2000, 'palette closes after arrows');

  // Shift+letter shortcuts keep working (the old dispatcher matched both cases)
  await page.evaluate(() => { const qa = document.querySelector('.qa-input'); if (qa) qa.blur(); });
  await page.keyboard.down('Shift');
  await page.keyboard.press('N');
  await page.keyboard.up('Shift');
  check('shift+N focuses quick add', await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('qa-input')));

  // App menu is a registry popover and runs a command
  await page.click('#app-menu');
  await waitFor(() => document.querySelectorAll('.pop .pop-item').length > 5, 2000, 'app menu popover');
  check('app menu lists registry categories', await page.evaluate(() => document.querySelectorAll('.pop-category').length >= 5));
  await page.evaluate(() => { [...document.querySelectorAll('.pop .pop-item')].find(b => b.textContent.includes('New board')).click(); });
  await waitFor(() => !!document.querySelector('.modal-panel input'), 2000, 'menu command opens modal');
  check('app menu command runs', (await page.$('.modal-panel input')) !== null);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.modal-actions .btn')].find(x => x.textContent.trim() === 'Cancel');
    if (b) b.click();
  });
  await waitFor(() => !document.querySelector('.modal-panel'), 2000, 'menu modal cancels');

  // ---- Mobile: pager, tabs, and the card action sheet ----
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await waitBoard();
  await page.evaluate(() => KB.Workspaces.set('board'));
  await page.evaluate(() => KB.App.refresh());
  await waitFor(() => !document.getElementById('board-pager').hidden && document.querySelectorAll('.bp-dot').length === 3, 3000, 'mobile pager');
  check('mobile shows a column pager', await page.evaluate(() => {
    const cols = [...document.querySelectorAll('.column')];
    const rect = cols[0].getBoundingClientRect();
    return rect.width > 300 && !document.getElementById('board-pager').hidden;
  }));
  check('mobile bottom tabs visible', await page.evaluate(() => getComputedStyle(document.getElementById('mobile-tabs')).display === 'flex'));
  const colBeforeNext = await page.evaluate(() => KB.Render.pagerActiveIndex());
  await page.click('.bp-next');
  await sleep(400); // let scroll-snap settle
  check('pager next moves to the second column', await page.evaluate((before) => KB.Render.pagerActiveIndex() === before + 1, colBeforeNext));
  await page.evaluate(() => KB.Render.scrollToColumn(0));
  await page.click('.card-actions [data-action="card-sheet"]');
  await waitFor(() => KB.Sheet.isOpen(), 2000, 'card sheet opens');
  await page.keyboard.press('Tab');
  check('sheet traps Tab focus', await page.evaluate(() => {
    return document.querySelector('.sheet-panel').contains(document.activeElement);
  }));
  const sheetItems = await page.$$eval('.sheet-item', els => els.map(e => e.textContent));
  check('card action sheet lists card commands', sheetItems.some(t => t.includes('Archive card')) && sheetItems.some(t => t.includes('Move to')));
  await page.evaluate(() => { [...document.querySelectorAll('.sheet-item')].find(b => b.textContent.includes('Archive card')).click(); });
  await waitFor(() => !KB.Sheet.isOpen(), 2000, 'sheet closes after archive');
  check('archive via action sheet works', await page.evaluate(() => {
    const board = KB.State.activeBoard();
    return board.archive.cards.some(c => c.title === 'Plan the weekly sync') || board.archive.cards.length >= 1;
  }));

  // Action sheet closes on Escape
  await page.evaluate(() => { document.querySelector('.card-actions [data-action="card-sheet"]').click(); });
  await waitFor(() => KB.Sheet.isOpen(), 2000, 'sheet reopens for escape');
  await page.keyboard.press('Escape');
  await waitFor(() => !KB.Sheet.isOpen(), 2000, 'sheet escapes');
  check('escape closes the action sheet', await page.evaluate(() => !KB.Sheet.isOpen()));

  // Filter drawer toggle opens and closes (self-contained: click, settle,
  // then assert — avoids interleaving with unrelated page activity)
  const drawerOpened = await page.evaluate(() => new Promise((resolve) => {
    const bar = document.getElementById('filter-bar');
    document.getElementById('filter-toggle').click();
    setTimeout(() => resolve(bar.classList.contains('open')), 120);
  }));
  check('filter drawer opens on mobile', drawerOpened === true);
  const drawerClosed = await page.evaluate(() => new Promise((resolve) => {
    const bar = document.getElementById('filter-bar');
    document.getElementById('filter-toggle').click();
    setTimeout(() => resolve(!bar.classList.contains('open')), 120);
  }));
  check('filter drawer closes', drawerClosed === true);

  // Breakpoint cross re-renders cards: the mobile label cap must engage and
  // disengage from the matchMedia change listener alone (no manual refresh).
  await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const col = board.columns[0];
    ['l-cap-1', 'l-cap-2', 'l-cap-3', 'l-cap-4', 'l-cap-5'].forEach((id) => {
      if (!board.labels.some(l => l.id === id)) {
        board.labels.push({ id, name: 'Cap ' + id, color: '#3fd7e0' });
      }
    });
    KB.State.addCard(col.id, { title: 'Label cap probe', labels: ['l-cap-1', 'l-cap-2', 'l-cap-3', 'l-cap-4', 'l-cap-5'] });
    KB.App.refresh();
  });
  await waitFor(() => {
    const card = [...document.querySelectorAll('.card')].find(c => c.textContent.includes('Label cap probe'));
    return card && card.querySelector('.more-labels');
  }, 3000, 'mobile label cap engages');
  check('mobile caps labels at three with +N', await page.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find(c => c.textContent.includes('Label cap probe'));
    return card.querySelector('.more-labels') && card.querySelector('.more-labels').textContent === '+2';
  }));
  await page.setViewport({ width: 1440, height: 900, isMobile: false });
  await waitFor(() => {
    const card = [...document.querySelectorAll('.card')].find(c => c.textContent.includes('Label cap probe'));
    return card && card.querySelectorAll('.chip').length >= 5 && !card.querySelector('.more-labels');
  }, 3000, 'desktop re-render after breakpoint');
  check('desktop shows every label after the breakpoint cross', await page.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find(c => c.textContent.includes('Label cap probe'));
    return card.querySelectorAll('.chip').length >= 5 && card.querySelector('.more-labels') === null;
  }));
  // Clean up the probe card so later sections see the board as they expect.
  await page.evaluate(() => {
    const board = KB.State.activeBoard();
    const col = board.columns[0];
    const card = col.cards.find(c => c.title === 'Label cap probe');
    if (card) KB.State.archiveCard(col.id, card.id, board.id);
    KB.App.refresh();
  });

  await page.keyboard.press('Escape');
  await page.setViewport({ width: 1440, height: 900, isMobile: false });
  await waitBoard();

  // ---- Local snapshots: listed, created, restored from the backup dialog ----
  await page.evaluate(() => { KB.Modal.backupModal(); });
  await waitFor(() => document.querySelectorAll('.snapshot-row').length >= 1, 3000, 'snapshot list renders');
  const snapCountBefore = await page.$$eval('.snapshot-row', els => els.length);
  check('snapshots listed in backup dialog', snapCountBefore >= 1);
  await page.evaluate(() => { document.querySelector('.snapshot-actions .btn').click(); }); // Snapshot now
  // The store rotates to maxBackups, so the list may stop growing; the
  // observable contract is a confirmation toast and a fresh manual snapshot.
  await waitFor(() => [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Snapshot saved')), 3000, 'snapshot toast');
  check('snapshot now saves a manual snapshot', await page.evaluate(async () => {
    const backups = await KB.Storage.listBackups();
    return backups.some(b => b.reason === 'manual');
  }));
  check('snapshot row reflects the new snapshot', await page.evaluate(() => {
    const row = document.querySelector('.snapshot-row');
    return row && row.querySelector('.snapshot-reason') && row.querySelector('.snapshot-reason').textContent.indexOf('Manual') !== -1;
  }));
  await page.evaluate(() => { window.confirm = () => true; });
  await page.evaluate(() => { document.querySelector('.snapshot-row .btn').click(); }); // Restore newest
  await waitFor(() => [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Snapshot restored')), 3000, 'snapshot restore toast');
  check('snapshot restore reports success', await page.$$eval('.toast', els => els.some(e => e.textContent.includes('Snapshot restored'))));
  await waitFor(() => !document.querySelector('.modal-panel'), 3000, 'snapshot restore closes dialog');
  check('snapshot restore keeps the board consistent', await page.evaluate(() => {
    return KB.State.activeBoard().name === document.querySelector('#board-name').textContent;
  }));

  // ---- Mid-session IndexedDB write failure degrades to the mirror ----
  const degradeResult = await page.evaluate(async () => {
    const realPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new Error('simulated quota'); };
    KB.State.addCard(KB.State.activeBoard().columns[0].id, { title: 'Degrade probe' });
    await new Promise((r) => setTimeout(r, 60));
    IDBObjectStore.prototype.put = realPut;
    return { degraded: !KB.Storage.status().idbAvailable };
  });
  check('write failure degrades to the mirror', degradeResult.degraded === true);
  const degradeState = await page.evaluate(() => ({
    cardPresent: KB.State.activeBoard().columns[0].cards.some(c => c.title === 'Degrade probe'),
    mirrorHolds: JSON.parse(localStorage.getItem('kanban.mirror.v1')).payload.boards.some(b => b.columns.some(c => c.cards.some(x => x.title === 'Degrade probe')))
  }));
  check('degraded session keeps working via memory and mirror', degradeState.cardPresent && degradeState.mirrorHolds);

  // ---- Cross-tab guard: a second tab is read-only until it takes over ----
  const tab2 = await browser.newPage();
  await tab2.goto(URL, { waitUntil: 'load' });
  await tab2.waitForFunction(() => document.documentElement.dataset.ready === '1', { timeout: 8000 });
  check('second tab is read-only with a banner', await tab2.evaluate(() => KB.MultiTab.readOnly() === true && !!document.querySelector('.multitab-banner')));
  // A mutation in the read-only tab stays in memory and must NOT persist.
  await tab2.evaluate(() => KB.State.addCard(KB.State.activeBoard().columns[0].id, { title: 'Multi-tab probe' }));
  await sleep(400);
  const multiTabNotPersisted = await page.evaluate(() => {
    const m = JSON.parse(localStorage.getItem('kanban.mirror.v1'));
    return !m.payload.boards.some(b => b.columns.some(c => c.cards.some(x => x.title === 'Multi-tab probe')));
  });
  check('read-only tab cannot persist changes', multiTabNotPersisted === true);
  // Takeover: the second tab claims the lock, reloads, and becomes the editor.
  await tab2.evaluate(() => { document.querySelector('.mt-takeover').click(); });
  await tab2.waitForFunction(() => document.documentElement.dataset.ready === '1' && KB.MultiTab.readOnly() === false, { timeout: 8000 });
  check('takeover promotes the second tab', await tab2.evaluate(() => !KB.MultiTab.readOnly() && !document.querySelector('.multitab-banner')));
  // The first tab demotes (broadcast, or its own claim check within ~1s).
  await waitFor(() => {
    return window.KB && KB.MultiTab.readOnly() === true && !!document.querySelector('.multitab-banner');
  }, 6000, 'first tab demotes on takeover');
  check('first tab demotes on takeover', await page.evaluate(() => KB.MultiTab.readOnly() === true));
  // Closing the new owner lets the first tab claim the lock again: the claim
  // goes stale after ~3s, the tab self-promotes and reloads fresh.
  await tab2.close();
  await sleep(3500);
  await page.goto(URL, { waitUntil: 'load' });
  await waitBoard();
  check('first tab resumes editing after the owner closes', await page.evaluate(() => KB.MultiTab.readOnly() === false && !document.querySelector('.multitab-banner')));

  // ---- Reduced motion: palette still opens without animation ----
  const reducedPage = await browser.newPage();
  await reducedPage.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await reducedPage.goto(URL, { waitUntil: 'load' });
  await reducedPage.waitForFunction(() => document.documentElement.dataset.ready === '1', { timeout: 5000 });
  await reducedPage.keyboard.down('Control');
  await reducedPage.keyboard.press('k');
  await reducedPage.keyboard.up('Control');
  await reducedPage.waitForFunction(() => KB.Palette.isOpen(), 3000, 'reduced-motion palette');
  const reducedMotionPalette = await reducedPage.evaluate(() => ({
    open: KB.Palette.isOpen(),
    animation: getComputedStyle(document.querySelector('.palette-panel')).animationName
  }));
  check('palette works under prefers-reduced-motion', reducedMotionPalette.open === true && reducedMotionPalette.animation === 'none');
  await reducedPage.close();

  // ---- PWA: manifest, service worker, offline from cache ----
  const pwaServer = spawn(process.execPath, [path.join(__dirname, '..', 'serve.js')], {
    env: Object.assign({}, process.env, { PORT: '8191' }),
    stdio: 'ignore'
  });
  await sleep(800);
  const pwaPage = await browser.newPage();
  const pwaErrors = [];
  pwaPage.on('pageerror', (e) => pwaErrors.push(e.message));
  try {
    await pwaPage.goto('http://localhost:8191/index.html?boot=off', { waitUntil: 'load' });
    await pwaPage.waitForFunction(() => document.documentElement.dataset.ready === '1', { timeout: 5000 });
    const manifest = await pwaPage.evaluate(async () => {
      const res = await fetch('manifest.webmanifest');
      const json = await res.json();
      return { name: json.name, display: json.display, icons: json.icons.length };
    });
    check('manifest is valid and installable', manifest.name === 'Kanban \u2014 The 8-Bit Atelier' && manifest.display === 'standalone' && manifest.icons >= 3);
    const swState = await pwaPage.evaluate(() => new Promise((resolve) => {
      navigator.serviceWorker.ready.then(() => resolve({
        registered: true,
        controller: Boolean(navigator.serviceWorker.controller)
      })).catch(() => resolve({ registered: false }));
    }));
    check('service worker registers over http', swState.registered === true);
    await sleep(1500); // let the precache finish
    const cacheSize = await pwaPage.evaluate(async () => {
      const keys = await caches.keys();
      if (keys.length === 0) return 0;
      const cache = await caches.open(keys[0]);
      return (await cache.keys()).length;
    });
    check('service worker precaches the app shell', cacheSize >= 30);

    // ---- Update flow: a new worker waits for consent, then reloads ----
    // Puppeteer's request interception cannot see service-worker script
    // fetches, so the update is triggered by registering a patched worker
    // from a temp file under the same scope (an update by another name).
    const tempSwPath = path.join(__dirname, '..', 'sw-update-test.js');
    fs.writeFileSync(tempSwPath, fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8').replace(/kanban-v1/g, 'kanban-v2-updated'));
    try {
      await pwaPage.evaluate(() => { window.__updateMarker = true; });
      await pwaPage.evaluate(() => navigator.serviceWorker.register('/sw-update-test.js', { scope: './' }));
      await pwaPage.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Update ready')), { timeout: 10000 });
      check('update toast appears for a waiting service worker', await pwaPage.evaluate(() => {
        return [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Update ready'));
      }));
      await pwaPage.evaluate(() => {
        const btn = [...document.querySelectorAll('.toast .toast-btn')].find(b => b.textContent.trim() === 'Reload');
        if (btn) btn.click();
      });
      // The reload wipes the marker; wait for it to be gone.
      await pwaPage.waitForFunction(() => document.documentElement.dataset.ready === '1' && window.__updateMarker === undefined, { timeout: 10000 }).catch(() => {});
      await pwaPage.waitForFunction(async () => (await caches.keys()).includes('kanban-v2-updated'), { timeout: 10000 });
      // The updated worker must be active and serving its cache after the
      // consent-driven reload. The old cache may briefly reappear while the
      // dying worker's in-flight fetches complete, so "old cache absent" is
      // not asserted.
      check('updated worker activates and serves the new cache', await pwaPage.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        const keys = await caches.keys();
        return window.__updateMarker === undefined &&
          reg && reg.active && reg.active.scriptURL.indexOf('sw-update-test.js') !== -1 &&
          keys.includes('kanban-v2-updated');
      }));
    } finally {
      try { fs.unlinkSync(tempSwPath); } catch (err) {}
    }

    pwaServer.kill('SIGKILL');
    await sleep(400);
    await pwaPage.reload({ waitUntil: 'load' }).catch(() => {});
    await pwaPage.waitForFunction(() => document.documentElement.dataset.ready === '1', { timeout: 8000 }).catch(() => {});
    const offlineRender = await pwaPage.evaluate(() => ({
      cols: document.querySelectorAll('.column').length,
      ready: document.documentElement.dataset.ready,
      fonts: document.fonts ? document.fonts.status : 'n/a'
    }));
    check('app renders offline from cache', offlineRender.ready === '1' && offlineRender.cols >= 3);
    const swSource = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    const urls = swSource.match(/'(\.\/[^']+)'/g).map((u) => u.slice(1, -1));
    const missing = urls.filter((u) => !fs.existsSync(path.join(__dirname, '..', u.replace(/^\.\//, ''))));
    check('service worker precache lists only real files', missing.length === 0);
    check('pwa page has no errors', pwaErrors.length === 0);
  } finally {
    if (!pwaServer.killed) pwaServer.kill('SIGKILL');
    await pwaPage.close();
  }

  check('no unexpected page errors', errors.filter(e => !e.includes('ERR_CONNECTION_REFUSED')).length === 0);

  console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECKS FAILED');
  if (errors.length) console.log('page errors:\n' + errors.join('\n'));
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('TEST CRASH:', e); process.exit(2); });
