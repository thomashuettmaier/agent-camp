/**
 * Painting kit of the rideable animals (RA1). A mount frame is painted once, back to front,
 * as a list of parts into one canvas; every part says whether it belongs to the `back` layer
 * (behind the rider) or the `front` layer (over the rider's legs). `finish` outlines the whole
 * animal and then splits it, so the two layers line up texel for texel and the cut between
 * them never shows a seam: `back` is the whole animal (and its floor shadow), `front` only the
 * texels whose topmost part was a front part, plus the outline along them.
 *
 * Coordinates are texels relative to the frame anchor: x from the centre (positive = forward,
 * every animal is authored facing right; facing left mirrors it), y from the floor (negative =
 * up). Shapes take continuous coordinates, a texel (x, y) covers [x, x+1) × [y, y+1).
 */
import { darken, lighten, luma, mix, NIGHT } from "../avatar/color.ts";
import type { MountAnim } from "../mounts.ts";
import { PixelCanvas, packColor } from "../pixel.ts";

/** How a frame is seen: profile (facing right; left mirrors it), head-on, from behind. */
export type View = "side" | "down" | "up";
/** World px relative to the mount anchor (profile facing right). */
export type Offset = { x: number; y: number };

/** What every animal module provides. */
export type MountArt = {
  paint(p: Painter, color: string, view: View, anim: MountAnim, frame: number): Finish;
  /** where the rider's anchor goes (world px) */
  rider(view: View, anim: MountAnim, frame: number): Offset;
  /** where a lead ties on (world px) */
  lead(view: View, anim: MountAnim, frame: number): Offset;
};

export type Layer = "back" | "front";
/** A colour ramp of the body: highlight, base, shadow, and a deep shade for far limbs / creases. */
export type Shade = { light: string; base: string; shadow: string; deep: string };

/** Ramp from one body colour (works for very dark and very light colours too). */
export function shadeOf(color: string): Shade {
  const l = luma(color);
  return {
    light: lighten(color, l > 0.8 ? 0.5 : 0.24),
    base: color,
    shadow: darken(color, l < 0.2 ? 0.18 : 0.26),
    deep: darken(color, l < 0.2 ? 0.34 : 0.46),
  };
}

/** Shade a body texel by its normalised position (u, v in -1..1) inside a round shape. */
export type Fill = string | ((u: number, v: number) => string | null);

/** Top light, bottom shadow: the default look of a rounded body part lit from above. */
export const lit =
  (s: Shade, top = -0.45, bottom = 0.5): Fill =>
  (_u, v) =>
    v < top ? s.light : v > bottom ? s.shadow : s.base;

/** One part being painted: texels collect here and land on the canvas on commit. */
export class Part {
  readonly px = new Map<number, string>();
  constructor(private readonly p: Painter) {}

  /** A position scaled by the painter's zoom (rounded to a texel). */
  z(v: number): number {
    return Math.round(v * this.p.zoom);
  }

  /** One texel at a zoomed position (eyes, nostrils, mouth corners). */
  dot(x: number, y: number, hex: string | null): void {
    this.set(this.z(x), this.z(y), hex);
  }

  /** One texel at an exact (unzoomed) position. */
  set(x: number, y: number, hex: string | null): void {
    if (!hex) return;
    const i = this.p.idx(Math.floor(x), Math.floor(y));
    if (i >= 0) this.px.set(i, hex);
  }

  /** Clear a texel of this part (cut-outs, e.g. the gap between two ears). */
  unset(x: number, y: number): void {
    const i = this.p.idx(Math.floor(x), Math.floor(y));
    if (i >= 0) this.px.delete(i);
  }

  /** A rectangle at a zoomed position (the size stays in texels). */
  rect(x: number, y: number, w: number, h: number, hex: string): void {
    const x0 = this.z(x);
    const y0 = this.z(y);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x0 + i, y0 + j, hex);
  }

  /** Ellipse around a continuous centre; `fill` may shade by the normalised position. */
  ellipse(cx0: number, cy0: number, rx0: number, ry0: number, fill: Fill): void {
    const zm = this.p.zoom;
    const [cx, cy, rx, ry] = [cx0 * zm, cy0 * zm, rx0 * zm, ry0 * zm];
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const u = (x + 0.5 - cx) / rx;
        const v = (y + 0.5 - cy) / ry;
        if (u * u + v * v > 1) continue;
        this.set(x, y, typeof fill === "string" ? fill : fill(u, v));
      }
    }
  }

  /**
   * A thick stroke from (x0, y0) to (x1, y1), radius r0 at the start tapering to r1. `fill`
   * gets (t along 0..1, side -1..1 across the stroke, + = left of the direction).
   */
  limb(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    ar: number,
    br: number,
    fill: string | ((t: number, side: number) => string | null),
  ): void {
    const zm = this.p.zoom;
    const [x0, y0, x1, y1, r0, r1] = [ax * zm, ay * zm, bx * zm, by * zm, ar * zm, br * zm];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1;
    const r = Math.max(r0, r1);
    for (let y = Math.floor(Math.min(y0, y1) - r); y <= Math.ceil(Math.max(y0, y1) + r); y++) {
      for (let x = Math.floor(Math.min(x0, x1) - r); x <= Math.ceil(Math.max(x0, x1) + r); x++) {
        const px = x + 0.5 - x0;
        const py = y + 0.5 - y0;
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const ex = px - t * dx;
        const ey = py - t * dy;
        const rr = r0 + (r1 - r0) * t;
        const d2 = ex * ex + ey * ey;
        if (d2 > rr * rr) continue;
        // signed distance across the stroke: + is left of the direction of travel
        const side = (dx * ey - dy * ex) / Math.sqrt(len2) / (rr || 1);
        this.set(x, y, typeof fill === "string" ? fill : fill(t, side));
      }
    }
  }

  /** A polyline of strokes through the points, the radius easing from r0 to r1. */
  path(pts: readonly (readonly [number, number])[], r0: number, r1: number, fill: string): void {
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k]!;
      const b = pts[k + 1]!;
      const t0 = k / (pts.length - 1);
      const t1 = (k + 1) / (pts.length - 1);
      this.limb(a[0], a[1], b[0], b[1], r0 + (r1 - r0) * t0, r0 + (r1 - r0) * t1, fill);
    }
  }

  /** A one-texel line (straps, reins, mouths). */
  line(ax: number, ay: number, bx: number, by: number, hex: string): void {
    const [x0, y0, x1, y1] = [this.z(ax), this.z(ay), this.z(bx), this.z(by)];
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let k = 0; k <= n; k++) {
      this.set(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), hex);
    }
  }

  /** ASCII art at (x, y): each char maps to a colour, '.' and ' ' are skipped. */
  sprite(x: number, y: number, rows: readonly string[], colors: Record<string, string>): void {
    const x0 = this.z(x);
    const y0 = this.z(y);
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const hex = colors[row[i]!];
        if (hex) this.set(x0 + i, y0 + j, hex);
      }
    });
  }
}

