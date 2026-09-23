import { createHash, randomUUID } from 'node:crypto';

// Answers and criteria travel together. Identity and existing verdicts do not.
// Blinding metadata cannot hide a model identifying itself inside its answer.
export function createBlindAnswerReview(runs) {
  const items = [], identities = [];
  for (const run of runs) {
    if (!run.collection || !['AWAITING_REVIEW','COLLECTION_PARTIAL'].includes(run.status)) {
      throw new Error('Only ungraded collections can enter this review export');
    }
    for (const task of run.tasks) {
      if (!task.input || !Array.isArray(task.responses) || task.responses.length !== task.details.length) {
        throw new Error('Collection detail is incomplete; export the full stored run');
      }
      for (const [index, response] of task.responses.entries()) {
        const id = randomUUID(), detail = task.details[index];
        items.push({ id, role: run.role, task: task.name, independenceGroup: task.independenceGroup,
          input: task.input, criteria: task.rubric, response, captureStatus: detail.captureStatus,
          ...(detail.conversation ? { conversation: {
            transcript: detail.conversation.transcript,
            plannedTurns: detail.conversation.plannedTurns, completedTurns: detail.conversation.completedTurns,
            status: detail.conversation.status, transcriptSha256: detail.conversation.transcriptSha256,
            // Provider identity stays in the private identity key.
            receipts: detail.conversation.receipts.map(r => ({ turn:r.turn, captureStatus:r.captureStatus,
              inputSha256:r.inputSha256, responseSha256:r.responseSha256, error:r.error })),
          } } : {}),
          error: detail.reason || null, score: null, criterionGrades: [], reviewStatus: 'NOT_REVIEWED' });
        identities.push({ id, runId: run.runId, model: run.model, digestSha256: run.digestSha256,
          suiteContractSha256: run.suiteContractSha256, providerVersion: run.providerVersion,
          task: task.name, repeat: index + 1, responseSha256: createHash('sha256').update(response).digest('hex'),
          ...(detail.conversation ? { conversationReceipts:detail.conversation.receipts } : {}) });
      }
    }
  }
  // Do not expose blocks of repeated answers in model/run order.
  items.sort((a,b) => a.id.localeCompare(b.id));
  return {
    review: { schemaVersion: 1, purpose: 'INDEPENDENT_REVIEW', identityMetadataRemoved: true,
      gradingAuthority: false, instructions: 'Grade content against the supplied criteria. Record a reason for each criterion; unresolved task defects remain null. Do not grade transport errors or CODE oracles by reading.', items },
    identityKey: { schemaVersion: 1, privateUntilReviewFrozen: true, identities },
  };
}

