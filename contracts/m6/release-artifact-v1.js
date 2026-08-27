export const M6_RELEASE_ARTIFACT_CONTRACT = 'M6ReleaseArtifact';
export const M6_RELEASE_ARTIFACT_VERSION = 1;

export const M6_RELEASE_ARTIFACT_REQUIRED_FILES = Object.freeze([
  Object.freeze({
    role: 'studio-frontend-bundle',
    sourcePath: 'c3-ide/applications/electron/lib/frontend/bundle.js',
    executable: false,
  }),
  Object.freeze({
    role: 'studio-preload',
    sourcePath: 'c3-ide/applications/electron/lib/frontend/preload.js',
    executable: false,
  }),
  Object.freeze({
    role: 'studio-backend-main',
    sourcePath: 'c3-ide/applications/electron/lib/backend/main.js',
    executable: false,
  }),
  Object.freeze({
    role: 'studio-electron-main',
    sourcePath: 'c3-ide/applications/electron/lib/backend/electron-main.js',
    executable: false,
  }),
  Object.freeze({
    role: 'studio-ripgrep',
    sourcePath: 'c3-ide/applications/electron/lib/backend/native/rg',
    executable: true,
  }),
  Object.freeze({
    role: 'studio-m1-consumer',
    sourcePath: 'c3-ide/extensions/c3-chat-panel/lib/browser/ws-client.js',
    executable: false,
  }),
  Object.freeze({
    role: 'studio-m1-protocol',
    sourcePath: 'c3-ide/extensions/c3-protocol/lib/index.js',
    executable: false,
  }),
]);
