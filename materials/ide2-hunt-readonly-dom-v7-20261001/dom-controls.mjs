// Controlled XMLDOM structure/geometry fixtures, never a browser/layout proof.
// Execute the exact old/new clickText functions and shared browser snapshots.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {CONFIG,ROOT,save,fileSha} from './common.mjs';
import {interactiveTargetSnapshot,settingsCatalogSnapshot,SETTINGS_BUTTON_SELECTOR} from './dom-target.mjs';
process.umask(0o077);
assert.equal(process.argv[2],'--cpu-dom-controls');
const out=path.resolve(process.argv[3]);assert.equal(path.dirname(out),path.dirname(ROOT));assert.equal(fs.existsSync(out),false);fs.mkdirSync(out,{mode:0o700});
const require=createRequire(path.join(CONFIG.stage,'intentsmith-ide/package.json'));
const {DOMParser}=require('@xmldom/xmldom');
const dependencyManifest=require.resolve('@xmldom/xmldom/package.json');
function fixture(markup) {
  const doc=new DOMParser().parseFromString(markup,'text/xml');
  assert.equal(doc.getElementsByTagName('parsererror').length,0);
  const all=[...Array.from(doc.getElementsByTagName('*'))];
  const descendants=n=>all.filter(e=>{for(let a=e.parentNode;a;a=a.parentNode)if(a===n)return true;return false;});
  const simple=(n,t)=>{
    const tag=/^[a-zA-Z][\w-]*/.exec(t)?.[0];if(tag&&n.tagName.toLowerCase()!==tag.toLowerCase())return false;
    const id=/#([\w-]+)/.exec(t)?.[1];if(id&&n.getAttribute('id')!==id)return false;
    for(const match of t.matchAll(/\.([\w-]+)/g))if(!(n.getAttribute('class')||'').split(/\s+/).includes(match[1]))return false;
    for(const match of t.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g))if(!n.hasAttribute(match[1])||(match[2]!==undefined&&n.getAttribute(match[1])!==match[2]))return false;
    return true;
  };
  const tokens=s=>s.match(/(?:[^\s\[]|\[[^\]]*\])+/g)||[];
  const matches=(n,s)=>{const parts=tokens(s);if(!simple(n,parts.pop()))return false;let a=n.parentNode;while(parts.length){const term=parts.pop();while(a?.nodeType===1&&!simple(a,term))a=a.parentNode;if(a?.nodeType!==1)return false;a=a.parentNode;}return true;};
  const query=(n,s)=>{const selectors=s.split(',').map(x=>x.trim());return (n===doc?all:descendants(n)).filter(e=>selectors.some(s=>matches(e,s)));};
  for(const n of all){
    n.querySelectorAll=s=>query(n,s);n.querySelector=s=>query(n,s)[0]||null;
    n.contains=other=>{for(let a=other;a;a=a.parentNode)if(a===n)return true;return false;};
    Object.defineProperty(n,'id',{get:()=>n.getAttribute('id')});Object.defineProperty(n,'parentElement',{get:()=>n.parentNode?.nodeType===1?n.parentNode:null});
    n.classList={contains:key=>(n.getAttribute('class')||'').split(/\s+/).includes(key)};
    n.getBoundingClientRect=()=>{const [left,top,width,height]=(n.getAttribute('data-rect')||'0,0,0,0').split(',').map(Number);return{left,top,width,height,right:left+width,bottom:top+height};};
  }
  doc.querySelectorAll=s=>query(doc,s);doc.querySelector=s=>query(doc,s)[0]||null;
  doc.elementFromPoint=(x,y)=>all.filter(n=>{if(!n.parentNode)return false;const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&x>=r.left&&x<r.right&&y>=r.top&&y<r.bottom;})
    .map((node,index)=>({node,index,layer:Number(node.getAttribute('data-layer')||0)})).sort((a,b)=>a.layer-b.layer||a.index-b.index).at(-1)?.node||null;
  const context={document:doc,innerWidth:1600,innerHeight:1000,getComputedStyle:n=>({display:n.getAttribute('data-display')||'block',visibility:n.getAttribute('data-visibility')||'visible',opacity:n.getAttribute('data-opacity')||'1'})};
  return {doc,context,run:(fn,args)=>vm.runInNewContext('('+fn.toString()+')(args)',{...context,args},{timeout:1000})};
}
const full='<div class="nav-b"><div class="nrow"><button class="nbtn" id="settings" data-rect="10,900,200,40" data-layer="1"><span data-rect="10,900,200,40" data-layer="2">Nastavení</span></button></div></div>';
const container=fixture('<div id="intentsmith-studio2"><div class="rail" id="wrong-container" data-rect="0,0,240,960">'+full+'</div></div>');
const oldPacket=path.join(path.dirname(ROOT),'ide2-hunt-readonly-dom-34cfc198-v3-20261001-1650');
const oldSource=fs.readFileSync(path.join(oldPacket,'probe.mjs'),'utf8');
const oldFunction=oldSource.slice(oldSource.indexOf('async function clickText('),oldSource.indexOf('\nasync function tab('));
const newSource=fs.readFileSync(path.join(ROOT,'probe.mjs'),'utf8');
const newFunction=newSource.slice(newSource.indexOf('let clickSequence = 0;'),newSource.indexOf('\nasync function tab('));
async function executeClick(f,source,selector,control={}){
 const clicks=[],receipts=[],screenshots=[];let clock=0;
 const FixtureDate=class extends Date {static now(){return clock;}};
 const page={waitForFunction:async(fn,_options,args)=>{assert.equal(f.run(fn,args),true,'fixture visible target');},evaluate:async(fn,args)=>f.run(fn,args),
  screenshot:async options=>screenshots.push(path.basename(options.path)),
  $$:async(s)=>f.doc.querySelectorAll(s).map(n=>({evaluate:async(fn,args)=>vm.runInNewContext('('+fn.toString()+')(node,args)',{...f.context,node:n,args},{timeout:1000}),
    click:async()=>clicks.push({tag:n.tagName.toUpperCase(),id:n.id,legacyHandleClick:true}),scrollIntoView:async()=>{},dispose:async()=>{}})),
  mouse:{click:async(x,y)=>{const hit=f.doc.elementFromPoint(x,y);let n=hit;while(n&&n.tagName?.toUpperCase()!=='BUTTON')n=n.parentElement;clicks.push({tag:n?.tagName.toUpperCase(),id:n?.id,point:{x,y},hit:hit?.tagName.toUpperCase(),actualPointerAPI:true});}}};
 const context={page,Date:FixtureDate,path,checkAbort(){},interactiveTargetSnapshot,assert,out,
  save:(_out,name,data)=>receipts.push({name,data:JSON.parse(JSON.stringify(data))}),
  delay:async ms=>{clock+=ms;if(control.clearAfterMs!==undefined&&clock>=control.clearAfterMs){
    const overlay=f.doc.querySelector('#curtain');if(overlay)overlay.parentNode.removeChild(overlay);
  }}};
 let error=null;
 try {await vm.runInNewContext(source+'\nclickText(selector,"Nastavení");',{...context,selector},{timeout:1000});}
 catch(e){error={name:e.name,message:e.message};if(!control.expectError)throw e;}
 return{clicks,receipts,screenshots,elapsedMs:clock,error};
}

