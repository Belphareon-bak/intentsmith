// Direct-run safety for database-backed tests.
// The audit runner may provide C3_DB_PATH together with its explicit marker.
// Every direct invocation overrides even an inherited application DB path with
// a private disposable database before any application DB module is evaluated.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const hasAuditRunnerDb = process.env.C3_AUDIT_RUN === '1' && process.env.C3_DB_PATH;

if (!hasAuditRunnerDb) {
  process.umask(0o077);
  const testDbRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'c3-test-db-'));
  process.env.C3_DB_PATH = path.join(testDbRoot, 'c3.sqlite');

  process.on('exit', exitCode => {
    if (exitCode === 0 && process.env.KEEP_TEST_DB !== '1') {
      try {
        fs.rmSync(testDbRoot, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup of a test-owned temporary directory.
      }
    } else {
      process.stderr.write(`Isolated test DB preserved: ${testDbRoot}\n`);
    }
  });
}
