import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { AgentDTO, RoomKey } from '@avo/shared';
import { PixelBuffer } from './pixel/buffer.js';
import { appearanceFor, CHAR_H, CHAR_W, dirOf, drawCharacter, FRAME_COUNT, type Appearance, type CharPose, type Dir } from './pixel/characters.js';
import { drawIcon, ICON, ICON_KEYS, type IconKey } from './pixel/icons.js';
import { BLOCKERS, ROOM_BY_KEY, ROOMS, SEATS, TILE, WORLD_H, WORLD_W, route, walkableAt, type Facing, type Seat } from './pixel/layout.js';
import { drawShip } from './pixel/ship.js';
import type { OfficeLabels, OfficeSfx, ViewFilter } from './types.js';

function toTexture(b: PixelBuffer): Texture {
  const c = document.createElement('canvas');
  c.width = b.w;
  c.height = b.h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(b.w, b.h);
  img.data.set(b.data);
  ctx.putImageData(img, 0, 0);
  const t = Texture.from(c);
  t.source.scaleMode = 'nearest';
  return t;
}

const SPEED = 52; // px/s
const WALK_FRAME_MS = 130;
const IDLE_FRAME_MS = 520;

type FrameTex = Map<string, Texture>;

interface Target {
  room: RoomKey;
  spot: { x: number; y: number; facing: Facing };
  sit: boolean;
  pose: CharPose;
}

class Actor {
  readonly root = new Container();
  readonly ring = new Graphics();
  readonly sprite = new Sprite();
  readonly icon = new Sprite();
  readonly tag = new Container();
  readonly nameText: Text;
  readonly badgeBg = new Graphics();
  readonly badgeText: Text;
  readonly stateText: Text;
  frames: FrameTex = new Map();
  appearance!: Appearance;
  appearanceKey = '';
  pos = { x: 0, y: 0 };
  room: RoomKey = 'main_office';
  path: { x: number; y: number }[] = [];
  target: Target | null = null;
  walkDir: Dir = 'down';
  walkFlip = false;
  frameClock = 0;
  agent: AgentDTO | null = null;
  seat: Seat | null = null;
  placed = false;
  constructor(public readonly id: string) {
    this.root.addChild(this.ring, this.sprite, this.icon);
    this.sprite.eventMode = 'static';
    this.sprite.cursor = 'pointer';
    const style = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 11, fill: 0xffffff, stroke: { color: 0x141b2d, width: 3 } } as const;
    this.nameText = new Text({ text: '', style });
    this.stateText = new Text({ text: '', style: { ...style, fontSize: 10, fill: 0xcfe3ff } });
    this.badgeText = new Text({ text: '', style: { ...style, fontSize: 9, fill: 0x141b2d, stroke: { color: 0x141b2d, width: 0 } } });
    this.tag.addChild(this.nameText, this.badgeBg, this.badgeText, this.stateText);
    this.tag.eventMode = 'none';
  }
}

export interface SceneOptions {
  onSelect: (id: string | null) => void;
  onSfx?: ((n: OfficeSfx) => void) | undefined;
  labels: OfficeLabels;
  reducedMotion: boolean;
}

export class OfficeScene {
  private readonly world = new Container();
  private readonly hud = new Container();
  private readonly actorLayer = new Container();
  private readonly lightsG = new Graphics();
  private readonly banner = new Container();
  private readonly roomLabels: { text: Text; bg: Graphics; key: RoomKey }[] = [];
  private actors = new Map<string, Actor>();
  private textures = new Map<string, FrameTex>();
  private icons = new Map<IconKey, Texture>();
  private lights: ReturnType<typeof drawShip>['lights'];
  private labels: OfficeLabels;
  private reduced: boolean;
  private filter: ViewFilter = 'ALL';
  private selected: string | null = null;
  private live = true;
  private time = 0;
  private fit = 1;
  private userZoomed = false;
  private roomSeatClaims = new Map<RoomKey, Map<string, Seat>>();
  private avatar: Actor | null = null;
  private avatarEnabled = false;
  private keys = new Set<string>();
  private destroyed = false;
  private lastActorsJson = '';
  private snapshotAcc = 0;
  private bannerText: Text;
  private bannerBg = new Graphics();
  private readonly cleanup: (() => void)[] = [];