const oldClick=await executeClick(container,oldFunction,'#intentsmith-studio2 .nav-b .nbtn, #intentsmith-studio2 .rail');
assert.equal(oldClick.clicks[0].tag,'DIV');assert.equal(oldClick.clicks[0].id,'wrong-container');
const newClick=await executeClick(container,newFunction,SETTINGS_BUTTON_SELECTOR);assert.equal(newClick.clicks[0].tag,'BUTTON');assert.equal(newClick.clicks[0].id,'settings');assert.equal(newClick.receipts.find(x=>x.name==='DOM-CLICK-1-before.json').data.status,'READY');
const cases=[{case:'actualoldfunction-selects-container/newfunction-pointer-selects-button',status:'PASS',oldClick,newClick}];
const variants=[
 ['rail-public-button','<nav class="railw"><button class="rail" aria-label="Nastavení" id="rail-setting" data-rect="0,900,90,50">Nastavení</button></nav>','READY'],
 ['overlay',full+'<div id="curtain" data-rect="10,900,200,40" data-layer="9">overlay</div>','HIT_BLOCKED'],
 ['disabled',full.replace('id="settings"','id="settings" disabled="disabled"'),'NO_ELIGIBLE_BUTTON'],
 ['ambiguous-two-visible-buttons',full+'<nav class="railw"><button class="rail" aria-label="Nastavení" data-rect="300,800,90,50">Nastavení</button></nav>','AMBIGUOUS'],
 ['offscreen',full.replace(/10,900,200,40/g,'10,1200,200,40'),'OFFSCREEN'],
 ['hidden',full.replace('id="settings"','id="settings" data-visibility="hidden"'),'NO_ELIGIBLE_BUTTON']
];
for(const [name,html,expected]of variants){const f=fixture('<div id="intentsmith-studio2">'+html+'</div>');const observed=f.run(interactiveTargetSnapshot,{selector:SETTINGS_BUTTON_SELECTOR,text:'Nastavení'});assert.equal(observed.status,expected,name);cases.push({case:name,status:'PASS',observed});}
const overlayHTML='<div id="intentsmith-studio2">'+full+'<div class="theia-preload" id="curtain" data-rect="10,900,200,40" data-layer="9"></div></div>';
const clears=await executeClick(fixture(overlayHTML),newFunction,SETTINGS_BUTTON_SELECTOR,{clearAfterMs:300});
assert.equal(clears.error,null);assert.equal(clears.elapsedMs,300);assert.equal(clears.clicks.length,1);assert.equal(clears.clicks[0].id,'settings');
assert.equal(clears.receipts.find(x=>x.name==='DOM-CLICK-1-blocked.json').data.hit.classes,'theia-preload');
assert.equal(clears.receipts.findLast(x=>x.name==='DOM-CLICK-1-readiness.json').data.status,'READY');
assert.equal(clears.receipts.find(x=>x.name==='DOM-CLICK-1-before.json').data.status,'READY');
cases.push({case:'actual-function-transient-preload-clears-before-pointer',status:'PASS',observed:clears});
for(const [name,clearAfterMs]of [['permanent-preload',undefined],['preload-clears-exactly-at-deadline',30_000]]){
 const blocked=await executeClick(fixture(overlayHTML),newFunction,SETTINGS_BUTTON_SELECTOR,{clearAfterMs,expectError:true});
 assert.ok(blocked.error?.message.includes('hit-readiness timeout'));assert.equal(blocked.clicks.length,0);assert.equal(blocked.elapsedMs,30_000);
 assert.equal(blocked.receipts.findLast(x=>x.name==='DOM-CLICK-1-readiness.json').data.status,'READINESS_TIMEOUT');
 assert.equal(blocked.receipts.find(x=>x.name==='DOM-CLICK-1-blocked.json').data.status,'HIT_BLOCKED');
 cases.push({case:'actual-function-'+name+'-no-pointer',status:'PASS',observed:{clicks:blocked.clicks,error:blocked.error,elapsedMs:blocked.elapsedMs,
 firstBlocking:blocked.receipts.find(x=>x.name==='DOM-CLICK-1-blocked.json'),finalReadiness:blocked.receipts.findLast(x=>x.name==='DOM-CLICK-1-readiness.json'),screenshots:blocked.screenshots}});
}
const catalog='<section class="ctr"><div class="view"><div class="sect"><div class="cat" data-rect="250,80,700,700"><h1>Nastavení</h1><button class="tile" data-rect="300,150,280,100">Modely a inference</button></div></div></div></section>';
const active=full.replace('class="nrow"','class="nrow on"');
for(const [name,html,ready] of [['settings-after-public-click-ready',active+catalog,true],['sessions-never-ready',full+'<section><div class="view"><div class="cols">Relace</div></div></section>',false],['wrong-catalog-never-ready',active+catalog.replace('<h1>Nastavení','<h1>Projekty'),false]]){
 const f=fixture('<div id="intentsmith-studio2">'+html+'</div>'),observed=f.run(settingsCatalogSnapshot,{});assert.equal(observed.ready,ready,name);cases.push({case:name,status:'PASS',observed});
}
save(out,'CPU-DOM-CONTROLS.json',{status:'PASS',caseCount:cases.length,cases,actualNewClickFunctionSha256:fileSha(path.join(ROOT,'probe.mjs')),
 actualOldClickFunctionSha256:fileSha(path.join(oldPacket,'probe.mjs')),actualSharedTargetSha256:fileSha(path.join(ROOT,'dom-target.mjs')),
 dependency:{name:'@xmldom/xmldom',packageVersion:require('@xmldom/xmldom/package.json').version,packageJsonSha256:fileSha(dependencyManifest)},
 fixtureLimit:'Parsed XMLDOM structure; generic selector subset used bytheseexactselectors, controlled rectangles/styles/hitpaintorder; notChromium rendering/layout/realroute evidence.',
 causeLimit:'V4 actual first target was HIT_BLOCKED by theia-preload and no pointer was sent. V5 waits real hit readiness. V3 timeout cause remains UNKNOWN. Synthetic fixture clearing/deadline do not prove packaged preload lifecycle completion.',
 AppImage:'NOT_RUN',browser:'NOT_RUN',providerRequests:0,DBOpens:0,Nvidia:'NOT_RUN',roleActivation:'PROHIBITED'});
process.stdout.write(JSON.stringify({status:'PASS',caseCount:cases.length,artifactRoot:out})+'\n');
