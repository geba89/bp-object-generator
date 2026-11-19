// Scan sections.html in Chromium, save the CSV and print the new columns
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + path.join(__dirname, 'sections.html'));
  await p.evaluate(() => { window.BP_SCAN_CONFIG = { downloadCsv: false, showOverlay: false }; });
  await p.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '..', 'bp-xpath-scanner.js'), 'utf8') });
  const { rows, csv } = await p.evaluate(() => ({ csv: BPScan.csv, rows: BPScan.rows.map(({ el, ...r }) => r) }));
  fs.writeFileSync(path.join(__dirname, 'sections.csv'), '﻿' + csv);
  for (const r of rows) console.log(`#${String(r.Index).padEnd(2)} ${r.Type.padEnd(10)} ${r.Section.padEnd(16)} ${r.Label.padEnd(18)} grp=${(r.Group||'-').padEnd(12)} opt=${r['Option XPath'] || '-'}`);
  await b.close();
})();
