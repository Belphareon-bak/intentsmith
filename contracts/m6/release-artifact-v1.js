export const M6_RELEASE_ARTIFACT_CONTRACT = 'M6ReleaseArtifact';
export const M6_RELEASE_ARTIFACT_VERSION = 1;

export const M6_RELEASE_ARTIFACT_REQUIRED_FILES = Object.freeze([
  Object.freeze({
    role: 'studio-frontend-bundle',
    sourcePath: 'intentsmith-ide/applications/electron/lib/frontend/bundle.js',
    executable: false,
  }),
  Object.freeze({
    role: 'studio-preload',
    sourcePath: 'intentsmith-ide/applications/electron/lib/frontend/preload.js',
    executable: false,
  }),
  Object.freeze({
    role: 'studio-backend-main',
    sourcePath: 'intentsmith-ide/applications/electron/lib/backend/main.js',
    executable: false,
  }),
  Object.freeze({
    role: 'studio-electron-main',
    sourcePath: 'intentsmith-ide/applications/electron/lib/backend/electron-main.js',
    executable: false,
  }),
  Object.freeze({
    role: 'studio-ripgrep',
    sourcePath: 'intentsmith-ide/applications/electron/lib/backend/native/rg',
    executable: true,
  }),
  Object.freeze({
    role: 'studio-m1-consumer',
    sourcePath: 'intentsmith-ide/extensions/intentsmith-chat-panel/lib/browser/ws-client.js',
    executable: false,
  }),
  Object.freeze({
    role: 'studio-m1-protocol',
    sourcePath: 'intentsmith-ide/extensions/intentsmith-protocol/lib/index.js',
    executable: false,
  }),
]);
