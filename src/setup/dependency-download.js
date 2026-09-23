// Fixed installation sources; no ambient credentials, redirects or private IPs.
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { isPublicWebAddress } from '../network/conversation-web-transport.js';

export const INSTALL_HOSTS = Object.freeze(['registry.npmjs.org', 'builds.dotnet.microsoft.com']);
export function installationUrl(value) {
  const url = new URL(value);
  if (url.href !== value || url.protocol !== 'https:' || url.port || url.username || url.password
      || url.hash || url.search || !INSTALL_HOSTS.includes(url.hostname)
      || /[\u0000-\u0020\u007f\\]/u.test(value)) throw Error('INSTALL_SOURCE_DENIED');
  return url;
}

export function createDependencyDownloader({ resolve = lookup, request = https.request } = {}) {
  return async function download({ url: target, destination, maxBytes, signal, beforeConnect, audit }) {
    const url = installationUrl(target);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw Error('INSTALL_DOWNLOAD_LIMIT');
    const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(120_000)].filter(Boolean));
    boundedSignal.throwIfAborted(); beforeConnect();
    let bytes = 0, address, output;
    const digest = createHash('sha512');
    await new Promise((accept, reject) => {
      const fail = error => { output?.destroy(); reject(error); };
      const req = request(url, { method: 'GET', agent: false, rejectUnauthorized: true, autoSelectFamily: false,
        signal: boundedSignal, maxHeaderSize: 16384, headers: { 'Accept-Encoding': 'identity' },
        lookup(_name, options, callback) {
          Promise.resolve().then(async () => {
            const answers = await resolve(url.hostname, { all: true, verbatim: true });
            if (!answers.length || answers.some(item => !isPublicWebAddress(item.address))) throw Error('INSTALL_ADDRESS_DENIED');
            boundedSignal.throwIfAborted(); beforeConnect();
            const chosen = answers.find(item => item.family === 4) || answers[0]; address = chosen.address;
            if (options?.all) callback(null, [chosen]); else callback(null, chosen.address, chosen.family);
          }).catch(callback);
        },
      }, response => {
        response.on('error', fail);
        try {
        if (response.statusCode !== 200 || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) {
          response.destroy(); fail(Error('INSTALL_RESPONSE_DENIED')); return;
        }
        if (Number(response.headers['content-length']) > maxBytes) {
          response.destroy(); fail(Error('INSTALL_DOWNLOAD_LIMIT')); return;
        }
        audit('download_started', { url: target, address });
        output = fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 });
        output.on('error', error => { response.destroy(error); fail(error); });
        response.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > maxBytes) response.destroy(Error('INSTALL_DOWNLOAD_LIMIT'));
          else digest.update(chunk);
        });
        output.on('finish', accept);
        response.pipe(output);
        } catch (error) { response.destroy();fail(error); }
      });
      req.on('error', fail); req.end();
    });
    const receipt = { url: target, address, bytes, sha512: digest.digest('hex') };
    audit('download_verified_transport', receipt); return receipt;
  };
}
