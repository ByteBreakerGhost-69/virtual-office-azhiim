import { mkdirSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { appearanceFor, CHAR_H, CHAR_POSES, CHAR_W, drawCharacter, FRAME_COUNT } from '../src/office/pixel/characters.js';
import { PixelBuffer } from '../src/office/pixel/buffer.js';

export function toPng(b: PixelBuffer, scale = 1): Buffer {
  const png = new PNG({ width: b.w * scale, height: b.h * scale });
  for (let y = 0; y < b.h * scale; y++)
    for (let x = 0; x < b.w * scale; x++) {
      const si = (Math.floor(y / scale) * b.w + Math.floor(x / scale)) * 4;
      const di = (y * b.w * scale + x) * 4;
      png.data[di] = b.data[si]!;
      png.data[di + 1] = b.data[si + 1]!;
      png.data[di + 2] = b.data[si + 2]!;
      png.data[di + 3] = b.data[si + 3]!;
    }
  return PNG.sync.write(png);
}

/** Exports every procedurally drawn asset as PNG so artists/reviewers can inspect them. The app itself draws them at runtime from the same code. */
import { drawIcon, ICON_KEYS } from '../src/office/pixel/icons.js';
import { drawShip } from '../src/office/pixel/ship.js';
import { DEFAULT_DEPARTMENTS } from '@avo/shared';

const out = new URL('../public/assets/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const ship = drawShip();
writeFileSync(`${out}ship.png`, toPng(ship.buffer));

const dirs = ['down', 'up', 'side'] as const;
const manifest: Record<string, unknown> = { tile: 16, character: { w: CHAR_W, h: CHAR_H }, ship: 'ship.png', lights: ship.lights.length, characters: {} as Record<string, unknown>, icons: ICON_KEYS };
for (const d of DEFAULT_DEPARTMENTS) {
  for (const variant of [0, 1, 2]) {
    const ap = appearanceFor({ seed: `${d.key}-${variant}`, departmentKey: d.key, departmentColor: d.color, orgRole: variant === 0 ? 'leader' : 'specialist' });
    const cells: { pose: string; dir: string; f: number }[] = [];
    for (const dir of dirs) for (const pose of CHAR_POSES) for (let f = 0; f < FRAME_COUNT[pose]; f++) cells.push({ pose, dir, f });
    const cols = 12;
    const rows = Math.ceil(cells.length / cols);
    const sheet = new PixelBuffer(cols * CHAR_W, rows * CHAR_H);
    cells.forEach((c, i) => sheet.blit(drawCharacter(ap, { pose: c.pose as never, dir: c.dir as never, f: c.f }), (i % cols) * CHAR_W, Math.floor(i / cols) * CHAR_H));
    const name = `character-${d.key}-${variant}.png`;
    writeFileSync(`${out}${name}`, toPng(sheet));
    (manifest['characters'] as Record<string, unknown>)[name] = { cols, cells };
  }
}
const iconSheet = new PixelBuffer(ICON_KEYS.length * 10, 10);
ICON_KEYS.forEach((k, i) => iconSheet.blit(drawIcon(k), i * 10, 0));
writeFileSync(`${out}icons.png`, toPng(iconSheet));
writeFileSync(`${out}manifest.json`, JSON.stringify(manifest, null, 1));
console.log(`assets written to ${out}`);
