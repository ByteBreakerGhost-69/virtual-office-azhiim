import type { DomainEvent } from '@avo/shared';
import { useI18n, hasKey } from '../i18n/index.js';
import { ModeBadge, PixelIcon, useRelTime } from './ui.js';

const SEV: Record<string, string> = { debug: 'text-ink-faint', info: 'text-accent-strong', warn: 'text-warn', error: 'text-danger', critical: 'text-danger' };
const SEV_ICON: Record<string, string> = { debug: 'dot', info: 'dot', warn: 'alert', error: 'cross', critical: 'stop' };

/** One activity entry: localized type label + the backend's own summary text, and who reported it. Text is rendered as plain text. */
export function EventLine({ e, showMode = true }: { e: DomainEvent; showMode?: boolean }) {
  const { t, td } = useI18n();
  const rel = useRelTime();
  const key = `events.${e.type}`;
  return (
    <li data-testid="event-line" data-event-type={e.type} className="grid gap-0.5 border-b border-surface-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1 font-bold ${SEV[e.severity] ?? ''}`}>
          <PixelIcon name={SEV_ICON[e.severity] ?? 'dot'} size={10} title={td('severity', e.severity)} />
          {hasKey(key) ? t(key) : e.type}
        </span>
        {showMode ? <ModeBadge mode={e.mode} compact /> : null}
        <span className="text-xs text-ink-faint">{td('activity.source', e.source.kind)}</span>
        <time className="ml-auto text-xs text-ink-faint" dateTime={e.occurredAt} title={new Date(e.occurredAt).toLocaleString()}>{rel(e.occurredAt)}</time>
      </div>
      <p className="break-words text-ink-soft">{e.summary}</p>
    </li>
  );
}
