'use strict';
// A coherent SQLite backup includes committed WAL data and never migrates the source.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Database = require('better-sqlite3');
async function copyUserData(source, target) {
  if (typeof source !== 'string' || typeof target !== 'string' || !path.isAbsolute(source) || !path.isAbsolute(target)
    || source === target || !fs.statSync(source).isFile() || fs.existsSync(target)) throw Error('Vyber existující zdrojovou DB a novou úplnou cílovou cestu.');
  const database = new Database(source, { readonly: true, fileMustExist: true });
  const temporary = target + '.backup-' + randomUUID();
  try {
    await database.backup(temporary);
    fs.chmodSync(temporary, 0o600);
    const snapshot = new Database(temporary, { readonly: true, fileMustExist: true });
    try {
      if (snapshot.pragma('quick_check', { simple: true }) !== 'ok') throw Error('Kopie databáze neprošla kontrolou.');
    } finally { snapshot.close(); }
    // link fails if another launcher already created the target. Publish only
    // a complete checked backup, without replacing any existing user database.
    fs.linkSync(temporary, target);
    console.log('Uživatelská data byla zkopírována. Původní databáze se nemění; cesty existujících projektů zůstávají skutečné.');
  } finally {
    database.close();
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(temporary + suffix, { force: true });
  }
}
module.exports = { copyUserData };
if (require.main === module) copyUserData(process.argv[2], process.argv[3]).catch(error => { console.error(error.message); process.exitCode = 1; });
