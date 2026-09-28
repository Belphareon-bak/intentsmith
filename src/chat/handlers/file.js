// handlers/file.js — FILE_READ / FILE_EXPLAIN handlers (TERMINAL)
// ══════════════════════════════════════════════════════════════════════════════
// v63.0 - File operations: read, explain, list
// INVARIANT: FILE_READ NEVER calls web.search, NEVER generates prose
// INVARIANT: FILE_EXPLAIN reads file, then asks LLM to explain content
//
// Security:
//   - path.resolve() to canonicalize
//   - Must be within project sandbox (projectPath) or /tmp
//   - No ".." traversal after resolve
//   - No /etc, /proc, /sys, /dev, /root, /home/*/.ssh etc.
//   - Max file size: 512KB (prevent memory issues)
// ══════════════════════════════════════════════════════════════════════════════

import { ResponseTag, TaggedResponse, ResponseSpeaker, ChatMode } from '../controller.js';
import { IntentType } from '../cre-decision.js';
import { logger } from '../../core/logger.js';
import { getLanguageContext } from './utils/language.js';
import { synthesizeWithLLM } from './utils/synthesis.js';
import path from 'path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validateM2ToolRequest, validateM2ToolResult, computeM2ToolRequestDigest, computeM2ToolValueDigest } from '../../../contracts/m2/tool-v1.js';
import {
  isM2FileReadOutputRequest, M2_FILE_READ_MAX_BYTES, m2FileReadConversationOrigin,
} from '../../../contracts/m2/file-read-output-v1.js';
import { config } from '../../config.js';
import { isM2FileListOutputRequest, m2FileListConversationOrigin, m2FileListOutputEvidenceRef } from '../../../contracts/m2/file-list-output-v1.js';
import { parseM2FileListSnapshot, M2_FILE_LIST_MAX_ENTRIES, M2_FILE_LIST_MAX_BYTES } from '../../../contracts/m2/file-list-snapshot-v1.js';
import { throwIfAborted, isAbortError } from '../../core/abort-error.js';
import { issueFileExplainContinuation, getFileExplainContinuation } from '../file-explain-continuation.js';
import { prepareFileExplanation, callFileExplanation } from './utils/file-explain.js';
import { canonicalStringify } from '../../../contracts/m2/effect-current.js';

// ─── Security constants ──────────────────────────────────────────────────────

const MAX_FILE_SIZE = config.limits.maxFileSize;
const MAX_DISPLAY_LINES = config.limits.maxDisplayLines;
const FORBIDDEN_PATHS = [
  '/etc', '/proc', '/sys', '/dev', '/root',
  '/boot', '/sbin', '/usr/sbin', '/var/log',
];
// v63.0: FORBIDDEN_PATTERNS — checked against BASENAME only (not full path)
// Prevents false positives like "src/credentials-helper.js" being blocked.
// Directory patterns (ssh, gnupg) are checked against full resolved path.
const FORBIDDEN_DIR_PATTERNS = [
  /[/\\]\.ssh([/\\]|$)/,     // .ssh directory anywhere in path
  /[/\\]\.gnupg([/\\]|$)/,   // .gnupg directory anywhere in path
];
const FORBIDDEN_BASENAME_PATTERNS = [
  /^\.env(\..*)?$/i,          // .env, .env.local, .env.production etc.
  /^credentials\.\w+$/i,     // credentials.json, credentials.yml (NOT credentials-helper.js)
  /^\.pem$/i, /\.pem$/i,     // *.pem
  /^.*\.key$/i,              // *.key
  /^id_rsa/,                 // id_rsa, id_rsa.pub
  /^id_ed25519/,             // id_ed25519, id_ed25519.pub
  /^shadow$/,                // /etc/shadow
  /^passwd$/,                // /etc/passwd
  /^\.netrc$/,               // .netrc (credentials)
  /^\.pgpass$/,              // postgres password
  /^secrets?\.\w+$/i,        // secret.json, secrets.yml
];

// ─── Security guard ──────────────────────────────────────────────────────────

/**
 * Validate that a file path is safe to read.
 * @param {string} filePath — Absolute or relative path
 * @param {string|null} projectPath — Project sandbox root (if active)
 * @returns {{ safe: boolean, resolved: string, reason?: string }}
 */
function validateFilePath(filePath, projectPath) {
  if (!filePath || typeof filePath !== 'string') {
    return { safe: false, resolved: '', reason: 'no_path' };
  }

  // Resolve to absolute path
  const basePath = projectPath || process.cwd();
  const resolved = path.resolve(basePath, filePath);

  // Check forbidden system paths
  for (const forbidden of FORBIDDEN_PATHS) {
    if (resolved.startsWith(forbidden + '/') || resolved === forbidden) {
      return { safe: false, resolved, reason: `forbidden_path:${forbidden}` };
    }
  }

  // Check forbidden directory patterns (full path)
  for (const pattern of FORBIDDEN_DIR_PATTERNS) {
    if (pattern.test(resolved)) {
      return { safe: false, resolved, reason: `forbidden_dir:${pattern.source}` };
    }
  }

  // Check forbidden filename patterns (basename only — prevents false positives)
  const basename = path.basename(resolved);
  for (const pattern of FORBIDDEN_BASENAME_PATTERNS) {
    if (pattern.test(basename)) {
      return { safe: false, resolved, reason: `forbidden_file:${basename}` };
    }
  }

  // If project is active, file must be within project path
  if (projectPath) {
    const normalizedProject = path.resolve(projectPath);
    if (!resolved.startsWith(normalizedProject + '/') && resolved !== normalizedProject) {
      // Allow /tmp as escape hatch
      if (!resolved.startsWith('/tmp/')) {
        return { safe: false, resolved, reason: 'outside_project_sandbox' };
      }
    }
  }

  return { safe: true, resolved };
}

// ─── Response formatting ─────────────────────────────────────────────────────

function storedPathLiteral(value) {
  // Names are data too: make control/format characters visible and contain all
  // Markdown/HTML inside a code span whose delimiter cannot occur in the name.
  const visible = String(value).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,
    character => `\\u{${character.codePointAt(0).toString(16)}}`);
  let longest = 0;
  for (const match of visible.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const delimiter = '`'.repeat(longest + 1);
  return `${delimiter} ${visible} ${delimiter}`;
}

