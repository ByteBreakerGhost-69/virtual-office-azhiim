import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAction, useAgent, useAgents } from '../../lib/queries.js';
import { useI18n } from '../../i18n/index.js';
import { useSession } from '../../app/session.js';
import { Button, ErrorNote, KV, Loading, ModeBadge, Pill, StateBadge, taskIcon, taskTone, useRelTime, PixelIcon } from '../../components/ui.js';
import { EventLine } from '../../components/EventLine.js';
import { QuickTaskModal } from '../tasks/QuickTask.js';

/** Detail panel of one registered agent. Everything shown is data from the backend (identity, runtime-reported state, events). */
export function AgentPanel({ agentId, onClose }: { agentId: string; onClose?: () => void }) {
  const { t, td } = useI18n();
  const { can } = useSession();
  const rel = useRelTime();
  const q = useAgent(agentId);
  const all = useAgents();
  const [taskOpen, setTaskOpen] = useState(false);
  const act = useAction((a: { path: string }) => api.post(`/agents/${agentId}/${a.path}`), [['agents'], ['agent', agentId], ['activity'], ['overview']]);
  if (q.isLoading || !q.data) return <Loading />;
  const { agent: a, currentTask, runs, recentEvents, messages } = q.data;
  const boss = a.reportsToAgentId ? all.data?.find((x) => x.id === a.reportsToAgentId)?.name : null;
  const reasonKey = `reason.${a.stateReason.code}`;
  return (
    <aside data-testid="agent-panel" data-agent-id={a.id} aria-label={t('agent.panel')} className="pixel-box grid gap-4 p-4">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold" data-testid="agent-panel-name">{a.name}</h2>
          <p className="text-sm text-ink-soft">{a.title} · @{a.handle}{a.employeeCode ? <> · <span data-testid="agent-employee-code">{a.employeeCode}</span></> : null}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ModeBadge mode={a.mode} />
            <StateBadge state={a.state} stale={a.stale} testId={`agent-state-${a.id}`} />
            {a.employmentStatus ? <Pill>{td('employment', a.employmentStatus)}</Pill> : <Pill>{t('agent.notEmployee')}</Pill>}
            {!a.enabled ? <Pill>{t('agent.disable')}d</Pill> : null}
          </div>
        </div>
        {onClose ? <Button variant="ghost" size="sm" onClick={onClose} aria-label={t('common.close')} data-testid="agent-panel-close">✕</Button> : null}
      </header>

      {a.mode === 'SIMULATED' ? <p className="rounded border border-dashed border-sim bg-sim-soft px-2 py-1 text-xs text-sim">{t('mode.simHelp')}</p> : null}

      <section aria-labelledby="ap-status">
        <h3 id="ap-status" className="pixel-heading mb-1 text-xs text-ink-faint">{t('agent.status')}</h3>
        <dl>
          <KV k={t('agent.shownState')}>{td('state', a.state)}{a.stale ? ` — ${t('state.staleNote')}` : ''}</KV>
          <KV k={t('agent.reportedState')}>{td('state', a.storedState)}</KV>
          <KV k={t('agent.whyHere')}>{t(`reason.${a.stateReason.code}` as never) === reasonKey ? t('reason.generic') : t(reasonKey as never, a.stateReason.params as never)}</KV>
          <KV k={t('agent.stateSource')}>{a.stateSource}</KV>
          <KV k={t('agent.since')}>{rel(a.stateSince)}</KV>
          <KV k={t('agent.lastSeen')}>{rel(a.lastSeenAt)}</KV>
          <KV k={t('agent.location')}>{td('room', a.placement.room)}</KV>
          {a.activityNote ? <KV k={t('agent.note')}><span data-testid="agent-note">{a.activityNote}</span></KV> : null}
        </dl>
      </section>

      <section aria-labelledby="ap-task">
        <h3 id="ap-task" className="pixel-heading mb-1 text-xs text-ink-faint">{t('agent.currentTask')}</h3>
        {currentTask ? (
          <div data-testid="agent-current-task" className="flex flex-wrap items-center gap-2">
            <Link to={`/tasks/${currentTask.id}`} className="font-bold text-accent underline">{currentTask.title}</Link>
            <Pill tone={taskTone(currentTask.status)} icon={taskIcon(currentTask.status)}>{td('task.status', currentTask.status)}</Pill>
          </div>
        ) : (
          <p className="text-sm text-ink-soft">{t('agent.noTask')}</p>
        )}
      </section>

      <section aria-labelledby="ap-ident">
        <h3 id="ap-ident" className="pixel-heading mb-1 text-xs text-ink-faint">{t('agent.identity')}</h3>
        <dl>
          <KV k={t('agent.department')}>{a.departmentName ? td('dept', a.departmentKey ?? '') || a.departmentName : t('org.unassigned')}</KV>
          <KV k={t('agent.orgRole')}>{td('role', a.orgRole)}</KV>
          <KV k={t('agent.reportsTo')}>{boss ?? t('common.none')}</KV>
          <KV k={t('agent.runtime')}>{td('kind', a.runtimeKind)} · {a.integrationName}</KV>
          <KV k={t('agent.runtimeRef')}>{a.runtimeRef ?? '—'}</KV>
        </dl>
      </section>

      <section aria-labelledby="ap-cap">
        <h3 id="ap-cap" className="pixel-heading mb-1 text-xs text-ink-faint">{t('agent.capabilities')}</h3>
        <div className="flex flex-wrap gap-1">{a.capabilities.length ? a.capabilities.map((c) => <Pill key={c} tone="info">{c}</Pill>) : <span className="text-sm text-ink-soft">{t('agent.noneDeclared')}</span>}</div>
        <h3 className="pixel-heading mb-1 mt-3 text-xs text-ink-faint">{t('agent.permissions')}</h3>
        <div className="flex flex-wrap gap-1">{a.permissions.length ? a.permissions.map((c) => <Pill key={c}>{c}</Pill>) : <span className="text-sm text-ink-soft">{t('agent.noneDeclared')}</span>}</div>
        <p className="mt-1 text-xs text-ink-faint">{t('agent.capabilitiesNote')}</p>
      </section>

      <section aria-labelledby="ap-act">
        <h3 id="ap-act" className="pixel-heading mb-1 text-xs text-ink-faint">{t('agent.activity')}</h3>
        {recentEvents.length ? <ul data-testid="agent-activity" className="max-h-64 overflow-auto">{recentEvents.map((e) => <EventLine key={e.id} e={e} showMode={false} />)}</ul> : <p className="text-sm text-ink-soft">{t('agent.noActivity')}</p>}
      </section>

      {messages.length ? (
        <section aria-labelledby="ap-msg">
          <h3 id="ap-msg" className="pixel-heading mb-1 text-xs text-ink-faint">{t('agent.messages')}</h3>
          <ul className="grid gap-1 text-sm">{messages.slice(0, 8).map((m) => <li key={m.id} className="rounded bg-surface-2 px-2 py-1"><b>{m.fromName}</b>: {m.body}</li>)}</ul>
        </section>
      ) : null}

      {runs.length ? (
        <section aria-labelledby="ap-runs">
          <h3 id="ap-runs" className="pixel-heading mb-1 text-xs text-ink-faint">{t('agent.runs')}</h3>
          <ul className="grid gap-1 text-sm">{runs.slice(0, 5).map((r) => <li key={r.id} className="flex items-center justify-between"><Link className="text-accent underline" to={`/tasks/${r.taskId}`}>{t('tasks.attempt', { n: r.attempt })}</Link><span>{td('run.state', r.state)}</span></li>)}</ul>
        </section>
      ) : null}

      <ErrorNote error={act.error} />
      <footer className="flex flex-wrap gap-2">
        {can('task.create') ? <Button variant="primary" size="sm" data-testid="agent-assign-task" onClick={() => setTaskOpen(true)}><PixelIcon name="check" size={11} /> {t('agent.assignTask')}</Button> : null}
        {can('run.control') && a.supports.pause ? <Button size="sm" onClick={() => act.mutate({ path: 'pause' })}>{t('agent.pause')}</Button> : null}
        {can('run.control') && a.supports.resume ? <Button size="sm" onClick={() => act.mutate({ path: 'resume' })}>{t('agent.resume')}</Button> : null}
        {can('agent.manage') ? <Button size="sm" onClick={() => act.mutate({ path: a.enabled ? 'disable' : 'enable' })}>{a.enabled ? t('agent.disable') : t('agent.enable')}</Button> : null}
      </footer>
      <QuickTaskModal open={taskOpen} agentId={a.id} onClose={() => setTaskOpen(false)} />
    </aside>
  );
}
