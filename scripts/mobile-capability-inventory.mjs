#!/usr/bin/env node

// Static review inventory, not an availability/authorization oracle. Port of
// donor 15e1cd6f's locale-independent ordering onto the actual M7 source graph.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { M7_TRANSPORT_ROUTES } from '../src/remote/m7-transport-admission-policy.js';
import { M7_RUNTIME_OPERATION_DESCRIPTORS } from '../src/mobile/client/m7-runtime-contract-v1.js';
import { MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1 } from '../docs/mobile/contracts/remote-capability-requirements-v1.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const JSON_TARGET = path.join(ROOT, 'docs/mobile/backend-capability-inventory.json');
const MD_TARGET = path.join(ROOT, 'docs/mobile/BACKEND-CAPABILITY-INVENTORY.md');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Never localeCompare: Czech collation orders "ch" after "h". This compares
// ordinal UTF-16 strings (all current route identifiers are ASCII).
export const compareOrdinal = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const routeKey = route => `${route.path} ${route.method}`;

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(absolute) : [absolute];
  });
}

export function scanDesktopRoutes(sources) {
  const byKey = new Map();
  for (const { source, contents } of sources) {
    // Only literal route-map keys. Dynamic routes and WebSocket messages are
    // outside this census; declarations do not prove a handler is activated.
    const pattern = /['"]((?:GET|POST|PUT|PATCH|DELETE)\s+\/(?:api|m1)(?:\/[^'"]*)?)['"]\s*:/gu;
    for (const match of contents.matchAll(pattern)) {
      const [method, routePath] = match[1].split(/\s+/, 2);
      const key = `${method} ${routePath}`;
      const route = byKey.get(key) || { method, path: routePath, sources: [] };
      if (!route.sources.includes(source)) route.sources.push(source);
      byKey.set(key, route);
    }
  }
  return [...byKey.values()].sort((a, b) => compareOrdinal(routeKey(a), routeKey(b)))
    .map(route => ({ ...route, sources: route.sources.sort(compareOrdinal) }));
}

export function buildInventory() {
  const sourcePaths = [...filesBelow(path.join(ROOT, 'src/routes')), path.join(ROOT, 'src/server.js')]
    .filter(file => file.endsWith('.js')).sort(compareOrdinal);
  const desktopRoutes = scanDesktopRoutes(sourcePaths.map(file => ({
    source: path.relative(ROOT, file).split(path.sep).join('/'),
    contents: readFileSync(file, 'utf8'),
  })));
  const transportRoutes = M7_TRANSPORT_ROUTES.map(route => ({ ...route }))
    .sort((a, b) => compareOrdinal(routeKey(a), routeKey(b)));
  const requirements = MOBILE_REMOTE_CAPABILITY_REQUIREMENTS_V1;
  const groups = [...requirements.capabilities.map(capability => ({
    capabilityId: capability.capabilityId,
    capabilityVersion: capability.targetVersion,
    operations: capability.operations,
  })), {
    capabilityId: 'm7-control-plane-prerequisite', capabilityVersion: 1,
    operations: requirements.controlPlanePrerequisite.operations,
  }];
  const declaredOperations = groups.flatMap(group => group.operations.map(operation => ({
    operationId: operation.operationId,
    capabilityId: group.capabilityId,
    capabilityVersion: group.capabilityVersion,
    kind: operation.kind,
    requestContract: operation.requestContract,
    resultContract: operation.resultContract,
    requiredScopes: [...operation.requiredScopes].sort(compareOrdinal),
  }))).sort((a, b) => compareOrdinal(a.operationId, b.operationId));
  const publicHealth = declaredOperations.find(operation => operation.operationId === 'remote-health.read');
  const healthRoute = transportRoutes.find(route => route.access === 'public_health');
  if (!publicHealth || healthRoute?.method !== 'GET' || healthRoute.path !== '/remote/v1/health') {
    throw new Error('M7 public health declaration and transport route differ');
  }
  // The native invocation catalog deliberately excludes the public-health
  // prerequisite. Preserve it as a separate surface instead of losing it.
  const publicHealthOperation = { ...publicHealth, method: healthRoute.method, path: healthRoute.path };
  const operations = declaredOperations.filter(operation => operation.operationId !== 'remote-health.read');
  const runtimeIds = Object.keys(M7_RUNTIME_OPERATION_DESCRIPTORS).sort(compareOrdinal);
  if (JSON.stringify(runtimeIds) !== JSON.stringify(operations.map(operation => operation.operationId))) {
    throw new Error('M7 operation inventory and native client identities differ');
  }
  for (const operation of operations) {
    const runtime = M7_RUNTIME_OPERATION_DESCRIPTORS[operation.operationId];
    for (const key of ['capabilityId', 'capabilityVersion', 'kind', 'requestContract', 'resultContract']) {
      if (runtime[key] !== operation[key]) throw new Error(`M7 projection drift: ${operation.operationId}:${key}`);
    }
  }
  const surfaces = { desktopRoutes, transportRoutes, publicHealthOperation, operations };
  return {
    schemaVersion: 2,
    status: 'STATIC_SOURCE_INVENTORY_NOT_SESSION_AVAILABILITY',
    scanner: 'scripts/mobile-capability-inventory.mjs',
    sources: {
      desktop: ['src/routes/**/*.js', 'src/server.js'],
      transport: 'src/remote/m7-transport-admission-policy.js',
      requirements: 'docs/mobile/contracts/remote-capability-requirements-v1.js',
      clientProjection: 'src/mobile/client/m7-runtime-contract-v1.js',
      requirementsStage: requirements.stage,
    },
    routeDigest: digest(desktopRoutes),
    inventoryDigest: digest(surfaces),
    summary: {
      desktopRouteDeclarations: desktopRoutes.length,
      legacyM1Declarations: desktopRoutes.filter(route => route.path.startsWith('/m1')).length,
      m7TransportRoutes: transportRoutes.length,
      m7Operations: operations.length,
      capabilityIds: groups.filter(group => group.capabilityId !== 'm7-control-plane-prerequisite')
        .map(group => group.capabilityId).sort(compareOrdinal),
      controlPlaneOperations: operations.filter(operation => operation.capabilityId === 'm7-control-plane-prerequisite').length,
    },
    ...surfaces,
  };
}

