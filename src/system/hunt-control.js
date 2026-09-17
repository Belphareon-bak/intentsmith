// Local desktop control of one installed, bounded systemd hunt. No shell input.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SERVICE = 'intentsmith-model-hunt.service';
const TIMER = 'intentsmith-model-hunt.timer';
const ACTIONS = Object.freeze({
  start: ['start', '--no-block', SERVICE],
  stop: ['stop', '--no-block', SERVICE],
  pause: ['disable', '--now', TIMER],
  resume: ['enable', '--now', TIMER],
});
const properties = ['LoadState', 'ActiveState', 'SubState', 'Result', 'ExecMainStatus', 'NextElapseUSecRealtime', 'UnitFileState', 'WorkingDirectory', 'ExecStart', 'EnvironmentFiles'];
const parse = value => Object.fromEntries(value.trim().split('\n').filter(Boolean).map(line => {
  const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
}));

async function json(file) {
  const st = await lstat(file);
  if (!st.isFile() || st.size > 262144 || st.uid !== process.getuid() || (st.mode & 0o077)) throw new Error('HUNT_STATE_UNSAFE');
  return JSON.parse(await readFile(file, 'utf8'));
}

export function createHuntControl({ installationFile = process.env.INTENTSMITH_INSTALLATION_FILE,
  sourceRoot = ROOT, databasePath = process.env.C3_DB_PATH,
  run = (args) => exec('/usr/bin/systemctl', ['--user', ...args], { timeout: 10000, maxBuffer: 65536 }),
} = {}) {
  async function installation() {
    if (!installationFile) throw new Error('DESKTOP_NOT_INSTALLED');
    const value = await json(installationFile);
    if (value.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(value.revision || '')
      || !value.stateDirectory || !value.dbPath || !value.node || !value.configDirectory
      || resolve(databasePath || '') !== value.dbPath
      || await realpath(value.sourceRoot) !== await realpath(sourceRoot)) throw new Error('DESKTOP_INSTALLATION_MISMATCH');
    return value;
  }
  const control = {
    async status() {
      const installed = await installation();
      const [serviceResult, timerResult] = await Promise.all([
        run(['show', SERVICE, ...properties.map(p => `--property=${p}`)]),
        run(['show', TIMER, ...properties.map(p => `--property=${p}`)]),
      ]);
      const service = parse(serviceResult.stdout), timer = parse(timerResult.stdout);
      if (service.LoadState !== 'loaded' || timer.LoadState !== 'loaded') throw new Error('HUNT_SERVICE_NOT_INSTALLED');
      if (service.WorkingDirectory !== installed.sourceRoot
        || !service.ExecStart?.includes(join(installed.sourceRoot,'scripts/run-model-hunt-provider.js'))
        || !service.ExecStart?.includes(`path=${installed.node} ;`)
        || service.EnvironmentFiles !== `${join(installed.configDirectory,'runtime.env')} (ignore_errors=no)`
        || !(await readFile(join(installed.configDirectory,'runtime.env'),'utf8')).split('\n').includes(`C3_DB_PATH="${installed.dbPath}"`)) {
        throw new Error('HUNT_INSTALLATION_MISMATCH');
      }
      let current = null, progress = null;
      try { current = await json(join(installed.stateDirectory, 'model-hunt/current.json')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (current && /^run-[A-Za-z0-9]+$/.test(current.runId)) {
        try { progress = await json(join(installed.stateDirectory, 'model-hunt', current.runId, 'progress.json')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const active = ['active', 'activating', 'deactivating'].includes(service.ActiveState);
      return {
        schemaVersion: 1, generatedAt: new Date().toISOString(),
        installation: { revision: installed.revision, sourceRoot: installed.sourceRoot, dbPath: installed.dbPath },
        state: active ? (service.ActiveState === 'deactivating' ? 'STOPPING' : 'RUNNING')
          : service.ActiveState === 'failed' ? 'FAILED' : timer.ActiveState === 'active' ? 'WAITING' : 'PAUSED',
        service, timer, current, progress,
        // A stored plan is explicitly dated, never passed off as a fresh discovery.
        queue: progress?.queue || [], queueObservedAt: progress?.updatedAt || null,
      };
    },
    async control(action) {
      if (!Object.hasOwn(ACTIONS, action)) throw Object.assign(new Error('HUNT_ACTION_INVALID'), { httpStatus: 400 });
      await control.status();
      await run(ACTIONS[action]);
      return { accepted: true, action };
    },
  };
  return Object.freeze(control);
}
