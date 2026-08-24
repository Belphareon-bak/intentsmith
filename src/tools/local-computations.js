// Pure deterministic LOCAL computations. This leaf module deliberately has
// no chat or executor imports so both layers can share one implementation
// without creating a module cycle.

export function computeDate(input) {
  const now = new Date();

  if (/kolik\s+(je\s+)?hodin|what.*time|current.*time/i.test(input)) {
    return {
      answer: now.toLocaleTimeString('cs-CZ'),
      explanation: `Aktuální čas: ${now.toLocaleTimeString('cs-CZ')}`,
    };
  }

  if (/datum|date|den|day/i.test(input)) {
    const dayNames = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
    return {
      answer: now.toLocaleDateString('cs-CZ'),
      dayOfWeek: dayNames[now.getDay()],
      explanation: `Dnes je ${dayNames[now.getDay()]}, ${now.toLocaleDateString('cs-CZ')}`,
    };
  }

  return {
    answer: now.toLocaleString('cs-CZ'),
    explanation: `Aktuální datum a čas: ${now.toLocaleString('cs-CZ')}`,
  };
}

export function computeCalendar(input) {
  const now = new Date();

  if (/úplněk|uplnek|full.*moon/i.test(input)) {
    const lunarCycle = 29.53;
    const refFullMoon = new Date('2025-01-13');
    const daysSinceRef = (now - refFullMoon) / (1000 * 60 * 60 * 24);
    const daysInCurrentCycle = daysSinceRef % lunarCycle;
    const daysToFullMoon = Math.round(lunarCycle - daysInCurrentCycle);
    const nextFullMoon = new Date(now);
    nextFullMoon.setDate(nextFullMoon.getDate() + daysToFullMoon);
    const todayStr = now.toLocaleDateString('cs-CZ');
    return {
      type: 'moon',
      answer: daysToFullMoon,
      unit: 'dní',
      date: nextFullMoon.toLocaleDateString('cs-CZ'),
      today: todayStr,
      explanation: `Příští úplněk bude za ${daysToFullMoon} dní (${nextFullMoon.toLocaleDateString('cs-CZ')}), počítáno od ${todayStr}`,
    };
  }

  if (/váno|vanoc|christmas/i.test(input)) {
    const christmas = new Date(now.getFullYear(), 11, 24);
    if (christmas < now) christmas.setFullYear(christmas.getFullYear() + 1);
    const days = Math.ceil((christmas - now) / (1000 * 60 * 60 * 24));
    const todayStr = now.toLocaleDateString('cs-CZ');
    return {
      type: 'christmas',
      answer: days,
      unit: 'dní',
      date: christmas.toLocaleDateString('cs-CZ'),
      today: todayStr,
      explanation: `Do Vánoc zbývá ${days} dní (od ${todayStr})`,
    };
  }

  return computeDate(input);
}

export function normalizeCzechMath(input) {
  let expr = input.toLowerCase().trim();
  expr = expr
    .replace(/^(vypočít[ea][jž]\s*(mi\s*(prosím\s*)?)?)/i, '')
    .replace(/^(spočít[ea][jž]\s*(mi\s*(prosím\s*)?)?)/i, '')
    .replace(/^(kolik\s+je\s*)/i, '')
    .replace(/^(jaký\s+je\s+výsledek\s*)/i, '')
    .trim();
  expr = expr.replace(/\s*(děleno|lomeno|÷)\s*/gi, ' / ');
  expr = expr.replace(/\s*(krát|×)\s*/gi, ' * ');
  expr = expr.replace(/\s+plus\s+/gi, ' + ');
  expr = expr.replace(/(\d)\s+a\s+(\d)/g, '$1 + $2');
  expr = expr.replace(/\s*(mínus|minus|méně)\s*/gi, ' - ');
  expr = expr.replace(/(\d+)\s+na\s+druhou/gi, '$1 ** 2');
  expr = expr.replace(/(\d+)\s+na\s+t[řr]et[ií]/gi, '$1 ** 3');
  expr = expr.replace(/odmocnina\s+z\s+(\d+)/gi, 'Math.sqrt($1)');
  expr = expr.replace(/(\d+)\s*procent\s+z\s+(\d+)/gi, '($1/100)*$2');
  const sqrtPlaceholder = '\x00SQ\x00';
  const powPlaceholder = '\x00PW\x00';
  expr = expr.replace(/Math\.sqrt/g, sqrtPlaceholder);
  expr = expr.replace(/\*\*/g, powPlaceholder);
  expr = expr.replace(/[a-záčďéěíňóřšťúůýž]+/gi, '').trim();
  expr = expr.replace(new RegExp(sqrtPlaceholder.replace(/\x00/g, '\\x00'), 'g'), 'Math.sqrt');
  expr = expr.replace(new RegExp(powPlaceholder.replace(/\x00/g, '\\x00'), 'g'), '**');
  expr = expr.replace(/\s{2,}/g, ' ').trim();
  return expr || null;
}

