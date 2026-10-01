import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyHuntBlindReview, compareHuntBlindReviews } from '../scripts/verify-hunt-blind-review.mjs';
import { verifyHuntSecondReviewBatches } from '../scripts/verify-hunt-second-review-batches.mjs';
import { compareChatPair } from '../scripts/manual/compare-chat-review-pair.mjs';

const packet=Buffer.from(JSON.stringify({schemaVersion:1,status:'DEVELOPMENT_BLIND_REVIEW',
  decisionAuthority:false,notFreshHoldout:true,cases:[
    {id:'case-a',role:'D1',task:'cause',rubric:['Causal chain','Evidence'],response:'Answer A'},
    {id:'case-b',role:'R1',task:'review',rubric:['Sound finding'],response:'Answer B'},
  ]})+'\n');
const packetSha256=createHash('sha256').update(packet).digest('hex');
const review=(reviewer='reader A')=>({schemaVersion:1,status:'DRAFT_BLIND_REVIEW',decisionAuthority:false,
  packetSha256,reviewer,reviewedAt:'2026-09-25T00:00:00Z',cases:[
    {id:'case-a',ratings:[1,.5],reasons:['Correct causal chain','Partial source evidence']},
    {id:'case-b',ratings:[0],reasons:['Misses the actual defect']},
  ]});

test('complete grounded draft validates but never becomes accepted evidence',()=>{
  const result=verifyHuntBlindReview(packet,review());
  assert.equal(result.cases,2);
  assert.equal(result.criteria,3);
  assert.equal(result.decisionAuthority,false);
  assert.equal(result.acceptedGrader,false);
});

test('a shared grading policy is part of the packet identity and cannot be silently changed',()=>{
  const value=JSON.parse(packet),r=review();
  value.reviewPolicyVersion='chat-review-shared-policy.1';
  value.rubricPolicy={instructions:['Both reviewers apply this rule.'],revision:'policy.1'};
  value.rubricPolicySha256=createHash('sha256').update(JSON.stringify(value.rubricPolicy)).digest('hex');
  let bytes=Buffer.from(JSON.stringify(value));
  r.packetSha256=createHash('sha256').update(bytes).digest('hex');
  assert.equal(verifyHuntBlindReview(bytes,r).cases,2);
  assert.throws(()=>verifyHuntBlindReview(bytes,review()),/REVIEW_HEADER/);
  value.rubricPolicy.instructions=['Changed rule'];bytes=Buffer.from(JSON.stringify(value));
  r.packetSha256=createHash('sha256').update(bytes).digest('hex');
  assert.throws(()=>verifyHuntBlindReview(bytes,r),/SHARED_RUBRIC_POLICY/);
});

test('external CHAT comparison keeps two scores, exact digests and priority reasons without granting authority',()=>{
  const value=JSON.parse(packet);
  value.cases=value.cases.map((c,i)=>({...c,role:'CHAT',task:'cs_example',label:i?'B':'A',
    rubric:['factual','usefulness','conversation','communication'].map(axis=>`Test [${axis}]: evidence`)}));
  const packetBytes=Buffer.from(JSON.stringify(value)),packetSha256=createHash('sha256').update(packetBytes).digest('hex');
  const a={...review('A'),packetSha256,cases:value.cases.map(c=>({id:c.id,ratings:[1,.5,1,1],reasons:['a','b','c','d']}))};
  const b=structuredClone(a);b.reviewer='B';b.cases[0].ratings[0]=.5;
  const identities={packetSha256,cases:value.cases.map((c,i)=>({id:c.id,model:`model-${i}`,digestSha256:String(i).repeat(64)}))};
  const result=compareChatPair({packetBytes,first:a,second:b,identities});
  assert.equal(result.decisionAuthority,false);assert.equal(result.simulation,false);
  assert.equal(result.comparison.disagreementAboveQuarter,1);
  assert.equal(result.models[0].first.weighted,.85);
  assert.equal(result.models[0].second.weighted,.65);
  assert.equal(result.cases[0].priorityReasons[0].kind,'DISAGREEMENT');
  assert.equal(result.cases[1].priorityReasons[0].kind,'POST_REVIEW_HASH_SAMPLE');
  assert.throws(()=>compareChatPair({packetBytes,first:a,second:b,
    identities:{...identities,packetSha256:'wrong'}}),/IDENTITY_MISMATCH/);
});

