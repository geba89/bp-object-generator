// Section-mode test in Chromium: sections.csv + template.bpobject -> object with
// "Fill <Section>" / "Get <Section>" actions. Verifies structure, flow and data references.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const T = __dirname;
const ROOT = path.join(T, '..');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  await page.goto('file://' + path.join(ROOT, 'bp-object-generator.html') + '?nointro');

  const template = fs.readFileSync(path.join(T, 'template.bpobject'), 'utf8');
  const csv = fs.readFileSync(path.join(T, 'sections.csv'), 'utf8');

  for (const mode of ['section', 'element']) {
    const report = await page.evaluate(({ template, csv, mode }) => {
      const tpl = BPGen.parseTemplate(template);
      const items = BPGen.buildItems(BPGen.parseCsv(csv), tpl);
      BPGen.applyMode(items, mode, tpl);
      const { errors, warnings } = BPGen.validate(items, 'App - Customer', tpl, mode);
      const { xml, created } = BPGen.generateObject(template, items, 'App - Customer', mode);

      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const problems = [];
      const kid = (el, tag) => [...el.children].find((c) => c.localName === tag);
      const txt = (el, tag) => (kid(el, tag)?.textContent || '').trim();
      if (doc.getElementsByTagName('parsererror').length) problems.push('not well-formed');

      const subs = [...doc.getElementsByTagName('subsheet')];
      const stages = [...doc.getElementsByTagName('stage')];
      const byId = new Map(stages.map((s) => [s.getAttribute('stageid'), s]));
      if (byId.size !== stages.length) problems.push('duplicate stage ids');
      if (new Set(subs.map((s) => s.getAttribute('subsheetid'))).size !== subs.length) problems.push('duplicate page ids');
      if (/\{\{(XPATH|LABEL|ACTION)\}\}/.test(xml)) problems.push('unfilled placeholder');
      const oldGuids = new Set(template.match(/[0-9a-f]{8}-[0-9a-f-]{27}/g));
      if ((xml.match(/[0-9a-f]{8}-[0-9a-f-]{27}/g) || []).some((x) => oldGuids.has(x))) problems.push('template GUID leaked');

      const links = (s) => ['onsuccess', 'ontrue', 'onfalse'].map((t) => txt(s, t)).filter(Boolean);
      const outsideStrings = (e) => e.replace(/"(?:[^"]|"")*"/g, '');
      const summary = [];

      for (const sub of subs) {
        const pid = sub.getAttribute('subsheetid');
        const name = txt(sub, 'name');
        const own = stages.filter((s) => txt(s, 'subsheetid') === pid);
        if (!own.length) continue; // e.g. Clean Up in the mock has no stages
        const type = (s) => s.getAttribute('type');
        const starts = own.filter((s) => type(s) === 'Start');
        if (starts.length !== 1) { problems.push(`${name}: ${starts.length} Start stages`); continue; }

        // Every link resolves to a stage on the same page
        for (const s of own) for (const l of links(s)) {
          if (!byId.has(l)) problems.push(`${name}: ${s.getAttribute('name')} -> missing stage`);
          else if (txt(byId.get(l), 'subsheetid') !== pid) problems.push(`${name}: link leaves the page`);
        }
        // Walk the flow from Start
        const seen = new Set(); const queue = [starts[0]];
        while (queue.length) {
          const s = queue.shift();
          if (seen.has(s)) continue;
          seen.add(s);
          links(s).forEach((l) => byId.has(l) && queue.push(byId.get(l)));
        }
        const flow = own.filter((s) => !['Data', 'Collection', 'SubSheetInfo'].includes(type(s)));
        const unreachable = flow.filter((s) => !seen.has(s));
        if (unreachable.length) problems.push(`${name}: unreachable ${unreachable.map((s) => s.getAttribute('name')).join(', ')}`);
        if (![...seen].some((s) => type(s) === 'End')) problems.push(`${name}: never reaches End`);

        // Data references
        const dataNames = own.filter((s) => ['Data', 'Collection'].includes(type(s))).map((s) => s.getAttribute('name'));
        if (new Set(dataNames).size !== dataNames.length) problems.push(`${name}: duplicate data item names`);
        const dataSet = new Set(dataNames);
        for (const s of own) {
          for (const el of s.getElementsByTagName('*')) {
            for (const a of el.attributes) {
              if (a.name === 'name' || a.name === 'stage') continue;
              const v = a.value;
              if (!v.includes('[')) continue;
              for (const m of outsideStrings(v).matchAll(/\[([^\]]+)\]/g)) {
                if (!dataSet.has(m[1].split('.')[0])) problems.push(`${name}: [${m[1]}] has no data item`);
              }
            }
            const st = el.getAttribute('stage');
            if (st && el.localName !== 'stage' && !dataSet.has(st)) problems.push(`${name}: stores into missing data item "${st}"`);
          }
        }
        // Flow order (Start, then by following links)
        const order = [];
        let cur = starts[0];
        const guard = new Set();
        while (cur && !guard.has(cur)) {
          guard.add(cur);
          order.push(`${cur.getAttribute('name')}@${kid(cur, 'display')?.getAttribute('y')}`);
          cur = byId.get(txt(cur, 'onsuccess') || txt(cur, 'ontrue'));
        }
        summary.push({ name, inputs: [...(kid(starts[0], 'inputs')?.children || [])].map((i) => i.getAttribute('name')),
          outputs: own.filter((s) => type(s) === 'End').flatMap((e) => [...(kid(e, 'outputs')?.children || [])].map((o) => o.getAttribute('name'))),
          order });
      }
      // Exception details as Blue Prism will see them
      const exceptions = [...doc.getElementsByTagName('exception')].map((e) => {
        const st = e.parentElement;
        const pg = subs.find((s) => s.getAttribute('subsheetid') === txt(st, 'subsheetid'));
        return `${txt(pg, 'name')} / ${st.getAttribute('name')}: ${e.getAttribute('detail')}`;
      });
      return { exceptions, errors, warnings, created: created.map((c) => ({ name: c.name, steps: c.steps.map((s) => `${s.field || '-'}: ${s.expression}`) })), problems, summary, xml };
    }, { template, csv, mode });

    console.log(`\n================ MODE: ${mode} ================`);
    console.log('Validation errors:', report.errors.length ? report.errors : 'none');
    console.log('Warnings:', report.warnings);
    for (const c of report.created) {
      const s = report.summary.find((x) => x.name === c.name);
      console.log(`\n* ${c.name}   in: [${s.inputs.join(', ')}]   out: [${s.outputs.join(', ')}]`);
      c.steps.forEach((st) => console.log('    ' + st));
      if (c.steps.length > 1) console.log('    flow: ' + s.order.join(' -> '));
    }
    console.log('\nException details:\n  ' + report.exceptions.slice(0, 4).join('\n  '));
    console.log('\nPROBLEMS:', report.problems.length ? report.problems : 'none');
    fs.writeFileSync(path.join(T, `generated-${mode}.bpobject`), report.xml);
  }

  // UI: section mode via the radio button, screenshot
  await page.reload();
  await page.setInputFiles('#tplFile', path.join(T, 'template.bpobject'));
  await page.setInputFiles('#csvFile', path.join(T, 'sections.csv'));
  await page.evaluate(() => BPGen.go(3)); await page.waitForSelector('#tableWrap table');
  await page.check('input[name=mode][value=section]');
  await page.evaluate(() => BPGen.go(5));
  await page.fill('#objName', 'App - Customer');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#generate')]);
  console.log('\nUI download:', dl.suggestedFilename());
  await page.screenshot({ path: path.join(T, 'sections-ui.png'), fullPage: true });
  await browser.close();
})();
