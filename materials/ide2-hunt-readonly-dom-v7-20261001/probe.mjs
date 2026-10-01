// Private isolated real AppImage display observation. No CHAT or model POST.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { CONFIG, ROOT, sha, fileSha, save, inherited, delay, sourceIdentity } from './common.mjs';
import { OwnedRelayRequests } from './relay-owned.mjs';
import { classifyInnerOwnedGroups } from './cleanup-boundary.mjs';
import { observeLoopbackOnlyNetwork } from './network-view.mjs';
import { interactiveTargetSnapshot, settingsCatalogSnapshot, SETTINGS_BUTTON_SELECTOR, MODELS_TILE_SELECTOR } from './dom-target.mjs';
process.umask(0o077);
assert.equal(process.argv[2], '--inner');
const out = path.resolve(process.argv[3]);
const run = JSON.parse(fs.readFileSync(path.join(out, 'INSIDE.json')));
assert.equal(run.out, out);
assert.notEqual(fs.readlinkSync('/proc/self/ns/pid'), run.parentPidNamespace);
assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'NAMESPACE-ACK.json'))).pidNamespace, fs.readlinkSync('/proc/self/ns/pid'));
assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'NAMESPACE-HELLO.json'))).namespacePid, 1);
assert.notEqual(String(fs.statSync('/proc/self/ns/net').ino), run.parentNetns);
assert.equal(spawnSync('/usr/sbin/ip', ['link', 'set', 'lo', 'up']).status, 0);
const networkObservation = observeLoopbackOnlyNetwork({
  parentNamespace: 'net:[' + run.parentNetns + ']',
  expectedNamespace: JSON.parse(fs.readFileSync(path.join(out, 'NAMESPACE-HELLO.json'))).netNamespace});
save(out, 'NETWORK-VIEW.json', networkObservation);
assert.equal(fs.readdirSync('/dev').some(name => name.startsWith('nvidia')), false);
const source = CONFIG.backend;
const packagedSource = path.join(CONFIG.package, 'source');
const identity = sourceIdentity();
const record = {schemaVersion: 1, status: 'FAIL', scope: 'actual GPU capacity + installed metadata → packaged UI, private fresh DB grade absence',
  backendSource: CONFIG.backendHead, guiPackageSource: CONFIG.packageSource,
  chat: 'NOT_RUN', modelQuality: 'NOT_RUN', installedHuntAcceptance: 'NOT_RUN',
  releaseAccepted: false, startedUtc: new Date().toISOString(), source: identity,
  network: {namespace: String(fs.statSync('/proc/self/ns/net').ino), interfaces: networkObservation.kernelInterfaces,
    routesLoopbackOnly: true, kernelObservation: 'NETWORK-VIEW.json', hostNetwork: false, gpuDevicesVisible: false}};
