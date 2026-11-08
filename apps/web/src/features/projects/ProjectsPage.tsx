import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api.js';
import { useAction, useProjects } from '../../lib/queries.js';
import { useI18n } from '../../i18n/index.js';
import { useSession } from '../../app/session.js';
import { Button, Empty, ErrorNote, Field, Input, Loading, PageHeader, Panel, Pill, Textarea } from '../../components/ui.js';

export function FoundationNotice({ text }: { text: string }) {
  return <p role="note" data-testid="foundation-notice" className="mb-4 rounded border border-dashed border-warn bg-warn-soft px-3 py-2 text-sm text-warn">{text}</p>;
}

export default function ProjectsPage() {
  const { t } = useI18n();
  const { can } = useSession();
  const q = useProjects();
  const [f, setF] = useState({ name: '', description: '' });
  const create = useAction((b: unknown) => api.post('/projects', b), [['projects']]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await create.mutateAsync({ name: f.name.trim(), ...(f.description ? { description: f.description } : {}) }).then(() => true).catch(() => false);
    if (ok) setF({ name: '', description: '' });
  };
  if (q.isLoading) return <Loading />;
  return (
    <div data-testid="projects-page">
      <PageHeader title={t('projects.title')} subtitle={t('projects.subtitle')} />
      <FoundationNotice text={t('projects.notice')} />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Panel>
          {q.data?.length ? (
            <ul className="grid gap-2">{q.data.map((p) => <li key={p.id} className="rounded border border-line bg-white p-3" data-testid={`project-${p.id}`}><b>{p.name}</b> <Pill>{t('projects.tasks', { n: p.taskCount })}</Pill>{p.description ? <p className="mt-1 text-sm text-ink-soft">{p.description}</p> : null}</li>)}</ul>
          ) : <Empty title={t('projects.empty')} />}
        </Panel>
        {can('task.create') ? (
          <Panel title={t('projects.create')}>
            <form onSubmit={submit} className="grid gap-3">
              <Field label={t('projects.name')}>{(id) => <Input id={id} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="project-name" />}</Field>
              <Field label={t('projects.description')}>{(id) => <Textarea id={id} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
              <ErrorNote error={create.error} />
              <Button type="submit" variant="primary" data-testid="project-create">{t('common.create')}</Button>
            </form>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
