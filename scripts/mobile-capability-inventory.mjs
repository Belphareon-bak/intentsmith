#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUTE_ROOT = path.join(ROOT, 'src', 'routes');
const EXTRA_SOURCES = [path.join(ROOT, 'src', 'mobile', 'handlers.js')];
const JSON_TARGET = path.join(ROOT, 'docs', 'mobile', 'backend-capability-inventory.json');
const MD_TARGET = path.join(ROOT, 'docs', 'mobile', 'BACKEND-CAPABILITY-INVENTORY.md');
const ROUTE_PATTERN = /['"]((?:GET|POST|PUT|PATCH|DELETE)\s+\/(?:api|m1)(?:\/[^'"]*)?)['"]\s*:/g;

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(absolute) : [absolute];
  });
}

function slash(value) {
  return value.split(path.sep).join('/');
}

function domainFor(routePath) {
  const pathOnly = routePath.replace(/^\/m1/, '/api');
  const rules = [
    ['projects', /^\/api\/(projects|workspace|artifacts|attachments)(\/|$)/],
    ['conversations', /^\/api\/(chat|conversations|drafts|export)(\/|$)/],
    ['stored-information', /^\/api\/(memory)(\/|$)/],
    ['agents', /^\/api\/(agents|sources)(\/|$)/],
    ['specialists', /^\/api\/(specialists|expertises|expertise-|merge-preview|lifecycle)(\/|$)/],
    ['approvals', /^\/api\/approvals(\/|$)/],
    ['notifications', /^\/api\/notifications(\/|$)/],
    ['settings', /^\/api\/(settings|features)(\/|$)/],
    ['operations', /^\/api\/operations(\/|$)/],
    ['security', /^\/api\/security(\/|$)/],
    ['system', /^\/api\/system(\/|$)/],
    ['marketplace', /^\/api\/marketplace(\/|$)/],
    ['media', /^\/api\/media(\/|$)/],
    ['autonomy', /^\/api\/autonomy(\/|$)/],
    ['governor', /^\/api\/system\/governor(\/|$)/],
    ['skills', /^\/api\/skills(\/|$)/],
    ['quality', /^\/api\/quality(\/|$)/],
    ['storage', /^\/api\/storage(\/|$)/],
  ];
  return rules.find(([, pattern]) => pattern.test(pathOnly))?.[0] || 'platform';
}

function remoteCoreFeature(method, routePath) {
  const normalized = routePath.replace(/^\/m1/, '/api');
  if (/^\/api\/projects(?:\/|$)/.test(normalized)) {
    if (method === 'GET') return 'projects.read';
    if (method === 'POST') return 'projects.create';
    if (/\/(archive|restore)$/.test(normalized) || method === 'DELETE') return 'projects.archive';
    return 'projects.update';
  }
  if (/^\/api\/(conversations|chat)(?:\/|$)/.test(normalized)) {
    if (normalized === '/api/chat' && method === 'POST') return 'conversations.send';
    if (method === 'GET') return 'conversations.read';
    if (method === 'POST') return 'conversations.create';
    if (/\/(archive|restore)$/.test(normalized) || method === 'DELETE') return 'conversations.archive';
    return 'conversations.update';
  }
  if (/^\/api\/settings(?:\/|$)/.test(normalized)) {
    return method === 'GET' ? 'settings.read' : 'settings.write';
  }
  if (/^\/api\/memory(?:\/|$)/.test(normalized)) {
    if (method === 'GET') return 'storedInformation.read';
    if (method === 'DELETE') return 'storedInformation.delete';
    return 'storedInformation.write';
  }
  if (/^\/api\/approvals(?:\/|$)/.test(normalized)) {
    return method === 'GET' ? 'approvals.read' : 'approvals.decide';
  }
  if (/^\/api\/notifications(?:\/|$)/.test(normalized)) {
    return method === 'GET' ? 'notifications.read' : 'notifications.ack';
  }
  if (/^\/api\/(events|runs\/[^/]+\/events)(?:\/|$)/.test(normalized)) {
    return 'events.read';
  }
  return null;
}

