import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useI18n, LOCALES, type Locale, type MessageKey } from '../i18n/index.js';
import { useSession } from './session.js';
import { useAudio } from '../audio/useAudio.js';
import { useOverview } from '../lib/queries.js';
import { api } from '../lib/api.js';
import { useAction } from '../lib/queries.js';
import { Button, ErrorNote, Modal, PixelIcon, Pill } from '../components/ui.js';

export const NAV: { key: string; to: string; label: MessageKey; icon: string; foundation?: boolean }[] = [
  { key: 'overview', to: '/overview', label: 'nav.overview', icon: 'spark' },
  { key: 'office', to: '/office', label: 'nav.office', icon: 'real' },
  { key: 'agents', to: '/agents', label: 'nav.agents', icon: 'bolt' },
  { key: 'tasks', to: '/tasks', label: 'nav.tasks', icon: 'check' },
  { key: 'organization', to: '/organization', label: 'nav.organization', icon: 'dot' },
  { key: 'activity', to: '/activity', label: 'nav.activity', icon: 'bubble' },
  { key: 'approvals', to: '/approvals', label: 'nav.approvals', icon: 'hourglass' },
  { key: 'integrations', to: '/integrations', label: 'nav.integrations', icon: 'power' },
  { key: 'settings', to: '/settings', label: 'nav.settings', icon: 'gear' },
  { key: 'projects', to: '/projects', label: 'nav.projects', icon: 'moon', foundation: true },
  { key: 'hive', to: '/hive', label: 'nav.hive', icon: 'sim', foundation: true },
];

export function LanguageSwitch({ dark }: { dark?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className={`flex items-center gap-1 text-xs font-bold ${dark ? 'text-white' : 'text-ink-soft'}`}>
      <span className="sr-only">{t('topbar.language')}</span>
      <select data-testid="language-switch" aria-label={t('topbar.language')} value={locale} onChange={(e) => setLocale(e.target.value as Locale)} className="rounded-sm border-2 border-line-strong bg-white px-1 py-0.5 text-xs text-ink">
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </select>
    </label>
  );
}

function AudioControls() {
  const { t } = useI18n();
  const a = useAudio();
  return (
    <div className="flex items-center gap-1" role="group" aria-label={t('topbar.audio')}>
      <Button size="sm" aria-pressed={a.music} data-testid="toggle-music" onClick={() => a.setMusic(!a.music)} title={t('audio.note')}>
        ♪ {a.music ? t('audio.musicOn') : t('audio.musicOff')}
      </Button>
      <Button size="sm" aria-pressed={a.sfx} data-testid="toggle-sfx" onClick={() => a.setSfx(!a.sfx)} title={t('audio.note')}>
        ♫ {a.sfx ? t('audio.sfxOn') : t('audio.sfxOff')}
      </Button>
    </div>
  );
}

interface StopResult { results?: { runId?: string; agent?: string; ok?: boolean; detail?: string; message?: string }[]; [k: string]: unknown }
function EmergencyStop() {
  const { t } = useI18n();
  const { can } = useSession();
  const ov = useOverview();
  const [open, setOpen] = useState(false);
  const stop = useAction(() => api.post<StopResult>('/control/emergency-stop'));
  const resume = useAction(() => api.post('/control/resume-dispatch'));
  if (!can('control.emergency')) return null;
  const paused = ov.data?.dispatchPaused;
  return (
    <>
      {paused ? (
        <Button size="sm" data-testid="resume-dispatch" onClick={() => resume.mutate(undefined)}>{t('topbar.resumeDispatch')}</Button>
      ) : null}
      <Button variant="danger" size="sm" data-testid="emergency-stop" onClick={() => { stop.reset(); setOpen(true); }}>■ {t('topbar.emergency')}</Button>
      <Modal open={open} title={t('emergency.title')} onClose={() => setOpen(false)} testId="emergency-dialog">
        <p className="mb-3 text-sm">{t('emergency.body')}</p>
        <ErrorNote error={stop.error} />
        {stop.data ? (
          <div data-testid="emergency-result" className="mb-3 rounded border border-line bg-surface-2 p-2 text-xs">
            <p className="font-bold">{t('emergency.result')}</p>
            <pre className="whitespace-pre-wrap">{JSON.stringify(stop.data, null, 2)}</pre>
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button onClick={() => setOpen(false)}>{t('common.close')}</Button>
          {!stop.data ? <Button variant="danger" disabled={stop.isPending} data-testid="emergency-confirm" onClick={() => stop.mutate(undefined)}>{t('emergency.confirm')}</Button> : null}
        </div>
      </Modal>
    </>
  );
}

export function Shell() {
  const { t } = useI18n();
  const { user, workspaceName, live, logout } = useSession();
  const ov = useOverview();
  return (
    <div className="flex h-full flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-2">{t('nav.skip')}</a>
      <header className="shell-glow flex flex-wrap items-center gap-3 border-b-2 border-line-strong bg-surface px-3 py-2">
        <div className="mr-2">
          <p className="pixel-heading text-sm leading-tight">{t('app.name')}</p>
          <p className="text-[11px] text-ink-faint">{workspaceName}</p>
        </div>
        <div data-testid="connection-indicator" data-live={live} role="status" className="flex items-center gap-1.5 text-xs font-bold">
          {live ? <Pill tone="ok" icon="bolt">{t('conn.live')}</Pill> : <Pill tone="warn" icon="alert">{t('conn.lost')}</Pill>}
        </div>
        {ov.data?.dispatchPaused ? <Pill tone="danger" icon="pause" testId="dispatch-paused">{t('topbar.dispatchPaused')}</Pill> : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <AudioControls />
          <LanguageSwitch />
          <EmergencyStop />
          <span className="text-xs text-ink-soft" data-testid="current-user">{user.displayName} · {t(`auth.role.${user.role}` as MessageKey)}</span>
          <Button size="sm" data-testid="logout" onClick={() => void logout()}>{t('auth.logout')}</Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav aria-label={t('nav.primary')} className="w-14 shrink-0 overflow-y-auto border-r-2 border-line bg-surface-2 p-1.5 md:w-52">
          <ul className="grid gap-1">
            {NAV.map((n) => (
              <li key={n.key}>
                <NavLink
                  to={n.to}
                  data-testid={`nav-${n.key}`}
                  title={t(n.label)}
                  className={({ isActive }) => `flex items-center gap-2 rounded-sm border-2 px-2 py-1.5 text-sm font-bold ${isActive ? 'border-accent bg-accent-soft text-accent-strong' : 'border-transparent text-ink-soft hover:bg-surface-3'}`}
                >
                  <PixelIcon name={n.icon} size={14} />
                  <span className="hidden md:inline">{t(n.label)}</span>
                  {n.foundation ? <span className="ml-auto hidden rounded-sm bg-surface-3 px-1 text-[10px] md:inline">β</span> : null}
                  {n.key === 'approvals' && ov.data && ov.data.pendingApprovals > 0 ? (
                    <span data-testid="approvals-badge" className="ml-auto rounded-sm bg-warn px-1.5 text-[11px] text-white">{ov.data.pendingApprovals}</span>
                  ) : null}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 overflow-auto p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
