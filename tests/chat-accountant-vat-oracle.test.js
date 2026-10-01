#!/usr/bin/env node

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertVatAnswer, assertVatDeterministicTurn,
  VAT_INPUT, VAT_PARAMS, VAT_RESULT } from './helpers/chat-accountant-vat-oracle.js';

const valid = [
  'ČR, rok 2025: základ 10 000 Kč, DPH 21 % je 2 100 Kč, cena s DPH je 12 100 Kč.',
  '### Předpoklady',
  '- Vstupní částka je základ daně; použita sazba 21 %.',
  '### Nezahrnuje',
  '- Individuální okolnosti konkrétního plnění.',
  '*Toto je informativní přehled, nikoli závazná daňová rada. Pro konkrétní daňové rozhodnutí konzultujte daňového poradce.*',
].join('\n');

test('bounded VAT answer oracle accepts only exact amounts and required limits', () => {
  assertVatAnswer(valid);
  assertVatAnswer(valid.replace('ČR, rok 2025', 'V Česku, rok 2025'));
  assertVatAnswer(valid.replaceAll('Kč', 'korun').replaceAll('21 %', '21 procent'));
  assertVatAnswer(valid.replace('### Předpoklady', '**Předpoklady**:')
    .replace('### Nezahrnuje', '**Nezahrnuje**:'));
  for (const [label, mutated] of [
    ['VAT amount', valid.replace('2 100 Kč', '2 200 Kč')],
    ['total amount', valid.replace('12 100 Kč', '12 200 Kč')],
    ['base amount', valid.replace('10 000 Kč', '11 000 Kč')],
    ['rate', valid.replaceAll('21 %', '12 %')],
    ['year', valid.replace('2025', '2024')],
    ['jurisdiction', valid.replace('ČR', 'Slovensko')],
    ['assumptions', valid.replace('Předpoklady', 'Poznámky')],
    ['exclusions', valid.replace('Nezahrnuje', 'Obsahuje')],
    ['disclaimer', valid.replace('konzultujte daňového poradce', 'pokračujte bez konzultace')],
    ['empty assumption list', valid.replace('- Vstupní částka je základ daně; použita sazba 21 %.', '')],
    ['late advice after disclaimer', `${valid}\nTento výsledek je závazný.`],
    ['contradictory VAT amount', valid.replace('### Předpoklady',
      'DPH je 2 200 Kč.\n### Předpoklady')],
  ]) {
    assert.throws(() => assertVatAnswer(mutated), undefined, label);
  }
});

test('VAT oracle accepts the tool supplied act number and bold section headings', () => {
  const withToolCitation = valid
    .replace('ČR, rok 2025:',
      'ČR, rok 2025 podle zákona č. 235/2004 Sb.:')
    .replace('### Předpoklady', '**Předpoklady:**')
    .replace('### Nezahrnuje', '**Nezahrnuje:**');
  assertVatAnswer(withToolCitation);
  assert.throws(() => assertVatAnswer(withToolCitation.replace('235/2004', '235/2005')),
    /every explicit four-digit year must be 2025|unknown Arabic numeral/u);
  assert.throws(() => assertVatAnswer(withToolCitation.replace('235/2004', '325/2004')),
    /every explicit four-digit year must be 2025|unknown Arabic numeral/u);
  assert.throws(() => assertVatAnswer(
    `DPH podle zákona č. 235/2004 Sb. neplatí.\n${withToolCitation}`),
  /explicitly negated VAT or Czech applicability/u);
});

test('VAT label remains bound to its amount across the exact tool citation', () => {
  const inlineCitation = valid.replace('DPH 21 % je 2 100 Kč',
    'DPH 21 % podle zákona č. 235/2004 Sb. činí 2 100 Kč');
  assertVatAnswer(inlineCitation);
  assert.throws(() => assertVatAnswer(inlineCitation.replace('2 100 Kč', '2 200 Kč')),
    /vat must uniquely map to 2100 CZK/u);
  assert.throws(() => assertVatAnswer(inlineCitation.replace('235/2004', '235/2005')));
});

test('VAT oracle checks the observed model table layout without flattening its labels', () => {
  const modelTable = [
    'Pro zdaňovací období rok 2025 v České republice platí výpočet podle zákona č. 235/2004 Sb.:',
    '| Položka | Částka (CZK) |',
    '| :--- | :--- |',
    '| Základ daně | 10 000 Kč |',
    '| DPH (sazba 21 %) | 2 100 Kč |',
    '| Cena s DPH celkem | 12 100 Kč |',
    '**Předpoklady:**',
    '* Sazba DPH: 21 % (zákon č. 235/2004 Sb.)',
    '* Rok: 2025',
    '* Vstupní částka = základ daně (bez DPH)',
    '**Nezahrnuje:**',
    '* Daňové přiznání nebo fakturační lhůty pro konkrétní subjekt.',
    '*Toto je informativní přehled, nikoli závazná daňová rada. Pro konkrétní daňové rozhodnutí konzultujte daňového poradce.*',
  ].join('\n');
  assertVatAnswer(modelTable);
  for (const [label, changed] of [
    ['base', modelTable.replace('10 000 Kč', '10 100 Kč')],
    ['vat', modelTable.replace('2 100 Kč', '2 200 Kč')],
    ['total', modelTable.replace('12 100 Kč', '12 200 Kč')],
    ['rate', modelTable.replace('21 %)', '12 %)')],
    ['period', modelTable.replace('rok 2025', 'rok 2024')],
    ['legal reference', modelTable.replace('235/2004', '236/2004')],
    ['invented paragraph', modelTable.replace('* Sazba DPH: 21 %',
      '* Sazba DPH: 21 % (§ 38)')],
    ['missing closing advice', modelTable.replace(' konzultujte daňového poradce.', '.')],
  ]) assert.throws(() => assertVatAnswer(changed), undefined, label);
});

