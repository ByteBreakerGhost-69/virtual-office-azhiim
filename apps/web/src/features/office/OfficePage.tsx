import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { OfficeCanvas, type OfficeLabels, type ViewFilter } from '../../office/index.js';
import { useAgents } from '../../lib/queries.js';
import { useI18n } from '../../i18n/index.js';
import { useSession } from '../../app/session.js';
import { useAudio } from '../../audio/useAudio.js';
import { AGENT_STATES, ROOM_KEYS, type AgentState, type RoomKey } from '@avo/shared';
import { Button, Empty, ErrorNote, Loading, ModeBadge, PageHeader, StateBadge, PixelIcon } from '../../components/ui.js';
import { AgentPanel } from '../agents/AgentPanel.js';
import { TerminalPanel, type TerminalSize } from '../terminal/TerminalPanel.js';
import { api } from '../../lib/api.js';
import type { AvatarPose } from '../../office/scene.js';

const TERM_W: Record<TerminalSize, string> = { sm: '20rem', md: '28rem', lg: '40rem' };
const lsGet = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

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
  const [termOpen, setTermOpen] = useState(() => lsGet('avo.terminal.open') !== '0');
  const [termSize, setTermSize] = useState<TerminalSize>(() => (['sm', 'md', 'lg'] as const).find((x) => x === lsGet('avo.terminal.size')) ?? 'md');
  useEffect(() => {
    lsSet('avo.terminal.open', termOpen ? '1' : '0');
  }, [termOpen]);
  useEffect(() => {
    lsSet('avo.terminal.size', termSize);
  }, [termSize]);
  const posQ = useQuery({ queryKey: ['office-position'], queryFn: () => api.get<AvatarPose | null>('/office/position'), staleTime: Infinity, retry: false });
  const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRest = (p: AvatarPose) => {
    if (restTimer.current) clearTimeout(restTimer.current);
    restTimer.current = setTimeout(() => void api.put('/office/position', p).catch(() => undefined), 250);
  };
  useEffect(() => () => { if (restTimer.current) clearTimeout(restTimer.current); }, []);
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
            <Button size="sm" aria-pressed={termOpen} data-testid="toggle-terminal" onClick={() => setTermOpen((v) => !v)}>{t('terminal.title')}</Button>
            <Button size="sm" aria-pressed={table} data-testid="toggle-table" onClick={() => setTable((v) => !v)}>{table ? t('office.map') : t('office.table')}</Button>
          </>
        }
      />
      <ErrorNote error={agents.error} />
      {list.length === 0 ? (
        <Empty title={t('office.empty')} help={t('office.emptyHelp')} action={<Link to="/integrations" className="font-bold text-accent underline">{t('overview.goIntegrations')}</Link>} />
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 lg:[grid-template-columns:minmax(0,1fr)_var(--side-w)]" style={{ ['--side-w' as string]: termOpen ? TERM_W[termSize] : '22rem' }}>
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
                {posQ.isFetched ? <OfficeCanvas
                  className="absolute inset-0"
                  agents={list}
                  selectedAgentId={selected}
                  onSelectAgent={setSelected}
                  filter={filter}
                  labels={labels}
                  reducedMotion={reduced}
                  avatarEnabled
                  avatarStart={posQ.data ?? null}
                  onAvatarRest={saveRest}
                  live={live}
                  onSfx={(n) => audio.play(n)}
                /> : <Loading />}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
              <span className="inline-flex items-center gap-1"><PixelIcon name="real" size={10} color="#2f9e62" />{t('office.legendReal')}</span>
              <span className="inline-flex items-center gap-1"><PixelIcon name="sim" size={10} color="#b8812a" />{t('office.legendSim')}</span>
              <span>{t('office.notAMock')}</span>
              {reduced ? <span>{t('office.reducedMotion')}</span> : null}
              <span>{t('office.avatarHelp')}</span>
            </div>
          </div>
          <div className="flex min-h-0 flex-col gap-3">
            {termOpen ? <div className="min-h-[16rem] flex-1"><TerminalPanel size={termSize} onSize={setTermSize} onHide={() => setTermOpen(false)} /></div> : null}
            <div className={`min-h-0 overflow-auto ${termOpen && selected ? 'max-h-[45%]' : 'flex-1'}`}>
              {selected ? <AgentPanel agentId={selected} onClose={() => setSelected(null)} /> : termOpen ? null : <p className="pixel-box p-4 text-sm text-ink-soft" data-testid="agent-panel-hint">{t('office.agentList')}: {shown.length}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
