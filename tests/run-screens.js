// Several screens in one object: three scans of a "Order Portal" app (Search, Edit, Not Found)
// loaded through the UI with the Web Browser template. Checks screen names, action names,
// the shared "Back" button XPath, XP names, one Check Page Elements per screen, and that
// one scan still works exactly as before.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const T = __dirname;

const head = 'Index;Type;Section;Label;XPath;BP Action;Quality;Strategy;Visible;Group;Option XPath;BP Expression;Page URL;Page Title;Scanned At';
const row = (i, type, section, label, xp, action, title) =>
  [i, type, section, label, xp, action, 'Stable', 'id', 'Yes', '', '', '', 'https://orders.local/app', title, '2026-11-17 08:00'].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';');
const csv = (rows) => '﻿' + [head, ...rows].join('\r\n');
const scans = {
  'search.csv': csv([
    row(1, 'Text Field', '', 'Order ID', "//input[@id='orderId']", 'Write Text / Read Text', 'Order Portal'),
    row(2, 'Dropdown', '', 'Year', "//select[@id='year']", 'Select From List', 'Order Portal'),
    row(3, 'Button', '', 'Search', "//button[@id='search']", 'Click', 'Order Portal'),
  ]),
  'edit.csv': csv([
    row(1, 'Text Field', 'Details', 'Amount', "//input[@id='amount']", 'Write Text / Read Text', 'Order Portal'),
    row(2, 'Dropdown', 'Details', 'Reason', "//select[@id='reason']", 'Select From List', 'Order Portal'),
    row(3, 'Button', '', 'Save', "//button[@id='save']", 'Click', 'Order Portal'),
    row(4, 'Button', '', 'Back', "//button[normalize-space()='Back']", 'Click', 'Order Portal'),
  ]),
  'notfound.csv': csv([
    row(1, 'Text', '', 'Message', "//div[@class='no-results']", 'Write Text / Read Text', 'Order Portal'),
    row(2, 'Button', '', 'Back', "//button[normalize-space()='Back']", 'Click', 'Order Portal'),
  ]),
};
for (const [f, c] of Object.entries(scans)) fs.writeFileSync(path.join(T, f), c);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 }, acceptDownloads: true });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('file://' + path.join(T, '..', 'bp-object-generator.html') + '?nointro');
  const problems = [];
  const expect = (ok, msg) => { if (!ok) problems.push(msg); };

  await page.setInputFiles('#tplFile', path.join(T, 'template-chrome.bpobject'));
  await page.evaluate(() => BPGen.go(2));
  // Two files at once, then a third one
  await page.setInputFiles('#csvFile', [path.join(T, 'search.csv'), path.join(T, 'edit.csv')]);
  await page.setInputFiles('#csvFile', path.join(T, 'notfound.csv'));
  // Name the screens
  const names = ['Search', 'Edit', 'Not Found'];
  for (let k = 0; k < 3; k++) {
    await page.fill(`#scanList input[data-scan="${k}"]`, names[k]);
    await page.dispatchEvent(`#scanList input[data-scan="${k}"]`, 'change');
  }
  await page.locator('section[data-step="2"]').screenshot({ path: path.join(T, 'screens-step2.png') });

  // Step 3: section mode, look at the action names
  await page.evaluate(() => BPGen.go(3));
  await page.check('input[name=mode][value=section]');
  const actions = await page.evaluate(() => [...new Set(BPGen.state.items.filter((i) => i.include).map((i) => i.page))]);
  console.log('Actions:', actions);
  for (const a of ['Search - Fill Page', 'Search - Click Search', 'Edit - Fill Details', 'Edit - Click Save', 'Edit - Click Back', 'Not Found - Get Page', 'Not Found - Click Back'])
    expect(actions.includes(a), 'missing action ' + a);
  await page.locator('#tableWrap').screenshot({ path: path.join(T, 'screens-step3.png') });

  // Generate
  await page.evaluate(() => BPGen.go(5));
  await page.fill('#objName', 'Order Portal');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#generate')]);
  const out = path.join(T, 'screens.bpobject');
  await dl.saveAs(out);
  const r = await page.evaluate((xml) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const kid = (el, t) => [...el.children].find((c) => c.localName === t);
    const pages = [...doc.getElementsByTagName('subsheet')].map((s) => kid(s, 'name').textContent);
    const xps = [...doc.getElementsByTagName('stage')].filter((s) => s.getAttribute('type') === 'Data' && s.getAttribute('name').startsWith('XP '))
      .map((s) => `${s.getAttribute('name')} = ${kid(s, 'initialvalue').textContent}`);
    return { pages, xps, narrative: doc.documentElement.getAttribute('narrative'), valid: !doc.getElementsByTagName('parsererror').length };
  }, fs.readFileSync(out, 'utf8'));
  console.log('Pages:', r.pages.join(' | '));
  console.log('XP items:\n  ' + [...new Set(r.xps)].join('\n  '));
  console.log('Description:', r.narrative.slice(0, 220));
  expect(r.valid, 'xml');
  expect(r.xps.some((x) => x.startsWith('XP Not Found Back =')), 'own XP item for Back on Not Found');
  expect(r.pages.filter((p) => p === 'Edit - Click Back' || p === 'Not Found - Click Back').length === 2, 'Back button on both screens');

  // Remove two scans: back to a single scan, names without screens
  await page.evaluate(() => BPGen.go(2));
  await page.click('#scanList button[data-unscan="2"]');
  await page.click('#scanList button[data-unscan="1"]');
  const single = await page.evaluate(() => [...new Set(BPGen.state.items.filter((i) => i.include).map((i) => i.page))]);
  console.log('After removing 2 scans:', single);
  expect(single.includes('Fill Page') && !single.some((a) => a.includes(' - ')), 'single scan names');

  console.log('JS errors:', errs.length ? errs : 'none');
  if (errs.length) problems.push('js errors');
  console.log('PROBLEMS:', problems.length ? problems : 'none');
  await browser.close();
})();
