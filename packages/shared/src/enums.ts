import { z } from 'zod';

/** Every enum used across API, adapters and UI lives here so all layers agree. */

export const RUNTIME_KINDS = ['HERMES', 'OPENCLAW', 'INTERNAL', 'SIMULATED'] as const;
export type RuntimeKind = (typeof RUNTIME_KINDS)[number];
export const RuntimeKindSchema = z.enum(RUNTIME_KINDS);

/** REAL = backed by a real runtime. SIMULATED = scripted demo data. They never mix. */
export const DATA_MODES = ['REAL', 'SIMULATED'] as const;
export type DataMode = (typeof DATA_MODES)[number];
export const DataModeSchema = z.enum(DATA_MODES);

/** Normalized agent lifecycle (PRD 7.3 + AGENT_PROTOCOL 3). */
export const AGENT_STATES = [
  'registered',
  'starting',
  'idle',
  'working',
  'thinking',
  'waiting',
  'blocked',
  'paused',
  'stopping',
  'stopped',
  'error',
  'offline',
  'unknown',
] as const;
export type AgentState = (typeof AGENT_STATES)[number];
export const AgentStateSchema = z.enum(AGENT_STATES);

export const TASK_STATUSES = [
  'created',
  'awaiting_assignment',
  'assigned',
  'running',
  'awaiting_approval',
  'blocked',
  'completed',
  'failed',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TaskStatusSchema = z.enum(TASK_STATUSES);

/** ORCHESTRATOR_SPEC 4. */
export const RUN_STATES = [
  'created',
  'planning',
  'awaiting_approval',
  'queued',
  'running',
  'verifying',
  'completed',
  'rejected',
  'blocked',
  'failed',
  'cancelled',
  'timed_out',
] as const;
export type RunState = (typeof RUN_STATES)[number];
export const RunStateSchema = z.enum(RUN_STATES);
export const TERMINAL_RUN_STATES: readonly RunState[] = [
  'completed',
  'rejected',
  'failed',
  'cancelled',
  'timed_out',
];
export const ACTIVE_RUN_STATES: readonly RunState[] = [
  'created',
  'planning',
  'awaiting_approval',
  'queued',
  'running',
  'verifying',
];

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PrioritySchema = z.enum(PRIORITIES);

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'expired'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export const ApprovalStatusSchema = z.enum(APPROVAL_STATUSES);

export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export const RiskLevelSchema = z.enum(RISK_LEVELS);

export const SEVERITIES = ['debug', 'info', 'warn', 'error', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SeveritySchema = z.enum(SEVERITIES);

/** Product roles (PRD 5). Enforced in the backend. */
export const USER_ROLES = ['OWNER', 'OPERATOR', 'OBSERVER'] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const UserRoleSchema = z.enum(USER_ROLES);

/** Organizational role of an agent (not a permission). */
export const ORG_ROLES = ['leader', 'manager', 'specialist', 'assistant'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
export const OrgRoleSchema = z.enum(ORG_ROLES);

export const INTEGRATION_STATUSES = ['unchecked', 'connected', 'degraded', 'disconnected'] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];
export const IntegrationStatusSchema = z.enum(INTEGRATION_STATUSES);

export const MEMORY_SCOPES = ['user', 'agent', 'department', 'project', 'workspace'] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];
export const MemoryScopeSchema = z.enum(MEMORY_SCOPES);

/** Structured capability identifiers (AGENT_PROTOCOL 4). A declaration is not a permission. */
export const KNOWN_CAPABILITIES = [
  'text.generate',
  'code.write',
  'code.execute',
  'web.search',
  'web.browse',
  'file.read',
  'file.write',
  'terminal.execute',
  'github.issue.create',
] as const;

export const ACTION_CATEGORIES = [
  'external.publish',
  'financial',
  'destructive',
  'deployment',
  'permission.change',
  'security.config',
  'tool.execute',
  'out_of_scope',
] as const;
export type ActionCategory = (typeof ACTION_CATEGORIES)[number];
export const ActionCategorySchema = z.enum(ACTION_CATEGORIES);

/** Company employment lifecycle (PRD employee-management 7.2). `null` on an agent = not hired as an employee. */
export const EMPLOYMENT_STATUSES = ['PENDING_ONBOARDING', 'ACTIVE', 'SUSPENDED', 'OFFBOARDING', 'ARCHIVED'] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];
export const EmploymentStatusSchema = z.enum(EMPLOYMENT_STATUSES);

/** Preset avatars (deterministic procedural looks). Selecting one overrides the seed-derived look. */
export const AVATAR_IDS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'] as const;
export type AvatarId = (typeof AVATAR_IDS)[number];
