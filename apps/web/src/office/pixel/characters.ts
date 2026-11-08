import { hash32, hex, light, mix, PixelBuffer, rng, shade, T, type Color } from './buffer.js';
import { HAIR_COLORS, P, SKIN_TONES } from './palette.js';

/**
 * Modular 16-bit character system. A character is a few independent parts (head/hair, torso/outfit, arms, legs,
 * accessory) assembled per frame from an `Appearance`. The appearance is derived from the agent's seed, department
 * and role, so every registered agent looks consistent and distinct, in every pose.
 */
export const CHAR_W = 16;
export const CHAR_H = 24;

export type Dir = 'down' | 'up' | 'side';
export type CharPose = 'idle' | 'walk' | 'working' | 'thinking' | 'talking' | 'meeting' | 'resting';
export const CHAR_POSES: CharPose[] = ['idle', 'walk', 'working', 'thinking', 'talking', 'meeting', 'resting'];
export const FRAME_COUNT: Record<CharPose, number> = { idle: 2, walk: 4, working: 2, thinking: 2, talking: 2, meeting: 2, resting: 2 };

export type Outfit = 'blazer' | 'vest-headset' | 'hoodie' | 'labcoat' | 'hivis' | 'jumpsuit' | 'owner';
export interface Appearance {
  skin: Color;
  hair: Color;
  hairStyle: number; // 0..5
  outfit: Outfit;
  accent: Color; // department color
  leader: boolean;
}
export interface FrameSpec {
  pose: CharPose;
  dir: Dir;
  f: number;
}

const OUTFIT_BY_DEPT: Record<string, Outfit> = {
  leadership: 'blazer',
  operations: 'vest-headset',
  engineering: 'hoodie',
  research: 'labcoat',
  infrastructure: 'hivis',
};

export function appearanceFor(input: { seed: string; departmentKey?: string | null; departmentColor?: string | null; orgRole?: string; isOwner?: boolean }): Appearance {
  const r = rng(hash32(input.seed));
  const outfit: Outfit = input.isOwner ? 'owner' : OUTFIT_BY_DEPT[input.departmentKey ?? ''] ?? 'jumpsuit';
  return {
    skin: SKIN_TONES[Math.floor(r() * SKIN_TONES.length)]!,
    hair: HAIR_COLORS[Math.floor(r() * HAIR_COLORS.length)]!,
    hairStyle: Math.floor(r() * 6),
    outfit,
    accent: input.departmentColor ? hex(input.departmentColor) : P.gray3,
    leader: input.orgRole === 'leader' || input.orgRole === 'manager',
  };
}

interface Rig {
  top: number; // y of the top of the head
  seated: boolean;
  swing: number; // -1,0,1 leg/arm swing
  mouth: boolean;
  eyesClosed: boolean;
  armsUp: 'none' | 'type' | 'chin' | 'gesture';
  tilt: number; // head x offset (resting)
}

function rigFor(s: FrameSpec): Rig {
  const f = s.f;
  const base: Rig = { top: 2, seated: false, swing: 0, mouth: false, eyesClosed: false, armsUp: 'none', tilt: 0 };
  switch (s.pose) {
    case 'idle':
      return { ...base, top: 2 + (f === 1 ? 1 : 0) };
    case 'walk':
      return { ...base, top: 2 + (f % 2 === 1 ? 1 : 0), swing: f === 0 ? 1 : f === 2 ? -1 : 0 };
    case 'working':
      return { ...base, top: 6 + (f === 1 ? 0 : 0), seated: true, armsUp: 'type' };
    case 'thinking':
      return { ...base, top: 6, seated: true, armsUp: 'chin' };
    case 'talking':
      return { ...base, top: 2 + (f === 1 ? 1 : 0), mouth: f === 1, armsUp: 'gesture' };
    case 'meeting':
      return { ...base, top: 6 + (f === 1 ? 1 : 0), seated: true, mouth: f === 1 };
    case 'resting':
      return { ...base, top: 7, seated: true, eyesClosed: true, tilt: f === 1 ? 1 : 0 };
  }
}