export function computeMath(input) {
  const nonFiniteResult = (expression, result) => ({
    answer: NaN,
    expression,
    error: 'non_finite_result',
    nonFiniteResult: Number.isNaN(result) ? 'NaN' : String(result),
    explanation: `${expression} does not have a finite numeric result`,
  });

  const dphMatch = input.match(/dph\s+(?:z\s+)?(?:částky\s+)?(\d[\d\s]*)\s*(?:kč\s*)?(?:při\s+(?:sazbě\s+)?)?(\d+)\s*%/i);
  if (dphMatch) {
    const base = parseFloat(dphMatch[1].replace(/\s/g, ''));
    const rate = parseFloat(dphMatch[2]);
    const vat = Math.round(base * rate / 100 * 100) / 100;
    return {
      answer: vat,
      expression: `DPH ${rate}% z ${base}`,
      explanation: `Základ: ${base} Kč, DPH ${rate}%: ${vat} Kč, celkem s DPH: ${base + vat} Kč`,
    };
  }

  const factMatch = input.match(/(\d+)\s*!/);
  if (factMatch) {
    const n = parseInt(factMatch[1], 10);
    if (n >= 0 && n <= 170) {
      let result = 1;
      for (let index = 2; index <= n; index += 1) result *= index;
      return { answer: result, expression: `${n}!`, explanation: `${n}! = ${result}` };
    }
  }

  const powMatch = input.match(/(\d+)\s*(?:\*\*|\^)\s*(\d+)/);
  if (powMatch) {
    const result = Math.pow(parseFloat(powMatch[1]), parseFloat(powMatch[2]));
    return {
      answer: result,
      expression: `${powMatch[1]} ** ${powMatch[2]}`,
      explanation: `${powMatch[1]} ** ${powMatch[2]} = ${result}`,
    };
  }

  const exprMatch = input.match(/([\d]+(?:\s*[+\-*/]\s*[\d]+)+)/);
  if (exprMatch) {
    const expression = exprMatch[1].replace(/\s+/g, '');
    if (/^[\d+\-*/().]+$/.test(expression)) {
      try {
        const result = Function(`"use strict"; return (${expression})`)();
        if (typeof result === 'number' && Number.isFinite(result)) {
          return { answer: result, expression, explanation: `${expression} = ${result}` };
        }
        if (typeof result === 'number') return nonFiniteResult(expression, result);
      } catch {
        // Fall through to Czech normalization.
      }
    }
  }

  const normalized = normalizeCzechMath(input);
  if (normalized && /[\d]/.test(normalized)) {
    try {
      const safe = /^[\d\s+\-*/().%]*(?:Math\.sqrt\([\d.]+\))?[\d\s+\-*/().%]*$/.test(normalized)
        || /\*\*/.test(normalized);
      if (safe) {
        const result = Function(`"use strict"; return (${normalized})`)();
        if (typeof result === 'number' && Number.isFinite(result)) {
          return { answer: result, expression: normalized, explanation: `${normalized} = ${result}` };
        }
        if (typeof result === 'number') return nonFiniteResult(normalized, result);
      }
    } catch {
      // Fall through to the typed parse failure.
    }
  }

  return { answer: null, error: 'Could not parse math expression' };
}
