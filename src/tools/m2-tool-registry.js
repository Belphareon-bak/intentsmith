import { createHash } from 'node:crypto';

import { isPlainRecord } from '../../contracts/m1/shared.js';
import { M2_TOOL_RISK_CLASS } from '../../contracts/m2/tool-v1.js';

function error(message) {
  return Object.freeze([message]);
}

function ok() {
  return Object.freeze([]);
}

function boundedString(value, maximum = 4096) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function validateExactInput(value, keys, context) {
  if (!isPlainRecord(value)) return error(`${context}:not-object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    return error(`${context}:invalid-keys`);
  }
  return ok();
}

function validateQueryInput(value, context) {
  const errors = [...validateExactInput(value, ['query'], context)];
  if (!boundedString(value?.query, 512)) errors.push(`${context}:invalid-query`);
  return Object.freeze(errors);
}

function validateScrapeInput(value) {
  const context = 'tool-input.web-scrape';
  const errors = [...validateExactInput(value, ['url', 'query', 'maxLength'], context)];
  if (!boundedString(value?.url, 8192)) errors.push(`${context}:invalid-url`);
  if (typeof value?.query !== 'string' || value.query.length > 512) {
    errors.push(`${context}:invalid-query`);
  }
  if (!Number.isSafeInteger(value?.maxLength) || value.maxLength < 1 || value.maxLength > 100_000) {
    errors.push(`${context}:invalid-maxLength`);
  }
  return Object.freeze(errors);
}

function validateFileInput(value, write) {
  const context = write ? 'tool-input.file-write' : 'tool-input.file-read';
  const keys = write ? ['path', 'content'] : ['path'];
  const errors = [...validateExactInput(value, keys, context)];
  if (!boundedString(value?.path, 4096)) errors.push(`${context}:invalid-path`);
  if (write && (typeof value?.content !== 'string' || value.content.length > 1_048_576)) {
    errors.push(`${context}:invalid-content`);
  }
  return Object.freeze(errors);
}

function validateCodeInput(value) {
  const context = 'tool-input.code-execute';
  const errors = [...validateExactInput(value, ['code', 'language'], context)];
  if (!boundedString(value?.code, 1_048_576)) errors.push(`${context}:invalid-code`);
  if (!(value?.language === null || boundedString(value.language, 64))) {
    errors.push(`${context}:invalid-language`);
  }
  return Object.freeze(errors);
}

function validateJsonObjectOutput(value, context) {
  return isPlainRecord(value) ? ok() : error(`${context}:not-object`);
}

function validateLocalOutput(value, subtype) {
  const context = `tool-output.local-${subtype}`;
  const keys = subtype === 'math'
    ? ['subtype', 'expression', 'result']
    : subtype === 'date'
      ? ['subtype', 'date', 'time', 'dayOfWeek', 'dayOfMonth', 'month', 'year', 'timestamp']
      : [
        'subtype', 'currentPhase', 'phaseEmoji', 'cycleDay',
        'daysUntilFullMoon', 'daysUntilNewMoon', 'illumination',
      ];
  const errors = [...validateExactInput(value, keys, context)];
  if (value?.subtype !== subtype) errors.push(`${context}:invalid-subtype`);
  if (subtype === 'math') {
    if (!boundedString(value?.expression, 512)) errors.push(`${context}:invalid-expression`);
    if (typeof value?.result !== 'number' || !Number.isFinite(value.result)) {
      errors.push(`${context}:invalid-result`);
    }
  } else if (subtype === 'date') {
    if (typeof value?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) {
      errors.push(`${context}:invalid-date`);
    }
    if (typeof value?.time !== 'string' || !/^\d{2}:\d{2}:\d{2}$/.test(value.time)) {
      errors.push(`${context}:invalid-time`);
    }
    for (const key of ['dayOfWeek', 'month']) {
      if (!boundedString(value?.[key], 32)) errors.push(`${context}:invalid-${key}`);
    }
    if (!Number.isSafeInteger(value?.dayOfMonth) || value.dayOfMonth < 1 || value.dayOfMonth > 31) {
      errors.push(`${context}:invalid-dayOfMonth`);
    }
    if (!Number.isSafeInteger(value?.year) || value.year < 1970 || value.year > 9999) {
      errors.push(`${context}:invalid-year`);
    }
    if (!Number.isSafeInteger(value?.timestamp) || value.timestamp < 0) {
      errors.push(`${context}:invalid-timestamp`);
    }
  } else {
    for (const key of ['currentPhase', 'phaseEmoji']) {
      if (!boundedString(value?.[key], 64)) errors.push(`${context}:invalid-${key}`);
    }
    for (const key of ['cycleDay', 'daysUntilFullMoon', 'daysUntilNewMoon', 'illumination']) {
      if (typeof value?.[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0) {
        errors.push(`${context}:invalid-${key}`);
      }
    }
    if (typeof value?.illumination === 'number' && value.illumination > 100) {
      errors.push(`${context}:illumination-out-of-range`);
    }
  }
  return Object.freeze(errors);
}

function descriptor({
  id,
  riskClass,
  requiredEffectKind,
  inputSchema,
  outputSchema,
  validateInput,
  validateOutput = value => validateJsonObjectOutput(value, `tool-output.${id}`),
  direct = false,
  validateEffectTranslation = null,
}) {
  return Object.freeze({
    id,
    version: 1,
    riskClass,
    requiredEffectKind,
    inputSchema,
    outputSchema,
    validateInput,
    validateOutput,
    direct,
    validateEffectTranslation,
  });
}

const EMPTY_PAYLOAD_DIGEST = `sha256:${createHash('sha256').update(Buffer.alloc(0)).digest('hex')}`;

function validateNetworkEffect(request, effectRequest, expectedUrl) {
  const expectedOrigin = new URL(expectedUrl).origin;
  return effectRequest.target?.type === 'network'
    && effectRequest.target.url === expectedUrl
    && effectRequest.target.origin === expectedOrigin
    && effectRequest.target.method === 'GET'
    && effectRequest.target.redirectPolicy === 'deny'
    && effectRequest.target.dnsPolicy === 'public-only'
    && effectRequest.payloadBytes === 0
    && effectRequest.payloadDigest === EMPTY_PAYLOAD_DIGEST
    && effectRequest.requiredCapability === 'network.http.get'
    && effectRequest.riskClass === 'network';
}

const DESCRIPTORS = Object.freeze([
  descriptor({
    id: 'web.search',
    riskClass: M2_TOOL_RISK_CLASS.NETWORK,
    requiredEffectKind: 'network.request',
    inputSchema: 'intentsmith.tool.web-search.input@1',
    outputSchema: 'intentsmith.tool.web-search.output@1',
    validateInput: value => validateQueryInput(value, 'tool-input.web-search'),
    validateEffectTranslation(request, effectRequest) {
      const expectedUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(request.input.query)}`;
      return validateNetworkEffect(request, effectRequest, expectedUrl);
    },
  }),
  descriptor({
    id: 'web.scrape',
    riskClass: M2_TOOL_RISK_CLASS.NETWORK,
    requiredEffectKind: 'network.request',
    inputSchema: 'intentsmith.tool.web-scrape.input@1',
    outputSchema: 'intentsmith.tool.web-scrape.output@1',
    validateInput: validateScrapeInput,
    validateEffectTranslation(request, effectRequest) {
      try {
        return validateNetworkEffect(request, effectRequest, new URL(request.input.url).href);
      } catch {
        return false;
      }
    },
  }),
  descriptor({
    id: 'file.read',
    riskClass: M2_TOOL_RISK_CLASS.READ,
    requiredEffectKind: 'fs.read',
    inputSchema: 'intentsmith.tool.file-read.input@1',
    outputSchema: 'intentsmith.tool.file-read.output@1',
    validateInput: value => validateFileInput(value, false),
  }),
  descriptor({
    id: 'file.write',
    riskClass: M2_TOOL_RISK_CLASS.WRITE,
    requiredEffectKind: 'fs.write',
    inputSchema: 'intentsmith.tool.file-write.input@1',
    outputSchema: 'intentsmith.tool.file-write.output@1',
    validateInput: value => validateFileInput(value, true),
    validateEffectTranslation(request, effectRequest) {
      const payload = Buffer.from(request.input.content, 'utf8');
      const digest = `sha256:${createHash('sha256').update(payload).digest('hex')}`;
      return effectRequest.target?.type === 'filesystem'
        && effectRequest.target.relativePath === request.input.path
        && effectRequest.payloadDigest === digest
        && effectRequest.payloadBytes === payload.length;
    },
  }),
  descriptor({
    id: 'code.execute',
    riskClass: M2_TOOL_RISK_CLASS.EXEC,
    requiredEffectKind: 'process.exec',
    inputSchema: 'intentsmith.tool.code-execute.input@1',
    outputSchema: 'intentsmith.tool.code-execute.output@1',
    validateInput: validateCodeInput,
  }),
  descriptor({
    id: 'local.date',
    riskClass: M2_TOOL_RISK_CLASS.PURE,
    requiredEffectKind: null,
    inputSchema: 'intentsmith.tool.local-date.input@1',
    outputSchema: 'intentsmith.tool.local-date.output@1',
    validateInput: value => validateQueryInput(value, 'tool-input.local-date'),
    validateOutput: value => validateLocalOutput(value, 'date'),
    direct: true,
  }),
  descriptor({
    id: 'local.calendar',
    riskClass: M2_TOOL_RISK_CLASS.PURE,
    requiredEffectKind: null,
    inputSchema: 'intentsmith.tool.local-calendar.input@1',
    outputSchema: 'intentsmith.tool.local-calendar.output@1',
    validateInput: value => validateQueryInput(value, 'tool-input.local-calendar'),
    validateOutput: value => validateLocalOutput(value, 'calendar'),
    direct: true,
  }),
  descriptor({
    id: 'local.math',
    riskClass: M2_TOOL_RISK_CLASS.PURE,
    requiredEffectKind: null,
    inputSchema: 'intentsmith.tool.local-math.input@1',
    outputSchema: 'intentsmith.tool.local-math.output@1',
    validateInput: value => validateQueryInput(value, 'tool-input.local-math'),
    validateOutput: value => validateLocalOutput(value, 'math'),
    direct: true,
  }),
]);

