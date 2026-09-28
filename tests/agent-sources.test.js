// C.3 v57.0 — Agent Sources Tests
// ══════════════════════════════════════════════════════════════════════════════

import { RSSSource } from '../src/agents/sources/rss.js';

let passed = 0;
let failed = 0;
const failures = [];

function pass(name) {
  console.log(`  ✅ ${name}`);
  passed++;
}

function fail(name, msg) {
  console.log(`  ❌ ${name}: ${msg}`);
  failed++;
  failures.push({ name, msg });
}

function assert(condition, name, detail = '') {
  if (condition) pass(name);
  else fail(name, detail || 'assertion failed');
}

// ══════════════════════════════════════════════════════════════════════════════
// Mock fetch for testing (replaces global fetch)
// ══════════════════════════════════════════════════════════════════════════════

const originalFetch = globalThis.fetch;
let mockResponse = null;

function mockFetch(url, opts) {
  if (mockResponse === null) return originalFetch(url, opts);
  if (typeof mockResponse === 'function') return mockResponse(url, opts);
  return Promise.resolve(mockResponse);
}

globalThis.fetch = mockFetch;

function setMockResponse(statusCode, body) {
  mockResponse = {
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    text: () => Promise.resolve(body),
  };
}

function setMockError(err) {
  mockResponse = () => Promise.reject(err);
}