/** Soft floor shadow ellipse (centre and radii in texels). */
export type Shadow = { cx: number; cy: number; rx: number; ry: number };
export type Finish = { shadow: Shadow | null; overlay?: (paint: Overlay) => void };
/** Paint a part into a layer after the split; `under` only fills empty texels. */
export type Overlay = (target: Layer | "both", draw: (s: Part) => void, under?: boolean) => void;

export class Painter {
  readonly full: PixelCanvas;
  /** 1 where the topmost part of a texel is a front part */
  readonly isFront: Uint8Array;
  /** Scale of shape coordinates and sizes (a bigger animal from the same numbers). */
  zoom = 1;
  constructor(
    readonly W: number,
    readonly H: number,
  ) {
    this.full = new PixelCanvas(W, H);
    this.isFront = new Uint8Array(W * H);
  }

  /** Canvas index of a local texel, -1 outside. */
  idx(x: number, y: number): number {
    const gx = this.W / 2 + x;
    const gy = this.H + y;
    if (gx < 0 || gy < 0 || gx >= this.W || gy >= this.H) return -1;
    return gy * this.W + gx;
  }

  /**
   * Paint one part. `contour` draws the part's edge in that colour wherever it lies over
   * something already painted (a near leg over the belly, a fin over the back); edges against
   * the empty background get the shared outline in `finish` instead.
   */
  part(layer: Layer, draw: (s: Part) => void, contour: string | null = null): void {
    const s = new Part(this);
    draw(s);
    const d = this.full.data;
    const W = this.W;
    for (const [i, hex] of s.px) {
      let c = hex;
      if (contour) {
        const x = i % W;
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
          if (j < 0 || j >= d.length) continue;
          if (!s.px.has(j) && d[j]! >>> 24 !== 0) {
            c = contour;
            break;
          }
        }
      }
      d[i] = packColor(c);
      this.isFront[i] = layer === "front" ? 1 : 0;
    }
  }

  /**
   * Outline, split into layers, add the floor shadow under the back layer and mirror for
   * left-facing frames. `overlay` paints unoutlined extras straight into the layers afterwards
   * (the shark's puddle under it and the ripple over its belly).
   */
  finish(
    shadow: Shadow | null,
    mirror: boolean,
    overlay?: (paint: Overlay) => void,
  ): { back: PixelCanvas; front: PixelCanvas } {
    const { W, H } = this;
    const full = this.full;
    const before = full.data.slice();
    full.outline(0, 0, W, H, NIGHT);
    const d = full.data;
    const mark = this.isFront;
    // outline texels belong to the front when they edge a front texel
    for (let i = 0; i < d.length; i++) {
      if (before[i]! >>> 24 !== 0 || d[i]! >>> 24 === 0) continue;
      const x = i % W;
      const n = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W];
      for (const j of n) {
        if (j >= 0 && j < d.length && before[j]! >>> 24 !== 0 && mark[j]) {
          mark[i] = 2;
          break;
        }
      }
    }
    const back = new PixelCanvas(W, H);
    const front = new PixelCanvas(W, H);
    back.data.set(d);
    for (let i = 0; i < d.length; i++) if (mark[i]) front.data[i] = d[i]!;
    if (shadow) {
      const sh = packColor(NIGHT, 80);
      const { cx, cy, rx, ry } = shadow;
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const u = (x + 0.5 - cx) / rx;
          const v = (y + 0.5 - cy) / ry;
          if (u * u + v * v > 1) continue;
          const i = this.idx(x, y);
          if (i >= 0 && back.data[i]! >>> 24 === 0) back.data[i] = sh;
        }
      }
    }
    overlay?.((target, draw, under = false) => {
      const s = new Part(this);
      draw(s);
      for (const pc of target === "both" ? [back, front] : [target === "back" ? back : front]) {
        for (const [i, hex] of s.px) {
          if (under && pc.data[i]! >>> 24 !== 0) continue;
          pc.data[i] = packColor(hex);
        }
      }
    });
    if (mirror) {
      flip(back);
      flip(front);
    }
    return { back, front };
  }
}

function flip(pc: PixelCanvas): void {
  const W = pc.width;
  for (let y = 0; y < pc.height; y++) {
    const row = pc.data.subarray(y * W, (y + 1) * W);
    row.reverse();
  }
}

export { darken, lighten, mix, NIGHT };

/** Eye white / shine, shared by all three animals. */
export const EYE_WHITE = "#ffffff";
