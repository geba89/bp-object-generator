// Field names: the scanner must name fields after their label/neighbour text, never after
// their current value; the generator must repair value-like labels from old scans.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const T = __dirname;

const html = `<!doctype html><title>Order Portal - Edit</title>
<table id="form">
  <tr><td>Price</td><td><input id="x9f3a2b1c7d" value="12345"></td></tr>
  <tr><th>Net amount:</th><td><input id="a8c7e6f5d4b3" value="99.50"></td></tr>
</table>
<div class="row"><span>Quantity *:</span><div><input name="qty_total" value="7"></div></div>
<span id="lblDisc">Discount</span><input aria-labelledby="lblDisc" value="15">
<input name="txtUnitPrice" value="12.50">
<label>Country <select id="c1"><option>Poland</option><option>Germany</option></select></label>
<p>Postal code: <input id="f00baa12cd34" value="30-001"></p>
<label for="city">City</label><input id="city" value="Kraków">
<table id="grid"><thead><tr><th>Item</th><th>Amount</th></tr></thead>
  <tbody><tr><td><input id="i1a2b3c4d5e6" value="Book"></td><td><input id="z9y8x7w6v5u4" value="250"></td></tr></tbody></table>
<button>Save</button><input type="submit" value="Send">`;

(async () => {
  const browser = await chromium.launch();
  const problems = [];
  const expect = (ok, msg) => { if (!ok) problems.push(msg); };

  // ---- scanner ----
  const sp = await browser.newPage({ acceptDownloads: true });
  await sp.setContent(html);
  await sp.evaluate(() => { window.BP_SCAN_CONFIG = { askScreenName: false, showOverlay: false }; });
  const [dl] = await Promise.all([sp.waitForEvent('download'), sp.addScriptTag({ content: fs.readFileSync(path.join(T, '..', 'bp-xpath-scanner.js'), 'utf8') })]);
  const file = path.join(T, 'labels.csv');
  await dl.saveAs(file);
  const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split('\r\n');
  const head = lines[0].split(';').map((h) => h.replace(/"/g, ''));
  const rows = lines.slice(1).filter(Boolean).map((l) => {
    const cells = l.match(/("(?:[^"]|"")*"|[^;]*)(;|$)/g).map((c) => c.replace(/;$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
    return Object.fromEntries(head.map((h, i) => [h, cells[i]]));
  });
  const got = rows.map((r) => `${r.Type}: ${r.Label}`);
  console.log('Scanner labels:\n  ' + got.join('\n  '));
  const want = ['Text Field: Price', 'Text Field: Net amount', 'Text Field: Quantity', 'Text Field: Discount', 'Text Field: Unit Price',
    'Dropdown: Country', 'Text Field: Postal code', 'Text Field: City', 'Text Field: Item', 'Text Field: Amount', 'Button: Save', 'Button: Send'];
  for (const w of want) expect(got.includes(w), 'scanner: missing ' + w);
  expect(!rows.some((r) => /^[\d\s.,-]+$/.test(r.Label)), 'scanner: a value used as a name');

  // ---- generator: old scan labels that are values ----
  const gp = await browser.newPage();
  await gp.goto('file://' + path.join(T, '..', 'bp-object-generator.html') + '?nointro');
  const g = await gp.evaluate(() => {
    const cases = [
      { type: 'Text Field', label: '12345', xpath: "//input[@id='txtUnitPrice']" },
      { type: 'Text Field', label: '99.50', xpath: "//input[@id=//label[normalize-space()='Net amount:']/@for]" },
      { type: 'Text Field', label: '7', xpath: "//input[@name='ctl00$Main$qty_total']" },
      { type: 'Dropdown', label: '13', xpath: "//select[@aria-label='Reason']" },
      { type: 'Text Field', label: '2026-11-19', xpath: "//input[@placeholder='Due date']" },
      { type: 'Text Field', label: 'Price', xpath: "//input[@id='x']" },            // a good label stays
      { type: 'Button', label: '2', xpath: "//button[normalize-space()='2']" },     // page "2" button stays
      { type: 'Text Field', label: '555', xpath: "(//input)[3]" },                  // nothing usable -> "Text Field 4"
    ];
    return cases.map((c) => BPGen.baseLabel({ ...c, index: 4, template: 'TPL Set Text' }));
  });
  console.log('Generator names:', g);
  expect(g.join('|') === 'Unit Price|Net amount|Qty Total|Reason|Due date|Price|2|Text Field 4', 'generator names');

  // ---- generator UI: the old-style CSV gives I_Price-like inputs, not I_12345 ----
  const old = rows.map((r) => ({ ...r, Label: r.Type === 'Text Field' ? r.Label.replace(/^Price$/, '12345') : r.Label }));
  const csv = '﻿' + [head.map((h) => `"${h}"`).join(';'), ...old.map((r) => head.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(';'))].join('\r\n');
  fs.writeFileSync(path.join(T, 'labels-old.csv'), csv);
  await gp.setInputFiles('#tplFile', path.join(T, 'template-chrome.bpobject'));
  await gp.evaluate(() => BPGen.go(2));
  await gp.setInputFiles('#csvFile', path.join(T, 'labels-old.csv'));
  await gp.waitForFunction(() => BPGen.state.rows.length > 0);
  await gp.evaluate(() => BPGen.go(3));
  const fields = await gp.evaluate(() => BPGen.state.items.filter((i) => i.include && i.template === 'TPL Set Text').map((i) => i.field));
  console.log('Set Text fields from a CSV whose Price label is "12345":', fields);
  expect(!fields.some((f) => /^\d/.test(f)) && /^Text Field \d+$/.test(fields[0]), 'no numeric or random field names');

  console.log('PROBLEMS:', problems.length ? problems : 'none');
  await browser.close();
})();
