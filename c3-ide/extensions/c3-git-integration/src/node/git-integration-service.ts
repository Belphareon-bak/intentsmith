/**
 * @c3/git-integration — Backend Service
 *
 * Minimal git integration:
 *   - Auto-commit after review apply
 *   - Sprint branch management (c3/sprint-N)
 *   - Descriptive commit messages from agent context
 *
 * SECURITY: Uses ShellTool's argv-based spawn (shell: false).
 * All git operations use explicit subcommands + args.
 *
 * NOT included (user does manually):
 *   - merge, rebase, push
 *   - conflict resolution
 *   - remote management
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core';
import { spawn } from 'child_process';
import * as path from 'path';
import {
  C3GitIntegration,
  CommitRequest,
  CommitResult,
  CommitMessage,
  BranchInfo,
} from '../common/git-integration-protocol';

@injectable()
export class C3GitIntegrationService implements C3GitIntegration {

  @inject(ILogger)
  protected readonly logger!: ILogger;

  // ─── Public API ────────────────────────────────────────

  async isGitRepo(projectPath: string): Promise<boolean> {
    try {
      const result = await this.git(projectPath, ['rev-parse', '--is-inside-work-tree']);
      return result.stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  async getBranchInfo(projectPath: string): Promise<BranchInfo> {
    const currentResult = await this.git(projectPath, ['branch', '--show-current']);
    const current = currentResult.stdout.trim() || 'HEAD (detached)';

    const branchResult = await this.git(projectPath, ['branch', '--list', 'c3/*']);
    const c3Branches = branchResult.stdout
      .split('\n')
      .map(b => b.trim().replace(/^\*\s*/, ''))
      .filter(b => b.startsWith('c3/'));

    return { current, c3Branches };
  }

  async createSprintBranch(projectPath: string, sprintNumber: number): Promise<string> {
    const branchName = `c3/sprint-${sprintNumber}`;

    // Check if branch already exists
    try {
      await this.git(projectPath, ['rev-parse', '--verify', branchName]);
      // Branch exists — check it out
      await this.git(projectPath, ['checkout', branchName]);
      this.logger.info(`Checked out existing branch: ${branchName}`);
    } catch {
      // Branch doesn't exist — create it
      await this.git(projectPath, ['checkout', '-b', branchName]);
      this.logger.info(`Created new branch: ${branchName}`);
    }

    return branchName;
  }

  async autoCommit(projectPath: string, request: CommitRequest): Promise<CommitResult> {
    try {
      // Stage specific files
      for (const file of request.files) {
        await this.git(projectPath, ['add', file]);
      }

      // Generate commit message
      const message = this.generateCommitMessage(request);

      // Commit with message
      const result = await this.git(projectPath, [
        'commit',
        '-m', message.full,
        '--no-verify',  // Skip hooks (agent commit, not user commit)
      ]);

      // Get commit hash
      const hashResult = await this.git(projectPath, ['rev-parse', '--short', 'HEAD']);
      const hash = hashResult.stdout.trim();

      this.logger.info(`Auto-committed: ${hash} — ${message.subject}`);

      return { success: true, hash };

    } catch (err: any) {
      this.logger.error(`Git commit failed: ${err.message}`);
      return {
        success: false,
        error: err.message || 'Git commit failed',
      };
    }
  }

  generateCommitMessage(request: CommitRequest): CommitMessage {
    const { subject, body, context } = request;

    // Build subject line
    // Format: feat(scope): Description
    const finalSubject = subject || `feat: C3 Sprint ${context.sprintNumber} changes`;

    // Build body
    const bodyLines = [
      '',
      `C3 Agent — Sprint ${context.sprintNumber}, Step ${context.stepNumber}`,
      '',
      ...body.map(line => `- ${line}`),
      '',
      `Intent: ${context.intent}`,
      `Project: ${context.projectName}`,
    ];

    const fullBody = bodyLines.join('\n');
    const full = `${finalSubject}\n${fullBody}`;

    return { subject: finalSubject, body: fullBody, full };
  }

  async isClean(projectPath: string): Promise<boolean> {
    try {
      const result = await this.git(projectPath, ['status', '--porcelain']);
      return result.stdout.trim() === '';
    } catch {
      return true; // Not a git repo — consider clean
    }
  }

  // ─── Git Command Execution ─────────────────────────────

  /**
   * Execute git command with argv-based spawn (shell: false).
   * This mirrors ShellToolService's security model.
   */
  private git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        cwd,
        shell: false,  // ← CRITICAL: argv-based only
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr, exitCode: code });
        } else {
          reject(new Error(`git ${args[0]} failed (exit ${code}): ${stderr}`));
        }
      });

      child.on('error', (err) => {
        reject(new Error(`git spawn failed: ${err.message}`));
      });
    });
  }
}
