export const M5_CONDITIONAL_SURFACE_CONTRACT = 'M5ConditionalSurfaceDisposition@1';
export const M5_CONDITIONAL_SURFACE_ERROR = 'M5_CONDITIONAL_SURFACE_UNSUPPORTED';

const DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'core-auto-update',
    releaseStatus: 'unsupported',
    requiredM6Journey: null,
    reasonCode: 'M5_CORE_AUTO_UPDATE_NOT_RELEASED',
  }),
  Object.freeze({
    id: 'external-notifications',
    releaseStatus: 'unsupported',
    requiredM6Journey: null,
    reasonCode: 'M5_EXTERNAL_NOTIFICATIONS_NOT_RELEASED',
  }),
  Object.freeze({
    id: 'marketplace',
    releaseStatus: 'unsupported',
    requiredM6Journey: null,
    reasonCode: 'M5_MARKETPLACE_NOT_RELEASED',
  }),
  Object.freeze({
    id: 'media-comfyui',
    releaseStatus: 'unsupported',
    requiredM6Journey: null,
    reasonCode: 'M5_MEDIA_COMFYUI_NOT_RELEASED',
  }),
  Object.freeze({
    id: 'model-discovery',
    releaseStatus: 'supported',
    requiredM6Journey: 'M6-JOURNEY-MODEL-DISCOVERY-V1',
    reasonCode: null,
  }),
]);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function enabledMap({ config, environment }) {
  return {
    'core-auto-update': typeof environment.C3_UPDATE_REPO === 'string'
      && environment.C3_UPDATE_REPO.trim().length > 0,
    'external-notifications': config.features.externalNotifications === true,
    marketplace: config.features.marketplace === true,
    'media-comfyui': config.features.comfyui === true,
    'model-discovery': config.features.onlineDiscovery === true,
  };
}

export function resolveM5ConditionalSurfaces({ config, environment = process.env } = {}) {
  if (!config?.features || !environment || typeof environment !== 'object') {
    throw new TypeError('m5-conditional-surfaces:config-and-environment-required');
  }
  const enabled = enabledMap({ config, environment });
  const surfaces = DEFINITIONS.map(definition => ({
    ...definition,
    enabled: enabled[definition.id],
    outboundAuthority: definition.id === 'model-discovery'
      ? { surface: 'model-discovery', scope: 'model.metadata.read' }
      : null,
  }));
  return deepFreeze({
    contract: M5_CONDITIONAL_SURFACE_CONTRACT,
    surfaces,
    requiredM6Journeys: surfaces
      .filter(surface => surface.enabled && surface.releaseStatus === 'supported')
      .map(surface => surface.requiredM6Journey),
  });
}

export function assertM5ProductionConditionalSurfaces(status, { production } = {}) {
  if (!status || status.contract !== M5_CONDITIONAL_SURFACE_CONTRACT) {
    throw new TypeError('m5-conditional-surfaces:invalid-status');
  }
  if (production !== true) return status;
  const unsupported = status.surfaces.filter(surface => (
    surface.enabled && surface.releaseStatus !== 'supported'
  ));
  if (unsupported.length > 0) {
    const error = new Error(
      `Unsupported M5 production surface enabled: ${unsupported.map(item => item.id).join(', ')}`,
    );
    error.code = M5_CONDITIONAL_SURFACE_ERROR;
    error.surfaces = Object.freeze(unsupported.map(item => item.id));
    throw error;
  }
  return status;
}

export const M5_CONDITIONAL_SURFACE_DEFINITIONS = DEFINITIONS;
