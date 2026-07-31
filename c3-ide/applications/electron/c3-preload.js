// C3 Studio — preload bridge for backend URL discovery
// Exposes window.electronC3 via contextBridge for renderer use.
const { contextBridge } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT_FILE = path.join(os.homedir(), '.c3', 'port');
const LOCAL_CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const LOCAL_BACKEND_HOSTS = new Set(['127.0.0.1', 'localhost']);

function readPortFile() {
  try {
    if (!fs.existsSync(PORT_FILE)) return null;
    return JSON.parse(fs.readFileSync(PORT_FILE, 'utf8'));
  } catch (_) { return null; }
}

function normalizeLocalAccess(info, requireCapability = true) {
  if (!info || typeof info !== 'object') return null;
  const host = typeof info.host === 'string' ? info.host.toLowerCase() : '';
  const port = info.port;
  if (
    !LOCAL_BACKEND_HOSTS.has(host)
    || !Number.isInteger(port)
    || port < 1
    || port > 65535
  ) {
    return null;
  }
  const localCapability = typeof info.localCapability === 'string'
    && LOCAL_CAPABILITY_PATTERN.test(info.localCapability)
    ? info.localCapability
    : null;
  if (requireCapability && !localCapability) return null;
  return {
    backendUrl: `http://${host}:${port}`,
    port,
    localCapability,
  };
}

exports.preload = function preload() {
  if (typeof window !== 'undefined' && window.electronC3) return; // idempotent
  console.log('exposing C3 backend bridge');
  contextBridge.exposeInMainWorld('electronC3', {
    getBackendUrl: () => {
      const access = normalizeLocalAccess(readPortFile(), false);
      return access ? access.backendUrl : null;
    },
    getPort: () => {
      const access = normalizeLocalAccess(readPortFile(), false);
      return access ? access.port : null;
    },
    getLocalCapability: () => {
      const access = normalizeLocalAccess(readPortFile());
      return access ? access.localCapability : null;
    },
    getLocalAccess: () => {
      const access = normalizeLocalAccess(readPortFile());
      return access
        ? {
            backendUrl: access.backendUrl,
            localCapability: access.localCapability,
          }
        : null;
    }
  });
};
