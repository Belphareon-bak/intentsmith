#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent E2E Quality Deep — v61.3
// ══════════════════════════════════════════════════════════════════════════════
//
// 36 testů pokrývající 4 reálné use-case:
//   S: Vyhledávání (zprávy, inzeráty, specifikace výrobců)
//   R: Reportování / řešení problémů
//   F: Fakta (čas, datum, osobnosti, aktuální události)
//   T: Technická expertíza (návody, srovnání)
//
// SPUŠTĚNÍ:
//   node src/server.js                          # backend
//   node tests/e2e-quality-deep.cjs             # run
//   node tests/e2e-quality-deep.cjs --verbose   # s plnými odpověďmi
//   node tests/e2e-quality-deep.cjs --save baseline.json
//   node tests/e2e-quality-deep.cjs --compare baseline.json
//
// ══════════════════════════════════════════════════════════════════════════════

const http = require('http');
const fs = require('fs');

// ─── Configuration ──────────────────────────────────────────────────────────

const C3_URL = process.env.C3_URL || 'http://127.0.0.1:3335';
const SEARCH_TIMEOUT_MS = parseInt(process.env.E2E_TIMEOUT || '120000');  // 2min for search
const LOCAL_TIMEOUT_MS = 150000;  // 150s for local LLM (v62.2b: increased — lang retries add time)
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');
const SAVE_TO = process.argv.find((a, i) => process.argv[i - 1] === '--save');
const COMPARE_TO = process.argv.find((a, i) => process.argv[i - 1] === '--compare');
const PAUSE_MS = 2000;  // pauza mezi testy (Ollama cooldown)

// ─── HTTP Client ────────────────────────────────────────────────────────────

function chatRequest(message, sessionId = null, timeoutMs = SEARCH_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const sid = sessionId || `e2e-deep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const data = JSON.stringify({ message, session_id: sid });
    const url = new URL('/chat', C3_URL);

    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: timeoutMs,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body), raw: body, sessionId: sid });
        } catch {
          resolve({ status: res.statusCode, body: null, raw: body, sessionId: sid });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout (${timeoutMs}ms)`)); });
    req.write(data);
    req.end();
  });
}

