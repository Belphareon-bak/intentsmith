// C3 Studio — tracked Theia webpack customization.
//
// Theia regenerates gen-webpack*.js before each build, then loads this file.
// Keep the C3 preload bridge and adapt Theia 1.65.2's native plugin to the
// integrity-locked platform packages used by @vscode/ripgrep 1.18.0.
// @ts-check
const fs = require('fs');
const path = require('path');
const configs = require('./gen-webpack.config.js');
const nodeConfig = require('./gen-webpack.node.config.js');
const nativePluginPackage = require('@theia/native-webpack-plugin/package.json');

if (!configs[2] || !configs[2].entry) {
  throw new Error(
    'Preload config not found at configs[2] — Theia build may have changed.\n' +
    'Check gen-webpack.config.js and update webpack.config.js accordingly.'
  );
}

if (!configs[0] || !configs[0].entry || !configs[0].entry.bundle) {
  throw new Error(
    'Frontend bundle config not found at configs[0] — Theia build may have changed.\n' +
    'Check gen-webpack.config.js and update webpack.config.js accordingly.'
  );
}

const generatedFrontendEntry = configs[0].entry.bundle;
configs[0].entry.bundle = [
  path.resolve(__dirname, 'c3-local-http-bootstrap.js'),
  ...(Array.isArray(generatedFrontendEntry)
    ? generatedFrontendEntry
    : [generatedFrontendEntry]),
];
configs[2].entry.preload = path.resolve(__dirname, 'c3-preload-entry.js');

if (!nodeConfig.config || !nodeConfig.config.entry?.['electron-main']) {
  throw new Error(
    'Electron main config not found — Theia build may have changed.\n' +
    'Check gen-webpack.node.config.js and update webpack.config.js accordingly.'
  );
}

const generatedElectronMainEntry = nodeConfig.config.entry['electron-main'];
nodeConfig.config.entry['electron-main'] = [
  path.resolve(__dirname, 'c3-local-origin-normalizer.js'),
  ...(Array.isArray(generatedElectronMainEntry)
    ? generatedElectronMainEntry
    : [generatedElectronMainEntry]),
];

const nativePlugin = nodeConfig.nativePlugin;
if (!nativePlugin || typeof nativePlugin.copyRipgrep !== 'function') {
  throw new Error('Theia native webpack plugin does not expose copyRipgrep');
}
if (nativePluginPackage.version !== '1.65.2') {
  throw new Error(
    `Unsupported @theia/native-webpack-plugin ${nativePluginPackage.version}; expected 1.65.2`
  );
}
if (!String(nativePlugin.copyRipgrep).includes('@vscode/ripgrep/bin/rg')) {
  throw new Error('Theia ripgrep compatibility hook changed; review the tracked override');
}

nativePlugin.copyRipgrep = async function copyLockedRipgrep(issuer, compiler) {
  const arch = process.env.npm_config_arch || process.arch;
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const platformPackage = `@vscode/ripgrep-${process.platform}-${arch}`;
  let sourceFile;
  try {
    sourceFile = require.resolve(`${platformPackage}/bin/rg${suffix}`, {
      paths: [issuer, __dirname],
    });
  } catch {
    throw new Error(
      `Could not find integrity-locked ${platformPackage}; ` +
      'install C3 Studio with the committed Yarn lockfile.'
    );
  }

  const targetFile = path.join(compiler.outputPath, this.options.out, `rg${suffix}`);
  await fs.promises.mkdir(path.dirname(targetFile), { recursive: true });
  await fs.promises.copyFile(sourceFile, targetFile);
  await fs.promises.chmod(targetFile, 0o755);
};

module.exports = [
  ...configs,
  nodeConfig.config,
];
