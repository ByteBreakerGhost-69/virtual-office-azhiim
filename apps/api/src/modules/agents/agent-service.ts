import { ADAPTER_DESCRIPTORS } from '@avo/adapters';
import {
  effectiveAgentState, resolvePlacement,
  type AgentDTO, type AgentState, type RoomKey, type SettingsDTO,
} from '@avo/shared';
import type { Db } from '../../db.js';
import type { Agent, Department, Integration } from '../../generated/prisma/client.js';
import type { Hub } from '../../realtime/hub.js';
import type { EventService } from '../../events/event-service.js';
import type { Clock } from '../../lib/util.js';
import type { SettingsService } from '../settings/settings-service.js';

export type AgentRow = Agent & {
  integration: Integration;
  department: Department | null;
  currentTask: { id: string; title: string } | null;
};
export const AGENT_INCLUDE = { integration: true, department: true, currentTask: { select: { id: true, title: true } } } as const;

type Talk = { at: string; kind: 'message' | 'meeting' };

/** Owns the *truthful* agent view: stored runtime state -> effective state -> placement -> DTO. */
export class AgentService {
  private readonly lastSig = new Map<string, string>();
  private readonly lastEffective = new Map<string, AgentState>();
  private readonly talk = new Map<string, Talk>();

  constructor(
    private readonly db: Db,
    private readonly hub: Hub,
    private readonly events: EventService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
  ) {}

  toDTO(row: AgentRow, s: SettingsDTO): AgentDTO {
    const now = this.clock.now();
    const connected = row.integration.status === 'connected' || row.integration.status === 'degraded';
    const eff = effectiveAgentState({
      storedState: row.storedState,
      mode: row.mode,
      lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
      integrationConnected: connected,
      enabled: row.enabled,
      now,
      thresholds: s,
    });
    const talk = this.talk.get(row.id) ?? null;
    const placement = resolvePlacement({
      effective: eff.state,
      homeRoom: row.homeRoom as RoomKey,
      stateSince: row.stateSince ? row.stateSince.toISOString() : null,
      now,
      recentTalk: talk,
      thresholds: s,
    });
    const features = ADAPTER_DESCRIPTORS[row.integration.kind].features;
    return {
      id: row.id,
      name: row.name,
      handle: row.handle,
      title: row.title,
      mode: row.mode,
      runtimeKind: row.integration.kind,
      integrationId: row.integrationId,
      integrationName: row.integration.name,
      integrationStatus: row.integration.status,
      runtimeRef: row.runtimeRef,
      departmentId: row.departmentId,
      departmentKey: row.department?.key ?? null,
      departmentName: row.department?.name ?? null,
      departmentColor: row.department?.color ?? null,
      orgRole: row.orgRole,
      reportsToAgentId: row.reportsToAgentId,
      enabled: row.enabled,
      storedState: row.storedState,
      state: eff.state,
      stale: eff.stale,
      stateReason: eff.reason,
      stateSince: row.stateSince ? row.stateSince.toISOString() : null,
      stateSource: row.stateSource,
      lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
      currentTaskId: row.currentTaskId,
      currentTaskTitle: row.currentTask?.title ?? null,
      capabilities: row.capabilities,
      permissions: row.permissions,
      appearanceSeed: row.appearanceSeed,
      employeeCode: row.employeeCode,
      employmentStatus: row.employmentStatus,
      avatarId: row.avatarId,
      responsibilities: row.responsibilities,
      homeRoom: row.homeRoom as RoomKey,
      placement,
      activityNote: row.activityNote,
      supports: { pause: features.pause, resume: features.resume, cancel: features.cancel },
      createdAt: row.createdAt.toISOString(),
    };
  }

  async load(workspaceId: string, id: string): Promise<AgentRow | null> {
    return this.db.agent.findFirst({ where: { id, workspaceId }, include: AGENT_INCLUDE });
  }

