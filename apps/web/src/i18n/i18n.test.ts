import { describe, expect, it } from 'vitest';
import { ACTION_CATEGORIES, AGENT_STATES, INTEGRATION_STATUSES, PRIORITIES, RUN_STATES, SEVERITIES, TASK_STATUSES, ROOM_KEYS, ORG_ROLES, RUNTIME_KINDS, EVENT_TYPES, RISK_LEVELS, APPROVAL_STATUSES } from '@avo/shared';
import { en } from './en.js';
import { id } from './id.js';
import { format, translate } from './index.js';

describe('i18n', () => {
  it('id and en have identical key sets and no empty values', () => {
    expect(Object.keys(id).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of Object.entries(id)) expect(v.trim(), k).not.toBe('');
  });
  it('placeholders match between languages', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(ph(id[k]), k).toBe(ph(en[k]));
  });
  it('every enum value coming from the API has a translation', () => {
    const need: string[] = [
      ...AGENT_STATES.map((s) => `state.${s}`),
      ...TASK_STATUSES.map((s) => `task.status.${s}`),
      ...RUN_STATES.map((s) => `run.state.${s}`),
      ...PRIORITIES.map((s) => `priority.${s}`),
      ...RISK_LEVELS.map((s) => `risk.${s}`),
      ...SEVERITIES.map((s) => `severity.${s}`),
      ...INTEGRATION_STATUSES.map((s) => `integration.status.${s}`),
      ...ACTION_CATEGORIES.map((s) => `category.${s}`),
      ...APPROVAL_STATUSES.map((s) => `approval.status.${s}`),
      ...ROOM_KEYS.map((s) => `room.${s}`),
      ...ORG_ROLES.map((s) => `role.${s}`),
      ...RUNTIME_KINDS.map((s) => `kind.${s}`),
      ...EVENT_TYPES.map((s) => `events.${s}`),
    ];
    for (const k of need) expect(k in en, k).toBe(true);
  });
  it('formats params and falls back to English then key', () => {
    expect(format('a {n} b', { n: 3 })).toBe('a 3 b');
    expect(translate('id', 'common.save')).toBe('Simpan');
    expect(translate('id', 'no.such.key')).toBe('no.such.key');
  });
});
