// Exact structured tasks use deterministic content checks, with protocol
// compliance reported separately. Markdown is never silently a strict-JSON PASS.
import { isDeepStrictEqual } from 'node:util';
export function gradeStructuredAnswer(response, expected) {
 const raw=String(response??'').trim();
 const fence=/^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(raw);
 let parsed;try{parsed=JSON.parse(fence?fence[1]:raw);}catch{return {score:0,passed:false,valid:true,detail:{contentScore:0,formatScore:0,strictJson:false,reason:'INVALID_JSON',criteria:[]}};}
 const object=parsed!==null&&typeof parsed==='object'&&!Array.isArray(parsed);
 const exactKeys=object&&isDeepStrictEqual(Object.keys(parsed).sort(),Object.keys(expected).sort());
 const criteria=Object.entries(expected).map(([id,value])=>({id,score:object&&isDeepStrictEqual(parsed[id],value)?1:0,observed:object?parsed[id]:null,expected:value}));
 const contentScore=criteria.reduce((n,c)=>n+c.score,0)/criteria.length;
 const formatScore=!fence&&exactKeys?1:0;
 return {valid:true,score:contentScore,passed:contentScore===1&&formatScore===1,detail:{contentScore,formatScore,strictJson:!fence,exactKeys,criteria,reason:formatScore?null:'OUTPUT_FORMAT_MISMATCH'}};
}
export function structuredTask(task) {
 const expected=structuredClone(task.evaluation.expected);
 return Object.freeze({name:task.name,role:task.role,language:task.language,tier:'T2',description:task.description,independenceGroup:task.independenceGroup,
  promptText:task.prompt,prompt:()=>({text:task.prompt}),rubric:task.reference.criteria,
  options:{num_ctx:16384,num_predict:2048,temperature:.1,top_p:.9,timeout:300000},
  contractMaterial:{prompt:{kind:'text',text:task.prompt},gradingInputs:{tier:'T2',expected,gradingVersion:'structured-answer.1',independenceGroup:task.independenceGroup,formatSeparate:true}},
  grade:response=>gradeStructuredAnswer(response,expected)});
}
