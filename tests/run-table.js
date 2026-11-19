// Read Table: scan a page with a table, build the template from the mock Web Browser
// object, generate, then check the generated action (read -> C# code stage -> collection
// output) and compile + run the C# code taken OUT OF THE GENERATED OBJECT on Chrome's
// real table text.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const T = __dirname;
const TT = path.join(T, 'table');

const pageHtml = `<!doctype html><title>Invoices</title>
<label for="q">Customer</label><input id="q"><button id="go">Search</button>
<table id="invoices"><caption>Invoices</caption>
  <thead><tr><th>Invoice</th><th>Amount</th><th>Status</th></tr></thead>
  <tbody><tr><td>INV-1</td><td>120.50</td><td>Open</td></tr>
         <tr><td>INV-2</td><td></td><td>Paid</td></tr></tbody></table>`;

(async () => {
  const browser = await chromium.launch();
  const problems = [];
  const expect = (ok, msg) => { if (!ok) problems.push(msg); };

  // 1. scan the page (real scanner) and keep Chrome's own table text
  const sp = await browser.newPage({ acceptDownloads: true });
  await sp.setContent(pageHtml);
  const chromeText = await sp.$eval('#invoices', (e) => e.innerText);
  fs.writeFileSync(path.join(TT, 'invoices.txt'), chromeText);
  await sp.evaluate(() => { window.BP_SCAN_CONFIG = { askScreenName: false, showOverlay: false }; });
  const [csvDl] = await Promise.all([sp.waitForEvent('download'), sp.addScriptTag({ content: fs.readFileSync(path.join(T, '..', 'bp-xpath-scanner.js'), 'utf8') })]);
  const csvPath = path.join(T, 'invoices.csv');
  await csvDl.saveAs(csvPath);

  // 2. template from the mock object, generate
  const page = await browser.newPage({ acceptDownloads: true });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('file://' + path.join(T, '..', 'bp-object-generator.html') + '?nointro');
  await page.click('#tplBuild summary');
  await page.setInputFiles('#chromeFile', path.join(T, 'chrome-mock.bpobject'));
  await page.waitForFunction(() => !!BPGen.state.chrome);
  await page.click('#chromeUse');
  console.log('Builder:', (await page.textContent('#chromeResult')).replace(/\s+/g, ' ').trim().slice(0, 260));
  expect((await page.textContent('#chromeResult')).includes('TPL Read Table'), 'builder makes TPL Read Table');
  await page.evaluate(() => BPGen.go(2));
  await page.setInputFiles('#csvFile', csvPath);
  await page.waitForFunction(() => BPGen.state.rows.length > 0);
  await page.evaluate(() => BPGen.go(3));
  const tableStep = await page.evaluate(() => BPGen.state.items.filter((i) => i.type === 'Table').map((i) => ({ page: i.page, field: i.field, template: i.template, include: i.include })));
  console.log('Table step:', JSON.stringify(tableStep));
  expect(tableStep.length === 1 && tableStep[0].template === 'TPL Read Table' && tableStep[0].include, 'table row uses TPL Read Table');
  await page.evaluate(() => BPGen.go(5));
  await page.fill('#objName', 'Invoices');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#generate')]);
  const out = path.join(T, 'table-gen.bpobject');
  await dl.saveAs(out);

  // 3. look at the generated action
  const r = await page.evaluate(({ xml, action }) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const kid = (el, t) => [...el.children].find((c) => c.localName === t);
    const sub = [...doc.getElementsByTagName('subsheet')].find((s) => kid(s, 'name').textContent === action);
    if (!sub) return { error: 'no action ' + action, pages: [...doc.getElementsByTagName('subsheet')].map((s) => kid(s, 'name').textContent) };
    const own = [...doc.getElementsByTagName('stage')].filter((s) => kid(s, 'subsheetid')?.textContent === sub.getAttribute('subsheetid'));
    const byId = new Map(own.map((s) => [s.getAttribute('stageid'), s]));
    const start = own.find((s) => s.getAttribute('type') === 'Start');
    const end = own.find((s) => s.getAttribute('type') === 'End');
    const flow = []; let cur = start;
    while (cur && flow.length < 20) { flow.push(`${cur.getAttribute('type')}:${cur.getAttribute('name')}`); const n = kid(cur, 'onsuccess'); cur = n && byId.get(n.textContent); }
    const code = own.find((s) => s.getAttribute('type') === 'Code');
    const read = own.find((s) => s.getAttribute('type') === 'Action');
    const outName = kid(kid(end, 'outputs'), 'output');
    return {
      flow,
      inputs: [...(kid(start, 'inputs')?.children || [])].map((i) => i.getAttribute('name')),
      output: `${outName.getAttribute('name')} (${outName.getAttribute('type')})`,
      collectionStages: own.filter((s) => s.getAttribute('type') === 'Collection').map((s) => s.getAttribute('name')),
      codeOut: kid(kid(code, 'outputs'), 'output').getAttribute('stage'),
      codeIn: [...kid(code, 'inputs').children].map((i) => `${i.getAttribute('name')}=${i.getAttribute('expr')}`),
      readXPath: [...kid(read, 'inputs').children].find((i) => i.getAttribute('name') === 'I_XPath').getAttribute('expr'),
      readOut: kid(kid(read, 'outputs'), 'output').getAttribute('stage'),
      language: [...doc.getElementsByTagName('stage')].find((s) => s.getAttribute('type') === 'ProcessInfo')?.getElementsByTagName('language')[0]?.textContent,
      code: kid(code, 'code').textContent,
    };
  }, { xml: fs.readFileSync(out, 'utf8'), action: tableStep[0].page });
  if (r.error) { console.log(r); problems.push(r.error); }
  else {
    console.log('Flow:', r.flow.join(' -> '));
    console.log('Inputs:', r.inputs, '| Output:', r.output, '| Collection items:', r.collectionStages);
    console.log('Read:', r.readXPath, '->', r.readOut, '| Code:', r.codeIn.join(', '), '->', r.codeOut, '| language:', r.language);
    expect(r.flow.filter((f) => !f.startsWith('Calculation:Step')).join() === 'Start:Start,Action:Read table text,Code:Text to collection,End:End', 'flow');
    expect(r.output.endsWith('(collection)') && r.collectionStages.includes(r.output.split(' (')[0]) && r.codeOut === r.output.split(' (')[0], 'collection output wired');
    expect(r.language === 'csharp', 'object language C#');

    // 4. compile the code FROM THE GENERATED OBJECT and run it on Chrome's table text
    const harness = fs.readFileSync(path.join(TT, 'Harness.cs'), 'utf8').replace('BODY', r.code);
    fs.writeFileSync(path.join(TT, 'HarnessGen.cs'), harness);
    execFileSync('mcs', ['-r:System.Data.dll', `-out:${path.join(TT, 'gen.exe')}`, path.join(TT, 'HarnessGen.cs')]);
    const run = execFileSync('mono', [path.join(TT, 'gen.exe'), path.join(TT, 'invoices.txt')]).toString();
    console.log('C# code from the generated object, run on Chrome text:\n' + run.split('\n').slice(0, 5).map((l) => '  ' + l).join('\n'));
    expect(run.includes('columns: Invoice | Amount | Status') && run.includes('INV-1 | 120.50 | Open') && run.includes('INV-2 |  | Paid'), 'code result');
  }
  console.log('JS errors:', errs.length ? errs : 'none');
  if (errs.length) problems.push('js errors');
  console.log('PROBLEMS:', problems.length ? problems : 'none');
  await browser.close();
})();