  async dto(workspaceId: string, id: string): Promise<AgentDTO | null> {
    const row = await this.load(workspaceId, id);
    return row ? this.toDTO(row, await this.settings.get(workspaceId)) : null;
  }

  private signature(d: AgentDTO): string {
    return [d.state, d.stale, d.placement.room, d.placement.pose, d.placement.overlay, d.activityNote, d.currentTaskId, d.enabled, d.integrationStatus, d.departmentId, d.orgRole, d.name, d.title, d.reportsToAgentId, d.placement.reason.code, d.capabilities.join(','), d.permissions.join(','), d.employeeCode, d.employmentStatus, d.avatarId].join('|');
  }

  /** Recompute one agent; broadcast if anything visible changed; record state transitions as events. */
  async refresh(row: AgentRow, opts: { force?: boolean } = {}): Promise<AgentDTO> {
    const s = await this.settings.get(row.workspaceId);
    const dto = this.toDTO(row, s);
    const sig = this.signature(dto);
    const prevEff = this.lastEffective.get(row.id);
    if (opts.force || this.lastSig.get(row.id) !== sig) {
      this.lastSig.set(row.id, sig);
      this.hub.broadcast(row.workspaceId, { type: 'agent', agent: dto });
    }
    if (prevEff !== undefined && prevEff !== dto.state) {
      const downgrade = dto.stale;
      await this.events.emit({
        workspaceId: row.workspaceId,
        type: 'agent.status.changed',
        source: { kind: downgrade ? 'system' : row.mode === 'SIMULATED' ? 'simulation' : 'runtime', ref: row.integrationId },
        mode: row.mode,
        agentId: row.id,
        severity: dto.state === 'error' ? 'error' : downgrade ? 'warn' : 'info',
        messageKey: 'events.agent.status.changed',
        params: { agent: row.name, from: prevEff, to: dto.state },
        summary: `${row.name}: ${prevEff} → ${dto.state}`,
        payload: { reason: dto.stateReason, stale: dto.stale },
      });
    }
    this.lastEffective.set(row.id, dto.state);
    return dto;
  }

  async refreshById(workspaceId: string, id: string): Promise<AgentDTO | null> {
    const row = await this.load(workspaceId, id);
    return row ? this.refresh(row) : null;
  }

  /** The 2-second ticker: catches stale/offline downgrades and rest/talk window expiry. */
  async tick(): Promise<void> {
    const rows = await this.db.agent.findMany({ include: AGENT_INCLUDE });
    for (const r of rows) await this.refresh(r);
  }

  forget(agentId: string): void {
    this.lastSig.delete(agentId);
    this.lastEffective.delete(agentId);
    this.talk.delete(agentId);
  }

  // ----- mutations that only the runtime / orchestrator may trigger -----

  /** Runtime proved it is alive. This is the ONLY way lastSeenAt moves. */
  async touch(where: { integrationId?: string; agentId?: string }, at: Date = this.clock.now()): Promise<void> {
    await this.db.agent.updateMany({ where: { ...(where.integrationId ? { integrationId: where.integrationId } : {}), ...(where.agentId ? { id: where.agentId } : {}), enabled: true }, data: { lastSeenAt: at } });
  }

  /** Move storedState (what the runtime reported). Keeps stateSince only when the state really changes. */
  async setStored(agentId: string, state: AgentState, info: { source: string; note?: string | null }): Promise<void> {
    const cur = await this.db.agent.findUnique({ where: { id: agentId }, select: { storedState: true } });
    if (!cur) return;
    const changed = cur.storedState !== state;
    await this.db.agent.update({
      where: { id: agentId },
      data: {
        storedState: state,
        stateSource: info.source,
        ...(changed ? { stateSince: this.clock.now() } : {}),
        ...(info.note !== undefined ? { activityNote: info.note } : {}),
      },
    });
  }

  markTalk(agentId: string, kind: 'message' | 'meeting'): void {
    this.talk.set(agentId, { at: this.clock.now().toISOString(), kind });
  }
}
