import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { commonPrefix, complete, type CommandHistoryEntry, type CommandMeta, type CommandResult, type CommandStatus, type RefIndex, type TerminalView } from '@avo/shared';
import { api } from '../../lib/api.js';
import { useAgents, useApprovals, useDepartments, useTasks } from '../../lib/queries.js';
import { useI18n } from '../../i18n/index.js';
import { useSession } from '../../app/session.js';
import { terminalStore, type Line } from './terminalStore.js';

const STATUS_MARK: Record<CommandStatus, { icon: string; cls: string }> = {
  SUCCESS: { icon: '✓', cls: 'text-[#5fd38d]' },
  FAILED: { icon: '✗', cls: 'text-[#ff7a7a]' },
  REJECTED: { icon: '⛔', cls: 'text-[#ff7a7a]' },
  PENDING_APPROVAL: { icon: '⏳', cls: 'text-[#f2c96b]' },
  RUNNING: { icon: '…', cls: 'text-[#57e0f0]' },
  CANCELLED: { icon: '∅', cls: 'text-[#aab3c4]' },
  PARTIAL_SUCCESS: { icon: '◐', cls: 'text-[#f2c96b]' },
};

function viewText(v: TerminalView | undefined): string {
  if (!v) return '';
  if (v.kind === 'text') return v.lines.join('\n');
  if (v.kind === 'kv') return v.pairs.map((p) => `${p.key}: ${p.value}`).join('\n');
  return [v.columns.join('\t'), ...v.rows.map((r) => r.join('\t'))].join('\n');
}

