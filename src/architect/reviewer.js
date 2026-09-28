// C.3 Architect Mode - Reviewer LLM
// ══════════════════════════════════════════════════════════════════════════════
//
// ReviewerLLM = IZOLOVANÝ REVIEWER
// - Pouze: definice + kód → verdikt
// - Žádné opravování, jen posouzení
// - Může použít jiný model než Coder (adversarial review)
//
// v36.9.1: Migrated to LLMGateway with WORKFLOW_REVIEWER auth token
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { callWithAuth } from '../llm/gateway.js';
import { createAuthToken, LLMCallerRole } from '../llm/auth-types.js';
import { extractJSON } from '../llm/client.js';

// Používáme jiný model než Coder pro adversarial review
const REVIEWER_MODEL = 'qwen3.5:27b';

/**
 * REVIEWER PROMPT
 */
const REVIEW_PROMPT = `Jsi CODE REVIEWER. Zkontroluj implementaci proti definici.

## DEFINICE (co mělo být implementováno)

{definition}

## VYGENEROVANÉ SOUBORY

{files}

---

Odpověz POUZE platným JSON:

{
  "verdict": "PASS|WARN|FAIL",
  "score": 0-100,
  "confidenceImpact": -0.2 až 0.1,
  "issues": [
    {
      "severity": "critical|major|minor",
      "file": "cesta/k/souboru",
      "line": null,
      "issue": "popis problému",
      "suggestion": "jak opravit"
    }
  ],
  "summary": "jednořádkové shrnutí"
}

VERDIKT:
- PASS: Implementace odpovídá definici, žádné kritické problémy (confidenceImpact: 0 až 0.1)
- WARN: Drobné problémy, ale základ je správný (confidenceImpact: -0.1 až 0)
- FAIL: Zásadní problémy, neodpovídá definici (confidenceImpact: -0.2 až -0.1)

KONTROLUJ:
1. Odpovídá implementace definici?
2. Je kód kompletní (ne TODO, ne pseudokód)?
3. Jsou všechny soubory validní?
4. Funguje to dohromady?`;

/**
 * Verdikt types
 */
export const Verdict = {
  PASS: 'PASS',
  WARN: 'WARN',
  FAIL: 'FAIL',
};

/**
 * Issue severity
 */
export const Severity = {
  CRITICAL: 'critical',
  MAJOR: 'major',
  MINOR: 'minor',
};

/**
 * ReviewerLLM - Izolovaný reviewer
 * 
 * Vstup: definice + vygenerované soubory
 * Výstup: verdikt + issues
 */
export class ReviewerLLM {

  /**
   * Review vygenerovaný kód proti definici
   * 
   * @param {string} definition - Originální definice bloku
   * @param {Array<{path: string, content: string}>} files - Vygenerované soubory
   * @returns {Promise<{verdict: string, score: number, confidenceImpact: number, issues: Array, summary: string}>}
   */
  async review(definition, files) {
    if (!definition) {
      throw new Error('Definition is required for review');
    }

    if (!files || files.length === 0) {
      return {
        verdict: Verdict.FAIL,
        score: 0,
        confidenceImpact: -0.2,
        issues: [{ severity: 'critical', issue: 'No files to review' }],
        summary: 'Žádné soubory k review',
      };
    }

    // Format files for prompt (truncate long files)
    const filesStr = files.map(f => {
      const content = f.content.length > 2000 
        ? f.content.substring(0, 2000) + '\n... (truncated)'
        : f.content;
      return `### ${f.path}\n\`\`\`\n${content}\n\`\`\``;
    }).join('\n\n');

    const prompt = REVIEW_PROMPT
      .replace('{definition}', definition)
      .replace('{files}', filesStr);

    logger.info('ReviewerLLM', 'Reviewing code...', { fileCount: files.length });

    try {
      const token = createAuthToken({
        role: LLMCallerRole.WORKFLOW_REVIEWER,
        decisionId: `reviewer_${Date.now()}`,
        auditContext: { sessionId: 'architect' }
      });

      const response = await callWithAuth(token, prompt, {
        model: REVIEWER_MODEL,
        temperature: 0.2,
        timeout: 90000,
        format: 'json',
        maxTokens: 3000
      });

      const result = extractJSON(response.content);
      
      if (!result) {
        logger.warn('ReviewerLLM', 'Could not parse review response');
        return {
          verdict: Verdict.WARN,
          score: 70,
          confidenceImpact: -0.05,
          issues: [],
          summary: 'Review nedokončen - automaticky WARN',
        };
      }

      // Normalize verdict
      const verdict = this.normalizeVerdict(result.verdict);
      
      // Calculate or use provided confidenceImpact
      const confidenceImpact = this.normalizeConfidenceImpact(
        result.confidenceImpact,
        verdict,
        result.issues
      );
      
      logger.info('ReviewerLLM', 'Review complete', { 
        verdict, 
        score: result.score,
        confidenceImpact,
        issues: result.issues?.length || 0 
      });

      return {
        verdict,
        score: result.score || this.calculateScore(verdict, result.issues),
        confidenceImpact,
        issues: result.issues || [],
        summary: result.summary || '',
        duration: response.duration,
      };

    } catch (err) {
      logger.error('ReviewerLLM', `Review failed: ${err.message}`);
      
      // Fail-safe: v případě chyby nevracíme PASS
      return {
        verdict: Verdict.WARN,
        score: 50,
        confidenceImpact: -0.1,
        issues: [{ severity: 'major', issue: `Review error: ${err.message}` }],
        summary: 'Review selhal',
      };
    }
  }

