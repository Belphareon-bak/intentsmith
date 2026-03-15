// Match Analysis Tool — Analýza zápasu / sportovní události
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Scoring weights for different analysis factors.
 */
const FACTOR_WEIGHTS = {
  form:        0.25,   // Recent form (last 5-10 matches)
  h2h:         0.15,   // Head-to-head record
  home_away:   0.15,   // Home/away advantage
  injuries:    0.10,   // Key player absences
  motivation:  0.10,   // Tournament stakes, relegation, etc.
  rest:        0.05,   // Days since last match
  odds_move:   0.10,   // Odds movement direction
  stats:       0.10,   // Goals, xG, possession, shots etc.
};

/**
 * Normalize a 0-10 score to 0-1.
 */
function normalize(score) {
  return Math.max(0, Math.min(1, score / 10));
}

/**
 * Calculate weighted composite score from factors.
 */
function compositeScore(factors) {
  let total = 0;
  let weightSum = 0;
  for (const [key, value] of Object.entries(factors)) {
    const w = FACTOR_WEIGHTS[key] || 0.05;
    total += normalize(value.score) * w;
    weightSum += w;
  }
  return weightSum > 0 ? Math.round((total / weightSum) * 100) / 100 : 0.5;
}

/**
 * Derive a confidence label from composite score difference.
 */
function confidenceLabel(diff) {
  if (diff > 0.25) return 'vysoká';
  if (diff > 0.12) return 'střední';
  return 'nízká';
}

/**
 * Analyze a match based on provided factors.
 *
 * @param {Object} params
 * @param {string} params.home - Home team name
 * @param {string} params.away - Away team name
 * @param {string} [params.sport='football'] - Sport type
 * @param {Object} [params.homeFactors] - Factor scores (0-10) for home team
 * @param {Object} [params.awayFactors] - Factor scores (0-10) for away team
 * @param {Object} [params.odds] - Current odds { home, draw, away }
 * @param {string} [params.context] - Additional context (tournament, round, etc.)
 */
export function analyzeMatch(params) {
  const { home, away, sport, homeFactors, awayFactors, odds, context } = params;

  if (!home || !away) {
    return {
      status: 'clarify',
      missingParams: !home && !away ? ['home', 'away'] : !home ? ['home'] : ['away'],
      message: 'Zadej jména obou týmů / hráčů.',
    };
  }

  // If no detailed factors provided, return analysis template
  if (!homeFactors && !awayFactors) {
    return {
      status: 'ok',
      data: {
        match: `${home} vs ${away}`,
        sport: sport || 'football',
        context: context || null,
        analysisTemplate: {
          description: 'Pro detailní analýzu zadej faktory pro oba týmy (0-10):',
          factors: Object.keys(FACTOR_WEIGHTS),
          example: {
            homeFactors: { form: 7, h2h: 6, home_away: 8, injuries: 5, motivation: 7, rest: 6, odds_move: 5, stats: 7 },
            awayFactors: { form: 6, h2h: 5, home_away: 4, injuries: 7, motivation: 6, rest: 7, odds_move: 6, stats: 5 },
          },
        },
        odds: odds || null,
        impliedProbabilities: odds ? {
          home: odds.home ? Math.round((1 / odds.home) * 10000) / 100 : null,
          draw: odds.draw ? Math.round((1 / odds.draw) * 10000) / 100 : null,
          away: odds.away ? Math.round((1 / odds.away) * 10000) / 100 : null,
        } : null,
      },
    };
  }

  const hFactors = homeFactors || {};
  const aFactors = awayFactors || {};
  const hScore = compositeScore(hFactors);
  const aScore = compositeScore(aFactors);
  const diff = Math.abs(hScore - aScore);

  // Predicted outcome
  let prediction;
  if (hScore > aScore + 0.05) {
    prediction = { outcome: '1', team: home, type: 'home_win' };
  } else if (aScore > hScore + 0.05) {
    prediction = { outcome: '2', team: away, type: 'away_win' };
  } else {
    prediction = { outcome: 'X', team: null, type: 'draw' };
  }
  prediction.confidence = confidenceLabel(diff);

  // Value assessment vs odds
  let valueAssessment = null;
  if (odds) {
    const impliedHome = odds.home ? 1 / odds.home : null;
    const impliedAway = odds.away ? 1 / odds.away : null;
    const impliedDraw = odds.draw ? 1 / odds.draw : null;

    valueAssessment = {};
    if (impliedHome != null) {
      valueAssessment.home = {
        ourProbability: Math.round(hScore * 100),
        impliedProbability: Math.round(impliedHome * 100),
        edge: Math.round((hScore - impliedHome) * 10000) / 100,
        isValue: hScore > impliedHome + 0.03,
      };
    }
    if (impliedAway != null) {
      valueAssessment.away = {
        ourProbability: Math.round(aScore * 100),
        impliedProbability: Math.round(impliedAway * 100),
        edge: Math.round((aScore - impliedAway) * 10000) / 100,
        isValue: aScore > impliedAway + 0.03,
      };
    }
    if (impliedDraw != null) {
      const drawProb = 1 - hScore - aScore;
      valueAssessment.draw = {
        ourProbability: Math.round(Math.max(0, drawProb) * 100),
        impliedProbability: Math.round(impliedDraw * 100),
        edge: Math.round((drawProb - impliedDraw) * 10000) / 100,
        isValue: drawProb > impliedDraw + 0.03,
      };
    }
  }

  // Key insights
  const insights = [];
  const hf = hFactors;
  const af = aFactors;

  if ((hf.form?.score || 0) >= 8) insights.push(`${home} je ve výborné formě`);
  if ((af.form?.score || 0) >= 8) insights.push(`${away} je ve výborné formě`);
  if ((hf.injuries?.score || 5) <= 3) insights.push(`${home} má vážné absences`);
  if ((af.injuries?.score || 5) <= 3) insights.push(`${away} má vážné absences`);
  if ((hf.motivation?.score || 5) >= 8) insights.push(`${home} má vysokou motivaci`);
  if ((af.motivation?.score || 5) >= 8) insights.push(`${away} má vysokou motivaci`);
  if ((hf.home_away?.score || 5) >= 8) insights.push(`${home} má silnou domácí bilanci`);

  return {
    status: 'ok',
    data: {
      match: `${home} vs ${away}`,
      sport: sport || 'football',
      context: context || null,
      scores: {
        home: { team: home, composite: hScore, factors: hFactors },
        away: { team: away, composite: aScore, factors: awayFactors },
      },
      prediction,
      valueAssessment,
      insights,
      recommendation: prediction.confidence === 'nízká'
        ? 'Těsný zápas — zvážit nižší stake nebo přeskočit'
        : `Doporučuji ${prediction.outcome} (${prediction.team || 'remíza'}) s ${prediction.confidence} jistotou`,
    },
  };
}
