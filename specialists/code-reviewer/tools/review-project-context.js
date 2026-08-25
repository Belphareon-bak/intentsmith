import { analyzeCode } from './analyze-code.js';
import { securityScan } from './security-scan.js';

const SEVERITY = Object.freeze({ critical: 0, warning: 1, info: 2 });

function fail(message) {
  return { status: 'error', error: message };
}

function languageFor(path) {
  if (/\.py$/iu.test(path)) return 'python';
  if (/\.go$/iu.test(path)) return 'go';
  if (/\.tsx?$/iu.test(path)) return 'typescript';
  if (/\.java$/iu.test(path)) return 'java';
  return 'javascript';
}

function validateParams(params) {
  return Array.isArray(params?.contextItems)
    && params.contextItems.length > 0
    && params.contextItems.every(item => (
      typeof item?.path === 'string'
      && Number.isSafeInteger(item.startLine)
      && typeof item.content === 'string'
      && item.provenance?.path === item.path
    ));
}

function compareFindings(left, right) {
  const severity = (SEVERITY[left.severity] ?? 99) - (SEVERITY[right.severity] ?? 99);
  if (severity !== 0) return severity;
  const path = Buffer.compare(Buffer.from(left.path), Buffer.from(right.path));
  if (path !== 0) return path;
  return (left.line ?? Number.MAX_SAFE_INTEGER) - (right.line ?? Number.MAX_SAFE_INTEGER);
}

function withProvenance(finding, item) {
  return {
    ...finding,
    path: item.path,
    line: Number.isSafeInteger(finding.line)
      ? item.startLine + finding.line - 1
      : null,
    provenance: {
      projectId: item.provenance.projectId,
      workspaceRevision: item.provenance.workspaceRevision,
      path: item.provenance.path,
      contentDigest: item.provenance.contentDigest,
    },
  };
}

export function analyzeProjectContext(params) {
  if (!validateParams(params)) return fail('ProjectContext items are required');
  const findings = [];
  const scores = [];
  for (const item of params.contextItems) {
    const result = analyzeCode({
      code: item.content,
      language: languageFor(item.path),
      focus: params.focus || 'all',
    });
    if (result.status !== 'ok') return result;
    scores.push(result.data.score);
    findings.push(...result.data.findings.map(finding => withProvenance(finding, item)));
  }
  findings.sort(compareFindings);
  const score = scores.length > 0
    ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)
    : 0;
  return {
    status: 'ok',
    data: {
      findings,
      filesReviewed: params.contextItems.map(item => item.path),
      score,
      summary: `${findings.length} finding(s) across ${params.contextItems.length} ProjectContext item(s)`,
      contextSnapshotDigest: params.contextSnapshotDigest,
    },
  };
}

export function securityScanProjectContext(params) {
  if (!validateParams(params)) return fail('ProjectContext items are required');
  const vulnerabilities = [];
  const recommendations = [];
  const recommendationKeys = new Set();
  for (const item of params.contextItems) {
    const result = securityScan({
      code: item.content,
      language: languageFor(item.path),
    });
    if (result.status !== 'ok') return result;
    vulnerabilities.push(...result.data.vulnerabilities.map(finding => withProvenance(finding, item)));
    for (const recommendation of result.data.recommendations) {
      const key = `${recommendation.vulnerability}\0${recommendation.action}`;
      if (!recommendationKeys.has(key)) {
        recommendationKeys.add(key);
        recommendations.push(recommendation);
      }
    }
  }
  vulnerabilities.sort(compareFindings);
  const critical = vulnerabilities.filter(item => item.severity === 'critical').length;
  const warning = vulnerabilities.filter(item => item.severity === 'warning').length;
  const riskLevel = critical >= 3 ? 'critical'
    : critical > 0 ? 'high'
      : warning >= 3 ? 'medium' : 'low';
  return {
    status: 'ok',
    data: {
      vulnerabilities,
      riskLevel,
      recommendations,
      filesReviewed: params.contextItems.map(item => item.path),
      contextSnapshotDigest: params.contextSnapshotDigest,
    },
  };
}
