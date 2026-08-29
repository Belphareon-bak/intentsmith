const path = require('node:path');

// Keep the browser provisioned by npm ci inside the dependency boundary.
// Deterministic tests intentionally replace HOME; a user-global Puppeteer
// cache would therefore turn an ACTIVE test into an environment-dependent
// BLOCKED result.
module.exports = {
  cacheDirectory: path.join(__dirname, 'node_modules', '.cache', 'puppeteer'),
};
