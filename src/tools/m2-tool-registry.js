import { createM2FileListPolicyPayload, M2_FILE_LIST_TARGET_TYPE } from '../../contracts/m2/file-list-snapshot-v1.js';
import { isM2FileListOutputRequest, validateM2FileListOutputEvidence } from '../../contracts/m2/file-list-output-v1.js';
import { createHash } from 'node:crypto';
import { createM2FileReadPolicyPayload, m2FileReadBytesDigest, validateM2FileReadOutputEvidence } from '../../contracts/m2/file-read-output-v1.js';

import { isPlainRecord } from '../../contracts/m1/shared.js';
import { isM2ProjectRelativePath } from '../../contracts/m2/effect-v1.js';
import {
  M2_TOOL_AUTHORITY_MODE,
  M2_TOOL_ERROR_CODE,
  M2_TOOL_RISK_CLASS,
  M2_TOOL_TERMINAL_STATUS,
  computeM2ToolValueDigest,
} from '../../contracts/m2/tool-v1.js';

function error(message) {
  return Object.freeze([message]);
}

function ok() {
  return Object.freeze([]);
}

export function expectedM2EffectOperationKey(toolRequest) {
  if (typeof toolRequest?.requestId !== 'string') return null;
  return `operation:${createHash('sha256').update(toolRequest.requestId, 'utf8').digest('hex')}`;
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
  if (!isM2ProjectRelativePath(value?.path)) errors.push(`${context}:invalid-path`);
  if (write && (typeof value?.content !== 'string' || value.content.length > 1_048_576)) {
    errors.push(`${context}:invalid-content`);
  }
  return Object.freeze(errors);
}

