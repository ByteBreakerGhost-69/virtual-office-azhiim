import { useState } from 'react';
import type { ApprovalDTO } from '@avo/shared';
import { api } from '../../lib/api.js';
import { useAction, useApprovals } from '../../lib/queries.js';
import { useI18n } from '../../i18n/index.js';
import { useSession } from '../../app/session.js';
import { Button, Empty, ErrorNote, Field, Input, KV, Loading, ModeBadge, PageHeader, Panel, Pill, useRelTime } from '../../components/ui.js';

const riskTone = (r: string) => (r === 'critical' || r === 'high' ? 'danger' : r === 'medium' ? 'warn' : 'info') as 'danger' | 'warn' | 'info';

function ApprovalCard({ a }: { a: ApprovalDTO }) {
  const { t, td } = useI18n();
  const { can } = useSession();
  const rel = useRelTime();
  const [reason, setReason] = useState('');
  const [need, setNeed] = useState(false);
  const decide = useAction((b: { decision: 'approve' | 'reject'; reason?: string }) => api.post(`/approvals/${a.id}/decide`, { ...b, payloadHash: a.payloadHash }), [['approvals'], ['tasks'], ['task'], ['agents'], ['overview'], ['activity']]);
  const pending = a.status === 'pending';
  return (
    <article data-testid={`approval-${a.id}`} data-approval-status={a.status} className="pixel-box pixel-box--warn p-4">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="font-bold">{td('category', a.actionCategory)} → {a.target}</h3>
        <ModeBadge mode={a.mode} compact />
        <Pill tone={riskTone(a.risk)} icon="alert">{t('approvals.risk')}: {td('risk', a.risk)}</Pill>
        <Pill tone={a.status === 'approved' ? 'ok' : a.status === 'pending' ? 'warn' : 'neutral'}>{td('approval.status', a.status)}</Pill>
      </header>
      <dl>
        <KV k={t('approvals.requestedBy')}>{a.agentName}</KV>
        {a.taskTitle ? <KV k={t('common.task')}>{a.taskTitle}</KV> : null}
        <KV k={t('approvals.args')}><span className="whitespace-pre-wrap">{a.argsSummary}</span></KV>
        <KV k={t('approvals.consequence')}>{a.consequence}</KV>
        <KV k={t('approvals.requestedAt')}>{rel(a.requestedAt)}</KV>
        <KV k={t('approvals.expiresAt')}>{new Date(a.expiresAt).toLocaleString()}</KV>
        <KV k={t('approvals.hash')}><code className="break-all text-xs">{a.payloadHash}</code></KV>
        {a.decidedAt ? <KV k={t('approvals.decidedBy')}>{a.decidedBy ?? '—'} · {rel(a.decidedAt)}{a.reason ? ` · ${a.reason}` : ''}</KV> : null}
      </dl>
      {pending ? (
        <>
          <p className="mt-2 text-xs text-ink-faint">{t('approvals.hashNote')}</p>
          {can('approval.decide') ? (
            <div className="mt-3 grid gap-2">
              <Field label={t('approvals.reasonLabel')} error={need ? t('approvals.reasonRequired') : null}>{(id) => <Input id={id} value={reason} onChange={(e) => { setReason(e.target.value); setNeed(false); }} data-testid={`approval-reason-${a.id}`} />}</Field>
              <ErrorNote error={decide.error} />
              <div className="flex gap-2">
                <Button variant="primary" disabled={decide.isPending} data-testid={`approval-approve-${a.id}`} onClick={() => decide.mutate({ decision: 'approve', ...(reason.trim() ? { reason: reason.trim() } : {}) })}>{t('approvals.approve')}</Button>
                <Button variant="danger" disabled={decide.isPending} data-testid={`approval-reject-${a.id}`} onClick={() => (reason.trim() ? decide.mutate({ decision: 'reject', reason: reason.trim() }) : setNeed(true))}>{t('approvals.reject')}</Button>
              </div>
            </div>
          ) : <p className="mt-2 text-sm text-ink-soft">{t('common.noPermission')}</p>}
        </>
      ) : null}
      {a.status === 'expired' ? <p className="mt-2 text-xs text-ink-faint">{t('approvals.expiredNote')}</p> : null}
    </article>
  );
}

export default function ApprovalsPage() {
  const { t } = useI18n();
  const q = useApprovals();
  if (q.isLoading) return <Loading />;
  const list = q.data ?? [];
  const pending = list.filter((a) => a.status === 'pending');
  const done = list.filter((a) => a.status !== 'pending');
  return (
    <div data-testid="approvals-page">
      <PageHeader title={t('approvals.title')} subtitle={t('approvals.subtitle')} />
      <ErrorNote error={q.error} />
      <h2 className="pixel-heading mb-2 text-sm text-ink-soft">{t('approvals.pending')} ({pending.length})</h2>
      <div className="mb-6 grid gap-3 xl:grid-cols-2">{pending.length ? pending.map((a) => <ApprovalCard key={a.id} a={a} />) : <Panel><Empty title={t('approvals.empty')} /></Panel>}</div>
      <h2 className="pixel-heading mb-2 text-sm text-ink-soft">{t('approvals.history')}</h2>
      <div className="grid gap-3 xl:grid-cols-2">{done.length ? done.map((a) => <ApprovalCard key={a.id} a={a} />) : <Panel><Empty title={t('approvals.emptyHistory')} /></Panel>}</div>
    </div>
  );
}
