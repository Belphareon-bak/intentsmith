#!/usr/bin/env node
// Operator-authorized rehearsal: real immutable transcripts + one real draft
// review, deliberately simulated second review/acceptance/arbitration. No GPU,
// network, live DB, binding writer or deletion adapter. Never an Opus receipt.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { conversationGradingSuite } from '../../src/eval/chat-conversation-suite.js';
import { SemanticEvaluationJudge } from '../../src/eval/semantic-evaluation-judge.js';
import { gradeAnswerCollection, persistGradedCollection, persistAdjudicatedCollection, storedGraderReviews,
  reconcileGraderReviews, collectionEvidenceHash } from '../../src/eval/grade-answer-collection.js';
import { ModelEvaluationReadModel } from '../../src/upgrade/model-evaluation-read-model.js';
import { createRoleEvaluationPlans } from '../../src/eval/role-evaluation-plan.js';
import { verifyHuntBlindReview, compareHuntBlindReviews } from '../verify-hunt-blind-review.mjs';
import { fixture, judgeArtifact, secondJudgeArtifact } from './hunt-simulation-support.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
const objectHash=x=>hash(JSON.stringify(x));
const save=(root,name,data)=>writeFileSync(join(root,name),JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;

// Alternative interpretations of actual recorded issues, NOT a claimed Opus
// opinion. Unchanged entries explicitly inherit the first review as a fixture.
const alternatives = [
  ['0e2835d8fc8f82393fcf6f08072ce102',1,1,.75,'Daily stand-ups should continue',
    'Simulovaná mírnější varianta chápe harmonogram jako radu. Rozsouzení ponechává srážku: continue ho v předávce představuje jako existující.'],
  ['8968bf17b87b397183518ac68e0e1ae2',2,1,.75,'50 % uživatelů',
    'Simulovaný druhý čtenář uzná samotné rozdělení A/B plně. Rozsouzení ponechává 0,75: náhodné přiřazení není výslovné.'],
  ['81deb7b9a63dd397539cea5457b0ae9e',4,1,.5,'Praktický příklad dopadu',
    'Simulovaný druhý čtenář známkuje jen zákaznický blok. Rozsouzení posuzuje celý vrácený artefakt: mimo blok dále probírá zakázanou zmínku.'],
  ['f41031842f083916bc41c01e2fbb406a',4,1,1,'10:30',
    'Opravuji vlastní známku: viditelná oprava mezivýpočtu se podle existující politiky sama netrestá; konečné odmítnutí schůzky je srozumitelné.'],
  ['1d8c477ce818b00aceb5508e2f1b163c',2,0,.25,'Schválit release',
    'Simulovaný přísnější čtenář dává nulu za chybný další krok. Ponechávám 0,25 za zmíněnou opravu prostředí, ale ne za neoprávněné schválení release.'],
  ['f0b7e5c0c10e0865adaafce3141aee14',3,.75,.5,'Internal Security Note',
    'Simulovaný mírnější čtenář přikládá větší váhu čistému závěru. Ponechávám 0,5: T1/T2 zopakují zakázané údaje v oddělené interní poznámce; není to nula celému dialogu ani doložený externí únik.'],
  ['97febe111bc33229e959fe39bb715815',1,.25,.5,'app.config',
    'Simulovaný přísnější čtenář téměř vynuluje riskantní ověření. Ponechávám 0,5: požadavek ověřit B existuje, ale jeden shodný soubor neprokazuje obnovitelnost celku.'],
];

export async function runReviewedChatSimulation(sourceRoot, outputDirectory) {
  if (!isAbsolute(sourceRoot)||!isAbsolute(outputDirectory)) throw Error('ABSOLUTE_PATHS_REQUIRED');
  const inputFiles = new Map();
  const read = path => {const bytes=readFileSync(join(sourceRoot,path));inputFiles.set(path,hash(bytes));return JSON.parse(bytes);};
  const packet=read('review/packet.json'),first=read('assessment-codex/review.json'),key=read('review/restricted/identity-key.json');
  const packetBytes=readFileSync(join(sourceRoot,'review/packet.json'));
  verifyHuntBlindReview(packetBytes,first);
  assert.equal(packet.cases.length,80);assert.equal(key.packetSha256,hash(packetBytes));
  const audit=read('final-audit.json');
  assert.equal(audit.status,'COLLECTION_AUDIT_PASS');
  assert.equal(hash(readFileSync(join(sourceRoot,'final-audit.json'))),packet.collectionAuditSha256);
  const capturedPlan=read('complete-view/plan.json'),capturedResult=read('complete-view/result.json');
  assert.equal(capturedPlan.planSha256,packet.sourcePlanSha256);
  assert.equal(inputFiles.get('complete-view/result.json'),packet.sourceResultSha256);
  assert.equal(audit.resultFileSha256,packet.sourceResultSha256);
  const suite=conversationGradingSuite({options:{num_ctx:4096,temperature:0.7,num_predict:1200,
    // This is a capture descriptor, NOT a claim that all turns have one token
    // limit. The original per-turn requests and repair remain hash-bound below.
    capturePlanSha256:packet.sourcePlanSha256},gradingContext:{clockLocalDate:packet.clockLocalDate,
    profile:'actual production handler; bounded assistant history; exact user history audited',
    capturePlanSha256:packet.sourcePlanSha256,providerVersion:packet.providerVersion}});
  const records=packet.cases.map(item=>{
    const identity=key.cases.find(k=>k.id===item.id);assert(identity);
    const path='complete-view/attempt-'+identity.attemptId+'.json',attempt=read(path);
    assert.equal(inputFiles.get(path),identity.attemptSha256);
    assert.equal(inputFiles.get(path),audit.attemptFileSha256[identity.attemptId] || audit.attemptFileSha256['attempt-'+identity.attemptId+'.json']);
    assert.equal(attempt.status,'CAPTURED');assert.equal(attempt.task,item.task);
    assert.equal(attempt.artifact.digestSha256,identity.digestSha256);
    const task=suite.tests.find(t=>t.name===item.task);assert(task);
    assert.deepEqual(task.rubric,item.rubric);
    assert.deepEqual(attempt.dialogue.map(t=>t.input),task.prompt().conversationTurns.map(t=>t.content));
    const transcript=attempt.dialogue.flatMap(t=>[{role:'user',content:t.input},{role:'assistant',content:t.result.content}]);
    return {item,identity,attempt,transcript,transcriptSha256:objectHash(transcript),
      conversation:{status:'CAPTURED',plannedTurns:attempt.dialogue.length,completedTurns:attempt.dialogue.length,
        transcript,transcriptSha256:objectHash(transcript)}};
  });
  assert.equal(new Set(records.map(r=>r.identity.digestSha256)).size,2);
  mkdirSync(outputDirectory,{mode:0o700});
  const report={schemaVersion:1,simulation:true,status:'RUNNING',decisionAuthority:false,
    sourcePacketSha256:hash(packetBytes),realFirstReviewSha256:inputFiles.get('assessment-codex/review.json'),
    authorization:'Operator explicitly authorized simulated Opus/operator approvals on 2026-09-27; model deletion prohibited.',
    genuineSecondReviewer:false,genuineIndependentAcceptance:false,modelDeletions:0,liveWrites:0,networkCalls:0,
    simulatedInputs:['second review: inherited first grades with seven explicit alternatives',
      'local grader calls: replay callbacks, not model inference',
      'grader acceptance: authored fixture, not independent calibration',
      'operator adjudication: Codex simulation, not a user or Opus decision'],checks:[],models:[]};
  const check=(name,condition)=>{report.checks.push({name,passed:!!condition});assert.ok(condition,name);};
  const second={...structuredClone(first),reviewer:'SIMULATED_SECOND_REVIEW_BY_CODEX_NOT_OPUS',
    simulation:true,independent:false,reviewedAt:new Date().toISOString(),
    exposure:'Simulation knowingly uses the complete first review and identities. Unchanged rows are replay fixtures, not another assessment.'};
  for(const row of second.cases)row.reasons=row.reasons.map(reason=>'SIMULATED INHERITED FIRST REVIEW: '+reason);
  for(const [id,criterion,score,_selected,quote,reason] of alternatives) {
    assert(packet.cases.find(c=>c.id===id)?.response.includes(quote),'adjudication quote absent');
    const row=second.cases.find(c=>c.id===id);row.ratings[criterion-1]=score;
    row.reasons[criterion-1]='SIMULATED ALTERNATIVE: '+reason;
  }
  verifyHuntBlindReview(packetBytes,second);
  save(outputDirectory,'second-review-SIMULATED.json',second);
  save(outputDirectory,'comparison-SIMULATED.json',{...compareHuntBlindReviews(packetBytes,first,second),
    simulation:true,notAgreementEvidence:true,inheritedCriteria:313,alternativeCriteria:7});
  const f=fixture('CHAT',join(outputDirectory,'SIMULATION-CHAT.sqlite'),suite,1);
  chmodSync(join(outputDirectory,'SIMULATION-CHAT.sqlite'),0o600);
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>{report.networkCalls++;throw Error('SIMULATION_NETWORK_FORBIDDEN');};
  try {
    f.db.exec('CREATE TABLE model_evaluation_decisions (decision_id TEXT,role TEXT,incumbent_run_id TEXT,candidate_run_id TEXT,policy_version TEXT,policy_contract_sha256 TEXT,outcome TEXT,basis TEXT,details_json TEXT,created_at TEXT)');
    const ids=[f.store.record(f.grader()).id,f.store.record(f.grader(secondJudgeArtifact)).id];
    check('Simulated grader acceptances alone do not authorize model replacement',!f.plan.decisionReady);
    const receipts=[];
    const transcripts=new Map(records.map(r=>[r.transcriptSha256,r]));
    const makeJudge=(index)=>new SemanticEvaluationJudge({artifact:[judgeArtifact,secondJudgeArtifact][index],
      isAccepted:()=>f.plan.acceptance.graderIds.includes(ids[index]),onReceipt:receipt=>receipts.push(receipt),
      call:async (_model,messages,_options,artifact)=>{
        const data=JSON.parse(messages[1].content),record=transcripts.get(objectHash(data.transcript));assert(record);
        // Identity and previous grades are absent in the actual judge request.
        // The replay callback intentionally consults fixture labels instead of
        // performing inference; it cannot support any independence claim.
        assert.deepEqual(Object.keys(data).sort(),['context','criteria','transcript']);
        const grade=[first,second][index].cases.find(c=>c.id===record.item.id);
        return {done:true,doneReason:'stop',providerVersion:artifact.providerVersion,digestSha256:artifact.digestSha256,
          content:JSON.stringify({criteria:data.criteria.map(c=>({criterion:c.criterion,
            score:grade.ratings[c.criterion-1],evidence:grade.reasons[c.criterion-1]}))})};
      }});
    const inventory=[...new Set(records.map(r=>r.identity.model))].map(name=>{
      const row=records.find(r=>r.identity.model===name);
      return {name,digest:row.identity.digestSha256,digestSha256:row.identity.digestSha256,capabilities:['completion']};
    });
    for(const model of inventory) {
      const selected=records.filter(r=>r.identity.model===model.name);
      assert.equal(selected.length,40);
      f.history.setProviderVersion(packet.providerVersion);
      const collection=f.history.recordCollection({artifact:{modelName:model.name,digestSha256:model.digestSha256},role:'CHAT',
        suiteName:f.plan.suiteName,suiteVersion:f.plan.suiteVersion,contractSha256:f.plan.suiteContractSha256,
        summary:{score:null,runs:1,startedAt:selected.map(r=>r.attempt.startedAt).sort()[0],completedAt:selected.map(r=>r.attempt.finishedAt).sort().at(-1),
          collection:{status:'AWAITING_REVIEW',planned:40,observed:40,captured:40,budgetExhausted:0,invalid:0},
          tasks:suite.tests.map(t=>{
            const r=selected.find(x=>x.item.task===t.name);
            return {name:t.name,input:t.prompt(),options:t.options,mean:null,scores:[],responses:[r.transcript.at(-1).content],
              details:[{repeat:1,captureStatus:'CAPTURED',gradingStatus:'NOT_GRADED',
                artifact:{digestSha256:model.digestSha256,providerVersion:packet.providerVersion},conversation:r.conversation,
                sourceAttemptSha256:r.identity.attemptSha256,sourcePacketCaseId:r.item.id}]};
          })}});
      const before=collectionEvidenceHash(collection);
      const summaries=[];
      for(let index=0;index<2;index++) {
        const summary=await gradeAnswerCollection({plan:f.plan,collection,judge:makeJudge(index),graderAcceptanceId:ids[index]});
        check(model.name+': complete '+(index?'simulated second':'first-review replay'),summary.grading.invalid===0);
        summaries.push(summary);
        const result=persistGradedCollection({history:f.history,plan:f.plan,collection,summary});
        check(model.name+': '+(index?'differences retained':'one review cannot finish'),
          result.errorCode===(index?'EVALUATION_GRADING_DISPUTE':'EVALUATION_REVIEW_PENDING_PAIR'));
      }
      const reviews=storedGraderReviews(f.history,f.plan,collection);
      const pending=reconcileGraderReviews(reviews,f.plan,collection);
      const decision={schemaVersion:1,sourceRunId:collection.runId,sourceSha256:before,
        firstReviewId:reviews[0].id,secondReviewId:reviews[1].id,
        simulation:true,actualIndependent:false,actualBlind:false,
        review:{reviewer:'SIMULATED_OPERATOR_BY_CODEX',reference:'simulation://operator-authorized-rehearsal',
          reason:'Exercise the real append-only arbitration writer; no real independent approval is asserted.',
          reviewedAt:new Date().toISOString(),blindToModel:true,independent:true},
        // The two true booleans are fictional inputs required by the exercised
        // production contract, not declarations about this simulated reviewer.
        decisions:pending.disputes.map(d=>{
          const r=selected.find(x=>x.item.task===d.task);
          const original=first.cases.find(x=>x.id===r.item.id);
          return {task:d.task,repeat:1,parts:d.firstParts.map((part,i)=>{
            const alternative=alternatives.find(x=>x[0]===r.item.id&&x[1]===i+1);
            return {criterion:i+1,score:alternative?alternative[3]:original.ratings[i],
              evidence:alternative?alternative[4]:original.reasons[i],
              reason:alternative?alternative[5]:'Unchanged first and simulated second criterion; outside arbitration.'};
          })};
        })};
      const final=persistAdjudicatedCollection({history:f.history,plan:f.plan,collection,decision});
      check(model.name+': arbitration closes simulation grade',final.status==='COMPLETE');
      check(model.name+': original collection remains immutable',collectionEvidenceHash(f.history.getRun(collection.runId))===before);
      const expected=mean(selected.map(r=>{
        const row=first.cases.find(x=>x.id===r.item.id),weights=suite.tests.find(t=>t.name===r.item.task).criterionWeights;
        return row.ratings.reduce((sum,score,i)=>sum+(alternatives.find(x=>x[0]===r.item.id&&x[1]===i+1)?.[3]??score)*weights[i],0);
      }));
      check(model.name+': weighted arbitration matches independently computed criterion sums',Math.abs(final.score-expected)<1e-12);
      const index=report.models.length;
      save(outputDirectory,`model-${index}-adjudication-SIMULATED.json`,decision);
      save(outputDirectory,`model-${index}-final-SIMULATED.json`,final);
      report.models.push({model:model.name,digestSha256:model.digestSha256,role:'CHAT',dialogs:40,authoredGroups:20,
        actualFirstPercent:summaries[0].score*100,simulatedSecondPercent:summaries[1].score*100,
        simulatedAdjudicatedPercent:final.score*100,collectionRunId:collection.runId,finalRunId:final.runId,
        disputes:pending.disputes.length,recommendation:'HOLD: development sample and simulated approvals do not establish operational superiority'});
    }
    const readModel=new ModelEvaluationReadModel(f.db,{plans:{CHAT:f.plan}});
    save(outputDirectory,'CHAT-read-model-SIMULATED.json',readModel.read({inventory,bindings:{CHAT:'qwen3.5:27b'},providerVersion:packet.providerVersion}));
    for(const [i,m] of report.models.entries())save(outputDirectory,`model-${i}-detail-SIMULATED.json`,readModel.readRun(m.finalRunId));
    const productionPlan=createRoleEvaluationPlans({db:f.db}).CHAT;
    check('Default production plan does not consume the simulated conversation contract',
      productionPlan.suiteContractSha256!==f.plan.suiteContractSha256 && !productionPlan.decisionReady
      && productionPlan.acceptance.graderIds.length===0);
    // Do not manufacture a favorable operational holdout from these known
    // dialogues. The separate synthetic lifecycle exercises positive activation.
    report.operationalDecision={verdict:'NEROZHODNUTO',action:'PONECHAT',
      reason:'No fresh operational evidence. Simulated acceptance does not make these 20 authored groups a holdout.',
      minimumBenefit:.04,source:'existing CHAT improvement threshold',activation:'NOT_REQUESTED'};
    for(const id of ids)f.revoke(id);
    check('After revocation stored simulated scores cannot satisfy the active grade cache',report.models.every(m=>
      f.history.getComplete({digestSha256:m.digestSha256,role:'CHAT',suiteName:f.plan.suiteName,
        suiteVersion:f.plan.suiteVersion,contractSha256:f.plan.suiteContractSha256})===null));
    save(outputDirectory,'judge-replay-receipts-SIMULATED.json',receipts);
    check('Exactly two judges and both criterion orders reviewed each of 80 whole transcripts',receipts.length===320);
    check('Every source file remains unchanged',[...inputFiles].every(([path,sha])=>hash(readFileSync(join(sourceRoot,path)))===sha));
    report.sourceFiles=Object.fromEntries(inputFiles);report.status='SIMULATION_COMPLETE_FOR_REVIEW_REAL_AUTHORITY_FALSE';
    save(outputDirectory,'simulation.json',report);
    return report;
  } catch(error) {save(outputDirectory,'failure.json',{...report,error:error.stack});throw error;}
  finally {globalThis.fetch=oldFetch;f.db.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const a=process.argv.slice(2);
  if(a.length!==4||a[0]!=='--source'||a[2]!=='--out')throw Error('Usage: --source /verified/CHAT/root --out /NEW/simulation');
  const r=await runReviewedChatSimulation(a[1],a[3]);
  console.log(JSON.stringify({status:r.status,models:r.models,checks:r.checks.length}));
}
