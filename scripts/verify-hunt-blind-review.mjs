#!/usr/bin/env node
// Validate independently filled development review packets. This does not
// accept graders, decide a role, or write to an evaluation database.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const validScore = score => Number.isFinite(score) && score >= 0 && score <= 1
  && Math.abs(score * 100 - Math.round(score * 100)) < 1e-8;
const fail = code => { throw new Error(`HUNT_BLIND_REVIEW_INVALID:${code}`); };
const exactKeys = (value, keys) => value && !Array.isArray(value) && typeof value === 'object'
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

export function verifyHuntBlindReview(packetBytes, review) {
  const packetSha256 = sha256(packetBytes);
  let packet;
  try { packet = JSON.parse(packetBytes); } catch { fail('PACKET_JSON'); }
  const legacyPacket = packet?.schemaVersion === 1 && packet.status === 'DEVELOPMENT_BLIND_REVIEW'
    && packet.notFreshHoldout === true;
  const completePacket = packet?.schemaVersion === 2 && packet.status === 'ANONYMIZED_REVIEW_PENDING'
    && packet.notAHoldout === true;
  if ((!legacyPacket && !completePacket) || packet.decisionAuthority !== false
    || !Array.isArray(packet.cases) || packet.cases.length === 0) fail('PACKET_SCOPE');
  if (packet.reviewPolicyVersion !== undefined) {
    const policy=packet.rubricPolicy;
    const canonical=JSON.stringify(policy,(_key,value)=>value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])) : value);
    if (packet.reviewPolicyVersion!=='chat-review-shared-policy.1' || !policy?.revision
      || !Array.isArray(policy.instructions) || !policy.instructions.length
      || policy.instructions.some(x=>typeof x!=='string' || !x.trim())
      || sha256(canonical)!==packet.rubricPolicySha256) fail('SHARED_RUBRIC_POLICY');
  }
  const legacyReview = review?.schemaVersion === 1
    && ['DRAFT_BLIND_REVIEW', 'DRAFT_EXPOSURE_RECORDED'].includes(review.status)
    && Array.isArray(review.cases) && review.cases.length === packet.cases.length;
  const completeReview = review?.schemaVersion === 2 && review.status === 'DRAFT_NOT_ACCEPTED'
    && exactKeys(review.grades, packet.cases.map(item => item.id));
  if (!(legacyPacket ? legacyReview : completeReview)
    || review.decisionAuthority !== false || review.packetSha256 !== packetSha256
    || typeof review.reviewer !== 'string' || !review.reviewer.trim()
    || !Number.isFinite(Date.parse(legacyReview ? review.reviewedAt : review.exportedAt))
    || (review.status !== 'DRAFT_BLIND_REVIEW' && typeof review.exposure !== 'string')) fail('REVIEW_HEADER');
  const expected = new Map();
  for (const item of packet.cases) {
    if (typeof item?.id !== 'string' || expected.has(item.id)
      || typeof item.role !== 'string' || typeof item.task !== 'string'
      || !Array.isArray(item.rubric) || item.rubric.length === 0
      || item.rubric.some(x => typeof x !== 'string' || !x.trim())
      || typeof item.response !== 'string') fail('PACKET_CASE');
    expected.set(item.id, item);
  }
  const rows = legacyReview ? review.cases : packet.cases.map(item => {
    const grade = review.grades[item.id];
    if (!exactKeys(grade, ['criteria']) || !Array.isArray(grade.criteria)
      || grade.criteria.length !== item.rubric.length
      || grade.criteria.some((criterion, index) => !exactKeys(criterion, ['index','score','reason'])
        || criterion.index !== index + 1)) fail('REVIEW_CRITERIA');
    return {id:item.id,ratings:grade.criteria.map(x => x.score),
      reasons:grade.criteria.map(x => x.reason)};
  });
  const graded = new Map();
  for (const row of rows) {
    if (!exactKeys(row,['id','ratings','reasons']) || !expected.has(row.id) || graded.has(row.id)) fail('REVIEW_CASE_ID');
    const item = expected.get(row.id);
    if (!Array.isArray(row.ratings) || row.ratings.length !== item.rubric.length
      || !Array.isArray(row.reasons) || row.reasons.length !== item.rubric.length
      || row.reasons.some(reason => typeof reason !== 'string' || !reason.trim())
      || row.ratings.some((score, index) => score === null
        ? !row.reasons[index].startsWith('TASK_ISSUE:') : !validScore(score))) fail('REVIEW_CRITERIA');
    graded.set(row.id,row);
  }
  const criteria=[...expected.values()].reduce((n,x)=>n+x.rubric.length,0);
  const taskIssueCriteria=rows.reduce((n,row)=>n+row.ratings.filter(score=>score===null).length,0);
  return {packetSha256,reviewer:review.reviewer,
    reviewedAt:legacyReview ? review.reviewedAt : review.exportedAt,
    exposure:typeof review.exposure === 'string' ? review.exposure : null,
    cases:graded.size,criteria,gradedCriteria:criteria-taskIssueCriteria,taskIssueCriteria,
    decisionAuthority:false,acceptedGrader:false,rows:graded,packetCases:expected};
}

