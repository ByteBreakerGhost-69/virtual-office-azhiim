import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import type { AgentState, DataMode } from '@avo/shared';
import { ApiError } from '../lib/api.js';
import { useI18n } from '../i18n/index.js';

// ------------------------------------------------------------------ pixel icons (inline SVG, crisp)
const ICONS: Record<string, string[]> = {
  dot: ['..##..', '.####.', '######', '######', '.####.', '..##..'],
  check: ['......##', '.....##.', '#...##..', '##.##...', '.###....', '..#.....'],
  cross: ['##....##', '###..###', '.######.', '..####..', '.######.', '###..###', '##....##'],
  pause: ['##..##', '##..##', '##..##', '##..##', '##..##', '##..##'],
  hourglass: ['######', '.####.', '..##..', '..##..', '.####.', '######'],
  alert: ['..##..', '..##..', '.####.', '.####.', '######', '..##..'],
  question: ['.####.', '##..##', '...##.', '..##..', '......', '..##..'],
  bolt: ['...##.', '..##..', '.####.', '..##..', '.##...', '##....'],
  power: ['..##..', '#.##.#', '##..##', '##..##', '.####.', '..##..'],
  spark: ['..#...', '..#...', '#####.', '..#...', '..#...', '......'],
  moon: ['.###..', '##....', '##....', '##....', '.###..', '..###.'],
  bubble: ['######', '#....#', '#....#', '######', '..##..', '.#....'],
  sim: ['#.#.#.', '.####.', '######', '.####.', '#.#.#.', '......'],
  real: ['..##..', '.####.', '######', '######', '.####.', '..##..'],
  stop: ['.####.', '######', '######', '######', '######', '.####.'],
  gear: ['.#..#.', '######', '##..##', '##..##', '######', '.#..#.'],
};
export function PixelIcon({ name, size = 14, color = 'currentColor', title }: { name: keyof typeof ICONS | string; size?: number; color?: string; title?: string }) {
  const rows = ICONS[name] ?? ICONS['dot']!;
  const w = Math.max(...rows.map((r) => r.length));
  return (
    <svg className="pixel-icon" width={size} height={(size * rows.length) / w} viewBox={`0 0 ${w} ${rows.length}`} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} fill={color}>
      {rows.flatMap((r, y) => [...r].map((c, x) => (c === '#' ? <rect key={`${x},${y}`} x={x} y={y} width="1" height="1" /> : null)))}
    </svg>
  );
}

// ------------------------------------------------------------------ status badges: icon + text + color (never color alone)
const STATE_STYLE: Record<AgentState, { icon: string; cls: string }> = {
  registered: { icon: 'dot', cls: 'bg-surface-3 text-ink-soft' },
  starting: { icon: 'spark', cls: 'bg-cyan-soft text-cyan' },
  idle: { icon: 'dot', cls: 'bg-accent-soft text-accent-strong' },
  working: { icon: 'bolt', cls: 'bg-ok-soft text-ok' },
  thinking: { icon: 'bubble', cls: 'bg-violet-soft text-violet' },
  waiting: { icon: 'hourglass', cls: 'bg-warn-soft text-warn' },
  blocked: { icon: 'stop', cls: 'bg-danger-soft text-danger' },
  paused: { icon: 'pause', cls: 'bg-accent-soft text-accent-strong' },
  stopping: { icon: 'stop', cls: 'bg-surface-3 text-ink-soft' },
  stopped: { icon: 'power', cls: 'bg-surface-3 text-ink-soft' },
  error: { icon: 'alert', cls: 'bg-danger-soft text-danger' },
  offline: { icon: 'power', cls: 'bg-surface-3 text-ink-soft' },
  unknown: { icon: 'question', cls: 'bg-surface-3 text-ink-soft' },
};
export function StateBadge({ state, stale, testId }: { state: AgentState; stale?: boolean; testId?: string }) {
  const { td, t } = useI18n();
  const s = STATE_STYLE[state];
  return (
    <span data-testid={testId} data-state={state} title={stale ? t('state.staleNote') : undefined} className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-bold ${s.cls}`}>
      <PixelIcon name={s.icon} size={11} />
      {td('state', state)}
      {stale ? <span aria-hidden="true">*</span> : null}
    </span>
  );
}

export function ModeBadge({ mode, compact }: { mode: DataMode; compact?: boolean }) {
  const { t } = useI18n();
  const real = mode === 'REAL';
  return (
    <span
      data-testid={`mode-${mode}`}
      title={real ? t('mode.realHelp') : t('mode.simHelp')}
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] font-bold tracking-wide ${real ? 'border-ok bg-ok-soft text-ok' : 'border-dashed border-sim bg-sim-soft text-sim'}`}
    >
      <PixelIcon name={real ? 'real' : 'sim'} size={10} />
      {compact ? (real ? 'REAL' : 'SIM') : t(`mode.${mode}`)}
    </span>
  );
}

