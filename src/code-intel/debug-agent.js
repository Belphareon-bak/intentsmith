// Autonomous Debugging Agent — Iterative hypothesis-driven debugging
// ══════════════════════════════════════════════════════════════════════════════
//
// Algorithm:
//   1. Analyze bug report → generate hypotheses
//   2. For each hypothesis (beam search, top 3):
//      a. Search relevant code
//      b. Analyze matching files
//      c. Score hypothesis (evidence for/against)
//   3. Pick best hypothesis → propose fix
//   4. Self-correction: if evidence contradicts → revise hypothesis
//   5. Max iterations: 5 (prevent infinite loops)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { expandQuery, buildSearchQueries } from './query-expander.js';
import { searchCode, searchSymbol } from './code-search.js';
import { rankFiles } from './file-discovery.js';
import { buildCodeContext } from './context-builder.js';
import { analyzeCodeStructure, detectLanguage } from './code-analyzer.js';
import { readFile } from 'fs/promises';
import path from 'path';

const MAX_ITERATIONS = 5;
const MAX_HYPOTHESES = 3;
const MAX_REVISIONS = 3;

// ─── Hypothesis Types ────────────────────────────────────────────────────────

/**
 * @typedef {Object} Hypothesis
 * @property {string} description - What might be wrong
 * @property {string[]} searchTerms - Code to search for
 * @property {number} confidence - 0-1 initial confidence
 * @property {string} category - 'config'|'logic'|'data'|'integration'|'concurrency'|'other'
 */

/**
 * @typedef {Object} DebugResult
 * @property {string} rootCause - Identified root cause
 * @property {Hypothesis} hypothesis - Winning hypothesis
 * @property {Array} evidence - Supporting evidence
 * @property {Array<{file: string, line: number, fix: string}>} fixes - Proposed fixes
 * @property {number} iterations - How many iterations were needed
 * @property {string} summary - Human-readable summary
 */

// ─── Bug Report Analysis ─────────────────────────────────────────────────────

/**
 * Extract structured information from a bug report.
 */
