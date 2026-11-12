/**
 * The frog (RA1): a squat cartoon frog the size of a pony, in the mount's colour with a pale
 * belly, darker spots, big bulging eyes, a wide smile and pink cheeks. The rider sits on a
 * little plum cushion on its back; the frog's body (profile), face (head-on) or back with the
 * folded thighs (from behind) are front parts and hide the rider's legs.
 *   walk  a hop: crouch, launch, airborne, land (the rider rises with it)
 *   idle  the throat pulses on the second frame
 *   happy croak: inflated throat sac, eyes closed happily
 *   rest  flat on the floor, eyes half shut, the throat slowly breathing
 */
import type { MountAnim } from "../mounts.ts";
import { C } from "../palette.ts";
import {
  darken,
  EYE_WHITE,
  type Finish,
  lighten,
  lit,
  type MountArt,
  mix,
  type Offset,
  type Painter,
  type Part,
  type Shade,
  shadeOf,
  type View,
} from "./kit.ts";

const PUPIL = C.night;
const CHEEK = C.pink;
const CUSHION = C.berry;
const CUSHION_DARK = C.plum;
const TASSEL = C.amber;

type Legs = "sit" | "crouch" | "push" | "air" | "land" | "flat";
type Pose = {
  /** body lift in texels (negative = up) */
  by: number;
  /** squash (+) / stretch (-) of the body height in texels */
  sq: number;
  /** nose up (texels the head rises over the body) */
  tilt: number;
  legs: Legs;
  eye: "open" | "happy" | "half";
  /** 0 none, 1 throat pulse, 2 small sac, 3 big sac */
  throat: 0 | 1 | 2 | 3;
};

/** the frog is authored small and painted this much bigger (pony-sized) */
const ZOOM = 1.2;
/** body lift per hop frame (texels): crouch, launch, airborne, land */
const HOP = [2, -6, -11, -2] as const;

function pose(anim: MountAnim, frame: number): Pose {
  const base: Pose = { by: 0, sq: 0, tilt: 0, legs: "sit", eye: "open", throat: 0 };
  if (anim === "walk") {
    const f = frame % 4;
    const legs: Legs[] = ["crouch", "push", "air", "land"];
    return {
      ...base,
      by: HOP[f]!,
      sq: [2, -1, -1, 1][f]!,
      tilt: [0, 2, 1, -1][f]!,
      legs: legs[f]!,
    };
  }
  if (anim === "idle") return { ...base, throat: frame % 2 ? 1 : 0 };
  if (anim === "happy") return { ...base, eye: "happy", throat: frame % 2 ? 2 : 3, tilt: 1 };
  return { ...base, by: 2, sq: 3, legs: "flat", eye: "half", throat: frame % 2 ? 1 : 0 };
}

type Pal = { s: Shade; far: Shade; belly: string; bellyShadow: string; spot: string };

function palette(color: string): Pal {
  const s = shadeOf(color);
  const belly = mix(color, C.cream, 0.68);
  return {
    s,
    far: { light: s.base, base: s.shadow, shadow: s.deep, deep: s.deep },
    belly,
    bellyShadow: mix(belly, s.shadow, 0.35),
    spot: mix(s.shadow, s.deep, 0.3),
  };
}

/** Body shading with a pale belly below `belly` (normalised v). */
const bodyFill =
  (c: Pal, belly = 0.35) =>
  (u: number, v: number): string =>
    v > belly
      ? v > 0.8 || (u > 0.75 && v > 0.55)
        ? c.bellyShadow
        : c.belly
      : v < -0.55 && u < 0.5
        ? c.s.light
        : c.s.base;

/** Webbed foot: three splayed toes, `dir` = which way the toes point. */
function foot(k: Part, x0: number, y0: number, dir: 1 | -1, col: string, tip: string): void {
  const x = k.z(x0);
  const y = k.z(y0);
  for (let i = 0; i < 5; i++) k.set(x + i * dir, y, col);
  for (let i = 0; i < 3; i++) k.set(x + i * dir, y - 1, col);
  k.set(x + 5 * dir, y, tip);
  k.set(x + 4 * dir, y - 1, tip);
  k.set(x + 2 * dir, y, darken(col, 0.2));
}

