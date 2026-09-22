// Local desktop control of one installed, bounded systemd hunt. No shell input.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, lstat, realpath, readdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectHuntGpu } from '../upgrade/model-hunt-diagnostics.js';

const exec = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SERVICE = 'intentsmith-model-hunt.service';
const EVALUATION = 'intentsmith-model-evaluation.service';
const TIMER = 'intentsmith-model-hunt.timer';
const ACTIONS = Object.freeze({
  start: ['start', '--no-block', SERVICE],
  stop: ['stop', '--no-block', SERVICE],
  pause: ['disable', '--now', TIMER],
  resume: ['enable', '--now', TIMER],
});
const properties = ['LoadState', 'ActiveState', 'SubState', 'Result', 'ExecMainStatus', 'NextElapseUSecRealtime', 'UnitFileState', 'WorkingDirectory', 'ExecStart', 'EnvironmentFiles', 'ConditionResult', 'ConditionTimestampMonotonic'];
const parse = value => Object.fromEntries(value.trim().split('\n').filter(Boolean).map(line => {
  const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
}));

async function json(file, maximumBytes = 262144) {
  const st = await lstat(file);
  if (!st.isFile() || st.size > maximumBytes || st.uid !== process.getuid() || (st.mode & 0o077)) throw new Error('HUNT_STATE_UNSAFE');
  return JSON.parse(await readFile(file, 'utf8'));
}

