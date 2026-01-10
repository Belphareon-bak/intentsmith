// C.3 Architect Mode - Git Manager
// ══════════════════════════════════════════════════════════════════════════════

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../core/logger.js';

const execAsync = promisify(exec);

/**
 * Git Manager
 * Handles all git operations for Architect Mode
 */
export class GitManager {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.lastWIPCommit = null; // HARDENING: Track WIP safepoint
  }

  /**
   * Execute git command
   */
  async git(command) {
    try {
      const { stdout, stderr } = await execAsync(`git ${command}`, {
        cwd: this.projectRoot,
      });
      return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (err) {
      logger.error('Git', `Command failed: git ${command}`, { error: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Check if git is initialized
   */
  async isInitialized() {
    const result = await this.git('rev-parse --git-dir');
    return result.success;
  }

  /**
   * Initialize git if not already
   */
  async init() {
    if (await this.isInitialized()) {
      return { success: true, message: 'Already initialized' };
    }
    
    const result = await this.git('init');
    if (result.success) {
      logger.info('Git', 'Repository initialized');
    }
    return result;
  }

  /**
   * Stage all changes
   */
  async stageAll() {
    return await this.git('add -A');
  }

  /**
   * Commit with message
   */
  async commit(message) {
    await this.stageAll();
    
    // Check if there are changes to commit
    const status = await this.git('status --porcelain');
    if (!status.stdout) {
      return { success: true, message: 'Nothing to commit' };
    }
    
    const result = await this.git(`commit -m "${message.replace(/"/g, '\\"')}"`);
    if (result.success) {
      logger.info('Git', 'Committed', { message });
    }
    return result;
  }

  /**
   * Create tag
   */
  async tag(tagName, message = '') {
    const cmd = message 
      ? `tag -a ${tagName} -m "${message.replace(/"/g, '\\"')}"` 
      : `tag ${tagName}`;
    
    const result = await this.git(cmd);
    if (result.success) {
      logger.info('Git', 'Tag created', { tag: tagName });
    }
    return result;
  }

  /**
   * Commit block completion
   * Follows conventional commit format
   */
  async commitBlock(blockPath, action = 'complete') {
    // Extract scope from path (e.g., "01-left-sidebar/02-nav" -> "left-sidebar")
    const parts = blockPath.split('/');
    const scope = parts[0].replace(/^\d+-/, '');
    const detail = parts.length > 1 ? parts[parts.length - 1].replace(/^\d+-/, '') : '';
    
    let type = 'feat';
    let message = '';
    
    switch (action) {
      case 'complete':
        message = detail 
          ? `feat(${scope}): ${detail} - complete`
          : `feat: ${scope} - complete`;
        break;
      case 'wip':
        type = 'wip';
        message = `wip(${scope}): work in progress`;
        break;
      case 'fix':
        type = 'fix';
        message = `fix(${scope}): ${detail || 'bug fix'}`;
        break;
      case 'docs':
        type = 'docs';
        message = `docs(${scope}): ${detail || 'update documentation'}`;
        break;
      default:
        message = `${type}(${scope}): ${action}`;
    }
    
    return await this.commit(message);
  }

  /**
   * Create WIP commit (safepoint)
   */
  async commitWIP(blockPath) {
    const scope = blockPath.split('/')[0].replace(/^\d+-/, '');
    const message = `wip(${scope}): safepoint before code generation`;
    
    const result = await this.commit(message);
    if (result.success && result.message !== 'Nothing to commit') {
      // Store WIP marker
      this.lastWIPCommit = await this.getLastCommit();
      logger.info('Git', 'Safepoint created', { blockPath, commit: this.lastWIPCommit });
    }
    return result;
  }

  /**
   * Check if WIP safepoint exists
   * HARDENING: Must have WIP commit before code generation
   */
  hasWIPSafepoint() {
    return !!this.lastWIPCommit;
  }

  /**
   * Get last WIP commit hash
   */
  getWIPCommit() {
    return this.lastWIPCommit || null;
  }

  /**
   * Clear WIP marker (after successful completion)
   */
  clearWIPMarker() {
    this.lastWIPCommit = null;
  }

  /**
   * Create tag for major block completion
   */
  async tagBlock(blockPath, version) {
    const scope = blockPath.split('/')[0].replace(/^\d+-/, '');
    const tagName = `v${version}-${scope}`;
    const message = `Completed ${blockPath}`;
    
    return await this.tag(tagName, message);
  }

  /**
   * Get last commit hash
   */
  async getLastCommit() {
    const result = await this.git('rev-parse HEAD');
    return result.success ? result.stdout : null;
  }

  /**
   * Rollback last commit (soft - keeps changes staged)
   */
  async rollbackLast() {
    const result = await this.git('reset --soft HEAD~1');
    if (result.success) {
      logger.warn('Git', 'Rolled back last commit');
    }
    return result;
  }

  /**
   * Hard rollback (discards changes)
   */
  async rollbackHard(commits = 1) {
    const result = await this.git(`reset --hard HEAD~${commits}`);
    if (result.success) {
      logger.warn('Git', `Hard rollback ${commits} commit(s)`);
    }
    return result;
  }

  /**
   * Get current branch
   */
  async getCurrentBranch() {
    const result = await this.git('branch --show-current');
    return result.success ? result.stdout : 'unknown';
  }

  /**
   * Get status summary
   */
  async getStatus() {
    const status = await this.git('status --short');
    const branch = await this.getCurrentBranch();
    const lastCommit = await this.git('log -1 --oneline');
    
    return {
      branch,
      lastCommit: lastCommit.success ? lastCommit.stdout : null,
      changes: status.stdout ? status.stdout.split('\n').length : 0,
      clean: !status.stdout,
    };
  }

  /**
   * Get commit log for block
   */
  async getBlockLog(blockPath, limit = 10) {
    const scope = blockPath.split('/')[0].replace(/^\d+-/, '');
    const result = await this.git(`log --oneline --grep="${scope}" -${limit}`);
    
    if (!result.success || !result.stdout) {
      return [];
    }
    
    return result.stdout.split('\n').map(line => {
      const [hash, ...messageParts] = line.split(' ');
      return { hash, message: messageParts.join(' ') };
    });
  }
}

export default GitManager;
