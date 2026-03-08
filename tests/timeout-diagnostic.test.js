#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// Timeout Diagnostic — measures LLM response time degradation over sequential calls
// ═══════════════════════════════════════════════════════════════════════════════
//
// Purpose: Determine WHY 5 E2E tests timeout in full run but pass in isolation
//
// Hypotheses to test:
//   H1: Ollama degrades under sustained sequential load (thermal/memory)
//   H2: Gateway retries amplify marginal slowdown (60s timeout → retry → 90s bust)
//   H3: Model swapping between CRE + synthesis models adds latency
//   H4: Backend state accumulation (memory leak, conversation store growth)
//
// ═══════════════════════════════════════════════════════════════════════════════

import http from 'node:http';

const BASE_URL = 'http://127.0.0.1:3335';
const OLLAMA_URL = 'http://127.0.0.1:11434';

// ─── HTTP helpers ────────────────────────────────────────────────────────────

function request(baseUrl, method, endpoint, data = null, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, baseUrl);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout,
    };
    const t0 = Date.now();
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const elapsed = Date.now() - t0;
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body), elapsed });
        } catch {
          resolve({ status: res.statusCode, body: null, raw: body, elapsed });
        }
      });
    });
    req.on('error', (e) => {
      const elapsed = Date.now() - t0;
      reject(Object.assign(e, { elapsed }));
    });
    req.on('timeout', () => {
      const elapsed = Date.now() - t0;
      req.destroy();
      reject(new Error(`Timeout ${timeout}ms (elapsed: ${elapsed}ms)`));
    });
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

