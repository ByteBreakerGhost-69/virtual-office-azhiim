import { hash32, light, mix, PixelBuffer, rng, shade, type Color } from './buffer.js';
import { P } from './palette.js';
import { COLS, CORRIDOR, DESKS, PROPS, ROOMS, ROOM_BY_KEY, ROWS, SEATS, TILE, type Light, type Prop, type RoomDef } from './layout.js';
import type { RoomKey } from '@avo/shared';

/** Draws the entire spaceship (floors, walls, windows, furniture) into one buffer. Deterministic. */
export interface ShipArt {
  buffer: PixelBuffer;
  lights: Light[];
}

function floorTileArt(b: PixelBuffer, key: RoomKey | 'corridor', tx: number, ty: number): void {
  const x = tx * TILE;
  const y = ty * TILE;
  const r = rng(hash32(`${key}${tx},${ty}`));
  switch (key) {
    case 'main_office': {
      const base = (tx + ty) % 2 ? P.blue1 : mix(P.blue1, P.white, 0.4);
      b.rect(x, y, TILE, TILE, base);
      for (let i = 0; i < 6; i++) b.set(x + Math.floor(r() * 16), y + Math.floor(r() * 16), mix(base, P.blue2, 0.4));
      break;
    }
    case 'employee_workspace':
      b.rect(x, y, TILE, TILE, P.paper);
      b.frame(x, y, TILE, TILE, P.gray1);
      b.set(x + 1, y + 1, P.white);
      break;
    case 'development_room':
      b.rect(x, y, TILE, TILE, P.gray6);
      b.frame(x, y, TILE, TILE, mix(P.gray6, P.cyan4, 0.55));
      b.set(x + 8, y + 8, mix(P.gray6, P.cyan3, 0.7));
      break;
    case 'research_room':
      b.rect(x, y, TILE, TILE, P.white);
      b.frame(x, y, TILE, TILE, P.blue1);
      if ((tx + ty) % 4 === 0) b.rect(x + 6, y + 6, 4, 4, P.purple1);
      break;
    case 'meeting_room': {
      const base = mix(P.warm2, P.warm1, (tx + ty) % 2 ? 0.2 : 0.5);
      b.rect(x, y, TILE, TILE, base);
      for (let i = 0; i < 8; i++) b.set(x + Math.floor(r() * 16), y + Math.floor(r() * 16), shade(base, 0.08));
      break;
    }
    case 'server_room':
      b.rect(x, y, TILE, TILE, P.gray5);
      for (let j = 2; j < 16; j += 4) for (let i = 2; i < 16; i += 4) b.rect(x + i, y + j, 2, 2, P.gray6);
      if (tx % 2 === 0) b.vline(x, y, TILE, mix(P.gray5, P.cyan3, 0.5));
      break;
    case 'lounge': {
      const base = [P.wood1, P.wood2][ty % 2]!;
      b.rect(x, y, TILE, TILE, base);
      b.hline(x, y + 15, TILE, shade(base, 0.2));
      b.vline(x + ((tx * 5 + ty * 3) % 14) + 1, y, TILE, shade(base, 0.12));
      break;
    }
    default:
      b.rect(x, y, TILE, TILE, P.gray1);
      b.frame(x, y, TILE, TILE, P.paper);
      if (ty === 14 || ty === 15) {
        b.rect(x, y + 6 + (ty - 14) * 4, TILE, 4, P.blue1);
        if (tx % 4 === 0 && ty === 14) b.rect(x + 4, y + 8, 8, 2, P.cyan2);
      }
  }
}

