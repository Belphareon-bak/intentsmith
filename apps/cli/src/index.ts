#!/usr/bin/env node

import { createHttpTransport, runCli } from './cli.js';

export { createCoreTransport, createHttpTransport, runCli, type CliIo, type CliResult, type CliTransport } from './cli.js';

if (import.meta.url === `file://${process.argv[1]}`) {
  const transport = createHttpTransport(process.env.INTENTSMITH_URL ?? 'http://127.0.0.1:47831');

  // Ctrl+C aborts an in-flight generation rather than orphaning it upstream.
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());

  const result = await runCli(process.argv.slice(2), transport, {
    // Only attach stdin when it is piped; an interactive TTY would block.
    stdin: process.stdin.isTTY ? undefined : process.stdin,
    onStreamChunk: chunk => process.stdout.write(chunk),
    signal: controller.signal,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
