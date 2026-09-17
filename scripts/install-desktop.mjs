#!/usr/bin/env node
// Register an already built, clean, detached installation. Never builds in a live checkout.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, realpath, chmod, copyFile, lstat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrate.js';
import { ROOT, refreshDesktopCaches, renderDesktopInstallation, verifyDesktopUnits, writePrivate, waitForBackend } from './desktop-runtime.mjs';
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
await exec(process.execPath, [join(sourceRoot,'c3-ide/scripts/verify-m1-consumer-build.js')], { cwd: join(sourceRoot,'c3-ide'), timeout: 15000 });
const configDirectory = join(homedir(), '.config/intentsmith');
const stateDirectory = join(homedir(), '.local/state/intentsmith');
const config = { schemaVersion: 1, revision, sourceRoot, node: process.execPath, dbPath, configDirectory, stateDirectory,
  icon: join(sourceRoot,'c3-ide/applications/electron/resources/intentsmith-icon.png'), pdfPython: process.env.INTENTSMITH_PDF_PYTHON || null };
const files = renderDesktopInstallation(config);
// Validate with systemd itself before touching the timer, live DB or configuration.
await verifyDesktopUnits(files);
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ config, files, next: 'Repeat with --apply to back up and install' }, null, 2));
  process.exit(0);
}
const hunt = (await systemctl(['show','intentsmith-model-hunt.service','--property=ActiveState','--value'])).stdout.trim();
if (!['inactive','failed'].includes(hunt)) throw new Error('HUNT_ACTIVE: installation will not interrupt an existing run');
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
const adminFile = join(configDirectory,'admin.env');
let adminEnvironment;
try {
  const metadata = await lstat(adminFile);
  if (!metadata.isFile() || metadata.uid !== process.getuid() || (metadata.mode & 0o077)) throw new Error('ADMIN_CREDENTIAL_FILE_UNSAFE');
  adminEnvironment = await readFile(adminFile,'utf8');
  if (!/^C3_ADMIN_TOKEN=[A-Za-z0-9_-]{43,128}\n$/.test(adminEnvironment)) throw new Error('ADMIN_CREDENTIAL_FILE_INVALID');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  adminEnvironment = `C3_ADMIN_TOKEN=${randomBytes(32).toString('base64url')}\n`;
}
const backup = join(stateDirectory,'installation-backups',stamp);
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
  [join(units,'intentsmith-backend.service'),files.backend],
  [join(units,'intentsmith-model-hunt.service'),files.hunt],
  [join(units,'intentsmith-model-hunt.timer'),files.timer],
  [join(homedir(),'.local/share/applications/intentsmith.desktop'),files.desktop,0o755],
  [adminFile,adminEnvironment],
];
const previous = [];
for (let i=0;i<targets.length;i++) {
  const [file] = targets[i];
  try { const value = await readFile(file,'utf8'); await writePrivate(join(backup,`${i}.txt`),value); previous.push({ file, backup: `${i}.txt` }); }
  catch(error) { if(error.code!=='ENOENT')throw error; previous.push({file,backup:null}); }
}
await writePrivate(join(backup,'files.json'),JSON.stringify(previous,null,2)+'\n');
await systemctl(['stop','intentsmith-model-hunt.timer']);
// Recheck after stopping scheduling. A manual start in between is a real conflict.
const after = (await systemctl(['show','intentsmith-model-hunt.service','--property=ActiveState','--value'])).stdout.trim();
if (!['inactive','failed'].includes(after)) throw new Error('HUNT_STARTED_DURING_INSTALL: timer stopped; resume after the run');
for (const [file,content,mode] of targets) await writePrivate(file,content,mode);
await systemctl(['daemon-reload']);
await systemctl(['enable','intentsmith-backend.service']);
await systemctl(['reset-failed','intentsmith-backend.service']);
await systemctl(['restart','intentsmith-backend.service']);
await waitForBackend(config);
await systemctl(['enable','--now','intentsmith-model-hunt.timer']);
const desktopCache = await refreshDesktopCaches(join(homedir(),'.local/share/applications'));
console.log(JSON.stringify({ installed:true, revision, dbPath, backup,
  launcher: join(homedir(),'.local/share/applications/intentsmith.desktop'), desktopCache },null,2));
