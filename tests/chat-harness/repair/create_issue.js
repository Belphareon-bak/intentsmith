// CI Issue Creator v48.0
// ══════════════════════════════════════════════════════════════════════════════
//
// Automatically creates issues for test failures in CI:
// - GitHub Issues integration
// - Structured failure reports
// - Deduplication to prevent spam
//
// ══════════════════════════════════════════════════════════════════════════════

import { createHash } from 'crypto';

// ════════════════════════════════════════════════════════════════════════════
// ISSUE TEMPLATES
// ════════════════════════════════════════════════════════════════════════════

const ISSUE_TEMPLATES = {
  test_failure: {
    title: '[Chat Quality] Test Failure: {{scenario_name}}',
    labels: ['bug', 'chat-quality', 'automated'],
    body: `## Test Failure Report

**Scenario:** {{scenario_name}} (\`{{scenario_id}}\`)
**Run ID:** {{run_id}}
**Timestamp:** {{timestamp}}

### Failure Summary

| Metric | Score | Threshold | Status |
|--------|-------|-----------|--------|
{{#metrics}}
| {{name}} | {{score}} | {{threshold}} | {{status}} |
{{/metrics}}

### Failed Turns

{{#failed_turns}}
#### Turn {{index}}
- **User Input:** {{user_input}}
- **Expected:** {{expected}}
- **Actual:** {{actual}}
- **Error:** {{error}}
{{/failed_turns}}

### Repair Attempts

{{#repair_attempts}}
- **Strategy:** {{strategy}}
- **Result:** {{result}}
{{/repair_attempts}}

---
*This issue was automatically created by the Chat Quality CI gate.*
`,
  },

  threshold_breach: {
    title: '[Chat Quality] Threshold Breach: {{metric_name}}',
    labels: ['quality', 'chat-quality', 'automated'],
    body: `## Quality Threshold Breach

**Metric:** {{metric_name}}
**Current Value:** {{current_value}}%
**Threshold:** {{threshold}}%
**Delta:** {{delta}}%

### Affected Scenarios

{{#scenarios}}
- {{name}}: {{score}}%
{{/scenarios}}

### Trend

{{trend_summary}}

---
*This issue was automatically created by the Chat Quality CI gate.*
`,
  },
};

// ════════════════════════════════════════════════════════════════════════════
// ISSUE CREATOR CLASS
// ════════════════════════════════════════════════════════════════════════════

export class IssueCreator {
  constructor(options = {}) {
    this.enabled = options.enabled ?? process.env.CREATE_ISSUES === 'true';
    this.repoOwner = options.repoOwner || process.env.GITHUB_REPOSITORY_OWNER;
    this.repoName = options.repoName || process.env.GITHUB_REPOSITORY?.split('/')[1];
    this.token = options.token || process.env.GITHUB_TOKEN;
    this.dryRun = options.dryRun ?? !this.token;

    // Deduplication
    this.issuedHashes = new Set();
    this.maxIssuesPerRun = options.maxIssuesPerRun || 5;
  }

  /**
   * Create issues from test report
   */
  async createFromReport(report) {
    if (!this.enabled) {
      console.log('  ℹ️  Issue creation disabled');
      return [];
    }

    const issues = [];
    let created = 0;

    // Create issues for failed scenarios
    for (const result of report.results) {
      if (!result.passed && created < this.maxIssuesPerRun) {
        const issue = await this.createTestFailureIssue(result, report);
        if (issue) {
          issues.push(issue);
          created++;
        }
      }
    }

    // Create issues for threshold breaches
    for (const [metric, data] of Object.entries(report.thresholds)) {
      if (!data.met && created < this.maxIssuesPerRun) {
        const issue = await this.createThresholdIssue(metric, data, report);
        if (issue) {
          issues.push(issue);
          created++;
        }
      }
    }

    return issues;
  }

  /**
   * Create a test failure issue
   */
  async createTestFailureIssue(result, report) {
    const hash = this.hashIssue('failure', result.scenario_id);

    if (this.issuedHashes.has(hash)) {
      return null; // Duplicate
    }

    const template = ISSUE_TEMPLATES.test_failure;
    const title = this.render(template.title, {
      scenario_name: result.scenario_name || result.scenario_id,
    });

    const body = this.render(template.body, {
      scenario_name: result.scenario_name || result.scenario_id,
      scenario_id: result.scenario_id,
      run_id: process.env.GITHUB_RUN_ID || 'local',
      timestamp: report.timestamp,
      metrics: this.formatMetrics(result.metrics || {}),
      failed_turns: this.formatFailedTurns(result.turns || []),
      repair_attempts: report.repair_attempts
        ?.filter(r => r.scenario_id === result.scenario_id)
        .map(r => ({ strategy: r.strategy, result: r.success ? 'Success' : 'Failed' })) || [],
    });

    const issue = {
      title,
      body,
      labels: template.labels,
      hash,
    };

    this.issuedHashes.add(hash);

    if (this.dryRun) {
      console.log(`  📝 [DRY RUN] Would create issue: ${title}`);
      return issue;
    }

    return this.postIssue(issue);
  }

