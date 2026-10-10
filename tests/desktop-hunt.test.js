import { execFileSync as runStudio2BehaviorTests } from 'node:child_process';
import './helpers/isolated-test-db.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, lstat, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import vm from 'node:vm';
import { createGpuProfileCache } from '../src/system/gpu-detector.js';
import { createHuntControl } from '../src/system/hunt-control.js';
import { buildCandidates } from '../src/upgrade/model-discovery.js';
import { canonicalModelName } from '../src/upgrade/model-identity.js';
import { comparePair } from '../src/upgrade/pairwise-trial.js';
import { analyzeHuntDecisions, inspectHuntGpu, readNvidiaDisplayCapacity, inspectHuntResources, watchHuntResources } from '../src/upgrade/model-hunt-diagnostics.js';
import { acquireGpuEvaluationLock, waitForGpuReadiness } from '../src/upgrade/gpu-evaluation-lock.js';
import { createGlobalAuthAuthority } from '../src/security/global-auth-policy.js';
import { createSystemRoutes } from '../src/routes/system.js';
import { ROOT, hashDesktopExecutable, refreshDesktopCaches, renderDesktopInstallation, resolveDesktopLaunch, restoreDesktopInstallation, restoreHuntTimerState, resolveElectronSandboxArgs, seedDesktopProfile, verifyDesktopUnits, waitForBackend, writePrivate } from '../scripts/desktop-runtime.mjs';
import { selectTrackedMetadata, validateAppImageBuild } from '../scripts/package-studio2-ready.mjs';
import { createHash } from 'node:crypto';
const exec = promisify(execFile);
const revision = 'a'.repeat(40);
const capability = 'c'.repeat(43);
test('candidate packaging accepts the same attested files in git or locale order but rejects missing, duplicate and changed inputs', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'is-studio2-package-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = ['intentsmith-ide/START.md', 'intentsmith-ide/app.js'];
  await mkdir(join(directory, 'intentsmith-ide'));
  const hash = content => createHash('sha256').update(content).digest('hex');
  for (const file of paths) await writeFile(join(directory, file), file);
  const selection = selectTrackedMetadata(paths.map(file => `100644 ${'b'.repeat(40)} 0\t${file}\0`).join(''));
  const artifact = join(directory, 'Studio2.AppImage');
  await writeFile(artifact, 'built image', { mode: 0o700 });
  const receipt = { status: 'BUILD_PASS', sourceRevision: revision, node: '24.21.0', sourceCleanAfter: true,
    studioSourceFiles: paths.map(file => ({ path: file, sha256: hash(file) })),
    commands: ['STUDIO_BUILD', 'APPIMAGE_DIST'].map(kind => ({ kind, argv: ['tool'], exitCode: 0,
      timedOut: false, cleanupTerminated: true, logSha256: 'c'.repeat(64) })),
    artifact: { path: artifact, size: 11, sha256: hash('built image') } };
  assert.equal(await validateAppImageBuild(directory, revision, selection, receipt), artifact);
  assert.equal(await validateAppImageBuild(directory, revision, selection,
    { ...receipt, studioSourceFiles: [...receipt.studioSourceFiles].reverse() }), artifact);
  for (const files of [[receipt.studioSourceFiles[0]], [receipt.studioSourceFiles[0], receipt.studioSourceFiles[0]]]) {
    await assert.rejects(validateAppImageBuild(directory, revision, selection,
      { ...receipt, studioSourceFiles: files }), /coverage mismatch/);
  }
  await writeFile(join(directory, paths[1]), 'unattested change');
  await assert.rejects(validateAppImageBuild(directory, revision, selection, receipt), /input mismatch/);
});
test('production selects pinned Studio 2 while Legacy shares the backend and keeps its own original profile', async t => {
  const directory = await mkdtemp(join(tmpdir(),'is-studio2-launch-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const appImage = join(directory,'Studio2.AppImage');
  await writeFile(appImage,'verified application',{mode:0o700});
  const config = { sourceRoot: ROOT, node: process.execPath, dbPath: '/data/original.sqlite',
    configDirectory: '/home/user/.config/intentsmith', stateDirectory: '/home/user/.local/state/intentsmith', icon: '/icons/app.png',
    studioAppImage: {path:appImage,sha256:await hashDesktopExecutable(appImage)}, userDataDirectory: '/home/user/.config/studio2',
    legacy: {sourceRoot:'/previous/installation',node:'/previous/node',userDataDirectory:'/home/user/.config/classic'} };
  const current = await resolveDesktopLaunch(config,{sandboxArgs:['--no-sandbox']});
  assert.equal(current.executable,appImage);
  assert.deepEqual(current.args,['--appimage-extract-and-run','--class=IntentSmith','--user-data-dir=/home/user/.config/studio2','--no-sandbox']);
  assert(!current.args.some(arg=>arg.includes('debugging')));
  const legacy = await resolveDesktopLaunch(config,{legacy:true});
  assert.equal(legacy.executable,'/previous/node');
  assert.equal(legacy.cwd,'/previous/installation');
  assert(legacy.args.includes('--user-data-dir=/home/user/.config/classic'));
  const files = renderDesktopInstallation(config);
  assert.match(files.desktop,/Name=IntentSmith IDE 2\.0/);
  assert.match(files.legacyDesktop,/Name=IntentSmith Legacy/);
  assert.match(files.legacyDesktop,/desktop-runtime\.mjs" --legacy/);
  await writeFile(appImage,'changed application');
  await assert.rejects(resolveDesktopLaunch(config),/DIGEST_MISMATCH/);
  await assert.rejects(resolveDesktopLaunch({...config,legacy:undefined},{legacy:true}),/LEGACY_NOT_INSTALLED/);
});
test('profile migration preserves original preferences and local data, excludes locks, and never overwrites an existing profile', async t => {
  const directory = await mkdtemp(join(tmpdir(),'is-studio2-profile-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const source = join(directory,'classic'), destination = join(directory,'studio2');
  await mkdir(join(source,'Local Storage'),{recursive:true});
  await writeFile(join(source,'Local Storage/state'),'original persisted state');
  await writeFile(join(source,'Preferences'),'original preferences');
  await symlink('host-123',join(source,'SingletonLock'));
  await seedDesktopProfile(source,destination);
  assert.equal(await readFile(join(destination,'Local Storage/state'),'utf8'),'original persisted state');
  assert.equal(await readFile(join(source,'Preferences'),'utf8'),'original preferences');
  await assert.rejects(lstat(join(destination,'SingletonLock')),{code:'ENOENT'});
  await writeFile(join(destination,'Preferences'),'new preferences');
  assert.equal((await seedDesktopProfile(source,destination)).existing,true);
  assert.equal(await readFile(join(destination,'Preferences'),'utf8'),'new preferences');
});
test('failed activation restores exact configuration and permissions, removes the new menu and verifies the original backend', async t => {
  const directory = await mkdtemp(join(tmpdir(),'is-studio2-rollback-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const backup = join(directory,'backup'), installed = join(directory,'runtime.env'), menu = join(directory,'legacy.desktop');
  await mkdir(backup); await writeFile(join(backup,'0.txt'),'original environment');
  await writeFile(installed,'new environment',{mode:0o755}); await writeFile(menu,'new menu');
  const config = {revision,dbPath:'/original/live.sqlite'}, calls=[];
  await restoreDesktopInstallation(backup,[{file:installed,backup:'0.txt',mode:0o600},{file:menu,backup:null}],{
    config,run:async args=>calls.push(args),verify:async previous=>{assert.equal(previous,config);calls.push(['verified-original']);}});
  assert.equal(await readFile(installed,'utf8'),'original environment');
  assert.equal((await lstat(installed)).mode&0o777,0o600);
  await assert.rejects(lstat(menu),{code:'ENOENT'});
  assert.deepEqual(calls.map(args=>args[0]),['stop','daemon-reload','reset-failed','start','verified-original']);
});
test('resource reserve uses available RAM, all filesystems, and fails closed on unknown capacity', () => {
  const GiB=2**30;
  const check=(memory,free,starting=false)=>inspectHuntResources(['/state','/models'],{
    starting,readMemory:()=>`MemAvailable: ${memory*GiB/1024} kB\nSwapFree: 0 kB`,
    diskStats:path=>({bsize:1,bavail:path==='/models'?free*GiB:100*GiB})});
  assert.equal(check(8,12,true).ready,true);
  assert.equal(check(7,12,true).code,'HUNT_MEMORY_RESERVE_LOW');
  assert.equal(check(4,12).ready,true);
  assert.equal(check(3,12).code,'HUNT_MEMORY_RESERVE_LOW');
  assert.equal(check(20,11).code,'HUNT_DISK_RESERVE_LOW');
  assert.equal(inspectHuntResources(['/state'],{readMemory:()=>''}).code,'HUNT_RESOURCE_PROBE_FAILED');
  assert.equal(inspectHuntResources(['/state'],{readMemory:()=> 'MemAvailable: 9000000 kB',
    diskStats:()=>({bsize:1,bavail:NaN})}).code,'HUNT_RESOURCE_PROBE_FAILED');
});
test('resource watcher stops once, records last probe, and can be disposed',async()=>{
  let stopped=0,samples=0;
  const dispose=watchHuntResources({intervalMs:5,inspect:()=>({ready:++samples<2,code:'HUNT_DISK_RESERVE_LOW'}),
    onSnapshot:s=>assert.equal(s.code,'HUNT_DISK_RESERVE_LOW'),onBlocked:()=>stopped++});
  await new Promise(r=>setTimeout(r,35));
  assert.equal(stopped,1);assert.equal(samples,2);dispose();
  const dispose2=watchHuntResources({intervalMs:5,inspect:()=>assert.fail('disposed'),onSnapshot(){},onBlocked(){}});
  dispose2();await new Promise(r=>setTimeout(r,15));
});
test('installation preserves stopped scheduling and an automation hold overrides a previously active timer', async () => {
  for (const [previous, held, expected] of [
    [{UnitFileState:'disabled',ActiveState:'inactive'},false,['disable','stop']],
    [{},false,['disable','stop']],
    [{UnitFileState:'enabled',ActiveState:'active'},false,['enable','start']],
    [{UnitFileState:'enabled',ActiveState:'inactive'},false,['enable','stop']],
    [{UnitFileState:'enabled',ActiveState:'active'},true,['disable','stop']],
  ]) {
    const calls=[];
    await restoreHuntTimerState(previous,{held,run:async args=>calls.push(args)});
    assert.deepEqual(calls.map(c=>c[0]),expected);
    assert(calls.every(c=>c.at(-1)==='intentsmith-model-hunt.timer'));
  }
});
test('manual CLI selection consumes the actual normalized inventory digest and rejects drift before pull',async()=>{
  const source=await readFile(join(ROOT,'scripts/model-upgrade-hunt.js'),'utf8');
  const block=source.slice(source.indexOf('let picked = queue;'),source.indexOf('if (INSTALLED_PANEL && picked.some'));
  const digest='d'.repeat(64),installed=buildCandidates([{name:'qwen3.5:27b',digest:'sha256:'+digest,size:1000,details:{parameter_size:'27B'}}]);
  const select=(name,expected)=>vm.runInNewContext('(async()=>{'+block+'return picked;})()',{
    queue:[],ONLY:[name],EVALUATE_INSTALLED:true,EXPECTED_DIGEST:expected,installed,ROLES:['CODE'],canonicalModelName,
    fetchFamilyTags:()=>{assert.fail('must not pull or discover');},
  });
  const rows=await select('qwen3.5:27b',digest);
  assert.equal(rows[0].artifact.digestSha256,digest);assert.equal(rows[0].installed,true);
  await assert.rejects(select('qwen3.5:27b','e'.repeat(64)),/ARTIFACT_CHANGED/);
  await assert.rejects(select('missing:7b',digest),/ARTIFACT_CHANGED/);
});

test('suite progress counts completed tasks across repeats and keeps model identity and unknown ETA',async()=>{
  const events=[];
  const runner={runSuite:async(suite,model,onProgress)=>{
    for(let i=0;i<2;i++)onProgress({suite,testName:'task-'+i,status:'running',currentTest:i+1,totalTests:2});
    onProgress({suite,status:'complete',currentTest:2,totalTests:2});
    return {tests:[{name:'task-0',score:1},{name:'task-1',score:1}],total:2,score:1};
  }};
  await comparePair(runner,'fixture','candidate','incumbent',{repeats:3,onProgress:e=>events.push(e)});
  for(const model of ['candidate','incumbent']){
    const rows=events.filter(e=>e.model===model);
    assert.deepEqual(rows.map(e=>e.completedTests),[0,1,2,2,3,4,4,5,6]);
    assert.deepEqual(rows.map(e=>e.percent),[0,16,33,33,50,66,66,83,100]);
    assert.ok(rows.every(e=>e.totalTests===6));assert.equal(rows[0].etaMs,null);
    assert.equal(rows.at(-1).repeat,3);assert.equal(rows.at(-1).etaMs,0);
  }
});

test('latest completed manual evaluation is not overridden by an older failed hunt service',async t=>{
  const {config,file}=await fixture(t);
  await mkdir(join(config.stateDirectory,'model-hunt'));
  const current=join(config.stateDirectory,'model-hunt/current.json');
  await writeFile(current,JSON.stringify({status:'COMPLETE',request:{kind:'evaluation',model:'fixture'}}),{mode:0o600});
  const control=createHuntControl({installationFile:file,databasePath:config.dbPath,inspectGpu:async()=>({available:true}),
    run:async args=>({stdout:`LoadState=loaded\nActiveState=${args[1].endsWith('.timer')?'active':args[1].includes('model-hunt')?'failed':'inactive'}\nWorkingDirectory=${ROOT}\nExecStart={ path=${process.execPath} ; argv[]=${ROOT}/scripts/run-model-hunt-provider.js ; }\nEnvironmentFiles=${config.configDirectory}/runtime.env (ignore_errors=no)\n`})});
  assert.equal((await control.status()).state,'WAITING');
  await writeFile(current,JSON.stringify({status:'FAILED'}),{mode:0o600});
  assert.equal((await control.status()).state,'FAILED');
  const run=join(config.stateDirectory,'model-hunt/run-fixture');await mkdir(run);
  const resources={checkedAt:new Date().toISOString(),ready:true,memoryAvailableBytes:10*2**30,disks:[{availableBytes:20*2**30}]};
  await writeFile(join(run,'resources.json'),JSON.stringify(resources),{mode:0o600});
  await writeFile(current,JSON.stringify({runId:'run-fixture',status:'COMPLETE'}),{mode:0o600});
  assert.deepEqual((await control.status()).resources,resources);
  await chmod(join(run,'resources.json'),0o644);
  assert.equal((await control.status()).resources.code,'HUNT_RESOURCE_STATE_UNAVAILABLE');
});


test('calibration diagnostic separates a stable near-tie from noise without overriding decisions',()=>{
  const data=[{model:'fixture',trials:[{role:'D1',decision:{reasonCode:'INSUFFICIENT_EVIDENCE'},
    policy:{minimumDiscriminatingTasks:3},comparison:{discriminating:2,tasks:[
      {name:'noisy',delta:0.2,noise:0.25,discriminating:false},{name:'tie',delta:0.01,noise:0,discriminating:false},
    ]}},{role:'R1',decision:{reasonCode:'INSUFFICIENT_EVIDENCE'},comparison:{discriminating:2,tasks:[{name:'tie',delta:0,noise:0,discriminating:false}]}},
    {role:'D2',decision:{reasonCode:'CANDIDATE_QUALITY'},comparison:{tasks:[]}}]}];
  const before=JSON.stringify(data),d=analyzeHuntDecisions(data);
  assert.equal(d.evaluated,3);assert.equal(d.insufficient,2);assert.equal(d.variabilityLimited,1);assert.equal(d.smallObservedDifference,1);
  assert.deepEqual(d.cases[0].noiseLimited,['noisy']);assert.equal(JSON.stringify(data),before);
});
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'intentsmith-desktop-'));
  t.after(() => rm(home,{recursive:true,force:true}));
  const config = { schemaVersion:1, sourceRoot:ROOT, revision, node:process.execPath,
    dbPath:join(home,'data/intentsmith.db'), configDirectory:join(home,'config'), stateDirectory:join(home,'state'), icon:join(home,'icon.png') };
  await mkdir(config.stateDirectory,{recursive:true});
  await mkdir(config.configDirectory,{recursive:true});
  await writeFile(join(config.configDirectory,'runtime.env'),`INTENTSMITH_DB_PATH="${config.dbPath}"\n`,{mode:0o600});
  const file=join(home,'installation.json');
  await writeFile(file,JSON.stringify(config),{mode:0o600});
  return {home,config,file};
}

test('desktop and hunt use one environment, bounded commands, and persistent scheduling', async () => {
  const files=renderDesktopInstallation({sourceRoot:'/opt/Intent Smith',node:'/usr/bin/node',dbPath:'/data/user/intentsmith.db',
    configDirectory:'/home/user/.config/intentsmith',stateDirectory:'/home/user/.local/state/intentsmith',icon:'/opt/icon.png'});
  assert.match(files.environment,/INTENTSMITH_DB_PATH="\/data\/user\/intentsmith.db"/);
  assert.doesNotMatch(files.hunt,/--prune-rejected|--allow-removal/,
    'installation must preserve the grading-validity pause on unattended removal');
  assert.match(files.environment,/INTENTSMITH_PROJECTS_DIR="\/data\/projects"/);
  const customRoot=renderDesktopInstallation({sourceRoot:'/opt/next-release',node:'/usr/bin/node',dbPath:'/data/user/intentsmith.db',projectsDirectory:'/data/IntentSmith/projects',
    configDirectory:'/home/user/.config/intentsmith',stateDirectory:'/home/user/.local/state/intentsmith',icon:'/opt/icon.png'});
  assert.match(customRoot.environment,/INTENTSMITH_PROJECTS_DIR="\/data\/IntentSmith\/projects"/);
  assert.match(files.environment,/\nNODE_ENV=production\n/);
  for(const unit of [files.backend,files.hunt]) {
    assert.match(unit,/WorkingDirectory=\/opt\/Intent Smith\n/);
    assert.match(unit,/EnvironmentFile=\/home\/user\/.config\/intentsmith\/runtime.env\n/);
    assert.match(unit,/KillMode=control-group/);
  }
  assert.match(files.hunt,/--limit=2 .*--scheduled/);
  assert.match(files.timer,/Persistent=false/);
  assert.match(files.desktop,/Terminal=false/);
  assert.match(files.apparmor,/profile intentsmith "\/opt\/Intent Smith\/intentsmith-ide\/node_modules\/electron\/dist\/electron" flags=\(unconfined\)/);
  assert.match(files.apparmor,/\n  userns,\n/);
  assert.throws(()=>renderDesktopInstallation({sourceRoot:'/bad\nExecStart=attack'}),/DESKTOP_PATH_UNSUPPORTED/);
  await verifyDesktopUnits(files);
  await assert.rejects(verifyDesktopUnits({...files,backend:files.backend.replace(
    'EnvironmentFile=/home/user/.config/intentsmith/runtime.env',
    'EnvironmentFile="/home/user/.config/intentsmith/runtime.env"')}),/DESKTOP_UNIT_VALIDATION/);
});

test('desktop entry is executable and both generic and KDE caches are refreshed', async t => {
  const {home}=await fixture(t),desktop=join(home,'intentsmith.desktop');
  await writePrivate(desktop,'[Desktop Entry]\n',0o755);
  assert.equal((await lstat(desktop)).mode & 0o777,0o755);
  await assert.rejects(writePrivate(join(home,'bad'),'bad',0o777),/DESKTOP_FILE_MODE_UNSUPPORTED/);
  const calls=[];
  const cache=await refreshDesktopCaches(join(home,'applications'),{run:async(command,args)=>{
    calls.push([command,args]);if(command.endsWith('kbuildsycoca6')){const error=new Error('missing');error.code='ENOENT';throw error;}
  }});
  assert.deepEqual(calls.map(call=>call[0]),['/usr/bin/update-desktop-database','/usr/bin/kbuildsycoca6','/usr/bin/kbuildsycoca5']);
  assert.deepEqual(cache.refreshed,['/usr/bin/update-desktop-database','/usr/bin/kbuildsycoca5']);
  assert.deepEqual(cache.warnings,[]);
  const installer=await readFile(join(ROOT,'scripts/install-desktop.mjs'),'utf8');
  assert.match(installer,/intentsmith\.desktop'\),files\.desktop,0o755/);
});

test('desktop launcher offers a bounded fallback for the Kubuntu AppArmor sandbox conflict', async t => {
  const {home,config}=await fixture(t);
  config.sourceRoot=join(home,'source');
  const electronDir=join(config.sourceRoot,'intentsmith-ide/node_modules/electron/dist');
  const restricted=join(home,'restricted-userns'),profile=join(home,'missing-profile');
  await mkdir(electronDir,{recursive:true});
  await writeFile(join(electronDir,'chrome-sandbox'),'fixture',{mode:0o755});
  await writeFile(restricted,'1\n');
  const calls=[];
  const args=await resolveElectronSandboxArgs(config,{env:{DISPLAY:':0'},restrictFile:restricted,profileFile:profile,
    run:async(file,argv)=>{calls.push({file,argv});}});
  assert.deepEqual(args,['--no-sandbox']);
  assert.equal(calls.length,1);assert.match(calls[0].argv.at(-1),/jednu vrstvu izolace/);
  assert.match(await readFile(join(config.configDirectory,'allow-no-sandbox'),'utf8'),/potvrdil/);
  const remembered=await resolveElectronSandboxArgs(config,{env:{DISPLAY:':0'},restrictFile:restricted,profileFile:profile,
    run:async()=>{throw new Error('remembered choice must not prompt');}});
  assert.deepEqual(remembered,['--no-sandbox']);
});

test('desktop launcher keeps sandbox when available and supports an explicit one-shot override', async t => {
  const {home,config}=await fixture(t);
  assert.deepEqual(await resolveElectronSandboxArgs(config,{env:{INTENTSMITH_NO_SANDBOX:'1'}}),['--no-sandbox']);
  const unrestricted=join(home,'unrestricted-userns');await writeFile(unrestricted,'0\n');
  assert.deepEqual(await resolveElectronSandboxArgs(config,{env:{},restrictFile:unrestricted}),[]);
});

test('hunt status shows observed queue, failures and the actual timer independently', async t => {
  const {config,file}=await fixture(t),calls=[];
  await mkdir(join(config.stateDirectory,'model-hunt/run-abc'),{recursive:true});
  await writeFile(join(config.stateDirectory,'model-hunt/current.json'),JSON.stringify({runId:'run-abc',status:'SCHEDULED_SKIPPED',reasons:['GPU_BUSY']}),{mode:0o600});
  await writeFile(join(config.stateDirectory,'model-hunt/run-abc/progress.json'),JSON.stringify({updatedAt:'2026-09-17T00:00:00Z',queue:[{name:'fixture',state:'PENDING'}]}),{mode:0o600});
  let drift=false;
  const control=createHuntControl({installationFile:file,databasePath:config.dbPath,inspectGpu:async()=>({available:true}),run:async args=>{calls.push(args);return {stdout:'LoadState=loaded\nActiveState='+ (args[1].endsWith('.timer')?'active':'inactive')+'\n'+
    `WorkingDirectory=${drift?'/wrong':ROOT}\nExecStart={ path=${process.execPath} ; argv[]=${process.execPath} ${ROOT}/scripts/run-model-hunt-provider.js ; }\nEnvironmentFiles=${config.configDirectory}/runtime.env (ignore_errors=no)\n`};}});
  const value=await control.status();
  assert.equal(value.state,'WAITING');assert.equal(value.current.status,'SCHEDULED_SKIPPED');
  assert.deepEqual(value.queue,[]);assert.equal(value.lastPlan[0].name,'fixture');assert.equal(value.queueObservedAt,'2026-09-17T00:00:00Z');
  await control.control('start');assert.deepEqual(calls.at(-1),['start','--no-block','intentsmith-model-hunt.service']);
  const count=calls.length;await assert.rejects(control.control('start; reboot'),/HUNT_ACTION_INVALID/);assert.equal(calls.length,count);
  await control.control('pause');assert.deepEqual(calls.at(-1),['disable','--now','intentsmith-model-hunt.timer']);
  await control.control('stop');assert.deepEqual(calls.at(-1),['stop','--no-block','intentsmith-model-hunt.service']);
  drift=true;const before=calls.filter(a=>a[0]==='start').length;
  await assert.rejects(control.control('start'),/HUNT_INSTALLATION_MISMATCH/);
  assert.equal(calls.filter(a=>a[0]==='start').length,before);
});

test('missing, foreign and symlinked installation fail before service control', async t=>{
  const {home,config,file}=await fixture(t);let calls=0;
  const run=async()=>{calls++;return {stdout:''};};
  await assert.rejects(createHuntControl({installationFile:join(home,'missing'),run}).control('start'));
  await writeFile(file,JSON.stringify({...config,sourceRoot:home}));
  await assert.rejects(createHuntControl({installationFile:file,databasePath:config.dbPath,run}).control('start'),/MISMATCH/);
  const link=join(home,'link');await symlink(file,link);
  await assert.rejects(createHuntControl({installationFile:link,run}).control('start'),/UNSAFE/);
  assert.equal(calls,0);
});

test('hunt routes require actual local transport provenance before body parsing or effects', async()=>{
  let calls=0,body={action:'start'},parses=0;
  const routes=createSystemRoutes({db:{},sendJSON:(_res,status,value)=>({status,value}),parseBody:async()=>{parses++;return body;},
    huntControl:{status:async()=>({state:'WAITING'}),control:async action=>{calls++;return {action};}}});
  const route=routes['POST /api/system/models/hunt/control'];
  assert.equal((await route({authenticatedSubject:{actorType:'user',actorId:'local-operator'}},{})).status,403);
  assert.equal(parses,0);assert.equal(calls,0);
  const subject=createGlobalAuthAuthority({production:true,localCapability:capability}).authorize({
    routeKey:'POST /api/system/models/hunt/control',headers:{'x-intentsmith-local-capability':capability},remoteAddress:'127.0.0.1'}).subject;
  assert.ok(subject);
  assert.equal((await route({authenticatedSubject:subject},{})).status,202);assert.equal(calls,1);
  body={action:'start',argv:['evil']};assert.equal((await route({authenticatedSubject:subject},{})).status,400);assert.equal(calls,1);
});

test('launcher verifies authenticated installation revision and DB rather than a public health response',async t=>{
  const {config}=await fixture(t);
  await writeFile(join(config.stateDirectory,'backend.port.json'),JSON.stringify({host:'127.0.0.1',port:34567,localCapability:capability}),{mode:0o600});
  const access=await waitForBackend(config,{fetchImpl:async(url,options)=>{
    assert.equal(url,'http://127.0.0.1:34567/api/system/models/hunt');
    if (!options.headers) return {status:401};
    assert.equal(options.headers['x-intentsmith-local-capability'],capability);
    return {ok:true,json:async()=>({installation:{revision,dbPath:config.dbPath}})};
  }});assert.equal(access.port,34567);
  await assert.rejects(waitForBackend(config,{timeoutMs:1,fetchImpl:async()=>({ok:true,json:async()=>({status:'ok'})})}),/Backend/);
  await assert.rejects(waitForBackend(config,{timeoutMs:1,fetchImpl:async()=>({ok:true,status:200,
    json:async()=>({installation:{revision,dbPath:config.dbPath}})})}),/Backend/);
});

test('legacy launcher preserves attached backend and its port file on Studio failure',async t=>{
  const {home}=await fixture(t),bin=join(home,'bin'),port=join(home,'port.json');await mkdir(bin);
  for(const [name,script] of [['curl','exit 0'],['yarn','exit 17']])await writeFile(join(bin,name),'#!/bin/sh\n'+script+'\n',{mode:0o700});
  const data=JSON.stringify({host:'127.0.0.1',port:34567,pid:process.pid,localCapability:capability});
  await writeFile(port,data,{mode:0o600});
  await assert.rejects(exec('/bin/bash',[join(ROOT,'scripts/run.sh')],{cwd:ROOT,env:{...process.env,HOME:home,
    INTENTSMITH_PORT_FILE:port,INTENTSMITH_INSTALLATION_FILE:join(home,'absent'),PATH:bin+':'+process.env.PATH},timeout:10000}),e=>e.code===17);
  assert.equal(await readFile(port,'utf8'),data);assert.doesNotThrow(()=>process.kill(process.pid,0));
});



test('GPU mismatch and unknown probe are actionable blockers, never zero-VRAM success',async()=>{
  const mismatch=await inspectHuntGpu({run:async()=>{throw Object.assign(new Error('exit 18'),{stdout:'Failed to initialize NVML: Driver/library version mismatch\n'});}});
  assert.equal(mismatch.available,false);assert.equal(mismatch.code,'GPU_DRIVER_LIBRARY_MISMATCH');assert.match(mismatch.message,/restartuj/);
  const unknown=await inspectHuntGpu({run:async()=>({stdout:'595.91, N/A'})});
  assert.equal(unknown.available,false);assert.equal(unknown.vramMb,null);
  const good=await inspectHuntGpu({run:async()=>({stdout:'595.91, 24576\n'})});
  assert.equal(good.available,true);assert.equal(good.vramMb,24576);
});

test('selected installed evaluation pins artifact and role, forbids effects on drift/busy/broken GPU',async t=>{
  const {config,file}=await fixture(t);let launched=[],active=false,available=true;
  const control=createHuntControl({installationFile:file,databasePath:config.dbPath,
    inspectGpu:async()=>({available,code:'GPU_PROBE_UNAVAILABLE',message:'GPU unavailable'}),
    launch:async args=>{launched.push(args);},run:async args=>({stdout:
      `LoadState=loaded\nActiveState=${active?'active':'inactive'}\nWorkingDirectory=${ROOT}\nExecStart={ path=${process.execPath} ; argv[]=${process.execPath} ${ROOT}/scripts/run-model-hunt-provider.js ; }\nEnvironmentFiles=${config.configDirectory}/runtime.env (ignore_errors=no)\n`})});
  const request={model:'fixture:7b',role:'CODE',digestSha256:'d'.repeat(64),suiteContractSha256:'e'.repeat(64)};
  const evaluations={roles:{CODE:{suiteContractSha256:request.suiteContractSha256,decisionReady:true,artifacts:[{model:request.model,digestSha256:request.digestSha256,applicable:true}]}}};
  await control.evaluate(request,evaluations);
  assert.equal(launched.length,1);assert.ok(launched[0].includes('--evaluate-installed'));
  assert.ok(launched[0].includes('--expected-digest='+request.digestSha256));
  assert.ok(launched[0].includes('--expected-contract='+request.suiteContractSha256));
  assert.ok(launched[0].includes('--scheduled'));assert.ok(!launched[0].includes('--prune-rejected'));
  await assert.rejects(control.evaluate({...request,argv:['--prune-rejected']},evaluations),/INVALID/);
  await assert.rejects(control.evaluate({...request,model:'--help'},evaluations),/INVALID/);
  await assert.rejects(control.evaluate({...request,digestSha256:'f'.repeat(64)},evaluations),/IDENTITY/);
  await assert.rejects(control.evaluate({...request,suiteContractSha256:'f'.repeat(64)},evaluations),/IDENTITY/);
  active=true;await assert.rejects(control.evaluate(request,evaluations),/ALREADY_RUNNING/);
  active=false;available=false;await assert.rejects(control.evaluate(request,evaluations),/GPU unavailable/);
  assert.equal((await control.status()).state,'BLOCKED');
  assert.equal(launched.length,1);
});

test('display capacity survives NVML failure without authorizing inference or summing GPUs',async()=>{
  const run=async(command,args,options)=>{
    if(command==='nvidia-smi')throw Object.assign(new Error('exit 18'),{stderr:'Driver/library version mismatch'});
    assert.equal(command,'nvidia-settings');assert.deepEqual(args,['-t','-q','[gpu]/TotalDedicatedGPUMemory']);
    assert.equal(options.timeout,3000);
    return {stdout:'24103\n8192\n',stderr:'ERROR: An internal driver error occurred'};
  };
  const gpu=await inspectHuntGpu({run});
  const capacity=await readNvidiaDisplayCapacity({run,platform:'linux'});
  assert.equal(gpu.available,false);assert.equal(gpu.code,'GPU_DRIVER_LIBRARY_MISMATCH');
  assert.deepEqual(capacity,{vramMb:24103,source:'nvidia-settings'});
  assert.equal(Object.hasOwn(capacity,'available'),false);
  for(const stdout of ['', 'N/A', '0', '-1', '24103\nN/A', 'Infinity', '9007199254740992']) {
    assert.equal(await readNvidiaDisplayCapacity({run:async()=>({stdout}),platform:'linux'}),null);
  }
  assert.equal(await readNvidiaDisplayCapacity({run:async()=>{throw new Error('no display');},platform:'linux'}),null);
  assert.equal(await readNvidiaDisplayCapacity({run:async()=>{assert.fail('not Linux');},platform:'darwin'}),null);
});

test('provider wrapper preserves an active run and incomplete ownership blocks a concurrent claimant',async t=>{
  const {home}=await fixture(t),state=join(home,'hunt'),lockPath=join(state,'provider.lock');
  await mkdir(state);
  const current='{"status":"RUNNING","runId":"run-owner"}\n';
  await writeFile(join(state,'current.json'),current,{mode:0o600});
  await mkdir(lockPath);
  assert.throws(()=>acquireGpuEvaluationLock({lockPath}),error=>error.code==='GPU_EVALUATION_BUSY');
  await rm(lockPath,{recursive:true});
  const lease=acquireGpuEvaluationLock({lockPath});t.after(()=>lease.release());
  const result=await exec(process.execPath,[join(ROOT,'scripts/run-model-hunt-provider.js'),'--run'],{
    env:{...process.env,INTENTSMITH_HUNT_STATE_DIR:state,INTENTSMITH_EVAL_RUNTIME:join(home,'must-not-be-read')},timeout:10000});
  assert.equal(JSON.parse(result.stdout).reason,'EVALUATION_PROVIDER_BUSY');
  assert.equal(await readFile(join(state,'current.json'),'utf8'),current);
});

test('selected evaluation HTTP rejects a remote or forged subject before reading inventory',async()=>{
  let effects=0;
  const routes=createSystemRoutes({db:{},sendJSON:(_r,status,value)=>({status,value}),parseBody:async()=>{effects++;return {};},huntControl:{evaluate:async()=>{effects++;}}});
  const result=await routes['POST /api/system/models/evaluate']({authenticatedSubject:{actorType:'user',actorId:'local-operator'}},{});
  assert.equal(result.status,403);assert.equal(effects,0);
});

test('grading HTTP rejects forged local identity before reading answers or launching GPU work',async()=>{
  let effects=0;
  const routes=createSystemRoutes({db:{},sendJSON:(_r,status,value)=>({status,value}),
    parseBody:async()=>{effects++;return {};},huntControl:{grade:async()=>{effects++;}}});
  const result=await routes['POST /api/system/models/grade']({authenticatedSubject:{actorType:'user',actorId:'local-operator'}},{});
  assert.equal(result.status,403);assert.equal(effects,0);
});

test('grading launches only an exact reviewed source, with the same resource limits and no new inference of answers',async t=>{
  const {config,file}=await fixture(t),launched=[];
  const control=createHuntControl({installationFile:file,databasePath:config.dbPath,inspectGpu:async()=>({available:true}),
    launch:async args=>launched.push(args),run:async()=>({stdout:`LoadState=loaded\nActiveState=inactive\nWorkingDirectory=${ROOT}\nExecStart={ path=${process.execPath} ; argv[]=${ROOT}/scripts/run-model-hunt-provider.js ; }\nEnvironmentFiles=${config.configDirectory}/runtime.env (ignore_errors=no)\n`})});
  const request={runId:'eval_test',graderAcceptanceId:'accept_test',sourceSha256:'a'.repeat(64)},
    preview={runId:request.runId,sourceSha256:request.sourceSha256,graders:[{id:'accept_test'}],model:'fixture',role:'D1'};
  await assert.rejects(control.grade({...request,sourceSha256:'b'.repeat(64)},preview),/EVIDENCE_CHANGED/);
  await assert.rejects(control.grade({...request,command:'anything'},preview),/REQUEST_INVALID/);
  assert.equal(launched.length,0);await control.grade(request,preview);
  assert.ok(launched[0].includes('--grade-collection'));assert.ok(launched[0].includes('--expected-source='+request.sourceSha256));
  assert.ok(launched[0].includes('--property=MemoryMax=75%'));assert.ok(!launched[0].includes('--evaluate-installed'));
});



test('historical HTTP detail delegates to the injected read authority with the exact run ID',async()=>{
  const calls=[];
  const routes=createSystemRoutes({db:{},sendJSON:(_r,status,value)=>({status,value}),modelRegistry:{getEvaluationRun(id){calls.push(id);return {runId:id,score:.114};}}});
  const result=await routes['GET /api/system/models/evaluations/:runId']({params:{runId:'old-measurement'}},{});
  assert.equal(result.status,200);assert.equal(result.value.runId,'old-measurement');assert.deepEqual(calls,['old-measurement']);
  const unavailable=createSystemRoutes({db:{},sendJSON:(_r,status,value)=>({status,value})});
  assert.equal((await unavailable['GET /api/system/models/evaluations/:runId']({params:{runId:'x'}},{})).status,503);
});








test('GPU inventory survives restart and refreshes daily without discarding last known capacity on failure', async t => {
  const {home}=await fixture(t),file=join(home,'gpu.json');let clock=1000,calls=0,available=true;
  const detect=()=>{calls++;return {gpus:[{gpu_model:'RTX fixture',vram_mb:available?24576:0}]};};
  const opts={file,host:'test-host',now:()=>clock,detect};
  const first=createGpuProfileCache(opts);assert.equal(first().gpus[0].vram_mb,24576);assert.equal(calls,1);
  for(let i=0;i<10;i++)first();assert.equal(calls,1);
  const restarted=createGpuProfileCache(opts);assert.equal(restarted().detectedAt,new Date(1000).toISOString());assert.equal(calls,1);
  clock+=86400001;available=false;const stale=restarted();assert.equal(calls,2);assert.equal(stale.gpus[0].vram_mb,24576);assert.equal(stale.inventoryStale,true);
  assert.equal(createGpuProfileCache(opts)().gpus[0].vram_mb,24576);assert.equal(calls,2);
  available=true;assert.equal(restarted(true).inventoryStale,false);assert.equal(calls,3);
  assert.equal((await lstat(file)).mode&0o777,0o600);
});

test('manual GPU wait observes the owner until release and respects a bounded deadline',async()=>{
  let clock=0,probes=0;const waits=[];
  const result=await waitForGpuReadiness({deadline:20000,now:()=>clock,pause:async ms=>{clock+=ms;},
    probe:async()=>({ready:++probes>=3,reasons:['foreign owner']}),onWait:s=>waits.push(s.reasons[0])});
  assert.equal(result.ready,true);assert.equal(probes,3);assert.deepEqual(waits,['foreign owner','foreign owner']);
  clock=0;probes=0;
  const expired=await waitForGpuReadiness({deadline:6000,now:()=>clock,pause:async ms=>{clock+=ms;},probe:async()=>({ready:false,reasons:['busy']})});
  assert.equal(expired.ready,false);assert.equal(clock,6000);
});

test('hunt retains the last five results and does not present an old plan as queued work',async t=>{
  const {config,file}=await fixture(t);const base=join(config.stateDirectory,'model-hunt');await mkdir(base);
  for(let i=0;i<7;i++){const dir=join(base,'run-test'+i);await mkdir(dir);await writeFile(join(dir,i<3?'result.json':'summary.json'),JSON.stringify({runId:'run-test'+i,status:i===6?'FAILED':'COMPLETE',generatedAt:'2026-09-18T00:00:0'+i+'Z',finishedAt:i<3?undefined:'2026-09-18T00:00:0'+i+'Z',results:[]}),{mode:0o600});}
  await writeFile(join(base,'current.json'),JSON.stringify({runId:'run-test6',status:'FAILED',finishedAt:'2026-09-18T00:00:06Z'}),{mode:0o600});
  await writeFile(join(base,'run-test6/progress.json'),JSON.stringify({queue:[{name:'already tried'}]}),{mode:0o600});
  let probes=0;const control=createHuntControl({installationFile:file,databasePath:config.dbPath,inspectGpu:async()=>{probes++;return {available:true};},
    readInventory:()=>({gpus:[{vram_mb:24576}]}),run:async args=>({stdout:`LoadState=loaded\nActiveState=${args[1].endsWith('.timer')?'active':'inactive'}\nWorkingDirectory=${ROOT}\nExecStart={ path=${process.execPath} ; argv[]=${ROOT}/scripts/run-model-hunt-provider.js ; }\nEnvironmentFiles=${config.configDirectory}/runtime.env (ignore_errors=no)\n`})});
  const result=await control.status();assert.equal(result.recent.length,5);assert.equal(result.recent[0].runId,'run-test6');assert.equal(result.recent.at(-1).runId,'run-test2');
  assert.deepEqual(result.queue,[]);assert.equal(result.lastPlan.length,1);assert.equal(result.gpuInventory.gpus[0].vram_mb,24576);
  await control.status();assert.equal(probes,1);await control.status({freshGpu:true});assert.equal(probes,2);
});










test('complete evaluation preflights every role and launches one serial service with distinct contract pins',async t=>{
  const {config,file}=await fixture(t),launched=[];
  const control=createHuntControl({installationFile:file,databasePath:config.dbPath,
    inspectGpu:async()=>({available:true}),launch:async args=>launched.push(args),
    run:async()=>({stdout:`LoadState=loaded\nActiveState=inactive\nWorkingDirectory=${ROOT}\nExecStart={ path=${process.execPath} ; argv[]=${process.execPath} ${ROOT}/scripts/run-model-hunt-provider.js ; }\nEnvironmentFiles=${config.configDirectory}/runtime.env (ignore_errors=no)\n`})});
  const request={model:'fixture:7b',digestSha256:'d'.repeat(64),roles:[{role:'CODE',suiteContractSha256:'a'.repeat(64)},{role:'CHAT',suiteContractSha256:'b'.repeat(64)}]};
  const evaluations={roles:Object.fromEntries(request.roles.map(pin=>[pin.role,{suiteContractSha256:pin.suiteContractSha256,decisionReady:true,artifacts:[{model:request.model,digestSha256:request.digestSha256,applicable:true}]}]))};
  for(const roles of [[],[...request.roles,request.roles[0]],[{role:'UNKNOWN',suiteContractSha256:'c'.repeat(64)}],[{...request.roles[0],argv:[]}]] )await assert.rejects(control.evaluate({...request,roles},evaluations),/INVALID/);
  await assert.rejects(control.evaluate({...request,roles:[request.roles[0],{...request.roles[1],suiteContractSha256:'c'.repeat(64)}]},evaluations),/IDENTITY/);
  evaluations.roles.CHAT.artifacts[0].applicable=false;
  await assert.rejects(control.evaluate(request,evaluations),/IDENTITY/);assert.equal(launched.length,0);
  evaluations.roles.CHAT.artifacts[0].applicable=true;
  const accepted=await control.evaluate(request,evaluations);
  assert.deepEqual(accepted.roles,['CODE','CHAT']);assert.equal(launched.length,1);
  assert.ok(launched[0].includes('--role=CODE,CHAT'));
  assert.deepEqual(JSON.parse(launched[0].find(v=>v.startsWith('--expected-contracts=')).slice(21)),{CODE:'a'.repeat(64),CHAT:'b'.repeat(64)});
  assert.ok(!launched[0].some(v=>/prune|activate|allow-removal/.test(v)));
});

test('manual CLI validates all pins before execution and incomplete batches cannot claim COMPLETE',async()=>{
  const source=await readFile(join(ROOT,'scripts/model-upgrade-hunt.js'),'utf8');
  const validation=source.slice(source.indexOf('const ROLE_FILTER ='),source.indexOf('\nconst log ='));
  const roles=['CODE','CHAT'],hash='a'.repeat(64);
  const validate=(pins,roleText='CODE,CHAT')=>vm.runInNewContext(validation,{val:n=>n==='role'?roleText:n==='expected-contracts'?JSON.stringify(pins):null,config:{models:{CODE:{},CHAT:{}}},
    EVALUATE_INSTALLED:true,DO_RUN:true,ONLY:['fixture'],EXPECTED_CONTRACT:null,EXPECTED_DIGEST:'d'.repeat(64),expectedContracts:pins,PRUNE_REJECTED:false,REMOTE_ONLY:false,INSTALLED_PANEL:false,console,process:{exit(){throw Error('EXIT');}}});
  validate({CODE:hash,CHAT:hash});
  for(const pins of [{CODE:hash},{CODE:hash,CHAT:'bad'},{CODE:hash,CHAT:hash,VISION:hash}])assert.throws(()=>validate(pins),/INVALID/);
  assert.throws(()=>validate({CODE:hash},'CODE,CODE'),/INVALID/);
  const start=source.indexOf("...(EVALUATE_INSTALLED ? { status:");const end=source.indexOf('\n    gpu,',start);
  const status=(results,{installed=true,blocked=[]}={})=>vm.runInNewContext('({'+source.slice(start,end)+'})',{
    EVALUATE_INSTALLED:installed,ROLE_FILTER:roles,results,blockedRoles:blocked,
    blockedRoleDetails:blocked.map(role=>({role,code:'EVALUATION_SUITE_NOT_READY'})),
  });
  const full={trials:roles.map(role=>({role,evaluation:{score:.8}}))};
  assert.equal(status([full]).status,'COMPLETE');assert.equal(status([{trials:[full.trials[0]]}]).status,'BLOCKED');
  assert.equal(status([{...full,roleErrors:[{role:'CHAT'}]}]).status,'FAILED');
  const mixed=status([full],{installed:false,blocked:['CODE']});
  assert.equal(mixed.status,'PARTIAL');assert.equal(mixed.blockedRoles[0].role,'CODE');
  const awaiting=status([{trials:[{role:'CHAT',evaluation:{collection:{status:'AWAITING_REVIEW'}}}]}],{installed:false,blocked:['CODE']});
  assert.equal(awaiting.status,'PARTIAL');assert.deepEqual(Array.from(awaiting.awaitingReviewRoles),['CHAT']);
});

test('automation hold is visible and refuses start/resume while preserving manual exploratory measurement', async t => {
  const {config,file}=await fixture(t),effects=[];
  await mkdir(config.stateDirectory,{recursive:true});
  await writeFile(join(config.stateDirectory,'code-pilot-automation-hold.json'),JSON.stringify({reason:'Review pending',releaseCondition:'Accepted evaluator'}),{mode:0o600});
  const control=createHuntControl({installationFile:file,databasePath:config.dbPath,
    inspectGpu:async()=>({available:true}),launch:async args=>effects.push(['launch',...args]),
    run:async args=>{if(args[0]!=='show')effects.push(args);return {stdout:`LoadState=loaded\nActiveState=inactive\nConditionResult=no\nConditionTimestampMonotonic=123\nWorkingDirectory=${ROOT}\nExecStart={ path=${process.execPath} ; argv[]=${ROOT}/scripts/run-model-hunt-provider.js ; }\nEnvironmentFiles=${config.configDirectory}/runtime.env (ignore_errors=no)\n`};}});
  const status=await control.status();assert.equal(status.state,'HELD');assert.equal(status.hold.reason,'Review pending');
  assert.equal(status.lastStartConditionFailed,true);
  await assert.rejects(control.control('start'),/HUNT_AUTOMATION_HELD/);
  await assert.rejects(control.control('resume'),/HUNT_AUTOMATION_HELD/);assert.equal(effects.length,0);
  await chmod(join(config.stateDirectory,'code-pilot-automation-hold.json'),0o664);
  const unreadable=await control.status();assert.equal(unreadable.state,'HELD');
  assert.equal(unreadable.hold.metadataStatus,'UNREADABLE');
  await assert.rejects(control.control('resume'),/HUNT_AUTOMATION_HELD/);assert.equal(effects.length,0);
  await chmod(join(config.stateDirectory,'code-pilot-automation-hold.json'),0o600);
  await writeFile(join(config.stateDirectory,'code-pilot-automation-hold.json'),'{ malformed');
  assert.equal((await control.status()).state,'HELD');
  const request={model:'fixture:7b',role:'CODE',digestSha256:'d'.repeat(64),suiteContractSha256:'e'.repeat(64)};
  const evaluations={roles:{CODE:{suiteContractSha256:request.suiteContractSha256,measurementReady:true,decisionReady:false,
    artifacts:[{model:request.model,digestSha256:request.digestSha256,applicable:true}]}}};
  assert.equal((await control.evaluate(request,evaluations)).accepted,true);assert.equal(effects.length,1);
  assert.equal(effects[0][0],'launch');
});

// Active Studio 2 adapters replace source extraction from the retired React monolith.
test('desktop-hunt: active Studio 2 integration coverage', () => {
  const output = runStudio2BehaviorTests(process.execPath, ['--test', '--test-reporter=tap', 'tests/studio2-model-workspace.test.js', 'tests/studio2-live-model.test.js'], { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 120000, env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
  if (!/# fail 0/.test(output)) throw new Error('Active Studio 2 tests did not complete: ' + output);
});
