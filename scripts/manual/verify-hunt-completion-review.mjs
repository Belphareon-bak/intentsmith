#!/usr/bin/env node
// Read-only browser checks of the final local review document.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const out=process.argv[2];if(!path.isAbsolute(out||''))throw Error('Absolute review directory required');
const input=JSON.parse(fs.readFileSync(path.join(out,'adjudication-proposal.json')));
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox'],protocolTimeout:60000});
const checks=[];const check=(name,value)=>{checks.push({name,passed:!!value});assert.ok(value,name);};
try {
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1500,height:950});await page.goto(pathToFileURL(path.join(out,'REVIEW.html')).href);
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
}finally{await browser.close();}
