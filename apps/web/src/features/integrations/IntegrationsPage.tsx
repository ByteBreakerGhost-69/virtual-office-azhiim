import { useState, type FormEvent } from 'react';
import type { IntegrationDTO } from '@avo/shared';
import { api } from '../../lib/api.js';
import { useAction, useAdapterKinds, useIntegrations, useSimulation } from '../../lib/queries.js';
import { useI18n } from '../../i18n/index.js';
import { useSession } from '../../app/session.js';
import { Button, Empty, ErrorNote, Field, Input, KV, Loading, Modal, ModeBadge, PageHeader, Panel, Pill, Select, useRelTime } from '../../components/ui.js';

const statusTone = (s: string) => (s === 'connected' ? 'ok' : s === 'degraded' ? 'warn' : s === 'disconnected' ? 'danger' : 'neutral') as 'ok' | 'warn' | 'danger' | 'neutral';

function IntegrationCard({ i }: { i: IntegrationDTO }) {
  const { t, td } = useI18n();
  const { can } = useSession();
  const rel = useRelTime();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ name: i.name, baseUrl: i.baseUrl ?? '', secret: '' });
  const check = useAction(() => api.post(`/integrations/${i.id}/check`));
  const del = useAction(() => api.del(`/integrations/${i.id}`));
  const upd = useAction((b: Record<string, unknown>) => api.patch(`/integrations/${i.id}`, b));
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await upd.mutateAsync({ name: f.name, ...(f.baseUrl ? { baseUrl: f.baseUrl } : {}), ...(f.secret ? { secret: f.secret } : {}) }).then(() => true).catch(() => false);
    if (ok) { setEditing(false); setF({ ...f, secret: '' }); }
  };
  const manage = can('integration.manage');
  return (
    <article data-testid={`integration-${i.id}`} data-integration-status={i.status} data-integration-mode={i.mode} className={`pixel-box p-4 ${i.mode === 'SIMULATED' ? 'pixel-box--sim' : ''}`}>
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="font-bold">{i.name}</h3>
        <ModeBadge mode={i.mode} />
        <Pill tone={statusTone(i.status)} icon={i.status === 'connected' ? 'check' : i.status === 'unchecked' ? 'question' : 'alert'} testId={`integration-status-${i.id}`}>{td('integration.status', i.status)}</Pill>
      </header>
      <dl>
        <KV k={t('integrations.kind')}>{td('kind', i.kind)}</KV>
        {i.baseUrl ? <KV k={t('integrations.baseUrl')}><code className="text-xs">{i.baseUrl}</code></KV> : null}
        {i.mode === 'REAL' ? <KV k={t('integrations.secret')}>{i.hasSecret ? t('integrations.secretStored') : t('integrations.noSecret')}</KV> : null}
        <KV k={t('integrations.lastChecked')}>{rel(i.lastCheckedAt)}</KV>
        <KV k={t('overview.lastSuccess')}>{rel(i.lastSuccessAt)}</KV>
        {i.lastError ? <KV k={t('integrations.lastError')}><span className="text-danger" data-testid="integration-error">{i.lastError}</span></KV> : null}
        <KV k={t('integrations.agents')}>{i.agentCount}</KV>
        <KV k={t('integrations.features')}>
          <span className="flex flex-wrap gap-1">{(['pause', 'resume', 'cancel', 'approvals', 'eventStream'] as const).map((k) => <Pill key={k} tone={i.features[k] ? 'ok' : 'neutral'} icon={i.features[k] ? 'check' : 'cross'}>{t(`integrations.feature.${k}` as never)}</Pill>)}</span>
        </KV>
      </dl>
      <ErrorNote error={check.error ?? del.error} />
      {manage ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="primary" disabled={check.isPending} data-testid={`integration-check-${i.id}`} onClick={() => check.mutate(undefined)}>{check.isPending ? t('integrations.checking') : t('integrations.check')}</Button>
          {i.mode === 'REAL' ? <Button size="sm" onClick={() => setEditing(true)}>{t('common.edit')}</Button> : null}
          {i.mode === 'REAL' ? <Button size="sm" variant="ghost" onClick={() => { if (confirm(t('integrations.removeConfirm'))) del.mutate(undefined); }}>{t('common.delete')}</Button> : null}
        </div>
      ) : null}
      <Modal open={editing} title={i.name} onClose={() => setEditing(false)}>
        <form onSubmit={save} className="grid gap-3">
          <Field label={t('common.name')}>{(id) => <Input id={id} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label={t('integrations.baseUrl')}>{(id) => <Input id={id} type="url" value={f.baseUrl} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} />}</Field>
          <Field label={t('integrations.secretReplace')}>{(id) => <Input id={id} type="password" autoComplete="off" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} />}</Field>
          <ErrorNote error={upd.error} />
          <div className="flex justify-end gap-2"><Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button><Button type="submit" variant="primary">{t('common.save')}</Button></div>
        </form>
      </Modal>
    </article>
  );
}

