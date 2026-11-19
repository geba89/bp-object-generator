// Builds a mock template object in Blue Prism's object XML shape, for testing
// the generator. Writes test/template.bpobject.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const g = () => crypto.randomUUID();
const APP_ROOT = g();
const OBJ = 'Chrome - Dynamic';

const subsheets = [];
const stages = [];

// Main page (Initialise): stages without <subsheetid>
const initEnd = g();
stages.push(`<stage stageid="${g()}" name="Start" type="Start"><display x="15" y="-105" /><onsuccess>${initEnd}</onsuccess></stage>`);
stages.push(`<stage stageid="${initEnd}" name="End" type="End"><display x="15" y="90" /></stage>`);

// A normal page that must survive untouched (besides new IDs)
function page(name, { inputs = [], outputs = [], action, actionInputs, actionOutputs = [], extra = '', skip = '', guard = '' }) {
  const id = g(), start = g(), act = g(), end = g(), dec = g(), skipEnd = g();
  // skip:  Start -> Decision "[skip] <> ''" -> yes: next, no: a second End stage
  // extra: a stage between Start and the Action (Start -> extra -> Action)
  // guard: Wait For Element (out Found) -> Decision [Found] -> yes: Action, no: Exception
  //        guard = the Exception's detail expression (XML-escaped)
  const extraId = extra ? g() : '';
  const waitId = g(), foundDec = g(), excId = g();
  const afterSkip = guard ? waitId : extra ? extraId : act;
  const first = skip ? dec : afterSkip;
  if (guard) {
    stages.push(`<stage stageid="${waitId}" name="Wait For Element" type="Action"><subsheetid>${id}</subsheetid><loginhibit onsuccess="true" /><display x="15" y="-40" />` +
      `<inputs>${XP}<input type="number" name="Timeout" expr="10" /></inputs><outputs><output type="flag" name="Found" stage="Found" /></outputs>` +
      `<onsuccess>${foundDec}</onsuccess><resource object="${OBJ}" action="Wait For Element" /></stage>`);
    stages.push(`<stage stageid="${foundDec}" name="Found?" type="Decision"><subsheetid>${id}</subsheetid><display x="15" y="-25" w="90" h="60" /><decision expression="[Found]" /><ontrue>${act}</ontrue><onfalse>${excId}</onfalse></stage>`);
    stages.push(`<stage stageid="${excId}" name="Not found" type="Exception"><subsheetid>${id}</subsheetid><display x="135" y="-25" /><exception localized="yes" type="Element Not Found" detail="${guard}" /></stage>`);
    stages.push(`<stage stageid="${g()}" name="Found" type="Data"><subsheetid>${id}</subsheetid><display x="195" y="-15" w="60" h="30" /><datatype>flag</datatype><initialvalue xml:space="preserve">False</initialvalue><private /><alwaysinit /></stage>`);
  }
  subsheets.push(`<subsheet subsheetid="${id}" type="Normal" published="True"><name>${name}</name><view><camerax>0</camerax><cameray>0</cameray><zoom version="2">1.25</zoom></view></subsheet>`);
  stages.push(`<stage stageid="${g()}" name="${name}" type="SubSheetInfo"><subsheetid>${id}</subsheetid>${name.startsWith("TPL ") ? "<narrative>{{LABEL}}</narrative>" : ""}<display x="-195" y="-105" w="150" h="90" /></stage>`);
  stages.push(`<stage stageid="${start}" name="Start" type="Start"><subsheetid>${id}</subsheetid><loginhibit onsuccess="true" /><display x="15" y="-105" />` +
    (inputs.length ? `<inputs>${inputs.map((n) => `<input type="text" name="${n}" narrative="" stage="${n}" />`).join('')}</inputs>` : '') +
    `<onsuccess>${first}</onsuccess></stage>`);
  if (skip) {
    stages.push(`<stage stageid="${dec}" name="${skip} given?" type="Decision"><subsheetid>${id}</subsheetid><loginhibit onsuccess="true" /><display x="15" y="-60" w="90" h="60" /><decision expression="[${skip}] &lt;&gt; &quot;&quot;" /><ontrue>${afterSkip}</ontrue><onfalse>${skipEnd}</onfalse></stage>`);
    stages.push(`<stage stageid="${skipEnd}" name="Skip" type="End"><subsheetid>${id}</subsheetid><loginhibit onsuccess="true" /><display x="135" y="-60" /></stage>`);
  }
  stages.push(`<stage stageid="${act}" name="${action}" type="Action"><subsheetid>${id}</subsheetid><loginhibit onsuccess="true" /><display x="15" y="-15" />` +
    `<inputs>${actionInputs}</inputs>` +
    (actionOutputs.length ? `<outputs>${actionOutputs.map((n) => `<output type="text" name="${n}" stage="${n}" />`).join('')}</outputs>` : '') +
    `<onsuccess>${end}</onsuccess><resource object="${OBJ}" action="${action}" /></stage>`);
  stages.push(`<stage stageid="${end}" name="End" type="End"><subsheetid>${id}</subsheetid><loginhibit onsuccess="true" /><display x="15" y="90" />` +
    (outputs.length ? `<outputs>${outputs.map((n) => `<output type="text" name="${n}" stage="${n}" />`).join('')}</outputs>` : '') + `</stage>`);
  // Data items for every parameter (hidden from other pages)
  for (const n of [...new Set([...inputs, ...outputs])]) {
    stages.push(`<stage stageid="${g()}" name="${n}" type="Data"><subsheetid>${id}</subsheetid><display x="135" y="-15" w="60" h="30" /><datatype>text</datatype><initialvalue xml:space="preserve" /><private /><alwaysinit /></stage>`);
  }
  if (extra) stages.push(extra.replace(/__PAGE__/g, id).replace(/__ID__/g, extraId).replace(/__NEXT__/g, act));
}

