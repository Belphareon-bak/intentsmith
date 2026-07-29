import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { DomainError } from '@intentsmith/core';

import type { ServerRuntime } from './app.js';
import { isLoopbackAddress, isOperatorAuthenticated } from './remote-access.js';

/**
 * The human approval decision surface.
 *
 * Three routes, scoped to one run: list what is pending, approve one exact
 * request, deny one exact request. That is the whole API, and the things it
 * deliberately does not offer are as much of the design as the things it does.
 *
 * There is no body on either decision route. A caller cannot name a tool, a
 * path, a command, a capability, a resource or a duration, because there is
 * nowhere to put one: the only thing being decided is the request the mediator
 * already recorded, identified by the pair (run, approval). There is no
 * allow-always, no standing grant, no wildcard and no cross-run decision,
 * because the ledger underneath has no representation for any of them.
 *
 * Everything that could refuse a decision — unknown id, wrong run, already
 * settled, expired, revoked with its run, terminal run — is refused by the
 * ledger, not re-implemented here. A route that decided for itself when an
 * approval was still valid would be a second authorization system.
 *
 * ## Trust boundary
 *
 * By default the main API has no authentication. It binds to `127.0.0.1` and
 * treats local access as the trust boundary, exactly as every other route here
 * does. These routes additionally refuse any request that did not arrive over
 * loopback, so that an operator who widens `INTENTSMITH_HOST` does not silently
 * hand the approval decision to the network. That is a guard, not an
 * authentication system: any process on this machine can still decide.
 *
 * That guard is composed with, not replaced by, the operator credential. When
 * remote access is enabled the central `onRequest` check in `remote-access.ts`
 * has already proved authority before any of this runs, and an authenticated
 * operator therefore satisfies the peer-address requirement the credential is
 * strictly stronger than. Unauthenticated callers never arrive here at all.
 * With no credential configured the behaviour below is unchanged.
 */

const RunParamsSchema = Type.Object(
  {
    runId: Type.String({ minLength: 1, maxLength: 200 }),
    approvalId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { additionalProperties: false },
);

export function registerApprovalRoutes(app: FastifyInstance, runtime: ServerRuntime): void {
  const desk = (): NonNullable<ServerRuntime['approvals']> => {
    if (!runtime.approvals) {
      // The fake worker mediates nothing, so there is nothing to decide. Saying
      // so is safer than pretending the surface exists and always answering
      // "not found", which would read as "no approval is pending right now".
      throw new DomainError(
        'APPROVAL_SURFACE_UNAVAILABLE',
        'This runtime composes no capability mediation, so it has no approvals to decide.',
      );
    }
    return runtime.approvals;
  };

  const assertDecisionAuthority = (request: FastifyRequest, reply: FastifyReply): boolean => {
    // An authenticated operator has already proved the stronger claim: the
    // credential is what the peer address was standing in for. Without one
    // configured this is exactly the loopback guard it always was.
    if (isOperatorAuthenticated(request)) return true;
    if (isLoopbackAddress(request.socket.remoteAddress ?? undefined)) return true;
    void reply.status(403).send({
      error: {
        code: 'APPROVAL_SURFACE_REMOTE',
        message: 'Approval decisions may only be made from this machine.',
        retryable: false,
      },
    });
    return false;
  };

  app.get('/runs/:runId/approvals', { schema: { params: RunParamsSchema } }, async (request, reply) => {
    if (!assertDecisionAuthority(request, reply)) return reply;
    const { runId } = request.params as { runId: string };
    return { approvals: await desk().listPending(runId) };
  });

  app.post(
    '/runs/:runId/approvals/:approvalId/approve',
    { schema: { params: RunParamsSchema } },
    async (request, reply) => {
      if (!assertDecisionAuthority(request, reply)) return reply;
      const { runId, approvalId } = request.params as { runId: string; approvalId: string };
      return await desk().decide(runId, approvalId, 'approve');
    },
  );

  app.post(
    '/runs/:runId/approvals/:approvalId/deny',
    { schema: { params: RunParamsSchema } },
    async (request, reply) => {
      if (!assertDecisionAuthority(request, reply)) return reply;
      const { runId, approvalId } = request.params as { runId: string; approvalId: string };
      return await desk().decide(runId, approvalId, 'deny');
    },
  );
}
