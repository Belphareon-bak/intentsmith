import { db } from '../../db/database.js';
import { ConversationWebRepository } from '../../network/conversation-web-repository.js';
import { createConversationWebTransport } from '../../network/conversation-web-transport.js';
import { parseWebApproval, webError } from '../../../contracts/m2/conversation-web-v1.js';
import { throwIfAborted, isAbortError } from '../../core/abort-error.js';

function tagged(content, metadata) {
  // The caller owns chat presentation. Keeping this result independent of the
  // controller prevents a new controller -> handler -> controller import cycle.
  return Object.freeze({ content, metadata: Object.freeze({ handler: 'conversation.web', ...metadata }) });
}

export function conversationSearchUrl(input) {
  // Remove conversational scaffolding, never the requested constraints. The
  // complete resulting URL is still shown and approved as one exact request.
  const query = String(input).trim()
    .replace(/^(?:pros[ií]m[, ]+)?(?:najdi|vyhledej|hledej|find|search(?: for)?)\s+(?:mi\s+)?/iu, '')
    .replace(/^na\s+(?:[cč]esk[eé]m[u]?\s+)?(?:webu|internetu)\s+/iu, '').trim();
  return `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query || String(input).trim())}`;
}

const fold = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const searchStopWords = new Set('najdi vyhledej hledej prosim ktery ktere ktera kteri ceskem ceskemu webu internetu chci potrebuji pomoz nejaky nejake nejaka dnes aktualni find search please with that this from which'.split(' '));
function searchTerms(text) {
  return [...new Set((fold(text).match(/[\p{L}\p{N}]+/gu) || [])
    .filter(word => word.length >= 4 && !searchStopWords.has(word)).map(word => word.slice(0, 5)))];
}
function feedText(value) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, '$1')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, '')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu, (match, entity) => {
      if (!entity.startsWith('#')) return entities[entity.toLowerCase()] || match;
      const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
    }).replace(/<[^>]*>/gu, ' ').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
}
const quoteMarkdown = text => text.replace(/[\\`*_{}\[\]()<>#!|~]/gu, '\\$&');

function renderSearchResults(content, row, metadata) {
  const target = new URL(row.url);
  if (target.hostname !== 'www.bing.com' || target.pathname !== '/search'
    || target.searchParams.get('format') !== 'rss') return null;
  const query = target.searchParams.get('q') || '';
  const terms = searchTerms(query);
  const results = []; const seen = new Set(); let parsed = 0;
  // This is bounded extraction, not an XML engine: no entities, remote DTDs,
  // embedded HTML, model calls, link following or secondary request is allowed.
  if (!/<!DOCTYPE|<!ENTITY/iu.test(content)) {
    for (const item of content.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/giu)) {
      if (++parsed > 50) break;
      const field = name => feedText(item[1].match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}\\s*>`, 'iu'))?.[1] || '');
      const title = field('title').slice(0, 250); const description = field('description').slice(0, 800);
      let url;
      try {
        url = new URL(field('link'));
        if (url.protocol !== 'https:' || url.username || url.password || url.port || seen.has(url.href)) continue;
      } catch { continue; }
      if (!title || (terms.length && !terms.some(term => fold(title + ' ' + description).includes(term)))) continue;
      seen.add(url.href);
      results.push({ title, description, url: url.href });
      if (results.length >= 10) break;
    }
  }
  const notice = results.length
    ? 'Následující náhledy souvisejí s dotazem. Samotný náhled ale nepotvrzuje splnění všech podmínek; cílové stránky zatím nejsou načtené.'
    : 'Z vrácených náhledů nemám doloženou odpověď na tvůj dotaz. Vyhledávač nevrátil použitelné odkazy s textovou shodou; nesouvisející výsledky nevydávám za řešení. Zkus kratší dotaz s hlavními podmínkami nebo uveď konkrétní web.';
  const rows = results.map((result, index) => `${index + 1}. ${quoteMarkdown(result.title)}\n   ${result.url.replace(/[()<>\\]/gu, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())}\n   ${quoteMarkdown(result.description)}`);
  return tagged(`Výsledky pro: ${quoteMarkdown(query)}\n\n${notice}${rows.length ? '\n\n' + rows.join('\n\n') : ''}`,
    { ...metadata, webDisplayStatus: results.length ? 'search_results' : 'no_relevant_search_results',
      resultCount: results.length, responseBytes: row.output.length, responseDigest: row.output_digest });
}

