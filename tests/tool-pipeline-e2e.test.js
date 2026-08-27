#!/usr/bin/env node

// Release-profile tool pipeline journey. The production candidate disables
// external discovery, so web.search must fail closed instead of manufacturing
// a live-web success. Inline attachment bytes, model-backed code generation,
// pure local calculation and negative transport inputs cover the remaining
// active chat/tool boundaries without ambient filesystem or network authority.

const BASE_URL = process.env.C3_URL || 'http://127.0.0.1:3335';
const TIMEOUT_MS = 300_000;
const INLINE_CANARY = 'INTENTSMITH_INLINE_FIBONACCI_CANARY';
const PATH_ONLY_CANARY = 'INTENTSMITH_PATH_ONLY_MUST_NOT_LEAK';

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, description) {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${description}`);
    return;
  }
  failed += 1;
  failures.push(description);
  console.log(`  ❌ ${description}`);
}

async function request(method, pathname, body = null) {
  const response = await fetch(new URL(pathname, BASE_URL), {
    method,
    headers: { 'Content-Type': 'application/json', Connection: 'close' },
    body: body === null ? undefined : JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}

function chat(message, extra = {}) {
  return request('POST', '/api/chat', {
    conversation_id: `m6-tool-pipeline-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    message,
    ...extra,
  });
}

async function run() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║    IntentSmith: M6 Tool Pipeline Release E2E            ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const health = await request('GET', '/api/health');
  assert(health.status === 200 && health.data?.status === 'ok', 'owned server health is ready');

  console.log('\n── Offline search authority ──');
  const search = await chat('Jaké jsou aktuální trendy v AI vývoji?');
  assert(search.status === 200, `offline SEARCH returned HTTP 200 (got ${search.status})`);
  assert(search.data?.metadata?.decision?.intent === 'SEARCH', 'CRE selected SEARCH');
  assert(search.data?.metadata?.decision?.tools?.includes('web.search'), 'SEARCH selected web.search');
  assert(search.data?.metadata?.securityBlocked === true, 'external search is security-blocked');
  assert(search.data?.metadata?.fallbackSuppressed === true, 'search denial suppresses LLM fallback');
  assert(
    search.data?.metadata?.m2EffectTerminal === true,
    'search denial is represented by a durable M2 effect terminal',
  );
  assert(
    !/https?:\/\//.test(search.data?.response || ''),
    'offline denial contains no fabricated live-web link',
  );

  console.log('\n── Inline attachment bytes ──');
  const inlineCode = [
    `// ${INLINE_CANARY}`,
    'function fibonacci(n) {',
    '  if (n <= 1) return n;',
    '  return fibonacci(n - 1) + fibonacci(n - 2);',
    '}',
  ].join('\n');
  const attachment = await chat('Vysvětli přiloženou funkci a její rekurzi.', {
    attachments: [{ name: 'fibonacci.js', content: inlineCode, size: Buffer.byteLength(inlineCode) }],
  });
  const attachmentText = attachment.data?.response || '';
  assert(attachment.status === 200, `inline attachment returned HTTP 200 (got ${attachment.status})`);
  assert(
    attachment.data?.metadata?.decision?.intent === 'FILE_EXPLAIN',
    `inline attachment selected FILE_EXPLAIN (got ${attachment.data?.metadata?.decision?.intent})`,
  );
  assert(attachmentText.length > 100, `inline explanation is substantive (${attachmentText.length} chars)`);
  assert(/fibonacci|rekurz/i.test(attachmentText), 'inline explanation identifies Fibonacci or recursion');
  assert(attachment.data?.metadata?.securityBlocked !== true, 'inline bytes do not require disk authority');

  console.log('\n── Model-backed code response ──');
  const code = await chat('Napiš v JavaScriptu krátkou funkci sum(a, b), která vrátí součet.');
  const codeText = code.data?.response || '';
  assert(code.status === 200, `code response returned HTTP 200 (got ${code.status})`);
  assert(codeText.length > 80, `code response is substantive (${codeText.length} chars)`);
  assert(/```/.test(codeText), 'code response contains a fenced code block');
  assert(/sum\s*\(|function\s+sum/i.test(codeText), 'code response contains the requested sum function');

  console.log('\n── Deterministic local tool ──');
  const math = await chat('Kolik je 17 * 23 + 5?');
  assert(math.status === 200, `local math returned HTTP 200 (got ${math.status})`);
  assert(math.data?.metadata?.decision?.intent === 'LOCAL', 'local math retained LOCAL intent');
  assert((math.data?.response || '').includes('396'), 'local math returned exact result 396');

  console.log('\n── Negative transport inputs ──');
  const pathOnly = await chat('Vysvětli přílohu.', {
    attachments: [{ name: 'secret.txt', path: `/tmp/${PATH_ONLY_CANARY}.txt`, size: 32 }],
  });
  assert(pathOnly.status === 200, `path-only attachment returned typed HTTP 200 denial (got ${pathOnly.status})`);
  assert(pathOnly.data?.metadata?.error === 'ATTACHMENT_CONTENT_AUTHORITY_REQUIRED', 'path-only attachment has exact error code');
  assert(pathOnly.data?.metadata?.securityBlocked === true, 'path-only attachment is security-blocked');
  assert(pathOnly.data?.metadata?.fallbackSuppressed === true, 'path-only attachment suppresses fallback');
  assert(!(pathOnly.data?.response || '').includes(PATH_ONLY_CANARY), 'path-only attachment does not echo path canary');

  const empty = await chat('');
  assert(empty.status === 400, `empty chat is rejected with HTTP 400 (got ${empty.status})`);
  assert(typeof empty.data?.error === 'string' && empty.data.error.length > 0, 'empty chat returns a typed error body');

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  M6 Tool Pipeline Release E2E: ${passed}/${passed + failed} PASS, ${failed} FAIL`);
  console.log('══════════════════════════════════════════════════════════');
  if (failures.length > 0) console.log(`❌ Failures: ${failures.join(', ')}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

run().catch(error => {
  console.error('M6 tool pipeline E2E error:', error.stack || error.message);
  process.exitCode = 1;
});
