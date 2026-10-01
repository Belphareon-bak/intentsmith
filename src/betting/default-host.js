import path from 'node:path';
import os from 'node:os';
import {BettingDataStore} from './data-store.js';
import {createBettingDataHost} from './data-host.js';
// Lazy initialization: discovering/enabling a specialist does not fetch or open a DB.
export function createDefaultBettingBridge(projectRoot) {
  const injected = globalThis[Symbol.for('intentsmith.test.bettingBridge')];
  if (process.env.INTENTSMITH_TEST_BETTING_BRIDGE_REQUIRED === '1' && injected === undefined) {
    throw new Error('BETTING_TEST_BRIDGE_MISSING');
  }
  if (injected !== undefined) {
    if (process.env.NODE_ENV !== 'test' || process.env.CI !== '1'
      || !process.env.INTENTSMITH_TEST_ARTIFACT_DIR
      || !process.env.INTENTSMITH_TEST_SERVER_NONCE) {
      throw new Error('BETTING_TEST_BRIDGE_FORBIDDEN');
    }
    if (typeof injected.host?.openInvocation !== 'function'
      || typeof injected.capability?.get !== 'function') {
      throw new Error('BETTING_TEST_BRIDGE_INVALID');
    }
    return injected;
  }
  let bridge;
  const active=()=>{if(!bridge)throw Object.assign(new Error('BETTING_SCOPE_EXPIRED'),{code:'BETTING_SCOPE_EXPIRED'});return bridge;};
  const get=()=>bridge??=createBettingDataHost({oddsIOKey:process.env.INTENTSMITH_BETTING_ODDS_IO_API_KEY??null,store:new BettingDataStore(path.join(process.env.INTENTSMITH_BETTING_STATE_DIR || path.join(os.homedir(),'.local/state/sazkar/studio'),'analysis.sqlite'))});
  return Object.freeze({
    capability:Object.freeze({contract:'BettingDataCapability',version:1,get:async(...args)=>active().capability.get(...args),save:async(...args)=>active().capability.save(...args)}),
    host:Object.freeze({openInvocation:args=>get().host.openInvocation(args),closeInvocation:token=>bridge?.host.closeInvocation(token),forTurn:token=>get().host.forTurn(token)}),
  });
}
