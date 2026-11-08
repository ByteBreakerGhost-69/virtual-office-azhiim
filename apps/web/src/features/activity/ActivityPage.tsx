import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SEVERITIES, type DomainEvent } from '@avo/shared';
import { api, qs } from '../../lib/api.js';
import { useActivity, type Page } from '../../lib/queries.js';
import { useI18n } from '../../i18n/index.js';
import { Button, Empty, ErrorNote, Loading, PageHeader, Panel, Select } from '../../components/ui.js';
import { EventLine } from '../../components/EventLine.js';

export default function ActivityPage() {
  const { t, td } = useI18n();
  const [severity, setSeverity] = useState('');
  const [mode, setMode] = useState('');
  const [extra, setExtra] = useState<DomainEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const first = useActivity({ limit: 50, ...(severity ? { severity } : {}), ...(mode ? { mode } : {}) });
  const more = useQuery({
    queryKey: ['activity-more', severity, mode, cursor],
    queryFn: async () => {
      const p = await api.get<Page<DomainEvent>>(`/activity${qs({ limit: 50, cursor, severity, mode })}`);
      setExtra((x) => [...x, ...p.items.filter((i) => !x.some((y) => y.id === i.id))]);
      return p;
    },
    enabled: !!cursor,
  });
  const reset = () => { setExtra([]); setCursor(null); };
  const items = [...(first.data?.items ?? []), ...extra.filter((e) => !first.data?.items.some((f) => f.id === e.id))];
  const next = cursor ? more.data?.nextCursor ?? null : first.data?.nextCursor ?? null;
  return (
    <div data-testid="activity-page">
      <PageHeader
        title={t('activity.title')}
        subtitle={t('activity.subtitle')}
        actions={
          <>
            <Select aria-label={t('activity.filterSeverity')} value={severity} onChange={(e) => { setSeverity(e.target.value); reset(); }} className="!w-auto">
              <option value="">{t('common.all')} — {t('activity.filterSeverity')}</option>
              {SEVERITIES.map((s) => <option key={s} value={s}>{td('severity', s)}</option>)}
            </Select>
            <Select aria-label={t('common.mode')} value={mode} onChange={(e) => { setMode(e.target.value); reset(); }} className="!w-auto">
              <option value="">{t('filter.ALL')}</option>
              <option value="REAL">{t('filter.REAL')}</option>
              <option value="SIMULATED">{t('filter.SIMULATED')}</option>
            </Select>
          </>
        }
      />
      <ErrorNote error={first.error ?? more.error} />
      <Panel>
        {first.isLoading ? <Loading /> : items.length === 0 ? <Empty title={t('activity.empty')} /> : <ul data-testid="activity-list">{items.map((e) => <EventLine key={e.id} e={e} />)}</ul>}
        {next ? <div className="mt-3 text-center"><Button onClick={() => setCursor(next)} disabled={more.isFetching}>{t('common.loadMore')}</Button></div> : null}
      </Panel>
    </div>
  );
}
