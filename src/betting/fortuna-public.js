// Public requests observed in Fortuna's anonymous website on 2026-09-12.
// No login, cookie, credential, browser, or bet placement is involved.
const TOURS={E0:'00-03m',D1:'00-0c6',I1:'00-06t',SP1:'00-0h7',F1:'00-0bo'};
const fixtureId=id=>typeof id==='string'&&/^ufo:mtch:[a-z0-9]{1,8}-[a-z0-9]{1,8}$/.test(id);
const fail=message=>{throw Object.assign(new Error(message),{code:'PROVIDER_ERROR'});};
const instant=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
function identity(e){return JSON.stringify([e.id,e.sportId,e.categoryId,e.tournamentId,e.name,e.kind,e.status,e.startDatetime,e.hasMarkets,...(e.participants??[]).map(p=>[p.type,p.id,p.name]).sort((a,b)=>a[0].localeCompare(b[0]))]);}
export async function fetchFortunaPublic(request,{getJSON,now}={}) {
  if(!request||Object.keys(request).sort().join(',')!=='from,kind,leagues,to'||request.kind!=='fortuna_public'
    ||!Array.isArray(request.leagues)||!request.leagues.length||request.leagues.length>5||new Set(request.leagues).size!==request.leagues.length||request.leagues.some(l=>!Object.hasOwn(TOURS,l))
    ||!instant(request.from)||!instant(request.to)||Date.parse(request.from)<Date.parse(now)-120000||Date.parse(request.to)<=Date.parse(request.from)||Date.parse(request.to)-Date.parse(request.from)>30*86400000)fail('FORTUNA_PUBLIC_SCOPE_INVALID');
  const sourceRefs=[],listings=[],selected=[],seen=new Set();
  async function get(suffix,resource){const r=await getJSON(new URL('https://api.ifortuna.cz/offer/'+suffix),resource);sourceRefs.push(r.sourceRef);let data;try{data=JSON.parse(r.content);}catch{fail('FORTUNA_PUBLIC_SCHEMA_CHANGED');}return {data,sourceRef:r.sourceRef};}
  function validateListing(data,league){
    const tour='ufo:tour:'+TOURS[league];
    if(!data||data.tournament?.id!==tour||data.tournament.sportId!=='ufo:sprt:00'||!Array.isArray(data.fixtures)||data.fixtures.length>200)fail('FORTUNA_PUBLIC_LISTING_INVALID');
    const ids=new Set();for(const e of data.fixtures){
      if(!fixtureId(e.id)||ids.has(e.id)||e.sportId!=='ufo:sprt:00'||e.tournamentId!==tour||e.categoryId!==data.tournament.categoryId||!Number.isSafeInteger(e.startDatetime)||!Array.isArray(e.participants)||e.participants.length!==2)fail('FORTUNA_PUBLIC_EVENT_INVALID');
      ids.add(e.id);
      if(new Set(e.participants.map(p=>p.type)).size!==2||e.participants.some(p=>!['HOME','AWAY'].includes(p.type)||typeof p.id!=='string'||!/^ufo:team:[a-z0-9-]{1,24}$/.test(p.id)||typeof p.name!=='string'||!p.name||p.name.length>200)||e.participants[0].id===e.participants[1].id)fail('FORTUNA_PUBLIC_PARTICIPANT_INVALID');
    }
  }
  for(const league of request.leagues){
    const suffix=`structure/api/v1_0/tournament/ufo:tour:${TOURS[league]}/matches?timeFilter=all`;
    const {data,sourceRef}=await get(suffix,`fortuna-public:fixtures:${league}`);validateListing(data,league);
    listings.push({league,data,sourceRef});
    for(const e of data.fixtures){if(seen.has(e.id))fail('FORTUNA_PUBLIC_DUPLICATE_EVENT');seen.add(e.id);
      if(e.kind==='PREMATCH'&&e.status==='ACTIVE'&&e.hasMarkets===true&&e.startDatetime>=Date.parse(request.from)+300000&&e.startDatetime<=Date.parse(request.to))selected.push({league,event:e});}
  }
  if(selected.length>100)fail('FORTUNA_PUBLIC_EVENT_LIMIT: zúž ligy nebo období.');
  const batches=[];
  for(let i=0;i<selected.length;i+=10){
    const ids=selected.slice(i,i+10).map(x=>x.event.id);
    const suffix='markets/api/v1_0/fixtures/markets/overview?'+ids.map(id=>'fixtureIds='+encodeURIComponent(id)).join('&');
    const {data,sourceRef}=await get(suffix,'fortuna-public:markets:'+ids.join(','));
    if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(id=>!ids.includes(id))||Object.values(data).some(ms=>!Array.isArray(ms)||ms.length>50))fail('FORTUNA_PUBLIC_MARKET_SCOPE_MISMATCH');
    batches.push({ids,data,sourceRef});
  }
  // Re-read the schedule after prices. A postponement or identity change must
  // not pair a former fixture with a newer market. Do not invent replacements.
  const confirmations=[];
  for(const listing of listings){
    if(!selected.some(s=>s.league===listing.league))continue;
    const {data,sourceRef}=await get(`structure/api/v1_0/tournament/ufo:tour:${TOURS[listing.league]}/matches?timeFilter=all`,`fortuna-public:confirm:${listing.league}`);
    validateListing(data,listing.league);
    for(const {event} of selected.filter(s=>s.league===listing.league)){const fresh=data.fixtures.find(e=>e.id===event.id);if(!fresh||identity(fresh)!==identity(event))fail('FORTUNA_PUBLIC_IDENTITY_CHANGED: nabídka zápasu se během načítání změnila.');}
    confirmations.push({league:listing.league,data,sourceRef});
  }
  return {content:JSON.stringify({listings,selected,batches,confirmations}),sourceRefs};
}
