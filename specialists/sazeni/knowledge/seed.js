// Betting Knowledge Seed — Základní znalosti o sázení
// ══════════════════════════════════════════════════════════════════════════════

import { BOOKMAKERS } from './bookmakers.js';

const BETTING_FACTS = [
  // Odds formats
  { domain: 'betting', key: 'odds.decimal', value: 'Decimální kurzy: výhra = stake × kurz. Např. 2.50 = 150% zisk.', source: 'fundamentals', confidence: 1.0 },
  { domain: 'betting', key: 'odds.fractional', value: 'Zlomkové kurzy (UK): 3/1 = stake × 3 + stake. Decimal: (3/1)+1 = 4.00', source: 'fundamentals', confidence: 1.0 },
  { domain: 'betting', key: 'odds.american', value: 'Americké kurzy: +150 = výhra 150 z 100, -200 = musíš vsadit 200 pro výhru 100', source: 'fundamentals', confidence: 1.0 },
  { domain: 'betting', key: 'odds.implied_prob', value: 'Implikovaná pravděpodobnost = 1 / decimal_kurz. Kurz 2.00 = 50%, 1.50 = 66.7%', source: 'fundamentals', confidence: 1.0 },

  // Margin & value
  { domain: 'betting', key: 'margin.definition', value: 'Marže bookera = součet implikovaných pravděpodobností - 100%. Typicky 2-8% u hlavních lig.', source: 'fundamentals', confidence: 1.0 },
  { domain: 'betting', key: 'value.definition', value: 'Value bet = sázka kde naše ohodnocení pravděpodobnosti je vyšší než implikovaná pravděpodobnost z kurzu.', source: 'fundamentals', confidence: 1.0 },
  { domain: 'betting', key: 'value.ev_formula', value: 'Expected Value = (probability × odds) - 1. Kladné EV = dlouhodobě zisková sázka.', source: 'fundamentals', confidence: 1.0 },
  { domain: 'betting', key: 'value.clv', value: 'Closing Line Value (CLV) = porovnání kurzu při sázce vs. závěrečný kurz. Pozitivní CLV = skill indikátor.', source: 'fundamentals', confidence: 0.95 },

  // Kelly criterion
  { domain: 'betting', key: 'kelly.formula', value: 'Kelly fraction: f* = (bp - q) / b kde b=odds-1, p=probability, q=1-p. Optimální sizing.', source: 'strategy', confidence: 1.0 },
  { domain: 'betting', key: 'kelly.fractional', value: 'Frakční Kelly (1/4 nebo 1/8) pro snížení variance. Plný Kelly je příliš agresivní.', source: 'strategy', confidence: 0.95 },

  // Bankroll management
  { domain: 'betting', key: 'bankroll.flat', value: 'Flat staking: konstantní sázka 1-3% bankrollu na tip. Nejbezpečnější metoda.', source: 'strategy', confidence: 0.95 },
  { domain: 'betting', key: 'bankroll.rule', value: 'Nikdy nesázet více než 5% bankrollu na jeden tip. Akumulátory max 1-2%.', source: 'strategy', confidence: 0.90 },

  // Bet types
  { domain: 'betting', key: 'types.1x2', value: '1X2: základní tip na výsledek — 1 (domácí), X (remíza), 2 (hosté)', source: 'fundamentals', confidence: 1.0 },
  { domain: 'betting', key: 'types.over_under', value: 'Over/Under: sázka na celkový počet gólů (nebo jiných metrik) nad/pod hranici', source: 'fundamentals', confidence: 1.0 },
  { domain: 'betting', key: 'types.handicap', value: 'Handicap: jeden tým má virtuální náskok/ztrátu. Asian handicap bez remízy.', source: 'fundamentals', confidence: 1.0 },
  { domain: 'betting', key: 'types.btts', value: 'Both Teams To Score (BTTS): obě strany skórují. Populární pro vysoké ligy.', source: 'fundamentals', confidence: 1.0 },
  { domain: 'betting', key: 'types.accumulator', value: 'Akumulátor (parlay): kombinace tipů, kurzy se násobí. Vyšší výnos, nižší pravděpodobnost.', source: 'fundamentals', confidence: 1.0 },
  { domain: 'betting', key: 'types.system', value: 'Systém (2/3, 3/4...): všechny kombinace k z n tipů. Toleruje prohru některých tipů.', source: 'fundamentals', confidence: 1.0 },

  // Analysis factors
  { domain: 'betting', key: 'analysis.form', value: 'Forma: posledních 5-10 zápasů. Váha: ~25% analýzy. Rozlišit domácí/venkovní formu.', source: 'analysis', confidence: 0.90 },
  { domain: 'betting', key: 'analysis.h2h', value: 'Head-to-head: vzájemné zápasy 3-5 let. Váha ~15%. Pozor na změny trenérů/kádru.', source: 'analysis', confidence: 0.90 },
  { domain: 'betting', key: 'analysis.motivation', value: 'Motivace: boj o titul, sestup, pohárový double, liga mistrů. Klíčový faktor koncem sezony.', source: 'analysis', confidence: 0.85 },
  { domain: 'betting', key: 'analysis.injuries', value: 'Zranění a suspenze: klíčoví hráči (brankář, střelec). Váha ~10%.', source: 'analysis', confidence: 0.90 },
  { domain: 'betting', key: 'analysis.odds_movement', value: 'Pohyb kurzů: steam move = sharp money. Sledovat opening → current. Reverse movement = trap.', source: 'analysis', confidence: 0.85 },

  // Common mistakes
  { domain: 'betting', key: 'mistakes.favorite_bias', value: 'Bias na favority: public money tlačí kurzy favoritů dolů → outsideři bývají hodnotnější.', source: 'psychology', confidence: 0.85 },
  { domain: 'betting', key: 'mistakes.accumulator_trap', value: 'Akumulátory mají horší expected value — marže se násobí. Bookeři je milují.', source: 'psychology', confidence: 0.90 },
  { domain: 'betting', key: 'mistakes.recency', value: 'Recency bias: poslední zápas má nepřiměřený vliv na hodnocení. Sledovat trend, ne body.', source: 'psychology', confidence: 0.85 },
  { domain: 'betting', key: 'mistakes.chasing', value: 'Chasing losses: zvyšování sázek po prohrách. Nejrychlejší cesta k bankrotu.', source: 'psychology', confidence: 0.95 },
];

export function seedBettingKnowledge(kb) {
  if (!kb || typeof kb.bulkSetFacts !== 'function') return 0;

  const facts = [
    ...BETTING_FACTS.map(f => ({ ...f, valueType: 'string', injectionScore: 0.8 })),
    ...BOOKMAKERS.map(b => ({
      domain: 'betting',
      key: `bookmaker.${b.id}`,
      value: JSON.stringify(b),
      valueType: 'json',
      source: 'bookmaker-data',
      confidence: 0.90,
      injectionScore: 0.5,
    })),
  ];

  kb.bulkSetFacts(facts);
  return facts.length;
}
