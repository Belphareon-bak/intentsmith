import path from 'node:path';
import fs from 'node:fs/promises';
import { isLocalOperatorTransportSubject } from '../security/global-auth-policy.js';
import { createIdeStore, ideError, record, textField, identifier } from '../db/ide-store.js';
import { storageInventory, validatePaths } from '../system/ide-storage.js';
import { validateAccount, accountView, deliverAccount, registerAccountChannels } from '../system/ide-accounts.js';
import { currentRoleArtifact, validateRoleSettings, IDE_MODEL_ROLES } from '../llm/role-runtime-settings.js';
import { getModelRuntimeProfile, getCodeRuntimeProfile } from '../llm/model-runtime-profile.js';
import { getNumCtx } from '../llm/model-ctx.js';
import { backupManagement } from '../system/ide-backups.js';
import { notificationAccountFetch } from '../network/outbound-policy.js';
import { git, projectRoot, remoteHost } from '../scm/git-runner.js';
import { validateHuntProfile, IDE_HUNT_TERMINAL_STATES } from '../system/ide-hunt-scheduler.js';
import { validateExternalSignal } from '../system/ide-external-signals.js';

export function createIdeManagementRoutes({db,config,parseBody,sendJSON,notificationRouter,
  accountFetch=notificationAccountFetch,environment=process.env,projectRoot:sourceRoot=process.cwd(),huntScheduler=null}) {
  const raw=db.db||db,store=createIdeStore(raw),dataDir=path.dirname(path.resolve(config.db.path));
  const backups=backupManagement({db:raw,dataDir,projectRoot:sourceRoot,dbPath:config.db.path,store});
  registerAccountChannels(notificationRouter,store,accountFetch,environment);
  const query=req=>new URL(req.url,'http://localhost').searchParams;
  const actor=req=>req.authenticatedSubject.actorId;
  const local=action=>async(req,res,params={})=>{
    if(!isLocalOperatorTransportSubject(req.authenticatedSubject))return sendJSON(res,403,{code:'IDE_LOCAL_OPERATOR_REQUIRED'});
    try{return sendJSON(res,200,await action(req,params));}
    catch(error){return sendJSON(res,error.httpStatus||400,{code:error.code||'IDE_OPERATION_FAILED',
      error:error.code||'Operace se nezdařila.'});}
  };
  function roleView(role) {
    let artifact;
    try {artifact=currentRoleArtifact(raw,config,role);}catch {return {role,status:'BINDING_UNAVAILABLE',revision:0};}
    const saved=store.get('role',role),profile=getModelRuntimeProfile(artifact.model)||getCodeRuntimeProfile(artifact.model,artifact.digestSha256);
    const current=saved?.digestSha256===artifact.digestSha256&&saved.model===artifact.model;
    return {role,...artifact,revision:saved?.revision??0,status:current?'CONFIGURED':saved?'STALE':'DEFAULT',
      settings:current?{contextWindowTokens:saved.contextWindowTokens,maxOutputTokens:saved.maxOutputTokens}:
        {contextWindowTokens:getNumCtx(artifact.model,4096),maxOutputTokens:null},
      outputAuthority:'CALL_SITE_AND_AUTH_TOKEN_CEILING',
      verifiedHardwareMaximum:null,approvedRuntimeProfile:profile||null};
  }
  async function repositories() {
    const rows=raw.prepare("SELECT id,name,path FROM projects WHERE status='active' ORDER BY name").all();
    const result=[];
    for(const item of rows) {
      try {const root=await projectRoot(raw,item.id),names=(await git(root,['remote'],{allowFailure:true})||'').trim().split('\n').filter(Boolean);
        const remotes=[];
        for(const name of names) {
          const url=(await git(root,['config','--local','--get',`remote.${name}.url`],{allowFailure:true})||'').trim();
          try {remotes.push({name,url,host:remoteHost(url)});}catch {remotes.push({name,url:null,status:'REMOTE_DENIED'});}
        }
        const policy=raw.prepare('SELECT * FROM scm_project_policy WHERE project_id=?').get(item.id)||null;
        result.push({...item,remotes,permissions:policy,profile:store.get('repository',String(item.id)),status:'OBSERVED'});
      }catch {result.push({...item,remotes:[],status:'UNAVAILABLE'});}
    }
    return {repositories:result,defaultProjectsPath:store.get('paths','default')?.projects||path.resolve(config.projects.defaultDir)};
  }
  async function validateSsh(input) {
    record(input,['revision','name','host','user','port','identityFile','knownHostsFile']);
    const host=textField(input.host,253),user=textField(input.user,64);
    if(!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host)||!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(user)
      ||!Number.isSafeInteger(input.port)||input.port<1||input.port>65535)throw ideError('IDE_SSH_PROFILE_INVALID');
    for(const key of ['identityFile','knownHostsFile']) {
      const filename=textField(input[key],4096);
      if(!path.isAbsolute(filename)||!/^\/[a-zA-Z0-9_./-]+$/.test(filename))throw ideError('IDE_SSH_PATH_INVALID');
      const stat=await fs.lstat(filename);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.uid!==process.getuid()
        ||stat.mode&(key==='identityFile'?0o077:0o022)||await fs.realpath(filename)!==filename)
        throw ideError('IDE_SSH_FILE_UNSAFE');
    }
    return {name:textField(input.name),host:host.toLowerCase(),user,port:input.port,
      identityFile:input.identityFile,knownHostsFile:input.knownHostsFile};
  }
  function telemetry(req) {
    const q=query(req),days=q.has('days')?Number(q.get('days')):7,digest=q.get('digestSha256');
    if(!Number.isSafeInteger(days)||days<1||days>90||digest&&!/^[a-f0-9]{64}$/.test(digest))throw ideError('IDE_TELEMETRY_FILTER_INVALID');
    const rows=raw.prepare(`SELECT * FROM model_runtime_telemetry WHERE occurred_at>=? ${digest?'AND digest_sha256=?':''}
      ORDER BY occurred_at DESC,id DESC LIMIT 5001`).all(...[Date.now()-days*86400000,...(digest?[digest]:[])]);
    const truncated=rows.length>5000;rows.length=Math.min(rows.length,5000);
    const groups=new Map();
    for(const row of rows) {const key=JSON.stringify([row.model,row.digest_sha256,row.role]);
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
    const percentile=(sorted,p)=>sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)];
    return {days,generatedAt:new Date().toISOString(),sampleLimit:5000,truncated,accuracy:null,
      accuracySource:'ROLE_EVALUATION_HISTORY_ONLY',models:[...groups.values()].map(items=>{
        const durations=items.map(r=>r.duration_ms).sort((a,b)=>a-b),timed=items.filter(r=>r.output_tokens!==null&&r.generation_ns>0);
        const tokens=timed.reduce((n,r)=>n+r.output_tokens,0),ns=timed.reduce((n,r)=>n+r.generation_ns,0);
        return {model:items[0].model,digestSha256:items[0].digest_sha256,role:items[0].role,requests:items.length,
          firstAt:items.at(-1).occurred_at,lastAt:items[0].occurred_at,totalDurationMs:durations.reduce((a,b)=>a+b,0),
          latencyP50Ms:percentile(durations,.5),latencyP95Ms:percentile(durations,.95),tokensPerSecond:ns?tokens/(ns/1e9):null,
          tokensPerSecondSamples:timed.length,averageOutputCharacters:items.reduce((n,r)=>n+r.output_characters,0)/items.length,
          observations:items.map(r=>({at:r.occurred_at,durationMs:r.duration_ms,outputTokens:r.output_tokens,
            tokensPerSecond:r.generation_ns>0&&r.output_tokens!==null?r.output_tokens/(r.generation_ns/1e9):null}))};})};
  }
  return {
    'GET /api/system/storage/inventory':local(()=>storageInventory(raw,config,store)),
    'GET /api/system/storage/paths':local(()=>({id:'default',revision:0,projects:path.resolve(config.projects.defaultDir),...store.get('paths','default')})),
    'PUT /api/system/storage/paths':local(async req=>{const body=await parseBody(req),values=validatePaths(body);
      const root=await fs.realpath(values.projects);if(!(await fs.stat(root)).isDirectory())throw ideError('IDE_PATH_INVALID');
      return store.put('paths','default',body.revision,{projects:root},actor(req));}),
    'GET /api/system/models/role-settings':local(()=>({roles:IDE_MODEL_ROLES.map(roleView)})),
    'PUT /api/system/models/role-settings/:role':local(async(req,p)=>{const body=await parseBody(req);
      store.put('role',p.role,body.revision,validateRoleSettings(raw,config,p.role,body),actor(req));return roleView(p.role);}),
    'GET /api/system/models/telemetry':local(telemetry),
    'GET /api/system/models/external-signals':local(()=>({signals:store.list('external-signal'),
      use:'DOWNLOAD_AND_TEST_PRIORITY_ONLY',localQualityAuthority:false})),
    'PUT /api/system/models/external-signals/:id':local(async(req,p)=>{const body=await parseBody(req);
      return store.put('external-signal',identifier(p.id),body.revision,validateExternalSignal(body),actor(req));}),
    'DELETE /api/system/models/external-signals/:id':local(async(req,p)=>{const body=record(await parseBody(req),['revision']);
      return store.remove('external-signal',identifier(p.id),body.revision,actor(req));}),
    'GET /api/accounts':local(()=>({accounts:store.list('account').map(a=>accountView(a,environment)),supportedEvents:['worker','lifecycle']})),
    'PUT /api/accounts/:id':local(async(req,p)=>{const body=await parseBody(req);
      const account=store.put('account',identifier(p.id),body.revision,validateAccount(body),actor(req));
      registerAccountChannels(notificationRouter,store,accountFetch,environment);return accountView(account,environment);}),
    'DELETE /api/accounts/:id':local(async(req,p)=>{const body=record(await parseBody(req),['revision']);
      const result=store.remove('account',identifier(p.id),body.revision,actor(req));
      registerAccountChannels(notificationRouter,store,accountFetch,environment);return result;}),
    'POST /api/accounts/:id/test':local(async(req,p)=>{const body=record(await parseBody(req),['revision','confirm']);
      const account=store.get('account',identifier(p.id));if(!account)throw ideError('IDE_DOCUMENT_NOT_FOUND',404);
      if(body.confirm!==true||body.revision!==account.revision)throw ideError('IDE_CONFIRMATION_REQUIRED',409);
      const result=await deliverAccount(account,{title:'IntentSmith',body:'Test připojení oznámení.'},{fetch:accountFetch,environment});
      store.event('account',p.id,actor(req),'test_delivered');return result;}),
    'GET /api/system/backups':local(()=>({backups:backups.list()})),
    'POST /api/system/backup':local(async req=>backups.create(await parseBody(req),actor(req))),
    'GET /api/system/backups/:name':local((_req,p)=>backups.find(p.name)),
    'PUT /api/system/backups/:name':local(async(req,p)=>backups.put(p.name,await parseBody(req),actor(req))),
    'DELETE /api/system/backups/:name':local(async(req,p)=>backups.remove(p.name,await parseBody(req),actor(req))),
    'GET /api/scm/repositories':local(repositories),
    'GET /api/scm/profiles':local(()=>({profiles:store.list('ssh-profile')})),
    'PUT /api/scm/profiles/:id':local(async(req,p)=>{const body=await parseBody(req);
      return store.put('ssh-profile',identifier(p.id),body.revision,await validateSsh(body),actor(req));}),
    'DELETE /api/scm/profiles/:id':local(async(req,p)=>{if(store.list('repository').some(r=>r.sshProfileId===p.id))throw ideError('IDE_PROFILE_IN_USE',409);
      const body=record(await parseBody(req),['revision']);return store.remove('ssh-profile',p.id,body.revision,actor(req));}),
    'PUT /api/scm/repositories/:projectId':local(async(req,p)=>{const body=record(await parseBody(req),['revision','sshProfileId']);
      const id=Number(p.projectId);await projectRoot(raw,id);
      if(body.sshProfileId!==null&&!store.get('ssh-profile',identifier(body.sshProfileId)))throw ideError('IDE_PROFILE_NOT_FOUND',404);
      return store.put('repository',String(id),body.revision,{sshProfileId:body.sshProfileId},actor(req));}),
    ...(huntScheduler?{
      'GET /api/system/models/hunt/profiles':local(()=>({profiles:huntScheduler.profiles(),
        capabilities:{kinds:['hunt','evaluation','challenge'],schedules:['manual','once','interval','daily','weekly'],
          limitUsage:'HUNT_DISCOVERY_ONLY',
          evaluationContextTokens:4096,activation:'SEPARATE_EXACT_ARTIFACT_ACCEPTANCE'}})),
      'PUT /api/system/models/hunt/profiles/:id':local(async(req,p)=>{const body=await parseBody(req);
        return store.put('hunt-profile',identifier(p.id),body.revision,validateHuntProfile(body),actor(req));}),
      'DELETE /api/system/models/hunt/profiles/:id':local(async(req,p)=>{
        if(huntScheduler.list().some(j=>j.profileId===p.id&&!IDE_HUNT_TERMINAL_STATES.includes(j.state)))
          throw ideError('IDE_HUNT_PROFILE_IN_USE',409);
        const body=record(await parseBody(req),['revision']);
        return raw.transaction(()=>{const removed=store.remove('hunt-profile',p.id,body.revision,actor(req));
          const cursor=store.get('hunt-cursor',p.id);if(cursor)store.remove('hunt-cursor',p.id,cursor.revision,actor(req));
          return removed;}).immediate();}),
      'GET /api/system/models/hunt/jobs':local(()=>({jobs:huntScheduler.list()})),
      'POST /api/system/models/hunt/profiles/:id/queue':local(async(req,p)=>huntScheduler.enqueue(p.id,
        record(await parseBody(req),['revision','at','confirm']),actor(req))),
      'DELETE /api/system/models/hunt/jobs/:id':local(async(req,p)=>{
        const body=record(await parseBody(req),['revision']);return huntScheduler.cancel(p.id,body.revision,actor(req));}),
    }:{}),
  };
}
