#!/usr/bin/env node
// Test script for HARD/SOFT intent separation in web search heuristic
// Run: node test-web-search-heuristic.js

// Mock logger
const logger = {
  info: (ctx, msg) => console.log(`  [${ctx}] ${msg}`)
};

// --- Copy of the new functions from web-search.js ---

function needsExternalData(message) {
  const lower = message.toLowerCase();
  const externalDataTriggers = [
    /\bodkaz\w*\b/,
    /\blink\w*\b/,
    /\burl\b/i,
    /\bauto\b.*\b(kup|prod|nabíd|inzer)/i,
    /\bvozidl\w*\b/,
    /\binzerát\w*\b/,
    /\bnabídk\w*\b/,
    /\bprodej\w*\b/,
    /\baktuální\w*\s*(cen|kurz|počasí|zpráv)/i,
    /\bdej mi\s*\d+/,
    /\bseznam\w*\s*(odkaz|auto|nabíd)/i,
    /\b(bazos|sauto|tipcars|autohero|aaa|mobile\.de)\b/i,
  ];
  
  for (const pattern of externalDataTriggers) {
    if (pattern.test(lower)) return true;
  }
  return false;
}

function isSoftExplainerIntent(lower) {
  const softPatterns = [
    /^co\s+je\s+(?!aktuální|dnešní|nového|v\s+prodeji)/i,
    /\bco\s+je\s+v\s+(tom|daném|tomhle|tamtom|souboru|zipu|archivu|balíčku|složce)\b/i,
    /\bjak\s+(funguje|fungují|pracuje|pracují|to\s+funguje)\b/i,
    /\b(vysvětli|vysvětlit|vysvětlíš|vysvětlete|popsat|popiš|popis)\b/i,
    /\bco\s+znamená\b/i,
    /\bjaký\s+(je\s+)?rozdíl\b/i,
    /\bco\s+to\s+je\b/i,
    /\b(v\s+kódu|ve\s+scriptu|v\s+souboru|v\s+projektu|v\s+repozitáři)\b/i,
    /\bjak\s+(se\s+)?(dělá|udělat|napsat|vytvořit|nastavit)\b/i,
    /\b(explain|what\s+does|how\s+does|what\'s\s+the\s+difference|what\s+is\s+a|what\s+is\s+an)\b/i,
    /\bin\s+(this|the|that)\s+(file|zip|archive|folder|code|script|project)\b/i,
  ];
  
  for (const pattern of softPatterns) {
    if (pattern.test(lower)) {
      logger.info('WebSearch', `Blocked by SOFT explainer pattern: ${pattern}`);
      return true;
    }
  }
  return false;
}

function hasHardExternalIntent(lower) {
  const hardPatterns = [
    { pattern: /\b(najdi|vyhledej|hledej)\s+(na\s+(webu|internetu|googlu)|online)\b/i, reason: 'explicit web search' },
    { pattern: /\baktuální\s*(cen|kurz|počasí|zpráv|stav|hodnot)/i, reason: 'current data request' },
    { pattern: /\b(kolik\s+stojí|cena|ceník)\s+[^?]*\b/i, reason: 'price query' },
    { pattern: /\b(novinky|zprávy|news|headlines)\s+(o|z|from|about)/i, reason: 'news request' },
    { pattern: /\b(hlavní\s+zpráv|breaking\s+news|latest\s+news)\b/i, reason: 'breaking news' },
    { pattern: /\b(počasí|předpověď|weather|forecast)\s+(v|pro|in|for)?\s*[A-ZÁ-Ž]/i, reason: 'weather request' },
    { pattern: /\b(kurz|exchange\s+rate)\s+(k|czk|eur|usd|gbp)/i, reason: 'exchange rate' },
    { pattern: /\bdej\s+mi\s+\d+\s*(odkaz|link|nabíd)/i, reason: 'link list request' },
    { pattern: /\b(na|z|from|at)\s+(bazos|sauto|tipcars|autohero|mobile\.de|sreality|idnes|novinky)\b/i, reason: 'site-specific' },
  ];
  
  for (const { pattern, reason } of hardPatterns) {
    if (pattern.test(lower)) {
      return { triggered: true, reason };
    }
  }
  return { triggered: false, reason: '' };
}

function needsWebSearch(message) {
  const lower = message.toLowerCase();
  
  // PHASE 1: HARD TRIGGERS
  if (message.match(/https?:\/\/[^\s]+/)) {
    logger.info('WebSearch', 'HARD trigger: URL in message');
    return true;
  }
  
  if (lower.match(/\b[\w-]+\.(cz|com|sk|eu|org|net|io)\b/)) {
    logger.info('WebSearch', 'HARD trigger: domain mention');
    return true;
  }
  
  if (needsExternalData(message)) {
    logger.info('WebSearch', 'HARD trigger: external data requirement');
    return true;
  }
  
  const hardIntent = hasHardExternalIntent(lower);
  if (hardIntent.triggered) {
    logger.info('WebSearch', `HARD trigger: ${hardIntent.reason}`);
    return true;
  }
  
  // PHASE 2: SOFT BLOCK
  if (isSoftExplainerIntent(lower)) {
    return false;
  }
  
  // PHASE 3: MEDIUM TRIGGERS
  const mediumTriggers = [
    'vyhledej', 'najdi na', 'hledej', 'dohledat',
    'dnes', 'včera', 'tento týden', 'teď', 'nyní',
    'co je nového', 'co se děje', 'co se stalo',
    'search for', 'look up', 'find me', 'google',
    'today', 'yesterday', 'this week', 'latest', 'recent',
  ];
  
  for (const trigger of mediumTriggers) {
    if (lower.includes(trigger)) {
      logger.info('WebSearch', `MEDIUM trigger: "${trigger}"`);
      return true;
    }
  }
  
  return false;
}

// --- Test cases ---

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log(' WEB SEARCH HEURISTIC TEST - HARD/SOFT Intent Separation');
console.log('═══════════════════════════════════════════════════════════════════\n');

const testCases = [
  // Should NOT trigger (SOFT explainer)
  { msg: 'co je v danem zipu?', expect: false, desc: 'SOFT: asking about zip contents' },
  { msg: 'co je v tom souboru?', expect: false, desc: 'SOFT: asking about file contents' },
  { msg: 'jak funguje Promise v JS?', expect: false, desc: 'SOFT: how does X work' },
  { msg: 'vysvětli mi async/await', expect: false, desc: 'SOFT: explain X' },
  { msg: 'co znamená const?', expect: false, desc: 'SOFT: what does X mean' },
  { msg: 'jaký je rozdíl mezi let a var?', expect: false, desc: 'SOFT: what is the difference' },
  { msg: 'co to je WebSocket?', expect: false, desc: 'SOFT: what is this' },
  { msg: 'jak napsat test v Jest?', expect: false, desc: 'SOFT: how to write X' },
  { msg: 'what does this function do?', expect: false, desc: 'SOFT: EN what does' },
  { msg: 'what is in this zip file?', expect: false, desc: 'SOFT: EN what is in file' },
  
  // Should trigger (HARD external intent)
  { msg: 'najdi mi auta na bazos.cz', expect: true, desc: 'HARD: specific site' },
  { msg: 'https://example.com co je tam?', expect: true, desc: 'HARD: URL in message' },
  { msg: 'dej mi 5 odkazů na škody', expect: true, desc: 'HARD: link list request' },
  { msg: 'aktuální kurz EUR', expect: true, desc: 'HARD: current exchange rate' },
  { msg: 'počasí v Praze', expect: true, desc: 'HARD: weather request' },
  { msg: 'novinky o AI z idnes.cz', expect: true, desc: 'HARD: news from site' },
  { msg: 'inzeráty na ojetá auta', expect: true, desc: 'HARD: listings request' },
  { msg: 'co se stalo dnes ve světě?', expect: true, desc: 'MEDIUM: today events' },
];

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const result = needsWebSearch(tc.msg);
  const status = result === tc.expect ? '✅ PASS' : '❌ FAIL';
  
  if (result === tc.expect) {
    passed++;
  } else {
    failed++;
  }
  
  console.log(`${status}: "${tc.msg}"`);
  console.log(`       ${tc.desc}`);
  console.log(`       Expected: ${tc.expect ? 'SEARCH' : 'NO SEARCH'}, Got: ${result ? 'SEARCH' : 'NO SEARCH'}`);
  console.log('');
}

console.log('═══════════════════════════════════════════════════════════════════');
console.log(` RESULTS: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
