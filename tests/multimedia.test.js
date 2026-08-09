// v130: Multimedia Generator Tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, assertThrows, assertIncludes, summary } from './harness.js';
import { sanitizePrompt, validateParams, getTemplate, substituteParams, validateWorkflow, getDefaultParams } from '../src/media/workflow-templates.js';
import { MediaModelDiscovery } from '../src/media/model-discovery.js';
import { VRAMManager } from '../src/media/vram-manager.js';
import {
  createVramArtifactUsePort,
  MODEL_ACTIVITY_OWNER,
  ModelUseAuthority,
} from '../src/upgrade/model-use-authority.js';
import { MediaOutputStorage } from '../src/media/output-storage.js';
import { createMediaRoutes, recoverStuckGenerations } from '../src/routes/media.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';

// ── Helper: mock broadcast to prevent WS errors in tests ─────────────────────

// Patch broadcast before VRAMManager tries to use it
const _origImport = await import('../src/ws-bridge/ws-server.js').catch(() => null);
// VRAMManager imports broadcast — if ws-server isn't running, we need to handle it

// ── Helper: setup test DB ────────────────────────────────────────────────────

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_generations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('txt2img','img2img','txt2vid')),
      prompt TEXT NOT NULL,
      negative_prompt TEXT DEFAULT '',
      params TEXT NOT NULL,
      workflow_template TEXT,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','cancelled')),
      comfyui_prompt_id TEXT,
      outputs TEXT,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      duration_ms INTEGER,
      favorite INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_mg_status ON media_generations(status);
    CREATE INDEX IF NOT EXISTS idx_mg_created ON media_generations(created_at);
    CREATE INDEX IF NOT EXISTS idx_mg_favorite ON media_generations(favorite);
  `);
  return db;
}

function insertGen(db, overrides = {}) {
  const defaults = {
    id: 'gen-test-' + Math.random().toString(36).slice(2, 8),
    type: 'txt2img',
    prompt: 'test prompt',
    negative_prompt: '',
    params: '{}',
    status: 'completed',
    favorite: 0,
  };
  const row = { ...defaults, ...overrides };
  db.prepare(`
    INSERT INTO media_generations (id, type, prompt, negative_prompt, params, status, favorite)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.type, row.prompt, row.negative_prompt, row.params, row.status, row.favorite);
  return row;
}

