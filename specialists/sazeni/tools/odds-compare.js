// Odds Compare Tool — Porovnání kurzů mezi bookery
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Converts between odds formats: decimal, fractional, american, implied probability.
 */
function toDecimal(odds, format) {
  if (format === 'decimal' || !format) return odds;
  if (format === 'fractional') {
    const [num, den] = String(odds).split('/').map(Number);
    return (num / den) + 1;
  }
  if (format === 'american') {
    if (odds > 0) return (odds / 100) + 1;
    return (100 / Math.abs(odds)) + 1;
  }
  return odds;
}

function impliedProbability(decimalOdds) {
  return Math.round((1 / decimalOdds) * 10000) / 100;
}

function toAmerican(decimalOdds) {
  if (decimalOdds >= 2.0) return `+${Math.round((decimalOdds - 1) * 100)}`;
  return `-${Math.round(100 / (decimalOdds - 1))}`;
}

function toFractional(decimalOdds) {
  const num = decimalOdds - 1;
  // Simple fraction approximation
  for (const den of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20, 25, 33, 50, 100]) {
    const n = Math.round(num * den);
    if (Math.abs((n / den) - num) < 0.02) return `${n}/${den}`;
  }
  return `${Math.round(num * 100)}/100`;
}

/**
 * Calculate margin (overround) from a set of odds for all outcomes.
 */
function calculateMargin(oddsList) {
  const sum = oddsList.reduce((acc, o) => acc + (1 / o), 0);
  return Math.round((sum - 1) * 10000) / 100;
}

/**
 * Find the best odds across bookmakers for each outcome.
 * Input: array of { bookmaker, home, draw?, away, format? }
 */
export function compareOdds(params) {
  const { entries, format } = params;

  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    return {
      status: 'clarify',
      missingParams: ['entries'],
      message: 'Zadej kurzy od bookmakerů. Formát: pole objektů s bookmaker, home, draw (volitelné), away.',
    };
  }

  // Normalize all to decimal
  const normalized = entries.map(e => ({
    bookmaker: e.bookmaker || 'Neznámý',
    home: toDecimal(e.home, e.format || format),
    draw: e.draw != null ? toDecimal(e.draw, e.format || format) : null,
    away: toDecimal(e.away, e.format || format),
  }));

  // Find best odds for each outcome
  const bestHome = normalized.reduce((best, e) => e.home > best.home ? e : best);
  const bestAway = normalized.reduce((best, e) => e.away > best.away ? e : best);
  const bestDraw = normalized[0].draw != null
    ? normalized.reduce((best, e) => (e.draw || 0) > (best.draw || 0) ? e : best)
    : null;

  // Calculate margins for each bookmaker
  const margins = normalized.map(e => {
    const odds = [e.home, e.away];
    if (e.draw != null) odds.push(e.draw);
    return {
      bookmaker: e.bookmaker,
      margin: calculateMargin(odds),
    };
  });

  // Best combo (cherry-picking best odds)
  const cherryOdds = [bestHome.home, bestAway.away];
  if (bestDraw) cherryOdds.push(bestDraw.draw);
  const cherryMargin = calculateMargin(cherryOdds);

  const result = {
    comparison: normalized.map(e => ({
      bookmaker: e.bookmaker,
      home: { decimal: e.home, implied: impliedProbability(e.home), american: toAmerican(e.home) },
      draw: e.draw != null ? { decimal: e.draw, implied: impliedProbability(e.draw), american: toAmerican(e.draw) } : null,
      away: { decimal: e.away, implied: impliedProbability(e.away), american: toAmerican(e.away) },
    })),
    best: {
      home: { bookmaker: bestHome.bookmaker, odds: bestHome.home, implied: impliedProbability(bestHome.home) },
      away: { bookmaker: bestAway.bookmaker, odds: bestAway.away, implied: impliedProbability(bestAway.away) },
      draw: bestDraw ? { bookmaker: bestDraw.bookmaker, odds: bestDraw.draw, implied: impliedProbability(bestDraw.draw) } : null,
    },
    margins: margins.sort((a, b) => a.margin - b.margin),
    cherryPickMargin: cherryMargin,
    lowestMarginBookmaker: margins[0]?.bookmaker,
  };

  return { status: 'ok', data: result };
}
