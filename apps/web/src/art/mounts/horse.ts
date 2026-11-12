/**
 * The horse (RA1): a stocky cartoon pony in the mount's colour, mane and tail a darker shade,
 * dark hooves, a red saddle blanket under a brown leather saddle, bridle and reins.
 *
 * Profile ~34 world px long, head-on and from behind ~13 px wide. The rider sits in the saddle
 * with the hip on the seat; the barrel (profile), head + chest (head-on) or rump (from behind)
 * are front parts and hide the rider's legs.
 *   walk  4-frame trot, diagonal leg pairs, the body bobs a world px on the passing frames
 *   idle  tail swish + ear flick on the second frame
 *   happy head down nuzzling, then nodding up, eyes closed happily
 *   rest  lying down with the legs folded under, eyes shut
 */
import type { MountAnim } from "../mounts.ts";
import { C } from "../palette.ts";
import {
  darken,
  EYE_WHITE,
  type Finish,
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

const HOOF = C.cocoa;
const HOOF_LIGHT = "#5a3a3a";
const LEATHER = C.bark;
const LEATHER_DARK = C.cocoa;
const LEATHER_LIGHT = C.wood;
const BLANKET = C.wine;
const BLANKET_TRIM = C.amber;
const METAL = C.silver;
const METAL_DARK = C.grey;
const PUPIL = C.night;

type Leg = { dx: number; lift: number };
type Pose = {
  /** body bob in texels (+ = down) */
  by: number;
  /** near front, far front, near hind, far hind */
  legs: readonly [Leg, Leg, Leg, Leg];
  /** head offset in texels */
  hx: number;
  hy: number;
  tail: 0 | 1 | 2;
  ear: 0 | 1;
  eye: "open" | "happy" | "closed";
  lying: boolean;
};

const STAND: Leg = { dx: 0, lift: 0 };
/** trot body bob per walk frame (texels); the rider bobs half of it in world px */
const TROT_BOB = [0, -2, 0, -2] as const;

function pose(anim: MountAnim, frame: number): Pose {
  const base: Pose = {
    by: 0,
    legs: [STAND, STAND, STAND, STAND],
    hx: 0,
    hy: 0,
    tail: 0,
    ear: 0,
    eye: "open",
    lying: false,
  };
  if (anim === "walk") {
    const f = frame % 4;
    // diagonal pairs: A = near front + far hind, B = far front + near hind
    const plantFwd = { dx: 2, lift: 0 };
    const plantBack = { dx: -2, lift: 0 };
    const swingUp = { dx: -1, lift: 5 };
    const swingFwd = { dx: 2, lift: 3 };
    const [a, b] =
      f === 0
        ? [plantFwd, swingUp]
        : f === 1
          ? [plantBack, swingFwd]
          : f === 2
            ? [swingUp, plantFwd]
            : [swingFwd, plantBack];
    return { ...base, by: TROT_BOB[f]!, legs: [a, b, b, a], hy: f % 2 ? -1 : 1, tail: 2 };
  }
  if (anim === "idle") return frame % 2 ? { ...base, tail: 1, ear: 1 } : base;
  if (anim === "happy")
    return frame % 2
      ? { ...base, hx: 0, hy: -1, eye: "happy", tail: 1 }
      : { ...base, hx: 2, hy: 5, eye: "happy" };
  // rest: lying down
  return { ...base, by: 12, hx: -2, hy: 7 + (frame % 2), eye: "closed", lying: true, ear: 0 };
}

type Pal = {
  s: Shade;
  far: Shade;
  mane: string;
  maneLight: string;
  muzzle: string;
};

function palette(color: string): Pal {
  const s = shadeOf(color);
  const mane = darken(color, 0.55);
  return {
    s,
    far: { light: s.base, base: s.shadow, shadow: s.deep, deep: s.deep },
    mane,
    maneLight: mix(mane, color, 0.45),
    muzzle: mix(s.shadow, C.tan, 0.25),
  };
}

/**
 * One leg from `top` to its hoof: upper leg, knee (bending forward for front legs, back for
 * hind legs when lifted), cannon, hoof.
 */
function leg(s: Part, x: number, top: number, l: Leg, bend: 1 | -1, sh: Shade, floor = -3): void {
  const hx = x + l.dx;
  const hy = floor - l.lift;
  const fy = hy - 3;
  const dx = hx - x;
  const dy = fy - top;
  const d = Math.hypot(dx, dy) || 1;
  const seg = (top < fy ? fy - top : 12) / 2 + 0.3;
  const off = Math.sqrt(Math.max(0, seg * seg - (d / 2) * (d / 2)));
  // perpendicular pointing towards `bend` in x
  let px = -dy / d;
  let py = dx / d;
  if (Math.sign(px) !== bend) {
    px = -px;
    py = -py;
  }
  const kx = x + dx / 2 + px * off;
  const ky = top + dy / 2 + py * off;
  const fill = (_t: number, side: number) => (side * bend < -0.35 ? sh.shadow : sh.base);
  s.limb(x, top, kx, ky, 2.7, 2, fill);
  s.limb(kx, ky, hx, fy, 1.9, 1.6, fill);
  s.rect(hx - 2, hy - 3, 4, 3, HOOF);
  s.set(hx + (bend > 0 ? 1 : -2), hy - 3, HOOF_LIGHT);
}

function eye(s: Part, x: number, y: number, kind: Pose["eye"]): void {
  if (kind === "open") {
    s.rect(x, y, 2, 2, PUPIL);
    s.set(x + 1, y, EYE_WHITE);
  } else if (kind === "happy") {
    s.set(x - 1, y + 1, PUPIL);
    s.set(x, y, PUPIL);
    s.set(x + 1, y, PUPIL);
    s.set(x + 2, y + 1, PUPIL);
  } else {
    s.rect(x - 1, y + 1, 3, 1, PUPIL);
  }
}

// ---- profile (facing right) -------------------------------------------------------------

function side(p: Painter, c: Pal, q: Pose): Offset {
  const { s, far } = c;
  const by = q.by;
  const hx = q.hx;
  const hy = q.hy + by;
  if (!q.lying) {
    p.part("back", (k) => leg(k, 15, -18 + by, q.legs[1], 1, far), far.deep);
    p.part("back", (k) => leg(k, -10, -18 + by, q.legs[3], -1, far), far.deep);
  } else {
    // folded far legs: just the hooves peeking out
    p.part("back", (k) => {
      k.limb(14, -6, 20, -4, 2, 1.7, far.base);
      k.rect(19, -6, 3, 3, HOOF);
    });
  }
  // tail
  p.part("back", (k) => {
    const sw = q.tail;
    const pts: [number, number][] =
      sw === 1
        ? [
            [-20, -27 + by],
            [-25, -26 + by],
            [-30, -22 + by],
            [-33, -17 + by],
          ]
        : sw === 2
          ? [
              [-20, -27 + by],
              [-25, -25 + by],
              [-29, -20 + by],
              [-31, -14 + by],
            ]
          : [
              [-20, -27 + by],
              [-24, -24 + by],
              [-26, -18 + by],
              [-26, -11 + Math.min(by, 6)],
            ];
    k.path(pts, 2.8, 1.6, c.mane);
    const [a, b, d] = [pts[0]!, pts[1]!, pts[2]!];
    k.line(a[0] - 1, a[1], b[0] - 1, b[1], c.maneLight);
    k.line(b[0] - 1, b[1], d[0] - 1, d[1] + 1, c.maneLight);
  });
  // neck + head
  const nx = 20 + hx;
  const ny = -36 + hy;
  p.part("back", (k) => {
    k.limb(11, -25 + by, nx, ny, 7, 4.6, (_t, side) =>
      side < -0.45 ? s.light : side > 0.55 ? s.shadow : s.base,
    );
    // jaw, skull and muzzle
    k.ellipse(nx + 2.5, ny - 1, 4.6, 4.4, lit(s, -0.5, 0.45));
    k.limb(nx + 1, ny - 4, nx + 9, ny + 2.5, 3.6, 2.8, (_t, side) =>
      side < -0.5 ? s.light : s.base,
    );
    k.ellipse(nx + 10, ny + 3.2, 3.2, 2.8, c.muzzle);
    k.set(nx + 11, ny + 2, s.deep);
    k.line(nx + 8, ny + 5, nx + 11, ny + 5, s.deep);
    eye(k, nx + 4, ny - 3, q.eye);
  });
  // ears + mane + forelock
  p.part(
    "back",
    (k) => {
      const ex = nx - 1;
      const ey = ny - 9;
      if (q.ear) {
        k.sprite(ex - 2, ey + 1, ["xx..", "xxx.", ".xxx"], { x: s.base });
        k.set(ex - 1, ey + 2, s.deep);
      } else {
        k.sprite(ex, ey, [".x", "xx", "xx", "xx"], { x: s.base });
        k.set(ex + 1, ey + 2, s.deep);
      }
      k.sprite(ex + 2, ey + 1, [".x", "xx", "xx"], { x: s.shadow });
      k.path(
        [
          [nx - 1, ny - 6],
          [nx - 4, ny - 2],
          [nx - 7, ny + 3],
          [9, -30 + by],
        ],
        2.6,
        2.2,
        c.mane,
      );
      k.line(nx - 2, ny - 5, nx - 6, ny + 1, c.maneLight);
      // jagged strands
      k.set(nx - 6, ny + 1, c.mane);
      k.set(nx - 8, ny + 5, c.mane);
      k.set(nx - 9, ny + 4, c.mane);
      k.sprite(nx + 1, ny - 7, ["xx", ".xx"], { x: c.mane });
    },
    darken(c.mane, 0.3),
  );
  // bridle
  const bit = { x: nx + 8, y: ny + 4 };
  p.part("back", (k) => {
    k.line(nx + 1, ny - 6, nx + 4, ny + 1, LEATHER);
    k.line(nx + 4, ny + 1, bit.x, bit.y, LEATHER);
    k.line(nx + 7, ny, nx + 7, ny + 4, LEATHER);
    k.line(nx + 7, ny, nx + 10, ny + 1, LEATHER);
    k.set(bit.x, bit.y, METAL);
  });
  // body
  p.part("front", (k) => {
    k.ellipse(0, -22 + by, 19.5, 7.5, lit(s));
    k.ellipse(12, -23 + by, 7.5, 7.6, lit(s));
    k.ellipse(-13, -23.5 + by, 8.5, 7.8, lit(s));
  });
  if (!q.lying) {
    p.part(
      "front",
      (k) => {
        k.ellipse(-14, -21 + by, 6, 6.5, lit(s, -0.3, 0.4));
        leg(k, -13, -18 + by, q.legs[2], -1, s);
      },
      s.deep,
    );
    p.part("front", (k) => leg(k, 12, -18 + by, q.legs[0], 1, s), s.deep);
  } else {
    p.part(
      "front",
      (k) => {
        // hind leg folded: thigh, hock on the floor, hoof forward
        k.ellipse(-12, -10, 7, 6.5, lit(s, -0.3, 0.4));
        k.limb(-10, -4, -1, -4, 2, 1.8, s.base);
        k.rect(-1, -6, 3, 3, HOOF);
        // front leg folded under the chest, knee forward
        k.limb(12, -9, 15, -5, 2.4, 2, s.base);
        k.limb(15, -5, 8, -4, 2, 1.7, s.shadow);
        k.rect(5, -6, 3, 3, HOOF);
      },
      s.deep,
    );
  }
  // saddle: blanket, seat, flap, girth, stirrup
  p.part(
    "front",
    (k) => {
      const y = by;
      k.rect(-10, -30 + y, 16, 9, BLANKET);
      k.rect(-10, -22 + y, 16, 1, BLANKET_TRIM);
      k.unset(-10, -22 + y);
      k.unset(5, -22 + y);
      k.rect(-9, -31 + y, 14, 2, LEATHER);
      k.rect(-8, -31 + y, 12, 1, LEATHER_LIGHT);
      k.rect(-11, -34 + y, 3, 4, LEATHER);
      k.set(-11, -34 + y, LEATHER_LIGHT);
      k.rect(4, -33 + y, 2, 3, LEATHER);
      k.set(4, -33 + y, LEATHER_LIGHT);
      if (!q.lying) {
        k.rect(-6, -29 + y, 9, 8, LEATHER_DARK);
        k.rect(-5, -28 + y, 7, 6, LEATHER);
        k.rect(-1, -21 + y, 2, 6, LEATHER_DARK);
        k.line(-3, -22 + y, -3, -18 + y, LEATHER_DARK);
        k.sprite(-5, -18 + y, [".xxx.", "x...x", "xxxxx"], { x: METAL });
        k.set(-1, -16 + y, METAL_DARK);
      } else {
        k.rect(-6, -29 + y, 9, 7, LEATHER_DARK);
        k.rect(-5, -28 + y, 7, 5, LEATHER);
      }
    },
    LEATHER_DARK,
  );
  // reins from the bit to the rider's hands at the pommel
  p.part("back", (k) => {
    if (q.lying) {
      k.line(bit.x, bit.y, bit.x - 6, bit.y + 4, LEATHER_DARK);
      return;
    }
    const hand = { x: 5, y: -30 + by };
    const mid = { x: (bit.x + hand.x) / 2, y: Math.max(bit.y, hand.y) + 3 };
    k.line(bit.x, bit.y, mid.x, mid.y, LEATHER_DARK);
    k.line(mid.x, mid.y, hand.x, hand.y, LEATHER_DARK);
  });
  return { x: bit.x, y: bit.y };
}

// ---- head-on (facing the viewer) --------------------------------------------------------

function head(k: Part, c: Pal, x: number, y: number, q: Pose): void {
  const { s } = c;
  k.ellipse(x, y - 13, 5, 5, lit(s, -0.5, 0.6));
  k.limb(x, y - 12, x, y - 1, 4.6, 3.8, (_t, side) => (side > 0.6 ? s.shadow : s.base));
  // blaze
  k.rect(x - 1, y - 12, 2, 8, s.light);
  k.ellipse(x, y, 4.2, 3.2, c.muzzle);
  k.set(x - 2, y, s.deep);
  k.set(x + 1, y, s.deep);
  k.line(x - 1, y + 2, x, y + 2, s.deep);
  eye(k, x - 5, y - 12, q.eye);
  eye(k, x + 3, y - 12, q.eye);
  // forelock
  k.sprite(x - 3, y - 18, [".xxxx.", "xxxxxx", ".x.xx.", "...x.."], { x: c.mane });
}

function ears(k: Part, c: Pal, x: number, y: number, q: Pose): void {
  const e = { x: c.s.base, i: c.s.deep };
  k.sprite(x - 6, y - 23, ["x..", "xx.", "xix", ".xx"], e);
  if (q.ear)
    k.sprite(x + 4, y - 21, ["..xx", ".xix", "xxx."], e); // flicked sideways
  else k.sprite(x + 3, y - 23, ["..x", ".xx", "xix", "xx."], e);
}

function front(p: Painter, c: Pal, q: Pose): Offset {
  const { s, far } = c;
  const by = q.by;
  const hy = q.hy + by;
  const hx = q.hx >> 1;
  if (!q.lying) {
    // hind legs, further back so a bit higher up
    p.part("back", (k) => leg(k, -8, -20 + by, q.legs[2], -1, far, -7), far.deep);
    p.part("back", (k) => leg(k, 8, -20 + by, q.legs[3], 1, far, -7), far.deep);
  }
  p.part("back", (k) => {
    k.ellipse(0, -25 + by, 12, 7.5, lit(s));
    k.rect(-6, -35 + by, 12, 3, LEATHER);
    k.rect(-5, -35 + by, 10, 1, LEATHER_LIGHT);
    k.rect(-4, -37 + by, 8, 2, LEATHER);
  });
  // blanket + flaps + stirrups at the sides
  p.part(
    "front",
    (k) => {
      for (const sx of [-1, 1]) {
        const x0 = sx < 0 ? -14 : 10;
        k.rect(x0, -31 + by, 4, 9, BLANKET);
        k.rect(x0, -23 + by, 4, 1, BLANKET_TRIM);
        k.rect(sx < 0 ? -13 : 10, -30 + by, 3, 7, LEATHER);
        if (!q.lying) {
          k.line(sx < 0 ? -12 : 11, -23 + by, sx < 0 ? -12 : 11, -20 + by, LEATHER_DARK);
          k.sprite(sx < 0 ? -14 : 10, -20 + by, [".x.", "x.x", "xxx"], { x: METAL });
        }
      }
    },
    LEATHER_DARK,
  );
  if (!q.lying) {
    const [l, r] = [q.legs[0], q.legs[1]];
    p.part("front", (k) => leg(k, -6, -17 + by, { dx: 0, lift: l.lift }, -1, s), s.deep);
    p.part("front", (k) => leg(k, 6, -17 + by, { dx: 0, lift: r.lift }, 1, s), s.deep);
  } else {
    p.part("front", (k) => {
      k.rect(-9, -5, 5, 3, HOOF);
      k.rect(4, -5, 5, 3, HOOF);
    });
  }
  // chest + neck
  p.part("front", (k) => {
    k.ellipse(0, -20 + by, 10.5, 7, lit(s, -0.5, 0.45));
    k.ellipse(0, -28 + by, 8, 7.5, lit(s, -0.6, 0.6));
    // mane falling to one side
    k.path(
      [
        [-3, -37 + by],
        [-5, -31 + by],
        [-6, -25 + by],
      ],
      2,
      1.6,
      c.mane,
    );
  });
  const x = hx;
  const y = (q.lying ? -24 : -18) + hy;
  p.part("front", (k) => ears(k, c, x, y, q), c.s.deep);
  p.part("front", (k) => head(k, c, x, y, q), c.s.deep);
  // bridle + reins
  p.part("front", (k) => {
    k.rect(x - 4, y - 16, 8, 1, LEATHER);
    k.rect(x - 4, y - 4, 8, 1, LEATHER);
    k.line(x - 5, y - 15, x - 5, y - 3, LEATHER);
    k.line(x + 4, y - 15, x + 4, y - 3, LEATHER);
    k.set(x - 5, y - 2, METAL);
    k.set(x + 4, y - 2, METAL);
  });
  if (!q.lying) {
    // reins up to the rider's hands, over the neck
    p.part("front", (k) => {
      k.line(x - 6, y - 2, -7, -29 + by, LEATHER_DARK);
      k.line(x + 5, y - 2, 6, -29 + by, LEATHER_DARK);
    });
  }
  return { x, y: y + 1 };
}

// ---- from behind ------------------------------------------------------------------------

/** From behind only the top of the head shows: it barely moves (a nod, a sleepy droop). */
const backHy = (q: Pose) => (q.lying ? q.hy - 6 : Math.min(q.hy, 2));

function back(p: Painter, c: Pal, q: Pose): Offset {
  const { s, far } = c;
  const by = q.by;
  const hy = backHy(q) + by;
  // head and neck far away (higher up)
  p.part(
    "back",
    (k) => {
      k.ellipse(0, -33 + hy, 5.5, 6.5, lit(s, -0.5, 0.6));
      k.ellipse(0, -40 + hy, 4.5, 4, lit(s, -0.4, 0.6));
      k.sprite(-5, -47 + hy, ["x..", "xx.", "xxx", ".xx"], { x: s.base });
      k.sprite(2, -47 + hy, ["..x", ".xx", "xxx", "xx."], { x: s.base });
      k.rect(-1, -43 + hy, 2, 13, c.mane);
      k.set(-2, -38 + hy, c.mane);
      k.set(1, -34 + hy, c.mane);
    },
    s.deep,
  );
  if (!q.lying) {
    p.part("back", (k) => leg(k, -5, -20 + by, q.legs[0], -1, far, -7), far.deep);
    p.part("back", (k) => leg(k, 5, -20 + by, q.legs[1], 1, far, -7), far.deep);
  }
  p.part("back", (k) => {
    k.ellipse(0, -25 + by, 12, 7.5, lit(s));
    k.rect(-6, -34 + by, 12, 3, LEATHER);
    k.rect(-5, -34 + by, 10, 1, LEATHER_LIGHT);
  });
  p.part(
    "front",
    (k) => {
      for (const sx of [-1, 1]) {
        const x0 = sx < 0 ? -14 : 10;
        k.rect(x0, -31 + by, 4, 9, BLANKET);
        k.rect(x0, -23 + by, 4, 1, BLANKET_TRIM);
        k.rect(sx < 0 ? -13 : 10, -30 + by, 3, 7, LEATHER);
        if (!q.lying) {
          k.line(sx < 0 ? -12 : 11, -23 + by, sx < 0 ? -12 : 11, -20 + by, LEATHER_DARK);
          k.sprite(sx < 0 ? -14 : 10, -20 + by, [".x.", "x.x", "xxx"], { x: METAL });
        }
      }
    },
    LEATHER_DARK,
  );
  if (!q.lying) {
    const sole = (k: Part, x: number, l: Leg) => {
      leg(k, x, -15 + by, { dx: 0, lift: l.lift }, x < 0 ? -1 : 1, s);
      if (l.lift > 0) k.rect(x - 1, -4 - l.lift, 2, 1, HOOF_LIGHT);
    };
    p.part("front", (k) => sole(k, -7, q.legs[2]), s.deep);
    p.part("front", (k) => sole(k, 7, q.legs[3]), s.deep);
  } else {
    p.part("front", (k) => {
      k.rect(-14, -5, 5, 3, HOOF);
      k.rect(9, -5, 5, 3, HOOF);
    });
  }
  // rump: two round haunches
  p.part("front", (k) => k.ellipse(-5, -21 + by, 7.5, 8, lit(s, -0.5, 0.5)), s.shadow);
  p.part("front", (k) => k.ellipse(5, -21 + by, 7.5, 8, lit(s, -0.5, 0.5)), s.shadow);
  // cantle
  p.part(
    "front",
    (k) => {
      k.rect(-7, -32 + by, 14, 3, LEATHER);
      k.rect(-6, -32 + by, 12, 1, LEATHER_LIGHT);
    },
    LEATHER_DARK,
  );
  // tail
  const sw = q.tail === 1 ? 4 : q.tail === 2 ? 0 : 0;
  const wag = q.tail === 2 ? (by ? 1 : -1) : 0;
  p.part(
    "front",
    (k) => {
      k.path(
        [
          [0, -28 + by],
          [sw / 2 + wag, -21 + by],
          [sw + wag * 2, -14 + Math.min(by, 5)],
        ],
        2.6,
        2,
        c.mane,
      );
      k.line(0, -27 + by, sw / 2 + wag, -18 + by, c.maneLight);
    },
    darken(c.mane, 0.3),
  );
  return { x: 0, y: -41 + hy };
}

export const horse: MountArt = {
  paint(p: Painter, color: string, view: View, anim: MountAnim, frame: number): Finish {
    const c = palette(color);
    const q = pose(anim, frame);
    if (view === "side") side(p, c, q);
    else if (view === "down") front(p, c, q);
    else back(p, c, q);
    return {
      shadow: view === "side" ? { cx: 0, cy: -3, rx: 27, ry: 3 } : { cx: 0, cy: -4, rx: 14, ry: 4 },
    };
  },
  rider(view: View, anim: MountAnim, frame: number): Offset {
    const x = view === "side" ? -1 : 0;
    // head-on the saddle is further back, so it sits a world px higher on screen
    const seat = view === "down" ? -10 : -9;
    if (anim === "rest") return { x, y: seat + 6 };
    const bob = anim === "walk" ? TROT_BOB[frame % 4]! / 2 : 0;
    return { x, y: seat + bob };
  },
  lead(view: View, anim: MountAnim, frame: number): Offset {
    const q = pose(anim, frame);
    const p =
      view === "side"
        ? { x: 28 + q.hx, y: -32 + q.hy + q.by }
        : view === "down"
          ? { x: q.hx >> 1, y: (q.lying ? -23 : -17) + q.hy + q.by }
          : { x: 0, y: -41 + backHy(q) + q.by };
    return { x: Math.round(p.x / 2), y: Math.round(p.y / 2) };
  },
};
