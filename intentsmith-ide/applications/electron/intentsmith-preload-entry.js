// IntentSmith Studio — preload entry point
// Chains Theia preloads + IntentSmith backend bridge.
// Used by intentsmith-webpack-wrapper.js to override the auto-generated preload entry.
// @ts-check
require('@theia/core/lib/electron-browser/preload').preload();
require('@theia/filesystem/lib/electron-browser/preload').preload();
require('./intentsmith-preload').preload();
