// Runs the whole test suite in the right order (later tests use files earlier ones create).
//   node tests/run-all.js
// Needs: Node 18+, Playwright with Chromium (npm i; npx playwright install chromium),
// and for run-table.js the Mono C# compiler (mcs) to compile the Read Table code stage.
const { spawnSync } = require('child_process');
const path = require('path');

const steps = [
  // test templates, mock objects, a scanned page
  'build-template.js', 'build-template-full.js', 'build-template-title.js', 'build-template-verify.js',
  'build-chrome-mock.js', ['build-chrome-mock.js', 'readsel'], 'scan-sections.js',
  // scanner + generator
  'run-chromium.js', 'run-generator.js', 'run-full.js', 'run-full-ui.js', 'run-title.js', 'run-sections.js',
  'run-mixed.js', 'run-wizard.js', 'run-bulk.js', 'run-order.js', 'run-images.js', 'run-naming.js', 'run-cond.js',
  // template builder, several screens, filter, references, dropdowns, field names, guide, tables
  'run-chrome.js', 'run-chrome-flow.js', 'run-screens.js', 'run-filter.js', 'run-refs.js', 'run-select.js',
  'run-labels.js', 'run-intro.js', 'run-table.js', 'run-repair.js',
];

// A test fails when it exits with an error or reports problems
const failed = (out) => /PROBLEMS: \[|TOTAL PROBLEMS: [1-9]|[1-9]\d* failures|JS errors: \[|Broken data references: (?!none)/.test(out);

let bad = 0;
for (const step of steps) {
  const [file, ...args] = Array.isArray(step) ? step : [step];
  const r = spawnSync(process.execPath, [path.join(__dirname, file), ...args], { cwd: __dirname, encoding: 'utf8', timeout: 300000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0 && !failed(out);
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${[file, ...args].join(' ')}`);
  if (!ok) console.log(out.split('\n').slice(-15).map((l) => '     ' + l).join('\n'));
}
console.log(bad ? `\n${bad} of ${steps.length} failed` : `\nAll ${steps.length} passed`);
process.exit(bad ? 1 : 0);
