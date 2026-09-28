import { createDependencyInstallationService } from '../setup/dependency-installation.js';
import { inspectDevelopmentEnvironment } from '../setup/development-environment.js';
import { isLocalOperatorTransportSubject } from '../security/global-auth-policy.js';

export function createDevelopmentRoutes({ db, parseBody, sendJSON, installationService }) {
  const service = installationService || createDependencyInstallationService({ db: db.db || db });
  const wrap = handler => async (req, res) => {
    if (!isLocalOperatorTransportSubject(req.authenticatedSubject)) {
      return sendJSON(res, 403, { error: 'Instalace a jejich nastavení jsou dostupné jen místnímu uživateli.', code: 'INSTALL_LOCAL_OPERATOR_REQUIRED' });
    }
    try { return sendJSON(res, 200, await handler(req)); }
    catch (error) {
      const code = String(error.code || error.message);
      const status = code.includes('NOT_FOUND') ? 404 : /BUSY|STALE|CHANGED|EXPIRED|APPROVAL|TARGET_EXISTS/.test(code) ? 409
        : /UNAVAILABLE/.test(code) ? 503 : code.startsWith('INSTALL_') ? 400 : 500;
      return sendJSON(res, status, { error: status === 500 ? 'Příprava instalace selhala.' : code, code: status === 500 ? 'INSTALL_INTERNAL_ERROR' : code });
    }
  };
  const id = req => new URL(req.url, 'http://localhost').searchParams.get('id');
  return {
    'GET /api/development/environment': wrap(() => inspectDevelopmentEnvironment({ refresh: true })),
    'GET /api/development/policy': wrap(() => service.policy()),
    'PUT /api/development/policy': wrap(async req => service.setPolicy(await parseBody(req), req.authenticatedSubject)),
    'GET /api/development/installations': wrap(req => service.list(req.authenticatedSubject)),
    'POST /api/development/prepare': wrap(async req => service.prepare(await parseBody(req), req.authenticatedSubject)),
    'POST /api/development/execute': wrap(async req => service.execute(await parseBody(req), req.authenticatedSubject)),
    'GET /api/development/status': wrap(req => service.status(id(req), req.authenticatedSubject)),
    'POST /api/development/cancel': wrap(async req => {
      const body = await parseBody(req);
      if (!body || Object.keys(body).join(',') !== 'id' || typeof body.id !== 'string') throw Error('INSTALL_INPUT_INVALID');
      return service.cancel(body.id, req.authenticatedSubject);
    }),
  };
}
