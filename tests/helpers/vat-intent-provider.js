import http from 'node:http';

// Expected semantic plans are supplied by each test, independently of the
// product lexer/validator. This provider verifies plumbing, not model quality.
export function vatPlan(input, options = {}) {
  return { contract: 'VatIntent', version: 1, action: 'calculate',
    amount: 10000, rate: '21', year: 2025, direction: 'add',
    presentation: { style: 'table', itemCount: null }, segments: [{ text: input, kind: 'calculation' }],
    clarification: null, ...options };
}

export async function startVatIntentProvider(model, plans = new Map()) {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const entry = { method: request.method, path: request.url, body, task: null };
    requests.push(entry);
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/tags') {
      response.end(JSON.stringify({ models: [{ name: model, digest: 'a'.repeat(64) }] }));
      return;
    }
    if (request.url === '/api/show') {
      response.end(JSON.stringify({ model_info: { 'fixture.context_length': 8192 } }));
      return;
    }
    if (request.url !== '/api/chat') {
      response.writeHead(503).end(JSON.stringify({ error: 'Unexpected fixture endpoint' }));
      return;
    }
    for (const message of body.messages || []) {
      try {
        const data = JSON.parse(message.content);
        if (data.task === 'specialist.input.interpretation') { entry.task = data; break; }
      } catch { /* Other CRE prompts are not the VAT interpretation packet. */ }
    }
    const selected = entry.task ? plans.get(entry.task.currentInput) : null;
    if (entry.task && selected === undefined) {
      response.writeHead(503).end(JSON.stringify({ error: 'Missing explicit fixture plan' }));
      return;
    }
    if (selected?.fixtureHttpError === true) {
      response.writeHead(503).end(JSON.stringify({ error: 'Owned inference failure' }));
      return;
    }
    const content = entry.task
      ? selected?.fixtureReplyContent ?? (typeof selected === 'string' ? selected : JSON.stringify(selected))
      : JSON.stringify({ intent: 'CONVERSATIONAL', confidence: 0.99, fileTarget: null });
    response.end(JSON.stringify({ model, digest: 'a'.repeat(64), message: { role: 'assistant', content },
      done: true, done_reason: selected?.fixtureFinishReason || 'stop', prompt_eval_count: 100, eval_count: 80 }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  return { plans, requests, url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
