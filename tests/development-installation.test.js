import './helpers/isolated-test-db.js';
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { up } from '../src/db/migrations/2026_09_23_117_development_installations.js';
import { createDependencyInstallationService, npmInstallationArtifacts, dotnetArtifact, readInstallationPolicy } from '../src/setup/dependency-installation.js';
import { createGlobalAuthAuthority } from '../src/security/global-auth-policy.js';
import { inspectDevelopmentEnvironment, developmentEnvironmentPrompt } from '../src/setup/development-environment.js';
import { runInstallationProcess, archiveInspectionArgs, publishInstallation } from '../src/setup/dependency-installer-process.js';
import { createDevelopmentRoutes } from '../src/routes/development.js';

const subject = createGlobalAuthAuthority({ production: false }).authorize({ routeKey: 'POST /api/chat', headers: {}, remoteAddress: '127.0.0.1' }).subject;
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'intentsmith-install-test-'));
const hash = bytes => createHash('sha512').update(bytes).digest('hex');
const integrity = bytes => 'sha512-' + Buffer.from(hash(bytes), 'hex').toString('base64');
const archiveRoot = path.join(root, 'archive');await fs.mkdir(path.join(archiveRoot, 'package'), { recursive: true });
await fs.writeFile(path.join(archiveRoot, 'package', 'package.json'), JSON.stringify({ name: 'intent-install-fixture', version: '1.0.0', scripts: { install: 'node -e "require(\'fs\').writeFileSync(\'INSTALL_SCRIPT_RAN\',\'bad\')"' } }));
await fs.writeFile(path.join(archiveRoot, 'package', 'index.js'), 'module.exports = 42;\n');
const tar = execFileSync('/usr/bin/tar', ['czf', '-', '-C', archiveRoot, 'package']);
const url = 'https://registry.npmjs.org/intent-install-fixture/-/intent-install-fixture-1.0.0.tgz';
const lock = { name: 'fixture', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'fixture', version: '1.0.0', dependencies: { 'intent-install-fixture': '1.0.0' } },
  'node_modules/intent-install-fixture': { version: '1.0.0', resolved: url, integrity: integrity(tar), hasInstallScript: true } } };
const databases = [];
after(async () => { for (const db of databases) db.close();await fs.rm(root, { recursive: true, force: true }); });
async function fixture(overrides = {}) {
  const project = await fs.mkdtemp(path.join(root, 'project-'));
  await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: { 'intent-install-fixture': '1.0.0' } }));
  await fs.writeFile(path.join(project, 'package-lock.json'), JSON.stringify(lock));
  const db = new Database(':memory:');databases.push(db);
  db.exec('PRAGMA foreign_keys=ON;CREATE TABLE projects(id INTEGER PRIMARY KEY,path TEXT NOT NULL);');up(db);
  db.prepare('INSERT INTO projects VALUES(1,?)').run(project);
  const calls = [];
  const service = createDependencyInstallationService({ db, download: async options => {
    options.beforeConnect(); calls.push(options.url);
    await fs.writeFile(options.destination, tar, { flag: 'wx' });return { bytes: tar.length, sha512: hash(tar) };
  }, ...overrides });
  const prepare = () => service.prepare({ projectId: 1, kind: 'npm' }, subject);
  return { service, db, project, calls, prepare };
}
const request = plan => ({ id: plan.id, digest: plan.digest, approval: true });

