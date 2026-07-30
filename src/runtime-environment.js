// Runtime entry-point environment.
//
// The database module deliberately has no implicit path fallback: importing it
// without an explicit C3_DB_PATH must fail before it can touch operator data.
// Product entry points import this module first so the normal local runtime
// keeps its project-local default after dotenv has had a chance to override it.

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(sourceDirectory, '..');

if (!process.env.C3_DB_PATH?.trim()) {
  process.env.C3_DB_PATH = path.join(projectRoot, 'data', 'c3.db');
}
