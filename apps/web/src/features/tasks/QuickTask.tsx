import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { KNOWN_CAPABILITIES, PRIORITIES, type TaskDTO } from '@avo/shared';
import { api } from '../../lib/api.js';
import { useAction, useAgents, useTasks } from '../../lib/queries.js';
import { useI18n } from '../../i18n/index.js';
import { Button, ErrorNote, Field, Input, Modal, ModeBadge, Select, Textarea } from '../../components/ui.js';

/** Create a task and (optionally) assign it right away. Used from the Tasks page and from the agent panel. */
export function QuickTaskModal({ open, onClose, agentId }: { open: boolean; onClose: () => void; agentId?: string | null }) {
  const { t, td } = useI18n();
  const nav = useNavigate();
  const agents = useAgents();
  const tasks = useTasks();
  const blank = { title: '', objective: '', expectedOutput: '', priority: 'normal', assigneeAgentId: agentId ?? '', requiresApproval: false, caps: [] as string[], dependsOn: [] as string[] };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (open) setF({ ...blank, assigneeAgentId: agentId ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agentId]);
  const create = useAction((b: Record<string, unknown>) => api.post<TaskDTO>('/tasks', b));
  const assignee = agents.data?.find((a) => a.id === f.assigneeAgentId);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = {
      title: f.title.trim(),
      objective: f.objective.trim(),
      priority: f.priority,
      requiresApproval: f.requiresApproval,
      requiredCapabilities: f.caps,
      dependsOn: f.dependsOn,
      ...(f.expectedOutput.trim() ? { expectedOutput: f.expectedOutput.trim() } : {}),
      ...(f.assigneeAgentId ? { assigneeAgentId: f.assigneeAgentId } : {}),
    };
    const created = await create.mutateAsync(body).catch(() => null);
    if (created) {
      onClose();
      nav(`/tasks/${created.id}`);
    }
  };
  return (
    <Modal open={open} title={t('tasks.create')} onClose={onClose} wide testId="task-dialog">
      <form onSubmit={submit} className="grid gap-3" data-testid="task-form">
        <Field label={t('tasks.form.title')}>{(id) => <Input id={id} required maxLength={160} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} data-testid="task-title" />}</Field>
        <Field label={t('tasks.form.objective')}>{(id) => <Textarea id={id} required maxLength={8000} value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} data-testid="task-objective" />}</Field>
        <Field label={t('tasks.form.expectedOutput')}>{(id) => <Input id={id} value={f.expectedOutput} onChange={(e) => setF({ ...f, expectedOutput: e.target.value })} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('tasks.form.priority')}>{(id) => <Select id={id} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p} value={p}>{td('priority', p)}</option>)}</Select>}</Field>
          <Field label={t('tasks.form.assignee')}>
            {(id) => (
              <Select id={id} value={f.assigneeAgentId} onChange={(e) => setF({ ...f, assigneeAgentId: e.target.value })} data-testid="task-assignee">
                <option value="">{t('tasks.form.unassigned')}</option>
                {(agents.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name} — {a.mode === 'REAL' ? t('mode.REAL') : t('mode.SIMULATED')} — {td('state', a.state)}</option>)}
              </Select>
            )}
          </Field>
        </div>
        {assignee ? <p className="flex items-center gap-2 text-xs text-ink-soft"><ModeBadge mode={assignee.mode} compact />{assignee.mode === 'SIMULATED' ? t('tasks.form.simNote') : null}</p> : null}
        <fieldset className="grid gap-1">
          <legend className="text-xs font-bold text-ink-soft">{t('tasks.form.requiredCapabilities')}</legend>
          <div className="flex flex-wrap gap-2">
            {KNOWN_CAPABILITIES.map((c) => (
              <label key={c} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={f.caps.includes(c)} onChange={(e) => setF({ ...f, caps: e.target.checked ? [...f.caps, c] : f.caps.filter((x) => x !== c) })} />{c}</label>
            ))}
          </div>
        </fieldset>
        {tasks.data?.length ? (
          <Field label={t('tasks.form.dependsOn')}>
            {(id) => (
              <select id={id} multiple className="min-h-20 w-full rounded-sm border-2 border-line-strong bg-white px-2 py-1 text-sm" value={f.dependsOn} onChange={(e) => setF({ ...f, dependsOn: [...e.target.selectedOptions].map((o) => o.value) })}>
                {tasks.data!.filter((x) => x.status !== 'cancelled').map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
              </select>
            )}
          </Field>
        ) : null}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.requiresApproval} onChange={(e) => setF({ ...f, requiresApproval: e.target.checked })} data-testid="task-requires-approval" />{t('tasks.form.requiresApproval')}</label>
        <ErrorNote error={create.error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={create.isPending} data-testid="create-task-submit">{t('tasks.form.submit')}</Button>
        </div>
      </form>
    </Modal>
  );
}