function formatFileReadResponse(filePath, result, lang = 'cs', storedBytes = false) {
  const filename = path.basename(filePath);
  const ext = path.extname(filename).slice(1);

  if (result.error === 'file_not_found') {
    return lang === 'cs'
      ? `❌ Soubor **${filename}** nebyl nalezen — zadaná cesta neexistuje.\n\nHledaná cesta: \`${filePath}\``
      : `❌ File **${filename}** not found.\n\nPath: \`${filePath}\``;
  }

  if (result.error === 'permission_denied') {
    return lang === 'cs'
      ? `🔒 Nemám oprávnění ke čtení souboru **${filename}**.`
      : `🔒 Permission denied for file **${filename}**.`;
  }

  if (result.error?.startsWith('file_too_large')) {
    const sizeKB = Math.round(result.size / 1024);
    return lang === 'cs'
      ? `⚠️ Soubor **${filename}** je příliš velký (${sizeKB} KB, max ${MAX_FILE_SIZE / 1024} KB).`
      : `⚠️ File **${filename}** is too large (${sizeKB} KB, max ${MAX_FILE_SIZE / 1024} KB).`;
  }

  if (result.error) {
    return lang === 'cs'
      ? `❌ Chyba při čtení souboru **${filename}**: ${result.error}`
      : `❌ Error reading file **${filename}**: ${result.error}`;
  }

  if (result.isDirectory) {
    const header = lang === 'cs'
      ? `📁 **Obsah adresáře** \`${filePath}\`:`
      : `📁 **Directory contents** \`${filePath}\`:`;
    return `${header}\n\n${result.content}`;
  }

  // Determine code fence language
  const langMap = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
    ts: 'typescript', tsx: 'tsx', mts: 'typescript',
    py: 'python', pyw: 'python', rb: 'ruby', php: 'php',
    sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'fish', ps1: 'powershell', bat: 'batch', cmd: 'batch',
    yml: 'yaml', yaml: 'yaml', md: 'markdown', mdx: 'mdx',
    json: 'json', jsonc: 'jsonc', json5: 'json5',
    html: 'html', htm: 'html', css: 'css', scss: 'scss', sass: 'sass', less: 'less',
    sql: 'sql', rs: 'rust', go: 'go', java: 'java',
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'c', h: 'c', hpp: 'cpp', hxx: 'cpp', cs: 'csharp',
    swift: 'swift', kt: 'kotlin', kts: 'kotlin', scala: 'scala', groovy: 'groovy', gradle: 'groovy',
    dart: 'dart', r: 'r', lua: 'lua', pl: 'perl', pm: 'perl',
    ex: 'elixir', exs: 'elixir', erl: 'erlang', hs: 'haskell', ml: 'ocaml', mli: 'ocaml',
    fs: 'fsharp', fsx: 'fsharp', clj: 'clojure', cljs: 'clojure',
    vue: 'vue', svelte: 'svelte', astro: 'astro',
    xml: 'xml', xsl: 'xml', toml: 'toml', ini: 'ini', conf: 'conf', properties: 'properties',
    graphql: 'graphql', gql: 'graphql', proto: 'protobuf',
    tf: 'hcl', hcl: 'hcl', dockerfile: 'dockerfile', makefile: 'makefile', cmake: 'cmake',
    prisma: 'prisma', sol: 'solidity', zig: 'zig', nim: 'nim', nix: 'nix',
    tex: 'latex', latex: 'latex', rst: 'rst',
    pug: 'pug', jade: 'pug', ejs: 'ejs', hbs: 'handlebars',
    diff: 'diff', patch: 'diff',
  };
  const codeLang = storedBytes
    ? (Object.hasOwn(langMap, ext) ? langMap[ext] : 'text')
    : (langMap[ext] || ext || '');
  const displayName = storedBytes ? storedPathLiteral(filename) : `**${filename}**`;

  const header = lang === 'cs'
    ? `📄 ${displayName} (${result.lines} řádků, ${Math.round(result.size / 1024) || '<1'} KB)`
    : `📄 ${displayName} (${result.lines} lines, ${Math.round(result.size / 1024) || '<1'} KB)`;

  let fence = '```';
  if (storedBytes) {
    // A file cannot close its own literal display and become chat instructions.
    let longest = 2;
    for (const match of result.content.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
    fence = '`'.repeat(longest + 1);
  }
  return `${header}\n\n${fence}${codeLang}\n${result.content}\n${fence}`;
}

function formatSecurityBlock(filePath, reason, lang = 'cs') {
  if (lang === 'cs') {
    switch (reason) {
      case 'no_path':
        return '⚠️ Nebyl zadán žádný soubor. Upřesni, který soubor chceš otevřít.\n\nPříklad: `otevři soubor package.json`';
      case 'outside_project_sandbox':
        return `🔒 Soubor \`${filePath}\` je mimo pracovní adresář projektu. Nemám přístup k souborům mimo sandbox.`;
      default:
        if (reason?.startsWith('forbidden_')) {
          return `🔒 Nemám přístup k \`${filePath}\` — soubor je blokován z bezpečnostních důvodů.`;
        }
        return `⚠️ Nelze přistoupit k souboru: ${reason}`;
    }
  }
  // EN fallback
  switch (reason) {
    case 'no_path':
      return '⚠️ No file specified. Please specify which file to open.\n\nExample: `open file package.json`';
    case 'outside_project_sandbox':
      return `🔒 File \`${filePath}\` is outside the project workspace. For security, only project files can be read.`;
    default:
      if (reason?.startsWith('forbidden_')) {
        return `🔒 Access to \`${filePath}\` is blocked for security reasons.`;
      }
      return `⚠️ Cannot access file: ${reason}`;
  }
}

function exactReadApprovalPreview(execution, context, lang) {
  const request = execution?.request;
  const effect = execution?.effectRequest;
  const projectId = context?.project?.id ?? context?.projectId;
  const matches = execution?.state === 'approval_required' && execution.result === null
    && validateM2ToolRequest(request).valid && request.toolId === 'file.read' && request.toolVersion === 2
    && isM2FileReadOutputRequest(effect)
    && effect.effectId === execution.effectRequestId
    && effect.runId === request.runId
    && isDeepStrictEqual(effect.actor, request.actor)
    && isDeepStrictEqual(effect.origin, request.origin)
    && request.actor.type === context?.authenticatedSubject?.actorType
    && request.actor.id === context?.authenticatedSubject?.actorId
    && Number.isSafeInteger(projectId) && projectId > 0 && projectId === request.origin.projectId
    && request.origin.conversationId === m2FileReadConversationOrigin(String(context?.conversationId ?? ''))
    && effect.target.relativePath === request.input.path
    && request.effectBinding?.kind === effect.kind
    && request.effectBinding.requiredCapability === effect.requiredCapability
    && request.effectBinding.riskClass === effect.riskClass
    && request.effectBinding.target.relativePath === effect.target.relativePath
    && request.effectBinding.payloadDigest === effect.payloadDigest
    && request.effectBinding.payloadBytes === effect.payloadBytes
    && effect.idempotencyKey === `operation:${createHash('sha256').update(request.requestId, 'utf8').digest('hex')}`;
  if (!matches) throw Object.assign(new Error('Exact read approval preview cannot be correlated'), {
    code: 'TOOL_READ_APPROVAL_PREVIEW_INVALID',
  });
  const file = storedPathLiteral(effect.target.relativePath);
  const project = `${projectId} (${storedPathLiteral(effect.target.canonicalRoot)})`;
  const command = storedPathLiteral(`approve effect ${effect.effectId}`);
  const content = lang === 'cs'
    ? `🔐 Čtení souboru ${file} v projektu ${project} čeká na schválení. Nejvýše ${M2_FILE_READ_MAX_BYTES} bajtů (1 MiB), pouze tento jeden soubor. Obsah zatím nebyl načten.\n\nPro schválení napiš ${command}.`
    : `🔐 Reading file ${file} in project ${project} awaits approval. At most ${M2_FILE_READ_MAX_BYTES} bytes (1 MiB), only this one file. No content was loaded.\n\nTo approve, enter ${command}.`;
  return { content, metadata: {
    filePath: effect.target.relativePath,
    projectId,
    projectRoot: effect.target.canonicalRoot,
    readMaxBytes: M2_FILE_READ_MAX_BYTES,
    approvalPreviewVerified: true,
  } };
}

