import type { AgentState, ActionCategory, RiskLevel, RuntimeKind } from '@avo/shared';

/**
 * Runtime adapter contract (AGENT_PROTOCOL 7).
 * Vendor protocols stay inside adapters. Nothing outside this package may import a vendor SDK
 * or know a vendor URL. Unsupported operations return NOT_SUPPORTED, never a fake success.
 */

export type AdapterErrorCode =
  | 'NOT_SUPPORTED'
  | 'NOT_IMPLEMENTED'
  | 'UNREACHABLE'
  | 'UNAUTHORIZED'
  | 'TIMEOUT'
  | 'REJECTED'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  /** Outcome unknown (e.g. timeout after sending). Caller must reconcile via getRun before retrying. */
  | 'AMBIGUOUS'
  | 'INVALID_RESPONSE';

export interface AdapterError {
  code: AdapterErrorCode;
  message: string;
  retryable: boolean;
  /** Provider request id, when the provider returned one (for audit). */
  providerRequestId?: string;
}

export type AdapterResult<T> = { ok: true; value: T } | { ok: false; error: AdapterError };
export const ok = <T>(value: T): AdapterResult<T> => ({ ok: true, value });
export const fail = (code: AdapterErrorCode, message: string, retryable = false, providerRequestId?: string): AdapterResult<never> => ({
  ok: false,
  error: providerRequestId ? { code, message, retryable, providerRequestId } : { code, message, retryable },
});

export interface AdapterFeatures {
  pause: boolean;
  resume: boolean;
  cancel: boolean;
  approvals: boolean;
  /** Provides a live per-run event stream. */
  eventStream: boolean;
}

export interface AdapterDescriptor {
  kind: RuntimeKind;
  label: string;
  /** false = declared for the architecture, but no working implementation yet. */
  available: boolean;
  /** true only for the scripted SIMULATED runtime. */
  simulated: boolean;
  features: AdapterFeatures;
  /** What the owner must provide to configure an integration of this kind. */
  config: { baseUrlRequired: boolean; secretRequired: boolean; baseUrlExample?: string };
  notes?: string;
}

export interface AdapterConfig {
  integrationId: string;
  baseUrl?: string | null;
  secret?: string | null;
  /** Per-call timeout. Every call has one (AGENT_PROTOCOL 8). */
  timeoutMs?: number;
}

export interface HealthReport {
  ok: boolean;
  latencyMs: number;
  checkedAt: string;
  detail?: string;
  /** Capabilities the runtime declares. A declaration is NOT a permission grant. */
  capabilities: string[];
}

export interface DiscoveredAgent {
  runtimeRef: string;
  displayName: string;
  description?: string;
  capabilities?: string[];
}

export interface DispatchInput {
  runId: string;
  taskId: string;
  traceId: string;
  /** Stable key so a retried dispatch cannot start the work twice. */
  idempotencyKey: string;
  runtimeRef: string | null;
  objective: string;
  expectedOutput?: string | null;
  deadlineAt?: string | null;
  allowedCapabilities: string[];
  /** Context lines for the agent (e.g. dependency outputs). Treated as data by the runtime. */
  context?: string[];
}

export interface DispatchOutput {
  providerRunId: string;
}

export type ProviderRunStatus = 'running' | 'stopping' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'unknown';

export interface ProviderRunSnapshot {
  providerRunId: string;
  status: ProviderRunStatus;
  output?: string | null;
  usage?: Record<string, unknown> | null;
  failureReason?: string | null;
}

export interface ApprovalRequestRef {
  requestId: string;
  executionGeneration?: number | string;
}

/**
 * Normalized runtime events (AGENT_PROTOCOL 6). Every event carries a timestamp and the adapter
 * never invents events: if the provider says nothing, nothing is emitted.
 */
export type RuntimeEvent =
  | { type: 'agent.heartbeat'; at: string; runtimeRef: string | null }
  | { type: 'agent.status'; at: string; runtimeRef: string | null; state: AgentState; note?: string }
  | { type: 'task.accepted'; at: string; providerRunId: string }
  | { type: 'task.progress'; at: string; providerRunId: string; kind: 'thinking' | 'tool' | 'message'; note: string; tool?: string; raw?: unknown }
  | { type: 'task.output'; at: string; providerRunId: string; content: string; final: boolean; raw?: unknown }
  | { type: 'task.completed'; at: string; providerRunId: string; summary: string; output?: string; usage?: Record<string, unknown>; raw?: unknown }
  | { type: 'task.failed'; at: string; providerRunId: string; reason: string; retryable: boolean; raw?: unknown }
  | { type: 'task.cancelled'; at: string; providerRunId: string; raw?: unknown }
  | { type: 'agent.message'; at: string; providerRunId?: string; fromRuntimeRef: string | null; toRuntimeRef: string | null; body: string; raw?: unknown }
  | {
      type: 'action.approval_required';
      at: string;
      providerRunId: string;
      requestRef: ApprovalRequestRef;
      category: ActionCategory;
      target: string;
      argsSummary: string;
      risk: RiskLevel;
      /** Raw payload used by the policy engine to bind the approval to the exact action (hashed). */
      payload: unknown;
      raw?: unknown;
    }
  | { type: 'runtime.disconnected'; at: string; reason: string; providerRunId?: string; raw?: unknown };

export type RuntimeEventHandler = (event: RuntimeEvent) => void;

export interface Subscription {
  close(): void;
}

export interface RuntimeAdapter {
  readonly kind: RuntimeKind;
  readonly descriptor: AdapterDescriptor;
  readonly config: AdapterConfig;

  connect(): Promise<AdapterResult<void>>;
  healthCheck(): Promise<AdapterResult<HealthReport>>;
  listAgents(): Promise<AdapterResult<DiscoveredAgent[]>>;

  dispatchTask(input: DispatchInput): Promise<AdapterResult<DispatchOutput>>;
  /** Source of truth for reconciliation after restarts/ambiguous timeouts. */
  getRun(providerRunId: string): Promise<AdapterResult<ProviderRunSnapshot>>;
  cancelRun(providerRunId: string): Promise<AdapterResult<void>>;
  decideApproval(
    providerRunId: string,
    requestRef: ApprovalRequestRef,
    decision: 'approve' | 'reject',
    reason?: string,
  ): Promise<AdapterResult<void>>;
  pauseAgent(runtimeRef: string | null): Promise<AdapterResult<void>>;
  resumeAgent(runtimeRef: string | null): Promise<AdapterResult<void>>;

  /** Stream one run's events. The adapter reconnects within reason; on give-up it emits runtime.disconnected. */
  watchRun(providerRunId: string, handler: RuntimeEventHandler): Subscription;
  /** Adapter-wide events not tied to a single run (the simulator emits heartbeats here). */
  subscribeEvents(handler: RuntimeEventHandler): Subscription;

  disconnect(): Promise<void>;
}

export class AdapterUnavailableError extends Error {
  constructor(public readonly kind: RuntimeKind, message: string) {
    super(message);
    this.name = 'AdapterUnavailableError';
  }
}

/** Minimal logger. Adapters never pass secrets or full bearer tokens to it. */
export interface AdapterLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export const noopLogger: AdapterLogger = { debug() {}, info() {}, warn() {}, error() {} };

/** Injectable dependencies (testability). All optional. */
export interface AdapterDeps {
  clock?: () => Date;
  /** Returns a float in [0,1). Used for backoff jitter. */
  random?: () => number;
  fetch?: typeof fetch;
  logger?: AdapterLogger;
  /** Adapter-specific tuning (e.g. reconnect timings, SimulatedAdapter seed/speed). */
  options?: Record<string, unknown>;
}
