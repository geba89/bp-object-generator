// Same as run-cond, but with the template BUILT from the mock of the user's Web Browser object.
// Conditions + read-back checks. Generates from template-chrome (no skip logic in the template),
// then SIMULATES running the actions: follows Decisions with given input values and records
// which steps run. Also checks structure (links, references, prefixes).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const T = __dirname;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.join(T, '..', 'bp-object-generator.html') + '?nointro');
  const problems = [];

  const r = await page.evaluate(({ template, csv }) => {
    const tpl = BPGen.parseTemplate(template);
    const opts = { shared: BPGen.defaultShared(tpl), inPrefix: 'I_', outPrefix: 'O_', locals: 'action',
      groupData: true, xpathItems: true, checkPage: false, descriptions: true, verify: true, errorHandler: true };
    BPGen.state.opts = opts;
    const items = BPGen.buildItems(BPGen.parseCsv(csv), tpl);
    // One action: City, Post code (text), Country (dropdown), Primary address (checkbox), Save (click)
    const want = [['City', 'TPL Set Text'], ['Post code', 'TPL Set Text'], ['Country', 'TPL Select From List'], ['Primary address', 'TPL Set Checkbox'], ['Save', 'TPL Click']];
    for (const it of items) it.picked = want.some(([l, t]) => it.label === l && it.template === t);
    BPGen.assignToAction(items, 'Fill Address');
    const defaults = items.filter((i) => i.page === 'Fill Address').map((i) => `${i.field}: ${i.cond.mode}${i.verify ? ' + check' : ''}`);
    // Save only when City is filled (custom); Post code: never check
    const save = items.find((i) => i.page === 'Fill Address' && i.label === 'Save');
    save.cond = { mode: 'custom', expr: '[I_City] <> ""' };
    items.find((i) => i.page === 'Fill Address' && i.label === 'Post code').verify = false;
    // A single action too: "Set Street" (skip if empty + check)
    const street = items.find((i) => i.label === 'Street' && i.template === 'TPL Set Text');
    const v = BPGen.validate(items, 'App - C', tpl, 'element', opts);
    const out = BPGen.generateObject(template, items, 'App - C', 'element', [], opts);
    const docs = BPGen.buildDocs(out, 'App - C', {});

    const doc = new DOMParser().parseFromString(out.xml, 'application/xml');
    const kid = (el, t) => [...el.children].find((c) => c.localName === t);
    const txt = (el, t) => (kid(el, t)?.textContent || '').trim();
    const stages = [...doc.getElementsByTagName('stage')];
    const pageStages = (name) => {
      const sub = [...doc.getElementsByTagName('subsheet')].find((s) => txt(s, 'name') === name);
      return stages.filter((s) => txt(s, 'subsheetid') === sub.getAttribute('subsheetid'));
    };

    // Simulator: run a page with input values; the field always "reads back" what was written
    function run(name, inputs) {
      const own = pageStages(name);
      const byId = new Map(own.map((s) => [s.getAttribute('stageid'), s]));
      const vars = { ...inputs };
      const ran = [];
      const val = (e) => {
        e = e.trim();
        let m;
        if ((m = e.match(/^Trim\((.*)\)$/))) return String(val(m[1])).trim();
        if ((m = e.match(/^\[([^\]]+)\]$/))) return vars[m[1]] ?? '';
        if ((m = e.match(/^"(.*)"$/))) return m[1];
        if (e === 'True') return true; if (e === 'False') return false;
        throw new Error('cannot evaluate ' + e);
      };
      const evalExpr = (e) => {
        let m;
        if ((m = e.match(/^(.*?)\s*<>\s*(.*)$/))) return val(m[1]) !== val(m[2]);
        if ((m = e.match(/^(.*?)\s*=\s*(.*)$/))) return val(m[1]) === val(m[2]);
        return !!val(e);
      };
      // Text expression: "a" & [B] & ExceptionDetail()
      const textOf = (e, err) => e.match(/"(?:[^"]|"")*"|\[[^\]]+\]|ExceptionDetail\(\)/g)
        .map((p) => (p.startsWith('"') ? p.slice(1, -1).replace(/""/g, '"') : p.startsWith('[') ? String(vars[p.slice(1, -1)] ?? '') : err)).join('');
      let cur = own.find((s) => s.getAttribute('type') === 'Start');
      let error = null;
      for (let guard = 0; cur && guard < 200; guard++) {
        const type = cur.getAttribute('type');
        if (type === 'End') return { ran, ended: 'End' };
        if (type === 'Exception') {
          const detail = kid(cur, 'exception').getAttribute('detail');
          const recover = own.find((s) => s.getAttribute('type') === 'Recover');
          if (!error && recover) {
            // Like Blue Prism: an Exception stage on a page with a Recover is caught by it
            error = textOf(detail, '');
            ran.push(`${cur.getAttribute('name')} THROWS "${error}"`, 'Recover');
            cur = byId.get(txt(recover, 'onsuccess'));
            continue;
          }
          return { ran, ended: 'Exception: ' + (error ? textOf(detail, error) : detail) };
        }
        if (type === 'Calculation') {
          const c = kid(cur, 'calculation');
          vars[c.getAttribute('stage')] = textOf(c.getAttribute('expression'), '');
          ran.push(`(${c.getAttribute('stage')} = ${vars[c.getAttribute('stage')]})`);
          cur = byId.get(txt(cur, 'onsuccess'));
          continue;
        }
        if (type === 'Action' && vars.__fail === cur.getAttribute('name')) {
          // The action throws: Blue Prism jumps to the page's Recover stage
          ran.push(`${cur.getAttribute('name')} FAILS`);
          error = 'Element not found';
          cur = own.find((s) => s.getAttribute('type') === 'Recover');
          ran.push('Recover');
          cur = byId.get(txt(cur, 'onsuccess'));
          continue;
        }
        if (type === 'Action') {
          ran.push(cur.getAttribute('name'));
          // "Read back" returns the last value written to the same XPath
          const xp = [...kid(cur, 'inputs').children].find((i) => i.getAttribute('name') === 'I_XPath').getAttribute('expr');
          const text = [...kid(cur, 'inputs').children].find((i) => ['I_Text', 'I_Select'].includes(i.getAttribute('name')) && i.getAttribute('expr') !== '""');
          if (text && text.getAttribute('expr') !== '""') vars['__field ' + xp] = val(text.getAttribute('expr'));
          const o = kid(cur, 'outputs')?.children[0];
          if (o) vars[o.getAttribute('stage')] = vars.__break === xp ? 'WRONG' : (vars['__field ' + xp] ?? '');
          cur = byId.get(txt(cur, 'onsuccess'));
        } else if (type === 'Decision') {
          const ok = evalExpr(kid(cur, 'decision').getAttribute('expression'));
          ran.push(`${cur.getAttribute('name')}=${ok ? 'yes' : 'no'}`);
          cur = byId.get(txt(cur, ok ? 'ontrue' : 'onfalse'));
        } else {
          cur = byId.get(txt(cur, 'onsuccess'));
        }
      }
      return { ran, ended: 'stuck' };
    }

    // Structure: links stay on the page, every [ref] exists, prefixes
    const structure = [];
    for (const name of ['Fill Address', 'Set Street']) {
      const own = pageStages(name);
      const ids = new Set(own.map((s) => s.getAttribute('stageid')));
      const dataNames = new Set(own.filter((s) => s.getAttribute('type') === 'Data').map((s) => s.getAttribute('name')));
      const globals = new Set(stages.filter((s) => s.getAttribute('type') === 'Data' && !kid(s, 'private')).map((s) => s.getAttribute('name')));
      for (const s of own) {
        for (const t of ['onsuccess', 'ontrue', 'onfalse']) if (txt(s, t) && !ids.has(txt(s, t))) structure.push(`${name}: ${s.getAttribute('name')} -> missing`);
        for (const el of s.getElementsByTagName('*')) for (const a of el.attributes) {
          if (a.name === 'stage' && el.localName !== 'stage') { if (!dataNames.has(a.value)) structure.push(`${name}: stores into ${a.value}`); continue; }
          if (a.name === 'name') continue;
          for (const m of a.value.replace(/"(?:[^"]|"")*"/g, '').matchAll(/\[([^\]]+)\]/g)) if (!dataNames.has(m[1]) && !globals.has(m[1])) structure.push(`${name}: [${m[1]}] missing`);
        }
      }
      const start = own.find((s) => s.getAttribute('type') === 'Start');
      structure.push(`${name} inputs: ${[...kid(start, 'inputs').children].map((i) => i.getAttribute('name')).join(', ')}`);
    }

    const base = { I_Title: 'Portal', I_Titles: '' };
    // Recover stages per generated action (should be exactly 1 each)
    const recovers = [...doc.getElementsByTagName('subsheet')].filter((s) => txt(s, 'name') !== 'Element XPaths' && txt(s, 'name') !== 'Clean Up')
      .map((s) => stages.filter((st) => txt(st, 'subsheetid') === s.getAttribute('subsheetid') && st.getAttribute('type') === 'Recover').length);
    return {
      recovers,
      defaults, errors: v.errors, warnings: v.warnings, structure,
      docsRow: docs.md.split('\n').filter((l) => /^\| [0-9] \|/.test(l)).slice(0, 5),
      runs: {
        'all filled':               run('Fill Address', { ...base, 'I_City': 'Kraków', 'I_Post code': '30-001', 'I_Country': 'Poland', 'I_Primary address': true }),
        'only Country':             run('Fill Address', { ...base, 'I_City': '', 'I_Post code': '', 'I_Country': 'Poland', 'I_Primary address': false }),
        'City read back is wrong':  run('Fill Address', { ...base, 'I_City': 'Kraków', 'I_Post code': '', 'I_Country': '', 'I_Primary address': false, __break: `[${out.xpaths.find((x) => x.name === 'XP City').name}]` }),
        'Set Street, empty':        run('Set Street', { ...base, 'I_Street': '' }),
        'Set Street, filled':       run('Set Street', { ...base, 'I_Street': 'Długa 1' }),
        'selecting Country fails':  run('Fill Address', { ...base, 'I_City': 'Kraków', 'I_Post code': '', 'I_Country': 'Poland', 'I_Primary address': false, __fail: 'Dynamic Action - Country' }),
        'click Validate fails':     run('Click Validate address', { ...base, __fail: 'Dynamic Action' }),
      },
    };
  }, { template: fs.readFileSync(path.join(T, 'template-chrome-text.bpobject'), 'utf8'), csv: fs.readFileSync(path.join(T, 'sections.csv'), 'utf8') });

  console.log('Defaults:', r.defaults.join(' | '));
  console.log('Validation errors:', r.errors.length ? r.errors : 'none', '| warnings:', r.warnings);
  r.structure.filter((s) => s.includes('inputs:')).forEach((s) => console.log(s));
  const broken = r.structure.filter((s) => !s.includes('inputs:'));
  console.log('Broken links/refs:', broken.length ? broken : 'none');
  for (const [name, res] of Object.entries(r.runs)) {
    console.log(`\n▶ ${name}  →  ${res.ended}`);
    console.log('   ' + res.ran.join(' → '));
  }
  console.log('\nDocs rows:\n  ' + r.docsRow.join('\n  '));
  if (broken.length || r.errors.length) problems.push('structure');

  // Expectations
  const ran = (k) => r.runs[k].ran.join(' | ');
  const expect = (ok, msg) => { if (!ok) problems.push(msg); };
  expect(/Dynamic Action - City/.test(ran('all filled')) && /Read back - City/.test(ran('all filled')) && /Click/.test(ran('all filled')) || /Dynamic Action - Save/.test(ran('all filled')), 'all filled: steps missing');
  expect(!/Dynamic Action - City/.test(ran('only Country')) && /Dynamic Action - Country/.test(ran('only Country')) && !/Dynamic Action - Save/.test(ran('only Country')), 'only Country: wrong steps');
  expect(r.runs['City read back is wrong'].ended === 'Exception: Fill Address / Set City: field shows "WRONG", expected "Kraków"', 'wrong value message');
  expect(r.runs['Set Street, empty'].ended === 'End' && !/Dynamic Action/.test(ran('Set Street, empty')), 'single action not skipped');
  expect(/Read back/.test(ran('Set Street, filled')), 'single action not checked');
  expect(r.runs['selecting Country fails'].ended === 'Exception: Fill Address / Select Country: Element not found', 'error message for Country');
  expect(r.runs['click Validate fails'].ended === 'Exception: Click Validate address / Click Validate address: Element not found', 'error message for single click');
  expect(r.recovers.every((n) => n === 1), 'not exactly one Recover per action: ' + r.recovers);
  console.log('\nPROBLEMS:', problems.length ? problems : 'none');
  await browser.close();
})();