// Read bytes come only from the durable, caller-bound content resolver. A
// successful ToolResult reference or adapter value alone is not file content.
function resolveVerifiedM2FileText(execution, context, toolExecutor, expectedEffectId = null) {
  const requestId = execution?.request?.requestId || null;
  const effectId = execution?.result?.effectRequestId || execution?.effectRequestId || null;
  if (execution?.request?.toolId !== 'file.read'
      || execution.request.toolVersion !== 2
      || execution.result?.status !== 'ok'
      || execution.result.requestId !== requestId
      || !effectId
      || (expectedEffectId !== null && expectedEffectId !== effectId)
      || typeof toolExecutor?.resolveM2FileReadContent !== 'function') {
    throw Object.assign(new Error('Stored file read terminal is unavailable'), {
      code: 'TOOL_READ_CONTENT_AUTHORITY_REQUIRED',
    });
  }
  const contentRef = execution.result.output?.contentRef;
  const resolved = toolExecutor.resolveM2FileReadContent({ requestId, contentRef, context });
  const { bytes, output, request, result } = resolved || {};
  const exact = Buffer.isBuffer(bytes)
    && request?.requestId === requestId
    && isDeepStrictEqual(request, execution.request)
    && isDeepStrictEqual(result, execution.result)
    && isDeepStrictEqual(output, result.output)
    && request.toolId === 'file.read' && request.toolVersion === 2
    && result?.requestId === requestId && result.status === 'ok'
    && result.requestDigest === execution.result.requestDigest
    && result.effectRequestId === effectId && resolved.effectId === effectId
    && output?.format === 'bytes' && output.contentRef === contentRef
    && output.path === request.input?.path && resolved.path === output.path
    && output.byteLength === bytes.length
    && output.contentDigest === `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (!exact) {
    throw Object.assign(new Error('Stored file read identity or bytes do not match'), {
      code: 'TOOL_READ_CONTENT_MISMATCH',
    });
  }
  let content;
  try {
    // Preserve a UTF-8 BOM and every valid code point; never replace invalid bytes.
    content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (content.includes('\0') || !Buffer.from(content, 'utf8').equals(bytes)) throw new Error('Non-text bytes');
  } catch {
    throw Object.assign(new Error('Stored file bytes cannot be displayed as UTF-8 text'), {
      code: 'TOOL_READ_CONTENT_NOT_TEXT',
    });
  }
  return { bytes, content, output, request, result, effectId };
}

export function renderM2FileReadResult(execution, context, {
  toolExecutor,
  decision = null,
  requestedHandler = 'file.read',
  expectedEffectId = null,
} = {}) {
  const lang = context.langCtx?.language || 'cs';
  const requestId = execution?.request?.requestId || null;
  const effectId = execution?.result?.effectRequestId || execution?.effectRequestId || null;
  const metadata = {
    handler: 'file.read',
    requestedHandler,
    fileOperation: false,
    fallbackSuppressed: true,
    approvalRequired: false,
    toolRequestId: requestId,
    effectId,
    ...(decision ? { decision: decision.toJSON() } : {}),
  };
  try {
    const { bytes, content, output } = resolveVerifiedM2FileText(execution, context, toolExecutor, expectedEffectId);
    const explanationPending = requestedHandler === 'file.explain';
    const rendered = formatFileReadResponse(output.path, {
      content, size: bytes.length, lines: content.split('\n').length, truncated: false,
    }, lang, true);
    context.sessionState?.setActiveFile?.(output.path);
    return new TaggedResponse({
      content: explanationPending
        ? (lang === 'cs' ? 'Zde je ověřený obsah souboru. Vysvětlení zatím neproběhlo.\n\n'
          : 'Here is the verified file content. An explanation has not been produced.\n\n') + rendered
        : rendered,
      tag: new ResponseTag({
        speaker: ResponseSpeaker.SYSTEM,
        mode: context.hasActiveProject ? ChatMode.PROJECT : ChatMode.CONVERSATION,
        confidence: 1,
        canExecute: false,
        metadata: {
          ...metadata,
          fileOperation: true,
          securityBlocked: false,
          filePath: output.path,
          fileSize: bytes.length,
          fileLines: content.split('\n').length,
          contentRef: output.contentRef,
          contentDigest: output.contentDigest,
          truncated: false,
          explanationPending,
          error: null,
        },
      }),
    });
  } catch (error) {
    return new TaggedResponse({
      content: error.code === 'TOOL_READ_CONTENT_NOT_TEXT'
        ? (lang === 'cs' ? 'Soubor byl načten, ale jeho bajty nelze bezpečně zobrazit jako text UTF-8.'
          : 'The file was read, but its bytes cannot safely be displayed as UTF-8 text.')
        : (lang === 'cs' ? 'Ověřený uložený obsah souboru nelze bezpečně zobrazit. Čtení se neopakovalo.'
          : 'The verified stored file content cannot safely be displayed. Reading was not repeated.'),
      tag: new ResponseTag({
        speaker: ResponseSpeaker.SYSTEM,
        mode: context.hasActiveProject ? ChatMode.PROJECT : ChatMode.CONVERSATION,
        confidence: 1,
        canExecute: false,
        metadata: { ...metadata, securityBlocked: true, error: error.code || 'TOOL_READ_CONTENT_UNAVAILABLE' },
      }),
    });
  }
}

// Concurrent explicit approvals never share results or start a second model
// call for the same exact operation. This is not a durable inference claim.
const activeFileExplanations = new Set();

/** Complete only an explicitly requested explanation of the exact stored read. */
export async function completeM2FileRead(execution, context, {
  toolExecutor, decision = null, requestedHandler = 'file.read', expectedEffectId = null,
  question = null, resume = false, callExplanation = callFileExplanation,
} = {}) {
  let wantsExplanation = requestedHandler === 'file.explain';
  if (!wantsExplanation && (!resume || !context.conversationStore?.isDurableReady?.())) {
    return renderM2FileReadResult(execution, context, { toolExecutor, decision, expectedEffectId });
  }
  let verified = false;
  const lang = context.langCtx?.language || 'cs';
  try {
    throwIfAborted(context.signal);
    const read = resolveVerifiedM2FileText(execution, context, toolExecutor, expectedEffectId);
    verified = true;
    let continuation = null;
    try {
      continuation = (wantsExplanation || resume) ? getFileExplainContinuation(execution, context) : null;
    } catch (error) {
      // A corrupt explanation continuation must not turn an otherwise valid
      // ordinary read resume into an explanation failure. An explicit
      // FILE_EXPLAIN request still fails closed below.
      if (!wantsExplanation && resume && error?.code === 'TOOL_FILE_EXPLAIN_CONTEXT_MISMATCH') {
        return renderM2FileReadResult(execution, context, { toolExecutor, decision, expectedEffectId });
      }
      throw error;
    }
    if (continuation) {
      if (wantsExplanation && question !== null && question !== continuation.question) {
        throw Object.assign(new Error('Replay question changed'), { code: 'TOOL_FILE_EXPLAIN_CONTEXT_MISMATCH' });
      }
      wantsExplanation = true;
      question = continuation.question;
    }
    if (!wantsExplanation) return renderM2FileReadResult(execution, context, { toolExecutor, decision, expectedEffectId });
    const language = continuation?.language || (lang === 'en' ? 'en' : 'cs');
    const explainContext = { ...context, langCtx: { ...context.langCtx, language } };
    const assertCurrent = () => {
      throwIfAborted(context.signal);
      const current = resolveVerifiedM2FileText(execution, context, toolExecutor, expectedEffectId);
      if (!current.bytes.equals(read.bytes) || !isDeepStrictEqual(current.output, read.output)) {
        throw Object.assign(new Error('Stored read changed during explanation'), { code: 'TOOL_READ_CONTENT_MISMATCH' });
      }
    };
    let responseContent;
    let model;
    const replayed = continuation?.state === 'complete';
    if (replayed) {
      responseContent = continuation.content;
      model = continuation.model;
    } else {
      const prepared = prepareFileExplanation({ path: read.output.path, content: read.content, question, language });
      // One ordinary D1 call. Neither the file nor model output can supply
      // tools, auth tokens, model options or additional filesystem paths.
      const claimKey = canonicalStringify({
        requestDigest: execution.result.requestDigest,
        effectId: read.effectId,
        actor: execution.request.actor,
        origin: execution.request.origin,
      });
      if (activeFileExplanations.has(claimKey)) {
        throw Object.assign(new Error('This exact explanation is already running'), { code: 'TOOL_FILE_EXPLAIN_BUSY' });
      }
      activeFileExplanations.add(claimKey);
      try {
        const result = await callExplanation(prepared, explainContext);
        assertCurrent();
        if (result?.finishReason !== 'stop' || typeof result.content !== 'string' || !result.content.trim()
            || typeof result.model !== 'string' || !result.model) {
          throw Object.assign(new Error('The model did not produce a complete explanation'), {
            code: result?.finishReason === 'length' ? 'TOOL_FILE_EXPLAIN_TRUNCATED' : 'TOOL_FILE_EXPLAIN_INCOMPLETE',
          });
        }
        model = result.model;
        responseContent = `${language === 'en' ? 'Explanation of' : 'Vysvětlení souboru'} ${storedPathLiteral(read.output.path)}\n\n${result.content}`;
      } finally { activeFileExplanations.delete(claimKey); }
    }
    assertCurrent();
    const marker = issueFileExplainContinuation(execution, explainContext, question,
      { content: responseContent, model }, assertCurrent);
    return new TaggedResponse({ content: responseContent, tag: new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM, mode: context.hasActiveProject ? ChatMode.PROJECT : ChatMode.CONVERSATION,
      confidence: 0.85, canExecute: false, metadata: {
        handler: 'file.explain', requestedHandler: 'file.explain', fileOperation: true,
        fileReadVerified: true, fallbackSuppressed: true, approvalRequired: false, securityBlocked: false,
        toolRequestId: execution.request.requestId, effectId: read.effectId,
        filePath: read.output.path, fileSize: read.bytes.length,
        contentRef: read.output.contentRef, contentDigest: read.output.contentDigest,
        explanationPending: false, explanationComplete: true, explanationReplayed: replayed,
        model, finishReason: 'stop', truncated: false, error: null, m2FileExplain: marker,
        ...(decision ? { decision: decision.toJSON() } : {}),
      },
    }) });
  } catch (error) {
    if (context.signal?.aborted || isAbortError(error)) throw error;
    if (typeof error?.code === 'string' && error.code.startsWith('TOOL_FILE_EXPLAIN_')) wantsExplanation = true;
    if (!wantsExplanation) return renderM2FileReadResult(execution, context, { toolExecutor, decision, expectedEffectId });
    const message = error?.code === 'TOOL_FILE_EXPLAIN_BUSY'
      ? (lang === 'en' ? 'This exact file explanation is already running. No second model call was started.'
        : 'Vysvětlení tohoto přesného souboru již běží. Další modelové volání nebylo spuštěno.')
      : error?.code === 'TOOL_FILE_EXPLAIN_CONTEXT_LIMIT'
      ? (lang === 'en' ? 'The complete file and question do not fit the current model context. No explanation was generated. Request a smaller file or a narrower, separately approved excerpt.'
        : 'Celý soubor a dotaz se nevejdou do aktuálního kontextu modelu. Vysvětlení nevzniklo. Zvolte menší soubor nebo užší, samostatně schválený výňatek.')
      : (lang === 'en' ? 'A complete, verified explanation is unavailable. No partial model answer or replacement file read was used.'
        : 'Úplné ověřené vysvětlení není k dispozici. Částečná modelová odpověď ani náhradní čtení souboru nebyly použity.');
    return new TaggedResponse({ content: message, tag: new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM, mode: context.hasActiveProject ? ChatMode.PROJECT : ChatMode.CONVERSATION,
      confidence: 1, canExecute: false, metadata: {
        handler: 'file.explain', requestedHandler: 'file.explain', fileOperation: false,
        fileReadVerified: verified, fallbackSuppressed: true, approvalRequired: false,
        explanationPending: true, explanationComplete: false, securityBlocked: !verified,
        toolRequestId: execution?.request?.requestId || null,
        effectId: execution?.result?.effectRequestId || execution?.effectRequestId || null,
        error: error?.code || 'TOOL_FILE_EXPLAIN_FAILED',
        ...(decision ? { decision: decision.toJSON() } : {}),
      },
    }) });
  }
}

// ─── Main handler ────────────────────────────────────────────────────────────

/**
 * Handle FILE_READ and FILE_EXPLAIN decisions — TERMINAL
 */
export async function handleFileDecision(input, decision, context, dependencies = {}) {
  const { sessionState } = context;
  const handler = decision.metadata?.handler || 'file.read';
  // v84: When FILE_READ has no specific file in project mode → default to directory listing ('.')
  // This removes the need for hardcoded phrase matching — any input the LLM classifies
  // as FILE_READ in project context will fall back to listing the project root.
  const filePath = decision.metadata?.filePath
    || (decision.intent === IntentType.FILE_READ && context.hasActiveProject ? '.' : null);
  const projectPath = decision.metadata?.projectScope?.projectPath
    || context.project?.path
    || process.cwd();

  logger.info('HandleFile', `Executing ${handler} (TERMINAL)`, {
    handler,
    filePath,
    projectPath,
    input: input.substring(0, 50),
  });

  const langCtx = context.langCtx || getLanguageContext(input);
  const lang = langCtx?.language || 'cs';

  // Security guard
  const validation = validateFilePath(filePath, projectPath);
  if (!validation.safe) {
    const reasonCategory = validation.reason?.startsWith('forbidden_dir') ? 'DIRECTORY_BLOCK'
      : validation.reason?.startsWith('forbidden_file') ? 'FILENAME_BLOCK'
      : validation.reason?.startsWith('forbidden_path') ? 'SYSTEM_PATH_BLOCK'
      : validation.reason === 'outside_project_sandbox' ? 'SANDBOX_ESCAPE'
      : validation.reason === 'no_path' ? 'MISSING_PATH'
      : 'UNKNOWN';
    logger.warn('HandleFile', `Security guard BLOCKED: ${reasonCategory}`, {
      category: reasonCategory,
      filePath,
      basename: filePath ? path.basename(filePath) : null,
      resolved: validation.resolved,
      reason: validation.reason,
      projectPath,
      userInput: input.substring(0, 80),
    });

    const content = formatSecurityBlock(filePath || '(not specified)', validation.reason, lang);

    return new TaggedResponse({
      content,
      tag: new ResponseTag({
        speaker: ResponseSpeaker.SYSTEM,
        mode: ChatMode.CONVERSATION,
        confidence: 0.95,
        canExecute: false,
        metadata: {
          decision: decision.toJSON(),
          fileOperation: true,
          handler,
          securityBlocked: true,
          reason: validation.reason,
        },
      }),
    });
  }

  // v82.1: Check inline attachments before disk read
  const basename = path.basename(validation.resolved);
  const inlineAttachment = (context.attachments || []).find(
    a => a.name === basename && a.content
  );

  let result;
  if (inlineAttachment) {
    logger.info('HandleFile', `Using inline attachment content for ${basename} (${inlineAttachment.content.length} chars)`);
    result = {
      content: inlineAttachment.content,
      size: inlineAttachment.size || inlineAttachment.content.length,
      lines: inlineAttachment.content.split('\n').length,
      truncated: false,
    };
  } else {
    // A path is an input, never read authority. Only exact durable read output
    // can be displayed; no direct filesystem access or LLM fallback runs here.
    try {
      let executor = dependencies.toolExecutor;
      if (!executor) {
        const module = await import('../../executor/tool-executor.js');
        executor = module.toolExecutor;
      }
      if (!executor || typeof executor.executeM2Tool !== 'function') {
        throw Object.assign(new Error('M2 tool runtime is unavailable'), {
          code: 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE',
        });
      }
      const toolId = filePath === '.' ? 'file.list' : 'file.read';
      const execution = await executor.executeM2Tool({
        toolId,
        input: { path: filePath },
        context,
        timeoutMs: 30_000,
      });
      if (toolId === 'file.list' && execution.result?.status === 'ok') {
        return renderM2FileListResult(execution, context, { toolExecutor: executor, decision });
      }
      if (toolId === 'file.read' && execution.result?.status === 'ok') {
        return await completeM2FileRead(execution, context, {
          toolExecutor: executor,
          question: input,
          callExplanation: dependencies.callExplanation,
          decision,
          requestedHandler: decision.intent === IntentType.FILE_EXPLAIN ? 'file.explain' : 'file.read',
        });
      }
      const errorCode = execution.result?.error?.code
        || (execution.state === 'in_progress' ? 'TOOL_EXECUTION_IN_PROGRESS' : null)
        || (execution.state === 'approval_required' ? 'TOOL_EFFECT_AUTHORITY_REQUIRED' : null)
        || 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE';
      const preview = toolId === 'file.read' && execution.request?.toolVersion === 2
        && execution.state === 'approval_required'
        ? exactReadApprovalPreview(execution, context, lang)
        : toolId === 'file.list' && execution.request?.toolVersion === 2 && execution.state === 'approval_required'
          ? exactM2FileListApprovalPreview(execution, context, lang) : null;
      const content = preview?.content ?? (execution.state === 'approval_required' && execution.effectRequestId
        ? (lang === 'cs'
          ? `🔐 Čtení čeká na přesné schválení efektu ${execution.effectRequestId}. Obsah zatím nebyl načten.`
          : `🔐 Reading awaits exact effect approval ${execution.effectRequestId}. No content was loaded.`)
        : (lang === 'cs'
          ? '🔒 Soubor nebyl načten: chybí přesná M2 autorita pro čtení. Nebyl spuštěn diskový přístup ani náhradní LLM odpověď.'
          : '🔒 File not loaded: exact M2 read authority is unavailable. No disk access or fallback LLM response ran.'));
      return new TaggedResponse({
        content,
        tag: new ResponseTag({
          speaker: ResponseSpeaker.SYSTEM,
          mode: context.hasActiveProject ? ChatMode.PROJECT : ChatMode.CONVERSATION,
          confidence: 1,
          canExecute: false,
          metadata: {
            decision: decision.toJSON(),
            fileOperation: false,
            handler: decision.intent === IntentType.FILE_EXPLAIN ? 'file.explain' : toolId,
            securityBlocked: true,
            fallbackSuppressed: true,
            error: errorCode,
            toolRequestId: execution.request?.requestId || null,
            effectId: execution.effectRequestId || null,
            approvalRequired: execution.state === 'approval_required',
            ...(preview?.metadata || {}),
            ...(preview && toolId === 'file.read' && decision.intent === IntentType.FILE_EXPLAIN
              ? { m2FileExplain: issueFileExplainContinuation(execution, context, input) } : {}),
          },
        }),
      });
    } catch (error) {
      if (context.signal?.aborted || isAbortError(error)) throw error;
      logger.warn('HandleFile', 'Durable file.read authority rejected the request', {
        code: error?.code || null,
      });
      return new TaggedResponse({
        content: lang === 'cs'
          ? '🔒 Soubor nebyl načten: požadavek neprošel M2 autoritou. Nebyl spuštěn diskový přístup ani náhradní LLM odpověď.'
          : '🔒 File not loaded: the request failed M2 authority. No disk access or fallback LLM response ran.',
        tag: new ResponseTag({
          speaker: ResponseSpeaker.SYSTEM,
          mode: context.hasActiveProject ? ChatMode.PROJECT : ChatMode.CONVERSATION,
          confidence: 1,
          canExecute: false,
          metadata: {
            decision: decision.toJSON(),
            fileOperation: false,
            handler: decision.intent === IntentType.FILE_EXPLAIN
              ? 'file.explain'
              : (filePath === '.' ? 'file.list' : 'file.read'),
            securityBlocked: true,
            fallbackSuppressed: true,
            error: error?.code || 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE',
            approvalRequired: false,
          },
        }),
      });
    }
  }

  // Record decision
  if (sessionState) {
    sessionState.recordDecision(decision, input);
    // v87: Track last active file for context continuity
    if (!result.isDirectory && !result.error) {
      sessionState.setActiveFile(validation.resolved);
    }
  }

  // FILE_READ — return content directly (no LLM)
  if (decision.intent === IntentType.FILE_READ) {
    const content = formatFileReadResponse(validation.resolved, result, lang);

    return new TaggedResponse({
      content,
      tag: new ResponseTag({
        speaker: ResponseSpeaker.SYSTEM,
        mode: ChatMode.CONVERSATION,
        confidence: 0.95,
        canExecute: false,
        metadata: {
          decision: decision.toJSON(),
          fileOperation: true,
          handler: 'file.read',
          filePath: validation.resolved,
          fileSize: result.size,
          fileLines: result.lines,
          truncated: result.truncated,
          error: result.error || null,
        },
      }),
    });
  }

  // FILE_EXPLAIN — read file, then LLM explains
  if (decision.intent === IntentType.FILE_EXPLAIN) {
    if (result.error) {
      // Can't explain a file we can't read
      const content = formatFileReadResponse(validation.resolved, result, lang);
      return new TaggedResponse({
        content,
        tag: new ResponseTag({
          speaker: ResponseSpeaker.SYSTEM,
          mode: ChatMode.CONVERSATION,
          confidence: 0.9,
          canExecute: false,
          metadata: {
            decision: decision.toJSON(),
            fileOperation: true,
            handler: 'file.explain',
            error: result.error,
          },
        }),
      });
    }

    // Use LLM to explain file content
    const filename = path.basename(validation.resolved);
    const ext = path.extname(filename).slice(1);
    const fileSnippet = result.content.substring(0, 8000); // Limit context for LLM

    const explainPrompt = lang === 'cs'
      ? `Uživatel se ptá na soubor "${filename}" (${ext}). Vysvětli, co soubor dělá, jaká je jeho struktura a účel. Odpověz v češtině.\n\nObsah souboru:\n\`\`\`${ext}\n${fileSnippet}\n\`\`\``
      : `User asks about file "${filename}" (${ext}). Explain what the file does, its structure and purpose.\n\nFile content:\n\`\`\`${ext}\n${fileSnippet}\n\`\`\``;

    try {
      const synthesized = await synthesizeWithLLM({
        query: explainPrompt,
        intent: IntentType.FILE_EXPLAIN,
        toolResults: [{ type: 'file_read', success: true, data: { content: fileSnippet, fileName: filename, ext }, meta: { source: 'local' } }],
        context: {
          ...context,
          langCtx,
          skipToolExecution: true,
        },
      });

      return new TaggedResponse({
        content: synthesized.content,
        tag: new ResponseTag({
          speaker: ResponseSpeaker.SYSTEM,
          mode: ChatMode.CONVERSATION,
          confidence: synthesized.confidence || 0.9,
          canExecute: false,
          metadata: {
            decision: decision.toJSON(),
            fileOperation: true,
            handler: 'file.explain',
            fileName: filename,
            semanticScore: synthesized.semanticScore || null, // v126.1
          },
        }),
      });
    } catch (err) {
      logger.error('HandleFile', `FILE_EXPLAIN synthesis failed: ${err.message}`);
      // Fallback: return raw file content
      const content = formatFileReadResponse(validation.resolved, result, lang);
      return new TaggedResponse({
        content: (lang === 'cs'
          ? `⚠️ Nepodařilo se vygenerovat vysvětlení (${err.message}). Zde je obsah souboru:\n\n`
          : `⚠️ Could not generate explanation (${err.message}). Here is the file content:\n\n`)
          + content,
        tag: new ResponseTag({
          speaker: ResponseSpeaker.SYSTEM,
          mode: ChatMode.CONVERSATION,
          confidence: 0.7,
          canExecute: false,
          metadata: {
            decision: decision.toJSON(),
            fileOperation: true,
            handler: 'file.explain',
            synthesisError: err.message,
          },
        }),
      });
    }
  }

  // Fallback (shouldn't happen)
  return new TaggedResponse({
    content: lang === 'cs'
      ? '⚠️ Neznámá operace se souborem.'
      : '⚠️ Unknown file operation.',
    tag: new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.CONVERSATION,
      confidence: 0.5,
      canExecute: false,
      metadata: { decision: decision.toJSON() },
    }),
  });
}

