#!/usr/bin/env node
// Read-only checks of an assembled local review packet; no model inference.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer';

const dir=path.resolve(process.argv[2]||'/mnt/vi7000/intentsmith/evidence/hunt-chat-panel-20260923/assessment-20260924');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const hash=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const a=read(path.join(dir,'assessment.json')),receipt=read(path.join(dir,'build-receipt.json'));
const source=read(path.join(dir,'../review-full-05/review.json'));
const rows=new Map(source.items.map(i=>[i.id,i]));
const checks=[];
function check(name,fn){try{fn();checks.push({name,pass:true});}catch(e){checks.push({name,pass:false,error:e.message});}}
check('Source export bytes unchanged',()=>assert.equal(hash(path.join(dir,'../review-full-05/review.json')),a.sourceReviewByteSha256));
check('All generated artifacts match receipt',()=>{for(const [name,sha]of Object.entries(receipt.artifacts))assert.equal(hash(path.join(dir,name)),sha,name);});
check('All original exports remain ungraded',()=>{assert.equal(rows.size,1200);for(const i of rows.values()){assert.equal(i.score,null);assert.deepEqual(i.criterionGrades,[]);}});
check('Each criterion maps to original rubric with nonempty reason',()=>{for(const g of a.grades){const item=rows.get(g.id);assert.equal(item.captureStatus,'CAPTURED');assert.equal(g.transcriptSha256,item.conversation.transcriptSha256);assert.deepEqual(g.criteria.map(c=>c.id),item.criteria.map(c=>c.id));for(const c of g.criteria)assert(c.reason.trim());}});
check('Null never changes the candidate denominator',()=>{for(const g of a.grades){if(g.criteria.some(c=>c.score===null)){assert.equal(g.score,null);continue;}const score=g.criteria.reduce((n,c)=>n+c.score*a.weightsDraft[c.axis],0);assert(Math.abs(g.score-score)<1e-6);}});
check('No partial or ungraded item receives a score',()=>{for(const e of a.exceptions){assert(!a.grades.some(g=>g.id===e.id));assert.equal(e.score,null);}const represented=new Set(a.grades.map(g=>g.id));assert.equal(source.items.filter(i=>i.captureStatus==='CAPTURED'&&!represented.has(i.id)).length,a.coverage.ungradedCaptured);});
check('Blind packet source, grades and identities remain separate',()=>{const blind=read(path.join(dir,'second-review/review.json'));assert.equal(blind.items.length,30);for(const i of blind.items){assert.deepEqual(i,rows.get(i.id));assert(!i.identity&&!i.grade);}assert(!fs.existsSync(path.join(dir,'second-review/PRIVATE-identity-key.json')));});

