import { useEffect, useState, type FormEvent } from 'react';
import { DEFAULT_SETTINGS, type SettingsDTO } from '@avo/shared';
import { api } from '../../lib/api.js';
import { useAction, useSettings } from '../../lib/queries.js';
import { useI18n, type MessageKey } from '../../i18n/index.js';
import { useSession } from '../../app/session.js';
import { Button, ErrorNote, Field, Input, KV, Loading, PageHeader, Panel, Select } from '../../components/ui.js';

const NUMERIC = ['staleAfterMs', 'offlineAfterMs', 'restAfterIdleMs', 'talkWindowMs', 'runDeadlineMs', 'approvalTtlMs', 'heartbeatIntervalMs', 'maxConcurrentRunsPerAgent'] as const;

export default function SettingsPage() {
  const { t, td } = useI18n();
  const { can, user, workspaceName } = useSession();
  const q = useSettings();
  const [f, setF] = useState<SettingsDTO>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (q.data) setF(q.data); }, [q.data]);
  const save = useAction((b: Partial<SettingsDTO>) => api.patch<SettingsDTO>('/settings', b), [['settings'], ['overview'], ['agents']]);
  if (q.isLoading) return <Loading />;
  const editable = can('settings.manage');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { dispatchPaused: _ignored, ...body } = f;
    void _ignored;
    setSaved(false);
    const ok = await save.mutateAsync(body).then(() => true).catch(() => false);
    setSaved(ok);
  };
  return (
    <div data-testid="settings-page">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Panel>
          {!editable ? <p className="mb-3 text-sm text-ink-soft">{t('settings.readOnly')}</p> : null}
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" data-testid="settings-form">
            {NUMERIC.map((k) => (
              <Field key={k} label={t(`settings.${k}` as MessageKey)}>
                {(id) => <Input id={id} type="number" min={k === 'maxConcurrentRunsPerAgent' ? 1 : 1000} disabled={!editable} value={f[k]} onChange={(e) => { setF({ ...f, [k]: Number(e.target.value) }); setSaved(false); }} data-testid={`setting-${k}`} />}
              </Field>
            ))}
            <Field label={t('settings.defaultLocale')}>{(id) => <Select id={id} disabled={!editable} value={f.defaultLocale} onChange={(e) => setF({ ...f, defaultLocale: e.target.value as 'id' | 'en' })}><option value="id">Bahasa Indonesia</option><option value="en">English</option></Select>}</Field>
            <p className="text-xs text-ink-faint sm:col-span-2">{t('settings.thresholdNote')}</p>
            <div className="sm:col-span-2"><ErrorNote error={save.error} /></div>
            {saved ? <p role="status" className="text-sm font-bold text-ok sm:col-span-2" data-testid="settings-saved">{t('settings.saved')}</p> : null}
            {editable ? <div className="sm:col-span-2"><Button type="submit" variant="primary" disabled={save.isPending} data-testid="settings-save">{t('common.save')}</Button></div> : null}
          </form>
        </Panel>
        <Panel title={t('settings.account')}>
          <dl>
            <KV k={t('auth.username')}>{user.username}</KV>
            <KV k={t('auth.displayName')}>{user.displayName}</KV>
            <KV k="Role">{td('auth.role', user.role)}</KV>
            <KV k={t('settings.workspace')}>{workspaceName}</KV>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
