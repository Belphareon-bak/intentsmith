#!/usr/bin/env node
// Isolated Studio 2 acceptance staging. Default invocation is read-only.
// The live path requires --live --gpu-authorized and never touches systemd
// configuration, the installed backend, or imported project directories.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  parseStageArgs, preflightStage, assertIsolatedProjectPath,
  PRESERVED_TABLES, assertPreserved, assertNoImportedStartupEffects,
  assertDurableStageChat,
} from './studio2-isolated-stage-contract.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let interrupted = false;
const ownedChildren = new Set();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  interrupted = true;
  for (const child of ownedChildren) {
    if (!Number.isSafeInteger(child.pid) || child.pid <= 0) continue;
    try { process.kill(-child.pid, 'SIGTERM'); }
    catch (error) { if (error.code !== 'ESRCH') process.stderr.write(`${error.message}\n`); }
  }
});

function fail(code, detail = '') {
  throw Object.assign(new Error(detail ? `${code}: ${detail}` : code), { code });
}

function sha256(file) {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r'), buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let size;
    while ((size = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, size));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

function privateFile(file, text) {
  fs.writeFileSync(file, text, { flag: 'wx', mode: 0o600 });
}

function privateDir(dir) {
  fs.mkdirSync(dir, { mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
}

async function until(label, predicate, timeoutMs = 60_000,
  { ignoreInterrupt = false, intervalMs = 150 } = {}) {
  const end = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < end) {
    if (interrupted && !ignoreInterrupt) fail('STAGE_INTERRUPTED');
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) { last = error?.code || error?.message || 'unknown'; }
    await sleep(intervalMs);
  }
  fail('STAGE_TIMEOUT', `${label}${last ? ` (${last})` : ''}`);
}

function git(args, cwd) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd, env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    encoding: 'utf8', timeout: 15_000,
  }).trim();
}

function tableRows(db, table) {
  assert(PRESERVED_TABLES.includes(table));
  return db.prepare(`SELECT * FROM ${table}`).all();
}

function snapshot(db) {
  return Object.fromEntries(PRESERVED_TABLES.map(table => [table, tableRows(db, table)]));
}

async function checkGpuIdle(minFreeVramMiB) {
  let response;
  try { response = await fetch('http://127.0.0.1:11434/api/ps', { signal: AbortSignal.timeout(5_000) }); }
  catch { fail('PROVIDER_UNAVAILABLE'); }
  if (!response.ok) fail('PROVIDER_UNAVAILABLE');
  const provider = await response.json();
  if (!Array.isArray(provider.models) || provider.models.length) fail('FOREIGN_PROVIDER_BUSY');
  let compute;
  try { compute = execFileSync('nvidia-smi', ['--query-compute-apps=pid', '--format=csv,noheader'], {
    encoding: 'utf8', timeout: 10_000,
  }).trim(); } catch { fail('GPU_INVENTORY_UNAVAILABLE'); }
  if (compute) fail('FOREIGN_GPU_BUSY');
  let free;
  try { free = execFileSync('nvidia-smi', ['--query-gpu=memory.free', '--format=csv,noheader,nounits'], {
    encoding: 'utf8', timeout: 10_000,
  }).trim().split('\n').map(line => Number(line.trim())); } catch { fail('GPU_INVENTORY_UNAVAILABLE'); }
  if (!free.length || free.some(value => !Number.isSafeInteger(value) || value < minFreeVramMiB)) {
    fail('INSUFFICIENT_FREE_VRAM');
  }
  return { minFreeVramMiB, freeVramMiB: free };
}

function productionBackendPid() {
  try {
    const output = execFileSync('systemctl', ['--user', 'show', 'intentsmith-backend.service',
      '--property=MainPID', '--value'], { encoding: 'utf8', timeout: 10_000 }).trim();
    const pid = Number(output);
    if (!Number.isSafeInteger(pid) || pid <= 0) fail('PRODUCTION_BACKEND_IDENTITY_UNAVAILABLE');
    return pid;
  } catch { fail('PRODUCTION_BACKEND_IDENTITY_UNAVAILABLE'); }
}

