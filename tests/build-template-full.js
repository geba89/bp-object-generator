// Full-feature mock template (the user-style): I_Title/I_Titles on every step page, one dynamic
// action, plus TPL Set Password, TPL XPaths (model data item), TPL Check Element (Missing),
// a Block named {{FIELD}} and an exception detail with placeholders.
// Writes test/template-full.bpobject.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const g = () => crypto.randomUUID();
const OBJ = 'Chrome - Dynamic Actions';
const subsheets = [], stages = [];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sub = (id, name, published = 'True') => subsheets.push(`<subsheet subsheetid="${id}" type="Normal" published="${published}"><name>${name}</name><view><camerax>0</camerax><cameray>0</cameray><zoom version="2">1.25</zoom></view></subsheet>`);
const data = (id, name, type = 'text', hidden = true, value = '') =>
  `<stage stageid="${g()}" name="${name}" type="Data"><subsheetid>${id}</subsheetid><display x="135" y="-15" w="60" h="30" /><datatype>${type}</datatype><initialvalue xml:space="preserve">${value}</initialvalue>${hidden ? '<private />' : ''}<alwaysinit /></stage>`;

const initEnd = g();
stages.push(`<stage stageid="${g()}" name="Start" type="Start"><display x="15" y="-105" /><onsuccess>${initEnd}</onsuccess></stage>`);
stages.push(`<stage stageid="${initEnd}" name="End" type="End"><display x="15" y="90" /></stage>`);
subsheets.push(`<subsheet subsheetid="${g()}" type="CleanUp" published="True"><name>Clean Up</name><view><camerax>0</camerax><cameray>0</cameray><zoom version="2">1.25</zoom></view></subsheet>`);

// Step page: Start(I_Title, I_Titles, ...) -> [skip] -> Dynamic Action -> End; wrapped in a Block {{FIELD}}
function page(name, { inputs = [], outputs = [], flags, select = '""', text = '""', skip = '', inputType = 'text', guard = false }) {
  const id = g(), start = g(), act = g(), end = g(), dec = g(), skipEnd = g(), exc = g(), okDec = g();
  const ins = ['I_Title', 'I_Titles', ...inputs];
  sub(id, name);
  stages.push(`<stage stageid="${g()}" name="${name}" type="SubSheetInfo"><subsheetid>${id}</subsheetid><narrative></narrative><display x="-195" y="-105" w="150" h="90" /></stage>`);
  stages.push(`<stage stageid="${start}" name="Start" type="Start"><subsheetid>${id}</subsheetid><loginhibit onsuccess="true" /><display x="15" y="-105" /><inputs>` +
    ins.map((n) => `<input type="${n.startsWith('I_Title') ? 'text' : inputType}" name="${n}" narrative="" stage="${n}" />`).join('') + `</inputs><onsuccess>${skip ? dec : act}</onsuccess></stage>`);
  stages.push(`<stage stageid="${g()}" name="{{FIELD}}" type="Block"><subsheetid>${id}</subsheetid><display x="-45" y="-75" w="270" h="150" /><font family="Segoe UI" size="10" style="Regular" color="7FB2E5" /></stage>`);
  if (skip) {
    stages.push(`<stage stageid="${dec}" name="${skip} given?" type="Decision"><subsheetid>${id}</subsheetid><display x="15" y="-60" w="90" h="60" /><decision expression="${esc(`[${skip}] <> ""`)}" /><ontrue>${act}</ontrue><onfalse>${skipEnd}</onfalse></stage>`);
    stages.push(`<stage stageid="${skipEnd}" name="Skip" type="End"><subsheetid>${id}</subsheetid><display x="135" y="-60" /></stage>`);
  }
  const [click, read, write] = flags;
  stages.push(`<stage stageid="${act}" name="Dynamic Action" type="Action"><subsheetid>${id}</subsheetid><loginhibit onsuccess="true" /><display x="15" y="-15" /><inputs>` +
    `<input type="number" name="Attempts" expr="3" /><input type="text" name="Page title" expr="[I_Title]" /><input type="text" name="Page titles" expr="[I_Titles]" />` +
    `<input type="text" name="XPATH" expr="&quot;{{XPATH}}&quot;" />` +
    `<input type="flag" name="Click" expr="${click}" /><input type="flag" name="Read" expr="${read}" /><input type="flag" name="Write" expr="${write}" />` +
    `<input type="text" name="Select" expr="${esc(select)}" /><input type="text" name="Text" expr="${esc(text)}" /></inputs>` +
    (outputs.length ? `<outputs><output type="text" name="O_Text" stage="O_Text" /></outputs>` : '') +
    `<onsuccess>${guard ? okDec : end}</onsuccess><resource object="${OBJ}" action="Dynamic Action" /></stage>`);
  if (guard) {
    // After writing: verify by flag; on failure throw with full context
    stages.push(`<stage stageid="${okDec}" name="Written?" type="Decision"><subsheetid>${id}</subsheetid><display x="15" y="30" w="90" h="60" /><decision expression="[Done]" /><ontrue>${end}</ontrue><onfalse>${exc}</onfalse></stage>`);
    stages.push(`<stage stageid="${exc}" name="Failed" type="Exception"><subsheetid>${id}</subsheetid><display x="135" y="30" /><exception localized="yes" type="Element Not Found" detail="${esc(`"{{ACTION}} / {{FIELD}}: cannot set '{{LABEL}}' (XPath: {{XPATH}}), value " & [${inputs[0]}]`)}" /></stage>`);
    stages.push(data(id, 'Done', 'flag', true, 'True'));
  }
  stages.push(`<stage stageid="${end}" name="End" type="End"><subsheetid>${id}</subsheetid><loginhibit onsuccess="true" /><display x="15" y="90" />` +
    (outputs.length ? `<outputs>${outputs.map((n) => `<output type="text" name="${n}" narrative="" stage="${n}" />`).join('')}</outputs>` : '') + `</stage>`);
  for (const n of [...ins, ...outputs]) stages.push(data(id, n, n === 'I_Password' ? 'password' : 'text'));
}

