// Code Analysis Handler — CODE_ANALYSIS intent routing
// ══════════════════════════════════════════════════════════════════════════════
//
// Pipeline: query → expand → search → rank → context → LLM → answer
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../../core/logger.js';
import { expandQuery, buildSearchQueries } from '../../code-intel/query-expander.js';
import { searchCode } from '../../code-intel/code-search.js';
import { buildCodeContext, buildCodeAnalysisPrompt } from '../../code-intel/context-builder.js';
import { ResponseTag, TaggedResponse, ResponseSpeaker } from '../controller.js';

// ─── File Ranking (basic — Phase 2 will add smart discovery) ──────────────────

function basicRankFiles(searchResults) {
  // Group results by file, count matches
  const fileMap = new Map();

  for (const r of searchResults) {
    const entry = fileMap.get(r.file) || { file: r.file, matchCount: 0, lines: [] };
    entry.matchCount++;
    entry.lines.push(r.line);
    fileMap.set(r.file, entry);
  }

  // Sort by match count (most matches first)
  const ranked = [...fileMap.values()].sort((a, b) => b.matchCount - a.matchCount);

  // Score based on rank position and match count
  return ranked.map((f, idx) => ({
    file: f.file,
    score: 1 - (idx / Math.max(ranked.length, 1)),
    matchCount: f.matchCount,
    matchLines: f.lines,
  }));
}

// ─── Project Info Builder ─────────────────────────────────────────────────────

function buildProjectInfo(context) {
  const parts = [];

  if (context.project?.name) parts.push(`**Project:** ${context.project.name}`);
  if (context.project?.path) parts.push(`**Path:** ${context.project.path}`);
  if (context.projectWorkingMemory?.scope) parts.push(`**Scope:** ${context.projectWorkingMemory.scope}`);
  if (context.projectWorkingMemory?.techStack) {
    const ts = context.projectWorkingMemory.techStack;
    if (typeof ts === 'string') parts.push(`**Tech Stack:** ${ts}`);
    else if (typeof ts === 'object') parts.push(`**Tech Stack:** ${JSON.stringify(ts)}`);
  }

  return parts.join('\n') || 'Unknown project';
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

/**
 * Handle CODE_ANALYSIS intent — search code, build context, LLM synthesis.
 *
 * @param {string} input - User message
 * @param {Object} decision - CRE decision
 * @param {Object} context - Handler context
 * @returns {TaggedResponse}
 */
export async function handleCodeAnalysisDecision(input, decision, context) {
  const projectPath = context.project?.path || context.projectPath;

  if (!projectPath) {
    logger.warn('CodeAnalysis', 'No project path — falling back to ANSWER');
    const { handleAnswerDecision } = await import('./decisions.js');
    return await handleAnswerDecision(input, decision, context);
  }

  logger.info('CodeAnalysis', 'Starting code analysis pipeline', {
    input: input.substring(0, 80),
    projectPath,
  });

  // System step: code analysis started
  if (typeof context.onSystemStep === 'function') {
    try { context.onSystemStep('code_analysis_start', input.substring(0, 80)); } catch (_) {}
  }

  try {
    // ─── Step 1: Expand query ────────────────────────────────────────
    const expanded = expandQuery(input);
    const queries = buildSearchQueries(expanded);

    logger.info('CodeAnalysis', 'Query expanded', {
      primary: expanded.primary,
      secondary: expanded.secondary,
      queries: queries.slice(0, 5),
    });

    if (typeof context.onSystemStep === 'function') {
      try { context.onSystemStep('code_analysis_search', `Searching: ${queries.slice(0, 3).join(', ')}`, 2); } catch (_) {}
    }

    // ─── Step 2: Search code with all queries ────────────────────────
    let allResults = [];

    for (const query of queries.slice(0, 5)) { // Max 5 search queries
      const searchResult = await searchCode(projectPath, query, {
        maxResults: 30,
        contextLines: 3,
      });
      allResults.push(...searchResult.results);
    }

    // Deduplicate results by file:line
    const seen = new Set();
    allResults = allResults.filter(r => {
      const key = `${r.file}:${r.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    logger.info('CodeAnalysis', `Search complete: ${allResults.length} unique matches`);

    if (allResults.length === 0) {
      // No code found — fall back to LLM answer without code context
      logger.info('CodeAnalysis', 'No code matches — falling back to ANSWER');
      const { handleAnswerDecision } = await import('./decisions.js');
      return await handleAnswerDecision(input, decision, context);
    }

    // ─── Step 3: Rank files ──────────────────────────────────────────
    const rankedFiles = basicRankFiles(allResults);

    if (typeof context.onSystemStep === 'function') {
      try { context.onSystemStep('code_analysis_context', `Building context from ${rankedFiles.length} files`, 2); } catch (_) {}
    }

    // ─── Step 4: Build multi-file context ────────────────────────────
    const codeContext = await buildCodeContext(projectPath, rankedFiles, {
      maxFiles: 10,
      maxTokens: 15000,
      maxLinesPerFile: 200,
      queryTerms: [...expanded.primary, ...expanded.secondary],
    });

    // ─── Step 5: LLM synthesis ───────────────────────────────────────
    const projectInfo = buildProjectInfo(context);
    const analysisPrompt = buildCodeAnalysisPrompt(input, codeContext.context, projectInfo);

    if (typeof context.onSystemStep === 'function') {
      try { context.onSystemStep('code_analysis_llm', `LLM synthesis (${codeContext.totalTokens} tokens context)`, 2); } catch (_) {}
    }

    // Use CRE bridge for LLM call
    const creBridge = await import('../../llm/cre-bridge.js');
    const llmResponse = await creBridge.classifyIntent(analysisPrompt, {
      systemPrompt: 'You are a senior software engineer performing code analysis. Answer in the same language as the developer\'s question. Be specific, reference files and line numbers.',
      rawMode: true,  // Get raw text, not JSON classification
    });

    const responseContent = typeof llmResponse === 'string'
      ? llmResponse
      : llmResponse?.content || llmResponse?.raw || String(llmResponse);

    // ─── Step 6: Build response ──────────────────────────────────────
    const filesSection = codeContext.files.length > 0
      ? `\n\n---\n*Analyzed ${codeContext.files.length} file(s): ${codeContext.files.map(f => f.path).join(', ')}*`
      : '';

    return new TaggedResponse(
      new ResponseTag(ResponseSpeaker.SYSTEM, 'code_analysis'),
      responseContent + filesSection
    );

  } catch (err) {
    logger.error('CodeAnalysis', `Pipeline error: ${err.message}`, { stack: err.stack });

    // Fallback to regular answer
    const { handleAnswerDecision } = await import('./decisions.js');
    return await handleAnswerDecision(input, decision, context);
  }
}

export default { handleCodeAnalysisDecision };
