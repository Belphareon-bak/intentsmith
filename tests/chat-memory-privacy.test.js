import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdirSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import Database from 'better-sqlite3';

process.env.C3_ENABLE_LIFECYCLE = 'false';
process.env.C3_ENABLE_AGENTS = 'false';
process.env.C3_ENABLE_SKILLS = 'false';
process.env.C3_ENABLE_ONLINE_DISCOVERY = 'false';
process.env.OLLAMA_URL = 'invalid://privacy-regression-no-provider';
const { default: database } = await import('../src/db/database.js');
const { longTermMemory } = await import('../src/memory/long-term.js');
const { chatMemory } = await import('../src/memory/chat-memory.js');
const { updateUserSettings, readChatMemoryPolicy } = await import('../src/db/user-settings.js');
const { preHandle } = await import('../src/chat/handlers/pre-handler.js');
const { ChatController, ChatMode, SessionState, createTaggedResponse } = await import('../src/chat/controller.js');
const { getConversationStore } = await import('../src/chat/conversation-store.js');
longTermMemory.db = database.db;
longTermMemory.init();
const store = getConversationStore(database);
function settings(value) {
  database.db.prepare('INSERT OR REPLACE INTO user_settings (id,data) VALUES (1,?)').run(JSON.stringify(value));
}
function project(name) {
  const path = `${isolatedTestRuntime.projects}/${name}`;
  mkdirSync(path, { recursive: true });
  return Number(database.projects.create.run(name, path, '').lastInsertRowid);
}
const a = project('privacy-A'), b = project('privacy-B');
for (const [id, projectId] of [['privacy:A', a], ['privacy:A2', a], ['privacy:B', b], ['privacy:free1', null], ['privacy:free2', null]]) {
  store.ensureConversation(id, { projectId });
}
const context = id => ({ conversationId: id, sessionId: id,
  sessionState: { lastDecision: { type: 'ANSWER' }, lastIntent: 'CODE', lastUserInput: 'old private input' } });
const count = () => database.db.prepare('SELECT count(*) AS n FROM memory').get().n;
after(() => { ChatController.stopCleanup(); database.close(); });

test('unsupported history opt-out is rejected atomically by the shared writer', () => {
  settings({ retained: 'sentinel' });
  assert.throws(() => updateUserSettings(database.db, d => ({ ...d, memory: { saveHistory: false } })),
    { code: 'CHAT_EPHEMERAL_UNSUPPORTED' });
  assert.deepEqual(JSON.parse(database.db.prepare('SELECT data FROM user_settings').get().data), { retained: 'sentinel' });
  for (const invalid of ['false', null, 0]) {
    assert.throws(() => updateUserSettings(database.db, () => ({ 'c3.memory.ltmEnabled': invalid })),
      { code: 'MEMORY_SETTINGS_INVALID' });
  }
});

test('persisted disabled history blocks a real controller turn before any content persistence', async () => {
  settings({ memory: { saveHistory: false } });
  await assert.rejects(ChatController.handle({ message: 'DO_NOT_PERSIST_PRIVATE_CANARY', sessionId: 'privacy:blocked', conversationId: 'privacy:blocked' }),
    { code: 'CHAT_PRIVACY_UNAVAILABLE' });
  assert.equal(store.getConversation('privacy:blocked'), null);
  assert.equal(database.db.prepare('SELECT count(*) AS n FROM messages WHERE content LIKE ?').get('%DO_NOT_PERSIST_PRIVATE_CANARY%').n, 0);
});

test('Studio rejects disabled history before emitting content to progress observers', async () => {
  settings({ memory: { saveHistory: false } });
  const { createSessionAdapter } = await import('../src/ws-bridge/session-adapter.js');
  const frames = [], observed = [];
  let calls = 0;
  const adapter = createSessionAdapter({
    send: raw => frames.push(JSON.parse(raw)),
    assertChatAllowed: () => ChatController.assertPersistence(),
    handleRequest: () => { calls++; throw new Error('must not execute'); },
    authenticatedSubject: { actorType: 'user', actorId: 'local-operator' },
    observeCoreEvent: event => observed.push(event),
    logger: { info() {}, warn() {}, error() {} },
  });
  try {
    await adapter.processM1Command({ command: { contract: 'ConversationCommand', version: 1,
      requestId: 'privacy:ws:request', conversationId: 'privacy:ws', turnId: 'privacy:ws:turn',
      action: 'send', input: 'PRIVATE_WS_CANARY' },
    context: { editMode: 'ask', agentId: null, projectId: null, attachments: [] } });
    assert.equal(calls, 0);
    assert.match(JSON.stringify(frames), /CHAT_PRIVACY_UNAVAILABLE/);
    assert.doesNotMatch(JSON.stringify([frames, observed]), /PRIVATE_WS_CANARY/);
  } finally { adapter.cleanup(); }
});

