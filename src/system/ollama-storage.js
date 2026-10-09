import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const unknown = reason => ({ path: null, status: 'UNKNOWN', source: null, reason });
const validPath = value => typeof value === 'string' && path.isAbsolute(value)
  && value.length <= 4096 && !/[\x00-\x1f]/.test(value);

// Read the fixed local provider unit, never a guessed home directory or a shell
// command. Config is a fallback hint for installations without systemd.
export async function resolveOllamaStorage(ollama = {}, { runCommand = execute, platform = process.platform } = {}) {
  let endpoint;
  try { endpoint = new URL(ollama.baseUrl || 'http://127.0.0.1:11434'); }
  catch { return unknown('PROVIDER_ENDPOINT_INVALID'); }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
    || endpoint.username || endpoint.password) return unknown('REMOTE_PROVIDER_STORAGE');
  if (platform === 'linux') {
    try {
      const { stdout } = await runCommand('systemctl', ['show', 'ollama.service',
        '--property=Environment,ActiveState,MainPID'], { timeout: 1000, maxBuffer: 65536, encoding: 'utf8' });
      const properties = Object.fromEntries(stdout.split('\n').filter(line => line.includes('='))
        .map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
      const environment = {};
      for (const token of properties.Environment?.match(/(?:[^\s"']|"[^"]*"|'[^']*')+/g) || []) {
        const value = token.replace(/^(["'])(.*)\1$/, '$2');
        const index = value.indexOf('=');
        if (index > 0) environment[value.slice(0, index)] = value.slice(index + 1);
      }
      const host = environment.OLLAMA_HOST || '127.0.0.1:11434';
      const unitEndpoint = new URL(host.includes('://') ? host : 'http://' + host);
      if (properties.ActiveState === 'active' && Number(properties.MainPID) > 0
        && endpoint.protocol === unitEndpoint.protocol
        && (endpoint.port || '80') === (unitEndpoint.port || '80')
        && validPath(environment.OLLAMA_MODELS)) {
        return { path: path.resolve(environment.OLLAMA_MODELS), status: 'CONFIGURED',
          source: 'LOCAL_PROVIDER_SERVICE', providerUnit: 'ollama.service',
          backendHintDiffers: validPath(ollama.modelsPath) && path.resolve(ollama.modelsPath) !== path.resolve(environment.OLLAMA_MODELS) };
      }
    } catch { /* Missing/inaccessible systemd is unknown, not a default path. */ }
  }
  if (validPath(ollama.modelsPath)) return { path: path.resolve(ollama.modelsPath),
    status: 'CONFIGURED', source: 'INSTALLATION_CONFIGURATION' };
  return unknown('LOCAL_PROVIDER_PATH_NOT_CONFIGURED');
}
