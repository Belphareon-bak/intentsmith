const FORBIDDEN_EXACT_KEYS = new Set([
  'access_token',
  'accessToken',
  'api_key',
  'apiKey',
  'discordWebhook',
  'licenseKey',
  'ntfyToken',
  'password',
  'passwd',
  'private_key',
  'privateKey',
  'slackWebhook',
  'smtpPass',
  'smsApiKey',
  'smsSecret',
  'telegramToken',
  'webhookSecret',
  'webhookUrl',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keyIsForbidden(key) {
  if (FORBIDDEN_EXACT_KEYS.has(key)) return true;
  const leaf = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : key;
  return FORBIDDEN_EXACT_KEYS.has(leaf)
    || /(?:secret|password|passwd|token|api[_-]?key|private[_-]?key|license[_-]?key)$/i.test(leaf);
}

function visit(value, path, findings, scrub) {
  if (Array.isArray(value)) return value.map((item, index) => (
    visit(item, `${path}[${index}]`, findings, scrub)
  ));
  if (!isRecord(value)) return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (keyIsForbidden(key)) {
      findings.push(childPath);
      if (scrub) continue;
    }
    result[key] = visit(child, childPath, findings, scrub);
  }
  return result;
}

export function inspectM5UserSettingsPrivacy(settings) {
  if (!isRecord(settings)) {
    return Object.freeze({ valid: false, forbiddenPaths: Object.freeze([]) });
  }
  const findings = [];
  visit(settings, '', findings, false);
  return Object.freeze({
    valid: findings.length === 0,
    forbiddenPaths: Object.freeze(findings.sort()),
  });
}

export function scrubM5UserSettingsPrivacy(settings) {
  if (!isRecord(settings)) throw new TypeError('m5-privacy-settings:record-required');
  const findings = [];
  const scrubbed = visit(settings, '', findings, true);
  return Object.freeze({
    settings: scrubbed,
    removedCount: findings.length,
    removedPaths: Object.freeze(findings.sort()),
  });
}

export function parseAndScrubM5UserSettingsPrivacy(raw) {
  if (typeof raw !== 'string') throw new TypeError('m5-privacy-settings:json-required');
  return scrubM5UserSettingsPrivacy(JSON.parse(raw));
}

export const M5_USER_SETTINGS_FORBIDDEN_KEYS = Object.freeze(
  [...FORBIDDEN_EXACT_KEYS].sort(),
);
