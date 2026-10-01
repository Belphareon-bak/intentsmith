// Shared bounded oracle for one approved Czech VAT input. It is intentionally
// narrower than a general tax-advice evaluator.
import assert from 'node:assert/strict';

export const VAT_INPUT = 'K základu daně 10 000 Kč přidej DPH 21 % za rok 2025. Uveď přesně základ, DPH a cenu s DPH pro ČR.';
export const VAT_PARAMS = Object.freeze({ amount: 10000, year: 2025,
  rate: '21', direction: 'add' });
export const VAT_RESULT = Object.freeze({ base: 10000, vat: 2100,
  total: 12100, rate_percent: 21, direction: 'add', year: 2025 });
export const VAT_DISCLAIMER = 'Toto je informativní přehled, nikoli závazná daňová rada. Pro konkrétní daňové rozhodnutí konzultujte daňového poradce.';

export function assertVatToolAndPrompt(result, providerBody, model) {
  assert.equal(result.status, 'ok');
  const metadata = result.response?.metadata;
  assert.equal(metadata?.expertise?.id, 'accountant');
  assert.equal(metadata?.executionStatus, 'SUCCESS');
  assert.equal(metadata?.specialistTool, 'accountant.vat_calculator');
  assert.deepEqual(metadata?.extractedParams, VAT_PARAMS);
  assert.equal(metadata?.toolResults?.length, 1);
  assert.equal(metadata.toolResults[0].type, 'accountant.vat_calculator');
  const vat = metadata.toolResults[0].data;
  assert.deepEqual(Object.fromEntries(Object.keys(VAT_RESULT).map(key => [key, vat?.[key]])),
    VAT_RESULT);
  assert.equal(metadata.finishReason, 'stop');

  assert.equal(providerBody.model, model);
  assert.equal(providerBody.stream, false);
  assert.equal(providerBody.think, false);
  const finalUser = providerBody.messages?.at(-1);
  assert.equal(finalUser?.role, 'user');
  assert(finalUser.content.includes(VAT_INPUT), 'exact current VAT input missing from provider prompt');
  const match = /Tool execution results:\n(\{[\s\S]*?\})\n\nBased on these results/u.exec(finalUser.content);
  assert(match, 'structured VAT result missing from final provider prompt');
  assert.deepEqual(JSON.parse(match[1]), vat,
    'provider must see the exact structured M1 VAT tool result');
  return vat;
}

const MONEY = /(\d{1,3}(?:[ .\u00a0\u202f]\d{3})+|\d+)(?:[,.](\d{1,2}))?\s*(?:Kč|CZK)/giu;
function moneyValues(clause) {
  return [...clause.matchAll(MONEY)].map(match =>
    Number(match[1].replace(/[ .\u00a0\u202f]/gu, '')
      + (match[2] ? `.${match[2]}` : '')));
}

const LABELS = /(?<total>cena s DPH|celková cena|částka s DPH|celkem)|(?<base>základ(?: daně)?|cena bez DPH)|(?<vat>daň z přidané hodnoty|(?<!s )(?<!bez )\bDPH\b)/giu;
function assertExactLabeledAmounts(resultText) {
  const labels = [...resultText.matchAll(LABELS)];
  const expected = { base: VAT_RESULT.base, vat: VAT_RESULT.vat,
    total: VAT_RESULT.total };
  const observed = { base: [], vat: [], total: [] };
  for (const [index, label] of labels.entries()) {
    const role = Object.keys(expected).find(key => label.groups[key] !== undefined);
    const next = labels[index + 1]?.index ?? resultText.length;
    const amounts = moneyValues(resultText.slice(label.index + label[0].length, next));
    if (amounts.length === 0) continue;
    assert.equal(amounts.length, 1,
      `${role} has ambiguous or contradictory monetary figures in one span`);
    observed[role].push(amounts[0]);
  }
  for (const [role, amount] of Object.entries(expected)) {
    assert(observed[role].length > 0 && observed[role].every(value => value === amount),
      `${role} must uniquely map to ${amount} CZK in the final answer`);
  }
}

function assertListedSection(lines, title) {
  const heading = new RegExp(`^[ \\t]*(?:#{1,6}[ \\t]*|\\*\\*)?${title}(?:\\*\\*)?[ \\t]*:?[ \\t]*$`, 'iu');
  const index = lines.findIndex(line => heading.test(line));
  assert(index >= 0, `${title} section missing`);
  const next = lines.slice(index + 1).find(line => line.trim().length > 0);
  assert(/^\s*(?:[-*]|\d+[.)])\s+\S/u.test(next || ''),
    `${title} needs a listed limitation`);
}

export function assertVatAnswer(answer) {
  assert.equal(typeof answer, 'string');
  const normalized = answer.normalize('NFKC').replace(/[\u00a0\u202f]/gu, ' ');
  assert(/(?:^|[^\p{L}])(?:ČR|Česká republika)(?=$|[^\p{L}])/iu.test(normalized),
    'Czech jurisdiction missing');
  assert(/\b2025\b/u.test(normalized), 'tax year 2025 missing');
  assert(/\b21\s*%/u.test(normalized), 'VAT rate 21 % missing');
  const assumptions = normalized.indexOf('Předpoklady');
  const resultText = assumptions >= 0 ? normalized.slice(0, assumptions) : normalized;
  assertExactLabeledAmounts(resultText);
  const lines = normalized.split(/\r?\n/u);
  assertListedSection(lines, 'Předpoklady');
  assertListedSection(lines, 'Nezahrnuje');
  const conclusion = normalized.trim().replace(/\*+$/u, '').trimEnd();
  assert(conclusion.endsWith(VAT_DISCLAIMER),
    'mandatory accountant disclaimer must close the answer');
  return { base: VAT_RESULT.base, vat: VAT_RESULT.vat,
    total: VAT_RESULT.total, rate: 21, year: 2025 };
}

export function assertVatCapturedTurn(row, result, { model, digest }) {
  assert.equal(row?.schemaVersion, 1);
  assert.equal(row.method, 'POST');
  assert.equal(row.path, '/api/chat');
  assert.equal(row.status, 200);
  assert.equal(row.model, model);
  assert.equal(row.terminal?.model, model);
  if (row.terminal?.digest) assert.equal(row.terminal.digest, digest);
  if (row.terminal?.model_digest_sha256) {
    assert.equal(row.terminal.model_digest_sha256, digest);
  }
  assert.equal(row.done, true);
  assert.equal(row.terminal?.done, true);
  assert.equal(row.doneReason, 'stop');
  assert.equal(row.terminal?.done_reason, 'stop');
  assert(Number.isSafeInteger(row.promptEvalCount) && row.promptEvalCount > 0);
  assert.equal(row.promptEvalCount, row.terminal?.prompt_eval_count);
  assert(Number.isSafeInteger(row.numCtx) && row.numCtx >= 512 && row.numCtx <= 4096);
  assert(Number.isSafeInteger(row.numPredict)
    && row.numPredict > 0 && row.numPredict <= row.numCtx);
  assert.match(row.requestSha256, /^[a-f0-9]{64}$/u);
  assert.match(row.responseSha256, /^[a-f0-9]{64}$/u);
  assert.equal(row.terminal?.message?.content, result.response?.content,
    'final M1 answer must equal captured provider terminal bytes');
  const vat = assertVatToolAndPrompt(result, row, model);
  const answer = assertVatAnswer(result.response.content);
  return { ...answer, toolResult: vat };
}
