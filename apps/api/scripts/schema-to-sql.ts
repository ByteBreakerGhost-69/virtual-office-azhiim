/**
 * Fallback migration generator.
 *
 * Normal workflow on a developer machine: `npm run db:migrate:dev -- --name <change>` (Prisma writes the SQL).
 * This script exists because the Prisma schema engine binary could not be downloaded in the sandbox where 0001_init
 * was produced. It converts prisma/schema.prisma (the subset of syntax used in this project) into SQL that follows
 * Prisma's own naming conventions, so `prisma migrate deploy` applies it and `npm run db:check` (prisma migrate diff)
 * is expected to report no drift. Run `npm run db:check` once on your machine to confirm.
 *
 * usage: tsx scripts/schema-to-sql.ts > prisma/migrations/0001_init/migration.sql
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, '../prisma/schema.prisma'), 'utf8');

interface Field {
  name: string;
  type: string;
  optional: boolean;
  list: boolean;
  attrs: string;
}
interface Model {
  name: string;
  fields: Field[];
  blockAttrs: string[];
}

const enums = new Map<string, string[]>();
const models: Model[] = [];
let cur: { kind: 'enum' | 'model'; name: string } | null = null;
let curModel: Model | null = null;

for (const raw of schema.split('\n')) {
  const line = raw.replace(/\/\/.*$/, '').trim();
  if (!line) continue;
  const open = /^(enum|model)\s+(\w+)\s*\{$/.exec(line);
  if (open) {
    cur = { kind: open[1] as 'enum' | 'model', name: open[2]! };
    if (cur.kind === 'enum') enums.set(cur.name, []);
    else models.push((curModel = { name: cur.name, fields: [], blockAttrs: [] }));
    continue;
  }
  if (line === '}') {
    cur = null;
    curModel = null;
    continue;
  }
  if (!cur) continue;
  if (cur.kind === 'enum') {
    enums.get(cur.name)!.push(line);
    continue;
  }
  if (line.startsWith('@@')) {
    curModel!.blockAttrs.push(line);
    continue;
  }
  const m = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(line);
  if (m) curModel!.fields.push({ name: m[1]!, type: m[2]!, list: !!m[3], optional: !!m[4], attrs: m[5] ?? '' });
}

const modelNames = new Set(models.map((m) => m.name));
const SCALARS: Record<string, string> = { String: 'TEXT', Int: 'INTEGER', Boolean: 'BOOLEAN', DateTime: 'TIMESTAMP(3)', Json: 'JSONB' };
const q = (s: string) => `"${s}"`;
const cols = (xs: string[]) => xs.map(q).join(', ');
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const FK_ACTION: Record<string, string> = { Cascade: 'CASCADE', SetNull: 'SET NULL', Restrict: 'RESTRICT', NoAction: 'NO ACTION' };

const out: string[] = [];
for (const [name, values] of enums) out.push(`-- CreateEnum\nCREATE TYPE ${q(name)} AS ENUM (${values.map((v) => `'${v}'`).join(', ')});\n`);

const indexes: string[] = [];
const fks: string[] = [];

for (const m of models) {
  const lines: string[] = [];
  const pk: string[] = [];
  for (const f of m.fields) {
    if (modelNames.has(f.type)) {
      const rel = /@relation\((?:"[^"]*",\s*)?fields:\s*\[([^\]]+)\],\s*references:\s*\[([^\]]+)\](?:,\s*onDelete:\s*(\w+))?(?:,\s*onUpdate:\s*(\w+))?\)/.exec(f.attrs);
      if (rel) {
        const fcols = list(rel[1]!);
        const del = FK_ACTION[rel[3] ?? (f.optional ? 'SetNull' : 'Restrict')]!;
        const upd = FK_ACTION[rel[4] ?? 'Cascade']!;
        fks.push(
          `-- AddForeignKey\nALTER TABLE ${q(m.name)} ADD CONSTRAINT ${q(`${m.name}_${fcols.join('_')}_fkey`)} FOREIGN KEY (${cols(fcols)}) REFERENCES ${q(f.type)}(${cols(list(rel[2]!))}) ON DELETE ${del} ON UPDATE ${upd};\n`,
        );
      }
      continue;
    }
    const base = SCALARS[f.type] ?? (enums.has(f.type) ? q(f.type) : undefined);
    if (!base) throw new Error(`unknown type ${f.type} on ${m.name}.${f.name}`);
    let col = `    ${q(f.name)} ${base}${f.list ? '[]' : ''}`;
    if (!f.optional && !f.list) col += ' NOT NULL';
    const def = /@default\((.*)\)(?=\s*(?:@|$))/.exec(f.attrs)?.[1];
    if (def !== undefined) {
      if (def === 'now()') col += ' DEFAULT CURRENT_TIMESTAMP';
      else if (def === '[]') col += ` DEFAULT ARRAY[]::${base}[]`;
      else if (/^".*"$/.test(def)) col += ` DEFAULT '${def.slice(1, -1)}'`;
      else if (def === 'true' || def === 'false' || /^-?\d+$/.test(def)) col += ` DEFAULT ${def}`;
      else if (enums.has(f.type)) col += ` DEFAULT '${def}'`;
      else throw new Error(`unsupported default ${def} on ${m.name}.${f.name}`);
    }
    lines.push(col);
    if (/@id\b/.test(f.attrs)) pk.push(f.name);
    if (/@unique\b/.test(f.attrs)) indexes.push(`CREATE UNIQUE INDEX ${q(`${m.name}_${f.name}_key`)} ON ${q(m.name)}(${q(f.name)});`);
  }
  for (const a of m.blockAttrs) {
    const c = /\(\[([^\]]+)\]/.exec(a)?.[1];
    if (!c) continue;
    const cs = list(c);
    if (a.startsWith('@@id')) pk.push(...cs);
    else if (a.startsWith('@@unique')) indexes.push(`CREATE UNIQUE INDEX ${q(`${m.name}_${cs.join('_')}_key`)} ON ${q(m.name)}(${cols(cs)});`);
    else if (a.startsWith('@@index')) indexes.push(`CREATE INDEX ${q(`${m.name}_${cs.join('_')}_idx`)} ON ${q(m.name)}(${cols(cs)});`);
  }
  out.push(`-- CreateTable\nCREATE TABLE ${q(m.name)} (\n${lines.join(',\n')},\n\n    CONSTRAINT ${q(`${m.name}_pkey`)} PRIMARY KEY (${cols(pk)})\n);\n`);
}
if (indexes.length) out.push(`-- CreateIndex\n${indexes.join('\n')}\n`);
out.push(...fks);
process.stdout.write(out.join('\n'));
