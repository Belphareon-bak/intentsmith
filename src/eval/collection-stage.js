// Bounded raw collection. No judge, production DB, role binding or retention.
// Authoritative inputs: operator stage budget and frozen public task/profile.
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { captureConversation } from './conversation-capture.js';
import { acquireGpuEvaluationLock } from '../upgrade/gpu-evaluation-lock.js';

export const stageHash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const positive = x => Number.isSafeInteger(x) && x > 0;
const fail = code => { throw Error(code); };

export function validateStagePlan(p) {
  if (p.schemaVersion !== 1 || p.decisionAuthority !== false || p.notAHoldout !== true
    || !positive(p.repeats) || !p.models?.length || !p.tasks?.length
    || !/^[a-f0-9]{64}$/.test(p.sourceContractSha256 || '')) fail('STAGE_PLAN_INVALID');
  for (const m of p.models) if (!m.name || m.artifact?.modelName !== m.name
    || !/^[a-f0-9]{64}$/.test(m.artifact.digestSha256 || '') || !m.artifact.providerVersion) fail('STAGE_IDENTITY_REQUIRED');
  if (new Set(p.models.map(m=>m.name)).size !== p.models.length
    || new Set(p.models.map(m=>m.artifact.digestSha256)).size !== p.models.length) fail('STAGE_DUPLICATE_MODEL');
  if (new Set(p.tasks.map(t=>t.name)).size !== p.tasks.length) fail('STAGE_DUPLICATE_TASK');
  for (const t of p.tasks) {
    if (!t.name || !t.independenceGroup || !t.role || !t.turns?.length || t.turns.length > 4
      || t.turns.some(x=>x.role!=='user' || typeof x.content!=='string' || !x.content.trim()
        || Object.keys(x).some(k=>!['role','content'].includes(k)))
      || !positive(t.options?.num_predict) || !positive(t.options?.num_ctx)
      || !positive(t.options?.timeout)) fail('STAGE_TASK_INVALID');
  }
  const calls = p.tasks.reduce((n,t)=>n+t.turns.length,0)*p.models.length*p.repeats;
  const tokens = p.tasks.reduce((n,t)=>n+t.turns.length*t.options.num_predict,0)*p.models.length*p.repeats;
  if (p.budget?.calls !== calls || p.budget.outputTokens !== tokens) fail('STAGE_BUDGET_MISMATCH');
  for (const k of ['freeRamGiB','freeEvidenceGiB','freeHomeGiB','freeTmpGiB'])
    if (!(p.resourceFloors?.[k] > 0) || !Number.isFinite(p.resourceFloors[k])) fail('STAGE_RESOURCE_FLOOR_REQUIRED');
  return true;
}

