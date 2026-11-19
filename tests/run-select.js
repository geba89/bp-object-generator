// Dropdowns: the template built from the mock Web Browser object (with I_ReadSelected),
// object generated from edit.csv (Amount + Reason dropdown), then the generated action is
// RUN against a simulated page whose dropdown only accepts "option=N" (like many real ones), whose
// option texts have odd spacing, and whose plain Read of the <select> returns ALL options.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const T = __dirname;

// ---------- a small Blue Prism expression evaluator ----------
function bpEval(expr, v) {
  const fns = {
    Trim: (s) => String(s ?? '').trim(), Lower: (s) => String(s ?? '').toLowerCase(), Upper: (s) => String(s ?? '').toUpperCase(),
    Len: (s) => String(s ?? '').length, Replace: (s, a, b) => String(s ?? '').split(a).join(b),
    InStr: (s, t) => String(s ?? '').indexOf(t) + 1, ExceptionDetail: () => v.__exception || '',
  };
  let js = '';
  const re = /\s*("(?:[^"]|"")*"|\[[^\]]+\]|<>|<=|>=|=|<|>|&|\+|-|\*|\/|\(|\)|,|\d+(?:\.\d+)?|True\b|False\b|And\b|Or\b|Not\b|[A-Za-z_]\w*)/gy;
  let m;
  while ((m = re.exec(expr)) && m[0] !== '') {
    const t = m[1];
    if (t[0] === '"') js += JSON.stringify(t.slice(1, -1).replace(/""/g, '"'));
    else if (t[0] === '[') js += `v[${JSON.stringify(t.slice(1, -1))}]`;
    else if (t === '&') js += '+""+';
    else if (t === '=') js += '==';
    else if (t === '<>') js += '!=';
    else if (t === 'True' || t === 'False') js += t.toLowerCase();
    else if (t === 'And') js += '&&'; else if (t === 'Or') js += '||'; else if (t === 'Not') js += '!';
    else if (fns[t]) js += `f.${t}`;
    else js += t;
    if (re.lastIndex >= expr.length) break;
  }
  if (re.lastIndex < expr.trimEnd().length && re.lastIndex !== 0) throw new Error('cannot parse: ' + expr);
  // eslint-disable-next-line no-new-func
  return new Function('v', 'f', `return (${js});`)(v, fns);
}

// ---------- the simulated web page + the user's dynamic action ----------
function makePage(readSelMode) {
  const page = {
    "//input[@id='amount']": { kind: 'input', value: '' },
    "//select[@id='reason']": { kind: 'select', options: [['OVR', ' Overpayment '], ['DBL', 'Double  charge'], ['OTH', 'Other']], selected: 0 },
  };
  const calls = [];
  const norm = (t) => t.replace(/\s+/g, ' ').trim();
  function dynamicAction(inp) {
    const xp = inp.I_XPath;
    calls.push({ xp, click: inp.I_Click, read: inp.I_Read, write: inp.I_Write, select: inp.I_Select, readsel: inp.I_ReadSelected });
    let m, base;
    const sel = (b) => { const el = page[b]; if (!el || el.kind !== 'select') throw new Error('Element not exist'); return el; };
    if (inp.I_ReadSelected === true || inp.I_ReadSelected === 'True') {
      const el = sel(xp); const o = el.options[el.selected - 1];
      return { O_Text: o ? (readSelMode === 'value' ? o[0] : o[1]) : '' };
    }
    if (inp.I_Read === true || inp.I_Read === 'True') {
      if ((m = xp.match(/^(.*)\/option\[(\d+)\]$/))) { const o = sel(m[1]).options[+m[2] - 1]; if (!o) throw new Error('Element not exist'); return { O_Text: o[1] }; }
      if ((m = xp.match(/^(.*)\/option\[translate\(normalize-space\(\), '([^']*)', '([^']*)'\)="(.*)"\]$/))) {
        const tr = (t) => [...t].map((c) => { const i = m[2].indexOf(c); return i < 0 ? c : m[3][i]; }).join('');
        const o = sel(m[1]).options.find((x) => tr(norm(x[1])) === m[4]); if (!o) throw new Error('Element not exist'); return { O_Text: o[1] };
      }
      if ((m = xp.match(/^(.*)\/option\[@value="(.*)"\]$/))) { const o = sel(m[1]).options.find((x) => x[0] === m[2]); if (!o) throw new Error('Element not exist'); return { O_Text: o[1] }; }
      base = page[xp]; if (!base) throw new Error('Element not exist');
      return { O_Text: base.kind === 'select' ? base.options.map((o) => o[1]).join('\n') : base.value }; // a <select> reads as ALL options
    }
    if (inp.I_Write === true || inp.I_Write === 'True') { page[xp].value = inp.I_Text; return {}; }
    if (inp.I_Select) {
      const el = sel(xp);
      if ((m = String(inp.I_Select).match(/^option=(\d+)$/))) { if (!el.options[+m[1] - 1]) throw new Error('no such option'); el.selected = +m[1]; return {}; }
      return {}; // selecting by TEXT silently does nothing on this dropdown (a common problem)
    }
    return {};
  }
  return { page, calls, dynamicAction };
}

