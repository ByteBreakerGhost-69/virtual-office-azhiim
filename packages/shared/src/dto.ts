import { z } from 'zod';
import {
  EmploymentStatusSchema,
  AgentStateSchema,
  ApprovalStatusSchema,
  DataModeSchema,
  IntegrationStatusSchema,
  MemoryScopeSchema,
  OrgRoleSchema,
  PrioritySchema,
  RiskLevelSchema,
  RunStateSchema,
  RuntimeKindSchema,
  TaskStatusSchema,
  UserRoleSchema,
  ActionCategorySchema,
} from './enums.js';
import { ROOM_KEYS, OVERLAYS, POSES } from './placement.js';

const iso = z.iso.datetime();
const RoomKeySchema = z.enum(ROOM_KEYS);

export const ReasonSchema = z.object({
  code: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});

export const PlacementSchema = z.object({
  room: RoomKeySchema,
  pose: z.enum(POSES),
  overlay: z.enum(OVERLAYS).nullable(),
  reason: ReasonSchema,
});

export const UserDTOSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  role: UserRoleSchema,
  locale: z.string(),
});
export type UserDTO = z.infer<typeof UserDTOSchema>;

export const DepartmentDTOSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  color: z.string(),
  homeRoom: RoomKeySchema,
});
export type DepartmentDTO = z.infer<typeof DepartmentDTOSchema>;

export const IntegrationDTOSchema = z.object({
  id: z.string(),
  kind: RuntimeKindSchema,
  mode: DataModeSchema,
  name: z.string(),
  baseUrl: z.string().nullable(),
  /** The secret itself is never returned. Only whether one is stored. */
  hasSecret: z.boolean(),
  status: IntegrationStatusSchema,
  lastCheckedAt: iso.nullable(),
  lastSuccessAt: iso.nullable(),
  lastError: z.string().nullable(),
  capabilities: z.array(z.string()),
  /** Adapter metadata: what this adapter can really do. */
  features: z.object({
    pause: z.boolean(),
    resume: z.boolean(),
    cancel: z.boolean(),
    approvals: z.boolean(),
    eventStream: z.boolean(),
  }),
  agentCount: z.number().int(),
  createdAt: iso,
});
export type IntegrationDTO = z.infer<typeof IntegrationDTOSchema>;

export const AgentDTOSchema = z.object({
  id: z.string(),
  name: z.string(),
  handle: z.string(),
  title: z.string(),
  mode: DataModeSchema,
  runtimeKind: RuntimeKindSchema,
  integrationId: z.string(),
  integrationName: z.string(),
  integrationStatus: IntegrationStatusSchema,
  /** Provider-side identifier (e.g. Hermes profile). Not interchangeable with `id`. */
  runtimeRef: z.string().nullable(),
  departmentId: z.string().nullable(),
  departmentKey: z.string().nullable(),
  departmentName: z.string().nullable(),
  departmentColor: z.string().nullable(),
  orgRole: OrgRoleSchema,
  reportsToAgentId: z.string().nullable(),
  enabled: z.boolean(),
  /** What the runtime last reported. */
  storedState: AgentStateSchema,
  /** What we are willing to show (downgraded to unknown/offline when data is stale). */
  state: AgentStateSchema,
  stale: z.boolean(),
  stateReason: ReasonSchema,
  stateSince: iso.nullable(),
  stateSource: z.string(),
  lastSeenAt: iso.nullable(),
  currentTaskId: z.string().nullable(),
  currentTaskTitle: z.string().nullable(),
  capabilities: z.array(z.string()),
  permissions: z.array(z.string()),
  appearanceSeed: z.string(),
  /** Company identity layer. `employeeCode` null = a runtime agent that is not yet an employee. */
  employeeCode: z.string().nullable(),
  employmentStatus: EmploymentStatusSchema.nullable(),
  avatarId: z.string().nullable(),
  responsibilities: z.array(z.string()),
  homeRoom: RoomKeySchema,
  placement: PlacementSchema,
  /** Latest human-readable activity line coming from the runtime (e.g. "tool: web.search"). */
  activityNote: z.string().nullable(),
  supports: z.object({ pause: z.boolean(), resume: z.boolean(), cancel: z.boolean() }),
  createdAt: iso,
});
export type AgentDTO = z.infer<typeof AgentDTOSchema>;

export const ApprovalDTOSchema = z.object({
  id: z.string(),
  status: ApprovalStatusSchema,
  taskId: z.string().nullable(),
  taskTitle: z.string().nullable(),
  runId: z.string().nullable(),
  agentId: z.string(),
  agentName: z.string(),
  mode: DataModeSchema,
  actionCategory: ActionCategorySchema,
  target: z.string(),
  argsSummary: z.string(),
  payloadHash: z.string(),
  risk: RiskLevelSchema,
  consequence: z.string(),
  requestedAt: iso,
  expiresAt: iso,
  decidedAt: iso.nullable(),
  decidedBy: z.string().nullable(),
  reason: z.string().nullable(),
});
export type ApprovalDTO = z.infer<typeof ApprovalDTOSchema>;