test('Studio settings save rejects failed HTTP and reloads persisted values', async () => {
  const source = readFileSync(new URL('../c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js', import.meta.url), 'utf8');
  const start = source.indexOf('var _bCfgSaveVersion=');
  const end = source.indexOf('\nfunction _bVal', start);
  const persisted = { 'c3.memory.ltmEnabled': true };
  const logs = [];
  const sandbox = vm.createContext({ _bCfg: { 'c3.memory.ltmEnabled': false }, _bCfgSaveTimer: null,
    _backendBase: 'http://controlled', AbortSignal, renderCenter() {}, clearTimeout() {},
    setTimeout(fn) { fn(); }, window: { _c3: { agentLog: (_kind, message) => logs.push(message) } },
    fetch: async (_url, options) => options.method === 'POST'
      ? { ok: false, status: 400, json: async () => ({ error: 'Rejected settings' }) }
      : { ok: true, status: 200, json: async () => persisted },
  });
  vm.runInContext(source.slice(start, end), sandbox);
  vm.runInContext('_saveBCfg()', sandbox);
  await sandbox._bCfgSaveChain;
  assert.equal(sandbox._bCfg['c3.memory.ltmEnabled'], true);
  assert.match(sandbox._bCfgError, /nebylo uloženo/);
  assert.match(logs.join('\n'), /Rejected settings/);
});

test('each learning opt-out prevents the real feedback intercept from writing a correction', async () => {
  for (const disabled of [
    { memory: { saveContext: false } }, { 'c3.memory.ltmEnabled': false },
    { 'c3.memory.learningEnabled': false }, { 'c3.memory.feedbackDetection': false },
  ]) {
    settings(disabled);
    const before = count();
    await preHandle('actually I meant MUST_NOT_LEARN', context('privacy:A'), ChatMode.PROJECT);
    assert.equal(count(), before, JSON.stringify(disabled));
  }
});

test('malformed storage fails closed and disabled pattern tracking drops buffered input', () => {
  settings({ 'c3.memory.patternTracking': false });
  assert.equal(chatMemory(context('privacy:A')).patterns, null);
  settings({ memory: { saveContext: false } });
  assert.equal(chatMemory(context('privacy:A')).ltm, null);
  const malformed = new Database(':memory:');
  malformed.exec("CREATE TABLE user_settings (id INTEGER, data TEXT); INSERT INTO user_settings VALUES (1,'[]')");
  assert.equal(readChatMemoryPolicy(malformed).history, false);
  assert.equal(readChatMemoryPolicy(malformed).feedback, false);
  malformed.close();
});

test('real correction is durable only in its project; old unscoped memories stay quarantined', async () => {
  settings({});
  longTermMemory.write({ kind: 'correction', key: 'historical', value: { corrected: 'UNSCOPED_PRIVATE_CANARY' } });
  await preHandle('actually I meant PROJECT_A_PRIVATE_CANARY', context('privacy:A'), ChatMode.PROJECT);
  const rows = database.db.prepare("SELECT user_id,value FROM memory WHERE kind='correction'").all();
  const own = rows.find(r => r.value.includes('PROJECT_A_PRIVATE_CANARY'));
  assert.ok(own);
  assert.deepEqual(JSON.parse(own.value).provenance, { conversationId: 'privacy:A', scope: ['project', a] });
  const reopened = new Database(isolatedTestRuntime.database, { readonly: true });
  assert.equal(reopened.prepare('SELECT value FROM memory WHERE user_id = ?').get(own.user_id).value, own.value);
  reopened.close();

  const observed = [];
  const handler = async (_input, ctx) => {
    const budget = await ctx.buildBudgetedContext('CONVERSATIONAL');
    observed.push({ context: ctx.ltmContext, budget: JSON.stringify(budget) });
    return createTaggedResponse(ctx.ltmContext || 'No project memory', { speaker: 'system', mode: ctx.mode, confidence: 1 });
  };
  ChatController.configure({ handlers: { [ChatMode.CONVERSATION]: handler, [ChatMode.PROJECT]: handler } });
  for (const [id, expected] of [['privacy:A2', true], ['privacy:B', false], ['privacy:free1', false]]) {
    const response = await ChatController.handle({ message: 'show scoped context', sessionId: id, conversationId: id });
    assert.equal(response.response.includes('PROJECT_A_PRIVATE_CANARY'), expected, id);
    const last = observed.at(-1);
    assert.equal(last.context.includes('PROJECT_A_PRIVATE_CANARY'), expected, id);
    assert.equal(last.budget.includes('PROJECT_A_PRIVATE_CANARY'), expected, id);
    assert.equal(JSON.stringify(last).includes('UNSCOPED_PRIVATE_CANARY'), false, id);
  }
  // Caller-supplied project IDs cannot rebind a conversation's memory scope.
  const forged = chatMemory({ conversationId: 'privacy:B', projectId: a });
  assert.equal(JSON.stringify(forged.ltm.queryByKind('correction')).includes('PROJECT_A_PRIVATE_CANARY'), false);
});

