import { useState, type FormEvent } from 'react';
import { KNOWN_CAPABILITIES, ORG_ROLES } from '@avo/shared';
import { api } from '../../lib/api.js';
import { useAction, useAgents, useDepartments, useIntegrations } from '../../lib/queries.js';
import { useI18n } from '../../i18n/index.js';
import { useSession } from '../../app/session.js';
import { Button, Empty, ErrorNote, Field, Input, Loading, Modal, ModeBadge, PageHeader, Panel, Select, StateBadge, useRelTime } from '../../components/ui.js';
import { AgentPanel } from './AgentPanel.js';

interface Discovered { runtimeRef?: string; id?: string; name?: string; description?: string; capabilities?: string[] }

function RegisterModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, td } = useI18n();
  const ints = useIntegrations();
  const depts = useDepartments();
  const real = (ints.data ?? []).filter((i) => i.mode === 'REAL');
  const blank = { integrationId: '', runtimeRef: '', name: '', handle: '', title: '', departmentId: '', orgRole: 'specialist', caps: [] as string[] };
  const [f, setF] = useState(blank);
  const [found, setFound] = useState<Discovered[] | null>(null);
  const reg = useAction((b: Record<string, unknown>) => api.post('/agents', b));
  const disc = useAction((id: string) => api.get<Discovered[]>(`/integrations/${id}/discover`));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await reg
      .mutateAsync({ integrationId: f.integrationId, name: f.name.trim(), handle: f.handle.trim(), title: f.title.trim(), orgRole: f.orgRole, capabilities: f.caps, ...(f.runtimeRef ? { runtimeRef: f.runtimeRef } : {}), departmentId: f.departmentId || null })
      .then(() => true)
      .catch(() => false);
    if (ok) {
      setF(blank);
      setFound(null);
      onClose();
    }
  };
  return (
    <Modal open={open} title={t('agents.register')} onClose={onClose} wide testId="register-dialog">
      {real.length === 0 ? (
        <p className="text-sm">{t('agents.form.noIntegration')}</p>
      ) : (
        <form onSubmit={submit} className="grid gap-3" data-testid="register-form">
          <Field label={t('agents.form.integration')}>
            {(id) => (
              <Select id={id} required value={f.integrationId} onChange={(e) => { setF({ ...f, integrationId: e.target.value }); setFound(null); }} data-testid="reg-integration">
                <option value="" disabled>—</option>
                {real.map((i) => <option key={i.id} value={i.id}>{i.name} ({td('kind', i.kind)})</option>)}
              </Select>
            )}
          </Field>
          {f.integrationId ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={disc.isPending} onClick={() => disc.mutate(f.integrationId, { onSuccess: (r) => setFound(r) })}>{t('agents.form.discover')}</Button>
              {found && found.length === 0 ? <span className="text-xs text-ink-soft">{t('agents.form.discoverNone')}</span> : null}
              {found?.map((d, i) => (
                <Button key={i} size="sm" variant="ghost" onClick={() => setF({ ...f, runtimeRef: d.runtimeRef ?? d.id ?? '', name: f.name || d.name || '', handle: f.handle || (d.runtimeRef ?? d.id ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '-') })}>{d.name ?? d.runtimeRef ?? d.id}</Button>
              ))}
              <ErrorNote error={disc.error} />
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('agents.form.runtimeRef')}>{(id) => <Input id={id} value={f.runtimeRef} onChange={(e) => setF({ ...f, runtimeRef: e.target.value })} data-testid="reg-runtimeref" />}</Field>
            <Field label={t('agents.form.name')}>{(id) => <Input id={id} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="reg-name" />}</Field>
            <Field label={t('agents.form.handle')}>{(id) => <Input id={id} required minLength={2} pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]*" value={f.handle} onChange={(e) => setF({ ...f, handle: e.target.value })} data-testid="reg-handle" />}</Field>
            <Field label={t('agents.form.title')}>{(id) => <Input id={id} required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} data-testid="reg-title" />}</Field>
            <Field label={t('agents.form.department')}>
              {(id) => (
                <Select id={id} value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })} data-testid="reg-dept">
                  <option value="">{t('org.unassigned')}</option>
                  {(depts.data ?? []).map((d) => <option key={d.id} value={d.id}>{td('dept', d.key) || d.name}</option>)}
                </Select>
              )}
            </Field>
            <Field label={t('agents.form.orgRole')}>{(id) => <Select id={id} value={f.orgRole} onChange={(e) => setF({ ...f, orgRole: e.target.value })}>{ORG_ROLES.map((r) => <option key={r} value={r}>{td('role', r)}</option>)}</Select>}</Field>
          </div>
          <fieldset>
            <legend className="text-xs font-bold text-ink-soft">{t('agents.form.capabilities')}</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {KNOWN_CAPABILITIES.map((c) => <label key={c} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={f.caps.includes(c)} onChange={(e) => setF({ ...f, caps: e.target.checked ? [...f.caps, c] : f.caps.filter((x) => x !== c) })} />{c}</label>)}
            </div>
            <p className="mt-1 text-xs text-ink-faint">{t('agent.capabilitiesNote')}</p>
          </fieldset>
          <ErrorNote error={reg.error} />
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" variant="primary" disabled={reg.isPending} data-testid="reg-submit">{t('agents.register')}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default function AgentsPage() {
  const { t, td } = useI18n();
  const { can } = useSession();
  const rel = useRelTime();
  const agents = useAgents();
  const [sel, setSel] = useState<string | null>(null);
  const [reg, setReg] = useState(false);
  const del = useAction((id: string) => api.del(`/agents/${id}`));
  if (agents.isLoading) return <Loading />;
  const list = agents.data ?? [];
  return (
    <div data-testid="agents-page">
      <PageHeader title={t('agents.title')} subtitle={t('agents.subtitle')} actions={can('agent.manage') ? <Button variant="primary" data-testid="agent-register" onClick={() => setReg(true)}>{t('agents.register')}</Button> : null} />
      <ErrorNote error={agents.error} />
      <ErrorNote error={del.error} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Panel>
          {list.length === 0 ? (
            <Empty title={t('agents.empty')} help={t('overview.noAgentsHelp')} />
          ) : (
            <div className="overflow-x-auto">
              <table className="avo-table" data-testid="agents-table">
                <thead><tr><th>{t('agents.col.agent')}</th><th>{t('common.mode')}</th><th>{t('agents.col.department')}</th><th>{t('agents.col.runtime')}</th><th>{t('agents.col.state')}</th><th>{t('agents.col.task')}</th><th>{t('agents.col.seen')}</th><th /></tr></thead>
                <tbody>
                  {list.map((a) => (
                    <tr key={a.id} data-testid={`agent-row-${a.id}`} data-agent-handle={a.handle} data-selected={a.id === sel}>
                      <td><button type="button" className="text-left font-bold text-accent underline" onClick={() => setSel(a.id)}>{a.name}</button><div className="text-xs text-ink-faint">{a.title}</div></td>
                      <td><ModeBadge mode={a.mode} compact /></td>
                      <td>{a.departmentKey ? td('dept', a.departmentKey) || a.departmentName : t('org.unassigned')}</td>
                      <td className="text-xs">{td('kind', a.runtimeKind)}</td>
                      <td><StateBadge state={a.state} stale={a.stale} testId={`agent-state-${a.id}`} /></td>
                      <td className="max-w-48 truncate text-xs">{a.currentTaskTitle ?? '—'}</td>
                      <td className="text-xs">{rel(a.lastSeenAt)}</td>
                      <td>{can('agent.manage') ? <Button size="sm" variant="ghost" onClick={() => { if (confirm(t('agents.removeConfirm'))) del.mutate(a.id); }}>{t('agents.remove')}</Button> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <div>{sel ? <AgentPanel agentId={sel} onClose={() => setSel(null)} /> : null}</div>
      </div>
      <RegisterModal open={reg} onClose={() => setReg(false)} />
    </div>
  );
}
