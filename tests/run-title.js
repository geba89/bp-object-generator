// I_Title-style template: shared inputs once per action, I_/O_ name patterns, roles.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const T = __dirname;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.join(T, '..', 'bp-object-generator.html') + '?nointro');
  const template = fs.readFileSync(path.join(T, 'template-title.bpobject'), 'utf8');
  const csv = fs.readFileSync(path.join(T, 'sections.csv'), 'utf8');

  for (const patterns of [{ inPrefix: '', outPrefix: '' }, { inPrefix: 'I_', outPrefix: 'O_' }]) {
    const r = await page.evaluate(({ template, csv, patterns }) => {
      const tpl = BPGen.parseTemplate(template);
      const shared = BPGen.defaultShared(tpl);
      const opts = { shared, ...patterns };
      BPGen.state.opts = opts; // roles + preview read these
      const items = BPGen.buildItems(BPGen.parseCsv(csv), tpl);
      BPGen.applyMode(items, 'section', tpl);
      const { errors } = BPGen.validate(items, 'App - T', tpl, 'section', opts);
      const { xml, created } = BPGen.generateObject(template, items, 'App - T', 'section', [], opts);

      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const kid = (el, t) => [...el.children].find((c) => c.localName === t);
      const report = {};
      for (const name of ['Fill Address data', 'Get Address data', 'Click Validate address']) {
        const sub = [...doc.getElementsByTagName('subsheet')].find((s) => kid(s, 'name').textContent === name);
        const own = [...doc.getElementsByTagName('stage')].filter((s) => kid(s, 'subsheetid')?.textContent === sub.getAttribute('subsheetid'));
        const start = own.find((s) => s.getAttribute('type') === 'Start');
        const ends = own.filter((s) => s.getAttribute('type') === 'End');
        const data = own.filter((s) => s.getAttribute('type') === 'Data').map((s) => s.getAttribute('name'));
        const dataSet = new Set(data);
        // Every [ref] outside strings must exist; every "stage=" target too
        const bad = [];
        for (const s of own) for (const el of s.getElementsByTagName('*')) for (const a of el.attributes) {
          if (a.name === 'stage' && el.localName !== 'stage') { if (!dataSet.has(a.value)) bad.push(a.value); continue; }
          if (a.name === 'name') continue;
          for (const m of a.value.replace(/"(?:[^"]|"")*"/g, '').matchAll(/\[([^\]]+)\]/g)) if (!dataSet.has(m[1])) bad.push(m[1]);
        }
        // What the Dynamic Action stages get for Page title / Text / Select
        const calls = own.filter((s) => s.getAttribute('type') === 'Action').map((s) => {
          const inp = (n) => [...kid(s, 'inputs').children].find((i) => i.getAttribute('name') === n)?.getAttribute('expr');
          const out = kid(s, 'outputs') ? [...kid(s, 'outputs').children].map((o) => `${o.getAttribute('name')}->[${o.getAttribute('stage')}]`).join(',') : '';
          return `Page title=${inp('Page title')} Text=${inp('Text')} Select=${inp('Select')}${out ? ' out ' + out : ''}`;
        });
        report[name] = {
          inputs: start && kid(start, 'inputs') ? [...kid(start, 'inputs').children].map((i) => i.getAttribute('name')) : [],
          outputs: ends.flatMap((e) => (kid(e, 'outputs') ? [...kid(e, 'outputs').children].map((o) => o.getAttribute('name')) : [])),
          data, bad, calls,
          preview: BPGen.previewParams(BPGen.orderedGroups(items).find((its) => its[0].page === name), tpl, 'section', opts),
        };
      }
      return { shared, errors, actions: created.map((c) => c.name), report };
    }, { template, csv, patterns });

    console.log(`\n======== prefixes '${patterns.inPrefix}' / '${patterns.outPrefix}' ========`);
    console.log('Suggested shared inputs:', r.shared);
    console.log('Validation errors:', r.errors.length ? r.errors : 'none');
    console.log('Actions:', r.actions.join(' | '));
    for (const [name, x] of Object.entries(r.report)) {
      console.log(`\n* ${name}`);
      console.log('  inputs :', x.inputs.join(', ') || '-');
      console.log('  outputs:', x.outputs.join(', ') || '-');
      console.log('  data   :', x.data.join(', '));
      console.log('  preview matches:', JSON.stringify(x.preview.inputs) === JSON.stringify(x.inputs) && JSON.stringify(x.preview.outputs) === JSON.stringify(x.outputs));
      x.calls.slice(0, 2).forEach((c) => console.log('  call   :', c));
      console.log('  broken refs:', x.bad.length ? x.bad : 'none');
    }
  }
  await browser.close();
})();