test('host observations are current, read-only and explicit about missing tools and cross-platform builds', async () => {
  const environment = await inspectDevelopmentEnvironment({ refresh: true });
  assert.equal(environment.platform, process.platform);assert.equal(environment.runtime.executable, process.execPath);
  assert.equal(environment.permissions.automaticElevation, false);assert.ok(environment.observedAtMs <= Date.now());
  environment.tools.npm = 'tampered';assert.notEqual((await inspectDevelopmentEnvironment()).tools.npm, 'tampered');
  assert.match(await developmentEnvironmentPrompt(), /Host OS is not project target/);
});
test('policy defaults to confirmation, malformed/absent storage fails closed, local transport identity is mandatory', async () => {
  const f = await fixture();assert.equal(f.service.policy().projectMode, 'ask');assert.equal(f.service.policy().sdkMode, 'ask');
  assert.equal(readInstallationPolicy(new Database(':memory:')).valid, false);
  for (const forged of [null, { actorType: 'user', actorId: 'local-operator' }]) {
    await assert.rejects(f.service.prepare({ projectId: 1, kind: 'npm' }, forged), /LOCAL_OPERATOR_REQUIRED/);
    assert.throws(() => f.service.setPolicy({ revision: 1, projectMode: 'automatic', sdkMode: 'automatic' }, forged), /LOCAL_OPERATOR_REQUIRED/);
  }
  assert.equal(f.calls.length, 0);
});
test('prepare performs no download/write, exact approval is required and manifest contents are not exposed', async () => {
  const f = await fixture(), plan = await f.prepare();assert.equal(plan.state, 'pending');assert.equal(f.calls.length, 0);
  assert.equal(plan.plan.manifests[0].content, undefined);
  assert.equal((await fs.readdir(f.project)).length, 2);
  await assert.rejects(f.service.execute({ ...request(plan), approval: false }, subject), /APPROVAL_REQUIRED/);
  await assert.rejects(f.service.execute({ ...request(plan), digest: 'forged' }, subject), /DIGEST_MISMATCH/);
  await assert.rejects(f.service.execute({ ...request(plan), approval: 'true' }, subject), /INPUT_INVALID/);
  assert.equal(f.calls.length, 0);assert.equal(f.service.status(plan.id, subject).state, 'pending');
});
test('actual offline npm install produces usable module, ignores install script, records process evidence and is not replayed', async () => {
  const f = await fixture(), plan = await f.prepare(), result = await f.service.execute(request(plan), subject);
  assert.equal(result.state, 'succeeded', JSON.stringify({result:result.result,events:result.events}));
  assert.equal(await fs.readFile(path.join(f.project, 'node_modules/intent-install-fixture/index.js'), 'utf8'), 'module.exports = 42;\n');
  await assert.rejects(fs.stat(path.join(f.project, 'node_modules/intent-install-fixture/INSTALL_SCRIPT_RAN')), { code: 'ENOENT' });
  assert.ok(result.events.some(e => e.kind === 'process_terminated' && e.detail.exitCode === 0));
  assert.ok(result.events.some(e => e.kind === 'archive_layout_verified'));assert.equal(f.calls.length, 1);
  assert.equal((await f.service.execute(request(plan), subject)).state, 'succeeded');assert.equal(f.calls.length, 1);
  await assert.rejects(f.prepare(), /TARGET_EXISTS/);
  assert.throws(() => f.db.prepare('UPDATE development_install_events SET kind=?').run('fake'), /append-only/);
  assert.throws(() => f.db.prepare('UPDATE development_installations SET plan_digest=?').run('fake'), /immutable/);
});
test('automatic policy authorizes a concrete locked plan; stale policy and changed manifest are rejected without network', async () => {
  const f = await fixture();f.service.setPolicy({ revision: 1, projectMode: 'automatic', sdkMode: 'ask' }, subject);
  let plan = await f.prepare();assert.equal(plan.plan.automatic, true);
  await fs.appendFile(path.join(f.project, 'package.json'), ' ');
  await assert.rejects(f.service.execute({ ...request(plan), approval: false }, subject), /MANIFEST_CHANGED/);assert.equal(f.calls.length, 0);
  plan = await f.prepare();f.service.setPolicy({ revision: 2, projectMode: 'disabled', sdkMode: 'ask' }, subject);
  await assert.rejects(f.service.execute(request(plan), subject), /POLICY_STALE/);assert.equal(f.calls.length, 0);
  await assert.rejects(f.prepare(), /POLICY_DISABLED/);
  const other = await fixture();other.service.setPolicy({ revision: 1, projectMode: 'automatic', sdkMode: 'ask' }, subject);
  const ready = await other.prepare();assert.equal((await other.service.execute({ ...request(ready), approval: false }, subject)).state, 'succeeded');
});
test('policy revocation stops an in-flight download; singleton composition cannot reset live work', async () => {
  let began, release;const started = new Promise(r => began = r), hold = new Promise(r => release = r);
  const f = await fixture({ download: async ({ signal, beforeConnect }) => { began();await hold;beforeConnect();signal.throwIfAborted();throw Error('must stop'); } });
  const plan = await f.prepare(), running = f.service.execute(request(plan), subject);await started;
  assert.equal(createDependencyInstallationService({ db: f.db }), f.service);
  f.service.setPolicy({ revision: 1, projectMode: 'disabled', sdkMode: 'disabled' }, subject);release();
  assert.equal((await running).state, 'cancelled');await assert.rejects(fs.stat(path.join(f.project, 'node_modules')), { code: 'ENOENT' });
  assert.equal((await fs.readdir(f.project)).filter(x => x.startsWith('.intentsmith-install-')).length, 0);
});
test('download integrity failure never runs packages or publishes files', async () => {
  let commands = 0;
  const f = await fixture({ download: async () => ({ bytes: 1, sha512: '0'.repeat(128) }), run: async () => { commands++; } });
  const result = await f.service.execute(request(await f.prepare()), subject);
  assert.equal(result.state, 'failed');assert.equal(result.result.error, 'INSTALL_ARCHIVE_INTEGRITY_MISMATCH');assert.equal(commands, 0);
  await assert.rejects(fs.stat(path.join(f.project, 'node_modules')), { code: 'ENOENT' });
});
test('non-public/custom/file/git sources, missing integrity, links and too many packages are rejected', () => {
  for (const patch of [{ resolved: 'http://registry.npmjs.org/a.tgz' }, { resolved: 'https://127.0.0.1/a.tgz' },
    { resolved: 'https://custom.example/a.tgz' }, { resolved: 'git+https://github.com/a/b' }, { integrity: '' }, { link: true }]) {
    const next = structuredClone(lock);Object.assign(next.packages['node_modules/intent-install-fixture'], patch);
    assert.throws(() => npmInstallationArtifacts(next));
  }
  const next = structuredClone(lock);next.packages['node_modules/../escape'] = next.packages['node_modules/intent-install-fixture'];assert.throws(() => npmInstallationArtifacts(next));
});
test('SDK automatic mode requires exact manifest version; metadata cannot redirect SDK download', async () => {
  const f = await fixture();f.service.setPolicy({ revision: 1, projectMode: 'ask', sdkMode: 'automatic' }, subject);
  const plan = await f.service.prepare({ projectId: 1, kind: 'dotnet', version: '10.0.100' }, subject);
  assert.equal(plan.plan.autoEligible, false);await assert.rejects(f.service.execute({ ...request(plan), approval: false }, subject), /APPROVAL_REQUIRED/);
  await fs.writeFile(path.join(f.project, 'global.json'), JSON.stringify({ sdk: { version: '10.0.100' } }));
  assert.equal((await f.service.prepare({ projectId: 1, kind: 'dotnet', version: '10.0.100' }, subject)).plan.autoEligible, true);
  const metadata = { releases: [{ sdk: { version: '10.0.100', files: [{ rid: 'linux-x64', name: 'dotnet-sdk-linux-x64.tar.gz', url: plan.plan.archiveUrl, hash: 'a'.repeat(128) }] } }] };
  assert.equal(dotnetArtifact(metadata, '10.0.100', 'x64').url, plan.plan.archiveUrl);
  metadata.releases[0].sdk.files[0].url = 'https://evil.example/sdk.tar.gz';assert.throws(() => dotnetArtifact(metadata, '10.0.100', 'x64'), /UNVERIFIED/);
});
test('real sandbox cannot read host HOME or connect to host network; archive links and no-replace races fail safely', async () => {
  const stage = await fs.mkdtemp(path.join(root, 'sandbox-'));
  for (const name of ['project', 'home', 'cache', 'downloads']) await fs.mkdir(path.join(stage, name));
  const probe = await runInstallationProcess({ stage, binary: '/usr/bin/python3', argv: ['-I', '-c', `import os,socket\nassert not os.path.exists(${JSON.stringify(os.homedir() + '/.ssh')})\ns=socket.socket()\nassert s.connect_ex(('127.0.0.1',22)) != 0\nprint('isolated')`], audit() {} });
  assert.match(probe.output, /isolated/);
  await fs.symlink('/etc/passwd', path.join(stage, 'project/unsafe'));
  await fs.writeFile(path.join(stage, 'downloads/unsafe.tgz'), execFileSync('/usr/bin/tar', ['czf', '-', '-C', path.join(stage, 'project'), 'unsafe']));
  await assert.rejects(runInstallationProcess({ stage, binary: '/usr/bin/prlimit', argv: archiveInspectionArgs('/work/downloads/unsafe.tgz'), audit() {} }), error => /INSTALL_ARCHIVE_TYPE_DENIED/.test(error.receipt?.output));
  const destination = path.join(stage, 'existing');await fs.mkdir(destination);
  await assert.rejects(publishInstallation(path.join(stage, 'project'), destination));assert.ok(await fs.stat(path.join(stage, 'project/unsafe')));
});
test('HTTP routes require real local transport, publish policy errors and expose durable status', async () => {
  const f = await fixture(), routes = createDevelopmentRoutes({ db: f.db, parseBody: async req => req.body, sendJSON: (_res, status, value) => ({ status, value }), installationService: f.service });
  assert.equal((await routes['GET /api/development/policy']({ authenticatedSubject: { actorType: 'user', actorId: 'local-operator' } })).status, 403);
  const response = await routes['POST /api/development/prepare']({ authenticatedSubject: subject, body: { projectId: 1, kind: 'npm' } });
  assert.equal(response.status, 200);assert.equal(response.value.state, 'pending');assert.equal(f.calls.length, 0);
  assert.equal((await routes['POST /api/development/execute']({ authenticatedSubject: subject, body: { ...request(response.value), approval: false } })).status, 409);
});
