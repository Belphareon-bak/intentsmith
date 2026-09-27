#!/usr/bin/env node
// Read-only review of the completed, operator-authorized rehearsal. The native
// Studio renderer is embedded, with all mutations disabled and data from the
// isolated production read model. Never opens a live database or a network.
import { readFileSync,writeFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--out')throw Error('Usage: --out /existing/rehearsal/root');
const root=resolve(args[1]);
const sources={};
const read=path=>{const bytes=readFileSync(path);sources[path]=createHash('sha256').update(bytes).digest('hex');return JSON.parse(bytes);};
const chat=read(join(root,'reviewed-chat','simulation.json'));
const life=read(join(root,'lifecycle','simulation.json'));
if(chat.simulation!==true||life.simulation!==true||!chat.checks.every(c=>c.passed)||!life.checks.every(c=>c.passed))throw Error('SIMULATION_FAILED');
const views={chat:read(join(root,'reviewed-chat','CHAT-read-model-SIMULATED.json')),lifecycle:{roles:{}}};
for(const role of life.roles)views.lifecycle.roles[role.role]=read(join(root,'lifecycle',role.role+'-read-model.json')).roles[role.role];
const details={};
for(const [i,m] of chat.models.entries())details[m.finalRunId]=read(join(root,'reviewed-chat',`model-${i}-detail-SIMULATED.json`));
const sourcePath=fileURLToPath(new URL('../../intentsmith-ide/extensions/intentsmith-chat-panel/lib/browser/chat-panel-module.js',import.meta.url));
const source=readFileSync(sourcePath,'utf8');sources[sourcePath]=createHash('sha256').update(source).digest('hex');
const renderer=source.slice(source.indexOf("var _evaluationRoleFilter='all'"),source.indexOf('function _renderEvaluationHistory()'));
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const json=x=>JSON.stringify(x).replaceAll('<','\\u003c');
const pct=x=>x.toFixed(2)+' %';
const decisions=chat.models.flatMap((m,i)=>read(join(root,'reviewed-chat',`model-${i}-adjudication-SIMULATED.json`)).decisions
  .map(d=>({model:m.model,...d})));
const doc=`<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>GPU hunt — celý průchod k revizi</title>
<style>body{background:#121922;color:#e4edf5;font:16px system-ui;margin:28px;line-height:1.5}a{color:#8dcaff}h1,h2{color:#ecc16b}button,select{font:inherit;padding:7px;background:#243448;color:#edf4fa;border:1px solid #698299;border-radius:5px;cursor:pointer}button:disabled{opacity:.5;cursor:default}table{border-collapse:collapse}td,th{border:1px solid #456;padding:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer}details{padding:8px}.notice{padding:18px;background:#3b2c17;border-left:5px solid #efba51}nav{display:flex;gap:20px;flex-wrap:wrap}.scroll{overflow:auto}#native{font-size:14px;padding:16px;border:1px solid #456}</style>
<h1>GPU hunt: celý simulační průchod k revizi</h1>
<p class="notice"><strong>SIMULACE DOKONČENA. Produkční rozhodovací autorita nevznikla.</strong><br>
Souhlasy a druhý posudek byly podle tvého zadání simulované Codexem. Nejsou vydávané za skutečný Opusův či tvůj posudek.
Modely se nemazaly, živé role se neměnily. Čtyři noví kandidáti i jejich stažení jsou v této zkoušce fiktivní.</p>
<nav><a href="#outcomes">Výsledek</a><a href="#native-title">Studio: test → odpověď → známka</a><a href="#decisions">Rozsouzení</a><a href="lifecycle/simulation.json">Celý deník</a><a href="reviewed-chat/simulation.json">Původ CHAT známek</a></nav>
<h2 id="outcomes">Co prošlo až do konce</h2>
<ol><li>Čtrnáct fiktivních modelů, sedm rolí: ${life.matrix.length} buněk, ${life.matrix.filter(x=>x.status==='N/A').length} z nich N/A. Čtyři kandidáti přibyli simulovaným discovery/pull průchodem.</li>
<li>Sběr → dva oddělené posudky → spor → simulované rozsouzení → uložení výsledku → čtení ve Studiu. CHAT nově zpracovává všechny tahy, setinové známky a váhy 40/30/20/10.</li>
<li>Přijaté syntetické provozní páry → sestava bez vlastní revize → virtuální aktivace → rollback při selhání → ověřené opětovné čtení po otevření DB → odvolání přejímek. Celkem ${life.checks.length} kontrol životního cyklu.</li>
<li>Samostatně všech 80 skutečných nových rozhovorů z 27. 9. se zachovanými SHA a prvním posudkem; ${chat.checks.length} kontrol. Zde jsou druhý posudek a rozhodnutí modelované, odpovědi skutečné.</li></ol>
<h2>Skutečné nové odpovědi, různé vrstvy posouzení</h2>
<table><tr><th>Model / CHAT</th><th>Skutečný první posudek</th><th>Simulovaný druhý</th><th>Po simulovaném rozsouzení</th></tr>
${chat.models.map(m=>`<tr><td>${esc(m.model)}<br>40 dialogů / 20 CS–EN skupin</td><td>${pct(m.actualFirstPercent)}</td><td>${pct(m.simulatedSecondPercent)}</td><td>${pct(m.simulatedAdjudicatedPercent)}</td></tr>`).join('')}</table>
<p>Druhý posudek přebírá 313 kritérií z prvního a u sedmi zkouší konkrétní alternativní výklad.
Shoda těchto dvou souborů neměří nezávislost. Změnou oproti prvnímu posudku je odstranění jedné srážky za opravený mezivýpočet.
Výsledek této skutečné dvojice: <b>NEROZHODNUTO / PONECHAT</b>; rozdíl nepřekračuje návrhový přínos CHAT 4 p. b. a chybí nový provozní holdout.
Na rozdíl od ní jsou čísla ostatních modelů v simulační matici výhradně fiktivní.</p>
<h2 id="native-title">Skutečný renderer Studia nad izolovanou DB</h2>
<p>Vyber datovou vrstvu, model a podrobnosti. U nového CHATu otevři „Celý rozhovor“: jsou zachované všechny uživatelské i modelové tahy.
Toto je přenosná zkouška skutečného rendereru, nikoli nasazená aplikace. Akce měnící modely jsou vypnuté.</p>
<p><button id="chat-view">Nový CHAT + simulované rozsouzení</button> <button id="life-view">14 fiktivních modelů × 7 rolí</button></p>
<div id="native"></div>
<h2 id="decisions">Sedm rozhodnutí k jedné souhrnné revizi</h2>
<p>Jde o moje odůvodněné simulační volby. Můžeš měnit závěry, aniž by se přepsaly původní odpovědi nebo známky.</p>
${decisions.map(d=>`<details><summary>${esc(d.model)} · ${esc(d.task)}</summary>${d.parts.map(p=>`<p><b>Kritérium ${p.criterion}: ${pct(p.score*100)}</b><br>${esc(p.reason)}<br><i>${esc(p.evidence)}</i></p>`).join('')}</details>`).join('')}
<h2>Výsledek fiktivního výběru celé sestavy</h2><pre>${esc(JSON.stringify(life.portfolio.proposed.bindings,null,2))}</pre>
<p>Každá role má jiný fiktivní model. Úspěšná virtuální aktivace ani tato sestava nejsou doporučením přepnout reálné modely.
Po ukončení byly všechny simulační provozní přejímky odvolány. Zákaz mazání je zachovaný ve všech větvích.</p>
<h2>Co při celkové revizi rozlišovat</h2><ul>
<li><b>Implementované a vyzkoušené:</b> úplný přepis pro hodnotitele i rozhodčího, váhy, dvě známky, rozsouzení, DB, zobrazení, identita a zachování důkazů.</li>
<li><b>Simulované:</b> druhý posudek nového CHATu, souhlasy, místní soudci, jejich přejímka, provozní úlohy, čtyři nové modely, přepnutí/rollback.</li>
<li><b>Dosud reálně nedoložené:</b> celá srovnatelná desetimodelová matice všech rolí, přejímka dvojice lokálních hodnotitelů, úplné CODE orákulum, nový nezávislý provozní holdout a fyzický deploy/rollback.</li></ul>
<p>Starší přehled skutečných D/R, CODE a VISION: <a href="../hunt-completion-review-20260927-v2/REVIEW.html#real">oddělená historická evidence</a>.
Nový CHAT: <a href="../hunt-chat-context-fixed-20260927-v2/operator-review/comparison-graded.html">nezměněný první posudek a všechny odpovědi</a>.
Otisky vstupů této stránky: <a href="review-sources.json">review-sources.json</a>.</p>
<script>
const views=${json(views)}, savedDetails=${json(details)};
var C={accent:'#edbd64',tx1:'#e4edf5',tx3:'#b0bdca',bg1:'#141d28',bg2:'#1d2937',border:'#456',success:'#73d5a2',warning:'#e5bb64',amber:'#e5bb64',accentBg:'#31291c'};
var _evaluationData=views.chat,_evaluationModelFilter='',_evaluationView='matrix',_modelTestPending=true;
function h(tag,props,...children){const el=document.createElement(tag);for(const [k,v] of Object.entries(props||{})){if(k==='key'||v==null)continue;if(k==='style'){Object.assign(el.style,Object.fromEntries(Object.entries(v).map(([a,b])=>[a,typeof b==='number'&&!['fontWeight','opacity','zIndex','flexGrow','flexShrink','lineHeight'].includes(a)?b+'px':b])));}else if(k.startsWith('on')&&typeof v==='function')el.addEventListener(k.slice(2).toLowerCase(),v);else if(k==='disabled')el.disabled=v;else if(k==='value')el.value=v;else el.setAttribute(k,v);}for(const child of children.flat(Infinity)){if(child==null||child===false)continue;el.append(child instanceof Node?child:document.createTextNode(String(child)));}if(props&&props.value!=null)el.value=props.value;return el;}
function _fs(n){return n+'px'}function _rgba(){return '#456'}function _modelButtonStyle(){return {padding:7,margin:3}}
function _modelFieldStyle(){return {padding:7}}function _modelTestFeedback(){return null}function _canonicalModelIdentity(x){return x}
function _huntDuration(ms){return ms==null?'—':Math.round(ms/1000)+' s'}
function _loadHistoricalRun(id){if(!savedDetails[id])throw Error('No offline detail '+id);_historyDetails[id]=savedDetails[id];renderCenter()}
function renderCenter(){document.querySelector('#native').replaceChildren(_renderEvaluationsTab())}
${renderer}
_historyDetails=Object.assign({},savedDetails);
document.querySelector('#chat-view').onclick=()=>{_evaluationData=views.chat;_evaluationRoleFilter='all';_evaluationModelFilter='';_evaluationView='matrix';_qualityExpanded={};renderCenter()};
document.querySelector('#life-view').onclick=()=>{_evaluationData=views.lifecycle;_evaluationRoleFilter='all';_evaluationModelFilter='';_evaluationView='matrix';_qualityExpanded={};renderCenter()};
renderCenter();
</script></html>`;
writeFileSync(join(root,'REVIEW.html'),doc,{flag:'wx'});
writeFileSync(join(root,'review-sources.json'),JSON.stringify({simulation:true,sources},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:'REVIEW_CREATED',path:join(root,'REVIEW.html'),sources:Object.keys(sources).length}));
