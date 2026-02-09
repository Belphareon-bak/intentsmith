/**
 * C3 Chat Search Widget
 *
 * Fulltext search across chat history.
 * Ctrl+Shift+H opens search panel in bottom area.
 *
 * Layout:
 *   ┌─────────────────────────────────────┐
 *   │ 🔍 [search input________________]  │
 *   │ Filter: [All ▼] [project ▼]        │
 *   ├─────────────────────────────────────┤
 *   │ 💬 user: ...text with «match»...   │
 *   │    14:32 — Mobilní aplikace         │
 *   │ 🤖 assistant: ...«match» found...  │
 *   │    14:33 — Mobilní aplikace         │
 *   ├─────────────────────────────────────┤
 *   │ 23 results (4ms)                    │
 *   └─────────────────────────────────────┘
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser';
import { CommandRegistry } from '@theia/core';
import {
  C3ChatSearch,
  ChatSearchQuery,
  ChatSearchResult,
  ChatSearchResponse,
} from '../../common/chat-search-protocol';

import '../styles/chat-search.css';

const WIDGET_ID = 'c3:chat-search';

@injectable()
export class C3ChatSearchWidget extends ReactWidget {

  static readonly ID = WIDGET_ID;
  static readonly LABEL = 'Hledat v chatu';

  @inject(C3ChatSearch)
  protected readonly searchService!: C3ChatSearch;

  @inject(CommandRegistry)
  protected readonly commands!: CommandRegistry;

  private searchText = '';
  private projectFilter: string | undefined = undefined;
  private roleFilter: 'user' | 'assistant' | undefined = undefined;
  private response: ChatSearchResponse | null = null;
  private searching = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Callback: scroll chat to a specific message */
  private scrollToMessageCallback?: (messageId: string, projectSlug: string) => void;

  constructor() {
    super();
    this.id = C3ChatSearchWidget.ID;
    this.title.label = C3ChatSearchWidget.LABEL;
    this.title.closable = true;
    this.title.iconClass = 'codicon codicon-search';
    this.addClass('c3-chat-search');
  }

  @postConstruct()
  protected init(): void {
    this.update();
  }

  setScrollToMessageCallback(cb: (id: string, projectSlug: string) => void): void {
    this.scrollToMessageCallback = cb;
  }

  // ─── Search Logic ──────────────────────────────────────

  private handleSearchInput = (text: string): void => {
    this.searchText = text;
    this.update();

    // Debounce: search after 300ms of no typing
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.executeSearch(), 300);
  };

  private async executeSearch(): Promise<void> {
    if (!this.searchText.trim()) {
      this.response = null;
      this.update();
      return;
    }

    this.searching = true;
    this.update();

    try {
      const query: ChatSearchQuery = {
        text: this.searchText.trim(),
        projectSlug: this.projectFilter,
        role: this.roleFilter,
        limit: 50,
      };

      this.response = await this.searchService.search(query);
    } catch {
      this.response = null;
    }

    this.searching = false;
    this.update();
  }

  private handleResultClick = (result: ChatSearchResult): void => {
    if (this.scrollToMessageCallback) {
      this.scrollToMessageCallback(result.entry.id, result.entry.projectSlug);
    }
  };

  // ─── Render ────────────────────────────────────────────

  protected render(): React.ReactNode {
    return (
      <div className="c3-search-container">
        {/* Search Input */}
        <div className="c3-search-header">
          <div className="c3-search-input-row">
            <span className="c3-search-icon">🔍</span>
            <input
              className="c3-search-input"
              type="text"
              placeholder="Hledat v chat historii..."
              value={this.searchText}
              onChange={e => this.handleSearchInput(e.target.value)}
              autoFocus
            />
            {this.searching && <span className="c3-search-spinner">⏳</span>}
          </div>

          <div className="c3-search-filters">
            <select
              className="c3-search-filter-select"
              value={this.roleFilter || ''}
              onChange={e => {
                this.roleFilter = (e.target.value as any) || undefined;
                this.executeSearch();
              }}
            >
              <option value="">Všechny role</option>
              <option value="user">Uživatel</option>
              <option value="assistant">Asistent</option>
            </select>
          </div>
        </div>

        {/* Results */}
        <div className="c3-search-results">
          {this.response && this.response.results.length > 0 ? (
            this.response.results.map((result, i) => (
              <SearchResultItem
                key={result.entry.id + '-' + i}
                result={result}
                onClick={() => this.handleResultClick(result)}
              />
            ))
          ) : this.response && this.searchText ? (
            <div className="c3-search-empty">
              Žádné výsledky pro "{this.searchText}"
            </div>
          ) : !this.searchText ? (
            <div className="c3-search-empty">
              Zadejte hledaný text (Ctrl+Shift+H)
            </div>
          ) : null}
        </div>

        {/* Footer */}
        {this.response && (
          <div className="c3-search-footer">
            {this.response.total} výsledků ({this.response.queryTimeMs}ms)
          </div>
        )}
      </div>
    );
  }
}

// ─── Result Item Component ───────────────────────────────

interface SearchResultItemProps {
  result: ChatSearchResult;
  onClick: () => void;
}

const ROLE_ICONS: Record<string, string> = {
  user: '💬',
  assistant: '🤖',
  system: '⚙️',
};

const SearchResultItem: React.FC<SearchResultItemProps> = ({ result, onClick }) => {
  const { entry, snippets, score } = result;
  const time = new Date(entry.timestamp).toLocaleTimeString('cs-CZ', {
    hour: '2-digit', minute: '2-digit',
  });
  const date = new Date(entry.timestamp).toLocaleDateString('cs-CZ');
  const icon = ROLE_ICONS[entry.role] || '💬';

  return (
    <div className="c3-search-result-item" onClick={onClick}>
      <div className="c3-search-result-header">
        <span className="c3-search-result-role">{icon} {entry.role}</span>
        <span className="c3-search-result-meta">
          {time} {date} — {entry.projectSlug}
        </span>
      </div>
      <div className="c3-search-result-snippets">
        {snippets.length > 0 ? (
          snippets.map((snippet, i) => (
            <div key={i} className="c3-search-result-snippet"
              dangerouslySetInnerHTML={{
                __html: snippet
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/«/g, '<mark>')
                  .replace(/»/g, '</mark>'),
              }}
            />
          ))
        ) : (
          <div className="c3-search-result-snippet">
            {entry.content.slice(0, 120)}
            {entry.content.length > 120 ? '...' : ''}
          </div>
        )}
      </div>
    </div>
  );
};
