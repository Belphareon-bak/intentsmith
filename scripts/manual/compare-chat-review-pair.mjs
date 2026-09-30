// Compare frozen external drafts, not grader acceptance or a role decision.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compareHuntBlindReviews } from '../verify-hunt-blind-review.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const mean = values => values.length ? values.reduce((a,b)=>a+b,0)/values.length : null;
const axes = ['factual','usefulness','conversation','communication'];
// Same descriptive weights as the frozen first assessment. Not an acceptance.
const weights = [.4,.3,.2,.1];
const weighted = values => values.some(v=>v===null) ? null : values.reduce((s,v,i)=>s+v*weights[i],0);
const escape = text => String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const percent = value => value === null ? '—' : (Math.round(value*10000+1e-8)/100).toFixed(2)+' %';

export function compareChatPair({packetBytes,first,second,identities,firstConfidence}) {
  const comparison=compareHuntBlindReviews(packetBytes,first,second);
  const packet=JSON.parse(packetBytes);
  if(identities.packetSha256!==comparison.packetSha256 || identities.cases.length!==packet.cases.length
    || new Set(identities.cases.map(c=>c.id)).size!==packet.cases.length)
    throw Error('CHAT_COMPARISON_IDENTITY_MISMATCH');
  if(firstConfidence && firstConfidence.packetSha256!==comparison.packetSha256)
    throw Error('CHAT_COMPARISON_CONFIDENCE_MISMATCH');
  const keys=new Map(identities.cases.map(c=>[c.id,c])),a=new Map(first.cases.map(c=>[c.id,c])),
    b=new Map(second.cases.map(c=>[c.id,c]));
  const confidence=new Map((firstConfidence?.cases || []).map(c=>[c.id,c.confidence]));
  const expand=prefix=>{
    const ids=packet.cases.filter(c=>c.id.startsWith(prefix)).map(c=>c.id);
    if(ids.length!==1)throw Error('CHAT_COMPARISON_AMBIGUOUS_ID');return ids[0];
  };
  const secondMedium=new Map(Object.entries(second.confidence?.medium || {}).map(([id,why])=>[expand(id),why]));
  const secondRisks=new Map((second.riskyOutputs || []).map(r=>[expand(r.id),r]));
  let exact=0;
  const cases=packet.cases.map(c=>{
    if(!keys.has(c.id) || c.rubric.length!==4 || c.rubric.some((r,i)=>!r.includes(`[${axes[i]}]`)))
      throw Error('CHAT_COMPARISON_CASE_CONTRACT');
    const reasons=[],disputes=comparison.disputes.filter(d=>d.id===c.id);
    if(disputes.length)reasons.push({kind:'DISAGREEMENT',detail:disputes.map(d=>d.criterion)});
    if(secondMedium.has(c.id))reasons.push({kind:'SECOND_MEDIUM_CONFIDENCE',detail:secondMedium.get(c.id)});
    if(confidence.get(c.id)?.some(x=>x<=.75))reasons.push({kind:'FIRST_LOWER_CONFIDENCE',detail:confidence.get(c.id)});
    if(secondRisks.has(c.id))reasons.push({kind:'REPORTED_RISK_NOT_YET_ADJUDICATED',detail:secondRisks.get(c.id)});
    a.get(c.id).ratings.forEach((v,i)=>{if(v!==null && v===b.get(c.id).ratings[i])exact++;});
    return {...c,model:keys.get(c.id).model,digestSha256:keys.get(c.id).digestSha256,
      first:a.get(c.id),second:b.get(c.id),firstWeighted:weighted(a.get(c.id).ratings),
      secondWeighted:weighted(b.get(c.id).ratings),priorityReasons:reasons};
  });
  // Reproducible spot check from the remaining cases; chosen after grading,
  // not a preregistered independent acceptance sample.
  const sampleSeed=hash(comparison.packetSha256+'post-review-spot-check-v1');
  const random=cases.filter(c=>!c.priorityReasons.length).sort((a,b)=>
    hash(sampleSeed+a.id).localeCompare(hash(sampleSeed+b.id))).slice(0,3);
  random.forEach(c=>c.priorityReasons.push({kind:'POST_REVIEW_HASH_SAMPLE',detail:sampleSeed}));
  const models=[...new Set(cases.map(c=>c.model))].sort().map(model=>{
    const rows=cases.filter(c=>c.model===model);
    if(new Set(rows.map(c=>c.digestSha256)).size!==1)throw Error('CHAT_COMPARISON_MIXED_DIGESTS');
    return {model,digestSha256:rows[0].digestSha256,dialogs:rows.length,
      first:{weighted:mean(rows.map(c=>c.firstWeighted)),unweighted:mean(rows.flatMap(c=>c.first.ratings))},
      second:{weighted:mean(rows.map(c=>c.secondWeighted)),unweighted:mean(rows.flatMap(c=>c.second.ratings))},
      axes:Object.fromEntries(axes.map((axis,i)=>[axis,{first:mean(rows.map(c=>c.first.ratings[i])),second:mean(rows.map(c=>c.second.ratings[i]))}])),
      languages:Object.fromEntries(['cs','en'].map(lang=>[lang,{dialogs:rows.filter(c=>c.task.startsWith(lang+'_')).length,
        first:mean(rows.filter(c=>c.task.startsWith(lang+'_')).map(c=>c.firstWeighted)),
        second:mean(rows.filter(c=>c.task.startsWith(lang+'_')).map(c=>c.secondWeighted))}]))};
  });
  // Refuse to hide missing criteria in any average.
  if(comparison.taskIssueCriteria)throw Error('CHAT_COMPARISON_UNSCORED_CRITERIA');
  return {status:'TWO_REAL_EXTERNAL_DRAFTS_NOT_ADJUDICATED',decisionAuthority:false,simulation:false,
    packetSha256:comparison.packetSha256,providerVersion:packet.providerVersion,clockLocalDate:packet.clockLocalDate,
    weights:Object.fromEntries(axes.map((axis,i)=>[axis,weights[i]])),comparison,exactCriteria:exact,models,cases,
    priorityCases:cases.filter(c=>c.priorityReasons.length).map(c=>c.id),
    sample:{method:'SHA256 order among unflagged answers, selected after review',seed:sampleSeed,ids:random.map(c=>c.id)},
    limitations:['No merged final score; neither review has decision authority.',
      'Reviewers disclosed exposure; agreement is not blind fresh-holdout acceptance.',
      'Original packet omitted shared policy. Criterion attribution and correction-timing disputes remain explicit.',
      'Two languages share 20 authored groups. No new confidence interval or role recommendation is inferred.']};
}

