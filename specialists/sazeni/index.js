import { fileURLToPath } from 'node:url';
import { extractBettingInput, runBetting } from './tools/betting-engine.js';
import { renderBettingResult } from './presentation/report.js';

const TOOL_IDS=['sazeni.ticket_builder','sazeni.odds_compare','sazeni.match_analysis','sazeni.value_finder'];
const EXPERTISE={
  id:'sazeni',name:'Sázkový analytik',icon:'📊',domain:'sports_betting',isCustom:true,
  description:'Výpočet tiketů z doložené nabídky, časových a pravděpodobnostních limitů.',
  tools:TOOL_IDS,primaryProblemTypes:['analysis','comparison'],allowedRepresentations:['tabular','report'],
  planningDepth:'medium',reviewPolicy:'self',dataUsagePolicy:'controlled',outputBias:'analytical',
  temperature:0,systemPrompt:'Číselné výsledky poskytuje výhradně betting engine. Bez podkladů požádej o BettingRequest a BettingSnapshot. Modelové pravděpodobnosti ani živé kurzy nevymýšlej.',
  styleRules:{tone:'professional',toolEnforcement:true,strictToolEnforcement:true},
};
export function buildToolDefinitions() {
  return TOOL_IDS.map(id=>({id,name:'Výpočet tiketů',description:EXPERTISE.description,
    modulePath:fileURLToPath(new URL('./tools/betting-engine.js',import.meta.url)),functionName:'runBetting',
    patterns:[{priority:10,patterns:[/[\s\S]*/]}],extractParams:extractBettingInput,
    acceptsAllInput:true,acceptsInlineAttachments:true,needsTurnContext:true,failClosed:true,
    renderResult:({result})=>renderBettingResult(result),
  }));
}
export async function register(ctx) {
  const runtime=ctx.requireCapability('specialist.runtime.v1');
  runtime.registerSpecialist({id:'sazeni',domain:'sports_betting',tools:buildToolDefinitions()});
  ctx.getCapability('specialist.registry.expertise.v1')?.addCustom(EXPERTISE);
  ctx.getCapability('specialist.registry.auto-select.v1')?.registerBoostPatterns?.('sazeni',[/tiket|sazk|sázk|bookmaker|akumulátor|BettingRequest/i]);
  // Retain public tool identities. Direct CRE calls have no clock/provider authority
  // and therefore return NEEDS_INPUT; the runtime injects the bounded turn context.
  const executor=ctx.getCapability('specialist.registry.tool-executor.v1');
  const cre=ctx.getCapability('specialist.registry.cre.v1');
  for(const id of TOOL_IDS) {cre?.registerToolType?.(id);executor?.register?.(id,params=>runBetting(params));}
  for(const cap of ctx.manifest.payload.providedCapabilities??[]) ctx.getCapability('specialist.registry.capability.v1')?.register?.(cap,ctx.extensionId);
}
export function unregister(ctx) {
  ctx.requireCapability('specialist.runtime.v1').unregisterSpecialist('sazeni');
  ctx.getCapability('specialist.registry.expertise.v1')?.removeCustom?.('sazeni');
  ctx.getCapability('specialist.registry.auto-select.v1')?.unregisterBoostPatterns?.('sazeni');
  ctx.getCapability('specialist.registry.scenario.v1')?.unregisterBySpecialist?.('sazeni');
  for(const id of TOOL_IDS) {
    ctx.getCapability('specialist.registry.cre.v1')?.unregisterToolType?.(id);
    ctx.getCapability('specialist.registry.tool-executor.v1')?.unregister?.(id);
  }
  ctx.getCapability('specialist.registry.capability.v1')?.unregisterBySpecialist?.(ctx.extensionId);
}
