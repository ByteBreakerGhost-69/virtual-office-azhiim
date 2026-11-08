import type { FastifyInstance } from 'fastify';
import { CreateIntegrationBodySchema, UpdateIntegrationBodySchema } from '@avo/shared';
import { ADAPTER_DESCRIPTORS } from '@avo/adapters';
import type { AppContext } from '../../context.js';
import { ApiError, conflict, notFound } from '../../lib/errors.js';
import { encryptSecret } from '../../lib/crypto.js';
import { newId, parse } from '../../lib/util.js';
import { integrationDTO } from '../../dto/mappers.js';
import type { Guard } from '../auth/guard.js';

export function registerIntegrationRoutes(app: FastifyInstance, ctx: () => AppContext, guard: Guard): void {
  const ws = (req: { auth?: { workspaceId: string } }) => req.auth!.workspaceId;
  const idOf = (req: { params: unknown }) => (req.params as { id: string }).id;

  app.get('/integrations/kinds', { preHandler: guard('view') }, async () => Object.values(ADAPTER_DESCRIPTORS));

  app.get('/integrations', { preHandler: guard('view') }, async (req) => {
    const rows = await ctx().db.integration.findMany({ where: { workspaceId: ws(req) }, orderBy: { createdAt: 'asc' }, include: { _count: { select: { agents: true } } } });
    return rows.map(integrationDTO);
  });

  app.post('/integrations', { preHandler: guard('integration.manage') }, async (req, reply) => {
    const c = ctx();
    const b = parse(CreateIntegrationBodySchema, req.body);
    const d = ADAPTER_DESCRIPTORS[b.kind];
    if (!d.available) throw new ApiError('validation_error', `${d.label} is not available yet: ${d.notes ?? ''}`);
    if (d.config.baseUrlRequired && !b.baseUrl) throw new ApiError('validation_error', 'baseUrl is required for this runtime');
    if (d.config.secretRequired && !b.secret) throw new ApiError('validation_error', 'An API key is required for this runtime');
    const row = await c.db.integration.create({
      data: { id: newId(), workspaceId: ws(req), kind: b.kind, mode: d.simulated ? 'SIMULATED' : 'REAL', name: b.name, baseUrl: b.baseUrl ?? null, encryptedSecret: b.secret ? encryptSecret(b.secret, c.config.encryptionKey) : null },
    });
    await c.audit.log({ workspaceId: ws(req), actorUserId: req.auth!.userId, action: 'integration.create', entity: 'integration', entityId: row.id, details: { kind: b.kind, name: b.name, hasSecret: !!b.secret } });
    void c.heartbeat?.check(row.id).catch(() => undefined);
    reply.code(201);
    return integrationDTO({ ...row, _count: { agents: 0 } });
  });

  app.patch('/integrations/:id', { preHandler: guard('integration.manage') }, async (req) => {
    const c = ctx();
    const id = idOf(req);
    const b = parse(UpdateIntegrationBodySchema, req.body);
    if (!(await c.db.integration.findFirst({ where: { id, workspaceId: ws(req) } }))) throw notFound('Integration');
    const row = await c.db.integration.update({
      where: { id },
      data: { ...(b.name ? { name: b.name } : {}), ...(b.baseUrl ? { baseUrl: b.baseUrl } : {}), ...(b.secret ? { encryptedSecret: encryptSecret(b.secret, c.config.encryptionKey) } : {}), ...(b.baseUrl || b.secret ? { status: 'unchecked', lastError: null } : {}) },
      include: { _count: { select: { agents: true } } },
    });
    await c.audit.log({ workspaceId: ws(req), actorUserId: req.auth!.userId, action: 'integration.update', entity: 'integration', entityId: id, details: { fields: Object.keys(b), secretChanged: !!b.secret } });
    void c.heartbeat?.check(id).catch(() => undefined);
    return integrationDTO(row);
  });

  app.delete('/integrations/:id', { preHandler: guard('integration.manage') }, async (req) => {
    const c = ctx();
    const id = idOf(req);
    const row = await c.db.integration.findFirst({ where: { id, workspaceId: ws(req) }, include: { _count: { select: { agents: true } } } });
    if (!row) throw notFound('Integration');
    if (row._count.agents) throw conflict('Remove or move the agents registered on this integration first');
    await c.db.integration.delete({ where: { id } });
    c.adapters.evict(id);
    await c.audit.log({ workspaceId: ws(req), actorUserId: req.auth!.userId, action: 'integration.delete', entity: 'integration', entityId: id });
    return { ok: true };
  });

  app.post('/integrations/:id/check', { preHandler: guard('integration.manage') }, async (req) => {
    const c = ctx();
    const id = idOf(req);
    if (!(await c.db.integration.findFirst({ where: { id, workspaceId: ws(req) } }))) throw notFound('Integration');
    await c.heartbeat!.check(id);
    const row = await c.db.integration.findUniqueOrThrow({ where: { id }, include: { _count: { select: { agents: true } } } });
    await c.events.emit({ workspaceId: ws(req), type: 'integration.checked', source: { kind: 'user', ref: req.auth!.userId }, mode: row.mode, integrationId: id, params: { integration: row.name, status: row.status }, summary: `${row.name} checked: ${row.status}` });
    return integrationDTO(row);
  });

  app.get('/integrations/:id/discover', { preHandler: guard('integration.manage') }, async (req) => {
    const c = ctx();
    const row = await c.db.integration.findFirst({ where: { id: idOf(req), workspaceId: ws(req) } });
    if (!row) throw notFound('Integration');
    const r = await (await c.adapters.get(row)).listAgents();
    if (!r.ok) throw new ApiError(r.error.code === 'NOT_SUPPORTED' ? 'not_supported' : 'runtime_unreachable', r.error.message);
    return r.value;
  });
}
