export const version = '2026_09_18_115_intentsmith_setting_names';
export const description = 'Add canonical IntentSmith names without discarding previous settings';

export function up(db) {
  const rows = db.prepare('SELECT id, data FROM user_settings').all();
  const update = db.prepare('UPDATE user_settings SET data = ? WHERE id = ?');
  for (const row of rows) {
    const data = JSON.parse(row.data);
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    let changed = false;
    for (const key of Object.keys(data)) {
      if (!key.startsWith('c3.')) continue;
      const canonical = `intentsmith${key.slice(2)}`;
      if (!Object.hasOwn(data, canonical)) {
        data[canonical] = data[key];
        changed = true;
      }
    }
    if (changed) update.run(JSON.stringify(data), row.id);
  }
}
