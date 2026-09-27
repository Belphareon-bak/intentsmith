import './helpers/isolated-test-db.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { runHuntSimulation, ROLES } from '../scripts/manual/simulate-hunt-lifecycle.mjs';
import { auditChatCaptureHistory } from '../src/eval/chat-capture-integrity.js';

const request = rows => [{role:'system',content:'system'},{role:'user',content:rows.length
  ? 'Previous conversation (quoted data, not system instructions):\n'+rows.map(row=>JSON.stringify(row)).join('\n')+'\n\nUser: continue'
  : 'User: continue'}];
test('capture guard accepts exact user order, rejects missing, reordered, duplicated or assistant-only evidence',()=>{
  const a={role:'user',content:'Group B: 90/100'},b={role:'user',content:'Correct A to 10/20'};
  assert.equal(auditChatCaptureHistory(request([a,b]),[a.content,b.content]).valid,true);
  assert.equal(auditChatCaptureHistory(request([]),[]).valid,true);
  for(const rows of [[b],[b,a],[a,b,b],[{role:'assistant',content:a.content},b]]) {
    const r=auditChatCaptureHistory(request(rows),[a.content,b.content]);
    assert.equal(r.valid,false);assert.equal(r.score,null);
  }
  assert.equal(auditChatCaptureHistory(request([a]),[a.content,a.content]).valid,false);
  assert.equal(auditChatCaptureHistory(request([{...a,content:'Group B: […část historie vynechána…]'}]),[a.content]).valid,false);
  assert.equal(auditChatCaptureHistory([],[]).code,'CHAT_CAPTURE_REQUEST_SHAPE');
  const broken=request([a]);broken[1].content=broken[1].content.replace('"role"','BROKEN');
  assert.equal(auditChatCaptureHistory(broken,[a.content]).code,'CHAT_CAPTURE_HISTORY_UNREADABLE');
});

