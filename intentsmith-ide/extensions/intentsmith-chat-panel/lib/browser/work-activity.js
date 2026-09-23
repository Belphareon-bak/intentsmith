'use strict';

// Presentation of already validated M1 events and M2 status views. No effect authority.
const MarkdownIt = require('@theia/core/shared/markdown-it');
const DOMPurify = require('@theia/core/shared/dompurify');
const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true });
// Rendering a reply must never fetch an image, including localhost/tracking URLs.
markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content || '[obrázek]');
const MAX_STEPS = 80, MAX_DETAIL = 6000;
const clip = value => {
  const text = String(value == null ? '' : value), suffix = '\n… [zkráceno]';
  return text.length > MAX_DETAIL ? text.slice(0, MAX_DETAIL - suffix.length) + suffix : text;
};
const labels = {
  analyzing_input: 'Zpracovává zadání', handler_selected: 'Volí postup', cre_decided: 'Rozhodnutí',
  routing_switch: 'Směruje požadavek', preparing_prompt: 'Připravuje kontext', prompt_built: 'Kontext připraven',
  llm_calling: 'Generuje odpověď', llm_response: 'Odpověď vygenerována',
  code_analysis_start: 'Analyzuje projekt', code_analysis_search: 'Vyhledává v kódu',
  code_analysis_context: 'Načítá kontext kódu', code_analysis_llm: 'Vysvětluje kód',
  search_start: 'Vyhledává', search_scrape: 'Načítá zdroj', search_synthesis: 'Zpracovává podklady',
  quality_d6: 'Kontroluje výstup', quality_lang: 'Kontroluje jazyk', quality_links: 'Kontroluje odkazy',
  quality_numeric: 'Kontroluje čísla', quality_fluff: 'Kontroluje odpověď', quality_scorer: 'Kontroluje kvalitu',
  specialist_dispatch: 'Předává specialistovi', expertise_discovery: 'Vybírá expertízu',
  attachment_guard: 'Kontroluje přílohy', tool_executing: 'Pracuje s nástrojem',
};
function detail(value) {
  if (typeof value === 'string') return clip(value);
  try { return clip(JSON.stringify(value, (key, item) => /password|secret|authorization|cookie|api.?key|capability/i.test(key) ? '[skryto]' : item, 2)); }
  catch (_) { return 'Detail není dostupný.'; }
}
function createActivity(id, label, now = Date.now()) {
  return { id, label, status: 'running', startedAt: now, endedAt: null, steps: [], omitted: 0, lastSequence: 0 };
}
function applyEvent(activity, event, now = Date.now()) {
  if (!activity || activity.status !== 'running' || event.turnId !== activity.id) return false;
  if (Number.isSafeInteger(event.seq)) {
    if (event.seq <= activity.lastSequence) return false;
    activity.lastSequence = event.seq;
  }
  const p = event.payload || {}, type = event.type;
  // A progress event cannot conclude the turn; only its canonical terminal can.
  if (['turn_start', 'turn_end', 'llm_token'].includes(type)) return false;
  let step;
  if (type === 'tool_result' || type === 'llm_done') {
    const kind = type === 'tool_result' ? 'tool' : 'model';
    const open = [...activity.steps].reverse().find(s => s.kind === kind && s.status === 'running'
      && (kind !== 'tool' || (p.callId ? s.callId === p.callId : s.tool === (p.tool || p.name))));
    if (open) {
      open.status = p.success === false ? 'error' : 'done'; open.endedAt = now;
      open.output = detail(p.summary ?? p.result ?? p.output ?? '');
      open.tokens = p.tokensOut ?? p.tokens ?? null;
      open.durationMs = p.durationMs ?? p.duration ?? (now - open.startedAt);
      activity.label = 'Dokončuje zpracování'; return true;
    }
  }
  if (type === 'tool_call') {
    step = { kind: 'tool', label: p.tool || p.name || 'Nástroj', tool: p.tool || p.name,
      callId: p.callId || null, input: detail(p.args ?? p.input ?? {}), status: 'running' };
  } else if (type === 'llm_start') {
    step = { kind: 'model', label: 'Generuje odpověď', input: p.model ? 'Model / role: ' + clip(p.model) : '', status: 'running' };
  } else if (type === 'system_step') {
    if (!labels[p.step]) return false;
    step = { kind: 'step', label: labels[p.step], input: detail(p.detail), status: 'observed' };
  } else if (type === 'error') {
    step = { kind: 'error', label: 'Ohlášena chyba', output: detail(p.message || p.error || p.code), status: 'error' };
  } else if (type === 'gate_verdict') {
    step = { kind: 'step', label: 'Kontrola výstupu', output: detail(p.reason || p.dimension || ''),
      status: (p.ok ?? p.passed) === true ? 'done' : 'error' };
  } else if (type === 'cre_decision') {
    step = { kind: 'step', label: p.actionType === 'ASK_USER' ? 'Připravuje otázku' : 'Volí postup',
      input: detail({intent:p.intent, action:p.actionType}), status:'observed' };
  } else return false;
  step.startedAt = now; step.id = event.id || String(event.seq || now);
  activity.label = step.label; activity.steps.push(step);
  if (activity.steps.length > MAX_STEPS) { activity.steps.shift(); activity.omitted++; }
  return true;
}
function finishActivity(activity, status, metadata = {}, now = Date.now()) {
  if (!activity || activity.status !== 'running') return;
  const question = metadata.awaitingClarification === true || metadata.decision?.type === 'ASK_USER';
  activity.status = status === 'ok' ? (question ? 'question' : metadata.webStatus === 'pending' ? 'approval' : 'done')
    : status === 'cancelled' ? 'cancelled' : status === 'timeout' ? 'timeout' : 'error';
  activity.label = {done:'Dokončeno',question:'Vyžádáno upřesnění',approval:'Vyžádáno schválení',cancelled:'Zrušeno',timeout:'Vypršel čas',error:'Nedokončeno'}[activity.status];
  activity.endedAt = now;
  activity.steps.forEach(s => { if (s.status === 'running') { s.status = 'unconfirmed'; s.endedAt = now; } });
}
function applyM2View(activity, view) {
  if(!activity||activity.status!=='running')return;
  const names={phase_intent:'Zapisuje soubor',phase_applied:'Soubor zapsán, čeká na ověření',process_started:'Spouští cílený test',process_terminated:'Cílený test ukončen',rollback_intent:'Obnovuje původní stav',rollback_applied:'Obnova zaznamenána',git_ref_updated:'Git aktualizován'};
  const events=Array.isArray(view.audit?.executionEvents)?view.audit.executionEvents:[];
  activity.auditIds=activity.auditIds||[];
  for(const event of events){
    if(!names[event.type]||!event.eventId||activity.auditIds.includes(event.eventId))continue;
    activity.auditIds.push(event.eventId);
    const focused=event.details?.focused;
    activity.steps.push({id:event.eventId,kind:'audit',label:names[event.type]+(event.path?' · '+event.path:''),
      status:event.type==='process_terminated'&&focused?.exitCode!==0?'error':'observed',
      input:event.type==='process_started'&&view.plan?.focusedTest?detail({binary:view.plan.focusedTest.binary,argv:view.plan.focusedTest.argv}):'',
      output:detail(event.details?.testOutput|| (focused?{exitCode:focused.exitCode,status:focused.terminalStatus}:'')),startedAt:Date.now()});
    activity.label=names[event.type];
    if(activity.steps.length>MAX_STEPS){activity.steps.shift();activity.omitted++;}
  }
  if(view.cancelRequested)activity.label='Čeká na potvrzení zrušení';
}
function lines(text) {
  if (!text) return [];
  const result = text.split('\n'); if (result[result.length - 1] === '') result.pop(); return result;
}
function lineCounts(before, after) {
  if ((before !== null && typeof before !== 'string') || typeof after !== 'string') return null;
  const a = lines(before || ''), b = lines(after); let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length-prefix && suffix < b.length-prefix && a[a.length-1-suffix] === b[b.length-1-suffix]) suffix++;
  const x = a.slice(prefix, a.length-suffix), y = b.slice(prefix, b.length-suffix);
  // Never manufacture a +/- count from a coarse fallback on a huge diff.
  if (x.length * y.length > 4000000) return null;
  const row = new Uint32Array(y.length+1);
  for (const value of x) { let diagonal=0; for(let j=1;j<=y.length;j++) { const previous=row[j]; row[j]=value===y[j-1]?diagonal+1:Math.max(row[j],row[j-1]); diagonal=previous; } }
  return { added:y.length-row[y.length], removed:x.length-row[y.length], newlineChanged:!!before && before.endsWith('\n') !== after.endsWith('\n') };
}
function changeSummary(view) {
  const files = (Array.isArray(view.diff) ? view.diff : []).map(file => ({ path:file.path,
    before:file.before?.content, after:file.after?.content, counts:lineCounts(file.before?.content, file.after?.content) }));
  const applied = view.state === 'succeeded' && view.terminal?.state === 'succeeded' && view.result?.terminalStatus === 'succeeded';
  return { lifecycleId:view.lifecycleId, state:view.state, applied, files,
    label:applied?'Provedené změny':view.state==='awaiting_approval'?'Navržené změny · čekají na schválení':'Návrh · nebyl potvrzen úspěšný výsledek',
    counts:files.every(f=>f.counts) ? files.reduce((n,f)=>({added:n.added+f.counts.added,removed:n.removed+f.counts.removed}),{added:0,removed:0}) : null };
}
function renderMarkdown(text) {
  return DOMPurify.sanitize(markdown.render(String(text || '')), {
    ALLOWED_TAGS:['p','br','strong','em','s','code','pre','blockquote','ul','ol','li','h1','h2','h3','h4','h5','h6','hr','table','thead','tbody','tr','th','td','a'],
    ALLOWED_ATTR:['href','title','start'], ALLOW_DATA_ATTR:false,
  });
}
function createComponents(React) {
  const h=React.createElement;
  function CopyButton({text}) {
    const [state,setState]=React.useState('idle');
    React.useEffect(()=>{if(state==='idle')return;const timer=setTimeout(()=>setState('idle'),2500);return()=>clearTimeout(timer);},[state]);
    const label=state==='done'?'Zkopírováno':state==='error'?'Kopírování selhalo':'Kopírovat odpověď';
    return h('button',{type:'button',className:'intentsmith-response-copy',title:label,'aria-label':label,onClick:async e=>{
      e.stopPropagation();try {if(!navigator.clipboard?.writeText)throw Error('clipboard unavailable');await navigator.clipboard.writeText(text);setState('done');}catch(_){setState('error');}
    }},h('svg',{width:14,height:14,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6,'aria-hidden':true},
      state==='done'?h('path',{d:'m5 12 4 4 10-10'}):h(React.Fragment,null,h('rect',{x:8,y:8,width:12,height:12,rx:2}),h('path',{d:'M16 8V4H4v12h4'}))),
    state==='error'?h('span',{role:'status'},label):null);
  }
  function Clock({activity}) {
    const [now,setNow]=React.useState(Date.now());
    React.useEffect(()=>{if(activity.status!=='running')return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[activity.status]);
    return h('span',{className:'intentsmith-activity-time'},Math.max(0,Math.round(((activity.endedAt||now)-activity.startedAt)/1000))+' s');
  }
  function Activity({activity}) {
    if(!activity)return null;
    const status=activity.status;
    return h('details',{className:'intentsmith-work-activity','data-activity-status':status,onClick:e=>e.stopPropagation()},
      h('summary',null,h('span',{className:'intentsmith-activity-dot '+status}),h('span',{'aria-live':'polite'},activity.label),h('span',{className:'intentsmith-activity-count'},activity.steps.length+' kroků'),h(Clock,{activity})),
      h('ol',{className:'intentsmith-activity-steps'},activity.steps.map(step=>h('li',{key:step.id,'data-step-status':step.status},
        h('details',null,h('summary',null,h('span',{className:'intentsmith-activity-dot '+step.status}),h('span',null,step.label),
          h('span',{className:'intentsmith-activity-time'},step.status==='running'?'Probíhá':step.status==='unconfirmed'?'Bez potvrzení dokončení':step.status==='error'?'Chyba':step.durationMs!=null?(step.durationMs/1000).toFixed(1)+' s':'')),
          step.input?h('div',{className:'intentsmith-step-detail'},h('small',null,'Vstup'),h('pre',null,step.input)):null,
          step.output?h('div',{className:'intentsmith-step-detail'},h('small',null,'Výsledek'),h('pre',null,step.output)):null,
          step.tokens!=null?h('small',null,step.tokens+' výstupních tokenů'):null)))),
      activity.omitted?h('small',null,activity.omitted+' starších kroků je jen v podrobném logu.'):null);
  }
  function Counts({counts}) { return counts?h('span',{className:'intentsmith-change-counts'},h('span',{className:'added'},'+'+counts.added),h('span',{className:'removed'},'−'+counts.removed),counts.newlineChanged?h('span',{title:'Změna koncového odřádkování'},'↵'):null):h('span',{className:'intentsmith-change-counts'},'Počet řádků nedostupný'); }
  function Changes({changes,onReview}) {
    if(!changes?.files?.length)return null;
    return h('section',{className:'intentsmith-change-summary','aria-label':changes.label,'data-change-state':changes.state},
      h('header',null,h('div',null,h('strong',null,changes.label),h('span',null,changes.files.length+' souborů')),h(Counts,{counts:changes.counts})),
      changes.files.map(file=>h('button',{key:file.path,type:'button',className:'intentsmith-change-file',title:'Zobrazit diff: '+file.path,
        disabled:typeof file.after!=='string'||(file.before!==null&&typeof file.before!=='string'),onClick:e=>{e.stopPropagation();onReview(file,changes);}},
        h('span',null,file.path),h(Counts,{counts:file.counts}))));
  }
  function Message({message:m,bubbles,editing,onEdit,onQuestion,onReview,questionPending,markdownEnabled,children}) {
    const u=m.role==='user',a=m.role==='assistant';
    return h('div',{className:'intentsmith-message-row'},
      h('article',{className:'intentsmith-message '+(u?'user':a?'assistant':'system')+(bubbles?' bordered':'')+(editing?' editing':''),onClick:u?onEdit:undefined,title:u?'Klikni pro editaci':undefined},
        h('header',null,h('span',{className:'intentsmith-message-avatar'},u?'Ty':a?'IS':'•'),h('strong',null,u?'Ty':a?'IntentSmith':'Systém'),
          m.tag?h('span',{className:'intentsmith-message-tag'},m.tag):null,a?h(CopyButton,{text:m.text}):null),
        m._question?h('div',{className:'intentsmith-question-label'},questionPending?'Čeká na odpověď':'Otázka na upřesnění'):null,
        m._changes?h(Changes,{changes:m._changes,onReview}):null,
        m._changes?h('details',{className:'intentsmith-plan-detail'},h('summary',null,'Úplný plán, obsahy souborů a ověření'),h('pre',null,m.text)):
          a&&markdownEnabled?h('div',{className:'intentsmith-message-body markdown',dangerouslySetInnerHTML:{__html:renderMarkdown(m.text)}}):h('div',{className:'intentsmith-message-body plain'},m.text),
        m._question&&questionPending?h('button',{type:'button',className:'intentsmith-question-reply',onClick:e=>{e.stopPropagation();onQuestion();}},'Odpovědět'):null,children),
      m._activity?h(Activity,{activity:m._activity}):null);
  }
  return {Activity,Changes,Message,CopyButton};
}
module.exports={createActivity,applyEvent,finishActivity,lineCounts,changeSummary,applyM2View,renderMarkdown,createComponents};