const runtime = path.join(out, 'runtime'); fs.mkdirSync(runtime, {mode: 0o700});
const dirs = Object.fromEntries(['home', 'config', 'cache', 'data', 'state', 'projects', 'output', 'profile'].map(name => [name, path.join(runtime, name)]));
for (const dir of Object.values(dirs)) fs.mkdirSync(dir, {mode: 0o700});
assert.equal(fileSha(run.gpuInventoryFile), run.gpuInventorySha256);
fs.mkdirSync(path.join(dirs.state, 'intentsmith'), {mode: 0o700});
fs.copyFileSync(run.gpuInventoryFile, path.join(dirs.state, 'intentsmith/gpu-inventory.json'));
fs.chmodSync(path.join(dirs.state, 'intentsmith/gpu-inventory.json'), 0o600);
const shortTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'is-hunt-dom-')); fs.chmodSync(shortTmp, 0o700);
const portFile = path.join(runtime, 'backend.port.json');
const require = createRequire(path.join(packagedSource, 'package.json'));
const {readLocalAccess} = require(path.join(packagedSource, 'intentsmith-ide/applications/electron/intentsmith-local-access.js'));
const puppeteer = require('puppeteer');
const ownership = new OwnedRelayRequests(), relayRows = [];
const relay = http.createServer((incoming, outgoing) => {
  const row = {at: new Date().toISOString(), method: incoming.method, path: incoming.url}; relayRows.push(row);
  if (incoming.method !== 'GET' || !CONFIG.allowedProviderReads.includes(incoming.url)
    || incoming.headers['transfer-encoding'] || Number(incoming.headers['content-length'] || 0) !== 0) {
    row.denied = true; incoming.resume(); outgoing.writeHead(403, {'Content-Type': 'application/json'});
    outgoing.end(JSON.stringify({code: 'READONLY_PROVIDER_DENY'})); return;
  }
  let ticket;
  const upstream = http.request({socketPath: run.socket, path: incoming.url, method: 'GET'}, response => {
    ticket.attachResponse(response); row.status = response.statusCode;
    outgoing.writeHead(response.statusCode, {'Content-Type': 'application/json'}); response.pipe(outgoing);
  });
  ticket = ownership.track(incoming, outgoing, upstream, error => {row.error = error.message;});
  upstream.setTimeout(12_000, () => upstream.destroy(Error('bounded metadata relay timeout')));
  upstream.on('error', error => {row.error = error.message; if (!outgoing.destroyed) {if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end();}});
  upstream.end();
});
await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
const providerUrl = `http://127.0.0.1:${relay.address().port}`;
const env = {...inherited(), PATH: path.dirname(CONFIG.node) + path.delimiter + process.env.PATH,
  HOME: dirs.home, TMPDIR: shortTmp, TMP: shortTmp, TEMP: shortTmp,
  XDG_CONFIG_HOME: dirs.config, XDG_CACHE_HOME: dirs.cache, XDG_DATA_HOME: dirs.data, XDG_STATE_HOME: dirs.state,
  NODE_ENV: 'test', CI: '1', DOTENV_CONFIG_PATH: path.join(runtime, 'no-dotenv-file'), DOTENV_CONFIG_QUIET: 'true',
  INTENTSMITH_HOST: '127.0.0.1', INTENTSMITH_PORT: '0', INTENTSMITH_PORT_FILE: portFile,
  INTENTSMITH_DB_PATH: path.join(dirs.data, 'hunt-ui.sqlite'), INTENTSMITH_PROJECTS_DIR: dirs.projects, INTENTSMITH_OUTPUT_DIR: dirs.output,
  INTENTSMITH_ENABLE_AUTONOMY: 'false', INTENTSMITH_ENABLE_COMFYUI: 'false', INTENTSMITH_ENABLE_ONLINE_DISCOVERY: 'false',
  INTENTSMITH_ENABLE_AGENTS: 'false', INTENTSMITH_MODEL_UNIVERSE_ENABLED: 'false', INTENTSMITH_LIFECYCLE_AUTO_COMMIT: 'false',
  INTENTSMITH_LOG_LEVEL: 'warn', OLLAMA_URL: providerUrl, DISPLAY: run.display, XAUTHORITY: path.join(out, 'Xauthority'),
  PYTHONDONTWRITEBYTECODE: '1', INTENTSMITH_PDF_PYTHON: path.join(CONFIG.package, 'runtime/pdf/bin/python'),
  UCETNI_RUNTIME_DIR: path.join(CONFIG.package, 'runtime/accountant')};
