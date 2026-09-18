import { readFile, writeFile, rename, mkdir, mkdtemp, rm, lstat, stat, chmod } from 'node:fs/promises';
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

export async function writePrivate(file, content, mode = 0o600) {
  if (![0o600, 0o755].includes(mode)) throw new Error('DESKTOP_FILE_MODE_UNSUPPORTED');
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, content, { mode });
  await rename(tmp, file);
  await chmod(file, mode);
}
export function quotedPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\r\n\0"\\$%`]/.test(value)) throw new Error('DESKTOP_PATH_UNSUPPORTED');
  return `"${value}"`;
}
export function normalizeAdminEnvironment(value) {
  const match = typeof value === 'string' && /^(?:INTENTSMITH|C3)_ADMIN_TOKEN=([A-Za-z0-9_-]{43,128})\n$/.exec(value);
  if (!match) throw new Error('ADMIN_CREDENTIAL_FILE_INVALID');
  return `INTENTSMITH_ADMIN_TOKEN=${match[1]}\n`;
}
export function renderDesktopInstallation(config) {
  const { sourceRoot, node, dbPath, stateDirectory, configDirectory, icon } = config;
  for (const v of [sourceRoot, node, dbPath, stateDirectory, configDirectory, icon]) quotedPath(v);
  const envFile = join(configDirectory, 'runtime.env');
  const env = Object.entries({ INTENTSMITH_DB_PATH: dbPath, INTENTSMITH_PORT_FILE: join(stateDirectory, 'backend.port.json'),
    INTENTSMITH_PROJECTS_DIR: config.projectsDirectory || join(dirname(dirname(dbPath)), 'projects'),
    INTENTSMITH_INSTALLATION_FILE: join(configDirectory, 'installation.json'),
    INTENTSMITH_HUNT_STATE_DIR: join(stateDirectory, 'model-hunt'),
    INTENTSMITH_PDF_PYTHON: config.pdfPython,
  }).filter(([,v]) => v).map(([k,v]) => `${k}=${quotedPath(v)}`).join('\n') + '\nNODE_ENV=production\nINTENTSMITH_HOST=127.0.0.1\nINTENTSMITH_PORT=0\n';
  // These directives consume a single literal path, not ExecStart's argv grammar.
  // Quoting them becomes part of the path and systemd rejects/ignores the value.
  const common = `WorkingDirectory=${sourceRoot}\nEnvironmentFile=${envFile}\nUMask=0077\nKillMode=control-group\n`;
  return {
    environment: env,
    backend: `[Unit]\nDescription=IntentSmith backend\nStartLimitIntervalSec=120\nStartLimitBurst=3\n\n[Service]\nType=simple\n${common}EnvironmentFile=${join(configDirectory,'admin.env')}\nExecStart=${quotedPath(node)} ${quotedPath(join(sourceRoot,'src/server.js'))}\nRestart=on-failure\nRestartSec=3\nTimeoutStopSec=30\n\n[Install]\nWantedBy=default.target\n`,
    hunt: `[Unit]\nDescription=IntentSmith bounded GPU hunt\n\n[Service]\nType=oneshot\n${common}ExecStart=${quotedPath(node)} ${quotedPath(join(sourceRoot,'scripts/run-model-hunt-provider.js'))} --run --limit=2 --keep-inconclusive --scheduled\nTimeoutStartSec=12h\nTimeoutStopSec=15s\nNoNewPrivileges=true\nNice=10\n`,
    timer: '[Unit]\nDescription=IntentSmith nightly model hunt\n\n[Timer]\nOnCalendar=*-*-* 03:00:00\nRandomizedDelaySec=15m\nAccuracySec=5m\nPersistent=true\nUnit=intentsmith-model-hunt.service\n\n[Install]\nWantedBy=timers.target\n',
    desktop: `[Desktop Entry]\nType=Application\nName=IntentSmith\nComment=Lokální AI pracovní prostředí\nExec=${quotedPath(node)} ${quotedPath(join(sourceRoot,'scripts/desktop-runtime.mjs'))}\nIcon=${icon}\nTerminal=false\nCategories=Development;Utility;\nStartupNotify=true\nStartupWMClass=IntentSmith\n`,
    apparmor: `# IntentSmith Electron profile for this exact installed revision.\nabi <abi/4.0>,\ninclude <tunables/global>\n\nprofile intentsmith ${quotedPath(join(sourceRoot,'intentsmith-ide/node_modules/electron/dist/electron'))} flags=(unconfined) {\n  userns,\n  include if exists <local/intentsmith>\n}\n`,
  };
}

