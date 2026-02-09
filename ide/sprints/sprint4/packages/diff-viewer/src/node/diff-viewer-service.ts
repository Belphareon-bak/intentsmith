/**
 * @c3/diff-viewer — Backend Service
 *
 * Manages diff proposals lifecycle:
 *   1. Agent creates change set → patches stored in .c3/pending-diffs/
 *   2. project.json updated with pending_changes + phase=pending_review
 *   3. User reviews in IDE (even after restart)
 *   4. Accept → apply to disk; Reject → clean up
 *
 * Diff storage:
 *   .c3/pending-diffs/
 *   ├── changeset.json          — metadata (proposals, context, status)
 *   ├── vpn_service.dart.patch  — unified diff
 *   ├── vpn_service.dart.mod    — full modified content
 *   └── vpn_test.dart.patch
 *
 * All writes are atomic (tmp + fsync + rename).
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { ILogger } from '@theia/core';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as crypto from 'crypto';
import {
  C3DiffViewer,
  C3DiffViewerClient,
  CodeChangeProposal,
  ChangeSet,
  ChangeSetContext,
  ChangeSetStatus,
  ProposalStatus,
  DiffStats,
  ApplyResult,
} from '../common/diff-viewer-protocol';

const PENDING_DIR = '.c3/pending-diffs';
const CHANGESET_FILE = 'changeset.json';

@injectable()
export class C3DiffViewerService implements C3DiffViewer {

  @inject(ILogger)
  protected readonly logger!: ILogger;

  private client: C3DiffViewerClient | undefined;

  setClient(client: C3DiffViewerClient): void {
    this.client = client;
  }

  // ─── Create Change Set ─────────────────────────────────

  async createChangeSet(
    projectPath: string,
    label: string,
    rawProposals: Omit<CodeChangeProposal, 'id' | 'patchPath' | 'status'>[],
    context: ChangeSetContext,
  ): Promise<ChangeSet> {
    const diffsDir = path.join(projectPath, PENDING_DIR);
    await fs.ensureDir(diffsDir);

    // Build proposals with IDs and stored patches
    const proposals: CodeChangeProposal[] = [];

    for (const raw of rawProposals) {
      const id = this.generateId();
      const safeName = this.safeFileName(raw.filePath);
      const patchPath = path.join(PENDING_DIR, `${safeName}.patch`);

      // Store diff patch
      await this.atomicWrite(
        path.join(projectPath, patchPath),
        raw.diff,
      );

      // Store modified content if provided
      if (raw.modifiedContent) {
        await this.atomicWrite(
          path.join(projectPath, PENDING_DIR, `${safeName}.mod`),
          raw.modifiedContent,
        );
      }

      proposals.push({
        id,
        filePath: raw.filePath,
        description: raw.description,
        diff: raw.diff,
        patchPath,
        stats: raw.stats || this.parseDiffStats(raw.diff),
        status: 'pending',
        originalContent: raw.originalContent,
        modifiedContent: raw.modifiedContent,
      });
    }

    const changeSet: ChangeSet = {
      id: this.generateId(),
      label,
      proposals,
      status: 'pending',
      createdAt: new Date().toISOString(),
      context,
    };

    // Store changeset metadata
    await this.atomicWriteJson(
      path.join(diffsDir, CHANGESET_FILE),
      changeSet,
    );

    this.logger.info(`ChangeSet created: ${label} (${proposals.length} files)`);
    this.client?.onChangeSetCreated(changeSet);

    return changeSet;
  }

  // ─── Load Change Set ───────────────────────────────────

  async loadChangeSet(projectPath: string): Promise<ChangeSet | null> {
    const csPath = path.join(projectPath, PENDING_DIR, CHANGESET_FILE);

    if (!await fs.pathExists(csPath)) return null;

    try {
      const data = await fs.readJson(csPath);

      // Rehydrate diff content from patch files
      for (const proposal of data.proposals) {
        const patchFullPath = path.join(projectPath, proposal.patchPath);
        if (await fs.pathExists(patchFullPath)) {
          proposal.diff = await fs.readFile(patchFullPath, 'utf-8');
        }

        // Load modified content if stored
        const modPath = path.join(
          projectPath, PENDING_DIR,
          this.safeFileName(proposal.filePath) + '.mod',
        );
        if (await fs.pathExists(modPath)) {
          proposal.modifiedContent = await fs.readFile(modPath, 'utf-8');
        }
      }

      return data;
    } catch (err: any) {
      this.logger.error(`Failed to load changeset: ${err.message}`);
      return null;
    }
  }

  // ─── Get Proposal Content ──────────────────────────────

  async getProposalContent(
    projectPath: string,
    proposal: CodeChangeProposal,
  ): Promise<{ original: string; modified: string }> {
    // Read original file
    let original = '';
    const originalPath = path.join(projectPath, proposal.filePath);
    if (!proposal.stats.isNew && await fs.pathExists(originalPath)) {
      original = await fs.readFile(originalPath, 'utf-8');
    }

    // Read modified content
    let modified = '';
    if (proposal.modifiedContent) {
      modified = proposal.modifiedContent;
    } else {
      // Reconstruct from diff
      modified = this.applyUnifiedDiff(original, proposal.diff);
    }

    return { original, modified };
  }

  // ─── Update Proposal Status ────────────────────────────

  async updateProposalStatus(
    projectPath: string,
    proposalId: string,
    status: ProposalStatus,
    editedContent?: string,
  ): Promise<ChangeSet> {
    const changeSet = await this.loadChangeSet(projectPath);
    if (!changeSet) {
      throw new Error('No active change set');
    }

    const proposal = changeSet.proposals.find(p => p.id === proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`);
    }

    proposal.status = status;

    // If edited, store the edited content
    if (status === 'edited' && editedContent) {
      proposal.modifiedContent = editedContent;
      const safeName = this.safeFileName(proposal.filePath);
      await this.atomicWrite(
        path.join(projectPath, PENDING_DIR, `${safeName}.mod`),
        editedContent,
      );
    }

    // Recalculate overall status
    changeSet.status = this.calculateSetStatus(changeSet.proposals);

    // Persist
    await this.atomicWriteJson(
      path.join(projectPath, PENDING_DIR, CHANGESET_FILE),
      changeSet,
    );

    this.client?.onProposalStatusChanged(proposalId, status);
    return changeSet;
  }

  // ─── Apply Accepted Changes ────────────────────────────

  async applyAccepted(projectPath: string): Promise<ApplyResult> {
    const changeSet = await this.loadChangeSet(projectPath);
    if (!changeSet) {
      throw new Error('No active change set');
    }

    const result: ApplyResult = {
      applied: 0,
      rejected: 0,
      edited: 0,
      writtenFiles: [],
    };

    for (const proposal of changeSet.proposals) {
      if (proposal.status === 'rejected') {
        result.rejected++;
        continue;
      }

      if (proposal.status !== 'accepted' && proposal.status !== 'edited') {
        // Still pending — skip
        continue;
      }

      const targetPath = path.join(projectPath, proposal.filePath);

      if (proposal.stats.isDelete) {
        // Delete file
        if (await fs.pathExists(targetPath)) {
          await fs.remove(targetPath);
          result.writtenFiles.push(proposal.filePath);
          result.applied++;
        }
        continue;
      }

      // Get content to write
      let content: string;
      if (proposal.status === 'edited' && proposal.modifiedContent) {
        content = proposal.modifiedContent;
        result.edited++;
      } else if (proposal.modifiedContent) {
        content = proposal.modifiedContent;
        result.applied++;
      } else {
        // Reconstruct from diff
        const original = await fs.pathExists(targetPath)
          ? await fs.readFile(targetPath, 'utf-8')
          : '';
        content = this.applyUnifiedDiff(original, proposal.diff);
        result.applied++;
      }

      // Ensure directory exists
      await fs.ensureDir(path.dirname(targetPath));

      // Atomic write
      await this.atomicWrite(targetPath, content);
      result.writtenFiles.push(proposal.filePath);
    }

    // Mark change set as applied
    changeSet.status = 'applied';
    await this.atomicWriteJson(
      path.join(projectPath, PENDING_DIR, CHANGESET_FILE),
      changeSet,
    );

    this.logger.info(
      `ChangeSet applied: ${result.applied} accepted, ${result.edited} edited, ${result.rejected} rejected`,
    );

    this.client?.onChangeSetApplied(result);
    return result;
  }

  // ─── Reject All ────────────────────────────────────────

  async rejectAll(projectPath: string): Promise<void> {
    const changeSet = await this.loadChangeSet(projectPath);
    if (!changeSet) return;

    for (const p of changeSet.proposals) {
      p.status = 'rejected';
    }
    changeSet.status = 'all_rejected';

    await this.atomicWriteJson(
      path.join(projectPath, PENDING_DIR, CHANGESET_FILE),
      changeSet,
    );

    this.logger.info('ChangeSet rejected');
  }

  // ─── Diff Parsing ─────────────────────────────────────

  parseDiffStats(diff: string): DiffStats {
    let additions = 0;
    let deletions = 0;
    let isNew = false;
    let isDelete = false;

    const lines = diff.split('\n');
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      } else if (line.startsWith('--- /dev/null')) {
        isNew = true;
      } else if (line.startsWith('+++ /dev/null')) {
        isDelete = true;
      }
    }

    return { additions, deletions, isNew, isDelete };
  }

  /**
   * Apply a unified diff to original content.
   * Simplified implementation — handles common cases.
   * For complex patches, use a proper diff library in production.
   */
  private applyUnifiedDiff(original: string, diff: string): string {
    const diffLines = diff.split('\n');
    const origLines = original.split('\n');
    const result: string[] = [];

    let origIdx = 0;
    let i = 0;

    // Skip diff headers
    while (i < diffLines.length && !diffLines[i].startsWith('@@')) {
      i++;
    }

    while (i < diffLines.length) {
      const line = diffLines[i];

      if (line.startsWith('@@')) {
        // Parse hunk header: @@ -start,count +start,count @@
        const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (match) {
          const origStart = parseInt(match[1], 10) - 1;

          // Copy lines before this hunk
          while (origIdx < origStart && origIdx < origLines.length) {
            result.push(origLines[origIdx]);
            origIdx++;
          }
        }
        i++;
        continue;
      }

      if (line.startsWith('-')) {
        // Line removed — skip in original
        origIdx++;
        i++;
      } else if (line.startsWith('+')) {
        // Line added
        result.push(line.slice(1));
        i++;
      } else if (line.startsWith(' ') || line === '') {
        // Context line
        if (origIdx < origLines.length) {
          result.push(origLines[origIdx]);
          origIdx++;
        }
        i++;
      } else {
        i++;
      }
    }

    // Copy remaining original lines
    while (origIdx < origLines.length) {
      result.push(origLines[origIdx]);
      origIdx++;
    }

    return result.join('\n');
  }

  // ─── Status Calculation ────────────────────────────────

  private calculateSetStatus(proposals: CodeChangeProposal[]): ChangeSetStatus {
    if (proposals.every(p => p.status === 'pending')) return 'pending';
    if (proposals.some(p => p.status === 'pending')) return 'pending';
    if (proposals.every(p => p.status === 'rejected')) return 'all_rejected';
    if (proposals.every(p => p.status === 'accepted' || p.status === 'edited')) return 'all_accepted';
    return 'reviewed';
  }

  // ─── Helpers ───────────────────────────────────────────

  private generateId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  private safeFileName(filePath: string): string {
    return filePath.replace(/[/\\]/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private async atomicWrite(filePath: string, content: string): Promise<void> {
    const tmp = filePath + '.tmp';
    await fs.ensureDir(path.dirname(filePath));
    const fd = await fs.open(tmp, 'w');
    try {
      await fs.writeFile(fd, content, 'utf-8');
      await fs.fsync(fd);
    } finally {
      await fs.close(fd);
    }
    await fs.rename(tmp, filePath);
  }

  private async atomicWriteJson(filePath: string, data: any): Promise<void> {
    await this.atomicWrite(filePath, JSON.stringify(data, null, 2) + '\n');
  }
}