for (const role of ['D1', 'D2', 'R1', 'R2', 'CODE', 'CHAT', 'VISION']) env['INTENTSMITH_MODEL_' + role] = CONFIG.roleSentinel;
const children = [], events = [], pending = new Set(); let browser, page, access, cdp;
let aborted = null, signalCleanup;
function checkAbort() {
  const file = path.join(out, 'ABORT.json');
  if (!aborted && fs.existsSync(file)) {
    const value = JSON.parse(fs.readFileSync(file));
    if (value.nonce === run.nonce) requestAbort(value.reason);
  }
  if (aborted) throw aborted;
}
function requestAbort(reason) {
  if (aborted) return;
  aborted = Error(reason); record.abort = {reason, at: new Date().toISOString()};
  signalCleanup = (async () => {
    try {await browser?.close();} catch {}
    for (const child of [...children].reverse()) await stop(child);
  })();
}
const onSignal = signal => requestAbort('PROBE_' + signal);
const onTerm = () => onSignal('SIGTERM'), onInt = () => onSignal('SIGINT');
process.on('SIGTERM', onTerm); process.on('SIGINT', onInt);
const abortPoll = setInterval(() => {
  const file = path.join(out, 'ABORT.json');
  if (fs.existsSync(file)) {try {const v = JSON.parse(fs.readFileSync(file)); if (v.nonce === run.nonce) requestAbort(v.reason);} catch (error) {requestAbort(error.message);}}
}, 50);
function ownedGroups() {
  const groups = new Set(children.map(c => c.pid)), rows = [];
  for (const name of fs.readdirSync('/proc')) if (/^\d+$/.test(name)) {
    try {
      const raw = fs.readFileSync('/proc/' + name + '/stat', 'utf8');
      const end = raw.lastIndexOf(')'), cols = raw.slice(end + 1).trim().split(/\s+/);
      const group = Number(cols[2]), state = cols[0];
      if (end < 0 || !Number.isSafeInteger(group) || group < 0 || typeof state !== 'string' || !/^[RSDZTtWXxKPI]$/.test(state))
        rows.push({pid: Number(name), group: null, state: 'UNKNOWN', error: 'MALFORMED_PROC_STAT'});
      else if (groups.has(group)) rows.push({pid: Number(name), group, state});
    } catch (error) {
      // A disappeared process is gone. An unreadable process is UNKNOWN, never
      // an empty observation; this /proc belongs only to our init namespace.
      if (!['ENOENT', 'ESRCH'].includes(error.code))
        rows.push({pid: Number(name), group: null, state: 'UNKNOWN', error: error.code || 'PROC_STAT_UNREADABLE'});
    }
  }
  return rows;
}

