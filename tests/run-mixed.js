// Mixed action: Set Text, Set Text, Select From List, Click in ONE action.
// Set Text template has exception handling (Wait For Element -> Found? -> Exception).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const T = __dirname;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.join(T, '..', 'bp-object-generator.html') + '?nointro');
  const template = fs.readFileSync(path.join(T, 'template.bpobject'), 'utf8');
  const csv = fs.readFileSync(path.join(T, 'sections.csv'), 'utf8');

  const r = await page.evaluate(({ template, csv }) => {
    const tpl = BPGen.parseTemplate(template);
    const items = BPGen.buildItems(BPGen.parseCsv(csv), tpl);
    // Pick: City (Set Text), Post code (Set Text), Country (dropdown), Validate address (button)
    const want = [['City', 'TPL Set Text'], ['Post code', 'TPL Set Text'], ['Country', 'TPL Select From List'], ['Validate address', 'TPL Click']];
    for (const it of items) it.picked = want.some(([l, t]) => it.label === l && it.template === t);
    BPGen.assignToAction(items, 'Fill And Validate Address');
    const { errors } = BPGen.validate(items, 'App - Test', tpl, 'element');
    const { xml } = BPGen.generateObject(template, items, 'App - Test', 'element');

    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const kid = (el, t) => [...el.children].find((c) => c.localName === t);
    const txt = (el, t) => (kid(el, t)?.textContent || '').trim();
    const sub = [...doc.getElementsByTagName('subsheet')].find((s) => txt(s, 'name') === 'Fill And Validate Address');
    const pid = sub.getAttribute('subsheetid');
    const own = [...doc.getElementsByTagName('stage')].filter((s) => txt(s, 'subsheetid') === pid);
    const byId = new Map(own.map((s) => [s.getAttribute('stageid'), s]));
    const type = (s) => s.getAttribute('type');
    const start = own.find((s) => type(s) === 'Start');

    // Every branch, written as "stage -[label]-> stage"
    const edges = [];
    for (const s of own) for (const [tag, lbl] of [['onsuccess', ''], ['ontrue', 'yes'], ['onfalse', 'no']]) {
      const to = txt(s, tag);
      if (to) edges.push(`${s.getAttribute('name')} -${lbl ? '[' + lbl + ']' : ''}-> ${byId.get(to)?.getAttribute('name') || 'MISSING'}`);
    }
    const dataSet = new Set(own.filter((s) => type(s) === 'Data').map((s) => s.getAttribute('name')));
    const badRefs = [];
    for (const s of own) for (const el of s.getElementsByTagName('*')) for (const a of el.attributes) {
      if (a.name === 'name' || a.name === 'stage') continue;
      for (const m of a.value.replace(/"(?:[^"]|"")*"/g, '').matchAll(/\[([^\]]+)\]/g)) if (!dataSet.has(m[1])) badRefs.push(m[1]);
    }
    return {
      errors,
      inputs: [...kid(start, 'inputs').children].map((i) => i.getAttribute('name')),
      data: [...dataSet],
      exceptions: own.filter((s) => type(s) === 'Exception').map((s) => `${s.getAttribute('name')}: ${kid(s, 'exception').getAttribute('detail')}`),
      edges, badRefs,
    };
  }, { template, csv });

  console.log('Validation errors:', r.errors.length ? r.errors : 'none');
  console.log('Start inputs:', r.inputs);
  console.log('Data items:', r.data);
  console.log('Exception stages:\n  ' + r.exceptions.join('\n  '));
  console.log('Flow (every link):\n  ' + r.edges.join('\n  '));
  console.log('Broken data references:', r.badRefs.length ? r.badRefs : 'none');
  await browser.close();
})();