// Static local review only. Identity-bearing and blinded pages are separate files.
// Untrusted prompts and answers enter the DOM via textContent, never innerHTML.
export function renderConversationReview(review, identityKey = null) {
  const identities = new Map((identityKey?.identities || []).map(row => [row.id, row]));
  if (!Array.isArray(review.items) || (identityKey && review.items.some(row => !identities.has(row.id)))) {
    throw Error('CONVERSATION_REVIEW_INPUT_INVALID');
  }
  const payload = {
    schemaVersion: 1,
    reviewSha256: createHash('sha256').update(JSON.stringify(review)).digest('hex'),
    identified: Boolean(identityKey),
    decisionAuthority: false,
    items: review.items.map(item => ({...item, ...(identityKey ? {identity: identities.get(item.id)} : {})})),
  };
  const data = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CHAT – rozhovory k hodnocení</title>
<style>
:root{color-scheme:dark;font:16px system-ui;background:#111;color:#ddd}body{max-width:1500px;margin:24px auto;padding:0 20px}h1{font-size:25px}h2{font-size:21px;color:#e3b666}h3{font-size:18px}button,select,input,textarea{font:inherit;color:inherit;background:#242424;border:1px solid #68614f;border-radius:5px;padding:8px}button{cursor:pointer}button:hover{border-color:#e3b666}label{display:block;margin:8px 0}textarea{display:block;width:calc(100% - 18px);min-height:64px}input[type=number]{width:90px}pre,.text{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.5}nav{display:flex;align-items:center;gap:14px;flex-wrap:wrap;position:sticky;top:0;background:#111;padding:14px 0;z-index:1}.notice{border-left:4px solid #d5a852;padding:12px;background:#222}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.card{background:#191919;border:1px solid #605337;border-radius:7px;padding:18px}.turn{border-bottom:1px solid #575047;padding:10px 0}.turn h4{color:#d7b171}.criterion{border-top:1px solid #575047;padding:14px 0}.muted{color:#b7aa92}.status{font-weight:bold;color:#e3b666}details{margin:12px 0}summary{cursor:pointer}#error{color:#ff8989}#coverage{color:#baad96}@media(max-width:900px){.cards{grid-template-columns:1fr}}
</style>
<h1>CHAT – zadání → odpovědi → hodnocení</h1><p id="notice" class="notice"></p><p id="coverage"></p>
<nav><label>Test <select id="task"></select></label><button id="export">Exportovat moje hodnocení</button><span id="saved" role="status"></span></nav><p id="error" role="alert"></p><main id="content"></main>
<script id="payload" type="application/json">${data}</script>
<script>
const packet=JSON.parse(document.getElementById('payload').textContent);
const key='hunt-dialog-review:'+packet.identified+':'+packet.items.map(i=>i.id).sort().join(',');
let grades={};try{const saved=JSON.parse(localStorage.getItem(key)||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))grades=saved;}catch{}
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const persist=()=>{try{localStorage.setItem(key,JSON.stringify(grades));document.getElementById('saved').textContent='Uloženo v tomto prohlížeči';}catch{document.getElementById('saved').textContent='Místní ukládání není dostupné; použij export.';}};
document.getElementById('notice').textContent=packet.identified?'Tato stránka ukazuje jména modelů. Tvoje posouzení bude označené jako neslepé. Žádné známky zatím nejsou přijaté ani použité v huntu.':'Metadata modelů jsou skrytá. Posuzuj celý rozhovor. Pokud odpověď poznáváš, poznamenej expozici; skryté jméno samo nezaručuje nezávislost.';
document.getElementById('coverage').textContent=packet.items.length+' rozhovorů; původní sběr bez známek. Čísla, která zadáš, jsou tvoje návrhy k revizi.';
const taskSelect=document.getElementById('task');
for(const name of [...new Set(packet.items.map(i=>i.task))].sort()){const item=packet.items.find(i=>i.task===name),option=el('option',name.slice(0,2).toUpperCase()+' · '+(item.title||name));option.value=name;taskSelect.append(option);}
function render(){
 const main=document.getElementById('content');main.replaceChildren();
 const items=packet.items.filter(i=>i.task===taskSelect.value);
 if(packet.identified)items.sort((a,b)=>a.identity.model.localeCompare(b.identity.model));
 if(!items.length)return;
 main.append(el('h2','Zadání testu: '+(items[0].title||taskSelect.value)));
 for(const [index,turn] of (items[0].input.conversationTurns||[]).entries()){
  const div=el('div',undefined,'turn');div.append(el('h3','Dotaz '+(index+1)),el('div',turn.content,'text'));main.append(div);
 }
 main.append(el('p','Další dotazy navazovaly na skutečnou předchozí odpověď daného modelu. Známkuj celý dialog, nikoli pouze závěrečný tah.','notice'));
 const cards=el('div',undefined,'cards');main.append(cards);
 for(const [index,item] of items.entries()){
  const card=el('section',undefined,'card');card.dataset.id=item.id;cards.append(card);
  const title=packet.identified?item.identity.model:'Odpověď '+(index+1);
  card.append(el('h2',title),el('p','Záznam '+item.id.slice(0,8)+' · '+item.captureStatus,'muted'));
  const transcript=item.conversation?.transcript||[{role:'assistant',content:item.response}];
  let turn=0;
  for(const message of transcript){
   if(message.role==='user'){turn++;continue;}
   const div=el('div',undefined,'turn');div.append(el('h3','Odpověď na dotaz '+turn),el('div',message.content,'text'));card.append(div);
  }
  if(item.captureStatus!=='CAPTURED')card.append(el('p','Neúplný sběr – nevydávej obsahovou nulu. '+(item.error||''),'notice'));
  const source=el('details');source.append(el('summary','Referenční fakta a pravidla pro posouzení'),el('pre',JSON.stringify(item.gradingContext,null,2)));card.append(source);
  const state=grades[item.id]||(grades[item.id]={criteria:{},note:'',exposure:false});
  card.append(el('h3','Moje hodnocení'),el('p','Každé kritérium 0–1, včetně mezihodnot. Prázdné pole znamená nerozhodnuto. Formát je samostatná osa.','muted'));
  const total=el('p','Zatím neohodnoceno','status');card.append(total);
  const weights=item.gradingContext?.policy?.weightsDraft||{};
  card.append(el('p','Navržené váhy z rubriky: '+JSON.stringify(weights)+'. Nejde o přijaté váhy huntu.','muted'));
  const refresh=()=>{const criteria=item.criteria||[],values=criteria.map(c=>state.criteria[c.id]?.score);const count=values.filter(v=>typeof v==='number').length;const weightSum=criteria.reduce((n,c)=>n+(weights[c.axis]||0),0);const validWeights=criteria.every(c=>Number.isFinite(weights[c.axis])&&weights[c.axis]>0);total.textContent=count===values.length&&count&&validWeights?'Návrh obsahové známky dle vah rubriky: '+(criteria.reduce((n,c,i)=>n+values[i]*weights[c.axis],0)/weightSum).toFixed(3)+' / 1':'Ohodnoceno '+count+' / '+values.length+' kritérií; souhrnná známka zatím neurčena';};
  for(const criterion of item.criteria||[]){
   const current=state.criteria[criterion.id]||(state.criteria[criterion.id]={score:null,reason:''});
   const box=el('div',undefined,'criterion');box.append(el('strong',criterion.id+' · '+criterion.axis),el('p',criterion.requirement));
   const detail=el('details');detail.append(el('summary','Co doložit a co do kritéria nepatří'),el('pre',JSON.stringify({evidence:criterion.evidence,excludes:criterion.excludes},null,2)));box.append(detail);
   const label=el('label','Známka 0–1 '),input=el('input');input.type='number';input.min='0';input.max='1';input.step='0.01';input.value=current.score??'';input.setAttribute('aria-label','Známka '+criterion.id);label.append(input);box.append(label);
   const reason=el('textarea');reason.placeholder='Důvod, konkrétní chyba nebo chybějící důkaz. Pro sporné kritérium nech známku prázdnou a vysvětli problém.';reason.value=current.reason;reason.setAttribute('aria-label','Důvod '+criterion.id);box.append(reason);
   input.oninput=()=>{const n=Number(input.value);current.score=input.value!==''&&input.validity.valid&&Number.isFinite(n)?n:null;refresh();persist();};
   reason.oninput=()=>{current.reason=reason.value;persist();};card.append(box);
  }
  if(item.formatCriteria?.length){
   const label=el('label','Samostatné dodržení formátu 0–1 '),input=el('input');input.type='number';input.min='0';input.max='1';input.step='0.01';input.value=state.formatScore??'';
   input.oninput=()=>{state.formatScore=input.value!==''&&input.validity.valid?Number(input.value):null;persist();};label.append(input);card.append(label,el('p',item.formatCriteria.join(' · '),'muted'));
   const reason=el('textarea');reason.placeholder='Důvod samostatné známky formátu';reason.value=state.formatReason||'';reason.oninput=()=>{state.formatReason=reason.value;persist();};card.append(reason);
  }
  const note=el('textarea');note.placeholder='Celkový dojem, vadné zadání, výhrada nebo preference. Nemění se tím automaticky váhy huntu.';note.value=state.note;note.oninput=()=>{state.note=note.value;persist();};card.append(note);
  const label=el('label'),check=el('input');check.type='checkbox';check.checked=state.exposure;check.onchange=()=>{state.exposure=check.checked;persist();};label.append(check,document.createTextNode(' Odpověď nebo identitu poznávám z dřívějška'));card.append(label);refresh();
 }
}
taskSelect.onchange=render;render();
document.getElementById('export').onclick=()=>{
 const error=document.getElementById('error');error.textContent='';
 for(const [id,g] of Object.entries(grades))for(const [criterion,c] of Object.entries(g.criteria||{})){
  if(c.score!==null && (!Number.isFinite(c.score)||c.score<0||c.score>1||!c.reason.trim())){error.textContent='Doplň důvod ke každé známce: '+id.slice(0,8)+' / '+criterion;return;}
 }
 for(const [id,g] of Object.entries(grades))if(g.formatScore!=null&&!g.formatReason?.trim()){error.textContent='Doplň důvod známky formátu: '+id.slice(0,8);return;}
 const result={schemaVersion:1,reviewSha256:packet.reviewSha256,itemIds:packet.items.map(i=>i.id),status:'DRAFT',createdAt:new Date().toISOString(),decisionAuthority:false,blindToIdentity:!packet.identified,independenceNotAttested:true,grades};
 const blob=new Blob([JSON.stringify(result,null,2)],{type:'application/json'}),a=el('a');a.href=URL.createObjectURL(blob);a.download='chat-pilot-review-DRAFT.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
 document.getElementById('saved').textContent='Exportováno jako návrh; do produkce se nic neimportovalo.';
};
</script></html>`;
}