export function compareHuntBlindReviews(packetBytes, first, second) {
  const a=verifyHuntBlindReview(packetBytes,first),b=verifyHuntBlindReview(packetBytes,second);
  if(a.reviewer===b.reviewer)fail('REVIEWER_NOT_INDEPENDENT');
  const disputes=[],taskIssues=[];let withinQuarter=0,total=0,comparedCriteria=0;
  for(const [id,item] of a.packetCases){
    const left=a.rows.get(id),right=b.rows.get(id);
    for(let i=0;i<item.rubric.length;i++){
      total++;
      if(left.ratings[i]===null || right.ratings[i]===null){
        taskIssues.push({id,role:item.role,task:item.task,criterion:i+1,
          scoreA:left.ratings[i],scoreB:right.ratings[i],reasonA:left.reasons[i],reasonB:right.reasons[i]});
        continue;
      }
      comparedCriteria++;
      const differenceInHundredths=Math.abs(Math.round(left.ratings[i]*100)-Math.round(right.ratings[i]*100));
      if(differenceInHundredths<=25)withinQuarter++;
      else disputes.push({id,role:item.role,task:item.task,criterion:i+1,
        scoreA:left.ratings[i],scoreB:right.ratings[i],reasonA:left.reasons[i],reasonB:right.reasons[i]});
    }
  }
  return {status:'DEVELOPMENT_REVIEW_COMPARISON',decisionAuthority:false,
    packetSha256:a.packetSha256,reviewers:[a.reviewer,b.reviewer],cases:a.cases,
    reviewerExposures:[a.exposure,b.exposure],
    criteria:total,comparedCriteria,taskIssueCriteria:taskIssues.length,taskIssues,
    withinQuarter,disagreementAboveQuarter:disputes.length,disputes,
    note:'Agreement on known development cases is not independent grader acceptance or a role decision.'};
}

function parseArgs(args){
  const options={packet:null,reviews:[]};
  for(let i=0;i<args.length;i+=2){
    if(args[i]==='--packet' && !options.packet && isAbsolute(args[i+1]||''))options.packet=args[i+1];
    else if(args[i]==='--review' && isAbsolute(args[i+1]||''))options.reviews.push(args[i+1]);
    else fail('ARGUMENTS');
  }
  if(!options.packet || ![1,2].includes(options.reviews.length))fail('ARGUMENTS');
  return options;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const options=parseArgs(process.argv.slice(2)),packet=readFileSync(options.packet),reviews=options.reviews.map(path=>JSON.parse(readFileSync(path,'utf8')));
    const result=reviews.length===2?compareHuntBlindReviews(packet,...reviews):verifyHuntBlindReview(packet,reviews[0]);
    if(reviews.length===1)delete result.rows,delete result.packetCases;
    console.log(JSON.stringify(result,null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
