#!/usr/bin/env node
// Read-only view of an existing collection journal. Never starts/stops inference.
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readStage,stageSummary,stageAttempts} from '../../src/eval/collection-stage.js';

export function progressSnapshot(stage,{provider={},service={},supervisor={},titles={},now=Date.now()}={}) {
  const summary=stageSummary(stage,now),attempts=stageAttempts(stage);
  const byAttempt=new Map(attempts.map(a=>[a.id,a]));
  const calls=stage.events.filter(e=>e.type==='CALL_RESERVED');
  const byCall=new Map(calls.map(c=>[c.callId,c]));
  const replies=stage.events.filter(e=>e.type==='CALL_OBSERVED');
  const replyByCall=new Map(replies.map(e=>[e.callId,e]));
  const finished=stage.events.filter(e=>e.type==='ATTEMPT_FINISHED');
  const open=summary.windows.at(-1)&&!summary.windows.at(-1).close;
  const processAlive=service.ActiveState==='active'&&service.SubState==='running';
  const running=Boolean(open&&processAlive&&provider.status==='RUNNING');
  const waiting=Boolean(!open&&processAlive&&supervisor.planSha256===stage.sha256
    &&supervisor.status==='WAITING_GPU'&&now-Date.parse(supervisor.updatedAt)<20000);
  const supervisorStop=!open&&supervisor.planSha256===stage.sha256&&['STOPPED','CANCELLED'].includes(supervisor.status)
    &&Date.parse(supervisor.updatedAt)>=Date.parse(summary.windows.at(-1)?.close?.at)
    ?supervisor.reason:null;
  const complete=finished.length===summary.plannedConversations;
  const state=complete?(summary.capturedConversations===finished.length?'COMPLETE':'COMPLETE_WITH_EXCEPTIONS')
    :running?'RUNNING':waiting?'WAITING_GPU':!summary.windows.length?'PREPARED':open?'INTERRUPTED':'STOPPED';
  const last=calls.at(-1),attempt=byAttempt.get(last?.attemptId);
  const current=attempt?{model:attempt.model.name,modelIndex:stage.plan.models.findIndex(m=>m.name===attempt.model.name)+1,
    task:attempt.task.name,title:titles[attempt.task.name]||attempt.task.name,language:attempt.task.language,
    taskIndex:stage.plan.tasks.findIndex(t=>t.name===attempt.task.name)+1,taskCount:stage.plan.tasks.length,
    repeat:attempt.repeat,repeats:stage.plan.repeats,turn:last.turn,turns:attempt.task.turns.length,
    pending:running&&!replyByCall.has(last.callId),callElapsedMs:Math.max(0,now-Date.parse(last.at)),
    timeoutMs:attempt.task.options.timeout}:null;
  let skippedCalls=0;
  for(const end of finished){const a=byAttempt.get(end.attemptId);skippedCalls+=a.task.turns.length-calls.filter(c=>c.attemptId===a.id).length;}
  const models=stage.plan.models.map((model,index)=>{
    const ownCalls=calls.filter(c=>c.model===model.name),ownReplies=ownCalls.map(c=>replyByCall.get(c.callId)).filter(Boolean);
    const done=finished.filter(e=>byAttempt.get(e.attemptId)?.model.name===model.name);
    const skipped=done.reduce((n,e)=>n+byAttempt.get(e.attemptId).task.turns.length-ownCalls.filter(c=>c.attemptId===e.attemptId).length,0);
    const plannedCalls=stage.plan.tasks.reduce((n,t)=>n+t.turns.length,0)*stage.plan.repeats;
    const durations=ownReplies.slice(-30).map(e=>e.durationMs).filter(Number.isFinite);
    const remaining=Math.max(0,plannedCalls-ownReplies.length-skipped);
    return {name:model.name,index:index+1,finished:done.length,complete:done.filter(e=>e.answer.captureStatus==='CAPTURED').length,
      planned:stage.plan.tasks.length*stage.plan.repeats,calls:ownReplies.length,plannedCalls,skippedCalls:skipped,
      exceptions:done.filter(e=>e.answer.captureStatus!=='CAPTURED').length,
      current:running&&current?.model===model.name,
      etaMs:running&&current?.model===model.name&&durations.length>=10?remaining*durations.reduce((n,v)=>n+v,0)/durations.length:null};
  });
  const logs=[];
  for(const event of stage.events){
    const call=byCall.get(event.callId),a=byAttempt.get(event.attemptId||call?.attemptId);
    const context=a?`${a.model.name} · ${titles[a.task.name]||a.task.name} · ${a.task.language||''} · opakování ${a.repeat}/${stage.plan.repeats}`:'';
    let message,level='info';
    if(event.type==='WINDOW_OPENED')message=`Spuštěno okno ${event.windowId}; limit ${event.budget.calls} volání.`;
    if(event.type==='CALL_RESERVED')message=`${context} · tah ${event.turn}/${a.task.turns.length}: čekám na odpověď.`;
    if(event.type==='CALL_OBSERVED'){
      const issue=event.result.error||(event.result.doneReason==='length'?'OUTPUT_BUDGET_EXHAUSTED':null);
      level=issue?'warning':'info';
      message=`${context} · tah ${call?.turn}: ${issue||'odpověď uložena'} · ${((event.durationMs||0)/1000).toFixed(1)} s · ${event.result.evalCount??'?'} tokenů.`;
    }
    if(event.type==='ATTEMPT_FINISHED'){
      const ok=event.answer.captureStatus==='CAPTURED';level=ok?'success':'warning';
      message=`${context}: ${ok?'celý rozhovor uložen':'neúplný rozhovor — '+(event.answer.error||event.answer.captureStatus)}.`;
    }
    if(event.type==='WINDOW_CLOSED'){
      level=event.reason==='PLANNED_ATTEMPTS_FINISHED'?'success':'warning';
      message=`Okno ${event.windowId} ukončeno: ${event.reason}.`;
    }
    if(message)logs.push({sequence:event.sequence,at:event.at,level,message});
  }
  return {updatedAt:new Date(now).toISOString(),planSha256:stage.sha256,state,running,
    stopReason:running?null:supervisorStop||summary.stopReason,providerStatus:provider.status||null,service,
    waitingForGpu:waiting,contentionResumes:waiting?supervisor.resumes:null,
    maxContentionResumes:waiting?supervisor.maxResumes:null,
    current,modelCount:models.length,models,finishedDialogs:finished.length,completeDialogs:summary.capturedConversations,
    plannedDialogs:summary.plannedConversations,exceptions:finished.length-summary.capturedConversations,
    completedCalls:replies.length,startedCalls:calls.length,plannedCalls:stage.plan.budget.calls,skippedCalls,
    percent:100*finished.length/summary.plannedConversations,elapsedMs:summary.activeDurationMs,
    lastResponseAt:replies.at(-1)?.at||null,overallEtaMs:null,
    logs:logs.slice(-100),problems:logs.filter(e=>e.level==='warning').slice(-100),score:null,decisionAuthority:false};
}

