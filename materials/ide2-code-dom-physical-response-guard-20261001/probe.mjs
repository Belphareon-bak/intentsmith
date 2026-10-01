// Private child of the physical IDE CODE qualification. Host owns GPU lease,
// exact provider relay and source pins; this child owns only its private runtime.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import http from 'node:http';
import { verifyPackageMembers } from './package-members.mjs';
import { OwnedRelayRequests } from './relay-owned.mjs';
import {
  ORACLE_PATH, ORACLE_SOURCE, ORACLE_ARGV, PROBE_PATH, PROBE_SOURCE,
  VALIDATE_PATH, VALIDATE_SOURCE, ENTRY_PATH, ENTRY_SOURCE,
  policyForFrozenOracle, ledgerBlueprint, LEDGER_FILES,
} from './inputs/project-app-acceptance.js';

process.umask(0o077);
assert.equal(process.argv[2], '--inner', 'run host.mjs for preflight or authorized live execution');
const candidate = path.dirname(fileURLToPath(import.meta.url));
const art = path.resolve(process.argv[3]);
const config = JSON.parse(fs.readFileSync(path.join(candidate, 'CONFIG.json')));
const runConfig = JSON.parse(fs.readFileSync(path.join(art, 'INSIDE.json')));
assert.equal(runConfig.out, art);
const pkg = config.package, source = path.join(pkg, 'source');
const node = path.join(pkg, 'runtime/bin/node');
const appImage = path.join(pkg, 'IntentSmith-Studio2.AppImage');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fileSha = p => sha(fs.readFileSync(p));
const save = (name, value) => fs.writeFileSync(path.join(art, name),
  JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const inherited = () => Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TZ']
  .filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const record = {
  schemaVersion: 1, status: 'FAIL', sourceRevision: config.sourceRevision,
  guiBackendEquivalentRevision: config.equivalentSourceRevision,
  stageHead: config.stageHead, scope: 'packaged DOM composer -> six physical CODE generations -> real M2 preview/approval -> frozen functional oracle',
  modelQuality: 'UNPROVEN', chat: 'NOT_RUN', releaseAccepted: false,
  model: runConfig.model, digest: runConfig.digest,
  startedUtc: new Date().toISOString(), checkpoints: [],
};
const checkpoint = name => {
  record.checkpoints.push({ name, at: new Date().toISOString() });
  process.stdout.write('IDE_CPU_M2 ' + name + '\n');
};
function git(args, cwd = config.stage) {
  return execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8', env: {
    ...inherited(), HOME: cwd, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  }, timeout: 30000 }).trim();
}
function sourceIdentity() {
  assert.equal(git(['rev-parse', 'HEAD']), config.stageHead);
  assert.equal(git(['status', '--porcelain=v1', '--untracked-files=all']), '');
  assert.equal(JSON.parse(fs.readFileSync(path.join(pkg, 'SOURCE.json'))).sourceRevision, config.sourceRevision);
  assert.equal(fileSha(appImage), config.appImageSha256);
  assert.equal(fileSha(path.join(candidate, 'package-members.mjs')),
    config.helpers.packageMembersSha256, 'package verifier pin inside private runtime');
  assert.equal(fileSha(path.join(candidate, 'relay-owned.mjs')),
    config.helpers.relayOwnedSha256, 'relay helper pin inside private runtime');
  const packageMembers = verifyPackageMembers(pkg, config.packageManifestSha256);
  for (const input of config.inputs) assert.equal(fileSha(path.join(candidate, input.file)), input.sha256);
  const rows = git(['ls-tree', '-r', config.equivalentSourceRevision, '--',
    'src', 'intentsmith-ide', 'package.json', 'package-lock.json', 'specialists', 'skills'], config.main)
    .split('\n').filter(Boolean);
  for (const row of rows) {
    const [meta, relative] = row.split('\t');
    const want = meta.split(' ')[2];
    for (const base of [config.stage, source]) {
      const bytes = fs.readFileSync(path.join(base, relative));
      const digest = createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
      assert.equal(digest, want, base + ':' + relative);
    }
  }
  record.identity = { comparedTrackedFilesPerCopy: rows.length, stageAndPackagedSourceMatch: true,
    AppImageSha256: fileSha(appImage), manifestSha256: fileSha(path.join(pkg, 'SHA256SUMS')),
    packageMemberCount: packageMembers.memberCount,
    packagedNodeSha256: fileSha(node), nativeSqliteSha256: fileSha(path.join(source, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node')),
    probeSha256: fileSha(fileURLToPath(import.meta.url)), inputs: config.inputs };
}
function snapshot(root) {
  const rows = [];
  function visit(relative) {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      if (!relative && name === '.git') continue;
      const child = path.join(relative, name), absolute = path.join(root, child), s = fs.lstatSync(absolute);
      assert.equal(s.isSymbolicLink(), false, 'private project contains no symlink');
      if (s.isDirectory()) { rows.push({ path: child, kind: 'directory', mode: s.mode & 0o777 }); visit(child); }
      else rows.push({ path: child, kind: 'file', mode: s.mode & 0o777, bytes: s.size, sha256: fileSha(absolute) });
    }
  }
  visit(''); return rows;
}
{
  sourceIdentity();
  save('SOURCE-IDENTITY.json', record.identity);
  assert.notEqual(String(fs.statSync('/proc/self/ns/net').ino), runConfig.parentNetns);
  assert.equal(spawnSync('/usr/sbin/ip', ['link', 'set', 'lo', 'up']).status, 0);
  const interfaces = JSON.parse(execFileSync('/usr/sbin/ip', ['-j', 'address'], { encoding: 'utf8' }));
  assert.deepEqual(interfaces.map(x => x.ifname), ['lo']);
  const relayRequests = new OwnedRelayRequests();
  const relayErrors = [];
  const relay = http.createServer((incoming, outgoing) => {
    let forwarded;
    try {
      let tracked;
      forwarded = http.request({ socketPath: runConfig.providerSocket, path: incoming.url,
        method: incoming.method, headers: incoming.headers }, response => {
        tracked.attachResponse(response);
        if (outgoing.destroyed) { response.destroy(); return; }
        outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing);
      });
      forwarded.on('error', error => { if (!outgoing.destroyed) {
        if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(error.message);
      } });
      tracked = relayRequests.track(incoming, outgoing, forwarded, error => {
        relayErrors.push(error.message);
      });
      incoming.pipe(forwarded);
    } catch (error) {
      forwarded?.destroy(); if (!outgoing.destroyed) {
        if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(error.message);
      }
    }
  });
  await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
  const providerUrl = `http://127.0.0.1:${relay.address().port}`;
  record.network = { namespace: String(fs.statSync('/proc/self/ns/net').ino), interfaces: ['lo'], provider: providerUrl,
    providerRelay: true, upstreamSocket: runConfig.providerSocket };
  const runtime = path.join(art, 'runtime'); fs.mkdirSync(runtime, { mode: 0o700 });
  const dirs = Object.fromEntries(['home','config','cache','data','state','projects','output','profile'].map(name => [name, path.join(runtime, name)]));
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { mode: 0o700 });
  dirs.projects = path.join(dirs.home, 'projects'); fs.mkdirSync(dirs.projects, { mode: 0o700 });
  const shortTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'is-ide-m2-')); fs.chmodSync(shortTmp, 0o700);
  const portFile = path.join(runtime, 'backend.port.json');
  const require = createRequire(path.join(source, 'package.json'));
  const { readLocalAccess } = require(path.join(source, 'intentsmith-ide/applications/electron/intentsmith-local-access.js'));
  const puppeteer = require('puppeteer');
  const children = []; let browser, page, access, cdp;
  const events = [], pendingResponses = new Set();
  const ownedGroups = () => {
    const groups = new Set(children.map(c => c.pid)), rows = [];
    for (const name of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue;
      try { const s = fs.readFileSync('/proc/' + name + '/stat', 'utf8');
        const columns = s.slice(s.lastIndexOf(')') + 1).trim().split(/\s+/);
        if (groups.has(Number(columns[2]))) rows.push({ pid: Number(name), group: Number(columns[2]), state: columns[0] });
      } catch {}
    }
    return rows;
  };
  const start = (command, argv, env, name) => {
    const fd = fs.openSync(path.join(runtime, name + '.log'), 'wx', 0o600);
    const child = spawn(command, argv, { cwd: source, env, detached: true, stdio: ['ignore', fd, fd] }); fs.closeSync(fd);
    child.completion = new Promise(resolve => {
      child.once('error', error => { child.spawnError = error; resolve({ exitCode: null, error: error.message }); });
      child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
    });
    children.push(child); return child;
  };
  const until = async (label, predicate, child, timeout = 60000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (child?.spawnError) throw child.spawnError;
      if (child && child.exitCode !== null) throw Error(label + ': owned child exited ' + child.exitCode);
      try { const v = await predicate(); if (v) return v; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await delay(100);
    }
    throw Error(label + ': timeout');
  };
  const stop = async child => {
    if (!child) return null;
    if (child.exitCode !== null || child.signalCode !== null) {
      const result = await child.completion;
      if (ownedGroups().some(p => p.group === child.pid)) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline && ownedGroups().some(p => p.group === child.pid)) await delay(100);
        if (ownedGroups().some(p => p.group === child.pid && p.state !== 'Z')) {
          try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
          await delay(300);
        }
      }
      return { ...result, remainingGroupChecked: true };
    }
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    const result = await Promise.race([child.completion, delay(10000).then(() => null)]);
    if (result) return { ...result, forced: false };
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    return { ...await child.completion, forced: true };
  };
  const env = { ...inherited(), PATH: path.join(pkg, 'runtime/bin') + path.delimiter + process.env.PATH,
    HOME: dirs.home, TMPDIR: shortTmp, TMP: shortTmp, TEMP: shortTmp,
    XDG_CONFIG_HOME: dirs.config, XDG_CACHE_HOME: dirs.cache, XDG_DATA_HOME: dirs.data, XDG_STATE_HOME: dirs.state,
    NODE_ENV: 'test', CI: '1', DOTENV_CONFIG_PATH: path.join(runtime, 'no-dotenv-file'), DOTENV_CONFIG_QUIET: 'true',
    INTENTSMITH_HOST: '127.0.0.1', INTENTSMITH_PORT: '0', INTENTSMITH_PORT_FILE: portFile,
    INTENTSMITH_DB_PATH: path.join(dirs.data, 'stage.sqlite'), INTENTSMITH_PROJECTS_DIR: dirs.projects, INTENTSMITH_OUTPUT_DIR: dirs.output,
    INTENTSMITH_ENABLE_AUTONOMY: 'false', INTENTSMITH_ENABLE_COMFYUI: 'false', INTENTSMITH_ENABLE_ONLINE_DISCOVERY: 'false',
    INTENTSMITH_ENABLE_AGENTS: 'false', INTENTSMITH_MODEL_UNIVERSE_ENABLED: 'false', INTENTSMITH_LIFECYCLE_AUTO_COMMIT: 'false',
    INTENTSMITH_MODEL_CHAT: runConfig.model, INTENTSMITH_MODEL_CODE: runConfig.model,
    INTENTSMITH_MODEL_D1: runConfig.model, INTENTSMITH_LOG_LEVEL: 'warn',
    OLLAMA_URL: providerUrl, DISPLAY: runConfig.display, XAUTHORITY: path.join(art, 'Xauthority'),
    PYTHONDONTWRITEBYTECODE: '1', INTENTSMITH_PDF_PYTHON: path.join(pkg, 'runtime/pdf/bin/python'), UCETNI_RUNTIME_DIR: path.join(pkg, 'runtime/accountant') };
  try {
    checkpoint('starting-private-packaged-backend');
    const backend = start(node, ['src/server.js'], env, 'backend');
    access = await until('private backend', () => readLocalAccess({ portFile }), backend);
    assert.equal(JSON.parse(fs.readFileSync(portFile)).pid, backend.pid);
    const app = start(appImage, ['--appimage-extract-and-run','--no-sandbox','--disable-gpu',
      '--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir=' + dirs.profile], env, 'appimage');
    const port = await until('AppImage CDP', () => Number(fs.readFileSync(path.join(dirs.profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]), app);
    browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:' + port });
    const target = await browser.waitForTarget(t => t.url().includes('/lib/frontend/index.html'), { timeout: 60000 });
    page = await target.page(); await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
    const index = fileURLToPath(new URL(target.url()));
    assert.ok(index.startsWith(shortTmp + path.sep));
    assert.equal(fileSha(index), config.rendererEntrypointSha256);
    record.rendererEntrypointSha256 = fileSha(index);
    await page.waitForSelector('#intentsmith-studio2 [data-studio-ui="studio2"]', { timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('#intentsmith-studio2 .sb')?.textContent.includes('Připojeno'), { timeout: 30000 });
    await page.waitForFunction(() => { const root = document.querySelector('#intentsmith-studio2 [data-studio-ui="studio2"]');
      const box = root?.getBoundingClientRect(); return root && box?.width > 100 && box?.height > 100
        && root.contains(document.elementFromPoint(innerWidth / 2, innerHeight / 2))
        && ![...document.querySelectorAll('.dialogOverlay')].some(n => getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().height > 0); }, { timeout: 60000 });
    assert.equal(await page.evaluate(() => window.electronIntentSmith?.getBackendUrl?.()), access.backendUrl);
    cdp = await page.createCDPSession(); await cdp.send('Network.enable');
    cdp.on('Network.webSocketFrameSent', ({ response }) => {
      let v; try { v = JSON.parse(response.payloadData); } catch { v = {}; }
      events.push({ kind: 'ws-sent', type: v.type ?? null, channel: v.channel ?? null, payloadSha256: sha(response.payloadData) });
    });
    page.on('request', request => {
      const u = new URL(request.url()); if (u.origin !== access.backendUrl) return;
      events.push({ kind: 'http-request', pathname: u.pathname, method: request.method(),
        postData: request.postData() ?? null, at: new Date().toISOString() });
    });
    page.on('response', response => {
      const u = new URL(response.url()); if (u.origin !== access.backendUrl) return;
      const promise = (async () => {
        let payload; try { payload = await response.json(); } catch { payload = null; }
        events.push({ kind: 'http-response', pathname: u.pathname, method: response.request().method(), status: response.status(), payload });
      })();
      pendingResponses.add(promise); promise.finally(() => pendingResponses.delete(promise));
    });
    const post = async (url, body) => {
      const r = await page.evaluate(async ({ url, body }) => {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
      }, { url, body }); assert.equal(r.status, 201, url); return r.body;
    };
    const projectPath = path.join(dirs.projects, 'expense-ledger');
    const created = await post('/api/projects', { name: 'Physical CODE DOM Expense Ledger', type: 'general', path: projectPath });
    const projectId = created.project?.id; assert.ok(Number.isSafeInteger(projectId) && projectId > 0);
    assert.equal(fs.realpathSync(created.path), projectPath);
    const conversation = (await post('/api/conversations', { title: 'Physical CODE composer M2 approval', project_id: projectId })).conversation;
    const origin = { surface: 'studio', sessionId: conversation.id, conversationId: conversation.id, projectId };
    record.project = { path: projectPath, id: projectId }; record.origin = origin;
    const policyPath = path.join(projectPath, '.intentsmith/m2-governance-policy.json');
    const policy = policyForFrozenOracle(JSON.parse(fs.readFileSync(policyPath, 'utf8')));
    fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2) + '\n');
    const frozen = { [ORACLE_PATH]: ORACLE_SOURCE, [PROBE_PATH]: PROBE_SOURCE,
      [VALIDATE_PATH]: VALIDATE_SOURCE, [ENTRY_PATH]: ENTRY_SOURCE,
      '.intentsmith/m2-governance-policy.json': fs.readFileSync(policyPath, 'utf8') };
    for (const [relative, content] of Object.entries(frozen)) fs.writeFileSync(path.join(projectPath, relative), content);
    git(['add', '--', ...Object.keys(frozen)], projectPath);
    git(['-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false','-c','user.name=IntentSmith Qualification',
      '-c','user.email=qualification@example.invalid','commit','-m','Freeze independent ledger oracle before CODE inference'], projectPath);
    record.baselineHead = git(['rev-parse', 'HEAD'], projectPath);
    assert.equal(git(['status','--porcelain=v1','--untracked-files=all'], projectPath), '');
    const before = snapshot(projectPath); save('PROJECT-BEFORE.json', before);
    record.frozen = Object.entries(frozen).map(([relative, content]) => ({ path: relative, sha256: sha(content) }));
    const blueprint = ledgerBlueprint();
    blueprint.focusedTest.binary = node;
    const submittedBlueprint = { ...blueprint,
      files: blueprint.files.map(file => ({ ...file, contextFiles: file.contextFiles || [] })) };
    save('BLUEPRINT.json', { fixtureSeed: blueprint, expectedComposerDraft: submittedBlueprint });
    assert.deepEqual(blueprint.files.map(file => file.path).sort(), LEDGER_FILES.map(file => file.path).sort());
    const preModel = { stageHead: config.stageHead, sourceRevision: config.sourceRevision,
      projectId, conversationId: conversation.id, baselineHead: record.baselineHead,
      generatedPaths: LEDGER_FILES.map(file => file.path).sort(), blueprintSha256: sha(JSON.stringify(blueprint)),
      expectedComposerDraftSha256: sha(JSON.stringify(submittedBlueprint)),
      frozen: record.frozen, beforeSnapshotSha256: sha(JSON.stringify(before)), at: new Date().toISOString() };
    save('BEFORE-MODEL.json', preModel);
    await page.evaluate(({ id, projectId, blueprint }) => {
      const session = window._sessions[0]; session._convId = id; session._projectId = projectId;
      session._agentId = null; session._conversationFocus = false; session.chat._thinking = null; session.chat.attachments = [];
      const origin = { surface: 'studio', sessionId: id, conversationId: id, projectId };
      session.chat._projectWorkProposal = { origin,
        proposal: { kind: 'ProjectWorkProposal@1', projectId, draft: blueprint } };
      window.IntentSmithBus.emit('session:changed', { idx: 0 });
    }, { id: conversation.id, projectId, blueprint });
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('#intentsmith-studio2 button')]
        .find(item => item.textContent.trim() === 'Připravit změnu');
      if (!button || button.disabled) throw new Error('visible project composer button unavailable');
      button.click();
    });
    await page.waitForSelector('#intentsmith-studio2 .m2-composer');
    const form = await page.evaluate(() => window._sessions[0].chat._m2Composer);
    assert.deepEqual(form.origin, origin);
    assert.deepEqual(form.gitCommit, blueprint.gitCommit, 'proposal prefill preserves operator Git metadata');
    assert.equal(form.instruction, blueprint.instruction);
    assert.deepEqual(form.files.map(file => ({ path: file.path, instruction: file.instruction,
      dependsOn: file.dependencies.split('\n').filter(Boolean), contextFiles: file.contextFiles.split('\n').filter(Boolean) })),
      blueprint.files.map(file => ({ path: file.path, instruction: file.instruction,
        dependsOn: file.dependsOn, contextFiles: file.contextFiles || [] })));
    assert.equal(form.binary, node); assert.deepEqual(JSON.parse(form.argv), [...ORACLE_ARGV]);
    assert.equal(form.timeoutMs, String(blueprint.focusedTest.timeoutMs));
    save('COMPOSER-PREFILL.json', { form, origin, blueprintSha256: preModel.blueprintSha256,
      expectedComposerDraftSha256: preModel.expectedComposerDraftSha256 });
    await page.screenshot({ path: path.join(art, '01-physical-composer-prefill.png') });
    assert.deepEqual(snapshot(projectPath), before);
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('#intentsmith-studio2 .m2-composer button')]
        .find(item => item.textContent.trim() === 'Připravit návrh bez schválení');
      if (!button || button.disabled) throw new Error('composer submit unavailable');
      button.click();
    });
    checkpoint('dom-composer-code-draft-submitted');
    await page.waitForFunction(() => !!window._sessions[0]._m2Pending
      || window._sessions[0].chat._m2Composer?.error
      || window._sessions[0].chat.msgs.some(m => m.tag === 'M2_ERROR'), { timeout: 990000 });
    const pending = await page.evaluate(() => ({ binding: window._sessions[0]._m2Pending,
      formError: window._sessions[0].chat._m2Composer?.error || null,
      errors: window._sessions[0].chat.msgs.filter(m => m.tag === 'M2_ERROR').map(m => m.text) }));
    assert.ok(pending.binding, JSON.stringify(pending.errors));
    assert.deepEqual(pending.binding.origin, origin);
    await until('captured actual CODE draft response', () => events.find(e => e.kind === 'http-response' && e.pathname === '/api/m2/lifecycle/draft'));
    const preparedEvent = events.find(e => e.kind === 'http-response' && e.pathname === '/api/m2/lifecycle/draft');
    assert.equal(preparedEvent.status, 200); const prepared = preparedEvent.payload;
    assert.equal(prepared.state, 'awaiting_approval'); assert.equal(prepared.lifecycleId, pending.binding.lifecycleId);
    assert.equal(prepared.planDigest, pending.binding.planDigest); assert.deepEqual(prepared.plan.origin, origin);
    assert.deepEqual(prepared.diff.map(f => f.path), LEDGER_FILES.map(file => file.path).sort());
    for (const f of prepared.diff) {
      assert.equal(f.before.content, null);
      assert.equal(typeof f.after.content, 'string'); assert.ok(f.after.content.trim());
    }
    record.previewHashes = prepared.diff.map(f => ({ path: f.path, sha256: sha(f.after.content) }));
    save('PREPARED.json', prepared);
    assert.deepEqual(snapshot(projectPath), before); assert.equal(git(['rev-parse','HEAD'], projectPath), record.baselineHead);
    await page.evaluate(() => [...document.querySelectorAll('#intentsmith-studio2 button')]
      .find(n => n.textContent.trim() === 'Zobrazit změny').click());
    await page.waitForFunction(() => document.querySelectorAll('#intentsmith-studio2 .rp .fh-p').length === 6
      && [...document.querySelectorAll('#intentsmith-studio2 button')].some(n => n.textContent.trim() === 'Schválit' && !n.disabled && !n.classList.contains('soft')), { timeout: 30000 });
    const preview = await page.evaluate(() => ({
      metadata: document.querySelector('#intentsmith-studio2 .rp .fsec-e.mono')?.textContent,
      files: [...document.querySelectorAll('#intentsmith-studio2 .rp .fh')].map(button => ({
        path: button.querySelector('.fh-p').textContent,
        lines: [...(button.nextElementSibling?.querySelectorAll('.dfl.add .cd') || [])].map(n => n.textContent),
        deleted: [...(button.nextElementSibling?.querySelectorAll('.dfl.del .cd') || [])].map(n => n.textContent) })),
      pending: window._sessions[0]._m2Pending,
    }));
    assert.ok(preview.metadata.includes(prepared.lifecycleId)); assert.ok(preview.metadata.includes(prepared.planDigest));
    assert.deepEqual(preview.files.map(f => f.path), LEDGER_FILES.map(file => file.path).sort());
    for (const file of preview.files) {
      const after = prepared.diff.find(item => item.path === file.path)?.after.content;
      assert.deepEqual(file.lines, after.split('\n'), 'DOM exact physical CODE bytes including final newline ' + file.path);
      assert.deepEqual(file.deleted, [''], 'DOM empty before projection ' + file.path);
    }
    save('DOM-PREVIEW.json', preview); await page.screenshot({ path: path.join(art, '02-exact-preview.png') });
    assert.deepEqual(snapshot(projectPath), before);
    assert.equal(events.filter(e => e.kind === 'http-request' && e.pathname === '/api/m2/lifecycle/approve').length, 0);
    checkpoint('six-physical-file-preview-exact-unchanged-before-approval');
    await page.evaluate(() => [...document.querySelectorAll('#intentsmith-studio2 button')]
      .find(n => n.textContent.trim() === 'Schválit' && !n.disabled && !n.classList.contains('soft')).click());
    await until('actual approval response', () => events.find(e => e.kind === 'http-response' && e.pathname === '/api/m2/lifecycle/approve'), null, 180000);
    const approvedEvent = events.find(e => e.kind === 'http-response' && e.pathname === '/api/m2/lifecycle/approve');
    assert.equal(approvedEvent.status, 200); const terminal = approvedEvent.payload; save('TERMINAL.json', terminal);
    assert.equal(terminal.planDigest, prepared.planDigest); assert.equal(terminal.terminal.planDigest, prepared.planDigest);
    assert.deepEqual(terminal.plan.origin, origin);
    assert.equal(terminal.state, 'succeeded', JSON.stringify(terminal.result));
    assert.equal(terminal.terminal.state, 'succeeded');
    assert.equal(terminal.result.terminalStatus, 'succeeded'); assert.equal(terminal.result.focusedTest.terminalStatus, 'succeeded');
    assert.equal(terminal.result.git.status, 'committed'); assert.equal(terminal.audit.governanceReceipt.status, 'accepted');
    assert.deepEqual(terminal.plan.focusedTest.argv, [...ORACLE_ARGV]); assert.equal(terminal.plan.focusedTest.binary, node);
    const output = terminal.audit.executionEvents.find(e => e.type === 'process_terminated')?.details?.testOutput;
    assert.match(output?.stdout ?? '', /PROJECT_APP_ORACLE_PASS/); save('FOCUSED-TEST-OUTPUT.json', output);
    const actualApproval = events.filter(e => e.kind === 'http-request' && e.pathname === '/api/m2/lifecycle/approve');
    assert.equal(actualApproval.length, 1); assert.deepEqual(JSON.parse(actualApproval[0].postData),
      { lifecycleId: prepared.lifecycleId, planDigest: prepared.planDigest, origin });
    const actualDraft = events.filter(e => e.kind === 'http-request' && e.pathname === '/api/m2/lifecycle/draft');
    assert.equal(actualDraft.length, 1);
    assert.deepEqual(JSON.parse(actualDraft[0].postData), { projectId, origin, draft: submittedBlueprint },
      'real composer emitted exact frozen blueprint including Git metadata');
    assert.equal(events.some(e => e.kind === 'http-request' && e.pathname === '/chat'), false);
    assert.equal(events.some(e => e.kind === 'ws-sent' && ['m1.start','chat','chat:start','chat_turn'].includes(e.type)), false);
    for (const { path: relative, after } of prepared.diff) {
      const content = after.content;
      assert.equal(fs.readFileSync(path.join(projectPath, relative), 'utf8'), content);
      assert.deepEqual(execFileSync('/usr/bin/git', ['show', 'HEAD:' + relative], { cwd: projectPath }), Buffer.from(content));
    }
    for (const [relative, content] of Object.entries(frozen)) assert.equal(fs.readFileSync(path.join(projectPath, relative), 'utf8'), content);
    record.committedHead = git(['rev-parse','HEAD'], projectPath); assert.notEqual(record.committedHead, record.baselineHead);
    assert.equal(terminal.result.git.commitId, record.committedHead);
    assert.equal(git(['status','--porcelain=v1','--untracked-files=all'], projectPath), '');
    await page.waitForFunction(() => !window._sessions[0]._m2Pending && window._sessions[0]._modifiedFiles.length === 6, { timeout: 30000 });
    const domTerminal = await page.evaluate(() => {
      const pre = document.querySelector('#intentsmith-studio2 .rp pre');
      return { pending: window._sessions[0]._m2Pending, modifiedFiles: window._sessions[0]._modifiedFiles,
        evidence: pre ? JSON.parse(pre.textContent) : null, stateText: document.querySelector('#intentsmith-studio2 .rp .fsec-e.mono')?.textContent };
    });
    assert.equal(domTerminal.evidence?.terminal?.state, 'succeeded');
    assert.equal(domTerminal.evidence?.result?.git?.commitId, record.committedHead);
    save('DOM-TERMINAL.json', domTerminal); await page.screenshot({ path: path.join(art, '03-approved-functional-app.png') });
    save('PROJECT-AFTER.json', snapshot(projectPath));
    record.lifecycleId = prepared.lifecycleId; record.planDigest = prepared.planDigest;
    record.approvedFiles = prepared.diff.map(({ path: relative, after }) => ({ path: relative,
      bytes: Buffer.byteLength(after.content), sha256: sha(after.content) }));
    checkpoint('dom-approved-real-sandbox-test-and-git-commit');
    await browser.close(); browser = null;
    record.appExit = await Promise.race([app.completion, delay(15000).then(() => null)]);
    assert.equal(record.appExit?.exitCode, 0); assert.equal(record.appExit?.signal, null);
    record.backendExit = await stop(backend); assert.equal(record.backendExit.exitCode, 0); assert.equal(record.backendExit.forced, false);
    assert.equal(fs.existsSync(portFile), false);
    const restarted = start(node, ['src/server.js'], env, 'backend-restart');
    const restoredAccess = await until('private backend restart', () => readLocalAccess({ portFile }), restarted);
    const statusPath = '/api/m2/lifecycle/status?' + new URLSearchParams({ id: prepared.lifecycleId,
      surface: origin.surface, sessionId: origin.sessionId, conversationId: origin.conversationId,
      projectId: String(projectId) });
    const restoredResponse = await fetch(restoredAccess.backendUrl + statusPath,
      { headers: { 'X-IntentSmith-Local-Capability': restoredAccess.localCapability } });
    assert.equal(restoredResponse.status, 200, 'M2 status after real backend restart');
    const restored = await restoredResponse.json();
    assert.deepEqual(restored.terminal, terminal.terminal, 'durable terminal after backend restart');
    assert.deepEqual(restored.result, terminal.result, 'durable M2 result after backend restart');
    save('RESTART-STATUS.json', restored);
    record.backendRestartExit = await stop(restarted);
    assert.equal(record.backendRestartExit.exitCode, 0); assert.equal(record.backendRestartExit.forced, false);
    assert.equal(fs.existsSync(portFile), false);
    const reader = path.join(art, 'read-durable.mjs');
    fs.writeFileSync(reader, `import fs from 'node:fs';\nimport {createRequire} from 'node:module';\nconst cfg=JSON.parse(fs.readFileSync(process.argv[2]));\nconst require=createRequire(cfg.source+'/package.json');\nconst Database=require('better-sqlite3');\nconst db=new Database(cfg.db,{readonly:true,fileMustExist:true});\ndb.pragma('query_only=ON');\nconst operation=db.prepare('SELECT lifecycle_id,project_id,plan_digest,plan_json FROM m2_lifecycle_operations WHERE lifecycle_id=?').get(cfg.lifecycle);\nconst terminal=db.prepare('SELECT terminal_status,terminal_digest,terminal_json FROM m2_lifecycle_terminals WHERE lifecycle_id=?').get(cfg.lifecycle);\nconst approval=db.prepare('SELECT intent_json FROM m2_lifecycle_approval_intents WHERE lifecycle_id=?').get(cfg.lifecycle);\nconst turns=db.prepare('SELECT count(*) AS count FROM messages WHERE conversation_id=?').get(cfg.conversation);\nconst binding=db.prepare("SELECT model_name,digest_sha256 FROM model_desired_bindings WHERE role='CODE'").get();\nconst result={operation,terminal,approval,turns,binding,readonly:true,pid:process.pid};db.close();console.log(JSON.stringify(result));\n`, { mode: 0o600 });
    const readerConfig = { source, db: env.INTENTSMITH_DB_PATH, lifecycle: prepared.lifecycleId, conversation: conversation.id };
    save('DURABLE-CONFIG.json', readerConfig);
    const readResult = spawnSync(node, [reader, path.join(art, 'DURABLE-CONFIG.json')], { env, encoding: 'utf8', timeout: 30000 });
    assert.equal(readResult.status, 0, readResult.stderr); assert.equal(readResult.signal, null);
    const durable = JSON.parse(readResult.stdout); save('DURABLE-NEW-PROCESS.json', durable);
    assert.equal(durable.operation.plan_digest, prepared.planDigest); assert.deepEqual(JSON.parse(durable.operation.plan_json), prepared.plan);
    assert.equal(durable.terminal.terminal_status, 'succeeded'); assert.deepEqual(JSON.parse(durable.terminal.terminal_json), terminal.terminal);
    assert.equal(durable.turns.count, 0); assert.ok(durable.approval);
    assert.equal(durable.binding?.model_name, runConfig.model);
    assert.equal(durable.binding?.digest_sha256, runConfig.digest);
    record.durable = { readOnlyNewProcess: true, readerExitCode: readResult.status, readerPid: durable.pid,
      databasePath: env.INTENTSMITH_DB_PATH, noChatTurns: true, operationAndTerminalExact: true };
    record.status = 'PASS'; record.modelQuality = 'FUNCTIONAL_ORACLE_PASS';
    checkpoint('backend-restart-and-readonly-new-process-durable-pass');
  } catch (error) {
    record.error = String(error.stack || error); record.modelQuality = 'UNPROVEN_OR_FAILED'; process.exitCode = 1;
    try { if (page) { save('DOM-FAILURE.json', await page.evaluate(() => ({ text: document.body?.innerText,
      pending: window._sessions?.[0]?._m2Pending,
      formError: window._sessions?.[0]?.chat._m2Composer?.error || null,
      errors: window._sessions?.[0]?.chat.msgs.filter(m => m.tag === 'M2_ERROR') }))); await page.screenshot({ path: path.join(art, 'FAILURE.png') }); } } catch {}
  } finally {
    try { await browser?.close(); } catch {}
    await Promise.allSettled([...pendingResponses]);
    record.cleanup = { children: [] };
    for (const child of [...children].reverse()) record.cleanup.children.push({ pid: child.pid, result: await stop(child) });
    await delay(300); record.cleanup.remainingOwnedGroupProcesses = ownedGroups();
    if (record.cleanup.remainingOwnedGroupProcesses.length) {
      record.status = 'FAIL'; record.cleanup.error = 'OWNED_PROCESS_GROUP_REMAINS'; process.exitCode = 1;
    }
    fs.rmSync(shortTmp, { recursive: true, force: true }); record.cleanup.shortTmpRemoved = !fs.existsSync(shortTmp);
    const relayClosed = new Promise(resolve => relay.close(() => resolve(true)));
    relay.closeAllConnections();
    record.cleanup.relayDrain = await relayRequests.cancelAndSettle(10000);
    record.cleanup.relayErrors = relayErrors;
    let closeTimer;
    record.cleanup.relayClosed = await Promise.race([relayClosed,
      new Promise(resolve => { closeTimer = setTimeout(() => resolve(false), 10000); })]);
    clearTimeout(closeTimer);
    if (!record.cleanup.relayDrain.settled || record.cleanup.relayDrain.pending
      || !record.cleanup.relayClosed || relayErrors.length) {
      record.status = 'FAIL'; process.exitCode = 1;
    }
    record.cleanup.portFileRemoved = !fs.existsSync(portFile);
    save('NETWORK.json', events); record.actualDraftRequests = events.filter(e => e.kind === 'http-request' && e.pathname === '/api/m2/lifecycle/draft').length;
    record.actualApprovalRequests = events.filter(e => e.kind === 'http-request' && e.pathname === '/api/m2/lifecycle/approve').length;
    record.endedUtc = new Date().toISOString(); save('RESULT.json', record);
    console.log(JSON.stringify({ status: record.status, artifactRoot: art, error: record.error ?? record.cleanup.error ?? null }));
  }
}
