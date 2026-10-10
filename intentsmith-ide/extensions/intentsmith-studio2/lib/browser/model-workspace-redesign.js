'use strict';
// Integration target: sibling of model-workspace.js. BE contract 0426198053f0f6023cd1fb5a57d4d84cd73e1249.
const { ModelWorkspace, ROLES } = require('./model-workspace');
const ROLE_INFO = {
  CHAT: {name:'Rozhovor',description:'Odpovídá uživateli a vysvětluje výsledky.'},
  D1: {name:'Návrhář',description:'Rozebírá požadavek a připravuje plán práce.'},
  D2: {name:'Diagnostik',description:'Hledá příčinu chyby a navrhuje opravu.'},
  CODE: {name:'Implementace',description:'Připravuje změny souborů podle schváleného plánu.'},
  R2: {name:'Průběžný revizor',description:'Kontroluje změny během pracovního cyklu.'},
  R1: {name:'Závěrečný revizor',description:'Posuzuje výsledek před dokončením plánu.'},
  VISION: {name:'Obrazová analýza',description:'Čte a popisuje obsah obrázků.'},
};
const roleInfo = role => ROLE_INFO[role] || {name:role,description:''};
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const TOP = [['overview','Přehled'],['roles','Role'],['inventory','Modely'],['evaluations','Evaluace'],['hunt','GPU Hunt'],['telemetry','Telemetrie'],['policy','Provoz']];
const HUNT = [['overview','Přehled'],['catalog','Katalog'],['profiles','Nastavení Huntu a Challenge'],['history','Historie']];
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const validRoleSettings = data => record(data) && Array.isArray(data.roles) && data.roles.length <= ROLES.length
  && new Set(data.roles.filter(record).map(row => row.role)).size === data.roles.length
  && data.roles.every(row => record(row) && ROLES.includes(row.role) && Number.isSafeInteger(row.revision) && row.revision >= 0
    && (row.status === 'BINDING_UNAVAILABLE' || ['DEFAULT', 'STALE', 'CONFIGURED','REQUIRES_UPDATE'].includes(row.status)
      && typeof row.model === 'string' && DIGEST.test(row.digestSha256 || '') && record(row.settings)
      && Number.isSafeInteger(row.settings.contextWindowTokens) && row.settings.contextWindowTokens >= 512
      && (row.settings.maxOutputTokens === null || Number.isSafeInteger(row.settings.maxOutputTokens) && row.settings.maxOutputTokens > 0)
      && (row.verifiedHardwareMaximum == null || record(row.verifiedHardwareMaximum)
        && Number.isSafeInteger(row.verifiedHardwareMaximum.contextWindowTokens) && Number.isSafeInteger(row.verifiedHardwareMaximum.maxOutputTokens))));