test('projectless learning stays in the same conversation and disabling LTM removes context', async () => {
  settings({});
  await preHandle('actually I meant FREE_PRIVATE_CANARY', context('privacy:free1'), ChatMode.CONVERSATION);
  assert.match(JSON.stringify(chatMemory(context('privacy:free1')).ltm.queryByKind('correction')), /FREE_PRIVATE_CANARY/);
  assert.doesNotMatch(JSON.stringify(chatMemory(context('privacy:free2')).ltm.queryByKind('correction')), /FREE_PRIVATE_CANARY/);
  settings({ 'c3.memory.ltmEnabled': false });
  const response = await ChatController.handle({ message: 'no learned memory', sessionId: 'privacy:A2', conversationId: 'privacy:A2' });
  assert.equal(response.response, 'No project memory');
});

test('context opt-out suppresses project working memory in fresh, warm and restored sessions without deleting it', async () => {
  const { projectHandler } = await import('../src/chat/handlers/project.js');
  settings({});
  SessionState.initProjectMemoryDb(database.projectMemory);
  ChatController.configure({ handlers: { [ChatMode.PROJECT]: projectHandler, [ChatMode.CONVERSATION]: projectHandler } });
  const pid = project('working-memory-privacy');
  const fields = { goal: 'SAVED_WORKING_GOAL_CANARY', activeFile: 'SAVED_WORKING_FILE_CANARY', lastArtifactId: 'SAVED_WORKING_ARTIFACT_CANARY' };
  for (const [field, value] of Object.entries(fields)) database.projectMemory.set.run(pid, `wm:${field}`, value, 'working_memory');
  const savedRows = () => database.projectMemory.listByCategory.all(pid, 'working_memory');
  const before = savedRows();
  const ask = id => ChatController.handle({ message: 'Jaký je stav projektu?', sessionId: id, conversationId: id, context: { projectId: pid } });
  const enabled = await ask('privacy:wm:warm');
  for (const value of Object.values(fields)) assert.ok(enabled.response.includes(value), 'positive control uses the actual project handler');
  const storedState = store.loadSessionState('privacy:wm:warm');
  assert.ok(storedState.includes(fields.goal));

  updateUserSettings(database.db, () => ({ memory: { saveContext: false } }));
  for (const id of ['privacy:wm:warm', 'privacy:wm:fresh']) {
    const result = await ask(id);
    assert.doesNotMatch(JSON.stringify(result), /SAVED_WORKING_/, id);
    assert.doesNotMatch(store.loadSessionState(id), /SAVED_WORKING_/, 'serialized session must not carry hidden working memory');
  }
  store.ensureConversation('privacy:wm:restored', { projectId: pid });
  store.saveSessionState('privacy:wm:restored', JSON.stringify({ ...JSON.parse(storedState), sessionId: 'privacy:wm:restored' }));
  assert.doesNotMatch(JSON.stringify(await ask('privacy:wm:restored')), /SAVED_WORKING_/);
  assert.deepEqual(savedRows(), before, 'restoration and opt-out neither rewrite nor delete saved project rows');

  // An explicit goal still guides this live session (including drift checks),
  // but cannot become persisted context while saving context is disabled.
  const live = ChatController.getState('privacy:wm:fresh');
  live.setProjectGoal('EXPLICIT_VOLATILE_GOAL').setActiveFile('EXPLICIT_VOLATILE_FILE').setLastArtifact('EXPLICIT_VOLATILE_ARTIFACT');
  live.incrementDriftCount();
  const explicit = await ask('privacy:wm:fresh');
  assert.match(explicit.response, /EXPLICIT_VOLATILE_GOAL/);
  assert.equal(live.shouldBlockDrift(), true);
  assert.deepEqual(savedRows(), before);
  assert.doesNotMatch(store.loadSessionState('privacy:wm:fresh'), /EXPLICIT_VOLATILE_/);
  const reloaded = SessionState.loadFromStorage('privacy:wm:fresh');
  assert.equal(reloaded.projectGoal, null);
  assert.equal(reloaded.activeFile, null);

  updateUserSettings(database.db, () => ({ memory: { saveContext: true } }));
  const reenabled = await ask('privacy:wm:fresh');
  for (const value of Object.values(fields)) assert.ok(reenabled.response.includes(value));
  assert.doesNotMatch(reenabled.response, /EXPLICIT_VOLATILE_/);
  assert.deepEqual(savedRows(), before);
});

