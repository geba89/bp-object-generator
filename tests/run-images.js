// Image/onclick buttons: are they listed, are the XPaths unique, and does clicking the
// element found by each XPath really run its click handler?
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + path.join(__dirname, 'images.html'));
  await page.evaluate(() => { window.BP_SCAN_CONFIG = { downloadCsv: false, showOverlay: false }; });
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '..', 'bp-xpath-scanner.js'), 'utf8') });

  const rows = await page.evaluate(() => BPScan.rows.map((r) => {
    const res = document.evaluate(r.XPath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    const unique = res.snapshotLength === 1 && res.snapshotItem(0) === r.el;
    // Click the element the XPath finds (what Blue Prism's Click does), record what fired
    const before = window.clicks.length;
    if (unique && r['BP Action'] === 'Click') res.snapshotItem(0).click();
    return { i: r.Index, type: r.Type, label: r.Label, xpath: r.XPath, q: r.Quality, unique, fired: window.clicks.slice(before).join(',') };
  }));
  for (const r of rows) {
    console.log(`${r.unique ? 'OK  ' : 'FAIL'} #${String(r.i).padEnd(2)} ${r.type.padEnd(7)} ${r.q.padEnd(7)} ${r.label.padEnd(16)} ${r.xpath.padEnd(58)} fired: ${r.fired || '-'}`);
  }
  const listedBody = await page.evaluate(() => BPScan.rows.some((r) => r.el === document.body));
  console.log('\nbody listed:', listedBody);
  await browser.close();
})();
