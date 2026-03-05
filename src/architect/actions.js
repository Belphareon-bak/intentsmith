// C.3 Architect Mode - Action Executor
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../core/logger.js';
import { stripCodeFences } from '../planner/code-cleaner.js';

/**
 * Action types
 */
const ActionType = {
  CODER: 'coder',     // Generate new files
  EDITOR: 'editor',   // Modify existing files (higher risk)
  UPDATE: 'update',   // Update .md definitions
  COMPLETE: 'complete', // Mark block done + commit + replay
};

/**
 * Action Executor
 * Handles all actions that modify files/state
 */
export class ActionExecutor {
  constructor(projectRoot, stateManager, roadmapManager, historyManager, gitManager) {
    this.projectRoot = projectRoot;
    this.state = stateManager;
    this.roadmap = roadmapManager;
    this.history = historyManager;
    this.git = gitManager;
  }

  /**
   * Execute CODER action - generate new files
   * Lower risk, creates files that don't exist
   */
  async coder(files) {
    const created = [];
    const errors = [];

    for (const file of files) {
      const filePath = path.isAbsolute(file.path) 
        ? file.path 
        : path.join(this.projectRoot, file.path);

      try {
        // Check if file exists
        try {
          await fs.access(filePath);
          // File exists - should use EDITOR instead
          errors.push({
            path: file.path,
            error: 'File exists - use EDITOR for modifications',
          });
          continue;
        } catch {
          // File doesn't exist - good, we can create
        }

        // Create directory if needed
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        
        // v97: Strip markdown fences and TS syntax from LLM output before writing
        const ext = path.extname(filePath);
        const cleanContent = stripCodeFences(file.content, ext);

        // Write file
        await fs.writeFile(filePath, cleanContent);
        created.push(file.path);
        
        logger.info('ActionExecutor', 'File created', { path: file.path });
      } catch (err) {
        errors.push({
          path: file.path,
          error: err.message,
        });
        logger.error('ActionExecutor', 'Failed to create file', { path: file.path, error: err.message });
      }
    }

    return {
      action: ActionType.CODER,
      created,
      errors,
      success: errors.length === 0,
    };
  }

  /**
   * Execute EDITOR action - modify existing files
   * Higher risk, requires more careful approval
   */
  async editor(modifications) {
    const modified = [];
    const errors = [];

    for (const mod of modifications) {
      const filePath = path.isAbsolute(mod.path)
        ? mod.path
        : path.join(this.projectRoot, mod.path);

      try {
        // Check if file exists
        try {
          await fs.access(filePath);
        } catch {
          errors.push({
            path: mod.path,
            error: 'File does not exist - use CODER for new files',
          });
          continue;
        }

        // Read current content
        const currentContent = await fs.readFile(filePath, 'utf-8');

        // Apply modification
        let newContent;
        if (mod.type === 'replace') {
          // Full replacement
          newContent = mod.content;
        } else if (mod.type === 'patch') {
          // Apply patch (search/replace)
          newContent = currentContent.replace(mod.search, mod.replace);
        } else if (mod.type === 'append') {
          newContent = currentContent + mod.content;
        } else if (mod.type === 'prepend') {
          newContent = mod.content + currentContent;
        } else {
          errors.push({
            path: mod.path,
            error: `Unknown modification type: ${mod.type}`,
          });
          continue;
        }

        // Write modified content
        await fs.writeFile(filePath, newContent);
        modified.push({
          path: mod.path,
          type: mod.type,
        });

        logger.info('ActionExecutor', 'File modified', { path: mod.path, type: mod.type });
      } catch (err) {
        errors.push({
          path: mod.path,
          error: err.message,
        });
        logger.error('ActionExecutor', 'Failed to modify file', { path: mod.path, error: err.message });
      }
    }

    return {
      action: ActionType.EDITOR,
      modified,
      errors,
      success: errors.length === 0,
    };
  }

  /**
   * Execute UPDATE action - update .md definitions in roadmap
   */
  async update(blockPath, content) {
    try {
      await this.roadmap.saveDefinition(blockPath, content);
      
      // Re-evaluate confidence after update
      // This would trigger confidence recalculation
      
      logger.info('ActionExecutor', 'Definition updated', { blockPath });
      
      return {
        action: ActionType.UPDATE,
        path: blockPath,
        success: true,
      };
    } catch (err) {
      logger.error('ActionExecutor', 'Failed to update definition', { blockPath, error: err.message });
      
      return {
        action: ActionType.UPDATE,
        path: blockPath,
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Execute COMPLETE action - full completion sequence
   * 1. Mark in main.md + timestamp
   * 2. Update state.json
   * 3. Create replay in history/
   * 4. Create decisions.md
   * 5. Git commit
   */
  async complete(blockPath, sessionLog = null, decisions = null) {
    const timestamp = new Date().toISOString();
    const results = {
      action: ActionType.COMPLETE,
      path: blockPath,
      steps: [],
      success: true,
    };

    try {
      // 1. Mark complete in roadmap
      await this.roadmap.markComplete(blockPath, timestamp);
      results.steps.push({ step: 'roadmap', success: true });

      // 2. Update state
      await this.state.completeBlock();
      results.steps.push({ step: 'state', success: true });

      // 3. Create replay document
      if (sessionLog) {
        await this.history.saveReplay(blockPath, sessionLog, timestamp);
        results.steps.push({ step: 'replay', success: true });
      }

      // 4. Create/update decisions
      if (decisions) {
        await this.history.saveDecisions(blockPath, decisions);
        results.steps.push({ step: 'decisions', success: true });
      }

      // 5. Git commit
      const commitResult = await this.git.commitBlock(blockPath, 'complete');
      results.steps.push({ step: 'git', success: commitResult.success });

      logger.info('ActionExecutor', 'Block completed', { blockPath, timestamp });

    } catch (err) {
      results.success = false;
      results.error = err.message;
      logger.error('ActionExecutor', 'Complete sequence failed', { blockPath, error: err.message });
    }

    return results;
  }

  /**
   * Create WIP commit before code generation
   * Safety checkpoint for rollback
   */
  async createSafepoint(blockPath) {
    return await this.git.commitWIP(blockPath);
  }

  /**
   * Rollback to last safepoint
   */
  async rollback() {
    return await this.git.rollbackLast();
  }

  /**
   * Execute action by type
   */
  async execute(action) {
    switch (action.type) {
      case ActionType.CODER:
        return await this.coder(action.files);
      
      case ActionType.EDITOR:
        return await this.editor(action.modifications);
      
      case ActionType.UPDATE:
        return await this.update(action.path, action.content);
      
      case ActionType.COMPLETE:
        return await this.complete(action.path, action.sessionLog, action.decisions);
      
      default:
        return {
          success: false,
          error: `Unknown action type: ${action.type}`,
        };
    }
  }
}

export { ActionType };
export default ActionExecutor;
