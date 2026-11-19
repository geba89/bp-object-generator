// Template without any skip Decisions (the generator must add them), with read-back pages.
// Every page: Start(I_Title, I_Titles, ...) -> Dynamic Action -> End.
// TPL Verify Text / Select: Start(I_Title, I_Titles, I_Expected) -> Read -> [Actual] = [I_Expected]?
//   yes -> End, no -> Exception with {{ACTION}} / {{FIELD}}.
// Writes test/template-verify.bpobject.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const g = () => crypto.randomUUID();
const OBJ = 'Chrome - Dynamic Actions';
const subsheets = [], stages = [];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sub = (id, name) => subsheets.push(`<subsheet subsheetid="${id}" type="Normal" published="True"><name>${name}</name><view><camerax>0</camerax><cameray>0</cameray><zoom version="2">1.25</zoom></view></subsheet>`);
const data = (id, name, type = 'text') => `<stage stageid="${g()}" name="${name}" type="Data"><subsheetid>${id}</subsheetid><display x="135" y="-15" w="60" h="30" /><datatype>${type}</datatype><initialvalue xml:space="preserve" /><private /><alwaysinit /></stage>`;
const action = (id, sid, name, flags, extra, next, outputs = '') =>
  `<stage stageid="${sid}" name="${name}" type="Action"><subsheetid>${id}</subsheetid><loginhibit onsuccess="true" /><display x="15" y="-15" /><inputs>` +
  `<input type="number" name="Attempts" expr="3" /><input type="text" name="Page title" expr="[I_Title]" /><input type="text" name="Page titles" expr="[I_Titles]" />` +
  `<input type="text" name="XPATH" expr="&quot;{{XPATH}}&quot;" />` +
  `<input type="flag" name="Click" expr="${flags[0]}" /><input type="flag" name="Read" expr="${flags[1]}" /><input type="flag" name="Write" expr="${flags[2]}" />${extra}</inputs>${outputs}` +
  `<onsuccess>${next}</onsuccess><resource object="${OBJ}" action="Dynamic Action" /></stage>`;

const initEnd = g();
stages.push(`<stage stageid="${g()}" name="Start" type="Start"><display x="15" y="-105" /><onsuccess>${initEnd}</onsuccess></stage>`);
stages.push(`<stage stageid="${initEnd}" name="End" type="End"><display x="15" y="90" /></stage>`);

function page(name, { inputs = [], outputs = [], flags, extra = '', inputType = 'text' }) {
  const id = g(), start = g(), act = g(), end = g();
  const ins = ['I_Title', 'I_Titles', ...inputs];
  sub(id, name);
  stages.push(`<stage stageid="${g()}" name="${name}" type="SubSheetInfo"><subsheetid>${id}</subsheetid><narrative></narrative><display x="-195" y="-105" w="150" h="90" /></stage>`);
  stages.push(`<stage stageid="${start}" name="Start" type="Start"><subsheetid>${id}</subsheetid><display x="15" y="-105" /><inputs>` +
    ins.map((n) => `<input type="${n.startsWith('I_Title') ? 'text' : inputType}" name="${n}" narrative="" stage="${n}" />`).join('') + `</inputs><onsuccess>${act}</onsuccess></stage>`);
  stages.push(action(id, act, 'Dynamic Action', flags, extra, end, outputs.length ? '<outputs><output type="text" name="O_Text" stage="O_Text" /></outputs>' : ''));
  stages.push(`<stage stageid="${end}" name="End" type="End"><subsheetid>${id}</subsheetid><display x="15" y="90" />` +
    (outputs.length ? `<outputs>${outputs.map((n) => `<output type="text" name="${n}" narrative="" stage="${n}" />`).join('')}</outputs>` : '') + `</stage>`);
  for (const n of [...ins, ...outputs]) stages.push(data(id, n, inputType === 'flag' && !n.startsWith('I_Title') ? 'flag' : 'text'));
}

