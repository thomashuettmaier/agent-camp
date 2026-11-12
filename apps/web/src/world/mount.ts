/**
 * Rideable animals (RA1) in the office: the horse, frog or shark of a session character
 * (`look.accessories.mount`). One `MountCompanion` per character with a mount; the character
 * manager calls `update` every frame right before it places the character's sprite.
 *
 *   ride   the character sits in the saddle (RIDE_POSE at riderAnchor), the animal walks
 *   lead   now and then a trip on foot: the animal follows ~1 tile behind on the character's
 *          breadcrumbs (never through walls, no pathfinding of its own), on a sagging rope
 *   stand  hopped off at a spot: it stands by, facing its human
 *   pet    hop off, face it, stroke it: it plays `happy`, hearts float up
 *   park   the character works at the desk: it lies on the pod mat behind the chair (`rest`),
 *          now and then stands up and looks around (`idle`)
 *
 * Getting on and off is a short jump (MOUNT_HOP_S) between the floor and the saddle. The
 * decisions and numbers live in mountRules.ts (pure, tested). The sprites (`back` behind the
 * rider, `front` over the rider's legs) sort by the animal's y like every other actor; while
 * someone rides they sandwich the rider. Textures are shared per kind + colour (mountSheet).
 */
import type { MountKind } from "@agent-office/protocol";
import { type Container, Graphics, Sprite } from "pixi.js";
import type { AnimName } from "../art/characters.ts";
import {
  leadPoint,
  MOUNT_ANIMS,
  MOUNT_FACINGS,
  MOUNT_FRAME_S,
  MOUNT_FRAMES,
  type Mount,
  type MountAnim,
  type MountFacing,
  type MountSheet,
  mountSheet,
  type Offset,
  RIDE_POSE,
  releaseMountSheet,
  riderAnchor,
} from "../art/mounts.ts";
import type { SessionCharacter } from "./characters.ts";
import {
  arrivalPlan,
  faceToward,
  HOP_REACH,
  hopArc,
  idlePet,
  LEAD_CATCH_UP,
  LEAD_GAP,
  MOUNT_HOP_S,
  PET_HEARTS_AT,
  PET_IDLE_EVERY_S,
  PET_S,
  parkPhase,
  parkSpot,
  petSpot,
  REMOUNT_AFTER_PET,
  RIDE_RUN,
  RIDE_SPEED,
  type Spot,
  type SpotPose,
  STEP_BACK,
  stepToward,
  Trail,
  type TripGoal,
  type TripStyle,
  tripStyle,
} from "./mountRules.ts";

export type MountSpec = { kind: Mount; color: string };

/** The mount of a look (null: none). */
export function mountOfLook(
  mount: { kind: MountKind; color: string } | undefined,
): MountSpec | null {
  if (!mount || mount.kind === "none") return null;
  return { kind: mount.kind, color: mount.color };
}

/** What a companion needs from the office (the character manager implements it once). */
export type MountWorld = {
  layer(): Container;
  walkable(tx: number, ty: number): boolean;
  /** the seat of the character's desk, null while roaming without one */
  seat(c: SessionCharacter): { x: number; y: number } | null;
  offline(c: SessionCharacter): boolean;
  /** px per second a character walks */
  walkSpeed: number;
  puff(x: number, y: number): void;
  floater(x: number, y: number): void;
};

export type MountState = "ride" | "lead" | "stand" | "pet" | "park";

const STAND: Record<MountFacing, AnimName> = {
  down: "idleDown",
  up: "idleUp",
  left: "idleLeft",
  right: "idleRight",
};
/** hemp: reads on the dark carpets and the light floors */
const ROPE = 0xd2a86a;
/** reused fill style of the rope (alpha changes) */
const ROPE_FILL = { color: ROPE, alpha: 1 };
const OFFLINE_TINT = 0x5a6988;

// riderAnchor / leadPoint are pure per (kind, facing, anim, frame): look them up from tables
// built once per kind instead of allocating an offset every frame
type OffsetTable = Record<MountFacing, Record<MountAnim, Offset[]>>;
const anchorTables = new Map<Mount, { rider: OffsetTable; lead: OffsetTable }>();
function tablesOf(kind: Mount) {
  let t = anchorTables.get(kind);
  if (t) return t;
  const build = (fn: typeof riderAnchor): OffsetTable => {
    const out = {} as OffsetTable;
    for (const f of MOUNT_FACINGS) {
      out[f] = {} as Record<MountAnim, Offset[]>;
      for (const a of MOUNT_ANIMS)
        out[f][a] = Array.from({ length: MOUNT_FRAMES[a] }, (_, i) => fn(kind, f, a, i));
    }
    return out;
  };
  t = { rider: build(riderAnchor), lead: build(leadPoint) };
  anchorTables.set(kind, t);
  return t;
}

