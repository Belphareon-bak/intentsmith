// C.3 Architect Mode - History Manager
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../core/logger.js';

const ARCHITECT_DIR = '.c3-architect';
const HISTORY_DIR = 'history';

/**
 * History Manager
 * Handles replay workflow and decision documentation
 */
export class HistoryManager {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.historyDir = path.join(projectRoot, ARCHITECT_DIR, HISTORY_DIR);
  }

  /**
   * Ensure history directory exists for block
   */
  async ensureBlockDir(blockPath) {
    const blockDir = path.join(this.historyDir, blockPath);
    await fs.mkdir(blockDir, { recursive: true });
    return blockDir;
  }

  /**
   * Generate timestamp filename
   */
  generateFilename(suffix = 'session') {
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/:/g, '-')
      .replace(/\..+$/, '');
    return `${timestamp}_${suffix}.md`;
  }

  /**
   * Save replay document
   * Extracts key points from session for future reference
   */
  async saveReplay(blockPath, sessionLog, timestamp = new Date().toISOString()) {
    const blockDir = await this.ensureBlockDir(blockPath);
    const filename = this.generateFilename('completed');
    const filePath = path.join(blockDir, filename);

    const content = this.formatReplayDocument(blockPath, sessionLog, timestamp);
    
    await fs.writeFile(filePath, content);
    logger.info('History', 'Replay saved', { blockPath, filename });
    
    return { path: filePath, filename };
  }

  /**
   * Format replay document from session log
   */
  formatReplayDocument(blockPath, sessionLog, timestamp) {
    const blockName = blockPath.split('/').pop().replace(/^\d+-/, '');
    
    let content = `# Replay: ${blockName}\n\n`;
    content += `**Blok:** ${blockPath}\n`;
    content += `**Dokončeno:** ${timestamp}\n\n`;
    content += `---\n\n`;

    // If sessionLog is structured
    if (typeof sessionLog === 'object') {
      // Goal
      if (sessionLog.goal) {
        content += `## Cíl\n\n${sessionLog.goal}\n\n`;
      }

      // Steps/workflow
      if (sessionLog.steps && Array.isArray(sessionLog.steps)) {
        content += `## Workflow\n\n`;
        for (let i = 0; i < sessionLog.steps.length; i++) {
          const step = sessionLog.steps[i];
          content += `### Krok ${i + 1}: ${step.title || 'Akce'}\n\n`;
          
          if (step.prompt) {
            content += `**Prompt:**\n\`\`\`\n${step.prompt}\n\`\`\`\n\n`;
          }
          
          if (step.action) {
            content += `**Akce:** ${step.action}\n\n`;
          }
          
          if (step.result) {
            content += `**Výsledek:** ${step.result}\n\n`;
          }
        }
      }

      // Files created/modified
      if (sessionLog.files && Array.isArray(sessionLog.files)) {
        content += `## Soubory\n\n`;
        for (const file of sessionLog.files) {
          const icon = file.action === 'created' ? '➕' : '✏️';
          content += `- ${icon} \`${file.path}\`\n`;
        }
        content += '\n';
      }

      // Result
      if (sessionLog.result) {
        content += `## Výsledek\n\n${sessionLog.result}\n\n`;
      }

    } else if (typeof sessionLog === 'string') {
      // Plain text session log
      content += `## Session Log\n\n${sessionLog}\n\n`;
    }

    return content;
  }

  /**
   * Save decisions document
   * What was decided, why, and what was rejected
   */
  async saveDecisions(blockPath, decisions) {
    const blockDir = await this.ensureBlockDir(blockPath);
    const filePath = path.join(blockDir, 'decisions.md');

    // Load existing or create new
    let content = '';
    try {
      content = await fs.readFile(filePath, 'utf-8');
      content += '\n---\n\n';
    } catch {
      content = `# Rozhodnutí: ${blockPath.split('/').pop().replace(/^\d+-/, '')}\n\n`;
    }

    // Add new decisions
    content += this.formatDecisions(decisions);
    
    await fs.writeFile(filePath, content);
    logger.info('History', 'Decisions saved', { blockPath });
    
    return { path: filePath };
  }

  /**
   * Format decisions entry
   */
  formatDecisions(decisions) {
    const timestamp = new Date().toISOString().substring(0, 16).replace('T', ' ');
    let content = `## ${timestamp}\n\n`;

    if (typeof decisions === 'object') {
      // What was decided
      if (decisions.decided && Array.isArray(decisions.decided)) {
        content += `### ✅ Rozhodnuto\n\n`;
        for (const d of decisions.decided) {
          content += `- **${d.what}**\n`;
          if (d.why) content += `  - Důvod: ${d.why}\n`;
        }
        content += '\n';
      }

      // What was rejected
      if (decisions.rejected && Array.isArray(decisions.rejected)) {
        content += `### ❌ Zavrženo\n\n`;
        for (const r of decisions.rejected) {
          content += `- **${r.what}**\n`;
          if (r.why) content += `  - Důvod: ${r.why}\n`;
        }
        content += '\n';
      }

      // Open questions
      if (decisions.open && Array.isArray(decisions.open)) {
        content += `### ❓ Otevřené otázky\n\n`;
        for (const o of decisions.open) {
          content += `- ${o}\n`;
        }
        content += '\n';
      }

      // Context/notes
      if (decisions.notes) {
        content += `### 📝 Poznámky\n\n${decisions.notes}\n\n`;
      }

    } else if (typeof decisions === 'string') {
      content += decisions + '\n\n';
    }

    return content;
  }

  /**
   * Load all history for a block
   */
  async loadBlockHistory(blockPath) {
    const blockDir = path.join(this.historyDir, blockPath);
    
    try {
      const files = await fs.readdir(blockDir);
      const history = {
        sessions: [],
        decisions: null,
      };

      for (const file of files.sort()) {
        const filePath = path.join(blockDir, file);
        const content = await fs.readFile(filePath, 'utf-8');

        if (file === 'decisions.md') {
          history.decisions = content;
        } else if (file.endsWith('.md')) {
          history.sessions.push({
            filename: file,
            timestamp: file.split('_')[0],
            content,
          });
        }
      }

      return history;
    } catch {
      return { sessions: [], decisions: null };
    }
  }

  /**
   * Load decisions for block
   */
  async loadDecisions(blockPath) {
    const filePath = path.join(this.historyDir, blockPath, 'decisions.md');
    
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Create session start marker
   */
  async markSessionStart(blockPath) {
    const blockDir = await this.ensureBlockDir(blockPath);
    const filename = this.generateFilename('session-start');
    const filePath = path.join(blockDir, filename);

    const content = `# Session Start: ${blockPath}\n\n`;
    
    await fs.writeFile(filePath, content + `**Začátek:** ${new Date().toISOString()}\n`);
    logger.info('History', 'Session started', { blockPath, filename });
    
    return { path: filePath, filename };
  }

  /**
   * Get history summary for a block
   */
  async getHistorySummary(blockPath) {
    const history = await this.loadBlockHistory(blockPath);
    
    return {
      sessionCount: history.sessions.length,
      hasDecisions: !!history.decisions,
      lastSession: history.sessions.length > 0 
        ? history.sessions[history.sessions.length - 1].timestamp 
        : null,
    };
  }

  /**
   * Clean old sessions (keep last N)
   */
  async pruneHistory(blockPath, keepLast = 10) {
    const blockDir = path.join(this.historyDir, blockPath);
    
    try {
      const files = await fs.readdir(blockDir);
      const sessions = files
        .filter(f => f.endsWith('.md') && f !== 'decisions.md')
        .sort();

      if (sessions.length > keepLast) {
        const toDelete = sessions.slice(0, sessions.length - keepLast);
        
        for (const file of toDelete) {
          await fs.unlink(path.join(blockDir, file));
          logger.debug('History', 'Pruned old session', { file });
        }
        
        return { pruned: toDelete.length };
      }

      return { pruned: 0 };
    } catch {
      return { pruned: 0 };
    }
  }
}

export default HistoryManager;
