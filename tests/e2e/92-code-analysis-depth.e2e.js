// tests/e2e/92-code-analysis-depth.e2e.js — Deep Code Analysis & Refactoring Quality
// ══════════════════════════════════════════════════════════════════════════════
// Tier 3+: Tests C3's ability to perform deep code analysis — understanding
// code structure, finding bugs, suggesting refactors, and explaining complex
// patterns. This is about analytical quality, not generation.
//
// Expected duration: 5-8 minutes.
// ══════════════════════════════════════════════════════════════════════════════
import {
  suite, testAsync, assert, summary,
  waitForServer, createConv, chatInConv, hasKeywords,
  cleanupConversation, LLM_TIMEOUT,
} from './_helpers.js';

await waitForServer();

const created = [];
const ANALYSIS_TIMEOUT = LLM_TIMEOUT * 5;  // 300s — long code analysis needs more time

// ── Code Samples ─────────────────────────────────────────────────────────────

const BUGGY_CODE = `
\`\`\`javascript
class UserCache {
  constructor() {
    this.cache = {};
    this.maxSize = 100;
  }

  get(userId) {
    return this.cache[userId];
  }

  set(userId, data) {
    this.cache[userId] = { data, timestamp: Date.now() };
    // Problem: never evicts old entries
  }

  getAll() {
    return Object.values(this.cache).map(entry => entry.data);
  }

  delete(userId) {
    delete this.cache[userId];
  }

  clear() {
    this.cache = {};
  }

  isExpired(userId, ttlMs = 300000) {
    const entry = this.cache[userId];
    if (!entry) return true;
    return Date.now() - entry.timestamp > ttlMs;
  }

  async fetchOrCache(userId, fetchFn) {
    if (!this.isExpired(userId)) {
      return this.cache[userId].data;
    }
    const data = await fetchFn(userId);
    this.set(userId, data);
    return data;
  }
}
\`\`\``;

const COMPLEX_PATTERN = `
\`\`\`python
from functools import wraps
from threading import Lock
import time

class RateLimiter:
    def __init__(self, max_calls, period):
        self.max_calls = max_calls
        self.period = period
        self.calls = []
        self.lock = Lock()

    def __call__(self, func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            with self.lock:
                now = time.time()
                self.calls = [c for c in self.calls if now - c < self.period]
                if len(self.calls) >= self.max_calls:
                    wait = self.period - (now - self.calls[0])
                    raise Exception(f"Rate limited. Retry after {wait:.1f}s")
                self.calls.append(now)
            return func(*args, **kwargs)
        return wrapper

@RateLimiter(max_calls=5, period=60)
def send_email(to, subject, body):
    print(f"Sending email to {to}")

@RateLimiter(max_calls=10, period=1)
def api_request(url):
    print(f"Requesting {url}")
\`\`\``;

const ARCHITECTURE_CODE = `
\`\`\`javascript
// file: src/api/users.js
import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../db/connection.js';

const router = express.Router();

router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [username, email, hash]
  );
  const token = jwt.sign({ userId: result.rows[0].id }, process.env.JWT_SECRET);
  res.json({ token, user: { id: result.rows[0].id, username, email } });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, result.rows[0].password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ userId: result.rows[0].id }, process.env.JWT_SECRET);
  res.json({ token });
});

router.get('/profile', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const result = await pool.query('SELECT id, username, email FROM users WHERE id = $1', [decoded.userId]);
  res.json(result.rows[0]);
});

export default router;
\`\`\``;

// ── Tests ────────────────────────────────────────────────────────────────────

