import './helpers/isolated-test-db.js';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import Database from 'better-sqlite3';
import {up as upIde} from '../src/db/migrations/2026_10_09_123_ide_management.js';
import {up as upScm} from '../src/db/migrations/2026_09_25_120_studio_scm.js';
import {up as upOutbound} from '../src/db/migrations/2026_08_26_089_m5_outbound_audit.js';
import {createIdeManagementRoutes} from '../src/routes/ide-management.js';
import {createScmRoutes} from '../src/routes/scm.js';
import {createScmService} from '../src/scm/service.js';
import {createProjectRoutes} from '../src/routes/projects.js';
import {createGlobalAuthAuthority} from '../src/security/global-auth-policy.js';
import {createIdeStore} from '../src/db/ide-store.js';
import {createIdeHuntScheduler,validateHuntProfile,nextHuntOccurrence} from '../src/system/ide-hunt-scheduler.js';
import {createOutboundPolicy} from '../src/network/outbound-policy.js';
import {createStateBackup,pruneBackups,listBackups,validateStateBackup} from '../src/core/db-backup.js';
import {createSpecialistRoutes} from '../src/routes/specialists.js';
import {AgentRepository,initAgentTables} from '../src/agents/repository.js';
import {AgentExtensionService} from '../src/extensions/agent-extension-service.js';
import {createAgentProjectContextBridge} from '../src/extensions/agent-project-context.js';
import {resolveRepositorySsh} from '../src/scm/ssh-profile.js';
import {NotificationRouter} from '../src/notifications/service.js';
import {NotificationEmitter} from '../src/notifications/emitter.js';
import {directoryUsage} from '../src/system/ide-storage.js';
import {config as runtimeConfig} from '../src/config.js';
import {llmGateway,callWithAuth} from '../src/llm/gateway.js';
import {createAuthToken} from '../src/llm/auth-types.js';
import {externalSignalsForCandidate} from '../src/system/ide-external-signals.js';
import {pruneAllData,DEFAULT_STORAGE_CONFIG} from '../src/db/data-retention.js';
import {generateChatResponse,analyzeImages} from '../src/llm/cre-bridge.js';
import {getCompactionBudget} from '../src/chat/context-compact.js';

const root=await fs.mkdtemp(path.join(os.tmpdir(),'ide-backend-'));
const resources=[];
after(async()=>{for(const cleanup of resources.reverse())await cleanup();await fs.rm(root,{recursive:true,force:true});});
const digest='a'.repeat(64),quiet={info(){},warn(){},error(){},debug(){}};
const local=createGlobalAuthAuthority({production:false}).authorize({routeKey:'POST /api/chat',headers:{},remoteAddress:'127.0.0.1'}).subject;
const git=(dir,args)=>execFileSync('/usr/bin/git',args,{cwd:dir,encoding:'utf8',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}}).trim();
async function fixture() {
  const dir=await fs.mkdtemp(path.join(root,'fixture-')),projects=path.join(dir,'projects');await fs.mkdir(projects);
  const filename=path.join(dir,'intentsmith.db'),db=new Database(filename);db.pragma('journal_mode=WAL');
  db.exec(`CREATE TABLE projects(id INTEGER PRIMARY KEY,name TEXT,path TEXT,status TEXT);
    CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,applied_at TEXT);
    CREATE TABLE user_settings(id INTEGER PRIMARY KEY,data TEXT,updated_at TEXT);
    CREATE TABLE model_desired_bindings(role TEXT PRIMARY KEY,model_name TEXT,digest_sha256 TEXT);
    CREATE TABLE m2_execution_requests(execution_id TEXT PRIMARY KEY,project_id INTEGER);
    CREATE TABLE m2_execution_claims(execution_id TEXT,generation INTEGER,lease_until_ms INTEGER);
    CREATE TABLE m2_execution_claim_renewals(execution_id TEXT,generation INTEGER,lease_until_ms INTEGER);
    CREATE TABLE m2_execution_results(execution_id TEXT PRIMARY KEY);`);
  upOutbound(db);upIde(db);upScm(db);
  db.prepare('INSERT INTO model_desired_bindings VALUES(?,?,?)').run('CHAT','fixture-model:latest',digest);
  const config={db:{path:filename},projects:{defaultDir:projects},models:{CHAT:'fixture-model:latest'}};
  const store=createIdeStore(db),router=new NotificationRouter({db,logger:quiet}),calls=[];
  const outbound=createOutboundPolicy({database:db,logger:quiet,enabledSurfaces:{'external-notifications':true},
    transport:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(
      url.includes('telegram')?{ok:true,result:{message_id:42}}:{id:'43'}),{status:200});}});
  const environment={INTENTSMITH_TELEGRAM_FIXTURE:'123456:fixture-secret',INTENTSMITH_DISCORD_FIXTURE:'fixture.secret'};
  const deps={db,config,sendJSON:(_res,status,body)=>({status,body}),parseBody:async req=>req.body,
    notificationRouter:router,accountFetch:outbound.notificationAccountFetch,environment,projectRoot:dir};
  let routes=createIdeManagementRoutes(deps);
  const request=async(key,body,params={},subject=local,url=key.slice(key.indexOf(' ')+1))=>routes[key]({body,authenticatedSubject:subject,url},{},params);
  resources.push(()=>{if(db.open)db.close();});
  return {dir,db,filename,config,store,router,calls,environment,deps,request,setRoutes:value=>{routes=value;}};
}