function wallCap(b: PixelBuffer, tx: number, ty: number): void {
  const x = tx * TILE;
  const y = ty * TILE;
  b.rect(x, y, TILE, TILE, P.gray3);
  b.rect(x, y, TILE, 3, P.gray2);
  b.hline(x, y + 3, TILE, P.gray4);
  b.rect(x, y + 13, TILE, 3, P.gray5);
}
function wallFace(b: PixelBuffer, tx: number, ty: number, outer: boolean): void {
  const x = tx * TILE;
  const y = ty * TILE;
  b.rect(x, y, TILE, TILE, P.gray1);
  b.rect(x, y, TILE, 2, P.white);
  b.rect(x, y + 13, TILE, 3, P.gray3);
  b.hline(x, y + 12, TILE, P.gray2);
  b.hline(x, y + 10, TILE, P.cyan3); // soft light strip
  b.hline(x, y + 11, TILE, P.cyan1);
  if (tx % 4 === 0) b.vline(x, y + 2, 8, P.gray2);
  void outer;
}
function windowArt(b: PixelBuffer, tx: number, ty: number, tw: number): void {
  const x = tx * TILE + 1;
  const y = ty * TILE + 2;
  const w = tw * TILE - 2;
  b.rect(x - 1, y - 1, w + 2, 11, P.gray4);
  b.rect(x, y, w, 9, P.space1);
  const r = rng(hash32(`win${tx}${ty}`));
  for (let i = 0; i < 9 * tw; i++) b.set(x + Math.floor(r() * w), y + Math.floor(r() * 9), r() > 0.7 ? P.white : P.blue2);
  b.ellipse(x + w - 8, y + 5, 3, 3, P.blue3);
  b.ellipse(x + w - 9, y + 4, 2, 2, P.cyan2);
  b.hline(x, y + 8, w, P.space2);
  b.vline(x + (w >> 1), y, 9, P.gray4);
}

// ------------------------------------------------------------------ props
function deskArt(b: PixelBuffer, d: { tx: number; ty: number; tw: number; style: string }): void {
  const x = d.tx * TILE;
  const y = d.ty * TILE;
  const w = d.tw * TILE;
  const top = d.style === 'dev' ? P.gray3 : d.style === 'lab' ? P.white : d.style === 'console' ? P.gray4 : P.wood1;
  const edge = d.style === 'dev' ? P.gray5 : d.style === 'lab' ? P.gray2 : d.style === 'console' ? P.gray6 : P.wood3;
  b.rect(x + 1, y + 2, w - 2, 11, top);
  b.rect(x + 1, y + 13, w - 2, 3, edge);
  b.hline(x + 1, y + 2, w - 2, light(top, 0.3));
  b.frame(x, y + 1, w, 15, P.ink);
  // monitors on the back edge of the desk (screens face the seated agent)
  const n = d.style === 'dev' ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const mx = x + (w >> 1) - (n === 2 ? 11 : 6) + i * 12;
    b.rect(mx, y - 6, 12, 9, P.ink);
    b.rect(mx + 1, y - 5, 10, 6, d.style === 'dev' ? P.cyan4 : d.style === 'console' ? P.green4 : P.blue4);
    b.hline(mx + 2, y - 4, 6, d.style === 'console' ? P.green1 : P.cyan1);
    b.hline(mx + 2, y - 2, 4, P.blue1);
    b.rect(mx + 5, y + 3, 2, 1, P.gray3);
  }
  if (d.style === 'lab') {
    b.rect(x + w - 6, y + 4, 3, 5, P.cyan1);
    b.rect(x + w - 6, y + 4, 3, 1, P.purple2);
  } else {
    b.rect(x + 3, y + 8, 5, 3, P.paper); // keyboard
    b.rect(x + w - 8, y + 6, 4, 4, P.warm4); // mug
  }
}
function chairArt(b: PixelBuffer, cx: number, cy: number, facing: string): void {
  b.rect(cx - 6, cy - 6, 12, 10, P.gray5);
  b.rect(cx - 5, cy - 5, 10, 8, P.blue4);
  b.frame(cx - 6, cy - 6, 12, 10, P.ink);
  if (facing === 'up') b.rect(cx - 5, cy + 4, 10, 3, P.gray6);
  if (facing === 'down') b.rect(cx - 5, cy - 9, 10, 3, P.gray6);
}
function plant(b: PixelBuffer, x: number, y: number): void {
  b.rect(x + 4, y + 10, 8, 5, P.warm4);
  b.hline(x + 4, y + 10, 8, P.warm3);
  b.ellipse(x + 8, y + 6, 5, 5, P.green3);
  b.ellipse(x + 6, y + 5, 3, 3, P.green2);
  b.ellipse(x + 10, y + 4, 2, 2, P.green1);
  b.frame(x + 4, y + 10, 8, 5, P.ink);
}
function rack(b: PixelBuffer, x: number, y: number, lights: Light[]): void {
  b.rect(x + 1, y + 1, 14, 30, P.gray6);
  b.frame(x + 1, y + 1, 14, 30, P.ink);
  for (let i = 0; i < 6; i++) {
    const yy = y + 3 + i * 5;
    b.rect(x + 3, yy, 10, 4, P.gray4);
    b.hline(x + 3, yy, 10, P.gray3);
    b.rect(x + 4, yy + 2, 3, 1, P.gray6);
    lights.push({ x: x + 10, y: yy + 1, colors: [P.green2, P.cyan2, P.amber2, P.green3], period: 500 + ((x * 7 + yy * 13) % 900), phase: (x + yy) % 7 });
    lights.push({ x: x + 12, y: yy + 1, colors: [P.cyan3, P.gray5, P.cyan2], period: 800 + ((x * 3 + yy * 11) % 700), phase: (x * 2 + yy) % 5 });
  }
}
function sofa(b: PixelBuffer, x: number, y: number, tw: number): void {
  const w = tw * TILE;
  b.rect(x, y - 12, w, 14, P.blue4);
  b.rect(x + 2, y - 10, w - 4, 4, P.blue3);
  b.rect(x, y + 2, w, 12, P.blue3);
  b.rect(x + 2, y + 4, w - 4, 8, P.blue2);
  b.rect(x - 3, y - 4, 4, 18, P.blue4);
  b.rect(x + w - 1, y - 4, 4, 18, P.blue4);
  for (let i = 1; i < tw; i++) b.vline(x + i * TILE, y + 3, 9, P.blue3);
  b.frame(x - 3, y - 12, w + 6, 27, P.ink);
}
function table(b: PixelBuffer, x: number, y: number, w: number, h: number, c: Color, cEdge: Color): void {
  b.rect(x, y, w, h, c);
  b.rect(x, y + h - 4, w, 4, cEdge);
  b.hline(x, y, w, light(c, 0.3));
  b.frame(x - 1, y - 1, w + 2, h + 2, P.ink);
}

