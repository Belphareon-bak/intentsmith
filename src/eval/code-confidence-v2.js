// New development task for the operator's direction §7.5. Historical answers
// and their grades are not inputs to this version. Not a production policy.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildPrompt, extractFunctionCode, runIsolatedTest } from './code-patch-runner.js';

const old=JSON.parse(readFileSync(new URL('./code-suite-tasks.json',import.meta.url),'utf8')).tasks
  .find(t=>t.oracleCase==='f63d14d5eb61' || t.taskFingerprint?.startsWith('f63d14d5eb61'));
if(!old)throw Error('CONFIDENCE_HISTORICAL_SOURCE_MISSING');
const original=old.snapshot.functionTexts[0];
export const confidenceV2Contract={version:'confidence-all-quality.2',status:'PREPARED_FOR_REVIEW',notAHoldout:true,
  historicalSource:old.hash+':'+old.source,decisionAuthority:false,
  domain:{
    comparison:'margin is finite in [-1,1]; candidateWins and incumbentWins are nonnegative integers whose sum equals discriminating. inconclusive is Boolean.',
    quality:'When inconclusive=false, discriminating is a positive integer. It may be 1, 2, 3 or more even when the margin does not meet the replacement threshold.',
    inconclusive:'When inconclusive=true, discriminating=candidateWins=incumbentWins=0 and margin=0.',
    speed:'candidate/incumbent speed is absent or a finite positive number; threshold is finite, strictly positive and at most 1.',
    excluded:'Missing comparison fields, NaN, infinities, negative/fractional counts, and contradictory counts are outside this task. No behavior or score is claimed for them.'},
  requirements:[
    'Uprav pouze decideRole(comparison, speed = {}, threshold = 0.05). Zachovej vítěze, prahy a historické rychlostní/nerozhodné větve. Toto je izolovaná historická úloha, ne oprávnění produkčního huntu měnit model podle rychlosti při neprůkazné kvalitě.',
    'Při KAŽDÉM návratu s basis: "kvalita", včetně ponechání pod prahem, musí confidence přesně být: discriminating=1 → "nízká (jediná úloha)", 2 → "střední", >=3 → "vysoká". Mapování vyjadřuje počet podkladových úloh; není to statistický interval.',
    'Ve všech těchto kvalitativních větvích musí detail pravdivě vysvětlovat stejný stupeň jistoty i dosažené rozhodnutí. Formulace a interpunkce jsou volné. Pouhá citace nebo popření správné hodnoty není její potvrzení.',
    'U basis "rychlost" a "nerozhodně" se confidence nevyžaduje. Zachovej věcně správné vysvětlení prahu, poměru rychlostí nebo nepřítomnosti měření. Změna prose bez změny významu není chyba.',
    'Vstupy: margin konečný v [-1,1]; počty výher nezáporné celé a jejich součet = discriminating. Při inconclusive=false je discriminating kladné celé číslo. Při inconclusive=true jsou margin i všechny počty 0. threshold je konečný v (0,1]. Rychlosti chybí, nebo jsou konečná kladná čísla. Ostatní vstupy jsou mimo tuto úlohu.'
  ]};
const prompt=buildPrompt({source:old.source,subject:'Doplň konzistentní jistotu do všech rozhodnutí založených na kvalitě.',
  functionTexts:[original],spans:old.snapshot.spans,publicContract:{requirements:confidenceV2Contract.requirements}});
const implementationSha256=createHash('sha256').update(readFileSync(new URL('./code-confidence-v2.js',import.meta.url))).digest('hex');
export const confidenceV2Sha256=createHash('sha256').update(JSON.stringify({confidenceV2Contract,prompt,implementationSha256})).digest('hex');
export const confidenceV2Task={name:'code_confidence_all_quality_v2_cs',role:'CODE',language:'cs',independenceGroup:'pairwise-confidence',
  turns:[{role:'user',content:prompt}],options:{num_ctx:16384,num_predict:4096,temperature:0.1,top_p:0.9,timeout:300000},
  taskContractSha256:confidenceV2Sha256,rubric:[
    {id:'api',axis:'executable',requirement:'Preserve winner/basis and exact confidence for all quality branches.'},
    {id:'meaning',axis:'semantic',requirement:'Observed detail faithfully explains confidence and the decision; wording is free.'}],
  gradingStatus:'SEMANTIC_ACCEPTANCE_REQUIRED',score:null,decisionAuthority:false};

export const confidenceV2References={
  gold:`export function decideRole(comparison, speed = {}, threshold = 0.05) {
${original.replace('export function decideRole','function legacyDecision')}
  const result = legacyDecision(comparison, speed, threshold);
  if (result.basis === 'kvalita') {
    result.confidence = comparison.discriminating === 1 ? 'nízká (jediná úloha)' : comparison.discriminating === 2 ? 'střední' : 'vysoká';
    result.detail += '; jistota rozhodnutí: ' + result.confidence;
  }
  return result;
}`,
  alternative:`export function decideRole(comparison, speed = {}, threshold = 0.05) {
  const {margin, candidateWins, incumbentWins, inconclusive, discriminating} = comparison;
  if (!inconclusive) {
    const confidence = ['nízká (jediná úloha)', 'střední', 'vysoká'][Math.min(discriminating, 3) - 1];
    const win = margin >= threshold && candidateWins > incumbentWins;
    const loss = margin <= -threshold && incumbentWins > candidateWins;
    const explanation = win ? 'Kandidát vyhrál kvalitou při dosažení prahu.' : loss ? 'Kandidát prohrál kvalitou při dosažení prahu.' : 'Přínos nestačí pro výměnu; současný model zůstává.';
    return {winner:win ? 'candidate' : 'incumbent', basis:'kvalita', confidence, detail:explanation + ' Jistota je ' + confidence + '.'};
  }
  if (speed.candidate > 0 && speed.incumbent > 0) {
    const ratio = speed.candidate / speed.incumbent;
    return ratio >= 1.25 ? {winner:'candidate',basis:'rychlost',detail:'Kvalita nerozlišila; kandidát dosahuje ' + ratio.toFixed(2) + 'násobku rychlosti.'}
      : {winner:'incumbent',basis:'nerozhodně',detail:'Kvalita nerozlišila, poměr rychlostí ' + ratio.toFixed(2) + ' nestačí pro výměnu.'};
  }
  return {winner:'incumbent',basis:'nerozhodně',detail:'Kvalita nerozlišila; chybí měření rychlosti.'};
}`,
  broken:original,
};