// ─── v131: FILE_WRITE content extraction from user input ────────────────────

/**
 * Extract content from user's message by stripping the save/write command suffix.
 * Used when FILE_WRITE is triggered but no previous assistant response exists.
 *
 * "mam novy update pro aplikaci, schopna ovladat desktop, zapis to do planu"
 * → "mam novy update pro aplikaci, schopna ovladat desktop"
 *
 * Returns the extracted content or null if nothing meaningful remains.
 */
function _extractUserContent(input) {
  if (!input) return null;

  // Patterns that match the save/write command at the end of user input.
  // Order: most specific first (with file target), then short forms.
  const SAVE_COMMAND_PATTERNS = [
    // CZ: "zapis/ulož/napiš to/ho/ji do <target>"
    /[,;.]\s*(?:ulo[žz]|uloz|zapi[šs]|zapsat|napi[šs]|napsat|dej|vlo[žz])\s+(?:to|ho|ji|je)\s+(?:do|jako|into)\s+\S+\s*$/i,
    // CZ: "zapis/ulož to" (no target)
    /[,;.]\s*(?:ulo[žz]|uloz|zapi[šs]|zapsat|napi[šs]|napsat|dej)\s+(?:to|ho|ji|je)\s*$/i,
    // CZ: "a zapis/ulož to do <target>" (with conjunction)
    /[,;.]?\s*a\s+(?:ulo[žz]|uloz|zapi[šs]|zapsat|napi[šs]|napsat|dej|vlo[žz])\s+(?:to|ho|ji|je)\s+(?:do|jako|into)\s+\S+\s*$/i,
    // CZ: "a zapis/ulož to" (conjunction, no target)
    /[,;.]?\s*a\s+(?:ulo[žz]|uloz|zapi[šs]|zapsat|napi[šs]|napsat|dej)\s+(?:to|ho|ji|je)\s*$/i,
    // EN: "save/write it/this/that to <target>"
    /[,;.]\s*(?:save|write)\s+(?:it|this|that)\s+(?:to|into)\s+\S+\s*$/i,
    // EN: "save/write it/this/that"
    /[,;.]\s*(?:save|write)\s+(?:it|this|that)\s*$/i,
    // EN: "and save/write it to <target>"
    /[,;.]?\s*and\s+(?:save|write)\s+(?:it|this|that)\s*(?:to\s+\S+)?\s*$/i,
  ];

  let extracted = input.trim();
  for (const p of SAVE_COMMAND_PATTERNS) {
    const stripped = extracted.replace(p, '').trim();
    if (stripped !== extracted) {
      extracted = stripped;
      break;
    }
  }

  // Only return if we actually stripped something AND meaningful content remains
  if (extracted === input.trim() || extracted.length < 10) return null;
  return extracted;
}