test('grounded hundredth-step grades are valid but arbitrary precision and out-of-range scores are rejected',()=>{
  const partial=review();partial.cases[0].ratings[1]=.98;
  assert.equal(verifyHuntBlindReview(packet,partial).cases,2);
  for(const score of [.333,-.01,1.01,NaN]){
    const invalid=review();invalid.cases[0].ratings[1]=score;
    assert.throws(()=>verifyHuntBlindReview(packet,invalid),/REVIEW_CRITERIA/);
  }
});

test('packet binding and missing grades fail closed',()=>{
  assert.throws(()=>verifyHuntBlindReview(Buffer.from(packet.toString()+' '),review()),/REVIEW_HEADER/);
  const missing=review();missing.cases[0].ratings[1]=null;
  assert.throws(()=>verifyHuntBlindReview(packet,missing),/REVIEW_CRITERIA/);
  const reason=review();reason.cases[1].reasons[0]='  ';
  assert.throws(()=>verifyHuntBlindReview(packet,reason),/REVIEW_CRITERIA/);
});

test('explicit task issue is unscored and retained for adjudication',()=>{
  const a=review('reader A'),b=review('reader B');
  a.cases[0].ratings[1]=null;
  a.cases[0].reasons[1]='TASK_ISSUE: Historical DDL is absent from the public prompt';
  const valid=verifyHuntBlindReview(packet,a);
  assert.equal(valid.criteria,3);
  assert.equal(valid.gradedCriteria,2);
  assert.equal(valid.taskIssueCriteria,1);
  const result=compareHuntBlindReviews(packet,a,b);
  assert.equal(result.criteria,3);
  assert.equal(result.comparedCriteria,2);
  assert.equal(result.taskIssueCriteria,1);
  assert.equal(result.withinQuarter,2);
  assert.equal(result.disagreementAboveQuarter,0);
  assert.equal(result.taskIssues[0].scoreA,null);
  assert.equal(result.taskIssues[0].scoreB,.5);
  assert.match(result.taskIssues[0].reasonA,/Historical DDL/);
  assert.equal(result.decisionAuthority,false);
});

test('duplicate or foreign answers cannot stand in for the packet',()=>{
  const duplicate=review();duplicate.cases[1].id='case-a';
  assert.throws(()=>verifyHuntBlindReview(packet,duplicate),/REVIEW_CASE_ID/);
  const foreign=review();foreign.cases[1].id='case-c';
  assert.throws(()=>verifyHuntBlindReview(packet,foreign),/REVIEW_CASE_ID/);
});

test('independent reviewers retain concrete criterion disputes',()=>{
  const a=review('reader A'),b=review('reader B');b.cases[0].ratings[0]=.5;
  b.cases[0].reasons[0]='Reference omits a required boundary';
  const result=compareHuntBlindReviews(packet,a,b);
  assert.equal(result.criteria,3);
  assert.equal(result.disagreementAboveQuarter,1);
  assert.deepEqual(result.disputes[0],{id:'case-a',role:'D1',task:'cause',criterion:1,
    scoreA:1,scoreB:.5,reasonA:'Correct causal chain',reasonB:'Reference omits a required boundary'});
  assert.equal(result.decisionAuthority,false);
  assert.throws(()=>compareHuntBlindReviews(packet,a,review('reader A')),/REVIEWER_NOT_INDEPENDENT/);
});


