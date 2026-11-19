// Repair: (1) the fixer repairs an old object (no ProcessInfo, empty Clean Up);
// (2) the template builder and the generator now produce complete objects;
// (3) every page of every generated object has exactly one Start; repair is idempotent.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const T = __dirname;

// The "old broken object": a generated object without the object info stage and with an
// empty Clean Up page, like objects made before the repair existed
function makeBroken() {
  let xml = fs.readFileSync(path.join(T, 'screens.bpobject'), 'utf8');
  xml = xml.replace(/<stage [^>]*type="ProcessInfo"[^>]*>[\s\S]*?<\/stage>/, '');
  const clean = xml.match(/<subsheet subsheetid="([^"]+)" type="CleanUp"/)[1];
  xml = xml.replace(new RegExp(`<stage [^>]*>(?:(?!<\\/stage>)[\\s\\S])*?<subsheetid>${clean}</subsheetid>[\\s\\S]*?<\\/stage>`, 'g'), '');
  fs.writeFileSync(path.join(T, 'screens-broken.bpobject'), xml);
}

(async () => {
  makeBroken();
  const browser = await chromium.launch();
  const page = await browser.newPage({ acceptDownloads: true });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('file://' + path.join(T, '..', 'bp-object-generator.html') + '?nointro');
  const problems = [];
  const expect = (ok, msg) => { if (!ok) problems.push(msg); };

  // Structure report of an object: ProcessInfo count, pages without exactly one Start, Clean Up flow
  const report = (xml) => page.evaluate((xml) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const kid = (el, t) => [...el.children].find((c) => c.localName === t);
    const stages = [...doc.getElementsByTagName('stage')];
    const sid = (s) => (kid(s, 'subsheetid')?.textContent || '').toLowerCase();
    const bad = [];
    const mainStarts = stages.filter((s) => !sid(s) && s.getAttribute('type') === 'Start').length;
    if (mainStarts !== 1) bad.push(`Initialise has ${mainStarts} Start stages`);
    let cleanUp = '';
    for (const sub of doc.getElementsByTagName('subsheet')) {
      const id = sub.getAttribute('subsheetid').toLowerCase();
      const own = stages.filter((s) => sid(s) === id);
      const starts = own.filter((s) => s.getAttribute('type') === 'Start');
      if (starts.length !== 1) bad.push(`"${kid(sub, 'name').textContent}" has ${starts.length} Start stages`);
      if (sub.getAttribute('type') === 'CleanUp' && starts[0]) {
        const next = own.find((s) => s.getAttribute('stageid') === kid(starts[0], 'onsuccess')?.textContent);
        cleanUp = `Start -> ${next ? next.getAttribute('type') : 'nothing'}`;
      }
    }
    return { valid: !doc.getElementsByTagName('parsererror').length, info: stages.filter((s) => s.getAttribute('type') === 'ProcessInfo').length, cleanUp, bad, again: BPGen.repairObject(doc) };
  }, xml);

  // 1. Fixer on the old broken object
  const before = await report(fs.readFileSync(path.join(T, 'screens-broken.bpobject'), 'utf8'));
  console.log('Old object:', JSON.stringify({ info: before.info, cleanUp: before.cleanUp, bad: before.bad }));
  await page.click('#refFix summary');
  await page.setInputFiles('#fixFile', path.join(T, 'screens-broken.bpobject'));
  console.log('Fixer says:', (await page.textContent('#fixInfo')).replace(/\s+/g, ' ').trim());
  console.log('Button:', await page.textContent('#fixDownload'));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#fixDownload')]);
  const fixedPath = path.join(T, 'screens-repaired.bpobject');
  await dl.saveAs(fixedPath);
  const after = await report(fs.readFileSync(fixedPath, 'utf8'));
  console.log('Repaired:', JSON.stringify(after));
  expect(after.valid && after.info === 1 && after.cleanUp === 'Start -> End' && !after.bad.length && !after.again.length, 'fixer repair');
  // The original file was not touched by the check
  expect((await report(fs.readFileSync(path.join(T, 'screens-broken.bpobject'), 'utf8'))).info === 0, 'original untouched');

  // 2. Freshly built template + generated objects from the other test runs
  for (const f of ['template-chrome.bpobject', 'screens.bpobject', 'refs-gen.bpobject', 'order.bpobject', 'bulk.bpobject']) {
    const r = await report(fs.readFileSync(path.join(T, f), 'utf8'));
    console.log(`${f}:`, JSON.stringify({ info: r.info, cleanUp: r.cleanUp, bad: r.bad, again: r.again.length }));
    expect(r.valid && r.info === 1 && r.cleanUp === 'Start -> End' && !r.bad.length && !r.again.length, 'structure ' + f);
  }
  console.log('JS errors:', errs.length ? errs : 'none');
  if (errs.length) problems.push('js errors');
  console.log('PROBLEMS:', problems.length ? problems : 'none');
  await browser.close();
})();
