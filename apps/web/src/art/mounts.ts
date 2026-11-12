/**
 * Rideable animals (RA1): the horse, the frog and the shark a character can ride through the
 * office (`look.accessories.mount`). Not part of the character sheet: a mount is its own pair
 * of sprites, `back` (drawn behind the rider) and `front` (drawn over the rider, hiding the
 * legs, e.g. the horse's near flank, the frog's front legs, the shark's water ripple).
 *
 * Every frame is a MOUNT_BOX-sized HD frame (2 texels per world px, like character sheets),
 * anchored bottom-centre (0.5, 1) where the animal stands on the floor.
 *
 * STUB: the API below is the contract the office (world/mount.ts) and the studio build on.
 * The drawing is a placeholder until the real art lands.
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
import { PixelCanvas } from "./pixel.ts";

/** A mount that is actually there. */
export type Mount = Exclude<MountKind, "none">;
export type MountFacing = "down" | "up" | "left" | "right";
/**
 * idle: standing (shark: treading water) · walk: moving (horse trot, frog hop, shark swim) ·
 * happy: being petted (nuzzle, croak, tail wag) · rest: parked while its rider works at the
 * desk (lying down, sitting, shark circling in its puddle)
 */
export type MountAnim = "idle" | "walk" | "happy" | "rest";
export const MOUNT_ANIMS: readonly MountAnim[] = ["idle", "walk", "happy", "rest"];
export const MOUNT_FACINGS: readonly MountFacing[] = ["down", "up", "left", "right"];
/** frames per animation (the same for every mount and facing) */
export const MOUNT_FRAMES: Record<MountAnim, number> = { idle: 2, walk: 4, happy: 2, rest: 2 };
/** seconds per frame */
export const MOUNT_FRAME_S: Record<MountAnim, number> = {
  idle: 0.5,
  walk: 0.14,
  happy: 0.25,
  rest: 0.8,
};

/** Size of one mount frame in world px (anchor bottom-centre). */
export const MOUNT_BOX = { w: 40, h: 32 } as const;
/** texels per world px */
export const MOUNT_RES = CHAR_RES;

/** Which character frame a rider shows on a mount facing this way. */
export const RIDE_POSE: Record<MountFacing, AnimName> = {
  down: "idleDown",
  up: "idleUp",
  left: "idleLeft",
  right: "idleRight",
};

export type Offset = { x: number; y: number };

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
  const bob = anim === "walk" ? frame % 2 : 0;
  const seat = kind === "horse" ? 14 : kind === "frog" ? 9 : 8;
  void facing;
  return { x: 0, y: -seat + 4 - bob };
}

/** Where a lead (rope / rein) ties on to the mount, world px relative to its anchor. */
export function leadPoint(
  kind: Mount,
  facing: MountFacing,
  anim: MountAnim,
  frame: number,
): Offset {
  void anim;
  void frame;
  const h = kind === "horse" ? 18 : 8;
  const dx = facing === "left" ? -12 : facing === "right" ? 12 : 0;
  return { x: dx, y: -h };
}

/** One frame, painted (DOM previews, tests): both layers are MOUNT_BOX × MOUNT_RES texels. */
export function paintMount(
  kind: Mount,
  color: string,
  facing: MountFacing,
  anim: MountAnim,
  frame: number,
): { back: PixelCanvas; front: PixelCanvas } {
  const W = MOUNT_BOX.w * MOUNT_RES;
  const H = MOUNT_BOX.h * MOUNT_RES;
  const back = new PixelCanvas(W, H);
  const front = new PixelCanvas(W, H);
  // placeholder: a coloured blob, bobbing while walking
  const bob = anim === "walk" ? (frame % 2) * 2 : 0;
  const side = facing === "left" || facing === "right";
  const bw = side ? 56 : 30;
  const bh = kind === "horse" ? 24 : 16;
  back.ellipse((W - bw) / 2, H - bh - 6 - bob, bw, bh, color);
  front.ellipse((W - bw) / 2 + 4, H - bh / 2 - 6 - bob, bw - 8, bh / 2, color);
  return { back, front };
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
 * MOUNT_BOX wide and MOUNT_BOX.h + CHAR_H tall so tall riders fit. Null without a mount.
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
  canvas.height = (MOUNT_BOX.h + CHAR_H) * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const ax = (MOUNT_BOX.w / 2) * scale;
  const ay = canvas.height;
  const mx = ax - (MOUNT_BOX.w / 2) * scale;
  const my = ay - MOUNT_BOX.h * scale;
  ctx.drawImage(back.toCanvas(), mx, my, MOUNT_BOX.w * scale, MOUNT_BOX.h * scale);
  const r = riderAnchor(kind, facing, anim, frame);
  const pose = RIDE_POSE[facing];
  const rider = lookPreview(look, riderFrameIndex(pose), scale);
  ctx.drawImage(rider, ax + r.x * scale - (CHAR_W / 2) * scale, ay + r.y * scale - CHAR_H * scale);
  ctx.drawImage(front.toCanvas(), mx, my, MOUNT_BOX.w * scale, MOUNT_BOX.h * scale);
  return canvas;
}

const riderFrameIndex = (a: AnimName): number => ANIM[a][0];