test('a difference of exactly 25 hundredths is agreement across decimal representations',()=>{
  for(const [left,right] of [[.54,.29],[.29,.54],[.75,.50],[.25,0]]){
    const a=review('reader A'),b=review('reader B');
    a.cases[0].ratings[0]=left;b.cases[0].ratings[0]=right;
    const result=compareHuntBlindReviews(packet,a,b);
    assert.equal(result.withinQuarter,3,`${left} versus ${right}`);
    assert.equal(result.disagreementAboveQuarter,0,`${left} versus ${right}`);
  }
  const a=review('reader A'),b=review('reader B');
  a.cases[0].ratings[0]=.55;b.cases[0].ratings[0]=.29;
  assert.equal(compareHuntBlindReviews(packet,a,b).disagreementAboveQuarter,1);
});

test('complete response packet and exposure-aware review export can be compared',()=>{
  const completePacket=Buffer.from(JSON.stringify({schemaVersion:2,status:'ANONYMIZED_REVIEW_PENDING',
    decisionAuthority:false,notAHoldout:true,cases:[
      {id:'complete-a',role:'R1',task:'model_cleanup',rubric:['Cause','Impact'],response:'Full answer'},
    ]})+'\n');
  const digest=createHash('sha256').update(completePacket).digest('hex');
  const form=(reviewer,exposure='')=>({schemaVersion:2,status:'DRAFT_NOT_ACCEPTED',
    decisionAuthority:false,packetSha256:digest,exportedAt:'2026-09-26T10:00:00Z',
    reviewer,exposure,grades:{'complete-a':{criteria:[
      {index:1,score:.75,reason:'Names the cause'},
      {index:2,score:.5,reason:'Partial impact'},
    ]}}});
  const first=form('first reader','Earlier answers were visible');
  const second=form('second reader');second.grades['complete-a'].criteria[1].score=.25;
  const verified=verifyHuntBlindReview(completePacket,first);
  assert.equal(verified.cases,1);
  assert.equal(verified.criteria,2);
  assert.equal(verified.exposure,'Earlier answers were visible');
  const comparison=compareHuntBlindReviews(completePacket,first,second);
  assert.equal(comparison.withinQuarter,2);
  assert.deepEqual(comparison.reviewerExposures,['Earlier answers were visible','']);
  second.grades['complete-a'].criteria[0].index=2;
  assert.throws(()=>verifyHuntBlindReview(completePacket,second),/REVIEW_CRITERIA/);
  const missing=form('first reader');delete missing.grades['complete-a'];
  assert.throws(()=>verifyHuntBlindReview(completePacket,missing),/REVIEW_HEADER/);
});

test('exposure-aware CHAT review keeps its disclosed status and packet binding',()=>{
  const disclosed={...review(),status:'DRAFT_EXPOSURE_RECORDED',exposure:'Saw the model names before grading'};
  assert.equal(verifyHuntBlindReview(packet,disclosed).exposure,disclosed.exposure);
  delete disclosed.exposure;
  assert.throws(()=>verifyHuntBlindReview(packet,disclosed),/REVIEW_HEADER/);
});

