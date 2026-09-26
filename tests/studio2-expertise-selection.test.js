import './helpers/isolated-test-db.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ExpertiseSelectionClient } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/expertise-selection-client.js');
const { SessionStore } = require('../intentsmith-ide/extensions/intentsmith-studio2/lib/browser/session-store.js');
const { default: database } = await import('../src/db/database.js');
const { expertiseRegistry } = await import('../src/expertises/expertise-layer.js');
const { readConversationSelection, writeConversationSelection } = await import('../src/expertises/conversation-selection.js');
const { ChatController, ChatMode, TaggedResponse, ResponseTag, ResponseSpeaker } = await import('../src/chat/controller.js');
const { resetConversationStore } = await import('../src/chat/conversation-store.js');

test('durable expertise selection checks revision, registry, compatibility and exact readback', () => {
  const id = 'studio-selection-' + Date.now();
  const initial = readConversationSelection(database, id);
  const selected = writeConversationSelection(database, expertiseRegistry, id, {
    expectedRevision: initial.revision, expertises: [
      { id: 'developer', weight: 0.7 }, { id: 'analyst', weight: 0.3 },
    ], confirmCompatibility: true,
  });
  assert.deepEqual(selected.expertises, [{ id: 'developer', weight: 0.7 }, { id: 'analyst', weight: 0.3 }]);
  assert.deepEqual(readConversationSelection(database, id).expertises, selected.expertises);
  assert.notEqual(selected.revision, initial.revision);
  assert.throws(() => writeConversationSelection(database, expertiseRegistry, id, {
    expectedRevision: initial.revision, expertises: [],
  }), { code: 'EXPERTISE_REVISION_CONFLICT' });
  assert.throws(() => writeConversationSelection(database, expertiseRegistry, id, {
    expectedRevision: selected.revision, expertises: [{ id: 'developer', weight: 0.5 },
      { id: 'developer', weight: 0.5 }],
  }), { code: 'EXPERTISE_SELECTION_INVALID' });
  assert.throws(() => writeConversationSelection(database, expertiseRegistry, id, {
    expectedRevision: selected.revision, expertises: [{ id: 'unknown-expertise', weight: 0.5 }],
  }), { code: 'EXPERTISE_NOT_FOUND' });
  assert.throws(() => writeConversationSelection(database, expertiseRegistry, id, {
    expectedRevision: selected.revision, expertises: [
      { id: 'dnd_master', weight: 0.5 }, { id: 'lawyer', weight: 0.5 },
    ], confirmCompatibility: true,
  }), { code: 'EXPERTISE_INCOMPATIBLE' });
  assert.deepEqual(readConversationSelection(database, id), {
    conversationId: id, expertises: selected.expertises, revision: selected.revision,
  });
});

test('M1 conversation turn resolves the durable combination before calling the expertise handler', async () => {
  resetConversationStore();
  const id = 'studio-m1-expertise-' + Date.now();
  const initial = readConversationSelection(database, id);
  writeConversationSelection(database, expertiseRegistry, id, { expectedRevision: initial.revision,
    expertises: [{ id: 'developer', weight: 0.6 }, { id: 'analyst', weight: 0.4 }],
    confirmCompatibility: true });
  const observed = [];
  ChatController.configure({ handlers: {
    [ChatMode.EXPERTISE]: async (_input, context) => {
      observed.push({ mode: context.expertise?.id,
        ids: context.activeExpertises?.map(item => [item.id, item.weight]) });
      return new TaggedResponse({ content: 'Verified selection', tag: new ResponseTag({
        speaker: ResponseSpeaker.SYSTEM, mode: ChatMode.EXPERTISE, confidence: 1,
        metadata: { semanticScore: { total: 100 }, decision: { intent: 'LOCAL' } },
      }) });
    },
  }, config: { autoModeDetection: false } });
  const result = await ChatController.handle({ message: 'Použij obě expertýzy.',
    sessionId: 'm1-studio-transport', conversationId: id,
    context: { m2LifecycleOnly: true } });
  assert.equal(result.response, 'Verified selection');
  assert.deepEqual(observed, [{ mode: 'developer', ids: [['developer', 0.6], ['analyst', 0.4]] }]);
});

test('Studio waits for durable readback and never repeats an uncertain expertise effect', async () => {
  const memory = new Map();
  const store = new SessionStore({ getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value) });
  const session = store.focusedSession();
  const items = [{ id: 'developer', name: 'Vývojář' }, { id: 'analyst', name: 'Analytik' }];
  const catalog = { backendUrl: () => 'http://127.0.0.1:3335',
    view: () => ({ items }) };
  let rows = [], writes = 0, loseResponse = true;
  const rev = value => createHash('sha256').update(JSON.stringify(value.map(row => [row.id, row.weight]))).digest('hex');
  const client = new ExpertiseSelectionClient({ store, catalog, onChange: () => {},
    confirmAction: () => { assert.equal(session.chat._selectingExpertise, true); return true; },
    fetchImpl: async (url, options = {}) => {
      const conversationId = new URL(url).pathname.split('/')[3];
      if (options.method === 'PUT') {
        writes++;
        const body = JSON.parse(options.body);
        assert.equal(body.expectedRevision, rev(rows));
        rows = body.expertises;
        if (loseResponse) { loseResponse = false; throw Error('response lost'); }
      }
      if (new URL(url).pathname === '/api/merge-preview') {
        return { ok: true, json: async () => ({ activeExpertises: rows.map(row => row.id).concat('analyst'),
          promptPreview: 'Ověřený náhled' }) };
      }
      return { ok: true, json: async () => ({ conversationId, expertises: rows, revision: rev(rows) }) };
    } });
  assert.equal(await client.change(session, 'single', 'developer'), true);
  assert.equal(writes, 1, 'a lost response is resolved by readback, not by a second PUT');
  assert.match(session._convId, /^studio-/);
  assert.equal(session.chat.expertise, 'Vývojář');
  assert.equal(session.chat._selectingExpertise, false);
  assert.deepEqual(client.entry(session).expertises, [{ id: 'developer', weight: 0.5 }]);
  assert.equal(await client.change(session, 'add', 'analyst'), true);
  assert.equal(writes, 2);
  assert.deepEqual(client.entry(session).expertises, [
    { id: 'developer', weight: 0.5 }, { id: 'analyst', weight: 0.5 },
  ]);
  assert.equal(session.chat.expertise, 'Vývojář + Analytik');
});