async function start(command, args, name) {
  checkAbort();
  const fd = fs.openSync(path.join(runtime, name + '.log'), 'wx', 0o600);
  const child = spawn(command, args, {cwd: source, env, detached: true, stdio: ['ignore', fd, fd]}); fs.closeSync(fd);
  child.completion = new Promise(resolve => {child.once('error', error => {child.spawnError = error; resolve({error: error.message});}); child.once('close', (exitCode, signal) => resolve({exitCode, signal}));});
  children.push(child);
  // All detached descendants are inside our init-owned PID namespace. If this
  // probe dies before publishing or finally, init exit tears down the namespace.
  checkAbort(); return child;
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return child.completion;
  try {process.kill(-child.pid, 'SIGTERM');} catch (error) {if (error.code !== 'ESRCH') throw error;}
  const done = await Promise.race([child.completion, delay(10_000).then(() => null)]);
  if (done) return {...done, forced: false};
  try {process.kill(-child.pid, 'SIGKILL');} catch (error) {if (error.code !== 'ESRCH') throw error;}
  return {...await child.completion, forced: true};
}
async function until(label, predicate, child, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    checkAbort();
    if (child?.spawnError) throw child.spawnError;
    if (child && child.exitCode !== null) throw Error(label + ': child exited ' + child.exitCode);
    try {const value = await predicate(); if (value) return value;} catch (error) {if (error.code !== 'ENOENT') throw error;}
    await delay(100);
  }
  throw Error(label + ': timeout');
}
async function get(pathname) {
  checkAbort();
  const response = await fetch(access.backendUrl + pathname, {headers: {'X-IntentSmith-Local-Capability': access.localCapability}, signal: AbortSignal.timeout(15_000)});
  const body = await response.json(); save(out, 'API-' + pathname.split('/').filter(Boolean).join('-') + '.json', {status: response.status, receivedUtc: new Date().toISOString(), body});
  return {status: response.status, body};
}
async function rows() {
  return page.$$eval('[aria-label="Modelové pracoviště"] .model-row', nodes => nodes.map(n => ({title: n.querySelector('.row-t')?.textContent,
    subtitle: n.querySelector('.row-s')?.textContent, meta: n.querySelector('.row-m')?.textContent})));
}
let clickSequence = 0;
async function clickText(selector, text, exact = true) {
  checkAbort();
  const spec = {selector, text, exact};
  const number = ++clickSequence, deadlineMs = 30_000, pollMs = 100;
  const startedMs = Date.now(), deadline = startedMs + deadlineMs;
  const readiness = {selector, text, deadlineMs, pollMs, status: 'WAITING', observations: []};
  let before;
  try {
    await page.waitForFunction(interactiveTargetSnapshot, {timeout: Math.max(1, deadline - Date.now())}, {...spec, waitForCandidate: true});
    const selected = await page.evaluate(interactiveTargetSnapshot, spec);
    assert.equal(selected.eligibleCount, 1, 'one visible declared public button');
    const handles = await page.$$(selector);
    try {assert.ok(handles[selected.selectedIndex]); await handles[selected.selectedIndex].scrollIntoView();}
    finally {await Promise.all(handles.map(h => h.dispose()));}
    // Visibility does not imply a clickable workbench: startup/other overlays
    // may cover the public button. Observe only; never hide/remove an overlay.
    before = await page.evaluate(interactiveTargetSnapshot, spec);
    let savedBlockingScreenshot = false;
    while (true) {
      checkAbort();
      const elapsedMs = Date.now() - startedMs;
      readiness.observations.push({elapsedMs, snapshot: before});
      if (before.status === 'READY' && elapsedMs < deadlineMs) {
        readiness.status = 'READY';
        save(out, `DOM-CLICK-${number}-readiness.json`, readiness);
        break;
      }
      save(out, `DOM-CLICK-${number}-readiness.json`, readiness);
      if (!savedBlockingScreenshot) {
        save(out, `DOM-CLICK-${number}-blocked.json`, before);
        await page.screenshot({path: path.join(out, `DOM-CLICK-${number}-blocked.png`)});
        savedBlockingScreenshot = true;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        readiness.status = 'READINESS_TIMEOUT';
        save(out, `DOM-CLICK-${number}-before.json`, before);
        save(out, `DOM-CLICK-${number}-readiness.json`, readiness);
        throw Error('public button hit-readiness timeout within ' + deadlineMs + 'ms: ' + text);
      }
      await delay(Math.min(pollMs, remainingMs));
      before = await page.evaluate(interactiveTargetSnapshot, spec);
    }
    save(out, `DOM-CLICK-${number}-before.json`, before);
    assert.equal(before.status, 'READY', 'exact button centre must pass DOM hit-test');
    checkAbort();
    // Real pointer input at the verified viewport point; never HTMLElement.click
    // or the prototype's private action/state methods.
    await page.mouse.click(before.point.x, before.point.y);
    save(out, `DOM-CLICK-${number}-pointer.json`, {selector, text, point: before.point, clickedUtc: new Date().toISOString()});
  } catch (error) {
    if (!before) {
      before = await page.evaluate(interactiveTargetSnapshot, spec);
      save(out, `DOM-CLICK-${number}-before.json`, before);
      readiness.status = 'CANDIDATE_TIMEOUT_OR_ERROR';
      readiness.observations.push({elapsedMs: Date.now() - startedMs, snapshot: before});
      save(out, `DOM-CLICK-${number}-readiness.json`, readiness);
    }
    throw error;
  }
}

