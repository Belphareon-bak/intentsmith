import { escapeMarkdown as safe } from '../engine/values.js';
const pct=p=>new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:2}).format(p*100)+' %';
const money=n=>new Intl.NumberFormat('cs-CZ',{style:'currency',currency:'CZK'}).format(n/100);
const LABELS={READY:'Návrhy tiketů',NEEDS_INPUT:'Potřebuji doplnit údaje',INVALID_REQUEST:'Neplatné zadání',INSUFFICIENT_DATA:'Nedostatek použitelných dat',MODEL_UNAVAILABLE:'Požadovaný model není dostupný',NO_SOLUTION:'V zadaném rozsahu není vyhovující tiket',SEARCH_LIMIT_REACHED:'Hledání dosáhlo limitu',CANCELLED:'Výpočet zrušen',PROVIDER_ERROR:'Datový zdroj není dostupný',INTERNAL_ERROR:'Výpočet selhal',PERSISTENCE_ERROR:'Výsledek se nepodařilo uložit'};
export function renderBettingResult(result) {
  const lines=[`**${LABELS[result.status]??'Výsledek'}**`];
  for(const error of result.errors) lines.push(`${safe(error.fieldPath??'')}: ${safe(error.message)}`);
  const prefs=result.effectivePreferences;
  const date=t=>new Intl.DateTimeFormat('cs-CZ',{timeZone:prefs?.window.timezone??'Europe/Prague',dateStyle:'short',timeStyle:'short'}).format(new Date(t));
  if(prefs) lines.push(`Okno začátků: ${date(prefs.window.from)} – ${date(prefs.window.to)} (${safe(prefs.window.timezone)}). Maximální rozestup ${prefs.window.maxSpreadHours} h.`);
  lines.push(`Data: ${result.verifiedObservation?'veřejná nabídka Fortuny načtená bez účtu a klíče; čas poslední změny kurzu neznámý':result.verifiedLive?'ověřený živý snapshot':result.dataMode==='observed'?'veřejnou nabídku se nepodařilo ověřit':result.dataMode==='delayed'?'automaticky načtená referenční nabídka; aktuální kurz v kanceláři neověřen':'import / historická nabídka, aktuální dostupnost neověřena'}.`);
  if(result.analysis?.autonomous) {
    if(result.analysis.policy) lines.push(`Pravděpodobnosti jsou tržní odhady očištěné o marži. Vlastní model z výsledků slouží k porovnání; měření zatím neprokázalo jeho přidanou hodnotu.`);
    for(const source of result.analysis.sourceRefs??[]) if(source.resource?.endsWith(':fixtures')) lines.push(`Zdroj: ${safe(source.url)}; načteno ${date(source.retrievedAt)}; soubor aktualizován ${source.lastModified?date(source.lastModified):'neznámo'}. Čas pořízení jednotlivých kurzů zdroj neuvádí.`);
    if(result.verifiedObservation){
      const quotes=(result.analysis.sourceRefs??[]).filter(s=>s.resource?.startsWith('fortuna-public:markets:')).map(s=>s.retrievedAt).sort();
      if(quotes.length)lines.push(`Kurzy načteny ${date(quotes[0])} – ${date(quotes.at(-1))}. Výběr vyprší nejpozději dvě minuty po načtení cen; spusť nový výpočet pro jejich obnovení.`);
      for(const page of result.analysis.publicSourcePages??[])lines.push(`Nabídka ${safe(page.league)}: ${safe(page.url)}`);
    }
    if(result.persistence) lines.push(`Výpočet uložen: ${safe(result.persistence.recordId)}.`);
  }
  if(prefs?.objective==='highest_probability'&&result.tickets.length) {
    lines.push('',result.search.completed?'Pořadí podle odhadované úspěšnosti v načtené nabídce:':'Pořadí dosud nalezených návrhů; hledání není dokončené:');
    if(prefs.probabilityFilter.min===0)lines.push('Bez minimálního prahu úspěšnosti.');
    lines.push('','| Pořadí | Kurz tiketu | Odhad úspěšnosti | Položek |','|---:|---:|---:|---:|');
    for(const [i,t] of result.tickets.entries())lines.push(`| ${i+1} | ${t.totalOdds} | ${pct(t.winProbability.estimate)} | ${t.selections.length} |`);
    const events=result.tickets.flatMap(t=>t.selections.map(s=>s.eventId));
    if(new Set(events).size<events.length)lines.push('','Návrhy jsou alternativy a sdílejí zápasy; nejsou nezávislými sázkami.');
  }
  for(const [i,t] of result.tickets.entries()) {
    lines.push('',`**Tiket ${i+1} — kurz ${t.totalOdds}, teoretická úspěšnost ${pct(t.winProbability.estimate)}**`,
      `Kancelář: ${safe(t.bookmakerId)} (${safe(t.region)}). ${t.selections.length} ${t.selections.length===1?'položka':t.selections.length<5?'položky':'položek'}.`,
      '', '| Zápas | Začátek | Tip | Kurz | Odhad p |','|---|---|---|---:|---:|');
    for(const s of t.selections) lines.push(`| ${safe(s.home)} – ${safe(s.away)} | ${date(s.kickoffAt)} | ${{home:'1',draw:'X',away:'2'}[s.outcomeId]} | ${s.decimalOdds} | ${pct(s.probability)} |`);
    lines.push('',`První–poslední zápas: ${date(t.window.firstKickoffAt)} – ${date(t.window.lastKickoffAt)}; rozestup ${t.window.spreadHours} h.`);
    if(t.selections.length>1) lines.push(`Meze při neznámé závislosti a stejných odhadech p: ${pct(t.winProbability.dependenceBounds.lower)} – ${pct(t.winProbability.dependenceBounds.upper)}. Nejde o interval statistické jistoty.`);
    if(t.money) lines.push(`Vklad ${money(t.money.stakeMinor)}; odhad návratnosti při výhře ${money(t.money.returnMinor)}, čistý zisk ${money(t.money.profitMinor)}; při prohře ztráta ${money(t.money.maxLossMinor)}. Odhad EV ${money(t.money.expectedProfitMinor)}.`);
    if(t.expiresAt) lines.push(`${result.verifiedObservation?'Obnovit pozorované kurzy do':'Platnost snapshotu do'} ${date(t.expiresAt)}.`);
  }
  if(result.rejections.length) {
    const counts={};for(const r of result.rejections) counts[r.code]=(counts[r.code]??0)+1;
    lines.push('',`Vyřazené nabídky: ${Object.entries(counts).map(([k,v])=>`${k}: ${v}`).join(', ')}.`);
  }
  if(result.status==='INSUFFICIENT_DATA'&&result.search.completed)lines.push('V načtené nabídce není vyhovující tiket. Pokrytí zdroje není úplné; nelze tvrdit, že neexistuje jinde.');
  if(result.status==='NO_SOLUTION') lines.push('Uprav minimální kurz nebo úspěšnost, počet položek či časové okno. Žádný limit nebyl změněn automaticky.');
  for(const a of result.alternatives) lines.push(`Samostatně přepočtená alternativa: ${safe(a.field)} → ${safe(a.value)}; ${a.found} návrhů (${safe(a.status)}). Vyžaduje nové zadání; nebyla použita automaticky.`);
  for(const warning of result.warnings) lines.push('',safe(warning));
  lines.push('','Teoretický odhad podle uvedené metody, nikoli záruka výhry. Jde o návrh; sázka nebyla podána.');
  return lines.join('\n');
}
export function exportBettingCSV(result) {
  const cell=v=>`"${String(v??'').replace(/^(?=\s*[=+@-])/,"'").replaceAll('"','""')}"`;
  const rows=[['ticket','event','home','away','kickoff_utc','bookmaker','outcome','odds','probability','snapshot']];
  for(const t of result.tickets) for(const s of t.selections) rows.push([t.ticketId,s.eventId,s.home,s.away,s.kickoffAt,t.bookmakerId,s.outcomeId,s.decimalOdds,s.probability,result.evidenceRefs[0]?.snapshotId]);
  return rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
