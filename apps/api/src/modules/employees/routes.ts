import type { FastifyInstance } from 'fastify';
import { AVATAR_IDS } from '@avo/shared';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { parse } from '../../lib/util.js';
import type { Guard } from '../auth/guard.js';
import { EmployeeService } from './employee-service.js';

const HireBody = z.object({
  agentRef: z.string().min(1).max(80),
  title: z.string().min(1).max(80).optional(),
  departmentRef: z.string().max(80).optional(),
  managerRef: z.string().max(80).optional(),
  avatarId: z.enum(AVATAR_IDS).optional(),
  responsibilities: z.array(z.string().min(1).max(200)).max(10).optional(),
});

/** Thin REST face of EmployeeService (the terminal calls the same service). */
export function registerEmployeeRoutes(app: FastifyInstance, ctx: () => AppContext, guard: Guard): void {
  const svc = () => new EmployeeService(ctx);
  const ws = (req: { auth?: { workspaceId: string } }) => req.auth!.workspaceId;
  const actor = (req: { auth?: { userId: string } }) => ({ userId: req.auth!.userId, source: { kind: 'user' as const, ref: req.auth!.userId } });
  const ref = (req: { params: unknown }) => (req.params as { ref: string }).ref;

  app.get('/employees', { preHandler: guard('view') }, async (req) => svc().list(ws(req), { ...((req.query as { dept?: string }).dept ? { departmentKey: (req.query as { dept: string }).dept } : {}) }));
  app.get('/employees/candidates', { preHandler: guard('view') }, async (req) => svc().candidates(ws(req)));
  app.post('/employees', { preHandler: guard('agent.manage') }, async (req, reply) => {
    reply.code(201);
    return svc().hire(ws(req), actor(req), parse(HireBody, req.body));
  });
  app.post('/employees/:ref/onboard', { preHandler: guard('agent.manage') }, async (req) => svc().onboard(ws(req), actor(req), ref(req)));
  app.post('/employees/:ref/suspend', { preHandler: guard('agent.manage') }, async (req) => svc().setSuspended(ws(req), actor(req), ref(req), true));
  app.post('/employees/:ref/resume', { preHandler: guard('agent.manage') }, async (req) => svc().setSuspended(ws(req), actor(req), ref(req), false));
}
