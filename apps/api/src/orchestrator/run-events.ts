import type { RuntimeEvent } from '@avo/adapters';
import type { AppContext } from '../context.js';
import { Prisma } from '../db.js';
import { TERMINAL_RUN_STATES } from '@avo/shared';
import { newId } from '../lib/util.js';
import type { Orchestrator } from './orchestrator.js';

/** Maps normalized RuntimeEvents to agent state, run transitions, messages, approvals and DomainEvents. */
export class RunEventProcessor {
  constructor(private readonly ctx: () => AppContext, private readonly orch: Orchestrator) {}

  async handle(runId: string, e: RuntimeEvent): Promise<void> {
    const c = this.ctx();
    const run = await this.orch.loadRun(runId);
    if (!run || TERMINAL_RUN_STATES.includes(run.state)) return;
    const sim = run.mode === 'SIMULATED';
    const source = sim ? 'simulation' : `runtime:${run.agent.integration.kind.toLowerCase()}`;
    const evSource = { kind: sim ? ('simulation' as const) : ('runtime' as const), ref: run.agent.integrationId };
    const base = { workspaceId: run.workspaceId, mode: run.mode, agentId: run.agentId, taskId: run.taskId, runId, traceId: run.traceId, source: evSource };
    // Any event from the runtime proves it is alive.
    if (e.type !== 'runtime.disconnected') await c.agents.touch({ agentId: run.agentId });

    switch (e.type) {
      case 'task.accepted':
        await c.agents.setStored(run.agentId, 'thinking', { source, note: 'Task accepted' });
        break;
      case 'task.progress': {
        await c.agents.setStored(run.agentId, e.kind === 'tool' ? 'working' : 'thinking', { source, note: e.note });
        await c.events.emit({ ...base, type: 'task.progress', severity: 'debug', params: { agent: run.agent.name, note: e.note, kind: e.kind, tool: e.tool ?? null }, summary: `${run.agent.name}: ${e.note}`, payload: { kind: e.kind, tool: e.tool ?? null } });
        break;
      }
      case 'task.output': {
        if (!e.final) break;
        const cur = Array.isArray(run.outputs) ? (run.outputs as unknown[]) : [];
        await c.db.run.update({ where: { id: runId }, data: { outputs: [...cur, { kind: 'text', name: 'output', content: e.content.slice(0, 20000) }] as Prisma.InputJsonValue } });
        break;
      }
      case 'agent.message': {
        const peers = await c.db.agent.findMany({ where: { integrationId: run.agent.integrationId, runtimeRef: { in: [e.fromRuntimeRef, e.toRuntimeRef].filter((x): x is string => !!x) } } });
        const from = peers.find((p) => p.runtimeRef === e.fromRuntimeRef) ?? run.agent;
        const to = peers.find((p) => p.runtimeRef === e.toRuntimeRef) ?? null;
        await c.db.message.create({ data: { id: newId(), workspaceId: run.workspaceId, taskId: run.taskId, runId, fromKind: 'agent', fromId: from.id, fromName: from.name, toKind: to ? 'agent' : 'broadcast', toId: to?.id ?? null, channel: 'task', body: e.body.slice(0, 4000), correlationId: run.traceId, mode: run.mode } });
        c.agents.markTalk(from.id, to ? 'meeting' : 'message');
        if (to) c.agents.markTalk(to.id, 'meeting');
        await c.events.emit({ ...base, type: 'agent.message', params: { from: from.name, to: to?.name ?? '—' }, summary: `${from.name} → ${to?.name ?? 'team'}: ${e.body.slice(0, 120)}`, correlationId: run.traceId, payload: { toAgentId: to?.id ?? null } });
        if (to) await c.agents.refreshById(run.workspaceId, to.id);
        break;
      }
      case 'action.approval_required':
        await c.approvals.createRuntime(run, { requestRef: e.requestRef, category: e.category, target: e.target, argsSummary: e.argsSummary, risk: e.risk, payload: e.payload });
        return;
      case 'task.completed':
        await this.orch.completeRun(run, e.summary, e.output, e.usage);
        break;
      case 'task.failed':
        await this.orch.transition(runId, 'failed', { reason: e.reason });
        break;
      case 'task.cancelled':
        await this.orch.transition(runId, 'cancelled', { reason: 'runtime reported cancelled' });
        break;
      case 'runtime.disconnected':
        await this.orch.reconcile(runId, `runtime_disconnected: ${e.reason}`);
        break;
      default:
        break;
    }
    await c.agents.refreshById(run.workspaceId, run.agentId);
  }
}
