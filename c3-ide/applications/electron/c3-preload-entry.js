// C3 Studio — preload entry point
// Chains Theia preloads + C3 backend bridge.
// Used by c3-webpack-wrapper.js to override the auto-generated preload entry.
// @ts-check
require('@theia/core/lib/electron-browser/preload').preload();
require('@theia/filesystem/lib/electron-browser/preload').preload();
require('./c3-preload').preload();