function secondReviewFixture(){
  const sharedContextBytes=Buffer.from('{"clock":"owned"}\n');
  const codePolicyBytes=Buffer.from('# Owned CODE review policy\n');
  const rubricPolicy={revision:'test.1',instructions:['Apply the same rubric to every answer.']};
  const packetValue={schemaVersion:1,status:'DEVELOPMENT_BLIND_REVIEW',
    notFreshHoldout:true,decisionAuthority:false,reviewPolicyVersion:'chat-review-shared-policy.1',
    rubricPolicy,rubricPolicySha256:createHash('sha256').update(JSON.stringify({
      instructions:rubricPolicy.instructions,revision:rubricPolicy.revision,
    })).digest('hex'),
    sharedSystemContextSha256:createHash('sha256').update(sharedContextBytes).digest('hex'),
    codeReviewPolicySha256:createHash('sha256').update(codePolicyBytes).digest('hex'),
    cases:[
      {id:'chat-id',role:'CHAT',task:'cs_case',label:'A',repeat:1,question:'Q',
        rubric:['case.1 [factual]: grounded answer'],response:'A'},
      {id:'code-id',role:'CODE',task:'code_case',label:'B',repeat:1,question:'Q',
        rubric:['api [executable]: safe','meaning [semantic]: grounded'],response:'A'},
      {id:'dr-id',role:'D1',task:'d1_case',label:'C',repeat:2,question:'Q',
        rubric:['Cause grounded in source'],response:'A'},
      {id:'missing-id',role:'R1',task:'r1_case',label:'D',repeat:3,question:'Q',
        rubric:['Review is actionable'],response:'A'},
    ]};
  const packetBytes=Buffer.from(JSON.stringify(packetValue)+'\n');
  const file=(name,grade)=>({name,bytes:Buffer.from(JSON.stringify({reviewer:'owned second reader',
    batch:name.slice(0,-5),scale:[0,.25,.5,.75,1],note:'Owned fixture',grades:[grade]})+'\n')});
  const batchFiles=[
    file('chat-001.json',{idx:0,id:'chat-id',task:'cs_case',label:'A',
      s:{'case.1':[.5,'Revised because context resolves the subject','Exact answer span']}}),
    file('code-001.json',{idx:1,id:'code-id',task:'code_case',label:'B',repeat:1,
      s:{meaning:[.5,'Meaning reason','Meaning evidence'],api:[.25,'API reason','API evidence']},
      meaning_points_of_24:12,api_cases_ok:6,provisional_task_mean:.38,
      exact_fractions:{meaning:.5,api:.25},scale_snap:{meaning:.5,api:.25}}),
    file('dr-001.json',{idx:2,task:'d1_case',label:'C',s:{c1:[.75,'Cause reason','Cause evidence']}}),
  ];
  const revisionBytes=Buffer.from(JSON.stringify({note:'Context revision',clock:'Owned clock',log:[
    {idx:0,task:'cs_case',label:'A',criterion:'case.1',old_score:.25,new_score:.5,
      old_reason:'Prior assessment',new_reason:'Revised because context resolves the subject'},
  ]})+'\n');
  return {packetBytes,expectedPacketSha256:createHash('sha256').update(packetBytes).digest('hex'),
    sharedContextBytes,codePolicyBytes,batchFiles,revisionBytes};
}

function mutateBatch(source,name,change){
  const value={...source,batchFiles:source.batchFiles.map(file=>({...file,bytes:Buffer.from(file.bytes)}))};
  const index=value.batchFiles.findIndex(file=>file.name===name);
  const batch=JSON.parse(value.batchFiles[index].bytes.toString('utf8'));
  change(batch);
  value.batchFiles[index].bytes=Buffer.from(JSON.stringify(batch)+'\n');
  return value;
}

test('partial second-review batches bind to packet and emit explicit gaps without a decision',()=>{
  const result=verifyHuntSecondReviewBatches(secondReviewFixture());
  assert.equal(result.status,'DEVELOPMENT_REVIEW_INCOMPLETE');
  assert.equal(result.decisionStatus,'NO_DECISION');
  assert.equal(result.decisionAuthority,false);
  assert.equal(result.acceptedGrader,false);
  assert.deepEqual(result.coverage,{packetCases:4,validatedCases:3,missingCases:1,
    packetCriteria:5,validatedCriteria:4,missingCriteria:1,taskIssueCriteria:0});
  assert.deepEqual(result.missingCases,[{idx:3,id:'missing-id',role:'R1',task:'r1_case',label:'D',repeat:3}]);
  assert.equal(result.normalizedMissingIds,1);
  assert.equal(result.revisions.entries,1);
  assert.equal(result.revisions.scoreChanges,1);
  assert.equal(result.files.length,3);
  assert(!JSON.stringify(result).includes('Revised because context'));
});

