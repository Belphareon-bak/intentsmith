/**
 * C3 Backend — Sprint 4 Integration
 * Uses only Node.js built-in modules (no external dependencies).
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const crypto = require('crypto');

async function ensureDir(d) { await fs.promises.mkdir(d, { recursive: true }); }
async function pathExists(p) { try { await fs.promises.access(p); return true; } catch { return false; } }
async function readJson(p) { return JSON.parse(await fs.promises.readFile(p, 'utf-8')); }
async function removeFile(p) { await fs.promises.rm(p, { recursive: true, force: true }); }

class DiffService {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.pendingDir = path.join(projectPath, '.c3', 'pending-diffs');
    this.changesetPath = path.join(this.pendingDir, 'changeset.json');
  }
  async createChangeSet(label, proposals, context) {
    await ensureDir(this.pendingDir);
    const fullProposals = [];
    for (const raw of proposals) {
      const id = crypto.randomBytes(8).toString('hex');
      const safeName = raw.filePath.replace(/[/\\]/g, '_');
      const patchPath = path.join('.c3', 'pending-diffs', safeName + '.patch');
      await atomicWrite(path.join(this.projectPath, patchPath), raw.diff);
      if (raw.modifiedContent) {
        await atomicWrite(path.join(this.pendingDir, safeName + '.mod'), raw.modifiedContent);
      }
      fullProposals.push({
        id, filePath: raw.filePath, description: raw.description, diff: raw.diff,
        patchPath, stats: raw.stats || parseDiffStats(raw.diff), status: 'pending',
        modifiedContent: raw.modifiedContent || null,
      });
    }
    const changeSet = {
      id: crypto.randomBytes(8).toString('hex'), label, proposals: fullProposals,
      status: 'pending', createdAt: new Date().toISOString(), context,
    };
    await atomicWriteJson(this.changesetPath, changeSet);
    return changeSet;
  }
  async loadChangeSet() {
    if (!await pathExists(this.changesetPath)) return null;
    try {
      const data = await readJson(this.changesetPath);
      for (const p of data.proposals) {
        const patchFull = path.join(this.projectPath, p.patchPath);
        if (await pathExists(patchFull)) p.diff = await fs.promises.readFile(patchFull, 'utf-8');
        const modPath = path.join(this.pendingDir, p.filePath.replace(/[/\\]/g, '_') + '.mod');
        if (await pathExists(modPath)) p.modifiedContent = await fs.promises.readFile(modPath, 'utf-8');
      }
      return data;
    } catch { return null; }
  }
  async updateProposalStatus(proposalId, status, editedContent) {
    const cs = await this.loadChangeSet();
    if (!cs) throw new Error('No active change set');
    const proposal = cs.proposals.find(p => p.id === proposalId);
    if (!proposal) throw new Error('Proposal not found: ' + proposalId);
    proposal.status = status;
    if (status === 'edited' && editedContent) {
      proposal.modifiedContent = editedContent;
      const safeName = proposal.filePath.replace(/[/\\]/g, '_');
      await atomicWrite(path.join(this.pendingDir, safeName + '.mod'), editedContent);
    }
    cs.status = calculateSetStatus(cs.proposals);
    await atomicWriteJson(this.changesetPath, cs);
    return cs;
  }
  async applyAccepted() {
    const cs = await this.loadChangeSet();
    if (!cs) throw new Error('No active change set');
    const result = { applied: 0, rejected: 0, edited: 0, writtenFiles: [] };
    for (const p of cs.proposals) {
      if (p.status === 'rejected') { result.rejected++; continue; }
      if (p.status !== 'accepted' && p.status !== 'edited') continue;
      const targetPath = path.join(this.projectPath, p.filePath);
      if (p.stats && p.stats.isDelete) {
        if (await pathExists(targetPath)) { await removeFile(targetPath); result.writtenFiles.push(p.filePath); result.applied++; }
        continue;
      }
      let content;
      if (p.modifiedContent) { content = p.modifiedContent; if (p.status === 'edited') result.edited++; else result.applied++; }
      else {
        const original = await pathExists(targetPath) ? await fs.promises.readFile(targetPath, 'utf-8') : '';
        content = applyUnifiedDiff(original, p.diff); result.applied++;
      }
      await ensureDir(path.dirname(targetPath));
      await atomicWrite(targetPath, content);
      result.writtenFiles.push(p.filePath);
    }
    cs.status = 'applied';
    await atomicWriteJson(this.changesetPath, cs);
    return result;
  }
  async rejectAll() {
    const cs = await this.loadChangeSet();
    if (!cs) return;
    for (const p of cs.proposals) p.status = 'rejected';
    cs.status = 'all_rejected';
    await atomicWriteJson(this.changesetPath, cs);
  }
}

class GitService {
  constructor(projectPath) { this.projectPath = projectPath; }
  async isGitRepo() { try { const r = await this.git(['rev-parse', '--is-inside-work-tree']); return r.stdout.trim() === 'true'; } catch { return false; } }
  async isClean() { try { const r = await this.git(['status', '--porcelain']); return r.stdout.trim() === ''; } catch { return true; } }
  async getCurrentBranch() { const r = await this.git(['branch', '--show-current']); return r.stdout.trim() || 'HEAD'; }
  async createSprintBranch(n) {
    const branch = 'c3/sprint-' + n;
    try { await this.git(['rev-parse', '--verify', branch]); await this.git(['checkout', branch]); }
    catch { await this.git(['checkout', '-b', branch]); }
    return branch;
  }
  async autoCommit(files, ctx) {
    try {
      for (const f of files) await this.git(['add', f]);
      const subject = ctx.subject || 'feat: C3 Sprint ' + ctx.sprintNumber + ' changes';
      const body = ['', 'C3 Agent — Sprint ' + ctx.sprintNumber + ', Step ' + ctx.stepNumber, '',
        ...(ctx.details || []).map(d => '- ' + d), '', 'Intent: ' + ctx.intent, 'Project: ' + ctx.projectName].join('\n');
      await this.git(['commit', '-m', subject + '\n' + body, '--no-verify']);
      const h = await this.git(['rev-parse', '--short', 'HEAD']);
      return { success: true, hash: h.stdout.trim() };
    } catch (e) { return { success: false, error: e.message }; }
  }
  git(args) {
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, { cwd: this.projectPath, shell: false, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
      let stdout = '', stderr = '';
      child.stdout.on('data', c => { stdout += c.toString(); });
      child.stderr.on('data', c => { stderr += c.toString(); });
      child.on('close', code => { if (code === 0) resolve({ stdout, stderr, exitCode: code }); else reject(new Error('git ' + args[0] + ' failed (exit ' + code + '): ' + stderr)); });
      child.on('error', err => reject(err));
    });
  }
}

class ReviewPipeline {
  constructor(projectPath, projectStore, auditTrail) {
    this.diffService = new DiffService(projectPath);
    this.gitService = new GitService(projectPath);
    this.projectStore = projectStore;
    this.auditTrail = auditTrail;
  }
  async submitChanges(turnId, label, proposals, context) {
    const cs = await this.diffService.createChangeSet(label, proposals, context);
    if (this.projectStore) await this.projectStore.updatePhase('pending_review');
    if (this.auditTrail) this.auditTrail.log(turnId, 'change_set_created', { changeSetId: cs.id, label, fileCount: proposals.length });
    return cs;
  }
  async applyAndCommit(turnId, context) {
    const r = await this.diffService.applyAccepted();
    if (r.writtenFiles.length > 0 && await this.gitService.isGitRepo()) {
      const cur = await this.gitService.getCurrentBranch();
      if (!cur.startsWith('c3/')) await this.gitService.createSprintBranch(context.sprintNumber);
      const commit = await this.gitService.autoCommit(r.writtenFiles, context);
      if (commit.success) r.commitHash = commit.hash;
    }
    if (this.projectStore) await this.projectStore.updatePhase('build');
    return r;
  }
  async rehydrate() {
    const cs = await this.diffService.loadChangeSet();
    if (!cs || cs.status === 'applied' || cs.status === 'all_rejected') return { hasPendingReview: false, changeSet: null };
    return { hasPendingReview: true, changeSet: cs };
  }
}

function parseDiffStats(diff) {
  let additions = 0, deletions = 0, isNew = false, isDelete = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    else if (line.startsWith('--- /dev/null')) isNew = true;
    else if (line.startsWith('+++ /dev/null')) isDelete = true;
  }
  return { additions, deletions, isNew, isDelete };
}
function calculateSetStatus(proposals) {
  if (proposals.every(p => p.status === 'pending')) return 'pending';
  if (proposals.some(p => p.status === 'pending')) return 'pending';
  if (proposals.every(p => p.status === 'rejected')) return 'all_rejected';
  if (proposals.every(p => p.status === 'accepted' || p.status === 'edited')) return 'all_accepted';
  return 'reviewed';
}
function applyUnifiedDiff(original, diff) {
  const diffLines = diff.split('\n'), origLines = original.split('\n'), result = [];
  let origIdx = 0, i = 0;
  while (i < diffLines.length && !diffLines[i].startsWith('@@')) i++;
  while (i < diffLines.length) {
    const line = diffLines[i];
    if (line.startsWith('@@')) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/);
      if (m) { const s = parseInt(m[1], 10) - 1; while (origIdx < s && origIdx < origLines.length) result.push(origLines[origIdx++]); }
      i++;
    } else if (line.startsWith('-')) { origIdx++; i++; }
    else if (line.startsWith('+')) { result.push(line.slice(1)); i++; }
    else { if (origIdx < origLines.length) result.push(origLines[origIdx++]); i++; }
  }
  while (origIdx < origLines.length) result.push(origLines[origIdx++]);
  return result.join('\n');
}
async function atomicWrite(filePath, content) {
  const tmp = filePath + '.tmp';
  await ensureDir(path.dirname(filePath));
  const handle = await fs.promises.open(tmp, 'w');
  try { await handle.writeFile(content, 'utf-8'); await handle.sync(); } finally { await handle.close(); }
  await fs.promises.rename(tmp, filePath);
}
async function atomicWriteJson(filePath, data) { await atomicWrite(filePath, JSON.stringify(data, null, 2) + '\n'); }

module.exports = { DiffService, GitService, ReviewPipeline, parseDiffStats, calculateSetStatus, applyUnifiedDiff, atomicWrite, atomicWriteJson };
