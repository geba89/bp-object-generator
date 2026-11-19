// Step-order test through the UI: build "Fill And Validate" (City, Post code, Country,
// Validate address), move the button to the top with the up-arrow, generate, check the flow.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const T = __dirname;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  await page.goto('file://' + path.join(T, '..', 'bp-object-generator.html') + '?nointro');
  await page.setInputFiles('#tplFile', path.join(T, 'template.bpobject'));
  await page.setInputFiles('#csvFile', path.join(T, 'nosections.csv'));
  await page.evaluate(() => BPGen.go(3)); await page.waitForSelector('#tableWrap table');

  // Pick the four rows by label + template
  const want = [['City', 'TPL Set Text'], ['Post code', 'TPL Set Text'], ['Country', 'TPL Select From List'], ['Validate address', 'TPL Click']];
  const rows = await page.$$eval('#tableWrap tr[data-i]', (trs) => trs.map((tr) => [tr.children[5].firstChild.textContent.trim(), tr.querySelector('[data-f=template]').value]));
  for (const [l, t] of want) {
    const n = rows.findIndex(([rl, rt]) => rl === l && rt === t);
    await page.click(`#tableWrap tr[data-i]:nth-child(${n + 1}) [data-f=picked]`);
  }
  await page.fill('#bulkName', 'Fill And Validate');
  await page.click('#bulkApply');

  await page.evaluate(() => BPGen.go(4));
  const order = () => page.$$eval('.ordergroup li', (lis) => lis.map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
  console.log('Before:', await order());
  const upDisabledOnFirst = await page.$eval('.ordergroup li:first-child button[data-move="-1"]', (b) => b.disabled);

  // Move the button (last step) to the top: click its up-arrow three times
  for (let k = 0; k < 3; k++) {
    await page.click('.ordergroup li:has-text("Validate address") button[data-move="-1"]');
  }
  console.log('After: ', await order());
  const downDisabledOnLast = await page.$eval('.ordergroup li:last-child button[data-move="1"]', (b) => b.disabled);
  console.log('Arrows disabled at the ends:', upDisabledOnFirst && downDisabledOnLast);

  // Table rows follow: the button row now comes before the City row
  const tableOrder = await page.$$eval('#tableWrap tr[data-i]', (trs) => trs.map((tr) => tr.children[5].firstChild.textContent.trim()));
  console.log('Table: button row before City row:', tableOrder.indexOf('Validate address') < tableOrder.indexOf('City'));

  await page.evaluate(() => BPGen.go(5)); await page.fill('#objName', 'App - Order Test');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#generate')]);
  const out = path.join(T, 'order.bpobject');
  await dl.saveAs(out);

  // Follow the main path of the generated action from Start
  const flow = await page.evaluate((xml) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const kid = (el, t) => [...el.children].find((c) => c.localName === t);
    const sub = [...doc.getElementsByTagName('subsheet')].find((s) => kid(s, 'name').textContent === 'Fill And Validate');
    const own = [...doc.getElementsByTagName('stage')].filter((s) => kid(s, 'subsheetid')?.textContent === sub.getAttribute('subsheetid'));
    const byId = new Map(own.map((s) => [s.getAttribute('stageid'), s]));
    let cur = own.find((s) => s.getAttribute('type') === 'Start');
    const path = [], seen = new Set();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      path.push(cur.getAttribute('name'));
      const n = kid(cur, 'onsuccess') || kid(cur, 'ontrue');
      cur = n && byId.get(n.textContent);
    }
    return { path, inputs: [...kid(own.find((s) => s.getAttribute('type') === 'Start'), 'inputs').children].map((i) => i.getAttribute('name')) };
  }, fs.readFileSync(out, 'utf8'));
  console.log('Generated flow:', flow.path.join(' -> '));
  console.log('Inputs:', flow.inputs);
  await page.screenshot({ path: path.join(T, 'order-ui.png'), clip: { x: 0, y: 0, width: 1400, height: 1000 }, fullPage: true });
  await browser.close();
})();
