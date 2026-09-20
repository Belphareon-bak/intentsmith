// Exact fields are checked after production JSON extraction. Protocol shape is
// separate; strictJson records the original wrapping without rejecting it.
import { isDeepStrictEqual } from 'node:util';
import { readRuntimeJson, RUNTIME_JSON_CONTRACT } from './runtime-json.js';
export function gradeStructuredAnswer(response, expected, rules = {}) {
 const {value:parsed,...parsing}=readRuntimeJson(response);
 if(!parsing.runtimeParsed)return {score:0,passed:false,valid:true,detail:{contentScore:null,formatScore:0,...parsing,reason:'INVALID_JSON',criteria:[]}};
 const object=parsed!==null&&typeof parsed==='object'&&!Array.isArray(parsed);
 const exactKeys=object&&isDeepStrictEqual(Object.keys(parsed).sort(),Object.keys(expected).sort());
 const criteria=Object.entries(expected).map(([id,value])=>{
  const observed=object?parsed[id]:null;
  if(rules[id]==='case-insensitive-label') {
   // These closed labels identify a weekday or a mode; their public prompts
   // prescribe keys and types, but do not prescribe capitalization.
   const normalize=v=>typeof v==='string'?v.normalize('NFC').toLowerCase():null;
   const score=typeof observed==='string'&&normalize(observed)===normalize(value)?1:0;
   return {id,score,observed,expected:value};
  }
  if(rules[id]==='literal-assertion-set') {
   const strings=v=>Array.isArray(v)&&v.every(s=>typeof s==='string');
   const sorted=v=>[...v].sort();
   // The prompt requires the assertions, without prescribing their array order.
   // Missing terminal sentence dots are a literal-format defect, not wrong facts.
   const normalize=v=>sorted(v.map(s=>s.replace(/\.$/,'')));
   const comparable=strings(observed)&&strings(value);
   const score=comparable&&isDeepStrictEqual(normalize(observed),normalize(value))?1:0;
   const literalMatch=comparable&&isDeepStrictEqual(sorted(observed),sorted(value));
   return {id,score,formatScore:literalMatch?1:0,observed,expected:value,reason:score&&!literalMatch?'TERMINAL_PUNCTUATION_MISMATCH':null};
  }
  return {id,score:object&&isDeepStrictEqual(observed,value)?1:0,observed,expected:value};
 });
 const contentScore=criteria.reduce((n,c)=>n+c.score,0)/criteria.length;
 const formatScore=exactKeys&&criteria.every(c=>c.formatScore!==0)?1:0;
 return {valid:true,score:contentScore,passed:contentScore===1&&formatScore===1,detail:{contentScore,formatScore,...parsing,exactKeys,observed:parsed,criteria,reason:formatScore?null:'OUTPUT_FORMAT_MISMATCH'}};
}
export function structuredTask(task) {
 const expected=structuredClone(task.evaluation.expected);
 return Object.freeze({name:task.name,role:task.role,language:task.language,tier:'T2',description:task.description,independenceGroup:task.independenceGroup,
  promptText:task.prompt,prompt:()=>({text:task.prompt}),rubric:task.reference.criteria,
  formatRubric:task.reference.formatCriteria||[],
  options:{num_ctx:16384,num_predict:2048,temperature:.1,top_p:.9,timeout:300000},
  contractMaterial:{prompt:{kind:'text',text:task.prompt},gradingInputs:{tier:'T2',expected,rules:structuredClone(task.evaluation.rules||{}),gradingVersion:'structured-answer.4',parser:RUNTIME_JSON_CONTRACT,independenceGroup:task.independenceGroup,formatSeparate:true,formatCriteria:task.reference.formatCriteria||[]}},
  grade:response=>gradeStructuredAnswer(response,expected,task.evaluation.rules)});
}
