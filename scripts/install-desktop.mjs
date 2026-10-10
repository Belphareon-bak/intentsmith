#!/usr/bin/env node
// Register an already built, clean, detached installation. Never builds in a live checkout.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, realpath, chmod, copyFile, lstat, readlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrate.js';
import { resolveOllamaStorage } from '../src/system/ollama-storage.js';
import { ROOT, hashDesktopExecutable, normalizeAdminEnvironment, refreshDesktopCaches, renderDesktopInstallation, restoreDesktopInstallation, restoreHuntTimerState, seedDesktopProfile, verifyDesktopUnits, writePrivate, waitForBackend } from './desktop-runtime.mjs';
const exec = promisify(execFile);
const arg = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const systemctl = args => exec('/usr/bin/systemctl', ['--user', ...args], { timeout: 40000 });
const sourceRoot = await realpath(arg('source') || ROOT);
if (sourceRoot !== await realpath(ROOT)) throw new Error('Run the installer from the target snapshot');
const dbPath = await realpath(arg('db') || '');
if (!arg('db')) throw new Error('--db=/absolute/existing/database is required');
const revision = (await exec('git', ['-C',sourceRoot,'rev-parse','HEAD'])).stdout.trim();
const dirty = (await exec('git', ['-C',sourceRoot,'status','--porcelain'])).stdout.trim();
const branch = (await exec('git', ['-C',sourceRoot,'branch','--show-current'])).stdout.trim();
if (dirty || branch) throw new Error('Installation must be a clean detached source snapshot');
await exec(process.execPath, [join(sourceRoot,'intentsmith-ide/scripts/verify-m1-consumer-build.js')], { cwd: join(sourceRoot,'intentsmith-ide'), timeout: 15000 });
const configDirectory = join(homedir(), '.config/intentsmith');
const stateDirectory = join(homedir(), '.local/state/intentsmith');
let previousConfig;
try { previousConfig = JSON.parse(await readFile(join(configDirectory,'installation.json'),'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const projectsDirectory = resolve(arg('projects') || previousConfig?.projectsDirectory || join(dirname(dirname(dbPath)), 'projects'));
const modelStorage = await resolveOllamaStorage({ baseUrl:process.env.OLLAMA_BASE_URL,
  modelsPath:process.env.OLLAMA_MODELS || previousConfig?.ollamaModelsPath });
const config = { schemaVersion: 1, revision, sourceRoot, node: process.execPath, dbPath, configDirectory, stateDirectory,
  projectsDirectory,
  ollamaModelsPath:modelStorage.path,
  icon: join(sourceRoot,'intentsmith-ide/applications/electron/resources/intentsmith-icon.png'),
  pdfPython: process.env.INTENTSMITH_PDF_PYTHON || previousConfig?.pdfPython || null };
if (arg('appimage')) {
  const appImage = await realpath(arg('appimage'));
  const expected = arg('appimage-sha256');
  if (!/^[a-f0-9]{64}$/.test(expected || '') || await hashDesktopExecutable(appImage) !== expected) throw new Error('STUDIO2_APPIMAGE_DIGEST_MISMATCH');
  config.studioAppImage = { path: appImage, sha256: expected };
  config.userDataDirectory = join(homedir(), '.config/intentsmith-studio2');
  config.accountantRuntime = process.env.UCETNI_RUNTIME_DIR || previousConfig?.accountantRuntime || null;
  if (previousConfig) config.legacy = previousConfig.legacy || {
    sourceRoot: previousConfig.sourceRoot, node: previousConfig.node, icon: previousConfig.icon,
    userDataDirectory: previousConfig.userDataDirectory || join(homedir(), '.config/intentsmith-ide-electron'),
  };
}
const files = renderDesktopInstallation(config);
// Validate with systemd itself before touching the timer, live DB or configuration.
await verifyDesktopUnits(files);
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ config, files, next: 'Repeat with --apply to back up and install' }, null, 2));
  process.exit(0);
}
const hunt = (await systemctl(['show','intentsmith-model-hunt.service','--property=ActiveState','--value'])).stdout.trim();
if (!['inactive','failed'].includes(hunt)) throw new Error('HUNT_ACTIVE: installation will not interrupt an existing run');
const evaluation = (await systemctl(['show','intentsmith-model-evaluation.service','--property=ActiveState','--value'])).stdout.trim();
if (!['inactive','failed',''].includes(evaluation)) throw new Error('EVALUATION_ACTIVE: installation will not interrupt a selected model test');
const backendState = (await systemctl(['show','intentsmith-backend.service','--property=ActiveState','--value'])).stdout.trim();
if (!['inactive','failed',''].includes(backendState)) {
  let previous;
  try { previous = JSON.parse(await readFile(join(configDirectory,'installation.json'),'utf8')); } catch {}
  if (previous?.revision === revision && previous?.sourceRoot === sourceRoot && previous?.dbPath === dbPath) {
    await waitForBackend(config);
    console.log(JSON.stringify({installed:true,unchanged:true,revision,dbPath}));
    process.exit(0);
  }
  throw new Error('BACKEND_ACTIVE: stop the existing backend deliberately before changing installations');
}
const stamp = new Date().toISOString().replace(/[:.]/g,'-');
const timerBefore = Object.fromEntries((await systemctl(['show','intentsmith-model-hunt.timer',
  '--property=UnitFileState','--property=ActiveState'])).stdout.trim().split('\n').map(line => line.split('=')));
