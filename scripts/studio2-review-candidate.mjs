#!/usr/bin/env node
// Open a packaged candidate with its own persistent data. Never start or
// replace the installed service; the model provider is deliberately disconnected.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hashDesktopExecutable, resolveElectronSandboxArgs } from './desktop-runtime.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function runReviewCandidate(config, { check = false, inspect = false } = {}) {
  if (process.versions.node.split('.')[0] !== '24') throw Error('Use Node 24.');
  for (const key of ['packageDirectory', 'profileDirectory', 'sandboxConfigDirectory']) {
    if (!path.isAbsolute(config[key] || '') || path.normalize(config[key]) !== config[key]) throw Error('Invalid candidate path.');
  }
  const pkg = config.packageDirectory, profile = config.profileDirectory;
  if (profile === pkg || profile.startsWith(pkg + path.sep)) throw Error('The review profile must be separate from the package.');
  const source = path.join(pkg, 'source'), image = path.join(pkg, 'IntentSmith-Studio2.AppImage');
  const metadata = JSON.parse(await fs.readFile(path.join(pkg, 'SOURCE.json'), 'utf8'));
  if (!/^[a-f0-9]{40}$/.test(metadata.sourceRevision || '')
    || metadata.appImage?.buildSourceRevision !== metadata.sourceRevision
    || !/^[a-f0-9]{64}$/.test(metadata.appImage?.sha256 || '')
    || await hashDesktopExecutable(image) !== metadata.appImage.sha256) throw Error('Candidate AppImage identity mismatch.');
  const marker = path.join(profile, 'REVIEW-PROFILE.json');
  try {
    await fs.mkdir(profile, { mode: 0o700 });
    await fs.writeFile(marker, JSON.stringify({ kind: 'IDE_REVIEW_ISOLATED', sourceRevision: metadata.sourceRevision }) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const owner = await fs.lstat(profile);
  const owned = JSON.parse(await fs.readFile(marker, 'utf8'));
  if (!owner.isDirectory() || owner.isSymbolicLink() || await fs.realpath(profile) !== profile
    || owner.uid !== process.getuid() || (owner.mode & 0o077)
    || owned.kind !== 'IDE_REVIEW_ISOLATED' || owned.sourceRevision !== metadata.sourceRevision) throw Error('Candidate profile ownership mismatch.');
  const dirs = Object.fromEntries(['home', 'config', 'cache', 'data', 'state', 'projects', 'electron'].map(name => [name, path.join(profile, name)]));
  for (const dir of Object.values(dirs)) await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const temporary = await fs.mkdtemp('/tmp/is-ide-review-');
  const portFile = path.join(temporary, 'backend.port.json'), database = path.join(dirs.data, 'intentsmith.sqlite');
  const installationFile = path.join(dirs.config, 'installation.json');
  await fs.writeFile(installationFile, JSON.stringify({ schemaVersion: 1, revision: metadata.sourceRevision,
    sourceRoot: source, node: process.execPath, dbPath: database, projectsDirectory: dirs.projects,
    configDirectory: dirs.config, stateDirectory: dirs.state }) + '\n', { mode: 0o600 });
  await fs.writeFile(path.join(dirs.state, 'code-pilot-automation-hold.json'), JSON.stringify({ active: true,
    reason: 'Samostatný kandidát IDE; automatika se zde nespouští.' }) + '\n', { mode: 0o600 });
  const forwarded = ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'LANG', 'LC_ALL', 'LC_CTYPE'];
  const env = { ...Object.fromEntries(forwarded.filter(key => process.env[key]).map(key => [key, process.env[key]])),
    PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', HOME: dirs.home, XDG_CONFIG_HOME: dirs.config,
    XDG_CACHE_HOME: dirs.cache, XDG_DATA_HOME: dirs.data, XDG_STATE_HOME: dirs.state, TMPDIR: temporary,
    NODE_ENV: 'production', DOTENV_CONFIG_PATH: path.join(profile, 'no-dotenv'), DOTENV_CONFIG_QUIET: 'true',
    INTENTSMITH_HOST: '127.0.0.1', INTENTSMITH_PORT: '0', INTENTSMITH_PORT_FILE: portFile,
    INTENTSMITH_STUDIO2_PREVIEW: '1',
    INTENTSMITH_DB_PATH: database, INTENTSMITH_PROJECTS_DIR: dirs.projects,
    INTENTSMITH_INSTALLATION_FILE: installationFile, INTENTSMITH_HUNT_STATE_DIR: path.join(dirs.state, 'model-hunt'),
    INTENTSMITH_ADMIN_TOKEN: randomBytes(32).toString('base64url'),
    INTENTSMITH_ENABLE_AGENTS: 'true', INTENTSMITH_ENABLE_AUTONOMY: 'false', INTENTSMITH_ENABLE_LIFECYCLE: 'false',
    INTENTSMITH_ENABLE_ONLINE_DISCOVERY: 'false', INTENTSMITH_MODEL_UNIVERSE_ENABLED: 'false',
    INTENTSMITH_ENABLE_TELEMETRY: 'false', INTENTSMITH_ENABLE_COMFYUI: 'false', INTENTSMITH_ENABLE_SKILLS: 'false',
    INTENTSMITH_LOG_LEVEL: 'warn', OLLAMA_URL: 'http://127.0.0.1:1' };
  const require = createRequire(import.meta.url);
  const { readLocalAccess } = require(path.join(source, 'intentsmith-ide/applications/electron/intentsmith-local-access.js'));
  const logs = [], children = [];
  let interrupted = false;
  const terminate = () => { interrupted = true; for (const child of children) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} } };
  process.on('SIGTERM', terminate); process.on('SIGINT', terminate);
  async function start(executable, args, file) {
    const log = await fs.open(path.join(profile, file), 'a', 0o600); logs.push(log);
    const child = spawn(executable, args, { cwd: source, env, detached: true, stdio: ['ignore', log.fd, log.fd] });
    children.push(child);
    child.on('error', error => { child.launchError = error; });
    return child;
  }
  try {
    const backend = await start(process.execPath, ['src/server.js'], 'backend.log');
    let access;
    for (let i = 0; i < 240; i++) {
      if (interrupted || backend.launchError || backend.exitCode !== null || backend.signalCode !== null) throw Error('Candidate backend failed; see its private backend.log.');
      const value = readLocalAccess({ portFile });
      if (value) {
        const port = JSON.parse(await fs.readFile(portFile, 'utf8'));
        if (port.pid === backend.pid) {
          const response = await fetch(value.backendUrl + '/api/projects', {
            headers: { 'x-intentsmith-local-capability': value.localCapability }, signal: AbortSignal.timeout(3000) });
          if (response.ok) { access = value; break; }
        }
      }
      await delay(250);
    }
    if (!access) throw Error('Candidate backend readiness timed out.');
    const anonymous = await fetch(access.backendUrl + '/api/projects', { signal: AbortSignal.timeout(3000) });
    if (![401, 403].includes(anonymous.status)) throw Error('Candidate API authentication could not be verified.');
    console.log(JSON.stringify({ status: 'CANDIDATE_READY', revision: metadata.sourceRevision, profile,
      backendPid: backend.pid, modelProvider: 'DISCONNECTED', productionInstallation: 'UNCHANGED' }));
    if (check) return;
    const sandboxArgs = await resolveElectronSandboxArgs({ sourceRoot: source, configDirectory: config.sandboxConfigDirectory }, { env: { ...env, INTENTSMITH_NO_SANDBOX: process.env.INTENTSMITH_NO_SANDBOX } });
    const electron = await start(image, ['--appimage-extract-and-run', '--class=IntentSmithCandidate',
      '--user-data-dir=' + dirs.electron, '--disable-gpu', ...sandboxArgs,
      ...(inspect ? ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'] : [])], 'electron.log');
    const exit = await new Promise((resolve, reject) => { electron.once('error', reject); electron.once('exit', (code, signal) => resolve({ code, signal })); });
    if (!interrupted && (exit.code !== 0 || exit.signal)) throw Error('Candidate IDE failed; see its private electron.log.');
  } finally {
    terminate();
    await delay(700);
    for (const child of children) { try { process.kill(-child.pid, 0); process.kill(-child.pid, 'SIGKILL'); } catch {} }
    for (const log of logs) await log.close();
    process.off('SIGTERM', terminate); process.off('SIGINT', terminate);
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), argument = args.find(arg => arg.startsWith('--config='));
    if (!argument || args.some(arg => arg !== argument && arg !== '--check' && arg !== '--inspect')) throw Error('Use --config=ABSOLUTE_JSON [--check|--inspect].');
    await runReviewCandidate(JSON.parse(await fs.readFile(argument.slice('--config='.length), 'utf8')),
      { check: args.includes('--check'), inspect: args.includes('--inspect') });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
