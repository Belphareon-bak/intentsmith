import { createScmService } from '../scm/service.js';
import { isLocalOperatorTransportSubject } from '../security/global-auth-policy.js';

export function createScmRoutes({ db, parseBody, sendJSON, scmService }) {
  const service = scmService || createScmService({ db: db.db || db });
  const query = req => new URL(req.url, 'http://localhost').searchParams;
  const id = params => {
    const value = params.get('projectId');
    if (!/^[1-9][0-9]*$/.test(value || '')) throw Object.assign(Error('SCM_PROJECT_REQUIRED'), { code: 'SCM_PROJECT_REQUIRED' });
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw Object.assign(Error('SCM_PROJECT_REQUIRED'), { code: 'SCM_PROJECT_REQUIRED' });
    return number;
  };
  const wrap = action => async (req, res) => {
    if (!isLocalOperatorTransportSubject(req.authenticatedSubject)) return sendJSON(res, 403,
      { error: 'Správa zdrojů je dostupná jen místnímu uživateli.', code: 'SCM_LOCAL_OPERATOR_REQUIRED' });
    try { return sendJSON(res, 200, await action(req)); }
    catch (error) {
      const code = String(error.code || 'SCM_INTERNAL_ERROR');
      const status = code === 'SCM_PLAN_NOT_FOUND' || code === 'SCM_PROJECT_NOT_FOUND' ? 404
        : /STALE|CHANGED|BUSY|DIRTY|DIVERGED|EXISTS|EMPTY|STATE|CONFLICT/.test(code) ? 409
        : code === 'SCM_INTERNAL_ERROR' ? 500 : 400;
      return sendJSON(res, status, { error: status === 500 ? 'Správa zdrojů selhala.' : code,
        code: status === 500 ? 'SCM_INTERNAL_ERROR' : code });
    }
  };
  return {
    'GET /api/scm/status': wrap(req => service.status(id(query(req)))),
    'GET /api/scm/branches': wrap(req => service.branches(id(query(req)))),
    'GET /api/scm/log': wrap(req => { const q = query(req); return service.log(id(q), {
      limit: q.has('limit') ? Number(q.get('limit')) : 50, ref: q.get('ref') || null }); }),
    'GET /api/scm/diff': wrap(req => { const q = query(req); return service.diff(id(q), {
      file: q.get('path'), staged: q.get('staged') === 'true' }); }),
    'GET /api/scm/policy': wrap(req => service.policy(id(query(req)))),
    'PUT /api/scm/policy': wrap(async req => {
      const input = await parseBody(req);
      const before = service.policy(input?.projectId);
      const updated = service.writePolicy(input, req.authenticatedSubject.actorId);
      if (before.init !== 'automatic' && updated.init === 'automatic') {
        try {
          if (!(await service.status(updated.projectId)).isRepo) {
            const result = await service.runAutomatic(updated.projectId, 'init');
            return { ...updated, automaticInit: { state: result.state } };
          }
        } catch (error) {
          // Policy is already durable. Return that fact with an explicit failed
          // effect; the caller must read the audit before attempting anything else.
          return { ...updated, automaticInit: { state: 'error', code: error.code || 'SCM_INTERNAL_ERROR' } };
        }
      }
      return updated;
    }),
    'POST /api/scm/prepare': wrap(async req => service.prepare(await parseBody(req), req.authenticatedSubject.actorId)),
    'POST /api/scm/execute': wrap(async req => service.execute(await parseBody(req), req.authenticatedSubject.actorId)),
    'POST /api/scm/cancel': wrap(async req => service.cancel(await parseBody(req), req.authenticatedSubject.actorId)),
    'GET /api/scm/operations': wrap(req => service.operations(id(query(req)), req.authenticatedSubject.actorId)),
  };
}
