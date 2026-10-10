import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import puppeteer from 'puppeteer';
import {createOwnedJourneyRuntime,startProduct,stopProduct,requestJson} from '../../tests/helpers/chat-project-expertise-model-journey.js';
const root=process.cwd(),out=path.join(path.dirname(new URL(import.meta.url).pathname),'native-mouse-decoration');await fs.mkdir(out,{recursive:true});
const runtime=createOwnedJourneyRuntime({artifacts:out,repositoryRoot:root}),tmp=await fs.mkdtemp('/tmp/is-v4-new-'),profile=path.join(tmp,'profile');
const appimage=path.join(root,'intentsmith-ide/applications/electron/dist/IntentSmith-0.1.0.AppImage');
let backend,child,browser,error,log,page;const errors=[],calls=[],screens=[],checks=[],focus=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function descendants(pid){const procs=[];for(const n of await fs.readdir('/proc'))if(/^\d+$/.test(n))try{const s=await fs.readFile('/proc/'+n+'/status','utf8');procs.push({pid:Number(n),ppid:Number(s.match(/^PPid:\s+(\d+)/m)[1])});}catch{}const set=new Set([pid]);let change=true;while(change){change=false;for(const p of procs)if(set.has(p.ppid)&&!set.has(p.pid)){set.add(p.pid);change=true;}}return [...set];}
async function click(text,index=0){const h=await page.evaluateHandle(({text,index})=>{const all=[...document.querySelectorAll('button,a')].filter(n=>n.getBoundingClientRect().width>0);return (text==='Nastavení'?all.find(n=>n.closest('.settings-crumb')&&n.innerText.trim()===text):null)||all.filter(n=>n.innerText.trim()===text)[index]||all.filter(n=>n.getAttribute('aria-label')===text||n.querySelector('.cell')?.innerText===text||n.querySelector('.tile-n')?.innerText===text)[index]||null;},{text,index});assert(h.asElement(),'button '+text);await h.asElement().click();await h.dispose();await delay(500);}
async function field(label,value){const h=await page.evaluateHandle(label=>[...document.querySelectorAll('label')].find(n=>n.innerText.trim().startsWith(label)&&n.querySelector('input,textarea'))?.querySelector('input,textarea'),label);assert(h.asElement(),'field '+label);await h.asElement().click();await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await h.asElement().type(value);await h.dispose();}
async function shot(name,width){if(['hunt','catalog','hunt-settings','hunt-history'].includes(name)){const decoration=await page.$eval('.mw-hunt-tabs .dtab.on',n=>getComputedStyle(n).boxShadow);assert.match(decoration,/inset/);assert.match(decoration,/-2px/);}const text=await page.evaluate(()=>document.body.innerText);await page.screenshot({path:path.join(out,name+'-'+width+'.png')});await fs.writeFile(path.join(out,name+'-'+width+'.txt'),text);screens.push({name,width,innerWidth:await page.evaluate(()=>innerWidth)});const overflow=await page.evaluate(()=>{const n=document.querySelector('.ide');return n?{width:n.clientWidth,scroll:n.scrollWidth}:null;});assert(!overflow||overflow.scroll<=overflow.width+1,name+' outer overflow '+JSON.stringify(overflow));}
try{
 backend=await startProduct(runtime,'http://127.0.0.1:11434','qwen3.8:latest');
 log=await fs.open(path.join(out,'native.log'),'w',0o600);const env={...process.env,INTENTSMITH_PORT_FILE:runtime.portFile,INTENTSMITH_STUDIO2_PREVIEW:'1',TMPDIR:tmp};delete env.ELECTRON_RUN_AS_NODE;
 child=spawn(appimage,['--appimage-extract-and-run','--no-sandbox','--disable-gpu','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile],{cwd:root,env,detached:true,stdio:['ignore',log.fd,log.fd]});
 let port;for(let n=0;n<120;n++){try{port=Number((await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break;}catch{}assert(child.exitCode===null);await delay(500);}assert(port);
 browser=await puppeteer.connect({browserURL:'http://127.0.0.1:'+port,defaultViewport:null});for(let n=0;n<90;n++){page=(await browser.pages()).find(p=>p.url().includes('/lib/frontend/index.html'));if(page)break;await delay(500);}assert(page);
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes(':'+backend.port+'/api/'))calls.push({method:r.method(),path:new URL(r.url()).pathname});});
 await page.waitForFunction(()=>!document.querySelector('.theia-preload')&&document.body.innerText.includes('Workeři'),{timeout:90000});
 for(const width of [1920,1366]){
  await page.setViewport({width,height:width===1920?1080:850});await delay(500);
  await click('Nastavení');await page.waitForFunction(()=>document.body.innerText.includes('Všechna nastavení'),{timeout:20000});await shot('settings',width);
  for(const [label,name]of [['Účet a propojení','account'],['Oznámení','notifications'],['Úložiště','storage'],['Zálohy','backups'],['Repozitáře a přístupy','git']]){await click(label);await shot(name,width);await click('Nastavení');}
  await click('Modely a inference');await shot('overview',width);if(width===1920)assert.match(await page.$eval('.model-summary',n=>n.innerText),/Nastaveno ·[\s\S]*Ověřený strop HW ·/);
  for(const [label,name]of [['Role','roles'],['Modely','inventory'],['Evaluace','matrix'],['GPU Hunt','hunt'],['Katalog','catalog'],['Nastavení Huntu a Challenge','hunt-settings'],['Historie','hunt-history'],['Telemetrie','telemetry'],['Provoz','operations']]){await click(label);await shot(name,width);}
  const f=await page.evaluate(()=>{const n=document.activeElement,s=getComputedStyle(n);return{classes:n.className,outline:s.outline,focusVisible:n.matches(':focus-visible')};});assert.equal(f.focusVisible,false);assert.equal(f.outline.includes('0px')||f.outline.includes('none'),true);focus.push({width,mouse:f});
  await page.keyboard.press('Tab');const keyboard=await page.evaluate(()=>{const n=document.activeElement,s=getComputedStyle(n);return{classes:n.className,outline:s.outline,focusVisible:n.matches(':focus-visible'),accent:getComputedStyle(document.querySelector('.ide')).getPropertyValue('--acc').trim()};});assert.equal(keyboard.focusVisible,true);assert.match(keyboard.outline,/2px/);focus.at(-1).keyboard=keyboard;
  await click('GPU Hunt');await click('Nastavení Huntu a Challenge');await click('Nový profil',1);await shot('challenge-draft',width);assert.equal(await page.evaluate(()=>document.querySelector('.mw-editor select')?.value),'challenge');await click('Zavřít editor');
  await click('Nastavení');
 }
 await click('Účet a propojení');await click('Upravit profil');await field('Zobrazované jméno','Kontrola V4');await field('E-mail','překlep');
 await click('Uložit změny');assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.im-field')].find(n=>n.innerText.startsWith('Zobrazované jméno'))?.querySelector('input')?.value),'Kontrola V4');assert.equal(calls.filter(c=>c.method==='PUT'&&c.path==='/api/accounts/profile').length,0);checks.push('invalid form retains draft without effect');
 await field('E-mail','review@example.invalid');await click('Uložit změny');await page.waitForFunction(()=>document.body.innerText.includes('Kontrola V4')&&!document.body.innerText.includes('Upravit lokální profil'),{timeout:15000});
 const saved=await requestJson(backend,'GET','/api/accounts');assert.equal(saved.data.profile.displayName,'Kontrola V4');assert.equal(saved.data.profile.revision,1);assert.equal(calls.filter(c=>c.method==='PUT'&&c.path==='/api/accounts/profile').length,1);checks.push('profile UI write exactly once and API readback');await shot('profile-saved',1366);
 await click('Nastavení');await click('Modely a inference');await click('Modely');const inventory=await requestJson(backend,'GET','/api/system/models');assert.ok(inventory.data.models.length>0);await click(inventory.data.models[0].name);await shot('model-detail',1366);assert.equal(await page.evaluate(()=>!!document.querySelector('[aria-label="Detail lokálního modelu"]')),true);checks.push('real Ollama inventory and inline model detail');
 await click('Zavřít detail modelu');await click('Provoz');await click('Upravit',0);assert.match(await page.$eval('.mw-editor',n=>n.innerText),/Ověřený strop HW: dosud neověřeno/);await shot('context-editor',1366);await click('Zavřít editor');checks.push('role editor and sidebar distinguish requested context from unverified HW');await click('GPU Hunt');await click('Nastavení Huntu a Challenge');await click('Nový profil',0);await field('Název','Kontrola profilu Huntu');await click('Uložit a ověřit revizi');
 await page.waitForFunction(()=>document.body.innerText.includes('Profil uložen a ověřen v revizi 1'),{timeout:15000});await click('Zavřít editor');
 await click('Seznam');assert.equal(await page.evaluate(()=>document.querySelector('.mw-profile-list')?.classList.contains('mw-profile-tiles')),false);await shot('profiles-list',1366);
 await click('Dlaždice');assert.equal(await page.evaluate(()=>document.querySelector('.mw-profile-list')?.classList.contains('mw-profile-tiles')),true);await shot('profiles-tiles',1366);
 const profiles=await requestJson(backend,'GET','/api/system/models/hunt/profiles');assert.equal(profiles.data.profiles.length,1);assert.equal(profiles.data.profiles[0].enabled,false);assert.equal(profiles.data.profiles[0].schedule.type,'manual');
 checks.push('native saved disabled Hunt profile and global list/tile controls; no run queued');
 assert.deepEqual(errors,[]);
}catch(e){error=e;}finally{
 const owned=child?.pid?await descendants(child.pid):[];if(browser)await browser.disconnect();if(child?.pid){try{process.kill(-child.pid,'SIGTERM');}catch{}}await delay(700);
 for(const pid of owned)try{process.kill(pid,'SIGTERM');}catch{}await delay(700);for(const pid of owned)try{process.kill(pid,'SIGKILL');}catch{}
 if(backend)try{await stopProduct(backend);}catch(e){error||=e;}if(log)await log.close();await fs.rm(tmp,{recursive:true,force:true});
 await fs.writeFile(path.join(out,'receipt.json'),JSON.stringify({status:error?'FAIL':'PASS',sourceRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),appimageSha256:createHash('sha256').update(await fs.readFile(appimage)).digest('hex'),scope:'owned fresh DB, real Ollama metadata only, no GPU inference/outbound delivery; production bindings unchanged',screens,checks,focus,errors,calls,error:error?.stack},null,2));
}if(error)throw error;console.log(JSON.stringify({status:'PASS',screens:screens.length,checks,focus}));
