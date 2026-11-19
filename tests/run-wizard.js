// Wizard test through the UI: gating, combine, order (actions + steps), generate.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const T = __dirname;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + path.join(T, '..', 'bp-object-generator.html') + '?nointro');
  const visibleStep = () => page.$eval('section[data-step]:not([hidden])', (s) => s.dataset.step);
  const navState = () => page.$$eval('#stepNav button', (bs) => bs.map((b) => `${b.dataset.go}${b.classList.contains('current') ? '*' : ''}${b.disabled ? '(locked)' : ''}`).join(' '));

  // ---- Step 1: Next without a template is blocked ----
  console.log('Start:', await visibleStep(), '|', await navState());
  await page.click('section[data-step="1"] .next');
  console.log('Blocked message:', await page.textContent('section[data-step="1"] + .wizmsg, section[data-step="1"] .wizmsg').catch(() => 'none'));
  await page.setInputFiles('#tplFile', path.join(T, 'template.bpobject'));
  await page.click('section[data-step="1"] .next');

  // ---- Step 2: elements ----
  console.log('Now on step', await visibleStep());
  await page.setInputFiles('#csvFile', path.join(T, 'sections.csv'));
  console.log('Step 2 info:', (await page.textContent('#csvInfo')).trim());
  await page.click('section[data-step="2"] .next');

  // ---- Step 3: section mode + one manual action ----
  await page.check('input[name=mode][value=section]');
  const rows = await page.$$eval('#tableWrap tr[data-i]', (trs) => trs.map((tr) => [tr.children[5].firstChild.textContent.trim(), tr.querySelector('[data-f=template]').value]));
  const rowOf = (l, t) => rows.findIndex(([rl, rt]) => rl.startsWith(l) && rt === t) + 1;
  // Put the "Save" click into "Fill Address data" (so that action ends with a click)
  await page.click(`#tableWrap tr[data-i]:nth-child(${rowOf('Save', 'TPL Click')}) [data-f=picked]`);
  await page.fill('#bulkName', 'Fill Address data');
  await page.click('#bulkApply');
  console.log('Step 3:', (await page.textContent('#plan')).replace(/\s+/g, ' ').trim());
  await page.click('section[data-step="3"] .next');

  // ---- Step 4: order ----
  const orderView = () => page.$$eval('.ordergroup', (gs) => gs.map((g) => g.querySelector('.head b').textContent));
  console.log('Step 4 actions before:', (await orderView()).join(' | '));
  const addr = '.ordergroup:has(.head b:text-matches("Fill Address data"))';
  console.log('Fill Address data I/O:', await page.textContent(`${addr} .io`));
  // Move "Fill Address data" to the top (it is 3rd: two clicks up)
  for (let k = 0; k < 2; k++) await page.click(`${addr} .head button[data-act="-1"]`);
  // Inside it, move Save (last step) to... one up, so it runs before the checkbox step
  await page.click(`${addr} li:has-text("Save") button[data-move="-1"]`);
  console.log('Step 4 actions after: ', (await orderView()).join(' | '));
  const addrSteps = await page.$$eval(`${addr} li`, (lis) => lis.map((li) => li.textContent.replace(/\s+/g, ' ').trim().replace(/^▲▼ /, '')));
  console.log('Fill Address data steps:', addrSteps.join(' -> '));
  await page.click('section[data-step="4"] .next');

  // ---- Step 5: generate ----
  console.log('Step 5 summary:', (await page.textContent('#genSummary')).replace(/\s+/g, ' ').slice(0, 140));
  await page.fill('#objName', 'App - Wizard');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#generate')]);
  const out = path.join(T, 'wizard.bpobject');
  await dl.saveAs(out);

  const check = await page.evaluate((xml) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const kid = (el, t) => [...el.children].find((c) => c.localName === t);
    const pages = [...doc.getElementsByTagName('subsheet')].map((s) => kid(s, 'name').textContent);
    const sub = [...doc.getElementsByTagName('subsheet')].find((s) => kid(s, 'name').textContent === 'Fill Address data');
    const own = [...doc.getElementsByTagName('stage')].filter((s) => kid(s, 'subsheetid')?.textContent === sub.getAttribute('subsheetid'));
    const byId = new Map(own.map((s) => [s.getAttribute('stageid'), s]));
    let cur = own.find((s) => s.getAttribute('type') === 'Start');
    const flow = [], seen = new Set();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      if (['Action', 'End'].includes(cur.getAttribute('type'))) flow.push(cur.getAttribute('name'));
      const n = kid(cur, 'onsuccess') || kid(cur, 'ontrue');
      cur = n && byId.get(n.textContent);
    }
    return { pages, flow };
  }, fs.readFileSync(out, 'utf8'));
  console.log('Pages in object:', check.pages.join(' | '));
  console.log('Fill Address data flow:', check.flow.join(' -> '));
  console.log('Final nav:', await navState());
  console.log('JS errors:', errors.length ? errors : 'none');
  await page.screenshot({ path: path.join(T, 'wizard-step5.png'), fullPage: true });
  await page.click('#stepNav button[data-go="4"]');
  await page.screenshot({ path: path.join(T, 'wizard-step4.png'), fullPage: true });
  await browser.close();
})();
