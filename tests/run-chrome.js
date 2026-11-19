// Template builder through the UI: load the mock "Web Browser" object, check the guessed
// action + input roles, build the template ("Use as template"), check every call in it,
// save it as test/template-chrome.bpobject (used by run-chrome-flow.js).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const T = __dirname;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1250, height: 1000 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('file://' + path.join(T, '..', 'bp-object-generator.html') + '?nointro');
  const problems = [];

  await page.click('#tplBuild summary');
  await page.setInputFiles('#chromeFile', path.join(T, 'chrome-mock.bpobject'));
  console.log('Info:', (await page.textContent('#chromeInfo')).trim());
  const roles = await page.$$eval('#chromeRoles select', (ss) => ss.map((s) => `${s.dataset.role}=${s.value}`));
  console.log('Roles:', roles.join(', '));
  const expected = ['attempts=I_Attempts', 'title=I_PageTitle', 'titles=I_PageTitles', 'xpath=I_XPath', 'click=I_Click', 'read=I_Read', 'write=I_Write', 'select=I_Select', 'text=I_Text', 'readsel=', 'out=O_Text'];
  if (roles.join() !== expected.join()) problems.push('roles guessed wrong');
  await page.locator('#tplBuild').screenshot({ path: path.join(T, 'chrome-builder.png') });

  await page.click('#chromeUse');
  console.log('Result:', (await page.textContent('#chromeResult')).replace(/\s+/g, ' ').trim());
  console.log('Template info:', (await page.textContent('#tplInfo')).replace(/\s+/g, ' ').trim().slice(0, 400));

  // The template XML itself, and a check of every call to the user's action
  const r = await page.evaluate(() => {
    const st = BPGen.state;
    const res = BPGen.buildTemplateFromChrome({
      objectName: st.chrome.obj.name, action: st.chrome.current.action.name, inputs: st.chrome.current.action.inputs,
      outputs: st.chrome.current.action.outputs, roles: st.chrome.current.roles, outRole: st.chrome.current.outRole, attempts: '3',
    });
    const doc = new DOMParser().parseFromString(res.xml, 'application/xml');
    const bad = [];
    if (doc.getElementsByTagName('parsererror').length) bad.push('XML not valid');
    const kid = (el, t) => [...el.children].find((c) => c.localName === t);
    const subs = new Map([...doc.getElementsByTagName('subsheet')].map((s) => [s.getAttribute('subsheetid'), kid(s, 'name').textContent]));
    const calls = [];
    for (const s of doc.getElementsByTagName('stage')) {
      if (s.getAttribute('type') !== 'Action') continue;
      const r = kid(s, 'resource');
      const ins = [...kid(s, 'inputs').children].map((i) => `${i.getAttribute('name')}:${i.getAttribute('type')}=${i.getAttribute('expr')}`);
      if (r.getAttribute('object') !== 'Web Browser' || r.getAttribute('action') !== 'Dynamic Action') bad.push('wrong resource');
      if (ins.length !== 9) bad.push('not 9 inputs');
      const pageName = subs.get(kid(s, 'subsheetid').textContent);
      const on = ins.filter((i) => /=(True|\[|"\{)/.test(i) && !/I_Page|I_XPath/.test(i)).map((i) => i.replace(/:\w+=/, '='));
      calls.push(`${pageName} / ${s.getAttribute('name')}: ${on.join(', ')}${kid(s, 'outputs') ? ' -> ' + kid(kid(s, 'outputs'), 'output').getAttribute('stage') : ''}`);
      // every link points to a stage
    }
    const ids = new Set([...doc.getElementsByTagName('stage')].map((s) => s.getAttribute('stageid')));
    for (const s of doc.getElementsByTagName('stage')) for (const t of ['onsuccess', 'ontrue', 'onfalse']) { const l = kid(s, t); if (l && !ids.has(l.textContent)) bad.push(`broken link in ${s.getAttribute('name')}`); }
    const tpl = BPGen.parseTemplate(res.xml);
    return { xml: res.xml, pages: res.pages, skipped: res.skipped, bad, calls, shared: BPGen.defaultShared(tpl), verify: tpl.verifyPages.map((p) => p.name), handler: !!tpl.special.handler };
  });
  fs.writeFileSync(path.join(T, 'template-chrome.bpobject'), r.xml);
  // A "select by text" variant for run-chrome-flow.js (its simple simulator can't follow the
  // position loop; run-select.js tests that loop with a full expression evaluator)
  const textXml = await page.evaluate(() => {
    const c = BPGen.state.chrome;
    return BPGen.buildTemplateFromChrome({ objectName: c.obj.name, action: c.current.action.name, inputs: c.current.action.inputs, outputs: c.current.action.outputs, roles: c.current.roles, outRole: c.current.outRole, attempts: '3', selectMode: 'text' }).xml;
  });
  fs.writeFileSync(path.join(T, 'template-chrome-text.bpobject'), textXml);
  console.log('Pages:', r.pages.join(', '));
  console.log('Calls:\n  ' + r.calls.join('\n  '));
  console.log('Shared inputs:', r.shared, '| verify pages:', r.verify, '| handler:', r.handler);
  if (r.bad.length) problems.push(...r.bad);
  // Only the dropdown check is skipped: this mock has no "Read selected" input
  if (r.skipped.map((x) => x.name).join() !== 'TPL Verify Select') problems.push('pages skipped: ' + r.skipped.map((x) => x.name));
  if (r.shared.join() !== 'I_Title,I_Titles') problems.push('shared inputs');

  // Without an output mapped: Get Text / Verify pages skipped, message shown
  await page.selectOption('#chromeRoles select[data-role=out]', '');
  await page.click('#chromeUse');
  console.log('No output ->', (await page.textContent('#chromeResult')).replace(/\s+/g, ' ').trim());
  // Without XPath: error
  await page.selectOption('#chromeRoles select[data-role=xpath]', '');
  await page.click('#chromeUse');
  console.log('No XPath ->', (await page.textContent('#chromeResult')).trim());

  console.log('JS errors:', errs.length ? errs : 'none');
  if (errs.length) problems.push('js errors');
  console.log('PROBLEMS:', problems.length ? problems : 'none');
  await browser.close();
})();
