/**
 * Rideable animals (RA1): every mount frame paints, animations move, the front layer hides the
 * rider's legs at the rider anchor, the colour tints the body, frames stay inside the box.
 */
import { describe, expect, test } from "bun:test";
import { type AvatarSpec, avatarFromSeed, randomLook } from "@agent-office/protocol";
import { LOOK_FIXTURES } from "@agent-office/protocol/fixtures";
import { ANIM, FH, FW, HEADROOM, ROW } from "../src/art/avatar/geometry.ts";
import { lookFor } from "../src/art/avatar/renderLook.ts";
import { paintSheet } from "../src/art/avatar/sheet.ts";
import { CHAR_H } from "../src/art/characters.ts";
import {
  DEFAULT_MOUNT_COLOR,
  leadPoint,
  MOUNT_ANIMS,
  MOUNT_BOX,
  MOUNT_FACINGS,
  MOUNT_FRAME_S,
  MOUNT_FRAMES,
  MOUNT_PREVIEW_H,
  MOUNT_RES,
  type Mount,
  type MountAnim,
  type MountFacing,
  paintMount,
  RIDE_POSE,
  riderAnchor,
} from "../src/art/mounts.ts";
import type { PixelCanvas } from "../src/art/pixel.ts";

const KINDS: Mount[] = ["horse", "frog", "shark"];
const W = MOUNT_BOX.w * MOUNT_RES;
const H = MOUNT_BOX.h * MOUNT_RES;
const RIDING: MountAnim[] = ["idle", "walk", "happy"];

const opaque = (pc: PixelCanvas) => pc.data.reduce((n, v) => n + (v >>> 24 ? 1 : 0), 0);
const bytes = (pc: PixelCanvas) => Array.from(pc.data).join(",");
const hex = (v: number) =>
  `#${[v & 255, (v >> 8) & 255, (v >> 16) & 255].map((c) => c.toString(16).padStart(2, "0")).join("")}`;

function* frames(): Generator<[Mount, MountFacing, MountAnim, number]> {
  for (const kind of KINDS)
    for (const facing of MOUNT_FACINGS)
      for (const anim of MOUNT_ANIMS)
        for (let f = 0; f < MOUNT_FRAMES[anim]; f++) yield [kind, facing, anim, f];
}

describe("mount frames", () => {
  test("every kind × facing × anim × frame paints both layers inside the box", () => {
    for (const [kind, facing, anim, f] of frames()) {
      const { back, front } = paintMount(kind, DEFAULT_MOUNT_COLOR[kind], facing, anim, f);
      const at = `${kind} ${facing} ${anim}${f}`;
      expect(back.width, at).toBe(W);
      expect(back.height, at).toBe(H);
      expect(front.width, at).toBe(W);
      expect(opaque(back), at).toBeGreaterThan(150);
      expect(opaque(front), at).toBeGreaterThan(40);
      // nothing touches the left, right or top edge (no clipped art); the floor row may be used
      for (const pc of [back, front]) {
        for (let y = 0; y < H; y++) {
          expect(pc.data[y * W]! >>> 24, `${at} left edge`).toBe(0);
          expect(pc.data[y * W + W - 1]! >>> 24, `${at} right edge`).toBe(0);
        }
        for (let x = 0; x < W; x++) expect(pc.data[x]! >>> 24, `${at} top edge`).toBe(0);
      }
    }
  });

  test("the frames of every animation differ (trot, hop, swim, swish, croak, rest)", () => {
    for (const kind of KINDS)
      for (const facing of MOUNT_FACINGS)
        for (const anim of MOUNT_ANIMS) {
          const seen = new Set<string>();
          for (let f = 0; f < MOUNT_FRAMES[anim]; f++) {
            const { back, front } = paintMount(kind, DEFAULT_MOUNT_COLOR[kind], facing, anim, f);
            seen.add(bytes(back) + bytes(front));
          }
          expect(seen.size, `${kind} ${facing} ${anim}`).toBe(MOUNT_FRAMES[anim]);
        }
  });

  test("left mirrors right", () => {
    for (const kind of KINDS) {
      const r = paintMount(kind, DEFAULT_MOUNT_COLOR[kind], "right", "walk", 1).back;
      const l = paintMount(kind, DEFAULT_MOUNT_COLOR[kind], "left", "walk", 1).back;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) expect(l.data[y * W + x]).toBe(r.data[y * W + W - 1 - x]!);
      expect(riderAnchor(kind, "left", "walk", 1)).toEqual({
        x: -riderAnchor(kind, "right", "walk", 1).x || 0,
        y: riderAnchor(kind, "right", "walk", 1).y,
      });
    }
  });

  test("frames wrap around and the timing is positive", () => {
    expect(bytes(paintMount("frog", "#63c74d", "down", "walk", 5).back)).toBe(
      bytes(paintMount("frog", "#63c74d", "down", "walk", 1).back),
    );
    for (const anim of MOUNT_ANIMS) expect(MOUNT_FRAME_S[anim]).toBeGreaterThan(0);
  });

  test("the colour tints the body; dark and light colours still paint", () => {
    for (const kind of KINDS) {
      const colors = ["#e43b44", "#124e89", "#181425", "#ffffff"];
      const looks = colors.map((c) => paintMount(kind, c, "right", "idle", 0).back);
      expect(new Set(looks.map(bytes)).size, kind).toBe(colors.length);
      // the base colour itself is on the body
      const used = new Set(Array.from(looks[0]!.data).map(hex));
      expect(used.has("#e43b44"), kind).toBe(true);
      for (const pc of looks) expect(opaque(pc)).toBeGreaterThan(150);
    }
  });

  test("the front layer is a subset of the animal except the shark's water", () => {
    for (const kind of ["horse", "frog"] as const)
      for (const facing of MOUNT_FACINGS) {
        const { back, front } = paintMount(kind, DEFAULT_MOUNT_COLOR[kind], facing, "walk", 2);
        for (let i = 0; i < front.data.length; i++)
          if (front.data[i]! >>> 24) expect(front.data[i]).toBe(back.data[i]!);
      }
  });
});