export function createStage(directory, plan) {
  validateStagePlan(plan);
  mkdirSync(directory, {mode:0o700});
  const fd=openSync(join(directory,'plan.json'),'wx',0o600);
  try { writeSync(fd,JSON.stringify({plan,sha256:stageHash(plan)},null,2)+'\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
  const dir=openSync(directory,'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
}

export function readStage(directory) {
  const envelope=JSON.parse(readFileSync(join(directory,'plan.json'),'utf8'));
  const {plan,sha256}=envelope;
  validateStagePlan(plan);
  if (sha256!==stageHash(plan)) fail('STAGE_PLAN_CHANGED');
  const path=join(directory,'events.jsonl'), events=[];
  let previous=sha256;
  if (existsSync(path)) {
    const bytes=readFileSync(path,'utf8');
    // A torn write needs explicit repair from retained bytes, never truncation.
    if (bytes && !bytes.endsWith('\n')) fail('STAGE_JOURNAL_TORN');
    for (const line of bytes.trim().split('\n').filter(Boolean)) {
      const {hash,...entry}=JSON.parse(line);
      if (entry.sequence!==events.length+1 || entry.previous!==previous || stageHash(entry)!==hash) fail('STAGE_JOURNAL_CHANGED');
      events.push({...entry,hash}); previous=hash;
    }
  }
  return {plan,sha256,events};
}

export function stageSummary(stage, asOfMs=Date.now()) {
  const {plan,events}=stage;
  const starts=events.filter(e=>e.type==='CALL_RESERVED');
  const results=new Map(events.filter(e=>e.type==='CALL_OBSERVED').map(e=>[e.callId,e]));
  const finished=events.filter(e=>e.type==='ATTEMPT_FINISHED');
  let observedOutputTokens=0,chargedOutputTokens=0,unknownTokenCalls=0;
  for (const start of starts) {
    const r=results.get(start.callId)?.result;
    const known=r && !r.error && Number.isSafeInteger(r.evalCount) && r.evalCount>=0;
    if (known) observedOutputTokens+=r.evalCount; else unknownTokenCalls++;
    chargedOutputTokens+=known?r.evalCount:start.reservedOutputTokens;
  }
  const planned=plan.models.length*plan.repeats*plan.tasks.length;
  const windows=events.filter(e=>e.type==='WINDOW_OPENED').map(e=>({
    ...e, close:events.find(c=>c.type==='WINDOW_CLOSED'&&c.windowId===e.windowId) || null }));
  const captured=finished.filter(e=>e.answer.captureStatus==='CAPTURED').length;
  return {planSha256:stage.sha256,gradingStatus:'NOT_GRADED',score:null,decisionAuthority:false,
    status:!windows.length?'PREPARED':finished.length===planned?(captured===planned?'CAPTURED':'CAPTURE_COMPLETE_WITH_EXCEPTIONS'):'PARTIAL',
    plannedConversations:planned,finishedConversations:finished.length,capturedConversations:captured,
    calls:starts.length,observedOutputTokens,chargedOutputTokens,unknownTokenCalls,
    unattemptedConversations:planned-new Set(starts.map(e=>e.attemptId)).size,
    remainingCalls:Math.max(0,plan.budget.calls-starts.length),
    remainingOutputTokens:Math.max(0,plan.budget.outputTokens-chargedOutputTokens),
    // An open window is elapsed wall time, not its entire reserved ceiling.
    activeDurationMs:windows.reduce((n,w)=>n+(w.close?.elapsedMs ?? Math.max(0,asOfMs-Date.parse(w.at))),0),
    reservedOpenWindowMs:windows.filter(w=>!w.close).reduce((n,w)=>n+w.budget.wallMs,0),
    conservativeCrashDurationMs:windows.filter(w=>w.close?.conservativeTimeCharge).reduce((n,w)=>n+w.close.elapsedMs,0),
    windows,stopReason:windows.at(-1)?.close?.reason || null};
}

export function stageAttempts(stage) {
  const result=[];
  for (const [mi,model] of stage.plan.models.entries()) for(let repeat=1;repeat<=stage.plan.repeats;repeat++)
    for(const task of stage.plan.tasks) result.push({id:`m${mi+1}-r${repeat}-${task.name}`,model,repeat,task});
  return result;
}

// Includes paused dialogs in review exports. A pending next turn is not a
// fictional failed call and must not be added to the provider denominator.
export function recordedStageAnswer(stage, attemptId) {
  const finished=stage.events.find(e=>e.type==='ATTEMPT_FINISHED'&&e.attemptId===attemptId);
  if(finished)return finished.answer;
  const attempt=stageAttempts(stage).find(a=>a.id===attemptId);
  const starts=stage.events.filter(e=>e.type==='CALL_RESERVED'&&e.attemptId===attemptId);
  if(!attempt || !starts.length)return null;
  const transcript=[],receipts=[];
  for(const start of starts) {
    const r=stage.events.find(e=>e.type==='CALL_OBSERVED'&&e.callId===start.callId)?.result;
    const response=r?.content || '',error=r?.error || (!r?'INTERRUPTED_RESPONSE_UNKNOWN':null);
    transcript.push(attempt.task.turns[start.turn-1],{role:'assistant',content:response});
    receipts.push({turn:start.turn,inputSha256:start.inputSha256,responseSha256:stageHash(response),
      captureStatus:error?'TRANSPORT_ERROR':r.doneReason==='length'?'OUTPUT_BUDGET_EXHAUSTED':'CAPTURED',error,
      artifact:{digestSha256:r?.digestSha256 || null,providerVersion:r?.providerVersion || null},
      evalTokens:r?.evalCount ?? null,promptEvalTokens:r?.promptEvalCount ?? null});
  }
  return {response:transcript.at(-1).content,captureStatus:'PARTIAL',error:'CONVERSATION_INCOMPLETE',score:null,
    conversation:{plannedTurns:attempt.task.turns.length,completedTurns:receipts.filter(r=>r.captureStatus==='CAPTURED').length,
      status:'PARTIAL',transcript,receipts,transcriptSha256:stageHash(transcript)}};
}

export async function runStageWindow({directory, windowId, budget, call, guard, signal,
  sourceContractSha256, now=Date.now, onProgress=()=>{}, monitorMs=2000}) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(windowId || '') || !positive(budget?.calls)
    || !positive(budget.outputTokens) || !positive(budget.wallMs)) fail('STAGE_WINDOW_INVALID');
  if (typeof call!=='function' || typeof guard!=='function') fail('STAGE_ADAPTER_REQUIRED');
  const lease=acquireGpuEvaluationLock({lockPath:join(directory,'.writer-lock'),command:'collection stage '+windowId});
  let stage, fd;
  try {
    stage=readStage(directory);
    if (sourceContractSha256!==stage.plan.sourceContractSha256) fail('STAGE_SOURCE_CHANGED');
    if (stage.events.some(e=>e.type==='WINDOW_OPENED'&&e.windowId===windowId)) fail('STAGE_WINDOW_ALREADY_USED');
    fd=openSync(join(directory,'events.jsonl'),'a',0o600);
    const dir=openSync(directory,'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
    const append=(type,data)=>{
      const entry={sequence:stage.events.length+1,previous:stage.events.at(-1)?.hash || stage.sha256,
        at:new Date(now()).toISOString(),type,...data};
      const row={...entry,hash:stageHash(entry)};
      writeSync(fd,JSON.stringify(row)+'\n'); fsyncSync(fd); stage.events.push(row);
    };
    // A request without a durable response is an unknown-cost interrupted
    // attempt. Charge its entire reservation; never reissue it automatically.
    for (const start of stage.events.filter(e=>e.type==='CALL_RESERVED')) {
      if (!stage.events.some(e=>e.type==='CALL_OBSERVED'&&e.callId===start.callId)) {
        append('CALL_OBSERVED',{callId:start.callId,result:{content:'',error:'INTERRUPTED_RESPONSE_UNKNOWN'}});
      }
    }
    for (const w of stage.events.filter(e=>e.type==='WINDOW_OPENED')) {
      if (!stage.events.some(e=>e.type==='WINDOW_CLOSED'&&e.windowId===w.windowId))
        append('WINDOW_CLOSED',{windowId:w.windowId,reason:'INTERRUPTED_WINDOW',elapsedMs:w.budget.wallMs,conservativeTimeCharge:true});
    }
    const baseline=stageSummary(stage,now());
    if (budget.calls>baseline.remainingCalls || budget.outputTokens>baseline.remainingOutputTokens) fail('STAGE_WINDOW_EXCEEDS_REMAINDER');
    const started=now(), deadline=started+budget.wallMs;
    append('WINDOW_OPENED',{windowId,budget});
    let stopReason=null;
    const paused=reason=>{stopReason=reason;throw Error(reason);};
    const abortReason=()=>signal?.aborted?'CANCELLED':now()>=deadline?'WALL_CLOCK_LIMIT':null;
    try {
      for (const attempt of stageAttempts(stage)) {
        if (stage.events.some(e=>e.type==='ATTEMPT_FINISHED'&&e.attemptId===attempt.id)) continue;
        const {model,task}=attempt;
        const answer=await captureConversation({turns:task.turns,model:model.name,artifact:model.artifact,options:task.options,
          call:async(name,messages,options,artifact)=>{
            const turn=(messages.length+1)/2, callId=`${attempt.id}-t${turn}`;
            const old=stage.events.find(e=>e.type==='CALL_RESERVED'&&e.callId===callId);
            if (old) {
              if (old.inputSha256!==stageHash(messages)) fail('STAGE_TRANSCRIPT_CHANGED');
              return structuredClone(stage.events.find(e=>e.type==='CALL_OBSERVED'&&e.callId===callId).result);
            }
            if (abortReason()) paused(abortReason());
            const used=stageSummary(stage,now());
            if (used.calls-baseline.calls>=budget.calls) paused('CALL_LIMIT');
            if (used.chargedOutputTokens-baseline.chargedOutputTokens+options.num_predict>budget.outputTokens) paused('OUTPUT_TOKEN_LIMIT');
            // Do not alter the model's locked per-call timeout to fit a window.
            if (now()+options.timeout>deadline) paused('WALL_CLOCK_LIMIT');
            let preflight;
            try { preflight=await guard({model,task,phase:'before'}); } catch(e) { paused(e.code || e.message); }
            if (abortReason()) paused(abortReason());
            if (now()+options.timeout>deadline) paused('WALL_CLOCK_LIMIT');
            append('CALL_RESERVED',{windowId,attemptId:attempt.id,callId,model:name,task:task.name,repeat:attempt.repeat,
              turn,messages,inputSha256:stageHash(messages),reservedOutputTokens:options.num_predict,preflight:preflight || null});
            const controller=new AbortController();
            const abort=()=>controller.abort(Error('CANCELLED'));
            signal?.addEventListener('abort',abort,{once:true});
            let monitoring=null, monitorFailure=null;
            const timer=setInterval(()=>{
              if(monitoring)return;
              monitoring=(async()=>{
                try { if(abortReason()) throw Error(abortReason()); await guard({model,task,phase:'during'}); }
                catch(e) { monitorFailure=e.code || e.message;controller.abort(e); }
              })().finally(()=>{monitoring=null;});
            },monitorMs);
            const start=now(); let result;
            try { result=await call(name,messages,{...options,signal:controller.signal},artifact); }
            catch(e) { result={content:'',error:e.code || e.message,detail:e.detail || null}; }
            finally { clearInterval(timer); await monitoring; signal?.removeEventListener('abort',abort); }
            if (monitorFailure || abortReason()) result={...result,error:monitorFailure || abortReason()};
            if (!result.error && (!Number.isSafeInteger(result.evalCount) || result.evalCount<0 || result.evalCount>options.num_predict))
              result={...result,error:'PROVIDER_TOKEN_ACCOUNTING_INVALID'};
            let postflight;
            try { postflight=await guard({model,task,phase:'after'}); } catch(e) { result={...result,error:result.error || e.code || e.message}; }
            append('CALL_OBSERVED',{callId,result,durationMs:now()-start,postflight:postflight || null});
            onProgress({...stageSummary(stage,now()),model:name,task:task.name,turn,totalTurns:task.turns.length,
              elapsedWindowMs:now()-started,remainingWindowMs:Math.max(0,deadline-now()),etaMs:null});
            return result;
          }});
        if (stopReason) break; // Before-dispatch limit: keep the dialog resumable.
        append('ATTEMPT_FINISHED',{attemptId:attempt.id,answer});
        if (!['CAPTURED','OUTPUT_BUDGET_EXHAUSTED'].includes(answer.captureStatus)) {
          stopReason=answer.error || answer.captureStatus;break;
        }
      }
    } catch(e) { stopReason=e.code || e.message; }
    append('WINDOW_CLOSED',{windowId,reason:stopReason || 'PLANNED_ATTEMPTS_FINISHED',elapsedMs:now()-started});
    return {stage,summary:stageSummary(stage,now())};
  } finally { if(fd!==undefined)closeSync(fd);lease.release(); }
}
