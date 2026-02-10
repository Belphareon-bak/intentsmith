/**
 * C3 Design Viewer Widget — Theia ReactWidget
 *
 * Visualizes DESIGN output: architecture, sprints, decisions, stack.
 * Split layout: outline sidebar + content area with tabs.
 *
 * Data source: EXCLUSIVELY filesystem (design/*.md + project.json).
 * NEVER reads from chat — chat is input, this is output.
 *
 * Live update: watches design files and re-renders on change.
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget, Message } from '@theia/core/lib/browser';
import {
  C3DesignViewer,
  C3DesignViewerClient,
  DesignDocument,
  OutlineSection,
} from '../common/design-viewer-protocol';
import { OutlineSidebar } from './components/OutlineSidebar';
import { MetadataCards } from './components/MetadataCards';

import './styles/design-viewer.css';

// Reuse MarkdownRenderer from Sprint 1 chat-panel
// In production: extract to shared @c3/ui-components
import { MarkdownRenderer } from '@c3/chat-panel/lib/browser/components/MarkdownRenderer';

type TabId = 'architecture' | 'sprints';

@injectable()
export class C3DesignViewerWidget extends ReactWidget implements C3DesignViewerClient {

  static readonly ID = 'c3:design-viewer';
  static readonly LABEL = 'Design';

  @inject(C3DesignViewer)
  protected readonly designService!: C3DesignViewer;

  // ─── State ─────────────────────────────────────────────

  private document: DesignDocument | null = null;
  private activeTab: TabId = 'architecture';
  private activeOutlineId: string | null = null;
  private loading: boolean = false;
  private error: string | null = null;
  private projectPath: string = '';

  constructor() {
    super();
    this.id = C3DesignViewerWidget.ID;
    this.title.label = C3DesignViewerWidget.LABEL;
    this.title.closable = true;
    this.title.iconClass = 'codicon codicon-preview';
    this.addClass('c3-design-viewer');
  }

  @postConstruct()
  protected init(): void {
    this.update();
  }

  // ─── C3DesignViewerClient ──────────────────────────────

  onDesignChanged(doc: DesignDocument): void {
    this.document = doc;
    this.error = null;
    this.update();
  }

  // ─── Public API ────────────────────────────────────────

  async loadProject(projectPath: string): Promise<void> {
    this.projectPath = projectPath;
    this.loading = true;
    this.error = null;
    this.update();

    try {
      const hasDesign = await this.designService.hasDesign(projectPath);
      if (!hasDesign) {
        this.document = null;
        this.loading = false;
        this.update();
        return;
      }

      this.document = await this.designService.loadDesign(projectPath);
      await this.designService.watchDesign(projectPath);
    } catch (err: any) {
      this.error = err.message;
    } finally {
      this.loading = false;
      this.update();
    }
  }

  // ─── Actions ───────────────────────────────────────────

  private handleOutlineSelect = (section: OutlineSection): void => {
    this.activeOutlineId = section.id;
    this.activeTab = section.source;
    this.update();

    // Scroll to section
    requestAnimationFrame(() => {
      const el = this.node.querySelector(`[data-section-id="${section.id}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  private handleTabChange = (tab: TabId): void => {
    this.activeTab = tab;
    this.activeOutlineId = null;
    this.update();
  };

  // ─── Render ────────────────────────────────────────────

  protected render(): React.ReactNode {
    if (this.loading) {
      return (
        <div className="c3-design-empty">
          <div className="c3-design-empty-icon">⏳</div>
          <div>Načítám design...</div>
        </div>
      );
    }

    if (this.error) {
      return (
        <div className="c3-design-empty">
          <div className="c3-design-empty-icon">❌</div>
          <div>Chyba: {this.error}</div>
        </div>
      );
    }

    if (!this.document) {
      return (
        <div className="c3-design-empty">
          <div className="c3-design-empty-icon">📐</div>
          <div>Žádný aktivní design.</div>
          <div className="c3-design-empty-hint">
            Začněte designovat přes chat: &quot;Navrhni architekturu pro...&quot;
          </div>
        </div>
      );
    }

    const { metadata, outline } = this.document;
    const content = this.activeTab === 'architecture'
      ? this.document.architecture
      : this.document.sprints;

    return (
      <div className="c3-design-container">
        {/* Header */}
        {this.renderHeader()}

        {/* Tabs */}
        <div className="c3-design-tabs">
          <button
            className={`c3-design-tab ${this.activeTab === 'architecture' ? 'active' : ''}`}
            onClick={() => this.handleTabChange('architecture')}
          >
            📐 Architektura
          </button>
          <button
            className={`c3-design-tab ${this.activeTab === 'sprints' ? 'active' : ''}`}
            onClick={() => this.handleTabChange('sprints')}
          >
            📋 Sprinty
          </button>
        </div>

        {/* Body: outline + content */}
        <div className="c3-design-body">
          <OutlineSidebar
            sections={outline}
            activeId={this.activeOutlineId}
            onSelect={this.handleOutlineSelect}
          />

          <div className="c3-design-content">
            {/* Metadata cards (only on architecture tab) */}
            {this.activeTab === 'architecture' && metadata && (
              <MetadataCards metadata={metadata} />
            )}

            {/* Markdown content */}
            {content ? (
              <div className="c3-design-markdown">
                {this.renderMarkdownWithAnchors(content)}
              </div>
            ) : (
              <div className="c3-design-empty">
                <div className="c3-design-empty-hint">
                  {this.activeTab === 'architecture'
                    ? 'Soubor design/architecture.md neexistuje.'
                    : 'Soubor design/sprints.md neexistuje.'
                  }
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  private renderHeader(): React.ReactNode {
    const { metadata } = this.document!;
    const name = metadata?.projectName || 'Design';
    const phase = metadata?.phase || 'design';

    return (
      <div className="c3-design-header">
        <div className="c3-design-header-left">
          <span className="c3-design-header-title">📐 {name}</span>
          <span className={`c3-design-header-phase ${phase}`}>
            {phase.toUpperCase()}
            {metadata?.designTurns ? ` (krok ${metadata.designTurns})` : ''}
          </span>
        </div>
        <div className="c3-design-header-actions">
          <button
            className="c3-design-action-btn"
            onClick={() => this.exportDesign('markdown')}
            title="Export jako Markdown"
          >
            📄 MD
          </button>
          <button
            className="c3-design-action-btn"
            onClick={() => this.exportDesign('pdf')}
            title="Export jako PDF"
          >
            📑 PDF
          </button>
        </div>
      </div>
    );
  }

  /**
   * Render markdown with data-section-id anchors for outline scroll-to.
   */
  private renderMarkdownWithAnchors(content: string): React.ReactNode {
    const lines = content.split('\n');
    const blocks: React.ReactNode[] = [];
    let currentBlock: string[] = [];
    let sectionCounter = 0;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(#{1,4})\s+(.+)/);

      if (match) {
        // Flush accumulated text
        if (currentBlock.length > 0) {
          blocks.push(
            <MarkdownRenderer key={`block-${i}`} content={currentBlock.join('\n')} />
          );
          currentBlock = [];
        }

        // Render header with anchor
        const sectionId = this.slugify(match[2]) + '-' + i;
        blocks.push(
          <div key={`header-${i}`} data-section-id={sectionId}>
            <MarkdownRenderer content={lines[i]} />
          </div>
        );
        sectionCounter++;
      } else {
        currentBlock.push(lines[i]);
      }
    }

    // Flush remaining
    if (currentBlock.length > 0) {
      blocks.push(
        <MarkdownRenderer key="block-final" content={currentBlock.join('\n')} />
      );
    }

    return blocks;
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private async exportDesign(format: 'markdown' | 'pdf'): Promise<void> {
    // TODO: implement export (Sprint 5)
  }

  // ─── Theia lifecycle ───────────────────────────────────

  protected override onCloseRequest(msg: Message): void {
    this.designService.unwatchDesign();
    super.onCloseRequest(msg);
  }
}
