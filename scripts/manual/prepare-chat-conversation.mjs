// Preparation only. There is deliberately no --run or provider dependency.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { CHAT_CONVERSATION_FIXTURE as fixture, chatConversationDraft as suite, chatConversationDraftSha256 } from '../../src/eval/chat-conversation-suite.js';
const args=process.argv.slice(2), opts={};
if (!args.length || args.includes('--help')) {
  console.log('Prepare bilingual prompts, rubric and bounded collection proposal. No inference.\n--out /new/directory --identities /historical-identity-key.json');process.exit(0);
}
if(args.length!==4)throw Error('INVALID_ARGUMENTS');
for(let i=0;i<args.length;i+=2){const k=args[i].slice(2);if(!['out','identities'].includes(k)||opts[k]||!isAbsolute(args[i+1]))throw Error('INVALID_ARGUMENTS');opts[k]=args[i+1];}
if(!opts.out || !opts.identities)throw Error('INVALID_ARGUMENTS');
const raw=readFileSync(opts.identities), identities=JSON.parse(raw), models=new Map();
// The historical CODE panel is the ten text-capable candidates previously
// compared in CHAT as well. No claim that these artifacts remain installed.
for(const id of Object.values(identities)){
  if(!id.model || !id.artifact?.digestSha256)throw Error('INVALID_IDENTITY');
  if(['llava-llama3:8b','llava:13b'].includes(id.model))continue;
  const prior=models.get(id.model);
  if(prior && prior.digestSha256!==id.artifact.digestSha256)throw Error('PANEL_ARTIFACT_AMBIGUOUS');
  models.set(id.model,id.artifact);
}
const pilotNames=['qwen3.8:latest','phi4:14b'];
for(const m of pilotNames)if(!models.has(m))throw Error('PILOT_IDENTITY_MISSING');
const quickGroups=['corrected_project','offline_diagnosis','time_explanation','quoted_injection','tone_rewrite','strict_json'];
function budget(names,groups,repeats,wallHours){
  const tasks=suite.tests.filter(t=>groups.includes(t.independenceGroup));
  const callsPerModelRepeat=tasks.reduce((n,t)=>n+t.prompt().conversationTurns.length,0);
  const providerCalls=names.length*repeats*callsPerModelRepeat;
  return {models:names.map(m=>({name:m,historicalArtifact:models.get(m)})),groups,repeats,
    taskVariants:tasks.length,conversations:names.length*repeats*tasks.length,providerCalls,
    maximumOutputTokens:providerCalls*2048,perCallTimeoutSeconds:300,
    sequentialTimeoutCeilingHours:providerCalls*300/3600,proposedWallClockStopHours:wallHours,
    estimatedDurationHours:null,etaReason:'New multi-turn prompt lengths and generation times are not measured.',
    resourceFloors:{freeRamGiB:6,freeEvidenceGiB:40,freeHomeGiB:40,freeTmpGiB:2},
    gpuPolicy:'One owner; recheck exact artifact, context placement and availability before every candidate. No foreign process termination.',
    onLimit:'Checkpoint partial capture; stop, do not manufacture zero quality or silently extend budget.'};
}
const plan={schemaVersion:1,status:'PREPARED_AWAITING_OPERATOR_GO',inference:false,productionImported:false,
  decisionAuthority:false,fixtureSha256:chatConversationDraftSha256,fixtureVersion:fixture.version,
  panelSource:{path:opts.identities,sha256:createHash('sha256').update(raw).digest('hex'),currentInventoryVerified:false},
  quick:{purpose:'Operator review of conversational usefulness and task adequacy, no ranking decision.',
    ...budget(pilotNames,quickGroups,1,4)},
  full:{purpose:'Comparable development capture after pilot task review, not an operational holdout.',
    ...budget([...models.keys()].sort(),fixture.scenarios.map(s=>s.id),3,24),
    continuation:{status:'IMPLEMENTED_PENDING_LIVE_PILOT',automatic:false,
      runner:'scripts/manual/collect-chat-conversation.mjs',
      initialWindowHours:24,additionalWindowHours:null,
      requires:'A separate approval names the remaining items and additional call, token and time budgets after reviewing the checkpoint.',
      freeze:['prompt/rubric hash','candidate digest and provider version','context/generation options','attempt IDs'],
      completedAttempts:'Retain without rerunning or picking better answers.',
      interruptedConversation:'Retain every partial turn and its costs. A fresh-history replacement requires a new linked attempt ID and explicit inclusion rule; never overwrite or silently omit the interrupted attempt.',
      ledger:'Cumulative calls/tokens/durations from all windows remain visible; a new window is not a budget reset.',
      onDrift:'Stop the comparable panel; do not silently combine different prompts or artifacts.',
      estimate:'Use pilot duration and context growth to propose window allocation. No measured ETA exists yet.'}},
  requiredBeforeExecution:['Operator approves exact stage, rubric version and budget.',
    'Fresh installed-artifact/VRAM/provider inventory; identity drift invalidates old panel IDs.',
    'Run scripts/manual/collect-chat-conversation.mjs through the managed provider. It enforces cumulative call/token limits and explicitly budgeted windows; this preparation command cannot execute.',
    'Bilingual semantic review of the authored pairs; independent grader acceptance remains separate.',
    'Freeze blind review inputs before disclosing model identity; both graders use the full transcript.'],
  reuse:{historicalAnswers:false,reason:'Prompts, conversational history and role-quality target changed.',
    existingTechnicalAxis:'Retain and report the old technical/format tasks separately; do not blend them into conversational usefulness.'}};
