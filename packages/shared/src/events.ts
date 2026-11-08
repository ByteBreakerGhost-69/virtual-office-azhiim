import { z } from 'zod';
import { DataModeSchema, SeveritySchema } from './enums.js';

export const EVENT_SCHEMA_VERSION = 1;

export const EVENT_TYPES = [
  'agent.registered',
  'agent.updated',
  'agent.removed',
  'agent.status.changed',
  'agent.message',
  'task.created',
  'task.assigned',
  'task.started',
  'task.progress',
  'task.output',
  'task.blocked',
  'task.completed',
  'task.failed',
  'task.cancelled',
  'run.state.changed',
  'approval.requested',
  'approval.decided',
  'approval.expired',
  'integration.connected',
  'integration.disconnected',
  'integration.checked',
  'control.emergency_stop',
  'control.dispatch_resumed',
  'simulation.seeded',
  'simulation.cleared',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const EventTypeSchema = z.enum(EVENT_TYPES);

/** Who produced the event. A UI status must always be traceable to one of these. */
export const EventSourceSchema = z.object({
  kind: z.enum(['runtime', 'orchestrator', 'user', 'system', 'simulation']),
  /** e.g. integration id, user id, adapter name */
  ref: z.string().optional(),
});
export type EventSource = z.infer<typeof EventSourceSchema>;

/** Append-only domain event envelope (ARCHITECTURE 5). */
export const DomainEventSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  type: EventTypeSchema,
  schemaVersion: z.literal(EVENT_SCHEMA_VERSION),
  occurredAt: z.iso.datetime(),
  source: EventSourceSchema,
  mode: DataModeSchema,
  agentId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  runId: z.string().nullable().optional(),
  integrationId: z.string().nullable().optional(),
  traceId: z.string(),
  correlationId: z.string().nullable().optional(),
  severity: SeveritySchema,
  /** i18n key (see apps/web i18n `events.*`) + params; `summary` is an English fallback. */
  messageKey: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  summary: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type DomainEvent = z.infer<typeof DomainEventSchema>;

/** Messages the WebSocket gateway sends to an authenticated client. */
export type WsServerMessage =
  | { type: 'hello'; serverTime: string; workspaceId: string }
  | { type: 'event'; event: DomainEvent }
  /** Full, truthful snapshot of one agent after any change (including stale/offline transitions). */
  | { type: 'agent'; agent: import('./dto.js').AgentDTO }
  | { type: 'agent.removed'; agentId: string }
  | { type: 'ping'; serverTime: string };