test('real HTTP management requests persist paths, refuse stale revision and forged local identity',async()=>{
  const f=await fixture(),newProjects=path.join(f.dir,'new-projects');await fs.mkdir(newProjects);
  const auth=createGlobalAuthAuthority({production:false});
  const server=http.createServer(async(req,res)=>{
    const key=`${req.method} ${new URL(req.url,'http://localhost').pathname}`;
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    req.body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};
    req.authenticatedSubject=auth.authorize({routeKey:key,headers:req.headers,remoteAddress:req.socket.remoteAddress}).subject;
    const result=await f.request(key,req.body,{},req.authenticatedSubject,req.url);
    res.writeHead(result.status,{'content-type':'application/json'});res.end(JSON.stringify(result.body));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const url=`http://127.0.0.1:${server.address().port}/api/system/storage/paths`;
    const put=await fetch(url,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({revision:0,projects:newProjects})});
    assert.equal(put.status,200);assert.equal((await put.json()).revision,1);
    assert.equal((await(await fetch(url)).json()).projects,newProjects);
    assert.equal((await fetch(url,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({revision:0,projects:newProjects})})).status,409);
    assert.equal((await f.request('GET /api/system/storage/paths',{}, {},{actorId:'local-operator',actorType:'user'})).status,403);
    const reopened=new Database(f.filename);assert.equal(createIdeStore(reopened).get('paths','default').projects,newProjects);reopened.close();
    let defaults;const projectRoutes=createProjectRoutes({db:{db:f.db},config:f.config,sendJSON:(_r,status,body)=>{defaults={status,body};},safeError:e=>({error:e.message})});
    await projectRoutes['GET /api/projects/defaults']({},{});assert.equal(defaults.body.defaultDir,newProjects);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('role context and output are separate, artifact-bound and survive SQLite reopening',async()=>{
  const f=await fixture(),input={revision:0,model:'fixture-model:latest',digestSha256:digest,contextWindowTokens:8192,maxOutputTokens:512};
  assert.equal((await f.request('PUT /api/system/models/role-settings/:role',input,{role:'CHAT'})).status,200);
  const value=(await f.request('GET /api/system/models/role-settings')).body.roles.find(r=>r.role==='CHAT');
  assert.deepEqual(value.settings,{contextWindowTokens:8192,maxOutputTokens:512});assert.equal(value.verifiedHardwareMaximum,null);
  assert.equal((await f.request('PUT /api/system/models/role-settings/:role',{...input,revision:1,digestSha256:'b'.repeat(64)},{role:'CHAT'})).status,409);
  assert.equal((await f.request('PUT /api/system/models/role-settings/:role',{...input,revision:1,maxOutputTokens:8192},{role:'CHAT'})).status,400);
  const reopened=new Database(f.filename);assert.equal(createIdeStore(reopened).get('role','CHAT').maxOutputTokens,512);reopened.close();
  f.db.prepare("UPDATE model_desired_bindings SET digest_sha256=? WHERE role='CHAT'").run('b'.repeat(64));
  assert.equal((await f.request('GET /api/system/models/role-settings')).body.roles.find(r=>r.role==='CHAT').status,'STALE');
});

test('document deletion retires identity so an old confirmation cannot authorize a replacement',async()=>{
  const f=await fixture();f.store.put('account','retired',0,{name:'Old'},'operator');
  f.store.remove('account','retired',1,'operator');
  assert.throws(()=>f.store.put('account','retired',0,{name:'Replacement'},'operator'),{code:'IDE_ID_RETIRED'});
  assert.throws(()=>f.db.prepare('DELETE FROM ide_events').run(),/IDE_AUDIT_APPEND_ONLY/);
  assert.equal(f.store.get('account','retired'),null);
});

test('storage reports observed mounts, attached SQLite versions/WAL and bounded directory measurement',async()=>{
  const f=await fixture();f.db.exec("ATTACH DATABASE ':memory:' AS auxiliary");
  const result=await f.request('GET /api/system/storage/inventory');assert.equal(result.status,200);
  assert.ok(result.body.disks.length);assert.equal(result.body.databases.length,2);
  assert.match(result.body.databases[0].version,/^3\./);assert.ok(result.body.databases[0].allocatedBytes>0);
  assert.equal(result.body.locations.find(l=>l.kind==='projects').path,f.config.projects.defaultDir);
  await fs.writeFile(path.join(f.config.projects.defaultDir,'one'),'abc');
  assert.equal((await directoryUsage(f.config.projects.defaultDir,{maximumEntries:1})).status,'PARTIAL');
});

test('Discord and Telegram accounts use only credential references, exact confirmation and audited fixed origins',async()=>{
  const f=await fixture();
  for(const provider of ['telegram','discord']) {
    const input={revision:0,name:provider,provider,credentialEnv:`INTENTSMITH_${provider.toUpperCase()}_FIXTURE`,
      recipient:'123456789',enabled:true,events:['worker']};
    const result=await f.request('PUT /api/accounts/:id',input,{id:provider});assert.equal(result.status,200);
    assert.equal(result.body.credentialConfigured,true);assert.ok(!JSON.stringify(result).includes('fixture-secret'));
    assert.equal((await f.request('POST /api/accounts/:id/test',{revision:1,confirm:false},{id:provider})).status,409);
    assert.equal((await f.request('POST /api/accounts/:id/test',{revision:1,confirm:true},{id:provider})).status,200);
  }
  assert.equal(f.calls.length,2);assert.deepEqual(JSON.parse(f.calls[1].options.body).allowed_mentions,{parse:[]});
  const audit=f.db.prepare('SELECT * FROM m5_outbound_audit_events').all();assert.equal(audit.length,4);
  assert.ok(!JSON.stringify(audit).includes('fixture-secret'));
  assert.ok(!f.db.prepare('SELECT data_json FROM ide_documents').all().some(r=>r.data_json.includes('fixture-secret')));
  assert.equal((await f.request('PUT /api/accounts/:id',{revision:0,name:'bad',provider:'telegram',telegramToken:'secret'},{id:'bad'})).status,400);
  const disabled=createOutboundPolicy({database:f.db,logger:quiet,enabledSurfaces:{},transport:async()=>{throw Error('must not send');}});
  await assert.rejects(disabled.notificationAccountFetch('https://api.telegram.org/bot123:secret/sendMessage',
    {method:'POST',headers:{'content-type':'application/json'},body:'{}'}),{code:'OUTBOUND_SURFACE_DISABLED'});
  const enabled=createOutboundPolicy({database:f.db,logger:quiet,enabledSurfaces:{'external-notifications':true},transport:async()=>{throw Error('must not send');}});
  await assert.rejects(enabled.notificationAccountFetch('https://discord.com/api/v10/channels/123456/messages/extra',
    {method:'POST',headers:{'content-type':'application/json',authorization:'Bot fixture'},body:'{}'}),{code:'OUTBOUND_TARGET_CONTRACT_DENIED'});
});

test('worker events reach subscribed accounts through the policy pipeline without requiring email',async()=>{
  const f=await fixture();await f.request('PUT /api/accounts/:id',{revision:0,name:'TG',provider:'telegram',
    credentialEnv:'INTENTSMITH_TELEGRAM_FIXTURE',recipient:'123456789',enabled:true,events:['worker']},{id:'tg'});
  const contexts=[];const emitter=new NotificationEmitter({db:f.db,logger:quiet,pipeline:{async process(ctx){contexts.push(ctx);
    return f.router.send({channel:ctx.channel,recipient:ctx.recipient,title:ctx.title,body:ctx.body,data:ctx.data});}}});
  await emitter.emitLifecycleEvent({type:'lifecycle_complete',projectName:'private'});assert.equal(contexts.length,0);
  await emitter.emitWorkerEvent({agentId:'health',type:'complete',title:'Done'});
  assert.equal(contexts.length,1);assert.equal(f.calls.length,1);assert.equal(contexts[0].channel,'telegram.account.tg');
  await f.request('PUT /api/accounts/:id',{revision:1,name:'TG',provider:'telegram',credentialEnv:'INTENTSMITH_TELEGRAM_FIXTURE',
    recipient:'123456789',enabled:false,events:['worker']},{id:'tg'});
  await emitter.emitWorkerEvent({agentId:'health',type:'error',title:'Failed'});assert.equal(f.calls.length,1);
});

test('backup note/archive are outside immutable payload; retention protects archive and last backup; deletion confirms exact metadata',async()=>{
  const f=await fixture();await fs.writeFile(path.join(f.dir,'package.json'),'{"version":"1.0.0"}');
  await fs.mkdir(path.join(f.dir,'skills'));await fs.writeFile(path.join(f.dir,'skills','fixture.json'),'{}');
  const first=createStateBackup(f.db,f.dir,{projectRoot:f.dir,dbPath:f.filename,now:new Date('2026-10-01T00:00:00.000Z'),sections:['database']});
  assert.equal(first.error,null);const snapshot=await fs.readFile(path.join(first.path,'metadata.json'),'utf8');
  assert.equal((await f.request('PUT /api/system/backups/:name',{revision:0,note:'before update',archived:true},{name:first.name})).status,200);
  const second=createStateBackup(f.db,f.dir,{projectRoot:f.dir,dbPath:f.filename,now:new Date('2026-10-02T00:00:00.000Z')});
  const third=createStateBackup(f.db,f.dir,{projectRoot:f.dir,dbPath:f.filename,now:new Date('2026-10-03T00:00:00.000Z')});
  const preview=(await f.request('POST /api/system/backups/retention-preview',{maxDaily:1,maxWeekly:1})).body;
  assert.equal(preview.deletesNothing,true);assert.deepEqual(preview.deletions.map(b=>b.name),[second.name]);
  assert.equal(listBackups(f.dir).length,3);assert(preview.protected.includes(first.name));assert(preview.protected.includes(third.name));
  assert.equal(pruneBackups(f.dir,{db:f.db,maxDaily:1,maxWeekly:0}).deleted,1);
  assert.deepEqual(new Set(listBackups(f.dir).map(b=>b.name)),new Set([first.name,third.name]));
  assert.equal(await fs.readFile(path.join(first.path,'metadata.json'),'utf8'),snapshot);
  const metadata=JSON.parse(snapshot);
  assert.equal((await f.request('DELETE /api/system/backups/:name',{revision:1,contentFingerprint:metadata.content_fingerprint,confirm:true},{name:first.name})).status,409);
  assert.equal((await f.request('DELETE /api/system/backups/:name',{revision:0,contentFingerprint:'wrong',confirm:true},{name:third.name})).status,409);
  await f.request('PUT /api/system/backups/:name',{revision:1,note:'before update',archived:false},{name:first.name});
  assert.equal((await f.request('DELETE /api/system/backups/:name',{revision:2,contentFingerprint:metadata.content_fingerprint,confirm:true},{name:first.name})).status,200);
  const last=(await f.request('GET /api/system/backups')).body.backups[0];
  assert.equal((await f.request('DELETE /api/system/backups/:name',{revision:0,contentFingerprint:last.content_fingerprint,confirm:true},{name:last.name})).status,409);
  assert.throws(()=>createStateBackup(f.db,f.dir,{sections:['skills']}),{code:'BACKUP_SCOPE_INVALID'});
  assert.equal(second.error,null);
});

test('Git comparison, commit detail, rename and local slash branches use exact refs without modifying project',async()=>{
  const f=await fixture(),repo=path.join(f.config.projects.defaultDir,'repo');await fs.mkdir(repo);
  f.db.prepare("INSERT INTO projects VALUES(1,'Repo',?,'active')").run(repo);
  git(repo,['init','--template=','-b','main']);await fs.writeFile(path.join(repo,'one.txt'),'one\n');git(repo,['add','.']);
  git(repo,['-c','user.name=Tester','-c','user.email=t@invalid','commit','-m','first']);const initial=git(repo,['rev-parse','HEAD']);
  git(repo,['switch','-c','feature/czech-name']);git(repo,['mv','one.txt','renamed.txt']);
  git(repo,['-c','user.name=Tester','-c','user.email=t@invalid','commit','-m','rename']);
  const service=createScmService({db:f.db}),scm=createScmRoutes({...f.deps,scmService:service});
  const invoke=(key,url)=>scm[key]({authenticatedSubject:local,url},{},{});
  const compare=await invoke('GET /api/scm/compare','/api/scm/compare?projectId=1&base=main&head=feature/czech-name');
  assert.equal(compare.status,200);assert.equal(compare.body.baseOid,initial);assert.equal(compare.body.files[0].oldPath,'one.txt');
  const commit=await invoke('GET /api/scm/commit','/api/scm/commit?projectId=1&ref=HEAD');
  assert.equal(commit.body.subject,'rename');assert.match(commit.body.diff,/rename/);
  assert.equal((await service.commit(1,{ref:initial})).files[0].path,'one.txt');
  assert.equal((await service.branches(1)).branches.find(b=>b.name==='feature/czech-name').remote,false);
  assert.equal((await invoke('GET /api/scm/compare','/api/scm/compare?projectId=1&base=--output=evil&head=main')).status,400);
  assert.equal(git(repo,['status','--porcelain']),'');assert.equal(f.db.prepare('SELECT count(*) AS n FROM scm_events').get().n,0);
  await fs.writeFile(path.join(repo,'large.txt'),'large line '.repeat(450000));git(repo,['add','large.txt']);
  git(repo,['-c','user.name=Tester','-c','user.email=t@invalid','commit','-m','large']);
  const bounded=await service.compare(1,{base:'main',head:'HEAD'});
  assert.equal(bounded.diffTruncated,true);assert(bounded.diff.length<=1_000_000);assert(bounded.files.some(f=>f.path==='large.txt'));
  const boundedCommit=await service.commit(1,{ref:'HEAD'});
  assert.equal(boundedCommit.diffTruncated,true);assert(boundedCommit.files.some(f=>f.path==='large.txt'));
});

test('SSH profiles are permission checked, matched to actual remote, bound into plans and key rotation invalidates them',async()=>{
  const f=await fixture(),key=path.join(f.dir,'key'),hosts=path.join(f.dir,'known_hosts');
  await fs.writeFile(key,'fixture key',{mode:0o600});await fs.writeFile(hosts,'fixture host',{mode:0o600});
  const input={revision:0,name:'Local Git',host:'example.invalid',user:'git',port:22,identityFile:key,knownHostsFile:hosts};
  assert.equal((await f.request('PUT /api/scm/profiles/:id',input,{id:'git'})).status,200);
  const repo=path.join(f.config.projects.defaultDir,'repo');await fs.mkdir(repo);f.db.prepare("INSERT INTO projects VALUES(1,'Repo',?,'active')").run(repo);
  git(repo,['init','--template=','-b','main']);await fs.writeFile(path.join(repo,'one'),'one');git(repo,['add','.']);
  git(repo,['-c','user.name=T','-c','user.email=t@invalid','commit','-m','first']);
  git(repo,['remote','add','origin','git@example.invalid:owner/repo.git']);git(repo,['config','branch.main.remote','origin']);git(repo,['config','branch.main.merge','refs/heads/main']);
  assert.equal((await f.request('PUT /api/scm/repositories/:projectId',{revision:0,sshProfileId:'git'},{projectId:'1'})).status,200);
  const service=createScmService({db:f.db});service.writePolicy({...service.policy(1),fetch:'ask',remotes:[{name:'origin',host:'example.invalid'}]},'operator');
  const plan=await service.prepare({projectId:1,op:'fetch'},'operator');assert.ok(plan.plan.ssh.fingerprint);assert.equal(plan.plan.ssh.command,undefined);
  await fs.writeFile(key,'rotated fixture key');
  await assert.rejects(service.execute({planId:plan.planId,digest:plan.digest,confirm:true},'operator'),{code:'SCM_SSH_PROFILE_CHANGED'});
  await assert.rejects(resolveRepositorySsh(f.db,1,{host:'other.invalid',url:'git@other.invalid:repo.git'}),{code:'SCM_SSH_PROFILE_HOST_MISMATCH'});
  await fs.chmod(key,0o644);assert.equal((await f.request('PUT /api/scm/profiles/:id',{...input,revision:1},{id:'git'})).status,400);
});

test('telemetry is grouped by exact artifact, generation-rate uses provider duration, unknown quality stays null',async()=>{
  const f=await fixture(),insert=f.db.prepare('INSERT INTO model_runtime_telemetry VALUES(NULL,?,?,?,?,?,?,?,?,?,?,?,?)');
  for(const [artifact,tokens,ns] of [[digest,20,1000000000],['b'.repeat(64),null,null]])
    insert.run('same-tag',artifact,'CHAT','chat',Date.now(),100,40,30,tokens,ns,4096,512);
  const result=await f.request('GET /api/system/models/telemetry');assert.equal(result.status,200);assert.equal(result.body.models.length,2);
  assert.equal(result.body.accuracy,null);assert.equal(result.body.models.find(m=>m.digestSha256===digest).tokensPerSecond,20);
  assert.equal(result.body.models.find(m=>m.digestSha256!==digest).tokensPerSecond,null);
  assert.equal((await f.request('GET /api/system/models/telemetry',null,{},local,'/api/system/models/telemetry?days=NaN')).status,400);
  insert.run('old-tag',digest,'CHAT','chat',Date.now()-40*86400000,100,40,30,20,1000000000,4096,512);
  const config=structuredClone(DEFAULT_STORAGE_CONFIG);config.retention.telemetry=30;
  pruneAllData(f.db,{config});
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM model_runtime_telemetry WHERE model='old-tag'").get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM model_runtime_telemetry').get().n,2);
});

test('Hunt queue snapshots parameters, defers busy GPU, handles challenge sequentially and never replays uncertain launch',async()=>{
  const f=await fixture();let now=Date.parse('2026-10-09T12:00:00.000Z'),counter=0,busy=true,started=[];
  let status={state:'WAITING',gpu:{available:true},recent:[]};
  const matrix={roles:{CHAT:{measurementReady:true,suiteContractSha256:'c'.repeat(64),artifacts:[
    {model:'one:latest',digestSha256:digest},{model:'two:latest',digestSha256:'b'.repeat(64)}]}}};
  const control={async status(){return busy?{state:'RUNNING',gpu:{available:false}}:status;},async evaluate(pin){started.push(pin);return {accepted:true};}};
  const scheduler=createIdeHuntScheduler({store:f.store,control,evaluations:async()=>matrix,clock:()=>now,idFactory:()=>`job-${++counter}`});
  const profile=validateHuntProfile({name:'Compare',kind:'challenge',roles:['CHAT'],models:['one:latest','two:latest'],limit:2,
    schedule:{type:'manual'},modelsPath:null,enabled:false});
  f.store.put('hunt-profile','compare',0,profile,'operator');
  const job=await scheduler.enqueue('compare',{revision:1,at:new Date(now).toISOString(),confirm:true},'operator');
  f.store.put('hunt-profile','compare',1,{...profile,name:'Edited'},'operator');assert.equal(job.profile.name,'Compare');
  await scheduler.tick();assert.equal(started.length,0);busy=false;await scheduler.tick();assert.equal(started.length,1);
  status.recent=[{startedAt:new Date(now).toISOString(),finishedAt:new Date(now+1000).toISOString(),status:'COMPLETE',runId:'run-one',request:{model:'one:latest',jobId:`${job.id}-step-0`}}];
  await scheduler.tick();await scheduler.tick();assert.equal(started.length,2);
  status.recent.unshift({startedAt:new Date(now).toISOString(),finishedAt:new Date(now+2000).toISOString(),status:'COMPLETE',runId:'run-two',request:{model:'two:latest',jobId:`${job.id}-step-1`}});
  await scheduler.tick();assert.equal(scheduler.list()[0].state,'COMPLETE');
  assert.deepEqual(scheduler.list()[0].results.map(item=>item.result.runId),['run-one','run-two']);
  assert.throws(()=>validateHuntProfile({...profile,schedule:{type:'manual',intervalMinutes:60}}));
  const {id,revision,updatedAt,...jobData}=job;
  f.store.put('hunt-job','uncertain',0,{...jobData,state:'LAUNCHING'},'operator');
  await scheduler.tick();assert.equal(f.store.get('hunt-job','uncertain').state,'INTERRUPTED');assert.equal(started.length,2);
});

test('daily Hunt uses local 24-hour time through DST and skips a repeated local date',()=>{
  const schedule={type:'daily',timezone:'Europe/Prague',time:'22:00'};
  const next=nextHuntOccurrence(schedule,Date.parse('2026-10-24T20:00:00.000Z'),'2026-10-24');
  assert.equal(new Date(next.at).toISOString(),'2026-10-25T21:00:00.000Z');
  assert.equal(next.day,'2026-10-25');
});

test('an unavailable automatic evaluation leaves other queued jobs runnable',async()=>{
  const f=await fixture(),now=Date.now();let launches=0;
  const profile={name:'Unavailable',kind:'evaluation',roles:['CHAT'],models:['missing:latest'],limit:1,
    schedule:{type:'once',at:new Date(now).toISOString()},modelsPath:null,enabled:true};
  f.store.put('hunt-profile','unavailable',0,validateHuntProfile(profile),'operator');
  f.store.put('hunt-profile','manual',0,validateHuntProfile({...profile,kind:'hunt',models:[],enabled:false,schedule:{type:'manual'}}),'operator');
  const scheduler=createIdeHuntScheduler({store:f.store,clock:()=>now,evaluations:async()=>({roles:{}}),
    control:{async status(){return {state:'WAITING',gpu:{available:true},recent:[]};},async hunt(){launches++;return {accepted:true};}}});
  await scheduler.enqueue('manual',{revision:1,at:new Date(now).toISOString(),confirm:true},'operator');
  await scheduler.tick();assert.equal(launches,1);
  assert.equal(scheduler.profiles().find(p=>p.id==='unavailable').lastScheduleError.code,'IDE_HUNT_EVALUATION_UNAVAILABLE');
});

test('queue confirmation refuses a profile changed while evaluation identity was read',async()=>{
  const f=await fixture(),now=Date.now();
  const profile=validateHuntProfile({name:'Original',kind:'evaluation',roles:['CHAT'],models:['one:latest'],limit:1,
    schedule:{type:'manual'},modelsPath:null,enabled:false});
  f.store.put('hunt-profile','race',0,profile,'operator');
  const scheduler=createIdeHuntScheduler({store:f.store,control:{},evaluations:async()=>{
    f.store.put('hunt-profile','race',1,{...profile,name:'Changed'},'operator');
    return {roles:{CHAT:{suiteContractSha256:'c'.repeat(64),artifacts:[{model:'one:latest',digestSha256:digest}]}}};
  }});
  await assert.rejects(scheduler.enqueue('race',{revision:1,at:new Date(now).toISOString(),confirm:true},'operator'),{code:'IDE_REVISION_STALE'});
  assert.equal(scheduler.list().length,0);
});

test('configured role limits reach the provider and telemetry keeps its served digest',async()=>{
  const f=await fixture(),oldFetch=globalThis.fetch,oldModels={...runtimeConfig.models},oldDb=llmGateway._usageDb;
  try {
    for(const role of Object.keys(runtimeConfig.models))runtimeConfig.models[role]='fixture-model:latest';
    llmGateway.setUsageDb(f.db);
    f.store.put('role','CHAT',0,{model:runtimeConfig.models.CHAT,digestSha256:digest,
      contextWindowTokens:8192,maxOutputTokens:128},'operator');
    let body;
    globalThis.fetch=async(_url,options)=>{body=JSON.parse(options.body);return new Response(JSON.stringify({
      model:runtimeConfig.models.CHAT,model_digest_sha256:digest,message:{content:'Controlled provider'},done_reason:'stop',
      prompt_eval_count:20,eval_count:3,eval_duration:1000000000}));};
    const token=createAuthToken({role:'CRE_DECISION',decisionId:'ide-wire-fixture',maxTokens:512,
      auditContext:{sessionId:'ide-wire-fixture'}});
    await callWithAuth(token,'Check the role settings',{model:runtimeConfig.models.CHAT,maxTokens:256,
      correlation:{modelRole:'CHAT',purpose:'answer'},retries:1});
    assert.equal(body.options.num_ctx,8192);assert.equal(body.options.num_predict,128);
    await callWithAuth(token,'Refine a user-visible answer',{model:runtimeConfig.models.CHAT,maxTokens:256,
      correlation:{modelRole:'CHAT',purpose:'refine'},retries:1});
    assert.equal(body.options.num_predict,128);
    await generateChatResponse('Check actual chat adapter','',{maxTokens:256,retries:1});
    assert.equal(body.options.num_ctx,8192);assert.equal(body.options.num_predict,128);
    assert.equal(getCompactionBudget(runtimeConfig.models.CHAT).contextWindow,8192);
    assert.equal(getCompactionBudget(runtimeConfig.models.CHAT).maxOutputTokens,1000);
    const observed=f.db.prepare('SELECT * FROM model_runtime_telemetry').get();
    assert.equal(observed.digest_sha256,digest);assert.equal(observed.output_tokens,3);assert.equal(observed.role,'CHAT');
  } finally {globalThis.fetch=oldFetch;Object.assign(runtimeConfig.models,oldModels);llmGateway.setUsageDb(oldDb);}
});

test('VISION adapter uses its own context/output pair and records provider observations',async()=>{
  const f=await fixture(),oldFetch=globalThis.fetch,oldVision=runtimeConfig.models.VISION,oldDb=llmGateway._usageDb;
  try {
    runtimeConfig.models.VISION='vision-fixture:latest';
    f.db.prepare('INSERT INTO model_desired_bindings VALUES(?,?,?)').run('VISION',runtimeConfig.models.VISION,digest);
    f.store.put('role','VISION',0,{model:runtimeConfig.models.VISION,digestSha256:digest,
      contextWindowTokens:2048,maxOutputTokens:256},'operator');llmGateway.setUsageDb(f.db);
    let body;
    globalThis.fetch=async(_url,options)=>{body=JSON.parse(options.body);return new Response(JSON.stringify({
      model:runtimeConfig.models.VISION,model_digest_sha256:digest,response:'Controlled image result',eval_count:4,eval_duration:1000000000}));};
    await analyzeImages('Describe',['fixture-base64'],'',{purpose:'answer'});
    assert.equal(body.options.num_ctx,2048);assert.equal(body.options.num_predict,256);
    assert.equal(f.db.prepare('SELECT role FROM model_runtime_telemetry').get().role,'VISION');
    f.store.put('role','VISION',1,{model:runtimeConfig.models.VISION,digestSha256:digest,contextWindowTokens:8192,maxOutputTokens:1},'operator');
    await analyzeImages('Extract image fields',['fixture-base64'],'',{format:'json'});assert.equal(body.options.num_predict,2048);
    f.store.put('role','VISION',2,{model:runtimeConfig.models.VISION,digestSha256:digest,contextWindowTokens:512,maxOutputTokens:1},'operator');
    const before=body;await assert.rejects(analyzeImages('x'.repeat(2000),['fixture-base64']),{code:'LLM_CONTEXT_WINDOW_EXCEEDED'});assert.equal(body,before);
  }finally{globalThis.fetch=oldFetch;runtimeConfig.models.VISION=oldVision;llmGateway.setUsageDb(oldDb);}
});

test('external scores retain provenance and compare only matching role, source, scale and benchmark date',async()=>{
  const f=await fixture(),base={revision:0,role:'CHAT',metric:'public-role-test',minimum:0,maximum:200,
    sourceUrl:'https://example.invalid/benchmark/v1',measuredAt:'2026-10-08T12:00:00.000Z',referenceModel:'public model'};
  assert.equal((await f.request('PUT /api/system/models/external-signals/:id',{
    ...base,model:'fixture-model:latest',score:100},{id:'baseline'})).status,200);
  assert.equal((await f.request('PUT /api/system/models/external-signals/:id',{
    ...base,model:'candidate:latest',score:140},{id:'candidate'})).status,200);
  const scored=externalSignalsForCandidate(f.store,{name:'candidate:latest'},f.config.models)[0];
  assert.equal(scored.normalizedPercent,70);assert.equal(scored.estimatedGainPoints,20);assert.equal(scored.localQuality,null);
  await f.request('PUT /api/system/models/external-signals/:id',{...base,revision:1,
    model:'fixture-model:latest',score:100,measuredAt:'2026-10-07T12:00:00.000Z'},{id:'baseline'});
  assert.equal(externalSignalsForCandidate(f.store,{name:'candidate:latest'},f.config.models)[0].estimatedGainPoints,null);
});

test('custom workers preserve M3 authority, persist templates, edit parameters and reject stale edits or external effects',async()=>{
  const f=await fixture();initAgentTables(f.db);
  const project=path.join(f.config.projects.defaultDir,'project');await fs.mkdir(project);
  f.db.prepare("INSERT INTO projects VALUES(1,'Project',?,'active')").run(project);
  const repository=new AgentRepository(f.db),bridge=createAgentProjectContextBridge({projects:{findById:f.db.prepare('SELECT * FROM projects WHERE id=?')}});
  const make=()=>new AgentExtensionService({repository,hostCapabilities:{'code-intel.project-context.v1':bridge.capability}});
  const service=make();service.discover();const manifest=JSON.parse(await fs.readFile(new URL('../agent-extensions/project-health/agent.json',import.meta.url),'utf8'));
  manifest.id='custom-health';manifest.payload.definition.id='custom-health';manifest.payload.definition.name='Custom Health';
  service.saveTemplate({manifest,revision:0},'operator');const reboot=make();reboot.discover();assert.ok(reboot.get('custom-health'));
  const installed=reboot.install('custom-health',{instanceId:'custom-one',params:{project_id:1},enabled:false});
  const before=reboot.instanceConfiguration('custom-one');
  const edited=reboot.updateInstance('custom-one',{params:{project_id:1},name:'New name',expectedDefinitionDigest:installed.definition.m3_extension.definitionDigest,expectedConfigDigest:before.configDigest});
  assert.equal(edited.name,'New name');assert.notEqual(edited.configDigest,before.configDigest);
  assert.throws(()=>reboot.updateInstance('custom-one',{params:{project_id:1},expectedDefinitionDigest:installed.definition.m3_extension.definitionDigest,expectedConfigDigest:before.configDigest}),{code:'M3_AGENT_EXTENSION_STALE'});
  assert.throws(()=>reboot.deleteTemplate('custom-health',1,'operator'),{code:'M3_AGENT_EXTENSION_CONFLICT'});
  const unsafe=structuredClone(manifest);unsafe.id='unsafe';unsafe.payload.definition.id='unsafe';unsafe.payload.definition.actions[0].config.channel='telegram';
  assert.throws(()=>reboot.saveTemplate({manifest:unsafe,revision:0},'operator'),{code:'M3_AGENT_EXTENSION_EFFECT_AUTHORITY_REQUIRED'});
});

test('Czech specialist names transliterate correctly, duplicate IDs conflict and supplied rules remain quoted data',async()=>{
  const f=await fixture(),specialists=path.join(f.dir,'specialists');await fs.mkdir(specialists);
  const created=new Set();
  const loader={baseDir:specialists,getInstalled:()=>[...created].map(id=>({id,status:'enabled'})),getManifest:id=>created.has(id)?{id}:null,discoverAll(){},installPending(){created.add(this.current);},async enableAll(){}};
  const routes=createSpecialistRoutes({specialistLoader:loader,logger:quiet,sendJSON:(_r,status,body)=>({status,body}),parseBody:async req=>req.body});
  for(const [name,id] of [['Překladač','prekladac'],['Šéf kuchyně','sef-kuchyne'],['Čí','ci'],['a'.repeat(31)+' b','a'.repeat(31)]]) {
    loader.current=id;let response;const direct=createSpecialistRoutes({specialistLoader:loader,logger:quiet,sendJSON:(_r,status,body)=>{response={status,body};},parseBody:async req=>req.body});
    await direct['POST /api/specialists']({body:{name,systemPrompt:'Translate faithfully',domainRules:['Keep names'],constraints:['No invented facts']}},{});
    assert.equal(response.status,201);assert.equal(response.body.specialist.id,id);
    const source=await fs.readFile(path.join(specialists,id,'index.js'),'utf8');assert.match(source,/domain_rules: \["Keep names"\]/);
    await direct['POST /api/specialists']({body:{name}},{});assert.equal(response.status,409);
  }
});

test('actual local Ollama service wins over backend hint; remote/missing providers remain unknown',async()=>{
  const {resolveOllamaStorage}=await import('../src/system/ollama-storage.js');
  const runCommand=async(executable,args)=>{assert.equal(executable,'/usr/bin/systemctl');assert.deepEqual(args,['show','ollama.service','--property=Environment,ActiveState,MainPID']);return {stdout:'ActiveState=active\nMainPID=42\nEnvironment=OLLAMA_MODELS=/mnt/vi7000/ollama/models OLLAMA_HOST=127.0.0.1:11434\n'};};
  const value=await resolveOllamaStorage({baseUrl:'http://127.0.0.1:11434',modelsPath:'/wrong/backend/hint'},{runCommand});
  assert.equal(value.path,'/mnt/vi7000/ollama/models');assert.equal(value.backendHintDiffers,true);
  assert.equal((await resolveOllamaStorage({baseUrl:'http://127.0.0.1:11111'},{runCommand})).path,null);
  assert.equal((await resolveOllamaStorage({baseUrl:'https://remote.invalid'},{runCommand:()=>{throw Error('Must not inspect local unit');}})).reason,'REMOTE_PROVIDER_STORAGE');
  assert.equal((await resolveOllamaStorage({},{runCommand:()=>{throw Error('Unavailable');}})).status,'UNKNOWN');
  const f=await fixture();f.db.exec('CREATE TEMP TABLE temporary_fixture(value TEXT)');
  const {storageInventory}=await import('../src/system/ide-storage.js');
  const inventory=await storageInventory(f.db,f.config,f.store,{providerProbe:{runCommand:async()=>({stdout:''})},readMountInfo:async()=>
    '1 0 8:1 / / rw - btrfs /dev/fixture rw\n2 0 8:1 /@home /home rw - btrfs /dev/fixture rw\n3 0 0:1 / /var/lib/docker/overlay rw - overlay overlay rw\n'});
  assert.equal(inventory.disks.length,1);assert.deepEqual(inventory.disks[0].mountPoints,['/','/home']);
  assert(!inventory.databases.some(x=>x.name==='temp'));assert.equal(inventory.locations.find(x=>x.kind==='models').status,'UNKNOWN');
});

test('correctable SSH/context errors are safe 422s; internal exceptions are 500 and DELETE IDs validate',async()=>{
  const f=await fixture();
  const missing=await f.request('PUT /api/scm/profiles/:id',{revision:0,name:'SSH',host:'github.com',user:'git',port:22,
    identityFile:path.join(f.dir,'missing'),knownHostsFile:path.join(f.dir,'missing-hosts')},{id:'safe'});
  assert.equal(missing.status,422);assert.equal(missing.body.code,'IDE_SSH_FILE_MISSING');assert(!JSON.stringify(missing).includes(f.dir));
  const small=await f.request('PUT /api/system/models/role-settings/:role',{revision:0,model:'fixture-model:latest',digestSha256:digest,contextWindowTokens:2048,maxOutputTokens:32},{role:'CHAT'});
  assert.equal(small.status,422);assert.equal(small.body.code,'IDE_CONTEXT_TOO_SMALL');
  f.setRoutes(createIdeManagementRoutes({...f.deps,huntScheduler:{list:()=>[]}}));
  for(const key of ['DELETE /api/scm/profiles/:id','DELETE /api/system/models/hunt/profiles/:id'])assert.equal((await f.request(key,{revision:1},{id:'../unsafe'})).status,400);
  const routes=createIdeManagementRoutes({...f.deps,parseBody:async()=>{throw Object.assign(Error('secret filesystem path'),{code:'ENOENT'});}});
  const unexpected=await routes['PUT /api/accounts/:id']({authenticatedSubject:local},{},{id:'fixture'});
  assert.equal(unexpected.status,500);assert.equal(unexpected.body.code,'IDE_OPERATION_FAILED');assert(!JSON.stringify(unexpected).includes('secret'));
});

test('shared model D2/R1/R2 calls apply distinct role contexts and persist role telemetry',async()=>{
  const {WorkflowOrchestrator}=await import('../src/planner/workflow.js');
  const f=await fixture(),oldFetch=globalThis.fetch,oldModels={...runtimeConfig.models},oldDb=llmGateway._usageDb;
  const roles=['D2','R1','R2'],observed=[];
  try {
    llmGateway.setUsageDb(f.db);
    for(const [i,role] of roles.entries()){
      runtimeConfig.models[role]='shared:latest';f.db.prepare('INSERT INTO model_desired_bindings VALUES(?,?,?)').run(role,'shared:latest',digest);
      f.store.put('role',role,0,{model:'shared:latest',digestSha256:digest,contextWindowTokens:4096*(i+1),maxOutputTokens:128+i},'operator');
    }
    globalThis.fetch=async(_url,options)=>{observed.push(JSON.parse(options.body));return new Response(JSON.stringify({model:'shared:latest',model_digest_sha256:digest,message:{content:'Controlled role response'},done_reason:'stop',eval_count:4,eval_duration:1000000000}));};
    const workflow=new WorkflowOrchestrator();for(const role of roles)await workflow._callLLM(role,'Controlled planner role','',{maxTokens:256,retries:1,correlation:{purpose:'answer'}});
    assert.deepEqual(observed.map(x=>x.options.num_ctx),[4096,8192,12288]);assert.deepEqual(observed.map(x=>x.options.num_predict),[128,129,130]);
    assert.deepEqual(f.db.prepare('SELECT role FROM model_runtime_telemetry ORDER BY id').all().map(x=>x.role),roles);
  }finally{globalThis.fetch=oldFetch;Object.assign(runtimeConfig.models,oldModels);llmGateway.setUsageDb(oldDb);}
});

test('structured role calls retain their JSON output budget and reject oversized configured inputs before inference',async()=>{
  const f=await fixture(),oldFetch=globalThis.fetch,oldModel=runtimeConfig.models.D2,oldDb=llmGateway._usageDb;
  try {
    runtimeConfig.models.D2='structured:latest';llmGateway.setUsageDb(f.db);
    f.db.prepare('INSERT INTO model_desired_bindings VALUES(?,?,?)').run('D2','structured:latest',digest);
    const settings={model:'structured:latest',digestSha256:digest,contextWindowTokens:8192,maxOutputTokens:1};
    f.store.put('role','D2',0,settings,'operator');let calls=0,body;
    globalThis.fetch=async(_url,options)=>{calls++;body=JSON.parse(options.body);return new Response(JSON.stringify({model:'structured:latest',model_digest_sha256:digest,message:{content:'{"ok":true}'},done_reason:'stop'}));};
    const token=createAuthToken({role:'CRE_DECISION',decisionId:'structured-role-fixture',maxTokens:256,auditContext:{sessionId:'structured-role-fixture'}});
    const options={model:'structured:latest',format:'json',maxTokens:256,correlation:{modelRole:'D2',purpose:'classification'},retries:1};
    await callWithAuth(token,'Classify the bounded input',options);assert.equal(body.options.num_predict,256);
    f.store.put('role','D2',1,{...settings,contextWindowTokens:512},'operator');
    await assert.rejects(callWithAuth(token,'x'.repeat(2000),options),{code:'LLM_CONTEXT_WINDOW_EXCEEDED',httpStatus:422});
    assert.equal(calls,1,'oversized role input must never reach the provider');
  } finally {globalThis.fetch=oldFetch;runtimeConfig.models.D2=oldModel;llmGateway.setUsageDb(oldDb);}
});

test('pull capacity resolves the actual target rather than the inference sidecar and unknown space has no network effect',async()=>{
  const {UpgradeManager}=await import('../src/upgrade/upgrade-manager.js');
  const old=runtimeConfig.ollama.baseUrl,seen=[],released=[];
  const manager=new UpgradeManager({resolvePullStorage:async options=>{seen.push(options.baseUrl);return {path:null,status:'UNKNOWN'};},
    modelUseAuthority:{acquireExclusive:()=>({release:()=>released.push(true)})}});
  try {
    runtimeConfig.ollama.baseUrl='http://127.0.0.1:11435';
    await assert.rejects(manager.pullModel('pull-fixture:latest',null,{baseUrl:'http://127.0.0.1:11434'}),{code:'MODEL_PULL_STORAGE_UNKNOWN'});
    assert.deepEqual(seen,['http://127.0.0.1:11434']);assert.equal(released.length,1);
  }finally{runtimeConfig.ollama.baseUrl=old;}
});

test('missing Hunt installation is a durable queue reason and known SCM/backup validation remains a client error',async()=>{
  const f=await fixture(),now=Date.now();
  f.store.put('hunt-profile','missing-install',0,validateHuntProfile({name:'Missing installation',kind:'hunt',roles:['CHAT'],models:[],limit:1,schedule:{type:'manual'},modelsPath:null,enabled:false}),'operator');
  const scheduler=createIdeHuntScheduler({store:f.store,clock:()=>now,evaluations:async()=>({roles:{}}),control:{async status(){throw Object.assign(Error('missing'),{code:'DESKTOP_NOT_INSTALLED'});}}});
  await scheduler.enqueue('missing-install',{revision:1,at:new Date(now).toISOString(),confirm:true},'operator');
  await scheduler.tick();assert.equal(scheduler.list()[0].deferredBecause,'DESKTOP_NOT_INSTALLED');assert.equal(scheduler.list()[0].state,'QUEUED');
  const missing=await f.request('PUT /api/scm/repositories/:projectId',{revision:0,sshProfileId:null},{projectId:'999'});
  assert.equal(missing.status,404);assert.equal(missing.body.code,'SCM_PROJECT_NOT_FOUND');
  const invalid=await f.request('POST /api/system/backup',{sections:['skills']});
  assert.equal(invalid.status,422);assert.equal(invalid.body.code,'BACKUP_SCOPE_INVALID');
});
