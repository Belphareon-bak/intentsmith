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
import fs from 'fs/promises';
import path from 'path';

// ─── Security constants ──────────────────────────────────────────────────────

const MAX_FILE_SIZE = 512 * 1024; // 512 KB
const MAX_DISPLAY_LINES = 200;    // Truncate display after this many lines
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

// ─── File reading ────────────────────────────────────────────────────────────

/**
 * Read a file safely with size guard.
 * @param {string} resolvedPath — Absolute path (already validated)
 * @returns {{ content: string, size: number, lines: number, truncated: boolean, error?: string }}
 */
async function readFileSafe(resolvedPath) {
  try {
    const stat = await fs.stat(resolvedPath);

    if (stat.isDirectory()) {
      // List directory contents instead
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
      const listing = entries.map(e =>
        `${e.isDirectory() ? '📁' : '📄'} ${e.name}`
      ).join('\n');
      return {
        content: listing,
        size: stat.size,
        lines: entries.length,
        truncated: false,
        isDirectory: true,
      };
    }

    if (stat.size > MAX_FILE_SIZE) {
      return {
        content: '',
        size: stat.size,
        lines: 0,
        truncated: true,
        error: `file_too_large:${stat.size}`,
      };
    }

    const content = await fs.readFile(resolvedPath, 'utf-8');
    const lines = content.split('\n');
    const truncated = lines.length > MAX_DISPLAY_LINES;
    const displayContent = truncated
      ? lines.slice(0, MAX_DISPLAY_LINES).join('\n') + `\n\n... (zkráceno, celkem ${lines.length} řádků)`
      : content;

    return {
      content: displayContent,
      size: stat.size,
      lines: lines.length,
      truncated,
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { content: '', size: 0, lines: 0, truncated: false, error: 'file_not_found' };
    }
    if (err.code === 'EACCES') {
      return { content: '', size: 0, lines: 0, truncated: false, error: 'permission_denied' };
    }
    return { content: '', size: 0, lines: 0, truncated: false, error: err.message };
  }
}

// ─── Response formatting ─────────────────────────────────────────────────────

function formatFileReadResponse(filePath, result, lang = 'cs') {
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
    js: 'javascript', ts: 'typescript', py: 'python', rb: 'ruby',
    sh: 'bash', yml: 'yaml', md: 'markdown', json: 'json',
    html: 'html', css: 'css', sql: 'sql', rs: 'rust', go: 'go',
    java: 'java', cpp: 'cpp', c: 'c', jsx: 'jsx', tsx: 'tsx',
    xml: 'xml', toml: 'toml', ini: 'ini', conf: 'conf',
  };
  const codeLang = langMap[ext] || ext || '';

  const header = lang === 'cs'
    ? `📄 **${filename}** (${result.lines} řádků, ${Math.round(result.size / 1024) || '<1'} KB)`
    : `📄 **${filename}** (${result.lines} lines, ${Math.round(result.size / 1024) || '<1'} KB)`;

  return `${header}\n\n\`\`\`${codeLang}\n${result.content}\n\`\`\``;
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

// ─── Main handler ────────────────────────────────────────────────────────────

/**
 * Handle FILE_READ and FILE_EXPLAIN decisions — TERMINAL
 */
export async function handleFileDecision(input, decision, context) {
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
    // Read the file from disk
    result = await readFileSafe(validation.resolved);
  }

  // Record decision
  if (sessionState) {
    sessionState.recordDecision(decision, input);
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

// ─── v70: FILE_WRITE handler ──────────────────────────────────────────────────

/**
 * Handle FILE_WRITE decision — saves previous assistant output to a file.
 * TERMINAL: writes to filesystem, returns confirmation.
 */
export async function handleFileWriteDecision(input, decision, context) {
  const projectPath = decision.metadata?.projectScope?.projectPath
    || context.project?.path
    || process.cwd();

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

  // 3. Security validation — reuse existing validateFilePath
  const validation = validateFilePath(filePath, projectPath);
  if (!validation.safe) {
    const msg = formatSecurityBlock(filePath, validation.reason, lang);
    return new TaggedResponse({
      content: msg,
      tag: new ResponseTag({
        speaker: ResponseSpeaker.SYSTEM,
        mode: ChatMode.CONVERSATION,
        confidence: 0.95,
        canExecute: false,
        metadata: { decision: decision.toJSON(), handler: 'file.write', securityBlocked: true, reason: validation.reason },
      }),
    });
  }

  // 4. Write the file
  try {
    // Ensure parent directory exists
    const dir = path.dirname(validation.resolved);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(validation.resolved, content, 'utf-8');

    const sizeKB = Math.round(Buffer.byteLength(content, 'utf-8') / 1024) || '<1';
    const lines = content.split('\n').length;
    const msg = lang === 'cs'
      ? `✅ Uloženo do **${filePath}** (${lines} řádků, ${sizeKB} KB)\n\nCesta: \`${validation.resolved}\``
      : `✅ Saved to **${filePath}** (${lines} lines, ${sizeKB} KB)\n\nPath: \`${validation.resolved}\``;

    logger.info('HandleFileWrite', `File written successfully`, {
      filePath: validation.resolved,
      size: Buffer.byteLength(content, 'utf-8'),
      lines,
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
          fileOperation: true,
          handler: 'file.write',
          filePath: validation.resolved,
          fileSize: Buffer.byteLength(content, 'utf-8'),
          fileLines: lines,
        },
      }),
    });
  } catch (err) {
    logger.error('HandleFileWrite', `File write failed: ${err.message}`, { filePath: validation.resolved });
    const msg = lang === 'cs'
      ? `❌ Chyba při zápisu do **${filePath}**: ${err.message}`
      : `❌ Error writing to **${filePath}**: ${err.message}`;
    return new TaggedResponse({
      content: msg,
      tag: new ResponseTag({
        speaker: ResponseSpeaker.SYSTEM,
        mode: ChatMode.CONVERSATION,
        confidence: 0.8,
        canExecute: false,
        metadata: { decision: decision.toJSON(), handler: 'file.write', error: err.message },
      }),
    });
  }
}

// Testing exports
export { validateFilePath, readFileSafe, extractFilePathFromInput };

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
