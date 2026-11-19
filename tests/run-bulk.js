// Bulk grouping test through the real UI: a page WITHOUT sections, rows picked by
// click + shift-click, put into "Fill Customer", then generated and checked.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const T = __dirname;

(async () => {
  // Same scan, but with the Section column emptied: a page without sections
  const csv = fs.readFileSync(path.join(T, 'sections.csv'), 'utf8').split('\r\n')
    .map((line, i) => (i === 0 ? line : line.replace(/^("[^"]*";"[^"]*";)"[^"]*"/, '$1""'))).join('\r\n');
  fs.writeFileSync(path.join(T, 'nosections.csv'), csv);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  await page.goto('file://' + path.join(T, '..', 'bp-object-generator.html') + '?nointro');
  await page.setInputFiles('#tplFile', path.join(T, 'template.bpobject'));
  await page.setInputFiles('#csvFile', path.join(T, 'nosections.csv'));
  await page.evaluate(() => BPGen.go(3)); await page.waitForSelector('#tableWrap table');

  // Rows in the table (visible order): pick a "Set" row, then shift-click a range
  const rowLabels = await page.$$eval('#tableWrap tr[data-i]', (trs) => trs.map((tr) => tr.children[5].firstChild.textContent.trim() + ' / ' + tr.querySelector('[data-f=template]').value));
  const idx = (label, tpl) => rowLabels.findIndex((r) => r.startsWith(label) && r.endsWith(tpl));
  const pick = (i, shift) => page.click(`#tableWrap tr[data-i]:nth-child(${i + 1}) [data-f=picked]`, { modifiers: shift ? ['Shift'] : [] });

  await pick(idx('First name', 'TPL Set Text'));            // single pick
  await pick(idx('City', 'TPL Set Text'));                  // start of range
  await pick(idx('Primary address', 'TPL Set Checkbox'), true); // shift-click: City .. Primary address
  // ...that range also caught the Get Text rows; unpick them individually
  for (const label of ['City', 'Post code', 'Street']) await pick(idx(label, 'TPL Get Text'));
  console.log('Picked:', await page.textContent('#pickCount'));

  await page.fill('#bulkName', 'Fill Customer');
  await page.click('#bulkApply');
  console.log('Plan:', (await page.textContent('#plan')).replace(/\s+/g, ' ').trim());

  await page.evaluate(() => BPGen.go(5)); await page.fill('#objName', 'App - Customer');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#generate')]);
  const out = path.join(T, 'bulk.bpobject');
  await dl.saveAs(out);

  // Check the composed action in the generated XML
  const xml = fs.readFileSync(out, 'utf8');
  const result = await page.evaluate((xml) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const kid = (el, t) => [...el.children].find((c) => c.localName === t);
    const sub = [...doc.getElementsByTagName('subsheet')].find((s) => kid(s, 'name').textContent === 'Fill Customer');
    if (!sub) return { error: 'no Fill Customer page' };
    const pid = sub.getAttribute('subsheetid');
    const own = [...doc.getElementsByTagName('stage')].filter((s) => kid(s, 'subsheetid')?.textContent === pid);
    const byId = new Map(own.map((s) => [s.getAttribute('stageid'), s]));
    const start = own.find((s) => s.getAttribute('type') === 'Start');
    const order = []; let cur = start; const seen = new Set();
    while (cur && !seen.has(cur)) { seen.add(cur); order.push(cur.getAttribute('name')); const n = kid(cur, 'onsuccess') || kid(cur, 'ontrue'); cur = n && byId.get(n.textContent); }
    return {
      inputs: [...kid(start, 'inputs').children].map((i) => i.getAttribute('name')),
      data: own.filter((s) => s.getAttribute('type') === 'Data').map((s) => s.getAttribute('name')),
      order,
    };
  }, xml);
  console.log('Fill Customer inputs:', result.inputs);
  console.log('Data items:', result.data);
  console.log('Flow:', result.order.join(' -> '));
  console.log('Status:', (await page.textContent('#genInfo')).slice(0, 60));
  await page.screenshot({ path: path.join(T, 'bulk-ui.png'), fullPage: false });
  await browser.close();
})();
