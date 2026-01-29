/**
 * Show actual responses - for debugging/demonstration
 */

import { ChatController } from '../src/unification/chat-controller.js';
import { getDefaultHandlers } from '../src/unification/handlers.js';

// Configure
ChatController.configure({
  handlers: getDefaultHandlers(),
});

async function showResponse(label, input, sessionId = null) {
  const sid = sessionId || `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  console.log(`\n╔═══════════════════════════════════════════════════════════════════════════════`);
  console.log(`║ ${label}`);
  console.log(`╠═══════════════════════════════════════════════════════════════════════════════`);
  console.log(`║ INPUT: "${input}"`);
  console.log(`╠───────────────────────────────────────────────────────────────────────────────`);

  try {
    const result = await ChatController.handle({
      message: input,
      sessionId: sid,
      context: {},
    });

    console.log(`║ INTENT: ${result.metadata?.decision?.intent || 'N/A'}`);
    console.log(`║ TYPE: ${result.metadata?.decision?.type || 'N/A'}`);
    console.log(`║ TOOLS: [${(result.metadata?.decision?.tools || []).join(', ')}]`);
    console.log(`╠───────────────────────────────────────────────────────────────────────────────`);
    console.log(`║ RESPONSE:`);
    console.log(`║`);
    const lines = (result.response || '(no response)').split('\n');
    for (const line of lines) {
      console.log(`║   ${line}`);
    }
    console.log(`╚═══════════════════════════════════════════════════════════════════════════════`);

    return { sid, result };
  } catch (err) {
    console.log(`║ ERROR: ${err.message}`);
    console.log(`╚═══════════════════════════════════════════════════════════════════════════════`);
    return { sid, error: err };
  }
}

async function main() {
  console.log('\n');
  console.log('█████████████████████████████████████████████████████████████████████████████████');
  console.log('█                                                                               █');
  console.log('█   CRE v44.8 - Response Demonstration                                          █');
  console.log('█                                                                               █');
  console.log('█████████████████████████████████████████████████████████████████████████████████');

  // ═══════════════════════════════════════════════════════════════════════════════
  // LOCAL QUERIES
  // ═══════════════════════════════════════════════════════════════════════════════

  console.log('\n\n▓▓▓ LOCAL QUERIES (date/time/math/moon) ▓▓▓\n');

  await showResponse('LOCAL: Moon phase', 'kdy bude úplněk?');
  await showResponse('LOCAL: Date', 'jaké je dnes datum?');
  await showResponse('LOCAL: Time', 'kolik je hodin?');
  await showResponse('LOCAL: Math', '5 + 3');
  await showResponse('LOCAL: Days to moon', 'za kolik dní bude úplněk?');

  // ═══════════════════════════════════════════════════════════════════════════════
  // CREATIVE QUERIES
  // ═══════════════════════════════════════════════════════════════════════════════

  console.log('\n\n▓▓▓ CREATIVE QUERIES (ideation - no web search!) ▓▓▓\n');

  await showResponse('CREATIVE: Story', 'vymysli mi příběh o drakovi');
  await showResponse('CREATIVE: Poem', 'napiš báseň o zimě');
  await showResponse('CREATIVE: Ideas', 'dej mi nápady na dovolenou');
  await showResponse('CREATIVE: Joke', 'řekni mi vtip');

  // ═══════════════════════════════════════════════════════════════════════════════
  // STRAHD SCENARIO
  // ═══════════════════════════════════════════════════════════════════════════════

  console.log('\n\n▓▓▓ STRAHD SCENARIO (multi-turn creative) ▓▓▓\n');

  const strahdSession = `strahd-${Date.now()}`;

  await showResponse('STRAHD Turn 1', 'chci vymyslet podobnou kampaň jako Curse of Strahd', strahdSession);
  await showResponse('STRAHD Turn 2', 'jaký to může mít vliv na hráče?', strahdSession);
  await showResponse('STRAHD Turn 3', 'trochu hororové, ale primárně mi jde o styl kampaně, dej mi pár návrhů', strahdSession);

  // ═══════════════════════════════════════════════════════════════════════════════
  // FIRST TURN BLOCKING
  // ═══════════════════════════════════════════════════════════════════════════════

  console.log('\n\n▓▓▓ FIRST TURN BLOCKING (ambiguous → optimistic) ▓▓▓\n');

  await showResponse('FIRST TURN: Ambiguous', 'něco');
  await showResponse('FIRST TURN: Vague', 'hmm');

  console.log('\n\n█████████████████████████████████████████████████████████████████████████████████');
  console.log('█  DONE                                                                          █');
  console.log('█████████████████████████████████████████████████████████████████████████████████\n');
}

main().catch(console.error);
