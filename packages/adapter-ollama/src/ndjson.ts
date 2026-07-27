import { ProviderError } from '@intentsmith/inference';

/**
 * Bounded NDJSON reader.
 *
 * Ollama streams one JSON object per line. Chunk boundaries are arbitrary: a
 * single record can be split across several network reads, and several records
 * can arrive in one read. Both cases are handled here so the adapter never
 * sees a partial record.
 *
 * Every limit exists because the daemon is untrusted input: a local process
 * that is compromised, buggy, or simply not Ollama must not be able to exhaust
 * memory by never sending a newline.
 */

export type NdjsonLimits = {
  /** Maximum bytes for one record, including the newline. */
  maxRecordBytes: number;
  /** Maximum bytes for the whole stream. */
  maxTotalBytes: number;
  /** Maximum number of records. */
  maxRecords: number;
};

export const DEFAULT_NDJSON_LIMITS: NdjsonLimits = {
  maxRecordBytes: 1_048_576,
  maxTotalBytes: 33_554_432,
  maxRecords: 100_000,
};

/**
 * Decodes a byte stream into parsed NDJSON records.
 *
 * Yields each record as an unknown value; schema validation is the caller's
 * job. Throws `STREAM_INVALID` on malformed JSON or any breached limit.
 */
export async function* readNdjson(
  source: AsyncIterable<Uint8Array>,
  limits: NdjsonLimits = DEFAULT_NDJSON_LIMITS,
): AsyncGenerator<unknown> {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let totalBytes = 0;
  let records = 0;

  const parse = (line: string): unknown => {
    try {
      return JSON.parse(line);
    } catch {
      throw new ProviderError('STREAM_INVALID', 'Provider emitted a line that is not valid JSON.');
    }
  };

  for await (const chunk of source) {
    totalBytes += chunk.byteLength;
    if (totalBytes > limits.maxTotalBytes) {
      throw new ProviderError('STREAM_INVALID', 'Provider stream exceeded the maximum total size.');
    }
    buffer += decoder.decode(chunk, { stream: true });

    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) {
        if (line.length > limits.maxRecordBytes) {
          throw new ProviderError('STREAM_INVALID', 'Provider emitted a record larger than the maximum record size.');
        }
        records += 1;
        if (records > limits.maxRecords) {
          throw new ProviderError('STREAM_INVALID', 'Provider emitted more records than the maximum allowed.');
        }
        yield parse(line);
      }
      newline = buffer.indexOf('\n');
    }

    // An unterminated record must not be allowed to grow without bound.
    if (buffer.length > limits.maxRecordBytes) {
      throw new ProviderError('STREAM_INVALID', 'Provider emitted a record larger than the maximum record size.');
    }
  }

  buffer += decoder.decode();
  const trailing = buffer.trim();
  if (trailing.length > 0) {
    if (trailing.length > limits.maxRecordBytes) {
      throw new ProviderError('STREAM_INVALID', 'Provider emitted a record larger than the maximum record size.');
    }
    records += 1;
    if (records > limits.maxRecords) {
      throw new ProviderError('STREAM_INVALID', 'Provider emitted more records than the maximum allowed.');
    }
    yield parse(trailing);
  }
}