const adminFile = join(configDirectory,'admin.env');
let adminEnvironment;
try {
  const metadata = await lstat(adminFile);
  if (!metadata.isFile() || metadata.uid !== process.getuid() || (metadata.mode & 0o077)) throw new Error('ADMIN_CREDENTIAL_FILE_UNSAFE');
  adminEnvironment = await readFile(adminFile,'utf8');
  adminEnvironment = normalizeAdminEnvironment(adminEnvironment);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  adminEnvironment = `INTENTSMITH_ADMIN_TOKEN=${randomBytes(32).toString('base64url')}\n`;
}
const backup = join(stateDirectory,'installation-backups',stamp);
await mkdir(projectsDirectory, { recursive: true, mode: 0o700 });
await mkdir(backup, { recursive: true, mode: 0o700 });
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
try { await db.backup(join(backup,'before.sqlite')); } finally { db.close(); }
await chmod(join(backup,'before.sqlite'),0o600);
await copyFile(join(backup,'before.sqlite'),join(backup,'migration-probe.sqlite'));
const probe = new Database(join(backup,'migration-probe.sqlite'));
try {
  await runMigrations(probe);
  if (probe.pragma('quick_check', { simple: true }) !== 'ok' || probe.pragma('foreign_key_check').length) throw new Error('MIGRATION_PROBE_FAILED');
} finally { probe.close(); }
const units = join(homedir(),'.config/systemd/user');
const targets = [
  [join(configDirectory,'installation.json'), JSON.stringify(config,null,2)+'\n'],
  [join(configDirectory,'runtime.env'), files.environment],
  [join(configDirectory,'intentsmith.apparmor'), files.apparmor],
  [join(configDirectory,'intentsmith-bwrap.apparmor'), await readFile(join(sourceRoot,'systemd/intentsmith-bwrap.apparmor'),'utf8')],
  [join(units,'intentsmith-backend.service'),files.backend],
  [join(units,'intentsmith-model-hunt.service'),files.hunt],
  [join(units,'intentsmith-model-hunt.timer'),files.timer],
  [join(homedir(),'.local/share/applications/intentsmith.desktop'),files.desktop,0o755],
  [adminFile,adminEnvironment],
  ...(files.legacyDesktop ? [[join(homedir(),'.local/share/applications/intentsmith-legacy.desktop'),files.legacyDesktop,0o755]] : []),
];
const previous = [];
for (let i=0;i<targets.length;i++) {
  const [file] = targets[i];
  try { const value = await readFile(file,'utf8'); const mode = (await lstat(file)).mode & 0o777; await writePrivate(join(backup,`${i}.txt`),value); previous.push({ file, backup: `${i}.txt`, mode }); }
  catch(error) { if(error.code!=='ENOENT')throw error; previous.push({file,backup:null}); }
}
await writePrivate(join(backup,'files.json'),JSON.stringify(previous,null,2)+'\n');
let targetProfileExists = false;
if (config.userDataDirectory) {
  try { targetProfileExists = (await lstat(config.userDataDirectory)).isDirectory(); }
  catch(error) { if(error.code!=='ENOENT')throw error; }
}
if (config.studioAppImage && config.legacy && !targetProfileExists) {
  const sourceProfile = config.legacy.userDataDirectory;
  let owner;
  try { owner = await readlink(join(sourceProfile, 'SingletonLock')); } catch (error) { if (error.code !== 'ENOENT' && error.code !== 'EINVAL') throw error; }
  const ownerPid = Number(owner?.slice(owner.lastIndexOf('-') + 1));
  if (Number.isSafeInteger(ownerPid) && ownerPid > 0) {
    try { process.kill(ownerPid, 0); throw new Error('DESKTOP_PROFILE_IN_USE'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  await seedDesktopProfile(sourceProfile, config.userDataDirectory);
}
let installationChanged = false;
try {
await systemctl(['stop','intentsmith-model-hunt.timer']);
// Recheck after stopping scheduling. A manual start in between is a real conflict.
const after = (await systemctl(['show','intentsmith-model-hunt.service','--property=ActiveState','--value'])).stdout.trim();
if (!['inactive','failed'].includes(after)) throw new Error('HUNT_STARTED_DURING_INSTALL: timer stopped; resume after the run');
const evaluationAfter = (await systemctl(['show','intentsmith-model-evaluation.service','--property=ActiveState','--value'])).stdout.trim();
if (!['inactive','failed',''].includes(evaluationAfter)) throw new Error('EVALUATION_STARTED_DURING_INSTALL: timer stopped; resume after the run');
installationChanged = true;
for (const [file,content,mode] of targets) await writePrivate(file,content,mode);
await systemctl(['daemon-reload']);
await systemctl(['enable','intentsmith-backend.service']);
await systemctl(['reset-failed','intentsmith-backend.service']);
await systemctl(['restart','intentsmith-backend.service']);
await waitForBackend(config);
let held = true;
try { await lstat(join(stateDirectory,'code-pilot-automation-hold.json')); }
catch (error) { if (error.code === 'ENOENT') held = false; }
const huntTimer = await restoreHuntTimerState(timerBefore, { held, run: systemctl });
const desktopCache = await refreshDesktopCaches(join(homedir(),'.local/share/applications'));
console.log(JSON.stringify({ installed:true, revision, dbPath, backup, huntTimer,
  launcher: join(homedir(),'.local/share/applications/intentsmith.desktop'), desktopCache },null,2));
} catch (error) {
  if (installationChanged) {
    await restoreDesktopInstallation(backup,previous,{config:previousConfig,run:systemctl});
  }
  let held = true;
  try { await lstat(join(stateDirectory,'code-pilot-automation-hold.json')); }
  catch (holdError) { if (holdError.code === 'ENOENT') held = false; }
  await restoreHuntTimerState(timerBefore,{held,run:systemctl});
  throw error;
}
