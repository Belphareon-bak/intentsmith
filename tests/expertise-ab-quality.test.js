// A7: Expert A/B Quality Test — expert prompt vs general prompt across 5 domains
// ═══════════════════════════════════════════════════════════════════════════════
//
// Runs each test prompt through Ollama twice:
//   A) With full expert system prompt (persona, style, rules, forbidden phrases)
//   B) With generic "helpful assistant" system prompt
//
// Scores both on:
//   - Substance (word count, specificity)
//   - Domain keywords (expert should use more domain vocabulary)
//   - Forbidden phrase avoidance (expert has explicit rules)
//   - Disclaimer presence (where required: legal, medical, finance)
//   - Language consistency (responses should be in Czech)
//
// Usage: node tests/expert-ab-quality.test.js
// Requires: Ollama running at 127.0.0.1:11434 with qwen3.5:27b
// ═══════════════════════════════════════════════════════════════════════════════

import { expertiseRegistry } from '../src/expertises/expertise-layer.js';
import { buildExpertiseSystemPrompt } from '../src/chat/handlers/expertise.js';
import { generateChatResponse } from '../src/llm/cre-bridge.js';
import { checkForbiddenPhrases } from '../src/expertises/expertise-enforcement.js';

const GENERAL_SYSTEM_PROMPT = `Jsi užitečný AI asistent. Odpovídej přesně a srozumitelně v češtině.`;

// ─── Test Domains (one per category) ─────────────────────────────────────────

const AB_TESTS = [
  {
    expertId: 'writer',
    category: 'A — Tvůrčí',
    prompt: 'Napiš krátký úvod k fantasy povídce o starém mágovi, který najde zapomenutou knihu.',
    domainKeywords: [/příběh|povídka|postav|atmosfér|kapitol|scén/i, /mág|kouzel|knih|mystick/i],
    minWordCountExpert: 60,
    requireDisclaimer: false,
  },
  {
    expertId: 'analyst',
    category: 'B — Analytický',
    prompt: 'Analyzuj výhody a nevýhody práce z domova z pohledu produktivity zaměstnanců a firemní kultury.',
    domainKeywords: [/produktivit|efektivit|metrik|analýz/i, /výhod|nevýhod|rizik|faktor/i],
    minWordCountExpert: 80,
    requireDisclaimer: false,
  },
  {
    expertId: 'lawyer',
    category: 'C — Normativní',
    prompt: 'Jaká jsou základní práva nájemce při zvýšení nájemného v České republice?',
    domainKeywords: [/zákon|právn|paragraf|občansk|smlouv|nájem/i, /práv|povinnost|lhůt|soud/i],
    minWordCountExpert: 80,
    requireDisclaimer: true,
    disclaimerPattern: /advokát|právní\s+porad|konzultuj|nenahrazuje|informativn/i,
  },
  {
    expertId: 'developer',
    category: 'D — Technický',
    prompt: 'Vysvětli, jak funguje garbage collection v Node.js a jaké jsou best practices pro prevenci memory leaků.',
    domainKeywords: [/heap|V8|garbage|GC|mark.sweep|scaveng/i, /memory|leak|referenc|closure|WeakRef|buffer/i],
    minWordCountExpert: 80,
    requireDisclaimer: false,
  },
  {
    expertId: 'accountant',
    category: 'B — Finance',
    prompt: 'Jak se správně účtuje DPH při reverse charge mechanismu u přeshraničních služeb v EU?',
    domainKeywords: [/DPH|daň|účt|základ|sazb|přiznán/i, /reverse.charge|EU|přeshranič|plnění|MOSS|faktur/i],
    minWordCountExpert: 80,
    requireDisclaimer: true,
    disclaimerPattern: /daňov.*porad|účetní|konzultuj|nenahrazuje|informativn|odborník/i,
  },
];

// ─── Scoring ─────────────────────────────────────────────────────────────────