function propArt(b: PixelBuffer, p: Prop, lights: Light[]): void {
  const x = p.tx * TILE;
  const y = p.ty * TILE;
  const w = p.tw * TILE;
  const h = p.th * TILE;
  switch (p.kind) {
    case 'plant':
      plant(b, x, y);
      break;
    case 'rug':
      b.rect(x, y, w, h, mix(ROOM_TINT[p.room], P.white, 0.55));
      b.frame(x + 2, y + 2, w - 4, h - 4, mix(ROOM_TINT[p.room], P.gray3, 0.4));
      b.frame(x + 5, y + 5, w - 10, h - 10, P.white);
      break;
    case 'shelf':
      b.rect(x + 1, y + 1, 14, 15, P.wood3);
      b.frame(x + 1, y + 1, 14, 15, P.ink);
      for (let i = 0; i < 3; i++) {
        b.hline(x + 2, y + 5 + i * 4, 12, P.wood4);
        for (let k = 0; k < 5; k++) b.rect(x + 3 + k * 2, y + 2 + i * 4, 1, 3, [P.red2, P.blue3, P.amber2, P.green3, P.purple2][(k + i) % 5]!);
      }
      break;
    case 'screen':
      b.rect(x + 2, y + 2, w - 4, 9, P.ink);
      b.rect(x + 3, y + 3, w - 6, 7, P.blue5);
      for (let i = 0; i < Math.floor((w - 8) / 4); i++) b.rect(x + 5 + i * 4, y + 8 - ((i * 5) % 5), 2, 1 + ((i * 5) % 5), P.cyan2);
      b.hline(x + 4, y + 4, w - 8, P.cyan1);
      break;
    case 'whiteboard':
      b.rect(x + 2, y + 2, w - 4, 10, P.gray3);
      b.rect(x + 3, y + 3, w - 6, 8, P.white);
      b.line(x + 5, y + 8, x + 12, y + 5, P.blue3);
      b.hline(x + 14, y + 6, Math.max(2, w - 22), P.red2);
      b.hline(x + 5, y + 10, 10, P.green3);
      break;
    case 'banner':
      b.rect(x + 4, y + 1, 8, 12, P.blue4);
      b.rect(x + 6, y + 4, 4, 4, P.cyan2);
      b.stamp(x + 4, y + 13, ['XXXXXXXX', '.XXXXXX.', '..XXXX..', '...XX...'], { X: P.blue4 });
      break;
    case 'clock':
      b.ellipse(x + 8, y + 7, 5, 5, P.white);
      b.vline(x + 8, y + 3, 5, P.ink);
      b.hline(x + 8, y + 7, 3, P.ink);
      break;
    case 'window':
      windowArt(b, p.tx, p.ty, p.tw);
      break;
    case 'rack':
      rack(b, x, y, lights);
      break;
    case 'sofa':
      sofa(b, x, y, p.tw);
      break;
    case 'coffee-table':
      table(b, x, y + 2, w, 12, P.wood1, P.wood3);
      b.rect(x + 8, y + 5, 4, 3, P.white);
      b.rect(x + 28, y + 5, 4, 3, P.white);
      break;
    case 'holo-table':
      table(b, x, y + 2, w, h - 6, P.gray3, P.gray5);
      b.ellipse(x + (w >> 1), y + 8, w >> 2, 5, P.cyan3, 140);
      b.ellipse(x + (w >> 1), y + 6, w >> 3, 3, P.cyan1, 200);
      lights.push({ x: x + (w >> 1), y: y + 3, colors: [P.cyan1, P.white, P.cyan2], period: 700, phase: 0 });
      break;
    case 'meeting-table':
      table(b, x, y, w, h, P.wood2, P.wood4);
      b.rect(x + (w >> 1) - 8, y + 10, 16, 10, P.gray5);
      b.rect(x + (w >> 1) - 6, y + 12, 12, 6, P.cyan4);
      lights.push({ x: x + (w >> 1), y: y + 15, colors: [P.cyan1, P.cyan2], period: 900, phase: 1 });
      break;
    case 'vending':
      b.rect(x + 1, y + 1, 14, 15, P.gray4);
      b.rect(x + 3, y + 3, 10, 8, P.cyan1);
      for (let i = 0; i < 3; i++) b.rect(x + 4 + i * 3, y + 4, 2, 3, [P.red2, P.amber2, P.green2][i]!);
      b.frame(x + 1, y + 1, 14, 15, P.ink);
      break;
    case 'coffee':
      b.rect(x + 3, y + 3, 10, 12, P.gray5);
      b.rect(x + 5, y + 5, 6, 4, P.gray2);
      b.rect(x + 6, y + 10, 4, 3, P.white);
      b.frame(x + 3, y + 3, 10, 12, P.ink);
      break;
    case 'beanbag':
      b.ellipse(x + 8, y + 8, 7, 6, P.purple2);
      b.ellipse(x + 7, y + 6, 4, 3, P.purple1);
      break;
    case 'bench':
    case 'leader-desk':
      b.rect(x, y, w, h, P.wood2);
      b.rect(x, y + h - 5, w, 5, P.wood4);
      b.hline(x, y, w, P.wood1);
      b.frame(x - 1, y - 1, w + 2, h + 2, P.ink);
      // two monitors + nameplate + lamp
      for (const mx of [x + 10, x + w - 26]) {
        b.rect(mx, y - 8, 16, 11, P.ink);
        b.rect(mx + 1, y - 7, 14, 8, P.blue4);
        b.hline(mx + 2, y - 5, 8, P.cyan1);
        b.hline(mx + 2, y - 3, 5, P.blue1);
      }
      b.rect(x + (w >> 1) - 6, y + 8, 12, 4, P.amber2);
      b.rect(x + w - 8, y + 4, 3, 6, P.gray4);
      b.rect(x + w - 9, y + 2, 5, 2, P.amber1);
      break;
  }
}
const ROOM_TINT = Object.fromEntries(ROOMS.map((r) => [r.key, r.tint])) as Record<RoomKey, Color>;

