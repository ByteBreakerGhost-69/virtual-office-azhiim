import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TASK_STATUSES } from '@avo/shared';
import { useTasks } from '../../lib/queries.js';
import { useI18n } from '../../i18n/index.js';
import { useSession } from '../../app/session.js';
import { Button, Empty, ErrorNote, Loading, ModeBadge, PageHeader, Panel, Pill, Select, taskIcon, taskTone, useRelTime } from '../../components/ui.js';
import { QuickTaskModal } from './QuickTask.js';

export default function TasksPage() {
  const { t, td } = useI18n();
  const { can } = useSession();
  const rel = useRelTime();
  const [status, setStatus] = useState('');
  const [mode, setMode] = useState('');
  const [open, setOpen] = useState(false);
  const tasks = useTasks({ ...(status ? { status } : {}), ...(mode ? { mode } : {}) });
  return (
    <div data-testid="tasks-page">
      <PageHeader
        title={t('tasks.title')}
        subtitle={t('tasks.subtitle')}
        actions={
          <>
            <Select aria-label={t('common.status')} value={status} onChange={(e) => setStatus(e.target.value)} className="!w-auto">
              <option value="">{t('common.all')} — {t('common.status')}</option>
              {TASK_STATUSES.map((s) => <option key={s} value={s}>{td('task.status', s)}</option>)}
            </Select>
            <Select aria-label={t('common.mode')} value={mode} onChange={(e) => setMode(e.target.value)} className="!w-auto">
              <option value="">{t('filter.ALL')}</option>
              <option value="REAL">{t('filter.REAL')}</option>
              <option value="SIMULATED">{t('filter.SIMULATED')}</option>
            </Select>
            {can('task.create') ? <Button variant="primary" data-testid="task-create" onClick={() => setOpen(true)}>{t('tasks.create')}</Button> : null}
          </>
        }
      />
      <ErrorNote error={tasks.error} />
      <Panel>
        {tasks.isLoading ? (
          <Loading />
        ) : !tasks.data?.length ? (
          <Empty title={t('tasks.empty')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="avo-table" data-testid="tasks-table">
              <thead><tr><th>{t('tasks.col.title')}</th><th>{t('common.mode')}</th><th>{t('tasks.col.assignee')}</th><th>{t('tasks.col.status')}</th><th>{t('tasks.col.priority')}</th><th>{t('tasks.col.updated')}</th></tr></thead>
              <tbody>
                {tasks.data.map((x) => (
                  <tr key={x.id} data-testid={`task-row-${x.id}`} data-task-status={x.status}>
                    <td><Link className="font-bold text-accent underline" to={`/tasks/${x.id}`}>{x.title}</Link></td>
                    <td><ModeBadge mode={x.mode} compact /></td>
                    <td>{x.assigneeName ?? '—'}</td>
                    <td><Pill tone={taskTone(x.status)} icon={taskIcon(x.status)} testId={`task-status-${x.id}`}>{td('task.status', x.status)}</Pill></td>
                    <td>{td('priority', x.priority)}</td>
                    <td className="text-xs">{rel(x.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <QuickTaskModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
