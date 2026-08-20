// Validation Test Suites v123 — Synthetic Model Evaluation
// ══════════════════════════════════════════════════════════════════════════════
//
// 5 suites: reasoning, code, chat, vision, review
// Each suite has 6-8 tests with deterministic grading (no LLM judge).
// Direct Ollama calls (bypass gateway — same pattern as upgrade-manager._verifyModel).
//
// Priority hierarchy: empirical > validation > benchmarks > estimated benchmarks
//
// ══════════════════════════════════════════════════════════════════════════════

import { config } from '../config.js';
import { logger } from '../core/logger.js';
import { MODEL_PROFILES } from './model-profiles.js';
import { codePatchSuite } from '../eval/code-patch-suite.js';
import { deflateSync } from 'node:zlib';

// ─── Constants ─────────────────────────────────────────────────────────────

export const VALIDATION_VERSION = 'v123.1';
export const VALIDATION_TTL_DAYS = 14;
export const BLACKLIST_THRESHOLD = 0.2;
const TEST_TIMEOUT_MS = 30000;
const DEFAULT_NUM_PREDICT = 512;
const DEFAULT_TEMPERATURE = 0.1;
const DEFAULT_TOP_P = 0.9;

// ─── Minimal PNG Generation ───────────────────────────────────────────────

function _crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function _pngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length);
  const combined = new Uint8Array(typeBytes.length + data.length);
  combined.set(typeBytes); combined.set(data, typeBytes.length);
  const crc = _crc32(combined);
  const crcBytes = new Uint8Array(4);
  new DataView(crcBytes.buffer).setUint32(0, crc);
  return Buffer.concat([Buffer.from(len), Buffer.from(typeBytes), Buffer.from(data), Buffer.from(crcBytes)]);
}

/**
 * Generate a minimal PNG image as base64 string.
 * @param {number} w - width
 * @param {number} h - height
 * @param {number[][]} pixels - flat array of [r,g,b] per pixel (row-major)
 * @returns {string} base64-encoded PNG
 */
export function generatePNG(w, h, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, w);
  ihdrView.setUint32(4, h);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Raw image data: filter byte (0) + RGB per pixel, per row
  const raw = [];
  for (let y = 0; y < h; y++) {
    raw.push(0); // filter: none
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const px = pixels[idx] || [0, 0, 0];
      raw.push(px[0], px[1], px[2]);
    }
  }

  const compressed = deflateSync(Buffer.from(raw));

  // IEND
  const iend = new Uint8Array(0);

  return Buffer.concat([
    signature,
    _pngChunk('IHDR', ihdr),
    _pngChunk('IDAT', compressed),
    _pngChunk('IEND', iend),
  ]).toString('base64');
}

// Pre-generated test images
let _testImages = null;
export function getTestImages() {
  if (_testImages) return _testImages;

  // 1×1 red pixel
  const redPixel = generatePNG(1, 1, [[255, 0, 0]]);

  // 8×8 solid red
  const red8x8 = generatePNG(8, 8, Array(64).fill([255, 0, 0]));

  // 32×32 black circle on white (approx)
  const circle32 = [];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = x - 16, dy = y - 16;
      const dist = Math.sqrt(dx * dx + dy * dy);
      circle32.push(dist <= 10 && dist >= 8 ? [0, 0, 0] : [255, 255, 255]);
    }
  }
  const circleImg = generatePNG(32, 32, circle32);

  // 3 colored dots on white (16×16)
  const dots16 = [];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d1 = Math.sqrt((x - 4) ** 2 + (y - 8) ** 2);
      const d2 = Math.sqrt((x - 8) ** 2 + (y - 8) ** 2);
      const d3 = Math.sqrt((x - 12) ** 2 + (y - 8) ** 2);
      if (d1 <= 2) dots16.push([255, 0, 0]);
      else if (d2 <= 2) dots16.push([0, 255, 0]);
      else if (d3 <= 2) dots16.push([0, 0, 255]);
      else dots16.push([255, 255, 255]);
    }
  }
  const dotsImg = generatePNG(16, 16, dots16);

  _testImages = { redPixel, red8x8, circleImg, dotsImg };
  return _testImages;
}

// ─── Czech Diacritics Detection ───────────────────────────────────────────

const CZECH_CHARS = /[ěščřžýáíéúůďťňóĚŠČŘŽÝÁÍÉÚŮĎŤŇÓ]/g;
export function countCzechDiacritics(text) {
  return (text.match(CZECH_CHARS) || []).length;
}

// ─── Grading Helpers ──────────────────────────────────────────────────────

