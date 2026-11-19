/**
 * Blue Prism XPath Scanner
 * ------------------------------------------------------------------
 * Run in Edge or Chrome DevTools (Console, or Sources -> Snippets).
 *
 * What it does:
 *   1. Finds interactive elements: buttons, links, text fields, dropdowns,
 *      radios, checkboxes, tables.
 *   2. Builds several candidate XPaths for each one, from most to least stable.
 *   3. Tests each candidate on the live page and keeps the first one that
 *      matches EXACTLY that element (one match, and it's the right one).
 *   4. Maps the element to an action in the "Browser - XPath Utility" VBO.
 *   5. Prints a table, draws numbered badges on the page, and downloads a CSV.
 *
 * Optional: before running, override settings, e.g.
 *   window.BP_SCAN_CONFIG = { showOverlay: false, csvSeparator: ',' };
 *
 * After running, use from the console:
 *   BPScan.highlight(5)   -> scroll to and outline element #5
 *   BPScan.clear()        -> remove badges and outlines
 *   BPScan.rows           -> the full results array
 */
(() => {
  'use strict';

  // ---------- Settings (override with window.BP_SCAN_CONFIG) ----------
  const CONFIG = Object.assign({
    includeHidden: true,    // hidden native radios/checkboxes are common; keep them, flag as Visible = No
    maxTextLength: 60,      // texts longer than this make poor anchors, skip them
    showOverlay: true,      // draw numbered badges on the page
    downloadCsv: true,      // download results as a CSV file
    csvSeparator: ';',      // ';' opens correctly in Excel with Polish regional settings
    // Elements whose text names a section of the form. Each element belongs to the nearest
    // one ABOVE it in the page. Add your app's own classes here (e.g. '.form-section-title').
    sectionSelector: 'legend, h1, h2, h3, h4, h5, h6, [role="heading"], .section-title, .panel-heading, .panel-title, .card-header, .card-title, mat-expansion-panel-header',
    // Also list elements that merely LOOK clickable: the mouse cursor is a hand (cursor: pointer).
    // Catches image/div buttons whose click handler was attached by script (no onclick attribute).
    pointerScan: true,
    // Ask for a screen name ("Search", "Edit", "Not Found") before saving. It goes into the
    // Screen column and the file name (bp-xpaths-Search.csv), so the generator can build one
    // object from scans of several screens. Set screenName to skip the question.
    askScreenName: true,
    screenName: '',
  }, window.BP_SCAN_CONFIG || {});

  // Everything we consider "interactive". input[type=hidden] is never useful for a bot.
  // [onclick] catches <img>, <div>, <td>... buttons built with an inline click handler.
  const CONTROLS = [
    'button', 'a[href]', '[role="button"]', '[role="link"]',
    'input:not([type="hidden"])', 'textarea', 'select',
    '[role="radio"]', '[role="checkbox"]', '[role="switch"]', '[role="combobox"]',
    '[contenteditable="true"]', '[onclick]',
  ];
  const SELECTOR = [...CONTROLS, 'table'].join(',');
  const CONTROL_SELECTOR = CONTROLS.join(','); // same without tables (a table is a container, not a control)

  // Attributes developers add specifically for test automation: the most stable choice.
  const TEST_ATTRS = ['data-testid', 'data-test', 'data-test-id', 'data-qa', 'data-cy', 'data-automation-id'];

  // Real form controls. Everything else with a role="..." is a custom widget built from divs/spans.
  const NATIVE_TAGS = ['input', 'select', 'textarea', 'button', 'a', 'table'];

  const OVERLAY_ID = '__bp_scan_overlay';
  const OUTLINE_ATTR = 'data-bp-scan-outline';

  // ---------- Small helpers ----------

  // Mirror XPath's normalize-space(): it only collapses space, tab, CR and LF.
  // (JavaScript's \s would also eat &nbsp;, which XPath does NOT, causing silent mismatches.)
  const norm = (s) => (s || '').replace(/[ \t\r\n]+/g, ' ').trim();

  // Build a safe XPath string literal. XPath 1.0 has no escape character, so a text
  // containing both ' and " must be glued together with concat().
  function lit(s) {
    if (!s.includes("'")) return `'${s}'`;
    if (!s.includes('"')) return `"${s}"`;
    return 'concat(' + s.split("'").map((p) => `'${p}'`).join(`, "'", `) + ')';
  }

  // Heuristic: does this id/name look auto-generated (changes between page loads)?
  function looksGenerated(v) {
    return /\d{3,}/.test(v)                                    // ember1234, input_8823
      || /[0-9a-f]{8}-[0-9a-f]{4}/i.test(v)                    // GUIDs
      || /^(mat-|cdk-|ng-|react-|rc-|ext-|j_id|ui-id-|:r)/i.test(v); // framework prefixes
  }

  // Run an XPath and return all matches as a snapshot (null if the XPath is invalid).
  function evaluate(xpath) {
    try {
      return document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    } catch (e) {
      return null;
    }
  }

  // The key check: exactly one match, and it is the element we're describing.
  function isUniqueFor(xpath, el) {
    const r = evaluate(xpath);
    return !!r && r.snapshotLength === 1 && r.snapshotItem(0) === el;
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0
      && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  }

  // ---------- Classification: what is it, and which VBO action fits ----------

  function classify(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();

    if (tag === 'table') return { kind: 'Table', action: 'Read Table' };
    if (tag === 'select' || role === 'combobox') return { kind: 'Dropdown', action: 'Select From List' };
    if ((tag === 'input' && type === 'radio') || role === 'radio') return { kind: 'Radio', action: 'Select Radio Option' };
    if ((tag === 'input' && type === 'checkbox') || role === 'checkbox' || role === 'switch') return { kind: 'Checkbox', action: 'Set Checkbox' };
    if (tag === 'button' || role === 'button' || (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(type))) return { kind: 'Button', action: 'Click' };
    if (tag === 'a' || role === 'link') return { kind: 'Link', action: 'Click' };
    if (tag === 'input' && type === 'file') return { kind: 'File Upload', action: 'Click (opens file dialog)' };
    // Passwords get their own action, so the generator can use a template that doesn't log the value
    if (tag === 'input' && type === 'password') return { kind: 'Password Field', action: 'Write Password' };
    if (tag === 'input' || tag === 'textarea' || el.isContentEditable) return { kind: 'Text Field', action: 'Write Text / Read Text' };
    // Anything else got here because it has onclick or a hand cursor: an <img>, <div>, <td>... button
    return { kind: 'Button', action: 'Click' };
  }

  // First function call in an onclick handler, e.g. "saveOrder(12)" from
  // onclick="saveOrder(12); return false;". Function names change less often than layout.
  function onclickCall(code) {
    const m = (code || '').match(/[A-Za-z_$][\w$.]*\s*\([^()]{0,50}\)/);
    return m ? m[0] : '';
  }

  // File name of an image, e.g. "btn_save.png" from "/img/icons/btn_save.png?v=3"
  function srcFile(src) {
    const name = (src || '').split(/[?#]/)[0].split('/').pop();
    return name && name.length <= CONFIG.maxTextLength && !name.startsWith('data:') ? name : '';
  }

  // Elements that look clickable (hand cursor) but have no onclick and aren't a control.
  // Only the OUTERMOST one counts: cursor is inherited, so an icon inside such a div is skipped.
  function pointerClickables(known) {
    // A page-level onclick on <body>/<html> doesn't make everything inside it "a control"
    const insideControl = (el) => {
      const c = el.closest(CONTROL_SELECTOR);
      return !!c && c !== document.body && c !== document.documentElement;
    };
    const found = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (known.has(el) || el.closest(`#${OVERLAY_ID}`)) continue;
      if (['svg', 'path', 'option', 'label', 'script', 'style'].includes(el.tagName.toLowerCase())) continue;
      if (insideControl(el) || el.querySelector(CONTROL_SELECTOR)) continue; // inside or around a control
      if (getComputedStyle(el).cursor !== 'pointer') continue;
      const parent = el.parentElement;
      if (parent && parent !== document.body && getComputedStyle(parent).cursor === 'pointer') continue;
      if (!isVisible(el)) continue;
      found.push(el);
    }
    return found;
  }

  // ---------- Finding human-readable text near an element ----------

  // Text of the sibling right before/after the element, e.g. <input> <strong>name 1</strong>.
  // Ignored if that sibling is itself interactive or the text is too long.
  function siblingAnchor(el, direction) {
    const s = direction === 'next' ? el.nextElementSibling : el.previousElementSibling;
    if (!s || s.matches(SELECTOR) || s.querySelector(SELECTOR)) return null;
    const text = norm(s.textContent);
    if (!text || text.length > CONFIG.maxTextLength) return null;
    return { tag: s.tagName.toLowerCase(), text };
  }

  // Is the element's own text a sensible way to identify it? True for buttons/links and for
  // custom ARIA widgets; false for inputs (their text is empty) and tables (far too long).
  function hasOwnText(el, kind) {
    const tag = el.tagName.toLowerCase();
    return kind === 'Button' || kind === 'Link'
      || (!!el.getAttribute('role') && !NATIVE_TAGS.includes(tag));
  }

  // For an element inside a table row: the text of that row's first cell (usually an ID or
  // name), e.g. '1001'. Lets us build //tr[td[1][normalize-space()='1001']]//button[...].
  function rowKey(el) {
    const tr = el.closest('tr');
    const first = tr && tr.querySelector('td, th');
    if (!first || first.contains(el)) return null; // the element is in the key cell itself
    const text = norm(first.textContent);
    return text && text.length <= CONFIG.maxTextLength ? text : null;
  }

  // <label for="id">Text</label>
  function labelFor(el) {
    const id = el.getAttribute('id');
    if (!id) return null;
    const lbl = [...document.querySelectorAll('label')].find((l) => l.getAttribute('for') === id);
    const text = lbl && norm(lbl.textContent);
    return text && text.length <= CONFIG.maxTextLength ? text : null;
  }

  // <label><input> Text</label>  (without the text of controls inside it: a <label> around
  // a <select> would otherwise include every option)
  function wrappingLabel(el) {
    const lbl = el.closest('label');
    const text = lbl && labelText(lbl);
    return text && text.length <= CONFIG.maxTextLength ? text : null;
  }

  // ---------- Field names (for fields that have no <label>) ----------
  // A field's VALUE is data ("12345"), never its name. These find the name in the usual
  // layouts instead; each returns null when it finds nothing sensible.

  // Visible text of a node without the form controls inside it
  function labelText(node) {
    if (!node) return '';
    const copy = node.cloneNode(true);
    copy.querySelectorAll('input, select, textarea, button, option, script, style').forEach((c) => c.remove());
    return norm(copy.textContent);
  }
  // A usable name: has a letter (so "12345", "12.50" or "2026-11-19" don't count), not too long.
  // A trailing ":" or "*" (required marker) is dropped: "Price *:" -> "Price"
  function asName(t) {
    const text = norm(String(t || '').replace(/[\s:*]+$/, ''));
    return text && text.length <= CONFIG.maxTextLength && /\p{L}/u.test(text) ? text : null;
  }
  // <span id="lblPrice">Price</span> ... <input aria-labelledby="lblPrice">
  function labelledBy(el) {
    const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    return asName(ids.map((id) => labelText(document.getElementById(id))).join(' '));
  }
  // Table forms:  <td>Price</td><td><input></td>  -> text of an earlier cell in the row
  //               <th>Price</th> above the column  -> that column header
  function cellLabel(el) {
    const cell = el.closest('td, th');
    if (!cell) return null;
    for (let c = cell.previousElementSibling; c; c = c.previousElementSibling) {
      if (c.matches(SELECTOR) || c.querySelector(SELECTOR)) break; // another field in between
      const t = asName(labelText(c));
      if (t) return t;
    }
    const row = cell.parentElement, table = cell.closest('table');
    const head = table && (table.querySelector('thead tr') || table.querySelector('tr'));
    if (head && head !== row) return asName(labelText(head.children[[...row.children].indexOf(cell)]));
    return null;
  }
  // Text just before the field in the same small block:
  //   <div><span>Price</span><div><input></div></div>   or   Price: <input>
  // Looks at most 3 levels up and stops at another field, so it never borrows a neighbour's name.
  function nearbyText(el) {
    let node = el;
    for (let up = 0; up < 3 && node.parentElement; up++) {
      for (let s = node.previousSibling; s; s = s.previousSibling) {
        if (s.nodeType === 3) { const t = asName(s.textContent); if (t) return t; continue; }
        if (s.nodeType !== 1) continue;
        if (s.matches(SELECTOR) || s.querySelector(SELECTOR)) return null;
        const t = asName(labelText(s));
        if (t) return t;
      }
      node = node.parentElement;
      if (/^(FORM|BODY|TABLE|TBODY|TR|UL|OL)$/.test(node.tagName)) break;
    }
    return null;
  }
  // A readable name from a technical one: "txtUnitPrice" -> "Unit Price",
  // "ctl00$Main$price_net" -> "Price Net". Generated ids give nothing.
  function humanize(v) {
    if (!v || looksGenerated(v)) return null;
    let t = String(v).split(/[$.:/]/).pop()
      .replace(/^(txt|tb|inp|input|ddl|cbo|cmb|sel|chk|cb|rb|rdo|fld|field|frm|lbl)(?=[A-Z_\-\d])/, '')
      .replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[_\-]+/g, ' ');
    t = norm(t).replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    return asName(t);
  }

  // ---------- Candidate XPaths, in priority order ----------

  function candidates(el, kind) {
    const attr = (n) => el.getAttribute(n);
    const tag = el.tagName.toLowerCase();
    const type = attr('type');
    const role = attr('role');
    // Including @type / @role makes the XPath self-documenting and narrows the search:
    //   //input[@type='radio'][...]   or   //div[@role='radio'][...]
    const base = tag === 'input' && type ? `//input[@type=${lit(type)}]`
      : role && !NATIVE_TAGS.includes(tag) ? `//${tag}[@role=${lit(role)}]`
      : `//${tag}`;
    const step = base.slice(2); // same thing without the leading '//', for use after an axis
    const list = [];
    const add = (xpath, quality, strategy) => list.push({ xpath, quality, strategy });

    // 1. Test-automation attributes
    for (const t of TEST_ATTRS) {
      if (attr(t)) add(`${base}[@${t}=${lit(attr(t))}]`, 'Stable', t);
    }

    // 2. id (only when it doesn't look generated)
    if (attr('id') && !looksGenerated(attr('id'))) add(`${base}[@id=${lit(attr('id'))}]`, 'Stable', 'id');

    // 3. name - radios/checkboxes share a name within a group, so add value to tell them apart
    if (attr('name') && !looksGenerated(attr('name'))) {
      if ((kind === 'Radio' || kind === 'Checkbox') && attr('value')) {
        add(`${base}[@name=${lit(attr('name'))}][@value=${lit(attr('value'))}]`, 'Stable', 'name + value');
      }
      add(`${base}[@name=${lit(attr('name'))}]`, 'Stable', 'name');
    }

    // 4. aria-label (used as-is: XPath compares attributes exactly), and alt text of images
    if (attr('aria-label')) add(`${base}[@aria-label=${lit(attr('aria-label'))}]`, 'Good', 'aria-label');
    if (attr('alt')) add(`${base}[@alt=${lit(attr('alt'))}]`, 'Good', 'alt');

    // 5. Visible text on buttons, links and custom ARIA widgets (<div role="radio">Bank transfer</div>)
    const text = norm(el.textContent);
    if (hasOwnText(el, kind) && text && text.length <= CONFIG.maxTextLength) {
      add(`${base}[normalize-space()=${lit(text)}]`, 'Good', 'text');
    }
    if (tag === 'input' && ['button', 'submit', 'reset'].includes(type) && attr('value')) {
      add(`${base}[@value=${lit(attr('value'))}]`, 'Good', 'button value');
    }

    // 5b. Title, the function an onclick calls, the image file shown. For buttons and links
    //     (often image buttons with no text) these come BEFORE neighbour-text anchors.
    const isClick = kind === 'Button' || kind === 'Link';
    const clickHints = () => {
      if (attr('title')) add(`${base}[@title=${lit(attr('title'))}]`, 'Good', 'title');
      const call = onclickCall(attr('onclick'));
      if (call) add(`${base}[contains(@onclick, ${lit(call)})]`, 'Good', 'onclick');
      const file = srcFile(attr('src'));
      if (file) add(`${base}[contains(@src, ${lit(file)})]`, 'Good', 'image file');
    };
    if (isClick) clickHints();

    // 6. <label for> - joins label to input, works even when the id itself is generated
    const lf = labelFor(el);
    if (lf) add(`${base}[@id=//label[normalize-space()=${lit(lf)}]/@for]`, 'Good', 'label[for]');

    // 7. Wrapping <label>
    // (exact label text as the page has it: the XPath compares normalize-space() of the label)
    const wl = (() => { const l = el.closest('label'); const t = l && norm(l.textContent); return t && t.length <= CONFIG.maxTextLength ? t : null; })();
    if (wl) add(`//label[normalize-space()=${lit(wl)}]${base}`, 'Good', 'wrapping label');

    // 8. Sibling text anchors. Radios/checkboxes usually have text AFTER them,
    //    text fields usually have it BEFORE, so try the likely one first.
    const after = siblingAnchor(el, 'next');
    const before = siblingAnchor(el, 'prev');
    const anchorAfter = after && [`//${after.tag}[normalize-space()=${lit(after.text)}]/preceding::${step}[1]`, 'Good', 'text after'];
    const anchorBefore = before && [`//${before.tag}[normalize-space()=${lit(before.text)}]/following::${step}[1]`, 'Good', 'text before'];
    const anchors = (kind === 'Radio' || kind === 'Checkbox') ? [anchorAfter, anchorBefore] : [anchorBefore, anchorAfter];
    anchors.filter(Boolean).forEach((a) => add(...a));

    // 9. placeholder and title
    if (attr('placeholder')) add(`${base}[@placeholder=${lit(attr('placeholder'))}]`, 'Good', 'placeholder');
    if (!isClick) clickHints(); // title (and onclick/src, rare on fields) for everything else

    // 10. Tables: by caption, or by a header cell
    if (kind === 'Table') {
      const cap = el.querySelector('caption');
      if (cap && norm(cap.textContent)) add(`//table[caption[normalize-space()=${lit(norm(cap.textContent))}]]`, 'Good', 'caption');
      for (const th of el.querySelectorAll('th')) {
        const t = norm(th.textContent);
        if (t && t.length <= CONFIG.maxTextLength) add(`//table[.//th[normalize-space()=${lit(t)}]]`, 'Good', 'header text');
      }
    }

    return list;
  }

  // Nearest ancestor with a stable id or test attribute, used to scope ambiguous XPaths.
  function stableAncestor(el) {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const tag = n.tagName.toLowerCase();
      for (const t of TEST_ATTRS) {
        if (n.getAttribute(t)) return `//${tag}[@${t}=${lit(n.getAttribute(t))}]`;
      }
      const id = n.getAttribute('id');
      if (id && !looksGenerated(id)) return `//${tag}[@id=${lit(id)}]`;
    }
    return null;
  }

  // Last resort: an indexed path, anchored on the nearest stable ancestor if there is one.
  function positionalPath(el) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      const tag = n.tagName.toLowerCase();
      const id = n.getAttribute('id');
      if (n !== el && id && !looksGenerated(id)) {
        return `//${tag}[@id=${lit(id)}]/` + parts.join('/');
      }
      const sameTag = [...n.parentElement.children].filter((c) => c.tagName === n.tagName);
      parts.unshift(sameTag.length > 1 ? `${tag}[${sameTag.indexOf(n) + 1}]` : tag);
    }
    return '/html/' + parts.join('/');
  }

  // Pick the best XPath: unique on its own > inside a container > by table row > indexed > positional.
  function bestXPath(el, kind) {
    const cands = candidates(el, kind);

    // a) Unique on its own
    for (const c of cands) if (isUniqueFor(c.xpath, el)) return c;

    // b) Same candidates, scoped to the nearest stable container: //div[@id='x']//button[...]
    const scope = stableAncestor(el);
    if (scope) {
      for (const c of cands) {
        const xp = scope + c.xpath;
        if (isUniqueFor(xp, el)) return { ...c, xpath: xp, strategy: `${c.strategy} in container` };
      }
    }

    // c) Inside a table row: use the row's first cell as a key, e.g.
    //    //tr[*[1][normalize-space()='1001']]//button[normalize-space()='Edit']
    //    In Blue Prism, swap '1001' for a data item to target any row.
    const key = rowKey(el);
    if (key) {
      for (const c of cands) {
        const xp = `//tr[*[1][normalize-space()=${lit(key)}]]${c.xpath}`;
        if (isUniqueFor(xp, el)) return { ...c, xpath: xp, strategy: `${c.strategy} in row '${key}'` };
      }
    }

    // d) Pick the n-th match: (//button[normalize-space()='Edit'])[2]
    for (const c of cands) {
      const r = evaluate(c.xpath);
      if (!r) continue;
      for (let i = 0; i < r.snapshotLength; i++) {
        if (r.snapshotItem(i) === el) {
          return { xpath: `(${c.xpath})[${i + 1}]`, quality: 'Fragile', strategy: `${c.strategy} + index` };
        }
      }
    }

    // e) Positional path
    const xp = positionalPath(el);
    return { xpath: xp, quality: isUniqueFor(xp, el) ? 'Fragile' : 'BROKEN', strategy: 'position' };
  }

  // ---------- Sections and radio groups ----------

  // Section headings in document order (collected once per scan).
  let sectionHeadings = [];

  // Which section of the form an element belongs to:
  //   1. the <legend> of its <fieldset>
  //   2. an aria-labelled region/group around it
  //   3. the nearest section heading above it in the page
  function sectionOf(el) {
    const clip = (t) => norm(t).slice(0, CONFIG.maxTextLength);
    const fs = el.closest('fieldset');
    const legend = fs && [...fs.children].find((c) => c.tagName === 'LEGEND');
    if (legend && norm(legend.textContent)) return clip(legend.textContent);

    const region = el.closest('section[aria-label], [role="region"][aria-label], [role="group"][aria-label], form[aria-label]');
    if (region) return clip(region.getAttribute('aria-label'));

    let best = null;
    for (const h of sectionHeadings) {
      if (h.contains(el)) continue;
      // Headings are in document order: stop at the first one that comes after the element
      if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) best = h; else break;
    }
    return best ? clip(best.textContent) : '';
  }

  // Name of a radio's group: an ARIA radiogroup label, else its name attribute.
  function groupOf(el, kind) {
    if (kind !== 'Radio') return '';
    const rg = el.closest('[role="radiogroup"]');
    if (rg) {
      const by = rg.getAttribute('aria-labelledby');
      const text = rg.getAttribute('aria-label') || (by && norm(document.getElementById(by)?.textContent));
      if (text) return norm(text).slice(0, CONFIG.maxTextLength);
    }
    return el.getAttribute('name') || '';
  }

  // For radios: a unique XPath that contains the option's visible text, so the generator
  // can turn that text into a parameter (one "Select option" action for the whole group).
  function optionXPath(el, kind) {
    if (kind !== 'Radio') return '';
    const textual = ['label[for]', 'wrapping label', 'text after', 'text before', 'text', 'aria-label'];
    const c = candidates(el, kind).find((x) => textual.includes(x.strategy) && isUniqueFor(x.xpath, el));
    return c ? c.xpath : '';
  }

  // A short human-readable name for the results table.
  function describe(el, kind) {
    const attr = (n) => el.getAttribute(n);
    const after = siblingAnchor(el, 'next');
    const before = siblingAnchor(el, 'prev');
    const text = norm(el.textContent);
    if (kind === 'Table') {
      // Tables: caption, else "table: <first header>"
      const cap = norm(el.querySelector('caption')?.textContent);
      const th = norm(el.querySelector('th')?.textContent);
      return (cap || (th ? `table: ${th}` : 'table')).slice(0, CONFIG.maxTextLength);
    }
    const key = rowKey(el);
    // Fields: a name from the page, never the field's current value or content
    if (['Text Field', 'Password Field', 'Dropdown', 'Checkbox', 'Radio', 'File Upload'].includes(kind)) {
      const field = asName(attr('aria-label')) || labelledBy(el) || asName(labelFor(el)) || asName(wrappingLabel(el))
        || asName((kind === 'Radio' || kind === 'Checkbox') ? after?.text : before?.text)
        || cellLabel(el) || nearbyText(el)
        || asName(attr('title')) || asName(attr('placeholder'))
        || humanize(attr('name')) || humanize(attr('id')) || humanize(attr('data-testid')) || '';
      return field.slice(0, CONFIG.maxTextLength);
    }
    const name = attr('aria-label') || labelFor(el) || wrappingLabel(el)
      // Neighbour text names a field ("City: [____]"), but not a button: a button's own
      // text/alt/title says what it does, the heading next to it doesn't.
      || (['Button', 'Link'].includes(kind) ? '' : ((kind === 'Radio' || kind === 'Checkbox') ? after?.text : before?.text))
      || (hasOwnText(el, kind) ? text + (key ? ` (row ${key})` : '') : '')
      || attr('alt') || attr('title')
      || attr('placeholder') || attr('value') || attr('name') || attr('id')
      || srcFile(attr('src')) || onclickCall(attr('onclick')) || '';
    return name.slice(0, CONFIG.maxTextLength);
  }

  // Blue Prism expressions write a literal " as "" inside a string.
  const bpExpression = (xpath) => '"' + xpath.replace(/"/g, '""') + '"';

  // ---------- Output ----------

  function clearOverlay() {
    document.getElementById(OVERLAY_ID)?.remove();
    document.querySelectorAll(`[${OUTLINE_ATTR}]`).forEach((e) => {
      e.style.outline = e.getAttribute(OUTLINE_ATTR);
      e.removeAttribute(OUTLINE_ATTR);
    });
  }

  function drawOverlay(rows) {
    clearOverlay();
    const colours = { Stable: '#1a7f37', Good: '#0969da', Fragile: '#bf8700', BROKEN: '#cf222e' };
    const layer = document.createElement('div');
    layer.id = OVERLAY_ID;
    // pointer-events:none so the badges never block clicks on the page
    Object.assign(layer.style, { position: 'absolute', top: '0', left: '0', zIndex: '2147483647', pointerEvents: 'none' });
    for (const r of rows) {
      if (!r.Visible) continue;
      const rect = r.el.getBoundingClientRect();
      const badge = document.createElement('div');
      badge.textContent = r.Index;
      Object.assign(badge.style, {
        position: 'absolute',
        left: `${rect.left + window.scrollX}px`,
        top: `${Math.max(0, rect.top + window.scrollY - 14)}px`,
        background: colours[r.Quality], color: '#fff',
        font: 'bold 11px/14px sans-serif', padding: '0 4px', borderRadius: '3px',
      });
      layer.appendChild(badge);
    }
    document.body.appendChild(layer);
  }

  function toCsv(rows) {
    const cols = ['Index', 'Type', 'Section', 'Label', 'XPath', 'BP Action', 'Quality', 'Strategy', 'Visible', 'Group', 'Option XPath', 'BP Expression', 'Page URL', 'Page Title', 'Scanned At', 'Screen'];
    const cell = (v) => `"${String(v).replace(/"/g, '""')}"`; // CSV escaping: wrap in quotes, double inner quotes
    return [cols.join(CONFIG.csvSeparator)]
      .concat(rows.map((r) => cols.map((c) => cell(c === 'Visible' ? (r.Visible ? 'Yes' : 'No') : r[c])).join(CONFIG.csvSeparator)))
      .join('\r\n');
  }

  function downloadCsv(csv, screen) {
    // \uFEFF (BOM) tells Excel the file is UTF-8, so Polish characters display correctly
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    // File name: the screen name when given, otherwise the site name
    const safe = (t) => t.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    a.download = `bp-xpaths-${safe(screen || '') || location.hostname || 'page'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- Main ----------

  clearOverlay(); // so a re-run doesn't scan our own badges

  sectionHeadings = [...document.querySelectorAll(CONFIG.sectionSelector)]
    .filter((h) => norm(h.textContent) && !h.closest(`#${OVERLAY_ID}`));

  // Controls + (optionally) hand-cursor clickables, in page order.
  // onclick on <body>/<html> is page-level behaviour, not a button.
  const controls = [...document.querySelectorAll(SELECTOR)]
    .filter((el) => el !== document.body && el !== document.documentElement);
  const extra = CONFIG.pointerScan ? pointerClickables(new Set(controls)) : [];
  const elements = [...controls, ...extra].sort((a, b) =>
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

  // Local date and time of the scan, e.g. "2026-10-29 16:20"
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const scannedAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const rows = [];
  for (const el of elements) {
    if (el.closest(`#${OVERLAY_ID}`)) continue;
    const visible = isVisible(el);
    if (!visible && !CONFIG.includeHidden) continue;

    const { kind, action } = classify(el);
    const best = bestXPath(el, kind);
    rows.push({
      Index: rows.length + 1,
      Type: kind,
      Section: sectionOf(el),
      Label: describe(el, kind),
      XPath: best.xpath,
      'BP Action': action,
      Quality: best.quality,
      Strategy: best.strategy,
      Visible: visible,
      Group: groupOf(el, kind),
      'Option XPath': optionXPath(el, kind),
      'BP Expression': bpExpression(best.xpath),
      // Where this came from: the generator writes it into the object's description
      'Page URL': location.href.split('#')[0],
      'Page Title': document.title,
      'Scanned At': scannedAt,
      el, // kept for highlight(); not shown in the table or CSV
    });
  }

  // Console table without the DOM element column
  // (page URL/title and long helper columns are in the CSV; the console table stays readable)
  console.table(rows.map(({ el, 'Page URL': u, 'Page Title': t, 'Scanned At': s, 'BP Expression': b, 'Option XPath': o, ...r }) => r));

  // XPath cannot look inside iframes or shadow DOM, so warn when the page has them
  const frames = document.querySelectorAll('iframe, frame').length;
  if (frames) console.warn(`${frames} iframe(s) on this page were NOT scanned. Open the frame's own URL, or pick its context in the DevTools console dropdown, and run again.`);
  const shadows = [...document.querySelectorAll('*')].filter((e) => e.shadowRoot).length;
  if (shadows) console.warn(`${shadows} element(s) use shadow DOM; their insides are invisible to XPath.`);

  // Which screen is this? (Cancel or empty = no name; the generator then uses the file name)
  if (CONFIG.showOverlay) drawOverlay(rows); // badges first, so you can see what was found
  const screen = String(CONFIG.screenName || (CONFIG.askScreenName
    ? window.prompt(`Found ${rows.length} elements. Name of this screen (e.g. Search, Edit, Not Found):`, '') || ''
    : '')).trim();
  rows.forEach((r) => { r.Screen = screen; });

  const csv = toCsv(rows);
  if (CONFIG.downloadCsv) downloadCsv(csv, screen);
  if (typeof copy === 'function') copy(csv); // DevTools-only helper: CSV goes to the clipboard too

  // Expose helpers for the console
  window.BPScan = {
    rows,
    csv,
    clear: clearOverlay,
    highlight(index) {
      const r = rows.find((x) => x.Index === index);
      if (!r) return console.warn(`No element #${index}`);
      r.el.scrollIntoView({ block: 'center' });
      if (!r.el.hasAttribute(OUTLINE_ATTR)) r.el.setAttribute(OUTLINE_ATTR, r.el.style.outline || '');
      r.el.style.outline = '3px solid magenta';
      console.log(`#${index}`, r.XPath, r.el);
    },
  };

  const count = (q) => rows.filter((r) => r.Quality === q).length;
  console.log(`BP scan: ${rows.length} elements | Stable ${count('Stable')} | Good ${count('Good')} | Fragile ${count('Fragile')} | Broken ${count('BROKEN')}`);
  return `${rows.length} elements scanned. Use BPScan.highlight(n) to find one on the page.`;
})();
