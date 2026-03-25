// C3 Studio — webpack config wrapper
// Imports Theia-generated webpack configs and overrides the preload entry
// to include our C3 backend bridge (electronC3).
//
// Usage: npx webpack --config c3-webpack-wrapper.js --mode development
const path = require('path');
const configs = require('./gen-webpack.config.js');

// configs[2] = preload config (target: electron-preload)
// Fail fast if Theia build changed the config structure
if (!configs[2] || !configs[2].entry) {
  throw new Error(
    'Preload config not found at configs[2] — Theia build may have changed.\n' +
    'Check gen-webpack.config.js and update c3-webpack-wrapper.js accordingly.'
  );
}

configs[2].entry.preload = path.resolve(__dirname, 'c3-preload-entry.js');

// Include node config if available
try {
  const nodeConfig = require('./gen-webpack.node.config.js');
  module.exports = [...configs, nodeConfig.config];
} catch (_) {
  module.exports = configs;
}