export function renderChatComparison(report) {
  return `<!doctype html><html lang="cs"><meta charset="utf-8"><title>CHAT · dva skutečné posudky</title>
<style>body{font:16px/1.5 system-ui;max-width:1200px;margin:24px auto;background:#151515;color:#eee;padding:20px}table{border-collapse:collapse;width:100%}td,th{padding:10px;border:1px solid #555;text-align:left}article{border:1px solid #777;margin:28px 0;padding:18px}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{padding:10px;margin:6px}a{color:#f3c780}.priority{color:#ffd58a}summary{cursor:pointer}</style>
<h1>CHAT · skutečný Codex a skutečný Opus</h1><p>80 dialogů / 320 kritérií u každého hodnotitele. Původní známky bez přepisu; žádné finální sloučené skóre, produkční výběr NO_GO. Datum sběru ${escape(report.clockLocalDate)}.</p>
<p>Shoda do 0,25: ${report.comparison.withinQuarter}/320. Větších rozdílů: ${report.comparison.disagreementAboveQuarter}. Priorita: ${report.priorityCases.length} odpovědí včetně tří mechanicky vybraných kontrol. Důvod je vždy uveden. Celé odpovědi jsou dostupné u všech 80 případů.</p>
<table><tr><th>Model</th><th>Codex · vážené</th><th>Opus · vážené</th><th>Počet</th></tr>${report.models.map(m=>`<tr><td>${escape(m.model)}</td><td>${percent(m.first.weighted)}</td><td>${percent(m.second.weighted)}</td><td>${m.dialogs}</td></tr>`).join('')}</table>
<p>Váhy 40/30/20/10 %. Jde o dva samostatné posudky stejného sběru, nikoli přijaté pořadí modelů. <a href="comparison.json">Úplná data a expozice</a> · <a href="adjudication-proposals.md">Rozbor sporů</a></p>
<button onclick="document.querySelectorAll('article').forEach(a=>a.hidden=a.dataset.priority!=='yes')">Jen prioritní odpovědi</button><button onclick="document.querySelectorAll('article').forEach(a=>a.hidden=false)">Všech 80 odpovědí</button>
${report.cases.map(c=>`<article id="${c.id}" data-priority="${c.priorityReasons.length?'yes':'no'}" ${c.priorityReasons.length?'':'hidden'}><h2>${escape(c.task)} → ${escape(c.model)}</h2><p>${c.id} · Codex ${percent(c.firstWeighted)} · Opus ${percent(c.secondWeighted)}</p>
<p class="priority">${escape(JSON.stringify(c.priorityReasons))}</p><details><summary>Dotaz → celá odpověď modelu</summary><pre>${escape(c.response)}</pre></details>
<table><tr><th>Kritérium</th><th>Codex</th><th>Opus</th></tr>${c.rubric.map((r,i)=>`<tr><td>${escape(r)}</td><td><b>${percent(c.first.ratings[i])}</b><p>${escape(c.first.reasons[i])}</p></td><td><b>${percent(c.second.ratings[i])}</b><p>${escape(c.second.reasons[i])}</p></td></tr>`).join('')}</table></article>`).join('')}</html>`;
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--') || !args[i+1])throw Error('ARGUMENTS');options[args[i].slice(2)]=resolve(args[i+1]);}
  const source={};
  for(const name of ['packet','first','second','identities','confidence']){
    const path=options[name];if(!path)throw Error('REQUIRED:'+name);
    const bytes=readFileSync(path);source[name]={path,sha256:hash(bytes),bytes};
  }
  const report=compareChatPair({packetBytes:source.packet.bytes,first:JSON.parse(source.first.bytes),
    second:JSON.parse(source.second.bytes),identities:JSON.parse(source.identities.bytes),firstConfidence:JSON.parse(source.confidence.bytes)});
  report.sources=Object.fromEntries(Object.entries(source).map(([key,{path,sha256}])=>[key,{path,sha256}]));
  mkdirSync(options.out,{mode:0o700});
  const save=(name,value)=>writeFileSync(join(options.out,name),value,{flag:'wx',mode:0o600});
  save('comparison.json',JSON.stringify(report,null,2)+'\n');save('comparison.html',renderChatComparison(report));
  console.log(JSON.stringify({models:report.models,compared:report.comparison.comparedCriteria,
    exact:report.exactCriteria,withinQuarter:report.comparison.withinQuarter,disputes:report.comparison.disagreementAboveQuarter,
    priorityCases:report.priorityCases.length}));
}