function _tryParseJSON(text) {
  try {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = jsonMatch ? jsonMatch[1].trim() : text.trim();
    return JSON.parse(candidate);
  } catch { return null; }
}

function _countKeywords(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.filter(k => lower.includes(k.toLowerCase())).length;
}

function _containsAny(text, keywords) {
  return _countKeywords(text, keywords) > 0;
}

function _countSentences(text) {
  return text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 5).length;
}

// ─── Randomized Prompt Helpers ────────────────────────────────────────────

function _randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ─── Suite Definitions ────────────────────────────────────────────────────

/**
 * Each test: { name, prompt(), grade(response), weight? }
 * prompt() returns string (or { prompt, images } for vision)
 * grade(response) returns { passed, score } where score is 0-1
 */

export const SUITES = {
  // ════════════════════════════════════════════════════════════════════════
  // REASONING (D1, D2, R1)
  // ════════════════════════════════════════════════════════════════════════
  reasoning: {
    name: 'reasoning',
    description: 'Logic, math, JSON compliance, planning',
    roles: ['D1', 'D2', 'R1'],
    tests: [
      {
        name: 'json_compliance',
        prompt: () => 'Odpověz jako JSON objekt s klíči: name, age, hobbies (pole). Jmenuji se Karel, je mi 35 let, rád čtu a běhám. Odpověz POUZE validním JSON.',
        grade: (r) => {
          const obj = _tryParseJSON(r);
          if (!obj) return { passed: false, score: 0 };
          const keys = ['name', 'age', 'hobbies'];
          const found = keys.filter(k => obj[k] != null).length;
          const isArray = Array.isArray(obj.hobbies);
          const score = (found / keys.length) * 0.7 + (isArray ? 0.3 : 0);
          return { passed: score >= 0.7, score };
        },
      },
      {
        name: 'logic_puzzle',
        prompt: () => 'Alice je vyšší než Bob. Cynthia je vyšší než Alice. Kdo je nejvyšší? Odpověz jedním jménem.',
        grade: (r) => {
          const passed = r.toLowerCase().includes('cynthia');
          return { passed, score: passed ? 1 : 0 };
        },
      },
      {
        name: 'math_basic',
        prompt: () => {
          const a = _randomInt(10, 50);
          const b = _randomInt(10, 50);
          const expected = a * b;
          return { text: `Kolik je ${a} × ${b}? Odpověz pouze číslem.`, _expected: String(expected) };
        },
        grade: (r, ctx) => {
          const expected = ctx?._expected || '391';
          const passed = r.includes(expected);
          return { passed, score: passed ? 1 : 0 };
        },
      },
      {
        name: 'multi_step_plan',
        prompt: () => 'Navrhni 5 kroků pro nasazení webové aplikace. Odpověz jako JSON pole řetězců. Pouze JSON.',
        grade: (r) => {
          const arr = _tryParseJSON(r);
          if (!Array.isArray(arr)) return { passed: false, score: 0 };
          const score = Math.min(1, arr.length / 5);
          return { passed: arr.length >= 5, score };
        },
      },
      {
        name: 'cause_effect',
        prompt: () => 'Pokud stoupne teplota nad 100°C, co se stane s vodou v otevřené nádobě? Odpověz jednou větou.',
        grade: (r) => {
          const passed = _containsAny(r, ['vař', 'vaří', 'bub', 'pár', 'steam', 'boil', 'vypař', 'vře']);
          return { passed, score: passed ? 1 : 0 };
        },
      },
      {
        name: 'categorization',
        prompt: () => 'Rozděl do kategorií: pes, kočka, jablko, hruška, auto, kolo. Odpověz jako JSON objekt s kategoriemi jako klíči a poli jako hodnotami. Pouze JSON.',
        grade: (r) => {
          const obj = _tryParseJSON(r);
          if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { passed: false, score: 0 };
          const keys = Object.keys(obj);
          const hasArrays = keys.filter(k => Array.isArray(obj[k])).length;
          const score = keys.length >= 2 ? (hasArrays / keys.length) * 0.7 + 0.3 : 0;
          return { passed: keys.length >= 2 && hasArrays >= 2, score };
        },
      },
      {
        name: 'instruction_follow',
        prompt: () => 'Napiš přesně 3 věty o kosmonautice. Každá věta musí začínat velkým písmenem a končit tečkou.',
        grade: (r) => {
          const sentences = _countSentences(r);
          if (sentences === 3) return { passed: true, score: 1 };
          if (sentences >= 2 && sentences <= 4) return { passed: false, score: 0.5 };
          return { passed: false, score: 0 };
        },
      },
      {
        name: 'czech_json',
        prompt: () => 'Vygeneruj JSON objekt s klíči: "město" (řetězec), "obyvatel" (číslo), "pamětihodnosti" (pole řetězců). Téma: Praha. Pouze JSON.',
        grade: (r) => {
          const obj = _tryParseJSON(r);
          if (!obj) return { passed: false, score: 0 };
          let score = 0;
          if (obj['město'] || obj.mesto || obj.city) score += 0.33;
          if (typeof (obj['obyvatel'] ?? obj.population) === 'number') score += 0.33;
          const landmarks = obj['pamětihodnosti'] || obj.landmarks || obj.pametihodnosti;
          if (Array.isArray(landmarks) && landmarks.length > 0) score += 0.34;
          return { passed: score >= 0.66, score };
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // CODE (CODE)
  // ════════════════════════════════════════════════════════════════════════
  code: {
    name: 'code',
    description: 'Function generation, bug fixes, code completion',
    roles: ['CODE'],
    tests: [
      {
        name: 'function_gen',
        prompt: () => 'Napiš JavaScript funkci `isPrime(n)` která vrátí true pokud je n prvočíslo. Pouze kód, žádný komentář.',
        grade: (r) => {
          const hasFunc = /function\s+isPrime|const\s+isPrime|isPrime\s*=/.test(r);
          const hasReturn = r.includes('return');
          const hasLoop = /for|while/.test(r);
          let score = 0;
          if (hasFunc) score += 0.4;
          if (hasReturn) score += 0.3;
          if (hasLoop) score += 0.3;
          return { passed: score >= 0.7, score };
        },
      },
      {
        name: 'bug_fix',
        prompt: () => 'Oprav chyby v této funkci:\n```js\nfunction sum(arr) {\n  let total;\n  for (let i = 0; i <= arr.length; i++) {\n    total += arr[i];\n  }\n  return total;\n}\n```\nVrať opravenou funkci.',
        grade: (r) => {
          const fix1 = /total\s*=\s*0/.test(r);
          const fix2 = /<\s*arr\.length/.test(r) || /i\s*<\s*arr/.test(r);
          let score = 0;
          if (fix1) score += 0.5;
          if (fix2) score += 0.5;
          return { passed: score >= 1.0, score };
        },
      },
      {
        name: 'code_completion',
        prompt: () => 'Dokonči funkci:\n```python\ndef fibonacci(n):\n    if n <= 1:\n        return n\n```\nPřidej rekurzivní nebo iterativní řešení. Vrať celou funkci.',
        grade: (r) => {
          const hasFib = r.includes('fibonacci');
          const hasRecursion = /fibonacci\s*\(n\s*-/.test(r) || /fibonacci\s*\(\s*n\s*-/.test(r);
          const hasIteration = /for|while/.test(r);
          const score = hasFib ? (hasRecursion || hasIteration ? 1 : 0.5) : 0;
          return { passed: score >= 0.5, score };
        },
      },
      {
        name: 'algorithm',
        prompt: () => 'Napiš funkci `binarySearch(arr, target)` v JavaScriptu. Vrať index nebo -1. Pouze kód.',
        grade: (r) => {
          const hasName = r.includes('binarySearch');
          const hasMid = /mid|middle|center/.test(r);
          const hasWhile = /while|for/.test(r);
          let score = 0;
          if (hasName) score += 0.3;
          if (hasMid) score += 0.4;
          if (hasWhile) score += 0.3;
          return { passed: score >= 0.7, score };
        },
      },
      {
        name: 'regex_gen',
        prompt: () => 'Napiš regulární výraz pro validaci emailové adresy v JavaScriptu. Vrať pouze regex literál.',
        grade: (r) => {
          const hasSlash = r.includes('/');
          const hasAt = r.includes('@');
          const hasDot = r.includes('\\.');
          let score = 0;
          if (hasSlash) score += 0.3;
          if (hasAt) score += 0.4;
          if (hasDot) score += 0.3;
          return { passed: score >= 0.7, score };
        },
      },
      {
        name: 'code_review',
        prompt: () => 'Najdi bezpečnostní problémy v tomto kódu:\n```js\nconst data = JSON.parse(userInput);\neval(data.command);\ndb.query(\'SELECT * FROM users WHERE id=\' + userId);\n```\nPopiš každý problém.',
        grade: (r) => {
          const issues = ['eval', 'injection', 'SQL', 'bezpečnost', 'security', 'XSS', 'sanitiz', 'nebezpeč', 'dangerous', 'command'];
          const found = _countKeywords(r, issues);
          if (found >= 3) return { passed: true, score: 1.0 };
          if (found >= 2) return { passed: true, score: 0.6 };
          if (found >= 1) return { passed: false, score: 0.3 };
          return { passed: false, score: 0 };
        },
      },
      {
        name: 'refactor',
        prompt: () => 'Refaktoruj na arrow functions:\n```js\nfunction add(a, b) { return a + b; }\nfunction multiply(a, b) { return a * b; }\n```\nVrať refaktorovaný kód.',
        grade: (r) => {
          const arrowCount = (r.match(/=>/g) || []).length;
          if (arrowCount >= 2) return { passed: true, score: 1.0 };
          if (arrowCount === 1) return { passed: false, score: 0.5 };
          return { passed: false, score: 0 };
        },
      },
      {
        name: 'test_gen',
        prompt: () => 'Napiš unit test pro funkci `add(a, b)` která vrací součet dvou čísel. Použij libovolný framework.',
        grade: (r) => {
          const hasTestKeyword = _containsAny(r, ['test', 'it(', 'describe', 'assert', 'expect', 'assertEqual']);
          const hasAdd = r.includes('add');
          const score = (hasTestKeyword ? 0.6 : 0) + (hasAdd ? 0.4 : 0);
          return { passed: score >= 0.6, score };
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // CHAT (CHAT)
  // ════════════════════════════════════════════════════════════════════════
  chat: {
    name: 'chat',
    description: 'Czech language quality, instruction following, conversation',
    roles: ['CHAT'],
    tests: [
      {
        name: 'czech_quality',
        prompt: () => 'Napiš 3 věty o historii Prahy. Každá věta musí obsahovat české znaky (háčky/čárky).',
        grade: (r) => {
          const count = countCzechDiacritics(r);
          if (count >= 5) return { passed: true, score: 1.0 };
          if (count >= 3) return { passed: true, score: 0.7 };
          if (count >= 1) return { passed: false, score: 0.3 };
          return { passed: false, score: 0 };
        },
      },
      {
        name: 'instruction_follow',
        prompt: () => 'Odpověz POUZE slovem "ano" nebo "ne": Je Země placatá?',
        grade: (r) => {
          const trimmed = r.trim().toLowerCase();
          const passed = trimmed.startsWith('ne');
          return { passed, score: passed ? 1 : 0 };
        },
      },
      {
        name: 'summarization',
        prompt: () => 'Shrň do 1-2 vět: Umělá inteligence je obor informatiky, který se zabývá tvorbou systémů schopných provádět úkoly vyžadující lidskou inteligenci, jako je rozpoznávání řeči, vizuální vnímání, rozhodování a překlad jazyků.',
        grade: (r) => {
          const short = r.length < 300;
          const relevant = _containsAny(r, ['AI', 'umělá', 'inteligenc', 'systém', 'informatik']);
          const score = (short ? 0.5 : 0) + (relevant ? 0.5 : 0);
          return { passed: score >= 1.0, score };
        },
      },
      {
        name: 'topic_awareness',
        prompt: () => 'O čem jsme se bavili? (Toto je první zpráva v konverzaci.)',
        grade: (r) => {
          const passed = _containsAny(r, ['prv', 'nebavili', 'začátek', 'žádn', 'nemám', 'first', 'no previous', 'nepamatuj', 'nezačali']);
          return { passed, score: passed ? 1 : 0 };
        },
      },
      {
        name: 'tone_formal',
        prompt: () => 'Napiš formální email řediteli školy o žádosti o schůzku. Maximálně 5 vět.',
        grade: (r) => {
          const hasFormal = _containsAny(r, ['Vážen', 'Dobrý den', 'S pozdravem', 'S úctou']);
          const hasSubject = r.length > 50;
          const score = (hasFormal ? 0.6 : 0) + (hasSubject ? 0.4 : 0);
          return { passed: score >= 0.6, score };
        },
      },
      {
        name: 'creative',
        prompt: () => 'Vymysli krátký příběh (3-5 vět) o robotovi, který se naučil vařit.',
        grade: (r) => {
          const hasLength = r.length > 100;
          const hasTheme = _containsAny(r, ['robot', 'vař', 'kuch', 'jídl', 'recept']);
          const score = (hasLength ? 0.5 : 0) + (hasTheme ? 0.5 : 0);
          return { passed: score >= 1.0, score };
        },
      },
      {
        name: 'multilingual',
        prompt: () => "Přelož do angličtiny: 'Dobrý den, jak se máte?'",
        grade: (r) => {
          const lower = r.toLowerCase();
          const hasGreeting = _containsAny(lower, ['hello', 'good day', 'good morning', 'hi']);
          const hasQuestion = _containsAny(lower, ['how are you', 'how do you do']);
          const score = (hasGreeting ? 0.5 : 0) + (hasQuestion ? 0.5 : 0);
          return { passed: score >= 1.0, score };
        },
      },
      {
        name: 'factual',
        prompt: () => 'Kdo napsal Romeo a Julii? Odpověz jedním jménem.',
        grade: (r) => {
          const passed = r.toLowerCase().includes('shakespeare');
          return { passed, score: passed ? 1 : 0 };
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // VISION (VISION)
  // ════════════════════════════════════════════════════════════════════════
  vision: {
    name: 'vision',
    description: 'Image understanding and description',
    roles: ['VISION'],
    tests: [
      {
        name: 'capability_check',
        prompt: () => {
          const images = getTestImages();
          return { text: 'Popiš tento obrázek.', images: [images.redPixel] };
        },
        grade: (r) => {
          const passed = r.length > 10;
          return { passed, score: passed ? 1 : 0 };
        },
      },
      {
        name: 'color_detect',
        prompt: () => {
          const images = getTestImages();
          return { text: 'Jaká barva je na obrázku? Odpověz jedním slovem.', images: [images.red8x8] };
        },
        grade: (r) => {
          const passed = _containsAny(r, ['červ', 'red', 'rudá', 'rudý']);
          return { passed, score: passed ? 1 : 0 };
        },
      },
      {
        name: 'shape_detect',
        prompt: () => {
          const images = getTestImages();
          return { text: 'Co vidíš na obrázku? Popiš tvar.', images: [images.circleImg] };
        },
        grade: (r) => {
          const passed = _containsAny(r, ['kruh', 'circle', 'kolečko', 'kolo', 'kulatý', 'ring', 'round']);
          return { passed, score: passed ? 1 : 0 };
        },
      },
      {
        name: 'count_objects',
        prompt: () => {
          const images = getTestImages();
          return { text: 'Kolik barevných bodů/teček je na obrázku? Odpověz číslem.', images: [images.dotsImg] };
        },
        grade: (r) => {
          const passed = _containsAny(r, ['3', 'tři', 'three']);
          return { passed, score: passed ? 1 : 0 };
        },
      },
      {
        name: 'color_names',
        prompt: () => {
          const images = getTestImages();
          return { text: 'Jaké barvy mají body na obrázku? Vypiš je.', images: [images.dotsImg] };
        },
        grade: (r) => {
          const colors = ['červ', 'red', 'zelen', 'green', 'modr', 'blue'];
          const found = _countKeywords(r, colors);
          if (found >= 3) return { passed: true, score: 1.0 };
          if (found >= 2) return { passed: true, score: 0.6 };
          if (found >= 1) return { passed: false, score: 0.3 };
          return { passed: false, score: 0 };
        },
      },
      {
        name: 'no_image_guard',
        prompt: () => 'Popiš obrázek, který vidíš.',
        grade: (r) => {
          // No image provided — model should acknowledge missing image
          const passed = _containsAny(r, ['nevidím', 'žádný', 'nemám', 'no image', 'nebyl', 'není', 'can\'t see', 'cannot']);
          return { passed, score: passed ? 1 : 0 };
        },
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // REVIEW (R2)
  // ════════════════════════════════════════════════════════════════════════
  review: {
    name: 'review',
    description: 'Bug detection, code review, JSON output',
    roles: ['R2'],
    tests: [
      {
        name: 'json_review',
        prompt: () => 'Zkontroluj tento kód a odpověz JSON: { "issues": [...], "severity": "high"|"medium"|"low" }\nKód: `eval(input)`\nOdpověz POUZE validním JSON.',
        grade: (r) => {
          const obj = _tryParseJSON(r);
          if (!obj) return { passed: false, score: 0 };
          let score = 0;
          if (Array.isArray(obj.issues)) score += 0.5;
          if (['high', 'medium', 'low'].includes(obj.severity)) score += 0.5;
          return { passed: score >= 1.0, score };
        },
      },
      {
        name: 'bug_detect',
        prompt: () => 'Najdi chybu:\n```js\nfor (let i = 0; i < arr.length; i++) {\n  setTimeout(() => console.log(arr[i]), 100);\n}\n```\nPopiš problém.',
        grade: (r) => {
          const passed = _containsAny(r, ['clos', 'scope', 'undefined', 'async', 'callback', 'uzávěr', 'setTimeout']);
          return { passed, score: passed ? 1 : 0 };
        },
      },
      {
        name: 'security_review',
        prompt: () => 'Zkontroluj bezpečnost:\n```python\nos.system(f\'rm {user_input}\')\n```\nJaké je riziko?',
        grade: (r) => {
          const keywords = ['inject', 'command', 'bezpečnost', 'sanitiz', 'nebezpeč', 'dangerous', 'shell', 'arbitrary', 'příkaz'];
          const found = _countKeywords(r, keywords);
          if (found >= 2) return { passed: true, score: 1.0 };
          if (found >= 1) return { passed: true, score: 0.6 };
          return { passed: false, score: 0 };
        },
      },
      {
        name: 'complexity_assess',
        prompt: () => 'Jaká je časová složitost?\n```\nfor i in range(n):\n  for j in range(n):\n    print(i, j)\n```\nOdpověz stručně.',
        grade: (r) => {
          const passed = _containsAny(r, ['n²', 'n^2', 'n*n', 'n×n', 'kvadratick', 'quadratic', 'O(n²)', 'O(n^2)']);
          return { passed, score: passed ? 1 : 0 };
        },
      },
      {
        name: 'style_review',
        prompt: () => 'Zkontroluj styl kódu:\n```js\nvar x=1;var y=2;var z=x+y;console.log(z)\n```\nCo bys změnil?',
        grade: (r) => {
          const issues = ['var', 'let', 'const', 'formát', 'format', 'mezery', 'spaces', 'středník', 'semicolon', 'whitespace'];
          const found = _countKeywords(r, issues);
          if (found >= 3) return { passed: true, score: 1.0 };
          if (found >= 2) return { passed: true, score: 0.6 };
          if (found >= 1) return { passed: false, score: 0.3 };
          return { passed: false, score: 0 };
        },
      },
      {
        name: 'refactor_suggest',
        prompt: () => 'Navrhni refaktoring:\n```js\nif (x === 1) { return \'one\'; }\nif (x === 2) { return \'two\'; }\nif (x === 3) { return \'three\'; }\n```\nJak to zjednodušit?',
        grade: (r) => {
          const passed = _containsAny(r, ['switch', 'map', 'objekt', 'object', 'lookup', 'slovník', 'dictionary', 'Map']);
          return { passed, score: passed ? 1 : 0 };
        },
      },
    ],
  },
};

// ─── Registrace sady CODE se spouštěným testem ────────────────────────────
//
// `code_patch` se přidává vedle `code`, ne místo ní.  Stará sada zůstává, aby
// šlo obojí porovnat na týchž modelech; vazba role CODE se nemění — to je
// ruční rozhodnutí operátora (`model-profiles.js` je připnutý bajtovým hashem).

SUITES.code_patch = codePatchSuite;

// ─── Suite Lookup ─────────────────────────────────────────────────────────

/**
 * Get validation suite name for a role.
 */
export function getSuiteForRole(role) {
  const profile = MODEL_PROFILES[role];
  return profile?.validationSuite || null;
}

/**
 * Get all roles that use a given suite.
 */
export function getRolesForSuite(suiteName) {
  return SUITES[suiteName]?.roles || [];
}

/**
 * Get all suite names relevant for a model (based on roles it could serve).
 */
export function getRelevantSuites(modelName) {
  const suiteSet = new Set();
  for (const [role, profile] of Object.entries(MODEL_PROFILES)) {
    if (profile.validationSuite) suiteSet.add(profile.validationSuite);
  }
  return [...suiteSet];
}

// ─── Validation Runner ────────────────────────────────────────────────────

export class ValidationRunner {
  constructor(ollamaBaseUrl) {
    this._baseUrl = ollamaBaseUrl || config.ollama?.baseUrl || 'http://127.0.0.1:11434';
    this._db = null;
    this._cancelled = false;
  }

  setDb(db) { this._db = db; }
  cancel() { this._cancelled = true; }

  /**
   * Direct Ollama call — same pattern as upgrade-manager._verifyModel().
   * No gateway, no auth token needed.
   */
  async _callModel(modelName, messages, options = {}) {
    const controller = new AbortController();
    const timeoutMs = options.timeout || TEST_TIMEOUT_MS;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const start = Date.now();

    try {
      const body = {
        model: modelName,
        messages,
        stream: false,
        think: false,
        options: {
          temperature: options.temperature ?? DEFAULT_TEMPERATURE,
          top_p: options.top_p ?? DEFAULT_TOP_P,
          num_predict: options.num_predict ?? DEFAULT_NUM_PREDICT,
          num_ctx: options.num_ctx || 4096,
        },
      };

      const response = await fetch(`${this._baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);

      const data = await response.json();
      return {
        content: data.message?.content || data.response || '',
        evalCount: data.eval_count || 0,
        promptEvalCount: data.prompt_eval_count || 0,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      const timedOut = err.name === 'AbortError';
      return { content: '', evalCount: 0, promptEvalCount: 0, durationMs: Date.now() - start, error: err.message, timedOut };
    }
  }

  /**
   * Run a single test case against a model.
   */
  async _runTest(testDef, modelName) {
    const promptResult = testDef.prompt();
    let promptText, images, expectedCtx;

    if (typeof promptResult === 'object' && promptResult.text) {
      promptText = promptResult.text;
      images = promptResult.images || null;
      expectedCtx = promptResult;
    } else if (typeof promptResult === 'object' && promptResult._expected) {
      promptText = promptResult.text || String(promptResult);
      expectedCtx = promptResult;
    } else {
      promptText = String(promptResult);
      expectedCtx = null;
    }

    const msg = { role: 'user', content: promptText };
    if (images) msg.images = images;

    // Sady si mohou vyžádat vlastní parametry volání. `code_patch` potřebuje
    // větší num_ctx (vadná funkce v promptu), víc num_predict (vrací celou
    // funkci) a delší timeout (studené načtení modelu trvalo změřeně 122 s).
    const result = await this._callModel(modelName, [msg], testDef.options || {});

    if (result.error) {
      return {
        name: testDef.name,
        passed: false,
        score: 0,
        response: '',
        durationMs: result.durationMs,
        evalTokens: 0,
        error: result.error,
      };
    }

    const gradeResult = testDef.grade(result.content, expectedCtx);
    return {
      name: testDef.name,
      passed: gradeResult.passed,
      score: gradeResult.score,
      response: result.content.substring(0, 500),
      durationMs: result.durationMs,
      evalTokens: result.evalCount,
    };
  }

  /**
   * Run a complete suite against a model.
   * @param {string} suiteName - 'reasoning', 'code', 'chat', 'vision', 'review'
   * @param {string} modelName - e.g. 'qwen3.5:27b'
   * @param {Function} [onProgress] - callback({ suite, testName, status, currentTest, totalTests, percent })
   * @returns {Promise<Object>} { suite, model, score, passed, total, tests[], durationMs }
   */
  async runSuite(suiteName, modelName, onProgress) {
    const suite = SUITES[suiteName];
    if (!suite) throw new Error(`Unknown suite: ${suiteName}`);

    this._cancelled = false;
    const startTime = Date.now();
    const tests = [];
    let passedCount = 0;
    let totalScore = 0;

    // Skip vision tests if model doesn't support vision
    const isVision = suiteName === 'vision';

    for (let i = 0; i < suite.tests.length; i++) {
      if (this._cancelled) break;

      const testDef = suite.tests[i];
      if (onProgress) {
        onProgress({
          suite: suiteName, testName: testDef.name, status: 'running',
          currentTest: i + 1, totalTests: suite.tests.length,
          percent: Math.round((i / suite.tests.length) * 100),
        });
      }

      const result = await this._runTest(testDef, modelName);
      tests.push(result);
      if (result.passed) passedCount++;
      totalScore += result.score;
    }

    const suiteScore = suite.tests.length > 0 ? totalScore / suite.tests.length : 0;
    const durationMs = Date.now() - startTime;

    // Persist to DB
    if (this._db) {
      this._persistResults(modelName, suiteName, tests, suiteScore, passedCount, suite.tests.length, durationMs);
    }

    if (onProgress) {
      onProgress({
        suite: suiteName, testName: null, status: 'complete',
        currentTest: suite.tests.length, totalTests: suite.tests.length,
        percent: 100, score: suiteScore,
      });
    }

    return { suite: suiteName, model: modelName, score: suiteScore, passed: passedCount, total: suite.tests.length, tests, durationMs };
  }

  /**
   * Run all relevant suites for a model.
   * @param {string} modelName
   * @param {string[]} [suiteNames] - specific suites (default: all)
   * @param {Function} [onProgress]
   */
  async runAll(modelName, suiteNames, onProgress) {
    const names = suiteNames || Object.keys(SUITES);
    const results = [];
    const startTime = Date.now();

    for (const name of names) {
      if (this._cancelled) break;
      const result = await this.runSuite(name, modelName, onProgress);
      results.push(result);
    }

    const overallScore = results.length > 0
      ? results.reduce((sum, r) => sum + r.score, 0) / results.length
      : 0;

    return {
      model: modelName,
      results,
      overallScore,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Persist test results + suite score to DB.
   */
  _persistResults(model, suite, tests, suiteScore, passed, total, durationMs) {
    try {
      const insertTest = this._db.prepare(`
        INSERT OR REPLACE INTO validation_results
          (model, suite, test_name, passed, score, response_preview, duration_ms, eval_tokens)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertSuite = this._db.prepare(`
        INSERT OR REPLACE INTO validation_suite_scores
          (model, suite, score, passed, total, duration_ms, validated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `);

      const tx = this._db.transaction(() => {
        for (const t of tests) {
          insertTest.run(model, suite, t.name, t.passed ? 1 : 0, t.score, t.response || '', t.durationMs || 0, t.evalTokens || 0);
        }
        insertSuite.run(model, suite, suiteScore, passed, total, durationMs);
      });
      tx();
    } catch (err) {
      logger.warn('ValidationRunner', `Failed to persist results: ${err.message}`);
    }
  }

  /**
   * Get cached validation results from DB.
   * @returns {Object|null} { suites: { code: { score, passed, total, validatedAt, tests[] }, ... } }
   */
  getResults(model) {
    if (!this._db) return null;
    try {
      const suiteRows = this._db.prepare(
        `SELECT * FROM validation_suite_scores WHERE model = ?`
      ).all(model);

      if (!suiteRows || suiteRows.length === 0) return null;

      const suites = {};
      for (const row of suiteRows) {
        const testRows = this._db.prepare(
          `SELECT test_name, passed, score, response_preview, duration_ms, eval_tokens
           FROM validation_results WHERE model = ? AND suite = ?`
        ).all(model, row.suite);

        suites[row.suite] = {
          score: row.score,
          passed: row.passed,
          total: row.total,
          durationMs: row.duration_ms,
          validatedAt: row.validated_at,
          tests: testRows.map(t => ({
            name: t.test_name,
            passed: !!t.passed,
            score: t.score,
            durationMs: t.duration_ms,
          })),
        };
      }

      return { model, suites };
    } catch { return null; }
  }

  /**
   * Check if validation results are stale (older than TTL).
   */
  isStale(model, suiteName) {
    if (!this._db) return true;
    try {
      const row = this._db.prepare(
        `SELECT validated_at FROM validation_suite_scores WHERE model = ? AND suite = ?`
      ).get(model, suiteName);
      if (!row) return true;
      const age = (Date.now() - Date.parse(row.validated_at)) / (1000 * 60 * 60 * 24);
      return age > VALIDATION_TTL_DAYS;
    } catch { return true; }
  }

  /**
   * Check if a model should be blacklisted for a role based on validation score.
   */
  isBlacklistedForRole(model, role) {
    const suiteName = getSuiteForRole(role);
    if (!suiteName || !this._db) return false;
    try {
      const row = this._db.prepare(
        `SELECT score FROM validation_suite_scores WHERE model = ? AND suite = ?`
      ).get(model, suiteName);
      return row ? row.score < BLACKLIST_THRESHOLD : false;
    } catch { return false; }
  }

  /**
   * Get validation score for a specific model+suite.
   * @returns {number|null} 0-1 score or null if not validated
   */
  getScore(model, suiteName) {
    if (!this._db) return null;
    try {
      const row = this._db.prepare(
        `SELECT score, validated_at FROM validation_suite_scores WHERE model = ? AND suite = ?`
      ).get(model, suiteName);
      return row ? row.score : null;
    } catch { return null; }
  }

  /**
   * Get all validation scores for all models (for scoring endpoint).
   * @returns {Map<string, Object>} model → { reasoning: 0.8, code: 0.9, ... }
   */
  getAllScores() {
    if (!this._db) return new Map();
    try {
      const rows = this._db.prepare(
        `SELECT model, suite, score, validated_at FROM validation_suite_scores`
      ).all();
      const result = new Map();
      for (const row of rows) {
        if (!result.has(row.model)) result.set(row.model, {});
        result.get(row.model)[row.suite] = { score: row.score, validatedAt: row.validated_at };
      }
      return result;
    } catch { return new Map(); }
  }
}

// Singleton
export const validationRunner = new ValidationRunner();

export default {
  SUITES, VALIDATION_VERSION, VALIDATION_TTL_DAYS, BLACKLIST_THRESHOLD,
  getSuiteForRole, getRolesForSuite, getRelevantSuites,
  ValidationRunner, validationRunner,
  generatePNG, getTestImages, countCzechDiacritics,
};
