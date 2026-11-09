import type { FastifyInstance } from 'fastify';
import { ExecuteCommandBodySchema, OwnerPositionBodySchema, ROOM_KEYS, type CommandMeta } from '@avo/shared';
import type { AppContext } from '../../context.js';
import { ApiError } from '../../lib/errors.js';
import { newId, parse } from '../../lib/util.js';
import type { Guard } from '../auth/guard.js';
import { metaOf, REGISTRY } from './registry.js';
import { TerminalService } from './service.js';

export function registerTerminalRoutes(app: FastifyInstance, ctx: () => AppContext, guard: Guard): void {
  const svc = new TerminalService(ctx);
  const ws = (req: { auth?: { workspaceId: string } }) => req.auth!.workspaceId;

  // Command metadata drives autocomplete + help in the UI. Visible to every signed-in role; execution is still authorized per command.
  app.get('/terminal/commands', { preHandler: guard('view') }, async (): Promise<CommandMeta[]> => REGISTRY.map(metaOf));

  // Observers may *run* read-only commands, so this route only needs a session; the executor enforces each command's action.
  app.post('/terminal/execute', { preHandler: guard() }, async (req) => {
    const b = parse(ExecuteCommandBodySchema, req.body);
    return svc.execute(ws(req), { userId: req.auth!.userId, role: req.auth!.role }, b.input);
  });

  app.get('/terminal/history', { preHandler: guard('view') }, async (req) => {
    const limit = Number((req.query as { limit?: string }).limit ?? 100);
    return svc.history(ws(req), req.auth!.userId, Number.isFinite(limit) ? limit : 100);
  });

  // ---- owner avatar checkpoint (resting position only; never per frame)
  app.get('/office/position', { preHandler: guard('view') }, async (req) => {
    const row = await ctx().db.characterPosition.findUnique({ where: { workspaceId_userId: { workspaceId: ws(req), userId: req.auth!.userId } } });
    return row ? { room: row.room, x: row.x, y: row.y, direction: row.direction, updatedAt: row.updatedAt.toISOString() } : null;
  });

  app.put('/office/position', { preHandler: guard('view') }, async (req) => {
    const c = ctx();
    const b = parse(OwnerPositionBodySchema, req.body);
    if (!(ROOM_KEYS as readonly string[]).includes(b.room)) throw new ApiError('validation_error', `Unknown room "${b.room}"`);
    const where = { workspaceId_userId: { workspaceId: ws(req), userId: req.auth!.userId } };
    const prev = await c.db.characterPosition.findUnique({ where });
    const row = await c.db.characterPosition.upsert({ where, create: { id: newId(), workspaceId: ws(req), userId: req.auth!.userId, room: b.room, x: b.x, y: b.y, direction: b.direction }, update: { room: b.room, x: b.x, y: b.y, direction: b.direction } });
    if (prev && prev.room !== b.room) {
      await c.events.emit({ workspaceId: ws(req), type: 'office.room_changed', source: { kind: 'user', ref: req.auth!.userId }, mode: 'REAL', params: { from: prev.room, to: b.room }, summary: `Owner moved from ${prev.room} to ${b.room}` });
    }
    return { room: row.room, x: row.x, y: row.y, direction: row.direction, updatedAt: row.updatedAt.toISOString() };
  });
}
