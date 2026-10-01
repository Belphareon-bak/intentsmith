import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { createOwnedJourneyRuntime, expectJson, startProduct, stopProduct } from
  './helpers/chat-project-expertise-model-journey.js';
import { startVatIntentProvider, vatPlan } from './helpers/vat-intent-provider.js';
import { isolatedTestRuntime as runtime } from './helpers/isolated-test-db.js';

const MODEL = 'fixture:vat-semantic';
const base = 'Spočti DPH z 10000 Kč bez DPH za rok 2025 při sazbě 21 %';
const cases = [
  { label: 'brief formatting', input: `${base} a napiš výsledek stručně`, style: 'concise',
    parts: [{ text: base, kind: 'calculation' }, { text: ' a napiš výsledek stručně', kind: 'format' }] },
  { label: 'numeric layout preference', input: `${base} a použij 2 odrážky`, style: 'bullets', itemCount: 2,
    parts: [{ text: base, kind: 'calculation' }, { text: ' a použij 2 odrážky', kind: 'format' }] },
  { label: 'negated formatting', input: `${base}, nepoužívej tabulku`, style: 'concise',
    parts: [{ text: base, kind: 'calculation' }, { text: ', nepoužívej tabulku', kind: 'format' }] },
  { label: 'quoted negation is data', input: `Text „nepočítej DPH“ ignoruj. ${base}`, style: 'table',
    parts: [{ text: 'Text ', kind: 'context' }, { text: '„nepočítej DPH“', kind: 'quote' },
      { text: ' ignoruj. ', kind: 'context' }, { text: base, kind: 'calculation' }] },
  { label: 'arithmetic explanation', input: `${base} a vysvětli výpočet`, style: 'explanation',
    parts: [{ text: base, kind: 'calculation' }, { text: ' a vysvětli výpočet', kind: 'format' }] },
  { label: 'politeness', input: `Prosím ${base.toLowerCase()}, díky`, style: 'concise',
    parts: [{ text: 'Prosím ', kind: 'politeness' }, { text: base.toLowerCase(), kind: 'calculation' },
      { text: ', díky', kind: 'politeness' }] },
  { label: 'denied calculation', input: `Neprováděj výpočet DPH z 10000 Kč bez DPH při sazbě 21 % za rok 2025`,
    parts: null, kind: 'negated_calculation', needsInput: true },
  { label: 'conflicting direction', input: `${base}, ale částka už obsahuje DPH`,
    plan: { action: 'clarify', clarification: 'direction' }, needsInput: true },
  { label: 'unsupported extra tax', input: `${base} a také daň z příjmu`,
    parts: [{ text: base, kind: 'calculation' }, { text: ' a také daň z příjmu', kind: 'unsupported' }], needsInput: true },
  { label: 'changed monetary value', input: base, plan: { amount: 10001 }, needsInput: true },
  { label: 'changed rate', input: `${base}.`, plan: { rate: '12' }, needsInput: true },
  { label: 'changed explicit year', input: `${base}!`, plan: { year: 2024 }, needsInput: true },
  { label: 'reversed net operand', input: `${base} .`, plan: { direction: 'remove' }, needsInput: true },
  { label: 'hidden alternative rate in a format span', input: `${base} nebo 12 %`,
    parts: [{ text: base, kind: 'calculation' }, { text: ' nebo 12 %', kind: 'format' }], needsInput: true },
  { label: 'format label cannot hide an alternative bare monetary operand', input: `${base} nebo 20000`,
    parts: [{ text: base, kind: 'calculation' }, { text: ' nebo 20000', kind: 'format' }], needsInput: true },
  { label: 'format and politeness splitting cannot hide an alternative rate', input: `${base} nebo 12 % `,
    parts: [{ text: base, kind: 'calculation' }, { text: ' nebo 12 ', kind: 'format' },
      { text: '% ', kind: 'politeness' }], needsInput: true },
  { label: 'splitting money from currency cannot hide a second operand', input: `${base} a 20000 Kč`,
    parts: [{ text: base, kind: 'calculation' }, { text: ' a 20000 ', kind: 'format' },
      { text: 'Kč', kind: 'politeness' }], needsInput: true },
  { label: 'splitting a tax year cannot hide an explicit alternative year', input: `${base} nebo rok 2030`,
    parts: [{ text: base, kind: 'calculation' }, { text: ' nebo rok ', kind: 'format' },
      { text: '2030', kind: 'politeness' }], needsInput: true },
  { label: 'money cannot become an exempt layout count', input: `${base} nebo 2 Kč odrážky`,
    plan: { presentation: { style: 'bullets', itemCount: 2, itemCountSource: '2 Kč odrážky' } },
    parts: [{ text: base, kind: 'calculation' }, { text: ' nebo 2 Kč odrážky', kind: 'format' }], needsInput: true },
  { label: 'fabricated quote scope', input: `${base}, nepočítej`,
    parts: [{ text: base, kind: 'calculation' }, { text: ', nepočítej', kind: 'quote' }], needsInput: true },
  { label: 'discarded second clause', input: `${base}; nepočítej ho`,
    parts: [{ text: base, kind: 'calculation' }], needsInput: true },
  { label: 'untrusted tool authority', input: `${base}?`, plan: { tool: 'fs.write' }, needsInput: true },
  { label: 'malformed model plan', input: `${base} prosím.`, raw: '{invalid', needsInput: true },
  { label: 'provider failure has no numerical fallback', input: `${base} prosím!`, raw: { fixtureHttpError: true }, failure: true },
  { label: 'truncated plan has no numerical fallback', input: `${base} prosím?`,
    raw: { fixtureReplyContent: '{}', fixtureFinishReason: 'length' }, failure: true },
];

