import {
  M2_REMOTE_CORE_PORT_DESCRIPTOR_V1,
  createM2RemoteCoreUnavailableNegotiation,
  validateM2RemoteCoreHello,
} from '../../contracts/m2/remote-core-port-v1.js';

function requireClock(clock) {
  if (typeof clock !== 'function') {
    throw new TypeError('remote-core-unavailable-provider:clock-required');
  }
  return clock;
}

function canonicalNow(clock) {
  const value = clock();
  if (!Number.isFinite(value)) {
    throw new TypeError('remote-core-unavailable-provider:clock-invalid');
  }
  return new Date(value).toISOString();
}

/**
 * This is availability truth, not a remote runtime. M5 may replace it with an
 * in-process core adapter after each capability contract exists. Network
 * listener, pairing and device authentication remain outside this provider.
 */
export function createUnavailableRemoteCorePort({ clock = Date.now } = {}) {
  const providerClock = requireClock(clock);
  return Object.freeze({
    describe() {
      return M2_REMOTE_CORE_PORT_DESCRIPTOR_V1;
    },
    negotiate(hello) {
      const validation = validateM2RemoteCoreHello(hello);
      if (!validation.valid) throw new TypeError(validation.errors.join(','));
      return createM2RemoteCoreUnavailableNegotiation(
        hello,
        canonicalNow(providerClock),
      );
    },
  });
}

export default createUnavailableRemoteCorePort;