export async function serveProgress({root,port=8765,unit}) {
  if(!isAbsolute(root)||!Number.isInteger(port)||port<1024||port>65535||!/^intentsmith-chat-panel-[a-zA-Z0-9-]+\.service$/.test(unit))throw Error('PROGRESS_ARGUMENTS_INVALID');
  const html=readFileSync(new URL('./chat-progress.html',import.meta.url));
  let cache=null,error=null,checkedAt=null;
  const titles={};
  // Titles only; authoritative tasks and all counters always come from the frozen plan.
  try{const f=JSON.parse(readFileSync(new URL('../../src/eval/fixtures/chat-conversation-draft.json',import.meta.url)));for(const s of f.scenarios)for(const lang of ['cs','en'])titles[lang+'_'+s.id]=s.title[lang];}catch{}
  function update(){
    checkedAt=new Date().toISOString();
    try{
      const stage=readStage(join(root,'capture'));
      let provider={};try{provider=JSON.parse(readFileSync(join(root,'provider-state/current.json')));}catch{}
      let supervisor={};try{supervisor=JSON.parse(readFileSync(join(root,'supervisor-state.json')));}catch{}
      const text=execFileSync('systemctl',['--user','show',unit,'-p','ActiveState','-p','SubState','-p','MainPID'],{encoding:'utf8',timeout:2000});
      const service=Object.fromEntries(text.trim().split('\n').map(s=>s.split('=')));
      cache=progressSnapshot(stage,{provider,service,supervisor,titles});error=null;
    }catch(e){error=e.code||e.message;}
  }
  update();const timer=setInterval(update,5000);
  const server=createServer((req,res)=>{
    const allowedHosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
    if(!allowedHosts.has(req.headers.host)||!['GET','HEAD'].includes(req.method)){res.writeHead(403);return res.end();}
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const path=new URL(req.url,`http://127.0.0.1:${port}`).pathname;
    if(path==='/api/status'){
      res.setHeader('Content-Type','application/json; charset=utf-8');
      return res.end(req.method==='HEAD'?'':JSON.stringify({data:cache,error,checkedAt}));
    }
    if(path==='/'||path==='/index.html'){
      res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(req.method==='HEAD'?'':html);
    }
    res.writeHead(404);res.end('Not found');
  });
  try{await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});}
  catch(e){clearInterval(timer);throw e;}
  console.log(JSON.stringify({status:'READ_ONLY_PROGRESS_LISTENING',url:`http://127.0.0.1:${port}`,unit,root}));
  const close=()=>{clearInterval(timer);server.close();};
  process.once('SIGTERM',close);process.once('SIGINT',close);
  return {server,close};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=Object.fromEntries(process.argv.slice(2).map(s=>{const m=/^--(root|port|unit)=(.+)$/.exec(s);if(!m)throw Error('PROGRESS_ARGUMENTS_INVALID');return [m[1],m[2]];}));
  await serveProgress({root:args.root,port:args.port?Number(args.port):8765,unit:args.unit});
}