function makeEnvironment(plan, dirs, portFile, database) {
  const forwarded = ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS',
    'XDG_RUNTIME_DIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'PULSE_SERVER'];
  const env = {
    ...Object.fromEntries(forwarded.filter(key => process.env[key]).map(key => [key, process.env[key]])),
    PATH: `${path.join(plan.packageDir, 'runtime/bin')}:/usr/bin:/bin`,
    HOME: dirs.home,
    XDG_CONFIG_HOME: dirs.config,
    XDG_CACHE_HOME: dirs.cache,
    XDG_DATA_HOME: dirs.data,
    XDG_STATE_HOME: dirs.state,
    TMPDIR: dirs.tmp,
    NODE_ENV: 'production',
    DOTENV_CONFIG_PATH: path.join(plan.trialRoot, 'no-dotenv'),
    INTENTSMITH_DB_PATH: database,
    INTENTSMITH_PORT_FILE: portFile,
    INTENTSMITH_PORT: '0',
    INTENTSMITH_HOST: '127.0.0.1',
    INTENTSMITH_PROJECTS_DIR: dirs.projects,
    INTENTSMITH_ENABLE_AGENTS: 'false',
    INTENTSMITH_ENABLE_AUTONOMY: 'false',
    INTENTSMITH_ENABLE_LIFECYCLE: 'false',
    INTENTSMITH_ENABLE_ONLINE_DISCOVERY: 'false',
    INTENTSMITH_MODEL_UNIVERSE_ENABLED: 'false',
    INTENTSMITH_ADMIN_TOKEN: randomBytes(32).toString('base64url'),
    INTENTSMITH_HUNT_STATE_DIR: path.join(dirs.state, 'model-hunt'),
    INTENTSMITH_UPDATE_REPO: '',
    INTENTSMITH_PDF_PYTHON: path.join(plan.packageDir, 'runtime/pdf/bin/python'),
    UCETNI_RUNTIME_DIR: path.join(plan.packageDir, 'runtime/accountant'),
    OLLAMA_URL: 'http://127.0.0.1:11434',
    PYTHONDONTWRITEBYTECODE: '1',
  };
  return env;
}

function startOwned(command, args, { cwd, env, log }) {
  const fd = fs.openSync(log, 'wx', 0o600);
  try {
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', fd, fd] });
    child.on('error', error => { child.stageSpawnError = error; });
    ownedChildren.add(child);
    return child;
  } finally { fs.closeSync(fd); }
}