// ---------- run one generated action ----------
function runAction(doc, actionName, inputs, sim) {
  const kid = (el, t) => [...el.children].find((c) => c.localName === t);
  const sub = [...doc.getElementsByTagName('subsheet')].find((s) => kid(s, 'name').textContent === actionName);
  if (!sub) throw new Error('no action ' + actionName);
  const pid = sub.getAttribute('subsheetid');
  const own = [...doc.getElementsByTagName('stage')].filter((s) => kid(s, 'subsheetid')?.textContent === pid);
  const byId = new Map(own.map((s) => [s.getAttribute('stageid'), s]));
  const v = {};
  const XP = [...doc.getElementsByTagName('stage')].filter((s) => s.getAttribute('type') === 'Data' && s.getAttribute('name').startsWith('XP '));
  for (const s of XP) v[s.getAttribute('name')] = kid(s, 'initialvalue').textContent;
  for (const s of own.filter((s) => s.getAttribute('type') === 'Data')) {
    const t = kid(s, 'datatype').textContent, iv = kid(s, 'initialvalue')?.textContent || '';
    v[s.getAttribute('name')] = t === 'number' ? Number(iv || 0) : t === 'flag' ? iv === 'True' : iv;
  }
  const start = own.find((s) => s.getAttribute('type') === 'Start');
  for (const i of kid(start, 'inputs')?.children || []) v[i.getAttribute('stage')] = inputs[i.getAttribute('name')] ?? '';
  const recover = own.find((s) => s.getAttribute('type') === 'Recover');
  const trace = [];
  let cur = byId.get(kid(start, 'onsuccess').textContent), steps = 0;
  const fail = (msg) => { if (recover && !v.__recovering) { v.__exception = msg; v.__recovering = true; return byId.get(kid(recover, 'onsuccess').textContent); } throw new Error(msg); };
  while (cur && steps++ < 5000) {
    const type = cur.getAttribute('type');
    trace.push(cur.getAttribute('name'));
    if (type === 'End') return { trace, v };
    if (type === 'Calculation') { const c = kid(cur, 'calculation'); v[c.getAttribute('stage')] = bpEval(c.getAttribute('expression'), v); cur = byId.get(kid(cur, 'onsuccess').textContent); continue; }
    if (type === 'Decision') { const ok = bpEval(kid(cur, 'decision').getAttribute('expression'), v); cur = byId.get(kid(cur, ok ? 'ontrue' : 'onfalse').textContent); continue; }
    if (type === 'Exception') { const e = kid(cur, 'exception'); const msg = bpEval(e.getAttribute('detail'), v); if (v.__recovering) throw new Error(msg); cur = fail(msg); continue; }
    if (type === 'Action') {
      const inp = {};
      for (const i of kid(cur, 'inputs').children) { const e = i.getAttribute('expr'); inp[i.getAttribute('name')] = e ? bpEval(e, v) : ''; }
      let out;
      try { out = sim.dynamicAction(inp); } catch (e) { cur = fail(e.message); continue; }
      for (const o of kid(cur, 'outputs')?.children || []) v[o.getAttribute('stage')] = out[o.getAttribute('name')];
      cur = byId.get(kid(cur, 'onsuccess').textContent);
      continue;
    }
    cur = byId.get(kid(cur, 'onsuccess').textContent);
  }
  throw new Error('flow did not end');
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1300, height: 1000 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('file://' + path.join(T, '..', 'bp-object-generator.html') + '?nointro');
  const problems = [];
  const expect = (ok, msg) => { if (!ok) problems.push(msg); };

  async function build(mock, readSelMode) {
    await page.reload();
    await page.click('#tplBuild summary');
    await page.setInputFiles('#chromeFile', path.join(T, mock));
    await page.selectOption('#chromeReadSelMode', readSelMode);
    console.log(`[${mock}, ${readSelMode}] roles:`, (await page.$$eval('#chromeRoles select', (ss) => ss.map((s) => `${s.dataset.role}=${s.value || '-'}`))).slice(-2).join(' '));
    await page.click('#chromeUse');
    console.log('  builder:', (await page.textContent('#chromeResult')).replace(/\s+/g, ' ').trim().slice(0, 330));
    await page.evaluate(() => BPGen.go(2));
    await page.setInputFiles('#csvFile', path.join(T, 'edit.csv'));
    await page.waitForFunction(() => BPGen.state.rows.length > 0);
    await page.evaluate(() => BPGen.go(3));
    const dbg = await page.evaluate(() => ({ rows: BPGen.state.rows.length, scans: BPGen.state.scans.length, msg: document.querySelector('.wizmsg')?.textContent, step: [...document.querySelectorAll('section[data-step]')].filter((s) => !s.hidden).map((s) => s.dataset.step) }));
    if (!dbg.step.includes('3')) console.log('  DEBUG', JSON.stringify(dbg));
    await page.check('input[name=mode][value=section]');
    const verify = await page.evaluate(() => BPGen.state.items.filter((i) => i.include && i.page === 'Fill Details').map((i) => `${i.field}:${i.verify ? 'checked' : 'no check'}`));
    console.log('  steps:', verify.join(', '));
    await page.evaluate(() => BPGen.go(5));
    await page.fill('#objName', 'Order Portal');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#generate')]);
    const out = path.join(T, 'select-gen.bpobject');
    await dl.saveAs(out);
    return fs.readFileSync(out, 'utf8');
  }

  // Run flows in the browser page (it has DOMParser) by shipping the runner code there
  const runInPage = (xml, action, inputs, readSelMode) => page.evaluate(({ xml, action, inputs, readSelMode, src }) => {
    // eslint-disable-next-line no-new-func
    const { bpEval, makePage, runAction } = new Function(src + '; return { bpEval, makePage, runAction };')();
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const sim = makePage(readSelMode);
    try {
      const r = runAction(doc, action, inputs, sim);
      return { ok: true, trace: r.trace.length, selected: sim.page["//select[@id='reason']"].selected, amount: sim.page["//input[@id='amount']"].value, selects: sim.calls.filter((c) => c.select).map((c) => c.select), reads: sim.calls.length };
    } catch (e) {
      return { ok: false, error: e.message, selected: sim.page["//select[@id='reason']"].selected, selects: sim.calls.filter((c) => c.select).map((c) => c.select) };
    }
  }, { xml, action, inputs, readSelMode, src: [bpEval, makePage, runAction].map((f) => f.toString()).join('\n') });

  // ---- A: object WITH "Read selected" returning text ----
  let xml = await build('chrome-mock-readsel.bpobject', 'text');
  let r = await runInPage(xml, 'Fill Details', { I_Title: 'Tax', I_Amount: '120', I_Reason: 'double charge' }, 'text');
  console.log('A1 "double charge":', JSON.stringify(r));
  expect(r.ok && r.selected === 2 && r.selects.join() === 'option=2', 'A1 select by position + check');
  r = await runInPage(xml, 'Fill Details', { I_Title: 'Tax', I_Amount: '120', I_Reason: 'Overpayment' }, 'text');
  console.log('A2 "Overpayment" (spaces around):', JSON.stringify(r));
  expect(r.ok && r.selected === 1, 'A2');
  r = await runInPage(xml, 'Fill Details', { I_Title: 'Tax', I_Amount: '120', I_Reason: 'Refund' }, 'text');
  console.log('A3 "Refund" (not in list):', JSON.stringify(r));
  expect(!r.ok && /Element not exist/.test(r.error) && r.selected === 0, 'A3 missing option stops before selecting');
  r = await runInPage(xml, 'Fill Details', { I_Title: 'Tax', I_Amount: '120', I_Reason: '' }, 'text');
  console.log('A4 empty reason (skipped):', JSON.stringify(r));
  expect(r.ok && r.selected === 0 && !r.selects.length, 'A4 skip empty');

  // ---- B: "Read selected" returns the option VALUE ----
  xml = await build('chrome-mock-readsel.bpobject', 'value');
  r = await runInPage(xml, 'Fill Details', { I_Title: 'Tax', I_Amount: '120', I_Reason: 'Other' }, 'value');
  console.log('B1 value mode "Other":', JSON.stringify(r));
  expect(r.ok && r.selected === 3, 'B1 value mode');

  // ---- C: object WITHOUT "Read selected": no dropdown check (instead of a check that always fails) ----
  xml = await build('chrome-mock.bpobject', 'text');
  r = await runInPage(xml, 'Fill Details', { I_Title: 'Tax', I_Amount: '120', I_Reason: 'Other' }, 'text');
  console.log('C1 no Read selected:', JSON.stringify(r));
  expect(r.ok && r.selected === 3, 'C1 selects, no false check failure');
  expect(!xml.includes('Read selected'), 'C1 no verify select stages');

  console.log('JS errors:', errs.length ? errs : 'none');
  if (errs.length) problems.push('js errors');
  console.log('PROBLEMS:', problems.length ? problems : 'none');
  await browser.close();
})();