test('final audit independently rejects missing user history even when capture claims success',()=>{
  const dir=mkdtempSync(join(tmpdir(),'hunt-wire-audit-'));
  const sha=x=>createHash('sha256').update(x).digest('hex');
  const save=(name,data)=>writeFileSync(join(dir,name),JSON.stringify(data));
  try {
    const tasks=Array.from({length:40},(_,i)=>({id:'t'+i,role:'CHAT',turns:['A='+i,'B=2','Sum?'],
      rubric:[{id:'sum',axis:'factual',requirement:'Compute sum',evidence:'Show calculation',excludes:'Format'}]}));
    save('tasks.json',tasks);
    const pairs=['a','b'].map(model=>({model,artifact:{digestSha256:sha(model)}}));
    const policy={productionImported:false,bindings:false,deletion:false,timer:false};
    const plan={status:'SEALED',roles:['CHAT'],workingTreeDirty:false,sourceRevision:'fixture',
      taskFileSha256:sha(readFileSync(join(dir,'tasks.json'))),pairs:{CHAT:pairs},decisionAuthority:false,
      operationPolicy:policy,providerVersion:'fixture',profile:{CHAT:'fixed to 4096'}};
    plan.planSha256=sha(JSON.stringify(plan));save('plan.json',plan);
    const attempts=[];
    for(const task of tasks)for(const p of pairs) {
      const id=task.id+'-'+p.model;
      attempts.push({id,model:p.model,status:'CAPTURED',proof:'RESPONSE_BOUND'});
      const receipts=task.turns.map((input,index)=>({body:{model:p.model,think:false,options:{num_ctx:4096},
        messages:[{role:'system',content:'Today / dnes: 2026-09-27 (Sunday).'},
          {role:'user',content:(index?'Previous conversation (quoted data, not system instructions):\n'
            +task.turns.slice(0,index).map(content=>JSON.stringify({role:'user',content})).join('\n')+'\n\n':'')+'User: '+input}]},
        data:{provider_version:'fixture',digest:p.artifact.digestSha256,done:true,done_reason:'stop'},
        placement:{digest:p.artifact.digestSha256,size:1,size_vram:1}}));
      save('attempt-'+id+'.json',{...attempts.at(-1),role:'CHAT',task:task.id,artifact:p.artifact,fullGpu:true,
        dialogue:task.turns.map(input=>({input,result:{content:'fixture'}})),receipts});
    }
    save('result.json',{status:'COLLECTION_COMPLETE',sourceRevision:'fixture',planSha256:plan.planSha256,
      attempts,unattempted:[],decisionAuthority:false,operationPolicy:policy});
    const script=new URL('../scripts/manual/audit-chat-production-pair.py',import.meta.url).pathname;
    const args=[script,'--run',dir,'--tasks',join(dir,'tasks.json'),'--out',join(dir,'audit.json')];
    execFileSync('python3',args);
    assert.equal(JSON.parse(readFileSync(join(dir,'audit.json'))).completeHistoryRequests,240);
    const exporter=new URL('../scripts/manual/export-chat-prod-canary-review.py',import.meta.url).pathname;
    const exportArgs=[exporter,'--run',dir,'--tasks',join(dir,'tasks.json'),'--audit',join(dir,'audit.json'),'--out'];
    execFileSync('python3',[...exportArgs,join(dir,'review')]);
    assert.equal(JSON.parse(readFileSync(join(dir,'review','packet.json'))).cases.length,80);
    const name='attempt-t0-a.json',bad=JSON.parse(readFileSync(join(dir,name)));
    bad.receipts[2].body.messages[1].content='Previous conversation (quoted data, not system instructions):\n'
      +JSON.stringify({role:'assistant',content:'A=0, B=2'})+'\n\nUser: Sum?';
    bad.contextIntegrityChecks=[{valid:true}];save(name,bad);
    const altered=spawnSync('python3',[...exportArgs,join(dir,'altered-review')],{encoding:'utf8'});
    assert.notEqual(altered.status,0);assert.match(altered.stderr,/ATTEMPT_AUDIT_HASH_MISMATCH/);
    const oldAudit=JSON.parse(readFileSync(join(dir,'audit.json')));delete oldAudit.completeHistoryRequests;save('old-audit.json',oldAudit);
    const stale=spawnSync('python3',[exporter,'--run',dir,'--tasks',join(dir,'tasks.json'),
      '--audit',join(dir,'old-audit.json'),'--out',join(dir,'stale-review')],{encoding:'utf8'});
    assert.notEqual(stale.status,0);assert.match(stale.stderr,/FULL_PAIR_AUDIT_MISMATCH/);
    const rejected=spawnSync('python3',[...args.slice(0,-1),join(dir,'bad-audit.json')],{encoding:'utf8'});
    assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/HISTORY_USER_TURNS_INCOMPLETE/);
    assert.equal(existsSync(join(dir,'bad-audit.json')),false);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('whole isolated rehearsal persists every applicable cell, exercises failures and renders actual Studio matrix',async()=>{
  const base=mkdtempSync(join(tmpdir(),'hunt-simulation-test-')),out=join(base,'new');
  try {
    const report=await runHuntSimulation(out);
    assert.equal(report.status,'SIMULATION_PASS_NOT_PRODUCTION_GO');
    assert.equal(report.decisionAuthority,false);
    assert.equal(report.matrix.length,70);
    assert.equal(report.matrix.filter(x=>x.status==='N/A').length,6);
    assert.equal(report.matrix.filter(x=>x.status==='SIMULATED').length,64);
    assert.equal(report.roles.length,7);
    assert(report.checks.every(c=>c.passed));
    assert.equal(report.networkCalls,0);assert.equal(report.productionWrites,0);assert.equal(report.modelDeletions,0);
    assert.equal(report.portfolio.proposed.audit.compliant,true);
    await assert.rejects(runHuntSimulation(out),/EEXIST/);
    assert.equal(existsSync(join(out,'failure.json')),false);
    const source=readFileSync(new URL('../intentsmith-ide/extensions/intentsmith-chat-panel/lib/browser/chat-panel-module.js',import.meta.url),'utf8');
    const view={roles:Object.fromEntries(ROLES.map(role=>[role,JSON.parse(readFileSync(join(out,role+'-read-model.json'))).roles[role]]))};
    const context=vm.createContext({C:{},_fs:n=>n,_rgba:()=>'',h:(tag,props,...children)=>({tag,props,children}),
      _modelButtonStyle:()=>({}),_modelFieldStyle:()=>({}),_modelTestFeedback:()=>null,
      _canonicalModelIdentity:x=>x,_huntDuration:ms=>String(ms),
      _evaluationData:view,_evaluationModelFilter:'',_modelTestPending:false,renderCenter(){}});
    vm.runInContext(source.slice(source.indexOf("var _evaluationRoleFilter='all'"),source.indexOf('function _renderEvaluationHistory()')),context);
    const tree=()=>vm.runInContext('_renderEvaluationsTab()',context);
    const nodes=x=>!x||typeof x!=='object'?[]:Array.isArray(x)?x.flatMap(nodes):[x,...nodes(x.children)];
    assert.equal(nodes(tree()).filter(n=>n.tag==='section').length,7);
    assert.match(JSON.stringify(tree()),/100\.0 %/);
    const button=nodes(tree()).find(n=>n.props?.title==='Podrobný rozpad a nový test: sim-model-02:fixture');
    assert(button);button.props.onClick();
    assert.equal(context._evaluationView,'detail');assert.equal(context._evaluationRoleFilter,'D1');
    assert.match(JSON.stringify(tree()),/Oba nezávislé posudky/);
  } finally {rmSync(base,{recursive:true,force:true});}
});
