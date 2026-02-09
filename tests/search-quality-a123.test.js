#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// C3-Agent — A1 + A2 + A3: Fetch Quality, Search Retry, Confidence Styling
// ═══════════════════════════════════════════════════════════════════════════════
//
// Run: node tests/search-quality-a123.test.js
//
// ═══════════════════════════════════════════════════════════════════════════════

import {
  cleanPageContent,
  stripHTML,
  removeBoilerplate,
  normalizeWhitespace,
  smartTruncate,
  detectPaywall,
} from '../src/chat/handlers/utils/fetch-quality.js';

import {
  simplifyQuery,
  translateToEnglish,
  expandQuery,
  alternativeQuery,
  generateRetryQueries,
  retryableSearch,
} from '../src/chat/handlers/utils/search-retry.js';

import {
  Confidence,
  scoreToLevel,
  confidenceCssClass,
  getConfidenceIndicator,
  formatSourceAttribution,
  styleWithConfidence,
  getConfidenceCss,
} from '../src/chat/handlers/utils/confidence-styling.js';

// ─── Test Runner ─────────────────────────────────────────────────────────────

let total = 0, passed = 0, failed = 0;
const failures = [];
let currentSection = '';

function section(name) {
  currentSection = name;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${'─'.repeat(60)}`);
}

async function t(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
    failures.push({ section: currentSection, name, error: err.message });
  }
}

function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`${msg} Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function ok(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  A1: FETCH PAGE QUALITY
// ═══════════════════════════════════════════════════════════════════════════════

section('A1.1 — HTML stripping');

await t('strips script/style blocks', async () => {
  const html = '<p>Hello</p><script>alert("xss")</script><style>.a{color:red}</style><p>World</p>';
  const r = stripHTML(html);
  ok(!r.includes('alert'), 'Script content should be removed');
  ok(!r.includes('color:red'), 'Style content should be removed');
  ok(r.includes('Hello'), 'Content should remain');
  ok(r.includes('World'), 'Content should remain');
});

await t('converts headings to markdown markers', async () => {
  const html = '<h1>Title</h1><h2>Subtitle</h2><p>Body text.</p>';
  const r = stripHTML(html);
  ok(r.includes('## Title'), `Expected heading marker, got: ${r}`);
  ok(r.includes('## Subtitle'), 'Expected h2 marker');
  ok(r.includes('Body text'), 'Body preserved');
});

await t('converts list items to bullets', async () => {
  const html = '<ul><li>First</li><li>Second</li><li>Third</li></ul>';
  const r = stripHTML(html);
  ok(r.includes('• First'), 'Expected bullet');
  ok(r.includes('• Second'), 'Expected bullet');
});

await t('removes nav/footer/aside', async () => {
  const html = '<nav>Home | About | Contact</nav><main><p>Article content here.</p></main><footer>© 2024</footer>';
  const r = stripHTML(html);
  ok(!r.includes('Home | About'), 'Nav should be removed');
  ok(!r.includes('© 2024'), 'Footer should be removed');
  ok(r.includes('Article content'), 'Main content preserved');
});

await t('decodes HTML entities', async () => {
  const html = '<p>Tom &amp; Jerry &lt;3 &quot;fun&quot; &#39;show&#39;</p>';
  const r = stripHTML(html);
  ok(r.includes('Tom & Jerry'), 'Ampersand decoded');
  ok(r.includes('<3'), 'Lt decoded');
  ok(r.includes('"fun"'), 'Quot decoded');
});

await t('handles empty/null input', async () => {
  eq(stripHTML(''), '');
  eq(stripHTML(null), '');
  eq(stripHTML(undefined), '');
});

section('A1.2 — Boilerplate removal');

await t('removes cookie consent patterns', async () => {
  const text = 'Article text.\nWe use cookies to improve your experience. Accept all cookies.\nMore article text.';
  const r = removeBoilerplate(text);
  ok(!r.includes('Accept all cookies'), 'Cookie consent removed');
  ok(r.includes('Article text'), 'Content preserved');
});

await t('removes copyright lines', async () => {
  const text = 'Content here.\n© 2024 Example Corp. All rights reserved.\nMore content.';
  const r = removeBoilerplate(text);
  ok(!r.includes('© 2024'), 'Copyright removed');
});

await t('removes subscribe/newsletter CTAs', async () => {
  const text = 'Article.\nSubscribe to our newsletter for daily updates.\nMore article.';
  const r = removeBoilerplate(text);
  ok(!r.includes('Subscribe to our newsletter'), 'CTA removed');
});

await t('removes social share buttons', async () => {
  const text = 'Content.\nShare on Facebook Share on Twitter\nMore content.';
  const r = removeBoilerplate(text);
  ok(!r.includes('Share on Facebook'), 'Social buttons removed');
});

section('A1.3 — Paywall detection');

await t('clean content → not blocked', async () => {
  const r = detectPaywall('Praha je hlavní město České republiky. Má přes milion obyvatel.');
  eq(r.blocked, false);
});

await t('short content with login wall → blocked', async () => {
  const r = detectPaywall('Please log in to continue reading this article.');
  eq(r.blocked, true);
  ok(r.confidence > 0.5, `Expected high confidence, got ${r.confidence}`);
});

await t('paywall message → blocked', async () => {
  const r = detectPaywall('Subscribe to read the full article. Premium content only for subscribers.');
  eq(r.blocked, true);
});

await t('long content with incidental login mention → not blocked', async () => {
  const longText = 'x'.repeat(800) + ' You can also log in for premium features. ' + 'y'.repeat(800);
  const r = detectPaywall(longText);
  // Long content with passing mention should not be blocked
  eq(r.blocked, false);
});

section('A1.4 — Smart truncation');

await t('short text → not truncated', async () => {
  const r = smartTruncate('Short text.', 8000);
  eq(r.truncated, false);
  eq(r.text, 'Short text.');
});

await t('long text → truncated at paragraph', async () => {
  const paragraphs = Array.from({ length: 50 }, (_, i) => `Paragraph ${i + 1}. ${'x'.repeat(200)}`);
  const text = paragraphs.join('\n\n');
  const r = smartTruncate(text, 2000);
  eq(r.truncated, true);
  ok(r.text.length <= 2100, `Should be ≈2000 chars, got ${r.text.length}`);
  ok(r.text.includes('[…truncated]'), 'Should have truncation marker');
  ok(r.originalLength > 2000, 'Original should be longer');
});

await t('truncation prefers paragraph boundary', async () => {
  const text = 'First paragraph about history.\n\nSecond paragraph about culture.\n\nThird paragraph about food.';
  const r = smartTruncate(text, 60);
  ok(r.truncated, 'Should be truncated');
  // Should cut at a paragraph boundary
  ok(r.text.includes('First paragraph'), 'First para preserved');
});

await t('null/empty input handled', async () => {
  const r1 = smartTruncate(null, 100);
  eq(r1.text, '');
  eq(r1.truncated, false);

  const r2 = smartTruncate('', 100);
  eq(r2.text, '');
  eq(r2.truncated, false);
});

section('A1.5 — cleanPageContent pipeline');

await t('good HTML article → GOOD quality', async () => {
  const html = `
    <html><head><title>Test</title><style>body{margin:0}</style></head>
    <body>
      <nav>Home | About</nav>
      <article>
        <h1>Prague Guide</h1>
        <p>Prague is the capital of the Czech Republic with a rich history spanning over 1000 years.</p>
        <p>The city offers excellent restaurants, beautiful architecture, and vibrant nightlife.</p>
        <p>Popular attractions include Charles Bridge, Prague Castle, and Old Town Square.</p>
        <p>Prague has over 1.3 million residents and is one of the most visited cities in Europe.</p>
      </article>
      <footer>© 2024 Example</footer>
    </body></html>`;
  const r = cleanPageContent(html, 'Prague guide');
  eq(r.quality.grade, 'GOOD');
  eq(r.quality.usable, true);
  ok(r.content.includes('Prague'), 'Content preserved');
  ok(!r.content.includes('Home | About'), 'Nav removed');
  ok(!r.content.includes('© 2024'), 'Footer removed');
});

await t('empty page → EMPTY', async () => {
  const r = cleanPageContent('', 'test');
  eq(r.quality.grade, 'EMPTY');
  eq(r.quality.usable, false);
});

await t('login wall → BLOCKED', async () => {
  const html = '<body><p>Please log in to continue. Create an account to read this article.</p></body>';
  const r = cleanPageContent(html, 'test');
  // Short + login = blocked
  ok(!r.quality.usable || r.paywall.blocked, 'Should detect as blocked or unusable');
});

await t('plain text mode (isHTML=false)', async () => {
  const text = 'This is plain text content about Prague restaurants. It has enough content to be useful for search.';
  const r = cleanPageContent(text, 'Prague restaurants', { isHTML: false });
  eq(r.quality.usable, true);
  ok(r.content.includes('Prague restaurants'), 'Content preserved');
});

await t('long article → truncated', async () => {
  const html = '<p>' + 'Long content about Prague. '.repeat(500) + '</p>';
  const r = cleanPageContent(html, 'Prague', { maxChars: 1000 });
  eq(r.truncated, true);
  ok(r.content.length <= 1100, `Should be ≈1000 chars, got ${r.content.length}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
//  A2: SEARCH AUTO-RETRY
// ═══════════════════════════════════════════════════════════════════════════════

section('A2.1 — Query simplification');

await t('CZ: removes stop words', async () => {
  const r = simplifyQuery('Jaké jsou nejlepší restaurace v Praze pro rodiny?', 'cs');
  ok(!r.includes('jaké'), 'Removed "jaké"');
  ok(!r.includes('jsou'), 'Removed "jsou"');
  ok(r.includes('nejlepší') || r.includes('restaurace'), 'Keywords preserved');
  ok(r.includes('praze') || r.includes('praha'), 'Location preserved');
});

await t('EN: removes stop words', async () => {
  const r = simplifyQuery('What are the best restaurants in Prague for families?', 'en');
  ok(!r.includes('what'), 'Removed "what"');
  ok(!r.includes('are'), 'Removed "are"');
  ok(!r.includes('the'), 'Removed "the"');
  ok(r.includes('best'), 'Keyword preserved');
  ok(r.includes('restaurants'), 'Keyword preserved');
  ok(r.includes('prague'), 'Location preserved');
});

await t('already simple query → minimal change', async () => {
  const r = simplifyQuery('restaurace Praha', 'cs');
  ok(r.includes('restaurace'), 'Keyword preserved');
  ok(r.includes('praha'), 'Location preserved');
});

section('A2.2 — CZ→EN translation');

await t('translates common terms', async () => {
  const r = translateToEnglish('nejlepší restaurace Praha');
  ok(r !== null, 'Should translate');
  ok(r.includes('best') || r.includes('restaurants') || r.includes('Prague'),
    `Should contain English terms, got: ${r}`);
});

await t('untranslatable query → null', async () => {
  const r = translateToEnglish('GraphQL schema design patterns');
  eq(r, null, 'Should return null for untranslatable');
});

section('A2.3 — Query expansion');

await t('adds current year', async () => {
  const r = expandQuery('restaurace Praha', 'cs');
  ok(r.includes(String(new Date().getFullYear())),
    `Should include year, got: ${r}`);
});

await t('does not duplicate year', async () => {
  const year = String(new Date().getFullYear());
  const r = expandQuery(`restaurace Praha ${year}`, 'cs');
  const yearCount = r.split(year).length - 1;
  eq(yearCount, 1, 'Year should appear only once');
});

section('A2.4 — Retry query generation');

await t('EMPTY grade → generates simplified + translated variants', async () => {
  const variants = generateRetryQueries(
    'Jaké jsou nejlepší restaurace v Praze pro rodiny?', 'cs', 'EMPTY'
  );
  ok(variants.length >= 1, `Expected ≥ 1 variant, got ${variants.length}`);
  ok(variants.length <= 3, `Expected ≤ 3 variants, got ${variants.length}`);
  // First should be simplified
  ok(variants[0].length < 'Jaké jsou nejlepší restaurace v Praze pro rodiny?'.length,
    'First variant should be shorter (simplified)');
});

await t('POOR grade → includes expanded variant', async () => {
  const variants = generateRetryQueries('restaurace Praha', 'cs', 'POOR');
  ok(variants.length >= 1, `Expected ≥ 1 variant, got ${variants.length}`);
});

await t('English query → no CZ→EN translation', async () => {
  const variants = generateRetryQueries('best restaurants Prague', 'en', 'EMPTY');
  ok(variants.length >= 1, 'Should have at least 1 variant');
  // Should not contain Czech words
  for (const v of variants) {
    ok(!v.includes('restaurace'), `Should not contain Czech: ${v}`);
  }
});

await t('deduplicates variants', async () => {
  const variants = generateRetryQueries('restaurace', 'cs', 'EMPTY');
  const unique = new Set(variants);
  eq(variants.length, unique.size, 'No duplicates');
});

section('A2.5 — retryableSearch orchestration');

await t('GOOD result → no retry', async () => {
  const mockSearch = async (q) => ({
    results: [{ title: 'Test', url: 'https://a.com', snippet: 'Answer' }],
    grade: 'GOOD',
  });

  const r = await retryableSearch(mockSearch, 'test query', 'cs');
  eq(r.retried, false);
  eq(r.retryCount, 0);
  eq(r.query, 'test query');
});

await t('EMPTY result → retries with simplified query', async () => {
  let callCount = 0;
  const mockSearch = async (q) => {
    callCount++;
    if (callCount === 1) return { results: [], grade: 'EMPTY' };
    return {
      results: [{ title: 'Test', url: 'https://a.com', snippet: 'Found it' }],
      grade: 'GOOD',
    };
  };

  const r = await retryableSearch(mockSearch, 'Jaké jsou nejlepší restaurace?', 'cs');
  eq(r.retried, true);
  ok(r.retryCount >= 1, 'Should have retried');
  eq(r.originalGrade, 'EMPTY');
});

await t('all retries fail → returns best result', async () => {
  const mockSearch = async (q) => ({
    results: [{ title: q, snippet: 'Low quality' }],
    grade: 'POOR',
  });

  const r = await retryableSearch(mockSearch, 'very obscure query', 'cs', { maxRetries: 2 });
  eq(r.retried, true);
  eq(r.originalGrade, 'POOR');
});

await t('retry error is caught gracefully', async () => {
  let callCount = 0;
  const mockSearch = async (q) => {
    callCount++;
    if (callCount === 1) return { results: [], grade: 'EMPTY' };
    if (callCount === 2) throw new Error('Network error');
    return { results: [{ title: 'OK' }], grade: 'FAIR' };
  };

  // Should not throw
  const r = await retryableSearch(mockSearch, 'test', 'cs', { maxRetries: 3 });
  ok(r.retried, 'Should have retried');
});

// ═══════════════════════════════════════════════════════════════════════════════
//  A3: CONFIDENCE STYLING
// ═══════════════════════════════════════════════════════════════════════════════

section('A3.1 — Score to level mapping');

await t('0.9 → HIGH', async () => { eq(scoreToLevel(0.9), 'HIGH'); });
await t('0.75 → HIGH', async () => { eq(scoreToLevel(0.75), 'HIGH'); });
await t('0.6 → MEDIUM', async () => { eq(scoreToLevel(0.6), 'MEDIUM'); });
await t('0.5 → MEDIUM', async () => { eq(scoreToLevel(0.5), 'MEDIUM'); });
await t('0.3 → LOW', async () => { eq(scoreToLevel(0.3), 'LOW'); });
await t('0.1 → UNCERTAIN', async () => { eq(scoreToLevel(0.1), 'UNCERTAIN'); });
await t('0.0 → UNCERTAIN', async () => { eq(scoreToLevel(0.0), 'UNCERTAIN'); });

section('A3.2 — Confidence indicators');

await t('HIGH → no label (clean response)', async () => {
  const r = getConfidenceIndicator('HIGH', 'cs');
  eq(r.label, '');
});

await t('LOW → warning label (CZ)', async () => {
  const r = getConfidenceIndicator('LOW', 'cs');
  ok(r.label.includes('Omezené'), `Expected Czech warning, got: ${r.label}`);
  eq(r.emoji, '⚠️');
});

await t('UNCERTAIN → question mark label (EN)', async () => {
  const r = getConfidenceIndicator('UNCERTAIN', 'en');
  ok(r.label.includes('Uncertain'), `Expected English label, got: ${r.label}`);
  eq(r.emoji, '❓');
});

await t('CSS classes map correctly', async () => {
  eq(confidenceCssClass('HIGH'), 'confidence-high');
  eq(confidenceCssClass('LOW'), 'confidence-low');
  eq(confidenceCssClass('UNCERTAIN'), 'confidence-uncertain');
  eq(confidenceCssClass('INVALID'), 'confidence-medium'); // fallback
});

section('A3.3 — Source attribution');

await t('formats sources as markdown links', async () => {
  const sources = [
    { url: 'https://example.com/page', title: 'Example Page' },
    { url: 'https://wiki.org/article', title: 'Wiki Article' },
  ];
  const r = formatSourceAttribution(sources, 'cs');
  ok(r.includes('Zdroje'), 'Czech label');
  ok(r.includes('[Example Page](https://example.com/page)'), 'Source link');
  ok(r.includes('[Wiki Article](https://wiki.org/article)'), 'Source link');
});

await t('EN sources', async () => {
  const r = formatSourceAttribution(
    [{ url: 'https://a.com', title: 'Test' }], 'en'
  );
  ok(r.includes('Sources'), 'English label');
});

await t('empty sources → empty string', async () => {
  eq(formatSourceAttribution([], 'cs'), '');
  eq(formatSourceAttribution(null, 'cs'), '');
});

await t('limits to maxSources', async () => {
  const sources = Array.from({ length: 10 }, (_, i) => ({
    url: `https://example${i}.com`, title: `Source ${i}`,
  }));
  const r = formatSourceAttribution(sources, 'cs', 2);
  // Should only contain 2 links
  const linkCount = (r.match(/\[Source/g) || []).length;
  eq(linkCount, 2, `Expected 2 sources, got ${linkCount}`);
});

section('A3.4 — styleWithConfidence');

await t('HIGH confidence → no modification', async () => {
  const r = styleWithConfidence('Odpověď je 42.', { level: 'HIGH', score: 0.95 });
  eq(r.text, 'Odpověď je 42.');
  eq(r.styled, false);
  eq(r.level, 'HIGH');
});

await t('MEDIUM confidence → no modification (unless sources)', async () => {
  const r = styleWithConfidence('Odpověď.', { level: 'MEDIUM', score: 0.6 });
  eq(r.styled, false);
});

await t('LOW confidence footer mode → appends warning', async () => {
  const r = styleWithConfidence('Odpověď.', { level: 'LOW', score: 0.3 }, { lang: 'cs', mode: 'footer' });
  eq(r.styled, true);
  ok(r.text.includes('⚠️'), 'Should have warning emoji');
  ok(r.text.includes('Ověřte') || r.text.includes('omezeném'), 'Should have Czech warning');
  ok(r.text.startsWith('Odpověď.'), 'Original response at start');
});

await t('UNCERTAIN badge mode → prepends warning', async () => {
  const r = styleWithConfidence('Odpověď.', { level: 'UNCERTAIN', score: 0.1 }, { lang: 'cs', mode: 'badge' });
  eq(r.styled, true);
  ok(r.text.includes('❓'), 'Should have question emoji');
  ok(r.text.includes('Nejisté'), 'Should have uncertain label');
});

await t('LOW with both mode → badge + footer', async () => {
  const r = styleWithConfidence('Odpověď.', { level: 'LOW', score: 0.3 }, { lang: 'en', mode: 'both' });
  eq(r.styled, true);
  ok(r.text.includes('Limited sources'), 'Badge present');
  ok(r.text.includes('limited sources'), 'Footer present');
});

await t('MEDIUM with sources → adds attribution', async () => {
  const sources = [{ url: 'https://example.com', title: 'Example' }];
  const r = styleWithConfidence('Odpověď.', { level: 'MEDIUM', score: 0.6 }, {
    lang: 'cs', sources, showSources: true,
  });
  ok(r.text.includes('Zdroje'), 'Should have source attribution');
});

await t('null/empty input handled', async () => {
  const r = styleWithConfidence(null, null);
  eq(r.text, '');
  eq(r.styled, false);
});

section('A3.5 — CSS generation');

await t('getConfidenceCss returns valid CSS', async () => {
  const css = getConfidenceCss();
  ok(css.includes('.confidence-high'), 'Has high class');
  ok(css.includes('.confidence-low'), 'Has low class');
  ok(css.includes('.confidence-uncertain'), 'Has uncertain class');
  ok(css.includes('border-left'), 'Has visual indicator');
});

// ═══════════════════════════════════════════════════════════════════════════════
//  INTEGRATION — A1 + A2 combined scenario
// ═══════════════════════════════════════════════════════════════════════════════

section('Integration — A1 + A2 combined flow');

await t('scraped paywall → triggers retry with different query', async () => {
  // Simulate: first search result leads to paywall page
  const paywallHTML = '<body><p>Subscribe to continue reading. Premium article.</p></body>';
  const pageResult = cleanPageContent(paywallHTML, 'Czech economy');

  // Page is blocked → should trigger search retry
  ok(!pageResult.quality.usable || pageResult.paywall.blocked,
    'Paywall should be detected');

  // Generate retry queries
  const retries = generateRetryQueries('Czech economy forecast', 'en', 'POOR');
  ok(retries.length >= 1, 'Should generate retry queries');
});

await t('good scrape → confidence HIGH → no styling', async () => {
  const goodHTML = `<article>
    <h1>Prague Economy</h1>
    <p>The Czech economy grew by 2.5% in 2024, driven by strong exports and domestic consumption.</p>
    <p>Key sectors include automotive, manufacturing, and IT services.</p>
    <p>Unemployment remained low at 2.8%, one of the lowest rates in the EU.</p>
    <p>Inflation decreased to 3.1% by year-end, approaching the central bank's target of 2%.</p>
  </article>`;

  const page = cleanPageContent(goodHTML, 'Czech economy');
  eq(page.quality.grade, 'GOOD');
  eq(page.quality.usable, true);

  // Simulate high confidence
  const styled = styleWithConfidence(
    'Czech economy grew 2.5% in 2024.',
    { level: 'HIGH', score: 0.9 },
    { lang: 'en' }
  );
  eq(styled.styled, false); // HIGH = no visual modification
});

await t('poor scrape → confidence LOW → footer warning added', async () => {
  const shortHTML = '<p>Brief mention of economy and some basic data about growth rates and inflation in the country.</p>';
  const page = cleanPageContent(shortHTML, 'Czech economy');
  ok(page.quality.grade === 'POOR' || page.quality.grade === 'FAIR',
    `Expected POOR or FAIR for short content, got ${page.quality.grade} (${page.quality.charCount} chars)`);

  const styled = styleWithConfidence(
    'The data is limited.',
    { level: 'LOW', score: 0.3 },
    { lang: 'en', mode: 'footer' }
  );
  eq(styled.styled, true);
  ok(styled.text.includes('limited sources'), 'Footer warning present');
});

// ═══════════════════════════════════════════════════════════════════════════════
//  RESULTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`);
console.log(`  A1+A2+A3 Tests: ${passed}/${total} passed, ${failed} failed`);
console.log(`${'═'.repeat(60)}`);

if (failures.length > 0) {
  console.log('\nFailed tests:');
  for (const f of failures) {
    console.log(`  ❌ [${f.section}] ${f.name}: ${f.error}`);
  }
}

console.log(`\nVÝSLEDKY: ${passed} OK, ${failed} FAIL, ${total} celkem`);
process.exit(failed > 0 ? 1 : 0);
