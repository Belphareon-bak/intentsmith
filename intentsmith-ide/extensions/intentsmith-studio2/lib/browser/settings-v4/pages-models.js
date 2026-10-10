'use strict';

// Kompozice model-v2/hunt-v2 z přijatého V4; jediný datový a efektový klient je ModelWorkspaceRedesign.
// Ukázkové modely, skóre, VRAM ani výsledky návrhu se do této vrstvy nekopírují.
const H = require('./helpers');
const { ROLES } = require('../model-workspace');
const { scoreCell } = require('../model-workspace-redesign');
const { e, icon, tag, kv, num, bytes, date, pl } = H;
const TOP = [['overview','Přehled'],['roles','Role'],['inventory','Modely'],['evaluations','Evaluace'],['hunt','GPU Hunt'],['telemetry','Telemetrie'],['policy','Provoz']];
const HUNT = [['overview','Přehled'],['catalog','Katalog'],['profiles','Nastavení Huntu a Challenge'],['history','Historie']];
const card = (title, html, actions = '', cls = '') => `<section class="card ${cls}"><div class="card-head"><h2>${e(title)}</h2>${actions}</div>${html}</section>`;
const table = (heads, rows, cls = '') => `<div class="table-wrap"><table class="data-table ${cls}"><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const row = cells => `<tr>${cells.map(cell => `<td>${cell}</td>`).join('')}</tr>`;
function button(c, text, fn, { disabled = false, cls = '', confirmation = '', attrs = '' } = {}) {
  const id = 'sv4-model-' + c.modelActions.size;
  c.modelActions.set(id, { fn, confirmation });
  return `<button type="button" class="button ${cls}" data-action="${id}" ${disabled ? 'disabled' : ''} ${attrs}>${e(text)}</button>`;
}
function input(c, id, label, value, fn, attrs = '', hint = '') {
  const action = 'sv4-model-' + c.modelActions.size;
  c.modelActions.set(action, { fn: (_el, ev) => fn(ev) });
  return H.labeled(label, id, `<input id="${e(id)}" value="${e(value)}" data-live data-change="${action}" ${attrs}>`, hint);
}
function select(c, id, label, values, value, fn, hint = '') {
  const action = 'sv4-model-' + c.modelActions.size;
  c.modelActions.set(action, { fn: (_el, ev) => fn(ev) });
  return H.labeled(label, id, H.select(id, values, value, `data-live data-change="${action}"`), hint);
}
function check(c, id, label, value, fn, hint = '') {
  const action = 'sv4-model-' + c.modelActions.size;
  c.modelActions.set(action, { fn: (_el, ev) => fn(ev) });
  return H.check(id, label, value, hint, `data-live data-change="${action}"`);
}
const stateLabel = status => ({MISSING:'Dosud nezměřeno',NOT_MEASURED:'Dosud nezměřeno',AWAITING_REVIEW:'Čeká na posouzení',REVIEW_PENDING_PAIR:'Čeká na druhý posudek',REVIEW_DISPUTED:'Spor hodnotitelů',STALE:'Jiný artefakt / starší sada',FAILED:'Měření selhalo',RUNNING:'Měření běží',COMPLETE:'Dvojí posudek uzavřen',INAPPLICABLE:'Pro roli nepoužitelné'})[status] || status || 'Dosud nezměřeno';
function score(artifact) {
  const cell = scoreCell(artifact);
  return cell.value === null ? `<span class="muted">${e(stateLabel(artifact?.status))}</span>`
    : `<span class="mv2-score-text ${e(cell.cls)}">${e(cell.text)}</span>`;
}
function currentArtifact(c, role) {
  const plans = c.mw.resources.get('roles')?.data?.[1]?.roles || c.mw.resources.get('evaluations')?.data?.[0]?.roles || {};
  return plans[role]?.artifacts?.find(a => a.isCurrentBinding);
}
function readStatus(c) {
  const w = c.mw, failed = [...w.resources.values(), ...w.extra.values()].filter(r => r.status === 'error');
  const relevant = w.resources.get(w.tab), extra = w.extra.get(w.tab);
  const r = relevant?.status === 'error' ? relevant : extra?.status === 'error' ? extra : null;
  return (w.notice ? H.notice(e(w.notice)) : '') + (r ? `<div class="sv4-error" role="alert">${e(r.error)}${button(c,'Obnovit',()=>ensure(c,true))}</div>`
    : !relevant?.data && !extra?.data && !failed.length ? '<div class="sv4-loading" role="status">Načítám data modelů…</div>' : '');
}
function ensure(c, refresh = false) {
  const w = c.mw, tab = c.s.modelTab;
  if (tab === 'hunt') {
    const target = c.s.huntTab === 'catalog' ? 'candidates' : c.s.huntTab === 'history' ? 'history' : 'hunt';
    w.tab = target; w.huntTab = c.s.huntTab;
    w.load(target,refresh); w.load('roles',refresh); w.load('evaluations',refresh);
    w.loadExtra('jobs',refresh); w.loadExtra('profiles',refresh);
    if (c.s.huntTab === 'profiles') w.load('candidates',refresh);
  } else {
    w.tab = tab === 'policy' ? (c.s.operationTab || 'policy') : tab; w.load(w.tab,refresh);
    if (['overview','roles','inventory','evaluations'].includes(tab)) {
      w.load('roles',refresh); w.load('evaluations',refresh); w.loadExtra('settings',refresh); w.loadExtra('inventory',refresh);
    }
  }
  c.load('gpu',refresh); c.load('info',refresh);
}
function go(c, tab, subtab) {
  c.captureDrafts(); c.s.modelTab = tab;
  if (subtab) c.s.huntTab = subtab;
  c.mw.notice = ''; ensure(c); c.scrollReset = true; c.render(true);
}
function aside(c, vm) {
  return `<h2>Aktuální přiřazení</h2><p class="help">${e(vm.summaryStatus)}</p>${vm.summaryRoles.map(r => `<section class="inspector-block"><button type="button" class="link-button" data-action="sv4-model-role" data-role="${r.role}">${e(r.role)}</button><strong class="mono">${e(r.model)}</strong><small>Nastaveno: ${e(r.settingsText)}</small><small>Ověřený strop HW: ${e(r.hardware)}</small><small>Místní skóre: ${score(currentArtifact(c,r.role))}</small></section>`).join('')}`;
}
function overview(c, vm) {
  const w = c.mw, gpu = c.data('gpu'), g = gpu?.profile?.gpus?.[0], settings = w.extraData('settings')?.roles || [];
  const chat = settings.find(r=>r.role==='CHAT'), history = w.resources.get('evaluations')?.data?.[0]?.history || [];
  const artifacts = Object.values(w.resources.get('evaluations')?.data?.[0]?.roles || {}).flatMap(p=>p.artifacts || []);
  const closed = artifacts.filter(a=>scoreCell(a).value!==null), modelCount = new Set(closed.map(a=>a.model)).size;
  const metrics = [['GPU',g ? e(g.gpu_model) : 'Stav GPU není dostupný',g ? (g.vram_mb>0?num(g.vram_mb/1024,1)+' GiB':'VRAM není dostupná')+' · '+(gpu.profile?.inventoryStale?'starší inventura':'inventura backendu') : 'Bez odhadu'],
    ['Kontext CHAT · nastaveno',chat?.settings ? num(chat.settings.contextWindowTokens)+' / '+(chat.settings.maxOutputTokens===null?'výchozí':num(chat.settings.maxOutputTokens))+' tok.' : '—',chat?.verifiedHardwareMaximum ? 'Ověřený strop: '+chat.verifiedHardwareMaximum.contextWindowTokens+' / '+chat.verifiedHardwareMaximum.maxOutputTokens : 'Strop HW dosud neověřen'],
    ['Lokální ověření',pl(modelCount,'model','modely','modelů')+' · '+pl(closed.length,'profil role','profily rolí','profilů rolí'),pl(artifacts.length-closed.length,'artefakt bez uzavřeného skóre','artefakty bez uzavřeného skóre','artefaktů bez uzavřeného skóre')],
    ['Poslední měření',history.length ? date(history[0].testedAt) : 'Záznam chybí',history.length ? history[0].model+' · '+history[0].role+' · '+stateLabel(history[0].status) : 'Měření není nahrazené ukázkou']];
  const strip = `<section class="mv2-status-strip" aria-label="Provozní přehled">${metrics.map(([name,value,note])=>`<div><span>${e(name)}</span><strong>${value}</strong><small>${e(note)}</small></div>`).join('')}</section>`;
  const rows = vm.summaryRoles.map(r=>row([`<button class="link-button" data-action="sv4-model-role" data-role="${r.role}">${r.role} · ${e(r.name)}</button><div class="cell-sub">${e(r.description)}</div>`, `<span class="mono">${e(r.model)}</span>`,score(currentArtifact(c,r.role)),e(r.settingsText),e(r.hardware)]));
  return strip + H.sectionTitle('Používané modely podle rolí',button(c,'Podrobnosti rolí',()=>go(c,'roles'),{cls:'small ghost'}))
    + table(['Role a účel','Primární model','Lokální skóre role','Nastaveno · okno / odpověď','Ověřený strop HW'],rows)
    + `<div class="grid2 section-gap">${card('Lokální výsledky', '<p>Každá role používá vlastní sadu. Chybějící, nevyhodnocený a starší artefakt mají různé stavy; nejsou nulovou známkou.</p>',button(c,'Otevřít evaluace',()=>go(c,'evaluations')))}${card('Dostupné modely a GPU Hunt','<p>Veřejná měření pomáhají vybrat další test. Aktivní roli mění až samostatné přijetí přesného artefaktu.</p>',button(c,'Katalog kandidátů',()=>go(c,'hunt','catalog')))}</div>`;
}
function runtime(c, vm) {
  const r = vm.redesign.roleRuntime;
  if (!r.hasDraft) return '';
  const d = r.draft;
  return card(d.role+' · Kontext a výstup',`<p class="help">${e(r.minimumNote)}</p>${r.sharedWarning ? H.notice(e(r.sharedWarning)) : ''}<p class="mono">${e(d.model)} · ${e(d.digestShort)} · revize ${d.revision}</p><div class="grid2">${input(c,'role-context','Požadované okno (tokeny)',d.contextWindowTokens,d.setContext,`type="number" min="${d.minimumContextWindowTokens}" max="262144" ${d.disabled?'disabled':''}`)}${input(c,'role-output','Maximum odpovědi (tokeny)',d.maxOutputTokens,d.setOutput,`type="number" min="1" max="6000" ${d.disabled?'disabled':''}`,'CHAT omezuje uživatelskou odpověď; interní JSON kroky mají svůj rozpočet.')}</div><div class="setting-footer">${button(c,'Zavřít editor',d.close,{disabled:c.mw.busy})}${button(c,'Uložit nastavení role',d.save,{cls:'primary',disabled:d.disabled})}</div>`,'','section-gap');
}
function changeBinding(c, role) {
  const w=c.mw, vm=w.vm(), names=(w.resources.get('roles')?.data?.[2]?.models || []).map(m=>[m.name,m.name]);
  c.modal('Změnit primární model · '+role,H.labeled('Model','binding-model',H.select('binding-model',names,w.summary().roles.find(r=>r.role===role)?.model))+'<p class="help">Backend vyžaduje přijatý přesný artefakt a nezávislé posudky. Samotné veřejné skóre změnu nepovoluje.</p>', 'Přiřadit model',async form=>{
    w.selectedRole=role; w.selectedModel=new FormData(form).get('binding-model');
    const accepted=await c.confirmThen('Přiřadit '+w.selectedModel+' roli '+role+'? Proběhne skutečná asynchronní změna a ověření modelu.',()=>w.assignRole());
    c.toast(w.notice); return accepted === true;
  });
}
function roles(c, vm) {
  const w=c.mw, role=ROLES.includes(w.selectedRole)?w.selectedRole:'CHAT', current=vm.summaryRoles.find(r=>r.role===role), plan=w.resources.get('roles')?.data?.[1]?.roles?.[role];
  const picker=`<div class="mv2-role-picker">${ROLES.map(r=>button(c,r,()=>{w.selectedRole=r;c.render(true);},{cls:r===role?'primary':'ghost',attrs:`aria-pressed="${r===role}"`})).join('')}</div>`;
  const primary=card(current.role+' · '+current.name,`<p>${e(current.description)}</p>${kv('Primární model',`<strong class="mono">${e(current.model)}</strong>`)}${kv('Lokální skóre této role',score(currentArtifact(c,role)))}${kv('Nastaveno · okno / odpověď',e(current.settingsText))}${kv('Ověřený strop HW',e(current.hardware))}<div class="toolbar">${button(c,'Změnit primární model',()=>changeBinding(c,role),{cls:'primary',disabled:w.busy||w.resources.get('roles')?.status!=='ready'})}${button(c,'Kontext a výstup',()=>w.editRoleRuntime(role),{disabled:w.busy||!w.extraData('settings')?.roles.find(r=>r.role===role&&r.digestSha256)})}</div>`);
  const secondary=card('Zástupné modely','<p class="help">Přepnutí se řídí politikou backendu a přijetím artefaktu. Současné API nespravuje uživatelský seznam záloh po jednotlivých rolích.</p>'+kv('Automatický failover',e(w.resources.get('policy')?.data?.[0]?.policy?.autoFailoverEnabled===true?'Povolen politikou':'Vypnut nebo dosud nenačten'))+button(c,'Provozní pravidla',()=>go(c,'policy')));
  const rows=(plan?.artifacts||[]).map(a=>row([`<strong class="mono">${e(a.model)}</strong><div class="cell-sub mono">${e(a.digestSha256||'Digest chybí')}</div>`,score(a),e(stateLabel(a.status)),`${a.runId?button(c,'Výsledek',()=>w.showRun(a.runId),{cls:'small'}):''}${button(c,'Otestovat',()=>w.evaluateArtifact(role,a.model,a.digestSha256),{cls:'small',disabled:w.busy||!a.digestSha256||a.applicable===false||plan?.measurementReady===false,confirmation:'Spustit místní test '+a.model+' pro '+role+'? Použije GPU a uloží nové výsledky.'})}`]));
  return picker+`<div class="grid2">${primary}${secondary}</div>`+runtime(c,vm)+H.sectionTitle('Modely pro '+role)+table(['Artefakt','Skóre této role','Stav','Akce'],rows)+(!rows.length?H.empty('Zatím žádný artefakt pro tuto roli.'):'');
}
function inventory(c,vm) {
  const w=c.mw, detail=vm.redesign.inventoryDetail, models=detail.rows;
  const item=m=>`<strong class="mono">${e(m.name)}</strong><div class="cell-sub">${e(m.family)} · ${e(m.parameters)} · ${e(m.quant)}</div>`;
  const tags=m=>m.roleTags.map(r=>tag(r.label,r.active?'gold':'')).join(' ')||'<span class="muted">Žádná přiřazená nebo změřená role</span>';
  const content=c.s.layout==='grid'?`<div class="catalog-grid">${models.map(m=>`<article class="catalog-card">${item(m)}<p>${e(m.size)}</p><div>${tags(m)}</div>${button(c,'Detail modelu',m.select)}</article>`).join('')}</div>`
    :table(['Model / artefakt','Kvantizace','Na disku','Role',''],models.map(m=>row([item(m),e(m.quant),e(m.size),tags(m),button(c,'Detail',m.select,{cls:'small'})])));
  const m=detail.hasSelection?detail.selected:models[0];
  const subtab=c.s.inventoryTab||'hardware', tabs=H.tabs([['hardware','Kontext a hardware'],['identity','Identita a umístění'],['results','Ověření rolí']],subtab,'sv4-model-detail-tab');
  const identity=m?`<div class="grid2">${H.meta([['Identita artefaktu',m.digest],['Kvantizace',m.quant],['Rodina',m.family],['Parametry',m.parameters]])}${H.meta([['Poskytovatel','Ollama'],['Na disku',m.size],['Umístění',c.data('info')?.config?.ollama_models || 'Úložiště modelů v nastavení Úložiště']])}</div>`:'';
  const settings=m?table(['Role','Nastaveno · okno / odpověď','Ověřený strop HW'],m.roleSettings.map(r=>row([e(r.role),e(r.requested),e(r.hardware)]))):'';
  const results=m?`<div class="mv2-role-results">${ROLES.map(r=>{const a=w.resources.get('evaluations')?.data?.[0]?.roles?.[r]?.artifacts?.find(a=>a.model===m.name&&a.digestSha256===m.digest.replace(/^sha256:/,''));return `<div>${tag(r)} ${score(a)} ${a?.runId?button(c,'Výsledek',()=>w.showRun(a.runId),{cls:'small'}):''}</div>`;}).join('')}</div>`:'';
  return '<p class="help">Zlatý label označuje skutečně přiřazenou roli. Skóre patří přesnému artefaktu a sadě role.</p>'+content+(m?card(m.name,tabs+(subtab==='identity'?identity:subtab==='results'?results:settings)+'<p class="help">Požadované okno není změřený strop hardware. Chybějící kapacita se neodhaduje.</p>',button(c,'Připravit místní testy',m.prepareTests,{disabled:w.busy}), 'mv2-profile section-gap'):H.empty('Poskytovatel nevrátil žádné modely.'));
}
function evaluations(c,vm) {
  const w=c.mw, matrix=vm.redesign.matrix;
  const heads=['Model / přesný digest',...matrix.headers.map(h=>button(c,h.role+' ↕',h.sort,{cls:'ghost',attrs:`aria-label="Seřadit podle ${h.role}"`}))];
  const rows=matrix.rows.map(m=>row([`<strong class="mono">${e(m.model)}</strong><div class="cell-sub mono">${e(m.digest)}</div>`,...m.cells.map(cell=>{
    const id='sv4-model-'+c.modelActions.size;c.modelActions.set(id,{fn:cell.select});
    return `<button class="mv2-matrix-cell ${e(cell.cls)} ${cell.value===null?'unmeasured':''} ${cell.selected?'active':''}" data-action="${id}" aria-label="${e(m.model+' · '+cell.role+' · '+cell.text+' · '+stateLabel(cell.status))}"><strong>${e(cell.text)}</strong><small>${e(stateLabel(cell.status))}</small></button>`;
  })]));
  return `<div class="mv2-matrix-toolbar"><div><h2>Lokální výsledky podle rolí</h2><p class="help">Každá buňka otevře odpovědi, posudky a provenance skutečného běhu.</p></div><div class="mv2-scale">${['< 50 %','50–69 %','70–79 %','80–89 %','90–100 %'].map((v,i)=>`<span class="mv2-score-text ${['mw-score-low','mw-score-low-middle','mw-score-middle','mw-score-middle-high','mw-score-high'][i]}">${e(v)}</span>`).join('')}</div></div>`+table(heads,rows,'mv2-matrix')+(!rows.length?H.empty('Zatím žádná data evaluací.'):'')+'<p class="help">Pomlčka znamená chybějící uzavřené skóre, nikoli nulu. Veřejný žebříček není místní ověření.</p>'+runDetail(c,vm);
}
function runDetail(c,vm) {
  if (!vm.hasRunDetail) return '';
  if (!vm.runDetailReady) return card('Výsledek měření',vm.runDetailError?`<p role="alert">${e(vm.runDetailError)}</p>`:'<p role="status">Načítám odpovědi a posudky…</p>',button(c,'Zavřít',()=>c.mw.closeRun(),{cls:'small'}),'section-gap');
  const r=vm.runDetail;
  return card(r.title,`<p>${e(r.status)}</p><p class="help mono">${e(r.provenance)}</p><p>${e(r.note)}</p><p class="help">${e(r.attempts)}</p>${r.tasks.map(t=>`<details><summary>${e(t.title)} · ${e(t.score)}</summary><pre class="sv4-pre">${e(t.input)}</pre>${(t.requirements||[]).map(req=>`<p class="help">${e(req)}</p>`).join('')}${t.attempts.map(a=>`<article class="sv4-attempt"><h3>${e(a.label)}</h3>${a.transcript.map(m=>`<strong>${e(m.role)}</strong><pre class="sv4-pre">${e(m.content)}</pre>`).join('')}${a.response?`<pre class="sv4-pre">${e(a.response)}</pre>`:''}${a.notes.map(n=>`<p>${e(n)}</p>`).join('')}${a.reviews.map(r=>`<div class="card"><strong>${e(r.label)} · ${e(r.score)}</strong>${r.parts.map(p=>`<p class="help">${e(p)}</p>`).join('')}</div>`).join('')}</article>`).join('')}</details>`).join('')}`,button(c,'Zavřít výsledek',()=>c.mw.closeRun(),{cls:'small ghost'}),'section-gap');
}
function prepareCatalogTests(c, selected) {
  const w=c.mw, choice=c.s.catalogSuites?.[selected.name], roles=(selected.tests||[]).map(t=>t.role).filter(r=>!choice||choice.includes(r));
  if (!roles.length) { c.toast('Vyberte alespoň jednu sadu role.'); return false; }
  if (!selected.prepareTests()) return false;
  const saved=w.profileRows().find(p=>p.id===c.s.catalogProfile);
  if (saved) { w.profileDraft={...w.profileDraft,...{scheduleType:saved.schedule.type,at:saved.schedule.at||'',intervalMinutes:saved.schedule.intervalMinutes||60,time:saved.schedule.time||'22:00',timezone:saved.schedule.timezone||'Europe/Prague',weekDays:saved.schedule.weekDays||[],limit:saved.limit}}; }
  w.profileDraft={...w.profileDraft,roles,enabled:false};w.notice='Připravené sady: '+roles.join(', ')+'. Profil je vypnutý; uložení ani spuštění nebylo provedeno.';c.s.modelTab='hunt';c.s.huntTab='profiles';ensure(c);return true;
}
function catalog(c,vm) {
  const w=c.mw, cat=vm.redesign.catalog, selected=cat.selected;
  const filters=`<section class="hunt2-catalog-filters mv4-cat-filters">${input(c,'hunt-search','Hledat model',cat.search,cat.setSearch,'type="search" placeholder="Název nebo rodina"')}${select(c,'hunt-role','Vhodná role',cat.roleOptions.map(o=>[o.value,o.label]),cat.role,cat.setRole)}${select(c,'hunt-availability','Dostupnost',[['notInstalled','Ke stažení'],['installed','Stažené'],['all','Všechny']],cat.availability,cat.setAvailability)}${select(c,'hunt-sort','Řadit podle',[['benefit','Přínos pro roli'],['score','Veřejné skóre'],['size','Velikost'],['name','Název']],cat.sort,cat.setSort)}${check(c,'hunt-fits','Jen co se vejde do profilu VRAM',cat.fits,cat.setFits)}${cat.protocolOptions.length?select(c,'hunt-protocol','Srovnatelný veřejný protokol',cat.protocolOptions.map(o=>[o.value,o.label]),cat.protocol,cat.setProtocol):''}</section>`;
  const list=`<section class="hunt2-search-results ${c.s.layout==='grid'?'sv4-catalog-tiles':''}"><div class="hunt2-results-caption">${e(cat.count)} · ${e(cat.unknownVram)}</div>${cat.rows.map(m=>{
    const id='sv4-model-'+c.modelActions.size;c.modelActions.set(id,{fn:m.select});
    return `<button type="button" class="hunt2-search-row ${m.cls?'hunt2-selected':''}" data-action="${id}"><span class="hunt2-model-glyph">${e(m.name.slice(0,1).toUpperCase())}</span><span class="sv4-candidate-main"><strong>${e(m.name)}</strong><small>${e(m.family)} · ${e(m.parameters)}</small><span>${m.roles.map(r=>tag(r.role,r.active?'gold':'')).join(' ')}</span><span class="cell-sub">${e(m.quant)} · ${e(m.size)} · ${e(m.vram)} VRAM</span><span>${tag(m.installed?'Stažený':'Ke stažení',m.installed?'green':'blue')} ${e(m.score)} · ${e(m.gain)}</span></span></button>`;
  }).join('')}${!cat.rows.length?H.empty('Filtru neodpovídá žádný model.','Výchozí filtr vybírá modely ke stažení s doloženým odhadem VRAM.')+button(c,'Zobrazit i neověřenou VRAM',cat.showUnknown):''}</section>`;
  const benchmarks=cat.hasSelection?table(['Role','Skóre kandidáta','Současný model / reference','Přínos','Doporučení'],selected.comparisonRows.map(r=>row([`<strong>${e(r.role)}</strong>`,e(r.score)+`<div class="cell-sub">${e(r.metric)}</div>`,e(r.incumbent),e(r.gain),e(r.recommendation)+`<div class="cell-sub">${e(r.scope)}</div>`+(r.hasSource?`<a href="${e(r.sourceUrl)}" target="_blank" rel="noopener noreferrer">Zdroj měření</a>`:'')]))):'';
  const variants=cat.hasSelection?(cat.variants.length?cat.variants:[selected]).map(m=>`<div class="mv4-variant ${m.name===selected.name?'hunt2-selected':''}">${button(c,m.quant+' · '+m.name,m.select,{cls:'ghost'})}<span>${e(m.size)} na disku</span><span>${e(m.vram)} VRAM</span>${tag(m.fit,m.fit==='V odhadovaném limitu'?'green':'gold')}</div>`).join(''):'';
  const preparation=cat.hasSelection?`<h3 class="section-gap">Profil plánování a sady</h3>${select(c,'catalog-profile','Použít plán uloženého profilu',[['','Ruční · výchozí parametry'],...w.profileRows().map(p=>[p.id,p.name])],c.s.catalogProfile||'',ev=>{c.s.catalogProfile=ev.target.value;const p=w.profileRows().find(p=>p.id===ev.target.value);if(p)c.s.catalogSuites={...c.s.catalogSuites,[selected.name]:(selected.tests||[]).map(t=>t.role).filter(r=>p.roles.includes(r))};c.render(true);})}<div class="hunt2-role-checks">${selected.tests.map(t=>check(c,'catalog-suite-'+t.role,t.role+' · pevná sada backendu',!c.s.catalogSuites?.[selected.name]||c.s.catalogSuites[selected.name].includes(t.role),ev=>{const chosen=c.s.catalogSuites?.[selected.name]||(selected.tests||[]).map(t=>t.role);c.s.catalogSuites={...c.s.catalogSuites,[selected.name]:ev.target.checked?[...new Set([...chosen,t.role])]:chosen.filter(r=>r!==t.role)};c.render(true);})).join('')}</div><p class="help">Benchmark používá přijatý kontext 4 096 tokenů. Příprava otevře vlastní vypnutý profil; uložený profil ani role se nemění.</p>`:'';
  const detail=cat.hasSelection?card(selected.name,`<p class="help">${e(selected.family)} · ${e(selected.parameters)} · licence ${e(selected.license)}</p>${H.notice(e(selected.localQuality))}<h3>Veřejné benchmarky podle role</h3>${benchmarks}<h3 class="section-gap">Kvantizace / přesné varianty</h3><div class="mv4-variants">${variants}</div><p class="help">VRAM je odhad pro výběr testu. Aktivace vyžaduje místní ověření konkrétního digestu; chybějící kvantizace se nedoplňuje ukázkou.</p>${preparation}<div class="toolbar">${button(c,'Stáhnout vybraný model',selected.pull,{cls:'primary',disabled:selected.pullDisabled,confirmation:'Stáhnout '+selected.name+'? Použije síť a disk; role se nezmění.'})}${button(c,'Připravit testy dostupných rolí',()=>prepareCatalogTests(c,selected),{disabled:selected.prepareTestsDisabled})}</div><p class="help">Stažení: ${e(selected.downloadStatus)}</p><h3>Místní test jednotlivé role</h3><div class="toolbar">${selected.tests.map(t=>button(c,t.role,t.test,{disabled:t.disabled,confirmation:'Spustit skutečný GPU test '+selected.name+' pro '+t.role+'?'})).join('')}</div>`,'','hunt2-model-detail'):card('Detail kandidáta','<p class="help">Vyberte model z katalogu. Chybějící kandidáti nejsou nahrazeni simulací.</p>');
  return filters+`<p class="help">Výchozí filtry: vejde se do profilu VRAM a ke stažení. Chybějící podklady jsou „—“. ${e(cat.unknownVram)}.</p><div class="hunt2-discovery-layout">${list}${detail}</div>`+externalReference(c,vm);
}
function externalReference(c,vm) {
  const x=vm.redesign.externalReference, d=c.mw.externalDraft;
  if (!x.hasDraft) return `<div class="toolbar section-gap">${button(c,'Přidat veřejný podklad',x.open)}</div>`;
  const fields=[['model','Model'],['role','Role'],['metric','Metrika'],['score','Skóre'],['minimum','Minimum škály'],['maximum','Maximum škály'],['sourceUrl','Zdroj HTTPS'],['measuredAt','Datum měření (ISO)'],['referenceModel','Srovnávaný model']];
  return card('Veřejný podklad',`<div class="hunt2-form-grid">${fields.map(([k,label])=>input(c,'ref-'+k,label,d[k],ev=>{if(!c.mw.busy&&!c.mw.externalDraft.blocked){c.mw.externalDraft[k]=ev.target.value;}},`${x.disabled?'disabled':''}`)).join('')}</div><p class="help">Jde o podklad pro prioritu testování. Nevytváří místní skóre ani oprávnění aktivovat model.</p><div class="setting-footer">${button(c,'Zavřít',x.close)}${button(c,'Uložit podklad',x.save,{cls:'primary',disabled:x.disabled})}</div>`,'','section-gap');
}
function profileEditor(c,vm) {
  const p=vm.redesign.profiles;
  if (!p.hasDraft) return '';
  const d=p.draft;
  const roles=d.roleOptions.map(o=>check(c,'profile-role-'+o.role,o.label,o.checked,o.change)).join('');
  const scheduling=select(c,'profile-schedule','Způsob spuštění',d.scheduleOptions.map(o=>[o.value,o.label]),d.scheduleType,d.setSchedule)
    +(d.dateEnabled?input(c,'profile-date','Jednorázový termín / počátek intervalu',d.at,d.setAt,'type="datetime-local"'):'')
    +(d.intervalEnabled?input(c,'profile-interval','Interval (minuty)',d.intervalMinutes,d.setInterval,'type="number" min="60" max="10080"'):'')
    +(d.timeEnabled?input(c,'profile-time','Čas',d.time,d.setTime,'type="time"')+input(c,'profile-timezone','Časové pásmo',d.timezone,d.setTimezone):'')
    +(d.dayEnabled?`<div class="hunt2-role-checks">${d.dayOptions.map((o,i)=>check(c,'profile-day-'+i,o.label,o.checked,o.change)).join('')}</div>`:'');
  const models=!d.isHunt?select(c,'profile-model-a',d.isChallenge?'Model A':'Model',d.modelOptions.map(o=>[o.value,o.label]),d.modelA,d.setModelA)
    +(d.isChallenge?select(c,'profile-model-b','Model B',d.modelOptions.map(o=>[o.value,o.label]),d.modelB,d.setModelB):''):input(c,'profile-path','Úložiště modelů (volitelná absolutní cesta)',d.modelsPath,d.setModelsPath,'placeholder="Výchozí úložiště backendu"');
  return card(p.editorTitle,`<div class="hunt2-form-grid">${input(c,'profile-name','Název profilu',d.name,d.setName,'maxlength="200"')}${select(c,'profile-kind','Typ profilu',d.kindOptions.map(o=>[o.value,o.label]),d.kind,d.setKind)}${models}</div><h3>Sady rolí</h3><div class="hunt2-role-checks">${roles}</div><h3>Termín a opakování</h3><div class="hunt2-form-grid">${scheduling}</div><h3>Limity a povolení</h3><div class="hunt2-form-grid">${input(c,'profile-limit','Limit kandidátů / evaluací',d.limit,d.setLimit,'type="number" min="1" max="10"')}${check(c,'profile-enabled','Povolit plánování profilu',d.enabled,d.setEnabled)}</div><p class="help">Pouze při volné GPU. Evaluace používá pevné sady backendu; úkol dostane vlastní snímek parametrů. Změna profilu nepřepíše zařazené úkoly a neaktivuje model.</p><div class="setting-footer">${button(c,'Zahodit rozpracované změny',p.close,{disabled:p.disabled})}${button(c,'Uložit profil',p.save,{cls:'primary',disabled:p.disabled,confirmation:'Uložit profil '+d.name+(d.enabled?' a povolit jeho plánování?':'?')})}</div>`,'','section-gap');
}
function jobs(c,vm) {
  const rows=vm.redesign.jobs;
  return `<div class="hunt2-section-heading"><div><h2>Fronta a příští běhy</h2><p class="help">Hunt, evaluace a Challenge · sériové zpracování · snímek profilu při zařazení</p></div>${button(c,'Naplánovat z profilu',()=>go(c,'hunt','profiles'),{cls:'small'})}</div><div class="hunt2-queue">${rows.map((j,i)=>`<article class="hunt2-queue-row"><span class="hunt2-order">${i+1}</span><div class="hunt2-queue-main"><strong>${e(j.name)}</strong><div class="cell-sub">${e(j.at)} · ${e(j.roles)}</div><div class="cell-sub mono">${e(j.models)}</div><div class="cell-sub">${e(j.revision)} · ${e(j.deferred)}</div></div>${tag(j.state,j.state==='COMPLETE'?'green':j.state==='FAILED'?'red':'gold')}<div class="hunt2-row-actions">${button(c,'Snímek',()=>{const raw=c.mw.jobRows().find(r=>r.id===j.id);c.modal('Úkol '+j.id,'<pre class="sv4-pre">'+e(JSON.stringify(raw,null,2))+'</pre>',null);},{cls:'small'})}${button(c,'Zrušit',j.cancel,{cls:'small ghost',disabled:j.cancelDisabled,confirmation:'Zrušit čekající úkol '+j.id+'?'})}</div></article>`).join('')||H.empty('Fronta je prázdná.','Vyberte uložený profil a potvrďte zařazení.')}</div>`;
}
function profiles(c,vm) {
  const p=vm.redesign.profiles;
  const groups=p.groups.map((g,i)=>card(g.title,`<div class="hunt2-profile-list ${c.s.layout==='grid'?'sv4-profile-tiles':''}" data-layout="${c.s.layout}">${g.rows.map(r=>`<div class="hunt2-profile-row"><div><strong>${e(r.name)}</strong><small>${e(r.schedule)} · ${e(r.roles)} · ${e(r.state)}</small><small>${e(r.models)} ${e(r.scheduleError)}</small></div><div class="toolbar">${button(c,'Upravit',r.edit,{cls:'small',disabled:r.disabled})}${button(c,'Zařadit',r.queue,{cls:'small primary',disabled:r.disabled,confirmation:'Zařadit '+r.name+'? Může použít disk, síť a GPU. Role se nezmění.'})}${button(c,'Smazat',r.remove,{cls:'small ghost',disabled:r.deleteDisabled,confirmation:'Smazat profil '+r.name+'?'})}</div></div>`).join('')||'<p class="help">Zatím žádný uložený profil.</p>'}</div>`,button(c,'Nový profil',g.create,{cls:'small'})));
  return `<div class="hunt2-profile-columns">${groups.join('')}</div>`+profileEditor(c,vm)
    + input(c,'queue-at','Termín při ručním zařazení (prázdný = nyní)',p.queueAt,p.setQueueAt,'type="datetime-local"')+jobs(c,vm);
}
function hunt(c,vm) {
  const v=vm.redesign;
  const tabs=H.tabs(HUNT,c.s.huntTab,'sv4-hunt-tab');
  const notice=(v.hold?H.notice(e(v.hold),'warn'):'')+(v.gpuNotice?H.notice(e(v.gpuNotice),'warn'):'');
  let html='';
  if(c.s.huntTab==='catalog')html=catalog(c,vm);
  else if(c.s.huntTab==='profiles')html=profiles(c,vm);
  else if(c.s.huntTab==='history')html=history(c,vm);
  else html=`<div class="metric-grid"><div class="metric"><span>Stav</span><strong>${e(v.huntState)}</strong></div><div class="metric"><span>Aktivní model</span><strong>${e(v.huntModel)}</strong></div><div class="metric"><span>Fáze</span><strong>${e(v.huntPhase)}</strong></div></div>`
    +card('Aktuální průběh',`<p>${e(v.progressDetail)}</p><p class="help">${e(v.progressAt)}</p><div class="toolbar">${['start','stop','pause','resume'].map(a=>button(c,({start:'Spustit Hunt',stop:'Zastavit běh',pause:'Pozastavit',resume:'Obnovit'})[a],()=>c.mw.hunt(a),{disabled:c.mw.busy||c.mw.resources.get('hunt')?.status!=='ready'||a==='resume'&&!!v.hold,confirmation:'Provést '+a+' Huntu? Může změnit běh a použít GPU nebo síť. Persistentní hold se touto akcí neuvolní.'})).join('')}</div>`,'','section-gap')
    +`<div class="grid2 section-gap">${card('Čekající kandidáti',v.activeQueue.length?v.activeQueue.map(q=>`<div class="provider"><div><strong>${e(q.name)}</strong><small>${e(q.roles)}</small></div>${tag(q.state)}</div>`).join(''):H.empty('Žádný aktivní kandidát.'))}${card('Povolené plány',v.scheduledProfiles.length?v.scheduledProfiles.map(p=>`<div class="provider"><div><strong>${e(p.name)}</strong><small>${e(p.schedule)} · ${e(p.error)}</small></div>${tag(p.kind)}</div>`).join(''):H.empty('Žádný povolený plán.'))}</div>`+jobs(c,vm);
  return H.sectionTitle('GPU Hunt',tag('Živá data backendu','blue'))+'<p class="help">Kandidáti, plánování, průběh a historie v jednom pracovním prostoru.</p>'+tabs+notice+html;
}
function history(c,vm) {
  const v=vm.redesign;
  return H.sectionTitle('Historie Huntu a Challenge')+`<div class="hunt2-history-layout"><div class="hunt2-history-list">${v.recent.map(r=>`<article class="hunt2-history-row"><span>${e(r.kind)} · ${e(r.status)}</span><strong>${e(r.id)}</strong><small>${e(r.at)}</small><p>${e(r.conclusion)}</p>${r.models.map(m=>`<div class="cell-sub">${e(m.name)} · ${e(m.stage)} · ${e(m.results)}</div>`).join('')}</article>`).join('')||H.empty('Hunt zatím nemá uložený běh.')}</div>${card('Uložená měření',table(['Model / role','Čas','Stav','Skóre',''],v.history.map(r=>row([e(r.model)+' · '+e(r.role),e(r.at),e(stateLabel(r.status)),e(r.score),button(c,'Otevřít odpovědi',r.detail,{cls:'small'})+(r.gradeDisabled?'':button(c,'Posoudit',r.grade,{cls:'small',confirmation:'Spustit skutečné posouzení uloženého běhu dvěma hodnotiteli? Použije GPU.'}))]))))}</div>`+runDetail(c,vm)+jobs(c,vm);
}
function telemetry(c,vm) {
  const v=vm.redesign, g=v.telemetryGraph;
  const requests=v.telemetry.reduce((n,r)=>n+(Number(r.requests)||0),0);
  return `<div class="mv2-telemetry-filter">${select(c,'telemetry-days','Období',[['1','Poslední den'],['7','7 dní'],['30','30 dní'],['90','90 dní']],String(v.days),v.setDays)}${button(c,'Obnovit',()=>c.mw.loadExtra('telemetry',true))}</div><div class="metric-grid"><div class="metric"><span>Obsloužené požadavky</span><strong>${num(requests)}</strong></div><div class="metric"><span>Model / role</span><strong>${num(v.telemetry.length)}</strong></div><div class="metric"><span>Místní správnost</span><strong>V evaluacích</strong><small>Telemetrie neměří kvalitu</small></div></div>`
    +card('Latence v čase',g.hasPoints?`<svg class="mv2-chart" viewBox="0 0 330 160" role="img" aria-label="Latence dokončené odpovědi v milisekundách"><path class="chart-axis" d="M20 5V130H320"/><text x="2" y="14">${e(g.maximum)} ms</text><text x="4" y="130">0</text><text x="20" y="155">${e(g.first)}</text><text x="320" y="155" text-anchor="end">${e(g.last)}</text>${g.points.map(p=>`<circle class="chart-dot" cx="${p.x+20}" cy="${p.y}" r="3"><title>${e(p.title)}</title></circle>`).join('')}</svg><p class="help">${e(g.note)}</p>`:H.empty('Zatím žádné měření latence.'),'','section-gap')
    +table(['Model / role','Požadavky','Latence medián / p95','Rychlost','Délka odpovědi'],v.telemetry.map(r=>row([`<span class="mono">${e(r.model)}</span><div class="cell-sub">${e(r.role)}</div>`,e(r.requests),e(r.median)+' / '+e(r.latency),e(r.speed)+`<div class="cell-sub">${e(r.samples)} vzorků</div>`,e(r.length)])))+`<p class="help">${e(v.telemetryNote)}</p>`;
}
function operation(c,vm) {
  const w=c.mw, state=w.resources.get('policy')?.data?.[0], draft=w.policyDraft, tabs=H.tabs([['policy','Provoz a parametry'],['governor','Správa hardwaru'],['upgrades','Změny modelů']],w.tab,'sv4-operation-tab');
  if(w.tab!=='policy')return tabs+table(['Položka','Popis','Stav','Akce'],vm.rows.map(r=>row([e(r.title),e(r.subtitle),e(r.meta),r.actions.map(a=>button(c,a.label,a.go,{disabled:a.disabled,confirmation:'Provést '+a.label+'?'})).join('')])))+`<div class="toolbar section-gap">${vm.buttons.map(b=>button(c,b.label,b.go,{disabled:b.disabled,confirmation:b.label==='Obnovit'?'':'Provést '+b.label+'? Může použít síť nebo uložit rozhodnutí.'})).join('')}</div>`;
  const settings=table(['Role','Model','Kontext','Maximum odpovědi','Stav',''],vm.redesign.settings.map(r=>row([e(r.role+' · '+r.name),e(r.model),e(r.context),e(r.output),e(r.status),button(c,'Upravit',r.edit,{cls:'small',disabled:r.editDisabled})])));
  const form=state?.valid&&draft?card('Politika automatizace',check(c,'policy-failover','Automaticky přepnout při výpadku',draft.autoFailoverEnabled,ev=>w.setPolicy('autoFailoverEnabled',ev.target.checked))+check(c,'policy-cleanup','Automatický úklid nepoužívaných modelů',draft.autoCleanupEnabled,ev=>w.setPolicy('autoCleanupEnabled',ev.target.checked))+input(c,'policy-days','Retence nepoužívaných modelů (dny)',draft.autoCleanupDays,ev=>w.setPolicy('autoCleanupDays',Number(ev.target.value)),'type="number" min="1" max="365"')+`<div class="setting-footer">${button(c,'Uložit politiku',()=>w.savePolicy(),{cls:'primary',disabled:w.busy,confirmation:'Uložit provozní politiku automatizace? Hold operátora zůstane zachován.'})}</div>`,'','section-gap'):H.notice(e(state?.reason||'Politiku se zatím nepodařilo načíst.'));
  return tabs+H.sectionTitle('Kontext a výstup pro každou roli')+settings+runtime(c,vm)+form;
}
function render(c) {
  c.modelActions=new Map();
  const vm=c.mw.vm(c.s.layout==='grid'?'dlazdice':'seznam',c.s.size), tab=c.s.modelTab;
  const content=({overview,roles,inventory,evaluations,hunt,telemetry,policy:operation})[tab]||overview;
  const head=H.head('Modely a inference','Role, lokální výsledky, dostupná kapacita a provoz.',button(c,'← Všechna nastavení',()=>c.navigate('home'))+button(c,'Obnovit',()=>ensure(c,true)),'Nastavení / Modely');
  return {html:head+H.tabs(TOP,tab,'sv4-model-tab')+readStatus(c)+[vm.redesign.settingsStatus,vm.redesign.profileStatus,vm.redesign.jobStatus].filter(Boolean).map(text=>H.notice(e(text),'warn')).join('')+content(c,vm)+(tab!=='evaluations'&&tab!=='hunt'?runDetail(c,vm):''),aside:aside(c,vm)};
}
function act(c, action, el, ev) {
  if(action==='sv4-model-tab'){go(c,el.dataset.tab);return true;}
  if(action==='sv4-hunt-tab'){go(c,'hunt',el.dataset.tab);return true;}
  if(action==='sv4-operation-tab'){c.s.operationTab=el.dataset.tab;c.mw.select(el.dataset.tab);c.render(true);return true;}
  if(action==='sv4-model-role'){c.mw.selectedRole=el.dataset.role;go(c,'roles');return true;}
  if(action==='sv4-model-detail-tab'){c.s.inventoryTab=el.dataset.tab;c.render(true);return true;}
  const item=c.modelActions?.get(action);
  if(!item)return false;
  const invoke=()=>item.fn(el,ev);
  Promise.resolve(item.confirmation?c.confirmThen(item.confirmation,invoke):invoke()).then(()=>{
    if(['hunt','candidates','history'].includes(c.mw.tab)&&c.s.modelTab!=='hunt'){c.s.modelTab='hunt';c.s.huntTab=c.mw.huntTab;}
    c.render(true);
  }).catch(error=>c.toast(error.message||'Operace selhala.'));
  return true;
}
module.exports={ensure,render,act,stateLabel};