function createTestVramManager(options = {}) {
  const authority = new ModelUseAuthority();
  return new VRAMManager({
    ...options,
    artifactUsePort: createVramArtifactUsePort({ authority }),
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Suite 1: Workflow Templates
// ═════════════════════════════════════════════════════════════════════════════

suite('Workflow Templates');

test('getTemplate returns deep copy', () => {
  const t1 = getTemplate('txt2img');
  const t2 = getTemplate('txt2img');
  assert(t1 !== t2, 'should be different objects');
  t1['1'].inputs.ckpt_name = 'modified';
  assert(t2['1'].inputs.ckpt_name !== 'modified', 'modification should not affect original');
});

test('getTemplate throws for unknown type', () => {
  assertThrows(() => getTemplate('unknown'));
});

test('substituteParams replaces all placeholders', () => {
  const template = getTemplate('txt2img');
  const wf = substituteParams(template, {
    prompt: 'a cat',
    negative_prompt: 'ugly',
    width: 512,
    height: 512,
    steps: 10,
    cfg_scale: 7,
    seed: 42,
    sampler: 'euler',
    scheduler: 'normal',
    denoise: 1.0,
    model: 'test.safetensors',
  });
  // Check prompt was substituted
  assertEqual(wf['2'].inputs.text, 'a cat');
  assertEqual(wf['3'].inputs.text, 'ugly');
  // Check numeric values
  assertEqual(wf['4'].inputs.width, 512);
  assertEqual(wf['4'].inputs.height, 512);
  assertEqual(wf['5'].inputs.steps, 10);
  assertEqual(wf['5'].inputs.cfg, 7);
  assertEqual(wf['5'].inputs.seed, 42);
});

test('substituteParams handles seed -1 as random', () => {
  const template = getTemplate('txt2img');
  const wf = substituteParams(template, {
    prompt: 'test', negative_prompt: '', width: 512, height: 512,
    steps: 10, cfg_scale: 7, seed: -1, sampler: 'euler', scheduler: 'normal',
    denoise: 1.0, model: 'test.safetensors',
  });
  assert(typeof wf['5'].inputs.seed === 'number', 'seed should be numeric');
  assert(wf['5'].inputs.seed >= 0, 'random seed should be >= 0');
});

test('getDefaultParams returns correct defaults per type', () => {
  const img = getDefaultParams('txt2img');
  assertEqual(img.width, 1024);
  assertEqual(img.height, 1024);
  assertEqual(img.steps, 20);

  const vid = getDefaultParams('txt2vid');
  assertEqual(vid.width, 848);
  assertEqual(vid.frames, 49);
});

test('getDefaultParams throws for unknown type', () => {
  assertThrows(() => getDefaultParams('unknown'));
});

test('validateParams accepts valid params', () => {
  const result = validateParams('txt2img', { width: 1024, height: 1024, steps: 20, cfg_scale: 7, seed: -1 });
  assert(result.valid, 'should be valid');
  assertEqual(result.errors.length, 0);
});

test('validateParams rejects width not divisible by 8', () => {
  const result = validateParams('txt2img', { width: 1025 });
  assert(!result.valid);
  assertIncludes(result.errors[0], 'divisible by 8');
});

test('validateParams rejects out-of-range values', () => {
  const r1 = validateParams('txt2img', { width: 8192 });
  assert(!r1.valid);

  const r2 = validateParams('txt2img', { steps: 200 });
  assert(!r2.valid);

  const r3 = validateParams('txt2img', { cfg_scale: 50 });
  assert(!r3.valid);

  const r4 = validateParams('txt2img', { seed: -2 });
  assert(!r4.valid);
});

test('validateParams checks video frames', () => {
  const r1 = validateParams('txt2vid', { frames: 500 });
  assert(!r1.valid);
  assertIncludes(r1.errors[0], 'frames');
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 2: Prompt Sanitization
// ═════════════════════════════════════════════════════════════════════════════

suite('Prompt Sanitization');

test('sanitizePrompt removes HTML tags', () => {
  const result = sanitizePrompt('hello <script>alert(1)</script> world');
  assert(!result.includes('<'), 'should remove <');
  assert(!result.includes('>'), 'should remove >');
  assertIncludes(result, 'hello');
  assertIncludes(result, 'world');
});

test('sanitizePrompt removes path traversal', () => {
  const result = sanitizePrompt('cat ../../etc/passwd');
  assert(!result.includes('../'), 'should remove ../');
});

test('sanitizePrompt removes control characters', () => {
  const result = sanitizePrompt('hello\x00\x01\x02world');
  assert(!result.includes('\x00'));
  assertIncludes(result, 'hello');
  assertIncludes(result, 'world');
});

test('sanitizePrompt preserves newlines', () => {
  const result = sanitizePrompt('line1\nline2');
  assertIncludes(result, '\n');
});

test('sanitizePrompt truncates at 2000 chars', () => {
  const long = 'a'.repeat(3000);
  const result = sanitizePrompt(long);
  assertEqual(result.length, 2000);
});

test('sanitizePrompt handles null/undefined', () => {
  assertEqual(sanitizePrompt(null), '');
  assertEqual(sanitizePrompt(undefined), '');
  assertEqual(sanitizePrompt(123), '');
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 3: Workflow Validation
// ═════════════════════════════════════════════════════════════════════════════

suite('Workflow Validation');

test('validateWorkflow accepts valid workflow', () => {
  const wf = getTemplate('txt2img');
  const params = { prompt: 'test', negative_prompt: '', width: 512, height: 512, steps: 10, cfg_scale: 7, seed: 42, sampler: 'euler', scheduler: 'normal', denoise: 1.0, model: 'test.safetensors' };
  const built = substituteParams(wf, params);
  validateWorkflow(built);  // should not throw
});

test('validateWorkflow rejects null', () => {
  assertThrows(() => validateWorkflow(null));
});

test('validateWorkflow rejects empty object', () => {
  assertThrows(() => validateWorkflow({}));
});

test('validateWorkflow rejects node without class_type', () => {
  assertThrows(() => validateWorkflow({ '1': { inputs: {} } }));
});

test('validateWorkflow rejects arrays', () => {
  assertThrows(() => validateWorkflow([1, 2, 3]));
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 4: ComfyUI Connector (unit tests — no live ComfyUI needed)
// ═════════════════════════════════════════════════════════════════════════════

suite('ComfyUI Connector');

await testAsync('fetchOutput rejects path traversal (../)', async () => {
  const { ComfyUIConnector } = await import('../src/media/comfyui-connector.js');
  const conn = new ComfyUIConnector({ baseUrl: 'http://127.0.0.1:19999' });
  try {
    await conn.fetchOutput('../../../etc/passwd');
    assert(false, 'should have thrown');
  } catch (err) {
    assertIncludes(err.message, 'Invalid output filename');
  }
});

await testAsync('fetchOutput rejects path with forward slash', async () => {
  const { ComfyUIConnector } = await import('../src/media/comfyui-connector.js');
  const conn = new ComfyUIConnector({ baseUrl: 'http://127.0.0.1:19999' });
  try {
    await conn.fetchOutput('foo/bar.png');
    assert(false, 'should have thrown');
  } catch (err) {
    assertIncludes(err.message, 'Invalid output filename');
  }
});

await testAsync('isAvailable returns false on ECONNREFUSED', async () => {
  const { ComfyUIConnector } = await import('../src/media/comfyui-connector.js');
  const conn = new ComfyUIConnector({ baseUrl: 'http://127.0.0.1:19999' });
  const result = await conn.isAvailable();
  assertEqual(result.available, false);
  assert(result.error !== undefined);
});

await testAsync('getQueue returns zeros on failure', async () => {
  const { ComfyUIConnector } = await import('../src/media/comfyui-connector.js');
  const conn = new ComfyUIConnector({ baseUrl: 'http://127.0.0.1:19999' });
  const result = await conn.getQueue();
  assertEqual(result.running, 0);
  assertEqual(result.pending, 0);
});

await testAsync('withTimeout rejects on timeout', async () => {
  const { ComfyUIConnector } = await import('../src/media/comfyui-connector.js');
  const conn = new ComfyUIConnector();
  try {
    await conn.withTimeout(new Promise(() => {}), 50);  // never resolves
    assert(false, 'should have thrown');
  } catch (err) {
    assertIncludes(err.message, 'Hard timeout');
  }
});

await testAsync('withTimeout resolves on fast promise', async () => {
  const { ComfyUIConnector } = await import('../src/media/comfyui-connector.js');
  const conn = new ComfyUIConnector();
  const result = await conn.withTimeout(Promise.resolve(42), 5000);
  assertEqual(result, 42);
});

await testAsync('connectWS closes previous WS (leak guard)', async () => {
  const { ComfyUIConnector } = await import('../src/media/comfyui-connector.js');
  const conn = new ComfyUIConnector({ baseUrl: 'http://127.0.0.1:19999' });
  // Simulate a _ws object that tracks close() calls
  let closeCalled = 0;
  conn._ws = { close: () => { closeCalled++; }, readyState: 1 };
  // connectWS should close the previous one first
  conn.connectWS(() => {});
  assertEqual(closeCalled, 1, 'previous WS should be closed');
  // Cleanup — disconnect the new WS attempt
  conn.disconnectWS();
});

await testAsync('getObjectInfo returns empty arrays on failure', async () => {
  const { ComfyUIConnector } = await import('../src/media/comfyui-connector.js');
  const conn = new ComfyUIConnector({ baseUrl: 'http://127.0.0.1:19999' });
  const result = await conn.getObjectInfo();
  assertEqual(result.checkpoints.length, 0);
  assertEqual(result.loras.length, 0);
  assertEqual(result.vaes.length, 0);
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 5: VRAM Manager — GPU Job Lock
// ═════════════════════════════════════════════════════════════════════════════

suite('VRAM Manager — GPU Job Lock');

await testAsync('acquire serializes tasks', async () => {
  // Override broadcast to prevent WS errors
  const mgr = createTestVramManager({ ollamaUrl: 'http://127.0.0.1:19999', chatModel: 'test' });
  mgr._broadcastState = () => {};  // no-op

  const order = [];
  const p1 = mgr.acquire(async () => {
    await new Promise(r => setTimeout(r, 50));
    order.push(1);
    return 'a';
  });
  const p2 = mgr.acquire(async () => {
    order.push(2);
    return 'b';
  });

  const [r1, r2] = await Promise.all([p1, p2]);
  assertEqual(r1, 'a');
  assertEqual(r2, 'b');
  assertEqual(order[0], 1, 'task 1 should complete first');
  assertEqual(order[1], 2, 'task 2 should complete second');
});

await testAsync('acquire FIFO order with 5 tasks', async () => {
  const mgr = createTestVramManager({ ollamaUrl: 'http://127.0.0.1:19999' });
  mgr._broadcastState = () => {};

  const order = [];
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(mgr.acquire(async () => {
      await new Promise(r => setTimeout(r, 10));
      order.push(i);
    }));
  }
  await Promise.all(promises);
  for (let i = 0; i < 5; i++) {
    assertEqual(order[i], i, `task ${i} should be at position ${i}`);
  }
});

await testAsync('acquire releases lock on task error', async () => {
  const mgr = createTestVramManager({ ollamaUrl: 'http://127.0.0.1:19999' });
  mgr._broadcastState = () => {};

  // First task throws
  const p1 = mgr.acquire(async () => { throw new Error('boom'); }).catch(e => e.message);
  // Second task should still execute
  const p2 = mgr.acquire(async () => 'ok');

  const [r1, r2] = await Promise.all([p1, p2]);
  assertEqual(r1, 'boom');
  assertEqual(r2, 'ok');
});

await testAsync('getState reports busy and queueLength', async () => {
  const mgr = createTestVramManager({ ollamaUrl: 'http://127.0.0.1:19999' });
  mgr._broadcastState = () => {};

  assertEqual(mgr.getState().busy, false);
  assertEqual(mgr.getState().queueLength, 0);

  let resolveTask;
  const taskPromise = new Promise(r => { resolveTask = r; });
  const p = mgr.acquire(async () => { await taskPromise; });

  // Give it a tick to start
  await new Promise(r => setTimeout(r, 10));
  assertEqual(mgr.getState().busy, true);

  resolveTask();
  await p;
  assertEqual(mgr.getState().busy, false);
});

await testAsync('concurrent acquire shows correct queue length', async () => {
  const mgr = createTestVramManager({ ollamaUrl: 'http://127.0.0.1:19999' });
  const states = [];
  mgr._broadcastState = () => { states.push({ ...mgr.getState() }); };

  let resolveFirst;
  const firstPromise = new Promise(r => { resolveFirst = r; });

  const p1 = mgr.acquire(async () => { await firstPromise; });
  const p2 = mgr.acquire(async () => {});
  const p3 = mgr.acquire(async () => {});

  await new Promise(r => setTimeout(r, 10));
  // First is running, 2 in queue
  assert(mgr.getState().busy);
  assertEqual(mgr.getState().queueLength, 2);

  resolveFirst();
  await Promise.all([p1, p2, p3]);
  assertEqual(mgr.getState().busy, false);
  assertEqual(mgr.getState().queueLength, 0);
});

test('getState reports ollamaUnloaded correctly', () => {
  const mgr = createTestVramManager({ ollamaUrl: 'http://127.0.0.1:19999' });
  assertEqual(mgr.getState().ollamaUnloaded, false);
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 6: Output Storage
// ═════════════════════════════════════════════════════════════════════════════

suite('Output Storage');

const tmpDir = path.join(os.tmpdir(), 'c3-mm-test-' + Date.now());

await testAsync('init creates base directory', async () => {
  const storage = new MediaOutputStorage({ baseDir: tmpDir, maxGB: 1 });
  storage.init();
  assert(fs.existsSync(tmpDir), 'base dir should exist');
});

await testAsync('init creates subdirectories', async () => {
  const storage = new MediaOutputStorage({ baseDir: tmpDir, maxGB: 1 });
  storage.init();
  assert(fs.existsSync(path.join(tmpDir, 'images')), 'images/ should exist');
  assert(fs.existsSync(path.join(tmpDir, 'videos')), 'videos/ should exist');
  assert(fs.existsSync(path.join(tmpDir, 'img2img')), 'img2img/ should exist');
  assert(fs.existsSync(path.join(tmpDir, 'thumbnails')), 'thumbnails/ should exist');
  assert(fs.existsSync(path.join(tmpDir, 'temp')), 'temp/ should exist');
});

await testAsync('saveOutput writes file to type subfolder', async () => {
  const storage = new MediaOutputStorage({ baseDir: tmpDir, maxGB: 1 });
  storage.init();
  const buf = Buffer.from('PNG data here');
  const filePath = await storage.saveOutput('gen-001', 'test.png', buf, 'txt2img');
  assert(fs.existsSync(filePath));
  assertIncludes(filePath, path.join('images', 'gen-001'), 'should be in images/ subfolder');
  const content = fs.readFileSync(filePath);
  assertEqual(content.toString(), 'PNG data here');
});

await testAsync('saveOutput uses videos subfolder for txt2vid', async () => {
  const storage = new MediaOutputStorage({ baseDir: tmpDir, maxGB: 1 });
  storage.init();
  const filePath = await storage.saveOutput('gen-vid', 'output.webp', Buffer.from('video'), 'txt2vid');
  assertIncludes(filePath, path.join('videos', 'gen-vid'));
});

await testAsync('saveOutput rejects path traversal', async () => {
  const storage = new MediaOutputStorage({ baseDir: tmpDir, maxGB: 1 });
  try {
    await storage.saveOutput('gen-001', '../evil.png', Buffer.alloc(0));
    assert(false, 'should have thrown');
  } catch (err) {
    assertIncludes(err.message, 'Invalid filename');
  }
});

await testAsync('saveMultipleOutputs saves all files', async () => {
  const storage = new MediaOutputStorage({ baseDir: tmpDir, maxGB: 1 });
  storage.init();
  const outputs = [
    { filename: 'frame1.png', buffer: Buffer.from('f1') },
    { filename: 'frame2.png', buffer: Buffer.from('f2') },
    { filename: 'frame3.png', buffer: Buffer.from('f3') },
  ];
  const paths = await storage.saveMultipleOutputs('gen-multi', outputs, 'txt2vid');
  assertEqual(paths.length, 3);
  for (const p of paths) assert(fs.existsSync(p));
  assertIncludes(paths[0], 'videos', 'video files in videos/ subfolder');
});

test('getOutputPath returns null for missing file', () => {
  const storage = new MediaOutputStorage({ baseDir: tmpDir, maxGB: 1 });
  const result = storage.getOutputPath('gen-nonexistent', 'nope.png');
  assertEqual(result, null);
});

test('getOutputPath rejects path traversal', () => {
  const storage = new MediaOutputStorage({ baseDir: tmpDir, maxGB: 1 });
  const result = storage.getOutputPath('gen-001', '../evil.png');
  assertEqual(result, null);
});

await testAsync('deleteGeneration removes directory from subfolder', async () => {
  const storage = new MediaOutputStorage({ baseDir: tmpDir, maxGB: 1 });
  storage.init();
  await storage.saveOutput('gen-del', 'test.png', Buffer.from('data'), 'txt2img');
  assert(fs.existsSync(path.join(tmpDir, 'images', 'gen-del')));

  await storage.deleteGeneration('gen-del');
  assert(!fs.existsSync(path.join(tmpDir, 'images', 'gen-del')));
});

test('getHistory returns paginated results', () => {
  const db = createTestDb();
  const storage = new MediaOutputStorage({ baseDir: tmpDir, maxGB: 1 });
  storage.setDb(db);

  for (let i = 0; i < 30; i++) insertGen(db, { id: `gen-hist-${i}` });

  const page0 = storage.getHistory({ page: 0, limit: 10 });
  assertEqual(page0.length, 10);

  const page1 = storage.getHistory({ page: 1, limit: 10 });
  assertEqual(page1.length, 10);

  // Pages should have different entries
  assert(page0[0].id !== page1[0].id, 'pages should have different entries');
});

test('getHistory filters by type', () => {
  const db = createTestDb();
  const storage = new MediaOutputStorage({ baseDir: tmpDir, maxGB: 1 });
  storage.setDb(db);

  insertGen(db, { id: 'gen-vid-1', type: 'txt2vid' });
  insertGen(db, { id: 'gen-img-1', type: 'txt2img' });

  const vidOnly = storage.getHistory({ type: 'txt2vid' });
  for (const row of vidOnly) assertEqual(row.type, 'txt2vid');
});

test('setFavorite toggles favorite', () => {
  const db = createTestDb();
  const storage = new MediaOutputStorage({ baseDir: tmpDir, maxGB: 1 });
  storage.setDb(db);

  insertGen(db, { id: 'gen-fav' });
  storage.setFavorite('gen-fav', true);

  const row = db.prepare('SELECT favorite FROM media_generations WHERE id = ?').get('gen-fav');
  assertEqual(row.favorite, 1);

  storage.setFavorite('gen-fav', false);
  const row2 = db.prepare('SELECT favorite FROM media_generations WHERE id = ?').get('gen-fav');
  assertEqual(row2.favorite, 0);
});

test('search finds by prompt substring', () => {
  const db = createTestDb();
  const storage = new MediaOutputStorage({ baseDir: tmpDir, maxGB: 1 });
  storage.setDb(db);

  insertGen(db, { id: 'gen-search-1', prompt: 'a beautiful sunset' });
  insertGen(db, { id: 'gen-search-2', prompt: 'ugly monster' });

  const results = storage.search('sunset');
  assertEqual(results.length, 1);
  assertEqual(results[0].id, 'gen-search-1');
});

test('getStats returns correct values', () => {
  const storage = new MediaOutputStorage({ baseDir: tmpDir, maxGB: 1 });
  const stats = storage.getStats();
  assert(typeof stats.totalSize === 'number');
  assert(typeof stats.fileCount === 'number');
  assert(stats.totalSize >= 0);
});

await testAsync('enforceQuota deletes oldest non-favorite', async () => {
  const db = createTestDb();
  const dir = path.join(os.tmpdir(), 'c3-mm-quota-' + Date.now());
  const storage = new MediaOutputStorage({ baseDir: dir, maxGB: 0 }); // 0 GB → always over quota
  storage.setDb(db);
  storage.init();

  // Insert some generations with files
  insertGen(db, { id: 'gen-old', favorite: 0 });
  insertGen(db, { id: 'gen-fav', favorite: 1 });
  await storage.saveOutput('gen-old', 'file.png', Buffer.alloc(1024), 'txt2img');
  await storage.saveOutput('gen-fav', 'file.png', Buffer.alloc(1024), 'txt2img');

  await storage.enforceQuota();

  // Old non-favorite should be deleted
  const old = db.prepare('SELECT id FROM media_generations WHERE id = ?').get('gen-old');
  assertEqual(old, undefined, 'non-favorite should be deleted');

  // Favorite should be preserved
  const fav = db.prepare('SELECT id FROM media_generations WHERE id = ?').get('gen-fav');
  assert(fav !== undefined, 'favorite should be preserved');

  // Cleanup
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cleanup preserves favorites', () => {
  const db = createTestDb();
  const storage = new MediaOutputStorage({ baseDir: tmpDir, maxGB: 1 });
  storage.setDb(db);

  // Insert an old favorite
  db.prepare(`
    INSERT INTO media_generations (id, type, prompt, params, status, favorite, created_at)
    VALUES (?, 'txt2img', 'old prompt', '{}', 'completed', 1, '2020-01-01')
  `).run('gen-old-fav');

  const cleaned = storage.cleanup({ maxAgeDays: 1 });
  const row = db.prepare('SELECT id FROM media_generations WHERE id = ?').get('gen-old-fav');
  assert(row !== undefined, 'old favorite should not be cleaned');
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 7: Media Routes (unit tests)
// ═════════════════════════════════════════════════════════════════════════════

suite('Media Routes');

test('recoverStuckGenerations marks running as failed', () => {
  const db = createTestDb();
  insertGen(db, { id: 'gen-stuck-1', status: 'running' });
  insertGen(db, { id: 'gen-stuck-2', status: 'pending' });
  insertGen(db, { id: 'gen-ok', status: 'completed' });

  const logs = [];
  const mockLogger = {
    warn: (cat, msg) => logs.push(msg),
    error: (cat, msg) => logs.push(msg),
  };

  recoverStuckGenerations(db, mockLogger);

  const s1 = db.prepare('SELECT status, error FROM media_generations WHERE id = ?').get('gen-stuck-1');
  assertEqual(s1.status, 'failed');
  assertIncludes(s1.error, 'Server restart');

  const s2 = db.prepare('SELECT status FROM media_generations WHERE id = ?').get('gen-stuck-2');
  assertEqual(s2.status, 'failed');

  const s3 = db.prepare('SELECT status FROM media_generations WHERE id = ?').get('gen-ok');
  assertEqual(s3.status, 'completed');

  assert(logs.some(l => l.includes('2 stuck')), 'should log recovery count');
});

test('recoverStuckGenerations handles empty table', () => {
  const db = createTestDb();
  const mockLogger = { warn: () => {}, error: () => {} };
  recoverStuckGenerations(db, mockLogger);  // should not throw
});

await testAsync('generate route enters task authority before the media callback', async () => {
  const rawDb = createTestDb();
  rawDb.exec(`
    CREATE TABLE media_status_log (status TEXT NOT NULL);
    CREATE TRIGGER media_status_log_after_update
    AFTER UPDATE OF status ON media_generations
    BEGIN
      INSERT INTO media_status_log(status) VALUES (NEW.status);
    END;
  `);
  const authority = new ModelUseAuthority();
  const vramManager = new VRAMManager({
    chatModel: 'route-authority-fixture:latest',
    artifactUsePort: createVramArtifactUsePort({ authority }),
  });
  vramManager._broadcastState = () => {};
  const deleteLease = authority.acquireExclusive({
    modelName: 'route-authority-fixture',
    owner: MODEL_ACTIVITY_OWNER.MODEL_DELETE,
  });
  let affectedProviderCalls = 0;
  const replies = [];
  const routes = createMediaRoutes({
    db: { db: rawDb },
    parseBody: async () => ({ type: 'txt2img', prompt: 'route authority fixture' }),
    sendJSON: (_res, status, body) => replies.push({ status, body }),
    safeError: error => error.message,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    comfyuiConnector: {
      _baseUrl: 'http://mock:8188',
      isAvailable: async () => ({ available: true }),
      submitWorkflow: async () => { affectedProviderCalls += 1; },
      disconnectWS: () => { affectedProviderCalls += 1; },
      freeVram: async () => { affectedProviderCalls += 1; },
    },
    vramManager,
    mediaStorage: {},
  });
  try {
    await routes['POST /api/media/generate']({}, {});
    await new Promise(resolve => setImmediate(resolve));
    assertEqual(replies.length, 1);
    assertEqual(replies[0].status, 200);
    const row = rawDb.prepare('SELECT status, error FROM media_generations').get();
    assertEqual(row.status, 'failed');
    assertIncludes(row.error, 'provider mutation is already active');
    const transitions = rawDb.prepare('SELECT status FROM media_status_log').all();
    assertEqual(transitions.length, 1);
    assertEqual(transitions[0].status, 'failed');
    assertEqual(affectedProviderCalls, 0);
  } finally {
    deleteLease.release();
    rawDb.close();
  }
});

await testAsync('generate route does not swallow authority failure from reload cleanup', async () => {
  const rawDb = createTestDb();
  let taskPromise = null;
  const reloadError = new Error('reload authority fixture');
  reloadError.code = 'MODEL_USE_EXCLUSIVE_ACTIVE';
  const vramManager = {
    _gpuTotalVramMb: 24576,
    acquire(task) {
      taskPromise = task();
      return taskPromise;
    },
    unloadOllama: async () => {},
    waitForVramDrop: async () => true,
    reloadOllama: async () => { throw reloadError; },
  };
  const routes = createMediaRoutes({
    db: { db: rawDb },
    parseBody: async () => ({ type: 'txt2img', prompt: 'reload authority fixture' }),
    sendJSON: () => {},
    safeError: error => error.message,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    comfyuiConnector: {
      _baseUrl: 'http://mock:8188',
      _timeout: 1000,
      isAvailable: async () => ({ available: true }),
      connectWS: () => {},
      disconnectWS: () => {},
      submitWorkflow: async () => ({ promptId: 'route-reload-fixture' }),
      waitForResult: async () => ({ outputs: [] }),
      withTimeout: async promise => promise,
      freeVram: async () => {},
    },
    vramManager,
    mediaStorage: { enforceQuota: async () => {} },
  });
  try {
    await routes['POST /api/media/generate']({}, {});
    await taskPromise.catch(() => {});
    await new Promise(resolve => setImmediate(resolve));
    const row = rawDb.prepare('SELECT status, error FROM media_generations').get();
    assertEqual(row.status, 'failed');
    assertEqual(row.error, 'reload authority fixture');
  } finally {
    rawDb.close();
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 8: DB Migration
// ═════════════════════════════════════════════════════════════════════════════

suite('DB Migration');

test('table has correct columns', () => {
  const db = createTestDb();
  const info = db.prepare("PRAGMA table_info(media_generations)").all();
  const cols = info.map(c => c.name);

  assert(cols.includes('id'));
  assert(cols.includes('type'));
  assert(cols.includes('prompt'));
  assert(cols.includes('negative_prompt'));
  assert(cols.includes('params'));
  assert(cols.includes('status'));
  assert(cols.includes('comfyui_prompt_id'));
  assert(cols.includes('outputs'));
  assert(cols.includes('error'));
  assert(cols.includes('created_at'));
  assert(cols.includes('completed_at'));
  assert(cols.includes('duration_ms'));
  assert(cols.includes('favorite'));
});

test('CHECK constraints enforce valid type', () => {
  const db = createTestDb();
  let threw = false;
  try {
    db.prepare(`INSERT INTO media_generations (id, type, prompt, params) VALUES ('x', 'invalid', 'test', '{}')`).run();
  } catch (err) {
    threw = true;
    assertIncludes(err.message, 'CHECK');
  }
  assert(threw, 'should throw on invalid type');
});

test('CHECK constraints enforce valid status', () => {
  const db = createTestDb();
  let threw = false;
  try {
    db.prepare(`
      INSERT INTO media_generations (id, type, prompt, params, status)
      VALUES ('y', 'txt2img', 'test', '{}', 'invalid_status')
    `).run();
  } catch (err) {
    threw = true;
    assertIncludes(err.message, 'CHECK');
  }
  assert(threw, 'should throw on invalid status');
});

test('indexes exist', () => {
  const db = createTestDb();
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='media_generations'").all();
  const names = indexes.map(i => i.name);
  assert(names.includes('idx_mg_status'), 'status index should exist');
  assert(names.includes('idx_mg_created'), 'created_at index should exist');
  assert(names.includes('idx_mg_favorite'), 'favorite index should exist');
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 9: Model Discovery
// ═════════════════════════════════════════════════════════════════════════════

suite('Model Discovery');

await testAsync('cache returns same data within TTL', async () => {
  let callCount = 0;
  const mockConnector = {
    getObjectInfo: async () => {
      callCount++;
      return { checkpoints: ['model1.safetensors'], loras: [], vaes: [] };
    },
  };

  const disc = new MediaModelDiscovery(mockConnector);
  const r1 = await disc.getCheckpoints();
  const r2 = await disc.getCheckpoints();

  assertEqual(callCount, 1, 'should only call once within TTL');
  assertEqual(r1.length, 1);
  assertEqual(r2.length, 1);
});

await testAsync('invalidateCache forces re-fetch', async () => {
  let callCount = 0;
  const mockConnector = {
    getObjectInfo: async () => {
      callCount++;
      return { checkpoints: ['model' + callCount], loras: [], vaes: [] };
    },
  };

  const disc = new MediaModelDiscovery(mockConnector);
  await disc.getCheckpoints();
  assertEqual(callCount, 1);

  disc.invalidateCache();
  await disc.getCheckpoints();
  assertEqual(callCount, 2, 'should re-fetch after invalidation');
});

await testAsync('getLoRAs and getVAEs delegate to connector', async () => {
  const mockConnector = {
    getObjectInfo: async () => ({
      checkpoints: ['ck1'],
      loras: ['lora1', 'lora2'],
      vaes: ['vae1'],
    }),
  };

  const disc = new MediaModelDiscovery(mockConnector);
  const loras = await disc.getLoRAs();
  const vaes = await disc.getVAEs();

  assertEqual(loras.length, 2);
  assertEqual(vaes.length, 1);
});

// ═════════════════════════════════════════════════════════════════════════════
// Cleanup + Summary
// ═════════════════════════════════════════════════════════════════════════════

// Cleanup test temp dir
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
