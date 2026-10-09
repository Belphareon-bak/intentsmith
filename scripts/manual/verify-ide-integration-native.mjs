// Opt-in native qualification over an owned backend/DB/profile and controlled
// loopback provider. No production DB, GPU inference or external delivery.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import puppeteer from 'puppeteer';
import {createOwnedJourneyRuntime,startProduct,stopProduct} from '../../tests/helpers/chat-project-expertise-model-journey.js';
const root=process.cwd(),output=path.resolve('.intentsmith-artifacts/ide-integration-20261009/native');
await fs.mkdir(output,{recursive:true,mode:0o700});
const runtime=createOwnedJourneyRuntime({artifacts:output,repositoryRoot:root}),profile=path.join(runtime.root,'electron-profile');
const electronTmp=await fs.mkdtemp('/tmp/is-ide-integration-');
const checks=[],requests=[],pageErrors=[],model='fixture:1b',digest='a'.repeat(64);
let backend,electron,browser,provider,error;
const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const sourceClean=execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()==='';
const bundle=await fs.readFile('intentsmith-ide/applications/electron/lib/frontend/bundle.js');
const check=(name,condition)=>{assert(condition,name);checks.push({name,status:'PASS'});};
try {
 provider=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);res.setHeader('content-type','application/json');
  if(req.url==='/api/tags')return res.end(JSON.stringify({models:[{name:model,digest,details:{quantization_level:'Q4_K_M'}}]}));
  if(req.url==='/api/show')return res.end(JSON.stringify({model_info:{'fixture.context_length':4096}}));
  if(req.url!=='/api/chat')return res.writeHead(503).end('{}');
  const body=JSON.parse(Buffer.concat(chunks)),classifier=body.messages?.some(m=>m.role==='system'&&m.content.includes('Klasifikuj'));
  res.end(JSON.stringify({model,model_digest_sha256:digest,done:true,done_reason:'stop',message:{role:'assistant',content:classifier?JSON.stringify({intent:'CONVERSATIONAL',confidence:.99,requestedOperation:'none'}):'Ověřená odpověď řízeného poskytovatele.'},eval_count:8,prompt_eval_count:40}));
 });await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
 backend=await startProduct(runtime,`http://127.0.0.1:${provider.address().port}`,model,{enableAgents:true});
 const log=await fs.open(path.join(output,'electron.log'),'w',0o600);
 const env={...process.env,INTENTSMITH_PORT_FILE:runtime.portFile,INTENTSMITH_STUDIO2_PREVIEW:'1',TMPDIR:electronTmp};delete env.ELECTRON_RUN_AS_NODE;
 electron=spawn(process.execPath,['intentsmith-ide/applications/electron/scripts/launch.js','--no-sandbox','--disable-gpu','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile],{cwd:root,env,detached:true,stdio:['ignore',log.fd,log.fd]});
 const debugFile=path.join(profile,'DevToolsActivePort');let debugPort;
 for(let i=0;i<120;i++){try{debugPort=Number((await fs.readFile(debugFile,'utf8')).split('\n')[0]);if(debugPort)break;}catch{}if(electron.exitCode!==null)throw Error('Owned Electron exited before CDP');await new Promise(r=>setTimeout(r,500));}
 assert(debugPort,'CDP port');browser=await puppeteer.connect({browserURL:'http://127.0.0.1:'+debugPort});
 let page;for(let i=0;i<90;i++){page=(await browser.pages()).find(p=>p.url().includes('/lib/frontend/index.html'));if(page)break;await new Promise(r=>setTimeout(r,500));}assert(page,'own native frontend');
 page.on('pageerror',e=>pageErrors.push(e.message));page.on('response',r=>{const u=new URL(r.url());if(u.port===String(backend.port)&&u.pathname.startsWith('/api/'))requests.push({method:r.request().method(),path:u.pathname,status:r.status()});});
 await page.waitForFunction(()=>document.body.innerText.includes('Nastavení')&&document.body.innerText.includes('Konverzace'),{timeout:90000});
 const bridge=await page.evaluate(()=>({backendUrl:window.electronIntentSmith?.getBackendUrl(),hasCapability:!!window.electronIntentSmith?.getLocalCapability()}));check('native preload uses owned backend capability',bridge.backendUrl==='http://127.0.0.1:'+backend.port&&bridge.hasCapability);
 async function clickText(text){const clicked=await page.evaluate(text=>{const node=[...document.querySelectorAll('button,[role="button"],a,.nav-item,.pitem')].find(n=>n.getBoundingClientRect().width>0&&n.innerText.trim()===text);if(!node)return false;node.click();return true;},text);assert(clicked,'visible control '+text);await new Promise(r=>setTimeout(r,400));}
 async function screenshot(name){await page.screenshot({path:path.join(output,name+'.png')});}
 await clickText('Nastavení');await clickText('Úložiště');
 await page.waitForFunction(()=>document.body.innerText.includes('Cesta není známá')||document.body.innerText.includes('Cesta modelů není známá'),{timeout:15000});check('native inventory renders UNKNOWN provider path',true);await screenshot('storage');
 await clickText('Nastavení');await clickText('Modely a inference');
 await page.waitForFunction(()=>document.body.innerText.includes('Požadované parametry rolí'),{timeout:15000});
 const edited=await page.evaluate(()=>{const row=[...document.querySelectorAll('tr')].find(n=>n.querySelector('th')?.innerText==='CHAT');const button=row?.querySelector('button');if(!button)return false;button.click();return true;});check('native CHAT role editor available',edited);
 await page.waitForFunction(()=>document.body.innerText.includes('Minimum kontextu pro CHAT: 4096'),{timeout:15000});check('native role minimum is visible',true);await screenshot('role');
 await clickText('Nastavení');await clickText('Git a repozitáře');await clickText('+ SSH profil');
 await page.waitForFunction(()=>document.body.innerText.includes('Soukromý klíč')||document.body.innerText.includes('Identity file')||document.body.innerText.includes('known_hosts'),{timeout:15000});check('native SSH form loads real backend',requests.some(r=>r.path==='/api/scm/profiles'&&r.status===200));await screenshot('ssh');
 await clickText('Workeři');await clickText('Nový worker');
 await page.waitForFunction(()=>document.body.innerText.includes('Vlastní šablona workeru'),{timeout:15000});check('native custom worker/editor controls mounted',true);await screenshot('worker');
 await clickText('Specialisté');await clickText('Nový specialista');
 await page.waitForFunction(()=>document.body.innerText.includes('Doménová pravidla'),{timeout:15000});check('native specialist advanced fields mounted',true);await screenshot('specialist');
 check('no renderer errors in integration navigation',pageErrors.length===0);
} catch(e){error=e;}
finally {
 if(browser)await browser.disconnect();
 if(electron?.pid){try{process.kill(-electron.pid,'SIGTERM');}catch{}await new Promise(r=>setTimeout(r,700));try{process.kill(-electron.pid,0);process.kill(-electron.pid,'SIGKILL');}catch{}}
 if(backend)try{await stopProduct(backend);}catch(e){error||=e;}
 if(provider)await new Promise(resolve=>provider.close(resolve));
 await fs.rm(electronTmp,{recursive:true,force:true});
 const result={scope:'NATIVE_OWNED_BACKEND_CONTROLLED_PROVIDER_NO_GPU_NO_RELEASE_ACCEPTANCE',sourceRevision,sourceClean,bundleSha256:createHash('sha256').update(bundle).digest('hex'),node:process.version,status:error?'FAIL':'PASS',checks,requests,pageErrors,error:error?.message||null};
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({status:result.status,checks:checks.length,error:result.error,artifact:path.join(output,'result.json')}));
}
if(error)throw error;