function eye(k: Part, c: Pal, x0: number, y0: number, kind: Pose["eye"], look: number): void {
  // bulge (x, y = centre), white, big pupil looking `look` (-1..1)
  k.ellipse(x0, y0, 4.6, 4.6, (_u, v) => (v < -0.4 ? c.s.light : c.s.base));
  const x = k.z(x0);
  const y = k.z(y0);
  if (kind === "happy") {
    for (const [dx, dy] of [
      [-2, 1],
      [-1, 0],
      [0, -1],
      [1, 0],
      [2, 1],
    ] as const)
      k.set(x + dx, y + dy, PUPIL);
    return;
  }
  k.ellipse(x0, y0 + 0.5, 3.4, 3.4, EYE_WHITE);
  const px = x - 1 + look;
  for (let j = -1; j < 2; j++) for (let i = 0; i < 2; i++) k.set(px + i, y + j, PUPIL);
  k.set(px, y - 1, EYE_WHITE);
  if (kind === "half")
    for (let j = -4; j < 0; j++) for (let i = -3; i < 4; i++) k.set(x + i, y + j, c.s.shadow);
}

function sac(k: Part, c: Pal, x: number, y: number, size: Pose["throat"]): void {
  if (!size) return;
  const r = size === 1 ? 3 : size === 2 ? 4.5 : 6;
  const col = lighten(c.belly, 0.25);
  k.ellipse(x, y + r * 0.35, r + 1, r, (u, v) =>
    u < -0.3 && v < -0.2 ? EYE_WHITE : v > 0.6 ? c.belly : col,
  );
}

function cushion(k: Part, x0: number, y0: number, w0: number): void {
  const x = k.z(x0);
  const y = k.z(y0);
  const w = k.z(w0);
  for (let i = 0; i < w; i++) {
    k.set(x + i, y, i > 0 && i < w - 1 ? lighten(CUSHION, 0.25) : CUSHION);
    k.set(x + i, y + 1, CUSHION);
    k.set(x + i, y + 2, CUSHION_DARK);
  }
  k.set(x - 1, y + 2, TASSEL);
  k.set(x + w, y + 2, TASSEL);
}

// ---- profile (facing right) -------------------------------------------------------------

