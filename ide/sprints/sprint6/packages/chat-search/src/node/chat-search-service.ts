/**
 * @c3/chat-search — Index Service (node)
 *
 * In-memory inverted index for fulltext search.
 * For production, swap for SQLite FTS5 — protocol is identical.
 *
 * Index structure:
 *   tokenMap: Map<token, Set<messageId>>
 *   entries:  Map<messageId, ChatIndexEntry>
 *
 * Scoring: TF (term frequency in document) × position bonus
 * Snippet: ±40 chars around first match, with «highlighted» terms
 *
 * Real-time: indexMessage() on each new chat message.
 * Bulk: indexBulk() on rehydration (loads conversation.jsonl).
 */

import {
  C3ChatSearch,
  ChatIndexEntry,
  ChatSearchQuery,
  ChatSearchResult,
  ChatSearchResponse,
} from '../common/chat-search-protocol';

export class C3ChatSearchService implements C3ChatSearch {

  /** messageId → entry */
  private entries = new Map<string, ChatIndexEntry>();

  /** normalized token → Set<messageId> */
  private tokenMap = new Map<string, Set<string>>();

  /** project → Set<messageId> */
  private projectIndex = new Map<string, Set<string>>();

  // ─── Indexing ──────────────────────────────────────────

  async indexMessage(entry: ChatIndexEntry): Promise<void> {
    this.entries.set(entry.id, entry);

    // Project index
    if (!this.projectIndex.has(entry.projectSlug)) {
      this.projectIndex.set(entry.projectSlug, new Set());
    }
    this.projectIndex.get(entry.projectSlug)!.add(entry.id);

    // Tokenize and index
    const tokens = this.tokenize(entry.content);
    for (const token of tokens) {
      if (!this.tokenMap.has(token)) {
        this.tokenMap.set(token, new Set());
      }
      this.tokenMap.get(token)!.add(entry.id);
    }
  }

  async indexBulk(entries: ChatIndexEntry[]): Promise<number> {
    let count = 0;
    for (const entry of entries) {
      await this.indexMessage(entry);
      count++;
    }
    return count;
  }

  // ─── Search ────────────────────────────────────────────

  async search(query: ChatSearchQuery): Promise<ChatSearchResponse> {
    const start = Date.now();
    const limit = query.limit || 50;

    // Tokenize query
    const queryTokens = this.tokenize(query.text);
    if (queryTokens.length === 0) {
      return { results: [], total: 0, queryTimeMs: Date.now() - start };
    }

    // Find candidate message IDs (intersection of token sets)
    let candidateIds: Set<string> | null = null;

    for (const token of queryTokens) {
      // Support prefix matching for partial words
      const matchingIds = new Set<string>();
      for (const [indexedToken, ids] of this.tokenMap) {
        if (indexedToken.startsWith(token) || token.startsWith(indexedToken)) {
          for (const id of ids) matchingIds.add(id);
        }
      }

      if (candidateIds === null) {
        candidateIds = matchingIds;
      } else {
        // Intersection: keep only IDs present in both sets
        candidateIds = new Set(
          [...candidateIds].filter(id => matchingIds.has(id)),
        );
      }

      if (candidateIds.size === 0) break;
    }

    if (!candidateIds || candidateIds.size === 0) {
      return { results: [], total: 0, queryTimeMs: Date.now() - start };
    }

    // Apply filters
    let filtered = [...candidateIds]
      .map(id => this.entries.get(id)!)
      .filter(Boolean);

    if (query.projectSlug) {
      filtered = filtered.filter(e => e.projectSlug === query.projectSlug);
    }
    if (query.role) {
      filtered = filtered.filter(e => e.role === query.role);
    }
    if (query.after) {
      const afterDate = new Date(query.after).getTime();
      filtered = filtered.filter(e => new Date(e.timestamp).getTime() >= afterDate);
    }
    if (query.before) {
      const beforeDate = new Date(query.before).getTime();
      filtered = filtered.filter(e => new Date(e.timestamp).getTime() <= beforeDate);
    }

    // Score and rank
    const scored: ChatSearchResult[] = filtered.map(entry => ({
      entry,
      score: this.calculateScore(entry, queryTokens),
      snippets: this.extractSnippets(entry.content, queryTokens),
    }));

    scored.sort((a, b) => b.score - a.score);

    const total = scored.length;
    const results = scored.slice(0, limit);

    return {
      results,
      total,
      queryTimeMs: Date.now() - start,
    };
  }