// ------------------------------------------------------------------ outfit palettes
function outfitColors(a: Appearance): { main: Color; dark: Color; trim: Color; under: Color; pants: Color; boots: Color } {
  switch (a.outfit) {
    case 'blazer':
      return { main: P.blue5, dark: shade(P.blue5, 0.35), trim: a.accent, under: P.white, pants: P.gray5, boots: P.ink };
    case 'vest-headset':
      return { main: P.amber2, dark: P.amber3, trim: a.accent, under: P.gray1, pants: P.gray4, boots: P.gray6 };
    case 'hoodie':
      return { main: P.gray4, dark: P.gray5, trim: a.accent, under: P.gray3, pants: P.blue5, boots: P.white };
    case 'labcoat':
      return { main: P.white, dark: P.gray1, trim: a.accent, under: P.gray2, pants: P.gray4, boots: P.gray6 };
    case 'hivis':
      return { main: P.green2, dark: P.green3, trim: P.amber1, under: P.gray5, pants: P.gray5, boots: P.warm5 };
    case 'owner':
      return { main: P.paper, dark: P.gray1, trim: P.cyan2, under: P.blue3, pants: P.blue4, boots: P.cyan4 };
    default:
      return { main: P.gray3, dark: P.gray4, trim: a.accent, under: P.gray2, pants: P.gray5, boots: P.gray6 };
  }
}

// ------------------------------------------------------------------ parts
function hairFront(b: PixelBuffer, a: Appearance, x: number, y: number, w: number): void {
  const h = a.hair;
  const hi = light(h, 0.25);
  const lo = shade(h, 0.3);
  // cap shared by all styles
  b.rect(x + 1, y, w - 2, 1, h);
  b.rect(x, y + 1, w, 2, h);
  b.set(x + 2, y, hi);
  b.set(x + 3, y + 1, hi);
  switch (a.hairStyle) {
    case 0: // short side part
      b.rect(x, y + 3, 1, 2, h);
      b.rect(x + w - 1, y + 3, 1, 2, h);
      b.hline(x + 1, y + 2, 3, lo);
      break;
    case 1: // long
      b.rect(x, y + 3, 2, 6, h);
      b.rect(x + w - 2, y + 3, 2, 6, h);
      b.vline(x, y + 4, 4, lo);
      break;
    case 2: // buzz
      b.rect(x, y + 3, 1, 1, h);
      b.rect(x + w - 1, y + 3, 1, 1, h);
      break;
    case 3: // bun / tall
      b.rect(x + 2, y - 1, w - 4, 1, h);
      b.rect(x, y + 3, 1, 3, h);
      b.rect(x + w - 1, y + 3, 1, 3, h);
      break;
    case 4: // bob with fringe
      b.rect(x, y + 3, 2, 4, h);
      b.rect(x + w - 2, y + 3, 2, 4, h);
      b.hline(x + 2, y + 3, w - 4, lo);
      break;
    default: // spiky
      b.set(x + 1, y - 1, h);
      b.set(x + 3, y - 1, h);
      b.set(x + 5, y - 1, h);
      b.rect(x, y + 3, 1, 2, h);
      b.rect(x + w - 1, y + 3, 1, 2, h);
  }
}

