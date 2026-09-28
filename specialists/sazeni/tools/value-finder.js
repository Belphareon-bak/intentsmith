// Value Finder Tool — Hledání value betů
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Expected Value calculation.
 * EV = (probability × payout) - stake
 * For a unit stake: EV = (probability × decimalOdds) - 1
 */
function expectedValue(probability, decimalOdds) {
  return Math.round((probability * decimalOdds - 1) * 10000) / 10000;
}

/**
 * ROI calculation based on expected value.
 * ROI% = EV × 100
 */
function roi(ev) {
  return Math.round(ev * 10000) / 100;
}

/**
 * Closing line value estimation.
 * If opening odds were higher than closing, the bet was value at time of placement.
 */
function closingLineValue(placedOdds, closingOdds) {
  if (!closingOdds) return null;
  const clv = Math.round(((placedOdds / closingOdds) - 1) * 10000) / 100;
  return { clv, isPositive: clv > 0 };
}

/**
 * True probability estimation from multiple bookmaker odds (power method).
 * Removes margin by normalizing inverse odds.
 */
function trueProbability(oddsArray) {
  if (!oddsArray || oddsArray.length === 0) return null;
  const invSum = oddsArray.reduce((s, o) => s + (1 / o), 0);
  return oddsArray.map(o => Math.round((1 / o / invSum) * 10000) / 10000);
}

/**
 * Find value bets in a set of matches/odds.
 *
 * @param {Object} params
 * @param {Array} params.matches - Array of matches with odds from multiple bookmakers
 *   Each: { match, bookmakers: [{ name, home, draw?, away }], estimatedProb?: { home, draw?, away } }
 * @param {number} [params.minEdge=3] - Minimum edge % to qualify as value
 * @param {number} [params.minOdds=1.3] - Minimum odds to consider
 * @param {number} [params.maxOdds=10] - Maximum odds to consider
 */
export function findValue(params) {
  const { matches, minEdge, minOdds, maxOdds } = params;

  if (!matches || !Array.isArray(matches) || matches.length === 0) {
    return {
      status: 'clarify',
      missingParams: ['matches'],
      message: 'Zadej zápasy s kurzy od bookmakerů. Formát: pole { match, bookmakers: [{ name, home, draw?, away }] }.',
    };
  }

  const edgeThreshold = (minEdge || 3) / 100;
  const oddsMin = minOdds || 1.3;
  const oddsMax = maxOdds || 10;

  const valueBets = [];

  for (const m of matches) {
    const bks = m.bookmakers || [];
    if (bks.length === 0) continue;

    const outcomes = ['home', 'away'];
    if (bks[0].draw != null) outcomes.push('draw');

    for (const outcome of outcomes) {
      const allOdds = bks.map(b => b[outcome]).filter(o => o != null && o > 0);
      if (allOdds.length === 0) continue;

      // Estimate true probability from market consensus
      let estimatedProb;
      if (m.estimatedProb && m.estimatedProb[outcome] != null) {
        estimatedProb = m.estimatedProb[outcome];
      } else {
        // Use market average with margin removal
        const avgInv = allOdds.reduce((s, o) => s + (1 / o), 0) / allOdds.length;
        // Scale down by estimated margin (~5%)
        estimatedProb = avgInv * 0.95;
      }

      // Find best available odds for this outcome
      const bestOdds = Math.max(...allOdds);
      const bestBookmaker = bks.find(b => b[outcome] === bestOdds)?.name || 'Neznámý';

      if (bestOdds < oddsMin || bestOdds > oddsMax) continue;

      const impliedProb = 1 / bestOdds;
      const edge = estimatedProb - impliedProb;

      if (edge >= edgeThreshold) {
        const ev = expectedValue(estimatedProb, bestOdds);
        valueBets.push({
          match: m.match,
          outcome,
          outcomeLabel: outcome === 'home' ? '1' : outcome === 'draw' ? 'X' : '2',
          bestOdds,
          bestBookmaker,
          estimatedProbability: Math.round(estimatedProb * 10000) / 100,
          impliedProbability: Math.round(impliedProb * 10000) / 100,
          edge: Math.round(edge * 10000) / 100,
          expectedValue: ev,
          roi: roi(ev),
          confidence: edge > 0.08 ? 'vysoká' : edge > 0.05 ? 'střední' : 'nízká',
        });
      }
    }
  }

  // Sort by edge descending
  valueBets.sort((a, b) => b.edge - a.edge);

  // Summary stats
  const avgEdge = valueBets.length > 0
    ? Math.round(valueBets.reduce((s, v) => s + v.edge, 0) / valueBets.length * 100) / 100
    : 0;
  const avgRoi = valueBets.length > 0
    ? Math.round(valueBets.reduce((s, v) => s + v.roi, 0) / valueBets.length * 100) / 100
    : 0;

  return {
    status: 'ok',
    data: {
      valueBets,
      summary: {
        found: valueBets.length,
        analyzed: matches.length,
        avgEdge,
        avgRoi,
        topPick: valueBets[0] || null,
      },
      filters: {
        minEdge: Math.round(edgeThreshold * 100),
        minOdds: oddsMin,
        maxOdds: oddsMax,
      },
    },
  };
}
