// Provider-specific parsing. The host supplies exact bytes and retrieval metadata.
import { digest } from '../engine/tickets.js';
export const LEAGUES=Object.freeze(['E0','D1','I1','SP1','F1']);
export function parseCSV(text) {
  if(typeof text!=='string'||text.length>4_000_000) throw new Error('CSV_SIZE_INVALID');
  text=text.replace(/^\uFEFF/,'');
  const rows=[];let row=[],field='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;}
    else if(c==='"'){if(field||closed)throw new Error('CSV_QUOTE_INVALID');quoted=true;}
    else if(c===','||c==='\n'||c==='\r'){row.push(field);field='';closed=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v!==''))rows.push(row);row=[];}}
    else {if(closed)throw new Error('CSV_TRAILING_QUOTE_DATA');field+=c;}
  }
  if(quoted)throw new Error('CSV_UNCLOSED_QUOTE');
  if(field||row.length){row.push(field);if(row.some(v=>v!==''))rows.push(row);}
  const headers=rows.shift();
  if(!headers||headers.length<5||new Set(headers.filter(Boolean)).size!==headers.filter(Boolean).length)throw new Error('CSV_HEADER_INVALID');
  for(const key of ['Div','Date','HomeTeam','AwayTeam'])if(!headers.includes(key))throw new Error('CSV_HEADER_MISSING');
  return rows.map(r=>{if(r.length>headers.length||r.slice(0,5).some(v=>v.length>200))throw new Error('CSV_ROW_INVALID');return Object.fromEntries(headers.flatMap((h,i)=>h?[[h,r[i]??'']]:[]));});
}
// Provider wall time is UK time. Require a unique IANA mapping at DST edges.
export function ukInstant(date,time,{dateOnly=false}={}) {
  const m=/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(date),t=/^(\d{2}):(\d{2})$/.exec(time??'');
  if(!m||(!t&&!dateOnly)) throw new Error('PROVIDER_KICKOFF_MISSING');
  const year=m[3].length===2?2000+Number(m[3]):Number(m[3]),month=Number(m[2]),day=Number(m[1]),h=t?Number(t[1]):12,minute=t?Number(t[2]):0;
  const base=Date.UTC(year,month-1,day,h,minute),d=new Date(base);
  if(year<2000||year>2100||d.getUTCMonth()!==month-1||d.getUTCDate()!==day||h>23||minute>59)throw new Error('PROVIDER_DATE_INVALID');
  const format=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const candidates=[base,base-3600000].filter(ms=>{
    const p=Object.fromEntries(format.formatToParts(ms).map(x=>[x.type,x.value]));return Number(p.year)===year&&Number(p.month)===month&&Number(p.day)===day&&Number(p.hour)===h&&Number(p.minute)===minute;
  });
  if(candidates.length!==1)throw new Error('PROVIDER_TIME_AMBIGUOUS');
  return new Date(candidates[0]).toISOString();
}
export function historyRecords(text,{league}={}) {
  const rows=parseCSV(text),seen=new Set(),records=[];
  for(const r of rows){
    if(r.Div!==league)throw new Error('PROVIDER_LEAGUE_MISMATCH');
    if(!r.HomeTeam||!r.AwayTeam||r.HomeTeam===r.AwayTeam)throw new Error('PROVIDER_TEAMS_INVALID');
    if(r.FTHG===''&&r.FTAG==='')continue;
    if(!/^\d+$/.test(r.FTHG)||!/^\d+$/.test(r.FTAG))throw new Error('PROVIDER_SCORE_INVALID');
    const homeGoals=Number(r.FTHG),awayGoals=Number(r.FTAG);
    if(r.FTR!==(homeGoals>awayGoals?'H':homeGoals===awayGoals?'D':'A'))throw new Error('PROVIDER_RESULT_MISMATCH');
    const kickoffAt=ukInstant(r.Date,r.Time,{dateOnly:true}),id=digest([r.Div,r.Date,r.HomeTeam,r.AwayTeam]);
    if(seen.has(id))throw new Error('PROVIDER_DUPLICATE_MATCH');seen.add(id);
    records.push({id,league:r.Div,kickoffAt,home:r.HomeTeam,away:r.AwayTeam,homeGoals,awayGoals,
      odds:['H','D','A'].map(s=>Number(r['B365'+s])),oddsColumn:'B365-pre-closing',timePrecision:r.Time?'minute':'date'});
  }
  return records;
}
export function fixturesSnapshot(text,{now,sourceRef,leagues=LEAGUES,bookmakerIds=['bet365-reference']}={}) {
  const events=[],seen=new Set();
  for(const r of parseCSV(text)) {
    if(!leagues.includes(r.Div))continue;
    if(!r.HomeTeam||!r.AwayTeam||r.HomeTeam===r.AwayTeam)throw new Error('PROVIDER_TEAMS_INVALID');
    const id='fd:'+digest([r.Div,r.Date,r.HomeTeam,r.AwayTeam]);
    if(seen.has(id))throw new Error('PROVIDER_DUPLICATE_MATCH');seen.add(id);
    const kickoffAt=ukInstant(r.Date,r.Time),markets=[];
    // A quoted bookmaker is a single coherent book. Max/Avg and exchange prices
    // are intentionally excluded: maxima are not an executable accumulator.
    const books={'bet365-reference':'B365','betfred-reference':'BFD','bwin-reference':'BW','paddypower-reference':'PP'};
    for(const [book,prefix] of Object.entries(books)) {
      if(!bookmakerIds.includes(book))continue;
      const odds=['H','D','A'].map(s=>r[prefix+s]);
      if(odds.some(o=>!/^\d+(\.\d+)?$/.test(o)||Number(o)<=1||Number(o)>10000))continue;
      markets.push({marketId:`${id}:${book}`,kind:'1x2',period:'regulation',bookmakerId:book,region:'reference-unverified',settlementRuleId:'football-regulation-reference-v1',
        sourceUpdatedAt:null,observedAt:sourceRef.retrievedAt,availability:'open',outcomes:odds.map((o,i)=>({outcomeId:['home','draw','away'][i],decimalOdds:o}))});
    }
    events.push({eventId:id,competitionId:r.Div,sport:'football',kickoffAt,status:Date.parse(kickoffAt)>Date.parse(now)?'scheduled':'finished',home:{id:`fd:${r.Div}:${r.HomeTeam}`,name:r.HomeTeam},away:{id:`fd:${r.Div}:${r.AwayTeam}`,name:r.AwayTeam},dependencyGroups:[],markets});
  }
  return {contract:'BettingSnapshot',version:2,snapshotId:'fd:'+sourceRef.sha256,generatedAt:now,dataMode:'delayed',
    source:{id:'football-data.co.uk',version:'fixtures-csv-v1'},coverage:{complete:false,scope:'Veřejné referenční kurzy; pokrytí pěti lig a jednotlivých kanceláří podle CSV. Čas pořízení konkrétního kurzu neznámý; nejde o potvrzenou nabídku pro ČR.'},events};
}
