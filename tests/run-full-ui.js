// UI test with the full template: wizard with options set in the UI, generate, both docs,
// then Update mode through its own screen.
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

  // Step 1: template + options
  await page.setInputFiles('#tplFile', path.join(T, 'template-full.bpobject'));
  await page.fill('#verbList input[data-verb="Set"]', 'Enter');
  await page.dispatchEvent('#verbList input[data-verb="Set"]', 'change');
  await page.check('#optTitle');
  console.log('Optional pages:', (await page.textContent('#tplInfo')).match(/Optional pages:(.*?)(Not in|$)/s)[1].replace(/\s+/g, ' ').trim());
  await page.screenshot({ path: path.join(T, 'full-step1.png'), fullPage: true });
  await page.click('section[data-step="1"] .next');

  // Step 2-3: elements, section mode
  await page.setInputFiles('#csvFile', path.join(T, 'full.csv'));
  console.log('Step 2:', (await page.textContent('#csvInfo')).trim());
  await page.click('section[data-step="2"] .next');
  await page.check('input[name=mode][value=section]');
  console.log('Step 3:', (await page.textContent('#plan')).replace(/\s+/g, ' ').trim());
  await page.click('section[data-step="3"] .next');
  await page.click('section[data-step="4"] .next');

  // Step 5: generate + docs
  console.log('Step 5:', (await page.textContent('#genSummary')).replace(/\s+/g, ' ').trim());
  await page.fill('#objName', 'Portal - Address');
  const [obj] = await Promise.all([page.waitForEvent('download'), page.click('#generate')]);
  await obj.saveAs(path.join(T, 'ui-generated.bpobject'));
  const [dh] = await Promise.all([page.waitForEvent('download'), page.click('#docHtml')]);
  await dh.saveAs(path.join(T, 'ui-docs.html'));
  const [dm] = await Promise.all([page.waitForEvent('download'), page.click('#docMd')]);
  await dm.saveAs(path.join(T, 'ui-docs.md'));
  console.log('Downloads:', obj.suggestedFilename(), '|', dh.suggestedFilename(), '|', dm.suggestedFilename());
  console.log('Result:', (await page.textContent('#genInfo')).slice(0, 110));

  // Row Key description in the generated object
  const xml = fs.readFileSync(path.join(T, 'ui-generated.bpobject'), 'utf8');
  console.log('Row Key description:', (xml.match(/name="Row Key" narrative="([^"]*)"/) || [])[1]);

  // Update mode through the UI
  await page.click('#modeUpdate');
  await page.setInputFiles('#updObj', path.join(T, 'ui-generated.bpobject'));
  await page.setInputFiles('#updCsv', path.join(T, 'full-v2.csv'));
  console.log('Update:', (await page.textContent('#updInfo')).replace(/\s+/g, ' ').trim());
  await page.screenshot({ path: path.join(T, 'full-update.png'), fullPage: true });
  const [up] = await Promise.all([page.waitForEvent('download'), page.click('#updApply')]);
  await up.saveAs(path.join(T, 'ui-updated.bpobject'));
  const updated = fs.readFileSync(path.join(T, 'ui-updated.bpobject'), 'utf8');
  console.log('Updated file:', up.suggestedFilename(), '| City now:', (updated.match(/name="XP City"[\s\S]*?<initialvalue[^>]*>([^<]*)</) || [])[1]);
  console.log('JS errors:', errors.length ? errors : 'none');
  await browser.close();
})();
