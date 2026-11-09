import { z } from 'zod';
import type { Action } from './permissions.js';

/**
 * Company Terminal contract (PRD company-terminal 9.4). The terminal is NOT a shell: every input resolves to a
 * registered command with a schema, a permission and an audit trail, or it is rejected.
 */
export const COMMAND_STATUSES = ['SUCCESS', 'FAILED', 'PENDING_APPROVAL', 'REJECTED', 'RUNNING', 'CANCELLED', 'PARTIAL_SUCCESS'] as const;
export type CommandStatus = (typeof COMMAND_STATUSES)[number];

export type RefKind = 'employee' | 'task' | 'department' | 'approval' | 'agent' | 'integration';
export type RiskLevelMeta = 'low' | 'medium' | 'high';

export interface ArgMeta {
  name: string;
  required: boolean;
  summary: string;
  ref?: RefKind;
}
export interface FlagMeta {
  name: string;
  summary: string;
  /** boolean flags take no value */
  boolean?: boolean;
  required?: boolean;
  values?: readonly string[];
  ref?: RefKind;
}
export interface CommandMeta {
  /** dotted id used in audit + results, e.g. "task.assign" */
  name: string;
  /** words typed by the user, e.g. ["task","assign"] */
  path: string[];
  summary: string;
  usage: string;
  example: string;
  action: Action;
  risk: RiskLevelMeta;
  mutating: boolean;
  args: ArgMeta[];
  flags: FlagMeta[];
}

export type TerminalView =
  | { kind: 'text'; lines: string[] }
  | { kind: 'kv'; pairs: { key: string; value: string }[] }
  | { kind: 'table'; columns: string[]; rows: string[][] };

export const CommandResultSchema = z.object({
  executionId: z.string(),
  command: z.string().nullable(),
  status: z.enum(COMMAND_STATUSES),
  message: z.string(),
  data: z.unknown().optional(),
  view: z.custom<TerminalView>().optional(),
  requiresApproval: z.boolean(),
  approvalId: z.string().optional(),
  auditId: z.string().nullable(),
  traceId: z.string(),
  durationMs: z.number(),
});
export type CommandResult = z.infer<typeof CommandResultSchema>;

export const ExecuteCommandBodySchema = z.object({ input: z.string().min(1).max(2000) });
export interface CommandHistoryEntry {
  id: string;
  input: string;
  command: string | null;
  status: CommandStatus;
  message: string;
  createdAt: string;
}

// ---------------------------------------------------------------- tokenizer + parser (pure; used by API and UI)
export interface ParsedInput {
  words: string[];
  flags: Record<string, string | true>;
  /** positional arguments after the command words */
  positionals: string[];
  /** set when the input could not be tokenized (e.g. an unterminated quote) */
  error?: string;
}

/** Splits on whitespace, honoring '…' and "…" and backslash escapes. Never evaluates anything. */
export function tokenize(input: string): { tokens: string[]; error?: string } {
  const tokens: string[] = [];
  let cur = '';
  let has = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < input.length) {
        cur += input[++i]!;
      } else if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) tokens.push(cur);
      cur = '';
      has = false;
    } else if (ch === '\\' && i + 1 < input.length) {
      cur += input[++i]!;
      has = true;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (quote) return { tokens, error: `Unterminated ${quote} quote` };
  if (has || cur) tokens.push(cur);
  return { tokens };
}

/**
 * `employee hire foo --title "QA Lead" --dept eng --verbose` -> words/flags/positionals. Command words are
 * split from positionals later by {@link resolveCommand}, because only the registry knows how many words a command has.
 */
export function parseInput(input: string, booleanFlags: ReadonlySet<string> = new Set()): ParsedInput {
  const { tokens, error } = tokenize(input);
  const words: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.startsWith('--') && t.length > 2) {
      const eq = t.indexOf('=');
      if (eq > 0) {
        flags[t.slice(2, eq)] = t.slice(eq + 1);
        continue;
      }
      const name = t.slice(2);
      const next = tokens[i + 1];
      if (booleanFlags.has(name) || next === undefined || next.startsWith('--')) flags[name] = true;
      else {
        flags[name] = next;
        i++;
      }
    } else words.push(t);
  }
  return { words, flags, positionals: [], ...(error ? { error } : {}) };
}