export function renderInventoryMarkdown(inventory) {
  return [
    '# Backend capability inventory', '',
    `Status: ${inventory.status}`, '',
    'Generated review input for mobile convergence, not an activation or authorization contract.',
    'Desktop declarations cover literal /api and /m1 route-map keys in src/routes and src/server.js.',
    'Dynamic handler registration, non-API aliases, comments that resemble keys, and WebSocket messages',
    'are outside the guarantees of this lexical census. No live server or database is imported.',
    'M7 HTTP routes are taken separately from the admission policy; invocation operations are',
    'taken from the same requirements consumed by the M7 pipeline and checked against the native client.',
    'remote-health.read is a public GET /remote/v1/health prerequisite, not one of the 17 native invocation operations.',
    'The underlying requirements retain their own candidate stage. Availability and scopes must',
    'still be validated against the actual server/session; desktop route existence grants no remote authority.', '',
    `- Desktop route declarations: ${inventory.summary.desktopRouteDeclarations}`,
    `- Legacy /m1 declarations: ${inventory.summary.legacyM1Declarations}`,
    `- M7 HTTP routes: ${inventory.summary.m7TransportRoutes}`,
    `- M7 invocation operations: ${inventory.summary.m7Operations}`,
    `- Capability areas: ${inventory.summary.capabilityIds.join(', ')}`,
    `- Control-plane operations (not another capability): ${inventory.summary.controlPlaneOperations}`,
    `- Desktop route digest: \`${inventory.routeDigest}\``,
    `- Combined inventory digest: \`${inventory.inventoryDigest}\``, '',
    'Workers, specialists and device management have no M7 operation in this projection.',
    'Their desktop route declarations must not be mistaken for a mobile capability.', '',
    '## M7 transport', '', '| Method | Path | Access |', '|---|---|---|',
    ...inventory.transportRoutes.map(route => `| ${route.method} | \`${route.path}\` | ${route.access} |`), '',
    '## M7 invocation operations', '',
    '| Operation | Capability / version | Kind | Request → result | Required scopes |', '|---|---|---|---|---|',
    ...inventory.operations.map(operation => `| \`${operation.operationId}\` | ${operation.capabilityId} / ${operation.capabilityVersion} | ${operation.kind} | ${operation.requestContract} → ${operation.resultContract} | ${operation.requiredScopes.join(', ')} |`), '',
    '## Desktop route declarations — not M7 exposure', '', '| Method | Path | Source |', '|---|---|---|',
    ...inventory.desktopRoutes.map(route => `| ${route.method} | \`${route.path}\` | ${route.sources.join(', ')} |`), '',
  ].join('\n');
}

export function validateInventoryArtifacts(inventory, json, markdown) {
  if (json !== `${JSON.stringify(inventory, null, 2)}\n` || markdown !== renderInventoryMarkdown(inventory)) {
    throw new Error('MOBILE_CAPABILITY_INVENTORY_STALE: regenerate on the integration tree with --write');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flags = process.argv.slice(2);
  if (flags.some(flag => flag !== '--write') || flags.length > 1) throw new Error('Usage: mobile-capability-inventory.mjs [--write]');
  const inventory = buildInventory();
  if (flags.includes('--write')) {
    writeFileSync(JSON_TARGET, `${JSON.stringify(inventory, null, 2)}\n`);
    writeFileSync(MD_TARGET, renderInventoryMarkdown(inventory));
  } else {
    validateInventoryArtifacts(inventory, readFileSync(JSON_TARGET, 'utf8'), readFileSync(MD_TARGET, 'utf8'));
  }
  console.log(`Mobile inventory: ${inventory.summary.desktopRouteDeclarations} desktop / ${inventory.summary.m7TransportRoutes} transport / ${inventory.summary.m7Operations} operations; ${inventory.inventoryDigest}`);
}
