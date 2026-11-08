import type { DataMode, DomainEvent, EventSource, EventType, Severity } from '@avo/shared';
import { EVENT_SCHEMA_VERSION } from '@avo/shared';
import { Prisma, type Db } from '../db.js';
import type { Hub } from '../realtime/hub.js';
import { newId, type Clock } from '../lib/util.js';

export interface EmitInput {
  workspaceId: string;
  type: EventType;
  source: EventSource;
  mode: DataMode;
  summary: string;
  messageKey?: string;
  params?: Record<string, string | number | boolean | null>;
  severity?: Severity;
  agentId?: string | null;
  taskId?: string | null;
  runId?: string | null;
  integrationId?: string | null;
  traceId?: string;
  correlationId?: string | null;
  payload?: Record<string, unknown>;
  occurredAt?: Date;
}

export function rowToEvent(r: {
  id: string; workspaceId: string; type: string; schemaVersion: number; occurredAt: Date; sourceKind: string; sourceRef: string | null;
  mode: DataMode; agentId: string | null; taskId: string | null; runId: string | null; integrationId: string | null; traceId: string;
  correlationId: string | null; severity: Severity; messageKey: string; params: Prisma.JsonValue; summary: string; payload: Prisma.JsonValue;
}): DomainEvent {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    type: r.type as EventType,
    schemaVersion: EVENT_SCHEMA_VERSION,
    occurredAt: r.occurredAt.toISOString(),
    source: { kind: r.sourceKind as EventSource['kind'], ...(r.sourceRef ? { ref: r.sourceRef } : {}) },
    mode: r.mode,
    agentId: r.agentId,
    taskId: r.taskId,
    runId: r.runId,
    integrationId: r.integrationId,
    traceId: r.traceId,
    correlationId: r.correlationId,
    severity: r.severity,
    messageKey: r.messageKey,
    params: (r.params ?? {}) as DomainEvent['params'],
    summary: r.summary,
    payload: (r.payload ?? {}) as Record<string, unknown>,
  };
}

/** Persist first, then broadcast (ARCHITECTURE 6: events are the durable record, the socket is a courtesy). */
export class EventService {
  constructor(private readonly db: Db, private readonly hub: Hub, private readonly clock: Clock) {}

  async emit(i: EmitInput): Promise<DomainEvent> {
    const row = await this.db.activityEvent.create({
      data: {
        id: newId(),
        workspaceId: i.workspaceId,
        type: i.type,
        schemaVersion: EVENT_SCHEMA_VERSION,
        occurredAt: i.occurredAt ?? this.clock.now(),
        sourceKind: i.source.kind,
        sourceRef: i.source.ref ?? null,
        mode: i.mode,
        agentId: i.agentId ?? null,
        taskId: i.taskId ?? null,
        runId: i.runId ?? null,
        integrationId: i.integrationId ?? null,
        traceId: i.traceId ?? newId(),
        correlationId: i.correlationId ?? null,
        severity: i.severity ?? 'info',
        messageKey: i.messageKey ?? `events.${i.type}`,
        params: (i.params ?? {}) as Prisma.InputJsonValue,
        summary: i.summary,
        payload: (i.payload ?? {}) as Prisma.InputJsonValue,
      },
    });
    const event = rowToEvent(row);
    this.hub.broadcast(i.workspaceId, { type: 'event', event });
    return event;
  }
}
