// Archive / Restore / Soft-Delete Lifecycle Test
// ==============================================================================
// Tests the full archive lifecycle for projects and conversations in an
// isolated temporary database:
//   active → archived → restored → soft-deleted → hard-deleted
// ==============================================================================

import './helpers/isolated-test-db.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intentsmith-archive-test-'));
process.env.C3_DB_PATH = path.join(testDir, 'archive.sqlite');

const {
  projects,
  conversations,
  messages,
  db,
} = await import('../src/db/database.js');

let passed = 0;
let failed = 0;
const failures = [];

function check(condition, name, detail) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
    failures.push({ name, detail: detail || '' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════

async function run() {
  console.log('══════════════════════════════════════════════════════════════════════');
  console.log('  Archive / Restore / Soft-Delete Lifecycle Test');
  console.log('══════════════════════════════════════════════════════════════════════');

  // ─── Setup: Create test project + conversation + messages ──────────────
  console.log('\n═══ SETUP ══════════════════════════════════════════════════════════════');

  const projPath = path.join(testDir, 'project-under-test');
  const result = projects.create.run('test-archive-project', projPath, 'Archive test project');
  const projectId = Number(result.lastInsertRowid);
  check(projectId > 0, 'Setup.1: project created');

  const sentinelPath = path.join(testDir, 'unrelated-project');
  const sentinelResult = projects.create.run(
    'test-unrelated-project',
    sentinelPath,
    'Must remain untouched',
  );
  const sentinelId = Number(sentinelResult.lastInsertRowid);

  const proj = projects.findById.get(projectId);
  check(proj.status === 'active', 'Setup.2: project status is active');
  check(proj.archived_at === null, 'Setup.3: archived_at is null');
  check(proj.deleted_at === null, 'Setup.4: deleted_at is null');

  const convId = `test-archive-conv-${Date.now()}`;
  conversations.getOrCreate(convId, projectId, 'Archive test conversation');
  messages.addMessage(convId, 'user', 'Test message 1', null, null);
  messages.addMessage(convId, 'assistant', 'Test response 1', null, null);

  const conv = conversations.findById.get(convId);
  check(conv != null, 'Setup.5: conversation created');
  check(conv.state === 'active', 'Setup.6: conversation state is active');

  const msgs = messages.listByConversation.all(convId);
  check(msgs.length === 2, 'Setup.7: 2 messages created');

  // ─── Test: listActive filters correctly ────────────────────────────────
  console.log('\n═══ LIST FILTERING ═════════════════════════════════════════════════════');

  const activeProjects = projects.listActive.all(100);
  check(activeProjects.some(p => p.id === projectId), 'List.1: project in listActive');

  const activeProjectConvs = conversations.listActiveByProject.all(projectId, 100);
  check(activeProjectConvs.some(c => c.id === convId), 'List.2: conversation in project active list');

  const activeGlobalConvs = conversations.listActive.all(100);
  check(!activeGlobalConvs.some(c => c.id === convId),
    'List.3: project conversation excluded from global active list');

  // ─── ARCHIVE project ──────────────────────────────────────────────────
  console.log('\n═══ ARCHIVE ════════════════════════════════════════════════════════════');

  projects.archive.run(projectId);
  const archivedProj = projects.findById.get(projectId);
  check(archivedProj.status === 'archived', 'Archive.1: project status is archived');
  check(archivedProj.archived_at != null, 'Archive.2: archived_at timestamp set');

  // Also archive conversation
  conversations.archive.run(convId);
  const archivedConv = conversations.findById.get(convId);
  check(archivedConv.state === 'archived', 'Archive.3: conversation state is archived');
  check(archivedConv.archived_at != null, 'Archive.4: archived_at timestamp set');

  // Verify filtering
  const activeAfterArchive = projects.listActive.all(100);
  check(!activeAfterArchive.some(p => p.id === projectId), 'Archive.5: project NOT in listActive');

  const archivedList = projects.listArchived.all(100);
  check(archivedList.some(p => p.id === projectId), 'Archive.6: project IN listArchived');

  const notDeletedList = projects.listNotDeleted.all(100);
  check(notDeletedList.some(p => p.id === projectId), 'Archive.7: project IN listNotDeleted');

  const activeProjectConvsAfter = conversations.listActiveByProject.all(projectId, 100);
  check(!activeProjectConvsAfter.some(c => c.id === convId),
    'Archive.8: conversation NOT in project active list');

  const archivedProjectConvs = conversations.findByProject.all(projectId);
  check(archivedProjectConvs.some(c => c.id === convId && c.state === 'archived'),
    'Archive.9: project conversation is archived');

  const archivedGlobalConvs = conversations.listArchived.all(100);
  check(!archivedGlobalConvs.some(c => c.id === convId),
    'Archive.10: project conversation excluded from global archived list');

  // Messages still accessible (read-only)
  const msgsAfterArchive = messages.listByConversation.all(convId);
  check(msgsAfterArchive.length === 2, 'Archive.11: messages still accessible after archive');

  // ─── RESTORE ──────────────────────────────────────────────────────────
  console.log('\n═══ RESTORE ════════════════════════════════════════════════════════════');

  projects.restore.run(projectId);
  const restoredProj = projects.findById.get(projectId);
  check(restoredProj.status === 'active', 'Restore.1: project status back to active');
  check(restoredProj.archived_at === null, 'Restore.2: archived_at cleared');
  check(restoredProj.deleted_at === null, 'Restore.3: deleted_at still null');

  conversations.restore.run(convId);
  const restoredConv = conversations.findById.get(convId);
  check(restoredConv.state === 'active', 'Restore.4: conversation state back to active');
  check(restoredConv.archived_at === null, 'Restore.5: archived_at cleared');

  const activeAfterRestore = projects.listActive.all(100);
  check(activeAfterRestore.some(p => p.id === projectId), 'Restore.6: project back in listActive');

  const activeProjectConvsRestored = conversations.listActiveByProject.all(projectId, 100);
  check(activeProjectConvsRestored.some(c => c.id === convId),
    'Restore.7: conversation back in project active list');

  const msgsAfterRestore = messages.listByConversation.all(convId);
  check(msgsAfterRestore.length === 2, 'Restore.8: messages intact after restore');

  // A lifecycle phase is still a live project and must reserve its name.
  db.prepare(`UPDATE projects SET status = 'SPEC' WHERE id = ?`).run(projectId);
  const conflict = projects.getOrCreate(
    'test-archive-project',
    path.join(testDir, 'conflicting-project'),
    'Must conflict with live lifecycle project',
  );
  check(conflict._nameConflict === true,
    'Restore.9: non-terminal lifecycle status reserves project name');
  db.prepare(`UPDATE projects SET status = 'active' WHERE id = ?`).run(projectId);

  // ─── SOFT DELETE ──────────────────────────────────────────────────────
  console.log('\n═══ SOFT DELETE ═════════════════════════════════════════════════════════');

  projects.softDelete.run(projectId);
  const softDeletedProj = projects.findById.get(projectId);
  check(softDeletedProj.status === 'deleted', 'SoftDel.1: project status is deleted');
  check(softDeletedProj.deleted_at != null, 'SoftDel.2: deleted_at timestamp set');

  conversations.softDelete.run(convId);
  const softDeletedConv = conversations.findById.get(convId);
  check(softDeletedConv.state === 'deleted', 'SoftDel.3: conversation state is deleted');
  check(softDeletedConv.deleted_at != null, 'SoftDel.4: deleted_at timestamp set');

  // Not visible in any non-deleted lists
  const activeAfterSoftDel = projects.listActive.all(100);
  check(!activeAfterSoftDel.some(p => p.id === projectId), 'SoftDel.5: project NOT in listActive');

  const archivedAfterSoftDel = projects.listArchived.all(100);
  check(!archivedAfterSoftDel.some(p => p.id === projectId), 'SoftDel.6: project NOT in listArchived');

  const notDeletedAfterSoftDel = projects.listNotDeleted.all(100);
  check(!notDeletedAfterSoftDel.some(p => p.id === projectId), 'SoftDel.7: project NOT in listNotDeleted');

  // Messages still exist (for potential recovery)
  const msgsAfterSoftDel = messages.listByConversation.all(convId);
  check(msgsAfterSoftDel.length === 2, 'SoftDel.8: messages still exist after soft delete');

  // ─── RESTORE FROM SOFT DELETE ─────────────────────────────────────────
  console.log('\n═══ RESTORE FROM SOFT DELETE ════════════════════════════════════════════');

  projects.restore.run(projectId);
  const restoredFromDel = projects.findById.get(projectId);
  check(restoredFromDel.status === 'active', 'RestoreDel.1: project restored from deleted to active');
  check(restoredFromDel.deleted_at === null, 'RestoreDel.2: deleted_at cleared');

  conversations.restore.run(convId);
  const restoredConvFromDel = conversations.findById.get(convId);
  check(restoredConvFromDel.state === 'active', 'RestoreDel.3: conversation restored to active');

  // ─── HARD DELETE (only after soft-delete) ─────────────────────────────
  console.log('\n═══ HARD DELETE ═════════════════════════════════════════════════════════');

  // Soft delete first
  projects.softDelete.run(projectId);
  conversations.softDelete.run(convId);

  // Hard delete conversation (messages + conversation)
  db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(convId);
  db.prepare('DELETE FROM conversations WHERE id = ?').run(convId);

  const hardDeletedConv = conversations.findById.get(convId);
  check(hardDeletedConv === undefined, 'HardDel.1: conversation permanently deleted');

  const msgsAfterHardDel = messages.listByConversation.all(convId);
  check(msgsAfterHardDel.length === 0, 'HardDel.2: messages permanently deleted');

  // Hard delete project
  projects.delete.run(projectId);
  const hardDeletedProj = projects.findById.get(projectId);
  check(hardDeletedProj === undefined, 'HardDel.3: project permanently deleted');

  // ─── VERIFY UNRELATED FIXTURE UNAFFECTED ───────────────────────────────
  console.log('\n═══ FIXTURE ISOLATION ═══════════════════════════════════════════════════');

  const sentinel = projects.findById.get(sentinelId);
  check(sentinel != null, 'Safety.1: unrelated project still exists');
  check(sentinel?.status === 'active', 'Safety.2: unrelated project remains active');

  const remainingProjects = projects.listNotDeleted.all(100);
  check(remainingProjects.length === 1 && remainingProjects[0].id === sentinelId,
    'Safety.3: only the unrelated fixture remains');

  // ═══ Summary ══════════════════════════════════════════════════════════

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  Archive Lifecycle: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`\n  Failures:`);
    for (const f of failures) {
      console.log(`    ✗ ${f.name}: ${f.detail}`);
    }
  }
  console.log('══════════════════════════════════════════════════════════════════════\n');

  db.close();
  fs.rmSync(testDir, { recursive: true, force: true });
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  try { db.close(); } catch {}
  fs.rmSync(testDir, { recursive: true, force: true });
  process.exit(1);
});
