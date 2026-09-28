// Preserve an existing Studio profile when the package namespace changes.
// Explicit/portable/new profiles retain priority. No profile is copied or removed.
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
function isDirectory(file) { try { return fs.statSync(file).isDirectory(); } catch { return false; } }
function resolveUserDataArgs(argv, options = {}) {
  if (argv.some(arg => /^--(?:user-data-dir|electron-user-data)(?:=|$)/.test(arg))) return [];
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const home = options.home || os.homedir();
  const directory = options.isDirectory || isDirectory;
  const root = platform === 'win32' ? env.APPDATA
    : platform === 'darwin' ? path.join(home, 'Library', 'Application Support')
      : env.XDG_CONFIG_HOME || path.join(home, '.config');
  if (!root) return [];
  const current = path.join(root, 'intentsmith-ide-electron');
  const previous = path.join(root, 'c3-ide-electron');
  return !directory(current) && directory(previous) ? ['--user-data-dir=' + previous] : [];
}
module.exports = { resolveUserDataArgs };