// ─── v70: FILE_WRITE handler ──────────────────────────────────────────────────

/**
 * Handle FILE_WRITE decision — saves previous assistant output to a file.
 * v131: Falls back to extracting content from user's own message when
 * no prior assistant response exists (compound intent: content + save command).
 * M2: registers an effect and returns an exact approval instruction. The
 * separate approval intercept owns execution through the canonical broker.
 */
export async function handleFileWriteDecision(input, decision, context, dependencies = {}) {
  const projectPath = context.project?.path || null;

  const langCtx = context.langCtx || getLanguageContext(input);
  const lang = langCtx?.language || 'cs';

  // 1. Determine file path
  let filePath = decision.metadata?.filePath;
  if (!filePath) {
    // Try to extract from input
    filePath = extractFilePathFromInput(input);
  }
  if (!filePath) {
    // Auto-generate filename based on timestamp
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    filePath = `output-${ts}.md`;
  }

  // 2. Get content to write — last ASSISTANT message from conversation history
  //    IMPORTANT: history contains both user and assistant turns.
  //    User turns have speaker='user', assistant turns have speaker='system'.
  //    The current user message is ALREADY in history (appended before handler),
  //    so we MUST filter by speaker to avoid writing the user's own request.
  let content = '';
  if (context.history?.length > 0) {
    for (let i = context.history.length - 1; i >= 0; i--) {
      const entry = context.history[i];
      // Skip user turns — only pick assistant (speaker='system') responses
      if (entry.response?.tag?.speaker === 'user') continue;
      const resp = entry.response?.content || entry.content;
      if (resp) {
        content = resp;
        break;
      }
    }
  }

  // v131: Fallback — extract content from user's own message when no assistant
  // response exists. Handles compound intent: content + save command in one message.
  // E.g.: "mam novy update pro aplikaci, schopna ovladat desktop, zapis to do planu"
  // → content = "mam novy update pro aplikaci, schopna ovladat desktop"
  if (!content && input) {
    const extracted = _extractUserContent(input);
    if (extracted) {
      content = extracted;
      logger.info('HandleFileWrite', 'Content extracted from user input (no prior assistant response)', {
        inputLen: input.length,
        extractedLen: extracted.length,
      });
    }
  }

  if (!content) {
    const msg = lang === 'cs'
      ? '⚠️ Není co uložit — žádná předchozí odpověď v konverzaci.'
      : '⚠️ Nothing to save — no previous response in conversation.';
    return new TaggedResponse({
      content: msg,
      tag: new ResponseTag({
        speaker: ResponseSpeaker.SYSTEM,
        mode: ChatMode.CONVERSATION,
        confidence: 0.9,
        canExecute: false,
        metadata: { decision: decision.toJSON(), handler: 'file.write', error: 'no_content' },
      }),
    });
  }

  // 3. M2 writes require a registered active project and authenticated caller.
  // There is deliberately no output-directory escape hatch on this path: every
  // production write is an EffectRequest and needs an exact ApprovalGrant.
  const projectId = Number(context.project?.id ?? context.projectId);
  const authenticatedSubject = context.authenticatedSubject;
  const hasMessageIdentity = Number.isSafeInteger(context.userMessageId) && context.userMessageId > 0;
  if (
    !projectPath
    || !Number.isSafeInteger(projectId)
    || projectId <= 0
    || !hasMessageIdentity
    || authenticatedSubject?.actorType !== 'user'
    || !authenticatedSubject.actorId
  ) {
    const msg = lang === 'cs'
      ? '🔒 Zápis vyžaduje aktivní registrovaný projekt a ověřeného uživatele.'
      : '🔒 Writing requires an active registered project and authenticated user.';
    return new TaggedResponse({
      content: msg,
      tag: new ResponseTag({
        speaker: ResponseSpeaker.SYSTEM,
        mode: ChatMode.CONVERSATION,
        confidence: 1,
        canExecute: false,
        metadata: {
          decision: decision.toJSON(),
          handler: 'file.write',
          securityBlocked: true,
          error: 'effect_authority_required',
        },
      }),
    });
  }

  // 4. Cross the same durable ToolRequest boundary as TOOL_CALL. The handler
  // never owns a filesystem syscall; canonical EffectRequest execution remains
  // behind the separate exact approval intercept.
  try {
    let executor = dependencies.toolExecutor;
    if (!executor) {
      const module = await import('../../executor/tool-executor.js');
      executor = module.toolExecutor;
    }
    if (!executor || typeof executor.executeM2Tool !== 'function') {
      throw Object.assign(new Error('M2 tool runtime is unavailable'), {
        code: 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE',
      });
    }
    const execution = await executor.executeM2Tool({
      toolId: 'file.write',
      input: { path: filePath, content },
      context,
      timeoutMs: 120_000,
    });

    if (execution.result) {
      const succeeded = execution.result.status === 'ok';
      const msg = succeeded
        ? (lang === 'cs'
          ? `✅ Zápis do **${filePath}** už byl dokončen.`
          : `✅ Write to **${filePath}** was already completed.`)
        : (lang === 'cs'
          ? `⚠️ Zápis do **${filePath}** už skončil stavem ${execution.result.status}.`
          : `⚠️ Write to **${filePath}** already ended as ${execution.result.status}.`);
      return new TaggedResponse({
        content: msg,
        tag: new ResponseTag({
          speaker: ResponseSpeaker.SYSTEM,
          mode: ChatMode.CONVERSATION,
          confidence: 1,
          canExecute: false,
          metadata: {
            decision: decision.toJSON(),
            fileOperation: succeeded,
            handler: 'file.write',
            toolRequestId: execution.request.requestId,
            effectId: execution.result.effectRequestId,
            effectState: 'terminal',
            terminalStatus: execution.result.status,
            approvalRequired: false,
            filePath,
          },
        }),
      });
    }

    if (execution.state !== 'approval_required' || !execution.effectRequestId) {
      throw Object.assign(new Error('M2 tool runtime returned no terminal or approval authority'), {
        code: 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE',
      });
    }

    const msg = lang === 'cs'
      ? `🔐 Zápis do **${filePath}** čeká na schválení. Napiš přesně: \`schválit efekt ${execution.effectRequestId}\``
      : `🔐 Write to **${filePath}** awaits approval. Enter exactly: \`approve effect ${execution.effectRequestId}\``;

    logger.info('HandleFileWrite', 'Filesystem effect registered for approval', {
      effectId: execution.effectRequestId,
      projectId,
      filePath,
      size: Buffer.byteLength(content, 'utf8'),
    });

    return new TaggedResponse({
      content: msg,
      tag: new ResponseTag({
        speaker: ResponseSpeaker.SYSTEM,
        mode: ChatMode.CONVERSATION,
        confidence: 0.95,
        canExecute: false,
        metadata: {
          decision: decision.toJSON(),
          fileOperation: false,
          handler: 'file.write',
          toolRequestId: execution.request.requestId,
          effectId: execution.effectRequestId,
          effectState: execution.state,
          approvalRequired: true,
          filePath,
          fileSize: Buffer.byteLength(content, 'utf8'),
          fileLines: content.split('\n').length,
        },
      }),
    });
  } catch (err) {
    logger.error('HandleFileWrite', `Effect preparation failed: ${err.message}`, {
      filePath,
      code: err.code || null,
    });
    const msg = lang === 'cs'
      ? `❌ Zápis do **${filePath}** nebyl autorizován: ${err.message}`
      : `❌ Write to **${filePath}** was not authorized: ${err.message}`;
    return new TaggedResponse({
      content: msg,
      tag: new ResponseTag({
        speaker: ResponseSpeaker.SYSTEM,
        mode: ChatMode.CONVERSATION,
        confidence: 0.8,
        canExecute: false,
        metadata: {
          decision: decision.toJSON(),
          handler: 'file.write',
          error: err.code || 'effect_prepare_failed',
        },
      }),
    });
  }
}

