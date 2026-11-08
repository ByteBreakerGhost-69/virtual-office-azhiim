import { Prisma, type Db } from '../../db.js';
import { newId } from '../../lib/util.js';

export class AuditService {
  constructor(private readonly db: Db) {}
  async log(e: { workspaceId?: string | null; actorUserId?: string | null; action: string; entity?: string; entityId?: string; traceId?: string; ip?: string; details?: Record<string, unknown> }): Promise<void> {
    await this.db.auditLog.create({
      data: {
        id: newId(),
        workspaceId: e.workspaceId ?? null,
        actorUserId: e.actorUserId ?? null,
        action: e.action,
        entity: e.entity ?? null,
        entityId: e.entityId ?? null,
        traceId: e.traceId ?? null,
        ip: e.ip ?? null,
        details: (e.details ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}
