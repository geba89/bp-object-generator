// Mock of a typical dynamic-XPath browser object:
//   object "Web Browser", page "Dynamic Action" (sic), inputs I_Attempts, I_PageTitle,
//   I_PageTitles, I_XPath, I_Click, I_Read, I_Write, I_Text, I_Select, output O_Text,
//   plus other pages (Attach, Wait For Page) that must NOT be picked.
// Writes test/chrome-mock.bpobject
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const g = () => crypto.randomUUID();
const subsheets = [], stages = [];
const view = '<view><camerax>0</camerax><cameray>0</cameray><zoom version="2">1.25</zoom></view>';

function page(name, inputs, outputs = []) {
  const id = g(), start = g(), end = g();
  subsheets.push(`<subsheet subsheetid="${id}" type="Normal" published="True"><name>${name}</name>${view}</subsheet>`);
  stages.push(`<stage stageid="${start}" name="Start" type="Start"><subsheetid>${id}</subsheetid><display x="15" y="-105" /><inputs>` +
    inputs.map(([n, t]) => `<input type="${t}" name="${n}" narrative="" stage="${n}" />`).join('') + `</inputs><onsuccess>${end}</onsuccess></stage>`);
  stages.push(`<stage stageid="${end}" name="End" type="End"><subsheetid>${id}</subsheetid><display x="15" y="90" />` +
    (outputs.length ? `<outputs>${outputs.map(([n, t]) => `<output type="${t}" name="${n}" narrative="" stage="${n}" />`).join('')}</outputs>` : '') + `</stage>`);
  for (const [n, t] of [...inputs, ...outputs]) stages.push(`<stage stageid="${g()}" name="${n}" type="Data"><subsheetid>${id}</subsheetid><display x="300" y="0" /><datatype>${t}</datatype><initialvalue xml:space="preserve" /><private /></stage>`);
}

page('Attach', [['I_PageTitle', 'text']]);
page('Wait For Page', [['I_PageTitle', 'text'], ['I_Attempts', 'number']], [['O_Displayed', 'flag']]);
page('Dynamic Action', [
  ['I_Attempts', 'number'], ['I_PageTitle', 'text'], ['I_PageTitles', 'text'], ['I_XPath', 'text'],
  ['I_Click', 'flag'], ['I_Read', 'flag'], ['I_Write', 'flag'], ['I_Text', 'text'], ['I_Select', 'text'],
  // "node build-chrome-mock.js readsel": the object also has a "read the selected item" flag
  ...(process.argv[2] === 'readsel' ? [['I_ReadSelected', 'flag']] : []),
], [['O_Text', 'text']]);
page('Close Browser', [['I_PageTitle', 'text']]);

const xml = `<?xml version="1.0" encoding="utf-8"?>
<process name="Web Browser" version="1.0" bpversion="7.5.1.0" narrative="" byrefcollection="true" type="object" runmode="Exclusive" preferredid="${g()}">
  <appdef><element name="Application Root"><id>${g()}</id><type>Application</type><basetype>Application</basetype><datatype>unknown</datatype><diagnose>False</diagnose></element></appdef>
  ${view}<preconditions /><endpoint narrative="" />
  ${subsheets.join('\n  ')}
  ${stages.join('\n  ')}
</process>`;
const out = process.argv[2] === 'readsel' ? 'chrome-mock-readsel.bpobject' : 'chrome-mock.bpobject';
fs.writeFileSync(path.join(__dirname, out), xml);
console.log(out + ' written');
