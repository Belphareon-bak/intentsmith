// C3-Agent v57.3 — Czech Tax Rates Data Model
// ══════════════════════════════════════════════════════════════════════════════
//
// INVARIANT: Rok je KLÍČ k celé logice, ne jen parametr.
//   RATES[year].social_rate   ✅
//   const SOCIAL_RATE = 0.292 ❌ NIKDY
//
// Zdroje:
//   §7 ZDP (zákon č. 586/1992 Sb., o daních z příjmů)
//   §5 zákona č. 589/1992 Sb., o pojistném na sociální zabezpečení
//   §2 zákona č. 592/1992 Sb., o pojistném na veřejné zdravotní pojištění
//   §7a ZDP (paušální daň)
//
// ══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} YearRates
 * @property {Object} income_tax — Daň z příjmů
 * @property {Object} social — Sociální pojištění
 * @property {Object} health — Zdravotní pojištění
 * @property {Object} flat_expense — Paušální výdaje
 * @property {Object} flat_tax — Paušální daň (režim)
 * @property {Object} corporate — Daň z příjmů PO
 * @property {Object} vat — DPH
 * @property {Object} credits — Slevy na dani
 * @property {Object} salary — Mzdy / odvody zaměstnavatel
 */

export const RATES = {
  // ═══════════════════════════════════════════════════════════════════════════
  // 2024
  // ═══════════════════════════════════════════════════════════════════════════
  2024: {
    _meta: {
      verified_at: '2025-09-15',
      valid_from: '2024-01-01',
      valid_to: '2024-12-31',
      source: 'Sbírka zákonů, Finanční správa ČR',
      confidence: 'high',
    },
    income_tax: {
      // §16 ZDP — sazba daně z příjmů fyzických osob
      base_rate: 0.15,           // 15% do limitu
      higher_rate: 0.23,         // 23% nad limit (solidární zvýšení nahrazeno)
      higher_rate_threshold: 36 * 38_025, // 36× průměrná mzda = 1_368_900 Kč
      // Pozn: průměrná mzda 2024 = 43_967 Kč (pro výpočet pojistného)
      average_salary_monthly: 43_967,
    },

    social: {
      // Zákon č. 589/1992 Sb.
      // OSVČ platí z 50% základu daně
      osvc_base_multiplier: 0.5,   // Vyměřovací základ = 50% ZD
      osvc_rate: 0.292,            // 29.2% z vyměřovacího základu
      osvc_min_monthly: 3_852,     // Minimální záloha OSVČ (hlavní činnost)
      osvc_min_monthly_side: 1_413, // Minimální záloha OSVČ (vedlejší činnost)
      osvc_side_threshold: 105_520, // Rozhodná částka pro vedlejší činnost
      max_base: 48 * 43_967,      // Maximální roční vyměřovací základ = 48× PM
      // Zaměstnanec
      employee_rate: 0.065,        // 6.5%
      employer_rate: 0.248,        // 24.8%
    },

    health: {
      // Zákon č. 592/1992 Sb.
      osvc_base_multiplier: 0.5,   // 50% ZD
      osvc_rate: 0.135,            // 13.5% z vyměřovacího základu
      osvc_min_monthly: 2_968,     // Minimální záloha OSVČ
      // Zaměstnanec
      employee_rate: 0.045,        // 4.5%
      employer_rate: 0.09,         // 9%
      // Žádný strop u ZP
    },

    flat_expense: {
      // §7 odst. 7 ZDP — paušální výdaje
      rate_80: { rate: 0.80, max: 1_600_000, description: 'zemědělství, řemeslné živnosti' },
      rate_60: { rate: 0.60, max: 1_200_000, description: 'ostatní živnosti' },
      rate_40: { rate: 0.40, max: 800_000,   description: 'jiné podnikání (§7/2c), autorské honoráře' },
      rate_30: { rate: 0.30, max: 600_000,   description: 'pronájem (§9)' },
    },

    flat_tax: {
      // §7a ZDP — paušální daň
      enabled: true,
      monthly_payment: 7_498,      // Měsíční platba (2024)
      income_limit: 2_000_000,     // Max příjem pro vstup
      // Tři pásma od 2023
      band_1: { limit: 1_000_000, monthly: 7_498 },
      band_2: { limit: 1_500_000, monthly: 16_000 },
      band_3: { limit: 2_000_000, monthly: 26_000 },
      conditions: [
        'Neplátce DPH',
        'Příjmy pouze ze samostatné činnosti (§7) a/nebo kapitálové (§8)',
        'Příjem do limitu pásma',
        'Není společník veřejné obchodní společnosti',
      ],
    },

    corporate: {
      // §21 ZDP — sazba daně z příjmů právnických osob
      rate: 0.21,                  // 21%
      dividend_rate: 0.15,         // Srážková daň z dividendy
    },

    vat: {
      // Zákon č. 235/2004 Sb., o DPH
      standard_rate: 0.21,         // 21%
      reduced_rate: 0.12,          // 12% (od 2024 sloučená snížená sazba)
      zero_rate: 0.00,             // 0% (export, vybrané služby)
      registration_threshold: 2_000_000, // Povinná registrace od 2M Kč/12 měsíců
    },

    credits: {
      // §35ba ZDP — slevy na dani
      taxpayer: 30_840,            // Sleva na poplatníka (základní)
      spouse: 24_840,              // Sleva na manžela/manželku (příjem do 68k)
      disability_1: 2_520,         // Invalidita I. a II. stupně
      disability_2: 5_040,         // Invalidita III. stupně
      disability_severe: 16_140,   // ZTP/P
      student: 4_020,              // Student (do 26/28 let)
      kindergarten_max: 17_300,    // Max sleva za školkovné (za dítě)
      // §35c ZDP — daňové zvýhodnění na děti
      child_1: 15_204,             // 1. dítě
      child_2: 22_320,             // 2. dítě
      child_3: 27_840,             // 3. a další dítě
      child_disabled_bonus: 0,     // U ZTP/P se zvýhodnění zdvojnásobuje
      child_disabled_multiplier: 2,
    },

    salary: {
      min_wage_monthly: 18_900,    // Minimální mzda 2024
      min_wage_hourly: 112.50,
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 2025
  // ═══════════════════════════════════════════════════════════════════════════
  2025: {
    _meta: {
      verified_at: '2025-01-10',
      valid_from: '2025-01-01',
      valid_to: '2025-12-31',
      source: 'Nařízení vlády, odhady MPSV',
      confidence: 'medium',
      provisional: ['income_tax.average_salary_monthly', 'flat_tax.monthly_payment'],
    },
    income_tax: {
      base_rate: 0.15,
      higher_rate: 0.23,
      higher_rate_threshold: 36 * 40_324, // Průměrná mzda 2025 = 43_967→odhad 40_324 (upřesnit)
      average_salary_monthly: 40_324,     // TODO: ověřit po vyhlášení MPSV
    },

    social: {
      osvc_base_multiplier: 0.5,
      osvc_rate: 0.292,
      osvc_min_monthly: 4_759,     // Zvýšení od 2025 (nařízení vlády)
      osvc_min_monthly_side: 1_496,
      osvc_side_threshold: 111_736,
      max_base: 48 * 40_324,
      employee_rate: 0.065,
      employer_rate: 0.248,
    },

    health: {
      osvc_base_multiplier: 0.5,
      osvc_rate: 0.135,
      osvc_min_monthly: 3_070,
      employee_rate: 0.045,
      employer_rate: 0.09,
    },

    flat_expense: {
      rate_80: { rate: 0.80, max: 1_600_000, description: 'zemědělství, řemeslné živnosti' },
      rate_60: { rate: 0.60, max: 1_200_000, description: 'ostatní živnosti' },
      rate_40: { rate: 0.40, max: 800_000,   description: 'jiné podnikání, autorské honoráře' },
      rate_30: { rate: 0.30, max: 600_000,   description: 'pronájem' },
    },

    flat_tax: {
      enabled: true,
      monthly_payment: 7_498,      // TODO: ověřit po vyhlášení pro 2025
      income_limit: 2_000_000,
      band_1: { limit: 1_000_000, monthly: 7_498 },
      band_2: { limit: 1_500_000, monthly: 16_000 },
      band_3: { limit: 2_000_000, monthly: 26_000 },
      conditions: [
        'Neplátce DPH',
        'Příjmy pouze ze samostatné činnosti (§7) a/nebo kapitálové (§8)',
        'Příjem do limitu pásma',
      ],
    },

    corporate: {
      rate: 0.21,                  // Pozn: konsolidační balíček uvažoval 0.19, zatím platí 0.21
      dividend_rate: 0.15,
    },

    vat: {
      standard_rate: 0.21,
      reduced_rate: 0.12,
      zero_rate: 0.00,
      registration_threshold: 2_000_000,
    },

    credits: {
      taxpayer: 30_840,
      spouse: 24_840,
      disability_1: 2_520,
      disability_2: 5_040,
      disability_severe: 16_140,
      student: 4_020,
      kindergarten_max: 17_300,
      child_1: 15_204,
      child_2: 22_320,
      child_3: 27_840,
      child_disabled_bonus: 0,
      child_disabled_multiplier: 2,
    },

    salary: {
      min_wage_monthly: 20_800,    // Zvýšení od 1.1.2025
      min_wage_hourly: 124.40,
    },
  },
};

/**
 * Get rates for a specific year.
 * @param {number} year
 * @returns {YearRates}
 * @throws {Error} if year not supported
 */
export function getRates(year) {
  const rates = RATES[year];
  if (!rates) {
    const supported = Object.keys(RATES).join(', ');
    throw new Error(`Rok ${year} není podporován. Dostupné roky: ${supported}`);
  }
  return rates;
}

/**
 * List supported years.
 * @returns {number[]}
 */
export function supportedYears() {
  return Object.keys(RATES).map(Number).sort();
}

/**
 * Check if rates for a given year are stale.
 * @param {number} year
 * @param {number} [toleranceDays=180] — days since verified_at before considered stale
 * @returns {{ stale: boolean, confidence: string, warnings: string[] }}
 */
export function checkStaleness(year, toleranceDays = 180) {
  const rates = RATES[year];
  if (!rates) {
    return { stale: true, confidence: 'none', warnings: [`Rok ${year} není v databázi`] };
  }

  const meta = rates._meta;
  const warnings = [];
  const verifiedAt = new Date(meta.verified_at);
  const daysSince = Math.floor((Date.now() - verifiedAt.getTime()) / (1000 * 60 * 60 * 24));

  if (meta.confidence === 'medium') {
    warnings.push(`Rok ${year} obsahuje odhady/provizorní hodnoty`);
  }
  if (meta.provisional && meta.provisional.length > 0) {
    warnings.push(`Provizorní pole: ${meta.provisional.join(', ')}`);
  }

  const stale = daysSince > toleranceDays;
  if (stale) {
    warnings.push(`Sazby ověřeny před ${daysSince} dny (limit ${toleranceDays})`);
  }

  return {
    stale,
    confidence: meta.confidence || 'high',
    warnings,
    days_since_verification: daysSince,
  };
}

/**
 * Get staleness warnings for display in calculations.
 * @param {number} year
 * @returns {string[]}
 */
export function getStalenessWarnings(year) {
  const rates = RATES[year];
  if (!rates) return [`Rok ${year} není podporován`];

  const meta = rates._meta;
  const warnings = [];

  if (meta.confidence === 'medium') {
    warnings.push(`⚠️ Sazby pro rok ${year} mohou obsahovat odhady`);
  }
  if (meta.provisional && meta.provisional.length > 0) {
    warnings.push(`⚠️ Provizorní hodnoty: ${meta.provisional.join(', ')}`);
  }

  return warnings;
}

/**
 * Get topics that should be verified for a given year.
 * @param {number} year
 * @returns {Array<{ topic: string, searchQuery: string, fields: string[] }>}
 */
export function getVerificationTopics(year) {
  return [
    {
      topic: 'Minimální zálohy OSVČ — sociální pojištění',
      searchQuery: `minimální zálohy OSVČ sociální pojištění ${year}`,
      fields: ['social.osvc_min_monthly', 'social.osvc_min_monthly_side'],
    },
    {
      topic: 'Minimální zálohy OSVČ — zdravotní pojištění',
      searchQuery: `minimální zálohy OSVČ zdravotní pojištění ${year}`,
      fields: ['health.osvc_min_monthly'],
    },
    {
      topic: 'Sazba daně z příjmů a průměrná mzda',
      searchQuery: `sazba daně z příjmů fyzických osob průměrná mzda ${year}`,
      fields: ['income_tax.base_rate', 'income_tax.higher_rate', 'income_tax.average_salary_monthly'],
    },
    {
      topic: 'Sazby DPH',
      searchQuery: `sazby DPH Česká republika ${year}`,
      fields: ['vat.standard_rate', 'vat.reduced_rate'],
    },
    {
      topic: 'Minimální mzda',
      searchQuery: `minimální mzda ${year} Česko`,
      fields: ['salary.min_wage_monthly', 'salary.min_wage_hourly'],
    },
    {
      topic: 'Paušální daň a výdaje',
      searchQuery: `paušální daň OSVČ ${year} podmínky pásma`,
      fields: ['flat_tax.monthly_payment', 'flat_tax.income_limit'],
    },
  ];
}

export default { RATES, getRates, supportedYears, checkStaleness, getStalenessWarnings, getVerificationTopics };