test('natural VAT formatting uses a typed semantic plan and verified arithmetic through M1/SQLite', {
  timeout: 180_000,
}, async t => {
  const plans = new Map(cases.map(item => [item.input, item.raw ?? vatPlan(item.input, {
    presentation: { style: item.style || 'table', itemCount: item.itemCount || null,
      itemCountSource: item.itemCount ? `${item.itemCount} odrážky` : null },
    segments: item.parts || [{ text: item.input, kind: item.kind || 'calculation' }],
    ...item.plan,
  })]));
  const provider = await startVatIntentProvider(MODEL, plans);
  const owned = createOwnedJourneyRuntime(runtime);
  let product = null;
  t.after(async () => { if (product) await stopProduct(product); await provider.close(); });
  product = await startProduct(owned, provider.url, MODEL);
  for (const item of cases) {
    await t.test(item.label, async () => {
      const created = await expectJson(product, 'POST', '/api/conversations', {
        title: `vat-semantic-${randomBytes(5).toString('hex')}`, mode: 'chat',
      }, 201);
      const conversationId = created.conversation.id;
      await expectJson(product, 'POST', '/api/chat/specialist',
        { specialistId: 'accountant-cz', sessionId: conversationId }, 200);
      const baseline = provider.requests.length;
      const result = await expectJson(product, 'POST', '/api/chat', {
        contract: 'ConversationCommand', version: 1, action: 'send', conversationId,
        requestId: `vat-${randomBytes(8).toString('hex')}`, turnId: `vat-turn-${randomBytes(8).toString('hex')}`,
        input: item.input,
      }, 200);
      const metadata = result.response.metadata;
      assert.equal(metadata.specialistTool, 'accountant.vat_calculator', JSON.stringify(result));
      const interpretations = provider.requests.slice(baseline).filter(request => request.task);
      if (item.needsInput || item.failure) {
        assert.equal(metadata.executionStatus, item.failure ? 'FAILED' : 'NEEDS_INPUT', JSON.stringify(result));
        assert.equal(metadata.toolResults, undefined, 'unverified plan must not calculate');
        assert.equal(metadata.deterministicPresentation, undefined);
      } else {
        assert.equal(metadata.executionStatus, 'SUCCESS', JSON.stringify(result));
        assert.equal(metadata.deterministicPresentation, true);
        assert.deepEqual(metadata.extractedParams,
          { amount: 10000, rate: '21', year: 2025, direction: 'add' });
        assert.deepEqual(metadata.toolResults, [{ type: 'accountant.vat_calculator', data: {
          base: 10000, vat: 2100, total: 12100, rate_percent: 21, direction: 'add', year: 2025,
        } }]);
        if (item.style === 'concise') assert(!result.response.content.includes('| Položka |'));
        if (item.style === 'explanation') assert(result.response.content.includes('DPH = základ × 21 / 100'));
        if (item.itemCount) assert.equal(result.response.content.split('\n').filter(line => line.startsWith('- ')).length, item.itemCount);
      }
      assert.equal(interpretations.length, 1, 'one explicit inference, no generated numerical wrapper');
      assert.equal(interpretations[0].task.currentInput, item.input);
      assert.equal(provider.requests.slice(baseline).filter(request => request.path === '/api/chat').length, 1);
      assert.equal(metadata.approvalRequired, undefined);
      assert.equal(result.response.toolRequests, undefined);
      const expected = [{ role: 'user', content: item.input },
        { role: 'assistant', content: result.response.content }];
      const history = await expectJson(product, 'GET', `/api/conversations/${conversationId}/messages`, null, 200);
      assert.deepEqual(history.messages.map(({ role, content }) => ({ role, content })), expected);
      const db = new Database(owned.database, { readonly: true });
      try {
        assert.deepEqual(db.prepare('SELECT role, content FROM messages WHERE conversation_id=? ORDER BY id').all(conversationId), expected);
        assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tool_v1_requests WHERE conversation_id=?').get(conversationId).count, 0);
      } finally { db.close(); }
    });
  }
  await t.test('meaning interpreter receives durable preceding turns after restart', async () => {
    const input = `${base} a napiš výsledek stručně`;
    const created = await expectJson(product, 'POST', '/api/conversations', {
      title: 'vat-semantic-durable-context', mode: 'chat',
    }, 201);
    const conversationId = created.conversation.id;
    await expectJson(product, 'POST', '/api/chat/specialist',
      { specialistId: 'accountant-cz', sessionId: conversationId }, 200);
    const send = () => expectJson(product, 'POST', '/api/chat', {
      contract: 'ConversationCommand', version: 1, action: 'send', conversationId,
      requestId: `vat-${randomBytes(8).toString('hex')}`, turnId: `vat-turn-${randomBytes(8).toString('hex')}`, input,
    }, 200);
    const first = await send();
    assert.equal(first.response.metadata.executionStatus, 'SUCCESS');
    await stopProduct(product);
    product = await startProduct(owned, provider.url, MODEL);
    const baseline = provider.requests.length;
    const second = await send();
    assert.equal(second.response.metadata.executionStatus, 'SUCCESS');
    const interpretation = provider.requests.slice(baseline).find(request => request.task)?.task;
    assert(interpretation.history.some(turn => turn.role === 'user' && turn.content === input));
    assert(interpretation.history.some(turn => turn.role === 'assistant'
      && turn.content === first.response.content.slice(0, 500)));
  });
});
