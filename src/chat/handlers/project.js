// Project Handler — extracted from handlers.js
// Handles PROJECT mode - code-focused work
//
// v56.2 Sprint D: Project-self query interceptor
//   - "Jaký je stav projektu?" → working memory, NOT web search
//   - Detected BEFORE CRE routing to avoid DDG search for internal queries

import { ResponseTag, TaggedResponse, ResponseSpeaker, ChatMode } from '../controller.js';
import {
  creDecisionEngine,
  DecisionType,
  IntentType,
  assertDecision,
} from '../cre-decision.js';
import { logger } from '../../core/logger.js';
import {
  handleToolCallDecision,
  handleAskUserDecision,
  handleAnswerDecision,
  handleRefuseDecision,
} from './decisions.js';
import { handleFileDecision, handleFileWriteDecision } from './file.js';
import { handleLocalDecision } from './local.js';
import { handleShellDecision } from './conversation.js';
import { config } from '../../config.js';
import { readdirSync } from 'fs';
import { extname } from 'path';

// ─── Phase C: Build handoff (lazy-loaded, null if lifecycle disabled) ───────
let handleBuildDetected = null;
let handleBuildConfirmed, handleClarificationAnswer,
    handlePlanVerdict, getActiveBuildHandoff, cancelBuildHandoff;

// Phase C: Lifecycle handoff (project lifecycle)
let getActiveLifecycleHandoff, cancelLifecycleHandoff, handleLifecycleInput;

if (config.features.lifecycle !== false) {
  try {
    const bh = await import('./build-handoff.js');
    handleBuildDetected = bh.handleBuildDetected;
    handleBuildConfirmed = bh.handleBuildConfirmed;
    handleClarificationAnswer = bh.handleClarificationAnswer;
    handlePlanVerdict = bh.handlePlanVerdict;
    getActiveBuildHandoff = bh.getActiveBuildHandoff;
    cancelBuildHandoff = bh.cancelBuildHandoff;
  } catch (err) {
    logger.warn('ProjectHandler', `Build handoff not available: ${err.message}`);
  }

  try {
    const lh = await import('./lifecycle-handoff.js');
    getActiveLifecycleHandoff = lh.getActiveLifecycleHandoff;
    cancelLifecycleHandoff = lh.cancelLifecycleHandoff;
    handleLifecycleInput = lh.handleLifecycleInput;
  } catch (err) {
    logger.warn('ProjectHandler', `Lifecycle handoff not available: ${err.message}`);
  }
}

/** Build a quick system TaggedResponse (shorthand for intercept returns) */
function systemResponse(content, metadata = {}, confidence = 1.0) {
  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.PROJECT,
    confidence,
    canExecute: false,
    metadata,
  });
  return new TaggedResponse({ content, tag });
}

// ════════════════════════════════════════════════════════════════════════════════
// v56.2 Sprint D: PROJECT_SELF_PATTERNS (#8)
// ════════════════════════════════════════════════════════════════════════════════
// Queries about the project itself — status, goal, files, progress.
// These should be answered from working memory, NOT from web search.
// Must be checked BEFORE CRE routing.
//
// Examples:
//   "Jaký je stav projektu?" → working memory
//   "Co je cíl tohoto projektu?" → working memory
//   "Na čem pracujeme?" → working memory
//   "Najdi článek o X" → NOT intercepted, routes to CRE → web search
// ════════════════════════════════════════════════════════════════════════════════

