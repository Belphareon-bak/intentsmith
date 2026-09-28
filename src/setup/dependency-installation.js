import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { readProjectFileBytes } from '../executor/project-path-authority.js';
import { isLocalOperatorTransportSubject } from '../security/global-auth-policy.js';
import { inspectDevelopmentEnvironment } from './development-environment.js';
import { createDependencyDownloader, installationUrl } from './dependency-download.js';
import { runInstallationProcess, verifyInstalledTree, archiveInspectionArgs, publishInstallation } from './dependency-installer-process.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const MODES = new Set(['ask', 'automatic', 'disabled']);
const MAX_DOWNLOAD = 700_000_000;
const services = new WeakMap();
const fail = code => { throw Object.assign(Error(code), { code }); };
const requireLocal = subject => { if (!isLocalOperatorTransportSubject(subject)) fail('INSTALL_LOCAL_OPERATOR_REQUIRED'); };
const exists = async target => { try { await fs.lstat(target);return true; } catch (error) { if (error.code !== 'ENOENT') throw error;return false; } };

export function readInstallationPolicy(db) {
  try {
    const row = db.prepare('SELECT * FROM development_install_policy WHERE id=1').get();
    if (!row || !MODES.has(row.project_mode) || !MODES.has(row.sdk_mode)) fail('INSTALL_POLICY_INVALID');
    return { revision: row.revision, projectMode: row.project_mode, sdkMode: row.sdk_mode, systemMode: 'manual', valid: true };
  } catch { return { revision: null, projectMode: 'disabled', sdkMode: 'disabled', systemMode: 'manual', valid: false }; }
}

export function npmInstallationArtifacts(lock) {
  if (![2, 3].includes(lock?.lockfileVersion) || !lock.packages || typeof lock.packages !== 'object') fail('INSTALL_NPM_LOCK_REQUIRED');
  const artifacts = new Map();
  if (Object.keys(lock.packages).length > 301) fail('INSTALL_NPM_PACKAGE_LIMIT');
  for (const [location, pkg] of Object.entries(lock.packages)) {
    if (location === '') continue;
    if (!location.startsWith('node_modules/') || location.split('/').some(part => !part || part === '.' || part === '..')
        || /[\\\u0000]/.test(location) || pkg.link) fail('INSTALL_NPM_LINK_DENIED');
    if (typeof pkg.resolved !== 'string' || typeof pkg.integrity !== 'string'
        || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(pkg.integrity)) fail('INSTALL_NPM_INTEGRITY_REQUIRED');
    const url = installationUrl(pkg.resolved);
    if (url.hostname !== 'registry.npmjs.org' || !url.pathname.endsWith('.tgz')) fail('INSTALL_NPM_SOURCE_DENIED');
    const previous = artifacts.get(pkg.resolved);
    if (previous && previous.integrity !== pkg.integrity) fail('INSTALL_NPM_INTEGRITY_CONFLICT');
    artifacts.set(pkg.resolved, { url: pkg.resolved, integrity: pkg.integrity, version: pkg.version, copies: (previous?.copies || 0) + 1,
      name: location.slice(location.lastIndexOf('node_modules/') + 13), installScript: pkg.hasInstallScript === true });
    if (artifacts.size > 300) fail('INSTALL_NPM_PACKAGE_LIMIT');
  }
  return [...artifacts.values()].sort((a, b) => a.url.localeCompare(b.url));
}

export function dotnetArtifact(metadata, version, architecture) {
  const rid = 'linux-' + ({ x64: 'x64', arm64: 'arm64' }[architecture] || fail('INSTALL_DOTNET_ARCH_UNSUPPORTED'));
  const sdks = (metadata.releases || []).flatMap(release => [release.sdk, ...(release.sdks || [])]).filter(Boolean);
  const file = sdks.find(sdk => sdk.version === version)?.files?.find(item => item.rid === rid && item.name?.endsWith('.tar.gz'));
  const expected = `https://builds.dotnet.microsoft.com/dotnet/Sdk/${version}/dotnet-sdk-${version}-${rid}.tar.gz`;
  if (!file || file.url !== expected || !/^[a-f0-9]{128}$/i.test(file.hash)) fail('INSTALL_DOTNET_RELEASE_UNVERIFIED');
  return { url: expected, sha512: file.hash.toLowerCase() };
}

