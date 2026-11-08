import type { RoomKey } from '@avo/shared';

/** The ship: tile grid, rooms, doors, seats and blockers. Pure data; drawing lives in ship.ts. */
export const TILE = 16;
export const COLS = 64;
export const ROWS = 34;
export const WORLD_W = COLS * TILE;
export const WORLD_H = ROWS * TILE;
export const CORRIDOR = { y0: 13, y1: 16 };
export const LANE_Y = 15 * TILE;

export type Facing = 'up' | 'down' | 'left' | 'right';
export interface Spot {
  x: number;
  y: number;
  facing: Facing;
}
export interface Seat {
  id: string;
  room: RoomKey;
  sit: Spot;
  stand: Spot;
  kind: 'leader' | 'desk' | 'meeting' | 'sofa';
}
export interface RoomDef {
  key: RoomKey;
  floor: { x: number; y: number; w: number; h: number };
  doorTx: number; // left tile of a 2-wide door
  top: boolean; // true: room above the corridor
  hub: { x: number; y: number };
  tint: number;
}
export interface Light {
  x: number;
  y: number;
  colors: number[];
  period: number;
  phase: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const room = (key: RoomKey, x: number, y: number, w: number, h: number, doorTx: number, top: boolean, tint: number): RoomDef => ({
  key,
  floor: { x, y, w, h },
  doorTx,
  top,
  tint,
  hub: { x: (doorTx + 1) * TILE, y: top ? (y + h - 1) * TILE + 4 : y * TILE + 4 },
});

export const ROOMS: RoomDef[] = [
  room('main_office', 1, 2, 19, 10, 9, true, 0x8fbdf5),
  room('employee_workspace', 21, 2, 23, 10, 31, true, 0xaab3c4),
  room('research_room', 45, 2, 18, 10, 52, true, 0x9b7bff),
  room('development_room', 1, 19, 23, 14, 11, false, 0x2fd6e6),
  room('meeting_room', 25, 19, 15, 14, 31, false, 0xf2d9ad),
  room('server_room', 41, 19, 11, 14, 46, false, 0x5fd38d),
  room('lounge', 53, 19, 10, 14, 57, false, 0xe0b985),
];
export const ROOM_BY_KEY = Object.fromEntries(ROOMS.map((r) => [r.key, r])) as Record<RoomKey, RoomDef>;

export function doorCenterX(r: RoomDef): number {
  return (r.doorTx + 1) * TILE;
}

// ------------------------------------------------------------------ furniture plan (shared by drawing + seats + blockers)
export interface Desk {
  room: RoomKey;
  tx: number;
  ty: number;
  tw: number;
  style: 'office' | 'dev' | 'lab' | 'console';
}
export interface Prop {
  room: RoomKey;
  kind: 'plant' | 'shelf' | 'screen' | 'whiteboard' | 'rack' | 'sofa' | 'coffee-table' | 'holo-table' | 'meeting-table' | 'vending' | 'coffee' | 'beanbag' | 'rug' | 'leader-desk' | 'window' | 'bench' | 'banner' | 'clock';
  tx: number;
  ty: number;
  tw: number;
  th: number;
}

export const DESKS: Desk[] = [];
export const PROPS: Prop[] = [];
export const SEATS: Seat[] = [];

function pod(roomKey: RoomKey, tx: number, ty: number, style: Desk['style'], opts: { seats?: number } = {}): void {
  const n = opts.seats ?? 1;
  DESKS.push({ room: roomKey, tx, ty, tw: 2 * n, style });
  for (let i = 0; i < n; i++) {
    const cx = (tx + 2 * i + 1) * TILE;
    SEATS.push({
      id: `${roomKey}#${SEATS.filter((s) => s.room === roomKey).length}`,
      room: roomKey,
      kind: 'desk',
      sit: { x: cx, y: (ty + 1) * TILE + 13, facing: 'up' },
      stand: { x: cx, y: (ty + 2) * TILE + 10, facing: 'down' },
    });
  }
}
const prop = (room: RoomKey, kind: Prop['kind'], tx: number, ty: number, tw = 1, th = 1) => PROPS.push({ room, kind, tx, ty, tw, th });

// --- main office (leader first)
prop('main_office', 'rug', 6, 3, 8, 7);
PROPS.push({ room: 'main_office', kind: 'leader-desk', tx: 8, ty: 6, tw: 4, th: 2 });
SEATS.push({
  id: 'main_office#0', room: 'main_office', kind: 'leader',
  sit: { x: 10 * TILE, y: 5 * TILE + 13, facing: 'down' },
  stand: { x: 13 * TILE + 8, y: 7 * TILE + 10, facing: 'down' },
});
pod('main_office', 3, 5, 'office');
pod('main_office', 15, 5, 'office');
pod('main_office', 3, 8, 'office');
prop('main_office', 'shelf', 2, 1); prop('main_office', 'shelf', 3, 1); prop('main_office', 'screen', 8, 1, 4, 1); prop('main_office', 'shelf', 16, 1); prop('main_office', 'shelf', 17, 1);
prop('main_office', 'banner', 6, 1); prop('main_office', 'banner', 13, 1);
prop('main_office', 'plant', 1, 2); prop('main_office', 'plant', 18, 2); prop('main_office', 'plant', 18, 10); prop('main_office', 'plant', 1, 10);

// --- employee workspace
for (const dx of [23, 27, 31, 35, 39]) pod('employee_workspace', dx, 4, 'office');
for (const dx of [23, 27, 35, 39]) pod('employee_workspace', dx, 8, 'office');
prop('employee_workspace', 'screen', 24, 1, 2, 1); prop('employee_workspace', 'screen', 36, 1, 2, 1); prop('employee_workspace', 'clock', 31, 1);
prop('employee_workspace', 'plant', 21, 2); prop('employee_workspace', 'plant', 42, 2); prop('employee_workspace', 'plant', 42, 10); prop('employee_workspace', 'coffee', 21, 10);

// --- research
for (const dx of [47, 51, 55, 59]) pod('research_room', dx, 4, 'lab');
for (const dx of [47, 51]) pod('research_room', dx, 8, 'lab');
prop('research_room', 'holo-table', 56, 8, 4, 2);
prop('research_room', 'shelf', 46, 1); prop('research_room', 'shelf', 47, 1); prop('research_room', 'shelf', 60, 1); prop('research_room', 'shelf', 61, 1); prop('research_room', 'whiteboard', 52, 1, 3, 1);
prop('research_room', 'plant', 45, 10); prop('research_room', 'plant', 62, 2);

// --- development
for (const dx of [3, 7, 15, 19]) pod('development_room', dx, 22, 'dev');
for (const dx of [3, 7, 15, 19]) pod('development_room', dx, 27, 'dev');
pod('development_room', 11, 27, 'dev');
prop('development_room', 'whiteboard', 3, 18, 3, 1); prop('development_room', 'whiteboard', 17, 18, 3, 1); prop('development_room', 'screen', 7, 18, 3, 1);
prop('development_room', 'coffee', 22, 19); prop('development_room', 'plant', 1, 19); prop('development_room', 'plant', 1, 32); prop('development_room', 'plant', 23, 32);

// --- meeting room (table seats)
prop('meeting_room', 'rug', 27, 22, 11, 7);
prop('meeting_room', 'meeting-table', 29, 24, 7, 3);
prop('meeting_room', 'screen', 29, 18, 7, 1); prop('meeting_room', 'plant', 25, 19); prop('meeting_room', 'plant', 39, 19); prop('meeting_room', 'plant', 25, 32); prop('meeting_room', 'plant', 39, 32);
(() => {
  const xs = [29 * TILE + 14, 29 * TILE + 42, 29 * TILE + 70, 29 * TILE + 98];
  const add = (sit: Spot, stand: Spot) => SEATS.push({ id: `meeting_room#${SEATS.filter((s) => s.room === 'meeting_room').length}`, room: 'meeting_room', kind: 'meeting', sit, stand });
  for (const x of xs) add({ x, y: 23 * TILE + 14, facing: 'down' }, { x, y: 22 * TILE + 12, facing: 'down' });
  for (const x of xs) add({ x, y: 27 * TILE + 14, facing: 'up' }, { x, y: 28 * TILE + 12, facing: 'up' });
  add({ x: 28 * TILE + 8, y: 25 * TILE + 14, facing: 'right' }, { x: 27 * TILE + 8, y: 25 * TILE + 14, facing: 'right' });
  add({ x: 36 * TILE + 8, y: 25 * TILE + 14, facing: 'left' }, { x: 37 * TILE + 8, y: 25 * TILE + 14, facing: 'left' });
})();

// --- server room
for (const ty of [21, 25, 29]) {
  prop('server_room', 'rack', 41, ty, 1, 2); prop('server_room', 'rack', 42, ty, 1, 2);
  prop('server_room', 'rack', 50, ty, 1, 2); prop('server_room', 'rack', 51, ty, 1, 2);
}
pod('server_room', 44, 23, 'console'); pod('server_room', 47, 27, 'console'); pod('server_room', 44, 30, 'console');
prop('server_room', 'screen', 44, 18, 5, 1);

// --- lounge (resting seats on sofas, all facing the viewer)
prop('lounge', 'rug', 54, 21, 8, 6);
prop('lounge', 'sofa', 54, 22, 3, 1); prop('lounge', 'sofa', 59, 22, 3, 1);
prop('lounge', 'coffee-table', 56, 24, 3, 1);
prop('lounge', 'beanbag', 54, 28, 1, 1); prop('lounge', 'beanbag', 57, 28, 1, 1); prop('lounge', 'beanbag', 60, 28, 1, 1);
prop('lounge', 'vending', 61, 18, 1, 1); prop('lounge', 'plant', 53, 19); prop('lounge', 'plant', 62, 32); prop('lounge', 'window', 55, 18, 2, 1);
(() => {
  const add = (x: number, y: number) =>
    SEATS.push({ id: `lounge#${SEATS.filter((s) => s.room === 'lounge').length}`, room: 'lounge', kind: 'sofa', sit: { x, y, facing: 'down' }, stand: { x, y: y + 22, facing: 'down' } });
  for (const tx of [54, 55, 56]) add(tx * TILE + 8, 22 * TILE + 14);
  for (const tx of [59, 60, 61]) add(tx * TILE + 8, 22 * TILE + 14);
  for (const tx of [54, 57, 60]) add(tx * TILE + 8, 28 * TILE + 14);
})();

// ------------------------------------------------------------------ walkability (WASD avatar)
export const BLOCKERS: Rect[] = [];
for (const d of DESKS) BLOCKERS.push({ x: d.tx * TILE, y: d.ty * TILE, w: d.tw * TILE, h: TILE });
for (const p of PROPS) {
  if (['rug', 'screen', 'whiteboard', 'banner', 'clock', 'window', 'shelf'].includes(p.kind)) continue;
  BLOCKERS.push({ x: p.tx * TILE, y: p.ty * TILE, w: p.tw * TILE, h: p.th * TILE });
}

export function floorTile(tx: number, ty: number): boolean {
  if (ty >= CORRIDOR.y0 && ty <= CORRIDOR.y1) return tx >= 1 && tx <= COLS - 2;
  for (const r of ROOMS) {
    const f = r.floor;
    if (tx >= f.x && tx < f.x + f.w && ty >= f.y && ty < f.y + f.h) return true;
    if ((tx === r.doorTx || tx === r.doorTx + 1) && (r.top ? ty === 12 : ty === 17 || ty === 18)) return true;
  }
  return false;
}
export function walkableAt(px: number, py: number): boolean {
  if (!floorTile(Math.floor(px / TILE), Math.floor(py / TILE))) return false;
  return !BLOCKERS.some((b) => px >= b.x && px < b.x + b.w && py >= b.y && py < b.y + b.h);
}

/** Route between rooms through doors and the corridor lane (pure waypoints; no pathfinding needed for this layout). */
export function route(from: { room: RoomKey; x: number; y: number }, to: { room: RoomKey; x: number; y: number }): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  if (from.room === to.room) {
    pts.push({ x: to.x, y: to.y });
    return pts;
  }
  const a = ROOM_BY_KEY[from.room];
  const b = ROOM_BY_KEY[to.room];
  pts.push({ x: a.hub.x, y: from.y > 0 && a.top ? Math.min(from.y, a.hub.y) : a.hub.y });
  pts.push({ x: a.hub.x, y: a.hub.y });
  pts.push({ x: doorCenterX(a), y: LANE_Y });
  pts.push({ x: doorCenterX(b), y: LANE_Y });
  pts.push({ x: b.hub.x, y: b.hub.y });
  pts.push({ x: to.x, y: to.y });
  return pts.filter((p, i, arr) => i === 0 || p.x !== arr[i - 1]!.x || p.y !== arr[i - 1]!.y);
}
