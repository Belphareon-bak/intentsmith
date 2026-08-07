// C3 Studio — preload bridge for backend URL discovery
// Exposes window.electronC3 via contextBridge for renderer use.
const { contextBridge } = require('electron');
const { readLocalAccess } = require('./c3-local-access');

exports.preload = function preload() {
  if (typeof window !== 'undefined' && window.electronC3) return; // idempotent
  console.log('exposing C3 backend bridge');
  contextBridge.exposeInMainWorld('electronC3', {
    getBackendUrl: () => {
      const access = readLocalAccess({ requireCapability: false });
      return access ? access.backendUrl : null;
    },
    getPort: () => {
      const access = readLocalAccess({ requireCapability: false });
      return access ? access.port : null;
    },
    getLocalCapability: () => {
      const access = readLocalAccess();
      return access ? access.localCapability : null;
    },
    getLocalAccess: () => {
      const access = readLocalAccess();
      return access
        ? {
            backendUrl: access.backendUrl,
            localCapability: access.localCapability,
          }
        : null;
    }
  });
};
