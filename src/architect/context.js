// C.3 Architect Mode - Context Loader
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../core/logger.js';

const ARCHITECT_DIR = '.c3-architect';

/**
 * Context Loader - manages what context AI sees
 */
export class ContextLoader {
  constructor(projectRoot, stateManager, roadmapManager) {
    this.projectRoot = projectRoot;
    this.architectDir = path.join(projectRoot, ARCHITECT_DIR);
    this.state = stateManager;
    this.roadmap = roadmapManager;
  }

  /**
   * Load base context (always included)
   * - spec.md
   * - state.json summary
   * - roadmap/main.md
   */
  async loadBaseContext() {
    const context = {
      spec: null,
      state: null,
      roadmap: null,
    };

    // Load spec.md
    try {
      context.spec = await fs.readFile(
        path.join(this.architectDir, 'spec.md'),
        'utf-8'
      );
    } catch {
      context.spec = '<!-- Specifikace projektu nebyla nalezena -->';
    }

    // State summary
    context.state = this.state.getSummary();

    // Roadmap main
    context.roadmap = await this.roadmap.loadMain();

    return context;
  }

  /**
   * Load current block context
   * Based on state.current.path
   */
  async loadCurrentBlockContext() {
    const currentPath = this.state.state?.current?.path;
    if (!currentPath) return null;

    const definition = await this.roadmap.loadDefinition(currentPath);
    return {
      path: currentPath,
      definition,
    };
  }

  /**
   * Load history for a block
   */
  async loadBlockHistory(blockPath) {
    const historyDir = path.join(this.architectDir, 'history', blockPath);
    
    try {
      const files = await fs.readdir(historyDir);
      const history = [];

      for (const file of files.sort()) {
        if (file.endsWith('.md')) {
          const content = await fs.readFile(path.join(historyDir, file), 'utf-8');
          history.push({
            filename: file,
            content,
          });
        }
      }

      return history;
    } catch {
      return [];
    }
  }

  /**
   * Load decisions for a block
   */
  async loadDecisions(blockPath) {
    const decisionsPath = path.join(
      this.architectDir,
      'history',
      blockPath,
      'decisions.md'
    );

    try {
      return await fs.readFile(decisionsPath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Build full context for AI
   */
  async buildContext(options = {}) {
    const {
      includeHistory = false,
      includeDecisions = true,
      additionalPaths = [],
    } = options;

    // Always load base
    const base = await this.loadBaseContext();
    
    // Current block
    const currentBlock = await this.loadCurrentBlockContext();

    // Optional: history
    let history = null;
    if (includeHistory && currentBlock?.path) {
      history = await this.loadBlockHistory(currentBlock.path);
    }

    // Optional: decisions
    let decisions = null;
    if (includeDecisions && currentBlock?.path) {
      decisions = await this.loadDecisions(currentBlock.path);
    }

    // Additional requested definitions
    const additional = {};
    for (const p of additionalPaths) {
      additional[p] = await this.roadmap.loadDefinition(p);
    }

    return {
      base,
      currentBlock,
      history,
      decisions,
      additional,
    };
  }

  /**
   * Format context for LLM prompt
   */
  formatForPrompt(context) {
    let prompt = '';

    // Spec
    prompt += `## Specifikace projektu\n\n${context.base.spec}\n\n`;

    // State
    prompt += `## Aktuální stav\n\n`;
    prompt += `- Projekt: ${context.base.state.project}\n`;
    prompt += `- Mód: ${context.base.state.mode}\n`;
    prompt += `- Confidence: ${(context.base.state.confidence * 100).toFixed(0)}%\n`;
    prompt += `- Pozice: ${context.base.state.current?.path || 'žádná'}\n`;
    prompt += `- Status: ${context.base.state.current?.status || 'initializing'}\n`;
    prompt += `- Progress: ${context.base.state.stats.done}/${context.base.state.stats.total}\n`;
    
    if (context.base.state.hasBlocker) {
      prompt += `\n### ⚠️ BLOCKER\n`;
      prompt += `- Typ: ${context.base.state.blocker.type}\n`;
      prompt += `- Popis: ${context.base.state.blocker.description}\n`;
      prompt += `- Pokusy: ${context.base.state.blocker.attempts.join(', ')}\n`;
      prompt += `- Další krok: ${context.base.state.blocker.nextStep}\n`;
    }
    prompt += '\n';

    // Roadmap
    prompt += `## Roadmapa\n\n${context.base.roadmap}\n\n`;

    // Current block definition
    if (context.currentBlock?.definition) {
      prompt += `## Aktuální blok: ${context.currentBlock.path}\n\n`;
      prompt += context.currentBlock.definition;
      prompt += '\n\n';
    }

    // Decisions
    if (context.decisions) {
      prompt += `## Předchozí rozhodnutí\n\n${context.decisions}\n\n`;
    }

    // Additional
    if (Object.keys(context.additional).length > 0) {
      prompt += `## Další definice\n\n`;
      for (const [p, def] of Object.entries(context.additional)) {
        if (def) {
          prompt += `### ${p}\n\n${def}\n\n`;
        }
      }
    }

    return prompt;
  }

  /**
   * Quick context summary for short responses
   */
  getQuickSummary() {
    const s = this.state.state;
    if (!s) return 'Projekt není inicializován.';

    let summary = `📍 ${s.current?.path || 'žádný blok'} (${s.current?.status})`;
    summary += ` | 📊 ${s.stats.done}/${s.stats.total}`;
    summary += ` | 🎯 ${(s.definitionConfidence * 100).toFixed(0)}%`;
    
    if (s.blocker) {
      summary += ` | ⚠️ BLOCKED: ${s.blocker.description}`;
    }

    return summary;
  }
}

export default ContextLoader;
