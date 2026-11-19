// Naming + grouping test:
//   every Start input starts with I_, every End output with O_, locals keep plain names,
//   data items laid out in columns Inputs | Outputs | Local data (+ Blocks when the template has one),
//   every [reference] still points at an existing data item.
// Runs with two templates: template-full (I_ names, has a Block) and template.bpobject
// (plain names "Value", "Row Key", "Option", no Block).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const T = __dirname;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.join(T, '..', 'bp-object-generator.html') + '?nointro');
  let total = 0;

  for (const [tplFile, csvFile] of [['template-full.bpobject', 'full.csv'], ['template.bpobject', 'sections.csv']]) {
    for (const [mode, locals] of [['section', 'action'], ['element', 'action'], ['section', 'field']]) {
      const r = await page.evaluate(({ template, csv, mode, locals }) => {
        const tpl = BPGen.parseTemplate(template);
        const opts = { shared: BPGen.defaultShared(tpl), inPrefix: 'I_', outPrefix: 'O_', locals,
          groupData: true, xpathItems: true, checkPage: true, descriptions: true };
        BPGen.state.opts = opts;
        const items = BPGen.buildItems(BPGen.parseCsv(csv), tpl);
        BPGen.applyMode(items, mode, tpl, opts);
        const v = BPGen.validate(items, 'App - N', tpl, mode, opts);
        const out = BPGen.generateObject(template, items, 'App - N', mode, [], opts);
        const doc = new DOMParser().parseFromString(out.xml, 'application/xml');
        const kid = (el, t) => [...el.children].find((c) => c.localName === t);
        const txt = (el, t) => (kid(el, t)?.textContent || '').trim();
        const stages = [...doc.getElementsByTagName('stage')];
        const globals = new Set(stages.filter((s) => s.getAttribute('type') === 'Data' && !kid(s, 'private')).map((s) => s.getAttribute('name')));
        const problems = [];
        const sample = {};
        for (const sub of doc.getElementsByTagName('subsheet')) {
          const name = txt(sub, 'name');
          if (name === 'Element XPaths' || name === 'Clean Up' || name === 'Attach') continue;
          const own = stages.filter((s) => txt(s, 'subsheetid') === sub.getAttribute('subsheetid'));
          if (!own.length) continue;
          const start = own.find((s) => s.getAttribute('type') === 'Start');
          const ends = own.filter((s) => s.getAttribute('type') === 'End');
          const ins = start && kid(start, 'inputs') ? [...kid(start, 'inputs').children] : [];
          const outs = ends.flatMap((e) => (kid(e, 'outputs') ? [...kid(e, 'outputs').children] : []));
          const data = own.filter((s) => s.getAttribute('type') === 'Data');
          const dataNames = new Set(data.map((s) => s.getAttribute('name')));
          // 1. prefixes
          ins.forEach((i) => { if (!i.getAttribute('name').startsWith('I_')) problems.push(`${name}: input "${i.getAttribute('name')}" has no I_`); });
          outs.forEach((o) => { if (!o.getAttribute('name').startsWith('O_')) problems.push(`${name}: output "${o.getAttribute('name')}" has no O_`); });
          // 2. parameters store into existing data items with the same name
          [...ins, ...outs].forEach((p) => { if (p.getAttribute('stage') !== p.getAttribute('name') && !dataNames.has(p.getAttribute('stage'))) problems.push(`${name}: ${p.getAttribute('name')} -> missing data item`); });
          // 3. locals: neither I_ nor O_, unique names
          const paramStages = new Set([...ins, ...outs].map((p) => p.getAttribute('stage')));
          const localNames = data.map((s) => s.getAttribute('name')).filter((n) => !paramStages.has(n));
          localNames.forEach((n) => { if (/^[IO]_/.test(n)) problems.push(`${name}: local "${n}" looks like a parameter`); });
          if (new Set(data.map((s) => s.getAttribute('name'))).size !== data.length) problems.push(`${name}: duplicate data items`);
          // 4. every [ref] / stage= resolves
          for (const s of own) for (const el of s.getElementsByTagName('*')) for (const a of el.attributes) {
            if (a.name === 'stage' && el.localName !== 'stage') { if (!dataNames.has(a.value) && !globals.has(a.value)) problems.push(`${name}: stores into "${a.value}"`); continue; }
            if (a.name === 'name') continue;
            for (const m of a.value.replace(/"(?:[^"]|"")*"/g, '').matchAll(/\[([^\]]+)\]/g)) if (!dataNames.has(m[1]) && !globals.has(m[1])) problems.push(`${name}: [${m[1]}] missing`);
          }
          // 5. grouping: x column per group
          const col = (n) => kid(data.find((s) => s.getAttribute('name') === n), 'display')?.getAttribute('x');
          const xs = { in: [...new Set(ins.map((i) => col(i.getAttribute('stage'))))], out: [...new Set(outs.map((o) => col(o.getAttribute('stage'))))], local: [...new Set(localNames.map(col))] };
          if (xs.in.length > 1 || xs.out.length > 1 || xs.local.length > 1) problems.push(`${name}: a group spans several columns ${JSON.stringify(xs)}`);
          const blocks = own.filter((s) => s.getAttribute('type') === 'Block' && ['Inputs', 'Outputs', 'Local data'].includes(s.getAttribute('name'))).map((s) => s.getAttribute('name'));
          sample[name] = { inputs: ins.map((i) => i.getAttribute('name')), outputs: outs.map((o) => o.getAttribute('name')), locals: localNames, columns: xs, blocks };
        }
        return { errors: v.errors, problems, sample };
      }, { template: fs.readFileSync(path.join(T, tplFile), 'utf8'), csv: fs.readFileSync(path.join(T, csvFile), 'utf8'), mode, locals });

      console.log(`\n===== ${tplFile} | ${mode} mode | locals: ${locals} =====`);
      console.log('validation errors:', r.errors.length ? r.errors : 'none');
      const show = Object.entries(r.sample).filter(([n]) => /Fill Address|Click Edit|Check Page|Enter City|Set City|Get City/i.test(n)).slice(0, 3);
      for (const [n, s] of show) console.log(`  ${n.padEnd(20)} in: ${s.inputs.join(', ') || '-'} | out: ${s.outputs.join(', ') || '-'} | local: ${s.locals.join(', ') || '-'} | blocks: ${s.blocks.join(', ') || '-'}`);
      console.log('PROBLEMS:', r.problems.length ? r.problems : 'none');
      total += r.problems.length + r.errors.length;
    }
  }
  console.log(`\nTOTAL PROBLEMS: ${total}`);
  await browser.close();
})();