function validateFileListInput(value) {
  const context = 'tool-input.file-list';
  const errors = [...validateExactInput(value, ['path'], context)];
  if (value?.path !== '.') errors.push(`${context}:invalid-path`);
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

function validateDatabaseInput(value) {
  const context = 'tool-input.database-query';
  const errors = [...validateExactInput(value, ['query', 'database'], context)];
  if (!boundedString(value?.query, 1_048_576)) errors.push(`${context}:invalid-query`);
  if (!(value?.database === null || boundedString(value.database, 4096))) {
    errors.push(`${context}:invalid-database`);
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
      : ['subtype', 'type', 'answer', 'unit', 'date', 'today', 'explanation'];
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
    if (!['moon', 'christmas'].includes(value?.type)) errors.push(`${context}:invalid-type`);
    if (!Number.isFinite(value?.answer) || value.answer < 0) errors.push(`${context}:invalid-answer`);
    for (const key of ['unit', 'date', 'today', 'explanation']) {
      if (!boundedString(value?.[key], key === 'explanation' ? 1024 : 64)) {
        errors.push(`${context}:invalid-${key}`);
      }
    }
  }
  return Object.freeze(errors);
}

function descriptor({
  id,
  riskClass,
  authorityMode,
  requiredEffectKind,
  inputSchema,
  outputSchema,
  validateInput,
  validateOutput = value => validateJsonObjectOutput(value, `tool-output.${id}`),
  direct = false,
  buildEffectBinding = null,
  validateEffectTranslation = null,
  projectEffectOutput = null,
}) {
  return Object.freeze({
    id,
    version: 1,
    riskClass,
    authorityMode,
    requiredEffectKind,
    inputSchema,
    outputSchema,
    validateInput,
    validateOutput,
    direct,
    buildEffectBinding,
    validateEffectTranslation,
    projectEffectOutput,
  });
}

const EMPTY_PAYLOAD_DIGEST = `sha256:${createHash('sha256').update(Buffer.alloc(0)).digest('hex')}`;

function effectBinding({ kind, target, payloadDigest, payloadBytes, requiredCapability, riskClass }) {
  return Object.freeze({
    kind,
    target: Object.freeze(target),
    payloadDigest,
    payloadBytes,
    requiredCapability,
    riskClass,
  });
}

function buildNetworkBinding(url) {
  return effectBinding({
    kind: 'network.request',
    target: {
      type: 'network',
      url,
      origin: new URL(url).origin,
      method: 'GET',
      redirectPolicy: 'deny',
      dnsPolicy: 'public-only',
    },
    payloadDigest: EMPTY_PAYLOAD_DIGEST,
    payloadBytes: 0,
    requiredCapability: 'network.http.get',
    riskClass: 'network',
  });
}

function bindingMatchesEffect(binding, effectRequest) {
  if (!binding || !effectRequest) return false;
  const common = binding.kind === effectRequest.kind
    && binding.payloadDigest === effectRequest.payloadDigest
    && binding.payloadBytes === effectRequest.payloadBytes
    && binding.requiredCapability === effectRequest.requiredCapability
    && binding.riskClass === effectRequest.riskClass
    && binding.target?.type === effectRequest.target?.type;
  if (!common) return false;
  if (binding.target.type === M2_FILE_LIST_TARGET_TYPE) {
    return isM2FileListOutputRequest(effectRequest) && binding.target.relativePath === '.';
  }
  if (binding.target.type === 'filesystem') {
    return binding.target.relativePath === effectRequest.target.relativePath;
  }
  if (binding.target.type === 'network') {
    return ['url', 'origin', 'method', 'redirectPolicy', 'dnsPolicy']
      .every(key => binding.target[key] === effectRequest.target[key]);
  }
  return false;
}

function sortedUnique(values) {
  return [...new Set(values)]
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

/**
 * The one canonical projection from durable EffectResult truth into the
 * terminal fields owned by a linked ToolResult. Both the broker and the
 * repository use this function so direct SQL cannot invent a different
 * failure, evidence trail, timing, or late-completion disposition.
 */
export function projectM2EffectToolTerminal(request, descriptorValue, effectRequest, effectResult, outputEvidence = null) {
  const descriptor = descriptorValue || getM2ToolDescriptor(request?.toolId, request?.toolVersion);
  if (!request || !descriptor || !effectRequest || !effectResult) return null;
  const evidenceRefs = sortedUnique([
    `effect:${effectRequest.effectId}`,
    ...(effectResult.evidenceRefs || []),
  ]);
  const common = {
    effectRequestId: effectRequest.effectId,
    startedAt: effectResult.startedAt,
    completedAt: effectResult.completedAt,
    lateCompletionRejected: effectResult.lateCompletionRejected === true,
  };

  if (effectResult.terminalStatus === 'succeeded') {
    const output = typeof descriptor.projectEffectOutput === 'function'
      ? descriptor.projectEffectOutput(request, effectRequest, effectResult, outputEvidence)
      : null;
    const outputErrors = descriptor.validateOutput(output);
    if (output !== null && outputErrors.length === 0) {
      return Object.freeze({
        ...common,
        status: M2_TOOL_TERMINAL_STATUS.OK,
        output,
        outputDigest: computeM2ToolValueDigest(output),
        error: null,
        evidenceRefs: Object.freeze(evidenceRefs),
      });
    }
    return Object.freeze({
      ...common,
      status: M2_TOOL_TERMINAL_STATUS.ERROR,
      output: null,
      outputDigest: null,
      error: Object.freeze({
        code: M2_TOOL_ERROR_CODE.OUTPUT_INVALID,
        message: `Canonical effect output does not match ${request.outputSchema}`,
        retryable: false,
      }),
      evidenceRefs: Object.freeze(sortedUnique([
        ...evidenceRefs,
        ...outputErrors.map(value => `schema:${value}`),
      ])),
    });
  }

  const status = effectResult.terminalStatus === 'cancelled'
    ? M2_TOOL_TERMINAL_STATUS.CANCELLED
    : effectResult.terminalStatus === 'timed_out'
      ? M2_TOOL_TERMINAL_STATUS.TIMEOUT
      : ['orphaned', 'killed'].includes(effectResult.terminalStatus)
        ? M2_TOOL_TERMINAL_STATUS.ORPHANED
        : M2_TOOL_TERMINAL_STATUS.ERROR;
  return Object.freeze({
    ...common,
    status,
    output: null,
    outputDigest: null,
    error: Object.freeze({
      code: effectResult.errorCode || M2_TOOL_ERROR_CODE.EXECUTION_FAILED,
      message: `${request.toolId} effect ended as ${effectResult.terminalStatus}`,
      retryable: false,
    }),
    evidenceRefs: Object.freeze(evidenceRefs),
  });
}

function validateNetworkEffect(request, effectRequest, expectedUrl) {
  return request.effectBinding?.target?.url === expectedUrl
    && bindingMatchesEffect(request.effectBinding, effectRequest);
}

function validateFileWriteOutput(value) {
  const context = 'tool-output.file-write';
  const errors = [...validateExactInput(value, ['path', 'effectId', 'terminalStatus'], context)];
  if (!boundedString(value?.path, 4096)) errors.push(`${context}:invalid-path`);
  if (typeof value?.effectId !== 'string' || !/^effect:[a-f0-9]{64}$/.test(value.effectId)) {
    errors.push(`${context}:invalid-effectId`);
  }
  if (value?.terminalStatus !== 'succeeded') errors.push(`${context}:invalid-terminalStatus`);
  return Object.freeze(errors);
}

const DESCRIPTORS = Object.freeze([
  descriptor({
    id: 'web.search',
    riskClass: M2_TOOL_RISK_CLASS.NETWORK,
    authorityMode: M2_TOOL_AUTHORITY_MODE.EFFECT,
    requiredEffectKind: 'network.request',
    inputSchema: 'intentsmith.tool.web-search.input@1',
    outputSchema: 'intentsmith.tool.web-search.output@1',
    validateInput: value => validateQueryInput(value, 'tool-input.web-search'),
    buildEffectBinding(input) {
      return buildNetworkBinding(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(input.query)}`,
      );
    },
    validateEffectTranslation(request, effectRequest) {
      const expectedUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(request.input.query)}`;
      return validateNetworkEffect(request, effectRequest, expectedUrl);
    },
  }),
  descriptor({
    id: 'web.scrape',
    riskClass: M2_TOOL_RISK_CLASS.NETWORK,
    authorityMode: M2_TOOL_AUTHORITY_MODE.EFFECT,
    requiredEffectKind: 'network.request',
    inputSchema: 'intentsmith.tool.web-scrape.input@1',
    outputSchema: 'intentsmith.tool.web-scrape.output@1',
    validateInput: validateScrapeInput,
    buildEffectBinding(input) {
      try {
        return buildNetworkBinding(new URL(input.url).href);
      } catch {
        return null;
      }
    },
    validateEffectTranslation(request, effectRequest) {
      try {
        return validateNetworkEffect(request, effectRequest, new URL(request.input.url).href);
      } catch {
        return false;
      }
    },
  }),
  descriptor({
    id: 'file.list',
    riskClass: M2_TOOL_RISK_CLASS.READ,
    authorityMode: M2_TOOL_AUTHORITY_MODE.UNAVAILABLE,
    requiredEffectKind: 'fs.read',
    inputSchema: 'intentsmith.tool.file-list.input@1',
    outputSchema: 'intentsmith.tool.file-list.output@1',
    validateInput: validateFileListInput,
  }),
  descriptor({
    id: 'file.read',
    riskClass: M2_TOOL_RISK_CLASS.READ,
    authorityMode: M2_TOOL_AUTHORITY_MODE.EFFECT,
    requiredEffectKind: 'fs.read',
    inputSchema: 'intentsmith.tool.file-read.input@1',
    outputSchema: 'intentsmith.tool.file-read.output@1',
    validateInput: value => validateFileInput(value, false),
    buildEffectBinding(input) {
      return effectBinding({
        kind: 'fs.read',
        target: { type: 'filesystem', relativePath: input.path },
        payloadDigest: EMPTY_PAYLOAD_DIGEST,
        payloadBytes: 0,
        requiredCapability: 'project.fs.read',
        riskClass: 'read',
      });
    },
    validateEffectTranslation(request, effectRequest) {
      return bindingMatchesEffect(request.effectBinding, effectRequest);
    },
  }),
  descriptor({
    id: 'file.write',
    riskClass: M2_TOOL_RISK_CLASS.WRITE,
    authorityMode: M2_TOOL_AUTHORITY_MODE.EFFECT,
    requiredEffectKind: 'fs.write',
    inputSchema: 'intentsmith.tool.file-write.input@1',
    outputSchema: 'intentsmith.tool.file-write.output@1',
    validateInput: value => validateFileInput(value, true),
    validateOutput: validateFileWriteOutput,
    buildEffectBinding(input) {
      const payload = Buffer.from(input.content, 'utf8');
      return effectBinding({
        kind: 'fs.write',
        target: { type: 'filesystem', relativePath: input.path },
        payloadDigest: `sha256:${createHash('sha256').update(payload).digest('hex')}`,
        payloadBytes: payload.length,
        requiredCapability: 'project.fs.write',
        riskClass: 'write',
      });
    },
    validateEffectTranslation(request, effectRequest) {
      return bindingMatchesEffect(request.effectBinding, effectRequest);
    },
    projectEffectOutput(request, effectRequest, effectResult) {
      if (effectResult?.terminalStatus !== 'succeeded') return null;
      return Object.freeze({
        path: request.input.path,
        effectId: effectRequest.effectId,
        terminalStatus: effectResult.terminalStatus,
      });
    },
  }),
  descriptor({
    id: 'code.execute',
    riskClass: M2_TOOL_RISK_CLASS.EXEC,
    authorityMode: M2_TOOL_AUTHORITY_MODE.UNAVAILABLE,
    requiredEffectKind: 'process.exec',
    inputSchema: 'intentsmith.tool.code-execute.input@1',
    outputSchema: 'intentsmith.tool.code-execute.output@1',
    validateInput: validateCodeInput,
  }),
  descriptor({
    id: 'database.query',
    riskClass: M2_TOOL_RISK_CLASS.EXEC,
    authorityMode: M2_TOOL_AUTHORITY_MODE.UNAVAILABLE,
    requiredEffectKind: 'process.exec',
    inputSchema: 'intentsmith.tool.database-query.input@1',
    outputSchema: 'intentsmith.tool.database-query.output@1',
    validateInput: validateDatabaseInput,
  }),
  descriptor({
    id: 'local.date',
    riskClass: M2_TOOL_RISK_CLASS.PURE,
    authorityMode: M2_TOOL_AUTHORITY_MODE.DIRECT,
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
    authorityMode: M2_TOOL_AUTHORITY_MODE.DIRECT,
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
    authorityMode: M2_TOOL_AUTHORITY_MODE.DIRECT,
    requiredEffectKind: null,
    inputSchema: 'intentsmith.tool.local-math.input@1',
    outputSchema: 'intentsmith.tool.local-math.output@1',
    validateInput: value => validateQueryInput(value, 'tool-input.local-math'),
    validateOutput: value => validateLocalOutput(value, 'math'),
    direct: true,
  }),
]);

const DESCRIPTOR_MAP = new Map(DESCRIPTORS.map(value => [value.id, value]));

const FILE_READ_V2 = Object.freeze({
  ...DESCRIPTOR_MAP.get('file.read'),
  version: 2,
  outputSchema: 'intentsmith.tool.file-read.output@2',
  validateOutput(value) {
    const errors = [...validateExactInput(value,
      ['path', 'contentRef', 'contentDigest', 'byteLength', 'format'], 'tool-output.file-read-v2')];
    if (!isM2ProjectRelativePath(value?.path) || value?.format !== 'bytes'
      || !/^effect:effect:[a-f0-9]{64}:file-read-output-v1$/.test(value?.contentRef ?? '')
      || !/^sha256:[a-f0-9]{64}$/.test(value?.contentDigest ?? '')
      || !Number.isSafeInteger(value?.byteLength) || value.byteLength < 0 || value.byteLength > 1048576) {
      errors.push('tool-output.file-read-v2:invalid-reference');
    }
    return Object.freeze(errors);
  },
  buildEffectBinding(input) {
    const payload = createM2FileReadPolicyPayload();
    return effectBinding({ kind: 'fs.read', target: { type: 'filesystem', relativePath: input.path },
      payloadDigest: m2FileReadBytesDigest(payload), payloadBytes: payload.length,
      requiredCapability: 'project.fs.read', riskClass: 'read' });
  },
  projectEffectOutput(request, effectRequest, effectResult, evidence) {
    if (!validateM2FileReadOutputEvidence(effectRequest, effectResult, evidence)
      || evidence.path !== request.input.path) return null;
    return Object.freeze({ path: evidence.path, contentRef: evidence.contentRef,
      contentDigest: evidence.contentDigest, byteLength: evidence.byteLength, format: 'bytes' });
  },
});

const FILE_LIST_V2 = Object.freeze({
  ...DESCRIPTOR_MAP.get('file.list'),
  version: 2,
  authorityMode: M2_TOOL_AUTHORITY_MODE.EFFECT,
  outputSchema: 'intentsmith.tool.file-list.output@2',
  validateOutput(value) {
    const errors = [...validateExactInput(value,
      ['path', 'contentRef', 'contentDigest', 'byteLength', 'format'], 'tool-output.file-list-v2')];
    if (value?.path !== '.' || value?.format !== 'root-entries@1'
      || !/^effect:effect:[a-f0-9]{64}:file-list-output-v1$/.test(value?.contentRef ?? '')
      || !/^sha256:[a-f0-9]{64}$/.test(value?.contentDigest ?? '')
      || !Number.isSafeInteger(value?.byteLength) || value.byteLength < 0 || value.byteLength > 1048576) {
      errors.push('tool-output.file-list-v2:invalid-reference');
    }
    return Object.freeze(errors);
  },
  buildEffectBinding(input) {
    const payload = createM2FileListPolicyPayload();
    return effectBinding({ kind: 'fs.read', target: { type: M2_FILE_LIST_TARGET_TYPE, relativePath: input.path },
      payloadDigest: m2FileReadBytesDigest(payload), payloadBytes: payload.length,
      requiredCapability: 'project.fs.list', riskClass: 'read' });
  },
  validateEffectTranslation(request, effectRequest) {
    return bindingMatchesEffect(request.effectBinding, effectRequest);
  },
  projectEffectOutput(request, effectRequest, effectResult, evidence) {
    if (!validateM2FileListOutputEvidence(effectRequest, effectResult, evidence)
      || evidence.path !== request.input.path) return null;
    return Object.freeze({ path: evidence.path, contentRef: evidence.contentRef,
      contentDigest: evidence.contentDigest, byteLength: evidence.byteLength, format: 'root-entries@1' });
  },
});

// Unversioned legacy imports include immutable migration076. Their @1 meaning
// must never change when a new producer version becomes available.
export function getM2ToolDescriptor(toolId, toolVersion = 1) {
  if (toolId === 'file.list' && toolVersion === 2) return FILE_LIST_V2;
  if (toolId === 'file.read' && toolVersion === 2) return FILE_READ_V2;
  return toolVersion === 1 ? DESCRIPTOR_MAP.get(toolId) || null : null;
}

export function getCurrentM2ToolDescriptor(toolId, storedVersion = null) {
  return getM2ToolDescriptor(toolId, storedVersion ?? (['file.read', 'file.list'].includes(toolId) ? 2 : 1));
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
    case 'file.list':
      return { path: '.' };
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
    case 'database.query':
      return {
        query: String(params.query ?? params.input ?? ''),
        database: typeof params.database === 'string' ? params.database : null,
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