const XP = '<input type="text" name="XPath" expr="&quot;{{XPATH}}&quot;" />';

subsheets.push(`<subsheet subsheetid="${g()}" type="CleanUp" published="True"><name>Clean Up</name><view><camerax>0</camerax><cameray>0</cameray><zoom version="2">1.25</zoom></view></subsheet>`);
page('Attach', { inputs: ['Window Title'], action: 'Attach', actionInputs: '<input type="text" name="Window Title" expr="[Window Title]" />' });
page('TPL Click', { action: 'Click', actionInputs: XP });
page('TPL Click (Row)', { inputs: ['Row Key'], action: 'Click', actionInputs: XP });
page('TPL Set Text', {
  inputs: ['Value'], skip: 'Value',
  // Exception detail: "Cannot find field '{{LABEL}}' to set value " & [Value]
  guard: '&quot;Cannot find field &apos;{{LABEL}}&apos; to set value &quot; &amp; [Value]',
  action: 'Write Text', actionInputs: XP + '<input type="text" name="Value" expr="[Value]" />' });
page('TPL Select From List', { inputs: ['Item Text'], skip: 'Item Text', action: 'Select From List', actionInputs: XP + '<input type="text" name="Item Text" expr="[Item Text]" />' });
page('TPL Set Checkbox', { inputs: ['Checked'], action: 'Set Checkbox', actionInputs: XP + '<input type="flag" name="Checked" expr="[Checked]" />' });
page('TPL Select Radio', { inputs: ['Option'], skip: 'Option', action: 'Select Radio Option', actionInputs: XP });
page('TPL Get Text', {
  outputs: ['Value'], action: 'Read Text', actionInputs: XP, actionOutputs: ['Value'],
  // A stage pointing at an Application Modeller element, to test cross-references
  extra: `<stage stageid="__ID__" name="Activate" type="Navigate"><subsheetid>__PAGE__</subsheetid><display x="15" y="-60" /><step><element id="${APP_ROOT}" /><action><id>Activate</id></action></step><onsuccess>__NEXT__</onsuccess></stage>`,
});
page('TPL Read Table', { outputs: ['Table'], action: 'Read Table', actionInputs: XP, actionOutputs: ['Table'] });

const xml = `<?xml version="1.0" encoding="utf-8"?>
<process name="TPL - Page Object Template" version="1.0" bpversion="7.5.1.0" narrative="" byrefcollection="true" type="object" runmode="Exclusive" preferredid="${g()}">
  <appdef>
    <element name="Application Root"><id>${APP_ROOT}</id><type>Application</type><basetype>Application</basetype><datatype>unknown</datatype><diagnose>False</diagnose></element>
  </appdef>
  <view><camerax>0</camerax><cameray>0</cameray><zoom version="2">1.25</zoom></view>
  <preconditions />
  <endpoint narrative="" />
  ${subsheets.join('\n  ')}
  ${stages.join('\n  ')}
</process>
`;
fs.writeFileSync(path.join(__dirname, 'template.bpobject'), xml);
console.log('template.bpobject written:', subsheets.length, 'pages,', stages.length, 'stages');