export async function verifyDesktopUnits(files) {
  // systemd expands user socket paths here; deep test TMPDIR exceeds sun_path.
  const dir = await mkdtemp('/tmp/is-units-');
  try {
    const paths = [];
    for (const [key, name] of [['backend','intentsmith-backend.service'], ['hunt','intentsmith-model-hunt.service'], ['timer','intentsmith-model-hunt.timer']]) {
      const file = join(dir, name);
      await writeFile(file, files[key], { mode: 0o600 }); paths.push(file);
    }
    const result = await exec('/usr/bin/systemd-analyze', ['--user','--generators=no','--man=no','verify',...paths], {
      timeout: 15000, env: { ...process.env, XDG_RUNTIME_DIR: dir },
    });
    // Ignored EnvironmentFile is a warning with exit 0: it is still a bad install.
    if (result.stderr.trim()) throw new Error(`DESKTOP_UNIT_VALIDATION: ${result.stderr.trim()}`);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export async function refreshDesktopCaches(applicationsDirectory, { run = exec } = {}) {
  const refreshed = [], warnings = [];
  const attempt = async (command, args) => {
    try { await run(command, args, { timeout: 30000 }); refreshed.push(command); return true; }
    catch (error) {
      if (error.code !== 'ENOENT') warnings.push(`${command}: ${error.message}`);
      return false;
    }
  };
  await attempt('/usr/bin/update-desktop-database', [applicationsDirectory]);
  for (const command of ['/usr/bin/kbuildsycoca6','/usr/bin/kbuildsycoca5']) {
    if (await attempt(command, ['--noincremental'])) break;
  }
  return { refreshed, warnings };
}

export async function waitForBackend(config, { timeoutMs = 30000, fetchImpl = fetch } = {}) {
  const { readLocalAccess } = require(join(config.sourceRoot, 'intentsmith-ide/applications/electron/intentsmith-local-access.js'));
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
        if (response.ok && data.installation?.revision === config.revision && data.installation?.dbPath === config.dbPath) {
          const uncredentialed = await fetchImpl(`${access.backendUrl}/api/system/models/hunt`, {
            signal: AbortSignal.timeout(2000), redirect: 'error',
          });
          if ([401,403].includes(uncredentialed.status)) return access;
          throw new Error('DESKTOP_AUTH_BOUNDARY_UNVERIFIED');
        }
      } catch { /* backend may still be migrating/starting; no unauthenticated fallback */ }
    }
    await new Promise(ok => setTimeout(ok, 200));
  }
  throw new Error('Backend se nepodařilo ověřit. Podrobnosti: journalctl --user -u intentsmith-backend.service -n 50');
}

function sandboxError(message) {
  const error = new Error(message);
  error.code = 'INTENTSMITH_SANDBOX_UNAVAILABLE';
  return error;
}

