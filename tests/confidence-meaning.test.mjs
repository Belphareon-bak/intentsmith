import test from 'node:test';
import assert from 'node:assert/strict';
import {parseConfidenceExtraction as parse,observeConfidenceMeaning as observe,compareConfidenceSources as compare} from '../src/eval/confidence-meaning.js';
const artifact={modelName:'judge',digestSha256:'a'.repeat(64),providerVersion:'v'};
const answerArtifact={digestSha256:'b'.repeat(64)};
const text='Jistota není nízká; je vysoká.';
const parsed={status:'ASSERTED',level:'vysoká',evidence:[text],reason:'The low degree is explicitly negated.'};
const reply=value=>({content:JSON.stringify(value),done:true,doneReason:'stop',...artifact});

test('extractor sees only text, uses two enum orders, and never receives expected fields',async()=>{
 const inputs=[];const r=await observe({text,artifact,answerArtifact,call:async(_,m,o)=>{inputs.push({m,o});return reply(parsed);}});
 assert.equal(r.readingsConsistent,true);assert.equal(inputs.length,2);
 for(const {m} of inputs){assert.deepEqual(JSON.parse(m[1].content),{detail:text});assert(!JSON.stringify(m).includes(artifact.modelName));}
 assert.notDeepEqual(inputs[0].o.format.properties.level.enum,inputs[1].o.format.properties.level.enum);
 assert.equal(r.score,null);assert.equal(r.independentAcceptance,false);
 assert.deepEqual(compare({discriminating:1,confidence:'nízká (jediná úloha)'},r).textMatches,false);
});
test('malformed judgement, absent quote and contradictory schema are not valid extraction',()=>{
 for(const p of [{...parsed,evidence:['made up quote']},{...parsed,status:'CONTRADICTORY'},{...parsed,evidence:[]},{...parsed,extra:true}])assert.equal(parse(JSON.stringify(p),text),null);
 assert(parse(JSON.stringify({...parsed,status:'CONTRADICTORY',level:null}),text));
 assert(parse(JSON.stringify({status:'MISSING',level:null,evidence:[],reason:'No degree given.'}),'No evidence.'));
});
test('order-dependent meaning stays unresolved even when each receipt is well formed',async()=>{
 let n=0;const r=await observe({text,artifact,answerArtifact,call:async()=>reply({...parsed,level:n++?'nízká':'vysoká'})});
 assert.equal(r.readingsConsistent,false);assert.equal(r.reason,'ORDER_UNSTABLE');assert.equal(compare({discriminating:1},r).textMatches,null);
});
test('self judging is refused before provider dispatch',async()=>{
 await assert.rejects(observe({text,artifact,answerArtifact:artifact,call:()=>assert.fail('called')}),/SELF_GRADING/);
});
test('invalid identity and truncated judge output do not create content grades',async()=>{
 for(const edit of [{digestSha256:'c'.repeat(64)},{doneReason:'length'},{error:'offline'}]){
  const r=await observe({text,artifact,answerArtifact,call:async()=>({...reply(parsed),...edit})});
  assert.equal(r.readingsConsistent,false);assert.equal(r.score,null);
 }
});
test('quote validation alone cannot qualify a semantically wrong extractor',async()=>{
 const wrong=await observe({text,artifact,answerArtifact,call:async()=>reply({...parsed,level:'nízká'})});
 assert.equal(wrong.readingsConsistent,true); // Schema consistency is not semantic acceptance.
 assert.equal(compare({discriminating:1,confidence:'nízká (jediná úloha)'},wrong).textMatches,true);
 assert.equal(wrong.independentAcceptance,false);assert.equal(wrong.score,null);assert.equal(wrong.decisionAuthority,false);
});