export function drawShip(): ShipArt {
  const b = new PixelBuffer(COLS * TILE, ROWS * TILE);
  const lights: Light[] = [];
  b.rect(0, 0, b.w, b.h, P.space1);

  // corridor
  for (let ty = CORRIDOR.y0; ty <= CORRIDOR.y1; ty++) for (let tx = 1; tx < COLS - 1; tx++) floorTileArt(b, 'corridor', tx, ty);

  const doorTiles = new Set<string>();
  for (const r of ROOMS) {
    const f = r.floor;
    for (let ty = f.y; ty < f.y + f.h; ty++) for (let tx = f.x; tx < f.x + f.w; tx++) floorTileArt(b, r.key, tx, ty);
    for (const dx of [0, 1]) {
      const rows = r.top ? [12] : [17, 18];
      for (const ty of rows) {
        doorTiles.add(`${r.doorTx + dx},${ty}`);
        floorTileArt(b, 'corridor', r.doorTx + dx, ty);
      }
    }
  }
  // walls
  const floorish = (tx: number, ty: number) => doorTiles.has(`${tx},${ty}`) || (ty >= CORRIDOR.y0 && ty <= CORRIDOR.y1 && tx >= 1 && tx < COLS - 1) || ROOMS.some((r) => tx >= r.floor.x && tx < r.floor.x + r.floor.w && ty >= r.floor.y && ty < r.floor.y + r.floor.h);
  for (let ty = 0; ty < ROWS; ty++)
    for (let tx = 0; tx < COLS; tx++) {
      if (floorish(tx, ty)) continue;
      const belowIsFloor = floorish(tx, ty + 1);
      const aboveIsWallFace = ty > 0 && !floorish(tx, ty - 1) && floorish(tx, ty + 1) && false;
      void aboveIsWallFace;
      if (ty === 1 && !floorish(tx, 1) && floorish(tx, 2)) wallFace(b, tx, ty, true);
      else if (ty === 18 && floorish(tx, 19)) wallFace(b, tx, ty, false);
      else wallCap(b, tx, ty);
      void belowIsFloor;
    }
  // outer north windows
  for (const tx of [2, 5, 13, 16, 23, 27, 40, 47, 51, 56, 60]) windowArt(b, tx, 1, 2);

  // furniture: chairs first, desks, props
  for (const p of PROPS) if (p.kind === 'rug') propArt(b, p, lights);
  for (const s of SEATS) if (s.kind === 'desk' || s.kind === 'leader') chairArt(b, s.sit.x, s.sit.y - 9, s.sit.facing);
  for (const s of SEATS) if (s.kind === 'meeting') chairArt(b, s.sit.x, s.sit.y - 8, s.sit.facing === 'up' || s.sit.facing === 'down' ? s.sit.facing : 'none');
  for (const p of PROPS) if (p.kind !== 'rug' && p.kind !== 'sofa' && p.kind !== 'leader-desk') propArt(b, p, lights);
  for (const d of DESKS) deskArt(b, d);
  for (const p of PROPS) if (p.kind === 'leader-desk' || p.kind === 'sofa') propArt(b, p, lights);

  // room edge glow (door frames)
  for (const r of ROOMS) doorFrame(b, r);
  return { buffer: b, lights };
}

function doorFrame(b: PixelBuffer, r: RoomDef): void {
  const x = r.doorTx * TILE;
  const ys = r.top ? [12 * TILE + 13] : [18 * TILE - 1];
  for (const y of ys) {
    b.rect(x - 2, y - (r.top ? 0 : 0), 2, 3, P.cyan3);
    b.rect(x + 2 * TILE, y, 2, 3, P.cyan3);
  }
  void ROOM_BY_KEY;
}