function verify(name) {
  const id = g(), start = g(), act = g(), dec = g(), exc = g(), end = g();
  sub(id, name);
  stages.push(`<stage stageid="${g()}" name="${name}" type="SubSheetInfo"><subsheetid>${id}</subsheetid><narrative></narrative><display x="-195" y="-105" w="150" h="90" /></stage>`);
  stages.push(`<stage stageid="${start}" name="Start" type="Start"><subsheetid>${id}</subsheetid><display x="15" y="-105" /><inputs>` +
    ['I_Title', 'I_Titles', 'I_Expected'].map((n) => `<input type="text" name="${n}" narrative="" stage="${n}" />`).join('') + `</inputs><onsuccess>${act}</onsuccess></stage>`);
  stages.push(action(id, act, 'Read back', ['False', 'True', 'False'], '', dec, '<outputs><output type="text" name="O_Text" stage="Actual" /></outputs>'));
  stages.push(`<stage stageid="${dec}" name="As expected?" type="Decision"><subsheetid>${id}</subsheetid><display x="15" y="30" w="90" h="60" /><decision expression="${esc('[Actual] = [I_Expected]')}" /><ontrue>${end}</ontrue><onfalse>${exc}</onfalse></stage>`);
  stages.push(`<stage stageid="${exc}" name="Wrong value" type="Exception"><subsheetid>${id}</subsheetid><display x="135" y="30" /><exception localized="yes" type="Field Check Failed" detail="${esc('"field shows """ & [Actual] & """, expected """ & [I_Expected] & """"')}" /></stage>`);
  stages.push(`<stage stageid="${end}" name="End" type="End"><subsheetid>${id}</subsheetid><display x="15" y="90" /></stage>`);
  for (const n of ['I_Title', 'I_Titles', 'I_Expected', 'Actual']) stages.push(data(id, n));
}

subsheets.push(`<subsheet subsheetid="${g()}" type="CleanUp" published="True"><name>Clean Up</name><view><camerax>0</camerax><cameray>0</cameray><zoom version="2">1.25</zoom></view></subsheet>`);
page('TPL Click', { flags: ['True', 'False', 'False'] });
page('TPL Set Text', { inputs: ['I_Text'], flags: ['False', 'False', 'True'], extra: '<input type="text" name="Text" expr="[I_Text]" />' });
page('TPL Select From List', { inputs: ['I_Select'], flags: ['False', 'False', 'False'], extra: '<input type="text" name="Select" expr="[I_Select]" />' });
page('TPL Set Checkbox', { inputs: ['I_Checked'], inputType: 'flag', flags: ['True', 'False', 'False'] });
page('TPL Get Text', { outputs: ['O_Text'], flags: ['False', 'True', 'False'] });
verify('TPL Verify Text');
verify('TPL Verify Select');

// TPL Error Handler: Recover -> Exception with context, data item Current Step
{
  const id = g(), start = g(), end = g(), rec = g(), exc = g();
  sub(id, 'TPL Error Handler');
  stages.push(`<stage stageid="${g()}" name="TPL Error Handler" type="SubSheetInfo"><subsheetid>${id}</subsheetid><narrative></narrative><display x="-195" y="-105" w="150" h="90" /></stage>`);
  stages.push(`<stage stageid="${start}" name="Start" type="Start"><subsheetid>${id}</subsheetid><display x="15" y="-105" /><onsuccess>${end}</onsuccess></stage>`);
  stages.push(`<stage stageid="${end}" name="End" type="End"><subsheetid>${id}</subsheetid><display x="15" y="-45" /></stage>`);
  stages.push(`<stage stageid="${rec}" name="Recover" type="Recover"><subsheetid>${id}</subsheetid><display x="15" y="60" /><onsuccess>${exc}</onsuccess></stage>`);
  stages.push(`<stage stageid="${exc}" name="Rethrow with context" type="Exception"><subsheetid>${id}</subsheetid><display x="15" y="120" /><exception localized="yes" type="System Exception" detail="${esc('"{{ACTION}} / " & [Current Step] & ": " & ExceptionDetail()')}" /></stage>`);
  stages.push(data(id, 'Current Step'));
}

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
fs.writeFileSync(path.join(__dirname, 'template-verify.bpobject'), xml);
console.log('template-verify.bpobject written');
