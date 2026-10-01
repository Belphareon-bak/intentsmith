// Loaded only in the owned M1 product child, before outbound-policy captures
// fetch. Public provider URLs receive curated fixture bytes (origin unverified); every other
// external URL fails closed. No production entry point imports this module.
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

if (process.env.NODE_ENV !== 'test' || process.env.CI !== '1'
  || !process.env.INTENTSMITH_TEST_ARTIFACT_DIR
  || !process.env.INTENTSMITH_TEST_SERVER_NONCE) {
  throw new Error('Sázení fixture preload requires an owned test product');
}

const capture = JSON.parse(readFileSync(
  new URL('../fixtures/betting/fortuna-public.json', import.meta.url), 'utf8'));
const log = path.join(process.env.INTENTSMITH_TEST_ARTIFACT_DIR,
  'sazeni-provider-requests.jsonl');
const originalFetch = globalThis.fetch.bind(globalThis);
const anchor = Date.now();
const ollamaOrigin = new URL(process.env.OLLAMA_URL).origin;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(ollamaOrigin)) {
  throw new Error('Sázení fixture requires an owned loopback model tripwire');
}

function historyCSV(season, at) {
  const rows = ['Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,B365H,B365D,B365A'];
  const names = { A: 'Crystal Palace', B: 'Ipswich', C: 'Liverpool', D: 'Fulham' };
  for (let i = 0; i < 96; i++) {
    const day = new Date(Date.UTC(2000 + season, 6, 1 + i * 3));
    if (day >= new Date(at)) continue;
    const teams = ['A', 'B', 'C', 'D'];
    const home = teams[i % 4];
    const away = teams[(i % 4 + 1 + Math.floor(i / 4) % 3) % 4];
    const homeGoals = i % 4;
    const awayGoals = Math.floor(i / 4) % 3;
    rows.push(['E0', `${String(day.getUTCDate()).padStart(2, '0')}/${String(day.getUTCMonth() + 1).padStart(2, '0')}/${day.getUTCFullYear()}`,
      '15:00', names[home], names[away], homeGoals, awayGoals,
      homeGoals > awayGoals ? 'H' : homeGoals === awayGoals ? 'D' : 'A', 1.9, 3.5, 4.5].join(','));
  }
  return rows.join('\n');
}

async function fixtureTransport(input) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin === 'https://www.football-data.co.uk') {
    const match = /^\/mmz4281\/(\d{2})\d{2}\/E0\.csv$/.exec(url.pathname);
    if (!match || url.search) throw new Error(`TEST_OUTBOUND_DENIED:${url.origin}${url.pathname}`);
    appendFileSync(log, `${JSON.stringify({ kind: 'history', path: url.pathname })}\n`);
    return new Response(historyCSV(Number(match[1]), new Date(anchor).toISOString()),
      { headers: { 'content-type': 'text/csv' } });
  }
  if (url.origin === 'https://api.ifortuna.cz') {
    let value;
    if (url.pathname.endsWith('/matches') && url.search === '?timeFilter=all') {
      value = structuredClone(capture.listing);
      value.fixtures.forEach((fixture, index) => {
        fixture.startDatetime = anchor + (6 + index) * 3_600_000;
      });
    } else if (url.pathname.endsWith('/overview')
      && [...url.searchParams.keys()].every(key => key === 'fixtureIds')) {
      value = structuredClone(capture.markets);
    } else {
      throw new Error(`TEST_OUTBOUND_DENIED:${url.origin}${url.pathname}`);
    }
    appendFileSync(log, `${JSON.stringify({ kind: 'fortuna', path: url.pathname,
      fixtureIds: url.searchParams.getAll('fixtureIds') })}\n`);
    return new Response(JSON.stringify(value), { headers: {
      'content-type': 'application/json', 'date': new Date().toUTCString(),
    } });
  }
  throw new Error(`TEST_OUTBOUND_DENIED:${url.origin}${url.pathname}`);
}

// Install the tripwire before importing outbound-policy via data-host so its
// default transport cannot retain the native network fetch in this child.
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin === ollamaOrigin) return originalFetch(input, init);
  throw new Error(`TEST_OUTBOUND_DENIED:${url.origin}${url.pathname}`);
};

// The betting host receives an explicit transport through a test-only seam.
const [{ BettingDataStore }, { createBettingDataHost }] = await Promise.all([
  import('../../src/betting/data-store.js'), import('../../src/betting/data-host.js'),
]);
const store = new BettingDataStore(path.join(process.env.INTENTSMITH_TEST_ARTIFACT_DIR,
  'sazeni-fixture.sqlite'));
globalThis[Symbol.for('intentsmith.test.bettingBridge')] = createBettingDataHost({
  store, transport: fixtureTransport,
});
