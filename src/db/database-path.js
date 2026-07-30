export const MISSING_DATABASE_PATH_MESSAGE =
  'C3_DB_PATH must be set before importing src/db/database.js';

export function requireConfiguredDatabasePath(configuredPath) {
  if (typeof configuredPath !== 'string' || configuredPath.trim() === '') {
    throw new Error(MISSING_DATABASE_PATH_MESSAGE);
  }

  return configuredPath.trim();
}
