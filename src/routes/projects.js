// H9: Projects, Workspace & Attachments routes
export function createProjectRoutes(deps) {
  const { db, parseBody, sendJSON, safeError, safeParseInt, sendStaticFile, logger, path } = deps;

  return {
    // ══════════════════════════════════════════════════════════════════════════
    // Legacy routes (non-API)
    // ══════════════════════════════════════════════════════════════════════════

    'GET /projects': (req, res) => {
      const projects = db.projects.list.all(50);
      sendJSON(res, 200, { projects });
    },

    'POST /projects': async (req, res) => {
      const body = await parseBody(req);
      const { name, path: projPath, description } = body;

      if (!name || !projPath) {
        return sendJSON(res, 400, { error: 'name and path are required' });
      }

      const project = db.projects.getOrCreate(name, projPath, description || '');
      sendJSON(res, 200, { project });
    },

    // ══════════════════════════════════════════════════════════════════════════
    // Projects CRUD
    // ══════════════════════════════════════════════════════════════════════════

    'GET /api/projects': async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const limit = parseInt(url.searchParams.get('limit')) || 10;

      try {
        const projects = db.projects.listRecent.all(limit);
        sendJSON(res, 200, { projects });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    'POST /api/projects': async (req, res) => {
      const body = await parseBody(req);
      const { name, description } = body;

      if (!name) {
        return sendJSON(res, 400, { error: 'name is required' });
      }

      try {
        const fs = await import('fs/promises');
        const pathModule = await import('path');

        // Create project directory
        const projectsDir = pathModule.join(process.cwd(), 'projects');
        await fs.mkdir(projectsDir, { recursive: true });

        const projectPath = pathModule.join(projectsDir, name.replace(/[^a-zA-Z0-9-_]/g, '-'));
        await fs.mkdir(projectPath, { recursive: true });
        await fs.mkdir(pathModule.join(projectPath, '.c3'), { recursive: true });
        await fs.mkdir(pathModule.join(projectPath, 'chat'), { recursive: true });

        // Create in DB
        const project = db.projects.getOrCreate(name, projectPath, description || '');

        sendJSON(res, 201, { project });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    'GET /api/projects/:id': async (req, res, params) => {
      try {
        const project = db.projects.findById.get(safeParseInt(params.id));

        if (!project) {
          return sendJSON(res, 404, { error: 'Project not found' });
        }

        sendJSON(res, 200, { project });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    'GET /api/projects/:id/conversations': async (req, res, params) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const limit = parseInt(url.searchParams.get('limit')) || 10;

      try {
        const conversations = db.conversations.listRecentByProject.all(safeParseInt(params.id), limit);
        sendJSON(res, 200, { conversations });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    // ══════════════════════════════════════════════════════════════════════════
    // v59: Open Folder - Register existing filesystem folder as project
    // ══════════════════════════════════════════════════════════════════════════

    'POST /api/projects/open-folder': async (req, res) => {
      const body = await parseBody(req);
      const { folderPath, name } = body;

      if (!folderPath) {
        return sendJSON(res, 400, { error: 'folderPath is required' });
      }

      try {
        const fsPromises = await import('fs/promises');
        const pathModule = await import('path');
        const fsConstants = await import('fs');

        // 1. Normalize path (resolve to absolute, follow symlinks)
        let normalizedPath;
        try {
          normalizedPath = await fsPromises.realpath(folderPath);
        } catch (err) {
          return sendJSON(res, 400, {
            error: 'Path does not exist or is not accessible',
            details: err.message
          });
        }

        // 2. Validate it's a directory
        const stats = await fsPromises.stat(normalizedPath);
        if (!stats.isDirectory()) {
          return sendJSON(res, 400, { error: 'Path is not a directory' });
        }

        // 3. Check write permissions
        try {
          await fsPromises.access(normalizedPath, fsConstants.constants.W_OK);
        } catch (err) {
          return sendJSON(res, 400, {
            error: 'No write access to directory',
            details: 'The folder must be writable to store project metadata'
          });
        }

        // 4. Check if already registered in DB
        const existingProject = db.projects.findByPath.get(normalizedPath);
        if (existingProject) {
          // Update last_active and return existing project
          db.projects.touch(existingProject.id);
          return sendJSON(res, 200, {
            project: existingProject,
            status: 'already_registered',
            message: 'Project was already registered'
          });
        }

        // 5. Detect existing metadata directories
        const c3Path = pathModule.join(normalizedPath, '.c3');
        const c3ArchitectPath = pathModule.join(normalizedPath, '.c3-architect');

        let hasC3 = false;
        let hasC3Architect = false;
        let metadataState = null;

        try {
          await fsPromises.access(c3Path);
          hasC3 = true;
        } catch { /* doesn't exist */ }

        try {
          await fsPromises.access(c3ArchitectPath);
          hasC3Architect = true;
          // Try to read existing state
          try {
            const statePath = pathModule.join(c3ArchitectPath, 'state.json');
            const stateContent = await fsPromises.readFile(statePath, 'utf-8');
            metadataState = JSON.parse(stateContent);
          } catch { /* state.json doesn't exist or invalid */ }
        } catch { /* doesn't exist */ }

        // 6. Bootstrap metadata if missing
        let bootstrapped = false;
        if (!hasC3 && !hasC3Architect) {
          // Create minimal .c3-architect structure
          await fsPromises.mkdir(c3ArchitectPath, { recursive: true });
          await fsPromises.mkdir(pathModule.join(c3ArchitectPath, 'roadmap'), { recursive: true });

          // Derive name from folder name if not provided
          const derivedName = name || pathModule.basename(normalizedPath);

          // Create minimal state.json
          const initialState = {
            projectName: derivedName,
            createdAt: new Date().toISOString(),
            phase: 'discovery',
            version: '1.0.0',
            isExternal: true
          };

          await fsPromises.writeFile(
            pathModule.join(c3ArchitectPath, 'state.json'),
            JSON.stringify(initialState, null, 2),
            'utf-8'
          );

          bootstrapped = true;
          metadataState = initialState;
        }

        // 7. Register in DB (is_external = 1)
        const projectName = name || metadataState?.projectName || pathModule.basename(normalizedPath);
        const description = metadataState?.description || `External project: ${normalizedPath}`;

        const { project, wasExisting } = db.projects.registerExternal(projectName, normalizedPath, description);

        sendJSON(res, 201, {
          project,
          status: 'registered',
          metadata: {
            hasC3,
            hasC3Architect,
            bootstrapped,
            state: metadataState
          }
        });

      } catch (err) {
        logger.error('Server', `Open folder error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    'DELETE /api/projects/:id': async (req, res, params) => {
      try {
        const project = db.projects.findById.get(safeParseInt(params.id));
        if (!project) {
          return sendJSON(res, 404, { error: 'Project not found' });
        }

        // Delete project from DB (cascades to conversations, etc.)
        db.projects.delete.run(safeParseInt(params.id));

        sendJSON(res, 200, { success: true, deleted: params.id });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    // ══════════════════════════════════════════════════════════════════════════
    // Conversation assignment & Project roadmap
    // ══════════════════════════════════════════════════════════════════════════

    // Assign conversation to project
    'POST /api/conversations/:id/assign': async (req, res, params) => {
      const body = await parseBody(req);
      const { project_id } = body;

      if (!project_id) {
        return sendJSON(res, 400, { error: 'project_id is required' });
      }

      try {
        db.conversations.assignToProject.run(project_id, params.id);
        sendJSON(res, 200, { success: true });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    // Project roadmap
    'GET /api/projects/:id/roadmap': async (req, res, params) => {
      try {
        const project = db.projects.findById.get(safeParseInt(params.id));

        if (!project) {
          return sendJSON(res, 404, { error: 'Project not found' });
        }

        const fs = await import('fs/promises');
        const pathModule = await import('path');

        // Try to read roadmap/main.md
        const roadmapPath = pathModule.join(project.path, 'roadmap', 'main.md');

        try {
          const roadmap = await fs.readFile(roadmapPath, 'utf-8');
          sendJSON(res, 200, { roadmap });
        } catch {
          // No roadmap yet
          sendJSON(res, 200, { roadmap: null });
        }
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    // ══════════════════════════════════════════════════════════════════════════
    // Attachments
    // ══════════════════════════════════════════════════════════════════════════

    'POST /api/attachments': async (req, res) => {
      try {
        const fs = await import('fs/promises');
        const pathModule = await import('path');
        const crypto = await import('crypto');

        // Parse multipart form data
        const boundary = req.headers['content-type']?.split('boundary=')[1];

        if (!boundary) {
          return sendJSON(res, 400, { error: 'Invalid content type' });
        }

        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

        // Simple multipart parser
        const parts = buffer.toString('binary').split('--' + boundary);
        let fileData = null;
        let filename = '';
        let mimeType = '';
        let conversationId = '';
        let projectId = '';

        for (const part of parts) {
          if (part.includes('filename="')) {
            const filenameMatch = part.match(/filename="([^"]+)"/);
            const contentTypeMatch = part.match(/Content-Type: ([^\r\n]+)/);

            if (filenameMatch) {
              filename = filenameMatch[1];
              mimeType = contentTypeMatch ? contentTypeMatch[1] : 'application/octet-stream';

              // Extract file data (after double CRLF)
              const dataStart = part.indexOf('\r\n\r\n') + 4;
              const dataEnd = part.lastIndexOf('\r\n');
              fileData = Buffer.from(part.substring(dataStart, dataEnd), 'binary');
            }
          } else if (part.includes('name="conversation_id"')) {
            const dataStart = part.indexOf('\r\n\r\n') + 4;
            conversationId = part.substring(dataStart).trim().replace(/\r\n--$/, '');
          } else if (part.includes('name="project_id"')) {
            const dataStart = part.indexOf('\r\n\r\n') + 4;
            projectId = part.substring(dataStart).trim().replace(/\r\n--$/, '');
          }
        }

        if (!fileData || !filename) {
          return sendJSON(res, 400, { error: 'No file uploaded' });
        }

        // Generate hash
        const hash = crypto.createHash('sha256').update(fileData).digest('hex').substring(0, 16);
        const ext = pathModule.extname(filename);
        const storedFilename = `${hash}${ext}`;

        // Determine storage path
        let attachmentsDir;
        if (projectId) {
          const project = db.projects.findById.get(safeParseInt(projectId, 'projectId'));
          if (project) {
            attachmentsDir = pathModule.join(project.path, 'attachments');
          }
        }

        if (!attachmentsDir && conversationId) {
          attachmentsDir = pathModule.join(process.cwd(), 'chats', conversationId, 'attachments');
        }

        if (!attachmentsDir) {
          attachmentsDir = pathModule.join(process.cwd(), 'data', 'attachments');
        }

        await fs.mkdir(attachmentsDir, { recursive: true });

        const filePath = pathModule.join(attachmentsDir, storedFilename);
        await fs.writeFile(filePath, fileData);

        // Save to DB
        const id = db.attachments.create(
          conversationId || null,
          projectId ? parseInt(projectId) : null,
          storedFilename,
          filename,
          mimeType,
          fileData.length,
          hash,
          filePath
        );

        // Check total storage
        const totalSize = db.attachments.getTotalSize.get();
        const totalMB = (totalSize?.total || 0) / (1024 * 1024);

        sendJSON(res, 201, {
          id,
          filename: storedFilename,
          originalName: filename,
          size: fileData.length,
          totalStorageMB: totalMB.toFixed(1),
          warning: totalMB > 80 ? 'Storage approaching 100MB limit' : null
        });

      } catch (err) {
        logger.error('Server', `Attachment upload error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    // ══════════════════════════════════════════════════════════════════════════
    // v34.2: ARTIFACT DOWNLOAD
    // ══════════════════════════════════════════════════════════════════════════

    'GET /api/artifacts/:filename': async (req, res, params) => {
      try {
        const fsPromises = await import('fs/promises');
        const pathModule = await import('path');

        const artifactsDir = './data/artifacts';
        const filepath = pathModule.default.join(artifactsDir, params.filename);

        // Check if file exists
        try {
          await fsPromises.access(filepath);
        } catch {
          return sendJSON(res, 404, { error: 'Artifact not found' });
        }

        // Determine content type from extension
        let contentType, disposition;

        if (params.filename.endsWith('.pdf')) {
          contentType = 'application/pdf';
          disposition = 'inline';
        } else if (params.filename.endsWith('.xlsx')) {
          contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          disposition = 'attachment';
        } else if (params.filename.endsWith('.csv')) {
          contentType = 'text/csv; charset=utf-8';
          disposition = 'attachment';
        } else if (params.filename.endsWith('.json')) {
          contentType = 'application/json; charset=utf-8';
          disposition = 'attachment';
        } else if (params.filename.endsWith('.html')) {
          contentType = 'text/html; charset=utf-8';
          disposition = 'inline';
        } else {
          contentType = 'application/octet-stream';
          disposition = 'attachment';
        }

        // Read file
        const content = await fsPromises.readFile(filepath);

        // Create safe ASCII filename + UTF-8 encoded original
        // RFC 5987: filename*=UTF-8''encoded_name for non-ASCII
        const safeFilename = params.filename.replace(/[^\x00-\x7F]/g, '_');
        const encodedFilename = encodeURIComponent(params.filename);

        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Disposition': `${disposition}; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`,
          'Content-Length': content.length,
          'Cache-Control': 'private, max-age=3600'
        });
        res.end(content);

      } catch (err) {
        logger.error('Server', `Artifact download error: ${err.message}`);
        sendJSON(res, 500, safeError(err));
      }
    },

    // Get attachment
    'GET /api/attachments/:id': async (req, res, params) => {
      try {
        const fs = await import('fs/promises');

        const attachment = db.attachments.findById.get(safeParseInt(params.id));

        if (!attachment) {
          return sendJSON(res, 404, { error: 'Attachment not found' });
        }

        const data = await fs.readFile(attachment.path);

        // Safe filename for non-ASCII characters
        const safeFilename = attachment.original_name.replace(/[^\x00-\x7F]/g, '_');
        const encodedFilename = encodeURIComponent(attachment.original_name);

        res.writeHead(200, {
          'Content-Type': attachment.mime_type,
          'Content-Disposition': `inline; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`,
          'Content-Length': data.length,
        });
        res.end(data);

      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    // ══════════════════════════════════════════════════════════════════════════
    // Workspace routes
    // ══════════════════════════════════════════════════════════════════════════

    'GET /api/workspace/tree': async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const projectId = url.searchParams.get('project_id');
        let projectPath = url.searchParams.get('path');

        if (projectId) {
          const proj = db.projects.get(projectId);
          if (proj) projectPath = proj.path;
        }
        if (!projectPath) {
          sendJSON(res, 400, { error: 'Missing project_id or path parameter' });
          return;
        }

        const fsP = await import('fs/promises');

        async function readTree(dir, depth, maxDepth) {
          if (depth > maxDepth) return [];
          const entries = await fsP.readdir(dir, { withFileTypes: true });
          const result = [];
          for (const entry of entries) {
            if (['node_modules', '.git', '.c3', '__pycache__', '.next'].includes(entry.name)) continue;
            const fullPath = path.join(dir, entry.name);
            const relPath = path.relative(projectPath, fullPath);
            if (entry.isDirectory()) {
              const children = await readTree(fullPath, depth + 1, maxDepth);
              result.push({ n: entry.name, d: true, i: depth, p: path.dirname(relPath) === '.' ? undefined : path.dirname(relPath), children });
            } else {
              result.push({ n: entry.name, d: false, i: depth, p: path.dirname(relPath) === '.' ? undefined : path.dirname(relPath) });
            }
          }
          return result.sort((a, b) => (b.d ? 1 : 0) - (a.d ? 1 : 0) || a.n.localeCompare(b.n));
        }

        const tree = await readTree(projectPath, 0, 5);
        sendJSON(res, 200, { tree, root: projectPath });
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
    },

    'GET /api/workspace/file': async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const filePath = url.searchParams.get('path');
        const projectRoot = url.searchParams.get('root');
        if (!filePath) { sendJSON(res, 400, { error: 'Missing path' }); return; }

        const resolved = path.resolve(projectRoot || '.', filePath);
        if (projectRoot && !resolved.startsWith(path.resolve(projectRoot) + path.sep) && resolved !== path.resolve(projectRoot)) {
          sendJSON(res, 403, { error: 'Path traversal blocked' }); return;
        }

        const fsP = await import('fs/promises');
        const stat = await fsP.stat(resolved);
        if (stat.size > 2 * 1024 * 1024) { sendJSON(res, 413, { error: 'File too large (max 2MB)' }); return; }

        const content = await fsP.readFile(resolved, 'utf-8');
        const { createHash } = await import('crypto');
        const hash = createHash('sha256').update(content).digest('hex').substring(0, 16);

        sendJSON(res, 200, { content, hash, path: filePath });
      } catch (err) {
        sendJSON(res, err.code === 'ENOENT' ? 404 : 500, { error: err.message });
      }
    },

    'POST /api/workspace/file': async (req, res) => {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 3 * 1024 * 1024) { req.destroy(); } });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          if (!data.path) { sendJSON(res, 400, { error: 'Missing path' }); return; }

          const resolved = path.resolve(data.root || '.', data.path);
          if (data.root && !resolved.startsWith(path.resolve(data.root) + path.sep)) {
            sendJSON(res, 403, { error: 'Path traversal blocked' }); return;
          }

          const fsP = await import('fs/promises');

          /* Optimistic locking */
          if (data.expectedHash) {
            try {
              const current = await fsP.readFile(resolved, 'utf-8');
              const { createHash } = await import('crypto');
              const currentHash = createHash('sha256').update(current).digest('hex').substring(0, 16);
              if (currentHash !== data.expectedHash) {
                sendJSON(res, 409, { error: 'File modified externally', currentContent: current, currentHash, yourHash: data.expectedHash });
                return;
              }
            } catch { /* file doesn't exist yet -- ok */ }
          }

          await fsP.mkdir(path.dirname(resolved), { recursive: true });
          await fsP.writeFile(resolved, data.content || '', 'utf-8');
          sendJSON(res, 200, { ok: true, path: data.path });
        } catch (err) {
          sendJSON(res, 500, { error: err.message });
        }
      });
    },

    'POST /api/workspace/directory': async (req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          if (!data.path) { sendJSON(res, 400, { error: 'Missing path' }); return; }
          const resolved = path.resolve(data.root || '.', data.path);
          if (data.root && !resolved.startsWith(path.resolve(data.root) + path.sep)) {
            sendJSON(res, 403, { error: 'Path traversal blocked' }); return;
          }
          const fsP = await import('fs/promises');
          await fsP.mkdir(resolved, { recursive: true });
          sendJSON(res, 200, { ok: true, path: data.path });
        } catch (err) {
          sendJSON(res, 500, { error: err.message });
        }
      });
    },

    'PUT /api/workspace/rename': async (req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          if (!data.from || !data.to) { sendJSON(res, 400, { error: 'Missing from/to' }); return; }
          const root = data.root || '.';
          const fromResolved = path.resolve(root, data.from);
          const toResolved = path.resolve(root, data.to);
          const absRoot = path.resolve(root);
          if (!fromResolved.startsWith(absRoot + path.sep) || !toResolved.startsWith(absRoot + path.sep)) {
            sendJSON(res, 403, { error: 'Path traversal blocked' }); return;
          }
          const fsP = await import('fs/promises');
          await fsP.rename(fromResolved, toResolved);
          sendJSON(res, 200, { ok: true, from: data.from, to: data.to });
        } catch (err) {
          sendJSON(res, 500, { error: err.message });
        }
      });
    },

    'DELETE /api/workspace/file': async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const filePath = url.searchParams.get('path');
      const root = url.searchParams.get('root') || '.';
      if (!filePath) { sendJSON(res, 400, { error: 'Missing path' }); return; }

      const resolved = path.resolve(root, filePath);
      if (!resolved.startsWith(path.resolve(root) + path.sep)) {
        sendJSON(res, 403, { error: 'Path traversal blocked' }); return;
      }

      try {
        const fsP = await import('fs/promises');
        const stat = await fsP.stat(resolved);
        if (stat.isDirectory()) {
          await fsP.rm(resolved, { recursive: true });
        } else {
          await fsP.unlink(resolved);
        }
        sendJSON(res, 200, { ok: true, path: filePath });
      } catch (err) {
        sendJSON(res, err.code === 'ENOENT' ? 404 : 500, { error: err.message });
      }
    },

    'GET /api/workspace/git-status': async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const projectId = url.searchParams.get('project_id');
        let projectPath = url.searchParams.get('path');

        if (projectId) {
          const proj = db.projects.get(projectId);
          if (proj) projectPath = proj.path;
        }
        if (!projectPath) { sendJSON(res, 400, { error: 'Missing project_id or path' }); return; }

        const { spawn } = await import('child_process');

        const results = await Promise.allSettled([
          new Promise((resolve, reject) => {
            let out = '';
            const p = spawn('git', ['status', '--porcelain'], { cwd: projectPath });
            const timer = setTimeout(() => { p.kill('SIGTERM'); reject(new Error('timeout')); }, 1500);
            p.stdout.on('data', d => { out += d; });
            p.on('close', () => { clearTimeout(timer); resolve(out); });
            p.on('error', reject);
          }),
          new Promise((resolve, reject) => {
            let out = '';
            const p = spawn('git', ['branch', '--show-current'], { cwd: projectPath });
            const timer = setTimeout(() => { p.kill('SIGTERM'); reject(new Error('timeout')); }, 1500);
            p.stdout.on('data', d => { out += d; });
            p.on('close', () => { clearTimeout(timer); resolve(out.trim()); });
            p.on('error', reject);
          })
        ]);

        const files = {};
        if (results[0].status === 'fulfilled') {
          results[0].value.split('\n').filter(Boolean).forEach(line => {
            files[line.substring(3)] = line.substring(0, 2).trim();
          });
        }
        const branch = results[1].status === 'fulfilled' ? results[1].value : null;

        sendJSON(res, 200, { files, branch });
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
    },
  };
}