function scoreResponse(text, test) {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;

  // Domain keyword hits
  let keywordHits = 0;
  let keywordTotal = test.domainKeywords.length;
  for (const kw of test.domainKeywords) {
    if (kw.test(text)) keywordHits++;
  }

  // Czech language check (common Czech words)
  const czechMarkers = /[ěščřžýáíéůúťďň]|že |je |ale |nebo |který |jako |pro |při /i;
  const isCzech = czechMarkers.test(text);

  // Zombie/deflection check
  const hasZombie = /spouštím|vyhledávám|tool_call|```json\s*\{/i.test(text);
  const hasDeflection = /bohužel nemám|nemohu poskytnout|nemám přístup/i.test(text);

  // Disclaimer check
  let hasDisclaimer = false;
  if (test.disclaimerPattern) {
    hasDisclaimer = test.disclaimerPattern.test(text);
  }

  // Forbidden phrase check (generic — "obecně se", "možná", etc.)
  const genericPhrases = [
    /obecn[eě]\s+(se|lze|platí)/i,
    /^možná[,.]?\s/im,
    /záleží na kontextu/i,
  ];
  let genericHits = 0;
  for (const gp of genericPhrases) {
    if (gp.test(text)) genericHits++;
  }

  return {
    wordCount,
    keywordHits,
    keywordTotal,
    keywordRatio: keywordHits / keywordTotal,
    isCzech,
    hasZombie,
    hasDeflection,
    hasDisclaimer,
    genericHits,
    meetsMinWords: wordCount >= (test.minWordCountExpert || 60),
  };
}

function calculateScore(s, test) {
  let score = 0;
  if (s.isCzech) score += 20;
  if (!s.hasZombie) score += 15;
  if (!s.hasDeflection) score += 15;
  if (s.meetsMinWords) score += 15;
  score += Math.round(s.keywordRatio * 20); // 0-20 for keywords
  if (s.genericHits === 0) score += 10;
  if (test.requireDisclaimer && s.hasDisclaimer) score += 5;
  else if (!test.requireDisclaimer) score += 5;
  return score; // max 100
}

// ─── Runner ──────────────────────────────────────────────────────────────────

async function callLLM(prompt, systemPrompt, temperature = 0.5) {
  try {
    const result = await generateChatResponse(prompt, systemPrompt, {
      sessionId: `ab-test-${Date.now()}`,
      temperature,
      maxTokens: 1024,
    });
    return result.content || '';
  } catch (err) {
    throw new Error(`LLM call failed: ${err.message}`);
  }
}

async function runABTest() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║     A7: Expert A/B Quality Test — 5 domains             ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const results = [];
  let expertWins = 0, generalWins = 0, ties = 0;

  for (const test of AB_TESTS) {
    const expert = expertiseRegistry.get(test.expertId);
    if (!expert) {
      throw new Error(`Required expert "${test.expertId}" not found`);
    }

    console.log(`\n── ${test.category}: ${expert.name} (${test.expertId}) ──`);
    console.log(`   Prompt: "${test.prompt.slice(0, 70)}..."`);

    // Build expert system prompt
    const expertSystemPrompt = await buildExpertiseSystemPrompt(expert);
    const expertTemp = expert.temperature || 0.5;

    // A) Expert arm
    console.log('   [A] Expert response...');
    const expertResponse = await callLLM(test.prompt, expertSystemPrompt, expertTemp);
    const expertScore = scoreResponse(expertResponse, test);
    const expertTotal = calculateScore(expertScore, test);

    // B) General arm
    console.log('   [B] General response...');
    const generalResponse = await callLLM(test.prompt, GENERAL_SYSTEM_PROMPT, 0.5);
    const generalScore = scoreResponse(generalResponse, test);
    const generalTotal = calculateScore(generalScore, test);

    // Compare
    const winner = expertTotal > generalTotal ? 'EXPERT' :
                   generalTotal > expertTotal ? 'GENERAL' : 'TIE';
    if (winner === 'EXPERT') expertWins++;
    else if (winner === 'GENERAL') generalWins++;
    else ties++;

    results.push({
      domain: test.expertId,
      category: test.category,
      expert: { score: expertTotal, ...expertScore, words: expertScore.wordCount },
      general: { score: generalTotal, ...generalScore, words: generalScore.wordCount },
      winner,
      delta: expertTotal - generalTotal,
    });

    // Print comparison
    console.log(`   ┌─────────────────┬──────────┬──────────┐`);
    console.log(`   │ Metric          │  Expert  │ General  │`);
    console.log(`   ├─────────────────┼──────────┼──────────┤`);
    console.log(`   │ Score           │  ${String(expertTotal).padStart(4)}    │  ${String(generalTotal).padStart(4)}    │`);
    console.log(`   │ Words           │  ${String(expertScore.wordCount).padStart(4)}    │  ${String(generalScore.wordCount).padStart(4)}    │`);
    console.log(`   │ Domain keywords │  ${expertScore.keywordHits}/${expertScore.keywordTotal}     │  ${generalScore.keywordHits}/${generalScore.keywordTotal}     │`);
    console.log(`   │ Czech           │  ${expertScore.isCzech ? '✅' : '❌'}      │  ${generalScore.isCzech ? '✅' : '❌'}      │`);
    console.log(`   │ No zombie       │  ${!expertScore.hasZombie ? '✅' : '❌'}      │  ${!generalScore.hasZombie ? '✅' : '❌'}      │`);
    console.log(`   │ No deflection   │  ${!expertScore.hasDeflection ? '✅' : '❌'}      │  ${!generalScore.hasDeflection ? '✅' : '❌'}      │`);
    if (test.requireDisclaimer) {
      console.log(`   │ Disclaimer      │  ${expertScore.hasDisclaimer ? '✅' : '❌'}      │  ${generalScore.hasDisclaimer ? '✅' : '❌'}      │`);
    }
    console.log(`   │ Generic phrases │  ${String(expertScore.genericHits).padStart(4)}    │  ${String(generalScore.genericHits).padStart(4)}    │`);
    console.log(`   └─────────────────┴──────────┴──────────┘`);
    console.log(`   Winner: ${winner} (${winner === 'EXPERT' ? '✅' : winner === 'TIE' ? '🟰' : '⚠️'} Δ=${expertTotal - generalTotal})`);
  }

  // Summary
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  A7 SUMMARY');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Domains tested:  ${results.length}`);
  console.log(`  Expert wins:     ${expertWins}`);
  console.log(`  General wins:    ${generalWins}`);
  console.log(`  Ties:            ${ties}`);

  const avgExpert = results.reduce((s, r) => s + r.expert.score, 0) / results.length;
  const avgGeneral = results.reduce((s, r) => s + r.general.score, 0) / results.length;
  console.log(`  Avg expert score:  ${avgExpert.toFixed(1)}/100`);
  console.log(`  Avg general score: ${avgGeneral.toFixed(1)}/100`);
  console.log(`  Expert advantage:  +${(avgExpert - avgGeneral).toFixed(1)} pts`);

  console.log('\n  Per-domain:');
  for (const r of results) {
    const icon = r.winner === 'EXPERT' ? '✅' : r.winner === 'TIE' ? '🟰' : '⚠️';
    console.log(`    ${icon} ${r.domain.padEnd(12)} Expert:${r.expert.score} General:${r.general.score} (Δ${r.delta >= 0 ? '+' : ''}${r.delta})`);
  }

  console.log('══════════════════════════════════════════════════════════');

  // Pass/fail: expert should win or tie in at least 3/5 domains
  const expertWinOrTie = expertWins + ties;
  if (expertWinOrTie >= 3) {
    console.log(`✅ A7 PASS — Expert prompts win/tie in ${expertWinOrTie}/5 domains`);
  } else {
    console.log(`❌ A7 FAIL — Expert prompts only win/tie in ${expertWinOrTie}/5 domains (need ≥3)`);
    process.exitCode = 1;
  }

  return { expertWins, generalWins, ties, results };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

runABTest().catch(err => {
  console.error('A7 test error:', err.message);
  process.exit(1);
});
