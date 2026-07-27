import { describe, expect, it } from 'vitest';

import { ALLOWED_REQUEST_HEADERS, assertLocalEndpoint, buildRequestHeaders } from './endpoint-policy.js';
import { REMOTE_MARKER_FIELDS, assertNotRemote, assessRemoteMarkers } from './remote-policy.js';
import { PROVIDER_ERROR_CODES, ProviderError, isProviderErrorCode, normalizeProviderError } from './provider.js';

/** Endpoint and remote-execution policy unit tests. */

describe('endpoint normalization', () => {
  it('defaults a missing port to 80', () => {
    expect(assertLocalEndpoint('http://127.0.0.1').port).toBe(80);
  });

  it('normalizes localhost to an explicit loopback literal', () => {
    const result = assertLocalEndpoint('http://LOCALHOST:11434');
    expect(result.hostname).toBe('127.0.0.1');
    expect(result.origin).toBe('http://127.0.0.1:11434');
  });

  it('accepts the whole 127.0.0.0/8 block but rejects invalid octets', () => {
    expect(assertLocalEndpoint('http://127.255.255.254:1').hostname).toBe('127.255.255.254');
    expect(() => assertLocalEndpoint('http://127.0.0.999:1')).toThrowError(
      expect.objectContaining({ code: 'REQUEST_INVALID' }),
    );
  });

  it('rejects a non-string or blank endpoint', () => {
    for (const bad of ['', '   ', undefined as unknown as string, 42 as unknown as string]) {
      expect(() => assertLocalEndpoint(bad)).toThrowError(expect.objectContaining({ code: 'REQUEST_INVALID' }));
    }
  });

  it('rejects a fragment and a non-root path separately', () => {
    expect(() => assertLocalEndpoint('http://127.0.0.1:11434#frag')).toThrowError(
      expect.objectContaining({ code: 'REQUEST_INVALID' }),
    );
    expect(() => assertLocalEndpoint('http://127.0.0.1:11434/api')).toThrowError(
      expect.objectContaining({ code: 'REQUEST_INVALID' }),
    );
  });

  it('rejects a username without a password and vice versa', () => {
    expect(() => assertLocalEndpoint('http://user@127.0.0.1:11434')).toThrowError(
      expect.objectContaining({ code: 'REQUEST_INVALID' }),
    );
  });
});

describe('request headers', () => {
  it('always sends content-type and nothing else by default', () => {
    expect(buildRequestHeaders()).toEqual({ 'content-type': 'application/json' });
  });

  it('permits only the allowlist', () => {
    expect(buildRequestHeaders({ accept: 'application/json' })).toMatchObject({ accept: 'application/json' });
    expect(ALLOWED_REQUEST_HEADERS).toEqual(['content-type', 'accept']);
  });

  it('throws rather than silently dropping a credential header', () => {
    for (const name of ['authorization', 'Authorization', 'cookie', 'x-api-key', 'ollama-api-key']) {
      expect(() => buildRequestHeaders({ [name]: 'secret' })).toThrowError(
        expect.objectContaining({ code: 'REQUEST_INVALID' }),
      );
    }
  });

  it('rejects any header outside the allowlist', () => {
    expect(() => buildRequestHeaders({ 'x-custom': '1' })).toThrowError(
      expect.objectContaining({ code: 'REQUEST_INVALID' }),
    );
  });
});