describe("riders", () => {
  const looks: [string, AvatarSpec][] = [
    ...Object.entries(LOOK_FIXTURES),
    ...Array.from({ length: 16 }, (_, i): [string, AvatarSpec] => [
      `random ${i}`,
      { ...avatarFromSeed("rider"), look: randomLook(i + 7) },
    ]),
  ];

  // legs (and skirts, tails) span these frame columns; hands and held items hang further out
  // and may show beside the animal, like a rider holding the reins or a mug
  const LEGS = [9, 22] as const;

  test("the front layer hides the rider's legs from the hip down", () => {
    const hip = HEADROOM + ROW.hip;
    const fails: string[] = [];
    for (const [name, avatar] of looks) {
      const sheet = paintSheet(lookFor(avatar, "claude", null));
      for (const kind of KINDS)
        for (const facing of MOUNT_FACINGS)
          for (const anim of RIDING)
            for (let f = 0; f < MOUNT_FRAMES[anim]; f++) {
              const { front } = paintMount(kind, "#888888", facing, anim, f);
              const a = riderAnchor(kind, facing, anim, f);
              const frame = ANIM[RIDE_POSE[facing]][0];
              const missing: string[] = [];
              for (let y = hip + 1; y < FH; y++)
                for (let x = LEGS[0]; x <= LEGS[1]; x++) {
                  if (!(sheet.data[y * sheet.width + frame * FW + x]! >>> 24)) continue;
                  const mx = W / 2 + a.x * MOUNT_RES - FW / 2 + x;
                  const my = H + a.y * MOUNT_RES - FH + y;
                  const inside = mx >= 0 && my >= 0 && mx < W && my < H;
                  if (!inside || !(front.data[my * W + mx]! >>> 24)) missing.push(`${x},${y}`);
                }
              if (missing.length)
                fails.push(`${name} on ${kind} ${facing} ${anim}${f}: ${missing.join(" ")}`);
            }
    }
    expect(fails).toEqual([]);
  });

  test("rider anchors are whole world px, sit on the animal and fit the preview", () => {
    for (const [kind, facing, anim, f] of frames()) {
      const a = riderAnchor(kind, facing, anim, f);
      const at = `${kind} ${facing} ${anim}${f}`;
      expect(Number.isInteger(a.x) && Number.isInteger(a.y), at).toBe(true);
      expect(Math.abs(a.x), at).toBeLessThan(MOUNT_BOX.w / 4);
      expect(a.y, at).toBeLessThan(4);
      expect(a.y, at).toBeGreaterThan(-MOUNT_BOX.h / 2);
      expect(CHAR_H - a.y, at).toBeLessThanOrEqual(MOUNT_PREVIEW_H);
    }
  });

  test("riders bob with the trot and rise with the frog's hop", () => {
    const ys = (kind: Mount) => [0, 1, 2, 3].map((f) => riderAnchor(kind, "right", "walk", f).y);
    expect(new Set(ys("horse")).size).toBeGreaterThan(1);
    const hop = ys("frog");
    expect(Math.min(...hop)).toBeLessThan(riderAnchor("frog", "right", "idle", 0).y - 2);
  });

  test("lead points are on the animal, at the head side", () => {
    for (const [kind, facing, anim, f] of frames()) {
      const p = leadPoint(kind, facing, anim, f);
      const at = `${kind} ${facing} ${anim}${f}`;
      expect(Number.isInteger(p.x) && Number.isInteger(p.y), at).toBe(true);
      expect(Math.abs(p.x), at).toBeLessThan(MOUNT_BOX.w / 2);
      expect(p.y, at).toBeLessThan(0);
      expect(p.y, at).toBeGreaterThan(-MOUNT_BOX.h);
      // the texel there (or right next to it) is painted
      const { back } = paintMount(kind, DEFAULT_MOUNT_COLOR[kind], facing, anim, f);
      let hit = false;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const x = W / 2 + p.x * MOUNT_RES + dx;
          const y = H + p.y * MOUNT_RES + dy;
          if (back.data[y * W + x]! >>> 24) hit = true;
        }
      expect(hit, at).toBe(true);
    }
    expect(leadPoint("horse", "right", "idle", 0).x).toBeGreaterThan(0);
    expect(leadPoint("horse", "left", "idle", 0).x).toBeLessThan(0);
  });
});