export const RunDTOSchema = z.object({
  id: z.string(),
  traceId: z.string(),
  taskId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  mode: DataModeSchema,
  state: RunStateSchema,
  attempt: z.number().int(),
  planVersion: z.number().int(),
  plan: z.record(z.string(), z.unknown()).nullable(),
  providerRunId: z.string().nullable(),
  startedAt: iso.nullable(),
  finishedAt: iso.nullable(),
  deadlineAt: iso.nullable(),
  failureReason: z.string().nullable(),
  resultSummary: z.string().nullable(),
  outputs: z.array(z.object({ kind: z.string(), name: z.string().optional(), content: z.string().optional() })),
  usage: z.record(z.string(), z.unknown()).nullable(),
  createdAt: iso,
});
export type RunDTO = z.infer<typeof RunDTOSchema>;

export const MessageDTOSchema = z.object({
  id: z.string(),
  taskId: z.string().nullable(),
  runId: z.string().nullable(),
  fromKind: z.enum(['user', 'agent', 'system']),
  fromId: z.string().nullable(),
  fromName: z.string(),
  toKind: z.enum(['user', 'agent', 'system', 'broadcast']),
  toId: z.string().nullable(),
  channel: z.string(),
  body: z.string(),
  correlationId: z.string().nullable(),
  mode: DataModeSchema,
  createdAt: iso,
});
export type MessageDTO = z.infer<typeof MessageDTOSchema>;

export const TaskDTOSchema = z.object({
  id: z.string(),
  /** Human-friendly reference (TASK-001); null only for rows that predate numbering. */
  code: z.string().nullable(),
  title: z.string(),
  objective: z.string(),
  expectedOutput: z.string().nullable(),
  priority: PrioritySchema,
  status: TaskStatusSchema,
  mode: DataModeSchema,
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  assigneeAgentId: z.string().nullable(),
  assigneeName: z.string().nullable(),
  dependsOn: z.array(z.string()),
  dueAt: iso.nullable(),
  blockedReason: z.string().nullable(),
  requiresApproval: z.boolean(),
  currentRunId: z.string().nullable(),
  createdByName: z.string().nullable(),
  createdAt: iso,
  updatedAt: iso,
});
export type TaskDTO = z.infer<typeof TaskDTOSchema>;

export const ProjectDTOSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(['active', 'archived']),
  taskCount: z.number().int(),
  createdAt: iso,
});
export type ProjectDTO = z.infer<typeof ProjectDTOSchema>;

export const MemoryRecordDTOSchema = z.object({
  id: z.string(),
  scope: MemoryScopeSchema,
  scopeRefId: z.string().nullable(),
  content: z.string(),
  source: z.string(),
  createdAt: iso,
});
export type MemoryRecordDTO = z.infer<typeof MemoryRecordDTOSchema>;

export const OverviewDTOSchema = z.object({
  generatedAt: iso,
  windowSeconds: z.number().int(),
  agentsByState: z.record(z.string(), z.number().int()),
  agentsByMode: z.record(z.string(), z.number().int()),
  tasksByStatus: z.record(z.string(), z.number().int()),
  pendingApprovals: z.number().int(),
  activeRuns: z.number().int(),
  integrations: z.array(z.object({ id: z.string(), name: z.string(), kind: RuntimeKindSchema, mode: DataModeSchema, status: IntegrationStatusSchema, lastSuccessAt: iso.nullable() })),
  dispatchPaused: z.boolean(),
});
export type OverviewDTO = z.infer<typeof OverviewDTOSchema>;

export const SettingsDTOSchema = z.object({
  staleAfterMs: z.number().int().min(2000),
  offlineAfterMs: z.number().int().min(5000),
  restAfterIdleMs: z.number().int().min(10_000),
  talkWindowMs: z.number().int().min(2000),
  runDeadlineMs: z.number().int().min(10_000),
  approvalTtlMs: z.number().int().min(10_000),
  heartbeatIntervalMs: z.number().int().min(2000),
  maxConcurrentRunsPerAgent: z.number().int().min(1).max(10),
  dispatchPaused: z.boolean(),
  defaultLocale: z.enum(['id', 'en']),
});
export type SettingsDTO = z.infer<typeof SettingsDTOSchema>;

export const DEFAULT_SETTINGS: SettingsDTO = {
  staleAfterMs: 15_000,
  offlineAfterMs: 60_000,
  restAfterIdleMs: 120_000,
  talkWindowMs: 20_000,
  runDeadlineMs: 10 * 60_000,
  approvalTtlMs: 10 * 60_000,
  heartbeatIntervalMs: 5_000,
  maxConcurrentRunsPerAgent: 1,
  dispatchPaused: false,
  defaultLocale: 'id',
};

export const OrganizationDTOSchema = z.object({
  departments: z.array(DepartmentDTOSchema.extend({ agentIds: z.array(z.string()) })),
  unassignedAgentIds: z.array(z.string()),
});
export type OrganizationDTO = z.infer<typeof OrganizationDTOSchema>;

export const PageSchema = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable() });
