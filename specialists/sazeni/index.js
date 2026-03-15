// Sázkový Analytik — Specialist Package Entry Point
// ══════════════════════════════════════════════════════════════════════════════
//
// Komplexní analýza sportovních sázek — porovnání kurzů, statistická analýza,
// value betting, konstrukce tiketů, bankroll management.
//
// ══════════════════════════════════════════════════════════════════════════════

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Inline Param Extractors ────────────────────────────────────────────────

function extractAmount(input) {
  const m = input.match(/(\d[\d\s,.]*\d?)\s*(?:kč|czk|Kč|korun)/i);
  if (m) return parseFloat(m[1].replace(/[\s,]/g, ''));
  const m2 = input.match(/(\d+)\s*(?:k|tis[íi]c)/i);
  if (m2) return parseFloat(m2[1]) * 1000;
  return null;
}

function extractTeams(input) {
  const m = input.match(/(.+?)\s+(?:vs\.?|[-–—:]|proti)\s+(.+?)(?:\s*[,.]|$)/i);
  if (m) return { home: m[1].trim(), away: m[2].trim() };
  return null;
}

function extractOdds(input) {
  // Match patterns like "kurz 2.10" or "odds 1.85"
  const matches = [...input.matchAll(/(?:kurz|odds?)\s*:?\s*(\d+[.,]\d+)/gi)];
  return matches.map(m => parseFloat(m[1].replace(',', '.')));
}

// ─── Expertise Definition ───────────────────────────────────────────────────

const SAZENI_EXPERTISE = {
  id: 'sazeni',
  name: 'Sázkový analytik',
  icon: '🎰',
  domain: 'sports_betting',
  description: 'Analýza sázek, porovnání kurzů, value betting, tikety',
  isCustom: true,
  primaryProblemTypes: ['analysis', 'comparison', 'recommendation'],
  allowedRepresentations: ['tabular', 'report', 'prose'],
  planningDepth: 'medium',
  reviewPolicy: 'self',
  dataUsagePolicy: 'controlled',
  outputBias: 'analytical',
  preferredModels: ['qwen3.5:27b'],
  temperature: 0.3,
  tools: ['sazeni.odds_compare', 'sazeni.match_analysis', 'sazeni.ticket_builder', 'sazeni.value_finder'],
  capabilities: {
    reasoning: 85,
    creativity: 20,
    determinism: 80,
    riskTolerance: 40,
    verbosity: 60,
  },
  tone: 'professional',
  modules: {
    domain_rules: [
      'Vždy uváděj implikovanou pravděpodobnost vedle kurzů',
      'Porovnávej kurzy minimálně u 2 bookmakerů',
      'Upozorni na value bety i na traps (podezřele dobré kurzy)',
      'Doporuč bankroll management — nikdy více než 5% na jeden tip',
      'Rozlišuj sharp (Pinnacle, Betfair) vs soft bookery (Tipsport, Fortuna)',
      'U akumulátorů vždy upozorni na násobení marží',
    ],
    emphasis: [
      'Matematický přístup — EV, Kelly, edge',
      'Risk management — nikdy nepronásleduj ztráty',
      'Objektivní analýza — žádné emocionální sázky',
      'Dlouhodobý profit > jednorázový výnos',
    ],
    constraints: [
      'NIKDY neslibuj jistou výhru — sázení má vždy riziko',
      'NIKDY nedoporuč all-in nebo chasing losses',
      'NIKDY neoznačuj tip jako "jistotu" nebo "100%"',
      'VŽDY upozorni na riziko gamblerského problému při excesivním sázení',
    ],
    vocabulary: [
      'kurz', 'value bet', 'edge', 'marže', 'bankroll', 'stake',
      'akumulátor', 'handicap', 'over/under', 'BTTS',
      'sharp', 'soft', 'steam move', 'CLV', 'EV', 'ROI',
      'Kelly criterion', 'implikovaná pravděpodobnost', 'tiket',
    ],
    antipatterns: [
      'Doporučení bez analýzy kurzů',
      'Ignorování bankroll managementu',
      'Přehnané akumulátory (7+ tipů)',
      'Emocionální sázky na oblíbený tým',
      'Přísliby jistých výher',
    ],
    disclaimer: 'Sázení je forma zábavy s rizikem ztráty. Nikdy nesázej peníze, které si nemůžeš dovolit prohrát. Pokud máš pocit, že ztrácíš kontrolu, kontaktuj linku pomoci: 800 350 000.',
  },
  styleRules: {
    tone: 'professional',
    minResponseLength: 100,
    toolEnforcement: true,
    strictToolEnforcement: false,
    forbiddenPhrases: ['jistota', 'zaručen', '100%', 'nemůžeš prohrát'],
  },
  systemPrompt: `Jsi profesionální sázkový analytik. Pomáháš uživatelům s analýzou sportovních sázek na základě dat a matematiky.

## ROLE
- Analyzuješ zápasy, porovnáváš kurzy, hledáš value bety
- Sestavuješ tikety s optimálním risk managementem
- Používáš Kelly criterion a EV kalkulace
- Vždy prezentuješ data v přehledných tabulkách

## PRAVIDLA
- VŽDY uváděj implikovanou pravděpodobnost vedle kurzů
- VŽDY porovnávej kurzy u více bookmakerů
- VŽDY doporuč bankroll management
- NIKDY neslibuj jistou výhru
- NIKDY nedoporuč all-in
- U akumulátorů vždy upozorni na násobení marží
- Upozorni na disclaimer při každé analýze

## FORMÁT VÝSTUPU
- Tabulky pro porovnání kurzů (booker | 1 | X | 2 | marže)
- Analýza faktorů: forma, H2H, zranění, motivace
- Tiket: přehled tipů s kurzy, celkový kurz, stake, potenciální výhra
- Risk rating: nízké/střední/vyšší/vysoké

## DISCLAIMER
Sázení je forma zábavy s rizikem. Nikdy nesázej peníze, které si nemůžeš dovolit prohrát.`,
};

