import { useState, type FormEvent } from 'react';
import { ORG_ROLES, ROOM_KEYS } from '@avo/shared';
import { api } from '../../lib/api.js';
import { useAction, useAgents, useDepartments, useOrganization } from '../../lib/queries.js';
import { useI18n } from '../../i18n/index.js';
import { useSession } from '../../app/session.js';
import { Button, Empty, ErrorNote, Field, Input, Loading, Modal, ModeBadge, PageHeader, Panel, Select, StateBadge } from '../../components/ui.js';

export default function OrganizationPage() {
  const { t, td } = useI18n();
  const { can } = useSession();
  const org = useOrganization();
  const agents = useAgents();
  const depts = useDepartments();
  const [edit, setEdit] = useState<string | null>(null);
  const [add, setAdd] = useState(false);
  const [form, setForm] = useState({ departmentId: '', orgRole: 'specialist', reportsToAgentId: '' });
  const [nd, setNd] = useState({ name: '', color: '#2fd6e6', homeRoom: 'employee_workspace' });
  const assign = useAction((a: { id: string; body: unknown }) => api.patch(`/agents/${a.id}/assignment`, a.body));
  const addDept = useAction((b: unknown) => api.post('/departments', b));
  if (org.isLoading || agents.isLoading) return <Loading />;
  const byId = new Map((agents.data ?? []).map((a) => [a.id, a]));
  const editing = edit ? byId.get(edit) : null;
  const card = (id: string) => {
    const a = byId.get(id);
    if (!a) return null;
    return (
      <li key={id} data-testid={`org-agent-${id}`} className="flex flex-wrap items-center gap-2 rounded border border-line bg-white px-2 py-1.5 text-sm">
        <b>{a.name}</b>
        <span className="text-xs text-ink-faint">{td('role', a.orgRole)} · {a.title}</span>
        <ModeBadge mode={a.mode} compact />
        <StateBadge state={a.state} stale={a.stale} />
        {a.reportsToAgentId ? <span className="text-xs text-ink-faint">→ {byId.get(a.reportsToAgentId)?.name}</span> : null}
        {can('agent.manage') ? (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { setEdit(id); setForm({ departmentId: a.departmentId ?? '', orgRole: a.orgRole, reportsToAgentId: a.reportsToAgentId ?? '' }); }}>{t('org.assign')}</Button>
        ) : null}
      </li>
    );
  };
  const submitAssign = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    const ok = await assign.mutateAsync({ id: edit, body: { departmentId: form.departmentId || null, orgRole: form.orgRole, reportsToAgentId: form.reportsToAgentId || null } }).then(() => true).catch(() => false);
    if (ok) setEdit(null);
  };
  const submitDept = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await addDept.mutateAsync({ key: nd.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dept', name: nd.name, color: nd.color, homeRoom: nd.homeRoom }).then(() => true).catch(() => false);
    if (ok) { setAdd(false); setNd({ ...nd, name: '' }); }
  };
  return (
    <div data-testid="organization-page">
      <PageHeader title={t('org.title')} subtitle={t('org.subtitle')} actions={can('agent.manage') ? <Button onClick={() => setAdd(true)}>{t('org.addDepartment')}</Button> : null} />
      <ErrorNote error={org.error} />
      <div className="grid gap-4 lg:grid-cols-2">
        {org.data?.departments.map((d) => (
          <Panel key={d.id} title={<span className="flex items-center gap-2"><span aria-hidden className="inline-block h-3 w-3 rounded-sm border border-ink" style={{ background: d.color }} />{td('dept', d.key) || d.name}</span>} testId={`org-dept-${d.key}`}>
            <p className="mb-2 text-xs text-ink-faint">{t(`room.${d.homeRoom}` as never)}</p>
            {d.agentIds.length ? <ul className="grid gap-1.5">{d.agentIds.map(card)}</ul> : <p className="text-sm text-ink-soft">{t('org.empty')}</p>}
          </Panel>
        ))}
        {org.data?.unassignedAgentIds.length ? <Panel title={t('org.unassigned')} tone="warn"><ul className="grid gap-1.5">{org.data.unassignedAgentIds.map(card)}</ul></Panel> : null}
      </div>
      {!org.data?.departments.length && !agents.data?.length ? <Empty title={t('agents.empty')} /> : null}
      <Modal open={!!editing} title={editing ? `${t('org.assign')} — ${editing.name}` : ''} onClose={() => setEdit(null)} testId="assign-dialog">
        <form onSubmit={submitAssign} className="grid gap-3">
          <Field label={t('agent.department')}>{(id) => <Select id={id} value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}><option value="">{t('org.unassigned')}</option>{(depts.data ?? []).map((d) => <option key={d.id} value={d.id}>{td('dept', d.key) || d.name}</option>)}</Select>}</Field>
          <Field label={t('agent.orgRole')}>{(id) => <Select id={id} value={form.orgRole} onChange={(e) => setForm({ ...form, orgRole: e.target.value })}>{ORG_ROLES.map((r) => <option key={r} value={r}>{td('role', r)}</option>)}</Select>}</Field>
          <Field label={t('agent.reportsTo')}>{(id) => <Select id={id} value={form.reportsToAgentId} onChange={(e) => setForm({ ...form, reportsToAgentId: e.target.value })}><option value="">{t('common.none')}</option>{(agents.data ?? []).filter((a) => a.id !== edit).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>}</Field>
          <ErrorNote error={assign.error} />
          <div className="flex justify-end gap-2"><Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button type="submit" variant="primary">{t('common.save')}</Button></div>
        </form>
      </Modal>
      <Modal open={add} title={t('org.addDepartment')} onClose={() => setAdd(false)}>
        <form onSubmit={submitDept} className="grid gap-3">
          <Field label={t('org.deptName')}>{(id) => <Input id={id} required value={nd.name} onChange={(e) => setNd({ ...nd, name: e.target.value })} />}</Field>
          <Field label={t('org.deptColor')}>{(id) => <Input id={id} type="color" value={nd.color} onChange={(e) => setNd({ ...nd, color: e.target.value })} />}</Field>
          <Field label={t('org.deptRoom')}>{(id) => <Select id={id} value={nd.homeRoom} onChange={(e) => setNd({ ...nd, homeRoom: e.target.value })}>{ROOM_KEYS.map((r) => <option key={r} value={r}>{t(`room.${r}` as never)}</option>)}</Select>}</Field>
          <ErrorNote error={addDept.error} />
          <div className="flex justify-end gap-2"><Button onClick={() => setAdd(false)}>{t('common.cancel')}</Button><Button type="submit" variant="primary">{t('common.create')}</Button></div>
        </form>
      </Modal>
    </div>
  );
}
