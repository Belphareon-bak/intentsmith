// Opt-in native qualification over an owned backend/DB/profile and controlled
// loopback provider. No production DB, GPU inference or external delivery.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import puppeteer from 'puppeteer';
import {createOwnedJourneyRuntime,expectJson,startProduct,stopProduct} from '../../tests/helpers/chat-project-expertise-model-journey.js';
const root=process.cwd(),output=path.resolve('.intentsmith-artifacts/ide-integration-20261009/native-final');
await fs.mkdir(output,{recursive:true,mode:0o700});
const runtime=createOwnedJourneyRuntime({artifacts:output,repositoryRoot:root}),profile=path.join(runtime.root,'electron-profile');
const electronTmp=await fs.mkdtemp('/tmp/is-ide-integration-');
const checks=[],requests=[],pageErrors=[],model='fixture:1b',digest='a'.repeat(64);
let backend,electron,browser,provider,error;
const launchBackend=()=>startProduct(runtime,`http://127.0.0.1:${provider.address().port}`,model,{enableAgents:true});
const written={};
const specialistName='native-ide-'+Date.now().toString(36),specialistPath=path.join(root,'specialists',specialistName);let ownsSpecialist=false;
const sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const sourceClean=execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()==='';
const bundle=await fs.readFile('intentsmith-ide/applications/electron/lib/frontend/bundle.js');
const check=(name,condition)=>{assert(condition,name);checks.push({name,status:'PASS'});};
try {
 assert.equal(await fs.realpath(path.join(root,'specialists')),path.join(root,'specialists'));
 assert.equal(await fs.stat(specialistPath).then(()=>true,()=>false),false,'native qualification name must not exist');
 provider=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);res.setHeader('content-type','application/json');
  if(req.url==='/api/tags')return res.end(JSON.stringify({models:[{name:model,digest,details:{quantization_level:'Q4_K_M'}}]}));
  if(req.url==='/api/show')return res.end(JSON.stringify({model_info:{'fixture.context_length':16384}}));
  if(req.url!=='/api/chat')return res.writeHead(503).end('{}');
  const body=JSON.parse(Buffer.concat(chunks)),classifier=body.messages?.some(m=>m.role==='system'&&m.content.includes('Klasifikuj'));
  res.end(JSON.stringify({model,model_digest_sha256:digest,done:true,done_reason:'stop',message:{role:'assistant',content:classifier?JSON.stringify({intent:'CONVERSATIONAL',confidence:.99,requestedOperation:'none'}):'Ověřená odpověď řízeného poskytovatele.'},eval_count:8,prompt_eval_count:40}));
 });await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
 backend=await launchBackend();
 const fixtureProject=await expectJson(backend,'POST','/api/projects',{name:'Native owned project',type:'general'},201);
 let page;
 async function openEditor(){
 const log=await fs.open(path.join(output,'electron.log'),'a',0o600);
 const env={...process.env,INTENTSMITH_PORT_FILE:runtime.portFile,INTENTSMITH_STUDIO2_PREVIEW:'1',TMPDIR:electronTmp};delete env.ELECTRON_RUN_AS_NODE;
 electron=spawn(path.join(root,'intentsmith-ide/applications/electron/dist/IntentSmith-0.1.0.AppImage'),['--appimage-extract-and-run','--no-sandbox','--disable-gpu','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile],{cwd:root,env,detached:true,stdio:['ignore',log.fd,log.fd]});
 const debugFile=path.join(profile,'DevToolsActivePort');let debugPort;
 for(let i=0;i<120;i++){try{debugPort=Number((await fs.readFile(debugFile,'utf8')).split('\n')[0]);if(debugPort)break;}catch{}if(electron.exitCode!==null)throw Error('Owned Electron exited before CDP');await new Promise(r=>setTimeout(r,500));}
 assert(debugPort,'CDP port');browser=await puppeteer.connect({browserURL:'http://127.0.0.1:'+debugPort});
 for(let i=0;i<90;i++){page=(await browser.pages()).find(p=>p.url().includes('/lib/frontend/index.html'));if(page)break;await new Promise(r=>setTimeout(r,500));}assert(page,'own native frontend');
 await page.setViewport({width:1440,height:900});
 page.on('pageerror',e=>pageErrors.push(e.message));page.on('response',r=>{const u=new URL(r.url());if(u.port===String(backend.port)&&u.pathname.startsWith('/api/'))requests.push({sourcePort:u.port,method:r.request().method(),path:u.pathname,status:r.status()});});
 await page.waitForFunction(()=>!document.querySelector('.theia-preload'),{timeout:90000});
 await page.waitForFunction(()=>document.body.innerText.includes('Nastavení')&&document.body.innerText.includes('Workeři'),{timeout:90000});
 const bridge=await page.evaluate(()=>({backendUrl:window.electronIntentSmith?.getBackendUrl(),hasCapability:!!window.electronIntentSmith?.getLocalCapability()}));check('native preload uses owned backend capability',bridge.backendUrl==='http://127.0.0.1:'+backend.port&&bridge.hasCapability);
 await log.close();
 }
 await openEditor();
 async function clickText(text){const handle=await page.evaluateHandle(text=>{const nodes=[...document.querySelectorAll('button,[role="button"],a')];const matches=n=>n.getBoundingClientRect().width>0&&(n.innerText.trim()===text||n.getAttribute('aria-label')===text||n.querySelector('.tile-n')?.innerText===text||n.querySelector('.cell')?.innerText===text);return (text==='Nastavení'?nodes.find(n=>n.closest('.settings-crumb')&&matches(n)):null)||nodes.find(matches)||null;},text);const node=handle.asElement();assert(node,'visible control '+text);await node.click();await handle.dispose();await new Promise(r=>setTimeout(r,400));}
 async function editField(label,value){
  const handle=await page.evaluateHandle(label=>[...document.querySelectorAll('label')].find(n=>n.getBoundingClientRect().width>0&&(n.querySelector('span')?.innerText.trim()===label||n.childNodes[0]?.textContent.trim()===label))?.querySelector('input,textarea,select')||null,label);
  const node=handle.asElement();assert(node,'visible field '+label);
  if(await node.evaluate(n=>n.tagName==='SELECT'))await node.select(String(value));
  else {await node.click({clickCount:3});await node.press('Backspace');await node.type(String(value));await node.press('Tab');}
  await handle.dispose();
 }
 async function clickSummary(text){const handle=await page.evaluateHandle(text=>[...document.querySelectorAll('summary')].find(n=>n.innerText.trim()===text),text);const node=handle.asElement();assert(node,'summary '+text);await node.click();await handle.dispose();}
 async function screenshot(name){await page.screenshot({path:path.join(output,name+'.png')});}
 await clickText('Nastavení');await clickText('Úložiště');
 await page.waitForFunction(()=>document.body.innerText.includes('Cesta není známá')||document.body.innerText.includes('Cesta modelů není známá'),{timeout:15000});check('native inventory renders UNKNOWN provider path',true);await screenshot('storage');
 await clickText('Nastavení');await clickText('Modely a inference');await clickText('Role');
 await page.waitForFunction(()=>document.body.innerText.includes('Požadované parametry rolí'),{timeout:15000});
 const editHandle=await page.evaluateHandle(()=>[...document.querySelectorAll('tr')].find(n=>n.querySelector('th')?.innerText==='CHAT')?.querySelector('button'));const edit=editHandle.asElement();check('native CHAT role editor available',!!edit);await edit.click();await editHandle.dispose();
 await page.waitForFunction(()=>document.body.innerText.includes('Minimum kontextu pro CHAT: 8192'),{timeout:15000});check('native role minimum is visible',true);await page.evaluate(()=>document.querySelector('.mw-editor')?.scrollIntoView({block:'start'}));await editField('Požadovaný kontext v tokenech','8192');await editField('Požadovaný výstup v tokenech','64');await clickText('Uložit a ověřit parametry role');
 await page.waitForFunction(()=>!document.querySelector('.mw-editor'),{timeout:15000});
 const savedRole=(await expectJson(backend,'GET','/api/system/models/role-settings',null,200)).roles.find(r=>r.role==='CHAT');check('native role save reaches actual backend and exact readback',savedRole.settings.contextWindowTokens===8192&&savedRole.settings.maxOutputTokens===64);written.role=savedRole.settings;await screenshot('role');
 await clickText('Nastavení');await clickText('Paměť');
 const memoryHandle=await page.evaluateHandle(()=>[...document.querySelectorAll('label')].find(n=>n.querySelector('span')?.innerText==='Dlouhodobá paměť')?.querySelector('input[type="checkbox"]'));const memoryToggle=memoryHandle.asElement();assert(memoryToggle);await memoryToggle.click();await memoryHandle.dispose();await clickText('Uložit změny');
 await page.waitForFunction(()=>document.body.innerText.includes('Změny byly ověřeny v backendu.'),{timeout:15000});
 const savedMemory=await expectJson(backend,'GET','/api/settings',null,200);check('native memory switch writes false with actual HTTP readback',savedMemory['intentsmith.memory.ltmEnabled']===false);written.memory=false;
 const disabledCount=await page.evaluate(()=>[...document.querySelectorAll('[aria-label="Uživatelské nastavení"] input')].filter(n=>n.disabled).length);check('native inactive memory settings are read only',disabledCount>=3);await screenshot('memory');
 await clickText('Nastavení');await clickText('Git a repozitáře');await clickText('+ SSH profil');
 await page.waitForFunction(()=>document.body.innerText.includes('Soukromý klíč')||document.body.innerText.includes('Identity file')||document.body.innerText.includes('known_hosts'),{timeout:15000});check('native SSH form loads real backend',requests.some(r=>r.path==='/api/scm/profiles'&&r.status===200));await screenshot('ssh');
 await clickText('Workeři');await clickText('Nový worker');
 await page.waitForFunction(()=>document.body.innerText.includes('Vytvořit vlastní šablonu workeru'),{timeout:15000});await clickSummary('Vytvořit vlastní šablonu workeru');
 for(const width of [1366,1920]){await page.setViewport({width,height:900});check('native form fits '+width+' px',await page.evaluate(()=>[...document.querySelectorAll('[aria-label="Průvodce workerem"] label')].every(n=>n.scrollWidth<=n.clientWidth+1)));await screenshot('worker-'+width);}await page.setViewport({width:1440,height:900});
 await editField('Název šablony','Nativní kontrola');await editField('Hledané signály v projektu','TODO FIXME');await clickText('Uložit a vybrat šablonu');
 await page.waitForFunction(()=>document.body.innerText.includes('Šablona uložena a ověřena.'),{timeout:15000});
 await editField('Projekt',String(fixtureProject.project.id));await editField('ID instance','native-owned-worker');await clickText('Pokračovat na kontrolu');await clickText('Ověřit konfiguraci bez spuštění');
 await page.waitForFunction(()=>document.body.innerText.includes('Konfigurace je platná.'),{timeout:15000});await clickText('Potvrdit instanci');
 await page.waitForFunction(()=>document.body.innerText.includes('Nativní kontrola')&&!document.querySelector('[aria-label="Průvodce workerem"]'),{timeout:15000});
 const savedWorker=await expectJson(backend,'GET','/api/agent-extensions/instances/native-owned-worker/config',null,200);check('native friendly worker form saves a verified disabled custom instance',savedWorker.enabled===false&&savedWorker.definition.sources[0].config.query==='TODO FIXME');written.worker=savedWorker.definitionDigest;
 await clickText('Upravit');await page.waitForFunction(()=>document.body.innerText.includes('Uložit konfiguraci'),{timeout:15000});await editField('Název','Nativní upravená kontrola');await clickText('Pokračovat na kontrolu');await clickText('Ověřit konfiguraci bez spuštění');await page.waitForFunction(()=>document.body.innerText.includes('Konfigurace je platná.'),{timeout:15000});await clickText('Uložit konfiguraci');
 const updatedWorker=await expectJson(backend,'GET','/api/agent-extensions/instances/native-owned-worker/config',null,200);check('native worker detail edit verifies configuration and retains disabled state',updatedWorker.name==='Nativní upravená kontrola'&&updatedWorker.enabled===false);await screenshot('worker');
 await clickText('Specialisté');await clickText('Nový specialista');
 await page.waitForFunction(()=>document.body.innerText.includes('Doménová pravidla'),{timeout:15000});check('native specialist advanced fields mounted',true);
 await editField('Název',specialistName);await editField('Popis','Vlastněná nativní kontrola průvodce.');await editField('Systémový prompt','Odpovídej stručně a nevymýšlej provedené kroky.');await editField('Doménová pravidla (jedno na řádek)','Vyžaduj doložený zdroj.');await editField('Omezení (jedno na řádek)','Bez ověřených výsledků nehlaš úspěch.');await clickText('Pokračovat na kontrolu');ownsSpecialist=true;await clickText('Potvrdit vytvoření');
 await page.waitForFunction(name=>document.body.innerText.includes(name)&&!document.querySelector('[aria-label="Průvodce specialistou"]'),{timeout:20000},specialistName);
 const savedSpecialist=await expectJson(backend,'GET','/api/specialists/'+specialistName,null,200);const specialistModule=await fs.readFile(path.join(specialistPath,'index.js'),'utf8');
 check('native specialist saves advanced fields and actual package readback',savedSpecialist.id===specialistName&&specialistModule.includes('Odpovídej stručně a nevymýšlej provedené kroky.')&&specialistModule.includes('Vyžaduj doložený zdroj.')&&specialistModule.includes('Bez ověřených výsledků nehlaš úspěch.'));written.specialist=specialistName;await screenshot('specialist');
 await clickText('Nastavení');await clickText('Účet');
 await clickText('+ Přidat propojení');await editField('Název','Native disabled Telegram');await editField('Proměnná s přihlašovacím údajem','INTENTSMITH_TELEGRAM_NATIVE_FIXTURE');await editField('Příjemce / kanál','123456');await clickText('Uložit změny');
 await page.waitForFunction(()=>!document.querySelector('.im-editor'),{timeout:15000});
 const account=(await expectJson(backend,'GET','/api/accounts',null,200)).accounts.find(a=>a.name==='Native disabled Telegram');check('native account form saves metadata without a token or delivery',account&&account.enabled===false&&account.credentialConfigured===false);written.account=account.id;await screenshot('account');
 await browser.disconnect();browser=null;
 process.kill(-electron.pid,'SIGTERM');await new Promise(r=>setTimeout(r,700));try{process.kill(-electron.pid,0);process.kill(-electron.pid,'SIGKILL');}catch{}electron=null;
 await fs.rm(path.join(profile,'DevToolsActivePort'),{force:true});
 await stopProduct(backend);backend=null;backend=await launchBackend();
 const roleAfterRestart=(await expectJson(backend,'GET','/api/system/models/role-settings',null,200)).roles.find(r=>r.role==='CHAT');
 check('native writes persist across actual backend restart',JSON.stringify(roleAfterRestart.settings)===JSON.stringify(written.role)
  &&(await expectJson(backend,'GET','/api/settings',null,200))['intentsmith.memory.ltmEnabled']===false
  &&(await expectJson(backend,'GET','/api/agent-extensions/instances/native-owned-worker/config',null,200)).name==='Nativní upravená kontrola'
  &&(await expectJson(backend,'GET','/api/accounts',null,200)).accounts.some(a=>a.id===written.account&&a.enabled===false));
 await openEditor();await clickText('Nastavení');await clickText('Modely a inference');await clickText('Role');
 await page.waitForFunction(()=>[...document.querySelectorAll('tr')].some(n=>n.querySelector('th')?.innerText==='CHAT'&&n.innerText.includes('8192')&&n.innerText.includes('64')),{timeout:15000});check('fresh native renderer reads saved role after backend restart',true);
 await clickText('Nastavení');await clickText('Paměť');
 const memoryAfterRestart=await page.evaluate(()=>[...document.querySelectorAll('label')].find(n=>n.querySelector('span')?.innerText==='Dlouhodobá paměť')?.querySelector('input')?.checked);
 check('fresh native renderer reads saved memory after restart',memoryAfterRestart===false);await clickText('Specialisté');await page.waitForFunction(name=>document.body.innerText.includes(name),{timeout:15000},specialistName);check('fresh native renderer reads created specialist after restart',(await expectJson(backend,'GET','/api/specialists/'+specialistName,null,200)).id===specialistName);await screenshot('restart');
 check('new worker wizard does not request a nonexistent instance' ,!requests.some(r=>r.path==='/api/agents/__new__'));
 check('no renderer errors in integration navigation',pageErrors.length===0);
} catch(e){error=e;}
finally {
 if(browser)await browser.disconnect();
 if(electron?.pid){try{process.kill(-electron.pid,'SIGTERM');}catch{}await new Promise(r=>setTimeout(r,700));try{process.kill(-electron.pid,0);process.kill(-electron.pid,'SIGKILL');}catch{}}
 if(backend)try{await stopProduct(backend);}catch(e){error||=e;}
 if(provider)await new Promise(resolve=>provider.close(resolve));
 await fs.rm(electronTmp,{recursive:true,force:true});
 if(ownsSpecialist)await fs.rm(specialistPath,{recursive:true,force:true});
 const result={probeSha256:createHash('sha256').update(await fs.readFile(new URL(import.meta.url))).digest('hex'),scope:'PACKAGED_NATIVE_OWNED_BACKEND_CONTROLLED_PROVIDER_NO_GPU_NO_RELEASE_ACCEPTANCE',sourceRevision,sourceClean,appimage:{path:path.join(root,'intentsmith-ide/applications/electron/dist/IntentSmith-0.1.0.AppImage'),sha256:createHash('sha256').update(await fs.readFile(path.join(root,'intentsmith-ide/applications/electron/dist/IntentSmith-0.1.0.AppImage'))).digest('hex')},bundleSha256:createHash('sha256').update(bundle).digest('hex'),node:process.version,written,status:error?'FAIL':'PASS',checks,requests,pageErrors,error:error?.message||null};
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({status:result.status,checks:checks.length,error:result.error,artifact:path.join(output,'result.json')}));
}
if(error)throw error;
