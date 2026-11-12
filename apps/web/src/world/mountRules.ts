/**
 * Rideable animals (RA1), the pure part: when a character rides, walks its animal on a lead,
 * hops off to pet it or parks it at the desk; where it parks; how the led animal follows the
 * character's breadcrumbs; the hop arc. No Pixi here (world/mount.ts does the sprites), all
 * randomness comes in as numbers from seeded generators.
 */
import type { MountKind } from "@agent-office/protocol";

type Mount = Exclude<MountKind, "none">;
type Facing = "down" | "up" | "left" | "right";
type Point = { x: number; y: number };

/** Why a character is walking (characters.ts `Goal`). */
export type TripGoal = "desk" | "poi" | "exit" | "chat" | "lunch" | "evac" | "rally";
/** How a character sits / stands at a point of interest (map.ts `PoiPose`). */
export type SpotPose = "stand" | "sit" | "sitBack" | "play";

// ---- tuning ---------------------------------------------------------------------------------
/** seconds of the jump between the floor and the saddle (characters.ts HOP_S is 0.35) */
export const MOUNT_HOP_S = 0.36;
/** px the hop arcs above the straight line between start and end */
export const MOUNT_HOP_H = 7;
/** riding is a bit faster than walking (× walking speed): horse trot, frog hops, shark swims */
export const RIDE_SPEED: Record<Mount, number> = { horse: 1.35, frog: 1.15, shark: 1.25 };
/** running for the hourly bow is already fast: riding adds only a little */
export const RIDE_RUN = 1.1;
/** about one trip in four the character walks the animal on a lead instead of riding it */
export const LEAD_CHANCE = 0.25;
/** px a led animal walks behind the character, measured along the trail (~1.5 tiles: rope + body) */
export const LEAD_GAP: Record<Mount, number> = { horse: 28, frog: 22, shark: 24 };
/** a led animal catching up walks at most this × walking speed */
export const LEAD_CATCH_UP = 1.6;
/** px a hopping-off rider's animal steps back along the trail (clears the spot for the rider) */
export const STEP_BACK: Record<Mount, number> = { horse: 22, frog: 17, shark: 19 };
/** arriving at a spot to stand at: pet the animal / stay up in the saddle */
export const PET_ON_ARRIVAL = 0.35;
export const STAY_ON_ARRIVAL = 0.15;
/** standing around at a spot: every so many seconds a chance to pet it again */
export const PET_IDLE_EVERY_S = 7;
export const PET_IDLE_CHANCE = 0.2;
/** how long a petting lasts and when its hearts float up */
export const PET_S = 2.6;
export const PET_HEARTS_AT: readonly number[] = [0.35, 0.95, 1.55];
/** after petting: hop back on (else stay off and stand by) */
export const REMOUNT_AFTER_PET = 0.35;
/** px beside the character where a petted animal stands */
export const PET_SIDE: Record<Mount, number> = { horse: 20, frog: 15, shark: 17 };
/** farther than this from its rider an animal is brought over in a puff instead of hopped onto */
export const HOP_REACH = 30;
/** parked at the desk: px below the seat (on the pod mat, behind the chair) */
export const PARK_BEHIND = 17;
/** parked, it rests for a while, then stands up and looks around for a bit */
export const PARK_REST_S: readonly [number, number] = [9, 20];
export const PARK_IDLE_S: readonly [number, number] = [2, 4.5];

// ---- decisions ------------------------------------------------------------------------------
export type TripStyle = "ride" | "lead";

/**
 * Ride or lead for a trip. Re-routed trips (a new path while already walking) keep their
 * style; hurried trips (the bow, a fire alarm, going home) always ride.
 */
export function tripStyle(
  goal: TripGoal,
  fromStandstill: boolean,
  current: TripStyle | null,
  r: number,
): TripStyle {
  if (goal === "rally" || goal === "evac" || goal === "exit") return "ride";
  if (!fromStandstill && current) return current;
  return r < LEAD_CHANCE ? "lead" : "ride";
}

/**
 * What happens on arrival: `park` (desk: hop off, it lies down beside the chair), `stay`
 * (keep riding), `stand` (hop off, it stands by) or `pet` (hop off and pet it).
 */
export type ArrivalPlan = "park" | "stay" | "stand" | "pet";

export function arrivalPlan(
  goal: TripGoal,
  pose: SpotPose | null,
  mounted: boolean,
  r: number,
): ArrivalPlan {
  if (goal === "desk") return "park";
  // in the bow line / outside at the fire alarm: wait in the saddle (moving up the line stays smooth)
  if (goal === "rally" || goal === "evac" || goal === "exit") return mounted ? "stay" : "stand";
  if (goal === "chat") return "stand";
  // sofas, stools, the arcade: only from the floor
  if (pose && pose !== "stand") return "stand";
  if (r < PET_ON_ARRIVAL) return "pet";
  if (mounted && r < PET_ON_ARRIVAL + STAY_ON_ARRIVAL) return "stay";
  return "stand";
}

/** Standing by at a spot: time to pet it again? (only standing up, not mid-conversation) */
export function idlePet(pose: SpotPose | null, busy: boolean, r: number): boolean {
  return !busy && (pose ?? "stand") === "stand" && r < PET_IDLE_CHANCE;
}

/** Seconds and animation of the next parked phase. */
export function parkPhase(resting: boolean, r: number): { anim: "rest" | "idle"; seconds: number } {
  // after resting comes a short look around, after that rest again
  const [lo, hi] = resting ? PARK_IDLE_S : PARK_REST_S;
  return { anim: resting ? "idle" : "rest", seconds: lo + r * (hi - lo) };
}

// ---- places ---------------------------------------------------------------------------------
export type Spot = Point & { facing: Facing };