// Testing exports
export { validateFilePath, extractFilePathFromInput, _extractUserContent };

/**
 * Extract file path from user input (exported for testing).
 * Same logic as extractFilePath in cre-decision.js.
 */
function extractFilePathFromInput(input) {
  const quoted = input.match(/["']([^"']+\.\w{1,10})["']/);
  if (quoted) return quoted[1];

  const tokens = input.split(/\s+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i].replace(/[,;:!?]+$/, '');
    if (/^[\w./-]+\.\w{1,10}$/.test(t) && !['mi', 'si', 'ti'].includes(t.toLowerCase())) {
      return t;
    }
    // Dotfile: .env, .gitignore, .bashrc, .env.local (no extension required)
    if (/^\.\w[\w.-]*$/.test(t)) {
      return t;
    }
  }

  const afterKeyword = input.match(/(?:soubor|file)\s+["']?([^\s"']+\.\w{1,10})["']?/i);
  if (afterKeyword) return afterKeyword[1];

  // Dotfile after keyword: "soubor .env"
  const afterKeywordDotfile = input.match(/(?:soubor|file)\s+["']?(\.[\w.-]+)["']?/i);
  if (afterKeywordDotfile) return afterKeywordDotfile[1];

  return null;
}

// Root listing formatting shares the existing handler boundary to avoid a new controller cycle.
function reject(code) {
  throw Object.assign(new Error('The stored project listing cannot be verified'), { code });
}

function literal(value) {
  const visible = String(value).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,
    character => `\\u{${character.codePointAt(0).toString(16)}}`);
  let longest = 0;
  for (const match of visible.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const delimiter = '`'.repeat(longest + 1);
  return `${delimiter} ${visible} ${delimiter}`;
}

function matchesCurrentOrigin(request, context) {
  const projectId = context?.project?.id ?? context?.projectId;
  return Number.isSafeInteger(projectId) && projectId > 0
    && projectId === request?.origin?.projectId
    && request?.actor?.type === 'user'
    && request.actor.type === context?.authenticatedSubject?.actorType
    && request.actor.id === context?.authenticatedSubject?.actorId
    && request.origin.conversationId === m2FileListConversationOrigin(String(context?.conversationId ?? ''));
}

export function exactM2FileListApprovalPreview(execution, context, lang = 'cs') {
  const request = execution?.request;
  const effect = execution?.effectRequest;
  const binding = request?.effectBinding;
  const valid = execution?.state === 'approval_required' && execution.result === null
    && validateM2ToolRequest(request).valid && request.toolId === 'file.list' && request.toolVersion === 2
    && matchesCurrentOrigin(request, context) && request.input.path === '.'
    && isM2FileListOutputRequest(effect)
    && effect.effectId === execution.effectRequestId && effect.runId === request.runId
    && isDeepStrictEqual(effect.actor, request.actor) && isDeepStrictEqual(effect.origin, request.origin)
    && binding?.kind === effect.kind && binding.requiredCapability === effect.requiredCapability
    && binding.riskClass === effect.riskClass && binding.payloadDigest === effect.payloadDigest
    && binding.payloadBytes === effect.payloadBytes && binding.target?.type === effect.target.type
    && binding.target.relativePath === '.' && effect.target.relativePath === '.'
    && effect.idempotencyKey === `operation:${createHash('sha256').update(request.requestId, 'utf8').digest('hex')}`;
  if (!valid) reject('TOOL_LIST_APPROVAL_PREVIEW_INVALID');
  if (context?.signal?.aborted) reject('TOOL_LIST_CANCELLED');
  const root = literal(effect.target.canonicalRoot);
  const command = literal(`approve effect ${effect.effectId}`);
  const content = lang === 'cs'
    ? `🔐 Výpis kořene projektu ${request.origin.projectId} (${root}) čeká na schválení. Zobrazí jména a typy přímých potomků, včetně skrytých položek. Nejvýše ${M2_FILE_LIST_MAX_ENTRIES} položek a ${M2_FILE_LIST_MAX_BYTES} bajtů (1 MiB); bez čtení obsahu souborů, rekurze a následování odkazů. Při překročení limitu výpis selže místo neúplného výsledku.\n\nPro schválení napiš ${command}.`
    : `🔐 Listing project ${request.origin.projectId} root (${root}) awaits approval. It returns direct-child names and types, including hidden entries. At most ${M2_FILE_LIST_MAX_ENTRIES} entries and ${M2_FILE_LIST_MAX_BYTES} bytes (1 MiB); no file contents, recursion or symlink following. Exceeding a limit fails instead of returning an incomplete listing.\n\nTo approve, enter ${command}.`;
  return { content, metadata: {
    handler: 'file.list', projectId: request.origin.projectId,
    projectRoot: effect.target.canonicalRoot, filePath: '.',
    listMaxEntries: M2_FILE_LIST_MAX_ENTRIES, listMaxBytes: M2_FILE_LIST_MAX_BYTES,
    recursive: false, approvalPreviewVerified: true,
  } };
}

function displayName(entry, lang) {
  const raw = Buffer.from(entry.nameBase64, 'base64');
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
    if (!Buffer.from(text, 'utf8').equals(raw)) throw new Error('Non-text name');
    return literal(text);
  } catch {
    return `${lang === 'cs' ? 'Jméno mimo UTF-8' : 'Non-UTF-8 name'} (${literal(`hex:${raw.toString('hex')}`)})`;
  }
}

