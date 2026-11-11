import { describe, expect, test } from "bun:test";
import {
  ACCENT_COLORS,
  ACCESSORIES,
  type AvatarSpec as Avatar,
  AvatarSpec,
  avatarFromSeed,
  HELD_ITEMS,
  OUTFITS,
  VEHICLES,
  WRISTWEAR,
} from "@agent-office/protocol";
import { LOOK_FIXTURES } from "@agent-office/protocol/fixtures";
import { FH, FW } from "../src/art/avatar/geometry.ts";
import { lookFor, lookKey, paintSheet } from "../src/art/characters.ts";
import { vehiclePixels } from "../src/art/party.ts";
import { packColor } from "../src/art/pixel.ts";

const base = {
  ...avatarFromSeed("anna"),
  accessory: "none" as const,
  leftHand: "none" as const,
  rightHand: "none" as const,
};
const signature = (avatar: Avatar) =>
  Array.from(paintSheet(lookFor(avatar, "codex", null)).data).join(",");
const frame = (avatar: Avatar, index: number) => {
  const sheet = paintSheet(lookFor(avatar, "codex", null));
  const pixels: number[] = [];
  for (let y = 0; y < FH; y++)
    for (let x = 0; x < FW; x++) pixels.push(sheet.data[y * sheet.width + index * FW + x]!);
  return pixels.join(",");
};

