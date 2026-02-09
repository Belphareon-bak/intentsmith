/**
 * C3 Diff Proposal Widget
 *
 * Opens Monaco diff editor (side-by-side) for each code change proposal.
 * Toolbar above shows file info, stats, Accept/Reject/Edit buttons.
 *
 * Workflow:
 *   1. Agent sends proposals via WebSocket
 *   2. DiffViewerService stores patches in .c3/pending-diffs/
 *   3. Review Panel lists proposals
 *   4. User clicks proposal → this widget opens Monaco diff
 *   5. User clicks Accept/Reject/Edit
 *   6. Status flows back to Review Panel and project.json
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { ILogger, URI } from '@theia/core';
import { EditorManager } from '@theia/editor/lib/browser';
import { MonacoWorkspace } from '@theia/monaco/lib/browser/monaco-workspace';
import {
  C3DiffViewer,
  CodeChangeProposal,
  UserReviewAction,
  ProposalStatus,
} from '../common/diff-viewer-protocol';

import './styles/diff-viewer.css';

/**
 * Manages opening diff editors for proposals.
 *
 * Uses Theia's built-in Monaco diff editor via DiffUris.
 * For each proposal, creates two virtual documents:
 *   - original (current file content or empty for new files)
 *   - modified (proposed content from agent)
 *
 * DiffToolbar is injected via decoration/overlay mechanism.
 */
@injectable()
export class C3DiffProposalManager {

  @inject(ILogger)
  protected readonly logger!: ILogger;

  @inject(EditorManager)
  protected readonly editorManager!: EditorManager;

  @inject(C3DiffViewer)
  protected readonly diffService!: C3DiffViewer;

  /** Callback for when user reviews a proposal */
  private reviewCallback?: (proposalId: string, action: UserReviewAction, editedContent?: string) => Promise<void>;

  private projectPath: string = '';

  setProjectPath(projectPath: string): void {
    this.projectPath = projectPath;
  }

  setReviewCallback(
    callback: (proposalId: string, action: UserReviewAction, editedContent?: string) => Promise<void>,
  ): void {
    this.reviewCallback = callback;
  }

  // ─── Open Diff for Proposal ────────────────────────────

  /**
   * Open a side-by-side diff editor for a proposal.
   * Returns the user's action (accept/reject/edit).
   */
  async openDiff(proposal: CodeChangeProposal): Promise<UserReviewAction> {
    const { original, modified } = await this.diffService.getProposalContent(
      this.projectPath,
      proposal,
    );

    // Create URIs for diff editor
    // Theia convention: scheme://authority/path
    const originalUri = new URI(`c3-diff-original:///${proposal.filePath}`);
    const modifiedUri = new URI(`c3-diff-modified:///${proposal.filePath}`);

    // Register virtual document contents
    this.registerVirtualDocument(originalUri, original);
    this.registerVirtualDocument(modifiedUri, modified);

    // Open diff editor
    const label = `C3: ${proposal.description || proposal.filePath}`;
    const diffUri = this.createDiffUri(originalUri, modifiedUri, label);

    await this.editorManager.open(diffUri, { mode: 'reveal' });

    this.logger.info(`Opened diff for: ${proposal.filePath}`);

    // Return a promise that resolves when user takes action
    // In practice, this is driven by the Review Panel UI
    return new Promise<UserReviewAction>((resolve) => {
      this.pendingReviews.set(proposal.id, resolve);
    });
  }

  // ─── User Action Handling ──────────────────────────────

  private pendingReviews = new Map<string, (action: UserReviewAction) => void>();

  /**
   * Called when user clicks Accept/Reject/Edit in Review Panel.
   */
  async handleUserAction(
    proposalId: string,
    action: UserReviewAction,
    editedContent?: string,
  ): Promise<void> {
    // Resolve the pending promise
    const resolver = this.pendingReviews.get(proposalId);
    if (resolver) {
      resolver(action);
      this.pendingReviews.delete(proposalId);
    }

    // Notify callback
    if (this.reviewCallback) {
      await this.reviewCallback(proposalId, action, editedContent);
    }
  }

  // ─── Virtual Document Registration ─────────────────────

  /**
   * Register content for a virtual URI.
   * In production, this uses Theia's InMemoryTextModelService
   * or a custom TextDocumentContentProvider.
   */
  private virtualDocuments = new Map<string, string>();

  private registerVirtualDocument(uri: URI, content: string): void {
    this.virtualDocuments.set(uri.toString(), content);
  }

  getVirtualDocumentContent(uri: string): string | undefined {
    return this.virtualDocuments.get(uri);
  }

  // ─── Diff URI Construction ─────────────────────────────

  /**
   * Create a diff URI that Theia's diff editor can open.
   *
   * Theia DiffUris format:
   *   diff:left?right#label
   */
  private createDiffUri(left: URI, right: URI, label: string): URI {
    // Theia's DiffUris.encode convention
    return new URI()
      .withScheme('diff')
      .withPath(left.path)
      .withQuery(encodeURIComponent(JSON.stringify({
        left: left.toString(),
        right: right.toString(),
      })))
      .withFragment(label);
  }

  // ─── Cleanup ───────────────────────────────────────────

  dispose(): void {
    this.virtualDocuments.clear();
    this.pendingReviews.clear();
  }
}