function side(p: Painter, c: Pal, q: Pose): void {
  const { s, far } = c;
  const by = q.by;
  const hy = by - q.tilt;
  const ry = 9 - q.sq * 0.5;
  // far legs
  p.part(
    "back",
    (k) => {
      if (q.legs === "air") {
        k.limb(14, -10 + by, 21, -6 + by, 1.8, 1.5, far.base);
        foot(k, 20, -5 + by, 1, far.base, far.deep);
      } else if (q.legs === "push") {
        k.limb(15, -9 + by, 17, -4 + by, 1.8, 1.5, far.base);
      } else if (q.legs !== "flat") {
        k.limb(15, -8 + by, 16, -4, 1.8, 1.5, far.base);
        foot(k, 15, -3, 1, far.base, far.deep);
      }
    },
    far.deep,
  );
  // body (rear) and head (front)
  p.part("front", (k) => {
    k.ellipse(-4, -11 + by + q.sq * 0.5, 15, ry, bodyFill(c, 0.5));
    k.ellipse(8, -12.5 + hy + q.sq * 0.5, 11, 8.5 - q.sq * 0.4, bodyFill(c, 0.25));
    // spots
    for (const [x, y, r] of [
      [-9, -16, 2],
      [-15, -11, 1.6],
      [-3, -18, 1.4],
      [-12, -6, 1.2],
    ] as const) {
      k.ellipse(x, y + by + q.sq * 0.7, r + 0.4, r, c.spot);
    }
  });
  // mouth, cheek, nostril
  p.part("front", (k) => {
    const y = -10 + hy + Math.round(q.sq * 0.6);
    k.line(5, y, 15, y - 1, s.deep);
    k.line(15, y - 1, 18, y - 3, s.deep);
    k.dot(4, y - 1, s.deep);
    k.rect(12, y - 3, 2, 1, CHEEK);
    k.dot(17, y - 7, s.deep);
    sac(k, c, 11, y + 1, q.throat);
  });
  // cushion saddle
  p.part("front", (k) => cushion(k, -11, -22 + by + Math.round(q.sq * 0.8), 12), CUSHION_DARK);
  // eye bulge (behind the rider)
  p.part("back", (k) => eye(k, c, 8, -20 + hy + q.sq, q.eye, 1), s.deep);
  // near hind leg: big folded thigh, or stretched out while hopping
  p.part(
    "front",
    (k) => {
      const t = { x: -9, y: -9 + by + q.sq * 0.5 };
      if (q.legs === "push") {
        k.ellipse(t.x - 1, t.y - 2, 7, 5.5, lit(s, -0.4, 0.5));
        k.limb(t.x - 4, t.y + 1, -17, -6, 2.6, 2, s.base);
        k.limb(-17, -6, -12, -3, 2, 1.6, s.shadow);
        foot(k, -13, -3, -1, s.base, s.deep);
      } else if (q.legs === "air") {
        k.ellipse(t.x - 1, t.y - 1, 6.5, 5, lit(s, -0.4, 0.5));
        k.limb(t.x - 4, t.y + 1, -20, t.y + 4, 2.4, 1.8, s.base);
        k.limb(-20, t.y + 4, -15, t.y + 6, 1.8, 1.5, s.shadow);
        foot(k, -16, t.y + 7, -1, s.base, s.deep);
      } else if (q.legs === "flat") {
        k.ellipse(t.x, t.y + 1, 8, 5, lit(s, -0.4, 0.5));
        foot(k, -2, -3, 1, s.base, s.deep);
      } else {
        const tuck = q.legs === "crouch" ? 1 : 0;
        k.ellipse(t.x, t.y - tuck, 8, 6.5, lit(s, -0.4, 0.5));
        k.limb(t.x - 5, t.y + 3, 0, -4, 2.2, 1.8, s.shadow);
        foot(k, 0, -3, 1, s.base, s.deep);
      }
    },
    s.deep,
  );
  // near front leg
  p.part(
    "front",
    (k) => {
      if (q.legs === "air") {
        k.limb(11, -9 + by, 18, -5 + by, 2, 1.6, s.base);
        foot(k, 17, -4 + by, 1, s.base, s.deep);
      } else if (q.legs === "push") {
        k.limb(11, -9 + by, 13, -3 + by, 2, 1.6, s.base);
        k.dot(13, -2 + by, s.deep);
      } else if (q.legs === "flat") {
        foot(k, 11, -3, 1, s.base, s.deep);
      } else {
        const reach = q.legs === "land" ? 3 : 0;
        k.limb(11, -8 + by, 12 + reach, -4, 2, 1.6, s.base);
        foot(k, 11 + reach, -3, 1, s.base, s.deep);
      }
    },
    s.deep,
  );
}

// ---- head-on ----------------------------------------------------------------------------

function front(p: Painter, c: Pal, q: Pose): void {
  const { s, far } = c;
  const by = q.by;
  const air = q.legs === "air" || q.legs === "push";
  // knees and hind feet at the sides
  p.part(
    "back",
    (k) => {
      for (const sx of [-1, 1] as const) {
        if (air) {
          k.limb(sx * 12, -10 + by, sx * 15, -4 + by, 2.6, 2, far.base);
          foot(k, sx * 14, -3 + by, sx, far.base, far.deep);
        } else {
          k.ellipse(sx * 15, -10 + by + q.sq, 5, 6 - q.sq * 0.5, lit(far, -0.4, 0.5));
          foot(k, sx * 17, -3, sx, far.base, far.deep);
        }
      }
    },
    far.deep,
  );
  // cushion peeking out behind the rider
  p.part("back", (k) => cushion(k, -8, -25 + by + q.sq, 16), CUSHION_DARK);
  const ry = 10 - q.sq * 0.5;
  const cy = -12.5 + by + q.sq * 0.5;
  p.part("front", (k) => {
    k.ellipse(0, cy, 17, ry, bodyFill(c, 0.3));
  });
  p.part("front", (k) => {
    const y = Math.round(cy + 1);
    // wide smile
    k.line(-10, y - 1, -7, y, s.deep);
    k.line(-7, y, 6, y, s.deep);
    k.line(6, y, 9, y - 1, s.deep);
    k.dot(-11, y - 2, s.deep);
    k.dot(10, y - 2, s.deep);
    k.rect(-12, y - 4, 2, 1, CHEEK);
    k.rect(10, y - 4, 2, 1, CHEEK);
    k.dot(-2, y - 5, s.deep);
    k.dot(1, y - 5, s.deep);
    sac(k, c, -0.5, y + 2, q.throat);
  });
  // front feet
  p.part(
    "front",
    (k) => {
      if (air) {
        for (const sx of [-1, 1] as const) {
          k.limb(sx * 6, -6 + by, sx * 7, -1 + by, 1.8, 1.5, s.base);
        }
      } else {
        foot(k, -10, -3, -1, s.base, s.deep);
        foot(k, 9, -3, 1, s.base, s.deep);
      }
    },
    s.deep,
  );
  // eyes on top
  const ey = Math.round(cy - ry + 2 + q.sq * 0.5);
  p.part(
    "front",
    (k) => {
      eye(k, c, -9, ey, q.eye, 0);
      eye(k, c, 9, ey, q.eye, 0);
    },
    s.deep,
  );
}

