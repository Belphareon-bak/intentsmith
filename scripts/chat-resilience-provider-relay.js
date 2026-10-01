// Private provider capture for the isolated chat runner. Every request and
// response chunk is fsynced before it can be forwarded to the child.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

export function createChatResilienceProviderRelay({ out, upstream, model, wire, persistWire }) {
  const journal = fs.openSync(path.join(out, 'initial-provider-raw.jsonl'), 'wx', 0o600);
  const active = new Set();
  let sequence = 0;
  let journalClosed = false;
  const append = event => {
    const bytes = Buffer.from(`${JSON.stringify(event)}\n`);
    for (let offset = 0; offset < bytes.length;) {
      const written = fs.writeSync(journal, bytes, offset, bytes.length - offset);
      if (written <= 0) throw new Error('PROVIDER_RAW_JOURNAL_WRITE_FAILED');
      offset += written;
    }
    fs.fsyncSync(journal);
  };
  const proxy = http.createServer(async (request, response) => {
    const row = { requestId: ++sequence, at: new Date().toISOString(),
      caseId: request.headers['x-chat-measurement-case'] || 'boot',
      path: request.url, method: request.method, captureComplete: false };
    const state = { request, response, upstream: null, providerResponse: null,
      upstreamEnded: false, responseBytes: 0, ended: false };
    wire.push(row);
    active.add(state);
    append({ requestId: row.requestId, event: 'request_start', at: row.at,
      path: row.path, method: row.method, caseId: row.caseId });
    persistWire(wire);
    const finishError = (reason, status = 502) => {
      if (state.ended) return;
      state.ended = true;
      row.error = reason;
      row.elapsedMs = Date.now() - Date.parse(row.at);
      append({ requestId: row.requestId, event: 'incomplete', at: new Date().toISOString(), reason });
      persistWire(wire);
      active.delete(state);
      state.providerResponse?.destroy();
      state.upstream?.destroy();
      if (!response.destroyed) {
        if (!response.headersSent) response.writeHead(status);
        response.end(reason);
      }
    };
    state.finishError = finishError;
    response.on('error', error => finishError(`CHILD_RESPONSE_ERROR: ${error.message}`));
    response.on('close', () => {
      if (response.writableFinished || state.ended) return;
      finishError('CHILD_RESPONSE_CLOSED');
    });
    response.on('finish', () => {
      if (state.ended) return;
      if (!state.upstreamEnded) { finishError('CHILD_RESPONSE_FINISHED_EARLY'); return; }
      state.ended = true;
      row.captureComplete = true;
      append({ requestId: row.requestId, event: 'response_end', bytes: state.responseBytes });
      persistWire(wire);
      active.delete(state);
    });
    request.on('aborted', () => finishError('CHILD_REQUEST_ABORTED'));
    request.on('error', error => finishError(`CHILD_REQUEST_ERROR: ${error.message}`));
    try {
      const chunks = [];
      for await (const chunk of request) {
        if (state.ended) return;
        append({ requestId: row.requestId, event: 'request_chunk', base64: chunk.toString('base64') });
        chunks.push(chunk);
      }
      if (state.ended) return;
      const bytes = Buffer.concat(chunks);
      let body = null;
      try { body = bytes.length ? JSON.parse(bytes) : null; }
      catch (error) { finishError(`INVALID_PROVIDER_REQUEST_JSON: ${error.message}`, 403); return; }
      row.body = body;
      append({ requestId: row.requestId, event: 'request_end', bytes: bytes.length });
      persistWire(wire);
      const allowed = (request.method === 'GET' && ['/api/tags', '/api/ps', '/api/version'].includes(request.url))
        || (request.method === 'POST' && ['/api/chat', '/api/generate', '/api/show'].includes(request.url)
          && (body?.model || body?.name) === model
          && !(request.url === '/api/generate' && body?.keep_alive === 0));
      if (!allowed) { finishError('OUT_OF_SCOPE provider request', 403); return; }
      state.upstream = http.request({ ...upstream, path: request.url, method: request.method,
        headers: { 'Content-Type': 'application/json', 'Content-Length': bytes.length } }, providerResponse => {
        if (state.ended) { providerResponse.destroy(); return; }
        state.providerResponse = providerResponse;
        row.status = providerResponse.statusCode;
        append({ requestId: row.requestId, event: 'response_start', status: row.status,
          headers: providerResponse.headers });
        persistWire(wire);
        response.writeHead(providerResponse.statusCode, providerResponse.headers);
        const returned = [];
        providerResponse.on('data', chunk => {
          if (state.ended) return;
          append({ requestId: row.requestId, event: 'response_chunk', base64: chunk.toString('base64') });
          returned.push(chunk);
          response.write(chunk);
        });
        providerResponse.on('end', () => {
          if (state.ended) return;
          const raw = Buffer.concat(returned).toString();
          try { row.response = JSON.parse(raw); }
          catch { row.responseLines = raw.trim().split('\n').map(line => {
            try { return JSON.parse(line); } catch { return { invalid: line }; }
          }); }
          row.elapsedMs = Date.now() - Date.parse(row.at);
          state.responseBytes = Buffer.byteLength(raw);
          state.upstreamEnded = true;
          try { response.end(); }
          catch (error) { finishError(`CHILD_RESPONSE_END_ERROR: ${error.message}`); }
        });
        providerResponse.on('aborted', () => finishError('UPSTREAM_RESPONSE_ABORTED'));
        providerResponse.on('error', error => finishError(`UPSTREAM_RESPONSE_ERROR: ${error.message}`));
        providerResponse.on('close', () => {
          if (!providerResponse.complete) finishError('UPSTREAM_RESPONSE_CLOSED');
        });
      });
      state.upstream.on('error', error => finishError(`UPSTREAM_REQUEST_ERROR: ${error.message}`));
      state.upstream.end(bytes);
    } catch (error) { finishError(`PROVIDER_RELAY_ERROR: ${error.message}`); }
  });
  proxy.sealPending = reason => {
    for (const state of [...active]) {
      state.finishError(reason);
      state.request.destroy();
    }
  };
  proxy.closeJournal = () => {
    if (journalClosed) return;
    journalClosed = true;
    fs.closeSync(journal);
  };
  return proxy;
}