function AddIntegration({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, td } = useI18n();
  const kinds = useAdapterKinds();
  const [f, setF] = useState({ kind: 'HERMES', name: '', baseUrl: '', secret: '' });
  const create = useAction((b: Record<string, unknown>) => api.post('/integrations', b));
  const real = (kinds.data ?? []).filter((k) => !k.simulated);
  const d = real.find((k) => k.kind === f.kind);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await create.mutateAsync({ kind: f.kind, name: f.name.trim(), ...(f.baseUrl ? { baseUrl: f.baseUrl.trim() } : {}), ...(f.secret ? { secret: f.secret } : {}) }).then(() => true).catch(() => false);
    if (ok) { setF({ ...f, name: '', secret: '' }); onClose(); }
  };
  return (
    <Modal open={open} title={t('integrations.add')} onClose={onClose} testId="integration-dialog">
      <form onSubmit={submit} className="grid gap-3" data-testid="integration-form">
        <Field label={t('integrations.kind')}>
          {(id) => (
            <Select id={id} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, baseUrl: '' })} data-testid="int-kind">
              {real.map((k) => <option key={k.kind} value={k.kind} disabled={!k.available}>{td('kind', k.kind)}{k.available ? '' : ` — ${t('common.unavailable')}`}</option>)}
            </Select>
          )}
        </Field>
        {d && !d.available ? <p className="text-sm text-warn">{t('integrations.unavailableKind')} {d.notes}</p> : null}
        {f.kind === 'HERMES' ? <p className="text-xs text-ink-soft">{t('integrations.hermesHelp')}</p> : null}
        <Field label={t('common.name')}>{(id) => <Input id={id} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="int-name" />}</Field>
        <Field label={t('integrations.baseUrl')} hint={d?.config.baseUrlExample}>{(id) => <Input id={id} type="url" required={!!d?.config.baseUrlRequired} placeholder={d?.config.baseUrlExample} value={f.baseUrl} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} data-testid="int-url" />}</Field>
        <Field label={t('integrations.secret')}>{(id) => <Input id={id} type="password" autoComplete="off" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} data-testid="int-secret" />}</Field>
        <ErrorNote error={create.error} />
        <div className="flex justify-end gap-2"><Button onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" variant="primary" disabled={create.isPending || (d ? !d.available : false)} data-testid="int-submit">{t('common.create')}</Button></div>
      </form>
    </Modal>
  );
}

function SimulationSection() {
  const { t } = useI18n();
  const { can } = useSession();
  const sim = useSimulation();
  const seed = useAction(() => api.post('/simulation/seed'));
  const clear = useAction(() => api.del('/simulation'));
  const present = sim.data?.present;
  return (
    <Panel title={t('integrations.simulation')} tone="sim" testId="simulation-section">
      <p className="mb-3 text-sm text-ink-soft">{t('integrations.simulationHelp')}</p>
      <p className="mb-3 text-sm font-bold" data-testid="simulation-status">{present ? t('integrations.simPresent', { n: sim.data?.agents ?? 0 }) : t('integrations.simAbsent')}</p>
      <ErrorNote error={seed.error ?? clear.error} />
      {can('simulation.manage') ? (
        <div className="flex gap-2">
          {!present ? <Button variant="primary" disabled={seed.isPending} data-testid="simulation-seed" onClick={() => seed.mutate(undefined)}>{t('integrations.simSeed')}</Button> : null}
          {present ? <Button variant="danger" disabled={clear.isPending} data-testid="simulation-clear" onClick={() => { if (confirm(t('integrations.simClearConfirm'))) clear.mutate(undefined); }}>{t('integrations.simClear')}</Button> : null}
        </div>
      ) : <p className="text-sm text-ink-soft">{t('common.noPermission')}</p>}
    </Panel>
  );
}

export default function IntegrationsPage() {
  const { t } = useI18n();
  const { can } = useSession();
  const q = useIntegrations();
  const [add, setAdd] = useState(false);
  if (q.isLoading) return <Loading />;
  const list = q.data ?? [];
  const real = list.filter((i) => i.mode === 'REAL');
  const sim = list.filter((i) => i.mode === 'SIMULATED');
  return (
    <div data-testid="integrations-page">
      <PageHeader title={t('integrations.title')} subtitle={t('integrations.subtitle')} actions={can('integration.manage') ? <Button variant="primary" data-testid="integration-add" onClick={() => setAdd(true)}>{t('integrations.add')}</Button> : null} />
      <ErrorNote error={q.error} />
      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        {real.length ? real.map((i) => <IntegrationCard key={i.id} i={i} />) : <Panel><Empty title={t('integrations.empty')} help={t('integrations.hermesHelp')} /></Panel>}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <SimulationSection />
        {sim.map((i) => <IntegrationCard key={i.id} i={i} />)}
      </div>
      <AddIntegration open={add} onClose={() => setAdd(false)} />
    </div>
  );
}
