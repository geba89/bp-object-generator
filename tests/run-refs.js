// Object references: (1) "Calls to other objects" renames the called object in every generated
// stage and is remembered after a reload; (2) the fixer repairs an already generated object:
// one stage fixed "by hand", "Use for all" on that row, download -> every stage fixed.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const T = __dirname;

const resources = (xml) => [...xml.matchAll(/<resource object="([^"]*)" action="([^"]*)"/g)].map((m) => `${m[1]} : ${m[2]}`);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1300, height: 1000 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const url = 'file://' + path.join(T, '..', 'bp-object-generator.html') + '?nointro';
  await page.goto(url);
  const problems = [];
  const expect = (ok, msg) => { if (!ok) problems.push(msg); };

  // ---- 1. rename in the settings, generate ----
  await page.setInputFiles('#tplFile', path.join(T, 'template-chrome.bpobject'));
  const before = await page.$$eval('#refList input', (ins) => ins.map((i) => i.value));
  console.log('Template calls:', before, (await page.textContent('#refList')).replace(/\s+/g, ' ').trim().slice(-30));
  await page.fill('#refList input[data-part=object]', 'Web Browser VBO');
  await page.dispatchEvent('#refList input[data-part=object]', 'change');
  console.log('After rename:', (await page.textContent('#refList')).replace(/\s+/g, ' ').trim());
  await page.locator('#tplSettings').screenshot({ path: path.join(T, 'refs-settings.png'), clip: undefined }).catch(() => {});
  await page.evaluate(() => BPGen.go(2));
  await page.setInputFiles('#csvFile', path.join(T, 'edit.csv'));
  await page.waitForFunction(() => BPGen.state.rows.length > 0);
  await page.evaluate(() => BPGen.go(3));
  await page.evaluate(() => BPGen.go(5));
  await page.fill('#objName', 'Order Portal');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#generate')]);
  const out = path.join(T, 'refs-gen.bpobject');
  await dl.saveAs(out);
  const gen = [...new Set(resources(fs.readFileSync(out, 'utf8')))];
  console.log('Generated object calls:', gen);
  expect(gen.length === 1 && gen[0] === 'Web Browser VBO : Dynamic Action', 'rename applied to generated object');

  // remembered after reload
  const p2 = await ctx.newPage();
  await p2.goto(url);
  await p2.setInputFiles('#tplFile', path.join(T, 'template-chrome.bpobject'));
  const remembered = await p2.$eval('#refList input[data-part=object]', (i) => i.value);
  console.log('After reload, object name field:', remembered);
  expect(remembered === 'Web Browser VBO', 'remembered');

  // ---- 2. fixer: one stage fixed by hand ----
  const broken = fs.readFileSync(path.join(T, 'screens.bpobject'), 'utf8');
  let first = true;
  const oneFixed = broken.replace(/<resource object="Web Browser" action="Dynamic Action"/g, (m) => (first ? ((first = false), '<resource object="Web Browser " action="Dynamic Action"') : m));
  fs.writeFileSync(path.join(T, 'refs-onefixed.bpobject'), oneFixed);
  await p2.click('#refFix summary');
  await p2.setInputFiles('#fixFile', path.join(T, 'refs-onefixed.bpobject'));
  await p2.waitForFunction(() => BPGen.state.fix && BPGen.state.fix.refs.length > 0);
  console.log('Fixer:', (await p2.textContent('#fixInfo')).trim());
  const rows = await p2.$$eval('#fixList tr', (trs) => trs.slice(1).map((tr) => tr.children[0].textContent + ' x' + tr.children[1].textContent));
  console.log('Rows:', rows);
  expect(rows.length === 2, 'two spellings listed');
  // the hand-fixed row is the one used once (sorted by count: last)
  await p2.click('#fixList tr:last-child button[data-fixall]');
  console.log('Button:', await p2.textContent('#fixDownload'));
  await p2.locator('#refFix').screenshot({ path: path.join(T, 'refs-fixer.png') });
  const [dl2] = await Promise.all([p2.waitForEvent('download'), p2.click('#fixDownload')]);
  const fixedPath = path.join(T, 'refs-fixed.bpobject');
  await dl2.saveAs(fixedPath);
  const fixed = fs.readFileSync(fixedPath, 'utf8');
  const fixedRefs = [...new Set(resources(fixed))];
  console.log('Fixed file:', dl2.suggestedFilename(), fixedRefs, '| stages:', resources(fixed).length, 'of', resources(broken).length);
  expect(fixedRefs.length === 1 && fixedRefs[0] === 'Web Browser  : Dynamic Action', 'all stages copied exactly from the hand-fixed one');
  // the fixed file is still a valid object the generator can read
  const ok = await p2.evaluate((xml) => { try { return BPGen.parseTemplate(xml).pages.length; } catch (e) { return e.message; } }, fixed);
  console.log('Fixed file parses, pages:', ok);
  expect(typeof ok === 'number' && ok > 5, 'fixed file valid');
  // Typed name instead
  await p2.fill('#fixList tr:nth-child(2) input[data-part=object]', 'Utility - Web Browser');
  await p2.dispatchEvent('#fixList tr:nth-child(2) input[data-part=object]', 'change');
  console.log('Typed name ->', await p2.textContent('#fixDownload'));

  console.log('JS errors:', errs.length ? errs : 'none');
  if (errs.length) problems.push('js errors');
  console.log('PROBLEMS:', problems.length ? problems : 'none');
  await browser.close();
})();