export function renderM2FileListResult(execution, context, {
  toolExecutor, decision = null, expectedEffectId = null,
} = {}) {
  const lang = context?.langCtx?.language || 'cs';
  const requestId = execution?.request?.requestId || null;
  const effectId = execution?.result?.effectRequestId || execution?.effectRequestId || null;
  const metadata = { handler: 'file.list', fileOperation: false, fallbackSuppressed: true,
    approvalRequired: false, toolRequestId: requestId, effectId,
    ...(decision ? { decision: decision.toJSON() } : {}) };
  try {
    if (context?.signal?.aborted) reject('TOOL_LIST_CANCELLED');
    if (!validateM2ToolRequest(execution?.request).valid
      || execution.request.toolId !== 'file.list' || execution.request.toolVersion !== 2
      || !matchesCurrentOrigin(execution.request, context)
      || execution.request.input.path !== '.'
      || execution.result?.status !== 'ok' || !effectId
      || (expectedEffectId !== null && expectedEffectId !== effectId)
      || typeof toolExecutor?.resolveM2FileListContent !== 'function') {
      reject('TOOL_LIST_CONTENT_AUTHORITY_REQUIRED');
    }
    const contentRef = execution.result.output?.contentRef;
    const resolved = toolExecutor.resolveM2FileListContent({ requestId, contentRef, context });
    const { bytes, output, request, result } = resolved || {};
    if (context?.signal?.aborted) reject('TOOL_LIST_CANCELLED');
    const exact = Buffer.isBuffer(bytes) && validateM2ToolResult(result).valid
      && isDeepStrictEqual(request, execution.request) && isDeepStrictEqual(result, execution.result)
      && isDeepStrictEqual(output, result.output)
      && request.requestId === requestId && result.requestId === requestId
      && result.status === 'ok' && result.toolId === 'file.list' && result.toolVersion === 2
      && result.runId === request.runId && result.projectId === request.origin.projectId
      && result.requestDigest === computeM2ToolRequestDigest(request)
      && result.outputDigest === computeM2ToolValueDigest(output)
      && result.effectRequestId === effectId && resolved.effectId === effectId
      && output?.format === 'root-entries@1' && output.path === '.' && resolved.path === '.'
      && output.contentRef === contentRef && contentRef === m2FileListOutputEvidenceRef(effectId)
      && output.byteLength === bytes.length
      && output.contentDigest === `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (!exact) reject('TOOL_LIST_CONTENT_MISMATCH');
    const { value } = parseM2FileListSnapshot(bytes);
    const labels = lang === 'cs'
      ? { file: 'soubor', directory: 'adresář', symlink: 'symbolický odkaz', special: 'zvláštní položka' }
      : { file: 'file', directory: 'directory', symlink: 'symlink', special: 'special entry' };
    const rows = value.entries.map(entry => `- ${displayName(entry, lang)} — ${labels[entry.type]}`);
    const heading = lang === 'cs'
      ? `📁 Uložený výpis kořene projektu ${request.origin.projectId}: ${rows.length} položek.`
      : `📁 Stored project ${request.origin.projectId} root listing: ${rows.length} entries.`;
    const note = lang === 'cs'
      ? 'Jde o uložený okamžik pozorování přímých potomků; adresář se při zobrazení znovu neprocházel.'
      : 'This is the stored direct-child observation; displaying it did not enumerate the directory again.';
    const empty = lang === 'cs' ? 'V okamžiku pozorování byl kořen prázdný.' : 'The root was empty when observed.';
    return new TaggedResponse({ content: `${heading}\n\n${rows.length ? rows.join('\n') : empty}\n\n${note}`,
      tag: new ResponseTag({ speaker: ResponseSpeaker.SYSTEM,
        mode: context.hasActiveProject ? ChatMode.PROJECT : ChatMode.CONVERSATION,
        confidence: 1, canExecute: false, metadata: { ...metadata, fileOperation: true,
          securityBlocked: false, filePath: '.', projectId: request.origin.projectId,
          entryCount: rows.length, recursive: false, complete: true,
          contentRef, contentDigest: output.contentDigest, error: null } }) });
  } catch (error) {
    const cancelled = error.code === 'TOOL_LIST_CANCELLED';
    const content = cancelled
      ? (lang === 'cs' ? 'Zobrazení výpisu bylo zrušeno.' : 'Displaying the listing was cancelled.')
      : (lang === 'cs' ? 'Ověřený uložený výpis projektu nelze bezpečně zobrazit. Adresář se znovu neprocházel.'
        : 'The verified stored project listing cannot safely be displayed. The directory was not enumerated again.');
    return new TaggedResponse({ content, tag: new ResponseTag({ speaker: ResponseSpeaker.SYSTEM,
      mode: context?.hasActiveProject ? ChatMode.PROJECT : ChatMode.CONVERSATION,
      confidence: 1, canExecute: false, metadata: { ...metadata, securityBlocked: !cancelled,
        cancelled, error: error.code || 'TOOL_LIST_CONTENT_UNAVAILABLE' } }) });
  }
}
