// Full-feature test: scan -> generate (all options) -> structural checks -> docs -> update mode.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const T = __dirname, ROOT = path.join(T, '..');

async function scan(page, file) {
  await page.goto('file://' + path.join(T, file));
  await page.evaluate(() => { window.BP_SCAN_CONFIG = { downloadCsv: false, showOverlay: false }; });
  await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'bp-xpath-scanner.js'), 'utf8') });
  return page.evaluate(() => ({ csv: BPScan.csv, rows: BPScan.rows.map(({ el, ...r }) => r) }));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const problems = [];
  const check = (ok, msg) => { if (!ok) problems.push(msg); };

  // ---- 1. Scan ----
  const s1 = await scan(page, 'full.html');
  const pwd = s1.rows.find((r) => r.Label === 'Password');
  console.log('Password row:', pwd.Type, '/', pwd['BP Action'], '| meta:', pwd['Page Title'], '|', pwd['Page URL'].replace(/^.*\//, '.../'), '|', pwd['Scanned At']);
  check(pwd.Type === 'Password Field' && pwd['BP Action'] === 'Write Password', 'password not detected');

  // ---- 2. Generate with every option on ----
  await page.goto('file://' + path.join(ROOT, 'bp-object-generator.html') + '?nointro');
  const template = fs.readFileSync(path.join(T, 'template-full.bpobject'), 'utf8');
  const res = await page.evaluate(({ template, csv }) => {
    const tpl = BPGen.parseTemplate(template);
    const opts = { shared: BPGen.defaultShared(tpl), inPrefix: 'I_', outPrefix: 'O_', groupData: true, verbs: { Set: 'Enter' },
      titleCase: true, xpathItems: true, checkPage: true, descriptions: true };
    BPGen.state.opts = opts;
    const rows = BPGen.parseCsv(csv);
    const meta = BPGen.metaOf(rows);
    const items = BPGen.buildItems(rows, tpl);
    BPGen.applyMode(items, 'section', tpl, opts);
    const v = BPGen.validate(items, 'Portal - Address', tpl, 'section', opts);
    const out = BPGen.generateObject(template, items, 'Portal - Address', 'section', [], opts, meta);
    const docs = BPGen.buildDocs(out, 'Portal - Address', meta);
    // element mode too, for verb + title case on single actions
    BPGen.applyMode(items, 'element', tpl, opts);
    const elementNames = BPGen.orderedGroups(items).map((g) => g[0].page);
    return { v, xml: out.xml, created: out.created.map((c) => ({ name: c.name, inputs: c.inputs, outputs: c.outputs, description: c.description })),
      xpaths: out.xpaths, checkSkipped: out.checkSkipped, docs, elementNames, shared: opts.shared };
  }, { template, csv: s1.csv });
  fs.writeFileSync(path.join(T, 'full-generated.bpobject'), res.xml);
  console.log('\nShared:', res.shared, '| validation errors:', res.v.errors.length ? res.v.errors : 'none');
  console.log('Warnings:', res.v.warnings);
  console.log('Section-mode actions:');
  res.created.forEach((c) => console.log(`  ${c.name.padEnd(22)} in: ${c.inputs.join(', ') || '-'}   out: ${c.outputs.join(', ') || '-'}`));
  console.log('Element-mode names (verbs + Title Case):', res.elementNames.join(' | '));
  console.log('XP items:'); res.xpaths.forEach((x) => console.log(`  ${x.name.padEnd(18)} ${x.value}`));
  console.log('Not in Check Page:', res.checkSkipped);

  // ---- 3. Structural checks on the generated XML ----
  const r = await page.evaluate((xml) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const kid = (el, t) => [...el.children].find((c) => c.localName === t);
    const txt = (el, t) => (kid(el, t)?.textContent || '').trim();
    const p = [];
    if (doc.getElementsByTagName('parsererror').length) p.push('not well-formed');
    const subs = [...doc.getElementsByTagName('subsheet')];
    const stages = [...doc.getElementsByTagName('stage')];
    const byId = new Map(stages.map((s) => [s.getAttribute('stageid'), s]));
    if (byId.size !== stages.length) p.push('duplicate stage ids');
    if (subs.some((s) => txt(s, 'name').startsWith('TPL '))) p.push('TPL page left');
    if (/\{\{[A-Z]+\}\}/.test(xml)) p.push('unfilled placeholder: ' + xml.match(/.{40}\{\{[A-Z]+\}\}.{20}/)[0]);
    const pageOf = (s) => txt(s, 'subsheetid');
    // Global (visible) data items: not <private/>
    const globalData = new Set(stages.filter((s) => s.getAttribute('type') === 'Data' && !kid(s, 'private')).map((s) => s.getAttribute('name')));
    const pages = {};
    for (const sub of subs) {
      const id = sub.getAttribute('subsheetid'), name = txt(sub, 'name');
      const own = stages.filter((s) => pageOf(s) === id);
      if (!own.length) continue;
      const local = new Set(own.filter((s) => s.getAttribute('type') === 'Data').map((s) => s.getAttribute('name')));
      const names = own.filter((s) => s.getAttribute('type') === 'Data').map((s) => s.getAttribute('name'));
      if (new Set(names).size !== names.length) p.push(`${name}: duplicate data items`);
      for (const s of own) {
        for (const t of ['onsuccess', 'ontrue', 'onfalse']) { const to = txt(s, t); if (to && (!byId.has(to) || pageOf(byId.get(to)) !== id)) p.push(`${name}: bad link`); }
        for (const el of s.getElementsByTagName('*')) for (const a of el.attributes) {
          if (a.name === 'stage' && el.localName !== 'stage') { if (!local.has(a.value) && !globalData.has(a.value)) p.push(`${name}: stores into missing "${a.value}"`); continue; }
          if (a.name === 'name') continue;
          for (const m of a.value.replace(/"(?:[^"]|"")*"/g, '').matchAll(/\[([^\]]+)\]/g)) if (!local.has(m[1]) && !globalData.has(m[1])) p.push(`${name}: [${m[1]}] missing`);
        }
      }
      const start = own.find((s) => s.getAttribute('type') === 'Start');
      const info = own.find((s) => s.getAttribute('type') === 'SubSheetInfo');
      pages[name] = {
        published: sub.getAttribute('published'),
        inputs: start && kid(start, 'inputs') ? [...kid(start, 'inputs').children].map((i) => `${i.getAttribute('name')}:${i.getAttribute('type')}${i.getAttribute('narrative') ? ' "' + i.getAttribute('narrative') + '"' : ''}`) : [],
        blocks: own.filter((s) => s.getAttribute('type') === 'Block').map((s) => s.getAttribute('name')),
        xpathInputs: own.filter((s) => s.getAttribute('type') === 'Action').map((s) => [...kid(s, 'inputs').children].find((i) => i.getAttribute('name') === 'XPATH')?.getAttribute('expr')).filter(Boolean),
        exceptions: own.filter((s) => s.getAttribute('type') === 'Exception').map((s) => kid(s, 'exception').getAttribute('detail')),
        calcs: own.filter((s) => s.getAttribute('type') === 'Calculation').map((s) => kid(s, 'calculation').getAttribute('expression')),
        info: info ? txt(info, 'narrative') : '',
        data: names,
      };
    }
    return { problems: p, pages, objectNarrative: doc.documentElement.getAttribute('narrative') };
  }, res.xml);
  problems.push(...r.problems);
  const P = r.pages;
  console.log('\nObject description:', r.objectNarrative);
  const show = (name, keys) => { console.log(`\n* ${name}`); for (const k of keys) console.log(`  ${k}:`, JSON.stringify(P[name]?.[k])); };
  show('Fill Login', ['inputs', 'blocks', 'xpathInputs', 'info']);
  show('Fill Address Data', ['blocks', 'xpathInputs', 'exceptions']);
  show('Click Edit', ['inputs', 'xpathInputs']);
  show('Check Page Elements', ['inputs', 'data', 'xpathInputs', 'calcs', 'info']);
  show('Element XPaths', ['published', 'data', 'info']);

  check(P['Fill Login']?.inputs.some((i) => i.startsWith('I_Password:password')), 'password input not Password type');
  check(P['Fill Address Data']?.blocks.filter((b) => !['Inputs', 'Outputs', 'Local data'].includes(b)).join() === 'City,Post code,Country', 'blocks not named per field');
  check(P['Click Edit']?.xpathInputs[0]?.startsWith('Replace([XP Edit], "{ROW}", [I_Row Key])'), 'row XPath not via Replace');
  check(P['Check Page Elements']?.data.filter((d) => d === 'O_Missing').length === 1, 'Missing not shared');
  check(P['Element XPaths']?.published === 'False', 'XPaths page published');
  check(res.docs.md.includes('| Fill Address Data |') && res.docs.html.includes('<h3'), 'docs incomplete');

  // ---- 4. Update mode: the app changed the City field's id ----
  fs.writeFileSync(path.join(T, 'full-v2.html'), fs.readFileSync(path.join(T, 'full.html'), 'utf8').replace(/id="city"/, 'id="cityName"').replace(/for="city"/, 'for="cityName"'));
  const s2 = await scan(page, 'full-v2.html');
  await page.goto('file://' + path.join(ROOT, 'bp-object-generator.html') + '?nointro');
  const u = await page.evaluate(({ xml, csv }) => {
    const g = BPGen.parseGenerated(xml);
    const { diff, newRows } = BPGen.diffObject(g.xps, BPGen.parseCsv(csv));
    const changes = new Map(diff.filter((d) => d.apply).map((d) => [d.name, d.newValue]));
    const { xml: out, count } = BPGen.applyUpdate(xml, changes);
    const ids = (x) => [...new DOMParser().parseFromString(x, 'application/xml').getElementsByTagName('stage')].map((s) => s.getAttribute('stageid')).join();
    const changedOnly = xml.replace(/<initialvalue[^>]*>[^<]*<\/initialvalue>/g, '').replace(/narrative="[^"]*"/, '') ===
      out.replace(/<initialvalue[^>]*>[^<]*<\/initialvalue>/g, '').replace(/narrative="[^"]*"/, '');
    return { diff: diff.map((d) => `${d.name}: ${d.status}${d.status === 'changed' ? ' -> ' + d.newValue : ''}`), newRows: newRows.length, count, sameIds: ids(xml) === ids(out), changedOnly };
  }, { xml: res.xml, csv: s2.csv });
  console.log('\nUpdate diff:\n  ' + u.diff.join('\n  '));
  console.log('Applied:', u.count, '| IDs unchanged:', u.sameIds, '| nothing else changed:', u.changedOnly, '| new on page:', u.newRows);
  check(u.count === 1 && u.sameIds && u.changedOnly, 'update mode');

  console.log('\nPROBLEMS:', problems.length ? problems : 'none');
  fs.writeFileSync(path.join(T, 'full-docs.html'), res.docs.html);
  fs.writeFileSync(path.join(T, 'full-docs.md'), res.docs.md);
  fs.writeFileSync(path.join(T, 'full-v2.csv'), '﻿' + s2.csv);
  fs.writeFileSync(path.join(T, 'full.csv'), '﻿' + s1.csv);
  await browser.close();
})();
