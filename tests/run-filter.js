// Filter bar in step 3 + default screen names from CSV file names / the Screen column,
// + the scanner's screen-name question (file name and Screen column).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const T = __dirname;
const TMP = path.join(T, 'filter-tmp');
fs.mkdirSync(TMP, { recursive: true });

// Same three scans as run-screens.js, saved under "real life" file names
fs.copyFileSync(path.join(T, 'search.csv'), path.join(TMP, 'Search.csv'));
fs.copyFileSync(path.join(T, 'edit.csv'), path.join(TMP, 'bp-xpaths-Edit (2).csv'));
fs.copyFileSync(path.join(T, 'notfound.csv'), path.join(TMP, 'Not_Found.csv'));
// A scan whose Screen column says "Results" (the file name must NOT win)
const withScreen = fs.readFileSync(path.join(T, 'notfound.csv'), 'utf8').split('\r\n')
  .map((l, i) => l + (i === 0 ? ';Screen' : ';"Results"')).join('\r\n');
fs.writeFileSync(path.join(TMP, 'whatever.csv'), withScreen);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 }, acceptDownloads: true });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('file://' + path.join(T, '..', 'bp-object-generator.html') + '?nointro');
  const problems = [];
  const expect = (ok, msg) => { if (!ok) problems.push(msg); };

  await page.setInputFiles('#tplFile', path.join(T, 'template-chrome.bpobject'));
  await page.evaluate(() => BPGen.go(2));
  await page.setInputFiles('#csvFile', ['Search.csv', 'bp-xpaths-Edit (2).csv', 'Not_Found.csv', 'whatever.csv'].map((f) => path.join(TMP, f)));
  await page.setInputFiles('#csvFile', path.join(TMP, 'Search.csv')); // same file again -> "Search 2"
  const names = await page.$$eval('#scanList input[data-scan]', (ins) => ins.map((i) => i.value));
  console.log('Default screen names:', names);
  expect(names.join('|') === 'Search|Edit|Not Found|Results|Search 2', 'default names');
  await page.click('#scanList button[data-unscan="4"]');
  await page.click('#scanList button[data-unscan="3"]');

  await page.evaluate(() => BPGen.go(3));
  const rowsShown = () => page.$$eval('#tableWrap tr[data-i]', (trs) => trs.length);
  const total = await rowsShown();
  const count = async () => (await page.textContent('#fCount')).trim();

  // 1. text search, several words
  await page.fill('#fSearch', 'amount');
  await page.waitForTimeout(300);
  console.log(`Search "amount": ${await rowsShown()} rows, "${await count()}"`);
  expect(await rowsShown() >= 1 && await rowsShown() < total, 'search');
  await page.fill('#fSearch', 'edit back');
  await page.waitForTimeout(300);
  const labels = await page.$$eval('#tableWrap tr[data-i]', (trs) => trs.map((tr) => tr.children[5].textContent.trim() + ' / ' + tr.children[3].textContent.trim()));
  console.log('Search "edit back":', labels);
  expect(labels.length && labels.every((l) => /Back/.test(l) && /Edit/.test(l)), 'two-word search');

  // 2. screen + step type lists
  await page.fill('#fSearch', '');
  await page.waitForTimeout(300);
  const screenOpts = await page.$$eval('#fScreen option', (os) => os.map((o) => o.textContent));
  const tplOpts = await page.$$eval('#fTemplate option', (os) => os.map((o) => o.textContent));
  console.log('Screen list:', screenOpts, '| Step types:', tplOpts);
  await page.selectOption('#fScreen', 'Not Found');
  await page.selectOption('#fTemplate', 'TPL Click');
  const nf = await page.$$eval('#tableWrap tr[data-i]', (trs) => trs.map((tr) => tr.children[5].textContent.trim()));
  console.log('Not Found + Click:', nf, `"${await count()}"`);
  expect(nf.join() === 'Back', 'screen + type filter');

  // 3. "Use none shown" changes only the shown rows
  const usedBefore = await page.evaluate(() => BPGen.state.items.filter((i) => i.include).length);
  await page.click('#selNone');
  const usedAfter = await page.evaluate(() => BPGen.state.items.filter((i) => i.include).length);
  console.log(`Use none shown: in use ${usedBefore} -> ${usedAfter}`);
  expect(usedAfter === usedBefore - 1, 'use none shown');
  await page.click('#selAll');

  // 4. picks survive the filter: search, pick, search, pick, apply once
  await page.click('#fClear');
  await page.fill('#fSearch', 'order id');
  await page.waitForTimeout(300);
  await page.click('#tableWrap tr[data-i]:first-child [data-f=picked]');
  await page.fill('#fSearch', 'amount set');
  await page.waitForTimeout(300);
  await page.click('#tableWrap tr[data-i]:first-child [data-f=picked]');
  console.log('Pick counter:', await page.textContent('#pickCount'));
  expect((await page.textContent('#pickCount')).includes('2 picked (1 not shown)'), 'pick counter');
  await page.fill('#bulkName', 'Search And Edit');
  await page.click('#bulkApply');
  const grouped = await page.evaluate(() => BPGen.state.items.filter((i) => i.page === 'Search And Edit').map((i) => i.field));
  console.log('Grouped into "Search And Edit":', grouped);
  expect(grouped.length === 2, 'bulk apply across searches');

  // 5. nothing matches
  await page.fill('#fSearch', 'zzz nothing');
  await page.waitForTimeout(300);
  console.log('No match:', (await page.textContent('#tableWrap')).trim());
  await page.click('#fClearLink');
  expect(await rowsShown() === total, 'clear link');
  await page.fill('#fSearch', 'edit');
  await page.waitForTimeout(300);
  await page.locator('section[data-step="3"]').screenshot({ path: path.join(T, 'filter-ui.png') });

  // 6. Scanner: answers "Search" to the question -> file bp-xpaths-Search.csv with a Screen column
  const sp = await browser.newPage({ acceptDownloads: true });
  await sp.setContent('<title>Order Portal</title><input id="orderId" placeholder="Order ID"><button id="go">Search</button>');
  sp.on('dialog', (d) => d.accept('Search'));
  const [dl] = await Promise.all([sp.waitForEvent('download'), sp.addScriptTag({ content: fs.readFileSync(path.join(T, '..', 'bp-xpath-scanner.js'), 'utf8') })]);
  const file = path.join(TMP, dl.suggestedFilename());
  await dl.saveAs(file);
  const lines = fs.readFileSync(file, 'utf8').split('\r\n');
  console.log('Scanner file:', dl.suggestedFilename(), '| header ends:', lines[0].slice(-30), '| row ends:', lines[1].slice(-12));
  expect(dl.suggestedFilename() === 'bp-xpaths-Search.csv' && lines[0].endsWith(';"Screen"') === false && lines[0].endsWith('Screen') && lines[1].endsWith('"Search"'), 'scanner screen name');

  console.log('JS errors:', errs.length ? errs : 'none');
  if (errs.length) problems.push('js errors');
  console.log('PROBLEMS:', problems.length ? problems : 'none');
  await browser.close();
})();
