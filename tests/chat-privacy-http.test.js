import { isolatedTestRuntime as r } from './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { request } from 'node:http';

process.env.C3_ENABLE_AGENTS = 'false';
process.env.C3_ENABLE_LIFECYCLE = 'false';
process.env.C3_ENABLE_ONLINE_DISCOVERY = 'false';
const { default: database } = await import('../src/db/database.js');
const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', TZ: 'UTC',
  HOME: r.home, XDG_CONFIG_HOME: r.xdgConfig, XDG_CACHE_HOME: r.xdgCache,
  XDG_DATA_HOME: r.xdgData, XDG_STATE_HOME: r.xdgState, TMPDIR: r.temp,
  TMP: r.temp, TEMP: r.temp, NODE_ENV: 'test', CI: '1',
  DOTENV_CONFIG_PATH: `${r.runtime}/absent-env`, C3_HOST: '127.0.0.1',
  C3_PORT: '0', C3_PORT_FILE: r.portFile, C3_DB_PATH: r.database,
  C3_PROJECTS_DIR: r.projects, C3_ENABLE_AGENTS: 'false', C3_ENABLE_EXPERTISES: 'false',
  C3_ENABLE_LIFECYCLE: 'false', C3_ENABLE_COMFYUI: 'false', C3_ENABLE_AUTONOMY: 'false',
  C3_ENABLE_SKILLS: 'false', C3_ENABLE_TELEMETRY: 'false', C3_ENABLE_ONLINE_DISCOVERY: 'false',
  C3_MODEL_UNIVERSE_ENABLED: 'false', C3_LIFECYCLE_AUTO_COMMIT: 'false', C3_UPDATE_REPO: '',
  C3_LOG_LEVEL: 'warn', OLLAMA_URL: 'invalid://privacy-no-provider',
  INTENTSMITH_TEST_SERVER_NONCE: 'privacy-review-isolated-server-20260917-0001' };
let child, identity, output = '';
function api(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const raw = body === undefined ? null : JSON.stringify(body);
    const q = request({ host: '127.0.0.1', port: identity.port, path: pathname, method,
      headers: { 'X-IntentSmith-Local-Capability': identity.localCapability,
        ...(raw ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) } : {}) } }, s => {
      let result = ''; s.on('data', c => { result += c; });
      s.on('end', () => { try { resolve({ status: s.statusCode, body: JSON.parse(result) }); } catch (e) { reject(e); } });
    });
    q.setTimeout(15000, () => q.destroy(new Error('request timeout'))); q.on('error', reject); q.end(raw);
  });
}
async function start() {
  identity = null;
  child = spawn(process.execPath, ['src/server.js'], { cwd: r.repositoryRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', c => { output += c; }); child.stderr.on('data', c => { output += c; });
  for (let i = 0; i < 1200; i++) {
    assert.equal(child.exitCode, null, 'server must stay alive');
    if (existsSync(r.portFile)) {
      try { const port = JSON.parse(readFileSync(r.portFile, 'utf8')); if (port.pid === child.pid) { identity = port; return; } } catch {}
    }
    await delay(25);
  }
  throw new Error('readiness timeout');
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  for (let i = 0; i < 600 && child.exitCode === null; i++) await delay(25);
  if (child.exitCode === null) { child.kill('SIGKILL'); throw new Error('server failed graceful shutdown'); }
  assert.equal(child.exitCode, 0);
}
const command = id => ({ contract: 'ConversationCommand', version: 1, requestId: `${id}:request`,
  conversationId: id, turnId: `${id}:turn`, action: 'send', input: 'kolik je 17 * 23?' });

test('real HTTP settings/chat reject unsupported privacy, preserve existing opt-out, and survive a process restart', { timeout: 90000 }, async () => {
  try {
    await start();
    const rejected = await api('POST', '/api/settings', { memory: { saveHistory: false } });
    assert.equal(rejected.status, 400); assert.equal(rejected.body.code, 'CHAT_EPHEMERAL_UNSUPPORTED');
    const rejectedImport = await api('POST', '/api/settings/import', { version: 1, settings: { memory: { saveHistory: false } } });
    assert.equal(rejectedImport.status, 400); assert.equal(rejectedImport.body.code, 'CHAT_EPHEMERAL_UNSUPPORTED');
    const disabled = { memory: { saveContext: false }, 'c3.memory.ltmEnabled': false,
      'c3.memory.learningEnabled': false, 'c3.memory.feedbackDetection': false, 'c3.memory.patternTracking': false };
    assert.equal((await api('POST', '/api/settings', disabled)).status, 200);
    const chat = await api('POST', '/api/chat', command('privacy:http:normal'));
    assert.equal(chat.status, 200); assert.equal(chat.body.status, 'ok');
    assert.match(chat.body.response.content, /391/);
    const messages = await api('GET', '/api/conversations/privacy:http:normal/messages');
    assert.equal(messages.body.messages.length, 2); // honest durable history, no ephemeral claim
    const firstPid = child.pid;
    await stop(); await start();
    assert.notEqual(child.pid, firstPid);
    assert.deepEqual((await api('GET', '/api/settings')).body, disabled);
    assert.equal((await api('GET', '/api/conversations/privacy:http:normal/messages')).body.messages.length, 2);

    // Represent the old release's already-persisted opt-out, without allowing
    // the new writer to claim it can create a private conversation mode.
    database.db.prepare('UPDATE user_settings SET data = ? WHERE id = 1').run(JSON.stringify({ memory: { saveHistory: false } }));
    const blocked = await api('POST', '/api/chat', { ...command('privacy:http:blocked'), input: 'PRIVATE_HTTP_CANARY' });
    assert.equal(blocked.status, 409); assert.equal(blocked.body.error.code, 'CHAT_PRIVACY_UNAVAILABLE');
    assert.equal(database.db.prepare('SELECT count(*) AS n FROM conversations WHERE id = ?').get('privacy:http:blocked').n, 0);
    assert.equal(database.db.prepare('SELECT count(*) AS n FROM messages WHERE content LIKE ?').get('%PRIVATE_HTTP_CANARY%').n, 0);
    assert.equal((await api('GET', '/api/settings')).body.memory.saveHistory, false);
    await stop(); await start();
    assert.equal((await api('POST', '/api/chat', command('privacy:http:blocked:restart'))).status, 409);
    assert.equal((await api('POST', '/api/settings', { memory: { saveHistory: true } })).status, 200);
    assert.equal((await api('POST', '/api/chat', command('privacy:http:recovered'))).body.status, 'ok');
  } finally {
    await stop();
    writeFileSync(`${r.artifacts}/privacy-http-server.log`, output);
    database.close();
  }
});
