import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { OfficeCanvas, type OfficeLabels, type ViewFilter } from '../../office/index.js';
import { useAgents } from '../../lib/queries.js';
import { useI18n } from '../../i18n/index.js';
import { useSession } from '../../app/session.js';
import { useAudio } from '../../audio/useAudio.js';
import { AGENT_STATES, ROOM_KEYS, type AgentState, type RoomKey } from '@avo/shared';
import { Button, Empty, ErrorNote, Loading, ModeBadge, PageHeader, StateBadge, PixelIcon } from '../../components/ui.js';
import { AgentPanel } from '../agents/AgentPanel.js';

function usePrefersReducedMotion(): boolean {
  const [r, setR] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!m) return;
    const h = () => setR(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return r;
}

export default function OfficePage() {
  const { t } = useI18n();
  const { live } = useSession();
  const agents = useAgents();
  const audio = useAudio();
  const reduced = usePrefersReducedMotion();
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<ViewFilter>('ALL');
  const [avatar, setAvatar] = useState(false);
  const [table, setTable] = useState(false);

  const labels = useMemo<OfficeLabels>(
    () => ({
      real: t('mode.REAL'),
      simulated: 'SIM',
      you: t('office.you'),
      staleOverlay: t('conn.lost'),
      roomNames: Object.fromEntries(ROOM_KEYS.map((k) => [k, t(`room.${k}` as never)])) as Record<RoomKey, string>,
      states: Object.fromEntries(AGENT_STATES.map((s) => [s, t(`state.${s}` as never)])) as Record<AgentState, string>,
      agentListLabel: t('office.agentList'),
      zoomIn: t('office.zoomIn'),
      zoomOut: t('office.zoomOut'),
      zoomReset: t('office.zoomReset'),
    }),
    [t],
  );
  // drop a selection whose agent no longer exists
  useEffect(() => {
    if (selected && agents.data && !agents.data.some((a) => a.id === selected)) setSelected(null);
  }, [agents.data, selected]);

  if (agents.isLoading) return <Loading />;
  const list = agents.data ?? [];
  const shown = list.filter((a) => filter === 'ALL' || a.mode === filter);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="office-page">
      <PageHeader
        title={t('office.title')}
        subtitle={t('office.subtitle')}
        actions={
          <>
            <div role="group" aria-label={t('filter.view')} className="flex gap-1">
              {(['ALL', 'REAL', 'SIMULATED'] as const).map((f) => (
                <Button key={f} size="sm" aria-pressed={filter === f} variant={filter === f ? 'primary' : 'secondary'} data-testid={`filter-${f}`} onClick={() => setFilter(f)}>{t(`filter.${f}`)}</Button>
              ))}
            </div>
            <label className="flex items-center gap-1 text-xs font-bold" title={t('office.avatarHelp')}>
              <input type="checkbox" checked={avatar} onChange={(e) => setAvatar(e.target.checked)} data-testid="toggle-avatar" /> {t('office.avatar')}
            </label>
            <Button size="sm" aria-pressed={table} data-testid="toggle-table" onClick={() => setTable((v) => !v)}>{table ? t('office.map') : t('office.table')}</Button>
          </>
        }
      />
      <ErrorNote error={agents.error} />
      {list.length === 0 ? (
        <Empty title={t('office.empty')} help={t('office.emptyHelp')} action={<Link to="/integrations" className="font-bold text-accent underline">{t('overview.goIntegrations')}</Link>} />
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-h-[22rem] min-w-0 flex-col gap-2">
            {table ? (
              <table className="avo-table pixel-box" data-testid="office-table">
                <thead><tr><th>{t('agents.col.agent')}</th><th>{t('common.mode')}</th><th>{t('agents.col.state')}</th><th>{t('agent.location')}</th></tr></thead>
                <tbody>
                  {shown.map((a) => (
                    <tr key={a.id} data-selected={a.id === selected}>
                      <td><button type="button" className="font-bold text-accent underline" onClick={() => setSelected(a.id)}>{a.name}</button></td>
                      <td><ModeBadge mode={a.mode} compact /></td>
                      <td><StateBadge state={a.state} stale={a.stale} /></td>
                      <td>{t(`room.${a.placement.room}` as never)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="pixel-box relative min-h-0 flex-1 overflow-hidden bg-night p-0" style={{ minHeight: '22rem' }}>
                <OfficeCanvas
                  className="absolute inset-0"
                  agents={list}
                  selectedAgentId={selected}
                  onSelectAgent={setSelected}
                  filter={filter}
                  labels={labels}
                  reducedMotion={reduced}
                  avatarEnabled={avatar}
                  live={live}
                  onSfx={(n) => audio.play(n)}
                />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
              <span className="inline-flex items-center gap-1"><PixelIcon name="real" size={10} color="#2f9e62" />{t('office.legendReal')}</span>
              <span className="inline-flex items-center gap-1"><PixelIcon name="sim" size={10} color="#b8812a" />{t('office.legendSim')}</span>
              <span>{t('office.notAMock')}</span>
              {reduced ? <span>{t('office.reducedMotion')}</span> : null}
              {avatar ? <span>{t('office.avatarHelp')}</span> : null}
            </div>
          </div>
          <div className="min-h-0 overflow-auto">
            {selected ? <AgentPanel agentId={selected} onClose={() => setSelected(null)} /> : <p className="pixel-box p-4 text-sm text-ink-soft" data-testid="agent-panel-hint">{t('office.agentList')}: {shown.length}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
