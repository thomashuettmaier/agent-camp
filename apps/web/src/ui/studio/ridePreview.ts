/**
 * The studio's "riding" preview (RA1): the rider on their animal, seen from the side, next to
 * the front / side / desk previews of the look. `mountPreview` leaves room above the rider for
 * the tallest hat on the tallest mount; the empty rows on top are cut off here, so the picture
 * sits on the same floor line as the other previews instead of floating in a tall empty box.
 */

import type { RenderLook } from "../../art/characters.ts";
import { mountPreview } from "../../art/mounts.ts";

/** Null without an animal to ride. */
export function ridePreview(look: RenderLook, scale = 4): HTMLCanvasElement | null {
  const full = mountPreview(look, "right", scale);
  if (!full) return null;
  const top = firstOpaqueRow(full);
  // one world px of air above the head (or the hat)
  const y = Math.max(0, top - scale);
  if (y === 0) return full;
  const out = document.createElement("canvas");
  out.width = full.width;
  out.height = full.height - y;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(full, 0, -y);
  return out;
}

function firstOpaqueRow(c: HTMLCanvasElement): number {
  const ctx = c.getContext("2d");
  if (!ctx) return 0;
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3]! > 0) return y;
  return 0;
}
