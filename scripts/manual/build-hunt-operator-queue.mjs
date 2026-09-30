#!/usr/bin/env node
// Development review handoff only. Never assign a model or write an eval DB.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { compareHuntBlindReviews } from '../verify-hunt-blind-review.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--([a-z-]+)=(.+)$/.exec(arg);
  if (!match || !isAbsolute(match[2])) throw Error('ABSOLUTE_ARGUMENTS_REQUIRED');
  return [match[1], match[2]];
}));
const required = ['packet','readiness','review-a','review-b','out'];
if (required.some(key => !args[key]) || Object.keys(args).some(key => ![...required,'flags-a','flags-b'].includes(key)))
  throw Error('QUEUE_ARGUMENTS_INVALID');
if (existsSync(args.out)) throw Error('OUTPUT_EXISTS');
const packetBytes = readFileSync(args.packet);
const readinessBytes = readFileSync(args.readiness);
const reviewABytes = readFileSync(args['review-a']);
const reviewBBytes = readFileSync(args['review-b']);
const packet = JSON.parse(packetBytes);
const readiness = JSON.parse(readinessBytes);
const reviewA = JSON.parse(reviewABytes), reviewB = JSON.parse(reviewBBytes);
const comparison = compareHuntBlindReviews(packetBytes, reviewA, reviewB);
if (!['STEP3_PREPARATION_NO_GRADES','STEP3_PREPARATION_NO_ACCEPTED_GRADES'].includes(readiness.status)
  || readiness.sources?.packet?.sha256 !== comparison.packetSha256
  || readiness.presampledOperatorCases?.length !== 26) throw Error('READINESS_DRIFT');
