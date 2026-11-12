/**
 * The shark (RA1): a friendly cartoon shark in the mount's colour (grey-blue by default) with a
 * white belly, dorsal fin, tail fin and a toothy grin, "swimming" through the office floor in
 * its own little puddle. The puddle is painted after the outline: its far half under the shark
 * (back layer), its near half over the shark's belly and the rider's legs (front layer), with
 * foam where the body meets the water and ripple rings that move with the frames.
 *   walk  swimming: the tail fin sways, ripples run backwards, a wake behind the tail
 *   idle  a gentle bob
 *   happy rolls a bit to show the belly, tail wag with a splash, eyes closed happily
 *   rest  mostly submerged: only the fin and the eyes poke out of the puddle
 */
import type { MountAnim } from "../mounts.ts";
import { C } from "../palette.ts";
import {
  EYE_WHITE,
  type Finish,
  type MountArt,
  mix,
  type Offset,
  type Overlay,
  type Painter,
  type Part,
  type Shade,
  shadeOf,
  type View,
} from "./kit.ts";

const PUPIL = C.night;
const BELLY = "#f4f4f2";
const BELLY_SHADOW = C.silver;
const MOUTH = C.wine;
const WATER = C.sky;
const WATER_RIM = C.navy;
const WATER_LIGHT = C.cyan;
const FOAM = "#ffffff";

type Pose = {
  /** body bob in texels (+ = down) */
  by: number;
  /** tail fin sway (-1..1) */
  tail: number;
  /** roll towards the viewer: more belly shows */
  roll: number;
  eye: "open" | "happy" | "sleepy";
  /** ripple phase 0..3 */
  phase: number;
  splash: 0 | 1 | 2;
  sunk: boolean;
  /** swimming: wake behind the tail */
  wake: boolean;
};

/** swim bob per walk frame (texels); the rider bobs half of it in world px */
const SWIM_BOB = [0, -2, -2, 0] as const;

function pose(anim: MountAnim, frame: number): Pose {
  const base: Pose = {
    by: 0,
    tail: 0,
    roll: 0,
    eye: "open",
    phase: 0,
    splash: 0,
    sunk: false,
    wake: false,
  };
  if (anim === "walk")
    return {
      ...base,
      by: SWIM_BOB[frame % 4]!,
      tail: [1, 0, -1, 0][frame % 4]!,
      phase: frame % 4,
      wake: true,
    };
  if (anim === "idle") return { ...base, by: frame % 2 ? 2 : 0, phase: frame % 2 ? 2 : 0 };
  if (anim === "happy")
    return frame % 2
      ? { ...base, eye: "happy", tail: -1, roll: 0.5, splash: 2, phase: 2 }
      : { ...base, eye: "happy", tail: 1, roll: 1, splash: 1, by: -2, phase: 0 };
  return { ...base, sunk: true, eye: "sleepy", phase: frame % 2 ? 2 : 0 };
}

type Pal = { s: Shade; fin: string; finLight: string };

function palette(color: string): Pal {
  const s = shadeOf(color);
  return { s, fin: s.shadow, finLight: mix(s.base, s.light, 0.5) };
}

/** A fin as a filled triangle-ish blade: base from (x0, y0) to (x1, y0), tip at (tx, ty). */
function blade(
  k: Part,
  x0: number,
  x1: number,
  y0: number,
  tx: number,
  ty: number,
  col: string,
  edge: string,
): void {
  const h = y0 - ty;
  for (let j = 0; j <= h; j++) {
    const t = j / h; // 0 at the tip, 1 at the base
    const curve = Math.sqrt(t);
    const a = tx + (x0 - tx) * t; // trailing (straight)
    const b = tx + (x1 - tx) * curve; // leading (curved, bulging)
    const lo = Math.round(Math.min(a, b));
    const hi = Math.round(Math.max(a, b));
    for (let x = lo; x <= hi; x++) k.set(x, ty + j, x === hi && hi - lo > 1 ? edge : col);
  }
}

function eye(k: Part, x: number, y: number, kind: Pose["eye"]): void {
  if (kind === "happy") {
    k.set(x - 1, y + 1, PUPIL);
    k.set(x, y, PUPIL);
    k.set(x + 1, y, PUPIL);
    k.set(x + 2, y + 1, PUPIL);
    return;
  }
  k.rect(x - 1, y - 1, 4, 3, EYE_WHITE);
  k.unset(x - 1, y - 1);
  k.unset(x + 2, y - 1);
  if (kind === "sleepy") {
    k.rect(x - 1, y - 1, 4, 2, PUPIL);
    k.rect(x, y + 1, 2, 1, PUPIL);
    return;
  }
  k.rect(x, y, 2, 2, PUPIL);
  k.set(x + 1, y, EYE_WHITE);
}

/** The grin: a dark curve with a row of white teeth. */
function grin(k: Part, pts: readonly [number, number][]): void {
  pts.forEach(([x, y], i) => {
    k.set(x, y, MOUTH);
    k.set(x, y - 1, PUPIL);
    if (i % 2 === 0) k.set(x, y, EYE_WHITE);
  });
}