  constructor(private readonly app: Application, private readonly host: HTMLElement, private readonly opts: SceneOptions) {
    this.labels = opts.labels;
    this.reduced = opts.reducedMotion;
    const art = drawShip();
    this.lights = art.lights;
    const ship = new Sprite(toTexture(art.buffer));
    for (const k of ICON_KEYS) this.icons.set(k, toTexture(drawIcon(k)));

    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    this.world.addChild(ship, this.lightsG, this.actorLayer);
    app.stage.addChild(this.world, this.hud);
    this.hud.eventMode = 'none';

    this.bannerText = new Text({ text: '', style: { fontFamily: 'ui-monospace, monospace', fontSize: 12, fill: 0x141b2d } });
    this.banner.addChild(this.bannerBg, this.bannerText);
    this.banner.visible = false;

    for (const r of ROOMS) {
      const bg = new Graphics();
      const text = new Text({ text: '', style: { fontFamily: 'ui-monospace, monospace', fontSize: 10, fill: 0x141b2d } });
      this.hud.addChild(bg, text);
      this.roomLabels.push({ text, bg, key: r.key });
    }
    this.hud.addChild(this.banner);
    this.applyLabels(opts.labels);
    this.bindPointer();
    this.bindKeys();
    this.layout();
    const ro = new ResizeObserver(() => this.layout());
    ro.observe(host);
    this.cleanup.push(() => ro.disconnect());
    app.ticker.add((t) => this.tick(t.deltaMS));
  }

  // ------------------------------------------------------------------ public API
  setLabels(l: OfficeLabels): void {
    this.labels = l;
    this.applyLabels(l);
    for (const a of this.actors.values()) this.refreshTag(a);
  }
  setReducedMotion(v: boolean): void {
    this.reduced = v;
  }
  setFilter(f: ViewFilter): void {
    this.filter = f;
    for (const a of this.actors.values()) a.root.visible = this.visible(a);
  }
  setSelected(id: string | null): void {
    this.selected = id;
  }
  setLive(v: boolean): void {
    this.live = v;
    this.banner.visible = !v;
    this.world.alpha = v ? 1 : 0.72;
  }
  setAvatarEnabled(v: boolean): void {
    this.avatarEnabled = v;
    if (v && !this.avatar) {
      const a = new Actor('__you__');
      a.appearance = appearanceFor({ seed: 'owner-avatar', isOwner: true });
      a.appearanceKey = 'owner';
      a.pos = { x: 6 * TILE, y: 10 * TILE };
      a.room = 'main_office';
      this.actorLayer.addChild(a.root);
      this.hud.addChild(a.tag);
      this.avatar = a;
      a.nameText.text = this.labels.you;
      this.hookClick(a);
    }
    if (this.avatar) {
      this.avatar.root.visible = v;
      this.avatar.tag.visible = v;
    }
    if (!v) this.keys.clear();
  }
  zoom(factor: number | 'reset'): void {
    if (factor === 'reset') {
      this.userZoomed = false;
      this.layout();
      return;
    }
    this.userZoomed = true;
    const cx = this.app.screen.width / 2;
    const cy = this.app.screen.height / 2;
    this.zoomAt(cx, cy, factor);
  }
  setAgents(agents: AgentDTO[]): void {
    const ids = new Set(agents.map((a) => a.id));
    for (const [id, a] of this.actors) {
      if (ids.has(id)) continue;
      a.root.destroy({ children: true });
      a.tag.destroy({ children: true });
      this.actors.delete(id);
      for (const claims of this.roomSeatClaims.values()) claims.delete(id);
    }
    for (const dto of agents) {
      let a = this.actors.get(dto.id);
      if (!a) {
        a = new Actor(dto.id);
        this.actors.set(dto.id, a);
        this.actorLayer.addChild(a.root);
        this.hud.addChild(a.tag);
        this.hookClick(a);
      }
      a.agent = dto;
      this.ensureAppearance(a, dto);
      this.retarget(a, dto, agents);
      a.root.visible = this.visible(a);
      this.refreshTag(a);
    }
  }
  snapshot(): { id: string; room: RoomKey; walking: boolean; x: number; y: number; pose: string }[] {
    return [...this.actors.values()].map((a) => ({ id: a.id, room: a.room, walking: a.path.length > 0, x: Math.round(a.pos.x), y: Math.round(a.pos.y), pose: a.target?.pose ?? 'idle' }));
  }
  destroy(): void {
    this.destroyed = true;
    this.cleanup.forEach((f) => f());
    this.actors.clear();
  }