const byId = new Map(packet.cases.map(item => [item.id,item]));
const ratingsA = new Map(reviewA.cases.map(item => [item.id,item]));
const ratingsB = new Map(reviewB.cases.map(item => [item.id,item]));
const queue = new Map();
function enqueue(id, reason) {
  if (!byId.has(id)) throw Error('UNKNOWN_CASE:'+id);
  if (!queue.has(id)) queue.set(id,new Set());
  queue.get(id).add(reason);
}
for (const item of readiness.presampledOperatorCases) enqueue(item.id,'PRESELECTED_RANDOM');
let differingCriteria=0, majorCriteria=0;
for (const item of packet.cases) {
  const a=ratingsA.get(item.id),b=ratingsB.get(item.id);
  for (let i=0;i<item.rubric.length;i++) {
    if (a.ratings[i]===null || b.ratings[i]===null) {
      enqueue(item.id,'TASK_ISSUE_UNSCORABLE');
      continue;
    }
    const left=Math.round(a.ratings[i]*100),right=Math.round(b.ratings[i]*100),delta=Math.abs(left-right);
    // Frozen before importing grades: all 15-point gaps go to the operator;
    // the existing 25-point agreement statistic remains unchanged.
    if (delta>=15) { differingCriteria++;enqueue(item.id,'SCORE_GAP_AT_LEAST_0_15'); }
    if (delta>25) { majorCriteria++;enqueue(item.id,'SCORE_GAP_OVER_0_25'); }
    if ((left===0&&right>=50)||(right===0&&left>=50)) enqueue(item.id,'ZERO_VERSUS_AT_LEAST_HALF');
  }
}
const flagStatus=[];
for (const [side,key,review] of [['A','flags-a',reviewA],['B','flags-b',reviewB]]) {
  if (!args[key]) {flagStatus.push({reviewer:review.reviewer,status:'NOT_SUBMITTED'});continue;}
  const value=JSON.parse(readFileSync(args[key],'utf8'));
  if (value.schemaVersion!==1||value.packetSha256!==comparison.packetSha256
    || value.reviewer!==review.reviewer||!Array.isArray(value.lowConfidence)
    ||!Array.isArray(value.criticalFailures))throw Error('FLAGS_INVALID:'+side);
  for (const [type,rows] of [['LOW_CONFIDENCE',value.lowConfidence],['CRITICAL_FAILURE',value.criticalFailures]])
    for (const row of rows) {
      if (!Number.isInteger(row.criterion)||row.criterion<1||row.criterion>byId.get(row.id)?.rubric.length
        || typeof row.reason!=='string'||!row.reason.trim())throw Error('FLAG_INVALID:'+side);
      enqueue(row.id,side+'_'+type);
    }
  flagStatus.push({reviewer:review.reviewer,status:'SUBMITTED',lowConfidence:value.lowConfidence.length,
    criticalFailures:value.criticalFailures.length});
}
const rows=[...queue].map(([id,reasons])=>{
  const item=byId.get(id),a=ratingsA.get(id),b=ratingsB.get(id);
  return {id,role:item.role,task:item.task,label:item.label,repeat:item.repeat,
    selectionReasons:[...reasons].sort(),question:item.question,response:item.response,
    criteria:item.rubric.map((criterion,i)=>({index:i+1,criterion,
      scoreA:a.ratings[i],reasonA:a.reasons[i],scoreB:b.ratings[i],reasonB:b.reasons[i],
      differenceHundredths:a.ratings[i]===null||b.ratings[i]===null?null:
        Math.abs(Math.round(a.ratings[i]*100)-Math.round(b.ratings[i]*100))}))};
}).sort((a,b)=>a.role.localeCompare(b.role)||a.task.localeCompare(b.task)||a.label.localeCompare(b.label)||a.repeat-b.repeat);
const result={schemaVersion:1,status:'OPERATOR_ADJUDICATION_PENDING',decisionAuthority:false,
  packetSha256:comparison.packetSha256,readinessSha256:hash(readinessBytes),
  reviewSha256:[hash(reviewABytes),hash(reviewBBytes)],reviewers:[reviewA.reviewer,reviewB.reviewer],
  flags:flagStatus,statistics:{cases:comparison.cases,criteria:comparison.criteria,
    withinQuarter:comparison.withinQuarter,comparedCriteria:comparison.comparedCriteria,
    taskIssueCriteria:comparison.taskIssueCriteria,majorCriteria,differingCriteria,
    presampledCases:26,operatorCases:rows.length},
  warnings:['This is a development review, not accepted grader calibration or a role decision.',
    ...comparison.taskIssueCriteria?['At least one criterion is unscored because its task needs adjudication; it is excluded from numeric agreement.']:[],
    ...flagStatus.some(x=>x.status==='NOT_SUBMITTED')?['Low-confidence and critical-failure selection is incomplete until both reviewers submit explicit flags.']:[]],
  rows};
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const html=`<!doctype html><html lang="cs"><meta charset="utf-8"><title>GPU hunt · rozhodnutí operátora</title>
<style>body{background:#111;color:#eee;font:15px/1.5 system-ui;max-width:1300px;margin:auto;padding:24px}article{border:1px solid #5b5141;background:#1d1d1d;padding:16px;margin:24px 0;border-radius:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#0b0b0b;padding:16px;max-height:500px;overflow:auto}details{margin:12px 0}summary{cursor:pointer;color:#e9bb6f}table{border-collapse:collapse;width:100%}td,th{border:1px solid #514b41;padding:8px;text-align:left;vertical-align:top}.alert{color:#ffc46b}</style>
<h1>GPU hunt · podklad k rozsouzení</h1><p>Žádná identita modelu ani doporučení role. Packet <code>${result.packetSha256}</code>. ${rows.length} odpovědí ve frontě; 26 bylo vybráno před známkováním.</p>
${result.warnings.map(x=>`<p class="alert">${esc(x)}</p>`).join('')}
${rows.map(row=>`<article id="${esc(row.id)}"><h2>${esc(row.role)} · ${esc(row.task)} · ${esc(row.label)}/${row.repeat}</h2><p>${row.selectionReasons.map(esc).join(' · ')} · <code>${esc(row.id)}</code></p><details><summary>Celé zadání</summary><pre>${esc(row.question)}</pre></details><h3>Celá odpověď</h3><pre>${esc(row.response)}</pre><table><thead><tr><th>Kritérium</th><th>${esc(reviewA.reviewer)}</th><th>${esc(reviewB.reviewer)}</th></tr></thead><tbody>${row.criteria.map(c=>`<tr><td>${c.index}. ${esc(c.criterion)}</td><td>${c.scoreA===null?'bez známky':c.scoreA.toFixed(2)} · ${esc(c.reasonA)}</td><td>${c.scoreB===null?'bez známky':c.scoreB.toFixed(2)} · ${esc(c.reasonB)}</td></tr>`).join('')}</tbody></table></article>`).join('')}
</html>`;
mkdirSync(args.out,{mode:0o700});
writeFileSync(join(args.out,'queue.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
writeFileSync(join(args.out,'review.html'),html,{mode:0o600});
console.log(JSON.stringify({status:result.status,statistics:result.statistics,flags:flagStatus,out:args.out}));
