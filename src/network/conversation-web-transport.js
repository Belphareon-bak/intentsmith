import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { CONVERSATION_WEB, canonicalWebUrl, webError } from '../../contracts/m2/conversation-web-v1.js';

export function isPublicWebAddress(address) {
  try {
    const parsed = ipaddr.parse(address);
    return !address.includes('%') && parsed.range() === 'unicast'
      && (parsed.kind() === 'ipv4' || parsed.match(ipaddr.parseCIDR('2000::/3')));
  } catch { return false; }
}

// Private transport for the durable conversation approval consumer. It cannot
// inherit cookies, proxy credentials, TLS options, headers or a request body.
// The lookup callback gives the socket the exact checked IP, preventing rebinding.
export function createConversationWebTransport({ resolve = lookup, request = https.request } = {}) {
  return async (input, { signal, beforeConnect = () => {} } = {}) => {
    const url = new URL(canonicalWebUrl(input));
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && !isPublicWebAddress(host)) throw webError('WEB_ADDRESS_DENIED');
    const timer = AbortSignal.timeout(CONVERSATION_WEB.timeoutMs);
    const boundedSignal = signal ? AbortSignal.any([signal, timer]) : timer;
    boundedSignal.throwIfAborted();
    beforeConnect();
    let address;
    return new Promise((accept, reject) => {
      const req = request(url, {
        method: 'GET', agent: false, rejectUnauthorized: true, autoSelectFamily: false,
        signal: boundedSignal, maxHeaderSize: 16384,
        headers: { Accept: 'text/html, text/plain, application/json, application/xml, application/rss+xml', 'Accept-Encoding': 'identity' },
        lookup(_hostname, options, callback) {
          Promise.resolve().then(async () => {
            const answers = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolve(host, { all: true, verbatim: true });
            if (!answers.length || answers.some(item => !isPublicWebAddress(item.address))) throw webError('WEB_ADDRESS_DENIED');
            boundedSignal.throwIfAborted();
            beforeConnect();
            const chosen = answers.find(item => item.family === 4) || answers[0];
            address = chosen.address;
            if (options?.all) callback(null, [chosen]); else callback(null, chosen.address, chosen.family);
          }).catch(callback);
        },
      }, response => {
        const contentType = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        const encoding = response.headers['content-encoding'];
        const supported = ['text/plain','text/html','application/json','application/xml','text/xml','application/rss+xml'];
        if (response.statusCode !== 200 || !supported.includes(contentType) || (encoding && encoding !== 'identity')) {
          response.destroy();
          reject(webError(response.statusCode >= 300 && response.statusCode < 400 ? 'WEB_REDIRECT_REQUIRES_NEW_APPROVAL' : 'WEB_RESPONSE_UNSUPPORTED'));
          return;
        }
        const chunks = []; let bytes = 0;
        response.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > CONVERSATION_WEB.maxResponseBytes) response.destroy(webError('WEB_RESPONSE_TOO_LARGE'));
          else chunks.push(chunk);
        });
        response.once('error', reject);
        response.once('end', () => accept({ bytes: Buffer.concat(chunks), status: response.statusCode, contentType,
          address: address || host }));
      });
      req.once('error', reject);
      req.end();
    });
  };
}