  // ------------------------------------------------------------------ layout & camera
  private layout(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    if (w <= 0 || h <= 0) return;
    this.fit = Math.min(w / WORLD_W, h / WORLD_H);
    if (!this.userZoomed) {
      this.world.scale.set(this.fit);
      this.world.position.set((w - WORLD_W * this.fit) / 2, (h - WORLD_H * this.fit) / 2);
    } else this.clamp();
    this.bannerBg.clear();
    this.positionBanner();
  }
  private zoomAt(sx: number, sy: number, factor: number): void {
    const old = this.world.scale.x;
    const next = Math.max(this.fit, Math.min(this.fit * 5, old * factor));
    const wx = (sx - this.world.x) / old;
    const wy = (sy - this.world.y) / old;
    this.world.scale.set(next);
    this.world.position.set(sx - wx * next, sy - wy * next);
    this.clamp();
    if (next <= this.fit + 0.001) {
      this.userZoomed = false;
      this.layout();
    }
  }
  private clamp(): void {
    const s = this.world.scale.x;
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const cw = WORLD_W * s;
    const ch = WORLD_H * s;
    this.world.x = cw <= w ? (w - cw) / 2 : Math.min(0, Math.max(w - cw, this.world.x));
    this.world.y = ch <= h ? (h - ch) / 2 : Math.min(0, Math.max(h - ch, this.world.y));
  }
  private bindPointer(): void {
    const stage = this.app.stage;
    let drag: { x: number; y: number; wx: number; wy: number; moved: boolean } | null = null;
    stage.on('pointerdown', (e) => {
      drag = { x: e.global.x, y: e.global.y, wx: this.world.x, wy: this.world.y, moved: false };
    });
    stage.on('pointermove', (e) => {
      if (!drag) return;
      const dx = e.global.x - drag.x;
      const dy = e.global.y - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved && this.world.scale.x > this.fit + 0.001) {
        this.world.position.set(drag.wx + dx, drag.wy + dy);
        this.clamp();
      }
    });
    const end = () => {
      if (drag && !drag.moved && !this.pickedThisTap) {
        if (this.selected) this.opts.onSfx?.('deselect');
        this.opts.onSelect(null);
      }
      this.pickedThisTap = false;
      drag = null;
    };
    stage.on('pointerup', end);
    stage.on('pointerupoutside', () => {
      drag = null;
    });
    const canvas = this.app.canvas as HTMLCanvasElement;
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      this.userZoomed = true;
      this.zoomAt(ev.clientX - rect.left, ev.clientY - rect.top, ev.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    this.cleanup.push(() => canvas.removeEventListener('wheel', wheel));
  }
  private pickedThisTap = false;
  private hookClick(a: Actor): void {
    a.sprite.on('pointertap', (e) => {
      e.stopPropagation();
      this.pickedThisTap = true;
      if (a === this.avatar) return;
      this.opts.onSfx?.('select');
      this.opts.onSelect(a.id);
    });
  }
  private bindKeys(): void {
    const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    const down = (e: KeyboardEvent) => {
      if (!this.avatarEnabled || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if ('wasd'.includes(k) && k.length === 1) {
        this.keys.add(k);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
    const blur = () => this.keys.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    this.cleanup.push(() => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    });
  }

  // ------------------------------------------------------------------ textures
  private ensureAppearance(a: Actor, dto: AgentDTO): void {
    const ap = appearanceFor({ seed: dto.appearanceSeed || dto.id, departmentKey: dto.departmentKey, departmentColor: dto.departmentColor, orgRole: dto.orgRole });
    const key = `${dto.appearanceSeed}|${dto.departmentKey}|${dto.departmentColor}|${dto.orgRole}`;
    if (a.appearanceKey === key) return;
    a.appearance = ap;
    a.appearanceKey = key;
    a.frames = this.textures.get(key) ?? new Map();
    this.textures.set(key, a.frames);
  }
  private frame(a: Actor, pose: CharPose, dir: Dir, f: number): Texture {
    const key = `${pose}|${dir}|${f % FRAME_COUNT[pose]}`;
    let t = a.frames.get(key);
    if (!t) {
      t = toTexture(drawCharacter(a.appearance, { pose, dir, f: f % FRAME_COUNT[pose] }));
      a.frames.set(key, t);
    }
    return t;
  }

  // ------------------------------------------------------------------ placement binding (the only input is AgentDTO.placement)
  private visible(a: Actor): boolean {
    const m = a.agent?.mode;
    return this.filter === 'ALL' || m === this.filter;
  }
  private claims(room: RoomKey): Map<string, Seat> {
    let m = this.roomSeatClaims.get(room);
    if (!m) this.roomSeatClaims.set(room, (m = new Map()));
    return m;
  }
  private seatFor(dto: AgentDTO, room: RoomKey, all: AgentDTO[]): Seat | null {
    const seats = SEATS.filter((s) => s.room === room);
    if (!seats.length) return null;
    const claims = this.claims(room);
    const mine = claims.get(dto.id);
    if (room === dto.homeRoom) {
      // stable rank among agents sharing this home room: leaders first, then by creation
      const mates = all.filter((x) => x.homeRoom === room).sort((x, y) => Number(y.orgRole === 'leader') - Number(x.orgRole === 'leader') || x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id));
      const rank = mates.findIndex((x) => x.id === dto.id);
      const s = seats[Math.max(0, rank) % seats.length]!;
      claims.set(dto.id, s);
      return s;
    }
    if (mine) return mine;
    const taken = new Set(claims.values());
    const s = seats.find((x) => !taken.has(x)) ?? seats[claims.size % seats.length]!;
    claims.set(dto.id, s);
    return s;
  }
  private retarget(a: Actor, dto: AgentDTO, all: AgentDTO[]): void {
    const pl = dto.placement;
    for (const [room, c] of this.roomSeatClaims) if (room !== pl.room) c.delete(dto.id);
    const seat = this.seatFor(dto, pl.room, all);
    let t: Target;
    const seated = pl.pose === 'working' || pl.pose === 'thinking' || pl.pose === 'meeting' || pl.pose === 'resting';
    if (!seat) {
      const hub = ROOM_BY_KEY[pl.room].hub;
      t = { room: pl.room, spot: { x: hub.x, y: hub.y + 10, facing: 'down' }, sit: false, pose: 'idle' };
    } else if (seated) {
      t = { room: pl.room, spot: seat.sit, sit: true, pose: pl.pose };
    } else {
      t = { room: pl.room, spot: seat.stand, sit: false, pose: pl.pose };
    }
    a.seat = seat;
    const prev = a.target;
    const same = prev && prev.room === t.room && prev.spot.x === t.spot.x && prev.spot.y === t.spot.y && prev.sit === t.sit;
    a.target = t;
    if (!a.placed || this.reduced) {
      a.pos = { x: t.spot.x, y: t.spot.y };
      a.room = t.room;
      a.path = [];
      a.placed = true;
      return;
    }
    if (same) return;
    const from = { room: a.room, x: a.pos.x, y: a.pos.y };
    a.path = route(from, { room: t.room, x: t.spot.x, y: t.spot.y });
    if (a.path.length) this.opts.onSfx?.('door');
  }

  // ------------------------------------------------------------------ per-frame
  private tick(dtMs: number): void {
    if (this.destroyed) return;
    this.time += dtMs;
    const dt = dtMs / 1000;
    for (const a of this.actors.values()) this.stepActor(a, dt, dtMs);
    if (this.avatar && this.avatarEnabled) this.stepAvatar(this.avatar, dt, dtMs);
    this.drawLights();
    this.positionHud();
    this.snapshotAcc += dtMs;
    if (this.snapshotAcc > 400) {
      this.snapshotAcc = 0;
      const json = JSON.stringify(this.snapshot());
      if (json !== this.lastActorsJson) {
        this.lastActorsJson = json;
        this.host.dataset['actors'] = json;
      }
    }
  }
  private stepActor(a: Actor, dt: number, dtMs: number): void {
    const dto = a.agent;
    const t = a.target;
    if (!dto || !t) return;
    let walking = false;
    if (a.path.length) {
      const next = a.path[0]!;
      const dx = next.x - a.pos.x;
      const dy = next.y - a.pos.y;
      const dist = Math.hypot(dx, dy);
      const step = SPEED * dt;
      walking = true;
      if (dist <= step) {
        a.pos.x = next.x;
        a.pos.y = next.y;
        a.path.shift();
        this.updateRoomOf(a);
        if (!a.path.length) {
          a.room = t.room;
          this.opts.onSfx?.('footstep');
        }
      } else {
        a.pos.x += (dx / dist) * step;
        a.pos.y += (dy / dist) * step;
        if (Math.abs(dx) > Math.abs(dy)) {
          a.walkDir = 'side';
          a.walkFlip = dx < 0;
        } else {
          a.walkDir = dy > 0 ? 'down' : 'up';
          a.walkFlip = false;
        }
      }
    }
    a.frameClock += dtMs;
    this.paintActor(a, dto, walking);
  }
  private updateRoomOf(a: Actor): void {
    const tx = Math.floor(a.pos.x / TILE);
    const ty = Math.floor(a.pos.y / TILE);
    for (const r of ROOMS) {
      const f = r.floor;
      if (tx >= f.x && tx < f.x + f.w && ty >= f.y && ty < f.y + f.h) a.room = r.key;
    }
  }
  private paintActor(a: Actor, dto: AgentDTO, walking: boolean): void {
    const t = a.target!;
    let pose: CharPose;
    let dir: Dir;
    let flip = false;
    let frameMs = IDLE_FRAME_MS;
    if (walking) {
      pose = 'walk';
      dir = a.walkDir;
      flip = a.walkFlip;
      frameMs = WALK_FRAME_MS;
    } else {
      pose = t.pose === 'idle' && dto.placement.overlay ? 'idle' : t.pose;
      const d = dirOf(t.spot.facing);
      dir = d.dir;
      flip = d.flip;
      if (this.reduced) frameMs = 1e9;
    }
    const f = Math.floor(a.frameClock / frameMs);
    a.sprite.texture = this.frame(a, pose, dir, f);
    a.sprite.scale.x = flip ? -1 : 1;
    a.sprite.x = Math.round(a.pos.x - CHAR_W / 2) + (flip ? CHAR_W : 0);
    a.sprite.y = Math.round(a.pos.y - 22);
    a.root.zIndex = a.pos.y;
    const sim = dto.mode === 'SIMULATED';
    const dim = dto.state === 'offline' || dto.state === 'unknown' || dto.state === 'stopped' || dto.stale;
    a.sprite.tint = dim ? 0x8d97ad : sim ? 0xe6dcff : 0xffffff;
    a.sprite.alpha = dim ? 0.62 : sim ? (Math.floor(this.time / 1700) % 9 === 0 && Math.floor(this.time / 60) % 2 ? 0.7 : 0.94) : 1;
    // overlay / bubble icon above the head
    const ov = dto.placement.overlay;
    const bubble: IconKey | null = ov ?? (walking ? null : pose === 'thinking' ? 'think' : pose === 'talking' ? 'talk' : pose === 'meeting' ? 'meet' : pose === 'resting' ? 'zzz' : null);
    a.icon.visible = !!bubble;
    if (bubble) {
      a.icon.texture = this.icons.get(bubble)!;
      a.icon.x = Math.round(a.pos.x - ICON / 2 + 7);
      a.icon.y = Math.round(a.pos.y - 22 - 6 + (Math.floor(this.time / 450) % 2));
    }
    this.drawRing(a, dto, walking);
  }
  private drawRing(a: Actor, dto: AgentDTO, walking: boolean): void {
    const g = a.ring;
    g.clear();
    const sel = this.selected === a.id;
    const cx = a.pos.x;
    const cy = a.pos.y - (a.target?.sit ? 6 : 1);
    const real = dto.mode === 'REAL';
    const col = real ? 0x5fd38d : 0xf2b84b;
    if (real) g.ellipse(cx, cy, 8, 3).stroke({ width: 1, color: col, alpha: 0.9 });
    else {
      // dashed ring = simulated
      const n = 10;
      for (let i = 0; i < n; i += 2) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        g.moveTo(cx + Math.cos(a0) * 8, cy + Math.sin(a0) * 3).lineTo(cx + Math.cos(a1) * 8, cy + Math.sin(a1) * 3).stroke({ width: 1, color: col, alpha: 0.95 });
      }
    }
    if (sel) {
      const pulse = this.reduced ? 1 : 1 + 0.12 * Math.sin(this.time / 220);
      g.ellipse(cx, cy, 11 * pulse, 4.5 * pulse).stroke({ width: 1.5, color: 0xffffff, alpha: 1 });
    }
    void walking;
  }
  private stepAvatar(a: Actor, dt: number, dtMs: number): void {
    let dx = 0;
    let dy = 0;
    if (this.keys.has('a')) dx -= 1;
    if (this.keys.has('d')) dx += 1;
    if (this.keys.has('w')) dy -= 1;
    if (this.keys.has('s')) dy += 1;
    let moving = false;
    if (dx || dy) {
      const len = Math.hypot(dx, dy);
      const sp = 78 * dt;
      const nx = a.pos.x + (dx / len) * sp;
      const ny = a.pos.y + (dy / len) * sp;
      // feet probe (two points so the body can't clip into walls/desks)
      const ok = (x: number, y: number) => walkableAt(x - 4, y - 2) && walkableAt(x + 4, y - 2);
      if (ok(nx, a.pos.y)) a.pos.x = nx;
      if (ok(a.pos.x, ny)) a.pos.y = ny;
      moving = true;
      if (Math.abs(dx) >= Math.abs(dy) && dx) {
        a.walkDir = 'side';
        a.walkFlip = dx < 0;
      } else {
        a.walkDir = dy > 0 ? 'down' : 'up';
        a.walkFlip = false;
      }
      if (Math.floor(a.frameClock / 260) !== Math.floor((a.frameClock + dtMs) / 260)) this.opts.onSfx?.('footstep');
    }
    a.frameClock += dtMs;
    const f = Math.floor(a.frameClock / (moving ? WALK_FRAME_MS : IDLE_FRAME_MS));
    a.sprite.texture = this.frame(a, moving ? 'walk' : 'idle', moving ? a.walkDir : 'down', f);
    a.sprite.scale.x = a.walkFlip && moving ? -1 : 1;
    a.sprite.x = Math.round(a.pos.x - CHAR_W / 2) + (a.walkFlip && moving ? CHAR_W : 0);
    a.sprite.y = Math.round(a.pos.y - 22);
    a.root.zIndex = a.pos.y;
    a.ring.clear().ellipse(a.pos.x, a.pos.y - 1, 8, 3).stroke({ width: 1, color: 0x57e0f0 });
    a.icon.visible = false;
  }
  private drawLights(): void {
    const g = this.lightsG;
    g.clear();
    for (const l of this.lights) {
      const i = Math.floor((this.reduced ? 0 : this.time) / l.period + l.phase) % l.colors.length;
      g.rect(l.x, l.y, 2, 2).fill(l.colors[i]!);
    }
  }

