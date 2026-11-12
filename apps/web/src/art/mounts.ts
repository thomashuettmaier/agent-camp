/**
 * Rideable animals (RA1): the horse, the frog and the shark a character can ride through the
 * office (`look.accessories.mount`). Not part of the character sheet: a mount is its own pair
 * of sprites, `back` (drawn behind the rider) and `front` (drawn over the rider, hiding the
 * legs, e.g. the horse's near flank, the frog's front legs, the shark's water ripple).
 *
 * Every frame is a MOUNT_BOX-sized HD frame (2 texels per world px, like character sheets),
 * anchored bottom-centre (0.5, 1) where the animal stands on the floor, with its own soft floor
 * shadow (the shark brings its puddle instead). The rider is a normal character sprite in its
 * RIDE_POSE frame, anchored at `riderAnchor`: its hip sits on the saddle / cushion / back and
 * `front` covers everything from the hip down, so riders read as seated without a riding frame.
 *
 * This file is the public entry the office (world/mount.ts) and the studio build on; the art
 * lives per animal in art/mounts/ (horse.ts, frog.ts, shark.ts) on a small painting kit
 * (kit.ts). Preview every frame with `bun apps/web/scripts/mount-grid.ts out.png horse`.
 */
import type { MountKind } from "@agent-office/protocol";
import { CanvasSource, Rectangle, Texture } from "pixi.js";
import { RefCache } from "./avatar/refCache.ts";
import {
  ANIM,
  type AnimName,
  CHAR_H,
  CHAR_RES,
  CHAR_W,
  lookPreview,
  type RenderLook,
} from "./characters.ts";
import { frog } from "./mounts/frog.ts";
import { horse } from "./mounts/horse.ts";
import { type MountArt, Painter, type View } from "./mounts/kit.ts";
import { shark } from "./mounts/shark.ts";
import type { PixelCanvas } from "./pixel.ts";

/** A mount that is actually there. */
export type Mount = Exclude<MountKind, "none">;
export type MountFacing = "down" | "up" | "left" | "right";
/**
 * idle: standing (horse tail swish, frog throat pulse, shark bobbing) · walk: moving (horse
 * trot, frog hop, shark swim) · happy: being petted (nuzzle, croak, roll + splash) · rest:
 * parked while its rider works at the desk (horse lying down, frog flat with sleepy eyes, shark
 * submerged with only fin and eyes showing)
 */
export type MountAnim = "idle" | "walk" | "happy" | "rest";
export const MOUNT_ANIMS: readonly MountAnim[] = ["idle", "walk", "happy", "rest"];
export const MOUNT_FACINGS: readonly MountFacing[] = ["down", "up", "left", "right"];
/** frames per animation (the same for every mount and facing) */
export const MOUNT_FRAMES: Record<MountAnim, number> = { idle: 2, walk: 4, happy: 2, rest: 2 };
/** seconds per frame (walk: one trot step / hop phase / swim stroke) */
export const MOUNT_FRAME_S: Record<MountAnim, number> = {
  idle: 0.6,
  walk: 0.14,
  happy: 0.25,
  rest: 0.8,
};

/** A good-looking default body colour per animal (bay horse, green frog, grey-blue shark). */
export const DEFAULT_MOUNT_COLOR: Record<Mount, string> = {
  horse: "#b86f50",
  frog: "#63c74d",
  shark: "#5a6988",
};

/** Size of one mount frame in world px (anchor bottom-centre). */
export const MOUNT_BOX = { w: 44, h: 32 } as const;
/** texels per world px */
export const MOUNT_RES = CHAR_RES;
/**
 * Height of `mountPreview` in world px: the highest rider anchor of any mount and frame plus a
 * full character frame (hats included), so the preview never clips and does not jump.
 */
export const MOUNT_PREVIEW_H = 42;

/** Which character frame a rider shows on a mount facing this way. */
export const RIDE_POSE: Record<MountFacing, AnimName> = {
  down: "idleDown",
  up: "idleUp",
  left: "idleLeft",
  right: "idleRight",
};

export type Offset = { x: number; y: number };

const ART: Record<Mount, MountArt> = { horse, frog, shark };

const view = (facing: MountFacing): View =>
  facing === "down" ? "down" : facing === "up" ? "up" : "side";
// `|| 0` keeps -0 out of the offsets
const mirrored = (o: Offset, facing: MountFacing): Offset => ({
  x: (facing === "left" ? -o.x : o.x) || 0,
  y: o.y || 0,
});
const frameOf = (anim: MountAnim, frame: number) =>
  ((frame % MOUNT_FRAMES[anim]) + MOUNT_FRAMES[anim]) % MOUNT_FRAMES[anim];

/**
 * Where the rider sprite's anchor (bottom-centre of the character frame) goes, in world px
 * relative to the mount's anchor, for this frame (includes the walk bob). The rider is drawn
 * between `back` and `front`.
 */
