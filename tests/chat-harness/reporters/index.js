// Chat Quality Reporters v48.0
// ══════════════════════════════════════════════════════════════════════════════
//
// Report generators for test results:
// - JSON (machine-readable)
// - HTML (human-readable dashboard)
// - Console (for CI output)
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ════════════════════════════════════════════════════════════════════════════
// BASE REPORTER
// ════════════════════════════════════════════════════════════════════════════

class BaseReporter {
  constructor(name, options = {}) {
    this.name = name;
    this.outputDir = options.outputDir || __dirname;
  }

  async report(data) {
    throw new Error('report() must be implemented');
  }

  ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// JSON REPORTER
// ════════════════════════════════════════════════════════════════════════════

export class JSONReporter extends BaseReporter {
  constructor(options = {}) {
    super('json', options);
    this.filename = options.filename || 'report.json';
  }

  async report(data) {
    this.ensureDir(this.outputDir);

    const outputPath = path.join(this.outputDir, this.filename);
    const json = JSON.stringify(data, null, 2);

    fs.writeFileSync(outputPath, json);
    console.log(`  📄 JSON report: ${outputPath}`);

    return outputPath;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HTML REPORTER
// ════════════════════════════════════════════════════════════════════════════

export class HTMLReporter extends BaseReporter {
  constructor(options = {}) {
    super('html', options);
    this.filename = options.filename || 'report.html';
  }

  async report(data) {
    this.ensureDir(this.outputDir);

    const html = this.generateHTML(data);
    const outputPath = path.join(this.outputDir, this.filename);

    fs.writeFileSync(outputPath, html);
    console.log(`  📊 HTML report: ${outputPath}`);

    return outputPath;
  }

  generateHTML(data) {
    const { summary, metrics, thresholds, results } = data;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chat Quality Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      color: #333;
      line-height: 1.6;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      border-radius: 10px;
      margin-bottom: 20px;
    }
    h1 { font-size: 2em; margin-bottom: 10px; }
    .timestamp { opacity: 0.8; font-size: 0.9em; }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 20px;
    }
    .card {
      background: white;
      border-radius: 10px;
      padding: 20px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .card h3 { color: #667eea; margin-bottom: 10px; }
    .metric-value {
      font-size: 2em;
      font-weight: bold;
    }
    .pass { color: #22c55e; }
    .fail { color: #ef4444; }
    .threshold-bar {
      height: 8px;
      background: #e5e5e5;
      border-radius: 4px;
      margin-top: 10px;
      overflow: hidden;
    }
    .threshold-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s ease;
    }
    .threshold-fill.pass { background: #22c55e; }
    .threshold-fill.fail { background: #ef4444; }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #e5e5e5;
    }
    th { background: #f9fafb; font-weight: 600; }
    tr:hover { background: #f9fafb; }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.85em;
      font-weight: 500;
    }
    .status-passed { background: #dcfce7; color: #166534; }
    .status-failed { background: #fee2e2; color: #991b1b; }
    .status-repaired { background: #fef3c7; color: #92400e; }
    .section { margin-bottom: 30px; }
    .ci-status {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-size: 1.2em;
      margin-top: 10px;
    }
    .ci-icon { font-size: 1.5em; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🤖 Chat Quality Report</h1>
      <div class="timestamp">Generated: ${data.timestamp}</div>
      <div class="ci-status">
        <span class="ci-icon">${data.ci_pass ? '✅' : '❌'}</span>
        <span>CI Status: ${data.ci_pass ? 'PASSING' : 'FAILING'}</span>
      </div>
    </header>

    <div class="section">
      <div class="summary-grid">
        <div class="card">
          <h3>Total Tests</h3>
          <div class="metric-value">${summary.total}</div>
        </div>
        <div class="card">
          <h3>Passed</h3>
          <div class="metric-value pass">${summary.passed}</div>
        </div>
        <div class="card">
          <h3>Failed</h3>
          <div class="metric-value ${summary.failed > 0 ? 'fail' : ''}">${summary.failed}</div>
        </div>
        <div class="card">
          <h3>Pass Rate</h3>
          <div class="metric-value">${summary.pass_rate}%</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="card">
        <h3>Quality Metrics</h3>
        ${this.generateMetricsHTML(metrics, thresholds)}
      </div>
    </div>

    <div class="section">
      <div class="card">
        <h3>Test Results</h3>
        <table>
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Turns</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${results.map(r => this.generateResultRow(r)).join('')}
          </tbody>
        </table>
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  generateMetricsHTML(metrics, thresholds) {
    const metricNames = {
      coherence: 'Coherence',
      tool_use: 'Tool Use',
      factuality: 'Factuality',
      instruction_following: 'Instruction Following',
    };

    return Object.entries(thresholds).map(([key, data]) => {
      const value = metrics[key] || 0;
      const percentage = (value * 100).toFixed(1);
      const thresholdPct = (data.threshold * 100).toFixed(0);
      const status = data.met ? 'pass' : 'fail';

      return `
        <div style="margin: 15px 0;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
            <span>${metricNames[key] || key}</span>
            <span class="${status}">${percentage}% / ${thresholdPct}%</span>
          </div>
          <div class="threshold-bar">
            <div class="threshold-fill ${status}" style="width: ${Math.min(percentage, 100)}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  generateResultRow(result) {
    const statusClass = result.passed ? 'passed' : (result.status === 'repaired' ? 'repaired' : 'failed');
    const statusText = result.passed ? 'PASSED' : (result.status === 'repaired' ? 'REPAIRED' : 'FAILED');

    return `
      <tr>
        <td>${result.scenario_name || result.scenario_id || 'Unknown'}</td>
        <td>${result.turns?.length || 0}</td>
        <td><span class="status-badge status-${statusClass}">${statusText}</span></td>
      </tr>
    `;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CONSOLE REPORTER
// ════════════════════════════════════════════════════════════════════════════

export class ConsoleReporter extends BaseReporter {
  constructor(options = {}) {
    super('console', options);
    this.verbose = options.verbose || false;
  }

  async report(data) {
    const { summary, metrics, thresholds } = data;

    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│              CHAT QUALITY REPORT                            │');
    console.log('└─────────────────────────────────────────────────────────────┘\n');

    console.log('📊 Summary:');
    console.log(`   Total:   ${summary.total}`);
    console.log(`   Passed:  ${summary.passed} ✅`);
    console.log(`   Failed:  ${summary.failed} ${summary.failed > 0 ? '❌' : ''}`);
    console.log(`   Repaired: ${summary.repaired || 0} 🔧`);
    console.log(`   Pass Rate: ${summary.pass_rate}%\n`);

    console.log('📈 Metrics:');
    for (const [key, data] of Object.entries(thresholds)) {
      const value = (metrics[key] * 100).toFixed(1);
      const threshold = (data.threshold * 100).toFixed(0);
      const status = data.met ? '✅' : '❌';
      console.log(`   ${key}: ${value}% / ${threshold}% ${status}`);
    }

    console.log(`\n🚦 CI Status: ${data.ci_pass ? 'PASS ✅' : 'FAIL ❌'}\n`);

    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CI REPORTER (for GitHub Actions, etc.)
// ════════════════════════════════════════════════════════════════════════════

export class CIReporter extends BaseReporter {
  constructor(options = {}) {
    super('ci', options);
  }

  async report(data) {
    // Output in GitHub Actions format
    if (process.env.GITHUB_ACTIONS) {
      this.reportGitHubActions(data);
    }

    // Output summary for CI
    const summary = data.summary;
    console.log(`::set-output name=total::${summary.total}`);
    console.log(`::set-output name=passed::${summary.passed}`);
    console.log(`::set-output name=failed::${summary.failed}`);
    console.log(`::set-output name=pass_rate::${summary.pass_rate}`);
    console.log(`::set-output name=ci_pass::${data.ci_pass}`);

    return null;
  }

  reportGitHubActions(data) {
    // Create job summary
    const summary = data.summary;

    console.log('::group::Chat Quality Results');
    console.log(`Total: ${summary.total}, Passed: ${summary.passed}, Failed: ${summary.failed}`);
    console.log('::endgroup::');

    // Report failures as annotations
    for (const result of data.results) {
      if (!result.passed) {
        console.log(`::error title=Test Failed::${result.scenario_name || result.scenario_id}`);
      }
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORT ALL REPORTERS
// ════════════════════════════════════════════════════════════════════════════

export const defaultReporters = [
  new JSONReporter(),
  new HTMLReporter(),
  new ConsoleReporter(),
];

export default defaultReporters;