mkdirSync(opts.out); // Fail if it exists; never overwrite reviewer edits.
writeFileSync(join(opts.out,'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
writeFileSync(join(opts.out,'tasks.json'),JSON.stringify(fixture,null,2)+'\n',{flag:'wx'});
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rows=fixture.scenarios.map(s=>`<section id="${s.id}"><h2>${esc(s.title.cs)} / ${esc(s.title.en)}</h2><p>${esc(s.ability)} · skupina ${s.id}</p><table><thead><tr><th>Tah</th><th>Česky</th><th>English</th></tr></thead><tbody>${s.turns.cs.map((t,i)=>`<tr><td>${i+1}</td><td>${esc(t)}</td><td>${esc(s.turns.en[i])}</td></tr>`).join('')}</tbody></table><p>Mezi tahy se vloží skutečná odpověď právě testovaného modelu. Každé opakování začíná bez předchozí historie.</p><details><summary>Kritéria, hranice a referenční fakta pro posuzovatele</summary><pre>${esc(JSON.stringify({criteria:s.criteria,referenceChecks:s.referenceChecks,positiveFinalExample:s.positiveExample,negativeFinalExample:s.negativeExample},null,2))}</pre></details></section>`).join('');
writeFileSync(join(opts.out,'review.html'),`<!doctype html><html lang="cs"><meta charset="utf-8"><title>CHAT — návrh k revizi</title><style>body{font:16px system-ui;background:#111;color:#ddd;max-width:1300px;margin:28px auto}a{color:#e2b568}table{width:100%;border-collapse:collapse}td,th{border:1px solid #555;padding:14px;vertical-align:top;width:47%}td:first-child,th:first-child{width:6%}section{margin:35px 0}pre{white-space:pre-wrap;background:#202020;padding:16px}summary{cursor:pointer}nav{display:flex;gap:12px;flex-wrap:wrap}</style><h1>CHAT — 20 dvojic, 40 úloh, skutečná návaznost</h1><p>PREPARED_NOT_VALIDATED. Toto je návrh nového sběru, nikoli výsledek měření nebo přijatá sada. Obsahuje jediný striktní JSON scénář ve dvou jazycích. Překlady a opakování se nesmějí vydávat za další nezávislé případy.</p><nav>${fixture.scenarios.map(s=>`<a href="#${s.id}">${esc(s.title.cs)}</a>`).join('')}</nav><details><summary>Stupnice a pravidla hodnocení</summary><pre>${esc(JSON.stringify(fixture.rubricPolicy,null,2))}</pre></details><details><summary>Pilot a celý panel: rozsah, rozpočet a podmínky GO</summary><pre>${esc(JSON.stringify(plan,null,2))}</pre></details>${rows}</html>`,{flag:'wx'});
console.log(JSON.stringify({status:plan.status,quickCalls:plan.quick.providerCalls,fullCalls:plan.full.providerCalls,output:opts.out}));