const DESCRIPTOR_MAP = new Map(DESCRIPTORS.map(value => [value.id, value]));

export function getM2ToolDescriptor(toolId) {
  return DESCRIPTOR_MAP.get(toolId) || null;
}

export function listM2ToolDescriptors() {
  return DESCRIPTORS;
}

export function projectLegacyToolInput(toolId, params = {}) {
  switch (toolId) {
    case 'web.search':
    case 'local.date':
    case 'local.calendar':
    case 'local.math':
      return { query: String(params.query ?? params.input ?? '') };
    case 'web.scrape':
      return {
        url: String(params.url ?? (Array.isArray(params.urls) ? params.urls[0] : '') ?? ''),
        query: String(params.query ?? params.input ?? ''),
        maxLength: Number.isSafeInteger(params.maxLength) ? params.maxLength : 10_000,
      };
    case 'file.read':
      return { path: String(params.path ?? params.filePath ?? '') };
    case 'file.write':
      return {
        path: String(params.path ?? params.filePath ?? ''),
        content: typeof params.content === 'string' ? params.content : '',
      };
    case 'code.execute':
      return {
        code: typeof params.code === 'string' ? params.code : '',
        language: typeof params.language === 'string' ? params.language : null,
      };
    default:
      return {};
  }
}

export default Object.freeze({
  get: getM2ToolDescriptor,
  list: listM2ToolDescriptors,
  projectLegacyInput: projectLegacyToolInput,
});
