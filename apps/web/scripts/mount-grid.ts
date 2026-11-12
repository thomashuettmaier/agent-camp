/**
 * Dev preview of the rideable animals (RA1): paint mounts headlessly into one upscaled PNG grid,
 * rider composited between the back and front layer exactly like the office does. One row per
 * facing (down, up, left, right), one column per frame (idle ×2, walk ×4, happy ×2, rest ×2).
 *
 *   bun apps/web/scripts/mount-grid.ts out.png horse                  default colour, knight
 *   bun apps/web/scripts/mount-grid.ts out.png frog '#3e8948' wizard  colour + rider fixture
 *   bun apps/web/scripts/mount-grid.ts out.png shark - none           no rider
 *   bun apps/web/scripts/mount-grid.ts out.png horse - front          front layer only
 *   [scale] [frames]          5th arg, default 4; 6th: only these frames, e.g. idle0,walk1
 */
import { writeFileSync } from "node:fs";
import { avatarFromSeed } from "@agent-office/protocol";
import { LOOK_FIXTURES } from "@agent-office/protocol/fixtures";
import { encodePng } from "../../../tools/sim/src/png.ts";
import { ANIM, FH, FW } from "../src/art/avatar/geometry.ts";
import { lookFor } from "../src/art/avatar/renderLook.ts";
import { paintSheet } from "../src/art/avatar/sheet.ts";
import {
  DEFAULT_MOUNT_COLOR,
  MOUNT_ANIMS,
  MOUNT_BOX,
  MOUNT_FACINGS,
  MOUNT_FRAMES,
  MOUNT_RES,
  type Mount,
  paintMount,
  RIDE_POSE,
  riderAnchor,
} from "../src/art/mounts.ts";
import type { PixelCanvas } from "../src/art/pixel.ts";

const [out = "mount-grid.png", kindArg = "horse", colorArg = "-", riderArg = "knight", sc, only] =
  process.argv.slice(2);
const kind = kindArg as Mount;
const color = colorArg === "-" ? DEFAULT_MOUNT_COLOR[kind] : colorArg;
const SCALE = Number(sc ?? 4);
const W = MOUNT_BOX.w * MOUNT_RES;
const H = MOUNT_BOX.h * MOUNT_RES;
const TOP = 48; // texels of headroom above the mount box for the rider
const BG = [0x8b, 0x9b, 0xb4];
const BG2 = [0x7a, 0x8a, 0xa4];

const avatar =
  riderArg === "none" || riderArg === "front"
    ? null
    : ((LOOK_FIXTURES as Record<string, ReturnType<typeof avatarFromSeed>>)[riderArg] ??
      avatarFromSeed(riderArg));
const sheet = avatar ? paintSheet(lookFor(avatar, "claude", null)) : null;

const cols = MOUNT_ANIMS.flatMap((a) =>
  Array.from({ length: MOUNT_FRAMES[a] }, (_, f) => [a, f] as const),
).filter(([a, f]) => !only || only.split(",").includes(`${a}${f}`));
const cellW = W + 4;
const cellH = H + TOP + 4;
const GW = cellW * cols.length;
const GH = cellH * MOUNT_FACINGS.length;
const texels = new Uint32Array(GW * GH);

function blit(
  src: PixelCanvas | null,
  data: Uint32Array,
  sw: number,
  sx: number,
  sy: number,
  w: number,
  h: number,
  dx: number,
  dy: number,
) {
  const d = src ? src.data : data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = d[(sy + y) * sw + sx + x]!;
      const a = v >>> 24;
      if (!a) continue;
      const i = (dy + y) * GW + dx + x;
      if (a === 255) texels[i] = v;
      else {
        // blend over what is there (the floor shadow)
        const under = texels[i]! || 0;
        const mixc = (s: number) => {
          const top = (v >> s) & 255;
          const bot = under ? (under >> s) & 255 : BG[s / 8]!;
          return Math.round((top * a + bot * (255 - a)) / 255);
        };
        texels[i] = (255 << 24) | (mixc(16) << 16) | (mixc(8) << 8) | mixc(0);
      }
    }
}

MOUNT_FACINGS.forEach((facing, r) => {
  cols.forEach(([anim, f], c) => {
    const { back, front } = paintMount(kind, color, facing, anim, f);
    const ox = c * cellW + 2;
    const oy = r * cellH + 2 + TOP;
    if (riderArg !== "front") blit(back, back.data, W, 0, 0, W, H, ox, oy);
    if (sheet && anim !== "rest") {
      const a = riderAnchor(kind, facing, anim, f);
      const frame = ANIM[RIDE_POSE[facing]][0];
      const rx = ox + W / 2 + a.x * MOUNT_RES - FW / 2;
      const ry = oy + H + a.y * MOUNT_RES - FH;
      blit(sheet, sheet.data, sheet.width, frame * FW, 0, FW, FH, rx, ry);
    }
    blit(front, front.data, W, 0, 0, W, H, ox, oy);
  });
});

const PW = GW * SCALE;
const PH = GH * SCALE;
const rgb = new Uint8Array(PW * PH * 3);
for (let y = 0; y < GH; y++)
  for (let x = 0; x < GW; x++) {
    const v = texels[y * GW + x]!;
    const bg = (Math.floor(x / cellW) + Math.floor(y / cellH)) % 2 ? BG : BG2;
    const px = v >>> 24 ? [v & 255, (v >> 8) & 255, (v >> 16) & 255] : bg;
    for (let dy = 0; dy < SCALE; dy++)
      for (let dx = 0; dx < SCALE; dx++) rgb.set(px, ((y * SCALE + dy) * PW + x * SCALE + dx) * 3);
  }
writeFileSync(out, encodePng(PW, PH, rgb));
console.log(`${out}: ${kind} ${color}, rider ${riderArg}`);
