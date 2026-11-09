import type { CommandMeta } from '@avo/shared';
import { companyCommands } from './commands/company.js';
import { employeeCommands } from './commands/employee.js';
import { workCommands } from './commands/work.js';
import type { CommandDef } from './types.js';

/** New commands are added by appending a module here; there is no central switch statement. */
export const REGISTRY: readonly CommandDef[] = [...companyCommands, ...employeeCommands, ...workCommands];

export const metaOf = (d: CommandDef): CommandMeta => ({ name: d.name, path: d.path, summary: d.summary, usage: d.usage, example: d.example, action: d.action, risk: d.risk, mutating: d.mutating, args: d.args, flags: d.flags });

(() => {
  const seen = new Set<string>();
  for (const d of REGISTRY) {
    if (seen.has(d.name)) throw new Error(`duplicate terminal command ${d.name}`);
    seen.add(d.name);
  }
})();