describe("integrated avatar costumes", () => {
  test("each catalog option has distinct paper-doll artwork", () => {
    for (const [slot, entries] of [
      ["accessory", ACCESSORIES],
      ["outfit", OUTFITS],
      ["leftHand", HELD_ITEMS],
      ["rightHand", HELD_ITEMS],
      ["wrist", WRISTWEAR],
    ] as const) {
      expect(new Set(entries.map(({ id }) => signature({ ...base, [slot]: id }))).size).toBe(
        entries.length,
      );
    }
    expect(
      new Set(
        ACCENT_COLORS.map(({ id }) =>
          signature({ ...base, leftHand: "lightsaber", accentColor: id }),
        ),
      ).size,
    ).toBe(ACCENT_COLORS.length);
    expect(
      new Set(
        VEHICLES.map(({ id }) =>
          Array.from(vehiclePixels({ ...base, vehicle: id }).data).join(","),
        ),
      ).size,
    ).toBe(VEHICLES.length);
  });

  test("cat ears and neon bands remain visible across front, back, side and seated frames", () => {
    for (const index of [0, 6, 10, 14, 18, 24])
      for (const [slot, value] of [
        ["accessory", "cat-ears"],
        ["wrist", "neon-pink"],
        ["outfit", "cat"],
      ] as const) {
        expect(frame({ ...base, [slot]: value }, index)).not.toBe(frame(base, index));
      }
  });

  test("held items remain visible in either hand while facing away and sitting", () => {
    for (const hand of ["leftHand", "rightHand"] as const)
      for (const item of HELD_ITEMS.filter((e) => e.id !== "none"))
        for (const index of [0, 6, 10, 14, 18]) {
          expect(frame({ ...base, [hand]: item.id }, index)).not.toBe(frame(base, index));
        }
  });

  test("flannel + beer + mint cap: plaid, a beer on the left, the white cap logo", () => {
    const avatar = {
      ...base,
      accessory: "cap-mint",
      outfit: "flannel",
      leftHand: "beer",
      rightHand: "joint",
    } as const;
    const sheet = paintSheet(lookFor(avatar, "codex", null));
    const at = (x: number, y: number) => sheet.data[y * sheet.width + x]!;
    const has = (hex: string, x0: number, x1: number, y0: number, y1: number) => {
      const want = packColor(hex);
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) if (at(x, y) === want) return true;
      return false;
    };
    expect(has("#feae34", 0, 8, 28, 46)).toBe(true); // the beer next to the viewer's-left hand
    expect(has("#ffffff", 13, 19, 6, 16)).toBe(true); // cap logo
    expect(has("#2ce8f5", 8, 24, 2, 16)).toBe(true); // mint crown
    expect(has("#3a4466", 8, 24, 24, 36)).toBe(true); // plaid bands on the flannel
    expect(frame(avatar, 0)).not.toBe(frame({ ...base, accessory: "cap" }, 0));
  });

  test("a posed detailed look shows what its hand-in-pocket hand holds", () => {
    const tracht = LOOK_FIXTURES.tracht;
    const holding = {
      ...tracht,
      look: { ...tracht.look, extras: { ...tracht.look.extras!, leftHand: "beer" as const } },
    };
    const sheet = paintSheet(lookFor(holding, "codex", null));
    const beer = packColor("#feae34");
    let found = false;
    for (let y = 28; y < 46; y++)
      for (let x = 0; x < 9; x++) if (sheet.data[y * sheet.width + x] === beer) found = true;
    expect(found).toBe(true);
  });

  /**
   * Pins how existing (catalog) looks render: all 35 HD frames of the seeded avatars (main's
   * pinned `anna` and `martin` = the jacket entries) in every catalog outfit, costumes included,
   * and the hand-authored detailed look. Any pixel change fails here; update the hashes only for
   * an intended change and list it below.
   *
   * Intended differences from main's 1× renderer (16×24) that these hashes accept:
   *  - painted at 32×48 texels (same world size, CHAR_RES = 2); classic hair and hats are main's
   *    1× layers Scale2x-upscaled, faces, clothes, legs and shoes are redrawn at 2×
   *  - same garments and base colours as main: open agent jacket over a white tee, pullover hoodie
   *    (drawstrings, kangaroo pocket, no zip), open plaid flannels over a navy tee, dusk tee
   *  - 2× shading from the look's ramps where main used flat Endesga colours: plaid threads blended
   *    into the flannel, beanie knit, beard shadow, a silver glint on glasses and the tee's edge,
   *    blush = skin mixed with main's pink on both cheeks, far trouser leg #303855 (main: ink),
   *    loafers with a bark highlight and the far shoe in their shadow #181425 (main: cocoa)
   *  - waist: the shirt ends at texel row 32 and trousers show from row 33 (world 16.5, main 18),
   *    in the opening of an open jacket / flannel as well; the beard no longer overlaps the
   *    torso's top row
   *  - same agent mark as main on non-agent outfits: chest badge (4×4, the flannel's / tee's half
   *    a world px from main's) + patch across the shoulders from behind (+ a dot at the front edge
   *    from the side)
   *  - held items, bracelets and costume details are main's 1× art, doubled
   */
  test("all 35 HD frames of seeded catalog looks retain their pixel checksums", () => {
    const sheetHash = (avatar: Avatar) => {
      let hash = 2166136261;
      for (const pixel of paintSheet(lookFor(avatar, "codex", null)).data)
        hash = Math.imul(hash ^ pixel, 16777619) >>> 0;
      return hash;
    };
    const got: Record<string, number> = {};
    for (const seed of ["anna", "martin"])
      for (const { id: outfit } of OUTFITS)
        got[`${seed}/${outfit}`] = sheetHash({ ...avatarFromSeed(seed), outfit });
    got.tracht = sheetHash(LOOK_FIXTURES.tracht);
    expect(got).toEqual(PINNED_SHEETS);
  });

  test("old avatar payloads receive neutral defaults", () => {
    const { wrist: _w, accentColor: _a, vehicle: _v, ...legacy } = avatarFromSeed("anna");
    const parsed = AvatarSpec.parse(legacy);
    expect([parsed.wrist, parsed.accentColor, parsed.vehicle]).toEqual(["none", "cyan", "none"]);
    expect(lookKey(lookFor(parsed, "codex", null))).not.toBe(
      lookKey(lookFor({ ...parsed, wrist: "rainbow" }, "codex", null)),
    );
  });
});

const PINNED_SHEETS: Record<string, number> = {
  "anna/jacket": 3533252985,
  "anna/hoodie": 2696425433,
  "anna/flannel": 4119217969,
  "anna/flannel-red": 2633891033,
  "anna/tee": 2819735303,
  "anna/cat": 1285367693,
  "anna/robot": 3586596483,
  "anna/astronaut": 4234510569,
  "anna/pirate": 1984409777,
  "anna/vampire": 3141327073,
  "anna/disco": 1247971807,
  "martin/jacket": 2462738828,
  "martin/hoodie": 10235228,
  "martin/flannel": 3321994145,
  "martin/flannel-red": 3280011012,
  "martin/tee": 2978690364,
  "martin/cat": 1299502084,
  "martin/robot": 935167976,
  "martin/astronaut": 826961384,
  "martin/pirate": 913177510,
  "martin/vampire": 1498393168,
  "martin/disco": 682794590,
  tracht: 3733927909,
};