async function safePrivateMarker(file, lstatImpl) {
  try {
    const metadata = await lstatImpl(file);
    return metadata.isFile() && metadata.uid === process.getuid() && !(metadata.mode & 0o077);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function resolveElectronSandboxArgs(config, options = {}) {
  const environment = options.env || process.env;
  if (environment.INTENTSMITH_NO_SANDBOX === '1') return ['--no-sandbox'];
  if ((options.platform || process.platform) !== 'linux') return [];
  const readFileImpl = options.readFileImpl || readFile;
  const lstatImpl = options.lstatImpl || lstat;
  const statImpl = options.statImpl || stat;
  const run = options.run || exec;
  const marker = join(config.configDirectory, 'allow-no-sandbox');
  if (await safePrivateMarker(marker, lstatImpl)) return ['--no-sandbox'];

  let restricted = false;
  try {
    restricted = (await readFileImpl(options.restrictFile || '/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8')).trim() === '1';
  } catch { /* kernels without this AppArmor switch do not need the fallback */ }
  if (!restricted) return [];

  const electron = join(config.sourceRoot, 'intentsmith-ide/node_modules/electron/dist/electron');
  const chromeSandbox = join(config.sourceRoot, 'intentsmith-ide/node_modules/electron/dist/chrome-sandbox');
  try {
    const metadata = await statImpl(chromeSandbox);
    if (metadata.uid === 0 && (metadata.mode & 0o4000)) return [];
  } catch { /* a missing helper still needs the explicit no-sandbox fallback */ }

  const profileFile = options.profileFile || '/etc/apparmor.d/intentsmith';
  try {
    const profile = await readFileImpl(profileFile, 'utf8');
    if (profile.includes(electron)) return [];
  } catch { /* no matching system profile */ }

  const generatedProfile = join(config.configDirectory, 'intentsmith.apparmor');
  const howTo = `Bezpečnější trvalá oprava (vyžaduje heslo správce):\n\n  sudo install -m 644 ${generatedProfile} /etc/apparmor.d/intentsmith\n  sudo apparmor_parser -r /etc/apparmor.d/intentsmith\n\nPotom spusťte IntentSmith znovu.`;
  if (!environment.DISPLAY && !environment.WAYLAND_DISPLAY) {
    throw sandboxError(`Chromium sandbox je na tomto systému blokovaný.\n\n${howTo}\n\nJednorázová náhrada: INTENTSMITH_NO_SANDBOX=1`);
  }
  const dialog = options.dialog || '/usr/bin/kdialog';
  try {
    await run(dialog, ['--title','IntentSmith','--warningyesno',
      'Chromium se na tomto systému nemůže zapouzdřit, takže se IntentSmith z nabídky nespustí.\n\nSpustit ho teď bez sandboxu? Aplikace poběží, ale přijde o jednu vrstvu izolace Chromia. Volba se zapamatuje.\n\nZvolíte-li Ne, ukážu bezpečnější trvalou opravu.'],
      { env: environment, timeout: 120000 });
  } catch (error) {
    if (error.code === 1) {
      try { await run(dialog, ['--title','IntentSmith','--msgbox',howTo], { env: environment, timeout: 120000 }); } catch {}
      throw sandboxError('Spuštění bez Chromium sandboxu bylo odmítnuto. Použijte zobrazený AppArmor postup.');
    }
    throw sandboxError(`Nelze zobrazit volbu opravy Chromium sandboxu.\n\n${howTo}\n\nJednorázová náhrada: INTENTSMITH_NO_SANDBOX=1`);
  }
  await writePrivate(marker, 'Uživatel potvrdil spuštění bez Chromium sandboxu.\n');
  return ['--no-sandbox'];
}

async function main() {
  let config;
  try {
    config = JSON.parse(await readFile(installationFile, 'utf8'));
    if (config.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(config.revision || '')) throw new Error('Neplatná konfigurace instalace.');
    await exec('/usr/bin/systemctl', ['--user','start','intentsmith-backend.service'], { timeout: 35000 });
    await waitForBackend(config);
    if (process.argv.includes('--check')) { console.log(`IntentSmith ${config.revision}: backend připraven`); return; }
    const env = { ...process.env, INTENTSMITH_PORT_FILE: join(config.stateDirectory,'backend.port.json'),
      INTENTSMITH_INSTALLATION_FILE: installationFile };
    delete env.ELECTRON_RUN_AS_NODE;
    const sandboxArgs = await resolveElectronSandboxArgs(config, { env });
    // Explicit local diagnostics only; the ordinary desktop launch has no CDP listener.
    const diagnostics = process.env.INTENTSMITH_STUDIO_INSPECT === '1'
      ? ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'] : [];
    const child = spawn(config.node, [join(config.sourceRoot,'intentsmith-ide/applications/electron/scripts/launch.js'), '--class=IntentSmith', ...sandboxArgs, ...diagnostics],
      { cwd: config.sourceRoot, env, stdio: 'inherit' });
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => child.kill(signal));
    const code = await new Promise((ok, fail) => { child.once('error', fail); child.once('exit', code => ok(code ?? 1)); });
    if (code) throw new Error(`Studio skončilo s chybou ${code}. Backend zůstává spravovaný službou.`);
  } catch (error) {
    console.error(error.message);
    if (!process.argv.includes('--check') && error.code !== 'INTENTSMITH_SANDBOX_UNAVAILABLE') {
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      try {
        const sourceRoot = config?.sourceRoot || ROOT;
        await exec(join(sourceRoot,'intentsmith-ide/node_modules/electron/dist/electron'),
          [join(sourceRoot,'scripts/desktop-error.cjs'), error.message], { env, timeout: 0 });
      } catch { /* original failure remains nonzero if no graphical session exists */ }
    }
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