type Water = { rx: number; ry: number; cy: number; line: number; phase: number };

/**
 * The puddle: far half under the shark (back), near half over it (front), a darker rim, a
 * moving ripple ring and foam along the waterline from `foam[0]` to `foam[1]`.
 */
function puddle(
  paint: Overlay,
  w: Water,
  foam: readonly [number, number],
  wake: boolean,
  splash: Pose["splash"],
  splashX: number,
): void {
  const ring = 0.55 + 0.12 * (w.phase % 4);
  const fill = (u: number, v: number) => {
    const d = Math.sqrt(u * u + v * v);
    if (d > 0.9) return WATER_RIM;
    if (Math.abs(d - ring) < 0.07) return WATER_LIGHT;
    if (Math.abs(d - ring - 0.3) < 0.05 && v > 0) return WATER_LIGHT;
    return WATER;
  };
  paint("back", (k) => k.ellipse(0, w.cy, w.rx, w.ry, fill), true);
  paint("front", (k) => {
    k.ellipse(0, w.cy, w.rx, w.ry, (u, v) => (w.cy + v * w.ry >= w.line ? fill(u, v) : null));
    for (let x = foam[0]; x <= foam[1]; x++) {
      const on = (x + w.phase * 2) % 5;
      k.set(x, w.line, on === 0 ? WATER_LIGHT : FOAM);
      if (on === 1 || on === 3) k.set(x, w.line + 1, FOAM);
    }
    if (wake) {
      // a little V of foam trailing the tail
      for (let i = 0; i < 4; i++) {
        const x = foam[0] - 2 - i * 2 - (w.phase % 2);
        k.set(x, w.line - 1 + i, FOAM);
        k.set(x, w.line + 1 + i, i % 2 ? WATER_LIGHT : FOAM);
      }
    }
  });
  if (splash) {
    paint("front", (k) => {
      const drops: [number, number][] =
        splash === 1
          ? [
              [0, -10],
              [-3, -14],
              [3, -13],
              [-6, -9],
              [5, -8],
            ]
          : [
              [-2, -7],
              [2, -9],
              [-5, -12],
              [6, -11],
            ];
      for (const [dx, dy] of drops) {
        k.set(splashX + dx, w.line + dy, FOAM);
        k.set(splashX + dx, w.line + dy + 1, WATER_LIGHT);
      }
    });
  }
}

// ---- profile (facing right) -------------------------------------------------------------

function side(p: Painter, c: Pal, q: Pose): Finish {
  const { s } = c;
  const by = q.by + (q.sunk ? 10 : -3);
  const line = -7;
  const tailX = -30;
  // dorsal fin (behind the rider), leaning back
  p.part(
    "back",
    (k) => blade(k, -14, -3, -17 + by, -12 + Math.round(q.roll), -31 + by, c.fin, c.finLight),
    s.deep,
  );
  // tail fin: an upper lobe out of the water, swaying
  if (!q.sunk) {
    p.part(
      "back",
      (k) => {
        const sway = Math.round(q.tail * 2);
        blade(
          k,
          tailX - 4,
          tailX + 3,
          -9 + by,
          tailX - 6 + sway,
          -24 + by - (q.splash ? 2 : 0),
          c.fin,
          c.finLight,
        );
      },
      s.deep,
    );
  }
  // body: torpedo with a round snout, countershaded
  const bellyAt = 0.35 - q.roll * 0.3;
  if (!q.sunk)
    p.part("front", (k) => {
      const shade = (_u: number, v: number) =>
        v > bellyAt ? (v > 0.75 ? BELLY_SHADOW : BELLY) : v < -0.6 ? s.light : s.base;
      k.limb(-18, -9 + by, tailX + 1, -10 + by, 7.5, 3, (_t, side) =>
        side < -0.55 ? s.light : side > 0.4 ? BELLY_SHADOW : s.base,
      );
      k.ellipse(-2, -8 + by, 22, 11, shade);
      k.ellipse(13, -9 + by, 12, 9.5, shade);
    });
  if (q.sunk) {
    // only the top of the head and the eyes show in the puddle
    p.part("front", (k) => {
      k.ellipse(15, -8, 6, 3.5, (_u, v) => (v < -0.4 ? s.light : s.base));
      eye(k, 16, -10, q.eye);
    });
  } else {
    p.part("front", (k) => {
      // gills, eye, grin
      for (const gx of [4, 6, 8]) k.line(gx, -14 + by, gx - 1, -10 + by, s.shadow);
      eye(k, 17, -15 + by, q.eye);
      const pts: [number, number][] = [];
      for (let x = 11; x <= 24; x++) {
        const t = (x - 11) / 13;
        pts.push([x, Math.round(-8 + by - t * t * 3)]);
      }
      grin(k, pts);
      // pectoral fin, near side, dipping into the water
      k.limb(3, -9 + by, -4, -5 + by, 2.6, 1.2, c.fin);
    });
  }
  const rest = q.sunk;
  return {
    shadow: null,
    overlay: (paint) =>
      puddle(
        paint,
        { rx: rest ? 22 : 36, ry: rest ? 4.5 : 6.5, cy: -7, line, phase: q.phase },
        rest ? [-14, 21] : [tailX - 2, 24],
        q.wake,
        q.splash,
        tailX - 2,
      ),
  };
}

