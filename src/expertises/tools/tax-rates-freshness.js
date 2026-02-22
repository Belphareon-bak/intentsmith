// C3-Agent v57.3 — Tax Rates Freshness & Verification Strategy
// ══════════════════════════════════════════════════════════════════════════════
//
// Modul pro ověřování aktuálnosti daňových sazeb.
// Používá _meta z tax-rates.js pro určení stáří dat.
//
// ══════════════════════════════════════════════════════════════════════════════

import { RATES, supportedYears } from './tax-rates.js';

// ─────────────────────────────────────────────────────────────────────────────
// Verification Sources — official Czech tax data endpoints
// ─────────────────────────────────────────────────────────────────────────────

export const VERIFICATION_SOURCES = [
  {
    id: 'cssz_osvc',
    name: 'ČSSZ — zálohy OSVČ',
    url: 'https://www.cssz.cz/web/cz/osvc-platba-pojistneho',
    affects: ['social.osvc_min_monthly', 'social.osvc_rate', 'social.max_base'],
    keywords: ['záloha', 'OSVČ', 'sociální pojištění', 'minimální'],
    check_frequency_days: 30,
  },
  {
    id: 'vzp_osvc',
    name: 'VZP — zálohy OSVČ',
    url: 'https://www.vzp.cz/platci/informace/osvc/platba-pojistneho',
    affects: ['health.osvc_min_monthly', 'health.osvc_rate'],
    keywords: ['záloha', 'zdravotní pojištění', 'OSVČ'],
    check_frequency_days: 30,
  },
  {
    id: 'mpsv_min_wage',
    name: 'MPSV — minimální mzda',
    url: 'https://www.mpsv.cz/minimalni-mzda',
    affects: ['salary.min_wage_monthly', 'salary.min_wage_hourly'],
    keywords: ['minimální mzda', 'nařízení vlády'],
    check_frequency_days: 90,
  },
  {
    id: 'zdp_sazby',
    name: 'Finanční správa — sazby daně z příjmů',
    url: 'https://www.financnisprava.cz/cs/dane/dane/dan-z-prijmu',
    affects: ['income_tax.base_rate', 'income_tax.higher_rate', 'credits.taxpayer'],
    keywords: ['sazba', 'daň z příjmů', 'sleva na poplatníka'],
    check_frequency_days: 60,
  },
  {
    id: 'dph_sazby',
    name: 'Finanční správa — sazby DPH',
    url: 'https://www.financnisprava.cz/cs/dane/dane/dan-z-pridane-hodnoty',
    affects: ['vat.standard_rate', 'vat.reduced_rate', 'vat.registration_threshold'],
    keywords: ['DPH', 'sazba', 'snížená', 'základní'],
    check_frequency_days: 90,
  },
  {
    id: 'pausalni_dan',
    name: 'Finanční správa — paušální daň',
    url: 'https://www.financnisprava.cz/cs/dane/dane/pausalni-dan',
    affects: ['flat_tax.monthly_payment', 'flat_tax.income_limit'],
    keywords: ['paušální daň', 'pásmo', 'měsíční záloha'],
    check_frequency_days: 90,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Freshness Check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check freshness of rate data for a given year.
 * @param {number} year
 * @returns {{ fresh: boolean, year_status: string, last_check: string|null, days_since_check: number, warnings: string[], low_confidence: string[] }}
 */
export function checkFreshness(year) {
  const rates = RATES[year];

  if (!rates) {
    return {
      fresh: false,
      year_status: 'unknown',
      last_check: null,
      days_since_check: Infinity,
      warnings: [`Rok ${year} není v databázi sazeb`],
      low_confidence: [],
    };
  }

  const meta = rates._meta;
  const verifiedAt = new Date(meta.verified_at);
  const daysSince = Math.floor((Date.now() - verifiedAt.getTime()) / (1000 * 60 * 60 * 24));

  const isProvisional = meta.confidence === 'medium' || (meta.provisional && meta.provisional.length > 0);
  const yearStatus = isProvisional ? 'provisional' : 'verified';

  const warnings = [];
  const lowConfidence = [];

  if (isProvisional) {
    warnings.push(`⚠️ Sazby pro rok ${year} jsou provizorní a mohou se změnit`);
    if (meta.provisional) {
      for (const field of meta.provisional) {
        lowConfidence.push(field);
        warnings.push(`⚠️ Provizorní: ${field}`);
      }
    }
  }

  if (daysSince > 180) {
    warnings.push(`⚠️ Sazby ověřeny před ${daysSince} dny`);
  }

  return {
    fresh: !isProvisional && daysSince <= 180,
    year_status: yearStatus,
    last_check: meta.verified_at,
    days_since_check: daysSince,
    warnings,
    low_confidence: lowConfidence,
  };
}

/**
 * Get freshness warnings for display.
 * @param {number} year
 * @returns {string[]}
 */
export function getFreshnessWarnings(year) {
  const result = checkFreshness(year);
  return result.warnings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Verification Strategy
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_QUERY_MAP = {
  social: 'minimální zálohy OSVČ sociální pojištění',
  health: 'minimální zálohy OSVČ zdravotní pojištění',
  income_tax: 'sazba daně z příjmů fyzických osob',
  vat: 'sazby DPH Česká republika',
  salary: 'minimální mzda Česko',
  flat_tax: 'paušální daň OSVČ podmínky',
};

/**
 * Determine whether rates need verification before calculation.
 * @param {number} year
 * @param {string[]} [categories] — specific rate categories to check
 * @returns {{ should_verify: boolean, queries: string[], reason: string }}
 */
export function getVerificationStrategy(year, categories = null) {
  const rates = RATES[year];
  const currentYear = new Date().getFullYear();

  // Past verified years don't need verification
  if (rates && rates._meta.confidence === 'high' && year < currentYear) {
    return {
      should_verify: false,
      queries: [],
      reason: `Rok ${year} je ověřený a uzavřený`,
    };
  }

  // Current or future year, or provisional — needs verification
  const queries = [];

  if (categories && categories.length > 0) {
    for (const cat of categories) {
      const queryTemplate = CATEGORY_QUERY_MAP[cat];
      if (queryTemplate) {
        queries.push(`${queryTemplate} ${year}`);
      }
    }
  } else {
    // General verification queries
    queries.push(`daňové sazby Česká republika ${year}`);
    queries.push(`zálohy OSVČ sociální zdravotní pojištění ${year}`);
    queries.push(`minimální mzda ${year} Česko`);
  }

  return {
    should_verify: true,
    queries,
    reason: year >= currentYear
      ? `Rok ${year} je aktuální/budoucí — sazby mohou být provizorní`
      : `Rok ${year} nemá plnou důvěru v datech`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate Monitor Agent Definition
// ─────────────────────────────────────────────────────────────────────────────

export const RATE_MONITOR_AGENT = {
  id: 'tax-rate-monitor',
  name: 'Hlídač daňových sazeb',
  schedule: '0 9 * * 1',  // Monday 9:00
  enabled: true,

  /**
   * Get verification sources that are due for a check.
   * @param {Object<string, string>} lastChecks — map of source.id → ISO date of last check
   * @returns {Array} sources due for checking
   */
  getSourcesDueForCheck(lastChecks) {
    const now = Date.now();
    return VERIFICATION_SOURCES.filter(source => {
      const lastCheck = lastChecks[source.id];
      if (!lastCheck) return true;
      const daysSince = Math.floor((now - new Date(lastCheck).getTime()) / (1000 * 60 * 60 * 24));
      return daysSince >= source.check_frequency_days;
    });
  },

  /**
   * Build search queries for due sources.
   * @param {Array} dueSources
   * @param {number} [year]
   * @returns {string[]}
   */
  buildSearchQueries(dueSources = VERIFICATION_SOURCES, year = new Date().getFullYear()) {
    return dueSources.map(source =>
      `${source.keywords.slice(0, 3).join(' ')} ${year}`
    );
  },
};

export default { checkFreshness, getFreshnessWarnings, getVerificationStrategy, VERIFICATION_SOURCES, RATE_MONITOR_AGENT };
