// Same check as run.js, but in real Chromium (the engine behind Chrome and Edge).
// Also exercises visibility detection and the numbered-badge overlay.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  await page.goto('file://' + path.join(__dirname, 'sample.html'));

  // Show badges, skip the file download
  await page.evaluate(() => { window.BP_SCAN_CONFIG = { downloadCsv: false }; });
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '..', 'bp-xpath-scanner.js'), 'utf8') });

  // Re-check every XPath against the element it was generated for
  const results = await page.evaluate(() => BPScan.rows.map((r) => {
    const res = document.evaluate(r.XPath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    return { ...r, el: undefined, ok: res.snapshotLength === 1 && res.snapshotItem(0) === r.el };
  }));

  let failures = 0;
  for (const r of results) {
    if (!r.ok) failures++;
    console.log(`${r.ok ? 'OK  ' : 'FAIL'} #${String(r.Index).padEnd(2)} ${r.Type.padEnd(10)} ${r.Quality.padEnd(7)} vis=${r.Visible ? 'Y' : 'N'} ${r.XPath}`);
  }
  console.log(`\n${results.length} rows, ${failures} failures`);
  console.log('\nCSV header + first row:\n' + (await page.evaluate(() => BPScan.csv.split('\r\n').slice(0, 2).join('\n'))));

  await page.screenshot({ path: path.join(__dirname, 'overlay.png'), fullPage: true });
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
