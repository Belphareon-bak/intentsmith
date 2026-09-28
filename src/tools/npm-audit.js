import { spawnSync } from 'node:child_process';

const AUDIT_SEVERITIES = ['critical', 'high', 'moderate', 'low', 'info'];
const AUDIT_SEVERITY_SET = new Set(AUDIT_SEVERITIES);
const DEFAULT_AUDIT_TIMEOUT_MS = 30_000;
const DEFAULT_FIX_TIMEOUT_MS = 60_000;
const MAX_AUDIT_OUTPUT_BYTES = 2 * 1024 * 1024;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function processFailure(reason, message, details = {}) {
  return {
    ok: false,
    reason,
    message,
    ...details,
  };
}

function decodeOutput(value) {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return '';
}

function parseAuditJson(stdout) {
  let audit;
  try {
    audit = JSON.parse(stdout);
  } catch {
    return processFailure(
      'INVALID_JSON',
      'npm audit returned malformed JSON',
    );
  }

  if (!isRecord(audit)) {
    return processFailure(
      'INVALID_REPORT',
      'npm audit returned an invalid report',
    );
  }

  if (audit.error !== undefined) {
    const npmError = isRecord(audit.error) ? audit.error : {};
    return processFailure(
      'NPM_ERROR_RESPONSE',
      'npm audit returned an error response',
      {
        npmErrorCode: typeof npmError.code === 'string'
          ? npmError.code
          : undefined,
      },
    );
  }

  if (
    !Number.isInteger(audit.auditReportVersion)
    || audit.auditReportVersion < 1
    || !isRecord(audit.vulnerabilities)
    || !isRecord(audit.metadata)
    || !isRecord(audit.metadata.vulnerabilities)
  ) {
    return processFailure(
      'INVALID_REPORT',
      'npm audit returned an invalid report',
    );
  }

  const summary = {
    critical: 0,
    high: 0,
    moderate: 0,
    low: 0,
    info: 0,
    total: 0,
  };
  const vulnerabilities = [];

  for (const [name, info] of Object.entries(audit.vulnerabilities)) {
    if (
      typeof name !== 'string'
      || name.length === 0
      || !isRecord(info)
      || !AUDIT_SEVERITY_SET.has(info.severity)
    ) {
      return processFailure(
        'INVALID_REPORT',
        'npm audit returned an invalid vulnerability record',
      );
    }

    summary[info.severity] += 1;
    summary.total += 1;

    const firstVia = Array.isArray(info.via) ? info.via[0] : undefined;
    const title = typeof firstVia === 'string'
      ? firstVia
      : isRecord(firstVia) && typeof firstVia.title === 'string'
        ? firstVia.title
        : 'Unknown';

    vulnerabilities.push({
      name,
      severity: info.severity,
      title,
      fixAvailable: Boolean(info.fixAvailable),
      range: info.range,
    });
  }

  for (const field of [...AUDIT_SEVERITIES, 'total']) {
    const expected = audit.metadata.vulnerabilities[field];
    if (!Number.isInteger(expected) || expected < 0 || expected !== summary[field]) {
      return processFailure(
        'INVALID_REPORT',
        'npm audit vulnerability totals are inconsistent',
      );
    }
  }

  vulnerabilities.sort((left, right) => (
    AUDIT_SEVERITIES.indexOf(left.severity)
    - AUDIT_SEVERITIES.indexOf(right.severity)
  ));

  return {
    ok: true,
    audit,
    summary,
    vulnerabilities,
  };
}

/**
 * Execute npm audit without a shell and preserve npm's exit semantics.
 *
 * npm exits 1 when a valid audit report contains vulnerabilities. Any other
 * non-zero status, a signal, timeout, spawn failure, malformed JSON, npm error
 * envelope, or internally inconsistent report is a terminal tool error.
 */
export function runNpmAuditReport(
  {
    cwd = process.cwd(),
    fix = false,
    production = false,
    timeoutMs = fix ? DEFAULT_FIX_TIMEOUT_MS : DEFAULT_AUDIT_TIMEOUT_MS,
  } = {},
  {
    spawnSyncImpl = spawnSync,
    env = process.env,
  } = {},
) {
  const args = ['audit'];
  if (fix) args.push('fix');
  args.push('--json');
  if (production) args.push('--production');

  let child;
  try {
    child = spawnSyncImpl('npm', args, {
      cwd,
      env,
      encoding: 'utf8',
      maxBuffer: MAX_AUDIT_OUTPUT_BYTES,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      windowsHide: true,
    });
  } catch {
    return processFailure(
      'SPAWN_FAILED',
      'npm audit could not be started',
    );
  }

  if (child?.error) {
    if (child.error.code === 'ETIMEDOUT') {
      return processFailure(
        'TIMEOUT',
        'npm audit timed out',
      );
    }
    return processFailure(
      'SPAWN_FAILED',
      'npm audit could not be started',
    );
  }

  if (child?.signal) {
    return processFailure(
      'SIGNALLED',
      'npm audit was terminated by a signal',
      { signal: child.signal },
    );
  }

  if (!Number.isInteger(child?.status)) {
    return processFailure(
      'MISSING_STATUS',
      'npm audit did not return an exit status',
    );
  }

  const parsed = parseAuditJson(decodeOutput(child.stdout));
  if (!parsed.ok) return parsed;

  if (child.status !== 0 && child.status !== 1) {
    return processFailure(
      'PROCESS_FAILED',
      'npm audit exited with an unexpected status',
      { status: child.status },
    );
  }

  if (
    (child.status === 0 && parsed.summary.total !== 0)
    || (child.status === 1 && parsed.summary.total === 0)
  ) {
    return processFailure(
      'INCONSISTENT_STATUS',
      'npm audit exit status contradicts the report',
      { status: child.status },
    );
  }

  return {
    ...parsed,
    status: child.status,
    command: {
      executable: 'npm',
      args,
    },
  };
}

export function npmAuditError(result, code) {
  const error = {
    error: result.message,
    code,
    reason: result.reason,
  };
  if (Number.isInteger(result.status)) error.status = result.status;
  if (typeof result.signal === 'string') error.signal = result.signal;
  if (typeof result.npmErrorCode === 'string') {
    error.npmErrorCode = result.npmErrorCode;
  }
  return error;
}

export function dependencyVulnerabilityResult(result) {
  return {
    summary: result.summary,
    vulnerabilities: result.vulnerabilities.slice(0, 50),
    clean: result.summary.total === 0,
  };
}

export function npmAuditOverview(result) {
  const audit = result.audit;
  return {
    vulnerabilities: audit.metadata.vulnerabilities,
    totalDeps: audit.metadata.totalDependencies,
    advisories: Object.values(
      isRecord(audit.advisories) ? audit.advisories : {},
    ).slice(0, 20).map(advisory => ({
      title: advisory?.title,
      severity: advisory?.severity,
      module: advisory?.module_name,
      url: advisory?.url,
    })),
  };
}