const TONES: Record<string, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-accent-soft text-accent-strong',
  neutral: 'bg-surface-3 text-ink-soft',
  violet: 'bg-violet-soft text-violet',
};
export function Pill({ tone = 'neutral', icon, children, testId }: { tone?: keyof typeof TONES; icon?: string; children: ReactNode; testId?: string }) {
  return (
    <span data-testid={testId} className={`inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-bold ${TONES[tone]}`}>
      {icon ? <PixelIcon name={icon} size={11} /> : null}
      {children}
    </span>
  );
}
export const taskTone = (s: string): keyof typeof TONES => (s === 'completed' ? 'ok' : s === 'failed' || s === 'blocked' ? 'danger' : s === 'awaiting_approval' ? 'warn' : s === 'running' ? 'violet' : s === 'cancelled' ? 'neutral' : 'info');
export const taskIcon = (s: string) => (s === 'completed' ? 'check' : s === 'failed' ? 'cross' : s === 'blocked' ? 'stop' : s === 'awaiting_approval' ? 'hourglass' : s === 'running' ? 'bolt' : s === 'cancelled' ? 'power' : 'dot');

// ------------------------------------------------------------------ layout bits
export function Panel({ title, actions, children, tone, className = '', testId }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; tone?: 'accent' | 'danger' | 'warn' | 'sim' | 'soft'; className?: string; testId?: string }) {
  return (
    <section data-testid={testId} className={`pixel-box ${tone ? `pixel-box--${tone}` : ''} p-4 ${className}`}>
      {title || actions ? (
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? <h2 className="pixel-heading text-sm text-ink-soft">{title}</h2> : <span />}
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="pixel-heading text-xl">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-3xl text-sm text-ink-soft">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
export function Empty({ title, help, action }: { title: string; help?: string; action?: ReactNode }) {
  return (
    <div className="grid place-items-center gap-2 rounded border-2 border-dashed border-line px-4 py-8 text-center">
      <p className="font-bold">{title}</p>
      {help ? <p className="max-w-md text-sm text-ink-soft">{help}</p> : null}
      {action}
    </div>
  );
}
export function Loading() {
  const { t } = useI18n();
  return <p role="status" className="p-4 text-sm text-ink-soft">{t('common.loading')}</p>;
}
export function errorText(e: unknown, t: (k: never, p?: never) => string): string {
  if (e instanceof ApiError) {
    const key = e.code === 'network' ? 'errors.network' : `errors.${e.code}`;
    const base = (t as unknown as (k: string) => string)(key);
    // The backend message carries the exact reason (e.g. "Agent is offline"); show it after the generic text.
    return e.message && e.code !== 'network' && e.code !== 'internal' ? `${base} ${e.message}` : base;
  }
  return e instanceof Error ? e.message : String(e);
}
export function ErrorNote({ error }: { error: unknown }) {
  const { t } = useI18n();
  if (!error) return null;
  return (
    <p role="alert" data-testid="error-note" className="rounded border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
      {errorText(error, t as never)}
    </p>
  );
}

// ------------------------------------------------------------------ form controls
type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export function Button({ variant = 'secondary', size = 'md', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' }) {
  const v: Record<BtnVariant, string> = {
    primary: 'bg-accent text-white border-accent-strong hover:bg-accent-strong',
    secondary: 'bg-surface text-ink border-line-strong hover:bg-accent-soft',
    danger: 'bg-danger text-white border-danger hover:brightness-95',
    ghost: 'bg-transparent text-ink-soft border-transparent hover:bg-surface-3',
  };
  return <button type="button" {...p} className={`inline-flex items-center justify-center gap-1.5 rounded-sm border-2 font-bold disabled:cursor-not-allowed disabled:opacity-50 ${size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1.5 text-sm'} ${v[variant]} ${className}`} />;
}
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-xs font-bold text-ink-soft">{label}</label>
      {children(id)}
      {hint ? <p className="text-xs text-ink-faint">{hint}</p> : null}
      {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
const ctl = 'w-full rounded-sm border-2 border-line-strong bg-white px-2 py-1.5 text-sm text-ink disabled:bg-surface-3';
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`${ctl} ${p.className ?? ''}`} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`${ctl} ${p.className ?? ''}`} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={`${ctl} min-h-24 ${p.className ?? ''}`} />;

// ------------------------------------------------------------------ modal (native <dialog>: focus trap + Esc for free)
export function Modal({ open, title, onClose, children, wide, testId }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean; testId?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useI18n();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  if (!open) return null;
  return (
    <dialog ref={ref} data-testid={testId} onClose={onClose} onCancel={onClose} className={`m-auto rounded-md border-2 border-line-strong bg-surface p-0 text-ink backdrop:bg-night/50 ${wide ? 'w-[min(52rem,94vw)]' : 'w-[min(32rem,94vw)]'}`}>
      <div className="flex items-center justify-between border-b-2 border-line px-4 py-3">
        <h2 className="pixel-heading text-sm">{title}</h2>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label={t('common.close')}>✕</Button>
      </div>
      <div className="max-h-[75vh] overflow-auto p-4">{children}</div>
    </dialog>
  );
}

export function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 border-b border-surface-3 py-1.5 text-sm">
      <dt className="text-xs font-bold uppercase tracking-wide text-ink-faint">{k}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function useRelTime() {
  const { t } = useI18n();
  return (iso: string | null | undefined): string => {
    if (!iso) return t('common.never');
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 5) return t('common.justNow');
    if (s < 60) return t('common.secondsAgo', { n: s });
    if (s < 3600) return t('common.minutesAgo', { n: Math.round(s / 60) });
    if (s < 86400) return t('common.hoursAgo', { n: Math.round(s / 3600) });
    return new Date(iso).toLocaleString();
  };
}
