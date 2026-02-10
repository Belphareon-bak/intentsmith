// ═══════════════════════════════════════════════════════════════════════════════
// C3-Agent — B5: RSS/Atom Source Adapter
// ═══════════════════════════════════════════════════════════════════════════════
//
// Source adapter for RSS 2.0 and Atom feeds.
// Used by agent runner to monitor news, blogs, listings.
//
// Features:
//   - RSS 2.0 parsing (<channel>/<item>)
//   - Atom 1.0 parsing (<feed>/<entry>)
//   - Auto-detection of feed format
//   - HTML entity unescaping + CDATA extraction
//   - HTML tag stripping from content
//   - Keyword filtering (case-insensitive, title + content)
//   - maxItems limiting
//   - Deduplication by ID/GUID
//
// API:
//   const src = new RSSSource({ url, maxItems?, filterKeywords? });
//   const { items } = await src.fetch();
//   // items: [{ id, title, link, published, content, source }]
//
// ═══════════════════════════════════════════════════════════════════════════════

export class RSSSource {
  /**
   * @param {object} config
   * @param {string} config.url - Feed URL
   * @param {number} [config.maxItems=20] - Maximum items to return
   * @param {string[]} [config.filterKeywords=[]] - Keywords to filter by (case-insensitive)
   */
  constructor(config) {
    this.url = config.url;
    this.maxItems = config.maxItems ?? 20;
    this.filterKeywords = (config.filterKeywords || []).map(k => k.toLowerCase());
  }

  /**
   * Fetch and parse the feed.
   * @returns {Promise<{ items: FeedItem[] }>}
   * @throws {Error} On HTTP or network errors
   */
  async fetch() {
    const res = await fetch(this.url);
    if (!res.ok) {
      throw new Error(`RSS fetch failed: HTTP ${res.status}`);
    }

    const xml = await res.text();
    let items;

    if (this._isAtom(xml)) {
      items = this._parseAtom(xml);
    } else {
      items = this._parseRSS(xml);
    }

    // Dedup by ID
    items = this._deduplicate(items);

    // Keyword filter
    if (this.filterKeywords.length > 0) {
      items = items.filter(item => this._matchesKeywords(item));
    }

    // Limit
    items = items.slice(0, this.maxItems);

    return { items };
  }

  // ─── Format Detection ────────────────────────────────────────────────────

  _isAtom(xml) {
    return /<feed[\s>]/.test(xml) && /<entry[\s>]/.test(xml);
  }

  // ─── RSS 2.0 Parser ─────────────────────────────────────────────────────

  _parseRSS(xml) {
    const items = [];
    const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      const rawDesc = this._tag(block, 'description');

      items.push({
        id: this._tag(block, 'guid') || this._tag(block, 'link') || `rss-${items.length}`,
        title: this._tag(block, 'title') || '',
        link: this._tag(block, 'link') || '',
        published: this._tag(block, 'pubDate') || '',
        content: rawDesc ? this._stripHTML(this._unescape(rawDesc)) : '',
        source: this.url,
      });
    }

    return items;
  }

  // ─── Atom 1.0 Parser ────────────────────────────────────────────────────

  _parseAtom(xml) {
    const items = [];
    const entryRegex = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
    let match;

    while ((match = entryRegex.exec(xml)) !== null) {
      const block = match[1];

      // Atom <link href="..." /> extraction
      const linkMatch = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/);
      const link = linkMatch ? linkMatch[1] : '';

      // Prefer <published> over <updated>
      const published = this._tag(block, 'published') || this._tag(block, 'updated') || '';

      // Prefer <content> over <summary>
      const rawContent = this._tag(block, 'content') || this._tag(block, 'summary') || '';

      items.push({
        id: this._tag(block, 'id') || link || `atom-${items.length}`,
        title: this._tag(block, 'title') || '',
        link,
        published,
        content: rawContent ? this._stripHTML(this._unescape(rawContent)) : '',
        source: this.url,
      });
    }

    return items;
  }

  // ─── Deduplication ───────────────────────────────────────────────────────

  _deduplicate(items) {
    const seen = new Set();
    return items.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }

  // ─── Keyword Matching ───────────────────────────────────────────────────

  _matchesKeywords(item) {
    const text = `${item.title} ${item.content}`.toLowerCase();
    return this.filterKeywords.some(kw => text.includes(kw));
  }

  // ─── XML Helpers ─────────────────────────────────────────────────────────

  /**
   * Extract text content from an XML tag.
   * Handles CDATA sections.
   *
   * @param {string} xml - XML fragment
   * @param {string} tag - Tag name
   * @returns {string|null}
   */
  _tag(xml, tag) {
    // Match tag with possible attributes
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = xml.match(regex);
    if (!match) return null;

    let content = match[1].trim();

    // Extract CDATA if present
    const cdataMatch = content.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
    if (cdataMatch) {
      content = cdataMatch[1];
    }

    return content;
  }

  /**
   * Unescape HTML entities.
   * @param {string} text
   * @returns {string}
   */
  _unescape(text) {
    if (!text) return '';
    return text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&amp;/g, '&'); // Must be last
  }

  /**
   * Strip HTML tags from text.
   * @param {string} html
   * @returns {string}
   */
  _stripHTML(html) {
    if (!html) return '';
    return html
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

export default RSSSource;
