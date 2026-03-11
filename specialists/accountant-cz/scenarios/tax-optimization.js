// Accountant-CZ Tax Optimization Scenario
// ══════════════════════════════════════════════════════════════════════════════
//
// Guided multi-step scenario for Czech tax structure optimization.
// Moved from core scenario-engine.js into self-contained specialist package.
//
// v121: Self-contained specialist scenario.
//
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Tax optimization scenario definition.
 * Registered into ScenarioRegistry during specialist register(ctx).
 */
export const taxOptimizationScenario = {
  id: 'accountant.tax_optimization',
  specialistId: 'accountant',
  name: 'Optimalizace daňové struktury',
  description: 'Provede uživatele optimalizací daní — OSVČ vs s.r.o., paušální vs skutečné výdaje.',
  introMessage: 'Pomohu vám optimalizovat vaši daňovou strukturu. Postupně se vás zeptám na pár údajů a pak spočítám nejlepší variantu.',

  triggers: [
    /optimali[zs]ovat?\s+da[nň]/i,
    /jak[áa]\s+struktura\s+je\s+v[yý]hodn/i,
    /osv[čc]\s+nebo\s+s\.?\s?r\.?\s?o/i,
    /nejlep[šs][íi]\s+(?:da[nň]|zdan[ěe]n[ií])/i,
    /porovn[áa]n[ií]\s+da[nň]/i,
    /pr[ůu]vodce\s+da[nň]/i,
  ],

  steps: [
    {
      id: 'income',
      question: 'Jaký je váš očekávaný hrubý roční příjem? (například: 850 000 Kč nebo 850k)',
      extract: (input) => {
        let m = input.match(/(\d[\d\s,.]*\d)\s*[kK]/);
        if (m) return parseFloat(m[1].replace(/[\s,]/g, '')) * 1000;
        m = input.match(/(\d[\d\s,.]*\d?)\s*[mM]/);
        if (m) return parseFloat(m[1].replace(/[\s,]/g, '')) * 1000000;
        m = input.match(/(\d{1,3}(?:\s\d{3})+|\d{4,})/);
        if (m) return parseInt(m[1].replace(/\s/g, ''));
        m = input.match(/(\d+)/);
        if (m && parseInt(m[1]) >= 1000) return parseInt(m[1]);
        return null;
      },
      required: true,
      validate: (v) => v > 0 && v < 100_000_000,
      errorMessage: 'Prosím zadejte platnou roční částku (např. 850000 nebo 850k).',
    },
    {
      id: 'entity_type',
      question: 'Jak podnikáte nebo chcete podnikat?\n  1. OSVČ (živnostník)\n  2. s.r.o.\n  3. Chci porovnat obě varianty',
      extract: (input) => {
        if (/1|osv[čc]|[žz]ivnost/i.test(input)) return 'osvc';
        if (/2|s\.?\s?r\.?\s?o|sro/i.test(input)) return 'sro';
        if (/3|ob[eě]|porovn|v[šs]e/i.test(input)) return 'compare';
        return null;
      },
      required: true,
      errorMessage: 'Zvolte prosím 1 (OSVČ), 2 (s.r.o.) nebo 3 (porovnání).',
    },
    {
      id: 'expense_type',
      question: 'Jaké výdaje uplatňujete?\n  1. Paušální 60 % (obchod, služby)\n  2. Paušální 80 % (řemesla, zemědělství)\n  3. Skutečné výdaje',
      extract: (input) => {
        if (/1|60\s*%|obchod|slu[žz]b/i.test(input)) return 'flat_60';
        if (/2|80\s*%|[řr]emesl|zem[ěe]d/i.test(input)) return 'flat_80';
        if (/3|skute[čc]n|actual|re[áa]ln/i.test(input)) return 'actual';
        return null;
      },
      skipIf: (collected) => collected.entity_type === 'sro',
      required: false,
      default: 'flat_60',
    },
    {
      id: 'year',
      question: 'Pro jaký rok počítáme? (Enter = aktuální rok)',
      extract: (input) => {
        const m = input.match(/(202[3-9]|203[0-5])/);
        if (m) return parseInt(m[1]);
        if (/enter|v[ýy]choz|aktu[áa]ln|letos/i.test(input) || input.trim().length === 0) {
          return new Date().getFullYear();
        }
        return null;
      },
      required: false,
      default: () => Math.min(new Date().getFullYear(), 2025),
    },
    {
      id: 'children',
      question: 'Kolik máte dětí, na které uplatňujete daňové zvýhodnění? (0 = žádné)',
      extract: (input) => {
        const m = input.match(/(\d+)/);
        if (m) return parseInt(m[0]);
        if (/[žz][áa]dn|ne|0|nic/i.test(input)) return 0;
        return null;
      },
      required: false,
      default: 0,
    },
  ],

  compute: async (collected) => {
    const { calculateTax, compareTaxEntities } = await import('../tools/tax-calc.js');

    const baseParams = {
      gross_income: collected.income,
      year: collected.year || 2025,
      expense_type: collected.expense_type || 'flat_60',
      children: collected.children || 0,
    };

    const results = {};

    if (collected.entity_type === 'compare') {
      const comparison = compareTaxEntities(collected.income, {
        ...baseParams,
        entity_type: 'osvc',
      });
      results.comparison = comparison;
      results.osvc = calculateTax({ ...baseParams, entity_type: 'osvc' });
      results.sro = calculateTax({ ...baseParams, entity_type: 'sro' });
    } else {
      results[collected.entity_type] = calculateTax({
        ...baseParams,
        entity_type: collected.entity_type,
      });
    }

    return results;
  },

  present: (results, collected) => {
    const lines = ['## Výsledky daňové kalkulace\n'];
    const fmt = (n) => typeof n === 'number' ? n.toLocaleString('cs-CZ') : String(n);

    if (results.comparison?.success && results.comparison.result) {
      const cmp = results.comparison.result;
      lines.push(`**Příjem:** ${fmt(collected.income)} Kč | **Rok:** ${collected.year || 2025}`);
      lines.push('');
      lines.push('| Položka | OSVČ | s.r.o. |');
      lines.push('|---------|------|--------|');
      if (cmp.osvc && cmp.sro) {
        lines.push(`| Čistý příjem | ${fmt(cmp.osvc.net_income)} Kč | ${fmt(cmp.sro.net_income)} Kč |`);
        lines.push(`| Efektivní sazba | ${cmp.osvc.effective_rate}% | ${cmp.sro.effective_rate}% |`);
        lines.push(`| Celkové odvody | ${fmt(cmp.osvc.total_deductions)} Kč | ${fmt(cmp.sro.total_deductions)} Kč |`);
      }
      if (cmp.recommendation) {
        lines.push(`\n**Doporučení:** ${cmp.recommendation}`);
      }
    } else {
      const key = collected.entity_type;
      const r = results[key];
      if (r?.success && r.result) {
        const d = r.result;
        lines.push(`**${key.toUpperCase()}** | **Příjem:** ${fmt(collected.income)} Kč | **Rok:** ${collected.year || 2025}`);
        lines.push('');
        lines.push(`- Čistý příjem: **${fmt(d.net_income)} Kč**`);
        lines.push(`- Daň z příjmu: ${fmt(d.income_tax)} Kč`);
        lines.push(`- Sociální pojištění: ${fmt(d.social_insurance)} Kč`);
        lines.push(`- Zdravotní pojištění: ${fmt(d.health_insurance)} Kč`);
        lines.push(`- Efektivní sazba: **${d.effective_rate}%**`);
      }
    }

    lines.push('\n---');
    lines.push('Chcete se zeptat na detaily, upravit parametry, nebo dostat doporučení?');
    return lines.join('\n');
  },

  recommendPrompt: 'Na základě výpočtů doporuč uživateli optimální daňovou strukturu. Uveď konkrétní čísla z výsledků. Vysvětli proč je zvolená varianta výhodnější. Zmiň relevantní rizika a podmínky.',
};
