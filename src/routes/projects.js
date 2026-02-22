// H9: Projects, Workspace & Attachments routes
import { generateReadme, ensureReadme } from '../chat/handlers/utils/readme-generator.js';

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

    'GET /api/projects/defaults': async (req, res) => {
      try {
        const pathModule = await import('path');
        const { config } = await import('../config.js');
        const defaultDir = pathModule.resolve(config.projects.defaultDir);
        sendJSON(res, 200, { defaultDir });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

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
      const { name, description, type, path: customPath, autoPath } = body;

      if (!name) {
        return sendJSON(res, 400, { error: 'name is required' });
      }

      try {
        const fs = await import('fs/promises');
        const pathModule = await import('path');
        const { config } = await import('../config.js');
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);

        // Resolve project path
        const slug = name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
        let projectPath;
        if (customPath && customPath.trim()) {
          projectPath = pathModule.resolve(customPath.trim());
        } else {
          const projectsDir = pathModule.resolve(config.projects.defaultDir);
          await fs.mkdir(projectsDir, { recursive: true });
          projectPath = pathModule.join(projectsDir, slug);
        }

        // Create directory structure
        await fs.mkdir(projectPath, { recursive: true });
        await fs.mkdir(pathModule.join(projectPath, '.c3'), { recursive: true });

        // Scaffolding per project type
        const projectType = type || 'general';
        const scaffoldLog = [];

        // git init (all types)
        try {
          await execFileAsync('git', ['init'], { cwd: projectPath, timeout: 10000 });
          await fs.writeFile(pathModule.join(projectPath, '.gitignore'), 'node_modules/\n.env\n.c3/\ndist/\nbuild/\n*.log\n');
          scaffoldLog.push('git init');
        } catch (e) { scaffoldLog.push('git init skipped: ' + e.message); }

        // Type-specific scaffolding
        if (projectType === 'webapp' || projectType === 'api') {
          // npm init + basic package.json
          const pkg = {
            name: slug,
            version: '0.1.0',
            description: description || '',
            type: 'module',
            scripts: {
              start: projectType === 'webapp' ? 'vite dev' : 'node src/index.js',
              build: projectType === 'webapp' ? 'vite build' : 'echo "no build step"',
              test: 'echo "no tests yet" && exit 0',
              dev: projectType === 'webapp' ? 'vite dev' : 'node --watch src/index.js',
            },
            dependencies: {},
            devDependencies: {},
          };
          await fs.writeFile(pathModule.join(projectPath, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
          scaffoldLog.push('package.json');

          if (projectType === 'webapp') {
            await fs.mkdir(pathModule.join(projectPath, 'src'), { recursive: true });
            await fs.mkdir(pathModule.join(projectPath, 'public'), { recursive: true });
            await fs.writeFile(pathModule.join(projectPath, 'src', 'index.js'), '// Entry point\nconsole.log("Hello from ' + name + '");\n');
            await fs.writeFile(pathModule.join(projectPath, 'public', 'index.html'), '<!DOCTYPE html>\n<html lang="cs"><head><meta charset="UTF-8"><title>' + name + '</title></head><body><div id="app"></div><script type="module" src="/src/index.js"></script></body></html>\n');
            scaffoldLog.push('src/ + public/');
          } else {
            await fs.mkdir(pathModule.join(projectPath, 'src'), { recursive: true });
            await fs.writeFile(pathModule.join(projectPath, 'src', 'index.js'), '// ' + name + ' — API server\nimport http from "http";\nconst server = http.createServer((req, res) => { res.writeHead(200); res.end("OK"); });\nserver.listen(3000, () => console.log("Listening on :3000"));\n');
            scaffoldLog.push('src/index.js (API)');
          }
        } else if (projectType === 'automation') {
          await fs.mkdir(pathModule.join(projectPath, 'scripts'), { recursive: true });
          const pkg = { name: slug, version: '0.1.0', type: 'module', scripts: { start: 'node scripts/main.js' }, dependencies: {} };
          await fs.writeFile(pathModule.join(projectPath, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
          await fs.writeFile(pathModule.join(projectPath, 'scripts', 'main.js'), '// ' + name + ' — automation entry\nconsole.log("Running...");\n');
          scaffoldLog.push('package.json + scripts/main.js');
        } else if (projectType === 'data') {
          await fs.mkdir(pathModule.join(projectPath, 'data'), { recursive: true });
          await fs.mkdir(pathModule.join(projectPath, 'notebooks'), { recursive: true });
          await fs.mkdir(pathModule.join(projectPath, 'src'), { recursive: true });
          const pkg = { name: slug, version: '0.1.0', type: 'module', scripts: { start: 'node src/pipeline.js' }, dependencies: {} };
          await fs.writeFile(pathModule.join(projectPath, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
          await fs.writeFile(pathModule.join(projectPath, 'src', 'pipeline.js'), '// ' + name + ' — data pipeline\nconsole.log("Pipeline start");\n');
          scaffoldLog.push('package.json + data/ + notebooks/ + src/pipeline.js');
        } else {
          // general — empty project, no package.json
          scaffoldLog.push('(prázdný projekt)');
        }

        // Write .c3/project.json metadata
        const meta = { name, type: projectType, description: description || '', created: new Date().toISOString(), lifecycle: 'SPEC' };
        await fs.writeFile(pathModule.join(projectPath, '.c3', 'project.json'), JSON.stringify(meta, null, 2) + '\n');
        scaffoldLog.push('.c3/project.json');

        // v67.0: README-first — generate structured README.md
        const readmeContent = generateReadme(projectPath, { name, description });
        await fs.writeFile(pathModule.join(projectPath, 'README.md'), readmeContent);
        scaffoldLog.push('README.md');

        // Create in DB with lifecycle SPEC
        const project = db.projects.getOrCreate(name, projectPath, description || '');

        // Set lifecycle phase to SPEC
        if (project && project.id) {
          try { db.db.prepare('UPDATE projects SET status = ? WHERE id = ?').run('SPEC', project.id); } catch (e) { /* column may not exist */ }
        }

        sendJSON(res, 201, {
          id: project?.id,
          project,
          path: projectPath,
          type: projectType,
          lifecycle: 'SPEC',
          scaffold: scaffoldLog,
        });
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

    'PUT /api/projects/:id': async (req, res, params) => {
      const body = await parseBody(req);
      try {
        const id = safeParseInt(params.id);
        const project = db.projects.findById.get(id);
        if (!project) return sendJSON(res, 404, { error: 'Project not found' });

        const updates = [];
        const values = [];
        if (body.name !== undefined && body.name.trim()) { updates.push('name = ?'); values.push(body.name.trim()); }
        if (body.path !== undefined && body.path.trim()) { updates.push('path = ?'); values.push(body.path.trim()); }
        if (body.description !== undefined) { updates.push('description = ?'); values.push(body.description); }
        if (updates.length === 0) return sendJSON(res, 400, { error: 'No fields to update' });

        updates.push('last_active = CURRENT_TIMESTAMP');
        db.db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values, id);

        const updated = db.projects.findById.get(id);
        sendJSON(res, 200, { project: updated });
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
    // v65.2: Get active lifecycle state for a project (used by IDE project opener)
    // ══════════════════════════════════════════════════════════════════════════

    'GET /api/projects/:id/lifecycle': async (req, res, params) => {
      try {
        const projectId = safeParseInt(params.id);
        const lc = db.lifecycles.findActiveByProject.get(projectId);

        if (!lc) {
          return sendJSON(res, 200, { lifecycle: null });
        }

        // Count milestones by status
        const statusRows = db.milestones.countByStatus.all(lc.id);
        const milestones = { total: 0 };
        for (const row of statusRows) {
          milestones[row.status] = row.count;
          milestones.total += row.count;
        }

        sendJSON(res, 200, {
          lifecycle: {
            id: lc.id,
            phase: lc.phase,
            activeSessionId: lc.active_session_id || null,
            projectPath: lc.project_path || null,
            milestones,
          },
        });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    // v65.2: Bind session to active lifecycle (double-bind guard + COMPLETED guard)
    'POST /api/projects/:id/lifecycle/bind': async (req, res, params) => {
      const body = await parseBody(req);
      const { sessionId } = body;

      if (!sessionId) {
        return sendJSON(res, 400, { error: 'sessionId is required' });
      }

      try {
        const projectId = safeParseInt(params.id);
        const { getLcStateByProject, bindSessionToLifecycle, setLcState } = await import('../chat/handlers/lifecycle-state.js');

        // Guard: double bind — another session already owns this lifecycle
        const existing = getLcStateByProject(projectId);
        if (existing && existing.sessionId !== sessionId) {
          return sendJSON(res, 409, { error: 'Lifecycle already bound', activeSession: existing.sessionId });
        }

        const lc = db.lifecycles.findActiveByProject.get(projectId);
        if (!lc) {
          return sendJSON(res, 200, { ok: false, reason: 'No active lifecycle' });
        }

        // Guard: COMPLETED/FAILED — no point binding
        if (lc.phase === 'COMPLETED' || lc.phase === 'FAILED') {
          return sendJSON(res, 200, { ok: false, reason: 'Lifecycle is ' + lc.phase });
        }

        // Bind session to lifecycle
        bindSessionToLifecycle(sessionId, lc.id);

        // Set lifecycle state in RAM for conversation handler
        setLcState(sessionId, {
          phase: lc.phase,
          lifecycleId: lc.id,
          currentMilestoneId: null,
          originalRequest: '',
          projectId,
          projectPath: lc.project_path || null,
        });

        logger.info('Projects', `Lifecycle bound: session=${sessionId} lifecycle=${lc.id} phase=${lc.phase}`);

        sendJSON(res, 200, { ok: true, phase: lc.phase, lifecycleId: lc.id });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    // ══════════════════════════════════════════════════════════════════════════
    // v65: Start lifecycle for a project (called from IDE wizard)
    // ══════════════════════════════════════════════════════════════════════════

    'POST /api/projects/lifecycle/start': async (req, res) => {
      const body = await parseBody(req);
      const { projectId, projectPath, projectName, description, type, sessionId } = body;

      if (!sessionId) {
        return sendJSON(res, 400, { error: 'sessionId is required' });
      }

      try {
        const { setLcState, bindSessionToLifecycle } = await import('../chat/handlers/lifecycle-state.js');

        const lcId = `lc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // Create lifecycle record in DB
        try {
          const specData = { name: projectName, type: type || 'general', description: description || '', goals: [], requirements: [] };
          // Validate projectId FK before insert
          const safeProjectId = projectId ? (db.projects.findById.get(projectId) ? projectId : null) : null;
          db.db.prepare(
            'INSERT OR IGNORE INTO project_lifecycles (id, project_id, phase, spec, config, active_session_id) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(lcId, safeProjectId, 'SPEC', JSON.stringify(specData), '{}', sessionId);
        } catch (e) {
          logger.warn('Projects', `Lifecycle DB insert failed: ${e.message}`);
        }

        // Activate lifecycle on session — phase SPEC
        setLcState(sessionId, {
          phase: 'SPEC',
          lifecycleId: lcId,
          currentMilestoneId: null,
          originalRequest: description || ('Nový projekt: ' + (projectName || '')),
          projectId: projectId || null,
          projectPath: projectPath || null,
        });
        bindSessionToLifecycle(sessionId, lcId);

        logger.info('Projects', `Lifecycle started for project ${projectName} (session: ${sessionId})`);

        sendJSON(res, 200, {
          ok: true,
          phase: 'SPEC',
          message: 'Lifecycle aktivován. Popište specifikaci projektu.',
        });
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

    // Terminal Tab-completion: list directory entries with optional prefix filter
    'GET /api/workspace/ls': async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const dirPath = url.searchParams.get('path');
        const prefix = url.searchParams.get('prefix') || '';
        if (!dirPath) { sendJSON(res, 400, { error: 'Missing path' }); return; }

        const fsP = await import('fs/promises');
        const resolved = path.resolve(dirPath);
        const entries = await fsP.readdir(resolved, { withFileTypes: true });

        const filtered = entries
          .filter(e => !prefix || e.name.startsWith(prefix))
          .filter(e => !e.name.startsWith('.') || prefix.startsWith('.'))
          .slice(0, 50)
          .map(e => ({ name: e.name, isDir: e.isDirectory() }))
          .sort((a, b) => (b.isDir ? 1 : 0) - (a.isDir ? 1 : 0) || a.name.localeCompare(b.name));

        sendJSON(res, 200, { entries: filtered });
      } catch (err) {
        sendJSON(res, 200, { entries: [] }); // graceful: empty on error
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

    // ══════════════════════════════════════════════════════════════════════════
    // v67.0: Memory Bank — Project-Scoped Persistent Memory
    // ══════════════════════════════════════════════════════════════════════════

    'GET /api/projects/:id/memory': (req, res) => {
      const projectId = safeParseInt(req.params?.id);
      if (!projectId) return sendJSON(res, 400, { error: 'Invalid project ID' });

      const category = req.query?.category || null;
      const entries = db.projectMemory.listByProject.all(projectId);
      const filtered = category
        ? entries.filter(e => e.category === category)
        : entries;

      sendJSON(res, 200, {
        projectId,
        entries: (filtered || []).map(e => ({
          key: e.key,
          value: _parseValue(e.value),
          category: e.category,
          updated_at: e.updated_at,
        })),
      });
    },

    'PUT /api/projects/:id/memory': async (req, res) => {
      const projectId = safeParseInt(req.params?.id);
      if (!projectId) return sendJSON(res, 400, { error: 'Invalid project ID' });

      const body = await parseBody(req);
      const { key, value, category } = body;
      if (!key) return sendJSON(res, 400, { error: 'key is required' });

      try {
        db.projectMemory.setValue(projectId, key, value, category || 'general');
        sendJSON(res, 200, { stored: true, key, category: category || 'general' });
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
    },

    // v67.0: README-first — generate/regenerate README.md for a project
    'POST /api/projects/:id/readme': (req, res) => {
      const projectId = safeParseInt(req.params?.id);
      if (!projectId) return sendJSON(res, 400, { error: 'Invalid project ID' });

      try {
        const project = db.projects.findById.get(projectId);
        if (!project || !project.path) return sendJSON(res, 404, { error: 'Project not found or has no path' });

        const result = ensureReadme(project.path, { name: project.name, description: project.description || '' });
        sendJSON(res, 200, result);
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
    },

    'DELETE /api/projects/:id/memory/:key': (req, res) => {
      const projectId = safeParseInt(req.params?.id);
      const key = req.params?.key;
      if (!projectId || !key) return sendJSON(res, 400, { error: 'Invalid project ID or key' });

      try {
        db.projectMemory.delete.run(projectId, decodeURIComponent(key));
        sendJSON(res, 200, { deleted: true, key });
      } catch (err) {
        sendJSON(res, 500, { error: err.message });
      }
    },
  };
}

function _parseValue(raw) {
  if (raw === null || raw === undefined) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}