function render(row) {
  const metadata = { webRequestId: row.request_id, webStatus: row.status, url: row.url };
  if (row.status === 'pending') return tagged(
    `Chystám jeden HTTPS GET na přesnou adresu:\n\n${row.url}\n\n`
    + `Odejde pouze tato adresa včetně dotazu; bez cookies a přihlašovacích údajů. `
    + `Přesměrování ani další stránky se automaticky nenačítají.\n\n`
    + `Pro schválení do pěti minut napiš:\n\n\`schválit web ${row.request_id}\`\n\n`
    + `Pro zrušení: \`zrušit web ${row.request_id}\`.`, { ...metadata, approvalRequired: true });
  if (row.status !== 'succeeded') return tagged(row.status === 'executing'
    ? 'Tento požadavek již byl schválen a mohl být odeslán. Uložený výsledek zatím není dostupný; požadavek neopakuji.'
    : `Webový požadavek nebyl dokončen: ${row.error_code || row.status}.`, metadata);
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(row.output); }
  catch { return tagged('Odpověď je uložená, ale její kódování nelze zobrazit jako UTF-8.', { ...metadata, webDisplayStatus: 'unsupported_encoding' }); }
  const search = renderSearchResults(content, row, metadata);
  if (search) return search;
  // The external content is displayed as quoted data, never raw HTML or a new
  // model/tool instruction. It cannot close the dynamically sized code fence.
  const truncated = content.length > 12000;
  content = content.slice(0, 12000);
  if (['text/html','text/xml','application/xml','application/rss+xml'].includes(row.content_type)) {
    content = content.replace(/<\/(?:title|link|description|item|p|div|h[1-6]|li)>/giu, '\n')
      .replace(/<[^<>]*>/gu, ' ').replace(/[ \t]+/gu, ' ');
  }
  const excerpt = content.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');
  const fence = '`'.repeat(Math.max(3, ...Array.from(excerpt.matchAll(/`+/gu), match => match[0].length + 1)));
  return tagged(`Načteno z ${row.url}\n\nCitovaný obsah webu (externí data):\n\n${fence}text\n${excerpt}\n${fence}`
    + (truncated ? '\n\nZobrazen je začátek; celá odpověď je uložená v této konverzaci.' : ''),
  { ...metadata, responseBytes: row.output.length, responseDigest: row.output_digest });
}

export function createConversationWebHandler({ database = db, clock = Date.now,
  transport = createConversationWebTransport() } = {}) {
  const repository = new ConversationWebRepository(database, { clock });
  const active = new Map();
  return Object.freeze({
    propose(url, context) { throwIfAborted(context.signal); return render(repository.propose(url, context)); },
    async intercept(input, context) {
      // Ask for an explicit place before searching for local weather. A city
      // answer is conversation state, never permission to access location or
      // send a request; the resulting HTTPS URL still needs exact approval.
      const text = String(input || '').trim();
      const normalized = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      const state = context.sessionState;
      const projectless = !context.project && !context.projectId && !context.projectRoot && !context.hasActiveProject;
      if (projectless && state?.awaitingSlots?.includes('weather_location')) {
        const pending = state.pendingDecision;
        state.clearPendingDecision();
        if (text.length <= 100 && text.split(/\s+/).length <= 8 && /^[\p{L}\p{N}\s,'’.-]+$/u.test(text)
          && !/^(?:ne|ano|zrus|cancel|jak|co|proc|what|how)(?:\s|$)/.test(normalized)) {
          const target = conversationSearchUrl((pending?.query || 'počasí dnes') + ' — místo: ' + text);
          try { return { handled: true, response: this.propose(target, context) }; }
          catch (error) { return { handled: true, response: tagged(`Webový požadavek nelze připravit: ${error.code || 'WEB_AUTHORITY_UNAVAILABLE'}.`, {}) }; }
        }
      }
      if (projectless && /pocasi|\bweather\b/.test(normalized)
        && /(?:moj[iem]|me)\s+(?:lokac|poloh|mist)|zjistit\s+polohu|my\s+location|\bnear me\b/.test(normalized)) {
        state?.setPendingDecision?.({ type: 'weather_location', query: text }, ['weather_location']);
        return { handled: true, response: tagged('Tvoji polohu neznám. Pro které město nebo obec chceš počasí? Napiš název místa. Potom ukážu přesnou webovou adresu ke schválení; žádný požadavek zatím neodešel.', { clarification: 'weather_location' }) };
      }
      const approvalId = parseWebApproval(input);
      const cancelId = String(input || '').trim().match(/^(?:zru[sš]it\s+web|cancel\s+web)\s+(web:[a-f0-9]{64})$/iu)?.[1];
      const url = String(input || '').trim().match(/^(?:na[cč]ti(?:\s+web)?|otev[rř]i\s+web|fetch\s+web)\s+(https:\/\/\S+)$/iu)?.[1];
      if (!approvalId && !cancelId && !url) return { handled: false };
      try {
        throwIfAborted(context.signal);
        if (cancelId) {
          const row = repository.revoke(cancelId, context);
          active.get(cancelId)?.abort();
          return { handled: true, response: render(row) };
        }
        if (url) return { handled: true, response: this.propose(url, context) };
        const claim = repository.claim(approvalId, context);
        if (!claim.claimed) return { handled: true, response: render(claim.row) };
        const controller = new AbortController();
        const signal = context.signal ? AbortSignal.any([context.signal, controller.signal]) : controller.signal;
        active.set(approvalId, controller);
        let result;
        try {
          // Recheck committed approval immediately before the only network call.
          if (repository.read(approvalId, context).status !== 'executing') throw webError('WEB_REQUEST_REVOKED');
          result = await transport(claim.row.url, { signal, beforeConnect() {
            if (repository.read(approvalId, context).status !== 'executing') throw webError('WEB_REQUEST_REVOKED');
          } });
          throwIfAborted(signal);
          const row = repository.settle(approvalId, context, result);
          return { handled: true, response: render(row) };
        } catch (error) {
          const code = signal.aborted ? 'WEB_REQUEST_CANCELLED'
            : /^WEB_[A-Z_]+$/.test(error?.code || '') ? error.code
              : result ? 'WEB_RESULT_COMMIT_FAILED' : 'WEB_TRANSPORT_FAILED';
          let recorded = false;
          try { repository.failClaim(claim, code); recorded = true; } catch { /* no durable terminal; never retry I/O */ }
          if (context.signal?.aborted || isAbortError(error)) throw error;
          return { handled: true, response: tagged(`Webový požadavek nebyl dokončen: ${code}.`,
            { webRequestId: approvalId, webStatus: recorded ? 'failed' : 'unavailable', errorCode: code }) };
        } finally { active.delete(approvalId); }
      } catch (error) {
        if (context.signal?.aborted || isAbortError(error)) throw error;
        const code = /^WEB_[A-Z_]+$/.test(error?.code || '') ? error.code : 'WEB_AUTHORITY_UNAVAILABLE';
        return { handled: true, response: tagged(`Webový požadavek nelze provést: ${code}.`,
          { webRequestId: approvalId || cancelId || null, webStatus: 'unavailable', errorCode: code }) };
      }
    },
  });
}

let production;
export function conversationWebHandler() {
  return production ||= createConversationWebHandler();
}