page('TPL Click', { flags: ['True', 'False', 'False'] });
page('TPL Click (Row)', { inputs: ['Row Key'], flags: ['True', 'False', 'False'] });
page('TPL Set Text', { inputs: ['I_Text'], skip: 'I_Text', flags: ['False', 'False', 'True'], text: '[I_Text]', guard: true });
page('TPL Set Password', { inputs: ['I_Password'], skip: 'I_Password', flags: ['False', 'False', 'True'], text: '[I_Password]', inputType: 'password' });
page('TPL Select From List', { inputs: ['I_Select'], skip: 'I_Select', flags: ['False', 'False', 'False'], select: '[I_Select]' });
page('TPL Get Text', { outputs: ['O_Text'], flags: ['False', 'True', 'False'] });

// TPL XPaths: one VISIBLE data item as the model for "XP ..." items
{
  const id = g(), start = g(), end = g();
  sub(id, 'TPL XPaths', 'False');
  stages.push(`<stage stageid="${g()}" name="TPL XPaths" type="SubSheetInfo"><subsheetid>${id}</subsheetid><narrative></narrative><display x="-195" y="-105" w="150" h="90" /></stage>`);
  stages.push(`<stage stageid="${start}" name="Start" type="Start"><subsheetid>${id}</subsheetid><display x="15" y="-105" /><onsuccess>${end}</onsuccess></stage>`);
  stages.push(`<stage stageid="${end}" name="End" type="End"><subsheetid>${id}</subsheetid><display x="15" y="-45" /></stage>`);
  stages.push(`<stage stageid="${g()}" name="XP Sample" type="Data"><subsheetid>${id}</subsheetid><narrative>model</narrative><display x="300" y="-105" w="60" h="30" /><datatype>text</datatype><initialvalue xml:space="preserve">//sample</initialvalue></stage>`);
}

// TPL Check Element: Start(I_Title, I_Titles) -> Read with Attempts 1 -> Found? -> no: Missing &= "{{LABEL}}; " -> End(Missing)
{
  const id = g(), start = g(), act = g(), dec = g(), calc = g(), end = g();
  sub(id, 'TPL Check Element');
  stages.push(`<stage stageid="${g()}" name="TPL Check Element" type="SubSheetInfo"><subsheetid>${id}</subsheetid><narrative>{{DESCRIPTION}}</narrative><display x="-195" y="-105" w="150" h="90" /></stage>`);
  stages.push(`<stage stageid="${start}" name="Start" type="Start"><subsheetid>${id}</subsheetid><display x="15" y="-105" /><inputs><input type="text" name="I_Title" narrative="" stage="I_Title" /><input type="text" name="I_Titles" narrative="" stage="I_Titles" /></inputs><onsuccess>${act}</onsuccess></stage>`);
  stages.push(`<stage stageid="${act}" name="Exists?" type="Action"><subsheetid>${id}</subsheetid><display x="15" y="-45" /><inputs><input type="number" name="Attempts" expr="1" /><input type="text" name="Page title" expr="[I_Title]" /><input type="text" name="Page titles" expr="[I_Titles]" /><input type="text" name="XPATH" expr="&quot;{{XPATH}}&quot;" /></inputs><outputs><output type="flag" name="Found" stage="Found" /></outputs><onsuccess>${dec}</onsuccess><resource object="${OBJ}" action="Element Exists" /></stage>`);
  stages.push(`<stage stageid="${dec}" name="Found?" type="Decision"><subsheetid>${id}</subsheetid><display x="15" y="0" w="90" h="60" /><decision expression="[Found]" /><ontrue>${end}</ontrue><onfalse>${calc}</onfalse></stage>`);
  stages.push(`<stage stageid="${calc}" name="Add to Missing" type="Calculation"><subsheetid>${id}</subsheetid><display x="135" y="0" /><calculation expression="${esc('[Missing] & "{{LABEL}}; "')}" stage="Missing" /><onsuccess>${end}</onsuccess></stage>`);
  stages.push(`<stage stageid="${end}" name="End" type="End"><subsheetid>${id}</subsheetid><display x="15" y="60" /><outputs><output type="text" name="Missing" narrative="" stage="Missing" /></outputs></stage>`);
  for (const n of ['I_Title', 'I_Titles', 'Missing']) stages.push(data(id, n));
  stages.push(data(id, 'Found', 'flag'));
}

const xml = `<?xml version="1.0" encoding="utf-8"?>
<process name="TPL - Page Object Template" version="1.0" bpversion="7.5.1.0" narrative="Template" byrefcollection="true" type="object" runmode="Exclusive" preferredid="${g()}">
  <appdef><element name="Application Root"><id>${g()}</id><type>Application</type><basetype>Application</basetype><datatype>unknown</datatype><diagnose>False</diagnose></element></appdef>
  <view><camerax>0</camerax><cameray>0</cameray><zoom version="2">1.25</zoom></view>
  <preconditions />
  <endpoint narrative="" />
  ${subsheets.join('\n  ')}
  ${stages.join('\n  ')}
</process>
`;
fs.writeFileSync(path.join(__dirname, 'template-full.bpobject'), xml);
console.log('template-full.bpobject written');
