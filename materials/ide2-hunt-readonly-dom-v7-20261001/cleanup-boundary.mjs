// Pure classification at the inner-process boundary, never a process killer.
// Z is deferred to mandatory host-observed complete init namespace teardown.
export function classifyInnerOwnedGroups(rows, ownedGroupIds) {
  const retained = Array.isArray(rows) ? rows.map(row => row && typeof row === 'object' && !Array.isArray(row) ? {...row} : row) : [];
  const groups = Array.isArray(ownedGroupIds) && ownedGroupIds.length > 0
    && ownedGroupIds.every(id => Number.isSafeInteger(id) && id > 0)
    && new Set(ownedGroupIds).size === ownedGroupIds.length ? new Set(ownedGroupIds) : null;
  const zombies = [], live = [], unknown = []; const seen = new Set();
  if (!Array.isArray(rows) || !groups) unknown.push({reason: 'MALFORMED_OWNERSHIP_OBSERVATION'});
  for (const row of retained) {
    const valid = row && typeof row === 'object' && !Array.isArray(row) && Number.isSafeInteger(row.pid) && row.pid > 0
      && Number.isSafeInteger(row.group) && row.group > 0 && groups?.has(row.group)
      && typeof row.state === 'string' && row.state.length === 1 && !row.error && !seen.has(row.pid);
    seen.add(row?.pid);
    if (!valid) unknown.push({...row, reason: 'UNVERIFIED_OWN_PROCESS_ROW'});
    else if (row.state === 'Z') zombies.push({...row});
    else if (/^[RSDTtWKPI]$/.test(row.state)) live.push({...row});
    else unknown.push({...row, reason: 'UNKNOWN_PROCESS_STATE'});
  }
  const readyForNamespaceTeardown = live.length === 0 && unknown.length === 0;
  return {allRows: retained, zombies, live, unknown, readyForNamespaceTeardown,
    status: !readyForNamespaceTeardown ? 'FAIL' : zombies.length ? 'ZOMBIES_DEFERRED_TO_INIT_TEARDOWN' : 'INNER_GROUPS_EMPTY',
    requiresHostNamespaceAfterZero: true};
}