// ─── Boost Patterns ─────────────────────────────────────────────────────────

const SAZENI_BOOST_PATTERNS = [
  /\bkurz[yů]?\b/i,
  /\bsáz[ekí]\w*/i,
  /\btiket\w*/i,
  /\bbook(?:maker|ie)/i,
  /\bvalue\s*bet/i,
  /\bhandicap/i,
  /\bover\s*\/?\s*under/i,
  /\bbtts/i,
  /\bakumulátor/i,
  /\b(?:tipsport|fortuna|betano|pinnacle|bet365|sazka|chance)\b/i,
  /\bvsadit/i,
  /\bprosáz/i,
  /\bvýhr[auy]\b/i,
  /\bprohr[auy]\b/i,
];

// ─── Tool Definitions ───────────────────────────────────────────────────────

function buildToolDefinitions() {
  const toolsDir = path.join(__dirname, 'tools');
  return [
    {
      id: 'sazeni.odds_compare',
      name: 'Porovnání kurzů',
      description: 'Compare odds across bookmakers, calculate margins, find best value',
      modulePath: path.join(toolsDir, 'odds-compare.js'),
      functionName: 'compareOdds',
      patterns: [{
        priority: 8,
        patterns: [
          /(?:porovn|srovn)\w*\s+.{0,20}kurz/i,
          /(?:kurz|odds)\s+.{0,20}(?:porovn|srovn|compar)/i,
          /(?:nejlepší|nejvyšší|best)\s+(?:kurz|odds)/i,
          /(?:marže|margin)\s+.{0,20}(?:book|sáz)/i,
        ],
      }],
      extractParams: (input) => {
        const odds = extractOdds(input);
        return odds.length > 0 ? { oddsHint: odds } : {};
      },
    },
    {
      id: 'sazeni.match_analysis',
      name: 'Analýza zápasu',
      description: 'Analyze a match using multiple factors (form, H2H, injuries, etc.)',
      modulePath: path.join(toolsDir, 'match-analysis.js'),
      functionName: 'analyzeMatch',
      patterns: [{
        priority: 7,
        patterns: [
          /(?:analyz|rozbor|analýz)\w*\s+.{0,30}(?:zápas|utkání|match)/i,
          /(?:zápas|utkání|match)\s+.{0,20}(?:analyz|rozbor)/i,
          /(?:jak|co)\s+.{0,20}(?:myslíš|říkáš|tipuješ)\s+.{0,20}(?:na|o)\s/i,
          /(?:šance|pravděpodobnost)\s+.{0,20}(?:výhr|proh|remíz)/i,
        ],
      }],
      extractParams: (input) => {
        const teams = extractTeams(input);
        const params = {};
        if (teams) { params.home = teams.home; params.away = teams.away; }
        return params;
      },
    },
    {
      id: 'sazeni.ticket_builder',
      name: 'Sestavení tiketu',
      description: 'Build a betting ticket with risk management, Kelly sizing, and value assessment',
      modulePath: path.join(toolsDir, 'ticket-builder.js'),
      functionName: 'buildTicket',
      patterns: [{
        priority: 9,
        patterns: [
          /(?:sestav|postav|vytvoř|udělej)\w*\s+.{0,15}tik/i,
          /tik(?:et)?\s+.{0,20}(?:na|pro|s\s)/i,
          /(?:chci|chtěl)\s+.{0,20}vsadit/i,
          /(?:parlay|akumulátor|kombi)/i,
        ],
      }],
      extractParams: (input) => {
        const amount = extractAmount(input);
        const params = {};
        if (amount) params.stake = amount;
        return params;
      },
    },
    {
      id: 'sazeni.value_finder',
      name: 'Value Bet Finder',
      description: 'Find value bets by comparing estimated probability vs. bookmaker odds',
      modulePath: path.join(toolsDir, 'value-finder.js'),
      functionName: 'findValue',
      patterns: [{
        priority: 6,
        patterns: [
          /value\s*bet/i,
          /(?:najdi|hledej|kde)\s+.{0,20}(?:value|hodnot)/i,
          /(?:podhodnocen|nadhodnocen)\w*\s+kurz/i,
          /(?:edge|výhoda)\s+.{0,20}(?:book|kurz)/i,
        ],
      }],
      extractParams: () => ({}),
    },
  ];
}

