import { fetchOddsIO } from './odds-io.js';
import {createOutboundPolicy} from '../network/outbound-policy.js';
const LEAGUES=['E0','D1','I1','SP1','F1'];
const fail=(code)=>{throw Object.assign(new Error(code),{code});};
async function readBounded(response,limit,signal) {
  const reader=response.body?.getReader();if(!reader)fail('PROVIDER_EMPTY_BODY');let n=0;const chunks=[];
  try {while(true){signal?.throwIfAborted();const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>limit)fail('PROVIDER_SIZE_LIMIT');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks);
}
export function createBettingDataHost({store,transport,clock=Date.now,oddsIOKey=null,logger={warn(){},error(){}}}={}) {
  if(!store)throw new Error('BETTING_STORE_REQUIRED');
  const policy=createOutboundPolicy({database:store.database,logger,transport,clock,enabledSurfaces:{'betting-data':true}});
  const scopes=new WeakMap();let queue=Promise.resolve(),nextPublicRequestAt=0;
  const host=Object.freeze({
    openInvocation({extensionId,toolId,conversationId,userMessageId,signal=null,operator=false}={}) {
      if(extensionId!=='sazeni'||!/^sazeni\.(ticket_builder|odds_compare|match_analysis|value_finder)$/.test(toolId??'')||(!operator&&(!conversationId||!Number.isSafeInteger(Number(userMessageId))||Number(userMessageId)<=0)))fail('BETTING_TURN_REQUIRED');
      const token=Object.freeze(Object.create(null)),controller=new AbortController();
      const scopedSignal=signal?AbortSignal.any([signal,controller.signal,AbortSignal.timeout(120000)]):AbortSignal.any([controller.signal,AbortSignal.timeout(120000)]);
      scopes.set(token,{start:clock(),now:new Date(clock()).toISOString(),signal:scopedSignal,controller,calls:0,networkCalls:0,bytes:0,finished:false,identity:Object.freeze({extensionId,toolId,conversationId:operator?null:String(conversationId),userMessageId:operator?null:Number(userMessageId),operator}),sourceObservationIds:new Set()});return token;
    },
    closeInvocation(token){const s=scopes.get(token);if(s)s.controller.abort();return scopes.delete(token);},
    forTurn(token){return Object.freeze({liveConfigured:Boolean(oddsIOKey),get:request=>capability.get(token,request),save:record=>capability.save(token,record)});},
  });
  function state(token){const s=scopes.get(token);if(!s||s.finished)fail('BETTING_SCOPE_EXPIRED');if(s.signal.aborted)fail('CANCELLED');if(clock()-s.start>120000)fail('PROVIDER_DEADLINE');return s;}
  async function observe(s,promise){const value=await promise;for(const ref of value.sourceRefs??[value.sourceRef])if(ref?.observationId)s.sourceObservationIds.add(ref.observationId);return value;}
  const capability=Object.freeze({
    contract:'BettingDataCapability',version:1,
    async get(token,request) {
      const s=state(token);if(++s.calls>32)fail('PROVIDER_CALL_BUDGET');
      if(!request||typeof request!=='object'||Array.isArray(request))fail('PROVIDER_REQUEST_INVALID');
      if(request.kind==='live') return observe(s,fetchOddsIO(request,{key:oddsIOKey,now:s.now,getJSON:async(url,resource,key)=>{
        state(token);if(++s.networkCalls>64)fail('PROVIDER_CALL_BUDGET');
        const signal=AbortSignal.any([s.signal,AbortSignal.timeout(15000)]);
        const response=await policy.oddsIOFetch(url,{method:'GET',headers:{accept:'application/json'},signal});
        if(!response.ok){await response.body?.cancel();fail(response.status===429?'PROVIDER_RATE_LIMITED':[401,403].includes(response.status)?'PROVIDER_AUTH_OR_PLAN_REQUIRED':'PROVIDER_HTTP_'+response.status);}
        const bytes=await readBounded(response,4_000_000,signal);s.bytes+=bytes.length;if(s.bytes>16_000_000)fail('PROVIDER_BYTE_BUDGET');
        if(bytes.includes(Buffer.from(key)))fail('PROVIDER_CREDENTIAL_ECHO');state(token);
        // Query scope is in resource; the credential-bearing URL is never stored.
        return store.record(resource,url.origin+url.pathname,bytes,{retrievedAt:new Date(clock()).toISOString()});
      }}));
      let resource,remote,ttl;
      if(request.kind==='fixtures'&&Object.keys(request).join(',')==='kind'){resource='football-data:fixtures';remote='fixtures.csv';ttl=3600000;}
      else if(request.kind==='history'&&Object.keys(request).sort().join(',')==='kind,league,season'&&LEAGUES.includes(request.league)&&Number.isInteger(request.season)){
        const year=new Date(s.now).getUTCFullYear(),month=new Date(s.now).getUTCMonth(),current=(month<6?year-1:year)-2000;
        if(request.season<current-4||request.season>current)fail('PROVIDER_SEASON_OUT_OF_SCOPE');
        remote=`mmz4281/${request.season}${request.season+1}/${request.league}.csv`;resource='football-data:'+remote;ttl=86400000;
      }else fail('PROVIDER_REQUEST_INVALID');
      const cached=store.latest(resource);if(cached&&clock()-Date.parse(cached.sourceRef.retrievedAt)<ttl&&Date.parse(cached.sourceRef.retrievedAt)<=clock())return observe(s,structuredClone({...cached,sourceRef:{...cached.sourceRef,cacheHit:true}}));
      // Serialize requests across turns; no retry storm or cache freshness fiction.
      const action=queue.then(async()=>{
        state(token);
        const refreshed=store.latest(resource);if(refreshed&&clock()-Date.parse(refreshed.sourceRef.retrievedAt)<ttl&&Date.parse(refreshed.sourceRef.retrievedAt)<=clock())return structuredClone({...refreshed,sourceRef:{...refreshed.sourceRef,cacheHit:true}});
        const delay=Math.max(0,nextPublicRequestAt-clock());
        if(delay)await new Promise((resolve,reject)=>{const finish=()=>{s.signal.removeEventListener('abort',abort);resolve();},timer=setTimeout(finish,Math.min(delay,1000)),abort=()=>{clearTimeout(timer);s.signal.removeEventListener('abort',abort);reject(Object.assign(new Error('CANCELLED'),{code:'CANCELLED'}));};s.signal.addEventListener('abort',abort,{once:true});if(s.signal.aborted)abort();});
        state(token);nextPublicRequestAt=clock()+750;
        if(++s.networkCalls>64)fail('PROVIDER_CALL_BUDGET');
        const url='https://www.football-data.co.uk/'+remote;
        const signal=AbortSignal.any([s.signal,AbortSignal.timeout(15000)]);
        const response=await policy.footballDataFetch(url,{method:'GET',headers:{accept:'text/csv'},signal});
        if(!response.ok){await response.body?.cancel();fail(response.status===429?'PROVIDER_RATE_LIMITED':'PROVIDER_HTTP_'+response.status);}
        const bytes=await readBounded(response,4_000_000,signal);s.bytes+=bytes.length;if(s.bytes>16_000_000)fail('PROVIDER_BYTE_BUDGET');
        if(!bytes.subarray(0,3000).includes(Buffer.from('HomeTeam')))fail('PROVIDER_SCHEMA_CHANGED');
        state(token);
        return store.record(resource,url,bytes,{retrievedAt:new Date(clock()).toISOString(),lastModified:response.headers.get('last-modified')});
      });queue=action.catch(()=>{});return observe(s,action);
    },
    async save(token,record){const s=state(token);if(!record||record.contract!=='BettingAnalysisEvidence'||record.version!==1)fail('PERSISTENCE_ERROR');const id=store.recordRun({...record,hostInvocation:{...s.identity,startedAt:s.now,sourceObservationIds:[...s.sourceObservationIds]}});s.finished=true;return id;},
  });
  return Object.freeze({host,capability,diagnostics:()=>policy.summary()});
}
