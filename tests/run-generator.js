// End-to-end test in Chromium:
//   1. scan sample.html with the scanner -> CSV
//   2. generate an object from template.bpobject + CSV
//   3. check the generated XML is structurally sound
//   4. drive the real UI (file inputs, Generate button) and capture the download
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const T = __dirname;
const ROOT = path.join(T, '..');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, acceptDownloads: true });

  // ---- 1. Scan the sample page ----
  await page.goto('file://' + path.join(T, 'sample.html'));
  await page.evaluate(() => { window.BP_SCAN_CONFIG = { downloadCsv: false, showOverlay: false }; });
  await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'bp-xpath-scanner.js'), 'utf8') });
  const csv = await page.evaluate(() => BPScan.csv);
  fs.writeFileSync(path.join(T, 'scan.csv'), '﻿' + csv);

  // ---- 2 + 3. Generate via the API and check the result ----
  const template = fs.readFileSync(path.join(T, 'template.bpobject'), 'utf8');
  await page.goto('file://' + path.join(ROOT, 'bp-object-generator.html') + '?nointro');
  const report = await page.evaluate(({ template, csv }) => {
    const tpl = BPGen.parseTemplate(template);
    const rows = BPGen.parseCsv('﻿' + csv);
    const items = BPGen.buildItems(rows, tpl);
    const { errors } = BPGen.validate(items, 'App - Order Form', tpl);
    const { xml, created } = BPGen.generateObject(template, items, 'App - Order Form');

    // --- structural checks on the generated XML ---
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const problems = [];
    if (doc.getElementsByTagName('parsererror').length) problems.push('output is not well-formed XML');
    const proc = doc.documentElement;
    if (proc.getAttribute('name') !== 'App - Order Form') problems.push('object not renamed');

    const subs = [...doc.getElementsByTagName('subsheet')];
    const stages = [...doc.getElementsByTagName('stage')];
    const subIds = new Set(subs.map((s) => s.getAttribute('subsheetid')));
    const stageIds = stages.map((s) => s.getAttribute('stageid'));
    const pageNames = subs.map((s) => s.querySelector('name').textContent);

    if (pageNames.some((n) => n.startsWith('TPL '))) problems.push('TPL pages still present');
    if (new Set(stageIds).size !== stageIds.length) problems.push('duplicate stage ids');
    if (subIds.size !== subs.length) problems.push('duplicate subsheet ids');
    if (new Set(pageNames.map((n) => n.toLowerCase())).size !== pageNames.length) problems.push('duplicate page names');
    if (xml.includes('{{XPATH}}') || xml.includes('{{LABEL}}')) problems.push('unfilled placeholders');

    // No GUID from the template survives (so import never clashes with it)
    const oldGuids = new Set(template.match(/[0-9a-f]{8}-[0-9a-f-]{27}/g));
    const leaked = (xml.match(/[0-9a-f]{8}-[0-9a-f-]{27}/g) || []).filter((x) => oldGuids.has(x));
    if (leaked.length) problems.push(`${leaked.length} template GUIDs leaked`);

    // Every link points to something that exists
    const idSet = new Set(stageIds);
    for (const s of stages) {
      const sub = s.querySelector(':scope > subsheetid');
      if (sub && !subIds.has(sub.textContent)) problems.push(`stage ${s.getAttribute('name')} -> missing page`);
      const next = s.querySelector(':scope > onsuccess');
      if (next && !idSet.has(next.textContent)) problems.push(`stage ${s.getAttribute('name')} -> missing next stage`);
    }

    // Each page's SubSheetInfo stage carries the page name
    for (const sub of subs) {
      const id = sub.getAttribute('subsheetid');
      const info = stages.find((s) => s.getAttribute('type') === 'SubSheetInfo' && s.querySelector(':scope > subsheetid')?.textContent === id);
      if (info && info.getAttribute('name') !== sub.querySelector('name').textContent) problems.push(`info stage name mismatch on ${sub.querySelector('name').textContent}`);
    }

    // Application Modeller reference follows the remapped element id
    const appId = doc.querySelector('appdef element > id').textContent;
    const refs = [...doc.querySelectorAll('step > element')].map((e) => e.getAttribute('id'));
    if (!refs.length || refs.some((r) => r !== appId)) problems.push('element references broken');

    // XPath expressions as Blue Prism will see them
    const exprs = stages.filter((s) => s.getAttribute('type') === 'Action')
      .map((s) => ({ page: subs.find((p) => p.getAttribute('subsheetid') === s.querySelector(':scope > subsheetid')?.textContent)?.querySelector('name').textContent,
        expr: [...s.querySelectorAll('inputs > input')].find((i) => i.getAttribute('name') === 'XPath')?.getAttribute('expr') }))
      .filter((e) => e.expr);

    return {
      validationErrors: errors,
      itemsTotal: items.length,
      skipped: items.filter((i) => !i.include).map((i) => `#${i.index} ${i.base}: ${i.note}`),
      created: created.length,
      pages: pageNames,
      exprs,
      problems,
      xmlHead: xml.slice(0, 120),
    };
  }, { template, csv });

  console.log('Validation errors:', report.validationErrors.length ? report.validationErrors : 'none');
  console.log(`Items: ${report.itemsTotal}, generated: ${report.created}`);
  console.log('Skipped:\n  ' + report.skipped.join('\n  '));
  console.log('Pages in generated object:\n  ' + report.pages.join('\n  '));
  console.log('XPath expressions:');
  report.exprs.forEach((e) => console.log(`  ${e.page.padEnd(26)} ${e.expr}`));
  console.log('Head:', report.xmlHead.replace(/\n/g, ' '));
  console.log('PROBLEMS:', report.problems.length ? report.problems : 'none');

  // ---- 4. Real UI flow ----
  await page.reload();
  await page.setInputFiles('#tplFile', path.join(T, 'template.bpobject'));
  await page.setInputFiles('#csvFile', path.join(T, 'scan.csv'));
  await page.evaluate(() => BPGen.go(3)); await page.waitForSelector('#tableWrap table');
  await page.evaluate(() => BPGen.go(5));
  await page.fill('#objName', 'App - Order Form');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#generate')]);
  const out = path.join(T, dl.suggestedFilename());
  await dl.saveAs(out);
  console.log('\nUI download:', dl.suggestedFilename(), fs.statSync(out).size, 'bytes');
  console.log('UI result:', (await page.textContent('#genInfo')).slice(0, 90));
  await page.screenshot({ path: path.join(T, 'generator-ui.png'), fullPage: true });

  await browser.close();
  process.exit(report.problems.length ? 1 : 0);
})();