function accessory(b: PixelBuffer, a: Appearance, dir: Dir, headTop: number): void {
  const x = dir === 'side' ? 5 : 4;
  const w = dir === 'side' ? 7 : 8;
  switch (a.outfit) {
    case 'vest-headset':
      b.rect(x, headTop + 1, w, 1, P.gray5); // band
      if (dir !== 'up') b.rect(dir === 'side' ? x + w - 3 : x - 1, headTop + 4, 1, 3, P.gray5);
      if (dir === 'down') {
        b.rect(x + w, headTop + 4, 1, 3, P.gray5);
        b.set(x - 1, headTop + 6, P.cyan2);
        b.hline(x - 1, headTop + 7, 3, P.gray5);
      }
      break;
    case 'hoodie':
      b.rect(x - 1, headTop + 3, 1, 4, P.gray6);
      b.rect(x + w, headTop + 3, 1, 4, P.gray6);
      b.hline(x, headTop, w, P.gray6);
      b.set(x - 1, headTop + 4, a.accent);
      b.set(x + w, headTop + 4, a.accent);
      break;
    case 'labcoat':
      if (dir !== 'up') {
        b.rect(x + 1, headTop + 3, w - 2, 2, P.purple3); // goggles strap
        b.set(x + 2, headTop + 3, P.cyan1);
        b.set(x + w - 3, headTop + 3, P.cyan1);
      } else b.hline(x, headTop + 3, w, P.purple3);
      break;
    case 'hivis':
      b.rect(x - 1, headTop, w + 2, 2, P.amber2); // hard hat
      b.rect(x + 1, headTop - 1, w - 2, 1, P.amber1);
      b.hline(x - 1, headTop + 2, w + 2, P.amber3);
      break;
    case 'owner':
      b.vline(x + (w >> 1), headTop - 3, 3, P.gray2); // antenna
      b.set(x + (w >> 1), headTop - 4, P.cyan2);
      if (dir !== 'up') b.hline(x, headTop + 4, w, P.cyan3); // visor
      break;
    case 'blazer':
      if (a.leader && dir === 'down') b.set(x + 1, headTop + 8, P.amber2); // pin
      break;
    default:
      break;
  }
}

function head(b: PixelBuffer, a: Appearance, rig: Rig, dir: Dir): void {
  const y = rig.top;
  const skinLo = shade(a.skin, 0.18);
  const x0 = 4 + rig.tilt;
  if (dir === 'side') {
    const x = 5 + rig.tilt;
    b.rect(x, y + 1, 7, 8, a.skin);
    b.set(x + 7, y + 5, a.skin); // nose
    b.vline(x + 6, y + 8, 1, skinLo);
    hairFront(b, a, x, y, 7);
    b.rect(x, y + 3, 3, 5, a.hair); // hair over back of head
    if (!rig.eyesClosed) b.set(x + 5, y + 5, P.ink);
    else b.hline(x + 4, y + 5, 2, P.ink);
    if (rig.mouth) b.set(x + 5, y + 7, P.red3);
    b.set(x + 3, y + 5, skinLo); // ear
    accessory(b, a, dir, y);
    return;
  }
  if (dir === 'up') {
    b.rect(x0, y + 1, 8, 8, a.hair);
    b.rect(x0 + 1, y + 8, 6, 1, a.skin); // nape
    b.hline(x0, y + 4, 8, shade(a.hair, 0.15));
    b.set(x0 + 2, y + 1, light(a.hair, 0.3));
    b.set(x0 + 3, y + 2, light(a.hair, 0.3));
    if (a.hairStyle === 1 || a.hairStyle === 4) b.rect(x0, y + 8, 8, 2, a.hair);
    accessory(b, a, dir, y);
    return;
  }
  b.rect(x0, y + 1, 8, 8, a.skin);
  b.hline(x0 + 1, y + 8, 6, skinLo);
  hairFront(b, a, x0, y, 8);
  // eyes
  if (rig.eyesClosed) {
    b.hline(x0 + 1, y + 5, 2, P.ink);
    b.hline(x0 + 5, y + 5, 2, P.ink);
  } else {
    b.rect(x0 + 1, y + 4, 2, 2, P.white);
    b.rect(x0 + 5, y + 4, 2, 2, P.white);
    b.set(x0 + 2, y + 5, P.ink);
    b.set(x0 + 6, y + 5, P.ink);
  }
  b.set(x0 + 1, y + 6, mix(a.skin, P.red1, 0.45));
  b.set(x0 + 6, y + 6, mix(a.skin, P.red1, 0.45));
  if (rig.mouth) b.rect(x0 + 3, y + 7, 2, 1, P.red3);
  else b.hline(x0 + 3, y + 7, 2, mix(a.skin, P.red3, 0.55));
  accessory(b, a, dir, y);
}

