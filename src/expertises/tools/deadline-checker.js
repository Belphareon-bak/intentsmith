// C3-Agent v57.3 — Czech Tax Deadline Checker
// ══════════════════════════════════════════════════════════════════════════════
//
// Deterministický výpočet lhůt. Žádný LLM.
//
// Zdroje:
//   §136 zákona č. 280/2009 Sb. (daňový řád) — lhůty pro podání
//   §40 zákona č. 235/2004 Sb. (DPH) — kontrolní/souhrnné hlášení
//   §15 zákona č. 589/1992 Sb. — přehledy OSSZ
//   §24 zákona č. 592/1992 Sb. — přehledy VZP
//
// ══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} DeadlineInput
 * @property {'osvc'|'sro'} entity_type
 * @property {number} year — Zdaňovací období (za které se podává)
 * @property {boolean} [has_advisor=false] — Má daňového poradce (prodloužená lhůta)
 * @property {boolean} [is_vat_payer=false] — Plátce DPH
 * @property {'monthly'|'quarterly'} [vat_period='monthly'] — Zdaňovací období DPH
 * @property {Date|string} [reference_date] — Referenční datum (default: dnes)
 */

/**
 * @typedef {Object} Deadline
 * @property {string} id — Unique identifier
 * @property {string} name — Název povinnosti
 * @property {string} date — ISO date (YYYY-MM-DD)
 * @property {string} description — Podrobný popis
 * @property {'critical'|'high'|'medium'|'low'|'info'} urgency
 * @property {number} days_until — Dní do lhůty (záporné = po lhůtě)
 * @property {boolean} overdue — Již po lhůtě
 * @property {string} [penalty] — Popis sankce za nesplnění
 * @property {string} legal_ref — Odkaz na zákon
 */

/**
 * Get all tax deadlines for a given entity and year.
 *
 * @param {DeadlineInput} input
 * @returns {{ success: boolean, result?: DeadlineResult, error?: string }}
 */
