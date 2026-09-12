import path from 'node:path';
import {BettingDataStore} from './data-store.js';
import {createBettingDataHost} from './data-host.js';
// Lazy initialization: discovering/enabling a specialist does not fetch or open a DB.
export function createDefaultBettingBridge(projectRoot) {
  let bridge;
  const get=()=>bridge??=createBettingDataHost({oddsIOKey:process.env.INTENTSMITH_BETTING_ODDS_IO_API_KEY??null,store:new BettingDataStore(path.join(projectRoot,'.intentsmith-artifacts','betting','analysis.sqlite'))});
  return Object.freeze({
    capability:Object.freeze({contract:'BettingDataCapability',version:1,get:(...args)=>get().capability.get(...args),save:(...args)=>get().capability.save(...args)}),
    host:Object.freeze({openInvocation:args=>get().host.openInvocation(args),closeInvocation:token=>bridge?.host.closeInvocation(token),forTurn:token=>get().host.forTurn(token)}),
  });
}
