// Project-scoped filesystem effects for the Studio 2 file tree. The existing
// workspace routes remain available for legacy clients.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const BLOCKED = new Set(['.git', '.intentsmith', 'node_modules', '__pycache__', '.next']);
const REVISION = /^[0-9a-f]{64}$/;

function relativeParts(value) {
  if (typeof value !== 'string' || !value || value.length > 500 || value.startsWith('/') || value.includes('\\'))
    throw Object.assign(Error('Invalid relative path'), { status: 400 });
  const parts = value.split('/');
  if (parts.length > 20 || parts.some(part => !part || part === '.' || part === '..' || part.length > 255
    || /[\x00-\x1f]/.test(part) || BLOCKED.has(part)))
    throw Object.assign(Error('Invalid relative path'), { status: 400 });
  return parts;
}

async function projectRoot(db, projectId) {
  const id = Number(projectId);
  if (!Number.isSafeInteger(id) || id < 1) throw Object.assign(Error('Invalid project ID'), { status: 400 });
  const project = db.projects.findById.get(id);
  if (!project || typeof project.path !== 'string') throw Object.assign(Error('Project not found'), { status: 404 });
  const root = await fs.realpath(project.path);
  if (!(await fs.stat(root)).isDirectory()) throw Object.assign(Error('Project root is not a directory'), { status: 409 });
  return root;
}

async function scopedEntry(root, relative) {
  const parts = relativeParts(relative);
  let parent = root;
  for (const segment of parts.slice(0, -1)) {
    parent = path.join(parent, segment);
    let stat;
    try { stat = await fs.lstat(parent); } catch (error) {
      if (error.code === 'ENOENT') throw Object.assign(Error('Parent directory does not exist'), { status: 404 });
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Object.assign(Error('Path passes through a non-directory or symlink'), { status: 403 });
  }
  const target = path.join(parent, parts.at(-1));
  let stat = null;
  try { stat = await fs.lstat(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (stat?.isSymbolicLink() || stat && !stat.isFile() && !stat.isDirectory())
    throw Object.assign(Error('Symlinks and special files are not supported'), { status: 403 });
  return { target, stat, relative };
}

async function revision(entry) {
  if (!entry.stat) return null;
  const { stat, target } = entry;
  const type = stat.isDirectory() ? 'directory' : 'file';
  const content = type === 'file' ? createHash('sha256').update(await fs.readFile(target)).digest('hex')
    : (await fs.readdir(target)).sort();
  return { type, revision: createHash('sha256').update(JSON.stringify({
    type, dev: String(stat.dev), ino: String(stat.ino), size: stat.size,
    mtimeMs: stat.mtimeMs, content
  })).digest('hex'), size: stat.size };
}

function errorStatus(error) {
  if (error.status) return error.status;
  if (error.code === 'EEXIST') return 409;
  if (error.code === 'ENOTEMPTY') return 409;
  if (error.code === 'ENOENT') return 404;
  if (error.code === 'EACCES' || error.code === 'EPERM') return 403;
  return 500;
}

export function createStudio2WorkspaceRoutes({ db, parseBody, sendJSON, safeError }) {
  return {
    'GET /api/studio2/workspace/entry': async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const root = await projectRoot(db, url.searchParams.get('project_id'));
        const entry = await scopedEntry(root, url.searchParams.get('path'));
        if (!entry.stat) return sendJSON(res, 404, { error: 'Entry not found' });
        sendJSON(res, 200, { projectId: Number(url.searchParams.get('project_id')), path: entry.relative,
          ...await revision(entry) });
      } catch (error) { sendJSON(res, errorStatus(error), safeError(error)); }
    },
    'POST /api/studio2/workspace/operation': async (req, res) => {
      try {
        const body = await parseBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body))
          return sendJSON(res, 400, { error: 'Invalid operation body' });
        const { projectId, op, path: relative, to, expectedRevision } = body;
        if (!['create_file', 'create_directory', 'rename', 'delete'].includes(op))
          return sendJSON(res, 400, { error: 'Unsupported operation' });
        const root = await projectRoot(db, projectId);
        const source = await scopedEntry(root, relative);
        if (op === 'create_file' || op === 'create_directory') {
          if (source.stat) return sendJSON(res, 409, { error: 'Entry already exists' });
          if (op === 'create_file') {
            const file = await fs.open(source.target, 'wx', 0o600);
            await file.close();
          } else await fs.mkdir(source.target);
        } else {
          if (!source.stat) return sendJSON(res, 404, { error: 'Entry not found' });
          if (!REVISION.test(expectedRevision || ''))
            return sendJSON(res, 400, { error: 'Expected entry revision is required' });
          const current = await revision(source);
          if (current.revision !== expectedRevision)
            return sendJSON(res, 409, { error: 'Entry changed since it was opened' });
          if (op === 'rename') {
            if (typeof to !== 'string' || to === relative || source.stat.isDirectory() && to.startsWith(relative + '/'))
              return sendJSON(res, 400, { error: 'Invalid rename destination' });
            const destination = await scopedEntry(root, to);
            if (destination.stat) return sendJSON(res, 409, { error: 'Destination already exists' });
            await fs.rename(source.target, destination.target);
          } else if (source.stat.isDirectory()) await fs.rmdir(source.target);
          else await fs.unlink(source.target);
        }
        sendJSON(res, 200, { ok: true, projectId: Number(projectId), op, path: relative,
          ...(op === 'rename' ? { to } : {}) });
      } catch (error) { sendJSON(res, errorStatus(error), safeError(error)); }
    }
  };
}