function clearMock() {
  mockResponse = null;
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n══════ 1. RSSSource Constructor ══════');

const src = new RSSSource({ url: 'https://example.com/rss', maxItems: 5 });
assert(src.url === 'https://example.com/rss', 'URL stored correctly');
assert(src.maxItems === 5, 'maxItems stored');
assert(src.filterKeywords.length === 0, 'No filter keywords by default');

const src2 = new RSSSource({ url: 'https://x.com/feed', filterKeywords: ['AI', 'Robot'] });
assert(src2.maxItems === 20, 'Default maxItems is 20');
assert(src2.filterKeywords.length === 2, 'Filter keywords stored');
assert(src2.filterKeywords[0] === 'ai', 'Keywords lowercased');

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n══════ 2. RSS 2.0 Parsing ══════');

const rss2xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>First Article</title>
      <link>https://example.com/1</link>
      <guid>guid-001</guid>
      <pubDate>Mon, 01 Jan 2025 10:00:00 GMT</pubDate>
      <description>This is the first article about AI technology.</description>
    </item>
    <item>
      <title>Second Article</title>
      <link>https://example.com/2</link>
      <guid>guid-002</guid>
      <pubDate>Tue, 02 Jan 2025 12:00:00 GMT</pubDate>
      <description>&lt;p&gt;HTML content with &amp;amp; entities&lt;/p&gt;</description>
    </item>
    <item>
      <title>Third Article</title>
      <link>https://example.com/3</link>
      <guid>guid-003</guid>
      <pubDate>Wed, 03 Jan 2025 08:00:00 GMT</pubDate>
      <description><![CDATA[<b>CDATA content</b> with <a href="#">links</a>]]></description>
    </item>
  </channel>
</rss>`;

setMockResponse(200, rss2xml);
const rssSource = new RSSSource({ url: 'https://example.com/rss' });
const rssResult = await rssSource.fetch();

assert(Array.isArray(rssResult.items), 'RSS result has items array');
assert(rssResult.items.length === 3, 'Parsed 3 RSS items');

const item1 = rssResult.items[0];
assert(item1.id === 'guid-001', 'Item ID from guid');
assert(item1.title === 'First Article', 'Item title parsed');
assert(item1.link === 'https://example.com/1', 'Item link parsed');
assert(item1.published === 'Mon, 01 Jan 2025 10:00:00 GMT', 'Item pubDate parsed');
assert(item1.content.includes('first article about AI'), 'Item description parsed');
assert(item1.source === 'https://example.com/rss', 'Source URL set');

// HTML entity unescaping
const item2 = rssResult.items[1];
assert(item2.content.includes('HTML content with'), 'HTML entities unescaped');
assert(item2.content.includes('&amp; entities'), 'Double-encoded ampersand decoded once');
assert(!item2.content.includes('<p>'), 'HTML tags stripped');

// CDATA handling
const item3 = rssResult.items[2];
assert(item3.content.includes('CDATA content'), 'CDATA content extracted');
assert(!item3.content.includes('<b>'), 'HTML inside CDATA stripped');

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n══════ 3. Atom Parsing ══════');

const atomXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Atom Entry One</title>
    <id>urn:atom:001</id>
    <link href="https://example.com/atom/1" rel="alternate" />
    <updated>2025-01-15T10:00:00Z</updated>
    <summary>Summary of entry one about machine learning.</summary>
  </entry>
  <entry>
    <title>Atom Entry Two</title>
    <id>urn:atom:002</id>
    <link href="https://example.com/atom/2" rel="alternate" />
    <published>2025-01-16T12:00:00Z</published>
    <content>Full content of entry two.</content>
  </entry>
</feed>`;

setMockResponse(200, atomXml);
const atomSource = new RSSSource({ url: 'https://example.com/atom' });
const atomResult = await atomSource.fetch();

assert(atomResult.items.length === 2, 'Parsed 2 Atom entries');

const atom1 = atomResult.items[0];
assert(atom1.id === 'urn:atom:001', 'Atom ID parsed');
assert(atom1.title === 'Atom Entry One', 'Atom title parsed');
assert(atom1.link === 'https://example.com/atom/1', 'Atom link extracted from href');
assert(atom1.published === '2025-01-15T10:00:00Z', 'Atom updated date used');
assert(atom1.content.includes('machine learning'), 'Atom summary parsed');

const atom2 = atomResult.items[1];
assert(atom2.published === '2025-01-16T12:00:00Z', 'Atom published preferred over updated');
assert(atom2.content.includes('Full content'), 'Atom content tag parsed');

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n══════ 4. Keyword Filtering ══════');

setMockResponse(200, rss2xml);
const filteredSource = new RSSSource({
  url: 'https://example.com/rss',
  filterKeywords: ['AI'],
});
const filteredResult = await filteredSource.fetch();

assert(filteredResult.items.length === 1, 'Only 1 item matches AI keyword');
assert(filteredResult.items[0].title === 'First Article', 'Correct item matched');

// Case-insensitive filtering
setMockResponse(200, rss2xml);
const filteredSource2 = new RSSSource({
  url: 'https://example.com/rss',
  filterKeywords: ['cdata'],
});
const filteredResult2 = await filteredSource2.fetch();
assert(filteredResult2.items.length === 1, 'Case-insensitive keyword match');
assert(filteredResult2.items[0].id === 'guid-003', 'Correct CDATA item matched');

// No match
setMockResponse(200, rss2xml);
const filteredSource3 = new RSSSource({
  url: 'https://example.com/rss',
  filterKeywords: ['quantum computing'],
});
const filteredResult3 = await filteredSource3.fetch();
assert(filteredResult3.items.length === 0, 'No items match non-existent keyword');

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n══════ 5. maxItems Limiting ══════');

setMockResponse(200, rss2xml);
const limitedSource = new RSSSource({ url: 'https://example.com/rss', maxItems: 2 });
const limitedResult = await limitedSource.fetch();
assert(limitedResult.items.length === 2, 'maxItems limits output to 2');

setMockResponse(200, rss2xml);
const limitedSource1 = new RSSSource({ url: 'https://example.com/rss', maxItems: 1 });
const limitedResult1 = await limitedSource1.fetch();
assert(limitedResult1.items.length === 1, 'maxItems limits output to 1');

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n══════ 6. Deduplication ══════');

const dupeXml = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Duplicate</title>
      <link>https://example.com/1</link>
      <guid>same-guid</guid>
      <description>First occurrence.</description>
    </item>
    <item>
      <title>Duplicate</title>
      <link>https://example.com/1</link>
      <guid>same-guid</guid>
      <description>Second occurrence.</description>
    </item>
    <item>
      <title>Unique</title>
      <link>https://example.com/2</link>
      <guid>different-guid</guid>
      <description>Unique item.</description>
    </item>
  </channel>
</rss>`;

setMockResponse(200, dupeXml);
const dedupeSource = new RSSSource({ url: 'https://example.com/rss' });
const dedupeResult = await dedupeSource.fetch();
assert(dedupeResult.items.length === 2, 'Duplicates removed (3 → 2)');
assert(dedupeResult.items[0].content.includes('First occurrence'), 'First occurrence kept');

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n══════ 7. Error Handling ══════');

// HTTP error
setMockResponse(404, 'Not Found');
try {
  const errSource = new RSSSource({ url: 'https://example.com/missing' });
  await errSource.fetch();
  fail('HTTP 404 throws', 'did not throw');
} catch (err) {
  assert(err.message.includes('404'), 'HTTP error includes status code');
}

// Network error
setMockError(new Error('ECONNREFUSED'));
try {
  const errSource = new RSSSource({ url: 'https://unreachable.local/rss' });
  await errSource.fetch();
  fail('Network error throws', 'did not throw');
} catch (err) {
  assert(err.message.includes('ECONNREFUSED'), 'Network error propagated');
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n══════ 8. Internal Helpers ══════');

const helper = new RSSSource({ url: 'https://x.com/feed' });

// _tag
assert(helper._tag('<title>Hello</title>', 'title') === 'Hello', '_tag extracts simple tag');
assert(helper._tag('<desc><![CDATA[Raw text]]></desc>', 'desc') === 'Raw text', '_tag extracts CDATA');
assert(helper._tag('<foo>bar</foo>', 'missing') === null, '_tag returns null for missing tag');

// _unescape
assert(helper._unescape('&amp; &lt; &gt;') === '& < >', '_unescape handles entities');
assert(helper._unescape('&#65;') === 'A', '_unescape handles numeric entities');
assert(helper._unescape('&quot;hi&quot;') === '"hi"', '_unescape handles quotes');

// _stripHTML
assert(helper._stripHTML('<p>Hello</p>') === 'Hello', '_stripHTML removes tags');
assert(helper._stripHTML('<b>Bold</b> and <i>italic</i>') === 'Bold and italic', '_stripHTML preserves text between tags');
assert(helper._stripHTML('No tags') === 'No tags', '_stripHTML handles plain text');

// ══════════════════════════════════════════════════════════════════════════════
// Cleanup
globalThis.fetch = originalFetch;

console.log('\n══════════════════════════════════════════');
console.log(`  PASSED: ${passed}`);
console.log(`  FAILED: ${failed}`);
console.log('══════════════════════════════════════════');

if (failures.length) {
  console.log('\n🔴 FAILURES:');
  failures.forEach(f => {
    console.log(`  ${f.name}`);
    console.log(`    → ${f.msg}`);
  });
}

console.log('');
process.exit(failed > 0 ? 1 : 0);