export function createDependencyInstallationService({ db, download = createDependencyDownloader(),
  run = runInstallationProcess, inspect = inspectDevelopmentEnvironment, clock = Date.now } = {}) {
  if (services.has(db)) return services.get(db);
  const active = new Map();
  const audit = (id, actor, kind, detail) => db.prepare(`INSERT INTO development_install_events
    (installation_id,actor_id,kind,occurred_at,detail_json) VALUES(?,?,?,?,?)`).run(id, actor, kind, clock(), JSON.stringify(detail));
  // A restarted service does not repeat a download or claim an interrupted
  // publication succeeded. The staging/publication event remains for recovery.
  db.transaction(() => {
    for (const row of db.prepare("SELECT id,actor_id FROM development_installations WHERE state='running'").all()) {
      db.prepare("UPDATE development_installations SET state='interrupted' WHERE id=?").run(row.id);
      audit(row.id, row.actor_id, 'interrupted', { reason: 'service_restarted', automaticRetry: false });
    }
  })();
  const policy = () => readInstallationPolicy(db);
  const load = (id, subject) => {
    requireLocal(subject);
    const row = db.prepare('SELECT * FROM development_installations WHERE id=? AND actor_id=?').get(id, subject.actorId);
    if (!row) fail('INSTALL_PLAN_NOT_FOUND');return row;
  };
  const view = row => ({ id: row.id, state: row.state, digest: row.plan_digest, expiresAt: row.expires_at,
    plan: (() => { const plan = JSON.parse(row.plan_json);return { ...plan,
      manifests: plan.manifests.map(({ content, ...manifest }) => manifest) }; })(), result: row.result_json ? JSON.parse(row.result_json) : null,
    events: db.prepare('SELECT seq,kind,occurred_at AS occurredAt,detail_json FROM development_install_events WHERE installation_id=? ORDER BY seq').all(row.id)
      .map(({ detail_json, ...event }) => ({ ...event, detail: JSON.parse(detail_json) })) });
  async function projectRoot(id) {
    if (!Number.isSafeInteger(id) || id <= 0) fail('INSTALL_PROJECT_REQUIRED');
    const project = db.prepare('SELECT path FROM projects WHERE id=?').get(id);
    if (!project?.path) fail('INSTALL_PROJECT_NOT_FOUND');
    const root = await fs.realpath(project.path);
    if (!(await fs.lstat(root)).isDirectory() || root === path.parse(root).root || root === os.homedir()) fail('INSTALL_PROJECT_ROOT_DENIED');
    return root;
  }
  function snapshot(root, name, optional = false) {
    try {
      const observed = readProjectFileBytes(root, name, { maxBytes: 4_000_000, requireCanonicalTarget: true, rejectHardlinks: true });
      if (!observed.exists) {
        if (optional) return null;
        fail(name === 'package-lock.json' ? 'INSTALL_NPM_LOCK_REQUIRED' : 'INSTALL_MANIFEST_REQUIRED');
      }
      return { path: name, digest: sha(observed.bytes), content: observed.bytes.toString('utf8') };
    } catch (error) { if (optional && (error.code === 'ENOENT' || error.reason === 'target_missing')) return null;throw error; }
  }
  async function validateCurrent(plan) {
    if (await projectRoot(plan.projectId) !== plan.root) fail('INSTALL_PROJECT_CHANGED');
    for (const file of plan.manifests) if (snapshot(plan.root, file.path).digest !== file.digest) fail('INSTALL_MANIFEST_CHANGED');
    if (await exists(plan.destination)) fail('INSTALL_TARGET_EXISTS');
    const targetParent = path.dirname(plan.destination);
    if (await fs.realpath(targetParent) !== targetParent) fail('INSTALL_TARGET_PARENT_CHANGED');
  }
  const service = {
    policy,
    list(subject) {
      requireLocal(subject);
      return db.prepare('SELECT * FROM development_installations WHERE actor_id=? ORDER BY created_at DESC LIMIT 20').all(subject.actorId).map(view);
    },
    abortAll() { for (const controller of active.values()) controller.abort(); },
    setPolicy(input, subject) {
      requireLocal(subject);
      if (!input || Object.keys(input).sort().join(',') !== 'projectMode,revision,sdkMode'
          || !MODES.has(input.projectMode) || !MODES.has(input.sdkMode)) fail('INSTALL_POLICY_INPUT_INVALID');
      return db.transaction(() => {
        const current = policy();
        if (!current.valid || current.revision !== input.revision) fail('INSTALL_POLICY_STALE');
        db.prepare('UPDATE development_install_policy SET project_mode=?,sdk_mode=?,revision=revision+1,updated_at=? WHERE id=1')
          .run(input.projectMode, input.sdkMode, clock());
        audit(null, subject.actorId, 'policy_changed', { before: current, after: policy() });
        for (const controller of active.values()) controller.abort();
        return policy();
      }).immediate();
    },
    async prepare(input, subject) {
      requireLocal(subject);
      if (!input || !['npm', 'dotnet'].includes(input.kind)
          || Object.keys(input).some(key => !['kind', 'projectId', 'version'].includes(key))) fail('INSTALL_INPUT_INVALID');
      const current = policy(), mode = input.kind === 'npm' ? current.projectMode : current.sdkMode;
      if (!current.valid || mode === 'disabled') fail('INSTALL_POLICY_DISABLED');
      const root = await projectRoot(input.projectId), environment = await inspect({ refresh: true });
      if (environment.platform !== 'linux' || !environment.tools.bwrap || !environment.tools.python3 || !environment.tools.prlimit) fail('INSTALL_SANDBOX_UNAVAILABLE');
      for (const binary of ['/usr/bin/bwrap', '/usr/bin/python3', '/usr/bin/prlimit', '/usr/bin/tar']) {
        if (!await exists(binary)) fail('INSTALL_SANDBOX_UNAVAILABLE');
      }
      const manifests = [], plan = { kind: input.kind, projectId: input.projectId, root, manifests,
        platform: environment.platform, architecture: environment.architecture, maxDownloadBytes: MAX_DOWNLOAD,
        scriptsAllowed: false, automatic: mode === 'automatic', autoEligible: true };
      if (input.kind === 'npm') {
        if (!environment.tools.npm) fail('INSTALL_NPM_UNAVAILABLE');
        manifests.push(snapshot(root, 'package.json'), snapshot(root, 'package-lock.json'));
        const manifest = JSON.parse(manifests[0].content);
        if (manifest.workspaces) fail('INSTALL_NPM_WORKSPACES_UNSUPPORTED');
        plan.artifacts = npmInstallationArtifacts(JSON.parse(manifests[1].content));
        plan.npm = environment.tools.npm;
        plan.destination = path.join(root, 'node_modules');
        plan.command = 'npm ci --offline --ignore-scripts --no-audit --no-fund';
        plan.limitations = 'Instalační skripty se nespouštějí. Nativní doplňky a Electron mohou vyžadovat další samostatný krok. Existující node_modules se nepřepisuje.';
      } else {
        if (typeof input.version !== 'string' || input.version !== input.version.trim()
            || !/^(?:[1-9]\d*)\.\d+\.\d{3}$/.test(input.version)) fail('INSTALL_DOTNET_EXACT_VERSION_REQUIRED');
        if (!['x64', 'arm64'].includes(environment.architecture)) fail('INSTALL_DOTNET_ARCH_UNSUPPORTED');
        const global = snapshot(root, 'global.json', true);
        if (global) manifests.push(global);
        plan.autoEligible = !!global && JSON.parse(global.content).sdk?.version === input.version;
        plan.version = input.version;
        plan.metadataUrl = `https://builds.dotnet.microsoft.com/dotnet/release-metadata/${input.version.split('.').slice(0, 2).join('.')}/releases.json`;
        plan.archiveUrl = `https://builds.dotnet.microsoft.com/dotnet/Sdk/${input.version}/dotnet-sdk-${input.version}-linux-${environment.architecture}.tar.gz`;
        // Project-local SDK avoids shell profile edits, sudo and shared SDK replacement.
        plan.destination = path.join(root, '.intentsmith-dotnet-' + input.version);
        plan.command = 'Ověřit SHA-512 oficiálního archivu, rozbalit izolovaně a ověřit dotnet --info';
        plan.limitations = 'SDK zůstane v tomto projektu. Systémové knihovny a Windows GUI nejsou součástí instalace.';
      }
      await validateCurrent(plan);
      const id = 'install:' + randomUUID(), serialized = JSON.stringify(plan), digest = sha(serialized), now = clock();
      db.transaction(() => {
        if (policy().revision !== current.revision) fail('INSTALL_POLICY_STALE');
        db.prepare(`INSERT INTO development_installations VALUES(?,?,?,?,?,?,?,?,?,?)`)
          .run(id, subject.actorId, input.projectId, serialized, digest, current.revision, now, now + 600_000, 'pending', null);
        audit(id, subject.actorId, 'prepared', { digest, policyRevision: current.revision, downloadsStarted: false });
      }).immediate();
      return view(load(id, subject));
    },
    status(id, subject) { return view(load(id, subject)); },
    cancel(id, subject) {
      const row = load(id, subject);
      if (row.state === 'pending') db.prepare("UPDATE development_installations SET state='cancelled' WHERE id=? AND state='pending'").run(id);
      else if (row.state === 'running') active.get(id)?.abort();
      audit(id, subject.actorId, 'cancel_requested', {});return view(load(id, subject));
    },
    async execute(input, subject) {
      if (!input || Object.keys(input).sort().join(',') !== 'approval,digest,id'
          || typeof input.id !== 'string' || typeof input.digest !== 'string' || typeof input.approval !== 'boolean') fail('INSTALL_INPUT_INVALID');
      const row = load(input?.id, subject), plan = JSON.parse(row.plan_json);
      if (input.digest !== row.plan_digest) fail('INSTALL_PLAN_DIGEST_MISMATCH');
      if (row.state !== 'pending') return view(row);
      await validateCurrent(plan);
      const controller = new AbortController(), signal = controller.signal;
      const assertPolicy = () => {
        signal.throwIfAborted(); const current = policy(), mode = plan.kind === 'npm' ? current.projectMode : current.sdkMode;
        if (!current.valid || current.revision !== row.policy_revision || mode === 'disabled') fail('INSTALL_POLICY_STALE');
      };
      db.transaction(() => {
        assertPolicy();
        if (clock() > row.expires_at) fail('INSTALL_PLAN_EXPIRED');
        if (input.approval !== true && !(plan.automatic && plan.autoEligible)) fail('INSTALL_APPROVAL_REQUIRED');
        if (db.prepare("SELECT 1 FROM development_installations WHERE state='running'").get()) fail('INSTALL_BUSY');
        const claim = db.prepare("UPDATE development_installations SET state='running' WHERE id=? AND state='pending'").run(row.id);
        if (claim.changes !== 1) fail('INSTALL_ALREADY_CLAIMED');
        audit(row.id, subject.actorId, 'authorized', { digest: row.plan_digest, authority: input.approval === true ? 'exact_user_approval' : 'installation_policy', policyRevision: row.policy_revision });
      }).immediate();
      active.set(row.id, controller);
      const deadline = setTimeout(() => controller.abort(), 600_000);
      const log = (kind, details) => audit(row.id, subject.actorId, kind, details);
      let stage, published = false;
      try {
        const free = await fs.statfs(plan.root);
        if (free.bavail * free.bsize < 8_000_000_000) fail('INSTALL_INSUFFICIENT_DISK');
        stage = await fs.mkdtemp(path.join(plan.root, '.intentsmith-install-'));await fs.chmod(stage, 0o700);
        log('staging_created', { stage });
        for (const name of ['project', 'home', 'cache', 'downloads', 'sdk']) await fs.mkdir(path.join(stage, name));
        const command = (binary, argv) => { assertPolicy();return run({ stage, binary, argv, signal, audit: log }); };
        let downloaded = 0;
        const get = async (url, name, limit) => {
          assertPolicy(); const destination = path.join(stage, 'downloads', name);
          const receipt = await download({ url, destination, maxBytes: Math.min(limit, MAX_DOWNLOAD - downloaded), signal, beforeConnect: assertPolicy, audit: log });
          downloaded += receipt.bytes;return { destination, receipt };
        };
        let ready, expandedBytes = 0;
        const inspectArchive = async (name, copies = 1) => {
          const receipt = await command('/usr/bin/prlimit', archiveInspectionArgs('/work/downloads/' + name));
          const limits = JSON.parse(receipt.output);
          expandedBytes += limits.bytes * copies;
          if (expandedBytes > 2_000_000_000) fail('INSTALL_DISK_LIMIT');
          log('archive_layout_verified', { name, ...limits, copies });
        };
        if (plan.kind === 'npm') {
          for (const file of plan.manifests) await fs.writeFile(path.join(stage, 'project', file.path), file.content, { mode: 0o600 });
          for (const [index, artifact] of plan.artifacts.entries()) {
            const { receipt } = await get(artifact.url, `${index}.tgz`, 100_000_000);
            if ('sha512-' + Buffer.from(receipt.sha512, 'hex').toString('base64') !== artifact.integrity) fail('INSTALL_ARCHIVE_INTEGRITY_MISMATCH');
            await inspectArchive(`${index}.tgz`, artifact.copies);
            await command(process.execPath, [plan.npm, 'cache', 'add', `/work/downloads/${index}.tgz`, '--offline', '--ignore-scripts']);
          }
          await command(process.execPath, [plan.npm, 'ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund']);
          ready = path.join(stage, 'project', 'node_modules');
          if (!await exists(ready) && plan.artifacts.length === 0) await fs.mkdir(ready);
        } else {
          const { destination } = await get(plan.metadataUrl, 'release.json', 8_000_000);
          const artifact = dotnetArtifact(JSON.parse(await fs.readFile(destination, 'utf8')), plan.version, plan.architecture);
          const { receipt } = await get(artifact.url, 'sdk.tar.gz', 650_000_000);
          if (receipt.sha512 !== artifact.sha512) fail('INSTALL_ARCHIVE_INTEGRITY_MISMATCH');
          log('archive_integrity_verified', { url: artifact.url, sha512: artifact.sha512 });
          await inspectArchive('sdk.tar.gz');
          await command('/usr/bin/tar', ['--extract', '--gzip', '--no-same-owner', '--no-same-permissions', '--file', '/work/downloads/sdk.tar.gz', '--directory', '/work/sdk']);
          await command('/work/sdk/dotnet', ['--info']);ready = path.join(stage, 'sdk');
        }
        const tree = await verifyInstalledTree(ready);
        assertPolicy();await validateCurrent(plan);
        log('publication_intent', { destination: plan.destination, staging: ready, ...tree });
        await publishInstallation(ready, plan.destination);published = true;
        const directory = await fs.open(plan.root, 'r');try { await directory.sync(); } finally { await directory.close(); }
        const result = { destination: plan.destination, downloadedBytes: downloaded, ...tree, scriptsExecuted: false,
          ...(plan.kind === 'dotnet' ? { executable: path.join(plan.destination, 'dotnet') } : {}), limitations: plan.limitations };
        db.transaction(() => {
          log('succeeded', result);
          db.prepare("UPDATE development_installations SET state='succeeded',result_json=? WHERE id=? AND state='running'").run(JSON.stringify(result), row.id);
        }).immediate();
      } catch (error) {
        const state = published ? 'interrupted' : signal.aborted ? 'cancelled' : 'failed';
        const result = { error: error.code || error.message, published, destination: plan.destination,
          ...(published ? { recovery: 'Soubory již byly zveřejněny, ale dokončení není potvrzené. Automaticky neopakovat.' } : {}) };
        db.transaction(() => {
          log(state, result);
          db.prepare('UPDATE development_installations SET state=?,result_json=? WHERE id=?').run(state, JSON.stringify(result), row.id);
        }).immediate();
      } finally {
        clearTimeout(deadline);
        active.delete(row.id);
        if (stage) await fs.rm(stage, { recursive: true, force: true }).catch(error => log('staging_cleanup_failed', { stage, code: error.code }));
      }
      return view(load(row.id, subject));
    },
  };
  services.set(db, service);return service;
}
