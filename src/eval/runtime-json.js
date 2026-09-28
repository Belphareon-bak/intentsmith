// The operator requires evaluation to consume exactly what production consumes.
// No extraction/repair fallback belongs here: client.js owns that sequence.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extractJSON } from '../llm/client.js';

export const RUNTIME_JSON_CONTRACT = Object.freeze({
  version: 'runtime-json.1',
  implementation: 'src/llm/client.js#extractJSON',
  sourceSha256: createHash('sha256').update(readFileSync(new URL('../llm/client.js', import.meta.url))).digest('hex'),
});

export function readRuntimeJson(response) {
  const value = extractJSON(response);
  let strictJson = false;
  try { JSON.parse(response); strictJson = typeof response === 'string'; } catch { /* diagnostic only */ }
  return {
    value,
    runtimeParsed: value !== null,
    strictJson,
    responseFormat: strictJson ? 'JSON' : value !== null ? 'RUNTIME_RECOVERED_JSON' : 'UNPARSEABLE',
  };
}
