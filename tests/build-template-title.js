// Mock template shaped like the user's: every TPL page has I_Title + I_Titles, one dynamic
// action on the Chrome object does everything (Attempts, Page title(s), XPATH, Click/Read/
// Write flags, Select, Text). Writes test/template-title.bpobject.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const g = () => crypto.randomUUID();
const OBJ = 'Chrome - Dynamic Actions';
const subsheets = [], stages = [];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Main page
const initEnd = g();
stages.push(`<stage stageid="${g()}" name="Start" type="Start"><display x="15" y="-105" /><onsuccess>${initEnd}</onsuccess></stage>`);
stages.push(`<stage stageid="${initEnd}" name="End" type="End"><display x="15" y="90" /></stage>`);
subsheets.push(`<subsheet subsheetid="${g()}" type="CleanUp" published="True"><name>Clean Up</name><view><camerax>0</camerax><cameray>0</cameray><zoom version="2">1.25</zoom></view></subsheet>`);

// One TPL page: Start(I_Title, I_Titles, extra inputs) -> [skip?] -> Dynamic action -> End(outputs)
function page(name, { inputs = [], outputs = [], flags, select = '""', text = '""', skip = '' }) {
  const id = g(), start = g(), act = g(), end = g(), dec = g(), skipEnd = g(), exc = g();
  const ins = ['I_Title', 'I_Titles', ...inputs];
  subsheets.push(`<subsheet subsheetid="${id}" type="Normal" published="True"><name>${name}</name><view><camerax>0</camerax><cameray>0</cameray><zoom version="2">1.25</zoom></view></subsheet>`);
  stages.push(`<stage stageid="${g()}" name="${name}" type="SubSheetInfo"><subsheetid>${id}</subsheetid><narrative>{{LABEL}}</narrative><display x="-195" y="-105" w="150" h="90" /></stage>`);
  stages.push(`<stage stageid="${start}" name="Start" type="Start"><subsheetid>${id}</subsheetid><loginhibit onsuccess="true" /><display x="15" y="-105" /><inputs>` +
    ins.map((n) => `<input type="text" name="${n}" narrative="" stage="${n}" />`).join('') + `</inputs><onsuccess>${skip ? dec : act}</onsuccess></stage>`);
  if (skip) {
    stages.push(`<stage stageid="${dec}" name="${skip} given?" type="Decision"><subsheetid>${id}</subsheetid><display x="15" y="-60" w="90" h="60" /><decision expression="${esc(`[${skip}] <> ""`)}" /><ontrue>${act}</ontrue><onfalse>${skipEnd}</onfalse></stage>`);
    stages.push(`<stage stageid="${skipEnd}" name="Skip" type="End"><subsheetid>${id}</subsheetid><display x="135" y="-60" /></stage>`);
  }
  const [click, read, write] = flags;
  stages.push(`<stage stageid="${act}" name="Dynamic Action" type="Action"><subsheetid>${id}</subsheetid><loginhibit onsuccess="true" /><display x="15" y="-15" /><inputs>` +
    `<input type="number" name="Attempts" expr="3" />` +
    `<input type="text" name="Page title" expr="[I_Title]" />` +
    `<input type="text" name="Page titles" expr="[I_Titles]" />` +
    `<input type="text" name="XPATH" expr="&quot;{{XPATH}}&quot;" />` +
    `<input type="flag" name="Click" expr="${click}" /><input type="flag" name="Read" expr="${read}" /><input type="flag" name="Write" expr="${write}" />` +
    `<input type="text" name="Select" expr="${esc(select)}" /><input type="text" name="Text" expr="${esc(text)}" />` +
    `</inputs>` + (outputs.length ? `<outputs><output type="text" name="O_Text" stage="O_Text" /></outputs>` : '') +
    `<onsuccess>${end}</onsuccess><resource object="${OBJ}" action="Dynamic Action" /></stage>`);
  stages.push(`<stage stageid="${end}" name="End" type="End"><subsheetid>${id}</subsheetid><loginhibit onsuccess="true" /><display x="15" y="90" />` +
    (outputs.length ? `<outputs>${outputs.map((n) => `<output type="text" name="${n}" stage="${n}" />`).join('')}</outputs>` : '') + `</stage>`);
  for (const n of [...ins, ...outputs]) {
    stages.push(`<stage stageid="${g()}" name="${n}" type="Data"><subsheetid>${id}</subsheetid><display x="135" y="-15" w="60" h="30" /><datatype>text</datatype><initialvalue xml:space="preserve" /><private /><alwaysinit /></stage>`);
  }
}

page('TPL Click', { flags: ['True', 'False', 'False'] });
page('TPL Set Text', { inputs: ['I_Text'], skip: 'I_Text', flags: ['False', 'False', 'True'], text: '[I_Text]' });
page('TPL Select From List', { inputs: ['I_Select'], skip: 'I_Select', flags: ['False', 'False', 'False'], select: '[I_Select]' });
page('TPL Get Text', { outputs: ['O_Text'], flags: ['False', 'True', 'False'] });

const xml = `<?xml version="1.0" encoding="utf-8"?>
<process name="TPL - Page Object Template" version="1.0" bpversion="7.5.1.0" narrative="" byrefcollection="true" type="object" runmode="Exclusive" preferredid="${g()}">
  <appdef><element name="Application Root"><id>${g()}</id><type>Application</type><basetype>Application</basetype><datatype>unknown</datatype><diagnose>False</diagnose></element></appdef>
  <view><camerax>0</camerax><cameray>0</cameray><zoom version="2">1.25</zoom></view>
  <preconditions />
  <endpoint narrative="" />
  ${subsheets.join('\n  ')}
  ${stages.join('\n  ')}
</process>
`;
fs.writeFileSync(path.join(__dirname, 'template-title.bpobject'), xml);
console.log('template-title.bpobject written');