try {
  // ═══════════════════════════════════════════════════════════════════════════
  suite('Code Analysis — Bug Detection');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('identify bugs in UserCache class', async () => {
    const convId = await createConv('analysis-bugs');
    created.push(convId);
    const r = await chatInConv(convId,
      `Najdi všechny chyby a problémy v tomto kódu. Buď konkrétní — uveď název metody a přesně popiš problém. Odpověz detailně.\n\n${BUGGY_CODE}`
    );

    assert(r.response.length > 120, `bug analysis too short: ${r.response.length}`);

    // Key bugs that should be found:
    // 1. No cache eviction (maxSize never enforced)
    // 2. Race condition in fetchOrCache (async gap between check and set)
    // 3. No size check in set()
    const identifiedBugs = [];
    if (hasKeywords(r.response, ['maxSize', 'evict', 'evikce', 'velikost', 'limit', 'overflow', 'přetečení', 'zaplní', 'nikdy neod', 'neomezuj'], 1)) identifiedBugs.push('eviction');
    if (hasKeywords(r.response, ['race', 'async', 'concurrent', 'souběž', 'paralelní', 'fetchOrCache', 'mezitím', 'souběh'], 1)) identifiedBugs.push('race-condition');
    if (hasKeywords(r.response, ['set', 'maxSize', 'kontrola', 'check', 'ověření', 'před vložení'], 1)) identifiedBugs.push('no-size-check');

    assert(identifiedBugs.length >= 2,
      `should identify at least 2 key bugs, found: ${identifiedBugs.join(', ') || 'none'}`);
  }, ANALYSIS_TIMEOUT);

  await testAsync('suggest concrete fixes for identified bugs', async () => {
    const convId = await createConv('analysis-fix');
    created.push(convId);
    const r = await chatInConv(convId,
      `Oprav všechny problémy v tomto kódu a vypiš opravenou verzi:\n\n${BUGGY_CODE}`
    );

    assert(r.response.includes('```'), 'fix should include code block');
    const blocks = r.response.match(/```[\s\S]*?```/g) || [];
    assert(blocks.length >= 1, 'should have at least one code block with fix');

    // Fixed version should have size check
    const code = blocks.join('\n');
    const hasEviction = hasKeywords(code, ['maxSize', 'delete', 'evict', 'size', 'length', 'Object.keys', 'Map'], 1);
    assert(hasEviction || code.length > 300,
      'fixed code should implement eviction or be comprehensive');
  }, ANALYSIS_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Code Analysis — Pattern Explanation');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('explain complex Python decorator pattern', async () => {
    const convId = await createConv('analysis-pattern');
    created.push(convId);
    const r = await chatInConv(convId,
      `Vysvětli detailně jak tento kód funguje. Rozepiš krok po kroku co se stane při zavolání send_email() a api_request(). Odpověz podrobně.\n\n${COMPLEX_PATTERN}`
    );

    assert(r.response.length > 120, `pattern explanation too short: ${r.response.length}`);

    // Should explain key concepts
    assert(hasKeywords(r.response, ['dekorátor', 'decorator', '@wraps', 'wrapper', '__call__', 'RateLimiter', 'obaluje', 'obal', 'funkce', 'function'], 1),
      'should explain decorator mechanism');
    assert(hasKeywords(r.response, ['lock', 'thread', 'vlákn', 'zámek', 'synchron'], 1),
      'should mention thread safety');
    assert(hasKeywords(r.response, ['rate limit', 'limit', 'omezen', 'volání', 'calls', 'perioda', 'period'], 1),
      'should explain rate limiting concept');
    // Should explain what happens on rate limit exceeded
    assert(hasKeywords(r.response, ['exception', 'raise', 'výjimk', 'chyb', 'retry', 'čekat', 'wait', 'odmítne'], 1),
      'should explain rate limit exceeded behavior');
  }, ANALYSIS_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Code Analysis — Security Review');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('identify security issues in Express API', async () => {
    const convId = await createConv('analysis-security');
    created.push(convId);
    const r = await chatInConv(convId,
      `Proveď bezpečnostní audit tohoto Express.js API kódu. Identifikuj každou bezpečnostní zranitelnost a navrhni opravu.\n\n${ARCHITECTURE_CODE}`
    );

    assert(r.response.length > 300, `security review too short: ${r.response.length}`);

    // Key security issues that should be found:
    const issues = [];
    // 1. No input validation
    if (hasKeywords(r.response, ['validac', 'validat', 'vstup', 'input', 'body', 'sanitiz'], 1)) issues.push('validation');
    // 2. JWT_SECRET from env (could be undefined)
    if (hasKeywords(r.response, ['JWT_SECRET', 'env', 'undefined', 'process.env', 'proměnná prostředí'], 1)) issues.push('jwt-secret');
    // 3. No try-catch on JWT verify
    if (hasKeywords(r.response, ['try', 'catch', 'verify', 'error', 'chyba', 'ošetření', 'handler', 'middleware'], 1)) issues.push('error-handling');
    // 4. No rate limiting
    if (hasKeywords(r.response, ['rate', 'limit', 'brute', 'force', 'omezen', 'útok', 'DDoS', 'DOS'], 1)) issues.push('rate-limit');
    // 5. SQL injection (parameterized is good, but no mention = missed review)
    if (hasKeywords(r.response, ['sql', 'injection', 'parametriz', 'prepared', 'dotaz'], 1)) issues.push('sql-review');

    assert(issues.length >= 3,
      `should identify ≥3 security issues, found ${issues.length}: ${issues.join(', ')}`);
  }, ANALYSIS_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Code Analysis — Refactoring Suggestions');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('suggest architectural improvements for Express API', async () => {
    const convId = await createConv('analysis-refactor');
    created.push(convId);
    const r = await chatInConv(convId,
      `Navrhni refaktoring tohoto kódu pro lepší architekturu. Rozděl zodpovědnosti, přidej abstrakce kde dávají smysl. Ukaž konkrétní kód.\n\n${ARCHITECTURE_CODE}`
    );

    assert(r.response.length > 300, `refactoring suggestion too short: ${r.response.length}`);
    assert(r.response.includes('```'), 'refactoring should include code examples');

    // Should suggest separation of concerns
    assert(hasKeywords(r.response, ['middleware', 'service', 'controller', 'vrst', 'layer', 'oddělení', 'separac', 'zodpověd', 'modul'], 2),
      `should suggest architectural separation: ${r.response.substring(0, 300)}`);
  }, ANALYSIS_TIMEOUT);

  // ═══════════════════════════════════════════════════════════════════════════
  suite('Code Analysis — Complexity Assessment');
  // ═══════════════════════════════════════════════════════════════════════════

  await testAsync('analyze time complexity of algorithm', async () => {
    const convId = await createConv('analysis-complexity');
    created.push(convId);
    const r = await chatInConv(convId,
      `Jaká je časová a prostorová složitost tohoto kódu? Vysvětli pro každou metodu zvlášť.

\`\`\`javascript
function findDuplicates(arr) {
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[i] === arr[j] && !result.includes(arr[i])) {
        result.push(arr[i]);
      }
    }
  }
  return result;
}
\`\`\``
    );

    assert(r.response.length > 100, `complexity analysis too short: ${r.response.length}`);
    // Should identify O(n²) or O(n³) complexity
    assert(hasKeywords(r.response, ['O(n', 'O(n²', 'O(n^2', 'O(n^3', 'O(n³', 'kvadratick', 'quadratic', 'kubick', 'n²', 'n^2'], 1),
      'should identify polynomial complexity');
    // Should suggest improvement
    assert(hasKeywords(r.response, ['Set', 'Map', 'hash', 'lepší', 'optimali', 'efektivn', 'improve', 'zlepš', 'O(n)'], 1),
      'should suggest a better approach');
  }, ANALYSIS_TIMEOUT);

  await testAsync('suggest optimized version', async () => {
    const convId = await createConv('analysis-optimize');
    created.push(convId);
    const r = await chatInConv(convId,
      `Napiš optimalizovanou verzi funkce findDuplicates s lepší časovou složitostí:

\`\`\`javascript
function findDuplicates(arr) {
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[i] === arr[j] && !result.includes(arr[i])) {
        result.push(arr[i]);
      }
    }
  }
  return result;
}
\`\`\``
    );

    assert(r.response.includes('```'), 'optimized version should include code');
    // Should use Set or Map for O(n) solution
    assert(hasKeywords(r.response, ['Set', 'Map', 'has(', 'add(', 'hash', 'seen', 'count', 'objekt'], 1),
      'optimized version should use Set/Map/hash structure');
  }, ANALYSIS_TIMEOUT);

} finally {
  for (const id of created) await cleanupConversation(id);
}

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
