#!/usr/bin/env node

import {
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';
import { isIP } from 'node:net';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createM7VpnRuntimeConfiguration } from '../src/remote/m7-vpn-runtime-config.js';

const TEMPLATE_PATH = fileURLToPath(
  new URL('../systemd/user/intentsmith-m7.service.in', import.meta.url),
);
const OPTION_NAMES = Object.freeze([
  'bind-address',
  'node-bin',
  'project-root',
  'rate-limit-hmac-credential',
  'server-origin',
  'server-spki-sha256',
  'tls-certificate-credential',
  'tls-private-key-credential',
  'vpn-interface',
]);
const SAFE_PATH = /^\/[A-Za-z0-9._/-]+$/u;

function fail(reason) {
  throw new TypeError(`m7-systemd-render:${reason}`);
}

export function parseM7SystemdServiceArgs(argv) {
  const values = {};
  for (const argument of argv) {
    if (argument === '--help' || argument === '-h') return { help: true };
    const match = /^--([a-z0-9-]+)=(.*)$/u.exec(argument);
    if (!match || !OPTION_NAMES.includes(match[1])) fail('unknown-argument');
    if (Object.hasOwn(values, match[1])) fail('duplicate-argument');
    values[match[1]] = match[2];
  }
  if (Object.keys(values).length !== OPTION_NAMES.length) fail('missing-argument');
  return Object.freeze({ help: false, ...values });
}

function exactExistingPath(value, type) {
  if (!SAFE_PATH.test(value || '') || path.resolve(value) !== value || value.includes('//')) {
    fail(`${type}-path-invalid`);
  }
  let metadata;
  try {
    metadata = lstatSync(value);
    if (realpathSync(value) !== value || metadata.isSymbolicLink()) fail(`${type}-path-invalid`);
  } catch (error) {
    if (error instanceof TypeError && error.message.startsWith('m7-systemd-render:')) throw error;
    fail(`${type}-path-invalid`);
  }
  if (type === 'project-root' && !metadata.isDirectory()) fail(`${type}-path-invalid`);
  if (type === 'node-bin' && (!metadata.isFile() || (metadata.mode & 0o111) === 0)) {
    fail(`${type}-path-invalid`);
  }
  return value;
}

function exactCredentialPath(value) {
  if (!SAFE_PATH.test(value || '') || path.resolve(value) !== value || value.includes('//')) {
    fail('credential-path-invalid');
  }
  return value;
}

function replaceExact(template, token, value) {
  if (!template.includes(token)) fail('template-token-missing');
  return template.split(token).join(value);
}

export function renderM7SystemdService(input) {
  if (!input || typeof input !== 'object') fail('input-invalid');
  // Insert only a literal address into systemd syntax, never a zone suffix
  // or a value normalized for interface comparison by another boundary.
  if (typeof input.bindAddress !== 'string' || input.bindAddress.includes('%')
    || isIP(input.bindAddress) === 0) fail('bind-address-invalid');
  const projectRoot = exactExistingPath(input.projectRoot, 'project-root');
  const nodeBin = exactExistingPath(input.nodeBin, 'node-bin');
  const certificateCredential = exactCredentialPath(input.tlsCertificateCredential);
  const privateKeyCredential = exactCredentialPath(input.tlsPrivateKeyCredential);
  const rateLimitCredential = exactCredentialPath(input.rateLimitHmacCredential);

  createM7VpnRuntimeConfiguration({
    effectiveUid: 1000,
    env: {
      CREDENTIALS_DIRECTORY: '/run/user/1000/credentials/intentsmith-m7.service',
      INTENTSMITH_M7_BIND_ADDRESS: input.bindAddress,
      INTENTSMITH_M7_REMOTE_ENABLED: 'true',
      INTENTSMITH_M7_SERVER_ORIGIN: input.serverOrigin,
      INTENTSMITH_M7_SERVER_SPKI_SHA256: input.serverSpkiSha256,
      INTENTSMITH_M7_VPN_INTERFACE: input.vpnInterface,
    },
    networkInterfaces: () => ({
      [input.vpnInterface]: [{ address: input.bindAddress, internal: false }],
    }),
  });

  let rendered = readFileSync(TEMPLATE_PATH, 'utf8');
  for (const [token, value] of [
    ['@PROJECT_ROOT@', projectRoot],
    ['@NODE_BIN@', nodeBin],
    ['@VPN_INTERFACE@', input.vpnInterface],
    ['@BIND_ADDRESS@', input.bindAddress],
    ['@SERVER_ORIGIN@', input.serverOrigin],
    ['@SERVER_SPKI_SHA256@', input.serverSpkiSha256],
    ['@TLS_CERTIFICATE_CREDENTIAL@', certificateCredential],
    ['@TLS_PRIVATE_KEY_CREDENTIAL@', privateKeyCredential],
    ['@RATE_LIMIT_HMAC_CREDENTIAL@', rateLimitCredential],
  ]) rendered = replaceExact(rendered, token, value);
  if (/@[A-Z_]+@/u.test(rendered) || !rendered.endsWith('\n')) fail('template-incomplete');
  return rendered;
}

function help() {
  return `Usage: node scripts/render-m7-systemd-service.mjs \\
  --project-root=/absolute/repository \\
  --node-bin=/absolute/node \\
  --vpn-interface=tailscale0 \\
  --bind-address=100.64.0.10 \\
  --server-origin=https://vpn-name:7443 \\
  --server-spki-sha256=sha256:<64-hex> \\
  --tls-certificate-credential=/absolute/certificate.cred \\
  --tls-private-key-credential=/absolute/private-key.cred \\
  --rate-limit-hmac-credential=/absolute/rate-limit-hmac.cred

The generated unit is written to stdout. The command reads no credential bytes,
does not install a unit and does not call systemctl.`;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseM7SystemdServiceArgs(argv);
  if (options.help) {
    process.stdout.write(`${help()}\n`);
    return;
  }
  process.stdout.write(renderM7SystemdService({
    bindAddress: options['bind-address'],
    nodeBin: options['node-bin'],
    projectRoot: options['project-root'],
    rateLimitHmacCredential: options['rate-limit-hmac-credential'],
    serverOrigin: options['server-origin'],
    serverSpkiSha256: options['server-spki-sha256'],
    tlsCertificateCredential: options['tls-certificate-credential'],
    tlsPrivateKeyCredential: options['tls-private-key-credential'],
    vpnInterface: options['vpn-interface'],
  }));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error?.message || 'm7-systemd-render:failed'}\n`);
    process.exitCode = 2;
  }
}