function torso(b: PixelBuffer, a: Appearance, rig: Rig, dir: Dir): void {
  const c = outfitColors(a);
  const y = rig.top + 9;
  const x = dir === 'side' ? 5 : 4;
  const w = dir === 'side' ? 6 : 8;
  b.rect(x, y, w, 7, c.main);
  b.rect(x, y + 5, w, 2, c.dark); // belt-line shading
  b.hline(x, y, w, light(c.main, 0.2));
  if (dir === 'down') {
    switch (a.outfit) {
      case 'blazer':
        b.rect(x + 3, y, 2, 5, c.under);
        b.vline(x + 3, y + 1, 4, c.trim); // tie
        b.vline(x + 4, y + 1, 4, shade(c.trim, 0.2));
        b.vline(x + 2, y, 5, c.dark);
        b.vline(x + 5, y, 5, c.dark);
        if (a.leader) b.set(x + 1, y + 2, P.amber2);
        break;
      case 'vest-headset':
        b.rect(x + 2, y, 4, 5, c.under);
        b.vline(x + 1, y, 6, c.dark);
        b.vline(x + 6, y, 6, c.dark);
        b.hline(x + 1, y + 3, 1, c.trim);
        b.hline(x + 6, y + 3, 1, c.trim);
        break;
      case 'hoodie':
        b.hline(x + 1, y, 6, c.dark);
        b.vline(x + 3, y + 1, 3, c.under);
        b.vline(x + 4, y + 1, 3, c.under);
        b.hline(x + 1, y + 4, 6, c.trim); // chest stripe
        break;
      case 'labcoat':
        b.rect(x + 2, y, 4, 5, c.under);
        b.vline(x + 3, y + 1, 5, c.dark);
        b.vline(x + 4, y + 1, 5, c.main);
        b.set(x + 5, y + 4, c.trim);
        b.hline(x + 1, y, 1, c.trim);
        b.hline(x + 6, y, 1, c.trim);
        break;
      case 'hivis':
        b.rect(x + 2, y, 4, 5, c.under);
        b.vline(x + 1, y, 7, c.main);
        b.vline(x + 6, y, 7, c.main);
        b.hline(x, y + 3, w, c.trim); // reflective stripe
        break;
      case 'owner':
        b.rect(x + 3, y, 2, 5, c.under);
        b.vline(x, y, 7, c.trim);
        b.vline(x + 7, y, 7, c.trim);
        b.set(x + 3, y + 5, P.cyan1);
        break;
      default:
        b.vline(x + 3, y + 1, 5, c.dark);
        b.hline(x + 1, y + 2, 2, c.trim);
    }
  } else if (dir === 'up') {
    b.vline(x + (w >> 1) - 1, y + 1, 5, c.dark);
    if (a.outfit === 'hoodie') b.rect(x + 1, y, w - 2, 3, c.dark);
    if (a.outfit === 'hivis') b.hline(x, y + 3, w, c.trim);
    if (a.outfit === 'vest-headset') b.hline(x, y + 3, w, c.trim);
    if (a.outfit === 'owner') b.rect(x + 3, y + 1, 2, 2, P.cyan2);
  } else {
    b.vline(x + 2, y + 1, 5, c.dark);
    if (a.outfit === 'hivis') b.hline(x, y + 3, w, c.trim);
  }
}

function arms(b: PixelBuffer, a: Appearance, rig: Rig, dir: Dir, f: number): void {
  const c = outfitColors(a);
  const y = rig.top + 9;
  const sleeve = a.outfit === 'vest-headset' || a.outfit === 'hivis' ? c.under : c.main;
  const sleeveDark = shade(sleeve, 0.2);
  const hand = a.skin;
  const lowArm = (x: number, dy: number) => {
    b.rect(x, y + dy, 2, 5, sleeve);
    b.vline(x, y + dy + 1, 4, sleeveDark);
    b.set(x, y + dy + 5, hand);
    b.set(x + 1, y + dy + 5, hand);
  };
  if (dir === 'side') {
    const x = 6 + (rig.swing === 1 ? 1 : rig.swing === -1 ? -1 : 0);
    lowArm(x, 1);
    return;
  }
  if (rig.armsUp === 'type' && dir === 'up') {
    // forearms forward toward the keyboard, hands tap alternately
    b.rect(2, y + 1, 3, 4, sleeve);
    b.rect(11, y + 1, 3, 4, sleeve);
    b.set(f ? 3 : 4, y + 5, hand);
    b.set(f ? 12 : 11, y + 5, hand);
    b.vline(2, y + 2, 3, sleeveDark);
    b.vline(13, y + 2, 3, sleeveDark);
    return;
  }
  if (rig.armsUp === 'chin') {
    lowArm(2, 1);
    // right hand to chin
    b.rect(11, y - 3, 3, 5, sleeve);
    b.rect(11, y - 5, 2, 2, hand);
    if (f) b.set(10, y - 4, hand);
    return;
  }
  if (rig.armsUp === 'gesture') {
    lowArm(2, 1);
    b.rect(12, y - (f ? 2 : 0), 2, 5, sleeve);
    b.set(12, y - (f ? 3 : 1), hand);
    b.set(13, y - (f ? 3 : 1), hand);
    return;
  }
  const swing = rig.swing;
  lowArm(2, 1 + (swing === 1 ? -1 : swing === -1 ? 1 : 0));
  lowArm(12, 1 + (swing === 1 ? 1 : swing === -1 ? -1 : 0));
}