  // ─── Clear ─────────────────────────────────────────────

  async clearProject(projectSlug: string): Promise<void> {
    const ids = this.projectIndex.get(projectSlug);
    if (!ids) return;

    for (const id of ids) {
      const entry = this.entries.get(id);
      if (entry) {
        // Remove from token index
        const tokens = this.tokenize(entry.content);
        for (const token of tokens) {
          const set = this.tokenMap.get(token);
          if (set) {
            set.delete(id);
            if (set.size === 0) this.tokenMap.delete(token);
          }
        }
      }
      this.entries.delete(id);
    }
    this.projectIndex.delete(projectSlug);
  }

  // ─── Stats ─────────────────────────────────────────────

  async getStats(): Promise<{ totalMessages: number; projects: string[] }> {
    return {
      totalMessages: this.entries.size,
      projects: [...this.projectIndex.keys()],
    };
  }

  // ─── Tokenization ─────────────────────────────────────

  /**
   * Tokenize text into normalized lowercase tokens.
   * Strips diacritics for Czech-friendly search.
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')  // strip diacritics
      .replace(/[^a-z0-9\s]/g, ' ')     // non-alnum → space
      .split(/\s+/)
      .filter(t => t.length >= 2);       // min 2 chars
  }

  // ─── Scoring ───────────────────────────────────────────

  /**
   * Score = sum of (TF per query token) + position bonus.
   * Earlier matches score higher.
   */
  private calculateScore(entry: ChatIndexEntry, queryTokens: string[]): number {
    const contentLower = entry.content.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    let score = 0;

    for (const token of queryTokens) {
      // Term frequency
      let tf = 0;
      let pos = contentLower.indexOf(token);
      let firstPos = -1;

      while (pos !== -1) {
        tf++;
        if (firstPos === -1) firstPos = pos;
        pos = contentLower.indexOf(token, pos + 1);
      }

      score += tf;

      // Position bonus: earlier match → higher score
      if (firstPos >= 0) {
        score += Math.max(0, 1 - firstPos / contentLower.length);
      }
    }

    // Recency bonus: newer messages score slightly higher
    const age = Date.now() - new Date(entry.timestamp).getTime();
    const ageHours = age / (1000 * 60 * 60);
    score += Math.max(0, 0.5 - ageHours / 720); // bonus decays over 30 days

    return score;
  }

  // ─── Snippet Extraction ────────────────────────────────

  /**
   * Extract ±40 char snippets around matches, with «highlighted» terms.
   */
  private extractSnippets(content: string, queryTokens: string[]): string[] {
    const contentLower = content.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    const snippets: string[] = [];
    const seen = new Set<number>(); // avoid overlapping snippets

    for (const token of queryTokens) {
      const pos = contentLower.indexOf(token);
      if (pos === -1) continue;

      // Check overlap
      const bucketKey = Math.floor(pos / 60);
      if (seen.has(bucketKey)) continue;
      seen.add(bucketKey);

      const start = Math.max(0, pos - 40);
      const end = Math.min(content.length, pos + token.length + 40);

      let snippet = '';
      if (start > 0) snippet += '...';
      snippet += content.slice(start, pos);
      snippet += '«' + content.slice(pos, pos + token.length) + '»';
      snippet += content.slice(pos + token.length, end);
      if (end < content.length) snippet += '...';

      snippets.push(snippet);

      if (snippets.length >= 3) break; // max 3 snippets
    }

    return snippets;
  }
}