test('even complete structural second-review coverage remains NO_DECISION',()=>{
  const source=secondReviewFixture();
  const last={reviewer:'owned second reader',batch:'dr-002',scale:[0,.25,.5,.75,1],
    note:'Owned completion fixture',grades:[{idx:3,id:'missing-id',task:'r1_case',label:'D',repeat:3,
      s:{c1:[1,'Review reason','Review evidence']}}]};
  source.batchFiles.push({name:'dr-002.json',bytes:Buffer.from(JSON.stringify(last)+'\n')});
  const result=verifyHuntSecondReviewBatches(source);
  assert.equal(result.status,'STRUCTURALLY_COMPLETE_NO_DECISION');
  assert.equal(result.decisionStatus,'NO_DECISION');
  assert.equal(result.acceptedGrader,false);
  assert.deepEqual(result.missingCases,[]);
});

test('partial second review rejects packet, context and CODE policy drift',()=>{
  const base=secondReviewFixture();
  assert.throws(()=>verifyHuntSecondReviewBatches({...base,expectedPacketSha256:'0'.repeat(64)}),/PACKET_HASH/);
  assert.throws(()=>verifyHuntSecondReviewBatches({...base,sharedContextBytes:Buffer.from('changed')}),/SHARED_CONTEXT_HASH/);
  assert.throws(()=>verifyHuntSecondReviewBatches({...base,codePolicyBytes:Buffer.from('changed')}),/CODE_POLICY_HASH/);
});

test('partial second review rejects duplicate, foreign and mismatched case identities',()=>{
  const base=secondReviewFixture();
  const duplicate=mutateBatch(base,'dr-001.json',batch=>{batch.grades[0].idx=0;});
  assert.throws(()=>verifyHuntSecondReviewBatches(duplicate),/DUPLICATE_INDEX/);
  const foreign=mutateBatch(base,'dr-001.json',batch=>{batch.grades[0].idx=40;});
  assert.throws(()=>verifyHuntSecondReviewBatches(foreign),/CASE_INDEX/);
  const wrongId=mutateBatch(base,'code-001.json',batch=>{batch.grades[0].id='other';});
  assert.throws(()=>verifyHuntSecondReviewBatches(wrongId),/CASE_ID/);
  const wrongNormalizedId=mutateBatch(base,'dr-001.json',batch=>{batch.grades[0].id='other';});
  assert.throws(()=>verifyHuntSecondReviewBatches(wrongNormalizedId),/CASE_ID/);
  const wrongTask=mutateBatch(base,'chat-001.json',batch=>{batch.grades[0].task='en_other';});
  assert.throws(()=>verifyHuntSecondReviewBatches(wrongTask),/CASE_METADATA/);
  const wrongRepeat=mutateBatch(base,'code-001.json',batch=>{batch.grades[0].repeat=2;});
  assert.throws(()=>verifyHuntSecondReviewBatches(wrongRepeat),/CASE_METADATA/);
});

test('partial second review rejects rubric, reason and revision drift',()=>{
  const base=secondReviewFixture();
  const rubric=mutateBatch(base,'chat-001.json',batch=>{batch.grades[0].s={'case.2':[.5,'Reason','Evidence']};});
  assert.throws(()=>verifyHuntSecondReviewBatches(rubric),/CRITERION_KEYS/);
  const evidence=mutateBatch(base,'dr-001.json',batch=>{batch.grades[0].s.c1[2]=' ';});
  assert.throws(()=>verifyHuntSecondReviewBatches(evidence),/CRITERION_VALUE/);
  const fraction=mutateBatch(base,'code-001.json',batch=>{batch.grades[0].exact_fractions.api=.5;});
  assert.throws(()=>verifyHuntSecondReviewBatches(fraction),/CODE_COMPONENTS/);
  const revision={...base};
  const value=JSON.parse(revision.revisionBytes.toString('utf8'));value.log[0].new_score=.75;
  revision.revisionBytes=Buffer.from(JSON.stringify(value));
  assert.throws(()=>verifyHuntSecondReviewBatches(revision),/REVISION_CURRENT_MISMATCH/);
});
