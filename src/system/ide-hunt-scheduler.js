import { randomUUID } from 'node:crypto';
import { IDE_MODEL_ROLES } from '../llm/role-runtime-settings.js';
import { ideError, record, textField, identifier } from '../db/ide-store.js';

const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
export function validateHuntProfile(input) {
  record(input,['revision','name','kind','roles','models','limit','schedule','enabled','modelsPath']);
  if(!['hunt','evaluation','challenge'].includes(input.kind)||typeof input.enabled!=='boolean'
    ||!Array.isArray(input.roles)||!input.roles.length||new Set(input.roles).size!==input.roles.length
    ||input.roles.some(role=>!IDE_MODEL_ROLES.includes(role))||!Array.isArray(input.models)||input.models.length>10
    ||input.models.some(model=>typeof model!=='string'||!model||!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model))
    ||new Set(input.models).size!==input.models.length||!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>10)
    throw ideError('IDE_HUNT_PROFILE_INVALID');
  if(input.kind==='challenge'&&input.models.length!==2||input.kind==='evaluation'&&input.models.length!==1)
    throw ideError('IDE_HUNT_MODELS_INVALID');
  const schedule=record(input.schedule,['type','at','intervalMinutes','time','timezone','weekDays']);
  if(!['manual','once','interval','daily','weekly'].includes(schedule.type))throw ideError('IDE_HUNT_SCHEDULE_INVALID');
  if(schedule.type==='manual'&&Object.keys(schedule).length!==1
    ||schedule.type==='once'&&(!iso(schedule.at)||Object.keys(schedule).sort().join(',')!=='at,type')
    ||schedule.type==='interval'&&(!iso(schedule.at)||!Number.isSafeInteger(schedule.intervalMinutes)
      ||schedule.intervalMinutes<60||schedule.intervalMinutes>10080||Object.keys(schedule).sort().join(',')!=='at,intervalMinutes,type'))
    throw ideError('IDE_HUNT_SCHEDULE_INVALID');
  if(['daily','weekly'].includes(schedule.type)) {
    const keys=Object.keys(schedule).sort().join(',');
    if(!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(schedule.time||'')
      ||keys!==(schedule.type==='daily'?'time,timezone,type':'time,timezone,type,weekDays')
      ||schedule.type==='weekly'&&(!Array.isArray(schedule.weekDays)||!schedule.weekDays.length
        ||new Set(schedule.weekDays).size!==schedule.weekDays.length||schedule.weekDays.some(day=>!Number.isSafeInteger(day)||day<0||day>6)))
      throw ideError('IDE_HUNT_SCHEDULE_INVALID');
    if(typeof schedule.timezone!=='string'||schedule.timezone.length>100)throw ideError('IDE_HUNT_TIMEZONE_INVALID');
    try {new Intl.DateTimeFormat('en',{timeZone:schedule.timezone}).format();}catch {throw ideError('IDE_HUNT_TIMEZONE_INVALID');}
  }
  const modelsPath=input.modelsPath===null?null:textField(input.modelsPath,4096);
  if(modelsPath!==null&&!/^\/[A-Za-z0-9_./-]+$/.test(modelsPath))throw ideError('IDE_PATH_INVALID');
  if(input.kind!=='hunt'&&modelsPath!==null)throw ideError('IDE_HUNT_EVALUATION_STORAGE_FIXED');
  return {name:textField(input.name),kind:input.kind,roles:input.roles,models:input.models,limit:input.limit,
    schedule,enabled:input.enabled,modelsPath,onlyWhenGpuIdle:true,numCtx:4096};
}

export function nextHuntOccurrence(schedule,from,excludedDay=null) {
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:schedule.timezone,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  for(let at=Math.ceil(from/60000)*60000;at<=from+8*86400000;at+=60000) {
    const parts=Object.fromEntries(formatter.formatToParts(at).map(part=>[part.type,part.value]));
    const day=`${parts.year}-${parts.month}-${parts.day}`;
    if(day!==excludedDay&&`${parts.hour}:${parts.minute}`===schedule.time
      &&(schedule.type==='daily'||schedule.weekDays.includes(new Date(day+'T12:00:00Z').getUTCDay())))return {at,day};
  }
  throw ideError('IDE_HUNT_SCHEDULE_UNAVAILABLE');
}

