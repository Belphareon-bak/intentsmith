// Release discovery only. Version metadata never authorizes provider install
// or proves the exact-artifact response contract needed for scoring.
import { ollamaReleaseFetch } from '../network/outbound-policy.js';
import { requireLoopbackModelProviderOrigin } from './model-provider-origin.js';

export const OLLAMA_LATEST_RELEASE_URL = 'https://api.github.com/repos/ollama/ollama/releases/latest';
const VERSION = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/;

function version(value) {
  const match = typeof value === 'string' && value.length <= 100 && VERSION.exec(value);
  if (!match) throw Object.assign(new Error('Invalid Ollama version'), { code: 'OLLAMA_VERSION_INVALID' });
  const parts = match.slice(1, 4).map(Number);
  if (!parts.every(Number.isSafeInteger)) throw Object.assign(new Error('Invalid Ollama version'), { code: 'OLLAMA_VERSION_INVALID' });
  return { value, parts, baseVersion: parts.join('.'), suffix: match[4] || '' };
}

async function readJson(response) {
  if (!response.ok) throw Object.assign(new Error('Metadata request failed'), { code: `HTTP_${response.status}` });
  if (!response.body) throw Object.assign(new Error('Empty metadata'), { code: 'METADATA_INVALID' });
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 256 * 1024) throw Object.assign(new Error('Oversized metadata'), { code: 'METADATA_TOO_LARGE' });
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function checkOllamaUpdate({
  enabled = false,
  baseUrl = 'http://127.0.0.1:11434',
  localFetch = globalThis.fetch,
  releaseFetch = ollamaReleaseFetch,
  clock = Date.now,
} = {}) {
  const result = {
    schemaVersion: 1,
    checkedAt: new Date(clock()).toISOString(),
    status: enabled === true ? 'CHECK_FAILED' : 'DISABLED',
    installed: null,
    latest: null,
    errors: [],
    compatibility: {
      status: 'UNVERIFIED',
      reasonCode: 'RESPONSE_DIGEST_REQUIRES_RUNTIME_QUALIFICATION',
    },
    automaticInstall: false,
  };
  if (enabled !== true) return result;
  let provider;
  try {
    provider = requireLoopbackModelProviderOrigin(baseUrl);
  } catch (error) {
    result.errors.push({ source: 'installed', code: error.code });
    return result;
  }
  let installed;
  let latest;
  // Either endpoint may be offline. Preserve the other observation, but never
  // label a failed or partial check as up-to-date.
  try {
    const data = await readJson(await localFetch(provider.endpoint('/api/version'), {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000),
    }));
    installed = version(data.version);
    result.installed = { version: installed.value, baseVersion: installed.baseVersion, origin: provider.origin };
  } catch (error) {
    result.errors.push({ source: 'installed', code: error.code || 'METADATA_UNAVAILABLE' });
  }
  try {
    const data = await readJson(await releaseFetch(OLLAMA_LATEST_RELEASE_URL, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'intentsmith/1.0' },
    }));
    latest = version(data.tag_name);
    if (latest.suffix || data.draft !== false || data.prerelease !== false
      || data.html_url !== `https://github.com/ollama/ollama/releases/tag/${data.tag_name}`
      || typeof data.published_at !== 'string' || !Number.isFinite(Date.parse(data.published_at))) {
      throw Object.assign(new Error('Invalid stable release'), { code: 'RELEASE_METADATA_INVALID' });
    }
    result.latest = { version: latest.baseVersion, tag: data.tag_name, publishedAt: data.published_at, url: data.html_url };
  } catch (error) {
    result.errors.push({ source: 'upstream', code: error.code || 'METADATA_UNAVAILABLE' });
  }
  if (result.errors.length) return result;
  const difference = latest.parts.map((part, index) => part - installed.parts[index]).find(part => part !== 0) || 0;
  const prerelease = installed.suffix && !/^-intentsmith\.\d+$/.test(installed.suffix);
  result.status = difference > 0 || (difference === 0 && prerelease) ? 'UPDATE_AVAILABLE'
    : difference < 0 ? 'AHEAD_OF_UPSTREAM' : 'UP_TO_DATE';
  return result;
}
