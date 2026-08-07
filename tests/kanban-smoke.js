const path = require('path');
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

  async function cardAction(col, card, action) {
    await page.hover(`.column:nth-child(${col}) .card:nth-child(${card})`);
    await sleep(60);
    await page.click(`.column:nth-child(${col}) .card:nth-child(${card}) .card-actions [data-action="${action}"]`);
  }
  async function clickByText(selector, text) {
    await page.evaluate((sel, t) => {
      [...document.querySelectorAll(sel)].find(b => b.textContent.trim() === t).click();
    }, selector, text);
  }
  async function blur() { await page.evaluate(() => document.activeElement && document.activeElement.blur()); }
  async function pressUndo() { await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await sleep(200); }
  async function pressRedo() { await page.keyboard.down('Control'); await page.keyboard.press('y'); await page.keyboard.up('Control'); await sleep(200); }

  // ---- Fresh boot ----
  await page.goto(URL, { waitUntil: 'load' });
  await sleep(600);
  check('board renders 3 columns', await page.$$eval('.column', els => els.length) === 3);
  check('board switch shows name', (await page.$eval('#board-name', el => el.textContent)) === 'My Board');
  check('quick-add rows present', await page.$$eval('.qa', els => els.length) === 3);
  check('due chips render', await page.$$eval('.chip.due', els => els.length) >= 2);
  check('checklist progress renders', await page.$$eval('.card-prog', els => els.length) >= 1);

  // ---- Quick-add + undo/redo ----
  await page.type('.column:nth-child(1) .qa-input', 'Brand new task');
  await page.keyboard.press('Enter');
  await sleep(200);
  let count = await page.$$eval('.column:nth-child(1) .card', els => els.length);
  check('quick-add creates card', count === 3);

  await blur();
  await pressUndo();
  count = await page.$$eval('.column:nth-child(1) .card', els => els.length);
  check('ctrl+z undoes quick-add', count === 2);

  await pressRedo();
  count = await page.$$eval('.column:nth-child(1) .card', els => els.length);
  check('ctrl+y redoes quick-add', count === 3);

  // ---- Bulk paste: one undo step ----
  await page.$eval('.column:nth-child(1) .qa-input', (el, v) => { el.value = v; el.focus(); }, 'One\nTwo\nThree');
  await page.keyboard.press('Enter');
  await sleep(200);
  count = await page.$$eval('.column:nth-child(1) .card', els => els.length);
  check('bulk paste adds 3 cards', count === 6);

  await blur();
  await pressUndo();
  count = await page.$$eval('.column:nth-child(1) .card', els => els.length);
  check('bulk paste undoes as one step', count === 3);

  await pressRedo();
  count = await page.$$eval('.column:nth-child(1) .card', els => els.length);
  check('bulk paste redoes as one step', count === 6);

  // ---- Card editor: due date + checklist + duplicate + template ----
  await cardAction(2, 1, 'edit-card');
  await sleep(200);
  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  await page.$eval('#cf-due', (el, v) => { el.value = v; }, iso);
  await page.$eval('.check-add-row input', (el, v) => { el.value = v; }, 'Smoke test item');
  await page.click('.check-add-row .btn');
  await sleep(150);
  await page.click('.check-item input[type="checkbox"]');
  await clickByText('.modal-actions .btn', 'Save');
  await sleep(200);
  check('editor save closes modal', (await page.$('.modal-panel')) === null);
  check('due chip on edited card', await page.$$eval('.chip.due', els => els.length) >= 1);

  await cardAction(2, 1, 'edit-card');
  await sleep(200);
  await clickByText('.modal-actions .btn', 'Duplicate');
  await sleep(250);
  count = await page.$$eval('.column:nth-child(2) .card', els => els.length);
  check('duplicate via editor', count === 3);

  await cardAction(2, 1, 'edit-card');
  await sleep(200);
  await clickByText('.modal-actions .btn', 'Save as template');
  await sleep(200);
  check('template saved toast', await page.$$eval('.toast', els => els.some(e => e.textContent.includes('Template saved'))));
  await clickByText('.modal-actions .btn', 'Cancel');
  await sleep(150);

  // ---- Template use from quick-add ----
  await page.click('.column:nth-child(1) .qa-tpl');
  await sleep(150);
  const popItems = await page.$$eval('.pop .pop-item', els => els.map(e => e.textContent.trim()));
  check('template popup lists templates', popItems.length >= 1);
  await page.click('.pop .pop-item');
  await sleep(200);
  count = await page.$$eval('.column:nth-child(1) .card', els => els.length);
  check('template creates card', count === 7);

  // ---- Column collapse ----
  await page.evaluate(() => {
    const board = document.querySelector('.board');
    const cols = board.querySelectorAll('.column');
    board.scrollLeft = cols[2].offsetLeft;
  });
  await sleep(100);
  await page.click('.column:nth-child(3) .column-header [data-action="col-collapse"]');
  await sleep(200);
  check('column collapses', await page.$eval('.column:nth-child(3)', el => el.classList.contains('collapsed')));
  await page.click('.column:nth-child(3) .column-header [data-action="col-collapse"]');
  await sleep(200);
  check('column expands', !(await page.$eval('.column:nth-child(3)', el => el.classList.contains('collapsed'))));

  // ---- WIP limit via column editor ----
  await page.click('.column:nth-child(2) .column-header [data-action="col-menu"]');
  await sleep(150);
  await page.$eval('#ce-wip', (el) => { el.value = '1'; });
  await page.click('.modal-actions .btn.primary');
  await sleep(200);
  const wipText = await page.$eval('.column:nth-child(2) .col-count', el => el.textContent);
  const wipOver = await page.$eval('.column:nth-child(2) .col-count', el => el.classList.contains('over'));
  check('WIP shows n/limit', wipText === '3/1');
  check('WIP over-limit warning', wipOver);

  // ---- Board switcher: new board ----
  await page.click('#board-switch');
  await sleep(150);
  const menuTexts = await page.$$eval('.pop .pop-item', els => els.map(e => e.textContent));
  check('board menu has actions', menuTexts.some(t => t.includes('New board')) && menuTexts.some(t => t.includes('Backup / restore')));
  await page.evaluate(() => { [...document.querySelectorAll('.pop .pop-item')].find(b => b.textContent.includes('New board')).click(); });
  await sleep(150);
  await page.type('.modal-panel input', 'Sprint 42');
  await page.click('.modal-actions .btn.primary');
  await sleep(250);
  check('switched to new empty board', (await page.$eval('#board-name', el => el.textContent)) === 'Sprint 42');
  check('new board is empty', await page.$$eval('.column', els => els.length) === 0);
  check('empty board state', (await page.$('.empty-board')) !== null);

  // ---- Switch back via menu ----
  await page.click('#board-switch');
  await sleep(150);
  await page.evaluate(() => { [...document.querySelectorAll('.pop .pop-item')].find(b => b.textContent.includes('My Board')).click(); });
  await sleep(200);
  check('switch back to My Board', (await page.$eval('#board-name', el => el.textContent)) === 'My Board');

  // ---- Undo board switch ----
  await pressUndo();
  check('undo board switch', (await page.$eval('#board-name', el => el.textContent)) === 'Sprint 42');
  await pressUndo();
  check('second undo returns to My Board', (await page.$eval('#board-name', el => el.textContent)) === 'My Board');

  // ---- Theme undo re-applies to the DOM ----
  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click('#toggle-theme');
  await sleep(150);
  const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme);
  check('theme toggle flips data-theme', themeAfter !== themeBefore);
  await blur();
  await pressUndo();
  const themeReverted = await page.evaluate(() => document.documentElement.dataset.theme);
  check('undo re-applies theme to DOM', themeReverted === themeBefore);

  // ---- Sort by due ----
  await page.select('#sort-select', 'due');
  await sleep(200);
  const sorted = await page.evaluate(() => {
    const cols = [...document.querySelectorAll('.column')];
    return cols.map(c => [...c.querySelectorAll('.card-title')].map(t => t.textContent));
  });
  check('sort by due orders by date', JSON.stringify(sorted[1]) === JSON.stringify(['Fix card drag on touch screens', 'Copy of Fix card drag on touch screens', 'Write tests for the archive flow']));
  await page.select('#sort-select', 'manual');
  await sleep(200);

  // ---- Filter by due (make dues deterministic in LOCAL time) ----
  await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.board.v1'));
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
    localStorage.setItem('kanban.board.v1', JSON.stringify(b));
  });
  await page.goto(URL, { waitUntil: 'load' });
  await sleep(400);
  await page.select('#due-filter', 'overdue');
  await sleep(200);
  const visibleTitles = await page.$$eval('.column .card-title', els => els.map(e => e.textContent));
  check('overdue filter shows only overdue', visibleTitles.length === 2 && visibleTitles.every(t => t.includes('Fix card drag')));
  await page.select('#due-filter', '');
  await sleep(200);

  // ---- Archive + undo toast ----
  await cardAction(1, 1, 'archive-card');
  await sleep(200);
  count = await page.$$eval('.column:nth-child(1) .card', els => els.length);
  check('archive removes card', count === 6);
  const undoBtns = await page.$$('.toast .toast-btn');
  check('toast has undo button', undoBtns.length >= 1);
  await undoBtns[undoBtns.length - 1].click();
  await sleep(200);
  count = await page.$$eval('.column:nth-child(1) .card', els => els.length);
  check('toast undo restores card', count === 7);

  // ---- Duplicate from card hover ----
  await cardAction(1, 1, 'duplicate-card');
  await sleep(200);
  count = await page.$$eval('.column:nth-child(1) .card', els => els.length);
  check('duplicate adds a card', count === 8);

  // ---- Persistence & migration ----
  const v2 = await page.evaluate(() => JSON.parse(localStorage.getItem('kanban.board.v1')));
  check('saved state is version 2', v2.version === 2 && Array.isArray(v2.boards));

  await page.evaluate(() => {
    const old = JSON.parse(localStorage.getItem('kanban.board.v1'));
    const v1 = { version: 1, theme: 'light', labels: [], columns: old.boards[0].columns.map(c => ({ id: c.id, title: c.title, isDone: c.isDone, cards: c.cards })), archive: { cards: [], columns: [] } };
    localStorage.setItem('kanban.board.v1', JSON.stringify(v1));
  });
  await page.goto(URL, { waitUntil: 'load' });
  await sleep(400);
  const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem('kanban.board.v1')));
  check('v1 migrates to v2 boards', migrated.version === 2 && migrated.boards.length === 1);
  check('migrated cards normalized', migrated.boards[0].columns.every(c => c.cards.every(card => typeof card.due === 'string' && Array.isArray(card.checklist))));
  check('migrated board renders', await page.$$eval('.column', els => els.length) === 3);

  // ---- Corrupt payload resilience ----
  await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.board.v1'));
    const board = b.boards[0];
    board.labels.push(null, { id: 'l-bad', name: 'Bad', color: 'url(https://example.com/x.png)' });
    board.columns[0].cards[0].labels = 'oops';
    delete board.columns[0].cards[1].labels;
    board.columns[0].cards[1].assignee = { evil: true };
    delete board.columns[1].cards;
    localStorage.setItem('kanban.board.v1', JSON.stringify(b));
  });
  await page.goto(URL, { waitUntil: 'load' });
  await sleep(400);
  check('corrupt labels payload still renders', await page.$$eval('.column', els => els.length) === 3);
  const healed = await page.evaluate(() => JSON.parse(localStorage.getItem('kanban.board.v1')));
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
  await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.board.v1'));
    const board = b.boards.find(x => x.id === b.activeBoardId);
    board.columns[0].cards[0].description = '**bold** *ital* `code` and a [link](https://example.com)';
    localStorage.setItem('kanban.board.v1', JSON.stringify(b));
  });
  await page.goto(URL, { waitUntil: 'load' });
  await sleep(400);
  const md = await page.$eval('.card-desc', el => el.innerHTML);
  check('markdown renders bold', md.includes('<strong>bold</strong>'));
  check('markdown renders link', md.includes('href="https://example.com"'));

  await page.evaluate(() => {
    const b = JSON.parse(localStorage.getItem('kanban.board.v1'));
    const board = b.boards.find(x => x.id === b.activeBoardId);
    board.columns[0].cards[0].description = '<img src=x onerror=alert(1)> **b**';
    localStorage.setItem('kanban.board.v1', JSON.stringify(b));
  });
  await page.goto(URL, { waitUntil: 'load' });
  await sleep(400);
  const md2 = await page.$eval('.card-desc', el => el.innerHTML);
  check('markdown is XSS safe', md2.indexOf('<img') === -1 && md2.indexOf('&lt;img') !== -1);

  // ---- Delete board: must toast and refresh the UI ----
  await page.evaluate(() => { window.confirm = () => true; KB.State.addBoard('Delete Me'); KB.App.refresh(); });
  await sleep(200);
  check('delete-board setup board active', (await page.$eval('#board-name', el => el.textContent)) === 'Delete Me');
  await page.click('#board-switch');
  await sleep(150);
  await page.evaluate(() => { [...document.querySelectorAll('.pop .pop-item')].find(b => b.textContent.includes('Delete board')).click(); });
  await sleep(250);
  check('delete board switches board and toasts',
    (await page.$eval('#board-name', el => el.textContent)) === 'My Board' &&
    (await page.$$eval('.toast', els => els.some(e => e.textContent.includes('Board deleted')))));
  const boardsAfterDelete = await page.evaluate(() => KB.State.boards().length);
  check('delete board removes it from state', boardsAfterDelete === 2);

  check('no unexpected page errors', errors.filter(e => !e.includes('ERR_CONNECTION_REFUSED')).length === 0);

  console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECKS FAILED');
  if (errors.length) console.log('page errors:\n' + errors.join('\n'));
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('TEST CRASH:', e); process.exit(2); });