const EXTRA = {
  bindings:['/api/system/upgrades/bindings',p=>record(p?.bindings)&&Object.entries(p.bindings).every(([r,m])=>ROLES.includes(r)&&(m===null||typeof m==='string'))],
  inventory: ['/api/system/models', p => Array.isArray(p?.models) && p.models.every(m => record(m) && typeof m.name === 'string')],
  profiles: ['/api/system/models/hunt/profiles', p => Array.isArray(p?.profiles) && p.profiles.every(row => record(row) && typeof row.id === 'string' && typeof row.name === 'string' && Array.isArray(row.roles) && row.roles.every(r => ROLES.includes(r)) && Array.isArray(row.models) && record(row.schedule)) && p?.capabilities?.activation === 'SEPARATE_EXACT_ARTIFACT_ACCEPTANCE'],
  jobs: ['/api/system/models/hunt/jobs', p => Array.isArray(p?.jobs) && p.jobs.every(j => record(j) && typeof j.id === 'string' && Number.isSafeInteger(j.revision) && typeof j.state === 'string' && (j.profile == null || record(j.profile) && Array.isArray(j.profile.roles)) && (j.pins === undefined || Array.isArray(j.pins) && j.pins.every(pin => record(pin) && typeof pin.model === 'string')))],
  settings: ['/api/system/models/role-settings', validRoleSettings],
  telemetry: ['/api/system/models/telemetry', p => Array.isArray(p?.models) && p.models.every(m => record(m) && typeof m.model === 'string') && p?.accuracySource === 'ROLE_EVALUATION_HISTORY_ONLY'],
};
const terminal = new Set(['COMPLETE','FAILED','CANCELLED','INTERRUPTED','BLOCKED','PARTIAL','SKIPPED','AWAITING_REVIEW']);
const str = value => value === null || value === undefined || value === '' ? '—' : String(value);
const num = (value, digits = 1) => Number.isFinite(value) ? value.toLocaleString('cs-CZ', { maximumFractionDigits: digits }) : '—';
const date = value => value === null || value === undefined ? '—' : Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('cs-CZ') : '—';
const localDateTime = value => { if (!value || !Number.isFinite(Date.parse(value))) return ''; const d=new Date(value); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16); };
const count = (n, one, few, many) => n + ' ' + (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v);
const same = (a,b) => stable(a) === stable(b);
const profileFields = p => ({ name:p.name, kind:p.kind, roles:p.roles, models:p.models, limit:p.limit, schedule:p.schedule, enabled:p.enabled, modelsPath:p.modelsPath });
function localScore(artifact) { return artifact?.status === 'COMPLETE' && Number.isFinite(artifact.score) && artifact.score >= 0 && artifact.score <= 1 ? artifact.score : null; }
function scoreCell(artifact) {
  const value = localScore(artifact);
  return { value, text:value === null ? '—' : num(value*100)+' %', status:str(artifact?.status), cls:value === null ? 'mw-unmeasured' : value < .5 ? 'mw-score-low' : value < .7 ? 'mw-score-low-middle' : value < .8 ? 'mw-score-middle' : value < .9 ? 'mw-score-middle-high' : 'mw-score-high' };
}
function telemetryGraph(models) {
  const observations=(models||[]).flatMap(m=>(m.observations||[]).map(o=>({...o,model:m.model,role:m.role})))
    .filter(o=>Number.isFinite(o.at)&&Number.isFinite(o.durationMs)&&o.durationMs>=0).sort((a,b)=>a.at-b.at);
  const points=observations.slice(-120),maximum=Math.max(0,...points.map(o=>o.durationMs));
  const first=points[0]?.at,last=points.at(-1)?.at,span=last-first;
  return {hasPoints:points.length>0,maximum:num(maximum,0),first:date(first),last:date(last),
    note:observations.length>120?'Graf zobrazuje posledních 120 naměřených požadavků.':'Graf zobrazuje naměřené požadavky ve vybraném období.',
    points:points.map(o=>({x:span?5+290*(o.at-first)/span:150,y:maximum?125-110*o.durationMs/maximum:125,
      title:o.model+' · '+o.role+' · '+date(o.at)+' · '+num(o.durationMs)+' ms'}))};
}
function validJobPins(profile, job) {
  if (!Array.isArray(job.pins)) return false;
  if (profile.kind==='hunt') return job.pins.length===0;
  return job.pins.length===profile.models.length && job.pins.every((pin,i)=>pin.model===profile.models[i] && DIGEST.test(pin.digestSha256||'') && Array.isArray(pin.roles) && pin.roles.length===profile.roles.length && pin.roles.every((r,j)=>r.role===profile.roles[j]&&DIGEST.test(r.suiteContractSha256||'')));
}
function matrixRows(roles, sortRole, direction) {
  const rows = new Map();
  for (const role of ROLES) for (const artifact of roles?.[role]?.artifacts || []) {
    if (typeof artifact.model !== 'string' || !DIGEST.test(artifact.digestSha256 || '')) continue;
    const key = artifact.model + '\n' + artifact.digestSha256;
    if (!rows.has(key)) rows.set(key, { key, model:artifact.model, digest:artifact.digestSha256, cells:{} });
    rows.get(key).cells[role] = artifact;
  }
  return [...rows.values()].sort((a,b) => {
    const av=localScore(a.cells[sortRole]), bv=localScore(b.cells[sortRole]);
    if (av === null || bv === null) return av === bv ? a.key.localeCompare(b.key) : av === null ? 1 : -1;
    return (av-bv)*(direction === 'asc' ? 1 : -1) || a.key.localeCompare(b.key);
  });
}
function scheduleLabel(s) {
  if (!s) return '—';
  if (s.type === 'manual') return 'Ruční';
  if (s.type === 'once') return date(s.at);
  if (s.type === 'interval') return 'Každých '+s.intervalMinutes+' min od '+date(s.at);
  return (s.type === 'daily' ? 'Denně' : 'Týdně ['+(s.weekDays||[]).join(', ')+']')+' '+str(s.time)+' · '+str(s.timezone);
}
function draftProfile(p) {
  const schedule=p?.schedule||{type:'manual'};
  return { id:p?.id||'', revision:p?.revision||0, name:p?.name||'', kind:p?.kind||'hunt', roles:[...(p?.roles||['CHAT'])],
    models:[...(p?.models||[])], limit:p?.limit||1, enabled:p?.enabled===true, modelsPath:p?.modelsPath||'',
    scheduleType:schedule.type, at:schedule.at||'', intervalMinutes:schedule.intervalMinutes||60,
    time:schedule.time||'', timezone:schedule.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC', weekDays:[...(schedule.weekDays||[])] };
}
function profileBody(d) {
  if (!ID.test(d.id) || !d.name.trim() || d.name.length>200 || /[\x00-\x1f]/.test(d.name) || typeof d.enabled!=='boolean' || !['hunt','evaluation','challenge'].includes(d.kind)
    || !d.roles.length || d.roles.some(r=>!ROLES.includes(r)) || new Set(d.roles).size!==d.roles.length
    || !Number.isSafeInteger(d.revision) || d.revision<0 || !Number.isSafeInteger(d.limit) || d.limit<1 || d.limit>10)
    throw Error('Zkontrolujte název, identifikátor, role a limit profilu.');
  const models=d.models.filter(Boolean);
  if (models.length>10 || new Set(models).size!==models.length || models.some(m=>!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(m))
    || d.kind==='evaluation' && models.length!==1 || d.kind==='challenge' && models.length!==2)
    throw Error('Evaluace potřebuje jeden model, Challenge dva odlišné modely.');
  let schedule={type:d.scheduleType};
  if (['once','interval'].includes(d.scheduleType)) {
    if (!d.at || !Number.isFinite(new Date(d.at).getTime())) throw Error('Zadejte platný termín.');
    schedule.at=new Date(d.at).toISOString();
    if(d.scheduleType==='interval') {
      if(!Number.isSafeInteger(d.intervalMinutes)||d.intervalMinutes<60||d.intervalMinutes>10080)throw Error('Interval musí být 60–10 080 minut.');
      schedule.intervalMinutes=d.intervalMinutes;
    }
  } else if (['daily','weekly'].includes(d.scheduleType)) {
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(d.time)) throw Error('Zadejte čas pravidelného běhu.');
    try {new Intl.DateTimeFormat('cs',{timeZone:d.timezone}).format();}catch {throw Error('Neplatné časové pásmo.');}
    schedule.time=d.time;schedule.timezone=d.timezone;
    if(d.scheduleType==='weekly') {
      if(!d.weekDays.length || d.weekDays.some(day=>!Number.isInteger(day)||day<0||day>6) || new Set(d.weekDays).size!==d.weekDays.length)throw Error('Vyberte dny v týdnu.');
      schedule.weekDays=[...d.weekDays];
    }
  } else if(d.scheduleType!=='manual')throw Error('Neplatný způsob plánování.');
  const modelsPath=d.modelsPath.trim()||null;
  if(modelsPath!==null && (d.kind!=='hunt'||!/^\/[A-Za-z0-9_./-]+$/.test(modelsPath)))throw Error('Cesta je podporovaná pouze pro discovery Hunt; evaluace používá pevné úložiště.');
  return {revision:d.revision,name:d.name.trim(),kind:d.kind,roles:[...d.roles],models,limit:d.limit,schedule,enabled:d.enabled,modelsPath};
}
class ModelWorkspaceRedesign extends ModelWorkspace {
  constructor(options={}) {
    super(options); this.extra=new Map();this.extraLoading=new Map();this.huntTab='overview';
    this.matrixRole='CHAT';this.matrixDirection='desc';this.matrixSelection='';this.inventoryModel='';
    this.catalogFilter={search:'',role:'CHAT',fits:true,availability:'notInstalled',sort:'benefit',protocol:''};
    this.externalDraft=null;this.catalogName='';this.profileDraft=null;this.roleRuntimeDraft=null;this.queueAt='';this.telemetryDays=7;this.sequence=0;
  }
  destroy(){super.destroy();this.extra.clear();this.extraLoading.clear();}
  currentBackend(){const value=this.backendUrl?.();if(typeof value!=='string'||!/^https?:\/\//.test(value))throw Error('Backend není dostupný.');return value;}
  assertBackend(value){if(this.currentBackend()!==value)throw Error('Backend se změnil. Obnovte data a otevřete nový editor; starý požadavek nebyl znovu odeslán.');}
  isCurrentBackend(value){try{return this.currentBackend()===value;}catch{return false;}}
  async requestAt(backend,path,options={}){this.assertBackend(backend);const result=await this.request(path,options);this.assertBackend(backend);return result;}
  extraData(key){const entry=this.extra.get(key);return entry?.status==='ready'&&this.isCurrentBackend(entry.backend)?entry.data:null;}
  async loadExtra(key,refresh=false) {
    if(!EXTRA[key])return false;
    let backend;try{backend=this.currentBackend();}catch(error){this.extra.set(key,{status:'error',error:error.message});this.changed();return false;}
    const candidate=this.extra.get(key),old=candidate?.backend===backend?candidate:null;
    if(!refresh&&old?.status==='ready')return true;
    if(!refresh&&old?.status==='loading')return this.extraLoading.get(key)||false;
    const token=Symbol(key);this.extra.set(key,{status:'loading',data:old?.data||null,token,backend});this.changed();
    const pending=(async()=>{try {
      const suffix=key==='telemetry'?'?days='+this.telemetryDays:'';
      const payload=await this.requestAt(backend,EXTRA[key][0]+suffix);
      if(!EXTRA[key][1](payload))throw Error('Backend vrátil neplatný formát této části pracoviště.');
      if(!this.destroyed&&this.extra.get(key)?.token===token){this.extra.set(key,{status:'ready',data:payload,backend});this.changed();}
      return true;
    }catch(error){if(!this.destroyed&&this.extra.get(key)?.token===token){this.extra.set(key,{status:'error',error:error.message||'Načtení selhalo.',data:old?.data||null,backend});this.changed();}return false;}})();
    this.extraLoading.set(key,pending);
    return pending.finally(()=>{if(this.extraLoading.get(key)===pending)this.extraLoading.delete(key);});
  }
  async load(tab=this.tab,refresh=false) {
    if(tab==='inventory'){super.load('roles',refresh);this.loadExtra('settings',refresh);this.loadExtra('bindings',refresh);return this.loadExtra('inventory',refresh);}
    if(tab==='telemetry')return this.loadExtra('telemetry',refresh);
    const base=super.load(tab,refresh);
    // Additional endpoints are independent: a 404 must not discard the old base resource.
    if(['overview','roles','policy','inventory'].includes(tab))this.loadExtra('settings',refresh);
    if(['overview','roles','policy'].includes(tab))this.loadExtra('bindings',refresh);
    if(tab==='overview')super.load('roles',refresh);
    if(tab==='hunt'){this.loadExtra('jobs',refresh);this.loadExtra('profiles',refresh);}
    if(tab==='candidates')super.load('evaluations',refresh);
    if(tab==='history')this.loadExtra('jobs',refresh);
    return base;
  }
  select(tab){if(tab==='inventory'||tab==='telemetry'){this.tab=tab;this.notice='';this.runDetail=null;this.changed();this.load(tab);return true;}if(tab==='hunt')this.huntTab='overview';if(tab==='candidates')this.huntTab='catalog';if(tab==='history')this.huntTab='history';return super.select(tab);}
  selectHuntTab(tab){if(!HUNT.some(([id])=>id===tab))return false;const target=tab==='catalog'?'candidates':tab==='history'?'history':'hunt';this.select(target);this.huntTab=tab;if(tab==='profiles'){this.loadExtra('profiles');this.loadExtra('jobs');super.load('evaluations');super.load('candidates');}this.changed();return true;}
  sortMatrix(role){if(!ROLES.includes(role))return;this.matrixDirection=this.matrixRole===role&&this.matrixDirection==='desc'?'asc':'desc';this.matrixRole=role;this.changed();}
  selectCell(row,role){const a=row.cells[role];this.matrixSelection=row.key+'\n'+role;if(a?.runId)this.showRun(a.runId);else{this.runDetail=null;this.changed();}}
  async mutate(path,method,body,backend=this.currentBackend()){return this.requestAt(backend,path,{method,timeout:30_000,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
  profileRows(){return this.extraData('profiles')?.profiles||[];}
  jobRows(){return this.extraData('jobs')?.jobs||[];}
  editProfile(id){if(this.busy)return false;const p=this.profileRows().find(p=>p.id===id);if(!p)return false;this.profileDraft={...draftProfile(p),backend:this.extra.get('profiles').backend};this.changed();return true;}
  newProfile(kind='hunt'){if(this.busy||!['hunt','evaluation','challenge'].includes(kind))return false;this.profileDraft={...draftProfile(null),kind,backend:this.currentBackend()};this.profileDraft.id='profile_'+Date.now().toString(36)+'_'+(++this.sequence);this.changed();}
  draft(key,value){if(!this.profileDraft||this.busy)return;const allowed=['name','kind','modelsPath','scheduleType','at','intervalMinutes','time','timezone','enabled','limit'];if(!allowed.includes(key))return;this.profileDraft={...this.profileDraft,[key]:value};this.changed();}
  async refreshProfiles(backend=this.currentBackend()){this.assertBackend(backend);if(!await this.loadExtra('profiles',true))throw Error('Profily nelze znovu ověřit.');this.assertBackend(backend);return this.profileRows();}
  async refreshJobs(backend=this.currentBackend()){this.assertBackend(backend);if(!await this.loadExtra('jobs',true))throw Error('Frontu nelze znovu ověřit.');this.assertBackend(backend);return this.jobRows();}
  saveProfile(){let body,backend;try{body=profileBody(this.profileDraft);backend=this.profileDraft.backend;this.assertBackend(backend);}catch(error){this.notice=error.message;this.changed();return false;}const id=this.profileDraft.id;
    return this.action('Uložení profilu',async()=>{
      const before=(await this.refreshProfiles(backend)).find(p=>p.id===id);
      if((before?.revision||0)!==body.revision)throw Error('Profil se změnil. Obnovte ho před uložením.');
      const result=await this.mutate('/api/system/models/hunt/profiles/'+encodeURIComponent(id),'PUT',body,backend);
      if(result.id!==id||result.revision!==body.revision+1||!same(profileFields(result),profileFields(body)))throw Error('Zápis profilu nebyl přesně potvrzen. Neopakujte ho naslepo.');
      const after=(await this.refreshProfiles(backend)).find(p=>p.id===id);
      if(!after||after.revision!==result.revision||!same(profileFields(after),profileFields(body)))throw Error('Zápis mohl proběhnout, ale readback se liší. Neopakujte zápis.');
      this.profileDraft={...draftProfile(after),backend};return 'Profil uložen a ověřen v revizi '+after.revision+'. Již zařazené úkoly si ponechávají původní snímek.';
    },body.enabled?'Povolit a uložit profil? Plánovaný Hunt/evaluace může použít síť, disk a GPU; aktivní role se nezmění.':undefined);
  }
  deleteProfile(id){const p=this.profileRows().find(p=>p.id===id);if(!p||this.jobRows().some(j=>j.profileId===id&&!terminal.has(j.state)))return false;
    const backend=this.extra.get('profiles').backend;return this.action('Smazání profilu',async()=>{const current=(await this.refreshProfiles(backend)).find(x=>x.id===id);if(current?.revision!==p.revision)throw Error('Profil se změnil.');
      const result=await this.mutate('/api/system/models/hunt/profiles/'+encodeURIComponent(id),'DELETE',{revision:p.revision},backend);
      if(result.removed!==true||result.id!==id)throw Error('Smazání nebylo potvrzeno.');
      if((await this.refreshProfiles(backend)).some(x=>x.id===id))throw Error('Profil stále existuje. Neopakujte smazání naslepo.');
      if(this.profileDraft?.id===id)this.profileDraft=null;return 'Profil byl smazán a jeho nepřítomnost ověřena.';
    },'Smazat uložený profil '+p.name+'? Backend odstranění odmítne, pokud má profil neuzavřený úkol.');
  }
  queueProfile(id){const p=this.profileRows().find(p=>p.id===id);if(!p)return false;let at;try{at=this.queueAt?new Date(this.queueAt).toISOString():new Date().toISOString();}catch{this.notice='Zadejte platný termín zařazení.';this.changed();return false;}
    const backend=this.extra.get('profiles').backend;return this.action('Zařazení profilu',async()=>{const fresh=(await this.refreshProfiles(backend)).find(x=>x.id===id);if(fresh?.revision!==p.revision||!same(profileFields(fresh),profileFields(p)))throw Error('Profil se změnil. Obnovte náhled.');
      const result=await this.mutate('/api/system/models/hunt/profiles/'+encodeURIComponent(id)+'/queue','POST',{revision:p.revision,at,confirm:true},backend);
      if(!ID.test(result.id||'')||result.profileId!==id||result.profileRevision!==p.revision||!Number.isSafeInteger(result.revision)||!same(profileFields(result.profile||{}),profileFields(p))||result.at!==at||!validJobPins(p,result))throw Error('Přesný snímek zařazeného úkolu nebyl potvrzen. Neopakujte požadavek.');
      const observed=(await this.refreshJobs(backend)).find(j=>j.id===result.id);
      if(!observed||observed.revision<result.revision||observed.profileRevision!==p.revision||observed.at!==at||!same(profileFields(observed.profile||{}),profileFields(p))||!same(observed.pins,result.pins))throw Error('Požadavek mohl proběhnout, ale frontu nelze přesně ověřit.');
      return 'Úkol '+result.id+' potvrzen backendem: '+observed.state+'. Digesty a sady evaluace pinují serverové metody; přiřazení rolí se nemění.';
    },'Zařadit '+p.name+' na '+date(at)+'? Může spustit skutečné stahování nebo GPU měření. Parametry zůstanou ve snímku úkolu.');
  }
  cancelJob(id){const job=this.jobRows().find(j=>j.id===id);if(!job||job.state!=='QUEUED')return false;
    const backend=this.extra.get('jobs').backend;return this.action('Zrušení čekajícího úkolu',async()=>{const fresh=(await this.refreshJobs(backend)).find(j=>j.id===id);if(fresh?.revision!==job.revision||fresh.state!=='QUEUED')throw Error('Úkol už není v původní čekající revizi.');
      const result=await this.mutate('/api/system/models/hunt/jobs/'+encodeURIComponent(id),'DELETE',{revision:job.revision},backend);
      if(result.id!==id||result.state!=='CANCELLED'||result.revision!==job.revision+1)throw Error('Zrušení nebylo potvrzeno.');
      const after=(await this.refreshJobs(backend)).find(j=>j.id===id);if(after?.state!=='CANCELLED'||after.revision!==result.revision)throw Error('Zrušení mohlo proběhnout, ale readback ho nepotvrdil.');return 'Čekající úkol byl zrušen a stav ověřen.';
    },'Zrušit čekající úkol '+id+'? Spuštěný úkol se touto cestou zastavit nedá.');
  }
  editRoleRuntime(role){if(this.busy)return false;const row=this.extraData('settings')?.roles.find(r=>r.role===role);if(!row||!ROLES.includes(role)||!DIGEST.test(row.digestSha256||'')||!Number.isSafeInteger(row.revision)||!row.settings||typeof row.model!=='string')return false;
    this.roleRuntimeDraft={role,backend:this.extra.get('settings').backend,model:row.model,digestSha256:row.digestSha256,revision:row.revision,minimumContextWindowTokens:row.minimumContextWindowTokens||(role==='CHAT'?8192:512),sharedModelRoles:(this.extraData('settings')?.roles||[]).filter(r=>r.model===row.model).map(r=>r.role),contextWindowTokens:row.settings.contextWindowTokens,maxOutputTokens:row.settings.maxOutputTokens??'',source:JSON.parse(JSON.stringify(row))};this.changed();return true;}
  setRoleRuntime(key,event){if(this.busy||!this.roleRuntimeDraft||!['contextWindowTokens','maxOutputTokens'].includes(key))return;this.roleRuntimeDraft={...this.roleRuntimeDraft,[key]:event.target.value===''?'':Number(event.target.value)};this.changed();}
  saveRoleRuntime(){const draft=this.roleRuntimeDraft;if(!draft)return false;const {role,backend,model,digestSha256,revision,contextWindowTokens,maxOutputTokens}=draft;
    const fail=text=>{this.notice=text;this.changed();return false;};
    if(!ROLES.includes(role)||!DIGEST.test(digestSha256)||!Number.isSafeInteger(revision)||!Number.isSafeInteger(contextWindowTokens)||contextWindowTokens<(draft.minimumContextWindowTokens||512)||contextWindowTokens>262144||!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>6000||maxOutputTokens>=contextWindowTokens)return fail('Zadejte celý kontext '+(draft.minimumContextWindowTokens||512)+'–262 144 a výstup 1–6 000 tokenů; výstup musí být menší než kontext. Skutečný runtime limit ověřuje backend.');
    try{this.assertBackend(backend);}catch(error){return fail(error.message);}
    const body={revision,model,digestSha256,contextWindowTokens,maxOutputTokens};
    return this.action('Uložení parametrů '+role,async()=>{
      if(!await this.loadExtra('settings',true))throw Error('Nastavení rolí nelze ověřit.');this.assertBackend(backend);
      const before=this.extraData('settings')?.roles.find(r=>r.role===role);
      if(!before||before.model!==model||before.digestSha256!==digestSha256||before.revision!==revision||!same(before,draft.source))throw Error('Vazba nebo nastavení role se změnily. Otevřete editor z aktuálního záznamu.');
      const result=await this.mutate('/api/system/models/role-settings/'+role,'PUT',body,backend);
      const confirmed=row=>row?.role===role&&row.model===model&&row.digestSha256===digestSha256&&row.revision===revision+1&&row.status==='CONFIGURED'&&row.settings?.contextWindowTokens===contextWindowTokens&&row.settings?.maxOutputTokens===maxOutputTokens;
      if(!confirmed(result))throw Error('Zápis parametrů nebyl přesně potvrzen. Neopakujte ho naslepo.');
      if(!await this.loadExtra('settings',true))throw Error('Parametry mohly být zapsané, ale readback selhal. Neopakujte zápis.');this.assertBackend(backend);
      if(!confirmed(this.extraData('settings')?.roles.find(r=>r.role===role)))throw Error('Readback neodpovídá přesnému artefaktu a tokenové dvojici. Neopakujte zápis.');
      this.roleRuntimeDraft=null;return 'Parametry '+role+' uloženy a ověřeny. Promptové a autorizované limity výstupu zůstávají platné.';
    });
  }
  roleRuntimeVM(){const d=this.roleRuntimeDraft,noop=()=>false;return {hasDraft:!!d,minimumNote:d?'Minimum kontextu pro '+d.role+': '+d.minimumContextWindowTokens+' tokenů. Délka odpovědi CHAT neomezuje interní JSON kroky. Ověřený strop HW: '+(d.source?.verifiedHardwareMaximum?str(d.source.verifiedHardwareMaximum.contextWindowTokens)+' / '+str(d.source.verifiedHardwareMaximum.maxOutputTokens)+' tokenů':'dosud neověřeno; ukládáte požadované okno a výstup')+'.':'',sharedWarning:d?.sharedModelRoles?.length>1?'Stejný model používají role '+d.sharedModelRoles.join(', ')+'. Rozdílný kontext může při přepnutí model znovu načíst.':'',draft:d?{...d,...roleInfo(d.role),digestShort:d.digestSha256.slice(0,12)+'…',contextWindowTokens:d.contextWindowTokens,maxOutputTokens:d.maxOutputTokens,setContext:e=>this.setRoleRuntime('contextWindowTokens',e),setOutput:e=>this.setRoleRuntime('maxOutputTokens',e),save:()=>this.saveRoleRuntime(),close:()=>{this.roleRuntimeDraft=null;this.changed();},disabled:this.busy||!this.isCurrentBackend(d.backend)}:{role:'',name:'',description:'',model:'',digestSha256:'',digestShort:'',revision:0,minimumContextWindowTokens:512,contextWindowTokens:'',maxOutputTokens:'',setContext:noop,setOutput:noop,save:noop,close:noop,disabled:true}};}
  evaluateArtifact(role, model, digest) {
    const current = this.resources.get('evaluations')?.data?.[0]?.roles?.[role]?.artifacts?.find(a => a.model === model);
    if (!DIGEST.test(digest || '') || current?.digestSha256 !== digest) return false;
    return this.evaluate(role, model);
  }
  prepareModelTests(name) {
    const candidate = this.resources.get('candidates')?.data?.[0]?.candidates?.find(c => c.name === name);
    if (!candidate || candidate.installed !== true || this.busy) return false;
    const roles = (candidate.eligibleRoles || []).filter(r => ROLES.includes(r));
    if (!roles.length) return false;
    this.selectHuntTab('profiles');
    const id = 'test_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    this.profileDraft = { ...draftProfile(null), id, name: 'Test ' + name, kind: 'evaluation', roles,
      models: [name], backend: this.currentBackend() };
    this.notice = 'Vybrané jsou všechny dostupné role modelu. Výběr sad můžete upravit a uložit; spuštění pak potvrďte u uloženého profilu.';
    this.changed(); return true;
  }
  inventoryRoleTags(model) {
    const bindings = this.resources.get('roles')?.data?.[0]?.bindings || {};
    const plans = this.resources.get('roles')?.data?.[1]?.roles || {};
    const digest = (model.digestSha256 || model.digest || '').replace(/^sha256:/, '');
    return ROLES.flatMap(role => {
      const measured = plans[role]?.artifacts?.find(a => a.model === model.name && a.digestSha256 === digest);
      const active = bindings[role] === model.name;
      return active || localScore(measured) !== null ? [{ role, active, cls: active ? 'on' : '',
        label: role + (active ? ' · aktivní' : '') + (localScore(measured) !== null ? ' · ' + scoreCell(measured).text : '') }] : [];
    });
  }
  inventoryVM(){
    const models=this.extraData('inventory')?.models||[];
    const settings=this.extraData('settings')?.roles||[];
    const present=m=>({name:m.name,digest:str(m.digestSha256||m.digest),size:num(Number.isFinite(m.size)?m.size/(1024**3):m.sizeGB)+' GiB',
      quant:str(m.details?.quantization_level||m.quantization||m.metadataSnapshot?.quantization),
      family:str(m.details?.family||m.family),parameters:str(m.details?.parameter_size||m.parameterSize),roleTags:this.inventoryRoleTags(m),
      selected:this.inventoryModel===m.name,select:()=>{this.inventoryModel=m.name;this.changed();},prepareTests:()=>this.prepareModelTests(m.name),
      roleSettings:settings.filter(s=>s.model===m.name).map(s=>({role:s.role,requested:str(s.settings?.contextWindowTokens)+' / '+str(s.settings?.maxOutputTokens)+' tok.',
        hardware:s.verifiedHardwareMaximum?str(s.verifiedHardwareMaximum.contextWindowTokens)+' / '+str(s.verifiedHardwareMaximum.maxOutputTokens)+' tok.':'Dosud neověřeno'}))});
    const selected=models.find(m=>m.name===this.inventoryModel);
    return {rows:models.map(present),hasSelection:!!selected,selected:selected?present(selected):{name:'',family:'',parameters:'',quant:'',size:'',digest:'',roleTags:[],roleSettings:[],prepareTests:()=>false},close:()=>{this.inventoryModel='';this.changed();}};
  }
  matrixVM(){const plans=this.resources.get('evaluations')?.data?.[0]?.roles||{};return {headers:ROLES.map(role=>({role,sort:()=>this.sortMatrix(role),ariaSort:this.matrixRole===role?(this.matrixDirection==='desc'?'descending':'ascending'):'none'})),rows:matrixRows(plans,this.matrixRole,this.matrixDirection).map(row=>({model:row.model,digest:row.digest,cells:ROLES.map(role=>{const a=row.cells[role],cell=scoreCell(a);return {...cell,role,selected:this.matrixSelection===row.key+'\n'+role,select:()=>this.selectCell(row,role),test:()=>this.evaluateArtifact(role,row.model,row.digest),testDisabled:this.busy||!a||plans[role]?.artifacts?.find(x=>x.model===row.model)?.digestSha256!==row.digest||a.applicable===false||(plans[role]?.measurementReady===false||plans[role]?.measurementReady===undefined&&plans[role]?.decisionReady===false)||!DIGEST.test(a.digestSha256||'')||!DIGEST.test(plans[role]?.suiteContractSha256||'')};})}))};}
  openExternalReference() {
    if(this.busy)return false;
    this.externalDraft={backend:this.currentBackend(),id:'reference_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8),model:this.catalogName||'',role:this.catalogFilter.role||'CHAT',
      metric:'',score:'',minimum:'0',maximum:'100',sourceUrl:'',measuredAt:'',referenceModel:'',blocked:false};this.changed();return true;
  }
  async saveExternalReference() {
    const d=this.externalDraft;if(!d||d.blocked||this.busy)return false;
    const body={revision:0,model:d.model,role:d.role,metric:d.metric,score:Number(d.score),minimum:Number(d.minimum),maximum:Number(d.maximum),sourceUrl:d.sourceUrl,measuredAt:Number.isFinite(Date.parse(d.measuredAt))?new Date(d.measuredAt).toISOString():d.measuredAt,referenceModel:d.referenceModel};
    if(!d.score.trim()||!d.metric.trim()||!d.referenceModel.trim()||!Number.isFinite(Date.parse(d.measuredAt))){this.notice='Vyplňte skóre, metriku, referenční model a datum v ISO formátu.';this.changed();return false;}
    return this.action('Uložení veřejného podkladu',async()=>{
      this.assertBackend(d.backend);d.blocked=true;
      let result;
      try{result=await this.requestAt(d.backend,'/api/system/models/external-signals/'+encodeURIComponent(d.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
      catch(error){if([400,422].includes(error.status))d.blocked=false;throw error;}
      const readback=await this.requestAt(d.backend,'/api/system/models/external-signals');
      const saved=readback.signals?.find(x=>x.id===d.id);
      if(result.revision!==1||saved?.revision!==1||Object.keys(body).filter(k=>k!=='revision'&&k!=='measuredAt').some(k=>saved[k]!==body[k])||saved.measuredAt!==new Date(body.measuredAt).toISOString())throw Error('Podklad mohl být uložen, ale nelze jej přesně ověřit. Obnovte katalog před dalším zápisem.');
      this.externalDraft=null;await super.load('candidates',true);return 'Veřejný podklad uložen a ověřen. Místní kvalitu prokazuje samostatná evaluace.';
    });
  }
  externalReferenceVM(){const d=this.externalDraft;return {open:()=>this.openExternalReference(),hasDraft:!!d,disabled:this.busy||!!d?.blocked,
    fields:d?['model','role','metric','score','minimum','maximum','sourceUrl','measuredAt','referenceModel'].map(key=>({key,label:({model:'Model v katalogu',role:'Role',metric:'Metrika',score:'Skóre',minimum:'Minimum stupnice',maximum:'Maximum stupnice',sourceUrl:'HTTPS odkaz na zdroj',measuredAt:'Datum měření (ISO)',referenceModel:'Název modelu ve zdroji'})[key],value:d[key],disabled:this.busy||d.blocked,change:e=>{if(!this.busy&&!d.blocked){d[key]=e.target.value;this.changed();}}})):[],save:()=>this.saveExternalReference(),close:()=>{if(!this.busy){this.externalDraft=null;this.changed();}}};}
  catalogVM(view='dlazdice',size=2){const source=this.resources.get('candidates')?.status==='ready'?this.resources.get('candidates').data[0]:null,items=source?.candidates||[],downloads=this.resources.get('candidates')?.data?.[1]?.downloads||[],filter=this.catalogFilter;
    const protocols=[...new Set(items.flatMap(c=>(c.externalSignals||[]).filter(s=>s.role===filter.role).map(s=>stable([s.sourceUrl,s.metric,s.minimum,s.maximum,s.measuredAt,s.protocolId||null,s.sourceSha256||null]))))];
    const protocol=protocols.includes(filter.protocol)?filter.protocol:protocols[0]||'';
    const signal=c=>(c.externalSignals||[]).find(s=>s.role===filter.role&&protocol&&stable([s.sourceUrl,s.metric,s.minimum,s.maximum,s.measuredAt,s.protocolId||null,s.sourceSha256||null])===protocol);
    const value=c=>{if(filter.sort==='size')return Number.isFinite(c.sizeGB)?c.sizeGB:null;const s=signal(c);return filter.sort==='benefit'?(s?.comparisonEvidenceId&&Number.isFinite(s.estimatedGainPoints)?s.estimatedGainPoints:null):Number.isFinite(s?.score)?s.score:null;};
    const filtered=items.filter(c=>(!filter.search||(c.name+' '+str(c.family)+' '+str(c.quantization||c.details?.quantization_level)).toLowerCase().includes(filter.search.toLowerCase()))&&(!filter.role||(c.eligibleRoles||[]).includes(filter.role))&&(!filter.fits||c.fitsVram===true)&&(filter.availability==='all'||filter.availability==='installed'&&c.installed||filter.availability==='notInstalled'&&!c.installed));
    filtered.sort((a,b)=>{if(filter.sort==='name')return a.name.localeCompare(b.name);const av=value(a),bv=value(b);return av===null||bv===null?av===bv?a.name.localeCompare(b.name):av===null?1:-1:(filter.sort==='size'?av-bv:bv-av)||a.name.localeCompare(b.name);});
    const selected=filtered.find(c=>c.name===this.catalogName)||filtered[0]||null;
    const family=selected&&selected.name.split(':')[0];
    const siblings=selected?items.filter(c=>c.name.split(':')[0]===family):[];
    const present=c=>{const download=downloads.find(d=>d.model===c.name),sig=signal(c);return {name:c.name,cls:c.name===selected?.name?'on':'',family:str(c.family),parameters:Number.isFinite(c.params)?num(c.params)+' miliard':'Není doloženo',license:typeof c.license==='string'&&c.license?c.license:'Není doložena',quant:c.quantization||c.details?.quantization_level||c.details?.quantizationLevel||'Kvantizace není doložena tímto API',metadata:str(c.metadataVerifiedAt),localQuality:'Místní kvalita není odvozena z veřejného žebříčku',size:num(c.sizeGB)+' GiB',vram:num(Number.isFinite(c.vramMb)?c.vramMb/1024:null)+' GiB',fit:c.fitsVram===true?'V odhadovaném limitu':c.fitsVram===false?'Nad odhadovaným limitem':'VRAM neověřena',installed:c.installed===true,roles:(c.eligibleRoles||[]).map(role=>({role,active:this.resources.get('roles')?.data?.[0]?.bindings?.[role]===c.name,cls:this.resources.get('roles')?.data?.[0]?.bindings?.[role]===c.name?'on':''})),
      score:sig?num(sig.score)+' · '+str(sig.metric):'—',gain:sig?.comparisonEvidenceId&&Number.isFinite(sig.estimatedGainPoints)?num(sig.estimatedGainPoints)+' normalizovaných bodů · prior':'—',source:sig?str(sig.sourceUrl):'Veřejný podklad chybí',scope:sig?str(sig.identityScope)+' · '+(sig.measuredAt?'Měření '+str(sig.measuredAt):'Ověřeno ve zdroji '+str(sig.observedAt)):'Místní kvalita nezměřena',
      prepareTests:()=>this.prepareModelTests(c.name),prepareTestsDisabled:this.busy||c.installed!==true||!(c.eligibleRoles||[]).some(r=>ROLES.includes(r)),select:()=>{this.catalogName=c.name;this.changed();},pull:()=>this.pull(c.name),pullDisabled:this.busy||c.installed===true||!!download&&!['done','error'].includes(download.status),downloadStatus:str(download?.status),
      comparisonRows:ROLES.map(role=>{
        const signals=(c.externalSignals||[]).filter(s=>s.role===role);
        const ref=signals.find(s=>s.comparisonEvidenceId&&Number.isFinite(s.estimatedGainPoints))||signals[0];
        return {role,metric:ref?.metric||'—',score:ref?num(ref.score):'—',incumbent:ref?.comparisonModel||'—',
          gain:ref?.comparisonEvidenceId&&Number.isFinite(ref.estimatedGainPoints)?num(ref.estimatedGainPoints)+' b.':'—',
          recommendation:ref?.comparisonEvidenceId&&ref.estimatedGainPoints>0?'Upřednostnit místní test':ref?'Ověřit místním testem':'Veřejný podklad chybí',
          sourceUrl:ref?.sourceUrl||'',hasSource:!!ref?.sourceUrl,scope:ref?.roleMapping==='APPLICATION_PROXY_NOT_ROLE_BENCHMARK'?'Pomocná metrika, nikoli test této role':'Reference pro prioritu testu'};
      }),
      tests:(c.eligibleRoles||[]).filter(r=>ROLES.includes(r)).map(role=>{const p=this.resources.get('evaluations')?.data?.[0]?.roles?.[role],a=p?.artifacts?.find(x=>x.model===c.name);return {role,test:()=>this.evaluate(role,c.name),disabled:this.busy||!a||a.applicable===false||(p?.measurementReady===false||p?.measurementReady===undefined&&p?.decisionReady===false)||!DIGEST.test(a.digestSha256||'')||!DIGEST.test(p?.suiteContractSha256||'')};})};};
    return {layoutClass:view==='seznam'?'mw-catalog-list':'mw-catalog-list mw-catalog-tiles mw-catalog-size-'+([1,2,3].includes(size)?size:2),rows:filtered.map(present),hasSelection:!!selected,selected:selected?present(selected):{roles:[],tests:[]},variants:siblings.map(present),hasVariants:siblings.length>1,selectedTag:selected?.name||'',setVariant:e=>{if(siblings.some(c=>c.name===e.target.value)){this.catalogName=e.target.value;this.changed();}},showUnknown:()=>{this.catalogFilter={...filter,fits:false};this.changed();},count:count(filtered.length,'model','modely','modelů'),unknownVram:count(items.filter(c=>c.fitsVram===null).length,'model bez ověřené VRAM','modely bez ověřené VRAM','modelů bez ověřené VRAM'),
      search:filter.search,setSearch:e=>{this.catalogFilter={...filter,search:e.target.value};this.changed();},roleOptions:[{value:'',label:'Všechny role'},...ROLES.map(value=>({value,label:value}))],role:filter.role,setRole:e=>{if(e.target.value===''||ROLES.includes(e.target.value)){this.catalogFilter={...filter,role:e.target.value,protocol:''};this.changed();}},fits:filter.fits,setFits:e=>{this.catalogFilter={...filter,fits:e.target.checked};this.changed();},availability:filter.availability,setAvailability:e=>{this.catalogFilter={...filter,availability:e.target.value};this.changed();},sort:filter.sort,setSort:e=>{this.catalogFilter={...filter,sort:e.target.value};this.changed();},
      protocol,protocolOptions:protocols.map(value=>{const p=JSON.parse(value);return {value,label:p[1]+' · '+p[0]+' · '+(p[4]||'datum měření není uvedeno')};}),setProtocol:e=>{this.catalogFilter={...filter,protocol:e.target.value};this.changed();}};
  }
  profileVM(view="dlazdice",size=2){const rows=this.profileRows(),jobs=this.jobRows(),d=this.profileDraft;const body={layoutClass:view==='seznam'?'mw-profile-list':'mw-profile-list mw-profile-tiles mw-profile-size-'+([1,2,3].includes(size)?size:2),rows:rows.map(p=>({id:p.id,name:p.name,kind:p.kind,roles:p.roles.join(', '),models:p.models.join(' × ')||'Discovery',schedule:scheduleLabel(p.schedule),state:p.enabled?'Povoleno':'Vypnuto',scheduleError:p.lastScheduleError?.code||'',edit:()=>this.editProfile(p.id),queue:()=>this.queueProfile(p.id),remove:()=>this.deleteProfile(p.id),deleteDisabled:this.busy||jobs.some(j=>j.profileId===p.id&&!terminal.has(j.state)),disabled:this.busy})),hasDraft:!!d,new:()=>this.newProfile(),queueAt:localDateTime(this.queueAt),setQueueAt:e=>{this.queueAt=e.target.value;this.changed();},save:()=>this.saveProfile(),close:()=>{if(this.busy)return false;this.profileDraft=null;this.changed();},disabled:this.busy,draft:{roleOptions:[],dayOptions:[],modelOptions:[],kindOptions:[],scheduleOptions:[]}};
    body.groups=[{title:'Uložené profily Huntu',rows:body.rows.filter(p=>p.kind!=='challenge'),create:()=>this.newProfile('hunt')},{title:'Uložené profily Challenge',rows:body.rows.filter(p=>p.kind==='challenge'),create:()=>this.newProfile('challenge')}];
    body.editorTitle=d?.kind==='challenge'?'Profil Challenge':d?.kind==='evaluation'?'Profil měření modelu':'Plán Huntu';
    if(!d)return body;const names=[...new Set([...(this.resources.get('candidates')?.data?.[0]?.candidates||[]).map(c=>c.name),...Object.values(this.resources.get('evaluations')?.data?.[0]?.roles||{}).flatMap(p=>(p.artifacts||[]).filter(a=>DIGEST.test(a.digestSha256||'')).map(a=>a.model))])];
    body.draft={...d,disabled:this.busy,at:localDateTime(d.at),modelA:d.models[0]||'',modelB:d.models[1]||'',isHunt:d.kind==='hunt',isChallenge:d.kind==='challenge',dateEnabled:['once','interval'].includes(d.scheduleType),timeEnabled:['daily','weekly'].includes(d.scheduleType),dayEnabled:d.scheduleType==='weekly',intervalEnabled:d.scheduleType==='interval',
      kindOptions:['hunt','evaluation','challenge'].map(value=>({value,label:{hunt:'Discovery Hunt',evaluation:'Evaluace jednoho modelu',challenge:'Challenge dvou modelů'}[value]})),scheduleOptions:['manual','once','interval','daily','weekly'].map(value=>({value,label:{manual:'Ruční',once:'Jednou',interval:'Interval',daily:'Denně',weekly:'Týdně'}[value]})),modelOptions:names.map(value=>({value,label:value})),
      roleOptions:ROLES.map(role=>({role,label:role+' · '+roleInfo(role).name,checked:d.roles.includes(role),change:e=>{if(this.busy||this.profileDraft!==d)return false;this.profileDraft={...this.profileDraft,roles:e.target.checked?[...new Set([...this.profileDraft.roles,role])]:this.profileDraft.roles.filter(r=>r!==role)};this.changed();}})),
      dayOptions:['Neděle','Pondělí','Úterý','Středa','Čtvrtek','Pátek','Sobota'].map((label,day)=>({label,checked:d.weekDays.includes(day),change:e=>{if(this.busy||this.profileDraft!==d)return false;this.profileDraft={...this.profileDraft,weekDays:e.target.checked?[...new Set([...this.profileDraft.weekDays,day])]:this.profileDraft.weekDays.filter(v=>v!==day)};this.changed();}})),
      setName:e=>this.draft('name',e.target.value),setKind:e=>{if(this.busy||this.profileDraft!==d)return false;this.profileDraft={...this.profileDraft,kind:e.target.value,models:[],modelsPath:''};this.changed();},setLimit:e=>this.draft('limit',Number(e.target.value)),setEnabled:e=>this.draft('enabled',e.target.checked),setModelsPath:e=>this.draft('modelsPath',e.target.value),setSchedule:e=>this.draft('scheduleType',e.target.value),setAt:e=>this.draft('at',e.target.value),setInterval:e=>this.draft('intervalMinutes',Number(e.target.value)),setTime:e=>this.draft('time',e.target.value),setTimezone:e=>this.draft('timezone',e.target.value),
      setModelA:e=>{if(this.busy||this.profileDraft!==d)return false;this.profileDraft={...this.profileDraft,models:[e.target.value,...this.profileDraft.models.slice(1)]};this.changed();},setModelB:e=>{if(this.busy||this.profileDraft!==d)return false;this.profileDraft={...this.profileDraft,models:[this.profileDraft.models[0]||'',e.target.value]};this.changed();},
      dateDisabled:this.busy||!['once','interval'].includes(d.scheduleType),timeDisabled:this.busy||!['daily','weekly'].includes(d.scheduleType),dayDisabled:this.busy||d.scheduleType!=='weekly',intervalDisabled:this.busy||d.scheduleType!=='interval'};return body;
  }
  jobsVM(){return this.jobRows().map(j=>({id:j.id,name:j.profile?.name||j.profileId,state:str(j.state),at:date(j.at),models:(j.pins||[]).map(p=>p.model+' @ '+p.digestSha256).join(' × ')||'Discovery',roles:(j.profile?.roles||[]).join(', '),revision:'Profil r'+j.profileRevision+' / úkol r'+j.revision,deferred:({GPU_DRIVER_LIBRARY_MISMATCH:'GPU je blokována kvůli rozdílným verzím NVIDIA a NVML; je nutný restart stanice',AUTOMATION_HOLD:'Pozastaveno výslovným automation hold',DESKTOP_NOT_INSTALLED:'Desktopová služba Huntu není nainstalovaná',HUNT_UNAVAILABLE:'Služba Huntu není dostupná',GPU_STATE_UNKNOWN:'Stav GPU nelze ověřit',HUNT_ACTIVE:'Jiný Hunt už běží'})[j.deferredBecause]||str(j.deferredBecause),result:str(j.result?.status||j.code),cancel:()=>this.cancelJob(j.id),cancelDisabled:this.busy||j.state!=='QUEUED'}));}
  summary(){const binding=this.resources.get('roles'),settings=this.extraData('settings')?.roles||[],configured=this.extraData('bindings'),roles=configured?.bindings||(binding?.status==='ready'?binding.data[0].bindings:{});const plans=binding?.status==='ready'?binding.data[1].roles:{};
    return {roles:ROLES.map(role=>{const s=settings.find(s=>s.role===role&&s.model===roles[role]),a=plans?.[role]?.artifacts?.find(a=>a.isCurrentBinding);return {role,...roleInfo(role),model:str(roles[role]),settingsText:s?.settings?str(s.settings.contextWindowTokens)+' / '+str(s.settings.maxOutputTokens)+' tok.':'—',hardware:s?.verifiedHardwareMaximum?str(s.verifiedHardwareMaximum.contextWindowTokens)+' / '+str(s.verifiedHardwareMaximum.maxOutputTokens)+' tok.':'Dosud neověřeno',measuredText:scoreCell(a).text,open:()=>{this.select('roles');this.editRoleRuntime(role);}};}),status:binding?.status==='ready'?'Aktuální přiřazení z backendu.':configured?'Nastavené vazby z backendu. Stav poskytovatele a měření nejsou ověřeny.':binding?.status==='error'?'Přiřazení nelze načíst: '+binding.error:'Načítám aktuální přiřazení…'};
  }
  vm(view='dlazdice',size=2){const base=super.vm(),tab=this.tab,isHunt=['hunt','candidates','history'].includes(tab),summary=this.summary(),matrix=this.matrixVM();const inventory=this.extraData('inventory')?.models||[],telemetry=this.extraData('telemetry');
    const selectedExtra=tab==='inventory'?'inventory':tab==='telemetry'?'telemetry':isHunt&&this.huntTab==='profiles'?'profiles':null;
    const storedExtra=selectedExtra?this.extra.get(selectedExtra):null;
    const extraState=storedExtra?.backend&&!this.isCurrentBackend(storedExtra.backend)?{status:'error',error:'Backend se změnil. Obnovte tuto část.'}:storedExtra;
    const status=this.notice||(selectedExtra?(extraState?.status==='ready'?'Data z backendu.':extraState?.status==='error'?'Tato část není dostupná: '+extraState.error:'Načítám data…'):base.status);
    const current=this.resources.get('hunt')?.data?.[0],request=current?.current?.request;
    const recent = (current?.recent || []).map(run => ({
      id:str(run.runId), kind:run.request?.kind === 'challenge' ? 'Challenge' : run.request?.kind === 'evaluation' ? 'Evaluace' : 'Hunt',
      at:date(run.finishedAt), status:str(run.status), conclusion:(run.reasons || []).map(str).join(' · ') || 'Záznam neobsahuje slovní závěr.',
      models:(run.results || []).map(result => ({ name:str(result.model), stage:str(result.stage),
        results:(result.evaluations || []).map(e => str(e.role) + ': ' + (e.collection ? 'čeká na posouzení' : Number.isFinite(e.score) ? num(e.score*100)+' % (záznam běhu)' : 'bez známky')).join(' · ') })),
    }));
    const operations = ['policy', 'governor', 'upgrades'].includes(tab);
    const redesign={isOverview:tab==='overview',isRoles:tab==='roles',isInventory:tab==='inventory',isEvaluations:tab==='evaluations',isHunt,isTelemetry:tab==='telemetry',isPolicy:operations,isLegacy:!TOP.some(([id])=>id===tab)&&!isHunt,showJobs:isHunt&&['overview','profiles','history'].includes(this.huntTab),showBaseRows:['roles','policy','governor','upgrades'].includes(tab),
      matrix,externalReference:this.externalReferenceVM(),catalog:this.catalogVM(view,size),profiles:this.profileVM(view,size),jobs:this.jobsVM(),huntOverview:isHunt&&this.huntTab==='overview',huntCatalog:isHunt&&this.huntTab==='catalog',huntProfiles:isHunt&&this.huntTab==='profiles',huntHistory:isHunt&&this.huntTab==='history',
      operationsTabs:[['policy','Provoz a parametry'],['governor','Správa hardwaru'],['upgrades','Změny modelů']].map(([id,label])=>({label,cls:id===tab?'on':'',select:()=>this.select(id)})),
      recent,progressDetail:typeof current?.progress?.detail==='string'?current.progress.detail:current?.progress?.detail?JSON.stringify(current.progress.detail):'Backend nemá aktuální hlášení.',progressAt:date(current?.progress?.updatedAt),
      activeQueue:(current?.queue||[]).map(q=>({name:str(q.name),roles:(q.roles||[]).join(', '),state:str(q.state)})),
      scheduledProfiles:this.profileRows().filter(p=>p.enabled).map(p=>({name:p.name,kind:p.kind,schedule:scheduleLabel(p.schedule),error:p.lastScheduleError?.code||''})),
      huntTabs:HUNT.map(([id,label])=>({label,cls:id===this.huntTab?'on':'',select:()=>this.selectHuntTab(id)})),huntState:({HELD:'Automatika pozastavena operátorem',RUNNING:'Běží',STOPPING:'Zastavuje se',WAITING:'Připraveno',BLOCKED:'Spuštění blokováno',UNAVAILABLE:'Služba není dostupná'})[current?.state]||str(current?.state),huntModel:str(current?.progress?.activeModel||request?.model),huntPhase:str(current?.progress?.phase||current?.current?.status),hold:current?.hold?'Automatizace pozastavena: '+str(current.hold.reason):'',gpuNotice:current?.gpu?.code==='GPU_DRIVER_LIBRARY_MISMATCH'?'GPU nelze použít: načtený ovladač NVIDIA a knihovna NVML mají rozdílné verze. Po aktualizaci ovladače je nutný restart stanice.':current?.gpu?.available===false?'GPU nelze použít: '+str(current.gpu.message||current.gpu.code):'',
      inventory:this.inventoryVM().rows,inventoryDetail:this.inventoryVM(),
      history:(this.resources.get('history')?.data?.[0]?.history||[]).map(r=>({model:str(r.model),role:str(r.role),at:date(r.testedAt),status:str(r.status),score:scoreCell(r).text,detail:()=>this.showRun(r.runId),grade:()=>this.grade(r.runId),gradeDisabled:this.busy||r.status!=='AWAITING_REVIEW'})),
      telemetry:(telemetry?.models||[]).map(m=>({model:m.model,role:m.role,digest:m.digestSha256,requests:str(m.requests),latency:num(m.latencyP95Ms)+' ms',median:num(m.latencyP50Ms)+' ms',total:num(m.totalDurationMs)+' ms',first:date(m.firstAt),last:date(m.lastAt),speed:num(m.tokensPerSecond)+' tok./s',samples:str(m.tokensPerSecondSamples),length:num(m.averageOutputCharacters)+' znaků'})),telemetryGraph:telemetryGraph(telemetry?.models),telemetryNote:(telemetry?.truncated?'Zobrazeno nejvýše 5 000 vzorků; data jsou zkrácená. ':'')+'Telemetrie neměří správnost odpovědí. Čas prvního tokenu se neměří; latence je do dokončení celé odpovědi.',
      days:this.telemetryDays,setDays:e=>{const days=Number(e.target.value);if([1,7,30,90].includes(days)){this.telemetryDays=days;this.loadExtra('telemetry',true);}},
      roleRuntime:this.roleRuntimeVM(),showRoleSettings:['roles','policy'].includes(tab),settings:(this.extraData('settings')?.roles||[]).map(s=>({role:s.role,...roleInfo(s.role),model:str(s.model),status:({DEFAULT:'Výchozí',CONFIGURED:'Uloženo pro roli',STALE:'Model se změnil',REQUIRES_UPDATE:'Nutná úprava',BINDING_UNAVAILABLE:'Přiřazení není dostupné'})[s.status]||'Nezjištěno',context:str(s.settings?.contextWindowTokens),output:str(s.settings?.maxOutputTokens),hardware:'Největší doložená dvojice: '+(s.verifiedHardwareMaximum?str(s.verifiedHardwareMaximum.contextWindowTokens)+' / '+str(s.verifiedHardwareMaximum.maxOutputTokens):'—'),authority:'Používají vlastní limit',edit:()=>this.editRoleRuntime(s.role),editDisabled:this.busy||!DIGEST.test(s.digestSha256||'')||!Number.isSafeInteger(s.revision)})),
      profileStatus:this.extra.get('profiles')?.status==='error'?'Profily nejsou připojené: '+this.extra.get('profiles').error:'',jobStatus:this.extra.get('jobs')?.status==='error'?'Fronta není připojená: '+this.extra.get('jobs').error:'',settingsStatus:this.extra.get('settings')?.status==='error'?'Nastavení rolí není dostupné: '+this.extra.get('settings').error:'',
      hasProfileApi:!!this.extraData('profiles'),noProfileApi:!this.extraData('profiles'),capabilityNote:'Discovery limit 1–10; evaluace používá kontext 4 096 tokenů a dostupné sady serveru. Jen při volné GPU. Bez automatické změny role. Rozpočty volání/VRAM/disku, editace pořadí a test největší HW dvojice zde ještě nemají API.'};
    return {...base,rows:tab==='roles'?base.rows.map(row=>({...row,title:row.title+' · '+roleInfo(row.title).name,subtitle:row.subtitle+' · '+roleInfo(row.title).description,meta:({MISSING:'Dosud nezměřeno',AWAITING_REVIEW:'Čeká na vyhodnocení',FAILED:'Měření selhalo',STALE:'Starší výsledek'})[row.meta]||row.meta})):base.rows,buttons:isHunt&&this.huntTab!=='overview'?base.buttons.filter(b=>b.label==='Obnovit'):base.buttons,status,roleOptions:base.roleOptions.map(o=>({...o,label:o.value+' · '+roleInfo(o.value).name})),summaryRoles:summary.roles,summaryStatus:summary.status,redesign,tabs:TOP.map(([id,label])=>({label,cls:(id===tab||id==='hunt'&&isHunt||id==='policy'&&operations)?'on':'',go:()=>this.select(id)}))};
  }
}
function defaultModelWorkspaceVM() {
  const workspace=new ModelWorkspaceRedesign({backendUrl:()=>'',fetchImpl:()=>{throw Error('Offline default must not fetch');}});
  const vm=workspace.vm(); const noop=()=>false;
  vm.redesign.profiles.draft={...draftProfile(null),modelA:'',modelB:'',disabled:true,isHunt:false,isChallenge:false,dateEnabled:false,timeEnabled:false,dayEnabled:false,intervalEnabled:false,dateDisabled:true,timeDisabled:true,dayDisabled:true,intervalDisabled:true,roleOptions:[],dayOptions:[],modelOptions:[],kindOptions:[],scheduleOptions:[],setName:noop,setKind:noop,setLimit:noop,setEnabled:noop,setModelsPath:noop,setSchedule:noop,setAt:noop,setInterval:noop,setTime:noop,setTimezone:noop,setModelA:noop,setModelB:noop};
  vm.redesign.catalog.selected={name:'',family:'',size:'',vram:'',fit:'',score:'',gain:'',source:'',scope:'',quant:'',metadata:'',localQuality:'',downloadStatus:'',roles:[],tests:[],comparisonRows:[],prepareTests:noop,prepareTestsDisabled:true,pull:noop,pullDisabled:true};
  vm.runDetail={title:'',status:'',runId:'',provenance:'',note:'',attempts:'',tasks:[]};
  return vm;
}
module.exports={ModelWorkspaceRedesign,matrixRows,scoreCell,telemetryGraph,profileBody,profileFields,validJobPins,defaultModelWorkspaceVM,validRoleSettings};
