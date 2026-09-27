import './helpers/isolated-test-db.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
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
