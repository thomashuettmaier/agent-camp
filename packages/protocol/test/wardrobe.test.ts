import { describe, expect, test } from "bun:test";
import {
  applyPreset,
  avatarFromSeed,
  CharacterLook,
  lookFromCatalog,
  MOUNT_COLORS,
  MOUNTS,
  mountColor,
  OUTFIT_PRESETS,
  rampFrom,
  randomLook,
  repairLook,
  withWardrobe,
} from "../src/index.ts";
import { LOOK_FIXTURES } from "../src/lookFixtures.ts";

const luma = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};

describe("wardrobe", () => {
  test("rampFrom: shadow darker, light lighter, all #rrggbb", () => {
    for (const base of ["#e43b44", "#000000", "#ffffff", "#ABCDEF"]) {
      const r = rampFrom(base);
      for (const c of [r.base, r.shadow, r.light]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      expect(luma(r.shadow)).toBeLessThanOrEqual(luma(r.base) + 0.06);
      expect(luma(r.light)).toBeGreaterThanOrEqual(luma(r.base));
    }
  });

  test("stored looks without wardrobe sections still parse and get defaults", () => {
    const tracht = LOOK_FIXTURES.tracht.look!;
    expect(CharacterLook.safeParse(tracht).success).toBe(true);
    const full = withWardrobe(tracht);
    expect(full.body).toEqual({ height: "average", figure: "neutral" });
    expect(full.underwear.top).toBe("none");
    expect(full.apron.kind).toBe("none");
    expect(full.accessories.wings.kind).toBe("none");
  });

  test("a bad wardrobe section drops only that section", () => {
    const base = lookFromCatalog(avatarFromSeed("x"));
    const parsed = CharacterLook.parse({ ...base, body: { height: "giant", figure: "curvy" } });
    expect(parsed.body).toBeUndefined();
    expect(parsed.shirt).toEqual(base.shirt);
  });

  test("every preset applies to a valid look, keeping body, face and hair", () => {
    const base = { ...randomLook(7), body: { height: "tall" as const, figure: "curvy" as const } };
    for (const p of OUTFIT_PRESETS) {
      const look = applyPreset(base, p.id);
      const r = CharacterLook.safeParse(look);
      if (!r.success) throw new Error(`${p.id}: ${r.error.message}`);
      expect(look.face).toEqual(base.face);
      expect(look.hair).toEqual(base.hair);
      expect(look.body).toEqual(base.body);
    }
    expect(new Set(OUTFIT_PRESETS.map((p) => p.id)).size).toBe(OUTFIT_PRESETS.length);
  });

  test("crazy presets (WD12) keep their pets and auras through the parse", () => {
    const base = randomLook(11);
    const withPart = OUTFIT_PRESETS.filter(
      (p) => p.outfit.accessories.pet || p.outfit.accessories.aura,
    );
    expect(withPart.length).toBeGreaterThanOrEqual(5);
    for (const p of withPart) {
      const parsed = CharacterLook.parse(applyPreset(base, p.id));
      // a bad pet or aura would be dropped silently by .catch; the animal ridden stays (RA1)
      expect(parsed.accessories).toEqual({
        ...p.outfit.accessories,
        mount: base.accessories.mount,
      });
    }
    // the presets from before WD12 write neither (their JSON is unchanged)
    const tux = OUTFIT_PRESETS.find((p) => p.id === "tuxedo")!;
    expect(Object.keys(tux.outfit.accessories)).not.toContain("pet");
    // switching outfit takes the pet off, like wings
    expect(applyPreset(applyPreset(base, "tourist"), "casual").accessories?.pet).toBeUndefined();
  });

  test("the WD12 look fixtures wear their pet and aura", () => {
    expect(LOOK_FIXTURES.mermaid.look.accessories?.pet?.kind).toBe("octopus");
    expect(LOOK_FIXTURES.knight.look.extras?.costume).toBe("knight");
    expect(LOOK_FIXTURES.wizard.look.accessories?.aura?.kind).toBe("sparkles");
    expect(LOOK_FIXTURES.wizard.look.facialHair.style).toBe("wizard-beard");
  });

  test("riding presets (RA1) bring their animal; other outfits keep the one you ride", () => {
    const { mount: _, ...accessories } = randomLook(11).accessories;
    const base = { ...randomLook(11), accessories };
    const riding = OUTFIT_PRESETS.filter((p) => p.outfit.accessories.mount);
    expect(riding.map((p) => p.outfit.accessories.mount!.kind).sort()).toEqual([
      "frog",
      "horse",
      "shark",
      "shark",
    ]);
    for (const p of riding) {
      const parsed = CharacterLook.parse(applyPreset(base, p.id));
      // a bad mount would be dropped silently by .catch
      expect(parsed.accessories).toEqual(p.outfit.accessories);
    }
    // no preset before RA1 writes a mount (their JSON is unchanged)
    const before = OUTFIT_PRESETS.slice(
      0,
      OUTFIT_PRESETS.findIndex((p) => p.id === "rodeo"),
    );
    expect(before.length).toBe(51);
    for (const p of before) expect(Object.keys(p.outfit.accessories)).not.toContain("mount");
    // the animal is not clothing: a new outfit keeps it, a riding outfit brings its own
    const onHorse = applyPreset(base, "rodeo");
    expect(applyPreset(onHorse, "tuxedo").accessories?.mount).toEqual({
      kind: "horse",
      color: "#8a4b2a",
    });
    expect(applyPreset(onHorse, "shark-surfer").accessories?.mount?.kind).toBe("shark");
    // and a look without one gets none
    expect(applyPreset(base, "tuxedo").accessories).not.toHaveProperty("mount");
  });

  test("every rideable animal has natural colours, the first is its default", () => {
    for (const kind of MOUNTS.slice(1)) {
      const colors = MOUNT_COLORS[kind as Exclude<(typeof MOUNTS)[number], "none">];
      expect(colors.length).toBeGreaterThanOrEqual(3);
      for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
      expect(mountColor(kind)).toBe(colors[0]!);
    }
  });

  test("the RA1 look fixtures ride their animals", () => {
    expect(LOOK_FIXTURES.cowboy.look.accessories?.mount?.kind).toBe("horse");
    expect(LOOK_FIXTURES.cowboy.look.headwear.style).toBe("cowboy-hat");
    expect(LOOK_FIXTURES.frogrider.look.accessories?.mount?.kind).toBe("frog");
    expect(LOOK_FIXTURES.sharkrider.look.accessories?.mount?.kind).toBe("shark");
    // parsed strictly: nothing dropped by .catch
    for (const n of ["cowboy", "frogrider", "sharkrider"] as const)
      expect(CharacterLook.parse(LOOK_FIXTURES[n].look)).toEqual(LOOK_FIXTURES[n].look!);
  });

  test("naked preset leaves nothing on", () => {
    const look = withWardrobe(applyPreset(randomLook(1), "naked"));
    expect(look.shirt.kind).toBe("none");
    expect(look.bottoms.kind).toBe("none");
    expect(look.outer.kind).toBe("none");
    expect(look.underwear.top).toBe("none");
    expect(look.underwear.bottom).toBe("none");
    expect(look.shoes.kind).toBe("none");
    expect(look.legwear.kind).toBe("none");
  });

  test("an outfit hat comes off with the next outfit, an ordinary one stays", () => {
    const witch = applyPreset(randomLook(3), "witch");
    expect(witch.headwear.style).toBe("witch-hat");
    expect(applyPreset(witch, "casual").headwear.style).toBe("none");
    const capped = { ...witch, headwear: { ...witch.headwear, style: "beanie" as const } };
    expect(applyPreset(capped, "casual").headwear.style).toBe("beanie");
  });

  test("randomLook is valid and deterministic for 500 seeds", () => {
    for (let s = 0; s < 500; s++) {
      const r = CharacterLook.safeParse(randomLook(s));
      if (!r.success) throw new Error(`seed ${s}: ${r.error.message}`);
      // nothing dropped by .catch: every wardrobe section survives the parse
      expect(r.data.body).toBeDefined();
      expect(r.data.underwear).toBeDefined();
      expect(r.data.accessories).toBeDefined();
    }
    expect(randomLook(42)).toEqual(randomLook(42));
    // pets and auras are rare extras: some, but far from most
    const looks = Array.from({ length: 500 }, (_, s) => randomLook(s).accessories);
    const pets = looks.filter((a) => a.pet && a.pet.kind !== "none").length;
    const auras = looks.filter((a) => a.aura && a.aura.kind !== "none").length;
    expect(pets).toBeGreaterThan(0);
    expect(pets).toBeLessThan(75);
    expect(auras).toBeGreaterThan(0);
    expect(auras).toBeLessThan(50);
    // RA1: an animal to ride is rarer still, in one of its own colours, and only written when
    // there is one (it is drawn last, so the rest of every look is what it was before)
    const mounts = looks.filter((a) => a.mount);
    expect(mounts.length).toBeGreaterThan(0);
    expect(mounts.length).toBeLessThan(50);
    for (const a of mounts) {
      expect(a.mount!.kind).not.toBe("none");
      expect(MOUNT_COLORS[a.mount!.kind as "horse"]).toContain(a.mount!.color);
    }
  });

  test("repairLook keeps valid wardrobe sections of a partly broken look", () => {
    const good = randomLook(9);
    const broken = { ...good, shirt: { ...good.shirt, kind: "toga" } };
    const fixed = repairLook(broken, lookFromCatalog(avatarFromSeed("y")))!;
    expect(fixed.body).toEqual(good.body);
    expect(fixed.accessories).toEqual(good.accessories);
  });
});