const PROJECT_SELF_PATTERNS = [
  // Czech: project status/info queries
  /(?:jaký|jaká|jaké) je stav projektu/i,
  /stav projektu/i,
  /(?:co|jaký|jaká) je cíl (?:tohoto |)projektu/i,
  /cíl projektu/i,
  // v87: "v jaké fázi projektu jsme?" — lifecycle phase queries
  /(?:v |)jak[ée] f[áa]zi (?:(?:tohoto |)projektu|jsme)/i,
  /f[áa]z[ei] projektu/i,
  /kde (?:jsme|se nach[áa]z[ií]me) (?:v |s |)projekt/i,
  /(?:jak|kde) daleko jsme/i,
  /na čem (?:pracujeme|děláme|pracuji)/i,
  /(?:co|jak) (?:děláme|dělám) (?:v |na |)(?:tomto |)projekt/i,
  /(?:shrň|shrnout|popiš) projekt/i,
  /(?:info|informace) o projektu/i,
  /co je (?:v |)(?:tomto |)projektu/i,
  // v65.5: "o čem je (tento) projekt?" — locative form of "co"
  /o\s+[čc][eě]m\s+je\s+(?:tento\s+|ten\s+|tenhle\s+)?projekt/i,
  /[čc][eě]mu\s+se\s+(?:tento\s+|ten\s+|tenhle\s+)?projekt\s+v[eě]nuje/i,
  /[čc][ií]m\s+se\s+(?:tento\s+|ten\s+|tenhle\s+)?projekt\s+zab[ýy]v[áa]/i,
  /aktivní soubor/i,
  /na jakém souboru/i,
  // English: project status/info queries
  /(?:what is |what's )(?:the )?(?:project |)status/i,
  /(?:what is |what's )(?:the )?(?:project |)goal/i,
  /what are we (?:working on|doing)/i,
  /(?:project |)(?:summary|overview|info)/i,
  /(?:describe|summarize) (?:the |this |)project/i,
  /active file/i,
  /which files? (?:are|is)/i,
];

/**
 * Check if input is a project-self query (about the project itself).
 * @param {string} input
 * @returns {boolean}
 */
function isProjectSelfQuery(input) {
  return PROJECT_SELF_PATTERNS.some(p => p.test(input));
}

/**
 * Build a response from project working memory + project info.
 * No web search, no LLM call — pure data assembly.
 *
 * @param {string} input - User query
 * @param {Object} project - Project object { id, name, path, scope }
 * @param {Object} workingMemory - { goal, activeFile, lastArtifactId, driftCount }
 * @param {Object} context - Full context
 * @returns {TaggedResponse}
 */
function buildProjectStatusResponse(input, project, workingMemory, context) {
  const parts = [];

  parts.push(`📂 **${project.name}**`);
  if (project.path) parts.push(`Cesta: \`${project.path}\``);
  if (project.scope) parts.push(`Scope: ${project.scope}`);

  if (workingMemory?.goal) {
    parts.push(`\n🎯 **Cíl:** ${workingMemory.goal}`);
  } else {
    parts.push(`\n🎯 **Cíl:** Zatím nenastavený. Zadejte cíl pro lepší navigaci.`);
  }

  if (workingMemory?.activeFile) {
    parts.push(`📄 **Aktivní soubor:** \`${workingMemory.activeFile}\``);
  }

  if (workingMemory?.lastArtifactId) {
    parts.push(`🔧 **Poslední artefakt:** ${workingMemory.lastArtifactId}`);
  }

  if (workingMemory?.driftCount > 0) {
    parts.push(`⚠️ **Drift count:** ${workingMemory.driftCount} (odchylky od cíle)`);
  }

  // v88.2: Enrich with cached project analysis (structure, stack, git, etc.)
  if (context.projectAnalysis) {
    // Extract key sections from the analysis text for a concise summary
    const analysis = context.projectAnalysis;
    const structureMatch = analysis.match(/### Source Structure\n([\s\S]*?)(?=\n###|$)/);
    const gitMatch = analysis.match(/### Git\n([\s\S]*?)(?=\n###|$)/);
    const pkgMatch = analysis.match(/### package\.json\n([\s\S]*?)(?=\n###|$)/);

    const analysisParts = [];
    if (pkgMatch) analysisParts.push(pkgMatch[1].trim());
    if (structureMatch) analysisParts.push(structureMatch[1].trim());
    if (gitMatch) analysisParts.push(gitMatch[1].trim());

    if (analysisParts.length > 0) {
      parts.push(`\n📊 **Analýza projektu:**\n${analysisParts.join('\n')}`);
    }
  }

  // History summary if available
  const historyLen = context.history?.length || 0;
  if (historyLen > 0) {
    parts.push(`\n💬 **Konverzace:** ${historyLen} zpráv v této session`);
  }

  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.PROJECT,
    confidence: 1.0,
    canExecute: false,
    metadata: {
      decision: { type: 'ANSWER', reason: 'PROJECT_SELF_QUERY' },
      source: 'working_memory',
      intercepted: true,  // v56.2: marks that CRE was bypassed
    },
  });

  return new TaggedResponse({
    content: parts.join('\n'),
    tag,
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// FILE INTENT HEURISTIC — dynamic detection (replaces static CRE phrases)
// ════════════════════════════════════════════════════════════════════════════════
// Instead of adding regex patterns for every Czech morphological form,
// this matches user input tokens against ACTUAL files in the project directory.
//
//   "co je v readme?"  → token "readme" matches README.md → FILE_READ
//   "co za soubory je v tomto projektu?" → file-signal + project ref → dir listing
//   "najdi článek o AI" → no file match, no signal → falls through to CRE
// ════════════════════════════════════════════════════════════════════════════════

const _dirCache = new Map();
const DIR_CACHE_TTL = 10000; // 10s

function _getProjectFiles(projectPath) {
  if (!projectPath) return [];
  const cached = _dirCache.get(projectPath);
  if (cached && Date.now() - cached.ts < DIR_CACHE_TTL) return cached.files;
  try {
    const entries = readdirSync(projectPath, { withFileTypes: true });
    const files = entries.map(e => e.name);
    _dirCache.set(projectPath, { files, ts: Date.now() });
    return files;
  } catch {
    return [];
  }
}

// Common words to skip when matching tokens against filenames
const _SKIP_TOKENS = new Set([
  // Czech
  'a','i','v','k','z','o','u','s','na','do','ze','za','po','od',
  'co','to','je','se','si','mi','ti','me','te','ho','mu','ji','ni',
  'ja','ty','on','my','vy','ne','az','uz','by','ale','ani','tak','jak',
  'pro','pri','pre','pod','nad','ten','tou','tom','tem','at',
  'kde','kdy','kdo','kam','jen','jiz','pak','tam','sem','ted',
  'ano','ok','hm','jeste','potom','proto','prece',
  'tohoto','toho','teto','tento','tenhle','tomto',
  'projektu','projekt','projektem','soubor','soubory','souboru',
  'obsah','obsahuje','obsahem','otevri','ukaz','zobraz','precti',
  'vysvetli','popis','adresari','adresar','slozka','slozku',
  'jake','jaky','jaka','ktere','ktery','ktera',
  // English
  'the','is','in','it','of','to','and','or','but','for',
  'this','that','with','from','not','are','was','has','have',
  'what','how','why','when','where','who','can','do','does',
  'show','list','open','read','file','files','display','tell','me',
]);

/**
 * Detect file-related intent by matching input against actual project files.
 * Dynamic — works with any project, any language form.
 *
 * @param {string} input
 * @param {string} projectPath
 * @returns {{ detected: boolean, filePath: string|null, reason: string|null }}
 */
function detectFileIntent(input, projectPath) {
  // NFD normalize + strip diacritics for token matching
  const stripped = input.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const tokens = stripped.split(/[\s,;:!?.()[\]{}"']+/).filter(Boolean);

  // ── 1. Match tokens against actual project files ──────────────────────────
  const files = _getProjectFiles(projectPath);
  if (files.length > 0) {
    const filesLower = files.map(f => f.toLowerCase());
    const basenames = files.map(f => {
      const ext = extname(f);
      return ext ? f.slice(0, -ext.length).toLowerCase() : f.toLowerCase();
    });

    for (const token of tokens) {
      if (token.length < 2 || _SKIP_TOKENS.has(token)) continue;

      // Direct match: "package.json" → package.json
      const di = filesLower.indexOf(token);
      if (di >= 0) return { detected: true, filePath: files[di], reason: `token→file:${files[di]}` };

      // Basename match: "readme" → README.md
      const bi = basenames.indexOf(token);
      if (bi >= 0) return { detected: true, filePath: files[bi], reason: `token→base:${files[bi]}` };
    }
  }

  // ── 2. "list files/contents" + project reference → directory listing ──────
  const hasFileSignal = /soubor|obsah|struktur|adres|slozk|files|directory|contents|folder|tree|listing/i.test(stripped);
  const hasProjectRef = /projekt|project|tomto|tady|zde|here|this/i.test(stripped);

  if (hasFileSignal && hasProjectRef) {
    return { detected: true, filePath: '.', reason: 'file-signal+project-ref' };
  }

  // ── 3. "co je v" / "what's in" + project reference (no explicit file word) ─
  if (/co\s+je|co\s+tam|what'?s?\s+in|ukaz|zobraz|show|list/i.test(stripped) &&
      hasProjectRef && tokens.length <= 10) {
    return { detected: true, filePath: '.', reason: 'content-query+project-ref' };
  }

  return { detected: false, filePath: null, reason: null };
}

export async function projectHandler(input, context) {
  const { sessionId, project } = context;

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 1: Project IS selected - route through CRE with CODE context
  // ════════════════════════════════════════════════════════════════════════════

  if (project && project.id) {
    logger.info('ProjectHandler', `Project active: ${project.name}`, {
      projectId: project.id,
      scope: project.scope || 'project',
    });

    // ════════════════════════════════════════════════════════════════════════
    // v88: BUILD HANDOFF INTERCEPT — route messages during active Planner flow
    // (mirrored from conversation.js — Phase C)
    // ════════════════════════════════════════════════════════════════════════
    const activeHandoff = getActiveBuildHandoff ? getActiveBuildHandoff(sessionId) : null;
    if (activeHandoff) {
      if (typeof context.onSystemStep === 'function') {
        try { context.onSystemStep('build_handoff', `phase: ${activeHandoff.phase}`, 2); } catch (_) {}
      }
      creDecisionEngine.logIntercept('build_handoff', `Active build handoff (phase: ${activeHandoff.phase}) — routing to build handler [PROJECT]`, {
        sessionId, phase: activeHandoff.phase,
      });
      if (/^(zrušit?|cancel|stop|zpět|back)\s*[!.]?$/i.test(input.trim())) {
        cancelBuildHandoff(sessionId);
        return systemResponse('Build zrušen. Jsem zpět v projektu.', { buildCancelled: true });
      }
      switch (activeHandoff.phase) {
        case 'PROPOSED': {
          const isYes = /^(ano|jo|ok|yes|jdi|jasně?|sure|build|stavět|start)\s*[!.]?$/i.test(input.trim());
          const isNo = /^(ne|no|nechci|cancel|zrušit?)\s*[!.]?$/i.test(input.trim());
          if (isYes) return await handleBuildConfirmed(input, context);
          if (isNo) {
            cancelBuildHandoff(sessionId);
            return systemResponse('OK, zůstáváme v projektu.', { buildCancelled: true });
          }
          return systemResponse('Chceš spustit Planner pipeline? (ano/ne)', { buildConfirmation: true }, 0.9);
        }
        case 'CLARIFYING':
          return await handleClarificationAnswer(input, context);
        case 'PLAN_REVIEW':
          return await handlePlanVerdict(input, context);
        case 'EXECUTING':
          return systemResponse('Pipeline právě běží, počkej na výsledek...', { pipelineRunning: true }, 0.9);
        default:
          cancelBuildHandoff(sessionId);
          break;
      }
    }
    // ════════════════════════════════════════════════════════════════════════

    // ════════════════════════════════════════════════════════════════════════
    // v88: C4 LIFECYCLE AUTO-DETECT — detect active lifecycle for this project
    // (mirrored from conversation.js — fixes lifecycle unreachable from PROJECT mode)
    // ════════════════════════════════════════════════════════════════════════
    if (getActiveLifecycleHandoff && !getActiveLifecycleHandoff(sessionId)) {
      if (config.features.lifecycle !== false) {
        try {
          const { getLcStateByProject, setLcState: setLcS, bindSessionToLifecycle: bindS } =
              await import('./lifecycle-state.js');

          // A) RAM lookup by projectId — fast path (catches sessionId mismatch)
          const existing = getLcStateByProject(project.id);
          if (existing && existing.state.phase !== 'COMPLETED' && existing.state.phase !== 'FAILED') {
            setLcS(sessionId, { ...existing.state });
            if (existing.state.lifecycleId) bindS(sessionId, existing.state.lifecycleId);
            logger.info('ProjectHandler', `C4: Lifecycle state migrated from ${existing.sessionId} to ${sessionId} for project ${project.id}`);
          } else {
            // B) DB fallback — restore from DB when RAM has no match
            const { lifecycles: lcRepo, lifecycleHandoffState: lhsRepo, projects: projRepo } = await import('../../db/database.js');
            const activeLc = lcRepo.findActiveByProject.get(project.id);
            if (activeLc && activeLc.phase !== 'COMPLETED' && activeLc.phase !== 'FAILED') {
              const prev = activeLc.active_session_id && lhsRepo
                ? lhsRepo.findBySession.get(activeLc.active_session_id) : null;
              let resolvedPath = project.path || prev?.project_path;
              if (!resolvedPath) {
                const proj = projRepo.findById.get(project.id);
                if (proj?.path) resolvedPath = proj.path;
              }
              setLcS(sessionId, {
                phase: activeLc.phase,
                lifecycleId: activeLc.id,
                currentMilestoneId: prev?.current_milestone_id || null,
                originalRequest: prev?.original_request || '',
                projectId: activeLc.project_id,
                projectPath: resolvedPath,
              });
              bindS(sessionId, activeLc.id);
              logger.info('ProjectHandler', `C4: Auto-detected active lifecycle ${activeLc.id} for project ${project.id}`);
            }
          }
        } catch (err) {
          logger.debug('ProjectHandler', `Lifecycle auto-detect: ${err.message}`);
        }
      }
    }
    // ════════════════════════════════════════════════════════════════════════

    // ════════════════════════════════════════════════════════════════════════
    // v88: LIFECYCLE HANDOFF INTERCEPT — route messages during active lifecycle
    // (mirrored from conversation.js — previously only reachable in CONVERSATION mode)
    // ════════════════════════════════════════════════════════════════════════
    const activeLifecycle = getActiveLifecycleHandoff ? getActiveLifecycleHandoff(sessionId) : null;
    if (activeLifecycle) {
      if (typeof context.onSystemStep === 'function') {
        try { context.onSystemStep('lifecycle', `phase: ${activeLifecycle.phase}`, 2); } catch (_) {}
      }
      creDecisionEngine.logIntercept('lifecycle_handoff', 'Active lifecycle handoff — routing to lifecycle handler [PROJECT]', {
        sessionId, phase: activeLifecycle.phase,
      });
      if (/^(zru[sš]it?|cancel|stop)\s*[!.]?$/i.test(input.trim())) {
        cancelLifecycleHandoff(sessionId);
        return systemResponse('Lifecycle zrušen. Jsem zpět v projektu.', { lifecycleCancelled: true });
      }
      const lcResult = await handleLifecycleInput(input, context);
      if (lcResult) return lcResult;
    }
    // ════════════════════════════════════════════════════════════════════════

    // ════════════════════════════════════════════════════════════════════════
    // v56.2 Sprint D: PROJECT-SELF QUERY INTERCEPTOR (#8)
    // ════════════════════════════════════════════════════════════════════════
    // "Jaký je stav projektu?" → working memory response, NO web search.
    // Must run BEFORE CRE routing — otherwise CRE classifies as SEARCH
    // and DDG gets "Jaký je stav projektu?" (nonsense web query).
    // ════════════════════════════════════════════════════════════════════════
    if (isProjectSelfQuery(input)) {
      logger.info('ProjectHandler', 'Project-self query intercepted (bypassing CRE)', {
        input: input.substring(0, 60),
        projectId: project.id,
      });
      return buildProjectStatusResponse(
        input,
        project,
        context.projectWorkingMemory || {},
        context
      );
    }

    // ════════════════════════════════════════════════════════════════════════
    // FILE INTENT HEURISTIC — pre-CRE dynamic detection
    // ════════════════════════════════════════════════════════════════════════
    // Matches input tokens against actual files in the project directory.
    // "co je v readme?" → "readme" matches README.md → FILE_READ.
    // Runs BEFORE CRE to avoid misclassification of file queries.
    // ════════════════════════════════════════════════════════════════════════
    if (project.path) {
      const fileDetect = detectFileIntent(input, project.path);
      if (fileDetect.detected) {
        logger.info('ProjectHandler', 'File intent detected by heuristic (bypassing CRE)', {
          input: input.substring(0, 60),
          filePath: fileDetect.filePath,
          reason: fileDetect.reason,
        });

        const fileDecision = creDecisionEngine.overrideDecision({
          type: DecisionType.LOCAL,
          intent: IntentType.FILE_READ,
          tools: ['file.read'],
          source: 'project_file_heuristic',
          reason: fileDetect.reason,
          confidence: 0.9,
          metadata: {
            handler: 'file.read',
            filePath: fileDetect.filePath,
            projectScope: { projectPath: project.path },
          },
        });

        return await handleFileDecision(input, fileDecision, {
          ...context,
          hasActiveProject: true,
          project: project,
          projectPath: project.path,
        });
      }
    }

    // Get CRE decision with project context
    // v71: decide() is now async (LLM-first classification)
    const decision = await creDecisionEngine.decide(input, {
      ...context,
      hasActiveProject: true,
      projectId: project.id,
      projectName: project.name,
      projectScope: project.scope || 'project',
    });

    assertDecision(decision);

    logger.info('ProjectHandler', `CRE Decision: ${decision.type}`, {
      intent: decision.intent,
      tools: decision.tools,
    });

    // Handle based on decision
    switch (decision.type) {
      // ════════════════════════════════════════════════════════════════════
      // LOCAL: FILE_READ, FILE_EXPLAIN, SHELL, date/calendar computations
      // ════════════════════════════════════════════════════════════════════
      case DecisionType.LOCAL:
        if (decision.intent === IntentType.FILE_READ || decision.intent === IntentType.FILE_EXPLAIN) {
          return await handleFileDecision(input, decision, {
            ...context,
            hasActiveProject: true,
            project: project,
            projectPath: project.path,
          });
        }
        // v70: FILE_WRITE intent → write content to file
        if (decision.intent === IntentType.FILE_WRITE) {
          return await handleFileWriteDecision(input, decision, {
            ...context,
            hasActiveProject: true,
            project: project,
            projectPath: project.path,
          });
        }
        // v70: SHELL intent → route to terminal execution
        if (decision.intent === IntentType.SHELL) {
          return handleShellDecision(input, decision, context);
        }
        return await handleLocalDecision(input, decision, context);

      // ════════════════════════════════════════════════════════════════════
      // v87: BUILD → PLAN: Handoff to Planner pipeline
      // Previously missing → fell to default → REFUSE dead end
      // ════════════════════════════════════════════════════════════════════
      case DecisionType.PLAN:
        if (handleBuildDetected) {
          return handleBuildDetected(input, decision, {
            ...context,
            hasActiveProject: true,
            project: project,
            projectPath: project.path,
          });
        }
        // Phase C not loaded — fall through to ANSWER with project context
        return await handleAnswerDecision(input, decision, context);

      case DecisionType.TOOL_CALL:
        // v87: CODE intent without explicit file path → route to ANSWER (inline synthesis).
        // Prevents "FILE_WRITE: No file path specified" error when user says
        // "zacni s psanim kodu" without specifying a target file.
        if (decision.intent === IntentType.CODE && !decision.metadata?.filePath) {
          logger.info('ProjectHandler', 'CODE without file path → inline ANSWER', {
            input: input.substring(0, 60),
            projectId: project.id,
          });
          return await handleAnswerDecision(input, decision, {
            ...context,
            hasActiveProject: true,
            project: project,
            projectPath: project.path,
          });
        }
        // v44.2 - Ensure project context is fully propagated for sandbox
        return await handleToolCallDecision(input, decision, {
          ...context,
          hasActiveProject: true,
          project: project, // Explicit project for ToolExecutor sandbox
          projectPath: project.path, // Explicit path for backward compatibility
        });

      case DecisionType.ASK_USER:
        return handleAskUserDecision(input, decision, context);

      case DecisionType.ANSWER:
        // In project mode, even CONVERSATIONAL gets project context
        return await handleAnswerDecision(input, decision, context);

      case DecisionType.REFUSE:
        return handleRefuseDecision(input, decision, context);

      default:
        return handleRefuseDecision(input, decision, context);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 2: No project selected - ASK_USER (no text description!)
  // ════════════════════════════════════════════════════════════════════════════

  logger.info('ProjectHandler', 'No project selected - asking user');

  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.PROJECT,
    confidence: 1.0,
    canExecute: false,
    metadata: {
      decision: { type: 'ASK_USER', reason: 'PROJECT_REQUIRED' },
      slots: ['project'],
      awaitingSelection: true,
    },
  });

  // This is ASK_USER behavior, not "chatty" text
  return new TaggedResponse({
    content: `💻 **Vyber projekt**\n\nPro práci s kódem potřebuji znát kontext projektu.\n\n` +
             `**Váš požadavek:** "${input.substring(0, 100)}${input.length > 100 ? '...' : ''}"\n\n` +
             `Vyberte projekt z nabídky nebo vytvořte nový.`,
    tag,
  });
}


