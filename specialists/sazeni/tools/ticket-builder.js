// Ticket Builder Tool — Sestavení sázkového tiketu
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Kelly criterion for optimal stake sizing.
 * f* = (bp - q) / b
 * where b = decimal odds - 1, p = probability, q = 1-p
 * Capped at fractional Kelly (25%) for safety.
 */
function kellyFraction(decimalOdds, probability, fraction = 0.25) {
  const b = decimalOdds - 1;
  const p = probability;
  const q = 1 - p;
  const kelly = (b * p - q) / b;
  if (kelly <= 0) return 0;
  return Math.round(kelly * fraction * 10000) / 10000;
}

/**
 * Calculate combined odds for an accumulator (multi-bet).
 */
function combinedOdds(selections) {
  return selections.reduce((acc, s) => acc * s.odds, 1);
}

/**
 * Calculate potential return for a ticket.
 */
function potentialReturn(stake, totalOdds) {
  return Math.round(stake * totalOdds * 100) / 100;
}

/**
 * Calculate combined probability for independent events.
 */
function combinedProbability(selections) {
  return selections.reduce((acc, s) => acc * (s.probability || (1 / s.odds)), 1);
}

/**
 * Risk classification.
 */
function riskLevel(probability) {
  if (probability > 0.5) return 'nízké';
  if (probability > 0.25) return 'střední';
  if (probability > 0.10) return 'vyšší';
  return 'vysoké';
}

/**
 * Build a betting ticket from selections.
 *
 * @param {Object} params
 * @param {Array} params.selections - Array of { match, outcome, odds, probability?, bookmaker?, confidence? }
 * @param {number} [params.stake=100] - Total stake in CZK
 * @param {string} [params.type='accumulator'] - Ticket type: single, accumulator, system
 * @param {string} [params.system] - System type (e.g., '2/3', '3/4') — only for type=system
 * @param {number} [params.bankroll] - Total bankroll for Kelly sizing
 */
export function buildTicket(params) {
  const { selections, stake, type, system, bankroll } = params;

  if (!selections || !Array.isArray(selections) || selections.length === 0) {
    return {
      status: 'clarify',
      missingParams: ['selections'],
      message: 'Zadej sázkové tipy. Formát: pole s match, outcome (1/X/2/over/under/...), odds, a volitelně probability.',
    };
  }

  const totalStake = stake || 100;
  const ticketType = type || (selections.length === 1 ? 'single' : 'accumulator');

  // Normalize selections
  const normalized = selections.map((s, i) => ({
    index: i + 1,
    match: s.match || `Zápas ${i + 1}`,
    outcome: s.outcome || '?',
    odds: Number(s.odds) || 1.5,
    probability: s.probability || Math.round((1 / (Number(s.odds) || 1.5)) * 100) / 100,
    bookmaker: s.bookmaker || null,
    confidence: s.confidence || null,
  }));

  // Individual edge for each selection
  const withEdge = normalized.map(s => ({
    ...s,
    impliedProbability: Math.round((1 / s.odds) * 10000) / 100,
    edge: Math.round((s.probability - (1 / s.odds)) * 10000) / 100,
    isValue: s.probability > (1 / s.odds) + 0.03,
  }));

  let ticketResult;

  if (ticketType === 'single') {
    // Single bets — stake distributed
    const singleStake = Math.round((totalStake / normalized.length) * 100) / 100;
    ticketResult = {
      type: 'single',
      bets: withEdge.map(s => ({
        ...s,
        stake: singleStake,
        potentialWin: potentialReturn(singleStake, s.odds),
        kellyStake: bankroll ? Math.round(bankroll * kellyFraction(s.odds, s.probability)) : null,
      })),
      totalStake,
      bestCase: withEdge.reduce((sum, s) => sum + potentialReturn(singleStake, s.odds), 0),
      worstCase: -totalStake,
    };
  } else if (ticketType === 'system') {
    // System bet (e.g., 2/3)
    const [k, n] = (system || '').split('/').map(Number);
    if (!k || !n || k > n || n !== normalized.length) {
      return {
        status: 'error',
        error: `Neplatný systém "${system}". Formát: k/n kde k < n a n = počet tipů (${normalized.length}).`,
      };
    }

    // Generate all k-combinations
    const combos = [];
    const indices = Array.from({ length: n }, (_, i) => i);
    function* combinations(arr, k, start = 0, current = []) {
      if (current.length === k) { yield [...current]; return; }
      for (let i = start; i <= arr.length - (k - current.length); i++) {
        current.push(arr[i]);
        yield* combinations(arr, k, i + 1, current);
        current.pop();
      }
    }

    for (const combo of combinations(indices, k)) {
      const sel = combo.map(i => normalized[i]);
      combos.push({
        picks: combo.map(i => i + 1),
        odds: Math.round(combinedOdds(sel) * 100) / 100,
        probability: Math.round(combinedProbability(sel) * 10000) / 100,
      });
    }

    const comboStake = Math.round((totalStake / combos.length) * 100) / 100;

    ticketResult = {
      type: 'system',
      system: `${k}/${n}`,
      combinations: combos.length,
      stakePerCombo: comboStake,
      totalStake: Math.round(comboStake * combos.length * 100) / 100,
      combos: combos.map(c => ({
        ...c,
        potentialWin: potentialReturn(comboStake, c.odds),
      })),
      bestCase: combos.reduce((sum, c) => sum + potentialReturn(comboStake, c.odds), 0),
      worstCase: -Math.round(comboStake * combos.length * 100) / 100,
    };
  } else {
    // Accumulator (default)
    const totalOdds = Math.round(combinedOdds(normalized) * 100) / 100;
    const totalProb = combinedProbability(normalized);

    ticketResult = {
      type: 'accumulator',
      selections: withEdge,
      totalOdds,
      combinedProbability: Math.round(totalProb * 10000) / 100,
      stake: totalStake,
      potentialReturn: potentialReturn(totalStake, totalOdds),
      profit: potentialReturn(totalStake, totalOdds) - totalStake,
      kellyStake: bankroll ? Math.round(bankroll * kellyFraction(totalOdds, totalProb)) : null,
    };
  }

  // Risk assessment
  const overallProb = ticketType === 'accumulator'
    ? combinedProbability(normalized)
    : normalized.reduce((min, s) => Math.min(min, s.probability), 1);

  const risk = riskLevel(overallProb);
  const valueCount = withEdge.filter(s => s.isValue).length;
  const noValueCount = withEdge.filter(s => !s.isValue).length;

  // Warnings
  const warnings = [];
  if (normalized.length > 6) warnings.push('Tiket s více než 6 tipy má velmi nízkou pravděpodobnost výhry');
  if (overallProb < 0.05) warnings.push('Celková pravděpodobnost je pod 5% — vysoce spekulativní');
  if (noValueCount > 0) warnings.push(`${noValueCount} z ${normalized.length} tipů nemá pozitivní edge`);
  if (normalized.some(s => s.odds < 1.15)) warnings.push('Tip s kurzem pod 1.15 — minimální výnos, vysoké riziko ztráty akumulátoru');

  return {
    status: 'ok',
    data: {
      ticket: ticketResult,
      riskAssessment: {
        level: risk,
        overallProbability: Math.round(overallProb * 10000) / 100,
        valueSelections: valueCount,
        totalSelections: normalized.length,
      },
      warnings,
      summary: `Tiket: ${ticketType} | ${normalized.length} tipů | kurz ${ticketType === 'accumulator' ? ticketResult.totalOdds : 'viz kombiance'} | riziko: ${risk}`,
    },
  };
}