  /**
   * Normalize verdict string
   */
  normalizeVerdict(verdict) {
    const v = (verdict || '').toUpperCase();
    if (v === 'PASS' || v === 'OK' || v === 'APPROVED') return Verdict.PASS;
    if (v === 'FAIL' || v === 'FAILED' || v === 'REJECTED') return Verdict.FAIL;
    return Verdict.WARN;
  }

  /**
   * Normalize confidenceImpact - ensure it's within bounds
   */
  normalizeConfidenceImpact(impact, verdict, issues = []) {
    // If LLM provided valid impact, use it (clamped)
    if (typeof impact === 'number' && !isNaN(impact)) {
      return Math.max(-0.2, Math.min(0.1, impact));
    }
    
    // Calculate from verdict and issues
    let calculated = 0;
    
    switch (verdict) {
      case Verdict.PASS:
        calculated = 0.05;
        break;
      case Verdict.WARN:
        calculated = -0.05;
        break;
      case Verdict.FAIL:
        calculated = -0.15;
        break;
    }
    
    // Adjust for critical issues
    const criticalCount = issues.filter(i => i.severity === 'critical').length;
    calculated -= criticalCount * 0.05;
    
    return Math.max(-0.2, Math.min(0.1, calculated));
  }

  /**
   * Calculate score from verdict and issues
   */
  calculateScore(verdict, issues = []) {
    let score = verdict === Verdict.PASS ? 90 : verdict === Verdict.FAIL ? 30 : 60;
    
    for (const issue of issues) {
      if (issue.severity === 'critical') score -= 20;
      else if (issue.severity === 'major') score -= 10;
      else score -= 5;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Quick check - jen základní validace bez LLM
   */
  quickCheck(files) {
    const issues = [];

    for (const file of files) {
      // Check for empty content
      if (!file.content || file.content.trim().length < 10) {
        issues.push({
          severity: Severity.CRITICAL,
          file: file.path,
          issue: 'Empty or nearly empty file',
        });
      }

      // Check for TODO/FIXME
      if (/TODO|FIXME|XXX/i.test(file.content)) {
        issues.push({
          severity: Severity.MAJOR,
          file: file.path,
          issue: 'Contains TODO/FIXME markers',
        });
      }

      // Check for placeholder code
      if (/placeholder|not implemented|coming soon/i.test(file.content)) {
        issues.push({
          severity: Severity.CRITICAL,
          file: file.path,
          issue: 'Contains placeholder code',
        });
      }
    }

    return {
      passed: issues.filter(i => i.severity === 'critical').length === 0,
      issues,
    };
  }
}

export default ReviewerLLM;
