import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXTENSION_KIND,
  canonicalizeExtensionManifestV1,
  createExtensionContextV1,
} from '../../contracts/m3/extension-v1.js';
import { validateAgentDefinition } from '../agents/schema.js';

const INSTANCE_BINDING_CONTRACT = 'M3AgentExtensionBinding';
const INSTANCE_BINDING_VERSION = 1;
const INSTANCE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort(compareUtf8).map(key => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(',')}}`;
}

function definitionDigest(definition) {
  return `sha256:${createHash('sha256').update(canonicalJson(definition)).digest('hex')}`;
}

function fail(message, code = 'M3_AGENT_EXTENSION_INVALID') {
  throw Object.assign(new Error(message), { code });
}

function validateEffectPolicy(manifest) {
  const definition = manifest.payload.definition;
  if (definition.sources.some(source => source.type !== 'project_context')) {
    fail(
      `Agent extension ${manifest.id} requests a source without M2 authority`,
      'M3_AGENT_EXTENSION_EFFECT_AUTHORITY_REQUIRED',
    );
  }
  if (!manifest.requiredCapabilities.includes('code-intel.project-context.v1')) {
    fail(
      `Agent extension ${manifest.id} must declare ProjectContext authority`,
      'M3_AGENT_EXTENSION_EFFECT_AUTHORITY_REQUIRED',
    );
  }
  for (const action of definition.actions) {
    const locallyContained = ['mark_seen', 'store'].includes(action.type)
      || (
        action.type === 'notify'
        && (action.config?.channel || 'in_app') === 'in_app'
        && action.config?.use_llm !== true
      );
    if (!locallyContained) {
      fail(
        `Agent extension ${manifest.id} requests an action without M2 authority`,
        'M3_AGENT_EXTENSION_EFFECT_AUTHORITY_REQUIRED',
      );
    }
  }
}

function extensionRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../agent-extensions');
}

function cloneDefinition(manifest, instanceId) {
  const definition = structuredClone(manifest.payload.definition);
  definition.id = instanceId;
  const digest = definitionDigest(definition);
  definition.m3_extension = {
    contract: INSTANCE_BINDING_CONTRACT,
    version: INSTANCE_BINDING_VERSION,
    id: manifest.id,
    moduleVersion: manifest.moduleVersion,
    definitionDigest: digest,
  };
  return definition;
}

export class AgentExtensionService {
  constructor({
    repository,
    scheduler = null,
    hostCapabilities = {},
    extensionsDir = extensionRoot(),
  } = {}) {
    if (!repository || typeof repository.createAgent !== 'function') {
      throw new TypeError('agent-extension-service:repository-required');
    }
    this.repository = repository;
    this.scheduler = scheduler;
    this.hostCapabilities = hostCapabilities;
    this.extensionsDir = extensionsDir;
    this.extensions = new Map();
  }

  attachScheduler(scheduler) {
    this.scheduler = scheduler;
  }

  discover() {
    this.extensions.clear();
    if (!existsSync(this.extensionsDir)) return [];
    const directories = readdirSync(this.extensionsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort(compareUtf8);
    for (const directory of directories) {
      const manifestPath = path.join(this.extensionsDir, directory, 'agent.json');
      if (!existsSync(manifestPath)) continue;
      let manifest;
      try {
        manifest = canonicalizeExtensionManifestV1(
          JSON.parse(readFileSync(manifestPath, 'utf8')),
          EXTENSION_KIND.AGENT,
        );
      } catch (cause) {
        fail(`Invalid agent extension manifest: ${directory}`, 'M3_AGENT_EXTENSION_MANIFEST_INVALID');
      }
      if (manifest.id !== directory) {
        fail(`Agent extension directory mismatch: ${directory}`, 'M3_AGENT_EXTENSION_MANIFEST_INVALID');
      }
      const validation = validateAgentDefinition(manifest.payload.definition);
      if (!validation.valid) {
        fail(
          `Invalid agent definition for ${manifest.id}: ${validation.errors.join('; ')}`,
          'M3_AGENT_EXTENSION_DEFINITION_INVALID',
        );
      }
      validateEffectPolicy(manifest);
      const context = createExtensionContextV1({
        manifest,
        hostCapabilities: this.hostCapabilities,
      });
      this.extensions.set(manifest.id, Object.freeze({
        manifest,
        context,
        manifestPath,
      }));
    }
    return this.list();
  }

  list() {
    return [...this.extensions.values()].map(({ manifest }) => Object.freeze({
      id: manifest.id,
      moduleVersion: manifest.moduleVersion,
      enabledByDefault: manifest.payload.enabledByDefault,
      name: manifest.payload.definition.name,
      description: manifest.payload.definition.description || '',
      requiredCapabilities: [...manifest.requiredCapabilities],
    }));
  }

  get(extensionId) {
    return this.extensions.get(extensionId) || null;
  }

  install(extensionId, {
    instanceId = extensionId,
    params = {},
    enabled,
  } = {}) {
    const extension = this.get(extensionId);
    if (!extension) fail(`Unknown agent extension: ${extensionId}`, 'M3_AGENT_EXTENSION_NOT_FOUND');
    if (typeof instanceId !== 'string' || !INSTANCE_ID_PATTERN.test(instanceId)) {
      fail('Agent extension instanceId is invalid');
    }
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      fail('Agent extension params must be an object');
    }
    if (this.repository.getAgent(instanceId)) {
      fail(`Agent extension instance already exists: ${instanceId}`, 'M3_AGENT_EXTENSION_CONFLICT');
    }
    const definition = cloneDefinition(extension.manifest, instanceId);
    const validation = validateAgentDefinition(definition);
    if (!validation.valid) {
      fail(
        `Agent extension instance is invalid: ${validation.errors.join('; ')}`,
        'M3_AGENT_EXTENSION_DEFINITION_INVALID',
      );
    }
    const isEnabled = enabled ?? extension.manifest.payload.enabledByDefault;
    const agent = this.repository.createAgent({
      id: instanceId,
      name: definition.name,
      description: definition.description,
      icon: definition.icon || '🤖',
      definition,
      params: structuredClone(params),
      enabled: isEnabled,
    });
    if (agent.enabled && definition.schedule?.type !== 'manual') {
      this.scheduler?.scheduleAgent(agent);
    }
    return agent;
  }

  uninstall(extensionId, instanceId) {
    const agent = this.repository.getAgent(instanceId);
    if (!agent) return false;
    const binding = agent.definition?.m3_extension;
    if (binding?.id !== extensionId) {
      fail('Agent is not owned by the requested extension', 'M3_AGENT_EXTENSION_OWNERSHIP_MISMATCH');
    }
    if (this.scheduler?.getStatus?.().runningAgents?.includes(instanceId)) {
      fail('Running agent extension cannot be uninstalled', 'M3_AGENT_EXTENSION_RUNNING');
    }
    this.repository.deleteAgent(instanceId);
    return true;
  }

  uninstallInstance(instanceId) {
    const agent = this.repository.getAgent(instanceId);
    if (!agent) return false;
    const extension = this.resolveExecution(agent);
    return this.uninstall(extension.manifest.id, instanceId);
  }

  async runInstance(instanceId) {
    const agent = this.repository.getAgent(instanceId);
    if (!agent) fail(`Unknown agent extension instance: ${instanceId}`, 'M3_AGENT_EXTENSION_NOT_FOUND');
    this.resolveExecution(agent);
    if (!this.scheduler || typeof this.scheduler.triggerAgent !== 'function') {
      fail('Agent extension scheduler is unavailable', 'M3_AGENT_EXTENSION_SCHEDULER_UNAVAILABLE');
    }
    return this.scheduler.triggerAgent(instanceId);
  }

  setInstanceEnabled(instanceId, enabled) {
    const agent = this.repository.getAgent(instanceId);
    if (!agent) fail(`Unknown agent extension instance: ${instanceId}`, 'M3_AGENT_EXTENSION_NOT_FOUND');
    this.resolveExecution(agent);
    const updated = this.repository.updateAgent(instanceId, { enabled: enabled === true });
    if (updated.enabled && updated.definition.schedule?.type !== 'manual') {
      this.scheduler?.rescheduleAgent(instanceId);
    }
    return updated;
  }

  resolveExecution(agent) {
    const binding = agent?.definition?.m3_extension;
    if (
      binding?.contract !== INSTANCE_BINDING_CONTRACT
      || binding.version !== INSTANCE_BINDING_VERSION
      || typeof binding.id !== 'string'
    ) fail('Agent has no trusted M3 extension binding', 'M3_AGENT_EXTENSION_AUTHORITY_REQUIRED');
    const extension = this.get(binding.id);
    if (!extension || extension.manifest.moduleVersion !== binding.moduleVersion) {
      fail('Agent extension binding is stale', 'M3_AGENT_EXTENSION_STALE');
    }
    const expected = cloneDefinition(extension.manifest, agent.id);
    const actual = structuredClone(agent.definition);
    const actualBinding = actual.m3_extension;
    delete actual.m3_extension;
    if (
      actualBinding.definitionDigest !== definitionDigest(actual)
      || canonicalJson(agent.definition) !== canonicalJson(expected)
    ) fail('Agent extension definition was modified', 'M3_AGENT_EXTENSION_TAMPERED');
    return extension;
  }
}

export const _testInternals = Object.freeze({
  canonicalJson,
  cloneDefinition,
  definitionDigest,
  validateEffectPolicy,
});

export default AgentExtensionService;
