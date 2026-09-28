import {digest} from '../../specialists/sazeni/engine/tickets.js';
import {fortunaPublicSnapshot} from '../../specialists/sazeni/providers/fortuna-public.js';
import {watchQuotes,findOpportunities,validateWatchPreferences} from '../../specialists/sazeni/engine/opportunities.js';

// Effects stay in the host. The same public provider is used by CLI and chat.
export async function scanBettingWatch({bridge,watch,preferences,clock=Date.now,signal=null,recipientHash=null}) {
  const p=validateWatchPreferences(preferences),lease=watch.acquire(clock());let token;
  try {
    const from=new Date(clock()).toISOString(),to=new Date(clock()+p.horizonHours*3600000).toISOString();
    const scope=digest({source:'fortuna-public-web',preferences:p});
    token=bridge.host.openInvocation({extensionId:'sazeni',toolId:'sazeni.value_finder',operator:true,signal});
    const data=bridge.host.forTurn(token),bundle=await data.get({kind:'fortuna_public',leagues:p.leagues,from,to});
    const now=new Date(clock()).toISOString(),snapshot=fortunaPublicSnapshot(bundle,{now,leagues:p.leagues});
    const quotes=watchQuotes(snapshot,{now,from,to,preferences:p});
    const signals=findOpportunities(quotes,{now,preferences:p,previousScan:watch.previous(scope),history:watch.history(quotes)});
    const runId=await data.save({contract:'BettingWatchEvidence',version:1,preferences:p,snapshot,sourceRefs:bundle.sourceRefs,signals});
    const scanId=watch.save({token:lease,now,scope,from,to,runId,quotes,signals,recipientHash});
    return {scanId,runId,quotes:quotes.length,signals,lease};
  }catch(e){watch.failed(new Date(clock()).toISOString(),e.code??'WATCH_SCAN_FAILED');watch.release(lease);throw e;}
  finally{if(token)bridge.host.closeInvocation(token);}
}