export function createHuntControl({ installationFile = process.env.INTENTSMITH_INSTALLATION_FILE,
  sourceRoot = ROOT, databasePath = (process.env.INTENTSMITH_DB_PATH ?? process.env['C3_DB_PATH']),
  inspectGpu = inspectHuntGpu, readInventory = () => null,
  launch = args => exec('/usr/bin/systemd-run', args, { timeout: 15000, maxBuffer: 65536 }),
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
  let health = null, healthAt = 0;
  const control = {
    async status({ freshGpu = false } = {}) {
      const installed = await installation();
      const [serviceResult, timerResult, evaluationResult, gpu] = await Promise.all([
        run(['show', SERVICE, ...properties.map(p => `--property=${p}`)]),
        run(['show', TIMER, ...properties.map(p => `--property=${p}`)]),
        run(['show', EVALUATION, ...properties.map(p => `--property=${p}`)]),
        freshGpu || !health || Date.now() - healthAt > 30000 ? inspectGpu().then(value => { health = value; healthAt = Date.now(); return value; }) : health,
      ]);
      const service = parse(serviceResult.stdout), timer = parse(timerResult.stdout), evaluation = parse(evaluationResult.stdout);
      let hold = null;
      try { const record = await json(join(installed.stateDirectory, 'code-pilot-automation-hold.json'));
        hold = { code: 'HUNT_AUTOMATION_HELD', reason: record.reason || 'Automatika je pozastavena do přijetí evaluátoru.',
          releaseCondition: record.releaseCondition || null, createdAt: record.createdAt || null }; }
      catch (error) {
        if (error.code !== 'ENOENT') hold = {code:'HUNT_AUTOMATION_HELD',metadataStatus:'UNREADABLE',
          reason:'Pozastavení automatiky je přítomné, ale jeho podrobnosti nelze bezpečně přečíst.',
          releaseCondition:null,createdAt:null};
      }
      if (service.LoadState !== 'loaded' || timer.LoadState !== 'loaded') throw new Error('HUNT_SERVICE_NOT_INSTALLED');
      if (service.WorkingDirectory !== installed.sourceRoot
        || !service.ExecStart?.includes(join(installed.sourceRoot,'scripts/run-model-hunt-provider.js'))
        || !service.ExecStart?.includes(`path=${installed.node} ;`)
        || service.EnvironmentFiles !== `${join(installed.configDirectory,'runtime.env')} (ignore_errors=no)`
        || !(await readFile(join(installed.configDirectory,'runtime.env'),'utf8')).split('\n').includes(`INTENTSMITH_DB_PATH="${installed.dbPath}"`)) {
        throw new Error('HUNT_INSTALLATION_MISMATCH');
      }
      let current = null, progress = null, resources = null;
      try { current = await json(join(installed.stateDirectory, 'model-hunt/current.json')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (current && /^run-[A-Za-z0-9]+$/.test(current.runId)) {
        try { progress = await json(join(installed.stateDirectory, 'model-hunt', current.runId, 'progress.json')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        try { resources = await json(join(installed.stateDirectory, 'model-hunt', current.runId, 'resources.json')); }
        catch (error) { if (error.code !== 'ENOENT') resources = { ready: null, code: 'HUNT_RESOURCE_STATE_UNAVAILABLE' }; }
      }
      const recent = [];
      for (const entry of await readdir(join(installed.stateDirectory, 'model-hunt'), {withFileTypes:true}).catch(() => [])) {
        if (!entry.isDirectory() || !/^run-[A-Za-z0-9]+$/.test(entry.name)) continue;
        try { const summary = await json(join(installed.stateDirectory, 'model-hunt', entry.name, 'summary.json'));
          if (summary.finishedAt) recent.push(summary); } catch {
          // Pre-summary versions retain result.json. Do not invent missing request identity.
          try {
            const report = await json(join(installed.stateDirectory, 'model-hunt', entry.name, 'result.json'), 4 * 1024 * 1024);
            const manual = report.results?.length === 1 && report.results[0].trials?.some(t => t.evaluation);
            recent.push({runId:entry.name, finishedAt:report.finishedAt || report.generatedAt,
              status:report.status || 'COMPLETE', reasons:report.reasons || (report.reason ? [report.reason] : []),
              request:manual ? {kind:'evaluation', model:report.results[0].model,
                role:report.results[0].trials.filter(t => t.evaluation).map(t => t.role).join(',')} : null,
              results:(report.results || []).map(r => ({model:r.model, stage:r.stage, error:r.error || null,
                evaluations:(r.trials || []).filter(t => t.evaluation).map(t => ({role:t.role,score:t.evaluation.score,collection:t.evaluation.collection||null,reused:t.evaluation.reused === true}))})),
            });
          } catch { /* An absent or unsafe record is not evidence of a completed run. */ }
        }
      }
      if (current?.finishedAt && !recent.some(r => r.runId === current.runId)) recent.push(current);
      const manualActive = ['active', 'activating', 'deactivating'].includes(evaluation.ActiveState);
      const activeService = manualActive ? evaluation : service;
      const active = ['active', 'activating', 'deactivating'].includes(activeService.ActiveState);
      return {
        schemaVersion: 1, generatedAt: new Date().toISOString(),
        installation: { revision: installed.revision, sourceRoot: installed.sourceRoot, dbPath: installed.dbPath },
        state: active ? (activeService.ActiveState === 'deactivating' ? 'STOPPING' : 'RUNNING')
          : hold ? 'HELD' : !gpu.available ? 'BLOCKED' : (current?.status === 'FAILED' || (!current && service.ActiveState === 'failed')) ? 'FAILED'
            : timer.ActiveState === 'active' ? 'WAITING' : 'PAUSED',
        service, timer, evaluation, gpu, gpuInventory: await readInventory(), current, progress, resources, hold,
        lastStartConditionFailed: service.ConditionResult === 'no' && Number(service.ConditionTimestampMonotonic) > 0,
        recent: recent.filter(r => r.finishedAt).sort((a,b) => String(b.finishedAt).localeCompare(String(a.finishedAt))).slice(0,5),
        // A stored plan is explicitly dated, never passed off as a fresh discovery.
        queue: active ? progress?.queue || [] : [], lastPlan: progress?.queue || [], queueObservedAt: progress?.updatedAt || null,
      };
    },
    async evaluate(request, evaluations) {
      const batch = request && Object.keys(request).sort().join(',') === 'digestSha256,model,roles';
      const pins = batch ? request.roles : [{ role: request?.role, suiteContractSha256: request?.suiteContractSha256 }];
      if (!request || (!batch && Object.keys(request).sort().join(',') !== 'digestSha256,model,role,suiteContractSha256')
        || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,199}$/.test(request.model || '')
        || !/^[a-f0-9]{64}$/.test(request.digestSha256 || '')
        || !Array.isArray(pins) || pins.length < 1 || pins.length > 7
        || pins.some(pin => !pin || Object.keys(pin).sort().join(',') !== 'role,suiteContractSha256'
          || !['D1','D2','CODE','R1','R2','CHAT','VISION'].includes(pin.role)
          || !/^[a-f0-9]{64}$/.test(pin.suiteContractSha256 || ''))
        || new Set(pins.map(pin => pin.role)).size !== pins.length) {
        throw Object.assign(new Error('MODEL_EVALUATION_REQUEST_INVALID'), { httpStatus: 400 });
      }
      // Preflight the entire batch before creating a service. One stale role
      // must not silently turn a complete evaluation into a partial request.
      for (const pin of pins) {
        const role = evaluations?.roles?.[pin.role];
        const artifact = role?.artifacts?.find(row => row.model === request.model && row.digestSha256 === request.digestSha256);
        if (!artifact || artifact.applicable === false || (role.measurementReady ?? role.decisionReady) === false
          || role.suiteContractSha256 !== pin.suiteContractSha256) {
          throw Object.assign(new Error('MODEL_EVALUATION_IDENTITY_CHANGED_OR_UNAVAILABLE'), { httpStatus: 409 });
        }
      }
      const status = await control.status({ freshGpu: true });
      if (['RUNNING','STOPPING'].includes(status.state)) throw Object.assign(new Error('HUNT_ALREADY_RUNNING'), { httpStatus: 409 });
      if (!status.gpu.available) throw Object.assign(new Error(status.gpu.message), { httpStatus: 503, code: status.gpu.code });
      const installed = await installation();
      await launch(['--user', '--collect', '--unit=' + EVALUATION,
        '--property=Type=exec', '--property=WorkingDirectory=' + installed.sourceRoot,
        '--property=EnvironmentFile=' + join(installed.configDirectory,'runtime.env'),
        '--property=KillMode=control-group', '--property=TimeoutStopSec=15s',
        '--property=MemoryHigh=60%', '--property=MemoryMax=75%', '--property=MemorySwapMax=1G', '--property=OOMPolicy=stop',
        '--property=RuntimeMaxSec=6h', '--property=NoNewPrivileges=true', '--property=UMask=0077', '--property=Nice=10',
        '--', installed.node, join(installed.sourceRoot,'scripts/run-model-hunt-provider.js'),
        '--run', '--scheduled', '--keep-inconclusive', '--evaluate-installed', '--limit=1',
        '--only=' + request.model, '--role=' + pins.map(pin => pin.role).join(','), '--expected-digest=' + request.digestSha256,
        batch ? '--expected-contracts=' + JSON.stringify(Object.fromEntries(pins.map(pin => [pin.role, pin.suiteContractSha256])))
          : '--expected-contract=' + request.suiteContractSha256]);
      return { accepted: true, model: request.model, role: pins.map(pin => pin.role).join(','), roles: pins.map(pin => pin.role) };
    },
    async grade(request, preview) {
      if (!request || Object.keys(request).sort().join(',') !== 'graderAcceptanceId,runId,sourceSha256'
        || !/^eval_[a-zA-Z0-9-]{1,100}$/.test(request.runId || '')
        || !/^accept_[a-zA-Z0-9-]{1,100}$/.test(request.graderAcceptanceId || '')
        || !/^[a-f0-9]{64}$/.test(request.sourceSha256 || ''))
        throw Object.assign(new Error('MODEL_GRADING_REQUEST_INVALID'), {httpStatus:400});
      if (preview?.runId !== request.runId || preview.sourceSha256 !== request.sourceSha256
        || !preview.graders?.some(g => g.id === request.graderAcceptanceId))
        throw Object.assign(new Error(preview?.code || 'MODEL_GRADING_EVIDENCE_CHANGED'), {httpStatus:409});
      const status = await control.status({freshGpu:true});
      if (['RUNNING','STOPPING'].includes(status.state)) throw Object.assign(new Error('HUNT_ALREADY_RUNNING'), {httpStatus:409});
      if (!status.gpu.available) throw Object.assign(new Error(status.gpu.message), {httpStatus:503,code:status.gpu.code});
      const installed = await installation();
      await launch(['--user','--collect','--unit=' + EVALUATION,
        '--property=Type=exec','--property=WorkingDirectory=' + installed.sourceRoot,
        '--property=EnvironmentFile=' + join(installed.configDirectory,'runtime.env'),
        '--property=KillMode=control-group','--property=TimeoutStopSec=15s',
        '--property=MemoryHigh=60%','--property=MemoryMax=75%','--property=MemorySwapMax=1G','--property=OOMPolicy=stop',
        '--property=RuntimeMaxSec=65m','--property=NoNewPrivileges=true','--property=UMask=0077','--property=Nice=10',
        '--',installed.node,join(installed.sourceRoot,'scripts/run-model-hunt-provider.js'),
        '--grade-collection','--run','--db=' + installed.dbPath,'--run-id=' + request.runId,
        '--grader-acceptance=' + request.graderAcceptanceId, '--expected-source=' + request.sourceSha256]);
      return {accepted:true,runId:request.runId,model:preview.model,role:preview.role};
    },
    async control(action) {
      if (!Object.hasOwn(ACTIONS, action)) throw Object.assign(new Error('HUNT_ACTION_INVALID'), { httpStatus: 400 });
      const status = await control.status({ freshGpu: true });
      if (['start','resume'].includes(action) && status.hold) {
        throw Object.assign(new Error('HUNT_AUTOMATION_HELD: ' + status.hold.reason), {httpStatus:409, code:'HUNT_AUTOMATION_HELD'});
      }
      if (action === 'start' && ['RUNNING','STOPPING'].includes(status.state)) throw Object.assign(new Error('HUNT_ALREADY_RUNNING'), { httpStatus: 409 });
      if (action === 'start' && !status.gpu.available) throw Object.assign(new Error(status.gpu.message), { httpStatus: 503, code: status.gpu.code });
      await run(action === 'stop' && ['active','activating','deactivating'].includes(status.evaluation.ActiveState)
        ? ['stop','--no-block',EVALUATION] : ACTIONS[action]);
      return { accepted: true, action };
    },
  };
  return Object.freeze(control);
}
