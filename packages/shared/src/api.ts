import { z } from 'zod';
import {
  ActionCategorySchema,
  OrgRoleSchema,
  PrioritySchema,
  RuntimeKindSchema,
  SeveritySchema,
} from './enums.js';
import { ROOM_KEYS } from './placement.js';
import { SettingsDTOSchema } from './dto.js';

export const API_PREFIX = '/api/v1';
export const SESSION_COOKIE = 'avo_session';
export const CSRF_HEADER = 'x-csrf-token';

const slug = z.string().min(2).max(40).regex(/^[a-z0-9][a-z0-9_-]*$/i, 'letters, numbers, - and _ only');

export const SetupBodySchema = z.object({
  username: z.string().min(3).max(40).regex(/^[a-zA-Z0-9_.-]+$/),
  displayName: z.string().min(1).max(80).optional(),
  password: z.string().min(12, 'at least 12 characters').max(200),
  workspaceName: z.string().min(1).max(80).optional(),
});
export const LoginBodySchema = z.object({ username: z.string().min(1).max(80), password: z.string().min(1).max(200) });

export const CreateIntegrationBodySchema = z.object({
  kind: RuntimeKindSchema,
  name: z.string().min(1).max(80),
  baseUrl: z.string().url().max(300).optional(),
  /** API key / bearer token. Stored encrypted; never returned. */
  secret: z.string().min(1).max(500).optional(),
});
export const UpdateIntegrationBodySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  baseUrl: z.string().url().max(300).optional(),
  secret: z.string().min(1).max(500).optional(),
});

export const RegisterAgentBodySchema = z.object({
  integrationId: z.string(),
  runtimeRef: z.string().max(120).optional(),
  name: z.string().min(1).max(80),
  handle: slug,
  title: z.string().min(1).max(80),
  departmentId: z.string().nullable().optional(),
  orgRole: OrgRoleSchema.default('specialist'),
  reportsToAgentId: z.string().nullable().optional(),
  capabilities: z.array(z.string().max(60)).max(40).default([]),
  permissions: z.array(z.string().max(60)).max(40).default([]),
  homeRoom: z.enum(ROOM_KEYS).optional(),
});
export const UpdateAgentBodySchema = RegisterAgentBodySchema.partial().omit({ integrationId: true });
export const AssignmentBodySchema = z.object({
  departmentId: z.string().nullable(),
  orgRole: OrgRoleSchema,
  title: z.string().min(1).max(80).optional(),
  reportsToAgentId: z.string().nullable().optional(),
});

export const CreateTaskBodySchema = z.object({
  title: z.string().min(1).max(160),
  objective: z.string().min(1).max(8000),
  expectedOutput: z.string().max(2000).optional(),
  priority: PrioritySchema.default('normal'),
  assigneeAgentId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  dependsOn: z.array(z.string()).max(20).default([]),
  dueAt: z.iso.datetime().nullable().optional(),
  /** Owner can require a human approval before the run starts. */
  requiresApproval: z.boolean().default(false),
  /** Capabilities the assignee must declare (checked by the orchestrator eligibility rules). */
  requiredCapabilities: z.array(z.string().max(60)).max(20).default([]),
});
export const UpdateTaskBodySchema = CreateTaskBodySchema.partial();
export const AssignTaskBodySchema = z.object({ agentId: z.string() });

export const DecideApprovalBodySchema = z.object({
  /** Hash the user saw; the server rejects the decision if the stored payload no longer matches. */
  payloadHash: z.string().optional(),
  decision: z.enum(['approve', 'reject']),
  reason: z.string().max(1000).optional(),
});

export const UpdateSettingsBodySchema = SettingsDTOSchema.partial();

export const CreateProjectBodySchema = z.object({ name: z.string().min(1).max(100), description: z.string().max(1000).optional() });
export const CreateMemoryBodySchema = z.object({
  scope: z.enum(['user', 'agent', 'department', 'project', 'workspace']),
  scopeRefId: z.string().nullable().optional(),
  content: z.string().min(1).max(4000),
});

export const ActivityQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  agentId: z.string().optional(),
  taskId: z.string().optional(),
  severity: SeveritySchema.optional(),
  mode: z.enum(['REAL', 'SIMULATED']).optional(),
});

export const ActionCategoryOptions = ActionCategorySchema.options;

/** Error body shape for every non-2xx response. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