const errors=[];
let browser;
try{
 browser=await puppeteer.launch({headless:true,args:['--no-sandbox'],protocolTimeout:60000});
 const page=await browser.newPage();await page.setViewport({width:1600,height:1000});page.on('pageerror',e=>errors.push(e.message));
 const ui=async(name,fn)=>{try{assert(await page.evaluate(fn));checks.push({name,pass:true});}catch(e){checks.push({name,pass:false,error:e.message});}};
 await page.goto(pathToFileURL(path.join(dir,'comparison-graded.html')).href,{waitUntil:'load'});
 await ui('Explicit partial coverage',()=>document.querySelector('#coverage').textContent.includes('120 / 1200')&&document.querySelector('#coverage').textContent.includes('1076'));
 await ui('Ten models, same first repeat',()=>document.querySelectorAll('.card').length===10&&[...document.querySelectorAll('.card .meta')].every(e=>e.textContent.includes('Opakování 1')));
 await ui('Forty criterion reasons actually visible',()=>document.querySelectorAll('.criterion').length===40&&[...document.querySelectorAll('.criterion')].every(e=>e.querySelector('p.text')?.textContent.length>25));
 await ui('All three assistant turns preserved per card',()=>document.querySelectorAll('.card .turn').length===30);
 await page.screenshot({path:path.join(dir,'comparison-graded.png'),fullPage:false});
 await page.select('#task','en_quoted_injection');await page.select('#model','qwen3-coder:latest');
 await ui('Dispute is not averaged over remaining axes',()=>document.querySelectorAll('.card').length===1&&document.querySelector('.card .score').textContent.startsWith('Nerozhodnuto')&&document.querySelectorAll('.criterion .score')[0].textContent.includes('Nerozhodnuto'));
 await page.select('#task','en_strict_json');await page.select('#model','phi4:14b');
 await ui('JSON content, envelope and runtime parse separate',()=>document.querySelectorAll('.card').length===3&&[...document.querySelectorAll('.card')].every(e=>e.textContent.includes('Obsah 1,000 · striktní formát 0,000 · produkční parse ANO')));
 await page.select('#task','cs_corrected_project');await page.select('#model','');await page.click('#graded-only');
 await ui('All thirty attempts reachable by pagination',()=>document.querySelector('#pagination').textContent.includes('Strana 1 / 3')&&document.querySelector('#shown').textContent.includes('30 odpovědí'));
 await page.select('#task','cs_incompatible_constraints');await page.select('#model','gemma4:26b');
 await ui('Interrupted output is not content zero',()=>document.querySelectorAll('.card').length===3&&[...document.querySelectorAll('.card')].some(e=>e.textContent.includes('Přerušený sběr — obsah nehodnocen'))&&![...document.querySelectorAll('.card')].some(e=>e.textContent.includes('Návrh známky: 0,000')));
 await page.select('#task','cs_budget_tradeoff');
 await ui('Three genuinely unassessed cards stay unassessed',()=>document.querySelectorAll('.card').length===3&&[...document.querySelectorAll('.card')].every(e=>e.querySelector('.score').textContent==='Zatím nehodnoceno'));
 await page.click('#matrix summary');
 await ui('All forty tasks by ten models in matrix',()=>document.querySelectorAll('#matrix-table tbody tr').length===40&&document.querySelectorAll('#matrix-table tbody td').length===440);
 await page.click('#matrix-table tbody tr:first-child td:nth-child(2) button');
 await ui('Matrix cell selects task and model',()=>document.querySelector('#model').value==='devstral-small-2:latest'&&document.querySelector('#task').value==='cs_ambiguous_handoff'&&!document.querySelector('#graded-only').checked);
 await page.goto(pathToFileURL(path.join(dir,'comparison-graded.html')).href+'#task=cs_corrected_project&model=qwen3.8%3Alatest&repeat=1',{waitUntil:'load'});
 await ui('Report deep link opens exact model and attempt',()=>document.querySelectorAll('.card').length===1&&document.querySelector('.card h2').textContent==='qwen3.8:latest'&&document.querySelector('.card .score').textContent.includes('1,000'));
 await page.goto(pathToFileURL(path.join(dir,'second-review/review.html')).href,{waitUntil:'load'});
 await ui('Blind form contains no model metadata or first grades',()=>{const p=JSON.parse(document.querySelector('#payload').textContent);return p.items.length===30&&!p.identified&&p.items.every(i=>!i.identity&&i.score===null&&!i.criterionGrades.length);});
 await ui('Blind form has actual empty grading fields',()=>document.querySelectorAll('input[type=number]').length>0&&[...document.querySelectorAll('input[type=number]')].every(e=>e.value===''));
 check('No browser script errors',()=>assert.deepEqual(errors,[]));
}catch(e){checks.push({name:'Browser run',pass:false,error:e.stack});}
finally{if(browser)await browser.close();}
const result={status:checks.every(c=>c.pass)?'PASS':'FAIL',checkedAt:new Date().toISOString(),
 assessmentSha256:hash(path.join(dir,'assessment.json')),checks,errors,
 scope:'Evidence integrity and rendered review UX. Not acceptance of semantic grades or of a local judge.'};
fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
if(result.status!=='PASS')process.exitCode=1;