function apiRequest(method, path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, C3_URL);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method, timeout: 15000,
    }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(b) }); }
        catch { resolve({ status: res.statusCode, body: b }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function getResponseText(resp) {
  if (!resp.body) return '';
  if (typeof resp.body === 'string') return resp.body;
  if (resp.body.response) return resp.body.response;
  if (resp.body.content) return resp.body.content;
  if (resp.body.message) return resp.body.message;
  return JSON.stringify(resp.body);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATORS — Reusable assertion functions
// ═══════════════════════════════════════════════════════════════════════════════

// ── Language ────────────────────────────────────────────────────────────────

function isCzech(text) {
  return /[ěščřžýáíéůúťďň]/i.test(text);
}

function isSlovak(text) {
  return /\b(čo|nie je|preto|ďakujem|veľmi|veľa|možno|nejaký|každý|takže)\b/i.test(text);
}

function hasChineseChars(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

function hasRawJSON(text) {
  return /\{\s*"[a-zA-Z_]+"\s*:/.test(text) && !text.includes('```');
}

// ── Links ───────────────────────────────────────────────────────────────────

function extractLinks(text) {
  const matches = text.match(/https?:\/\/[^\s)\]>]+/g) || [];
  // Deduplicate
  return [...new Set(matches)];
}

function extractDomains(text) {
  const links = extractLinks(text);
  const domains = links.map(u => {
    try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; }
  }).filter(Boolean);
  return [...new Set(domains)];
}

function hasMinLinks(text, min) {
  return extractLinks(text).length >= min;
}

function hasUniqueDomains(text, min) {
  return extractDomains(text).length >= min;
}

// ── Length & Structure ──────────────────────────────────────────────────────

function hasMinLength(text, n) {
  return text.length >= n;
}

function sentenceCount(text) {
  // Split by sentence-ending punctuation
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  return sentences.length;
}

function hasMultipleParagraphs(text) {
  const paras = text.split(/\n\s*\n/).filter(p => p.trim().length > 20);
  return paras.length >= 2;
}

function hasListStructure(text) {
  // Numbered list (1. 2. 3.) or bullet list (- * •)
  const numberedItems = (text.match(/^\s*\d+[.)]\s+/gm) || []).length;
  const bulletItems = (text.match(/^\s*[-*•]\s+/gm) || []).length;
  const boldItems = (text.match(/\*\*[^*]+\*\*/g) || []).length;
  return numberedItems >= 2 || bulletItems >= 2 || boldItems >= 2;
}

// ── Depth scoring ──────────────────────────────────────────────────────────

function depthScore(text) {
  let score = 0;
  const len = text.length;

  // Length tiers
  if (len > 200) score += 1;
  if (len > 500) score += 1;
  if (len > 1000) score += 1;

  // Structure
  if (hasListStructure(text)) score += 2;
  if (hasMultipleParagraphs(text)) score += 1;

  // Sentence count
  const sc = sentenceCount(text);
  if (sc >= 5) score += 1;
  if (sc >= 10) score += 1;

  // Specificity: numbers, technical terms, proper nouns
  const numbers = (text.match(/\d+/g) || []).length;
  if (numbers >= 3) score += 1;

  // Max 9
  return Math.min(score, 9);
}

function hasMinDepth(text, minScore) {
  return depthScore(text) >= minScore;
}

// ── Content ────────────────────────────────────────────────────────────────

function containsAny(text, words) {
  const lower = text.toLowerCase();
  return words.some(w => lower.includes(w.toLowerCase()));
}

function containsAll(text, words) {
  const lower = text.toLowerCase();
  return words.every(w => lower.includes(w.toLowerCase()));
}

function hasNumber(text) {
  return /\d+/.test(text);
}

// ── Range validators ───────────────────────────────────────────────────────

function extractFirstNumber(text) {
  // Extract first decimal number
  const match = text.match(/(\d+[.,]\d+|\d+)/);
  if (!match) return null;
  return parseFloat(match[1].replace(',', '.'));
}

function isEuroRateValid(text) {
  // EUR/CZK should be between 20 and 35
  const rateMatch = text.match(/(\d{2}[.,]\d+)\s*(Kč|CZK|korun)/i) ||
                    text.match(/EUR.*?(\d{2}[.,]\d+)/i) ||
                    text.match(/(\d{2}[.,]\d+).*EUR/i);
  if (!rateMatch) return false;
  const rate = parseFloat(rateMatch[1].replace(',', '.'));
  return rate > 20 && rate < 35;
}

function hasTimeFormat(text) {
  // HH:MM or "X hodin Y minut"
  return /\d{1,2}:\d{2}/.test(text) || /\d+\s*(hodin|hour|minut)/i.test(text);
}

function hasDateFormat(text) {
  // DD.MM.YYYY or day name + date
  return /\d{1,2}\.\s*\d{1,2}\.\s*\d{4}/.test(text) ||
         /(pondělí|úterý|středa|čtvrtek|pátek|sobota|neděle|pondelí|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(text);
}

// ── Blacklists (penalization) ──────────────────────────────────────────────

const GENERIC_PHRASES = [
  'obecně platí', 'může se lišit', 'je to složité', 'záleží na kontextu',
  'nelze jednoznačně', 'závisí na mnoha faktorech', 'každý případ je jiný',
  'doporučuji konzultovat', 'kontaktujte odborníka',
];

const META_PHRASES = [
  'jako AI', 'jako umělá inteligence', 'jako jazykový model',
  'nemám přístup', 'nemohu vyhledat', 'nemohu přistupovat',
  'nemám aktuální', 'nemohu potvrdit',
  'as an AI', 'I cannot access', 'I don\'t have access',
];

const HEDGING_EXCESS = [
  'pravděpodobně', 'možná', 'může být', 'asi', 'zřejmě',
  'patrně', 'snad', 'eventuálně',
];

function countBlacklistHits(text, phrases) {
  const lower = text.toLowerCase();
  return phrases.filter(p => lower.includes(p.toLowerCase())).length;
}

function hasNoMetaPhrases(text) {
  return countBlacklistHits(text, META_PHRASES) === 0;
}

function hasNoExcessiveGeneric(text) {
  return countBlacklistHits(text, GENERIC_PHRASES) <= 1;  // max 1 is OK
}

function hasNoExcessiveHedging(text) {
  return countBlacklistHits(text, HEDGING_EXCESS) <= 2;  // max 2 is OK
}

// ═══════════════════════════════════════════════════════════════════════════════
// DECLARATIVE TEST DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

const TESTS = [
  // ════════════════════════════════════════════════════════════════════════════
  // S: VYHLEDÁVÁNÍ (Internet Search)
  // ════════════════════════════════════════════════════════════════════════════

  // ── Zprávy (3) ──
  {
    id: 'S1', category: 'S: Vyhledávání',
    query: 'Jaké jsou dnešní hlavní zprávy z České republiky?',
    needsSearch: true,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 200), label: '>200 znaků' },
      { fn: t => hasMinLinks(t, 2), label: 'min 2 odkazy' },
      { fn: t => hasUniqueDomains(t, 2), label: 'min 2 různé domény' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
      { fn: t => hasMinDepth(t, 3), label: 'depth >= 3' },
    ],
  },
  {
    id: 'S2', category: 'S: Vyhledávání',
    query: 'Co se děje na Ukrajině? Shrň aktuální situaci.',
    needsSearch: true,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 300), label: '>300 znaků' },
      { fn: t => hasMinLinks(t, 2), label: 'min 2 odkazy' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
      { fn: t => hasMinDepth(t, 4), label: 'depth >= 4' },
    ],
  },
  {
    id: 'S3', category: 'S: Vyhledávání',
    query: 'Novinky ze světa technologií tento týden',
    needsSearch: true,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 200), label: '>200 znaků' },
      { fn: t => hasMinLinks(t, 2), label: 'min 2 odkazy' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
    ],
  },

  // ── Inzeráty (3) ──
  {
    id: 'S4', category: 'S: Vyhledávání',
    query: 'Najdi mi 3 inzeráty na použitou Škodu Octavia do 300 000 Kč',
    needsSearch: true,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLinks(t, 2), label: 'min 2 odkazy' },
      { fn: t => containsAny(t, ['Kč', 'kč', 'cena', 'km', 'rok']), label: 'zmínky o ceně/km' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
    ],
  },
  {
    id: 'S5', category: 'S: Vyhledávání',
    query: 'Hledám pronájem bytu 2+1 v Brně do 15 000 Kč měsíčně',
    needsSearch: true,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLinks(t, 2), label: 'min 2 odkazy' },
      { fn: t => containsAny(t, ['Kč', 'kč', 'cena', 'měsíc', 'nájem', 'byt']), label: 'zmínky o ceně/bydlení' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
    ],
  },
  {
    id: 'S6', category: 'S: Vyhledávání',
    query: 'Najdi mi 3 nabídky práce pro programátora v Praze',
    needsSearch: true,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLinks(t, 2), label: 'min 2 odkazy' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
    ],
  },

  // ── Fakta z webu výrobců (3) ──
  {
    id: 'S7', category: 'S: Vyhledávání',
    query: 'Jaké jsou specifikace iPhone 16 Pro? Uveď zdroj.',
    needsSearch: true,
    must: [
      { fn: t => hasMinLength(t, 200), label: '>200 znaků' },
      { fn: t => hasMinLinks(t, 1), label: 'min 1 odkaz' },
      { fn: t => containsAny(t, ['displej', 'display', 'procesor', 'chip', 'A18', 'kamera', 'camera', 'baterie', 'battery']), label: 'technické specifikace' },
      { fn: t => hasMinDepth(t, 3), label: 'depth >= 3' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
    ],
  },
  {
    id: 'S8', category: 'S: Vyhledávání',
    query: 'Porovnej parametry AMD Ryzen 7 9800X3D a Intel Core i7-14700K',
    needsSearch: true,
    must: [
      { fn: t => hasMinLength(t, 300), label: '>300 znaků' },
      { fn: t => hasMinLinks(t, 1), label: 'min 1 odkaz' },
      { fn: t => containsAny(t, ['AMD', 'Ryzen', '9800X3D']), label: 'zmínka AMD' },
      { fn: t => containsAny(t, ['Intel', 'i7', '14700']), label: 'zmínka Intel' },
      { fn: t => hasMinDepth(t, 4), label: 'depth >= 4' },
    ],
  },
  {
    id: 'S9', category: 'S: Vyhledávání',
    query: 'Jaká je spotřeba a výkon nové Škoda Enyaq Coupé RS?',
    needsSearch: true,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 200), label: '>200 znaků' },
      { fn: t => hasMinLinks(t, 1), label: 'min 1 odkaz' },
      { fn: t => containsAny(t, ['kW', 'kw', 'hp', 'koní', 'výkon', 'PS']), label: 'zmínky o výkonu' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // R: REPORTOVÁNÍ / Řešení problémů
  // ════════════════════════════════════════════════════════════════════════════
  {
    id: 'R1', category: 'R: Reportování',
    query: 'Jak vyřešit zaseknuté GUI v Linuxu, když nereaguje na klávesnici ani myš?',
    needsSearch: false,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 300), label: '>300 znaků' },
      { fn: t => containsAny(t, ['Ctrl', 'Alt', 'F2', 'tty', 'kill', 'xkill', 'SysRq', 'REISUB', 'terminál', 'terminal', 'konzol']), label: 'konkrétní řešení (Ctrl+Alt+F2/kill/tty)' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
      { fn: hasNoExcessiveGeneric, label: 'max 1 generická fráze' },
      { fn: t => hasMinDepth(t, 4), label: 'depth >= 4' },
      { fn: t => hasListStructure(t) || sentenceCount(t) >= 5, label: 'struktura (list nebo 5+ vět)' },
    ],
  },
  {
    id: 'R2', category: 'R: Reportování',
    query: 'Jak správně opravit přetržený síťový kabel (ethernet RJ45)?',
    needsSearch: false,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 200), label: '>200 znaků' },
      { fn: t => containsAny(t, ['krimp', 'kleště', 'konektor', 'RJ45', 'RJ-45', 'drát', 'kabel', 'cat5', 'cat6', 'žíla', 'páry', 'zapojení', 'standard']), label: 'konkrétní postup (krimpovačky/konektor)' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
      { fn: t => hasMinDepth(t, 3), label: 'depth >= 3' },
    ],
  },
  {
    id: 'R3', category: 'R: Reportování',
    query: 'Jak postavit PC pro gaming? Podle čeho vybírat komponenty a na co si dát pozor?',
    needsSearch: false,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 400), label: '>400 znaků' },
      { fn: t => containsAll(t, ['CPU', 'GPU']), label: 'zmínky o CPU i GPU' },
      { fn: t => containsAny(t, ['RAM', 'paměť', 'operační paměť']), label: 'zmínka RAM' },
      { fn: t => containsAny(t, ['zdroj', 'PSU', 'napájecí', 'watt', 'W']), label: 'zmínka zdroj/PSU' },
      { fn: t => containsAny(t, ['deska', 'motherboard', 'základní']), label: 'zmínka základní deska' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
      { fn: t => hasMinDepth(t, 5), label: 'depth >= 5' },
      { fn: t => hasListStructure(t), label: 'list struktura' },
    ],
  },
  {
    id: 'R4', category: 'R: Reportování',
    query: 'Mám problém s pomalým WiFi — co můžu udělat pro zlepšení signálu?',
    needsSearch: false,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 200), label: '>200 znaků' },
      { fn: t => containsAny(t, ['kanál', 'channel', '5 GHz', '5GHz', 'router', 'umístění', 'anténa', 'repeater', 'extender', 'mesh']), label: 'konkrétní rady (kanál/5GHz/router)' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
      { fn: t => hasMinDepth(t, 3), label: 'depth >= 3' },
    ],
  },
  {
    id: 'R5', category: 'R: Reportování',
    query: 'Jak zálohovat data na Linuxu automaticky?',
    needsSearch: false,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 200), label: '>200 znaků' },
      { fn: t => containsAny(t, ['rsync', 'cron', 'timeshift', 'borg', 'tar', 'duplicity', 'restic', 'systemd', 'timer', 'script']), label: 'konkrétní nástroje (rsync/cron/borg)' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
      { fn: t => hasMinDepth(t, 3), label: 'depth >= 3' },
    ],
  },
  {
    id: 'R6', category: 'R: Reportování',
    query: 'Jak vyčistit a zrychlit starý notebook s Windows?',
    needsSearch: false,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 200), label: '>200 znaků' },
      { fn: t => containsAny(t, ['disk', 'SSD', 'RAM', 'paměť', 'defragment', 'startup', 'spouštění', 'programy', 'temp', 'čištění', 'CCleaner']), label: 'konkrétní kroky (SSD/RAM/cleanup)' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
      { fn: t => hasMinDepth(t, 3), label: 'depth >= 3' },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // F: FAKTA
  // ════════════════════════════════════════════════════════════════════════════

  // ── Lokální/deterministické (3) ──
  {
    id: 'F1', category: 'F: Fakta',
    query: 'Kolik je hodin?',
    needsSearch: false,
    must: [
      { fn: hasTimeFormat, label: 'formát času (HH:MM)' },
      { fn: hasNumber, label: 'obsahuje číslo' },
    ],
  },
  {
    id: 'F2', category: 'F: Fakta',
    query: 'Jaký je dnes den a datum?',
    needsSearch: false,
    must: [
      { fn: hasDateFormat, label: 'formát data (den + datum)' },
    ],
  },
  {
    id: 'F3', category: 'F: Fakta',
    query: 'Kdy bude příští úplněk?',
    needsSearch: false,
    must: [
      { fn: hasDateFormat, label: 'obsahuje datum' },
      { fn: hasNumber, label: 'obsahuje číslo' },
    ],
  },

  // ── Osobnosti (3) ──
  {
    id: 'F4', category: 'F: Fakta',
    query: 'Kdo je Jirka Orsag?',
    needsSearch: true,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 80), label: '>80 znaků' },
      { fn: t => !/(nevím|neznám|nemám informace|I don't know)/i.test(t), label: 'ne odmítnutí' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
    ],
  },
  {
    id: 'F5', category: 'F: Fakta',
    query: 'Kdo je aktuální prezident České republiky?',
    needsSearch: true,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => containsAny(t, ['Pavel', 'prezident']), label: 'jméno prezidenta' },
      { fn: t => hasMinLinks(t, 1), label: 'min 1 odkaz' },
    ],
  },
  {
    id: 'F6', category: 'F: Fakta',
    query: 'Kdo je Elon Musk a čím se proslavil?',
    needsSearch: true,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 200), label: '>200 znaků' },
      { fn: t => containsAny(t, ['Tesla', 'SpaceX', 'Twitter', 'X', 'PayPal']), label: 'zmínky o Tesla/SpaceX' },
      { fn: t => hasMinDepth(t, 3), label: 'depth >= 3' },
    ],
  },

  // ── Aktuální události (3) ──
  {
    id: 'F7', category: 'F: Fakta',
    query: 'Jak si Česko vede na letošních zimních olympijských hrách?',
    needsSearch: true,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 100), label: '>100 znaků' },
      { fn: t => containsAny(t, ['medail', 'zlat', 'stříbr', 'bronz', 'sport', 'olymp', 'ZOH', 'hry', 'biatlon', 'hokej', 'lyžo', 'skelet', 'sáňk']), label: 'zmínky o sportu/medailích' },
      { fn: t => hasMinLinks(t, 1), label: 'min 1 odkaz' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
    ],
  },
  {
    id: 'F8', category: 'F: Fakta',
    query: 'Jaký je aktuální kurz eura vůči koruně?',
    needsSearch: true,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: hasNumber, label: 'obsahuje číslo' },
      { fn: isEuroRateValid, label: 'kurz v rozsahu 20-35 Kč' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
    ],
  },
  {
    id: 'F9', category: 'F: Fakta',
    query: 'Jaké je dnes počasí v Praze?',
    needsSearch: true,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 50), label: '>50 znaků' },
      { fn: t => containsAny(t, ['°C', '°', 'stupň', 'teplot', 'vítr', 'oblač', 'déšť', 'sníh', 'slune', 'mrholení', 'polojasno', 'zataženo']), label: 'teplota/podmínky' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════════
  // T: TECHNICKÁ EXPERTÍZA
  // ════════════════════════════════════════════════════════════════════════════

  // ── Návody (6) ──
  {
    id: 'T1', category: 'T: Technická expertíza',
    query: 'Jak vytvořit mobilní aplikaci? Jaké jsou kroky a technologie?',
    needsSearch: false,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 400), label: '>400 znaků' },
      { fn: t => containsAny(t, ['React Native', 'Flutter', 'Swift', 'Kotlin', 'iOS', 'Android', 'nativní', 'hybridní', 'cross-platform']), label: 'technologie (RN/Flutter/Swift/Kotlin)' },
      { fn: t => hasMinDepth(t, 5), label: 'depth >= 5' },
      { fn: t => hasListStructure(t), label: 'list struktura' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
      { fn: hasNoExcessiveGeneric, label: 'max 1 generická fráze' },
      { fn: hasNoExcessiveHedging, label: 'max 2 hedging fráze' },
    ],
  },
  {
    id: 'T2', category: 'T: Technická expertíza',
    query: 'Vysvětli mi rozdíl mezi REST a GraphQL API — kdy použít co?',
    needsSearch: false,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 300), label: '>300 znaků' },
      { fn: t => containsAll(t, ['REST', 'GraphQL']), label: 'oba pojmy zmíněny' },
      { fn: t => containsAny(t, ['endpoint', 'query', 'mutation', 'request', 'GET', 'POST', 'schema']), label: 'technické detaily' },
      { fn: t => hasMinDepth(t, 4), label: 'depth >= 4' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
    ],
  },
  {
    id: 'T3', category: 'T: Technická expertíza',
    query: 'Jak nastavit CI/CD pipeline pro Node.js projekt?',
    needsSearch: false,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 300), label: '>300 znaků' },
      { fn: t => containsAny(t, ['GitHub Actions', 'GitLab CI', 'Jenkins', 'CircleCI', 'pipeline', 'workflow', 'YAML', 'yml']), label: 'CI/CD nástroj' },
      { fn: t => containsAny(t, ['Docker', 'test', 'build', 'deploy', 'npm']), label: 'kroky pipeline' },
      { fn: t => hasMinDepth(t, 4), label: 'depth >= 4' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
    ],
  },
  {
    id: 'T4', category: 'T: Technická expertíza',
    query: 'Jak zabezpečit webovou aplikaci proti nejčastějším útokům?',
    needsSearch: false,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 300), label: '>300 znaků' },
      { fn: t => containsAny(t, ['XSS', 'cross-site', 'SQL injection', 'CSRF', 'OWASP']), label: 'typy útoků' },
      { fn: t => hasMinDepth(t, 4), label: 'depth >= 4' },
      { fn: t => hasListStructure(t), label: 'list struktura' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
    ],
  },
  {
    id: 'T5', category: 'T: Technická expertíza',
    query: 'Jak funguje Docker a k čemu je dobrý?',
    needsSearch: false,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 300), label: '>300 znaků' },
      { fn: t => containsAny(t, ['kontejner', 'container', 'image', 'obraz', 'Dockerfile', 'compose', 'izolac']), label: 'Docker koncepty' },
      { fn: t => hasMinDepth(t, 4), label: 'depth >= 4' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
    ],
  },
  {
    id: 'T6', category: 'T: Technická expertíza',
    query: 'Popiš architekturu microservices — výhody, nevýhody, kdy použít?',
    needsSearch: false,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 300), label: '>300 znaků' },
      { fn: t => containsAny(t, ['služb', 'service', 'API', 'gateway', 'orchestrace', 'Kubernetes', 'kontejner', 'škálov']), label: 'microservices koncepty' },
      { fn: t => containsAny(t, ['výhod', 'nevýhod', 'pro a proti', 'plusy', 'mínusy']), label: 'výhody/nevýhody' },
      { fn: t => hasMinDepth(t, 5), label: 'depth >= 5' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
    ],
  },

  // ── Srovnání (6) ──
  {
    id: 'T7', category: 'T: Technická expertíza',
    query: 'Porovnej mi motorky Kawasaki Versys 1000 a Suzuki GSX-S 1000 — která je lepší a v čem?',
    needsSearch: true,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 300), label: '>300 znaků' },
      { fn: t => containsAny(t, ['Versys', 'Kawasaki']), label: 'zmínka Versys/Kawasaki' },
      { fn: t => containsAny(t, ['GSX', 'Suzuki']), label: 'zmínka GSX/Suzuki' },
      { fn: t => containsAny(t, ['výkon', 'koní', 'kW', 'Nm', 'hmotnost', 'kg', 'motor', 'válec']), label: 'technické parametry' },
      { fn: t => hasMinDepth(t, 5), label: 'depth >= 5' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
      { fn: hasNoExcessiveHedging, label: 'max 2 hedging fráze' },
    ],
  },
  {
    id: 'T8', category: 'T: Technická expertíza',
    query: 'Python vs JavaScript — kdy použít který jazyk?',
    needsSearch: false,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 300), label: '>300 znaků' },
      { fn: t => containsAll(t, ['Python', 'JavaScript']), label: 'oba jazyky zmíněny' },
      { fn: t => containsAny(t, ['backend', 'frontend', 'ML', 'machine learning', 'web', 'data', 'strojové']), label: 'use-case rozdíly' },
      { fn: t => hasMinDepth(t, 4), label: 'depth >= 4' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
    ],
  },
  {
    id: 'T9', category: 'T: Technická expertíza',
    query: 'Porovnej PostgreSQL a MongoDB — výhody a nevýhody',
    needsSearch: false,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 300), label: '>300 znaků' },
      { fn: t => containsAll(t, ['PostgreSQL', 'MongoDB']), label: 'obě DB zmíněny' },
      { fn: t => containsAny(t, ['relační', 'SQL', 'dokument', 'NoSQL', 'ACID', 'schém', 'flexibil']), label: 'technické koncepty' },
      { fn: t => hasMinDepth(t, 4), label: 'depth >= 4' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
    ],
  },
  {
    id: 'T10', category: 'T: Technická expertíza',
    query: 'TypeScript vs JavaScript — stojí za to přecházet?',
    needsSearch: false,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 300), label: '>300 znaků' },
      { fn: t => containsAll(t, ['TypeScript', 'JavaScript']), label: 'oba jazyky zmíněny' },
      { fn: t => containsAny(t, ['typ', 'type', 'kompilace', 'kompil', 'tooling', 'chyb', 'error', 'IDE', 'refaktor']), label: 'type system koncepty' },
      { fn: t => hasMinDepth(t, 4), label: 'depth >= 4' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
    ],
  },
  {
    id: 'T11', category: 'T: Technická expertíza',
    query: 'Linux vs Windows pro vývojáře — co je lepší?',
    needsSearch: false,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 300), label: '>300 znaků' },
      { fn: t => containsAll(t, ['Linux', 'Windows']), label: 'oba systémy zmíněny' },
      { fn: t => containsAny(t, ['terminál', 'terminal', 'package manager', 'správce balíčků', 'WSL', 'příkazov', 'bash', 'shell']), label: 'vývojářské koncepty' },
      { fn: t => hasMinDepth(t, 4), label: 'depth >= 4' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
    ],
  },
  {
    id: 'T12', category: 'T: Technická expertíza',
    query: 'Porovnej React, Vue a Angular — který framework zvolit pro nový projekt?',
    needsSearch: false,
    must: [
      { fn: isCzech, label: 'CZ jazyk' },
      { fn: t => hasMinLength(t, 300), label: '>300 znaků' },
      { fn: t => containsAll(t, ['React', 'Vue', 'Angular']), label: 'všechny 3 frameworky zmíněny' },
      { fn: t => hasMinDepth(t, 5), label: 'depth >= 5' },
      { fn: hasNoMetaPhrases, label: 'žádné meta-fráze' },
      { fn: hasNoExcessiveHedging, label: 'max 2 hedging fráze' },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

async function runAllTests() {
  console.log('\n\x1b[1m╔══════════════════════════════════════════════════════════╗');
  console.log('║       C3-Agent E2E Quality Deep — v61.3                 ║');
  console.log('╚══════════════════════════════════════════════════════════╝\x1b[0m\n');

  // ── Health check ──
  try {
    const health = await apiRequest('GET', '/api/health');
    if (health.status !== 200) throw new Error(`Status ${health.status}`);
    console.log(`\x1b[32m  Backend OK: ${C3_URL}\x1b[0m`);
    if (health.body?.version) console.log(`  Version: ${health.body.version}`);
    console.log('');
  } catch (err) {
    console.error(`\x1b[31m  Backend nedostupný: ${C3_URL}\x1b[0m`);
    console.error(`  Spusť: node src/server.js`);
    console.error(`  Error: ${err.message}`);
    process.exit(1);
  }

  const results = [];
  let lastCategory = '';

  for (let i = 0; i < TESTS.length; i++) {
    const t = TESTS[i];

    // Print category header
    if (t.category !== lastCategory) {
      lastCategory = t.category;
      console.log(`\n\x1b[1m── ${t.category} ──\x1b[0m`);
    }

    const start = Date.now();
    const timeout = t.needsSearch ? SEARCH_TIMEOUT_MS : LOCAL_TIMEOUT_MS;

    try {
      const resp = await chatRequest(t.query, null, timeout);
      const text = getResponseText(resp);
      const duration = Date.now() - start;

      // Run all validations
      const failures = [];
      for (const check of t.must) {
        try {
          if (!check.fn(text)) {
            failures.push(check.label);
          }
        } catch (e) {
          failures.push(`${check.label} (ERROR: ${e.message})`);
        }
      }

      // Also check universal quality gates
      const universalFailures = [];
      if (isSlovak(text)) universalFailures.push('SK kontaminace');
      if (hasChineseChars(text)) universalFailures.push('čínské znaky');
      if (hasRawJSON(text)) universalFailures.push('raw JSON leak');

      const allFailures = [...failures, ...universalFailures];
      const passed = allFailures.length === 0;

      const icon = passed ? '\x1b[32m  ✅\x1b[0m' : '\x1b[31m  ❌\x1b[0m';
      const dur = `${(duration / 1000).toFixed(1)}s`;
      const failMsg = allFailures.length > 0 ? ` — \x1b[33m${allFailures.join(', ')}\x1b[0m` : '';

      console.log(`${icon} ${t.id}: ${t.query.substring(0, 60)}${t.query.length > 60 ? '...' : ''} (${dur})${failMsg}`);

      if (VERBOSE) {
        console.log(`     \x1b[90m📝 ${text.slice(0, 300)}${text.length > 300 ? '...' : ''}\x1b[0m`);
        const links = extractLinks(text);
        if (links.length > 0) {
          console.log(`     \x1b[90m🔗 ${links.slice(0, 5).join(', ')}${links.length > 5 ? ` (+${links.length - 5})` : ''}\x1b[0m`);
        }
        console.log(`     \x1b[90m📊 depth=${depthScore(text)} len=${text.length} sent=${sentenceCount(text)} links=${links.length} domains=${extractDomains(text).length}\x1b[0m`);
      }

      results.push({
        id: t.id, name: t.query, category: t.category,
        pass: passed, duration, detail: allFailures.join('; '),
        response: text.substring(0, 500),
        metrics: {
          length: text.length,
          depth: depthScore(text),
          sentences: sentenceCount(text),
          links: extractLinks(text).length,
          domains: extractDomains(text).length,
          genericHits: countBlacklistHits(text, GENERIC_PHRASES),
          metaHits: countBlacklistHits(text, META_PHRASES),
          hedgingHits: countBlacklistHits(text, HEDGING_EXCESS),
        },
      });
    } catch (err) {
      const duration = Date.now() - start;
      console.log(`\x1b[31m  💥 ${t.id}: ${t.query.substring(0, 60)} — ${err.message}\x1b[0m`);
      results.push({
        id: t.id, name: t.query, category: t.category,
        pass: false, duration, detail: `ERROR: ${err.message}`,
        response: '', metrics: {},
      });
    }

    // Pauza mezi testy (Ollama cooldown)
    if (i < TESTS.length - 1) {
      await sleep(PAUSE_MS);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════════════════════════════════════

  printResults(results);
}

function printResults(results) {
  console.log('\n\x1b[1m╔══════════════════════════════════════════════════════════╗');
  console.log('║          E2E QUALITY DEEP — VÝSLEDKY                    ║');
  console.log('╚══════════════════════════════════════════════════════════╝\x1b[0m\n');

  const categories = [...new Set(results.map(r => r.category))];
  let totalPass = 0;
  let totalFail = 0;

  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    const pass = catResults.filter(r => r.pass).length;
    const fail = catResults.length - pass;
    totalPass += pass;
    totalFail += fail;

    const pct = Math.round((pass / catResults.length) * 100);
    const barFull = Math.round(pct / 5);
    const bar = '\x1b[32m' + '█'.repeat(barFull) + '\x1b[90m' + '░'.repeat(20 - barFull) + '\x1b[0m';
    console.log(`  ${cat}`);
    console.log(`    [${bar}] ${pct}% (${pass}/${catResults.length})`);

    if (fail > 0) {
      const failed = catResults.filter(r => !r.pass);
      for (const f of failed) {
        console.log(`    \x1b[31m❌ ${f.id}: ${f.name.substring(0, 55)}${f.detail ? ' — ' + f.detail.substring(0, 80) : ''}\x1b[0m`);
      }
    }
    console.log('');
  }

  // Aggregate metrics
  const avgDepth = results.reduce((a, r) => a + (r.metrics?.depth || 0), 0) / results.length;
  const avgLen = results.reduce((a, r) => a + (r.metrics?.length || 0), 0) / results.length;
  const totalLinks = results.reduce((a, r) => a + (r.metrics?.links || 0), 0);
  const metaViolations = results.filter(r => (r.metrics?.metaHits || 0) > 0).length;

  const totalPct = Math.round((totalPass / results.length) * 100);
  console.log('─'.repeat(60));
  console.log(`  \x1b[1mCELKEM: ${totalPass}/${results.length} (${totalPct}%)\x1b[0m`);
  console.log(`  Čas: ${(results.reduce((a, r) => a + r.duration, 0) / 1000).toFixed(1)}s`);
  console.log(`  Průměrná hloubka: ${avgDepth.toFixed(1)}/9`);
  console.log(`  Průměrná délka: ${Math.round(avgLen)} znaků`);
  console.log(`  Celkem odkazů: ${totalLinks}`);
  console.log(`  Meta-fráze porušení: ${metaViolations}/${results.length}`);
  console.log('');

  // Save results
  const output = {
    timestamp: new Date().toISOString(),
    version: 'e2e-quality-deep-v61.3',
    total: results.length,
    passed: totalPass,
    failed: totalFail,
    percentage: totalPct,
    metrics: { avgDepth: +avgDepth.toFixed(1), avgLength: Math.round(avgLen), totalLinks, metaViolations },
    categories: categories.map(cat => {
      const cr = results.filter(r => r.category === cat);
      return { name: cat, pass: cr.filter(r => r.pass).length, total: cr.length };
    }),
    tests: results.map(r => ({
      id: r.id, name: r.name, category: r.category,
      pass: r.pass, duration: r.duration, detail: r.detail,
      metrics: r.metrics,
    })),
  };

  // Always save latest
  const latestPath = 'e2e-quality-deep.json';
  fs.writeFileSync(latestPath, JSON.stringify(output, null, 2));
  console.log(`  📁 Výsledky: ${latestPath}`);

  if (SAVE_TO) {
    fs.writeFileSync(SAVE_TO, JSON.stringify(output, null, 2));
    console.log(`  📁 Uloženo jako: ${SAVE_TO}`);
  }

  if (COMPARE_TO && fs.existsSync(COMPARE_TO)) {
    printComparison(JSON.parse(fs.readFileSync(COMPARE_TO, 'utf-8')), output);
  }
}

function printComparison(before, after) {
  console.log('\n\x1b[1m╔══════════════════════════════════════════════════════════╗');
  console.log('║              POROVNÁNÍ BEFORE / AFTER                   ║');
  console.log('╚══════════════════════════════════════════════════════════╝\x1b[0m\n');

  console.log(`  Baseline:  ${before.timestamp}  ${before.passed}/${before.total} (${before.percentage}%)`);
  console.log(`  Current:   ${after.timestamp}  ${after.passed}/${after.total} (${after.percentage}%)`);

  const delta = after.percentage - before.percentage;
  const arrow = delta > 0 ? '📈' : delta < 0 ? '📉' : '➡️';
  console.log(`\n  ${arrow} Změna: ${delta > 0 ? '+' : ''}${delta}%`);

  if (before.metrics && after.metrics) {
    const depthDelta = (after.metrics.avgDepth - before.metrics.avgDepth).toFixed(1);
    console.log(`  Hloubka: ${before.metrics.avgDepth} → ${after.metrics.avgDepth} (${depthDelta > 0 ? '+' : ''}${depthDelta})`);
  }

  console.log('');
  for (const afterCat of after.categories) {
    const beforeCat = before.categories?.find(c => c.name === afterCat.name);
    if (beforeCat) {
      const bPct = Math.round((beforeCat.pass / beforeCat.total) * 100);
      const aPct = Math.round((afterCat.pass / afterCat.total) * 100);
      const d = aPct - bPct;
      const icon = d > 0 ? '🟢' : d < 0 ? '🔴' : '⚪';
      console.log(`  ${icon} ${afterCat.name}: ${bPct}% → ${aPct}% (${d > 0 ? '+' : ''}${d}%)`);
    }
  }

  const newPasses = [];
  const newFails = [];
  for (const at of after.tests) {
    const bt = before.tests?.find(t => t.id === at.id);
    if (bt && !bt.pass && at.pass) newPasses.push(at);
    if (bt && bt.pass && !at.pass) newFails.push(at);
  }

  if (newPasses.length > 0) {
    console.log(`\n  🎉 Nově opraveno (${newPasses.length}):`);
    for (const t of newPasses) console.log(`     ✅ ${t.id}: ${t.name.substring(0, 50)}`);
  }
  if (newFails.length > 0) {
    console.log(`\n  ⚠️ Nové regrese (${newFails.length}):`);
    for (const t of newFails) console.log(`     ❌ ${t.id}: ${t.name.substring(0, 50)}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

runAllTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