export const confidenceV2Cases=[];
for(const n of [1,2,3,7]) for(const margin of [.2,-.2,.01,.05,-.05]) {
  const wins=margin>0;
  confidenceV2Cases.push({id:`quality-${n}-${margin}`,comparison:{margin,candidateWins:wins?n:0,incumbentWins:wins?0:n,inconclusive:false,discriminating:n},speed:{},threshold:.05,
    expected:{winner:margin>=.05?'candidate':'incumbent',basis:'kvalita',confidence:n===1?'nízká (jediná úloha)':n===2?'střední':'vysoká'}});
}
for(const [id,speed,basis,winner] of [['speed-above',{candidate:20,incumbent:10},'rychlost','candidate'],
  ['speed-boundary',{candidate:12.5,incumbent:10},'rychlost','candidate'],['speed-below',{candidate:12.4,incumbent:10},'nerozhodně','incumbent'],
  ['speed-missing',{},'nerozhodně','incumbent']])
  confidenceV2Cases.push({id,comparison:{margin:0,candidateWins:0,incumbentWins:0,inconclusive:true,discriminating:0},speed,threshold:.05,expected:{winner,basis}});

export function assessConfidenceV2Technical(response) {
  const code=extractFunctionCode(response),directory=mkdtempSync(join(tmpdir(),'confidence-v2-'));
  try {
    if(!code)return {score:null,decisionAuthority:false,technical:{valid:true,score:0},semantics:{status:'NOT_ASSESSED'}};
    writeFileSync(join(directory,'candidate.mjs'),code);
    writeFileSync(join(directory,'cases.json'),JSON.stringify(confidenceV2Cases));
    writeFileSync(join(directory,'check.mjs'),`import {decideRole} from './candidate.mjs';
import {readFileSync} from 'node:fs';
const rows=JSON.parse(readFileSync(new URL('./cases.json',import.meta.url))).map(c=>{
 try {const observed=decideRole(c.comparison,c.speed,c.threshold);
 return {id:c.id,comparison:c.comparison,speed:c.speed,threshold:c.threshold,expected:c.expected,observed,
 passed:Object.entries(c.expected).every(([k,v])=>observed[k]===v) && typeof observed.detail==='string' && observed.detail.trim().length>0};}
 catch(e){return {id:c.id,passed:false,error:e.message};}
});
console.log('CONFIDENCE_V2_RECEIPT '+JSON.stringify(rows));
if(rows.some(r=>!r.passed))process.exitCode=1;`);
    const run=runIsolatedTest(directory,'check.mjs',15000);
    const lines=run.output.split('\n').filter(l=>l.startsWith('CONFIDENCE_V2_RECEIPT '));
    let rows=null;try{if(lines.length===1)rows=JSON.parse(lines[0].slice(22));}catch{}
    const valid=!run.environmentError && !run.timedOut && run.completed!==false && rows?.length===confidenceV2Cases.length;
    return {taskContractSha256:confidenceV2Sha256,score:null,passed:false,decisionAuthority:false,
      technical:{valid:!!valid,score:valid?rows.filter(r=>r.passed).length/rows.length:null,
        reason:run.environmentError || (run.timedOut?'TIMEOUT':!valid?'INVALID_RECEIPT':null),rows,output:run.output},
      semantics:{status:'REVIEW_REQUIRED',score:null,reason:'Executable component does not decide the meaning of detail.'}};
  } finally {rmSync(directory,{recursive:true,force:true});}
}

// Author-written DEVELOPMENT probes, not fresh independent acceptance labels.
export const confidenceMeaningProbes=['nízká','střední','vysoká'].flatMap((level,i)=>{
  const other=['vysoká','nízká','střední'][i];
  return [
    {id:`positive-${i}`,text:`Jistota rozhodnutí je ${level}.`,expected:{status:'ASSERTED',level}},
    {id:`paraphrase-${i}`,text:`Výsledek má ${level === 'nízká'?'nízkou':level === 'střední'?'střední':'vysokou'} jistotu.`,expected:{status:'ASSERTED',level}},
    {id:`negation-${i}`,text:`Jistota není ${level}; je ${other}.`,expected:{status:'ASSERTED',level:other}},
    {id:`quoted-${i}`,text:`Předchozí hlášení znělo „jistota ${level}“. To neplatí. Nyní je ${other}.`,expected:{status:'ASSERTED',level:other}},
    {id:`contradiction-${i}`,text:`Jistota je ${level}. Současně je ${other}.`,expected:{status:'CONTRADICTORY',level:null}},
    {id:`unresolved-${i}`,text:`Je jistota ${level}? Z podkladů to neumím určit.`,expected:{status:'UNRESOLVED',level:null}},
  ];
});