async function tab(label, expectedCount) {
  checkAbort();
  await clickText('[aria-label="Modelové pracoviště"] .model-tabs button', label);
  await page.waitForFunction(expectedCount => {
    const scope = document.querySelector('[aria-label="Modelové pracoviště"]');
    return scope && scope.querySelectorAll('.model-row').length === expectedCount && !scope.querySelector('p[role="status"]')?.textContent.includes('Načítám');
  }, {timeout: 30_000}, expectedCount);
  const dom = await rows(); save(out, 'DOM-' + label + '.json', {observedUtc: new Date().toISOString(), rows: dom});
  await page.screenshot({path: path.join(out, 'DOM-' + label + '.png')}); return dom;
}
try {
  const backend = await start(CONFIG.node, ['src/server.js'], 'backend');
  access = await until('private backend', () => readLocalAccess({portFile}), backend);
  assert.equal(JSON.parse(fs.readFileSync(portFile)).pid, backend.pid);
  const app = await start(path.join(CONFIG.package, 'IntentSmith-Studio2.AppImage'), ['--appimage-extract-and-run', '--no-sandbox', '--disable-gpu',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + dirs.profile], 'appimage');
  const port = await until('own AppImage CDP', () => Number(fs.readFileSync(path.join(dirs.profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]), app);
  browser = await puppeteer.connect({browserURL: 'http://127.0.0.1:' + port});
  const target = await browser.waitForTarget(t => t.url().includes('/lib/frontend/index.html'), {timeout: 60_000});
  page = await target.page(); await page.setViewport({width: 1600, height: 1000, deviceScaleFactor: 1});
  const index = fileURLToPath(new URL(target.url())); assert.ok(index.startsWith(shortTmp + path.sep)); assert.equal(fileSha(index), CONFIG.rendererEntrypointSha256);
  record.rendererEntrypointSha256 = fileSha(index);
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === access.backendUrl) {
      const allowed = ['GET', 'HEAD'].includes(request.method());
      events.push({kind: 'http-request', method: request.method(), path: url.pathname, denied: !allowed, at: new Date().toISOString()});
      if (!allowed) {request.abort('blockedbyclient').catch(() => {}); return;}
    }
    request.continue().catch(() => {});
  });
  page.on('response', response => {
    const url = new URL(response.url()); if (url.origin !== access.backendUrl) return;
    const promise = (async () => {let body; try {body = await response.json();} catch {body = null;}
      events.push({kind: 'http-response', path: url.pathname, method: response.request().method(), status: response.status(), body, at: new Date().toISOString()});})();
    pending.add(promise); promise.finally(() => pending.delete(promise));
  });
  cdp = await page.createCDPSession(); await cdp.send('Network.enable');
  cdp.on('Network.webSocketFrameSent', ({response}) => {let body; try {body = JSON.parse(response.payloadData);} catch {body = {};}
    events.push({kind: 'ws-sent', type: body.type ?? null, channel: body.channel ?? null, sha256: sha(response.payloadData)});});
  await page.waitForSelector('#intentsmith-studio2 [data-studio-ui="studio2"]', {timeout: 60_000});
  await page.waitForFunction(() => document.querySelector('#intentsmith-studio2 .sb')?.textContent.includes('Připojeno'), {timeout: 30_000});
  assert.equal(await page.evaluate(() => window.electronIntentSmith?.getBackendUrl?.()), access.backendUrl);
  const gpu = await get('/api/system/gpu'); assert.equal(gpu.status, 200);
  const captured = JSON.parse(fs.readFileSync(path.join(out, 'GPU-OBSERVATION.json'))).observed;
  assert.deepEqual(gpu.body.profile, captured, 'private backend must retain actual canonical timestamped GPU observation');
  assert.equal(gpu.body.profile.capacityOnly, true); assert.equal(gpu.body.profile.inventoryStale, false);
  const primary = gpu.body.profile.gpus.find(g => !g.is_igpu && g.vram_mb > 0);
  assert.ok(Number.isSafeInteger(primary.vram_mb) && primary.vram_mb <= 1024 * 1024);
  const statusText = await page.$eval('#intentsmith-studio2 .sb', n => n.textContent);
  const capacity = /GPU kapacita\s+([\d\s.,]+)\s+GiB/.exec(statusText); assert.ok(capacity, 'real GPU capacity must reach packaged DOM');
  assert.ok(Math.abs(Number(capacity[1].replace(/\s/g, '').replace(',', '.')) - primary.vram_mb / 1024) <= 0.051, 'MiB→GiB display bound');
  record.gpu = {profile: gpu.body.profile, statusText, timestampDisplayedInStatus: statusText.includes(gpu.body.profile.checkedAt), usageNotClaimed: true};
  save(out, 'DOM-settings-before-navigation.json', await page.evaluate(settingsCatalogSnapshot));
  await clickText(SETTINGS_BUTTON_SELECTOR, 'Nastavení');
  let settingsAfter;
  try {await page.waitForFunction(settingsCatalogSnapshot, {timeout: 30_000}, {waitForReady: true});}
  finally {
    settingsAfter = await page.evaluate(settingsCatalogSnapshot);
    save(out, 'DOM-settings-after-navigation.json', settingsAfter);
    await page.screenshot({path: path.join(out, 'DOM-settings-after-navigation.png')});
  }
  assert.equal(settingsAfter.ready, true, 'visible settings catalogue reached through public pointer input');
  await clickText(MODELS_TILE_SELECTOR, 'Modely a inference', false);
  await page.waitForSelector('[aria-label="Modelové pracoviště"]');
  const overview = await get('/api/system/models/overview'); assert.equal(overview.status, 200); assert.ok(overview.body.models.length);
  const displayed = await tab('Přehled', Math.min(150, overview.body.models.length));
  assert.deepEqual(displayed.map(r => r.title), overview.body.models.slice(0, 150).map(m => m.name));
  for (let i = 0; i < displayed.length; i++) {
    const m = overview.body.models[i]; assert.ok(Number.isSafeInteger(m.size) && m.size > 0);
    assert.equal(m.sizeGB, (m.size / 1073741824).toFixed(1)); assert.equal(m.evaluatedRoleCount, 0);
    assert.equal(displayed[i].meta, m.sizeGB + ' GiB · měřeno 0/' + m.applicableRoleCount);
  }
  const evaluations = await get('/api/system/models/evaluations'); assert.equal(evaluations.status, 200); assert.equal(evaluations.body.history.length, 0);
  const expected = Object.entries(evaluations.body.roles).flatMap(([role, plan]) => plan.artifacts.filter(a => a.applicable !== false).map(a => ({title: a.model + ' · ' + role,
    subtitle: a.status + (a.errorCode ? ' · ' + a.errorCode : ''), meta: '—'}))).slice(0, 150);
  for (const plan of Object.values(evaluations.body.roles)) for (const artifact of plan.artifacts) {
    assert.equal(artifact.score, null); assert.notEqual(artifact.status, 'COMPLETE');
  }
  assert.deepEqual(await tab('Evaluace', expected.length), expected);
  const roles = await tab('Role', 7); assert.equal(roles.some(r => r.meta.includes('%')), false);
  const candidates = await get('/api/system/models/candidates'); assert.equal(candidates.status, 200);
  assert.equal(candidates.body.gpuVramMb, Math.max(...captured.gpus.map(g => g.vram_mb)));
  assert.equal(candidates.body.gpuCapacitySource, 'system-profile'); assert.equal(candidates.body.vramBudgetMb, Math.round(candidates.body.gpuVramMb * 0.8));
  assert.equal(candidates.body.authority.qualityRecommendation, false);
  const candidateDom = await tab('Kandidáti', Math.min(150, candidates.body.candidates.length));
  for (let i = 0; i < candidateDom.length; i++) {
    const c = candidates.body.candidates[i]; assert.equal(candidateDom[i].title, c.name);
    assert.equal(candidateDom[i].meta, c.vramMb ? (c.vramMb / 1024).toFixed(1) + ' GiB odhad' : 'VRAM neznámá');
    assert.equal(c.qualityStatus, 'NOT_EVALUATED');
  }
  await clickText('[aria-label="Modelové pracoviště"] .model-tabs button', 'GPU hunt');
  await page.waitForFunction(() => document.querySelector('[aria-label="Modelové pracoviště"] p[role="status"]')?.textContent.includes('Načtení selhalo'), {timeout: 30_000});
  const hunt = await get('/api/system/models/hunt'); assert.equal(hunt.status, 503); assert.equal(hunt.body.code, 'HUNT_UNAVAILABLE');
  assert.equal(hunt.body.error, 'DESKTOP_NOT_INSTALLED'); record.hunt = {expectedUnavailable: true, actualInstalledHuntNotAccepted: true};
  await page.screenshot({path: path.join(out, 'DOM-GPU-hunt-unavailable.png')});
  await browser.close(); browser = null;
  record.appExit = await Promise.race([app.completion, delay(15_000).then(() => null)]); assert.ok(record.appExit); assert.equal(record.appExit.exitCode, 0);
  record.backendExit = await stop(backend); assert.equal(record.backendExit.exitCode, 0); assert.equal(record.backendExit.forced, false);
  // A new read-only process inspects only the explicit private probe DB after backend close.
  const reader = path.join(out, 'private-db-read.mjs');
  fs.writeFileSync(reader, `import {createRequire} from 'node:module';const require=createRequire(${JSON.stringify(path.join(source, 'package.json'))});const D=require('better-sqlite3');const db=new D(process.argv[2],{readonly:true,fileMustExist:true});db.pragma('query_only=ON');const names=['model_desired_bindings','model_binding_operations','model_binding_provider_operations','model_evaluation_runs','model_evaluation_acceptances','model_evaluation_grader_reviews','model_evaluation_grader_adjudications','messages'];const counts=Object.fromEntries(names.map(n=>[n,db.prepare('SELECT count(*) AS n FROM '+n).get().n]));db.close();console.log(JSON.stringify({readonly:true,counts}));\n`, {mode: 0o600});
  const dbRead = spawnSync(CONFIG.node, [reader, env.INTENTSMITH_DB_PATH], {cwd: source, env, encoding: 'utf8', timeout: 15_000});
  assert.equal(dbRead.status, 0); record.privateDb = JSON.parse(dbRead.stdout);
  for (const count of Object.values(record.privateDb.counts)) assert.equal(count, 0, 'no grade/chat/binding activation may be written');
  save(out, 'PRIVATE-DB-COUNTS.json', record.privateDb); checkAbort(); record.status = 'PASS';
} catch (error) {record.error = String(error.stack || error); process.exitCode = 1; try {await page?.screenshot({path: path.join(out, 'FAILURE.png')});} catch {}}
finally {
  clearInterval(abortPoll);
  if (signalCleanup) await signalCleanup;
  try {await browser?.close();} catch {}
  await Promise.allSettled([...pending]);
  record.cleanup = {children: []};
  for (const child of [...children].reverse()) record.cleanup.children.push({pid: child.pid, result: await stop(child)});
  await delay(300); record.cleanup.remainingOwnedGroups = ownedGroups();
  record.cleanup.innerGroupBoundary = classifyInnerOwnedGroups(record.cleanup.remainingOwnedGroups, children.map(child => child.pid));
  const closed = new Promise(resolve => relay.close(() => resolve(true))); relay.closeAllConnections();
  record.cleanup.relayDrain = await ownership.cancelAndSettle(10_000);
  let timer; record.cleanup.relayClosed = await Promise.race([closed, new Promise(resolve => {timer = setTimeout(() => resolve(false), 10_000);})]); clearTimeout(timer);
  fs.rmSync(shortTmp, {recursive: true, force: true}); record.cleanup.shortTmpRemoved = !fs.existsSync(shortTmp);
  record.cleanup.portFileRemoved = !fs.existsSync(portFile);
  record.sourceUnchanged = JSON.stringify(sourceIdentity()) === JSON.stringify(identity);
  if (!record.cleanup.innerGroupBoundary.readyForNamespaceTeardown || !record.cleanup.relayDrain.settled || record.cleanup.relayDrain.pending
    || !record.cleanup.relayClosed || !record.cleanup.shortTmpRemoved || !record.cleanup.portFileRemoved || !record.sourceUnchanged) record.status = 'FAIL';
  record.endedUtc = new Date().toISOString(); save(out, 'NETWORK.json', events); save(out, 'INNER-METADATA-RELAY.json', relayRows); save(out, 'RESULT.json', record);
  save(out, 'CLEANUP-ACK.json', {nonce: run.nonce, namespacePid: process.pid,
    pidNamespace: fs.readlinkSync('/proc/self/ns/pid'), status: record.status,
    remainingOwnedGroups: record.cleanup.remainingOwnedGroups, innerGroupBoundary: record.cleanup.innerGroupBoundary, at: new Date().toISOString()});
  process.off('SIGTERM', onTerm); process.off('SIGINT', onInt);
  if (record.status !== 'PASS') process.exitCode = 1;
  process.stdout.write(JSON.stringify({status: record.status, artifactRoot: out, error: record.error ?? null}) + '\n');
}
