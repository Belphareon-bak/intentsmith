#!/usr/bin/env node
// Read-only browser checks of the final local review document.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const out=process.argv[2];if(!path.isAbsolute(out||''))throw Error('Absolute review directory required');
const authorized=process.argv[3]==='--authorized';
const input=JSON.parse(fs.readFileSync(path.join(out,authorized?'reviewed-chat/simulation.json':'adjudication-proposal.json')));
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox'],protocolTimeout:60000,
 ...(process.env.PUPPETEER_EXECUTABLE_PATH?{executablePath:process.env.PUPPETEER_EXECUTABLE_PATH}:{})});
const checks=[];const check=(name,value)=>{checks.push({name,passed:!!value});assert.ok(value,name);};
try {
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1500,height:950});await page.goto(pathToFileURL(path.join(out,'REVIEW.html')).href);
 if(authorized){
  check('Simulation and simulated approvals are explicit',await page.$eval('.notice',x=>x.textContent.includes('SIMULACE DOKONČENA')&&x.textContent.includes('simulované Codexem')));
  check('Native CHAT renderer loaded',await page.$$eval('#native section',x=>x.length===1));
  check('Both real model names visible',await page.$eval('#native',el=>el.textContent.includes('qwen3.8')&&el.textContent.includes('qwen3.5')));
  const model=input.models[0];
  await page.click('[title="Podrobný rozpad a nový test: '+model.model+'"]');
  check('Native detail opened',await page.$eval('#native [data-testid="model-task-detail"]',()=>true));
  check('All forty whole dialogues available',await page.$$eval('#native [data-testid="graded-conversation"]',x=>x.length===40));
  check('Both prior reviews and weights shown',await page.$eval('#native',x=>x.textContent.includes('Oba uložené posudky')&&x.textContent.includes('40 % / 30 % / 20 % / 10 %')));
  check('Simulated arbitration and actual collection date preserved',await page.$eval('#native',x=>x.textContent.includes('SIMULOVANÉ rozsouzení kritérií')&&!x.textContent.includes('(čas nezaznamenán)')));
  const actual=await page.$$eval('#native [data-testid="graded-conversation-message"] pre',x=>x.map(e=>e.textContent));
  const detail=JSON.parse(fs.readFileSync(path.join(out,'reviewed-chat','model-0-detail-SIMULATED.json')));
  const expected=detail.tasks.flatMap(t=>t.details.flatMap(d=>d.conversation.transcript.map(x=>x.content)));
  check('Every user/model turn equals stored complete transcript',JSON.stringify(actual)===JSON.stringify(expected));
  check('Arbitration visible in native detail',(await page.$eval('#native',x=>x.textContent)).includes('Rozsouzení kritérií'));
  await page.click('#native [data-testid="graded-conversation"] > summary');
  check('Transcript disclosure opens',await page.$eval('#native [data-testid="graded-conversation"]',x=>x.open));
  check('Mutation buttons disabled',await page.$$eval('#native button',xs=>xs.filter(x=>['Nový test','Otestovat vše'].includes(x.textContent)).every(x=>x.disabled)));
  await page.click('#life-view');
  check('Seven native role sections',await page.$$eval('#native section',x=>x.length===7));
  check('Four new fictional candidates included',await page.$eval('#native',x=>['11','12','13','14'].every(n=>x.textContent.includes('sim-model-'+n))));
  check('No browser errors',errors.length===0);
  await page.click('#chat-view');await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:path.join(out,'review.png'),fullPage:false});
  fs.writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify({simulation:true,checks,errors},null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({checks:checks.length,passed:checks.filter(x=>x.passed).length}));
 } else {
 const values=await page.evaluate(()=>({models:document.querySelectorAll('table')[0].rows.length-1,
  roles:document.querySelectorAll('table')[0].rows[0].cells.length-1,
  fictional:document.querySelectorAll('table')[1].rows.length-1,
  labels:document.body.innerText.includes('REÁLNÉ AUTOMATICKÉ ROZHODOVÁNÍ NO-GO')&&document.body.innerText.includes('66 dialogů'),
  percentage:document.querySelectorAll('table')[0].textContent.includes('%')}));
 check('Ten real models and seven roles',values.models===10&&values.roles===7);
 check('Separate ten-model fictional matrix',values.fictional===10);
 check('NO-GO and invalid CHAT context remain visible',values.labels);
 check('Observed grades shown as percentages',values.percentage);
 const summaries=await page.$$('details > summary');check('Exactly five prioritized criteria',summaries.length===5);
 for(const summary of summaries)await summary.click();
 const content=await page.$$eval('details',rows=>rows.map(row=>({open:row.open,
  question:row.querySelectorAll('pre')[0].textContent,response:row.querySelectorAll('pre')[1].textContent})));
 check('All five disclosures open',content.every(x=>x.open));
 check('Whole questions and answers equal source bytes',content.every((x,i)=>x.question===input.decisions[i].question&&x.response===input.decisions[i].response));
 check('No browser errors',errors.length===0);
 for(const summary of summaries)await summary.click();await page.evaluate(()=>window.scrollTo(0,0));
 await page.screenshot({path:path.join(out,'review.png'),fullPage:false});
 fs.writeFileSync(path.join(out,'browser-checks.json'),JSON.stringify({checks,errors},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({checks:checks.length,passed:checks.filter(x=>x.passed).length}));
 }
}finally{await browser.close();}
