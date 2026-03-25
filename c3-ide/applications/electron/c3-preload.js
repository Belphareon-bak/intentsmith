// C3 Studio — preload bridge for backend URL discovery
// Exposes window.electronC3 via contextBridge for renderer use.
const { contextBridge } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT_FILE = path.join(os.homedir(), '.c3', 'port');

function readPortFile() {
  try {
    if (!fs.existsSync(PORT_FILE)) return null;
    return JSON.parse(fs.readFileSync(PORT_FILE, 'utf8'));
  } catch (_) { return null; }
}

exports.preload = function preload() {
  if (typeof window !== 'undefined' && window.electronC3) return; // idempotent
  console.log('exposing C3 backend bridge');
  contextBridge.exposeInMainWorld('electronC3', {
    getBackendUrl: () => {
      const info = readPortFile();
      return info ? `http://${info.host || '127.0.0.1'}:${info.port}` : null;
    },
    getPort: () => {
      const info = readPortFile();
      return info ? info.port : null;
    }
  });
};
