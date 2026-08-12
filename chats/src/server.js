import { pathToFileURL } from 'node:url';

const UNSUPPORTED_MESSAGE = 'C3_STANDALONE_CHATS_UNSUPPORTED_NOT_SHIPPED';

const isDirectExecution = typeof process.argv[1] === 'string'
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  process.stderr.write(`${UNSUPPORTED_MESSAGE}\n`);
  process.exitCode = 78;
}
