import { useState, type FormEvent } from 'react';
import { MEMORY_SCOPES } from '@avo/shared';
import { api } from '../../lib/api.js';
import { useAction, useMemory } from '../../lib/queries.js';
import { useI18n } from '../../i18n/index.js';
import { useSession } from '../../app/session.js';
import { Button, Empty, ErrorNote, Field, Loading, PageHeader, Panel, Pill, Select, Textarea, useRelTime } from '../../components/ui.js';
import { FoundationNotice } from './ProjectsPage.js';

export default function HivePage() {
  const { t, td } = useI18n();
  const { can } = useSession();
  const rel = useRelTime();
  const q = useMemory();
  const [f, setF] = useState({ scope: 'workspace', content: '' });
  const create = useAction((b: unknown) => api.post('/memory', b), [['memory']]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await create.mutateAsync({ scope: f.scope, content: f.content.trim() }).then(() => true).catch(() => false);
    if (ok) setF({ ...f, content: '' });
  };
  if (q.isLoading) return <Loading />;
  return (
    <div data-testid="hive-page">
      <PageHeader title={t('hive.title')} subtitle={t('hive.subtitle')} />
      <FoundationNotice text={t('hive.notice')} />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Panel>
          {q.data?.length ? (
            <ul className="grid gap-2">{q.data.map((m) => <li key={m.id} className="rounded border border-line bg-white p-3 text-sm"><Pill tone="info">{td('hive.scope', m.scope)}</Pill> <span className="text-xs text-ink-faint">{t('hive.source')}: {m.source} · {rel(m.createdAt)}</span><p className="mt-1 whitespace-pre-wrap">{m.content}</p></li>)}</ul>
          ) : <Empty title={t('hive.empty')} />}
        </Panel>
        {can('agent.manage') ? (
          <Panel title={t('hive.add')}>
            <form onSubmit={submit} className="grid gap-3">
              <Field label={t('hive.scope')}>{(id) => <Select id={id} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>{MEMORY_SCOPES.map((s) => <option key={s} value={s}>{td('hive.scope', s)}</option>)}</Select>}</Field>
              <Field label={t('hive.content')}>{(id) => <Textarea id={id} required value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} data-testid="hive-content" />}</Field>
              <ErrorNote error={create.error} />
              <Button type="submit" variant="primary" data-testid="hive-add">{t('common.create')}</Button>
            </form>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