function legs(b: PixelBuffer, a: Appearance, rig: Rig, dir: Dir): void {
  const c = outfitColors(a);
  const y = rig.top + 16;
  if (rig.seated) {
    if (dir === 'down') {
      // thighs toward the viewer, knees bent
      b.rect(4, y, 8, 2, c.pants);
      b.hline(4, y + 1, 8, shade(c.pants, 0.25));
      b.rect(4, y + 2, 3, 1, c.boots);
      b.rect(9, y + 2, 3, 1, c.boots);
    } else if (dir === 'side') {
      b.rect(5, y, 7, 2, c.pants);
      b.rect(10, y + 1, 3, 2, c.boots);
    }
    return;
  }
  const s = rig.swing;
  if (dir === 'side') {
    b.rect(6 + (s === 1 ? 1 : 0), y, 3, 4, c.pants);
    b.rect(6 + (s === -1 ? -1 : 0), y, 3, 4, shade(c.pants, 0.2));
    b.rect(6 + (s === 1 ? 1 : 0), y + 4, 4, 1, c.boots);
    b.rect(5 + (s === -1 ? -1 : 0), y + 4, 4, 1, shade(c.boots, 0.2));
    return;
  }
  const lh = 4;
  b.rect(5, y, 3, lh - (s === 1 ? 1 : 0), c.pants);
  b.rect(8, y, 3, lh - (s === -1 ? 1 : 0), shade(c.pants, 0.15));
  b.rect(5, y + lh - (s === 1 ? 1 : 0), 3, 1, c.boots);
  b.rect(8, y + lh - (s === -1 ? 1 : 0), 3, 1, c.boots);
  if (s === 1) b.rect(5, y + lh, 3, 1, c.boots);
  if (s === -1) b.rect(8, y + lh, 3, 1, c.boots);
}

/** Render one animation frame (16x24, feet around y=22). */
export function drawCharacter(a: Appearance, spec: FrameSpec): PixelBuffer {
  const rig = rigFor(spec);
  const body = new PixelBuffer(CHAR_W, CHAR_H);
  // back-to-front: legs, torso, arms, head
  legs(body, a, rig, spec.dir);
  torso(body, a, rig, spec.dir);
  if (spec.dir === 'up' && rig.armsUp === 'type') {
    arms(body, a, rig, spec.dir, spec.f);
    head(body, a, rig, spec.dir);
  } else {
    arms(body, a, rig, spec.dir, spec.f);
    head(body, a, rig, spec.dir);
  }
  body.outline(P.ink);
  const out = new PixelBuffer(CHAR_W, CHAR_H);
  if (!rig.seated) {
    out.ellipse(8, 22, 5, 1, 0x0a0f1e, 80);
  }
  out.blit(body, 0, 0);
  return out;
}

/** Dir actually used for a pose at a seat/spot facing `facing`. */
export function dirOf(facing: 'up' | 'down' | 'left' | 'right'): { dir: Dir; flip: boolean } {
  if (facing === 'left') return { dir: 'side', flip: true };
  if (facing === 'right') return { dir: 'side', flip: false };
  return { dir: facing, flip: false };
}

export { T };
