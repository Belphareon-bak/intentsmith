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
        } catch (error) {
          const code = signal.aborted ? 'WEB_REQUEST_CANCELLED'
            : /^WEB_[A-Z_]+$/.test(error?.code || '') ? error.code : 'WEB_TRANSPORT_FAILED';
          try { repository.settle(approvalId, context, null, code); } catch { /* revoked/deleted or uncommitted stays non-success */ }
          if (context.signal?.aborted || isAbortError(error)) throw error;
          return { handled: true, response: tagged(`Webový požadavek nebyl dokončen: ${code}.`,
            { webRequestId: approvalId, webStatus: 'failed', errorCode: code }) };
        } finally { active.delete(approvalId); }
        const row = repository.settle(approvalId, context, result);
        return { handled: true, response: render(row) };
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
