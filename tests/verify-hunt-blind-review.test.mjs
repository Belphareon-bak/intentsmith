import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyHuntBlindReview, compareHuntBlindReviews } from '../scripts/verify-hunt-blind-review.mjs';

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

test('packet binding and missing grades fail closed',()=>{
  assert.throws(()=>verifyHuntBlindReview(Buffer.from(packet.toString()+' '),review()),/REVIEW_HEADER/);
  const missing=review();missing.cases[0].ratings[1]=null;
  assert.throws(()=>verifyHuntBlindReview(packet,missing),/REVIEW_CRITERIA/);
  const reason=review();reason.cases[1].reasons[0]='  ';
  assert.throws(()=>verifyHuntBlindReview(packet,reason),/REVIEW_CRITERIA/);
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