export function riderAnchor(
  kind: Mount,
  facing: MountFacing,
  anim: MountAnim,
  frame: number,
): Offset {
  return mirrored(ART[kind].rider(view(facing), anim, frameOf(anim, frame)), facing);
}

/** Where a lead (rope / rein) ties on to the mount, world px relative to its anchor. */
export function leadPoint(
  kind: Mount,
  facing: MountFacing,
  anim: MountAnim,
  frame: number,
): Offset {
  return mirrored(ART[kind].lead(view(facing), anim, frameOf(anim, frame)), facing);
}

/** One frame, painted (DOM previews, tests): both layers are MOUNT_BOX × MOUNT_RES texels. */
export function paintMount(
  kind: Mount,
  color: string,
  facing: MountFacing,
  anim: MountAnim,
  frame: number,
): { back: PixelCanvas; front: PixelCanvas } {
  const p = new Painter(MOUNT_BOX.w * MOUNT_RES, MOUNT_BOX.h * MOUNT_RES);
  const f = ART[kind].paint(p, color, view(facing), anim, frameOf(anim, frame));
  return p.finish(f.shadow, facing === "left", f.overlay);
}

type Frames = Record<MountFacing, Record<MountAnim, Texture[]>>;
export type MountSheet = { kind: Mount; color: string; back: Frames; front: Frames };

function buildSheet(key: string): MountSheet {
  const { kind, color } = JSON.parse(key) as { kind: Mount; color: string };
  const layer = (pick: "back" | "front"): Frames => {
    const out = {} as Frames;
    for (const facing of MOUNT_FACINGS) {
      out[facing] = {} as Record<MountAnim, Texture[]>;
      for (const anim of MOUNT_ANIMS) {
        out[facing][anim] = Array.from({ length: MOUNT_FRAMES[anim] }, (_, f) => {
          const pc = paintMount(kind, color, facing, anim, f)[pick];
          const source = new CanvasSource({
            resource: pc.toCanvas(),
            resolution: MOUNT_RES,
            scaleMode: "nearest",
          });
          return new Texture({
            source,
            frame: new Rectangle(0, 0, MOUNT_BOX.w, MOUNT_BOX.h),
          });
        });
      }
    }
    return out;
  };
  return { kind, color, back: layer("back"), front: layer("front") };
}

const sheets = new RefCache<MountSheet>(buildSheet, (sheet) => {
  for (const layer of [sheet.back, sheet.front]) {
    for (const facing of MOUNT_FACINGS) {
      for (const anim of MOUNT_ANIMS) {
        for (const t of layer[facing][anim]) t.destroy(true);
      }
    }
  }
});

/** The shared textures of a mount in a colour; pair with `releaseMountSheet`. */
export function mountSheet(kind: Mount, color: string): MountSheet {
  return sheets.acquire(JSON.stringify({ kind, color }));
}

export function releaseMountSheet(sheet: MountSheet): void {
  sheets.release(sheet);
}

/**
 * A rider on their mount as a DOM canvas (studio preview), `scale` canvas px per world px,
 * MOUNT_BOX.w wide and MOUNT_PREVIEW_H tall so tall riders and hats fit. Null without a mount.
 * In `rest` the animal is shown alone (its rider is at the desk then).
 */
export function mountPreview(
  look: RenderLook,
  facing: MountFacing = "right",
  scale = 4,
  anim: MountAnim = "idle",
  frame = 0,
): HTMLCanvasElement | null {
  const m = look.look.accessories.mount;
  if (!m || m.kind === "none") return null;
  const kind = m.kind;
  const { back, front } = paintMount(kind, m.color, facing, anim, frame);
  const canvas = document.createElement("canvas");
  canvas.width = MOUNT_BOX.w * scale;
  canvas.height = Math.max(MOUNT_BOX.h, MOUNT_PREVIEW_H) * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const ax = (MOUNT_BOX.w / 2) * scale;
  const ay = canvas.height;
  const mx = ax - (MOUNT_BOX.w / 2) * scale;
  const my = ay - MOUNT_BOX.h * scale;
  ctx.drawImage(back.toCanvas(), mx, my, MOUNT_BOX.w * scale, MOUNT_BOX.h * scale);
  if (anim !== "rest") {
    const r = riderAnchor(kind, facing, anim, frame);
    const rider = lookPreview(look, riderFrameIndex(RIDE_POSE[facing]), scale);
    ctx.drawImage(
      rider,
      ax + r.x * scale - (CHAR_W / 2) * scale,
      ay + r.y * scale - CHAR_H * scale,
    );
  }
  ctx.drawImage(front.toCanvas(), mx, my, MOUNT_BOX.w * scale, MOUNT_BOX.h * scale);
  return canvas;
}

const riderFrameIndex = (a: AnimName): number => ANIM[a][0];
