import './helpers/isolated-test-db.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import vm from 'node:vm';
import { createHuntControl } from '../src/system/hunt-control.js';
import { analyzeHuntDecisions } from '../src/upgrade/model-hunt-diagnostics.js';
import { createGlobalAuthAuthority } from '../src/security/global-auth-policy.js';
import { createSystemRoutes } from '../src/routes/system.js';
import { ROOT, refreshDesktopCaches, renderDesktopInstallation, resolveElectronSandboxArgs, verifyDesktopUnits, waitForBackend, writePrivate } from '../scripts/desktop-runtime.mjs';
const exec = promisify(execFile);
const revision = 'a'.repeat(40);
const capability = 'c'.repeat(43);
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
    dbPath:join(home,'data/c3.db'), configDirectory:join(home,'config'), stateDirectory:join(home,'state'), icon:join(home,'icon.png') };
  await mkdir(config.stateDirectory,{recursive:true});
  await mkdir(config.configDirectory,{recursive:true});
  await writeFile(join(config.configDirectory,'runtime.env'),`C3_DB_PATH="${config.dbPath}"\n`,{mode:0o600});
  const file=join(home,'installation.json');
  await writeFile(file,JSON.stringify(config),{mode:0o600});
  return {home,config,file};
}

test('desktop and hunt use one environment, bounded commands, and persistent scheduling', async () => {
  const files=renderDesktopInstallation({sourceRoot:'/opt/Intent Smith',node:'/usr/bin/node',dbPath:'/data/user/c3.db',
    configDirectory:'/home/user/.config/intentsmith',stateDirectory:'/home/user/.local/state/intentsmith',icon:'/opt/icon.png'});
  assert.match(files.environment,/C3_DB_PATH="\/data\/user\/c3.db"/);
  assert.match(files.environment,/\nNODE_ENV=production\n/);
  for(const unit of [files.backend,files.hunt]) {
    assert.match(unit,/WorkingDirectory=\/opt\/Intent Smith\n/);
    assert.match(unit,/EnvironmentFile=\/home\/user\/.config\/intentsmith\/runtime.env\n/);
    assert.match(unit,/KillMode=control-group/);
  }
  assert.match(files.hunt,/--limit=2 .*--scheduled/);
  assert.match(files.timer,/Persistent=true/);
  assert.match(files.desktop,/Terminal=false/);
  assert.match(files.apparmor,/profile intentsmith "\/opt\/Intent Smith\/c3-ide\/node_modules\/electron\/dist\/electron" flags=\(unconfined\)/);
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
  const electronDir=join(config.sourceRoot,'c3-ide/node_modules/electron/dist');
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
  const control=createHuntControl({installationFile:file,databasePath:config.dbPath,run:async args=>{calls.push(args);return {stdout:'LoadState=loaded\nActiveState='+ (args[1].endsWith('.timer')?'active':'inactive')+'\n'+
    `WorkingDirectory=${drift?'/wrong':ROOT}\nExecStart={ path=${process.execPath} ; argv[]=${process.execPath} ${ROOT}/scripts/run-model-hunt-provider.js ; }\nEnvironmentFiles=${config.configDirectory}/runtime.env (ignore_errors=no)\n`};}});
  const value=await control.status();
  assert.equal(value.state,'WAITING');assert.equal(value.current.status,'SCHEDULED_SKIPPED');
  assert.equal(value.queue[0].name,'fixture');assert.equal(value.queueObservedAt,'2026-09-17T00:00:00Z');
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
    C3_PORT_FILE:port,INTENTSMITH_INSTALLATION_FILE:join(home,'absent'),PATH:bin+':'+process.env.PATH},timeout:10000}),e=>e.code===17);
  assert.equal(await readFile(port,'utf8'),data);assert.doesNotThrow(()=>process.kill(process.pid,0));
});

test('Studio hunt renders queue and skip reason, and cancelled confirmation sends no control request',async()=>{
  const source=await readFile(join(ROOT,'c3-ide/extensions/c3-chat-panel/lib/browser/chat-panel-module.js'),'utf8');
  const start=source.indexOf('var _huntData='),end=source.indexOf('\n}',source.indexOf('function _renderHuntTab()'))+2;
  let fetches=0;
  const context=vm.createContext({setInterval(){},confirm:()=>false,fetch:()=>{fetches++;},
    _backendBase:'http://fixture',_centerState:{view:'upgrades'},_upgradeTab:'hunt',renderCenter(){},
    _fs:n=>n,C:{tx3:'#888',border:'#333'},h:(tag,props,...children)=>({tag,props,children})});
  vm.runInContext(source.slice(start,end),context);
  vm.runInContext("_huntData={state:'WAITING',timer:{ActiveState:'active'},installation:{revision:'abcdef123456'},current:{status:'SCHEDULED_SKIPPED',reasons:['GPU_BUSY']},queue:[{name:'candidate',roles:['CODE'],state:'PENDING'}]};_controlHunt('start');",context);
  assert.equal(fetches,0);
  const rendered=JSON.stringify(vm.runInContext('_renderHuntTab()',context));
  assert.match(rendered,/GPU_BUSY/);assert.match(rendered,/candidate/);assert.match(rendered,/Přeskočeno/);
});
