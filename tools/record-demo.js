// Records docs/demo.gif: the whole workflow in a real browser, with a caption per step.
//   node tools/record-demo.js
// Needs Playwright (Chromium) and ffmpeg. Everything shown is example data from examples/.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SIZE = { width: 1040, height: 650 }; // a small window keeps the text readable in the GIF
const DEMO_URL = 'https://portal.example.com/registration'; // the demo page is served under this address
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs in every page before its own scripts: a visible cursor and a caption bar.
// Both ignore the mouse, so they never get in the way of the page (or of the scanner).
function overlays() {
  const make = () => {
    const cursor = document.createElement('div');
    cursor.id = '__cursor';
    Object.assign(cursor.style, {
      position: 'fixed', left: '-40px', top: '-40px', width: '22px', height: '22px', margin: '-11px 0 0 -11px',
      borderRadius: '50%', background: 'rgba(31,95,214,.55)', border: '2px solid #fff', boxShadow: '0 0 0 1px rgba(31,95,214,.8)',
      zIndex: 2147483647, pointerEvents: 'none', transition: 'transform .12s',
    });
    const caption = document.createElement('div');
    caption.id = '__caption';
    Object.assign(caption.style, {
      position: 'fixed', left: '50%', bottom: '22px', transform: 'translateX(-50%)', maxWidth: '86%',
      padding: '12px 24px', borderRadius: '10px', background: 'rgba(27,35,48,.94)', color: '#fff',
      font: '600 24px/1.3 "Segoe UI", Arial, sans-serif', textAlign: 'center', zIndex: 2147483647,
      pointerEvents: 'none', boxShadow: '0 6px 24px rgba(0,0,0,.3)', display: 'none',
    });
    document.documentElement.append(cursor, caption);
    document.addEventListener('mousemove', (e) => { cursor.style.left = e.clientX + 'px'; cursor.style.top = e.clientY + 'px'; }, true);
    document.addEventListener('mousedown', () => { cursor.style.transform = 'scale(.6)'; }, true);
    document.addEventListener('mouseup', () => { cursor.style.transform = 'scale(1)'; }, true);
    window.__say = (text) => { caption.textContent = text; caption.style.display = text ? 'block' : 'none'; };
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', make); else make();
}

(async () => {
  const videoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-demo-'));
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: videoDir, size: SIZE }, acceptDownloads: true });
  await context.addInitScript(overlays);
  // The demo page under a realistic address (so the scan shows a normal URL, not a file path)
  await context.route('https://portal.example.com/**', (route) => route.fulfill({
    contentType: 'text/html', body: fs.readFileSync(path.join(ROOT, 'examples', 'demo-page.html')),
  }));
  const page = await context.newPage();
  const say = (text) => page.evaluate((t) => window.__say(t), text);
  let mouse = { x: 600, y: 300 };
  // Move the visible cursor to an element (scrolling it into view first), optionally click it
  async function pointAt(selector, { click = true } = {}) {
    const el = page.locator(selector).first();
    await el.evaluate((n) => n.scrollIntoView({ block: 'center' })); // a jump, not a smooth scroll: far fewer frames
    await pause(250);
    const box = await el.boundingBox();
    const to = { x: box.x + Math.min(box.width / 2, 90), y: box.y + box.height / 2 };
    await page.mouse.move(to.x, to.y, { steps: 10 });
    mouse = to;
    await pause(220);
    if (click) { await page.mouse.down(); await pause(90); await page.mouse.up(); }
    await pause(160);
  }
  const top = async () => { await page.evaluate(() => window.scrollTo(0, 0)); await pause(150); };

  // ---- 1. the application page + scanner ----
  await page.goto(DEMO_URL);
  await page.mouse.move(mouse.x, mouse.y);
  await say('1  Open your web page and run the scanner snippet');
  await pause(1700);
  await page.evaluate(() => { window.BP_SCAN_CONFIG = { askScreenName: false }; });
  const [csvDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'bp-xpath-scanner.js'), 'utf8') }),
  ]);
  const csvPath = path.join(videoDir, 'bp-xpaths-Registration.csv');
  await csvDownload.saveAs(csvPath);
  await say('It finds every field and builds a stable XPath for each');
  await pause(700);
  await page.screenshot({ path: path.join(ROOT, 'docs', 'demo-poster.png') });
  await pause(1800);

  // ---- 2. generator: template ----
  await page.goto('file://' + path.join(ROOT, 'bp-object-generator.html') + '?nointro');
  await page.mouse.move(mouse.x, mouse.y);
  await say('2  Open the generator and load your template object');
  await pause(1000);
  await pointAt('#tplFile', { click: false });
  await page.setInputFiles('#tplFile', path.join(ROOT, 'examples', 'TPL - Web Browser Template.bpobject'));
  await page.waitForFunction(() => !!BPGen.state.tpl);
  await pause(1500);
  await pointAt('section[data-step="1"] .next');

  // ---- 3. scan ----
  await top();
  await say('3  Load the scan');
  await pointAt('#csvFile', { click: false });
  await page.setInputFiles('#csvFile', csvPath);
  await page.waitForFunction(() => BPGen.state.rows.length > 0);
  await pause(1500);
  await pointAt('section[data-step="2"] .next');

  // ---- 4. combine into actions ----
  await top();
  await say('4  Group the fields into actions');
  await pause(900);
  await pointAt('input[name=mode][value=section]');
  await pause(1200);
  await pointAt('#plan', { click: false });
  await pause(1500);
  await pointAt('section[data-step="3"] .next');

  // ---- 5. order, conditions, checks ----
  await top();
  await say('5  Set the order, skip empty inputs, check after writing');
  await pause(2300);
  await pointAt('section[data-step="4"] .next');

  // ---- 6. generate ----
  await top();
  await say('6  Generate, then import the object into Blue Prism');
  await pointAt('#objName');
  await page.fill('#objName', '');
  await page.type('#objName', 'Portal - Registration', { delay: 45 });
  await pause(500);
  const [objDownload] = await Promise.all([page.waitForEvent('download'), pointAt('#generate')]);
  await objDownload.saveAs(path.join(videoDir, 'object.bpobject'));
  await pointAt('#genInfo', { click: false });
  await pause(2200);
  await say('Runs offline in your browser. Free and open source.');
  await pause(2400);

  const video = page.video();
  await context.close();
  await browser.close();
  const webm = await video.path();

  // ---- video -> GIF (own colour palette, only changed areas redrawn: small file, sharp text) ----
  const gif = path.join(ROOT, 'docs', 'demo.gif');
  const filter = 'fps=6,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.4', '-i', webm, '-vf', filter, gif]);
  console.log(`docs/demo.gif: ${(fs.statSync(gif).size / 1048576).toFixed(2)} MB`);
  console.log('Generated object stages:', (fs.readFileSync(path.join(videoDir, 'object.bpobject'), 'utf8').match(/<stage /g) || []).length);
  console.log('Scan:', fs.readFileSync(csvPath, 'utf8').split('\r\n').slice(1).filter(Boolean).map((l) => l.split(';').slice(1, 4).join(' ').replace(/"/g, '')).join(' | '));
})();
