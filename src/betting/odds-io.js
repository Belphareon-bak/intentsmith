// Core-only adapter. Keys never cross the specialist capability or stored URL.
const LEAGUE_SLUGS={E0:'england-premier-league',D1:'germany-bundesliga',I1:'italy-serie-a',SP1:'spain-la-liga',F1:'france-ligue-1'};
export const CZECH_BOOKMAKERS=Object.freeze(['Tipsport.cz','Chance.cz','iFortuna CZ','Betano CZ']);
const error=code=>Object.assign(new Error(code),{code:'PROVIDER_ERROR'});
export async function fetchOddsIO(request,{key,getJSON,now}={}) {
  if(typeof key!=='string'||!key)throw error('ODDS_IO_KEY_REQUIRED: host potřebuje API klíč Odds-API.io.');
  if(!/^[A-Za-z0-9_-]{1,256}$/.test(key))throw error('ODDS_IO_KEY_INVALID');
  if(Object.keys(request).sort().join(',')!=='bookmakers,from,kind,leagues,to'||request.kind!=='live'
    ||!Array.isArray(request.leagues)||!request.leagues.length||request.leagues.length>5||new Set(request.leagues).size!==request.leagues.length||request.leagues.some(x=>!LEAGUE_SLUGS[x])
    ||!Array.isArray(request.bookmakers)||!request.bookmakers.length||request.bookmakers.length>4||new Set(request.bookmakers).size!==request.bookmakers.length||request.bookmakers.some(x=>!CZECH_BOOKMAKERS.includes(x))
    ||!Number.isFinite(Date.parse(request.from))||!Number.isFinite(Date.parse(request.to))||Date.parse(request.from)<Date.parse(now)-120000||Date.parse(request.to)<=Date.parse(request.from)||Date.parse(request.to)-Date.parse(request.from)>30*86400000)throw error('ODDS_IO_SCOPE_INVALID');
  const sources=[];
  async function get(endpoint,query,resource) {
    const url=new URL('https://api.odds-api.io/v3/'+endpoint);for(const [k,v] of Object.entries(query))url.searchParams.set(k,v);
    const response=await getJSON(url,resource,key);sources.push(response.sourceRef);return JSON.parse(response.content);
  }
  const catalog=await get('bookmakers',{},'odds-io:bookmakers');
  if(!Array.isArray(catalog)||catalog.length>2000)throw error('ODDS_IO_CATALOG_INVALID');
  if(request.bookmakers.some(name=>!catalog.some(b=>b.name===name&&b.active===true)))throw error('ODDS_IO_BOOKMAKER_UNAVAILABLE');
  const events=[],seen=new Set();
  for(const league of request.leagues){
    let complete=false;
    for(let skip=0;skip<=400;skip+=100){
      const batch=await get('events',{apiKey:key,sport:'football',league:LEAGUE_SLUGS[league],status:'pending',from:request.from,to:request.to,limit:'100',skip:String(skip)},`odds-io:events:${league}:${request.from}:${request.to}:${skip}`);
      if(!Array.isArray(batch)||batch.length>100)throw error('ODDS_IO_EVENTS_INVALID');
      for(const e of batch){if(!Number.isSafeInteger(e.id)||e.id<=0||seen.has(e.id)||e.league?.slug!==LEAGUE_SLUGS[league]||e.sport?.slug!=='football')throw error('ODDS_IO_EVENT_SCOPE_MISMATCH');seen.add(e.id);events.push(e);}
      if(batch.length<100){complete=true;break;}
    }
    if(!complete||events.length>500)throw error('ODDS_IO_EVENT_LIMIT: zúž ligy nebo období.');
  }
  const odds=[];
  for(let i=0;i<events.length;i+=10){const ids=events.slice(i,i+10).map(e=>e.id);const batch=await get('odds/multi',{apiKey:key,eventIds:ids.join(','),bookmakers:request.bookmakers.join(',')},`odds-io:odds:${ids.join(',')}:${request.bookmakers.join(',')}`);
    if(!Array.isArray(batch)||batch.length>ids.length||new Set(batch.map(e=>e.id)).size!==batch.length||batch.some(e=>!ids.includes(e.id)))throw error('ODDS_IO_ODDS_SCOPE_MISMATCH');odds.push(...batch);}
  return {content:JSON.stringify({events,odds}),sourceRefs:sources,observedAt:sources.at(-1)?.retrievedAt??now,complete:odds.length===events.length};
}
