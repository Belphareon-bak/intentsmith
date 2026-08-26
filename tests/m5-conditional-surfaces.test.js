#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import {
  M5_CONDITIONAL_SURFACE_CONTRACT,
  M5_CONDITIONAL_SURFACE_DEFINITIONS,
  M5_CONDITIONAL_SURFACE_ERROR,
  assertM5ProductionConditionalSurfaces,
  resolveM5ConditionalSurfaces,
} from '../src/release/conditional-surfaces.js';
import { createNotificationRouter } from '../src/notifications/index.js';
import { suite, summary, test } from './harness.js';

function config(overrides = {}) {
  return {
    features: {
      comfyui: false,
      externalNotifications: false,
      marketplace: false,
      onlineDiscovery: true,
      ...overrides,
    },
  };
}

function status(overrides = {}, environment = {}) {
  return resolveM5ConditionalSurfaces({ config: config(overrides), environment });
}

function byId(value, id) {
  return value.surfaces.find(surface => surface.id === id);
}

suite('M5 conditional release surface disposition');

test('release catalog is exact, deterministic and deeply immutable', () => {
  const value = status();
  assert.equal(value.contract, M5_CONDITIONAL_SURFACE_CONTRACT);
  assert.deepEqual(value.surfaces.map(item => item.id), [
    'core-auto-update',
    'external-notifications',
    'marketplace',
    'media-comfyui',
    'model-discovery',
  ]);
  assert.equal(Object.isFrozen(M5_CONDITIONAL_SURFACE_DEFINITIONS), true);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.surfaces[0]), true);
});

test('default release set includes only the audited model-discovery journey', () => {
  const value = status();
  assert.deepEqual(value.requiredM6Journeys, ['M6-JOURNEY-MODEL-DISCOVERY-V1']);
  assert.equal(byId(value, 'model-discovery').releaseStatus, 'supported');
  assert.deepEqual(byId(value, 'model-discovery').outboundAuthority, {
    surface: 'model-discovery',
    scope: 'model.metadata.read',
  });
  for (const surface of value.surfaces.filter(item => item.id !== 'model-discovery')) {
    assert.equal(surface.enabled, false, surface.id);
    assert.equal(surface.releaseStatus, 'unsupported', surface.id);
    assert.equal(surface.requiredM6Journey, null, surface.id);
  }
});

test('unsupported flags require strict true and are never promoted to supported', () => {
  const truthyString = status({ marketplace: 'true', comfyui: 1 });
  assert.equal(byId(truthyString, 'marketplace').enabled, false);
  assert.equal(byId(truthyString, 'media-comfyui').enabled, false);

  const requested = status({
    comfyui: true,
    externalNotifications: true,
    marketplace: true,
  }, { C3_UPDATE_REPO: 'owner/repository' });
  for (const id of [
    'core-auto-update', 'external-notifications', 'marketplace', 'media-comfyui',
  ]) {
    assert.equal(byId(requested, id).enabled, true, id);
    assert.equal(byId(requested, id).releaseStatus, 'unsupported', id);
  }
  assert.deepEqual(requested.requiredM6Journeys, ['M6-JOURNEY-MODEL-DISCOVERY-V1']);
});

test('production rejects every requested unsupported surface with a typed census', () => {
  for (const [id, feature] of [
    ['external-notifications', 'externalNotifications'],
    ['marketplace', 'marketplace'],
    ['media-comfyui', 'comfyui'],
  ]) {
    assert.throws(
      () => assertM5ProductionConditionalSurfaces(status({ [feature]: true }), {
        production: true,
      }),
      error => error.code === M5_CONDITIONAL_SURFACE_ERROR
        && error.surfaces.length === 1
        && error.surfaces[0] === id,
      id,
    );
  }
  assert.throws(
    () => assertM5ProductionConditionalSurfaces(
      status({}, { C3_UPDATE_REPO: 'private-owner/private-repository' }),
      { production: true },
    ),
    error => error.code === M5_CONDITIONAL_SURFACE_ERROR
      && error.surfaces[0] === 'core-auto-update',
  );
});

test('non-production may exercise dormant modules without changing release support truth', () => {
  const value = status({ marketplace: true });
  assert.equal(assertM5ProductionConditionalSurfaces(value, { production: false }), value);
  assert.equal(byId(value, 'marketplace').releaseStatus, 'unsupported');
  assert.equal(byId(value, 'marketplace').requiredM6Journey, null);
});

test('disabled notification factory registers no external delivery channel', () => {
  const disabled = createNotificationRouter({ includeExternal: false });
  assert.deepEqual(disabled.getAvailableChannels(), []);
  const enabled = createNotificationRouter({ includeExternal: true });
  assert.deepEqual(enabled.getAvailableChannels().sort(), ['email', 'push', 'telegram']);
});

test('production environment parsing rejects an unsupported request before optional startup', () => {
  const moduleUrl = new URL('../src/release/conditional-surfaces.js', import.meta.url).href;
  const configUrl = new URL('../src/config.js', import.meta.url).href;
  const script = `
    import { config } from ${JSON.stringify(configUrl)};
    import { resolveM5ConditionalSurfaces, assertM5ProductionConditionalSurfaces }
      from ${JSON.stringify(moduleUrl)};
    assertM5ProductionConditionalSurfaces(
      resolveM5ConditionalSurfaces({ config }),
      { production: process.env.NODE_ENV === 'production' },
    );
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      C3_ENABLE_MARKETPLACE: 'true',
      C3_ENABLE_COMFYUI: 'false',
      C3_ENABLE_EXTERNAL_NOTIFICATIONS: 'false',
      C3_UPDATE_REPO: '',
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported M5 production surface enabled: marketplace/);
});

test('server checks release disposition before notification, marketplace, media and updater start', () => {
  const source = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const assertion = source.indexOf('assertM5ProductionConditionalSurfaces');
  assert.equal(assertion >= 0, true);
  for (const sentinel of [
    'createNotificationPipeline({',
    "if (config.features.marketplace === true)",
    "if (config.features.comfyui !== false)",
    'if (process.env.C3_UPDATE_REPO)',
  ]) assert.equal(source.indexOf(sentinel) > assertion, true, sentinel);
  assert.equal(source.includes('conditionalSurfaces,'), true);

  const serialized = JSON.stringify(status({}, {
    C3_UPDATE_REPO: 'credential-shaped/private-value',
  }));
  assert.equal(serialized.includes('credential-shaped/private-value'), false);
});

summary();