function chat(message) {
  const convId = `diag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return request(BASE_URL, 'POST', '/api/chat', {
    conversation_id: convId,
    message,
  }, 180000); // 3 minute timeout — we want to MEASURE, not timeout
}

function ollamaDirect(prompt, model = 'qwen3.5:27b') {
  return request(OLLAMA_URL, 'POST', '/api/generate', {
    model,
    prompt,
    stream: false,
    options: { num_predict: 100, temperature: 0.3 },
  }, 180000);
}

function ollamaModels() {
  return request(OLLAMA_URL, 'GET', '/api/tags', null, 10000);
}

function fmt(ms) {
  return (ms / 1000).toFixed(1) + 's';
}

// ─── Diagnostic Tests ────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  Timeout Diagnostic — LLM Latency Under Sequential Load        ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  // ═══ Phase 0: Environment ═══════════════════════════════════════════════════
  console.log('═══ Phase 0: Environment ═══════════════════════════════════════\n');

  try {
    const health = await request(BASE_URL, 'GET', '/api/health', null, 5000);
    console.log(`  Backend: ✅ ${health.body?.version || '?'}`);
  } catch (e) {
    console.log(`  Backend: ❌ ${e.message}`);
    process.exit(1);
  }

  try {
    const models = await ollamaModels();
    const loaded = (models.body?.models || []).map(m => `${m.name} (${(m.size / 1e9).toFixed(1)}GB)`);
    console.log(`  Ollama models: ${loaded.join(', ') || 'none'}`);
  } catch (e) {
    console.log(`  Ollama: ❌ ${e.message}`);
  }

  // Check Ollama running processes (loaded models)
  try {
    const ps = await request(OLLAMA_URL, 'GET', '/api/ps', null, 5000);
    const running = (ps.body?.models || []).map(m => `${m.name} (VRAM: ${(m.size_vram / 1e9).toFixed(1)}GB)`);
    console.log(`  Loaded in VRAM: ${running.join(', ') || 'none (cold start!)'}`);
  } catch (e) {
    console.log(`  Ollama /api/ps: ${e.message}`);
  }

  console.log('');

  // ═══ Phase 1: Direct Ollama — 10 sequential calls ═════════════════════════
  console.log('═══ Phase 1: Direct Ollama — 10 sequential calls ═══════════════\n');
  console.log('  Bypasses backend entirely. Measures raw Ollama response time.\n');

  const directTimes = [];
  const prompts = [
    'What is 2+2?',
    'Name 3 programming languages',
    'What is HTTP?',
    'Explain REST in one sentence',
    'What is JSON?',
    'Name 3 databases',
    'What is an API?',
    'Explain TCP/IP briefly',
    'What is DNS?',
    'What is a compiler?',
  ];

  for (let i = 0; i < prompts.length; i++) {
    try {
      const t0 = Date.now();
      const res = await ollamaDirect(prompts[i]);
      const elapsed = Date.now() - t0;
      directTimes.push(elapsed);
      const respLen = (res.body?.response || '').length;
      console.log(`  [${i + 1}/10] ${fmt(elapsed)} — "${prompts[i]}" (${respLen} chars)`);
    } catch (e) {
      directTimes.push(-1);
      console.log(`  [${i + 1}/10] ❌ ${e.message}`);
    }
  }

  const validDirect = directTimes.filter(t => t > 0);
  if (validDirect.length > 1) {
    const first3 = validDirect.slice(0, 3);
    const last3 = validDirect.slice(-3);
    const avg1 = first3.reduce((a, b) => a + b, 0) / first3.length;
    const avg2 = last3.reduce((a, b) => a + b, 0) / last3.length;
    const degradation = ((avg2 / avg1 - 1) * 100).toFixed(0);
    console.log(`\n  First 3 avg: ${fmt(avg1)}, Last 3 avg: ${fmt(avg2)}`);
    console.log(`  Degradation: ${degradation > 0 ? '+' : ''}${degradation}%`);
    console.log(`  Min: ${fmt(Math.min(...validDirect))}, Max: ${fmt(Math.max(...validDirect))}`);
  }

  console.log('');

  // ═══ Phase 2: Backend — 10 sequential chat calls ══════════════════════════
  console.log('═══ Phase 2: Backend — 10 sequential chat calls ════════════════\n');
  console.log('  Full pipeline: CRE → routing → tool/LLM → synthesis → quality.\n');

  const backendTimes = [];
  const queries = [
    'Ahoj, jak se máš?',                                    // conversational
    'Kolik je 5+3?',                                         // local math
    'Co je to WebAssembly?',                                 // search
    'Vysvětli let vs const v JavaScriptu',                   // conversational
    'Jaké jsou trendy v AI?',                                // search
    'Napiš haiku o programování',                            // creative
    'Jaká je sazba daně z příjmu v ČR?',                     // search (E1 equivalent)
    'Kolik je DPH z 10000 Kč při sazbě 21%?',               // local math (E2 equivalent)
    'Porovnej React a Vue.js',                               // search
    'Explain what a REST API is and give an example',         // conversational EN
  ];

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    try {
      const t0 = Date.now();
      const res = await chat(q);
      const elapsed = Date.now() - t0;
      backendTimes.push(elapsed);
      const mode = res.body?.mode || '?';
      const respLen = (res.body?.response || '').length;
      const meta = res.body?.metadata?.decision || {};
      const intent = meta.intent || '?';
      console.log(`  [${i + 1}/10] ${fmt(elapsed).padStart(7)} — ${intent.padEnd(15)} — "${q.substring(0, 45)}" (${respLen} chars)`);
    } catch (e) {
      backendTimes.push(-1);
      console.log(`  [${i + 1}/10]      ❌ — ${e.message} — "${q.substring(0, 45)}"`);
    }
  }

  const validBackend = backendTimes.filter(t => t > 0);
  if (validBackend.length > 1) {
    const first3 = validBackend.slice(0, 3);
    const last3 = validBackend.slice(-3);
    const avg1 = first3.reduce((a, b) => a + b, 0) / first3.length;
    const avg2 = last3.reduce((a, b) => a + b, 0) / last3.length;
    const degradation = ((avg2 / avg1 - 1) * 100).toFixed(0);
    console.log(`\n  First 3 avg: ${fmt(avg1)}, Last 3 avg: ${fmt(avg2)}`);
    console.log(`  Degradation: ${degradation > 0 ? '+' : ''}${degradation}%`);
    console.log(`  Min: ${fmt(Math.min(...validBackend))}, Max: ${fmt(Math.max(...validBackend))}`);

    const over60 = validBackend.filter(t => t > 60000).length;
    const over90 = validBackend.filter(t => t > 90000).length;
    console.log(`  Over 60s (gateway timeout): ${over60}/${validBackend.length}`);
    console.log(`  Over 90s (test timeout): ${over90}/${validBackend.length}`);
  }

  console.log('');

  // ═══ Phase 3: Gateway retry detection ═════════════════════════════════════
  console.log('═══ Phase 3: Retry detection ═══════════════════════════════════\n');

  // Check if any response took >60s — that means gateway hit its timeout
  // and potentially retried, adding 2s + another attempt
  const gatewayTimeouts = backendTimes.filter(t => t > 60000 && t > 0);
  if (gatewayTimeouts.length > 0) {
    console.log(`  ⚠️  ${gatewayTimeouts.length} calls exceeded 60s gateway CHAT timeout`);
    console.log(`     These likely triggered gateway retries:`);
    gatewayTimeouts.forEach((t, i) => {
      const retryEstimate = t > 62000 ? 'Yes (60s + 2s delay + 2nd attempt)' : 'Borderline';
      console.log(`     Call: ${fmt(t)} — Retry: ${retryEstimate}`);
    });
    console.log(`\n  🔴 DIAGNOSIS: Gateway retries are the amplification mechanism.`);
    console.log(`     When Ollama takes >60s, the gateway retries, doubling the time.`);
    console.log(`     60s first attempt + 2s delay + N seconds retry > 90s test timeout.`);
  } else {
    console.log(`  ✅ No calls exceeded 60s gateway timeout`);
    console.log(`     Gateway retries are NOT the issue.`);
  }

  console.log('');

  // ═══ Phase 4: Summary & Recommendations ═══════════════════════════════════
  console.log('═══ Phase 4: Summary ═══════════════════════════════════════════\n');

  // Determine root cause
  const directDegrade = validDirect.length > 4
    ? (validDirect.slice(-3).reduce((a, b) => a + b, 0) / 3) / (validDirect.slice(0, 3).reduce((a, b) => a + b, 0) / 3)
    : 1;

  const backendDegrade = validBackend.length > 4
    ? (validBackend.slice(-3).reduce((a, b) => a + b, 0) / 3) / (validBackend.slice(0, 3).reduce((a, b) => a + b, 0) / 3)
    : 1;

  console.log(`  Direct Ollama degradation ratio: ${directDegrade.toFixed(2)}x`);
  console.log(`  Backend pipeline degradation ratio: ${backendDegrade.toFixed(2)}x`);

  if (directDegrade > 1.5) {
    console.log(`\n  🔴 H1 CONFIRMED: Ollama itself degrades under sequential load`);
    console.log(`     Likely cause: GPU thermal throttling or KV cache pressure`);
  } else {
    console.log(`\n  ✅ H1 REJECTED: Ollama is stable under sequential load`);
  }

  if (backendDegrade > directDegrade * 1.3) {
    console.log(`  🔴 H4 LIKELY: Backend adds extra degradation beyond Ollama`);
    console.log(`     Possible: state accumulation, memory pressure, retry amplification`);
  } else {
    console.log(`  ✅ H4 REJECTED: Backend overhead is proportional to Ollama`);
  }

  const maxDirect = validDirect.length > 0 ? Math.max(...validDirect) : 0;
  const maxBackend = validBackend.length > 0 ? Math.max(...validBackend) : 0;
  const pipelineOverhead = maxBackend > 0 && maxDirect > 0 ? maxBackend / maxDirect : 0;
  console.log(`\n  Pipeline overhead: ${pipelineOverhead.toFixed(1)}x (backend/direct ratio)`);

  console.log('\n═══════════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