function analyzeBugReport(bugReport) {
  const info = {
    errorType: null,
    errorMessage: null,
    stackTrace: [],
    affectedEndpoint: null,
    symptoms: [],
    keywords: [],
  };

  // Extract error type
  const errorMatch = bugReport.match(/(?:Error|Exception|Fault|Panic|TypeError|ReferenceError|NullPointer\w*|SegFault)\b/i);
  if (errorMatch) info.errorType = errorMatch[0];

  // Extract HTTP status
  const statusMatch = bugReport.match(/(?:returns?|status|code|vrací)\s*(\d{3})/i);
  if (statusMatch) info.symptoms.push(`HTTP ${statusMatch[1]}`);

  // Extract endpoint
  const endpointMatch = bugReport.match(/(?:endpoint|route|url|path)\s+['"]?([/\w-]+)/i) ||
                         bugReport.match(/(?:GET|POST|PUT|DELETE|PATCH)\s+([/\w-]+)/i);
  if (endpointMatch) info.affectedEndpoint = endpointMatch[1];

  // Extract stack trace lines
  const stackLines = bugReport.match(/at\s+[\w.]+\s*\([^)]+:\d+:\d+\)/g);
  if (stackLines) info.stackTrace = stackLines;

  // Extract file references
  const fileRefs = bugReport.match(/[\w/.-]+\.\w{1,4}(?::\d+)?/g);
  if (fileRefs) info.keywords.push(...fileRefs);

  // Extract key symptoms
  const symptomPatterns = [
    /timeout/i, /crash/i, /hang/i, /slow/i, /leak/i,
    /null/i, /undefined/i, /NaN/i, /empty/i,
    /permission/i, /denied/i, /forbidden/i,
    /not found/i, /missing/i, /invalid/i,
  ];
  for (const p of symptomPatterns) {
    if (p.test(bugReport)) info.symptoms.push(p.source.replace(/\/i$/, ''));
  }

  return info;
}

// ─── Hypothesis Generation ───────────────────────────────────────────────────

/**
 * Generate debugging hypotheses from bug report + code context.
 */
function generateHypotheses(bugReport, bugInfo) {
  const hypotheses = [];

  // Category-based hypothesis generators (lazy — only evaluated when condition matches)
  const generators = [
    {
      condition: () => bugInfo.symptoms.some(s => /timeout|slow|hang/i.test(s)),
      generate: () => ({
        description: 'Timeout or performance issue — check timeout config, async operations, database queries',
        searchTerms: ['timeout', 'setTimeout', 'deadline', 'TIMEOUT', 'maxWait'],
        confidence: 0.6,
        category: 'config',
      }),
    },
    {
      condition: () => bugInfo.errorType && /null|undefined|NaN/i.test(bugInfo.errorType + ' ' + bugReport),
      generate: () => ({
        description: 'Null/undefined reference — missing null check, uninitialized variable, or broken data flow',
        searchTerms: bugInfo.keywords.length > 0 ? bugInfo.keywords.slice(0, 3) : ['null', 'undefined'],
        confidence: 0.7,
        category: 'logic',
      }),
    },
    {
      condition: () => bugInfo.symptoms.some(s => /permission|denied|forbidden|403/i.test(s)),
      generate: () => ({
        description: 'Authorization/permission issue — check auth middleware, role checks, token validation',
        searchTerms: ['authorize', 'permission', 'role', 'isAllowed', 'canAccess'],
        confidence: 0.6,
        category: 'integration',
      }),
    },
    {
      condition: () => bugInfo.affectedEndpoint,
      generate: () => ({
        description: `Endpoint ${bugInfo.affectedEndpoint} handler — check route definition, request parsing, response building`,
        searchTerms: [bugInfo.affectedEndpoint.split('/').pop(), 'router', 'handler'],
        confidence: 0.5,
        category: 'logic',
      }),
    },
    {
      condition: () => bugInfo.symptoms.some(s => /not.?found|missing|404/i.test(s)),
      generate: () => ({
        description: 'Resource not found — check file paths, database keys, route matching',
        searchTerms: ['notFound', '404', 'FileNotFound', 'ENOENT'],
        confidence: 0.5,
        category: 'data',
      }),
    },
    {
      condition: () => bugInfo.symptoms.some(s => /leak|memory/i.test(s)),
      generate: () => ({
        description: 'Resource leak — check unclosed connections, event listeners, timers, streams',
        searchTerms: ['addEventListener', 'setInterval', 'createConnection', 'on('],
        confidence: 0.5,
        category: 'concurrency',
      }),
    },
    {
      condition: () => bugInfo.stackTrace.length > 0,
      generate: () => ({
        description: 'Stack trace analysis — investigate call chain from stack trace',
        searchTerms: extractFunctionsFromStack(bugInfo.stackTrace),
        confidence: 0.8,
        category: 'logic',
      }),
    },
  ];

  // Generate from matching conditions (lazy evaluation)
  for (const g of generators) {
    if (g.condition()) {
      hypotheses.push(g.generate());
    }
  }

  // Always add a generic hypothesis from query expansion
  const expanded = expandQuery(bugReport);
  if (expanded.primary.length > 0) {
    hypotheses.push({
      description: `Direct code analysis — search for ${expanded.primary.slice(0, 3).join(', ')}`,
      searchTerms: [...expanded.primary, ...expanded.secondary].slice(0, 5),
      confidence: 0.4,
      category: 'other',
    });
  }

  // Sort by confidence, take top N
  hypotheses.sort((a, b) => b.confidence - a.confidence);
  return hypotheses.slice(0, MAX_HYPOTHESES);
}

function extractFunctionsFromStack(stackTrace) {
  const funcs = [];
  for (const line of stackTrace) {
    const m = line.match(/at\s+([\w.]+)/);
    if (m) funcs.push(m[1]);
  }
  return funcs.slice(0, 5);
}

// ─── Evidence Scoring ────────────────────────────────────────────────────────

/**
 * Score evidence for/against a hypothesis.
 */
function scoreEvidence(hypothesis, searchResults, fileAnalyses) {
  let score = hypothesis.confidence;
  const evidence = [];

  // Positive: search matches found
  if (searchResults.length > 0) {
    score += 0.1;
    evidence.push({
      type: 'positive',
      detail: `Found ${searchResults.length} code matches`,
    });
  }

  // Positive: code smells in matching files
  const totalSmells = fileAnalyses.reduce((sum, a) => sum + a.codeSmells.length, 0);
  if (totalSmells > 0) {
    score += 0.05 * Math.min(totalSmells, 5);
    evidence.push({
      type: 'positive',
      detail: `${totalSmells} code smell(s) found`,
    });
  }

  // Positive: config values that match hypothesis
  if (hypothesis.category === 'config') {
    const configCount = fileAnalyses.reduce((sum, a) => sum + a.configValues.length, 0);
    if (configCount > 0) {
      score += 0.1;
      evidence.push({
        type: 'positive',
        detail: `${configCount} config value(s) found`,
      });
    }
  }

  // Negative: no matches at all
  if (searchResults.length === 0) {
    score -= 0.2;
    evidence.push({
      type: 'negative',
      detail: 'No code matches found for search terms',
    });
  }

  return {
    score: Math.max(0, Math.min(1, score)),
    evidence,
  };
}

// ─── Main Debug Function ─────────────────────────────────────────────────────

/**
 * Autonomously debug an issue by iterative hypothesis testing.
 *
 * @param {string} projectPath - Absolute project path
 * @param {string} bugReport - Bug description from user
 * @param {Object} [opts]
 * @param {Function} [opts.onProgress] - (step, detail) callback
 * @param {Function} [opts.llmSynthesize] - async (prompt, systemPrompt) → string
 * @returns {Promise<DebugResult>}
 */
export async function debugIssue(projectPath, bugReport, opts = {}) {
  const { onProgress, llmSynthesize } = opts;

  logger.info('DebugAgent', 'Starting debug session', {
    report: bugReport.substring(0, 100),
    projectPath,
  });

  const report = (step, detail) => {
    logger.info('DebugAgent', `[${step}] ${detail}`);
    if (onProgress) {
      try { onProgress(step, detail); } catch (_) {}
    }
  };

  // ─── Step 1: Analyze bug report ─────────────────────────────────
  report('analyze', 'Analyzing bug report...');
  const bugInfo = analyzeBugReport(bugReport);

  // ─── Step 2: Generate hypotheses ─────────────────────────────────
  report('hypothesize', `Generating hypotheses (${bugInfo.symptoms.length} symptoms detected)`);
  let hypotheses = generateHypotheses(bugReport, bugInfo);

  if (hypotheses.length === 0) {
    return {
      rootCause: 'Unable to generate hypotheses from bug report',
      hypothesis: null,
      evidence: [],
      fixes: [],
      iterations: 0,
      summary: 'The bug report did not contain enough information to form debugging hypotheses. Please provide more details: error messages, stack traces, or specific behavior observed.',
    };
  }

  // ─── Step 3: Iterative hypothesis testing ────────────────────────
  let bestResult = null;
  let revisions = 0;
  let iteration = 0;

  for (iteration = 0; iteration < MAX_ITERATIONS && revisions < MAX_REVISIONS; iteration++) {
    report('search', `Iteration ${iteration + 1}: Testing ${hypotheses.length} hypotheses`);

    const results = [];

    for (const hyp of hypotheses) {
      // Search for evidence
      let allSearchResults = [];
      for (const term of hyp.searchTerms.slice(0, 5)) {
        const sr = await searchCode(projectPath, term, {
          maxResults: 20,
          contextLines: 3,
          noCache: true,
        });
        allSearchResults.push(...sr.results);
      }

      // Deduplicate
      const seen = new Set();
      allSearchResults = allSearchResults.filter(r => {
        const key = `${r.file}:${r.line}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Rank files
      const ranked = await rankFiles(allSearchResults, hyp.searchTerms, { projectPath });

      // Analyze top files
      const analyses = [];
      for (const rf of ranked.slice(0, 5)) {
        try {
          const absPath = path.join(projectPath, rf.file);
          const content = await readFile(absPath, 'utf8');
          const lang = detectLanguage(rf.file);
          const analysis = analyzeCodeStructure(content, lang);
          analyses.push(analysis);
        } catch {
          // skip
        }
      }

      // Score hypothesis
      const { score, evidence } = scoreEvidence(hyp, allSearchResults, analyses);

      results.push({
        hypothesis: hyp,
        score,
        evidence,
        searchResults: allSearchResults,
        rankedFiles: ranked,
        analyses,
      });
    }

    // Sort by score
    results.sort((a, b) => b.score - a.score);
    bestResult = results[0];

    report('evaluate', `Best hypothesis: "${bestResult.hypothesis.description.substring(0, 60)}" (score: ${bestResult.score.toFixed(2)})`);

    // Check if confidence is high enough
    if (bestResult.score >= 0.7) {
      break; // Good enough
    }

    // Self-correction: if best score is low, revise hypotheses
    if (bestResult.score < 0.4 && revisions < MAX_REVISIONS) {
      report('revise', 'Low confidence — revising hypotheses');
      revisions++;

      // Generate new search terms from what we found
      const newTerms = [];
      for (const r of bestResult.searchResults.slice(0, 10)) {
        const expanded = expandQuery(r.content);
        newTerms.push(...expanded.primary);
      }

      if (newTerms.length > 0) {
        hypotheses = [{
          description: `Revised: analyzing ${newTerms.slice(0, 3).join(', ')}`,
          searchTerms: [...new Set(newTerms)].slice(0, 5),
          confidence: 0.5,
          category: 'other',
        }];
      } else {
        break; // Can't revise further
      }
    } else {
      break; // Decent confidence
    }
  }

  // ─── Step 4: Build result ────────────────────────────────────────
  if (!bestResult) {
    return {
      rootCause: 'No conclusive findings',
      hypothesis: null,
      evidence: [],
      fixes: [],
      iterations: iteration,
      summary: 'Debug agent could not find sufficient evidence to identify the root cause.',
    };
  }

  // Build context for LLM synthesis (if available)
  let rootCause = bestResult.hypothesis.description;
  let fixes = [];

  if (llmSynthesize && bestResult.rankedFiles.length > 0) {
    try {
      const codeContext = await buildCodeContext(projectPath, bestResult.rankedFiles, {
        maxFiles: 5,
        maxTokens: 10000,
        queryTerms: bestResult.hypothesis.searchTerms,
      });

      const prompt = buildDebugPrompt(bugReport, bugInfo, bestResult, codeContext.context);
      const llmResult = await llmSynthesize(prompt, 'You are a senior developer performing root cause analysis. Be specific about files, lines, and mechanisms. Propose concrete fixes.');

      if (llmResult) {
        rootCause = llmResult;
      }
    } catch (err) {
      logger.warn('DebugAgent', `LLM synthesis failed: ${err.message}`);
    }
  }

  // Extract fix suggestions from evidence
  for (const rf of bestResult.rankedFiles.slice(0, 3)) {
    for (const analysis of bestResult.analyses) {
      for (const smell of analysis.codeSmells) {
        if (['EVAL_USAGE', 'HARDCODED_SECRET', 'EMPTY_CATCH'].includes(smell.type)) {
          fixes.push({
            file: rf.file,
            line: smell.line,
            fix: `Fix ${smell.type}: ${smell.content}`,
          });
        }
      }
    }
  }

  const summary = [
    `## Debug Report`,
    `**Hypothesis:** ${bestResult.hypothesis.description}`,
    `**Confidence:** ${(bestResult.score * 100).toFixed(0)}%`,
    `**Category:** ${bestResult.hypothesis.category}`,
    `**Files analyzed:** ${bestResult.rankedFiles.length}`,
    `**Iterations:** ${iteration + 1}`,
    bestResult.evidence.length > 0 ? `\n### Evidence\n${bestResult.evidence.map(e => `- [${e.type}] ${e.detail}`).join('\n')}` : '',
    fixes.length > 0 ? `\n### Suggested Fixes\n${fixes.map(f => `- ${f.file}:${f.line} — ${f.fix}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');

  report('done', `Debug complete after ${iteration + 1} iterations (confidence: ${(bestResult.score * 100).toFixed(0)}%)`);

  return {
    rootCause,
    hypothesis: bestResult.hypothesis,
    evidence: bestResult.evidence,
    fixes,
    iterations: iteration + 1,
    summary,
  };
}

// ─── Debug Prompt ────────────────────────────────────────────────────────────

function buildDebugPrompt(bugReport, bugInfo, bestResult, codeContext) {
  return `## Bug Report
${bugReport}

## Symptoms
${bugInfo.symptoms.join(', ') || 'Not specified'}

## Error Type
${bugInfo.errorType || 'Not specified'}

## Working Hypothesis
${bestResult.hypothesis.description}

## Evidence
${bestResult.evidence.map(e => `[${e.type}] ${e.detail}`).join('\n')}

## Relevant Code
${codeContext}

## Task
1. Identify the root cause based on the code and evidence above
2. Explain the mechanism (how the bug occurs)
3. Propose specific code changes to fix the issue
4. If the hypothesis is wrong, explain what actually causes the issue
`;
}

export default { debugIssue };