async function stopOwned(child) {
  if (!child || !Number.isSafeInteger(child.pid) || child.pid <= 0) return;
  const groupAlive = () => {
    try { process.kill(-child.pid, 0); return true; }
    catch (error) { if (error.code === 'ESRCH') return false; throw error; }
  };
  try { process.kill(-child.pid, 'SIGTERM'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  try {
    await until('owned process group exit', () => !groupAlive(), 10_000,
      { ignoreInterrupt: true });
  } catch {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
    await until('owned process group kill', () => !groupAlive(), 5_000,
      { ignoreInterrupt: true });
  }
  ownedChildren.delete(child);
}

async function launchDesktop(command, args, profile, env, name, dirs, puppeteer) {
  if (!fs.statSync(profile).isDirectory()) fail('DESKTOP_PROFILE_INVALID');
  const child = startOwned(command, [...args, '--no-sandbox', '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`], {
    cwd: dirs.source, env, log: path.join(dirs.evidence, `${name}.log`),
  });
  try {
    const port = await until(`${name} CDP`, () => {
      if (child.stageSpawnError) throw child.stageSpawnError;
      const file = path.join(profile, 'DevToolsActivePort');
      if (!fs.existsSync(file)) return 0;
      const value = Number(fs.readFileSync(file, 'utf8').split('\n')[0]);
      return Number.isSafeInteger(value) ? value : 0;
    }, 60_000);
    const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` });
    const target = await browser.waitForTarget(t => t.url().includes('/lib/frontend/index.html'), { timeout: 60_000 });
    const page = await target.page();
    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
    return { child, browser, page };
  } catch (error) {
    await stopOwned(child);
    throw error;
  }
}

async function closeDesktop(desktop) {
  if (!desktop) return;
  try { await desktop.browser.close(); } catch {}
  await stopOwned(desktop.child);
}

function httpClient(access) {
  return async (url, body) => {
    const response = await fetch(access.backendUrl + url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Origin: 'null',
        'X-IntentSmith-Local-Capability': access.localCapability,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(180_000),
    });
    const payload = await response.json();
    if (!response.ok) throw Object.assign(new Error(`STAGE_HTTP_${response.status}: ${url}`), {
      code: payload.code || `STAGE_HTTP_${response.status}`, payload,
    });
    return payload;
  };
}

async function exerciseStudio(page, http, expectedBackendUrl, projectId, projectPath, dirs, result) {
  assertIsolatedProjectPath({ trialRoot: dirs.root, projectPath });
  await page.waitForSelector('#intentsmith-studio2 [data-studio-ui="studio2"]', { timeout: 60_000 });
  await page.waitForFunction(() => document.querySelector('#intentsmith-studio2 .sb')?.textContent.includes('Připojeno'), { timeout: 30_000 });
  assert.equal(await page.evaluate(() => window.electronIntentSmith?.getBackendUrl?.()),
    expectedBackendUrl, 'AppImage connected to a different backend');
  const conversation = (await http('/api/conversations', {
    title: 'Isolated Studio 2 staging chat', project_id: projectId,
  })).conversation;
  await page.evaluate(({ id, pid }) => {
    const session = window._sessions[0];
    session._convId = id; session._projectId = pid; session._agentId = null;
    session._conversationFocus = false;
    window.IntentSmithBus.emit('session:changed', { idx: 0 });
  }, { id: conversation.id, pid: projectId });
  const marker = 'IDE2-STAGE-391';
  const prompt = `Jednou větou vysvětli, proč tým zaznamenává rozhodnutí. Odpověď zakonči přesně ${marker}.`;
  await page.evaluate(text => {
    const input = document.querySelector('[aria-label^="Zpráva pro relaci"]');
    if (!input) throw Error('STAGE_COMPOSER_MISSING');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, prompt);
  await page.focus('[aria-label^="Zpráva pro relaci"]');
  await page.keyboard.down('Control'); await page.keyboard.press('Enter'); await page.keyboard.up('Control');
  await page.waitForFunction(value => window._sessions[0].chat.msgs.some(
    m => m.role === 'assistant' && m.text.includes(value)) && !window._sessions[0].chat._thinking,
  { timeout: 180_000 }, marker);
  const chat = await page.evaluate(() => {
    const session = window._sessions[0];
    return { conversationId: session._convId, mode: window.__intentsmithStudioMode,
      classicVisible: !!document.querySelector('#intentsmith-chat-panel'),
      answer: session.chat.msgs.filter(message => message.role === 'assistant').at(-1)?.text || '' };
  });
  assert.equal(chat.mode, 'studio2');
  assert.equal(chat.classicVisible, false);
  assert.equal(chat.conversationId, conversation.id, 'AppImage chat used a different conversation');
  assert(chat.answer.includes(marker));
  result.modelChat = { status: 'PASS', conversationId: chat.conversationId,
    projectId, prompt, marker, answer: chat.answer };
  await page.screenshot({ path: path.join(dirs.evidence, 'model-chat.png') });

  const fixture = path.join(projectPath, 'src/calc.cjs');
  const broken = 'module.exports = { mul: (a, b) => a + b };\n';
  assert.equal(fs.readFileSync(fixture, 'utf8'), broken);
  assertIsolatedProjectPath({ trialRoot: dirs.root, projectPath });
  await page.evaluate(async () => {
    const pause = () => new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(ok)));
    const button = (scope, text) => [...scope.querySelectorAll('button')].find(node => node.textContent.trim() === text);
    const root = document.querySelector('#intentsmith-studio2 [data-studio-ui="studio2"]');
    button(root, 'Připravit změnu').click(); await pause();
    const form = document.querySelector('section[aria-label="Připravit změnu projektu"]');
    if (!form) throw Error('STAGE_M2_FORM_MISSING');
    const input = async (element, value) => {
      if (!element) throw Error('STAGE_M2_INPUT_MISSING');
      const type = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
      Object.getOwnPropertyDescriptor(type.prototype, 'value').set.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true })); await pause();
    };
    await input(form.querySelector('[aria-label="Celkové zadání změny"]'),
      'Oprav násobení: mul(a,b) musí vracet a*b včetně nuly, záporných čísel a desetinných čísel. Zachovej CommonJS export.');
    await input(form.querySelector('fieldset input'), 'src/calc.cjs');
    await input(form.querySelector('fieldset textarea'), 'Nahraď chybný součet správným násobením a*b.');
    await input(form.querySelector('[aria-label="Program cíleného testu"]'), '/usr/bin/node');
    await input(form.querySelector('[aria-label="Argumenty cíleného testu"]'),
      JSON.stringify(['-e', "const {mul}=require('./src/calc.cjs');for(const [a,b,v] of [[6,7,42],[-2,3,-6],[0,7,0],[1.5,2,3]])if(mul(a,b)!==v)throw Error('wrong multiplication');"]));
    button(form, 'Připravit návrh bez schválení').click();
  });
  await page.waitForFunction(() => !!window._sessions[0]._m2Pending
    || (!window._sessions[0].chat._m2Busy && document.querySelector('section[aria-label="Připravit změnu projektu"]')?.textContent.includes('HTTP')),
  { timeout: 240_000 });
  const pending = await page.evaluate(() => !!window._sessions[0]._m2Pending);
  assert(pending, 'M2 draft was not produced');
  assert.equal(fs.readFileSync(fixture, 'utf8'), broken, 'M2 draft changed file before approval');
  await page.evaluate(() => [...document.querySelectorAll('#intentsmith-studio2 button')]
    .find(node => node.textContent.trim() === 'Zobrazit změny').click());
  await page.waitForFunction(() => [...document.querySelectorAll('#intentsmith-studio2 button')]
    .some(node => node.textContent.trim() === 'Schválit' && !node.disabled), { timeout: 30_000 });
  await page.screenshot({ path: path.join(dirs.evidence, 'm2-preview.png') });
  assertIsolatedProjectPath({ trialRoot: dirs.root, projectPath });
  await page.evaluate(() => [...document.querySelectorAll('#intentsmith-studio2 button')]
    .find(node => node.textContent.trim() === 'Schválit' && !node.disabled).click());
  await until('M2 approved file', () => {
    const content = fs.readFileSync(fixture, 'utf8');
    return content.includes('a * b') || content.includes('a*b');
  }, 180_000);
  execFileSync('/usr/bin/node', ['-e',
    "const {mul}=require('./src/calc.cjs');for(const [a,b,v] of [[6,7,42],[-2,3,-6],[0,7,0],[1.5,2,3]])if(mul(a,b)!==v)throw Error('wrong multiplication');"],
  { cwd: projectPath, timeout: 15_000 });
  await page.waitForFunction(() => !window._sessions[0].chat._m2Busy, { timeout: 90_000 });
  result.m2 = { status: 'PASS', unchangedBeforeApproval: true, approvedFileSha256: sha256(fixture) };
  await page.screenshot({ path: path.join(dirs.evidence, 'm2-written.png') });
  const status = await http(`/api/scm/status?projectId=${projectId}`);
  assert(status.files.some(file => file.path === 'src/calc.cjs'));
  const operations = [];
  for (const [op, args] of [
    ['stage', { paths: ['src/calc.cjs'] }],
    ['commit', { message: 'Isolated Studio 2 multiplication acceptance' }],
    ['branch.create', { name: 'ide2-stage-verified' }],
  ]) {
    assertIsolatedProjectPath({ trialRoot: dirs.root, projectPath });
    const plan = await http('/api/scm/prepare', { projectId, op, args });
    assert.equal(plan.state, 'pending');
    const run = await http('/api/scm/execute', { planId: plan.planId, digest: plan.digest, confirm: true });
    assert.equal(run.state, 'succeeded');
    operations.push(op);
  }
  await assert.rejects(http('/api/scm/prepare', { projectId, op: 'push' }),
    error => error.code === 'SCM_HOST_DENIED');
  result.scm = { status: 'PASS', operations, unauthorizedPushDenied: true };
}

async function exerciseLegacy(page, expectedBackendUrl, result) {
  await page.waitForSelector('#intentsmith-chat-panel', { timeout: 60_000 });
  const observed = await page.evaluate(() => ({
    studioVisible: !!document.querySelector('#intentsmith-studio2 [data-studio-ui="studio2"]'),
    backendUrl: window.electronIntentSmith?.getBackendUrl?.() || null,
  }));
  assert.equal(observed.studioVisible, false);
  assert.equal(observed.backendUrl, expectedBackendUrl);
  result.legacy = { status: 'PASS', classicVisible: true,
    sameStagedBackend: true, backendUrl: observed.backendUrl };
}

function packetFiles(root, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) files.push(...packetFiles(root, relative));
    else if (entry.isFile() && relative !== 'manifest.json') files.push(relative);
  }
  return files.sort();
}

async function liveStage(plan) {
  if (process.versions.node.split('.')[0] !== '24') fail('NODE24_REQUIRED');
  const gpuBefore = await checkGpuIdle(plan.minFreeVramMiB);
  const installedPid = productionBackendPid();
  const root = privateDir(plan.trialRoot);
  const dirs = { root, source: path.join(plan.packageDir, 'source'),
    evidence: privateDir(path.join(root, 'evidence')) };
  for (const name of ['home', 'config', 'cache', 'data', 'state', 'tmp', 'ui', 'legacy-ui']) {
    dirs[name] = privateDir(path.join(root, name));
  }
  dirs.projects = privateDir(path.join(dirs.home, 'projects'));
  const stageDb = path.join(dirs.data, 'stage.sqlite');
  const probeDb = path.join(dirs.data, 'migration-probe.sqlite');
  const portFile = path.join(root, 'backend.port.json');
  const result = {
    schemaVersion: 1, status: 'FAIL', sourceRevision: plan.sourceRevision,
    appImageSha256: plan.appImageSha256, legacyRevision: plan.legacyRevision,
    packageFileCount: plan.fileCount, sourceDb: plan.sourceDb, stageDb,
    trialRoot: root, productionBackendPidBefore: installedPid,
    gpuBefore,
    startedAt: new Date().toISOString(), independentReview: 'REVIEW_PENDING',
    publicReleaseAttested: false,
  };
  let backend, desktop, lease, originalRows;
  try {
    const require = createRequire(path.join(dirs.source, 'package.json'));
    const Database = require('better-sqlite3');
    const puppeteer = require('puppeteer');
    const { readLocalAccess } = require(path.join(dirs.source,
      'intentsmith-ide/applications/electron/intentsmith-local-access.js'));
    const { runMigrations } = await import(pathToFileURL(path.join(dirs.source, 'src/db/migrate.js')).href);
    const source = new Database(plan.sourceDb, { readonly: true, fileMustExist: true });
    try {
      if (source.pragma('quick_check', { simple: true }) !== 'ok'
        || source.pragma('foreign_key_check').length) fail('SOURCE_DB_INTEGRITY_FAILED');
      // Production can accept writes between these reads and the backup.
      // The completed SQLite backup is the coherent preservation baseline.
      await source.backup(stageDb);
    } finally { source.close(); }
    await fsp.chmod(stageDb, 0o600);
    const copy = new Database(stageDb, { readonly: true, fileMustExist: true });
    try {
      if (copy.pragma('quick_check', { simple: true }) !== 'ok'
        || copy.pragma('foreign_key_check').length) fail('DB_COPY_INTEGRITY_FAILED');
      originalRows = snapshot(copy);
      result.databaseCopy = { status: 'PASS', baselineCounts: Object.fromEntries(
        PRESERVED_TABLES.map(table => [table, originalRows[table].length])) };
    } finally { copy.close(); }
    await fsp.copyFile(stageDb, probeDb, fs.constants.COPYFILE_EXCL);
    await fsp.chmod(probeDb, 0o600);
    const probe = new Database(probeDb);
    try {
      await runMigrations(probe);
      if (probe.pragma('quick_check', { simple: true }) !== 'ok'
        || probe.pragma('foreign_key_check').length) fail('MIGRATION_PROBE_FAILED');
      result.migration = { status: 'PASS', counts: assertPreserved(originalRows, snapshot(probe)),
        originalModelBindingsPreserved: true };
      result.importedStartupEffects = {
        status: 'PASS', ...assertNoImportedStartupEffects(probe),
      };
    } finally { probe.close(); }
    const env = makeEnvironment(plan, dirs, portFile, stageDb);
    backend = startOwned(plan.runtimeNode, ['src/server.js'], {
      cwd: dirs.source, env, log: path.join(dirs.evidence, 'backend.log'),
    });
    await until('private backend port', () => {
      if (backend.stageSpawnError) throw backend.stageSpawnError;
      if (!fs.existsSync(portFile)) return false;
      const info = JSON.parse(fs.readFileSync(portFile, 'utf8'));
      return info.pid === backend.pid;
    }, 60_000);
    const access = readLocalAccess({ portFile });
    if (!access) fail('PRIVATE_BACKEND_ACCESS_INVALID');
    const http = httpClient(access);
    await until('private backend health', async () => (await http('/api/health')).ready === true, 60_000);
    result.backend = { status: 'PASS', pid: backend.pid, port: access.port };
    let bindingStatuses = [];
    try {
      await until('model verification settled', () => {
        const db = new Database(stageDb, { readonly: true, fileMustExist: true });
        try {
          bindingStatuses = db.prepare('SELECT role, verification_status FROM model_overrides ORDER BY role').all();
          return ['CHAT', 'CODE'].every(role => bindingStatuses.some(row => row.role === role))
            && bindingStatuses.every(row => row.verification_status === 'VERIFIED');
        } finally { db.close(); }
      }, 240_000);
    } catch (error) {
      result.modelBindingVerification = { status: 'FAIL', roles: bindingStatuses };
      if (error.code === 'STAGE_TIMEOUT') fail('MODEL_BINDINGS_UNVERIFIED', JSON.stringify(bindingStatuses));
      throw error;
    }
    result.modelBindingVerification = { status: 'PASS', roles: bindingStatuses };
    // Startup verification owns its own shared GPU lease. Acquire our lease
    // only after that queue drains, then keep it through M1/M2/SCM/Legacy.
    result.gpuBeforeLease = await until('provider and GPU drain after startup verification',
      () => checkGpuIdle(plan.minFreeVramMiB), 360_000, { intervalMs: 2000 });
    const { holdGpuEvaluationLock } = await import(pathToFileURL(path.join(dirs.source, 'src/upgrade/gpu-evaluation-lock.js')).href);
    lease = holdGpuEvaluationLock({ command: `isolated Studio 2 staging ${plan.sourceRevision}` });
    const projectPath = path.join(dirs.projects, 'stage-fixture');
    const registered = await http('/api/projects', {
      name: 'Isolated Studio 2 stage fixture', type: 'general', path: projectPath,
    });
    assert.equal(registered.path, projectPath);
    assertIsolatedProjectPath({ trialRoot: root, projectPath });
    const projectId = registered.project?.id;
    if (!Number.isSafeInteger(projectId) || projectId <= 0) fail('STAGE_PROJECT_ID_INVALID');
    result.project = { id: projectId, path: projectPath, newAndPrivate: true };
    await fsp.mkdir(path.join(projectPath, 'src'), { recursive: true });
    await fsp.writeFile(path.join(projectPath, 'src/calc.cjs'), 'module.exports = { mul: (a, b) => a + b };\n', { flag: 'wx' });
    git(['add', 'src/calc.cjs'], projectPath);
    git(['-c', 'user.name=IntentSmith staging', '-c', 'user.email=staging@localhost',
      '-c', 'commit.gpgSign=false',
      'commit', '-m', 'Stage isolated fixture'], projectPath);
    desktop = await launchDesktop(plan.appImage, ['--appimage-extract-and-run'], dirs.ui,
      { ...env, INTENTSMITH_STUDIO2_PREVIEW: '1' }, 'studio2', dirs, puppeteer);
    await exerciseStudio(desktop.page, http, access.backendUrl, projectId, projectPath, dirs, result);
    await closeDesktop(desktop); desktop = null;
    desktop = await launchDesktop(plan.legacyNode, [
      path.join(plan.legacySource, 'intentsmith-ide/applications/electron/scripts/launch.js'),
    ], dirs['legacy-ui'], env, 'legacy', dirs, puppeteer);
    await exerciseLegacy(desktop.page, access.backendUrl, result);
    await desktop.page.screenshot({ path: path.join(dirs.evidence, 'legacy.png') });
    await closeDesktop(desktop); desktop = null;
    const final = new Database(stageDb, { readonly: true, fileMustExist: true });
    try {
      if (final.pragma('quick_check', { simple: true }) !== 'ok'
        || final.pragma('foreign_key_check').length) fail('FINAL_DB_INTEGRITY_FAILED');
      const after = snapshot(final);
      result.dataPreservation = {
        status: 'PASS', counts: assertPreserved(originalRows, after,
          { allowNew: true, allowVerificationChange: true }),
        stableModelBindingsUnchanged: true,
      };
      result.modelChat.durableTurns = assertDurableStageChat(final, result.modelChat);
      result.modelChat.persistedInCopy = true;
    } finally { final.close(); }
    if (productionBackendPid() !== installedPid) fail('PRODUCTION_BACKEND_CHANGED');
    result.productionBackendPidAfter = installedPid;
    result.status = 'PASS';
  } catch (error) {
    result.error = { code: error.code || 'STAGE_FAILURE', message: error.message,
      stack: error.stack };
    process.exitCode = 1;
  } finally {
    if (desktop) try { await closeDesktop(desktop); } catch (error) {
      result.cleanupError = error.message; result.status = 'FAIL'; process.exitCode = 1;
    }
    if (backend) try { await stopOwned(backend); } catch (error) {
      result.cleanupError = error.message; result.status = 'FAIL'; process.exitCode = 1;
    }
    if (lease) try { lease.release(); } catch (error) {
      result.cleanupError = error.message; result.status = 'FAIL'; process.exitCode = 1;
    }
    result.completedAt = new Date().toISOString();
    try { result.productionBackendPidAfter = productionBackendPid(); }
    catch { result.status = 'FAIL'; process.exitCode = 1; }
    if (result.productionBackendPidAfter !== installedPid) {
      result.status = 'FAIL'; result.error ||= { code: 'PRODUCTION_BACKEND_CHANGED' }; process.exitCode = 1;
    }
    privateFile(path.join(root, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    privateFile(path.join(root, 'manifest.json'), JSON.stringify({
      schemaVersion: 1, status: result.status, sourceRevision: plan.sourceRevision,
      appImageSha256: plan.appImageSha256, legacyRevision: plan.legacyRevision,
      independentReview: 'REVIEW_PENDING', publicReleaseAttested: false,
      files: packetFiles(root).map(relative => ({ path: relative, sha256: sha256(path.join(root, relative)) })),
    }, null, 2) + '\n');
    console.log(JSON.stringify({ status: result.status, trialRoot: root,
      result: path.join(root, 'result.json'), manifest: path.join(root, 'manifest.json'),
      error: result.error?.code || result.cleanupError || null }));
  }
}

async function main() {
  const options = parseStageArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/studio2-isolated-stage.mjs --package=ABS --db=ABS --trial-root=NEW_ABS --legacy-source=ABS --legacy-node=ABS --expected-source=40HEX --expected-appimage=64HEX --expected-legacy=40HEX [--live --gpu-authorized --min-free-vram-mib=N]');
    return;
  }
  const plan = await preflightStage(options);
  if (options.mode === 'preflight') {
    console.log(JSON.stringify({ status: 'READY_FOR_SERIAL_LIVE_STAGE',
      sourceRevision: plan.sourceRevision, appImageSha256: plan.appImageSha256,
      legacyRevision: plan.legacyRevision, packageFileCount: plan.fileCount,
      sourceDb: plan.sourceDb, trialRoot: plan.trialRoot,
      gpuCalled: false, databaseWritten: false, serviceChanged: false }, null, 2));
    return;
  }
  await liveStage({ ...plan, minFreeVramMiB: options.minFreeVramMiB });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch(error => {
    console.error(JSON.stringify({ status: 'BLOCKED_BEFORE_STAGE', code: error.code || 'STAGE_FAILURE',
      message: error.message }));
    process.exitCode = 1;
  });
}