// ─── Registration ───────────────────────────────────────────────────────────

export async function register(ctx) {
  const { runtime, manifest, logger: log } = ctx;

  // 1. Tools — register into SpecialistRuntime
  runtime.registerSpecialist({
    id: 'sazeni',
    domain: 'sports_betting',
    globalParamExtractor: null,
    tools: buildToolDefinitions(),
  });

  // 2. Expertise
  if (ctx.registries?.expertise) {
    ctx.registries.expertise.addCustom(SAZENI_EXPERTISE);
  }

  // 3. Boost patterns
  if (ctx.registries?.autoSelect?.registerBoostPatterns) {
    ctx.registries.autoSelect.registerBoostPatterns('sazeni', SAZENI_BOOST_PATTERNS);
  }

  // 4. Knowledge seeding
  if (ctx.knowledgeBase) {
    try {
      const { seedBettingKnowledge } = await import('./knowledge/seed.js');
      seedBettingKnowledge(ctx.knowledgeBase);
    } catch (err) {
      log?.warn?.('Sazeni', `Knowledge seed failed: ${err.message}`);
    }
  }

  // 5. Scenarios
  if (ctx.registries?.scenario?.register) {
    try {
      const { ticketConstructionScenario } = await import('./scenarios/ticket-construction.js');
      ctx.registries.scenario.register(ticketConstructionScenario);
    } catch (err) {
      log?.warn?.('Sazeni', `Scenario registration failed: ${err.message}`);
    }
  }

  // 6. ToolType registration
  if (ctx.registries?.cre?.registerToolType) {
    for (const tool of manifest?.tools || []) {
      ctx.registries.cre.registerToolType(tool.id);
    }
  }

  // 7. ToolExecutor handlers
  if (ctx.registries?.toolExecutor?.register) {
    const { compareOdds } = await import('./tools/odds-compare.js');
    const { analyzeMatch } = await import('./tools/match-analysis.js');
    const { buildTicket } = await import('./tools/ticket-builder.js');
    const { findValue } = await import('./tools/value-finder.js');

    ctx.registries.toolExecutor.register('sazeni.odds_compare', compareOdds);
    ctx.registries.toolExecutor.register('sazeni.match_analysis', analyzeMatch);
    ctx.registries.toolExecutor.register('sazeni.ticket_builder', buildTicket);
    ctx.registries.toolExecutor.register('sazeni.value_finder', findValue);
  }

  // 8. Capabilities
  if (ctx.registries?.capability?.register) {
    for (const cap of manifest?.capabilities || []) {
      ctx.registries.capability.register(cap, manifest.id);
    }
  }
}

export function unregister(ctx) {
  const { runtime, manifest } = ctx;

  try { runtime?.unregisterSpecialist?.('sazeni'); } catch { /* noop */ }
  try { ctx.registries?.expertise?.removeCustom('sazeni'); } catch { /* noop */ }
  try { ctx.registries?.autoSelect?.unregisterBoostPatterns('sazeni'); } catch { /* noop */ }
  try { ctx.registries?.scenario?.unregisterBySpecialist?.('sazeni'); } catch { /* noop */ }

  try {
    for (const tool of manifest?.tools || []) {
      ctx.registries?.cre?.unregisterToolType(tool.id);
      ctx.registries?.toolExecutor?.unregister(tool.id);
    }
  } catch { /* noop */ }

  try { ctx.registries?.capability?.unregisterBySpecialist?.(manifest?.id); } catch { /* noop */ }
}
