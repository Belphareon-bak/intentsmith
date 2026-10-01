#!/usr/bin/env node

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertVatAnswer, assertVatCapturedTurn,
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
  ['contradictory VAT rate', 'Sazba DPH je 12 %.'],
  ['contradictory year', 'Platí pro rok 2024.'],
  ['foreign jurisdiction', 'Pro Slovensko.'],
  ['foreign jurisdiction in a Czech inflection', 'Platí na Slovensku.'],
  ['another foreign jurisdiction', 'Platí v Německu.'],
  ['foreign -ie jurisdiction in a Czech inflection', 'Platí ve Francii.'],
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

test('captured VAT oracle binds one completed model turn to tool result and M1 bytes', () => {
  const model = 'fixture:vat';
  const digest = 'a'.repeat(64);
  const tool = { ...VAT_RESULT, assumptions: ['Vstupní částka = základ daně'] };
  const result = { status: 'ok', response: { content: valid,
    metadata: { expertise: { id: 'accountant' }, executionStatus: 'SUCCESS',
      specialistTool: 'accountant.vat_calculator', extractedParams: VAT_PARAMS,
      toolResults: [{ type: 'accountant.vat_calculator', data: tool }],
      finishReason: 'stop' } } };
  const row = { schemaVersion: 1, method: 'POST', path: '/api/chat', status: 200,
    model, stream: false, think: false, numCtx: 4096, numPredict: 1024,
    promptEvalCount: 300, requestSha256: 'b'.repeat(64), responseSha256: 'c'.repeat(64),
    done: true, doneReason: 'stop', messages: [{ role: 'system', content: 'Účetní' },
      { role: 'user', content: `User asked: "${VAT_INPUT}"\n\nTool execution results:\n${JSON.stringify(tool)}\n\nBased on these results, provide your expert analysis and response.` }],
    terminal: { model, digest, done: true, done_reason: 'stop',
      prompt_eval_count: 300, message: { role: 'assistant', content: valid } } };
  assert.deepEqual(assertVatCapturedTurn(row, result, { model, digest }).toolResult, tool);
  for (const [label, mutate] of [
    ['incomplete provider', r => { r.doneReason = 'length'; }],
    ['foreign model', r => { r.terminal.model = 'other'; }],
    ['provider text mismatch', r => { r.terminal.message.content = 'Other answer'; }],
    ['missing tool prompt', r => { r.messages.at(-1).content = VAT_INPUT; }],
    ['incorrect structured VAT', (_r, m1) => { m1.response.metadata.toolResults[0].data.vat = 2000; }],
  ]) {
    const changedRow = structuredClone(row);
    const changedResult = structuredClone(result);
    mutate(changedRow, changedResult);
    assert.throws(() => assertVatCapturedTurn(changedRow, changedResult,
      { model, digest }), undefined, label);
  }
});