test('shipped Studio handler uses native routes, reports actual outcomes and preserves enabled state', async () => {
  const { AgentRepository, initAgentTables } = await import('../src/agents/repository.js');
  initAgentTables(database.db);
  const { AgentExtensionService } = await import('../src/extensions/agent-extension-service.js');
  const { AgentRunner } = await import('../src/agents/runner.js');
  const { AgentScheduler } = await import('../src/agents/scheduler.js');
  const { createAgentProjectContextBridge } = await import('../src/extensions/agent-project-context.js');
  const { createAgentPlatformRoutes } = await import('../src/routes/agents.js');
  const repository = new AgentRepository(database.db);
  const bridge = createAgentProjectContextBridge({ projects: database.projects });
  const service = new AgentExtensionService({ repository,
    hostCapabilities: { 'code-intel.project-context.v1': bridge.capability } });
  service.discover();
  const logger = { info() {}, warn() {}, error() {} };
  const runner = new AgentRunner({ repository, extensionService: service, projectContextBridge: bridge, logger });
  const scheduler = new AgentScheduler({ repository, runner, logger });
  service.attachScheduler(scheduler);
  service.install('project-health', { instanceId: 'privacy-native', params: { project_id: a }, enabled: false });
  let routeResponse;
  const routes = createAgentPlatformRoutes({ agentExtensionService: service,
    sendJSON: (_res, status, body) => { routeResponse = { status, body }; } });
  const source = readFileSync(new URL('../c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js', import.meta.url), 'utf8');
  const start = source.indexOf('function _detailActionHandler(d,a){');
  const end = source.indexOf('function _assignConvToProject(', start);
  assert.ok(start >= 0 && end > start);
  let calls = [], logs = [], override = null;
  const worker = { id: 'privacy-native', name: 'Scoped agent', native: true };
  const sandbox = vm.createContext({ window: { _c3: { agentLog: (_type, message) => logs.push(message) } },
    WORKERS: [worker], _backendBase: 'http://controlled', AbortSignal,
    fetchBackendData() {}, encodeURIComponent,
    fetch: async (url, options) => {
      const path = new URL(url).pathname;
      calls.push(path);
      const action = path.split('/').at(-1);
      if (!override) await routes[`${options.method} /api/agent-extensions/instances/:agentId/${action}`]({}, {}, { agentId: worker.id });
      const response = override || routeResponse;
      return { ok: response.status >= 200 && response.status < 300, status: response.status, json: async () => response.body };
    },
  });
  vm.runInContext(source.slice(start, end), sandbox);
  const act = async action => {
    logs = []; sandbox.action = action;
    await vm.runInContext('_detailActionHandler({_itemId:"privacy-native",name:"Scoped agent"},action)', sandbox);
    return logs.join('\n');
  };
  assert.match(await act('Spustit'), /nebyl úspěšně dokončen: skipped/);
  assert.match(await act('Povolit'), /Plánování agenta Scoped agent povoleno/);
  assert.match(await act('Spustit'), /Agent Scoped agent dokončil běh/);
  assert.match(await act('Pozastavit'), /Plánování agenta Scoped agent pozastaveno/);
  const reopened = new Database(isolatedTestRuntime.database, { readonly: true });
  assert.equal(reopened.prepare('SELECT enabled FROM agents_v33 WHERE id = ?').get(worker.id).enabled, 0);
  reopened.close();
  for (const response of [{ status: 410, body: { error: 'LEGACY_AGENT_MUTATION_RETIRED' } },
    { status: 200, body: { status: 'error' } }, { status: 200, body: { status: 'partial' } },
    { status: 200, body: {} }]) {
    override = response;
    const log = await act('Spustit');
    assert.match(log, /❌/); assert.doesNotMatch(log, /dokončil běh/);
  }
  override = { status: 200, body: { id: worker.id, enabled: true } };
  assert.match(await act('Pozastavit'), /Server nepotvrdil/);
  worker.native = false;
  const before = calls.length;
  assert.match(await act('Spustit'), /pouze ke čtení/);
  assert.equal(calls.length, before);
  assert.ok(calls.every(path => path.startsWith('/api/agent-extensions/instances/')));
});