export class MountCompanion {
  spec: MountSpec;
  private sheet: MountSheet;
  private tables: { rider: OffsetTable; lead: OffsetTable };
  readonly back: Sprite;
  readonly front: Sprite;
  private readonly rope = new Graphics();
  /** the animal's anchor (bottom-centre, on the floor) */
  readonly pos = { x: 0, y: 0 };
  facing: MountFacing = "down";
  anim: MountAnim = "idle";
  private animT = 0;
  private frame = 0;
  state: MountState = "ride";
  /** where it walks on its own (stepping back, to the desk, beside its human), if anywhere */
  private target: Spot | null = null;
  private readonly trail = new Trail();
  private readonly tmp = { x: 0, y: 0 };
  private readonly arc = { k: 0, lift: 0 };
  /** jump between floor and saddle: seconds left, direction, where the rider took off */
  private hopT = 0;
  private hopOn = false;
  private hopX = 0;
  private hopY = 0;
  private prevMode = "";
  private prevPath: unknown = null;
  private tripGoal: TripGoal = "desk";
  private petT = -1;
  private petCheck = PET_IDLE_EVERY_S;
  private savedFacing: SessionCharacter["facing"] = "down";
  private parkT = 0;
  private resting = false;
  private parkAt: { x: number; y: number } | null = null;
  private fade = 1;
  private destroyed = false;

  constructor(
    spec: MountSpec,
    private readonly world: MountWorld,
    private readonly rand: () => number,
  ) {
    this.spec = spec;
    this.sheet = mountSheet(spec.kind, spec.color);
    this.tables = tablesOf(spec.kind);
    this.back = new Sprite(this.sheet.back.down.idle[0]!);
    this.front = new Sprite(this.sheet.front.down.idle[0]!);
    for (const s of [this.back, this.front]) {
      s.anchor.set(0.5, 1);
      // "actor": kept when the office rebuilds (office.ts)
      s.label = "actor";
      s.eventMode = "none";
    }
    this.rope.label = "actor";
    this.rope.eventMode = "none";
    this.rope.visible = false;
    world.layer().addChild(this.back, this.front, this.rope);
  }

  /** Rider currently in the saddle (or jumping into it). */
  get mounted(): boolean {
    return this.state === "ride";
  }

  /** Start out in a state that fits what the character is doing right now (spawn / look change). */
  attach(c: SessionCharacter, appear: boolean) {
    this.prevMode = c.mode;
    this.prevPath = c.path;
    this.tripGoal = (c.goal as TripGoal | null) ?? "desk";
    if (c.mode === "seated" || c.mode === "waving" || c.mode === "carried") {
      this.enterPark(c, true);
    } else if (c.mode === "poi") {
      const spot = petSpot(this.spec.kind, c, this.rand() < 0.5 ? 1 : -1, this.world.walkable);
      this.pos.x = spot?.x ?? c.x;
      this.pos.y = spot?.y ?? c.y + 4;
      this.state = "stand";
    } else {
      this.pos.x = c.x;
      this.pos.y = c.y;
      this.state = "ride";
      this.facing = c.facing;
    }
    this.trail.reset(c.x, c.y);
    if (appear && c.sprite.visible) this.world.puff(this.pos.x, this.pos.y - 8);
  }

  /** A new colour or another animal (avatar.updated): same state, new textures. */
  setSpec(spec: MountSpec) {
    if (spec.kind === this.spec.kind && spec.color === this.spec.color) return;
    const old = this.sheet;
    this.spec = spec;
    this.sheet = mountSheet(spec.kind, spec.color);
    this.tables = tablesOf(spec.kind);
    this.applyTextures();
    releaseMountSheet(old);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    const layer = this.back.parent;
    layer?.removeChild(this.back, this.front, this.rope);
    this.back.destroy();
    this.front.destroy();
    this.rope.destroy();
    releaseMountSheet(this.sheet);
  }

  /** The rider got off for good (mount removed from the look): clear what it set on them. */
  static clearRider(c: SessionCharacter) {
    c.lift = 0;
    c.rideDx = 0;
    c.ridePose = null;
    c.holdWalk = false;
    c.speedK = 1;
  }

