// C.3 v57.0 — RSS/Atom Source Adapter
// ══════════════════════════════════════════════════════════════════════════════

/**
 * RSS/Atom feed source.
 * Parses both RSS 2.0 and Atom formats into a normalized item array.
 * Uses regex-based parsing — no external XML library needed.
 *
 * @example
 *   const source = new RSSSource({ url: 'https://example.com/rss' });
 *   const { items } = await source.fetch();
 */
export class RSSSource {
  /**
   * @param {object} config
   * @param {string} config.url - Feed URL
   * @param {number} [config.maxItems=20] - Max items to return
   * @param {string[]} [config.filterKeywords] - Only include items matching these keywords
   */
  constructor(config) {
    this.url = config.url;
    this.maxItems = config.maxItems || 20;
    this.filterKeywords = (config.filterKeywords || []).map(k => k.toLowerCase());
  }

  /**
   * Fetch and parse the RSS/Atom feed.
   * @returns {Promise<{items: Array<{id: string, title: string, link: string, published: string, content: string, source: string}>}>}
   */
  async fetch() {
    const response = await fetch(this.url, {
      headers: { 'User-Agent': 'C3-Agent/57.0 (RSS Reader)' },
    });

    if (!response.ok) {
      throw new Error(`RSS fetch failed: HTTP ${response.status} from ${this.url}`);
    }

    const xml = await response.text();
    const isAtom = xml.includes('<feed') && xml.includes('xmlns="http://www.w3.org/2005/Atom"');

    let items = isAtom ? this._parseAtom(xml) : this._parseRSS(xml);

    // Filter by keywords if configured
    if (this.filterKeywords.length > 0) {
      items = items.filter(item => {
        const text = `${item.title} ${item.content}`.toLowerCase();
        return this.filterKeywords.some(kw => text.includes(kw));
      });
    }

    // Deduplicate by id
    const seen = new Set();
    items = items.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

    return { items: items.slice(0, this.maxItems) };
  }

  /**
   * Parse RSS 2.0 XML into normalized items.
   */
  _parseRSS(xml) {
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const block = match[1];
      const title = this._tag(block, 'title');
      const link = this._tag(block, 'link');
      const guid = this._tag(block, 'guid');
      const pubDate = this._tag(block, 'pubDate');
      const description = this._tag(block, 'description');
      const contentEncoded = this._tag(block, 'content:encoded');

      items.push({
        id: guid || link || title,
        title: this._unescape(title || ''),
        link: link || '',
        published: pubDate || '',
        content: this._stripHTML(this._unescape(contentEncoded || description || '')),
        source: this.url,
      });
    }

    return items;
  }

  /**
   * Parse Atom XML into normalized items.
   */
  _parseAtom(xml) {
    const items = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;

    while ((match = entryRegex.exec(xml)) !== null) {
      const block = match[1];
      const title = this._tag(block, 'title');
      const id = this._tag(block, 'id');
      const updated = this._tag(block, 'updated');
      const published = this._tag(block, 'published');
      const summary = this._tag(block, 'summary');
      const content = this._tag(block, 'content');

      // Atom links are self-closing: <link href="..." />
      const linkMatch = block.match(/<link[^>]*href="([^"]*)"[^>]*(?:rel="alternate")?/);
      const link = linkMatch ? linkMatch[1] : '';

      items.push({
        id: id || link || title,
        title: this._unescape(title || ''),
        link,
        published: published || updated || '',
        content: this._stripHTML(this._unescape(content || summary || '')),
        source: this.url,
      });
    }

    return items;
  }

  /** Extract text content of an XML tag. */
  _tag(xml, tag) {
    // Handle CDATA sections
    const cdataMatch = xml.match(new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i'));
    if (cdataMatch) return cdataMatch[1].trim();

    const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    return match ? match[1].trim() : null;
  }

  /** Unescape HTML entities. */
  _unescape(str) {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));
  }

  /** Strip HTML tags from content. */
  _stripHTML(str) {
    return str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}
