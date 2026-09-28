// Code Reviewer — Security Scan Tool
// ══════════════════════════════════════════════════════════════════════════════
//
// Pure deterministic tool: takes code + language → returns structured
// vulnerability findings with risk level and recommendations.
//
// Pattern-based detection — no LLM, no side effects, no external calls.
//
// Detects:
//   - SQL injection (string concat in queries)
//   - XSS (innerHTML, dangerouslySetInnerHTML)
//   - Command injection (exec/execSync with string concat)
//   - Path traversal (../ in file operations)
//   - Hardcoded secrets (password=, apiKey=, token= in strings)
//   - Insecure crypto (md5, sha1)
//   - eval() usage
//
// ══════════════════════════════════════════════════════════════════════════════

// ─── Vulnerability Patterns ─────────────────────────────────────────────────

const VULN_PATTERNS = [
  // ── SQL Injection ──────────────────────────────────────────────────────
  {
    id: 'SQL_INJECTION',
    name: 'SQL Injection',
    severity: 'critical',
    patterns: [
      /(?:query|execute|exec|run)\s*\(\s*['"`](?:SELECT|INSERT|UPDATE|DELETE|DROP)\b[^'"`]*\$\{/i,
      /(?:query|execute|exec|run)\s*\(\s*['"`](?:SELECT|INSERT|UPDATE|DELETE|DROP)\b[^'"`]*['"]\s*\+/i,
      /(?:query|execute|exec|run)\s*\(\s*[`](?:SELECT|INSERT|UPDATE|DELETE|DROP)\b.*\$\{/i,
      /['"`](?:SELECT|INSERT|UPDATE|DELETE)\s+.*['"]\s*\+\s*(?:req\.|params\.|query\.|body\.|input|user)/i,
      /f['"](?:SELECT|INSERT|UPDATE|DELETE)\s+.*\{.*\}/i, // Python f-strings
      /\.format\s*\(.*\).*(?:SELECT|INSERT|UPDATE|DELETE)/i,
    ],
    recommendation: 'Use parameterized queries / prepared statements. Never concatenate user input into SQL strings.',
  },

  // ── XSS ────────────────────────────────────────────────────────────────
  {
    id: 'XSS',
    name: 'Cross-Site Scripting (XSS)',
    severity: 'critical',
    patterns: [
      /\.innerHTML\s*=\s*(?!['"`]\s*['"`])/,
      /\.innerHTML\s*\+=/,
      /dangerouslySetInnerHTML/,
      /\.outerHTML\s*=/,
      /document\.write\s*\(/,
      /document\.writeln\s*\(/,
      /\.insertAdjacentHTML\s*\(/,
    ],
    recommendation: 'Use textContent/innerText for text, or sanitize HTML with DOMPurify. Avoid dangerouslySetInnerHTML unless content is trusted and sanitized.',
  },

  // ── Command Injection ──────────────────────────────────────────────────
  {
    id: 'COMMAND_INJECTION',
    name: 'Command Injection',
    severity: 'critical',
    patterns: [
      /(?:exec|execSync|spawn|spawnSync)\s*\(\s*['"`].*\$\{/,
      /(?:exec|execSync)\s*\(\s*[^,)]*\+\s*(?:req\.|params\.|input|user|arg)/i,
      /(?:exec|execSync)\s*\(\s*`[^`]*\$\{/,
      /child_process.*(?:exec|spawn)\s*\(\s*[^,)]*\+/,
      /os\.system\s*\(\s*(?:f['"]|.*\+|.*\.format|.*%\s*\()/,  // Python
      /subprocess\.(?:call|run|Popen)\s*\(\s*(?:f['"]|.*\+|.*\.format)/,  // Python
      /exec\.Command\s*\(\s*.*\+/,  // Go
    ],
    recommendation: 'Use execFile/spawn with argument arrays instead of shell strings. Never pass user input to exec(). Validate and sanitize all inputs.',
  },

  // ── Path Traversal ────────────────────────────────────────────────────
  {
    id: 'PATH_TRAVERSAL',
    name: 'Path Traversal',
    severity: 'critical',
    patterns: [
      /(?:readFile|writeFile|createReadStream|createWriteStream|readFileSync|writeFileSync|open)\s*\(\s*(?:req\.|params\.|input|user|query)/i,
      /(?:readFile|writeFile|readFileSync|writeFileSync|open)\s*\(\s*[^,)]*\+\s*(?:req\.|params\.|input|user)/i,
      /path\.join\s*\([^)]*(?:req\.|params\.|input|user|query)/i,
      /\.\.\/.*(?:readFile|open|require|import)/i,
      /os\.path\.join\s*\([^)]*(?:request\.|input|user)/i,  // Python
    ],
    recommendation: 'Validate and sanitize file paths. Use path.resolve() and check that the resolved path is within the expected directory. Reject paths containing "..".',
  },

  // ── Hardcoded Secrets ─────────────────────────────────────────────────
  {
    id: 'HARDCODED_SECRET',
    name: 'Hardcoded Secret',
    severity: 'critical',
    patterns: [
      /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{3,}['"]/i,
      /(?:apiKey|api_key|apikey)\s*[:=]\s*['"][^'"]{8,}['"]/i,
      /(?:token|secret|secretKey|secret_key)\s*[:=]\s*['"][^'"]{8,}['"]/i,
      /(?:access_key|accessKey)\s*[:=]\s*['"][A-Za-z0-9+/=]{16,}['"]/i,
      /(?:private_key|privateKey)\s*[:=]\s*['"][^'"]{20,}['"]/i,
      /(?:AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/,  // AWS access key
      /Bearer\s+[A-Za-z0-9\-._~+/]+=*/,  // Bearer tokens
    ],
    recommendation: 'Never hardcode secrets in source code. Use environment variables, secret managers (Vault, AWS Secrets Manager), or .env files (excluded from VCS).',
  },

  // ── Insecure Crypto ───────────────────────────────────────────────────
  {
    id: 'INSECURE_CRYPTO',
    name: 'Insecure Cryptography',
    severity: 'warning',
    patterns: [
      /createHash\s*\(\s*['"]md5['"]\s*\)/i,
      /createHash\s*\(\s*['"]sha1['"]\s*\)/i,
      /hashlib\.md5\s*\(/i,  // Python
      /hashlib\.sha1\s*\(/i, // Python
      /\bMD5\s*\(/,
      /\bSHA1\s*\(/,
      /crypto\.createCipher\b/,  // Deprecated, no IV
      /DES|3DES|RC4|Blowfish/i,
    ],
    recommendation: 'Use SHA-256 or SHA-3 for hashing, AES-256-GCM for encryption. MD5 and SHA-1 are cryptographically broken. Use createCipheriv instead of createCipher.',
  },

  // ── eval() Usage ──────────────────────────────────────────────────────
  {
    id: 'EVAL_USAGE',
    name: 'Dynamic Code Execution',
    severity: 'critical',
    patterns: [
      /\beval\s*\(/,
      /new\s+Function\s*\(\s*[^)]*(?:req\.|params\.|input|user)/i,
      /setTimeout\s*\(\s*['"`][^'"]*['"`]/,
      /setInterval\s*\(\s*['"`][^'"]*['"`]/,
      /\bexec\s*\(\s*['"].*\bimport\b/,  // Python exec with imports
    ],
    recommendation: 'Avoid eval() and new Function() with dynamic input. Use JSON.parse() for data, or a sandboxed execution environment if code execution is necessary.',
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function splitLines(code) {
  return code.split(/\r?\n/);
}

/**
 * Check if a line is inside a comment.
 */
function isCommentLine(line) {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('"""') ||
    trimmed.startsWith("'''")
  );
}

// ─── Risk Level Calculation ─────────────────────────────────────────────────

function calculateRiskLevel(vulnerabilities) {
  if (vulnerabilities.length === 0) return 'low';

  const criticalCount = vulnerabilities.filter(v => v.severity === 'critical').length;
  const warningCount = vulnerabilities.filter(v => v.severity === 'warning').length;

  if (criticalCount >= 3) return 'critical';
  if (criticalCount >= 1) return 'high';
  if (warningCount >= 3) return 'medium';
  return 'low';
}

// ─── Build Recommendations ──────────────────────────────────────────────────

function buildRecommendations(vulnerabilities) {
  const seen = new Set();
  const recommendations = [];

  for (const v of vulnerabilities) {
    if (!seen.has(v.id)) {
      seen.add(v.id);
      recommendations.push({
        vulnerability: v.name,
        action: v.recommendation,
      });
    }
  }

  // Always include general recommendations
  if (vulnerabilities.length > 0) {
    recommendations.push({
      vulnerability: 'General',
      action: 'Consider adding automated security scanning (SAST/DAST) to your CI/CD pipeline.',
    });
  }

  return recommendations;
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Scan code for security vulnerabilities.
 *
 * @param {Object} params
 * @param {string} params.code      - Source code to scan
 * @param {string} [params.language='javascript'] - Language hint (javascript, python, go, java, typescript)
 * @returns {{ status: string, data: { vulnerabilities: Array, riskLevel: string, recommendations: Array } }}
 */
export function securityScan(params) {
  const code = params?.code;
  if (!code || typeof code !== 'string') {
    return { status: 'error', error: 'code is required (string)' };
  }

  const language = (params.language || 'javascript').toLowerCase();
  const lines = splitLines(code);
  const vulnerabilities = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip comment lines
    if (isCommentLine(line)) continue;

    for (const vulnDef of VULN_PATTERNS) {
      for (const pattern of vulnDef.patterns) {
        if (pattern.test(line)) {
          vulnerabilities.push({
            id: vulnDef.id,
            name: vulnDef.name,
            severity: vulnDef.severity,
            line: i + 1,
            snippet: line.trim().substring(0, 120),
            recommendation: vulnDef.recommendation,
          });
          // Only one match per pattern group per line
          break;
        }
      }
    }
  }

  const riskLevel = calculateRiskLevel(vulnerabilities);
  const recommendations = buildRecommendations(vulnerabilities);

  return {
    status: 'ok',
    data: {
      vulnerabilities,
      riskLevel,
      recommendations,
    },
  };
}
