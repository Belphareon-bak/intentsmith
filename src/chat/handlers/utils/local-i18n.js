// ═══════════════════════════════════════════════════════════════════════════════
// C3-Agent — Local Handler i18n (Q4)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Fix: Local handler always returns Czech ("📊 **Dnes je pondělí, 9. 2. 2026**")
//      even when the user is chatting in English.
//      8/8 = 100% reproduction in EN conv tests.
//
// Integration: Replace formatLocalResponse() calls in local.js handler
//              to use these i18n-aware formatters.
//
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Day names ───────────────────────────────────────────────────────────────

const DAY_NAMES = {
  cs: ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  de: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
  sk: ['nedeľa', 'pondelok', 'utorok', 'streda', 'štvrtok', 'piatok', 'sobota'],
};

const MONTH_NAMES = {
  en: ['January', 'February', 'March', 'April', 'May', 'June',
       'July', 'August', 'September', 'October', 'November', 'December'],
};

// ─── Date formatting ─────────────────────────────────────────────────────────

/**
 * Format a date for display in the user's language.
 * @param {Date} date
 * @param {string} lang - 'cs'|'en'|'de'|'sk'
 * @returns {string} Formatted date string
 */
export function formatDate(date, lang = 'cs') {
  const dayName = (DAY_NAMES[lang] || DAY_NAMES['en'])[date.getDay()];
  const d = date.getDate();
  const m = date.getMonth() + 1;
  const y = date.getFullYear();

  switch (lang) {
    case 'cs':
    case 'sk':
      // "pondělí, 9. 2. 2026"
      return `${dayName}, ${d}. ${m}. ${y}`;
    case 'en':
      // "Monday, February 9, 2026"
      return `${dayName}, ${MONTH_NAMES.en[date.getMonth()]} ${d}, ${y}`;
    case 'de':
      // "Montag, 9.2.2026"
      return `${dayName}, ${d}.${m}.${y}`;
    default:
      return `${dayName}, ${d}. ${m}. ${y}`;
  }
}

/**
 * Format current time for display in the user's language.
 * @param {Date} date
 * @param {string} lang
 * @returns {string}
 */
export function formatTime(date, lang = 'cs') {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');

  if (lang === 'en') {
    // 12-hour format for English
    const hour12 = date.getHours() % 12 || 12;
    const ampm = date.getHours() >= 12 ? 'PM' : 'AM';
    return `${hour12}:${m}:${s} ${ampm}`;
  }
  // 24-hour for all other languages
  return `${h}:${m}:${s}`;
}

// ─── Response formatters ─────────────────────────────────────────────────────

const LABELS = {
  cs: { today: 'Dnes je', time: 'Aktuální čas', nextFullMoon: 'Příští úplněk bude za', daysUntilChristmas: 'Do Vánoc zbývá', days: 'dní', countedFrom: 'počítáno od', fromDate: 'od' },
  en: { today: 'Today is', time: 'Current time', nextFullMoon: 'Next full moon in', daysUntilChristmas: 'Days until Christmas:', days: 'days', countedFrom: 'counting from', fromDate: 'from' },
  de: { today: 'Heute ist', time: 'Aktuelle Zeit', nextFullMoon: 'Nächster Vollmond in', daysUntilChristmas: 'Tage bis Weihnachten:', days: 'Tagen', countedFrom: 'ab', fromDate: 'ab' },
  sk: { today: 'Dnes je', time: 'Aktuálny čas', nextFullMoon: 'Ďalší spln bude za', daysUntilChristmas: 'Do Vianoc zostáva', days: 'dní', countedFrom: 'počítané od', fromDate: 'od' },
};

/**
 * Format "what day is today" response.
 * @param {string} lang
 * @returns {string}
 */
export function formatTodayResponse(lang = 'cs') {
  const now = new Date();
  const l = LABELS[lang] || LABELS['en'];
  return `📊 **${l.today} ${formatDate(now, lang)}**`;
}

/**
 * Format "what time is it" response.
 * @param {string} lang
 * @returns {string}
 */
export function formatTimeResponse(lang = 'cs') {
  const now = new Date();
  const l = LABELS[lang] || LABELS['en'];
  return `📊 **${l.time}: ${formatTime(now, lang)}**`;
}

/**
 * Format math calculation response.
 * Math is language-independent, but the wrapper text matches language.
 * @param {string} expression
 * @param {number} result
 * @param {string} lang
 * @returns {string}
 */
export function formatMathResponse(expression, result, lang = 'cs') {
  // Math formatting is universal — just the expression = result
  return `📊 **${expression} = ${result}**`;
}

/**
 * Format "next full moon" response.
 * @param {number} daysUntil
 * @param {string} moonDate - formatted date of the full moon
 * @param {string} todayDate - formatted today's date
 * @param {string} lang
 * @returns {string}
 */
export function formatMoonResponse(daysUntil, moonDate, todayDate, lang = 'cs') {
  const l = LABELS[lang] || LABELS['en'];
  return `📊 **${l.nextFullMoon} ${daysUntil} ${l.days} (${moonDate}), ${l.countedFrom} ${todayDate}**`;
}

/**
 * Format "days until Christmas" response.
 * @param {number} daysUntil
 * @param {string} christmasDate - formatted date of Christmas
 * @param {string} todayDate - formatted today's date
 * @param {string} lang
 * @returns {string}
 */
export function formatChristmasResponse(daysUntil, christmasDate, todayDate, lang = 'cs') {
  const l = LABELS[lang] || LABELS['en'];
  return `📊 **${l.daysUntilChristmas} ${daysUntil} ${l.days} (${christmasDate}), ${l.fromDate} ${todayDate}**`;
}

/**
 * Format a "yes/no today is [date]" confirmation response.
 * @param {string} lang
 * @returns {string}
 */
export function formatDateConfirmation(lang = 'cs') {
  const now = new Date();
  if (lang === 'en') {
    return `📊 **Yes, today is ${formatDate(now, 'en')}. Current date and time: ${formatDate(now, 'en')} ${formatTime(now, 'en')}.**`;
  }
  return `📊 **Ano, dnes je ${formatDate(now, 'cs')}. Aktuální datum a čas: ${formatDate(now, 'cs')} ${formatTime(now, 'cs')}.**`;
}

export default {
  formatDate,
  formatTime,
  formatTodayResponse,
  formatTimeResponse,
  formatMathResponse,
  formatMoonResponse,
  formatChristmasResponse,
  formatDateConfirmation,
  DAY_NAMES,
  LABELS,
};