function View({ v }: { v: TerminalView }) {
  if (v.kind === 'text') return <pre className="whitespace-pre-wrap">{v.lines.join('\n')}</pre>;
  if (v.kind === 'kv')
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-3">
        {v.pairs.map((p) => (
          <div key={p.key} className="contents">
            <dt className="text-[#7f8aa8]">{p.key}</dt>
            <dd className="whitespace-pre-wrap break-words">{p.value}</dd>
          </div>
        ))}
      </dl>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead><tr>{v.columns.map((c) => <th key={c} className="pr-3 font-normal text-[#7f8aa8]">{c}</th>)}</tr></thead>
        <tbody>{v.rows.map((r, i) => <tr key={i}>{r.map((cell, j) => <td key={j} className="whitespace-nowrap pr-3 align-top">{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function highlight(text: string) {
  return text.split(/(\s+)/).map((tok, i) => {
    const cls = tok.startsWith('--') ? 'text-[#f2c96b]' : /^(EMP|TASK)-\d+$/i.test(tok) ? 'text-[#57e0f0]' : i === 0 ? 'text-[#5fd38d]' : '';
    return <span key={i} className={cls}>{tok}</span>;
  });
}

export type TerminalSize = 'sm' | 'md' | 'lg';
export function TerminalPanel({ size, onSize, onHide }: { size: TerminalSize; onSize: (s: TerminalSize) => void; onHide: () => void }) {
  const { t } = useI18n();
  const { live, user } = useSession();
  const qc = useQueryClient();
  const lines = useSyncExternalStore(terminalStore.subscribe, terminalStore.lines);
  const commands = useSyncExternalStore(terminalStore.subscribe, terminalStore.commands);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string[]>([]);
  const cursor = useRef<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const metaQ = useQuery({ queryKey: ['terminal-commands'], queryFn: () => api.get<CommandMeta[]>('/terminal/commands'), staleTime: Infinity });
  const histQ = useQuery({ queryKey: ['terminal-history'], queryFn: () => api.get<CommandHistoryEntry[]>('/terminal/history?limit=100'), staleTime: Infinity });
  useEffect(() => {
    if (histQ.data) terminalStore.hydrate(histQ.data.map((h) => h.input));
  }, [histQ.data]);

  const agents = useAgents();
  const tasks = useTasks();
  const depts = useDepartments();
  const approvals = useApprovals('pending');
  const refs = useMemo<RefIndex>(
    () => ({
      employee: (agents.data ?? []).filter((a) => a.employeeCode).map((a) => a.employeeCode!),
      agent: (agents.data ?? []).map((a) => a.handle),
      task: (tasks.data ?? []).map((x) => x.code ?? x.id.slice(0, 8)),
      department: (depts.data ?? []).map((d) => d.key),
      approval: (approvals.data ?? []).map((a) => a.id.slice(0, 8)),
    }),
    [agents.data, tasks.data, depts.data, approvals.data],
  );

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [lines.length]);

  const run = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    terminalStore.push({ kind: 'in', text });
    terminalStore.addCommand(text);
    setInput('');
    setHint([]);
    cursor.current = null;
    if (text === 'clear' || text === 'cls') return terminalStore.clear();
    setBusy(true);
    try {
      const result = await api.post<CommandResult>('/terminal/execute', { input: text });
      terminalStore.push({ kind: 'out', result });
      // anything a command changed must be reflected from the backend, not guessed
      if (result.status !== 'FAILED' && result.status !== 'REJECTED') for (const k of ['agents', 'agent', 'tasks', 'task', 'overview', 'approvals', 'activity']) void qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      terminalStore.push({ kind: 'sys', text: `${t('terminal.backendError')}: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') return void run(input);
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (!commands.length) return;
      const cur = cursor.current ?? commands.length;
      const next = Math.max(0, Math.min(commands.length, cur + (e.key === 'ArrowUp' ? -1 : 1)));
      cursor.current = next;
      setInput(next === commands.length ? '' : commands[next]!);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (!metaQ.data) return;
      const { prefix, options } = complete(metaQ.data, input, refs);
      if (!options.length) return setHint([]);
      const head = input.slice(0, input.length - prefix.length);
      if (options.length === 1) {
        setInput(`${head}${options[0]!} `);
        setHint([]);
      } else {
        setInput(head + commonPrefix(options));
        setHint(options);
      }
      return;
    }
    if (e.key === 'Escape') {
      setInput('');
      setHint([]);
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      terminalStore.clear();
    }
  };

  const copyAll = () => {
    const txt = lines.map((l) => (l.kind === 'in' ? `$ ${l.text}` : l.kind === 'sys' ? l.text : `${l.result.status}: ${l.result.message}\n${viewText(l.result.view)}`)).join('\n');
    void navigator.clipboard?.writeText(txt).then(() => terminalStore.push({ kind: 'sys', text: t('terminal.copied') }));
  };

  const prompt = `${user.username}@azhiim:~$`;
  return (
    <section aria-label={t('terminal.title')} data-testid="terminal-panel" data-size={size} className="flex h-full min-h-0 flex-col overflow-hidden rounded border-2 border-[#2a3a66] bg-[#0a1024] font-mono text-xs text-[#d7e3ff]">
      <header className="flex items-center gap-2 border-b border-[#2a3a66] bg-[#101a38] px-2 py-1">
        <strong className="tracking-wider">{t('terminal.title')}</strong>
        <span data-testid="terminal-conn" data-live={live} className={live ? 'text-[#5fd38d]' : 'text-[#ff7a7a]'}>{live ? `● ${t('terminal.online')}` : `○ ${t('terminal.offline')}`}</span>
        <span className="ml-auto flex gap-1">
          {(['sm', 'md', 'lg'] as const).map((s) => (
            <button key={s} type="button" aria-pressed={size === s} onClick={() => onSize(s)} className={`rounded px-1.5 ${size === s ? 'bg-[#2a3a66]' : 'hover:bg-[#1b2a55]'}`}>{s.toUpperCase()}</button>
          ))}
          <button type="button" onClick={copyAll} className="rounded px-1.5 hover:bg-[#1b2a55]" data-testid="terminal-copy">{t('terminal.copy')}</button>
          <button type="button" onClick={() => terminalStore.clear()} className="rounded px-1.5 hover:bg-[#1b2a55]" data-testid="terminal-clear">{t('terminal.clear')}</button>
          <button type="button" onClick={onHide} aria-label={t('terminal.hide')} className="rounded px-1.5 hover:bg-[#1b2a55]" data-testid="terminal-hide">✕</button>
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-2" role="log" aria-live="polite" data-testid="terminal-log" onClick={() => inputRef.current?.focus()}>
        {lines.length === 0 ? <p className="text-[#7f8aa8]">{t('terminal.welcome')}</p> : null}
        {lines.map((l: Line) =>
          l.kind === 'in' ? (
            <div key={l.id} className="mt-2"><span className="text-[#7f8aa8]">{prompt}</span> {highlight(l.text)}</div>
          ) : l.kind === 'sys' ? (
            <div key={l.id} className="text-[#7f8aa8]">{l.text}</div>
          ) : (
            <div key={l.id} className="mb-1 border-l-2 border-[#2a3a66] pl-2" data-testid="terminal-result" data-status={l.result.status} data-command={l.result.command ?? ''}>
              <div className={STATUS_MARK[l.result.status].cls}><span aria-hidden>{STATUS_MARK[l.result.status].icon}</span> {l.result.status}{l.result.auditId ? <span className="text-[#7f8aa8]"> · audit {l.result.auditId.slice(0, 8)}</span> : null}</div>
              <div>{l.result.message}</div>
              {l.result.view ? <div className="mt-1"><View v={l.result.view} /></div> : null}
            </div>
          ),
        )}
        {hint.length ? <div className="text-[#7f8aa8]">{hint.join('  ')}</div> : null}
        <div ref={endRef} />
      </div>
      <label className="flex items-center gap-2 border-t border-[#2a3a66] px-2 py-1.5">
        <span className="shrink-0 text-[#7f8aa8]">{prompt}</span>
        <input
          ref={inputRef}
          data-testid="terminal-input"
          value={input}
          onChange={(e) => { setInput(e.target.value); cursor.current = null; }}
          onKeyDown={onKey}
          disabled={busy}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          aria-label={t('terminal.inputLabel')}
          placeholder={t('terminal.placeholder')}
          className="min-w-0 flex-1 bg-transparent text-[#d7e3ff] outline-none placeholder:text-[#4a5778]"
        />
      </label>
    </section>
  );
}