/**
 * Where an animal parks while its rider works: on the pod mat right behind the chair (never
 * over the desk, which is above the seat, and clear of the aisle, which is a tile further
 * down), facing the camera so neighbours at a 24 px desk pitch don't overlap. Falls back to
 * beside the chair when that floor is taken by something solid.
 */
export function parkSpot(seat: Point, walkable: (tx: number, ty: number) => boolean): Spot {
  const cands: Spot[] = [
    { x: seat.x, y: seat.y + PARK_BEHIND, facing: "down" },
    { x: seat.x + 18, y: seat.y + 4, facing: "left" },
    { x: seat.x - 18, y: seat.y + 4, facing: "right" },
  ];
  for (const c of cands) if (walkable(Math.floor(c.x / 16), Math.floor((c.y - 2) / 16))) return c;
  return cands[0]!;
}

/** Beside the character for petting: the preferred side first, then the other; null if neither. */
export function petSpot(
  kind: Mount,
  at: Point,
  prefer: 1 | -1,
  walkable: (tx: number, ty: number) => boolean,
): Spot | null {
  for (const side of [prefer, -prefer]) {
    const x = at.x + side * PET_SIDE[kind];
    if (walkable(Math.floor(x / 16), Math.floor((at.y - 2) / 16)))
      return { x, y: at.y, facing: side > 0 ? "left" : "right" };
  }
  return null;
}

/** Facing from a direction (ties go sideways, like characters.ts). */
export function faceToward(dx: number, dy: number): Facing {
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

// ---- motion ---------------------------------------------------------------------------------
/**
 * Hop progress u (0..1) -> how far along (eased) and how high above the line (px).
 * Writes into `out` (no allocation per frame).
 */
export function hopArc(u: number, out: { k: number; lift: number }): { k: number; lift: number } {
  const t = Math.max(0, Math.min(1, u));
  out.k = t * t * (3 - 2 * t);
  out.lift = Math.sin(t * Math.PI) * MOUNT_HOP_H;
  return out;
}

/** Move `pos` up to `step` px toward (tx, ty); returns the distance still left. */
export function stepToward(pos: Point, tx: number, ty: number, step: number): number {
  const dx = tx - pos.x;
  const dy = ty - pos.y;
  const d = Math.hypot(dx, dy);
  if (d <= step || d < 1e-6) {
    pos.x = tx;
    pos.y = ty;
    return 0;
  }
  pos.x += (dx / d) * step;
  pos.y += (dy / d) * step;
  return d - step;
}

/**
 * Breadcrumbs of where a character walked (fixed-size ring buffer, no allocation after
 * construction). A led animal walks a fixed distance behind along it, so it takes the same
 * way round desks and through doors and never needs its own path.
 */
export class Trail {
  private readonly xs: Float32Array;
  private readonly ys: Float32Array;
  private head = -1;
  private n = 0;

  constructor(
    readonly capacity = 48,
    /** px between crumbs */
    readonly spacing = 3,
  ) {
    this.xs = new Float32Array(capacity);
    this.ys = new Float32Array(capacity);
  }

  get length(): number {
    return this.n;
  }

  reset(x: number, y: number): void {
    this.n = 0;
    this.head = -1;
    this.add(x, y);
  }

  /** The character's position this frame: a new crumb once it moved `spacing` px. */
  push(x: number, y: number): void {
    if (this.n === 0) {
      this.add(x, y);
      return;
    }
    const d = Math.hypot(x - this.xs[this.head]!, y - this.ys[this.head]!);
    if (d >= this.spacing) this.add(x, y);
  }

  private add(x: number, y: number): void {
    this.head = (this.head + 1) % this.capacity;
    this.xs[this.head] = x;
    this.ys[this.head] = y;
    if (this.n < this.capacity) this.n++;
  }

  /**
   * The point `dist` px behind (x, y) (the character now) along the crumbs; the oldest crumb
   * when the trail is shorter. Writes into `out`.
   */
  sample(x: number, y: number, dist: number, out: Point): Point {
    let px = x;
    let py = y;
    let left = dist;
    for (let i = 0; i < this.n; i++) {
      const j = (this.head - i + this.capacity) % this.capacity;
      const cx = this.xs[j]!;
      const cy = this.ys[j]!;
      const seg = Math.hypot(cx - px, cy - py);
      if (seg >= left && seg > 0) {
        const k = left / seg;
        out.x = px + (cx - px) * k;
        out.y = py + (cy - py) * k;
        return out;
      }
      left -= seg;
      px = cx;
      py = cy;
    }
    out.x = px;
    out.y = py;
    return out;
  }
}

// ---- dev ------------------------------------------------------------------------------------
const DEV_COLORS: Record<Mount, readonly string[]> = {
  horse: ["#8a5a3b", "#e8dcc8", "#3a2a22", "#b7793f"],
  frog: ["#5fb34a", "#8bc34a", "#3e8e5a", "#c9b33a"],
  shark: ["#7d8ea3", "#5e7187", "#a3b4c4", "#4a6a8a"],
};
const DEV_KINDS: readonly Mount[] = ["horse", "frog", "shark"];

/**
 * `?mounts=horse|frog|shark|mixed` (dev): the animal a person rides on this screen, whatever
 * their look says. Null for anything else (the look decides).
 */
export function devMount(
  param: string | null,
  hash: number,
): { kind: Mount; color: string } | null {
  if (!param) return null;
  const h = Math.abs(hash);
  const kind: Mount | null =
    param === "mixed"
      ? DEV_KINDS[h % DEV_KINDS.length]!
      : (DEV_KINDS as readonly string[]).includes(param)
        ? (param as Mount)
        : null;
  if (!kind) return null;
  const colors = DEV_COLORS[kind];
  return { kind, color: colors[Math.floor(h / 3) % colors.length]! };
}
