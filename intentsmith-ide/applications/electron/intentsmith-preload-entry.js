// Preserve all generated Theia preloads, then expose the IntentSmith byte bridge.
// @ts-check
require('./src-gen/frontend/preload');
require('./intentsmith-preload').preload();