// A job is a snapshot, not a reference to a mutable profile. GPU admission,
// exact suite/digest checks and the existing automation hold stay in control.
export function createIdeHuntScheduler({store,control,evaluations,clock=Date.now,idFactory=randomUUID}) {
  let ticking=false;
  const terminal=new Set(IDE_HUNT_TERMINAL_STATES);
  async function pin(profile) {
    if(profile.kind==='hunt')return [];
    const matrix=await evaluations();
    return profile.models.map(model=>{
      let digestSha256=null;
      const roles=profile.roles.map(role=>{
        const info=matrix.roles?.[role],artifact=info?.artifacts?.find(a=>a.model===model);
        if(!artifact?.digestSha256||artifact.applicable===false||info.measurementReady===false
          ||!info.suiteContractSha256)throw ideError('IDE_HUNT_EVALUATION_UNAVAILABLE',409);
        if(digestSha256&&digestSha256!==artifact.digestSha256)throw ideError('IDE_HUNT_ARTIFACT_CHANGED',409);
        digestSha256=artifact.digestSha256;
        return {role,suiteContractSha256:info.suiteContractSha256};
      });
      return {model,digestSha256,roles};
    });
  }
  async function enqueue(profileId,{revision,at,confirm},actor) {
    if(confirm!==true||!iso(at))throw ideError('IDE_CONFIRMATION_REQUIRED',409);
    const profile=store.get('hunt-profile',identifier(profileId));
    if(!profile||profile.revision!==revision)throw ideError('IDE_REVISION_STALE',409);
    const job={profileId,profileRevision:revision,profile:structuredClone(profile),pins:await pin(profile),
      at,state:'QUEUED',actor,createdAt:clock(),step:0,startedAt:null,runId:null,result:null,results:[]};
    return store.put('hunt-job',idFactory(),0,job,actor);
  }
  async function tick() {
    if(ticking)return;ticking=true;
    try {
      for(const profile of store.list('hunt-profile')) {
        if(!profile.enabled||profile.schedule.type==='manual')continue;
        const storedCursor=store.get('hunt-cursor',profile.id),cursor=storedCursor?.profileRevision===profile.revision?storedCursor:null;
        if(['daily','weekly'].includes(profile.schedule.type)&&!cursor) {
          const next=nextHuntOccurrence(profile.schedule,clock());
          store.put('hunt-cursor',profile.id,storedCursor?.revision??0,{nextAt:next.at,day:next.day,profileRevision:profile.revision},'ide-hunt-schedule');
          continue;
        }
        const initial=Date.parse(profile.schedule.at),step=profile.schedule.intervalMinutes*60000;
        if(profile.schedule.type==='once'&&cursor)continue;
        const next=cursor?.nextAt??initial;if(next>clock())continue;
        if(store.list('hunt-job').some(j=>j.profileId===profile.id&&!terminal.has(j.state)))continue;
        await enqueue(profile.id,{revision:profile.revision,at:new Date(next).toISOString(),confirm:true},'ide-hunt-schedule');
        const occurrence=['daily','weekly'].includes(profile.schedule.type)?nextHuntOccurrence(profile.schedule,clock()+60000,cursor.day):null;
        store.put('hunt-cursor',profile.id,storedCursor?.revision??0,{profileRevision:profile.revision,
          nextAt:occurrence?.at??(profile.schedule.type==='once'?null:initial+(Math.floor((clock()-initial)/step)+1)*step),
          ...(occurrence?{day:occurrence.day}:{})},'ide-hunt-schedule');
      }
      const active=store.list('hunt-job').find(job=>['LAUNCHING','RUNNING'].includes(job.state));
      if(active) {
        if(active.state==='LAUNCHING') {
          store.put('hunt-job',active.id,active.revision,{...data(active),state:'INTERRUPTED',code:'IDE_HUNT_LAUNCH_UNCERTAIN'},active.actor);return;
        }
        const status=await control.status({jobId:active.launchToken});
        if(['RUNNING','STOPPING'].includes(status.state))return;
        // Only a matching request started after this job proves completion.
        const result=[status.jobResult,...(status.recent||[])].filter(Boolean)
          .find(r=>r.request?.jobId===active.launchToken&&Date.parse(r.startedAt)>=active.startedAt);
        if(!result) {
          if(clock()-active.startedAt>7*3600000)store.put('hunt-job',active.id,active.revision,
            {...data(active),state:'INTERRUPTED',code:'IDE_HUNT_COMPLETION_UNPROVEN'},active.actor);
          return;
        }
        const nextStep=active.step+1,complete=active.profile.kind==='hunt'||nextStep>=active.pins.length;
        const successful=['COMPLETE','AWAITING_REVIEW','NO_PENDING_CANDIDATES','RETENTION_COMPLETE'].includes(result.status);
        const results=[...(active.results||[]),{pin:active.pins[active.step]||null,result}];
        const stopped={CANCELLED:'CANCELLED',PARTIAL:'PARTIAL',BLOCKED:'BLOCKED',STORAGE_BLOCKED:'BLOCKED',SCHEDULED_SKIPPED:'SKIPPED'};
        const state=!successful?(stopped[result.status]||'FAILED'):!complete?'QUEUED':
          results.some(item=>item.result.status==='AWAITING_REVIEW')?'AWAITING_REVIEW':'COMPLETE';
        store.put('hunt-job',active.id,active.revision,{...data(active),state,
          step:nextStep,result,results,
          runId:result.runId,startedAt:null},active.actor);return;
      }
      const job=store.list('hunt-job').filter(j=>j.state==='QUEUED'&&Date.parse(j.at)<=clock())
        .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.createdAt-b.createdAt)[0];
      if(!job)return;
      const status=await control.status({freshGpu:true});
      const deferredBecause=['RUNNING','STOPPING'].includes(status.state)?'HUNT_ACTIVE':status.hold?'AUTOMATION_HOLD':
        !status.gpu.available?(status.gpu.code||'GPU_NOT_IDLE'):null;
      if(deferredBecause) {
        if(job.deferredBecause!==deferredBecause)store.put('hunt-job',job.id,job.revision,{...data(job),deferredBecause},job.actor);
        return;
      }
      const launchToken=`${job.id}-step-${job.step}`;
      const launched=store.put('hunt-job',job.id,job.revision,{...data(job),state:'LAUNCHING',deferredBecause:null,startedAt:clock(),launchToken},job.actor);
      try {
        const result=job.profile.kind==='hunt'?await control.hunt(job.profile,launchToken):
          await control.evaluate(job.pins[job.step],await evaluations(),launchToken);
        store.put('hunt-job',job.id,launched.revision,{...data(launched),state:'RUNNING',launch:result},job.actor);
      }catch(error) {
        store.put('hunt-job',job.id,launched.revision,{...data(launched),state:'INTERRUPTED',code:error.code||'IDE_HUNT_LAUNCH_FAILED'},job.actor);
      }
    } finally {ticking=false;}
  }
  function data(value){const {id,revision,updatedAt,...result}=value;return result;}
  function cancel(id,revision,actor) {
    const job=store.get('hunt-job',identifier(id));
    if(!job||job.revision!==revision)throw ideError('IDE_REVISION_STALE',409);
    if(job.state!=='QUEUED')throw ideError('IDE_HUNT_JOB_NOT_QUEUED',409);
    return store.put('hunt-job',id,revision,{...data(job),state:'CANCELLED'},actor);
  }
  return {enqueue,tick,cancel,list:()=>store.list('hunt-job'),profiles:()=>store.list('hunt-profile')};
}
export const IDE_HUNT_TERMINAL_STATES=Object.freeze(['COMPLETE','FAILED','CANCELLED','INTERRUPTED','BLOCKED','PARTIAL','SKIPPED','AWAITING_REVIEW']);
