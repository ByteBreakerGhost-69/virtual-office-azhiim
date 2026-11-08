import { Link } from 'react-router-dom';
import { AGENT_STATES, TASK_STATUSES } from '@avo/shared';
import { useActivity, useOverview } from '../../lib/queries.js';
import { useI18n } from '../../i18n/index.js';
import { Empty, ErrorNote, Loading, ModeBadge, PageHeader, Panel, Pill, useRelTime, PixelIcon } from '../../components/ui.js';
import { EventLine } from '../../components/EventLine.js';

function Stat({ label, value, testId, icon }: { label: string; value: number; testId: string; icon: string }) {
  return (
    <div className="pixel-box pixel-box--soft p-3" data-testid={testId}>
      <p className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-ink-faint"><PixelIcon name={icon} size={11} />{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

export default function OverviewPage() {
  const { t, td } = useI18n();
  const rel = useRelTime();
  const ov = useOverview();
  const act = useActivity({ limit: 8 });
  if (ov.isLoading) return <Loading />;
  const o = ov.data;
  if (!o) return <ErrorNote error={ov.error} />;
  const real = o.agentsByMode['REAL'] ?? 0;
  const sim = o.agentsByMode['SIMULATED'] ?? 0;
  return (
    <div data-testid="overview-page">
      <PageHeader title={t('overview.title')} subtitle={t('overview.subtitle')} />
      {real + sim === 0 ? (
        <Panel className="mb-4">
          <Empty title={t('overview.noAgents')} help={t('overview.noAgentsHelp')} action={<Link to="/integrations" className="font-bold text-accent underline">{t('overview.goIntegrations')}</Link>} />
        </Panel>
      ) : null}
      <div className="mb-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={t('overview.agentsReal')} value={real} testId="stat-real" icon="real" />
        <Stat label={t('overview.agentsSim')} value={sim} testId="stat-sim" icon="sim" />
        <Stat label={t('overview.pendingApprovals')} value={o.pendingApprovals} testId="stat-approvals" icon="hourglass" />
        <Stat label={t('overview.activeRuns')} value={o.activeRuns} testId="stat-runs" icon="bolt" />
      </div>
      <p className="mb-4 text-xs text-ink-faint">{t('overview.separationNote')}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('overview.byState')}>
          <ul className="grid gap-1 text-sm">
            {AGENT_STATES.filter((s) => (o.agentsByState[s] ?? 0) > 0).map((s) => <li key={s} className="flex justify-between border-b border-surface-3 py-1"><span>{td('state', s)}</span><b className="tabular-nums">{o.agentsByState[s]}</b></li>)}
            {Object.keys(o.agentsByState).length === 0 ? <li className="text-ink-soft">—</li> : null}
          </ul>
        </Panel>
        <Panel title={t('overview.tasksByStatus')}>
          <ul className="grid gap-1 text-sm">
            {TASK_STATUSES.filter((s) => (o.tasksByStatus[s] ?? 0) > 0).map((s) => <li key={s} className="flex justify-between border-b border-surface-3 py-1"><span>{td('task.status', s)}</span><b className="tabular-nums">{o.tasksByStatus[s]}</b></li>)}
            {Object.keys(o.tasksByStatus).length === 0 ? <li className="text-ink-soft">—</li> : null}
          </ul>
        </Panel>
        <Panel title={t('overview.integrationHealth')}>
          {o.integrations.length === 0 ? (
            <p className="text-sm text-ink-soft">{t('integrations.empty')}</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {o.integrations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2">
                  <b>{i.name}</b> <ModeBadge mode={i.mode} compact />
                  <Pill tone={i.status === 'connected' ? 'ok' : i.status === 'degraded' ? 'warn' : i.status === 'disconnected' ? 'danger' : 'neutral'} icon={i.status === 'connected' ? 'check' : i.status === 'unchecked' ? 'question' : 'alert'}>{td('integration.status', i.status)}</Pill>
                  <span className="text-xs text-ink-faint">{t('overview.lastSuccess')}: {rel(i.lastSuccessAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={t('overview.recent')}>
          {act.data?.items.length ? <ul>{act.data.items.map((e) => <EventLine key={e.id} e={e} />)}</ul> : <p className="text-sm text-ink-soft">{t('activity.empty')}</p>}
        </Panel>
      </div>
    </div>
  );
}
