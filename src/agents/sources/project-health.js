const HEALTH_PATTERNS = Object.freeze([
  Object.freeze({ code: 'FIXME', severity: 'high', pattern: /\bFIXME\b/i }),
  Object.freeze({ code: 'HACK', severity: 'medium', pattern: /\bHACK\b/i }),
  Object.freeze({ code: 'TODO', severity: 'low', pattern: /\bTODO\b/i }),
  Object.freeze({ code: 'FOCUSED_TEST', severity: 'medium', pattern: /\.(?:only|skip)\s*\(/ }),
  Object.freeze({ code: 'DEBUG_LOG', severity: 'low', pattern: /\bconsole\.log\s*\(/ }),
]);

const SEVERITY_ORDER = Object.freeze({ high: 0, medium: 1, low: 2 });

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function fail(message, code = 'M3_AGENT_PROJECT_HEALTH_INVALID') {
  throw Object.assign(new Error(message), { code });
}

function positiveInteger(value, fallback, maximum, label) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    fail(`${label} is outside the project-health source budget`);
  }
  return resolved;
}

export function summarizeProjectHealthSnapshot(snapshot) {
  if (snapshot?.status !== 'ok' || !Array.isArray(snapshot.items)) {
    fail(
      snapshot?.error?.message || 'ProjectContext did not return a successful snapshot',
      snapshot?.error?.code || 'M3_AGENT_PROJECT_CONTEXT_FAILED',
    );
  }

  const findings = [];
  for (const item of snapshot.items) {
    const lines = item.content.split('\n');
    for (let offset = 0; offset < lines.length; offset += 1) {
      for (const rule of HEALTH_PATTERNS) {
        if (!rule.pattern.test(lines[offset])) continue;
        findings.push({
          code: rule.code,
          severity: rule.severity,
          path: item.path,
          line: item.startLine + offset,
          contentDigest: item.contentDigest,
        });
      }
    }
  }
  findings.sort((left, right) => (
    SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
    || compareUtf8(left.path, right.path)
    || left.line - right.line
    || compareUtf8(left.code, right.code)
  ));

  return Object.freeze({
    status: findings.length > 0 ? 'attention' : 'healthy',
    issue_count: findings.length,
    files_observed: snapshot.items.length,
    project_id: snapshot.projectId,
    workspace_revision: snapshot.workspaceRevision,
    snapshot_digest: snapshot.snapshotDigest,
    truncated: snapshot.truncation?.truncated === true,
    findings: Object.freeze(findings.map(finding => Object.freeze(finding))),
    provenance: Object.freeze(snapshot.items.map(item => Object.freeze({
      path: item.path,
      contentDigest: item.contentDigest,
      workspaceRevision: item.provenance.workspaceRevision,
    }))),
  });
}

export async function fetchProjectHealthSource({
  config,
  invocation,
  capability,
} = {}) {
  if (!capability || typeof capability.query !== 'function') {
    fail('ProjectContext capability is unavailable', 'M3_AGENT_PROJECT_CONTEXT_REQUIRED');
  }
  if (!invocation) fail('ProjectContext invocation is required');
  const projectId = Number(config?.project_id);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    fail('project_id must resolve to an active project');
  }
  const queryText = config?.query;
  if (typeof queryText !== 'string' || queryText.trim().length === 0) {
    fail('project-health query is required');
  }
  const snapshot = await capability.query(invocation, {
    queryText,
    maxFiles: positiveInteger(config.max_files, 12, 16, 'max_files'),
    maxBytes: positiveInteger(config.max_bytes, 49_152, 65_536, 'max_bytes'),
    maxTokens: positiveInteger(config.max_tokens, 12_288, 16_384, 'max_tokens'),
  });
  return summarizeProjectHealthSnapshot(snapshot);
}

export default fetchProjectHealthSource;