  /**
   * Create a threshold breach issue
   */
  async createThresholdIssue(metric, data, report) {
    const hash = this.hashIssue('threshold', metric);

    if (this.issuedHashes.has(hash)) {
      return null;
    }

    const template = ISSUE_TEMPLATES.threshold_breach;
    const currentValue = (report.metrics[metric] * 100).toFixed(1);
    const threshold = (data.threshold * 100).toFixed(0);
    const delta = (currentValue - threshold).toFixed(1);

    const title = this.render(template.title, {
      metric_name: this.formatMetricName(metric),
    });

    const body = this.render(template.body, {
      metric_name: this.formatMetricName(metric),
      current_value: currentValue,
      threshold,
      delta,
      scenarios: report.results
        .filter(r => !r.passed)
        .map(r => ({
          name: r.scenario_name || r.scenario_id,
          score: r.metrics?.[metric]?.sum || 0,
        })),
      trend_summary: 'See CI history for trend data.',
    });

    const issue = {
      title,
      body,
      labels: template.labels,
      hash,
    };

    this.issuedHashes.add(hash);

    if (this.dryRun) {
      console.log(`  📝 [DRY RUN] Would create issue: ${title}`);
      return issue;
    }

    return this.postIssue(issue);
  }

  /**
   * Post issue to GitHub
   */
  async postIssue(issue) {
    const url = `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/issues`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `token ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: issue.title,
          body: issue.body,
          labels: issue.labels,
        }),
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const data = await response.json();
      console.log(`  ✅ Created issue #${data.number}: ${issue.title}`);

      return {
        ...issue,
        number: data.number,
        url: data.html_url,
      };

    } catch (error) {
      console.error(`  ❌ Failed to create issue: ${error.message}`);
      return null;
    }
  }

  /**
   * Simple template rendering
   */
  render(template, data) {
    let result = template;

    // Simple key replacement
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string' || typeof value === 'number') {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }
    }

    // Handle arrays (simple)
    const arrayMatches = result.matchAll(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/(\\w+)\}\}/g);
    for (const match of arrayMatches) {
      const [full, key, content] = match;
      const arr = data[key];

      if (Array.isArray(arr)) {
        const rendered = arr.map(item => {
          let itemContent = content;
          for (const [k, v] of Object.entries(item)) {
            itemContent = itemContent.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
          }
          return itemContent;
        }).join('\n');
        result = result.replace(full, rendered);
      } else {
        result = result.replace(full, '');
      }
    }

    return result;
  }

  /**
   * Hash for deduplication
   */
  hashIssue(type, id) {
    const date = new Date().toISOString().split('T')[0];
    return createHash('sha256').update(`${type}:${id}:${date}`).digest('hex').slice(0, 8);
  }

  /**
   * Format metric name
   */
  formatMetricName(metric) {
    return metric.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  /**
   * Format metrics for issue body
   */
  formatMetrics(metrics) {
    return Object.entries(metrics).map(([name, data]) => ({
      name: this.formatMetricName(name),
      score: data.count > 0 ? (data.sum / data.count * 100).toFixed(1) + '%' : 'N/A',
      threshold: '90%',
      status: data.sum / data.count >= 0.9 ? '✅' : '❌',
    }));
  }

  /**
   * Format failed turns for issue body
   */
  formatFailedTurns(turns) {
    return turns
      .filter(t => !t.passed)
      .map((t, i) => ({
        index: i + 1,
        user_input: t.user_input?.substring(0, 100) || 'N/A',
        expected: t.expected?.substring(0, 100) || 'N/A',
        actual: t.assistant_response?.substring(0, 100) || 'N/A',
        error: t.error || 'Evaluation failed',
      }));
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CI GATE INTEGRATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * CI gate that fails/passes based on quality thresholds
 */
export class CIGate {
  constructor(options = {}) {
    this.issueCreator = new IssueCreator(options);
    this.failOnThresholdBreach = options.failOnThresholdBreach ?? true;
    this.failOnTestFailure = options.failOnTestFailure ?? true;
  }

  /**
   * Evaluate report and determine CI pass/fail
   */
  async evaluate(report) {
    const result = {
      pass: true,
      reasons: [],
      issues: [],
    };

    // Check thresholds
    if (this.failOnThresholdBreach) {
      for (const [metric, data] of Object.entries(report.thresholds)) {
        if (!data.met) {
          result.pass = false;
          result.reasons.push(`Threshold breach: ${metric}`);
        }
      }
    }

    // Check test failures
    if (this.failOnTestFailure) {
      const failures = report.results.filter(r => !r.passed);
      if (failures.length > 0) {
        result.pass = false;
        result.reasons.push(`${failures.length} test(s) failed`);
      }
    }

    // Create issues for failures
    if (!result.pass) {
      result.issues = await this.issueCreator.createFromReport(report);
    }

    return result;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  IssueCreator,
  CIGate,
  ISSUE_TEMPLATES,
};
