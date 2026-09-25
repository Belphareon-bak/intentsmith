#!/usr/bin/env node
// Developer preparation and executable controls only; no model or grading call.
import { mkdirSync,writeFileSync } from 'node:fs';
import { isAbsolute,join } from 'node:path';
import { confidenceV2Task,confidenceV2Contract,confidenceV2References,confidenceMeaningProbes,assessConfidenceV2Technical } from '../../src/eval/code-confidence-v2.js';
const args=process.argv.slice(2);
if(!args.length || args.includes('--help')){console.log('Prepare NEW confidence task and run author technical controls. --out=/absolute/new/directory');process.exit(0);}
if(args.length!==1 || !args[0].startsWith('--out=') || !isAbsolute(args[0].slice(6)))throw Error('INVALID_ARGUMENTS');
const out=args[0].slice(6);mkdirSync(out,{mode:0o700});
const controls=[];
for(const [name,source] of Object.entries(confidenceV2References)) {
  const result=assessConfidenceV2Technical(source);
  controls.push({name,expectedTechnicalScore:name==='broken'?4/24:1,result,
    ok:result.technical.valid && result.technical.score===(name==='broken'?4/24:1) && result.score===null});
}
const data={status:'AUTHOR_TECHNICAL_CONTROLS_ONLY',decisionAuthority:false,inference:false,
  oracleAccepted:false,semanticExtractorAccepted:false,freshHoldout:false,
  task:confidenceV2Task,contract:confidenceV2Contract,controls,
  semanticAcceptance:{status:'INDEPENDENT_UNUSED_RESPONSES_REQUIRED',
    input:'Extractor sees detail text alone, without expected degree, API, count or model identity.',
    output:'ASSERTED + nízká/střední/vysoká, MISSING, UNRESOLVED, or CONTRADICTORY; each assertion with verbatim evidence.',
    comparison:'Only after extraction: compare text degree, exact confidence enum and discriminating.',
    developmentProbes:confidenceMeaningProbes,
    limitation:'Author labels exposed here are developmental controls, never independent blind acceptance.'}};
writeFileSync(join(out,'review.json'),JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
writeFileSync(join(out,'task.json'),JSON.stringify(confidenceV2Task,null,2)+'\n',{flag:'wx',mode:0o600});
writeFileSync(join(out,'PRIVATE-references.json'),JSON.stringify(confidenceV2References,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({status:data.status,controlsPass:controls.every(c=>c.ok),out}));
if(controls.some(c=>!c.ok))process.exitCode=1;