function mobilePolicyFor(domain, routePath) {
  if (domain === 'security') return 'never-expose-admin';
  if (/^\/api\/workspace\//.test(routePath)) return 'governed-effect-only';
  if (['projects', 'conversations', 'stored-information', 'agents', 'specialists',
    'approvals', 'notifications', 'settings', 'operations'].includes(domain)) {
    return 'mobile-mirror-candidate';
  }
  return 'conditional-or-desktop-only';
}

export function buildInventory() {
  const sources = [...filesBelow(ROUTE_ROOT), ...EXTRA_SOURCES]
    .filter(file => file.endsWith('.js'))
    .sort();
  const byKey = new Map();
  for (const file of sources) {
    const relative = slash(path.relative(ROOT, file));
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(ROUTE_PATTERN)) {
      const [method, routePath] = match[1].split(/\s+/, 2);
      const key = `${method} ${routePath}`;
      const existing = byKey.get(key) || { method, path: routePath, sources: [] };
      if (!existing.sources.includes(relative)) existing.sources.push(relative);
      byKey.set(key, existing);
    }
  }

  const routes = [...byKey.values()]
    .sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`))
    .map(route => {
      const domain = domainFor(route.path);
      return {
        ...route,
        sources: route.sources.sort(),
        domain,
        access: route.method === 'GET' ? 'read' : 'mutation',
        exposure: route.path.startsWith('/m1') ? 'mobile-v1' : 'legacy-core',
        remoteCoreFeature: remoteCoreFeature(route.method, route.path),
        mobilePolicy: mobilePolicyFor(domain, route.path),
      };
    });
  const domains = Object.fromEntries([...new Set(routes.map(route => route.domain))]
    .sort()
    .map(domain => [domain, routes.filter(route => route.domain === domain).length]));
  const canonical = JSON.stringify(routes);
  return {
    schemaVersion: 1,
    scanner: 'scripts/mobile-capability-inventory.mjs',
    routeDigest: createHash('sha256').update(canonical).digest('hex'),
    summary: {
      routes: routes.length,
      mobileV1: routes.filter(route => route.exposure === 'mobile-v1').length,
      legacyCore: routes.filter(route => route.exposure === 'legacy-core').length,
      reads: routes.filter(route => route.access === 'read').length,
      mutations: routes.filter(route => route.access === 'mutation').length,
      remoteCoreCandidates: routes.filter(route => route.remoteCoreFeature !== null).length,
      domains,
    },
    routes,
  };
}

function markdown(inventory) {
  const lines = [
    '# Backend capability inventory',
    '',
    'Status: generated, review input for MM2–MM4',
    '',
    'This inventory is exhaustive for statically declared `/api` and `/m1` route-map',
    'keys under `src/routes/**` and `src/mobile/handlers.js`. Dynamic behavior and',
    'WebSocket message kinds require separate contract inventories.',
    '',
    `- Routes: ${inventory.summary.routes}`,
    `- Existing mobile v1 routes: ${inventory.summary.mobileV1}`,
    `- Legacy core routes: ${inventory.summary.legacyCore}`,
    `- Reads / mutations: ${inventory.summary.reads} / ${inventory.summary.mutations}`,
    `- Routes mapping to the seven-domain RemoteCorePort candidate: ${inventory.summary.remoteCoreCandidates}`,
    `- Route digest: \`${inventory.routeDigest}\``,
    '',
    '## Domain counts',
    '',
    '| Domain | Routes |',
    '|---|---:|',
    ...Object.entries(inventory.summary.domains).map(([domain, count]) => `| ${domain} | ${count} |`),
    '',
    '## Interpretation',
    '',
    '- `legacy-core` means the capability exists on the broad desktop/core listener;',
    '  it is not authority to expose it to a paired device.',
    '- `mobile-v1` is the current exact allow-list, not a wildcard.',
    '- `never-expose-admin` covers security-token and secret administration.',
    '- `governed-effect-only` means a future mobile action must cross an effect and',
    '  approval authority rather than proxy the workspace route.',
    '- The JSON sibling is the line-by-line review artifact and is checked in tests.',
    '',
    '## Complete route list',
    '',
    '| Route | Domain | Exposure | RemoteCorePort feature | Mobile policy |',
    '|---|---|---|---|---|',
    ...inventory.routes.map(route => (
      `| \`${route.method} ${route.path}\` | ${route.domain} | ${route.exposure} | ${route.remoteCoreFeature || '—'} | ${route.mobilePolicy} |`
    )),
    '',
  ];
  // The final empty item contributes the single POSIX newline. Appending a
  // second newline would make every generated review artifact fail diff-check.
  return lines.join('\n');
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const inventory = buildInventory();
  const serialized = `${JSON.stringify(inventory, null, 2)}\n`;
  const rendered = markdown(inventory);
  if (process.argv.includes('--write')) {
    writeFileSync(JSON_TARGET, serialized, 'utf8');
    writeFileSync(MD_TARGET, rendered, 'utf8');
    console.log(`Wrote ${inventory.summary.routes} routes (${inventory.routeDigest})`);
  } else {
    const actualJson = readFileSync(JSON_TARGET, 'utf8');
    const actualMarkdown = readFileSync(MD_TARGET, 'utf8');
    if (actualJson !== serialized || actualMarkdown !== rendered) {
      console.error('MOBILE_CAPABILITY_INVENTORY_STALE: run with --write');
      process.exit(1);
    }
    console.log(`Mobile capability inventory valid: ${inventory.summary.routes} routes, ${inventory.routeDigest}`);
  }
}
