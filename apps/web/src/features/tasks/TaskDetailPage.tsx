import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAction, useAgents, useTask } from '../../lib/queries.js';
import { useI18n } from '../../i18n/index.js';
import { useSession } from '../../app/session.js';
import { Button, Empty, ErrorNote, KV, Loading, ModeBadge, PageHeader, Panel, Pill, Select, taskIcon, taskTone, useRelTime } from '../../components/ui.js';
import { EventLine } from '../../components/EventLine.js';

const ACTIVE = ['planning', 'awaiting_approval', 'queued', 'running', 'verifying'];

export default function TaskDetailPage() {
  const { id = '' } = useParams();
  const { t, td } = useI18n();
  const { can } = useSession();
  const rel = useRelTime();
  const q = useTask(id);
  const agents = useAgents();
  const [assignee, setAssignee] = useState('');
  const act = useAction((a: { path: string; body?: unknown }) => api.post(`/tasks/${id}/${a.path}`, a.body), [['tasks'], ['task', id], ['agents'], ['overview'], ['activity'], ['approvals']]);
  const stop = useAction((runId: string) => api.post(`/runs/${runId}/stop`), [['tasks'], ['task', id], ['agents'], ['overview']]);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorNote error={q.error} />;
  const { task, runs, approvals, messages, events } = q.data;
  const activeRun = runs.find((r) => ACTIVE.includes(r.state));
  const latest = runs[0];
  const terminal = ['completed', 'failed', 'cancelled'].includes(task.status);
  return (
    <div data-testid="task-detail" data-task-status={task.status}>
      <p className="mb-2 text-sm"><Link to="/tasks" className="text-accent underline">← {t('tasks.title')}</Link></p>
      <PageHeader title={task.title} actions={<><ModeBadge mode={task.mode} /><Pill tone={taskTone(task.status)} icon={taskIcon(task.status)} testId="task-detail-status">{td('task.status', task.status)}</Pill></>} />
      <ErrorNote error={act.error ?? stop.error} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('tasks.detail')}>
          <dl>
            <KV k={t('tasks.objective')}><span className="whitespace-pre-wrap">{task.objective}</span></KV>
            {task.expectedOutput ? <KV k={t('tasks.expected')}>{task.expectedOutput}</KV> : null}
            <KV k={t('tasks.assignee')}>{task.assigneeName ?? '—'}</KV>
            <KV k={t('common.priority')}>{td('priority', task.priority)}</KV>
            {task.blockedReason ? <KV k={t('tasks.blockedReason')}><span data-testid="task-blocked-reason">{task.blockedReason}</span></KV> : null}
            {task.dependsOn.length ? <KV k={t('tasks.dependsOn')}>{task.dependsOn.length}</KV> : null}
            <KV k={t('common.created')}>{rel(task.createdAt)}{task.createdByName ? ` · ${task.createdByName}` : ''}</KV>
          </dl>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            {can('task.create') && !terminal && !activeRun ? (
              <>
                <Select aria-label={t('tasks.assign')} value={assignee} onChange={(e) => setAssignee(e.target.value)} className="!w-auto" data-testid="assign-select">
                  <option value="">{t('tasks.form.assignee')}</option>
                  {(agents.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.mode === 'REAL' ? t('mode.REAL') : t('mode.SIMULATED')})</option>)}
                </Select>
                <Button variant="primary" disabled={!assignee || act.isPending} data-testid="assign-submit" onClick={() => act.mutate({ path: 'assign', body: { agentId: assignee } })}>{t('tasks.assign')}</Button>
              </>
            ) : null}
            {can('task.cancel') && !terminal ? <Button variant="danger" data-testid="task-cancel" onClick={() => act.mutate({ path: 'cancel' })}>{t('tasks.cancel')}</Button> : null}
            {can('task.create') && ['failed', 'cancelled', 'blocked'].includes(task.status) ? <Button data-testid="task-retry" onClick={() => act.mutate({ path: 'retry' })}>{t('tasks.retry')}</Button> : null}
            {can('run.control') && activeRun ? <Button size="sm" onClick={() => stop.mutate(activeRun.id)}>{t('tasks.stopRun')}</Button> : null}
          </div>
        </Panel>

        <Panel title={t('tasks.runs')}>
          {runs.length === 0 ? <Empty title={t('tasks.noRuns')} /> : null}
          {runs.map((r) => {
            const plan = r.plan as { planner?: string; selectionRationale?: unknown; subtasks?: { title: string }[]; completionCriteria?: unknown } | null;
            return (
              <article key={r.id} data-testid={`run-${r.id}`} data-run-state={r.state} className="mb-3 rounded border border-line p-3 text-sm">
                <header className="flex flex-wrap items-center justify-between gap-2">
                  <b>{t('tasks.attempt', { n: r.attempt })} — {r.agentName}</b>
                  <Pill tone={taskTone(r.state === 'completed' ? 'completed' : ['failed', 'timed_out', 'rejected', 'blocked'].includes(r.state) ? 'failed' : r.state === 'awaiting_approval' ? 'awaiting_approval' : 'running')}>{td('run.state', r.state)}</Pill>
                </header>
                <dl className="mt-2">
                  {plan?.planner ? <KV k={t('tasks.planner')}>{plan.planner}</KV> : null}
                  {plan?.selectionRationale ? <KV k={t('tasks.rationale')}><span className="text-xs">{Array.isArray(plan.selectionRationale) ? plan.selectionRationale.join('; ') : String(plan.selectionRationale)}</span></KV> : null}
                  {r.failureReason ? <KV k={t('tasks.failure')}><span data-testid="run-failure">{r.failureReason}</span></KV> : null}
                  {r.resultSummary ? <KV k={t('tasks.result')}><span data-testid="run-result">{r.resultSummary}</span></KV> : null}
                </dl>
                {r.outputs.length ? (
                  <div className="mt-2">
                    <p className="text-xs font-bold">{t('tasks.outputs')}</p>
                    <p className="text-xs text-ink-faint">{t('tasks.untrusted')}</p>
                    {r.outputs.map((o, i) => <pre key={i} data-testid="run-output" className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 text-xs">{o.name ? `${o.name}\n` : ''}{o.content ?? ''}</pre>)}
                  </div>
                ) : null}
              </article>
            );
          })}
          {latest && latest.state === 'completed' && !task.expectedOutput ? <p className="text-xs text-ink-faint">{t('tasks.unverified')}</p> : null}
        </Panel>

        {approvals.length ? (
          <Panel title={t('tasks.approvals')}>
            <ul className="grid gap-1 text-sm">{approvals.map((a) => <li key={a.id}><Link className="text-accent underline" to="/approvals">{td('category', a.actionCategory)} → {a.target}</Link> — {td('approval.status', a.status)}</li>)}</ul>
          </Panel>
        ) : null}
        {messages.length ? (
          <Panel title={t('tasks.messages')}>
            <ul className="grid gap-1 text-sm">{messages.map((m) => <li key={m.id} className="rounded bg-surface-2 px-2 py-1"><b>{m.fromName}</b>: {m.body}</li>)}</ul>
          </Panel>
        ) : null}
        <Panel title={t('tasks.history')} className="lg:col-span-2">
          <ul data-testid="task-events">{events.map((e) => <EventLine key={e.id} e={e} />)}</ul>
        </Panel>
      </div>
    </div>
  );
}
