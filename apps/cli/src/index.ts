#!/usr/bin/env node

import { createHttpTransport, runCli } from './cli.js';

export { createCoreTransport, createHttpTransport, runCli, type CliResult, type CliTransport } from './cli.js';

if (import.meta.url === `file://${process.argv[1]}`) {
  const transport = createHttpTransport(process.env.INTENTSMITH_URL ?? 'http://127.0.0.1:47831');
  const result = await runCli(process.argv.slice(2), transport);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
