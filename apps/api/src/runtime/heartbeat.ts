import type { RuntimeEvent } from '@avo/adapters';
import type { AppContext } from '../context.js';
import type { Integration } from '../generated/prisma/client.js';
import { AGENT_INCLUDE } from '../modules/agents/agent-service.js';

/** Liveness comes ONLY from adapters (health checks / heartbeats). Nothing here can invent a state. */
export class HeartbeatService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly inflight = new Set<string>();
  private readonly nextDue = new Map<string, number>();

  constructor(private readonly ctx: () => AppContext) {}

  start(): void {
    if (this.timer) return;
    const c = this.ctx();
    c.adapters.onAdapterEvent((i, e) => void this.onAdapterEvent(i, e));
    this.timer = setInterval(() => void this.pollDue(), 1000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async pollDue(): Promise<void> {
    const c = this.ctx();
    const now = c.clock.now().getTime();
    const list = await c.db.integration.findMany();
    for (const i of list) {
      if ((this.nextDue.get(i.id) ?? 0) > now) continue;
      const s = await c.settings.get(i.workspaceId);
      this.nextDue.set(i.id, now + s.heartbeatIntervalMs);
      void this.check(i.id).catch((err) => c.log.error({ err }, 'heartbeat check failed'));
    }
  }

  /** Poll every integration once (tests call this directly). */
  async pollOnce(): Promise<void> {
    const list = await this.ctx().db.integration.findMany();
    for (const i of list) await this.check(i.id);
  }

  async check(integrationId: string): Promise<Integration | null> {
    if (this.inflight.has(integrationId)) return null;
    this.inflight.add(integrationId);
    try {
      const c = this.ctx();
      const integration = await c.db.integration.findUnique({ where: { id: integrationId } });
      if (!integration) return null;
      const adapter = await c.adapters.get(integration);
      const r = await adapter.healthCheck();
      const healthy = r.ok && r.value.ok;
      const now = c.clock.now();
      const detail = !r.ok ? r.error.message : r.value.ok ? null : r.value.detail ?? 'health check failed';
      const updated = await c.db.integration.update({
        where: { id: integration.id },
        data: {
          lastCheckedAt: now,
          status: healthy ? 'connected' : 'disconnected',
          lastError: healthy ? null : (detail ?? 'unreachable').slice(0, 300),
          ...(healthy ? { lastSuccessAt: now, capabilities: r.ok ? r.value.capabilities : [] } : {}),
        },
      });
      const was = integration.status;
      if (healthy && was !== 'connected') {
        await c.events.emit({ workspaceId: integration.workspaceId, type: 'integration.connected', source: { kind: 'system', ref: integration.id }, mode: integration.mode, integrationId: integration.id, params: { integration: integration.name }, summary: `${integration.name} connected` });
      } else if (!healthy && was !== 'disconnected') {
        await c.events.emit({ workspaceId: integration.workspaceId, type: 'integration.disconnected', source: { kind: 'system', ref: integration.id }, mode: integration.mode, integrationId: integration.id, severity: 'warn', params: { integration: integration.name, reason: detail ?? '' }, summary: `${integration.name} disconnected: ${detail ?? 'unreachable'}`, payload: { reason: detail } });
      }
      if (healthy) {
        await c.agents.touch({ integrationId: integration.id }, now);
        await c.db.agent.updateMany({
          where: { integrationId: integration.id, enabled: true, storedState: { in: ['registered', 'starting', 'unknown', 'offline'] } },
          data: { storedState: 'idle', stateSince: now, stateSource: integration.mode === 'SIMULATED' ? 'simulation' : 'runtime-health' },
        });
      }
      await this.refreshAgents(integration.id);
      if (healthy && was !== 'connected') await c.orchestrator.onIntegrationConnected(integration.id);
      return updated;
    } finally {
      this.inflight.delete(integrationId);
    }
  }

  private async refreshAgents(integrationId: string): Promise<void> {
    const c = this.ctx();
    const rows = await c.db.agent.findMany({ where: { integrationId }, include: AGENT_INCLUDE });
    for (const r of rows) await c.agents.refresh(r);
  }

  private async onAdapterEvent(integration: Integration, e: RuntimeEvent): Promise<void> {
    if (e.type !== 'agent.heartbeat') return;
    const c = this.ctx();
    await c.agents.touch({ integrationId: integration.id });
  }
}