// ---- head-on ----------------------------------------------------------------------------

function front(p: Painter, c: Pal, q: Pose): Finish {
  const { s } = c;
  const by = q.by + (q.sunk ? 10 : -2);
  const line = -6;
  // dorsal fin behind the rider: a thin blade seen edge-on
  p.part(
    "back",
    (k) => blade(k, -2, 1, -19 + by, Math.round(q.roll), -31 + by, c.fin, c.finLight),
    s.deep,
  );
  // tail tip far behind, swaying
  if (!q.sunk && q.tail) {
    p.part(
      "back",
      (k) => blade(k, -1, 1, -20 + by, Math.round(q.tail * 5), -27 + by, c.fin, c.finLight),
      s.deep,
    );
  }
  const bellyAt = 0.1 - q.roll * 0.15;
  // pectoral fins
  if (!q.sunk) {
    p.part(
      "front",
      (k) => {
        k.limb(-9, -9 + by, -17, -5 + by, 2.6, 1.2, c.fin);
        k.limb(9, -9 + by, 17, -5 + by, 2.6, 1.2, c.fin);
      },
      s.deep,
    );
  }
  p.part("front", (k) =>
    k.ellipse(0, -10 + by, 12, 11.5, (u, v) =>
      v > bellyAt + Math.abs(u) * 0.2
        ? v > 0.7
          ? BELLY_SHADOW
          : BELLY
        : v < -0.55 && u < 0.3
          ? s.light
          : s.base,
    ),
  );
  if (q.sunk) {
    p.part("front", (k) => {
      eye(k, -7, -8, q.eye);
      eye(k, 6, -8, q.eye);
    });
  } else {
    p.part("front", (k) => {
      eye(k, -7, -14 + by, q.eye);
      eye(k, 6, -14 + by, q.eye);
      const pts: [number, number][] = [];
      for (let x = -8; x <= 7; x++) {
        const t = (x + 0.5) / 8;
        pts.push([x, Math.round(-7 + by + (1 - t * t) * 2)]);
      }
      grin(k, pts);
    });
  }
  return {
    shadow: null,
    overlay: (paint) =>
      puddle(
        paint,
        { rx: 22, ry: 6, cy: -6, line, phase: q.phase },
        q.sunk ? [-8, 7] : [-12, 11],
        false,
        q.splash,
        -14,
      ),
  };
}

// ---- from behind ------------------------------------------------------------------------

function back(p: Painter, c: Pal, q: Pose): Finish {
  const { s } = c;
  const by = q.by + (q.sunk ? 10 : -2);
  const line = -6;
  if (!q.sunk) {
    p.part(
      "front",
      (k) => {
        k.limb(-9, -9 + by, -17, -5 + by, 2.6, 1.2, c.fin);
        k.limb(9, -9 + by, 17, -5 + by, 2.6, 1.2, c.fin);
      },
      s.deep,
    );
  }
  p.part("front", (k) =>
    k.ellipse(0, -10 + by, 11.5, 11, (u, v) =>
      v < -0.55 && u < 0.3 ? s.light : u > 0.7 ? s.shadow : s.base,
    ),
  );
  // dorsal fin between the rider and us, edge-on
  p.part(
    "front",
    (k) => blade(k, -2, 1, -19 + by, Math.round(q.roll), -30 + by, c.fin, c.finLight),
    s.deep,
  );
  // tail fin rising out of the water close to us
  if (!q.sunk) {
    p.part(
      "front",
      (k) => {
        const sway = Math.round(q.tail * 3);
        blade(k, -2, 1, -5, sway, -17 + by - (q.splash ? 2 : 0), c.fin, c.finLight);
      },
      s.deep,
    );
  }
  return {
    shadow: null,
    overlay: (paint) =>
      puddle(
        paint,
        { rx: 22, ry: 6, cy: -6, line, phase: q.phase },
        q.sunk ? [-8, 7] : [-12, 11],
        q.wake,
        q.splash,
        2,
      ),
  };
}

export const shark: MountArt = {
  paint(p: Painter, color: string, view: View, anim: MountAnim, frame: number): Finish {
    const c = palette(color);
    const q = pose(anim, frame);
    if (view === "side") return side(p, c, q);
    if (view === "down") return front(p, c, q);
    return back(p, c, q);
  },
  rider(view: View, anim: MountAnim, frame: number): Offset {
    const q = pose(anim, frame);
    const x = view === "side" ? 2 : 0;
    if (anim === "rest") return { x, y: 2 };
    return { x, y: (view === "side" ? -4 : -5) + q.by / 2 };
  },
  lead(view: View, anim: MountAnim, frame: number): Offset {
    const q = pose(anim, frame);
    const by = q.by + (q.sunk ? 10 : view === "side" ? -3 : -2);
    // the dorsal fin, a bit below its tip
    const p = view === "side" ? { x: -10, y: -26 + by } : { x: 0, y: -26 + by };
    return { x: Math.round(p.x / 2), y: Math.round(p.y / 2) };
  },
};
