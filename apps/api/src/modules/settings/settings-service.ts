import { DEFAULT_SETTINGS, SettingsDTOSchema, type SettingsDTO } from '@avo/shared';
import { Prisma, type Db } from '../../db.js';

export class SettingsService {
  private readonly cache = new Map<string, SettingsDTO>();
  constructor(private readonly db: Db) {}

  async get(workspaceId: string): Promise<SettingsDTO> {
    const hit = this.cache.get(workspaceId);
    if (hit) return hit;
    const rows = await this.db.setting.findMany({ where: { workspaceId } });
    const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const r of rows) merged[r.key] = r.value;
    const parsed = SettingsDTOSchema.safeParse(merged);
    const value = parsed.success ? parsed.data : { ...DEFAULT_SETTINGS };
    this.cache.set(workspaceId, value);
    return value;
  }

  async update(workspaceId: string, patch: Partial<SettingsDTO>): Promise<SettingsDTO> {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      await this.db.setting.upsert({
        where: { workspaceId_key: { workspaceId, key } },
        create: { workspaceId, key, value: value as Prisma.InputJsonValue },
        update: { value: value as Prisma.InputJsonValue },
      });
    }
    this.cache.delete(workspaceId);
    return this.get(workspaceId);
  }

  invalidate(workspaceId: string): void {
    this.cache.delete(workspaceId);
  }
}