export function checkDeadlines(input) {
  if (!input.entity_type || !['osvc', 'sro'].includes(input.entity_type)) {
    return { success: false, error: 'entity_type musí být osvc nebo sro' };
  }
  if (!input.year || input.year < 2023 || input.year > 2030) {
    return { success: false, error: 'year musí být platný rok (2023-2030)' };
  }

  const entityType = input.entity_type;
  const year = input.year;
  const filingYear = year + 1; // Lhůty se počítají v následujícím roce
  const hasAdvisor = input.has_advisor || false;
  const isVatPayer = input.is_vat_payer || false;
  const vatPeriod = input.vat_period || 'monthly';

  const refDate = input.reference_date ? new Date(input.reference_date) : new Date();
  const refDateStr = refDate.toISOString().slice(0, 10);

  const deadlines = [];

  // ══════════════════════════════════════════════════════════════════════════
  // DAŇOVÉ PŘIZNÁNÍ (DPFO / DPPO)
  // ══════════════════════════════════════════════════════════════════════════

  const taxType = entityType === 'osvc' ? 'DPFO' : 'DPPO';
  const taxLaw = entityType === 'osvc'
    ? '§136 zákona č. 280/2009 Sb. (daňový řád)'
    : '§136 zákona č. 280/2009 Sb. (daňový řád)';

  // Papírové přiznání: 1.4.
  if (!hasAdvisor) {
    deadlines.push({
      id: `${taxType.toLowerCase()}_paper`,
      name: `Přiznání ${taxType} (papírové)`,
      date: `${filingYear}-04-01`,
      description: `Podání daňového přiznání k dani z příjmů ${entityType === 'osvc' ? 'fyzických' : 'právnických'} osob za rok ${year}. Papírová forma.`,
      penalty: 'Pokuta za opožděné podání: min. 500 Kč, max 5% daně (§250 daňový řád)',
      legal_ref: taxLaw,
    });
  }

  // Elektronické přiznání: 2.5.
  deadlines.push({
    id: `${taxType.toLowerCase()}_electronic`,
    name: `Přiznání ${taxType} (elektronicky)`,
    date: hasAdvisor ? `${filingYear}-07-01` : `${filingYear}-05-02`,
    description: hasAdvisor
      ? `Prodloužená lhůta — podání přes daňového poradce na základě plné moci podané FÚ do 1.4.${filingYear}`
      : `Elektronické podání daňového přiznání za rok ${year} (datová schránka / EPO)`,
    penalty: 'Pokuta za opožděné podání: min. 500 Kč, max 5% daně',
    legal_ref: taxLaw,
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PŘEHLEDY OSVČ (jen pro OSVČ)
  // ══════════════════════════════════════════════════════════════════════════

  if (entityType === 'osvc') {
    const prehledDate = hasAdvisor ? `${filingYear}-08-01` : `${filingYear}-05-02`;

    deadlines.push({
      id: 'prehled_ossz',
      name: 'Přehled OSSZ',
      date: prehledDate,
      description: `Přehled o příjmech a výdajích OSVČ pro Okresní správu sociálního zabezpečení za rok ${year}. Lhůta: do měsíce po podání daňového přiznání.`,
      penalty: 'Pokuta do 20 000 Kč + penále z dlužného pojistného',
      legal_ref: '§15 zákona č. 589/1992 Sb.',
    });

    deadlines.push({
      id: 'prehled_vzp',
      name: 'Přehled VZP',
      date: prehledDate,
      description: `Přehled pro zdravotní pojišťovnu za rok ${year}. Lhůta: do měsíce po podání daňového přiznání.`,
      penalty: 'Pokuta do 50 000 Kč',
      legal_ref: '§24 zákona č. 592/1992 Sb.',
    });

    // Doplatek pojistného
    deadlines.push({
      id: 'doplatek_pojistne',
      name: 'Doplatek pojistného OSSZ + VZP',
      date: hasAdvisor ? `${filingYear}-08-08` : `${filingYear}-05-10`,
      description: `Doplatek na sociálním a zdravotním pojištění za rok ${year} (do 8 dnů po podání přehledu).`,
      penalty: 'Penále 0.05% z dlužné částky za každý den prodlení',
      legal_ref: '§20 zákona č. 589/1992 Sb.',
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ZÁLOHY NA DAŇ
  // ══════════════════════════════════════════════════════════════════════════

  // Pro vyšší daňové povinnosti (nad 150k pololetně, nad 30k čtvrtletně)
  deadlines.push({
    id: 'zaloha_1',
    name: 'Záloha na daň (1. pololetí)',
    date: `${filingYear}-06-15`,
    description: `Záloha na daň z příjmů. Platí při poslední známé daňové povinnosti nad 30 000 Kč.`,
    penalty: 'Úrok z prodlení (repo sazba + 14% p.a.)',
    legal_ref: '§38a ZDP',
  });

  deadlines.push({
    id: 'zaloha_2',
    name: 'Záloha na daň (2. pololetí)',
    date: `${filingYear}-12-15`,
    description: `Záloha na daň z příjmů — 2. pololetí.`,
    penalty: 'Úrok z prodlení',
    legal_ref: '§38a ZDP',
  });

  // ══════════════════════════════════════════════════════════════════════════
  // DPH (jen pro plátce)
  // ══════════════════════════════════════════════════════════════════════════

  if (isVatPayer) {
    // Kontrolní hlášení — vždy měsíčně pro PO, měsíčně/čtvrtletně pro FO
    const khPeriods = entityType === 'sro' ? generateMonthlyDates(filingYear) : 
      (vatPeriod === 'quarterly' ? generateQuarterlyDates(filingYear) : generateMonthlyDates(filingYear));

    for (const period of khPeriods) {
      deadlines.push({
        id: `kh_${period.label}`,
        name: `Kontrolní hlášení DPH (${period.label})`,
        date: period.date,
        description: `Kontrolní hlášení DPH za ${period.description}. Podání do 25. dne po skončení zdaňovacího období.`,
        penalty: 'Pokuta 10 000 Kč za pozdní podání (do 5 dnů), 30 000 Kč (do 5-30 dnů), 50 000 Kč (nad 30 dnů)',
        legal_ref: '§101e zákona č. 235/2004 Sb.',
      });
    }

    // Přiznání k DPH
    const dphPeriods = vatPeriod === 'quarterly' ? generateQuarterlyDates(filingYear) : generateMonthlyDates(filingYear);
    for (const period of dphPeriods) {
      deadlines.push({
        id: `dph_${period.label}`,
        name: `Přiznání k DPH (${period.label})`,
        date: period.date,
        description: `Daňové přiznání k DPH za ${period.description}`,
        penalty: 'Pokuta min. 500 Kč + úrok z prodlení',
        legal_ref: '§40 zákona č. 235/2004 Sb.',
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COMPUTE URGENCY + SORT
  // ══════════════════════════════════════════════════════════════════════════

  const enriched = deadlines.map(d => {
    const deadlineDate = new Date(d.date + 'T00:00:00');
    const daysUntil = Math.ceil((deadlineDate - refDate) / (1000 * 60 * 60 * 24));
    const overdue = daysUntil < 0;

    let urgency;
    if (overdue) urgency = 'critical';
    else if (daysUntil <= 3) urgency = 'critical';
    else if (daysUntil <= 14) urgency = 'high';
    else if (daysUntil <= 30) urgency = 'medium';
    else if (daysUntil <= 90) urgency = 'low';
    else urgency = 'info';

    return { ...d, days_until: daysUntil, overdue, urgency };
  });

  // Sort: overdue first, then by date ascending
  enriched.sort((a, b) => {
    if (a.overdue && !b.overdue) return -1;
    if (!a.overdue && b.overdue) return 1;
    return new Date(a.date) - new Date(b.date);
  });

  // Next deadline (not overdue)
  const nextDeadline = enriched.find(d => !d.overdue) || null;
  const overdueList = enriched.filter(d => d.overdue);
  const upcomingList = enriched.filter(d => !d.overdue);

  return {
    success: true,
    result: {
      entity_type: entityType,
      year,
      filing_year: filingYear,
      has_advisor: hasAdvisor,
      is_vat_payer: isVatPayer,
      reference_date: refDateStr,
      deadlines: enriched,
      next_deadline: nextDeadline,
      overdue: overdueList,
      upcoming: upcomingList,
      total_count: enriched.length,
      overdue_count: overdueList.length,
      assumptions: [
        `Zdaňovací období: ${year}`,
        `Referenční datum: ${refDateStr}`,
        hasAdvisor ? 'Prodloužené lhůty (daňový poradce + plná moc)' : 'Standardní lhůty (bez daňového poradce)',
        entityType === 'osvc' ? 'OSVČ — hlavní činnost' : 's.r.o. — kalendářní rok',
      ],
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Period generators (for DPH deadlines)
// ─────────────────────────────────────────────────────────────────────────────

function generateMonthlyDates(year) {
  const periods = [];
  for (let month = 1; month <= 12; month++) {
    // Deadline is 25th of the FOLLOWING month
    const deadlineMonth = month === 12 ? 1 : month + 1;
    const deadlineYear = month === 12 ? year + 1 : year;
    const date = `${deadlineYear}-${String(deadlineMonth).padStart(2, '0')}-25`;
    const monthNames = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen',
                         'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
    periods.push({
      label: `${year}-${String(month).padStart(2, '0')}`,
      date,
      description: `${monthNames[month - 1]} ${year}`,
    });
  }
  return periods;
}

function generateQuarterlyDates(year) {
  return [
    { label: `Q1-${year}`, date: `${year}-04-25`, description: `1. čtvrtletí ${year}` },
    { label: `Q2-${year}`, date: `${year}-07-25`, description: `2. čtvrtletí ${year}` },
    { label: `Q3-${year}`, date: `${year}-10-25`, description: `3. čtvrtletí ${year}` },
    { label: `Q4-${year}`, date: `${year + 1}-01-25`, description: `4. čtvrtletí ${year}` },
  ];
}

export default { checkDeadlines };