export function resolveCommand<T extends { path: string[] }>(commands: readonly T[], words: string[]): { command: T; positionals: string[] } | null {
  let best: T | null = null;
  for (const c of commands) {
    if (c.path.length > words.length) continue;
    if (c.path.every((w, i) => w.toLowerCase() === words[i]!.toLowerCase()) && (!best || c.path.length > best.path.length)) best = c;
  }
  return best ? { command: best, positionals: words.slice(best.path.length) } : null;
}

/** Union of all boolean flag names so the parser knows they take no value. */
export function booleanFlagNames(commands: readonly CommandMeta[]): Set<string> {
  const s = new Set<string>();
  for (const c of commands) for (const f of c.flags) if (f.boolean) s.add(f.name);
  return s;
}

// ---------------------------------------------------------------- autocomplete (pure)
export type RefIndex = Partial<Record<RefKind, string[]>>;

/**
 * Suggestions for the token being typed at the end of `input`. Completion is advisory; the server re-validates
 * everything on execution.
 */
export function complete(commands: readonly CommandMeta[], input: string, refs: RefIndex = {}): { prefix: string; options: string[] } {
  const endsWithSpace = /\s$/.test(input);
  const { tokens } = tokenize(input);
  const typing = endsWithSpace || tokens.length === 0 ? '' : tokens[tokens.length - 1]!;
  const done = endsWithSpace || tokens.length === 0 ? tokens : tokens.slice(0, -1);
  const pick = (xs: string[]) => [...new Set(xs)].filter((x) => x.toLowerCase().startsWith(typing.toLowerCase()) && x !== typing).sort();

  // a pending flag value (e.g. `--dept `)
  const last = done[done.length - 1];
  const flagWords = done.filter((t) => !t.startsWith('--'));
  const resolved = resolveCommand(commands, flagWords);
  if (last && last.startsWith('--') && !last.includes('=') && resolved) {
    const f = resolved.command.flags.find((x) => x.name === last.slice(2));
    if (f && !f.boolean) {
      if (f.values) return { prefix: typing, options: pick([...f.values]) };
      if (f.ref) return { prefix: typing, options: pick(refs[f.ref] ?? []) };
      return { prefix: typing, options: [] };
    }
  }
  if (typing.startsWith('--')) {
    if (!resolved) return { prefix: typing, options: [] };
    const used = new Set(done.filter((t) => t.startsWith('--')).map((t) => t.slice(2)));
    return { prefix: typing, options: pick(resolved.command.flags.filter((f) => !used.has(f.name)).map((f) => `--${f.name}`)) };
  }
  // still choosing command words
  const wordsSoFar = done.filter((t) => !t.startsWith('--'));
  const fullMatch = resolveCommand(commands, wordsSoFar);
  if (!fullMatch || (fullMatch.positionals.length === 0 && commands.some((c) => c.path.length > wordsSoFar.length && c.path.slice(0, wordsSoFar.length).every((w, i) => w === wordsSoFar[i])))) {
    const next = commands.filter((c) => c.path.length > wordsSoFar.length && c.path.slice(0, wordsSoFar.length).every((w, i) => w.toLowerCase() === wordsSoFar[i]!.toLowerCase())).map((c) => c.path[wordsSoFar.length]!);
    if (next.length) return { prefix: typing, options: pick(next) };
  }
  if (fullMatch) {
    const arg = fullMatch.command.args[fullMatch.positionals.length];
    if (arg?.ref) return { prefix: typing, options: pick(refs[arg.ref] ?? []) };
  }
  return { prefix: typing, options: [] };
}

/** Longest common prefix, for Tab completion of several options. */
export function commonPrefix(xs: string[]): string {
  if (!xs.length) return '';
  let p = xs[0]!;
  for (const x of xs) while (!x.toLowerCase().startsWith(p.toLowerCase())) p = p.slice(0, -1);
  return p;
}

// ---------------------------------------------------------------- redaction (history must never hold secrets)
const SECRET_FLAG = /(--(?:api[-_]?key|token|secret|password|passwd|authorization)(?:=|\s+))(\S+)/gi;
export function redactInput(input: string): string {
  return input.replace(SECRET_FLAG, '$1[redacted]');
}

// ---------------------------------------------------------------- owner position
export const FACINGS = ['up', 'down', 'left', 'right'] as const;
export const OwnerPositionBodySchema = z.object({
  room: z.string().min(1).max(40),
  x: z.number().int().min(0).max(4096),
  y: z.number().int().min(0).max(4096),
  direction: z.enum(FACINGS),
});
export type OwnerPosition = z.infer<typeof OwnerPositionBodySchema> & { updatedAt: string };