test('VAT label rejects two monetary amounts in one sentence', () => {
  const contradictory = valid.replace('DPH 21 % je 2 100 Kč',
    'DPH 21 % je 2 100 Kč i 2 200 Kč');
  assert.throws(() => assertVatAnswer(contradictory),
    /vat has ambiguous or contradictory monetary figures in one span/u);
});

test('base and VAT labels reject swapped amounts in one clause', () => {
  const swapped = valid.replace('základ 10 000 Kč, DPH 21 % je 2 100 Kč',
    'základ 2 100 Kč a DPH 21 % je 10 000 Kč');
  assert.throws(() => assertVatAnswer(swapped),
    /base must uniquely map to 10000 CZK in the final answer/u);
});

test('VAT label rejects a contradictory monetary claim under assumptions', () => {
  const contradictory = valid.replace('### Předpoklady',
    '### Předpoklady\n- DPH je 2 200 Kč.');
  assert.throws(() => assertVatAnswer(contradictory),
    /vat must uniquely map to 2100 CZK in the final answer/u);
});

test('total label rejects a contradictory monetary claim under exclusions', () => {
  const contradictory = valid.replace('### Nezahrnuje',
    '### Nezahrnuje\n- Celkem je 12 200 Kč.');
  assert.throws(() => assertVatAnswer(contradictory),
    /total must uniquely map to 12100 CZK in the final answer/u);
});

for (const [name, statement] of [
  ['unlabeled VAT amount', 'Výsledná daň je 2 200 Kč.'],
  ['unlabeled payable amount', 'Zaplatíte 2 200 Kč.'],
  ['word-form VAT amount', 'DPH je 2 200 korun.'],
  ['contradictory VAT rate', 'Sazba DPH je 12 %.'],
  ['word-form VAT rate', 'Sazba DPH je 12 procent.'],
  ['contradictory year', 'Platí pro rok 2024.'],
  ['foreign jurisdiction', 'Pro Slovensko.'],
  ['foreign ISO jurisdiction', 'Platí pro SK.'],
  ['unknown Arabic numeral', 'Výsledná daň je 12.'],
  ['foreign jurisdiction in a Czech inflection', 'Platí na Slovensku.'],
  ['another foreign jurisdiction', 'Platí v Německu.'],
  ['foreign -ie jurisdiction in a Czech inflection', 'Platí ve Francii.'],
  ['negative VAT amount', 'DPH je -2 100 Kč.'],
  ['negative VAT rate', 'DPH -21 %.'],
  ['negated VAT amount', 'DPH není 2 100 Kč.'],
  ['negated Czech applicability', 'Pro ČR tato sazba neplatí.'],
]) {
  test(`VAT answer rejects ${name} before the valid text`, () => {
    assert.throws(() => assertVatAnswer(`${statement}\n${valid}`));
  });
  test(`VAT answer rejects ${name} in assumptions`, () => {
    const contradictory = valid.replace('### Předpoklady',
      `### Předpoklady\n- ${statement}`);
    assert.throws(() => assertVatAnswer(contradictory));
  });
}

test('deterministic VAT oracle binds public tool scalars and final M1 text', () => {
  const result = { status: 'ok', response: { content: valid,
    metadata: { expertise: { id: 'accountant' }, executionStatus: 'SUCCESS',
      specialistTool: 'accountant.vat_calculator', extractedParams: VAT_PARAMS,
      toolResults: [{ type: 'accountant.vat_calculator', data: VAT_RESULT }],
      deterministicPresentation: true } } };
  assert.deepEqual(assertVatDeterministicTurn(result).toolResult, VAT_RESULT);
  for (const [label, mutate] of [
    ['incorrect structured VAT', m1 => { m1.response.metadata.toolResults[0].data.vat = 2000; }],
    ['wrong extracted rate', m1 => { m1.response.metadata.extractedParams.rate = '12'; }],
    ['missing execution status', m1 => { delete m1.response.metadata.executionStatus; }],
    ['missing deterministic marker', m1 => { delete m1.response.metadata.deterministicPresentation; }],
    ['claimed model evidence', m1 => { m1.response.metadata.model = 'fixture:vat'; }],
    ['unbounded raw field', m1 => { m1.response.metadata.toolResults[0].data.input = VAT_INPUT; }],
    ['incorrect final text', m1 => { m1.response.content = valid.replace('2 100 Kč', '2 200 Kč'); }],
  ]) {
    const changedResult = structuredClone(result);
    mutate(changedResult);
    assert.throws(() => assertVatDeterministicTurn(changedResult), undefined, label);
  }
});
