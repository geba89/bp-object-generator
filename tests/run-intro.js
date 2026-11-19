// Getting started guide + embedded scanner:
//  - opens by itself on the first visit, not after "Got it", again with "show every time"
//  - "Copy scanner" puts exactly bp-xpath-scanner.js on the clipboard, "Download" saves it
//  - the copied scanner runs on a page and produces a CSV
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const T = __dirname;
const scannerFile = fs.readFileSync(path.join(T, '..', 'bp-xpath-scanner.js'), 'utf8');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1250, height: 950 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const url = 'file://' + path.join(T, '..', 'bp-object-generator.html'); // no ?nointro: like a real first visit
  const problems = [];
  const expect = (ok, msg) => { if (!ok) problems.push(msg); };
  const isOpen = () => page.evaluate(() => document.getElementById('intro').open);

  // 1. first visit: the guide is open
  await page.goto(url);
  expect(await isOpen(), 'guide opens on first visit');
  console.log('First visit, guide open:', await isOpen(), '|', await page.textContent('#scannerInfo'));
  await page.screenshot({ path: path.join(T, 'intro.png') });

  // 2. copy: clipboard = scanner file
  await page.click('#scannerCopy');
  await page.waitForTimeout(200);
  console.log('Copy button:', await page.textContent('#scannerCopy'));
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip.trim() === scannerFile.trim(), 'clipboard = scanner file');
  console.log('Clipboard equals bp-xpath-scanner.js:', clip.trim() === scannerFile.trim(), `(${clip.length} chars)`);

  // 3. download: same file
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#scannerDownload')]);
  const saved = path.join(T, 'intro-scanner.js');
  await dl.saveAs(saved);
  const same = fs.readFileSync(saved, 'utf8').trim() === scannerFile.trim();
  console.log('Download:', dl.suggestedFilename(), 'equals file:', same);
  expect(same && dl.suggestedFilename() === 'bp-xpath-scanner.js', 'download');

  // 4. the copied scanner really runs (on a small page)
  const sp = await ctx.newPage();
  await sp.setContent('<title>Search</title><label for="q">Order ID</label><input id="q" value="123"><button>Search</button>');
  sp.on('dialog', (d) => d.accept('Search'));
  const [csv] = await Promise.all([sp.waitForEvent('download'), sp.addScriptTag({ content: clip })]);
  console.log('Copied scanner ran, CSV:', csv.suggestedFilename());
  expect(csv.suggestedFilename() === 'bp-xpaths-Search.csv', 'copied scanner runs');
  await sp.close();

  // 5. "Got it" -> not again; "show every time" -> again
  await page.click('#introDone');
  await page.reload();
  console.log('After "Got it" + reload, open:', await isOpen());
  expect(!(await isOpen()), 'stays closed after Got it');
  await page.click('#introOpen');
  expect(await isOpen(), 'button opens it');
  await page.check('#introAgain');
  await page.click('#introDone');
  await page.reload();
  console.log('With "show every time" + reload, open:', await isOpen());
  expect(await isOpen(), 'show every time');
  await page.uncheck('#introAgain');
  await page.keyboard.press('Escape'); // Esc closes it too and remembers the choice
  await page.reload();
  expect(!(await isOpen()), 'Esc remembers');
  // link in step 2
  await page.setInputFiles('#tplFile', path.join(T, 'template-chrome.bpobject'));
  await page.waitForFunction(() => !!BPGen.state.tpl);
  await page.evaluate(() => BPGen.go(2));
  await page.click('#introFromCsv');
  expect(await isOpen(), 'link in step 2 opens it');

  console.log('JS errors:', errs.length ? errs : 'none');
  if (errs.length) problems.push('js errors');
  console.log('PROBLEMS:', problems.length ? problems : 'none');
  await browser.close();
})();
