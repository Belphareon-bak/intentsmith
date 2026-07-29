import { isAbsolute } from 'node:path';

import { ValidationSafetyError } from './safety.js';

function requireAbsolute(label: string, path: string): void {
  if (!isAbsolute(path)) throw new ValidationSafetyError('SYSTEMD_PATH_NOT_ABSOLUTE', `${label} must be absolute.`);
}

export function renderUserSystemdUnits(options: {
  nodePath: string;
  cliPath: string;
  sourceRoot: string;
  runsRoot: string;
  lockPath: string;
  timezone?: string;
  schedule?: string;
}): { service: string; timer: string; installRequired: true } {
  for (const [label, path] of Object.entries({
    nodePath: options.nodePath,
    cliPath: options.cliPath,
    sourceRoot: options.sourceRoot,
    runsRoot: options.runsRoot,
    lockPath: options.lockPath,
  })) {
    requireAbsolute(label, path);
  }
  const timezone = options.timezone ?? 'Europe/Prague';
  const schedule = options.schedule ?? '00:30';
  return {
    service: [
      '[Unit]',
      'Description=IntentSmith local validation',
      '',
      '[Service]',
      'Type=oneshot',
      `ExecStart=/usr/bin/flock -n ${options.lockPath} ${options.nodePath} ${options.cliPath} --execute --source ${options.sourceRoot} --runs-root ${options.runsRoot}`,
      'NoNewPrivileges=true',
      '',
    ].join('\n'),
    timer: [
      '[Unit]',
      'Description=Schedule IntentSmith local validation',
      '',
      '[Timer]',
      `OnCalendar=*-*-* ${schedule}:00 ${timezone}`,
      'Persistent=false',
      '',
      '[Install]',
      'WantedBy=timers.target',
      '',
    ].join('\n'),
    // Rendering does not install, enable or start anything. A separate,
    // explicit operator command must consume these strings.
    installRequired: true,
  };
}
