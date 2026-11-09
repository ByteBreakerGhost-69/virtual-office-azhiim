import type { CommandResult } from '@avo/shared';

/**
 * Terminal scrollback + command history live outside React so closing/reopening the panel (or leaving the page)
 * never loses them. Server history (per user) re-seeds `commands` after a refresh.
 */
export type Line = { id: number; kind: 'in'; text: string } | { id: number; kind: 'out'; result: CommandResult } | { id: number; kind: 'sys'; text: string };

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

let lines: Line[] = [];
let commands: string[] = [];
let seq = 0;
let hydrated = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const terminalStore = {
  subscribe(f: () => void) {
    subs.add(f);
    return () => void subs.delete(f);
  },
  lines: () => lines,
  commands: () => commands,
  push(l: DistributiveOmit<Line, 'id'>) {
    lines = [...lines.slice(-299), { ...(l as object), id: ++seq } as Line];
    emit();
  },
  addCommand(c: string) {
    if (commands[commands.length - 1] !== c) commands = [...commands.slice(-199), c];
  },
  clear() {
    lines = [];
    emit();
  },
  hydrate(history: string[]) {
    if (hydrated) return;
    hydrated = true;
    if (!commands.length) commands = history.slice(-200);
    emit();
  },
  reset() {
    lines = [];
    commands = [];
    hydrated = false;
    emit();
  },
};
