import { describe, expect, it } from 'vitest';

import {
  extractContextLength,
  nsToMs,
  parseGenerateRecord,
  parseParameterBillions,
  parsePs,
  parseShow,
  parseTags,
  parseVersion,
  sanitize,
} from './dto.js';
import { DEFAULT_NDJSON_LIMITS, readNdjson } from './ndjson.js';

/** DTO and NDJSON unit tests, including the bounds that protect against a hostile daemon. */

const encoder = new TextEncoder();

async function* bytes(...chunks: string[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield encoder.encode(chunk);
}

async function drain(source: AsyncIterable<Uint8Array>, limits = DEFAULT_NDJSON_LIMITS): Promise<unknown[]> {
  const records: unknown[] = [];
  for await (const record of readNdjson(source, limits)) records.push(record);
  return records;
}

describe('ndjson reader', () => {
  it('parses records separated by newlines', async () => {
    expect(await drain(bytes('{"a":1}\n{"a":2}\n'))).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('parses a trailing record with no final newline', async () => {
    expect(await drain(bytes('{"a":1}\n{"a":2}'))).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('ignores blank lines', async () => {
    expect(await drain(bytes('\n\n{"a":1}\n\n'))).toEqual([{ a: 1 }]);
  });

  it('reassembles a record split across chunks, including mid-multibyte', async () => {
    // The euro sign is three bytes; split it to prove the decoder streams.
    const encoded = encoder.encode('{"t":"€"}\n');
    const first = encoded.slice(0, 6);
    const second = encoded.slice(6);
    const records: unknown[] = [];
    for await (const record of readNdjson(
      (async function* () {
        yield first;
        yield second;
      })(),
    )) {
      records.push(record);
    }
    expect(records).toEqual([{ t: '€' }]);
  });

  it('rejects invalid JSON on a line', async () => {
    await expect(drain(bytes('{"a":1}\n{oops}\n'))).rejects.toMatchObject({ code: 'STREAM_INVALID' });
  });

  it('rejects an invalid trailing record', async () => {
    await expect(drain(bytes('{oops}'))).rejects.toMatchObject({ code: 'STREAM_INVALID' });
  });

  it('rejects a record over the record cap', async () => {
    const limits = { maxRecordBytes: 32, maxTotalBytes: 10_000, maxRecords: 100 };
    await expect(drain(bytes(`{"a":"${'x'.repeat(200)}"}\n`), limits)).rejects.toMatchObject({
      code: 'STREAM_INVALID',
    });
  });

  it('rejects an unterminated record that keeps growing', async () => {
    const limits = { maxRecordBytes: 32, maxTotalBytes: 10_000, maxRecords: 100 };
    // No newline ever arrives; the buffer must be capped rather than grow.
    await expect(drain(bytes('x'.repeat(20), 'x'.repeat(20)), limits)).rejects.toMatchObject({
      code: 'STREAM_INVALID',
    });
  });

  it('rejects a stream over the total-size cap', async () => {
    const limits = { maxRecordBytes: 1000, maxTotalBytes: 20, maxRecords: 100 };
    await expect(drain(bytes('{"a":1}\n', '{"a":2}\n', '{"a":3}\n'), limits)).rejects.toMatchObject({
      code: 'STREAM_INVALID',
    });
  });

  it('rejects a stream over the record-count cap', async () => {
    const limits = { maxRecordBytes: 1000, maxTotalBytes: 10_000, maxRecords: 2 };
    await expect(drain(bytes('{"a":1}\n{"a":2}\n{"a":3}\n'), limits)).rejects.toMatchObject({
      code: 'STREAM_INVALID',
    });
  });

  it('rejects a trailing record that exceeds the count cap', async () => {
    const limits = { maxRecordBytes: 1000, maxTotalBytes: 10_000, maxRecords: 1 };
    await expect(drain(bytes('{"a":1}\n{"a":2}'), limits)).rejects.toMatchObject({ code: 'STREAM_INVALID' });
  });
});

describe('dto parsing', () => {
  it('parses a version payload and rejects bad shapes', () => {
    expect(parseVersion({ version: '0.17.7' })).toBe('0.17.7');
    for (const bad of [null, 'string', [], {}, { version: '' }, { version: 5 }]) {
      expect(() => parseVersion(bad)).toThrowError(expect.objectContaining({ code: 'PROVIDER_PROTOCOL_ERROR' }));
    }
  });

  it('parses parameter size labels without guessing', () => {
    expect(parseParameterBillions('8B')).toBe(8);
    expect(parseParameterBillions('14.8B')).toBe(14.8);
    expect(parseParameterBillions('500M')).toBe(0.5);
    // Unknown stays unknown; it must never become 0.
    expect(parseParameterBillions(undefined)).toBeUndefined();
    expect(parseParameterBillions('')).toBeUndefined();
    expect(parseParameterBillions('huge')).toBeUndefined();
    expect(parseParameterBillions('8')).toBeUndefined();
  });

  it('extracts a family-prefixed context length', () => {
    expect(extractContextLength({ 'qwen3.context_length': 40_960 })).toBe(40_960);
    expect(extractContextLength({ 'llama.context_length': 8192, other: 1 })).toBe(8192);
    expect(extractContextLength({ 'qwen3.block_count': 40 })).toBeUndefined();
    expect(extractContextLength(undefined)).toBeUndefined();
    expect(extractContextLength({ 'x.context_length': 'nope' })).toBeUndefined();
  });

  it('tolerates a missing models array but rejects a wrong type', () => {
    expect(parseTags({ models: null })).toEqual([]);
    expect(parseTags({})).toEqual([]);
    expect(() => parseTags({ models: 42 })).toThrowError(
      expect.objectContaining({ code: 'PROVIDER_PROTOCOL_ERROR' }),
    );
    expect(() => parseTags(null)).toThrowError(expect.objectContaining({ code: 'PROVIDER_PROTOCOL_ERROR' }));
    expect(() => parseTags({ models: [{ noName: true }] })).toThrowError(
      expect.objectContaining({ code: 'PROVIDER_PROTOCOL_ERROR' }),
    );
  });

  it('falls back to the model field when name is absent', () => {
    const [entry] = parseTags({ models: [{ model: 'only-model-field:1b' }] });
    expect(entry?.descriptor.id).toBe('only-model-field:1b');
    expect(entry?.descriptor.family).toBe('unknown');
    expect(entry?.descriptor.parameterBillions).toBeUndefined();
  });

  it('parses show with missing optional sections', () => {
    const result = parseShow({});
    expect(result.capabilities).toEqual([]);
    expect(result.contextTokens).toBeUndefined();
    expect(result.family).toBeUndefined();
    expect(() => parseShow(null)).toThrowError(expect.objectContaining({ code: 'PROVIDER_PROTOCOL_ERROR' }));
  });

  it('drops non-string capability entries', () => {
    expect(parseShow({ capabilities: ['completion', 5, null] }).capabilities).toEqual(['completion']);
  });

  it('parses generate records and rejects malformed ones', () => {
    const record = parseGenerateRecord({ model: 'm', response: 'hi', done: false });
    expect(record).toMatchObject({ model: 'm', response: 'hi', done: false });

    for (const bad of [null, {}, { model: 'm' }, { done: true }, { model: 'm', done: 'yes' }]) {
      expect(() => parseGenerateRecord(bad)).toThrowError(
        expect.objectContaining({ code: 'PROVIDER_PROTOCOL_ERROR' }),
      );
    }
  });

  it('treats an inline error record as a protocol error', () => {
    expect(() => parseGenerateRecord({ error: 'model not loaded' })).toThrowError(
      expect.objectContaining({ code: 'PROVIDER_PROTOCOL_ERROR' }),
    );
  });

  it('defaults a missing response to empty rather than failing', () => {
    expect(parseGenerateRecord({ model: 'm', done: true }).response).toBe('');
  });

  it('parses ps and skips unusable entries', () => {
    expect(parsePs({ models: null })).toEqual([]);
    expect(parsePs({})).toEqual([]);
    expect(parsePs({ models: [{ name: 'a' }, { nope: 1 }, 'string'] })).toEqual([{ model: 'a' }]);
    expect(() => parsePs({ models: 3 })).toThrowError(expect.objectContaining({ code: 'PROVIDER_PROTOCOL_ERROR' }));
  });

  it('converts nanoseconds to milliseconds only for display', () => {
    expect(nsToMs(1_500_000_000)).toBe(1500);
    expect(nsToMs(undefined)).toBeUndefined();
  });

  it('sanitizes stack frames, paths and length', () => {
    expect(sanitize('boom at /home/x/y.ts:12:5')).not.toContain('at /home');
    expect(sanitize('failed reading /var/lib/ollama/blobs/sha256-abc')).toContain('<path>');
    expect(sanitize('x'.repeat(500))).toHaveLength(303);
    expect(sanitize('  spaced   out  ')).toBe('spaced out');
  });
});
