/**
 * @c3/chat-search — Protocol (common)
 *
 * Fulltext search across chat history using an in-memory
 * inverted index (no SQLite dependency for portability).
 *
 * For production with large histories, swap IndexService
 * for SQLite FTS5 backend — the protocol stays the same.
 *
 * Ctrl+Shift+H → Search Chat History
 *   → "WireGuard" → all messages containing WireGuard
 *   → Click result → scroll to context
 *   → "Zobrazit celou konverzaci" → open in new tab
 */

export const C3ChatSearchPath = '/services/c3-chat-search';
export const C3ChatSearch = Symbol('C3ChatSearch');

// ─── Index Entry ─────────────────────────────────────────

export interface ChatIndexEntry {
  /** Message ID */
  id: string;
  /** Project slug (for multi-project filtering) */
  projectSlug: string;
  /** Role: user | assistant | system */
  role: string;
  /** Full message content */
  content: string;
  /** ISO timestamp */
  timestamp: string;
  /** Intent (for assistant messages) */
  intent?: string;
  /** Turn ID for correlation */
  turnId?: string;
}

// ─── Search Query ────────────────────────────────────────

export interface ChatSearchQuery {
  /** Search text (fulltext) */
  text: string;
  /** Filter by project (optional) */
  projectSlug?: string;
  /** Filter by role (optional) */
  role?: 'user' | 'assistant';
  /** Filter by date range (optional) */
  after?: string;
  before?: string;
  /** Max results (default 50) */
  limit?: number;
}

// ─── Search Result ───────────────────────────────────────

export interface ChatSearchResult {
  /** Matched entry */
  entry: ChatIndexEntry;
  /** Relevance score (higher = more relevant) */
  score: number;
  /** Matched text snippets with highlighted terms */
  snippets: string[];
}

export interface ChatSearchResponse {
  results: ChatSearchResult[];
  total: number;
  queryTimeMs: number;
}

// ─── Service Interface ───────────────────────────────────

export interface C3ChatSearch {
  /** Index a new message (real-time, called on each new message) */
  indexMessage(entry: ChatIndexEntry): Promise<void>;

  /** Bulk index (for rehydration/import) */
  indexBulk(entries: ChatIndexEntry[]): Promise<number>;

  /** Search indexed messages */
  search(query: ChatSearchQuery): Promise<ChatSearchResponse>;

  /** Clear index for a project */
  clearProject(projectSlug: string): Promise<void>;

  /** Get index stats */
  getStats(): Promise<{ totalMessages: number; projects: string[] }>;
}
