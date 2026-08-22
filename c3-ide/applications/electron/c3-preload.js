// C3 Studio — preload bridge for backend URL discovery and attachment bytes.
// Exposes window.electronC3 via contextBridge for renderer use.
const { contextBridge, ipcRenderer } = require('electron');
const { readLocalAccess } = require('./c3-local-access');
const { createAttachmentBridge } = require('./c3-attachment-bridge');

/* Theia's own filesystem preload registers this handler in electron-main; the
   bridge reuses it rather than adding a second dialog channel. */
const CHANNEL_SHOW_OPEN = 'ShowOpenDialog';

exports.preload = function preload() {
  if (typeof window !== 'undefined' && window.electronC3) return; // idempotent
  console.log('exposing C3 backend bridge');
  const attachments = createAttachmentBridge();

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
    },

    /**
     * Open the native file dialog and mint one read grant per picked file.
     *
     * Returns descriptors only — name, size, media type and an opaque token,
     * plus the directory the pick came from so the next dialog can start there.
     * The renderer never learns a file path, so it cannot ask for a file the
     * user did not just choose. A cancelled dialog is an empty list, not an
     * error.
     *
     * @param {{title?: string, defaultPath?: string, selectMany?: boolean}} [options]
     * @returns {Promise<{directory: string|null, files: Array<{token: string, name: string, size: number, type: string}>}>}
     */
    pickAttachmentFiles: async (options = {}) => {
      const request = {
        title: typeof options.title === 'string' ? options.title : undefined,
        openFiles: true,
        openFolders: false,
        selectMany: options.selectMany === true,
        /* electron-main reads `path`; `defaultPath` alone is silently ignored. */
        path: typeof options.defaultPath === 'string' && options.defaultPath
          ? options.defaultPath
          : undefined,
      };
      const filePaths = await ipcRenderer.invoke(CHANNEL_SHOW_OPEN, request);
      return attachments.grantPaths(filePaths);
    },

    /**
     * Spend a grant for that file's bytes, refusing above `maxBytes`.
     *
     * The caller passes the ceiling it is about to enforce, so an oversized
     * file is refused from its stat instead of being read and then discarded.
     * Each token reads once.
     *
     * @param {string} token
     * @param {number} maxBytes
     * @returns {{ok: true, bytes: Uint8Array, size: number}|{ok: false, code: string}}
     */
    readAttachmentBytes: (token, maxBytes) => attachments.readTokenBytes(token, maxBytes),
  });
};