  // ---- per frame ----------------------------------------------------------------------------
  update(c: SessionCharacter, dt: number) {
    if (this.destroyed) return;
    // waiting at the door / blown up and about to walk back in: hidden, saddled up at the door
    if (c.mode === "queued" || (!c.sprite.visible && c.mode !== "zapped")) {
      this.hide();
      MountCompanion.clearRider(c);
      if (c.mode === "queued") {
        this.state = "ride";
        this.hopT = 0;
        this.pos.x = c.x;
        this.pos.y = c.y;
        this.trail.reset(c.x, c.y);
      }
      this.prevMode = c.mode;
      this.prevPath = c.path;
      return;
    }
    if (c.mode === "zapped") {
      // fried at the desk: the animal bolts in a puff (the character's remains take over)
      if (this.fade === 1) this.world.puff(this.pos.x, this.pos.y - 8);
      this.fade = Math.max(0, this.fade - dt * 2.5);
      MountCompanion.clearRider(c);
      this.rope.visible = false;
      this.draw(c);
      return;
    }

    const walking = c.mode === "walking";
    if (walking) {
      const fresh = this.prevMode !== "walking";
      if (fresh || c.path !== this.prevPath) this.startTrip(c, fresh);
      this.tripGoal = (c.goal as TripGoal | null) ?? this.tripGoal;
    } else if (this.prevMode === "walking") {
      this.arrive(c);
    }
    this.prevMode = c.mode;
    this.prevPath = c.path;
    // at the desk (also teleported there, carried around, waving goodbye): parked
    if (
      (c.mode === "seated" || c.mode === "carried" || c.mode === "waving") &&
      this.state !== "park"
    )
      this.enterPark(c, false);

    // defaults for the rider; the states below override
    c.ridePose = null;
    c.ridePoseFps = 1;
    c.lift = 0;
    c.rideDx = 0;
    c.speedK = 1;
    c.holdWalk = false;

    let moved = false;
    switch (this.state) {
      case "ride":
        moved = this.rideStep(c);
        break;
      case "lead":
        moved = this.leadStep(c, dt);
        break;
      case "stand":
        moved = this.standStep(c, dt);
        break;
      case "pet":
        moved = this.petStep(c, dt);
        break;
      case "park":
        moved = this.parkStep(c, dt);
        break;
    }
    if (this.hopT > 0) this.hopStep(c, dt);
    if (this.state !== "park")
      this.setAnim(moved ? "walk" : this.anim === "happy" ? "happy" : "idle");
    this.animT += dt;
    this.frame = Math.floor(this.animT / MOUNT_FRAME_S[this.anim]) % MOUNT_FRAMES[this.anim];
    this.draw(c);
  }

  private setAnim(a: MountAnim) {
    if (a === this.anim) return;
    this.anim = a;
    this.animT = 0;
  }

  /** Walk toward the target (if any) at walking speed; true while moving. */
  private walkToTarget(dt: number, speedK = 1): boolean {
    const t = this.target;
    if (!t) return false;
    const ox = this.pos.x;
    const oy = this.pos.y;
    const left = stepToward(this.pos, t.x, t.y, this.world.walkSpeed * speedK * dt);
    const dx = this.pos.x - ox;
    const dy = this.pos.y - oy;
    if (Math.abs(dx) + Math.abs(dy) > 0.01) this.facing = faceToward(dx, dy);
    if (left > 0) return true;
    this.facing = t.facing;
    this.target = null;
    return Math.abs(dx) + Math.abs(dy) > 0.01;
  }

