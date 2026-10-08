#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  discoverSupportedMigrationVersions,
  restoreStateBackup,
  extractStateBackupArchive,
} from '../src/core/db-backup.js';

function usage() {
  return [
    'Usage: node scripts/restore-state-backup.js --data-dir ABSOLUTE_PATH --backup BACKUP_NAME [--db-path ABSOLUTE_PATH]',
    '       node scripts/restore-state-backup.js --data-dir ABSOLUTE_PATH --backup BACKUP_NAME --extract-archive-to ABSOLUTE_NEW_DIRECTORY',
    '',
    'The IntentSmith server must be stopped. The command validates the complete',
    'V2 manifest, SQLite quick_check and migration compatibility before replacing',
    'the configured database. A pre-restore safety copy is retained.',
    'The explicit --extract-archive-to mode instead retrieves only archived config',
    'and skill JSON bytes into a fresh inactive directory outside installation/data.',
    'Its existing parent must be private (0700), owned by you, without symlinks.',
    'This mode never restores the DB, installs config, or activates skills.',
  ].join('\n');
}

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--help' || key === '-h') return { help: true };
    if (!['--data-dir', '--backup', '--db-path', '--extract-archive-to'].includes(key)) {
      throw new Error(`Unknown argument: ${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    options[key.slice(2)] = value;
    index += 1;
  }
  return options;
}

try {
  const options = parse(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  if (!options['data-dir'] || !path.isAbsolute(options['data-dir'])) {
    throw new Error('--data-dir must be an absolute path');
  }
  if (!options.backup) throw new Error('--backup is required');
  if (options['db-path'] && !path.isAbsolute(options['db-path'])) {
    throw new Error('--db-path must be an absolute path');
  }

  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (options['extract-archive-to']) {
    if (options['db-path']) throw new Error('--db-path cannot be combined with --extract-archive-to');
    const extracted = extractStateBackupArchive(options['data-dir'], options.backup, options['extract-archive-to'], {
      offline: true,
      projectRoot,
      supportedMigrationVersions: discoverSupportedMigrationVersions(projectRoot),
    });
    process.stdout.write(`${JSON.stringify(extracted)}\n`);
    process.exit(0);
  }
  const result = restoreStateBackup(options['data-dir'], options.backup, {
    offline: true,
    silent: true,
    dbPath: options['db-path'],
    projectRoot,
    supportedMigrationVersions: discoverSupportedMigrationVersions(projectRoot),
  });
  process.stdout.write(`${JSON.stringify({
    ok: result.ok,
    backup: result.backupName,
    safetyBackup: result.safetyBackupName,
    migrationCount: result.migrationCount,
    contentFingerprint: result.contentFingerprint,
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error.code || 'DATABASE_RESTORE_INPUT_INVALID',
    error: error.message,
  })}\n`);
  process.exit(1);
}