  // ------------------------------------------------------------------ HUD (screen-space text so it stays crisp)
  private applyLabels(l: OfficeLabels): void {
    for (const r of this.roomLabels) {
      r.text.text = l.roomNames[r.key];
    }
    this.bannerText.text = l.staleOverlay;
    if (this.avatar) this.avatar.nameText.text = l.you;
  }
  private positionBanner(): void {
    const w = this.app.screen.width;
    this.bannerBg.clear().roundRect(0, 0, this.bannerText.width + 20, this.bannerText.height + 10, 4).fill({ color: 0xffe3a0 }).stroke({ width: 1, color: 0x141b2d });
    this.bannerText.position.set(10, 5);
    this.banner.position.set((w - this.banner.width) / 2, 8);
  }
  private refreshTag(a: Actor): void {
    const dto = a.agent;
    if (!dto) return;
    a.nameText.text = dto.name;
    const real = dto.mode === 'REAL';
    a.badgeText.text = real ? this.labels.real : this.labels.simulated;
    a.stateText.text = this.labels.states[dto.state] ?? dto.state;
  }
  private positionHud(): void {
    const s = this.world.scale.x;
    const small = s < 1.6;
    for (const r of this.roomLabels) {
      const def = ROOM_BY_KEY[r.key];
      const p = this.world.toGlobal({ x: def.floor.x * TILE + 4, y: def.floor.y * TILE + 3 });
      r.text.position.set(p.x + 5, p.y + 2);
      r.bg.clear().roundRect(p.x, p.y, r.text.width + 10, r.text.height + 4, 3).fill({ color: 0xf4f6fa, alpha: 0.88 });
      r.text.visible = r.bg.visible = !small || s > 0.6;
    }
    const place = (a: Actor) => {
      const dto = a.agent;
      const showFull = a.id === this.selected || (a.id === '__you__' ? true : s >= 1.0);
      const p = this.world.toGlobal({ x: a.pos.x, y: a.pos.y - 30 });
      a.tag.visible = a.root.visible;
      a.tag.position.set(Math.round(p.x), Math.round(p.y));
      const name = a.nameText;
      name.anchor.set(0.5, 1);
      name.position.set(0, -13);
      a.badgeText.anchor.set(0.5, 0.5);
      a.stateText.anchor.set(0.5, 1);
      a.stateText.position.set(0, 0);
      a.stateText.visible = showFull && a.id !== '__you__';
      a.badgeText.position.set(0, -6);
      const w = a.badgeText.width + 8;
      a.badgeBg.clear();
      if (a.id === '__you__') {
        a.badgeText.visible = false;
        return;
      }
      const real = dto?.mode === 'REAL';
      a.badgeText.visible = true;
      a.badgeBg.roundRect(-w / 2, -12, w, 12, 3).fill({ color: real ? 0x5fd38d : 0xf2b84b }).stroke({ width: 1, color: 0x141b2d });
      if (!real) a.badgeBg.roundRect(-w / 2 + 1, -11, w - 2, 10, 2).stroke({ width: 1, color: 0x141b2d, alpha: 0.5 });
      name.position.set(0, -14);
      a.stateText.position.set(0, 11);
      a.stateText.anchor.set(0.5, 0);
      name.visible = showFull || a.id === this.selected;
    };
    for (const a of this.actors.values()) place(a);
    if (this.avatar && this.avatarEnabled) place(this.avatar);
  }
}
void BLOCKERS;
