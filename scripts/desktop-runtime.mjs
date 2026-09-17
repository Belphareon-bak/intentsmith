import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const require = createRequire(import.meta.url);
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const installationFile = process.env.INTENTSMITH_INSTALLATION_FILE || join(homedir(), '.config/intentsmith/installation.json');

export async function writePrivate(file, content) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, content, { mode: 0o600 });
  await rename(tmp, file);
}
export function quotedPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\r\n\0"\\$%`]/.test(value)) throw new Error('DESKTOP_PATH_UNSUPPORTED');
  return `"${value}"`;
}
export function renderDesktopInstallation(config) {
  const { sourceRoot, node, dbPath, stateDirectory, configDirectory, icon } = config;
  for (const v of [sourceRoot, node, dbPath, stateDirectory, configDirectory, icon]) quotedPath(v);
  const envFile = join(configDirectory, 'runtime.env');
  const env = Object.entries({ C3_DB_PATH: dbPath, C3_PORT_FILE: join(stateDirectory, 'backend.port.json'),
    INTENTSMITH_INSTALLATION_FILE: join(configDirectory, 'installation.json'),
    INTENTSMITH_HUNT_STATE_DIR: join(stateDirectory, 'model-hunt'),
    INTENTSMITH_PDF_PYTHON: config.pdfPython,
  }).filter(([,v]) => v).map(([k,v]) => `${k}=${quotedPath(v)}`).join('\n') + '\nC3_HOST=127.0.0.1\nC3_PORT=0\n';
  const common = `WorkingDirectory=${quotedPath(sourceRoot)}\nEnvironmentFile=${quotedPath(envFile)}\nUMask=0077\nKillMode=control-group\n`;
  return {
    environment: env,
    backend: `[Unit]\nDescription=IntentSmith backend\nStartLimitIntervalSec=120\nStartLimitBurst=3\n\n[Service]\nType=simple\n${common}ExecStart=${quotedPath(node)} ${quotedPath(join(sourceRoot,'src/server.js'))}\nRestart=on-failure\nRestartSec=3\nTimeoutStopSec=30\n\n[Install]\nWantedBy=default.target\n`,
    hunt: `[Unit]\nDescription=IntentSmith bounded GPU hunt\n\n[Service]\nType=oneshot\n${common}ExecStart=${quotedPath(node)} ${quotedPath(join(sourceRoot,'scripts/run-model-hunt-provider.js'))} --run --limit=2 --keep-inconclusive --prune-rejected --scheduled\nTimeoutStartSec=12h\nTimeoutStopSec=15s\nNoNewPrivileges=true\nNice=10\n`,
    timer: '[Unit]\nDescription=IntentSmith nightly model hunt\n\n[Timer]\nOnCalendar=*-*-* 03:00:00\nRandomizedDelaySec=15m\nAccuracySec=5m\nPersistent=true\nUnit=intentsmith-model-hunt.service\n\n[Install]\nWantedBy=timers.target\n',
    desktop: `[Desktop Entry]\nType=Application\nName=IntentSmith\nComment=Lokální AI pracovní prostředí\nExec=${quotedPath(node)} ${quotedPath(join(sourceRoot,'scripts/desktop-runtime.mjs'))}\nIcon=${icon}\nTerminal=false\nCategories=Development;Utility;\nStartupNotify=true\nStartupWMClass=IntentSmith\n`,
  };
}

export async function waitForBackend(config, { timeoutMs = 30000, fetchImpl = fetch } = {}) {
  const { readLocalAccess } = require(join(config.sourceRoot, 'c3-ide/applications/electron/c3-local-access.js'));
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const access = readLocalAccess({ portFile: join(config.stateDirectory, 'backend.port.json') });
    if (access) {
      try {
        const response = await fetchImpl(`${access.backendUrl}/api/system/models/hunt`, {
          headers: { 'x-intentsmith-local-capability': access.localCapability },
          signal: AbortSignal.timeout(2000), redirect: 'error',
        });
        const data = await response.json();
        if (response.ok && data.installation?.revision === config.revision && data.installation?.dbPath === config.dbPath) return access;
      } catch { /* backend may still be migrating/starting; no unauthenticated fallback */ }
    }
    await new Promise(ok => setTimeout(ok, 200));
  }
  throw new Error('Backend se nepodařilo ověřit. Podrobnosti: journalctl --user -u intentsmith-backend.service -n 50');
}

async function main() {
  let config;
  try {
    config = JSON.parse(await readFile(installationFile, 'utf8'));
    if (config.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(config.revision || '')) throw new Error('Neplatná konfigurace instalace.');
    await exec('/usr/bin/systemctl', ['--user','start','intentsmith-backend.service'], { timeout: 35000 });
    await waitForBackend(config);
    if (process.argv.includes('--check')) { console.log(`IntentSmith ${config.revision}: backend připraven`); return; }
    const env = { ...process.env, C3_PORT_FILE: join(config.stateDirectory,'backend.port.json'),
      INTENTSMITH_INSTALLATION_FILE: installationFile };
    delete env.ELECTRON_RUN_AS_NODE;
    // Explicit local diagnostics only; the ordinary desktop launch has no CDP listener.
    const diagnostics = process.env.INTENTSMITH_STUDIO_INSPECT === '1'
      ? ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'] : [];
    const child = spawn(config.node, [join(config.sourceRoot,'c3-ide/applications/electron/scripts/launch.js'), '--class=IntentSmith', ...diagnostics],
      { cwd: config.sourceRoot, env, stdio: 'inherit' });
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => child.kill(signal));
    const code = await new Promise((ok, fail) => { child.once('error', fail); child.once('exit', code => ok(code ?? 1)); });
    if (code) throw new Error(`Studio skončilo s chybou ${code}. Backend zůstává spravovaný službou.`);
  } catch (error) {
    console.error(error.message);
    if (!process.argv.includes('--check')) {
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      try {
        const sourceRoot = config?.sourceRoot || ROOT;
        await exec(join(sourceRoot,'c3-ide/node_modules/electron/dist/electron'),
          [join(sourceRoot,'scripts/desktop-error.cjs'), error.message], { env, timeout: 0 });
      } catch { /* original failure remains nonzero if no graphical session exists */ }
    }
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
