'use strict';

// Existing /api/settings keys and defaults from the classic Studio. The
// renderer keeps these declarations separate from backend-owned model policy.
const field = (key, label, type, defaultValue, extra = {}) => Object.freeze({ key, label, type, defaultValue, ...extra });
const SETTINGS_FIELDS = Object.freeze({
  modely: {
    inference: [field('intentsmith.llm.temperature', 'Teplota generování', 'number', 0.7, { min: 0, max: 2, step: 0.1 }),
      field('intentsmith.llm.contextWindow', 'Kontextové okno v tokenech', 'number', 32768,
        { min: 2048, max: 131072, step: 1024 }),
      field('intentsmith.llm.timeoutChat', 'Časový limit chatu v ms', 'number', 90000,
        { min: 10000, max: 300000, step: 5000 }),
      field('intentsmith.llm.timeoutCode', 'Časový limit kódu v ms', 'number', 90000,
        { min: 10000, max: 300000, step: 5000 })],
    pripojeni: [field('intentsmith.llm.ollamaUrl', 'Adresa lokální Ollamy', 'text', 'http://127.0.0.1:11434',
      { maxLength: 512 })],
    hardware: [field('intentsmith.llm.numGpu', 'Počet vrstev v GPU (-1 = automaticky)', 'number', -1,
      { min: -1, max: 8, step: 1 })],
  },
  ucet: {
    prehled: [field('intentsmith.account.displayName', 'Zobrazované jméno', 'text', '', { maxLength: 120 }),
      field('intentsmith.account.description', 'Popis / Bio', 'textarea', '', { maxLength: 2000 }),
      field('intentsmith.language', 'Jazyk rozhraní', 'select', 'cs', { options: ['cs', 'en'] })],
  },
  pamet: {
    prehled: [field('intentsmith.memory.conversationMaxTurns', 'Max. turnů konverzace', 'number', 500, { min: 50, max: 5000, step: 50 }),
      field('intentsmith.memory.compactThreshold', 'Práh kompakce', 'number', 0.75, { min: 0.3, max: 0.95, step: 0.05 }),
      field('intentsmith.memory.compactKeepTurns', 'Uchované turny', 'number', 6, { min: 2, max: 20, step: 1 })],
    uceni: [field('intentsmith.memory.ltmEnabled', 'Dlouhodobá paměť', 'toggle', true),
      field('intentsmith.memory.learningEnabled', 'Učení z preferencí', 'toggle', true),
      field('intentsmith.memory.feedbackDetection', 'Detekce zpětné vazby', 'toggle', true),
      field('intentsmith.memory.patternTracking', 'Sledování vzorců', 'toggle', true)],
    retence: [field('intentsmith.memory.ltmMaxEntries', 'Max. LTM záznamů', 'number', 1000, { min: 100, max: 10000, step: 100 }),
      field('intentsmith.memory.ltmDecayHalfLife', 'Poločas LTM ve dnech', 'number', 69, { min: 7, max: 365, step: 7 }),
      field('intentsmith.memory.contextBudgetChat', 'Rozpočet kontextu chat %', 'number', 60, { min: 10, max: 90, step: 5 }),
      field('intentsmith.memory.contextBudgetCode', 'Rozpočet kontextu kód %', 'number', 40, { min: 10, max: 90, step: 5 }),
      field('intentsmith.memory.contextBudgetMaxTokens', 'Tvrdý limit tokenů', 'number', 24576, { min: 2048, max: 65536, step: 1024 })],
  },
  oznameni: {
    prehled: [field('intentsmith.notif.desktopEnabled', 'Oznámení na ploše', 'toggle', true)],
    ticho: [field('intentsmith.notif.quietEnabled', 'Tichý režim', 'toggle', false),
      field('intentsmith.notif.quietFrom', 'Ticho od', 'time', '22:00'),
      field('intentsmith.notif.quietTo', 'Ticho do', 'time', '07:00')],
  },
  vystup: {
    prehled: [field('intentsmith.output.codeBlocks', 'Bloky kódu', 'toggle', true),
      field('intentsmith.output.syntaxHighlight', 'Zvýrazňování syntaxe', 'toggle', true),
      field('intentsmith.output.markdownRendering', 'Markdown', 'toggle', true)],
    delka: [field('intentsmith.output.maxResponseLength', 'Max. délka odpovědi v tokenech', 'number', 8192,
      { min: 1024, max: 65536, step: 512 })],
  },
  system: {
    spousteni: [field('intentsmith.account.timezone', 'Časové pásmo', 'select', 'Europe/Prague',
      { options: ['Europe/Prague', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'UTC'] }),
      field('intentsmith.account.currency', 'Měna', 'select', 'CZK', { options: ['CZK', 'EUR', 'USD', 'GBP'] })],
    diagnostika: [field('intentsmith.system.logLevel', 'Úroveň logování', 'select', 'info',
      { options: ['debug', 'info', 'warn', 'error'] }),
      field('intentsmith.system.logRetentionDays', 'Retence logů ve dnech', 'number', 30, { min: 7, max: 365, step: 7 })],
    limity: [field('intentsmith.system.maxFileSize', 'Max. velikost přílohy v bajtech', 'number', 1048576,
      { min: 102400, max: 10485760, step: 102400 }),
      field('intentsmith.system.rateLimit', 'Limit požadavků za minutu', 'number', 120,
        { min: 10, max: 1000, step: 10 })],
  },
});

function fieldsFor(category, tab) { return SETTINGS_FIELDS[category]?.[tab] || []; }
function validateValue(definition, value) {
  if (definition.type === 'toggle') return typeof value === 'boolean';
  if (definition.type === 'select') return definition.options.includes(value);
  if (definition.type === 'time') return typeof value === 'string' && /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
  if (definition.type === 'number') return typeof value === 'number' && Number.isFinite(value)
    && value >= definition.min && value <= definition.max;
  return typeof value === 'string' && value.length <= definition.maxLength;
}
module.exports = { SETTINGS_FIELDS, fieldsFor, validateValue };
