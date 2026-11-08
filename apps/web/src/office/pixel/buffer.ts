/**
 * Pure RGBA pixel buffer. No DOM, no Node APIs: the same drawing code runs in the browser
 * (textures for PixiJS) and in Node (PNG export by scripts/generate-assets.ts).
 * Colors are 0xRRGGBB integers; `-1` is "transparent".
 */
export type Color = number;
export const T: Color = -1;

export function rgb(c: Color): [number, number, number] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}
export function pack(r: number, g: number, b: number): Color {
  const k = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (k(r) << 16) | (k(g) << 8) | k(b);
}
export function mix(a: Color, b: Color, t: number): Color {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return pack(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}
export const shade = (c: Color, t: number): Color => mix(c, 0x0a0f1e, t);
export const light = (c: Color, t: number): Color => mix(c, 0xffffff, t);
export function hex(css: string): Color {
  const m = /^#?([0-9a-f]{6})$/i.exec(css.trim());
  return m ? parseInt(m[1]!, 16) : 0x888888;
}

export class PixelBuffer {
  readonly data: Uint8ClampedArray;
  constructor(readonly w: number, readonly h: number) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  clone(): PixelBuffer {
    const b = new PixelBuffer(this.w, this.h);
    b.data.set(this.data);
    return b;
  }
  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  set(x: number, y: number, c: Color, alpha = 255): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (c === T || !this.inside(x, y)) return;
    const i = (y * this.w + x) * 4;
    if (alpha >= 255) {
      this.data[i] = (c >> 16) & 255;
      this.data[i + 1] = (c >> 8) & 255;
      this.data[i + 2] = c & 255;
      this.data[i + 3] = 255;
    } else {
      const a = alpha / 255;
      const inv = 1 - a;
      const da = this.data[i + 3]! / 255;
      const oa = a + da * inv;
      if (oa <= 0) return;
      this.data[i] = (((c >> 16) & 255) * a + this.data[i]! * da * inv) / oa;
      this.data[i + 1] = (((c >> 8) & 255) * a + this.data[i + 1]! * da * inv) / oa;
      this.data[i + 2] = ((c & 255) * a + this.data[i + 2]! * da * inv) / oa;
      this.data[i + 3] = oa * 255;
    }
  }
  get(x: number, y: number): Color {
    if (!this.inside(x, y)) return T;
    const i = (y * this.w + x) * 4;
    if (this.data[i + 3] === 0) return T;
    return (this.data[i]! << 16) | (this.data[i + 1]! << 8) | this.data[i + 2]!;
  }
  alphaAt(x: number, y: number): number {
    return this.inside(x, y) ? this.data[(y * this.w + x) * 4 + 3]! : 0;
  }
  rect(x: number, y: number, w: number, h: number, c: Color, alpha = 255): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c, alpha);
    return this;
  }
  frame(x: number, y: number, w: number, h: number, c: Color): this {
    this.rect(x, y, w, 1, c);
    this.rect(x, y + h - 1, w, 1, c);
    this.rect(x, y, 1, h, c);
    this.rect(x + w - 1, y, 1, h, c);
    return this;
  }
  hline(x: number, y: number, w: number, c: Color): this {
    return this.rect(x, y, w, 1, c);
  }
  vline(x: number, y: number, h: number, c: Color): this {
    return this.rect(x, y, 1, h, c);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: Color): this {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
    return this;
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: Color, alpha = 255): this {
    for (let y = -ry; y <= ry; y++)
      for (let x = -rx; x <= rx; x++) if ((x * x) / (rx * rx + 0.25) + (y * y) / (ry * ry + 0.25) <= 1) this.set(cx + x, cy + y, c, alpha);
    return this;
  }
  /** Copy `src` onto this buffer at (dx, dy). */
  blit(src: PixelBuffer, dx: number, dy: number, opts: { flipX?: boolean; alpha?: number } = {}): this {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const sx = opts.flipX ? src.w - 1 - x : x;
        const i = (y * src.w + sx) * 4;
        const a = src.data[i + 3]!;
        if (a === 0) continue;
        this.set(dx + x, dy + y, (src.data[i]! << 16) | (src.data[i + 1]! << 8) | src.data[i + 2]!, ((opts.alpha ?? 255) * a) / 255);
      }
    return this;
  }
  /** Adds a 1px outline around every opaque pixel (drawn *behind* the content). */
  outline(c: Color): this {
    const add: [number, number][] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.alphaAt(x, y) > 0) continue;
        if (this.alphaAt(x - 1, y) > 0 || this.alphaAt(x + 1, y) > 0 || this.alphaAt(x, y - 1) > 0 || this.alphaAt(x, y + 1) > 0) add.push([x, y]);
      }
    for (const [x, y] of add) this.set(x, y, c);
    return this;
  }
  /** Map every opaque pixel. */
  map(fn: (c: Color, x: number, y: number) => Color): this {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const c = this.get(x, y);
        if (c === T) continue;
        const n = fn(c, x, y);
        const i = (y * this.w + x) * 4;
        this.data[i] = (n >> 16) & 255;
        this.data[i + 1] = (n >> 8) & 255;
        this.data[i + 2] = n & 255;
      }
    return this;
  }
  desaturate(amount: number): this {
    return this.map((c) => {
      const [r, g, b] = rgb(c);
      const l = 0.3 * r + 0.59 * g + 0.11 * b;
      return pack(r + (l - r) * amount, g + (l - g) * amount, b + (l - b) * amount);
    });
  }
  /** Draw a pixel pattern: rows of chars mapped through `pal` (space/'.' = skip). */
  stamp(x: number, y: number, rows: string[], pal: Record<string, Color>): this {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i]!;
        const c = pal[ch];
        if (c !== undefined && ch !== ' ' && ch !== '.') this.set(x + i, y + j, c);
      }
    });
    return this;
  }
  imageData(): { width: number; height: number; data: Uint8ClampedArray } {
    return { width: this.w, height: this.h, data: this.data };
  }
}

// ---------------------------------------------------------------- deterministic randomness
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