// ---- from behind -----------------------------------------------------------------------

function back(p: Painter, c: Pal, q: Pose): void {
  const { s } = c;
  const by = q.by;
  const air = q.legs === "air" || q.legs === "push";
  const ry = 10 - q.sq * 0.5 + [0, 0.7, 0.3, 1.4][q.throat]!; // breathing, puffing up to croak
  const cy = -12 + by + q.sq * 0.5;
  // backs of the eyes, far away
  p.part(
    "back",
    (k) => {
      for (const sx of [-1, 1]) {
        k.ellipse(sx * 8, cy - ry + 1, 4.4, 4.4, (_u, v) => (v < -0.3 ? s.light : s.base));
      }
    },
    s.deep,
  );
  p.part("front", (k) => {
    k.ellipse(0, cy, 16, ry, (u, v) =>
      v > 0.7 ? c.belly : v < -0.5 && u < 0.4 ? s.light : s.base,
    );
    for (const [x, y, r] of [
      [-5, -6, 2],
      [6, -5, 1.6],
      [0, -1, 1.4],
      [-9, 1, 1.2],
      [9, 2, 1.3],
    ] as const) {
      k.ellipse(x, cy + y, r + 0.4, r, c.spot);
    }
  });
  p.part("front", (k) => cushion(k, -7, Math.round(cy - ry), 14), CUSHION_DARK);
  // folded thighs and feet
  p.part(
    "front",
    (k) => {
      for (const sx of [-1, 1] as const) {
        if (air) {
          k.limb(sx * 8, cy + 4, sx * 9, -1 + by, 3, 2.4, s.base);
          k.rect(sx * 9 - 2, -2 + by, 4, 2, c.belly);
        } else {
          k.ellipse(sx * 12, cy + 4 + q.sq * 0.3, 6, 6, lit(s, -0.4, 0.5));
          foot(k, sx * 14, -3, sx, s.base, s.deep);
        }
      }
    },
    s.deep,
  );
}

export const frog: MountArt = {
  paint(p: Painter, color: string, view: View, anim: MountAnim, frame: number): Finish {
    const c = palette(color);
    const q = pose(anim, frame);
    p.zoom = ZOOM;
    if (view === "side") side(p, c, q);
    else if (view === "down") front(p, c, q);
    else back(p, c, q);
    // the shadow stays on the floor and shrinks while the frog is up in the air
    const up = Math.max(0, -q.by);
    const rx = ((view === "side" ? 22 : 18) - up * 0.6) * ZOOM;
    return { shadow: { cx: 0, cy: -3, rx, ry: 3 } };
  },
  rider(view: View, anim: MountAnim, frame: number): Offset {
    const q = pose(anim, frame);
    // the cushion's top row, unzoomed; the hip (13 texels above the rider's anchor) sinks
    // one texel into it
    const top =
      view === "side"
        ? -22 + q.by + q.sq * 0.8
        : view === "down"
          ? -23.5 + q.by + q.sq
          : -22 + q.by + q.sq;
    return { x: view === "side" ? -2 : 0, y: Math.round((ZOOM * top + 14) / 2) };
  },
  lead(view: View, anim: MountAnim, frame: number): Offset {
    const q = pose(anim, frame);
    const p =
      view === "side"
        ? { x: 14, y: -9 + q.by - q.tilt }
        : view === "down"
          ? { x: 0, y: -8 + q.by }
          : { x: 0, y: -20 + q.by };
    return { x: Math.round((p.x * ZOOM) / 2), y: Math.round((p.y * ZOOM) / 2) };
  },
};