describe('remote marker detection', () => {
  it('treats a payload with no markers as local', () => {
    expect(assessRemoteMarkers({ name: 'qwen3:14b' }).execution).toBe('local');
  });

  it.each(REMOTE_MARKER_FIELDS)('flags a non-empty %s', field => {
    const assessment = assessRemoteMarkers({ [field]: 'something' }, 'm');
    expect(assessment.execution).toBe('remote_forbidden');
    expect(assessment.markers).toContain(field);
  });

  it('ignores an empty or whitespace marker', () => {
    expect(assessRemoteMarkers({ remote_model: '' }).execution).toBe('local');
    expect(assessRemoteMarkers({ remote_host: '   ' }).execution).toBe('local');
    expect(assessRemoteMarkers({ remote_model: null }).execution).toBe('local');
  });

  it('finds a marker nested inside an object or array', () => {
    expect(assessRemoteMarkers({ details: { remote_host: 'https://example' } }).execution).toBe('remote_forbidden');
    expect(assessRemoteMarkers({ models: [{ remote_model: 'x' }] }).execution).toBe('remote_forbidden');
  });

  it('does not recurse without bound', () => {
    // Deeply nested beyond the search depth; must not hang or throw.
    let deep: Record<string, unknown> = { remote_model: 'x' };
    for (let level = 0; level < 40; level += 1) deep = { nested: deep };
    expect(() => assessRemoteMarkers(deep)).not.toThrow();
  });

  it('records a cloud-looking name as a warning only', () => {
    const assessment = assessRemoteMarkers({ name: 'gpt-oss:120b-cloud' }, 'gpt-oss:120b-cloud');
    // Advisory: the name alone must never block.
    expect(assessment.execution).toBe('local');
    expect(assessment.warnings.join(' ')).toContain('advisory only');
  });

  it('throws REMOTE_INFERENCE_FORBIDDEN from assertNotRemote', () => {
    expect(() => assertNotRemote({ remote_host: 'https://ollama.com' }, 'm', 'preflight')).toThrowError(
      expect.objectContaining({ code: 'REMOTE_INFERENCE_FORBIDDEN' }),
    );
    expect(assertNotRemote({}, 'm', 'preflight').execution).toBe('local');
  });

  it('treats non-string marker values by emptiness, not truthiness', () => {
    // Arrays and objects count as present only when non-empty.
    expect(assessRemoteMarkers({ remote_model: ['a'] }).execution).toBe('remote_forbidden');
    expect(assessRemoteMarkers({ remote_model: [] }).execution).toBe('local');
    expect(assessRemoteMarkers({ remote_host: { url: 'x' } }).execution).toBe('remote_forbidden');
    expect(assessRemoteMarkers({ remote_host: {} }).execution).toBe('local');
    expect(assessRemoteMarkers({ remote_model: true }).execution).toBe('remote_forbidden');
    expect(assessRemoteMarkers({ remote_model: false }).execution).toBe('local');
    expect(assessRemoteMarkers({ remote_model: 0 }).execution).toBe('local');
  });

  it('reports both a marker and a name warning together', () => {
    const assessment = assessRemoteMarkers({ remote_host: 'https://x' }, 'thing-cloud');
    expect(assessment.execution).toBe('remote_forbidden');
    expect(assessment.warnings.length).toBeGreaterThan(0);
  });

  it('handles non-object payloads safely', () => {
    for (const payload of [null, undefined, 'string', 42, []]) {
      expect(assessRemoteMarkers(payload).execution).toBe('local');
    }
  });
});

describe('provider error vocabulary', () => {
  it('includes REMOTE_INFERENCE_FORBIDDEN and excludes MODEL_TOO_LARGE', () => {
    expect(PROVIDER_ERROR_CODES).toContain('REMOTE_INFERENCE_FORBIDDEN');
    expect(isProviderErrorCode('REMOTE_INFERENCE_FORBIDDEN')).toBe(true);
    // Model fit is a hardware policy concern, not a transport error.
    expect(PROVIDER_ERROR_CODES).not.toContain('MODEL_TOO_LARGE' as never);
  });

  it('preserves a ProviderError and its retryable flag', () => {
    const normalized = normalizeProviderError(new ProviderError('PROVIDER_UNAVAILABLE', 'down', true));
    expect(normalized).toEqual({ code: 'PROVIDER_UNAVAILABLE', message: 'down', retryable: true });
  });
});
