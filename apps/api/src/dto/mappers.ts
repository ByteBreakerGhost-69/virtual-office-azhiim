import { ADAPTER_DESCRIPTORS } from '@avo/adapters';
import type {
  ApprovalDTO, IntegrationDTO, MemoryRecordDTO, MessageDTO, ProjectDTO, RunDTO, TaskDTO,
} from '@avo/shared';
import type { Prisma } from '../db.js';
import type { Agent, Approval, Department, Integration, Message, Project, Run, Task } from '../generated/prisma/client.js';

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export type IntegrationRow = Integration & { _count?: { agents: number } };
export function integrationDTO(r: IntegrationRow): IntegrationDTO {
  const d = ADAPTER_DESCRIPTORS[r.kind];
  return {
    id: r.id,
    kind: r.kind,
    mode: r.mode,
    name: r.name,
    baseUrl: r.baseUrl,
    hasSecret: !!r.encryptedSecret,
    status: r.status,
    lastCheckedAt: iso(r.lastCheckedAt),
    lastSuccessAt: iso(r.lastSuccessAt),
    lastError: r.lastError,
    capabilities: r.capabilities,
    features: d.features,
    agentCount: r._count?.agents ?? 0,
    createdAt: r.createdAt.toISOString(),
  };
}

export type TaskRow = Task & {
  project?: { name: string } | null;
  assignee?: { name: string } | null;
  createdBy?: { displayName: string } | null;
  dependencies?: { dependsOnId: string }[];
};
export function taskDTO(t: TaskRow): TaskDTO {
  return {
    id: t.id,
    code: t.taskNumber ? `TASK-${String(t.taskNumber).padStart(3, '0')}` : null,
    title: t.title,
    objective: t.objective,
    expectedOutput: t.expectedOutput,
    priority: t.priority,
    status: t.status,
    mode: t.mode,
    projectId: t.projectId,
    projectName: t.project?.name ?? null,
    assigneeAgentId: t.assigneeAgentId,
    assigneeName: t.assignee?.name ?? null,
    dependsOn: (t.dependencies ?? []).map((d) => d.dependsOnId),
    dueAt: iso(t.dueAt),
    blockedReason: t.blockedReason,
    requiresApproval: t.requiresApproval,
    currentRunId: t.currentRunId,
    createdByName: t.createdBy?.displayName ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export type RunRow = Run & { agent?: { name: string } | null };
export function runDTO(r: RunRow): RunDTO {
  return {
    id: r.id,
    traceId: r.traceId,
    taskId: r.taskId,
    agentId: r.agentId,
    agentName: r.agent?.name ?? '',
    mode: r.mode,
    state: r.state,
    attempt: r.attempt,
    planVersion: r.planVersion,
    plan: (r.planJson as Record<string, unknown> | null) ?? null,
    providerRunId: r.providerRunId,
    startedAt: iso(r.startedAt),
    finishedAt: iso(r.finishedAt),
    deadlineAt: iso(r.deadlineAt),
    failureReason: r.failureReason,
    resultSummary: r.resultSummary,
    outputs: (Array.isArray(r.outputs) ? r.outputs : []) as RunDTO['outputs'],
    usage: (r.usage as Record<string, unknown> | null) ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export type ApprovalRow = Approval & { agent?: { name: string } | null; taskTitle?: string | null };
export function approvalDTO(a: ApprovalRow): ApprovalDTO {
  return {
    id: a.id,
    status: a.status,
    taskId: a.taskId,
    taskTitle: a.taskTitle ?? null,
    runId: a.runId,
    agentId: a.agentId,
    agentName: a.agent?.name ?? '',
    mode: a.mode,
    actionCategory: a.actionCategory as ApprovalDTO['actionCategory'],
    target: a.target,
    argsSummary: a.argsSummary,
    payloadHash: a.payloadHash,
    risk: a.risk,
    consequence: a.consequence,
    requestedAt: a.requestedAt.toISOString(),
    expiresAt: a.expiresAt.toISOString(),
    decidedAt: iso(a.decidedAt),
    decidedBy: a.decidedById,
    reason: a.reason,
  };
}

export function messageDTO(m: Message): MessageDTO {
  return {
    id: m.id,
    taskId: m.taskId,
    runId: m.runId,
    fromKind: m.fromKind as MessageDTO['fromKind'],
    fromId: m.fromId,
    fromName: m.fromName,
    toKind: m.toKind as MessageDTO['toKind'],
    toId: m.toId,
    channel: m.channel,
    body: m.body,
    correlationId: m.correlationId,
    mode: m.mode,
    createdAt: m.createdAt.toISOString(),
  };
}

export function projectDTO(p: Project & { _count?: { tasks: number } }): ProjectDTO {
  return { id: p.id, name: p.name, description: p.description, status: p.status, taskCount: p._count?.tasks ?? 0, createdAt: p.createdAt.toISOString() };
}

export function memoryDTO(m: { id: string; scope: MemoryRecordDTO['scope']; scopeRefId: string | null; content: string; source: string; createdAt: Date }): MemoryRecordDTO {
  return { id: m.id, scope: m.scope, scopeRefId: m.scopeRefId, content: m.content, source: m.source, createdAt: m.createdAt.toISOString() };
}

export type { Agent, Department, Prisma };