  private faceRider(c: SessionCharacter) {
    const dx = c.x - this.pos.x;
    const dy = c.y - this.pos.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) this.facing = faceToward(dx, dy);
  }

  // ---- trips --------------------------------------------------------------------------------
  private startTrip(c: SessionCharacter, fromStandstill: boolean) {
    if (this.state === "pet") this.endPet(c, false);
    const goal = (c.goal as TripGoal | null) ?? "poi";
    const current: TripStyle | null =
      this.state === "ride" ? "ride" : this.state === "lead" ? "lead" : null;
    const style = tripStyle(goal, fromStandstill, current, this.rand());
    this.target = null;
    if (style === "ride") {
      if (this.state !== "ride") this.mountUp(c);
      return;
    }
    if (this.state === "ride") {
      // off the saddle first, onto the floor a step along the way
      const next = c.path[0];
      let lx = c.x;
      let ly = c.y + 2;
      if (next) {
        const d = Math.hypot(next.x - c.x, next.y - c.y);
        const k = d > 0 ? Math.min(1, 14 / d) : 0;
        lx = c.x + (next.x - c.x) * k;
        ly = c.y + (next.y - c.y) * k;
      }
      this.hopOff(c, lx, ly);
    }
    this.state = "lead";
    this.trail.reset(this.pos.x, this.pos.y);
    this.trail.push(c.x, c.y);
  }

  private arrive(c: SessionCharacter) {
    const seated = c.mode === "seated";
    const pose: SpotPose | null =
      c.mode === "poi" ? ((c.poi?.pose as SpotPose | undefined) ?? "stand") : null;
    const plan = seated
      ? "park"
      : arrivalPlan(this.tripGoal, pose, this.state === "ride", this.rand());
    if (plan === "park") {
      this.enterPark(c, false);
      return;
    }
    if (plan === "stay") {
      if (this.state !== "ride") this.state = "stand";
      return;
    }
    const wasRiding = this.state === "ride";
    if (wasRiding) {
      // the animal steps back along the way they came, the rider jumps down onto the spot
      this.trail.sample(c.x, c.y, STEP_BACK[this.spec.kind], this.tmp);
      this.target = {
        x: this.tmp.x,
        y: this.tmp.y,
        facing: faceToward(c.x - this.tmp.x, c.y - this.tmp.y),
      };
      this.hopOff(c, c.x, c.y);
    }
    if (plan === "pet") this.beginPet(c);
    else this.state = "stand";
    this.petCheck = PET_IDLE_EVERY_S;
  }

  /** Jump into the saddle (the animal is brought over first if it is too far away). */
  private mountUp(c: SessionCharacter) {
    const fromX = c.x + c.rideDx;
    const fromY = c.y - c.lift;
    if (Math.hypot(this.pos.x - c.x, this.pos.y - c.y) > HOP_REACH) {
      this.world.puff(this.pos.x, this.pos.y - 8);
      this.pos.x = c.x;
      this.pos.y = c.y + 1;
      this.world.puff(this.pos.x, this.pos.y - 8);
    }
    // the character's spot becomes the animal's; the sprite jumps over from where it stood
    c.x = this.pos.x;
    c.y = this.pos.y;
    this.state = "ride";
    this.target = null;
    this.hopOn = true;
    this.hopT = MOUNT_HOP_S;
    this.hopX = fromX;
    this.hopY = fromY;
    this.trail.reset(c.x, c.y);
  }

  /** Jump down to (x, y), which becomes the character's spot. */
  private hopOff(c: SessionCharacter, x: number, y: number) {
    const a = this.tables.rider[this.facing][this.anim][this.frame] ?? { x: 0, y: 0 };
    this.hopX = this.pos.x + a.x;
    this.hopY = this.pos.y + a.y;
    c.x = x;
    c.y = y;
    this.hopOn = false;
    this.hopT = MOUNT_HOP_S;
    // no longer riding: whatever state comes next sets it
    if (this.state === "ride") this.state = "stand";
  }

  /** Where the rider's sprite is mid-jump, relative to the character's spot. */
  private hopStep(c: SessionCharacter, dt: number) {
    this.hopT = Math.max(0, this.hopT - dt);
    hopArc(1 - this.hopT / MOUNT_HOP_S, this.arc);
    let ex = c.x;
    let ey = c.y;
    if (this.hopOn) {
      const a = this.tables.rider[this.facing][this.anim][this.frame] ?? { x: 0, y: 0 };
      ex = this.pos.x + a.x;
      ey = this.pos.y + a.y;
    }
    const vx = this.hopX + (ex - this.hopX) * this.arc.k;
    const vy = this.hopY + (ey - this.hopY) * this.arc.k - this.arc.lift;
    c.rideDx = vx - c.x;
    c.lift = c.y - vy;
    c.ridePose = STAND[(c.facing as MountFacing) ?? "down"];
    if (c.mode === "walking") c.holdWalk = this.hopT > 0;
  }

  // ---- states -------------------------------------------------------------------------------
  private rideStep(c: SessionCharacter): boolean {
    const walking = c.mode === "walking";
    if (this.hopT <= 0 || !this.hopOn) {
      this.pos.x = c.x;
      this.pos.y = c.y;
    }
    this.facing = c.facing;
    this.trail.push(c.x, c.y);
    if (this.hopT > 0) return false;
    c.speedK = c.rally ? RIDE_RUN : RIDE_SPEED[this.spec.kind];
    const a = this.tables.rider[this.facing][this.anim][this.frame] ?? { x: 0, y: 0 };
    c.rideDx = a.x;
    c.lift = -a.y;
    c.ridePose = RIDE_POSE[this.facing];
    return walking;
  }

  private leadStep(c: SessionCharacter, dt: number): boolean {
    this.trail.push(c.x, c.y);
    this.trail.sample(c.x, c.y, LEAD_GAP[this.spec.kind], this.tmp);
    const ox = this.pos.x;
    const oy = this.pos.y;
    stepToward(this.pos, this.tmp.x, this.tmp.y, this.world.walkSpeed * LEAD_CATCH_UP * dt);
    const dx = this.pos.x - ox;
    const dy = this.pos.y - oy;
    const moved = Math.abs(dx) + Math.abs(dy) > 0.02;
    if (moved) this.facing = faceToward(dx, dy);
    else this.faceRider(c);
    return moved;
  }

  private standStep(c: SessionCharacter, dt: number): boolean {
    const moved = this.walkToTarget(dt);
    if (!moved && !this.target && this.hopT <= 0) this.faceRider(c);
    if (c.mode !== "poi" || this.hopT > 0) return moved;
    this.petCheck -= dt;
    if (this.petCheck <= 0) {
      this.petCheck = PET_IDLE_EVERY_S;
      const pose = (c.poi?.pose as SpotPose | undefined) ?? "stand";
      if (idlePet(pose, !!c.chat || !!c.chatTarget || c.rally || c.evac, this.rand()))
        this.beginPet(c);
    }
    return moved;
  }

  private beginPet(c: SessionCharacter) {
    this.state = "pet";
    this.petT = -1;
    const spot = petSpot(this.spec.kind, c, this.pos.x >= c.x ? 1 : -1, this.world.walkable);
    if (spot) this.target = spot;
  }

  private petStep(c: SessionCharacter, dt: number): boolean {
    if (c.mode !== "poi") {
      this.endPet(c, false);
      return false;
    }
    if (this.hopT > 0 || this.target) {
      const moved = this.walkToTarget(dt);
      if (this.target || this.hopT > 0) return moved;
    }
    if (this.petT < 0) {
      this.petT = 0;
      this.savedFacing = c.facing;
    }
    const before = this.petT;
    this.petT += dt;
    this.faceRider(c);
    this.setAnim("happy");
    const dx = this.pos.x - c.x;
    const dy = this.pos.y - c.y;
    c.facing = faceToward(dx, dy);
    // stroke: back to the camera the arms move (play), else a little lean toward it
    const stroke = Math.floor(this.petT * 4) % 2;
    if (c.facing === "up") {
      c.ridePose = "play";
      c.ridePoseFps = 4;
    } else {
      c.ridePose = STAND[c.facing];
      if (c.facing === "left") c.rideDx = -stroke;
      else if (c.facing === "right") c.rideDx = stroke;
      else c.lift = -stroke;
    }
    const lp = this.tables.lead[this.facing][this.anim][this.frame] ?? { x: 0, y: -10 };
    for (let i = 0; i < PET_HEARTS_AT.length; i++) {
      const at = PET_HEARTS_AT[i]!;
      if (before < at && this.petT >= at)
        this.world.floater(this.pos.x + lp.x + (i - 1) * 3, this.pos.y + lp.y - 2);
    }
    if (this.petT >= PET_S) this.endPet(c, true);
    return false;
  }

  /** Done petting (or interrupted): stand by, or now and then hop back on. */
  private endPet(c: SessionCharacter, done: boolean) {
    this.petT = -1;
    this.anim = "idle";
    this.animT = 0;
    this.state = "stand";
    this.target = null;
    if (!done || c.mode !== "poi") return;
    c.facing = this.savedFacing;
    const pose = (c.poi?.pose as SpotPose | undefined) ?? "stand";
    if (pose === "stand" && !c.chat && this.rand() < REMOUNT_AFTER_PET) this.mountUp(c);
  }

  private enterPark(c: SessionCharacter, instant: boolean) {
    if (this.state === "pet") this.endPet(c, false);
    const seat = this.world.seat(c) ?? { x: c.x, y: c.y };
    const spot = parkSpot(seat, this.world.walkable);
    this.parkAt = { x: seat.x, y: seat.y };
    if (this.state === "ride" && !instant) this.hopOff(c, c.x, c.y);
    this.state = "park";
    this.resting = false;
    this.parkT = 0;
    if (instant) {
      this.pos.x = spot.x;
      this.pos.y = spot.y;
      this.facing = spot.facing;
      this.target = null;
      this.setAnim("rest");
      this.resting = true;
      this.parkT = parkPhase(false, this.rand()).seconds;
    } else this.target = spot;
  }

  private parkStep(c: SessionCharacter, dt: number): boolean {
    // the desk moved (pod rebuilt, desk swap): park at the new one
    const seat = this.world.seat(c);
    if (seat && this.parkAt && (seat.x !== this.parkAt.x || seat.y !== this.parkAt.y)) {
      const spot = parkSpot(seat, this.world.walkable);
      this.parkAt = { x: seat.x, y: seat.y };
      if (Math.hypot(spot.x - this.pos.x, spot.y - this.pos.y) > 64) {
        this.world.puff(this.pos.x, this.pos.y - 8);
        this.pos.x = spot.x;
        this.pos.y = spot.y;
        this.facing = spot.facing;
        this.target = null;
      } else this.target = spot;
    }
    if (this.target) {
      const moved = this.walkToTarget(dt);
      this.setAnim(moved ? "walk" : "idle");
      if (this.target) return moved;
    }
    this.parkT -= dt;
    if (this.parkT <= 0) {
      const next = parkPhase(this.resting, this.rand());
      this.resting = next.anim === "rest";
      this.parkT = next.seconds;
      this.setAnim(next.anim);
    }
    return false;
  }

  // ---- drawing ------------------------------------------------------------------------------
  private hide() {
    this.back.visible = false;
    this.front.visible = false;
    this.rope.visible = false;
  }

  private applyTextures() {
    const f = Math.min(this.frame, MOUNT_FRAMES[this.anim] - 1);
    const b = this.sheet.back[this.facing][this.anim][f]!;
    const fr = this.sheet.front[this.facing][this.anim][f]!;
    if (this.back.texture !== b) this.back.texture = b;
    if (this.front.texture !== fr) this.front.texture = fr;
  }

  private draw(c: SessionCharacter) {
    this.applyTextures();
    const x = Math.round(this.pos.x);
    const y = Math.round(this.pos.y);
    this.back.position.set(x, y);
    this.front.position.set(x, y);
    // riding (or jumping on / off): the rider sits between the two layers
    const z = this.state === "ride" || this.hopT > 0 ? c.y : this.pos.y;
    this.back.zIndex = z - 0.05;
    this.front.zIndex = z + 0.05;
    const off = this.world.offline(c);
    const tint = off ? OFFLINE_TINT : 0xffffff;
    const alpha = (off ? 0.6 : 1) * this.fade;
    this.back.visible = true;
    this.front.visible = true;
    this.back.tint = tint;
    this.front.tint = tint;
    this.back.alpha = alpha;
    this.front.alpha = alpha;
    this.drawRope(c, alpha);
  }

  /** The lead: from the character's hand to the animal's halter, sagging when slack. */
  private drawRope(c: SessionCharacter, alpha: number) {
    const g = this.rope;
    if (this.state !== "lead" || this.hopT > 0) {
      if (g.visible) {
        g.clear();
        g.visible = false;
      }
      return;
    }
    const lp = this.tables.lead[this.facing][this.anim][this.frame] ?? { x: 0, y: -10 };
    const lx = this.pos.x + lp.x;
    const ly = this.pos.y + lp.y;
    // the hand on the animal's side
    const side = c.facing === "left" ? -1 : c.facing === "right" ? 1 : lx >= c.x ? 1 : -1;
    const hx = c.x + side * 5;
    const hy = c.y - 10;
    const len = Math.hypot(lx - hx, ly - hy);
    const sag = Math.max(1, Math.min(6, 7 - len * 0.2));
    const cx = (hx + lx) / 2;
    const cy = (hy + ly) / 2 + sag * 2;
    g.clear();
    const n = Math.max(2, Math.ceil(len));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      const px = u * u * hx + 2 * u * t * cx + t * t * lx;
      const py = u * u * hy + 2 * u * t * cy + t * t * ly;
      g.rect(Math.round(px), Math.round(py), 1, 1);
    }
    ROPE_FILL.alpha = alpha;
    g.fill(ROPE_FILL);
    g.zIndex = Math.max(c.y, this.pos.y) + 0.3;
    g.visible = true;
  }
}
