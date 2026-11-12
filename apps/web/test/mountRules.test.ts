import { describe, expect, test } from "bun:test";
import { seededRandom } from "@agent-office/protocol";
import {
  arrivalPlan,
  devMount,
  faceToward,
  hopArc,
  idlePet,
  LEAD_CHANCE,
  LEAD_GAP,
  MOUNT_HOP_H,
  MOUNT_HOP_S,
  PARK_BEHIND,
  PARK_IDLE_S,
  PARK_REST_S,
  PET_ON_ARRIVAL,
  PET_SIDE,
  parkPhase,
  parkSpot,
  petSpot,
  RIDE_SPEED,
  STAY_ON_ARRIVAL,
  stepToward,
  Trail,
  tripStyle,
} from "../src/world/mountRules.ts";

const open = () => true;

describe("ride or lead", () => {
  test("about one trip in four is on foot with the lead", () => {
    const rand = seededRandom("trips");
    let lead = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) if (tripStyle("poi", true, null, rand()) === "lead") lead++;
    expect(lead / n).toBeGreaterThan(LEAD_CHANCE - 0.03);
    expect(lead / n).toBeLessThan(LEAD_CHANCE + 0.03);
  });

  test("hurried trips always ride", () => {
    for (const goal of ["rally", "evac", "exit"] as const) {
      expect(tripStyle(goal, true, null, 0)).toBe("ride");
      expect(tripStyle(goal, false, "lead", 0)).toBe("ride");
    }
  });

  test("a re-routed trip keeps its style; from a standstill it rolls again", () => {
    expect(tripStyle("desk", false, "lead", 0.99)).toBe("lead");
    expect(tripStyle("desk", false, "ride", 0)).toBe("ride");
    expect(tripStyle("desk", true, "ride", 0)).toBe("lead");
    expect(tripStyle("poi", true, null, 0.99)).toBe("ride");
  });

  test("the same seed walks the same trips", () => {
    const a = seededRandom("mount:s1");
    const b = seededRandom("mount:s1");
    const run = (r: () => number) =>
      Array.from({ length: 20 }, () => tripStyle("poi", true, null, r()));
    expect(run(a)).toEqual(run(b));
  });

  test("riding is a bit faster than walking, within reason", () => {
    for (const k of Object.values(RIDE_SPEED)) {
      expect(k).toBeGreaterThan(1);
      expect(k).toBeLessThanOrEqual(1.5);
    }
  });
});

describe("arriving", () => {
  test("at the desk the animal parks", () => {
    expect(arrivalPlan("desk", null, true, 0)).toBe("park");
    expect(arrivalPlan("desk", null, false, 0.9)).toBe("park");
  });

  test("in the bow line and outside at the fire alarm the rider stays up", () => {
    expect(arrivalPlan("rally", null, true, 0)).toBe("stay");
    expect(arrivalPlan("evac", null, true, 0.9)).toBe("stay");
    // came on foot: the animal just stands by
    expect(arrivalPlan("rally", null, false, 0)).toBe("stand");
  });

  test("sofas, stools and the arcade only from the floor, never petting", () => {
    for (const pose of ["sit", "sitBack", "play"] as const)
      for (const r of [0, 0.3, 0.9]) expect(arrivalPlan("poi", pose, true, r)).toBe("stand");
  });

  test("standing spots: sometimes pet it, sometimes stay in the saddle, else stand by", () => {
    expect(arrivalPlan("poi", "stand", true, 0)).toBe("pet");
    expect(arrivalPlan("poi", "stand", true, PET_ON_ARRIVAL + STAY_ON_ARRIVAL / 2)).toBe("stay");
    expect(arrivalPlan("poi", "stand", false, PET_ON_ARRIVAL + STAY_ON_ARRIVAL / 2)).toBe("stand");
    expect(arrivalPlan("poi", "stand", true, 0.99)).toBe("stand");
    expect(arrivalPlan("lunch", null, true, 0)).toBe("pet");
    expect(arrivalPlan("chat", null, true, 0)).toBe("stand");
  });

  test("standing around: pet now and then, not while busy or seated", () => {
    expect(idlePet("stand", false, 0)).toBe(true);
    expect(idlePet(null, false, 0)).toBe(true);
    expect(idlePet("stand", true, 0)).toBe(false);
    expect(idlePet("sit", false, 0)).toBe(false);
    expect(idlePet("stand", false, 0.99)).toBe(false);
  });
});

describe("places", () => {
  const seat = { x: 72, y: 98 };

  test("parks on the floor right behind the chair, facing the camera", () => {
    const s = parkSpot(seat, open);
    expect(s).toEqual({ x: seat.x, y: seat.y + PARK_BEHIND, facing: "down" });
    // never up over the desk (the desk is above the seat), never down into the aisle
    // (two tiles below the chair row)
    expect(s.y).toBeGreaterThan(seat.y);
    expect(Math.floor((s.y - 2) / 16)).toBe(Math.floor(seat.y / 16) + 1);
  });

  test("falls back to beside the chair when the floor behind it is blocked", () => {
    const behind = Math.floor((seat.y + PARK_BEHIND - 2) / 16);
    const s = parkSpot(seat, (_x, y) => y !== behind);
    expect(s.facing).toBe("left");
    expect(s.x).toBeGreaterThan(seat.x);
    const t = parkSpot(seat, (x, y) => y !== behind && x <= Math.floor(seat.x / 16));
    expect(t.facing).toBe("right");
    expect(t.x).toBeLessThan(seat.x);
  });

  test("pets beside the character, preferred side first, facing them", () => {
    const at = { x: 200, y: 150 };
    const r = petSpot("horse", at, 1, open)!;
    expect(r).toEqual({ x: at.x + PET_SIDE.horse, y: at.y, facing: "left" });
    const l = petSpot("frog", at, -1, open)!;
    expect(l).toEqual({ x: at.x - PET_SIDE.frog, y: at.y, facing: "right" });
    // a wall on the right: the other side
    const wall = Math.floor((at.x + PET_SIDE.shark) / 16);
    expect(petSpot("shark", at, 1, (x) => x !== wall)?.facing).toBe("right");
    expect(petSpot("shark", at, 1, () => false)).toBeNull();
  });

  test("parked: rests for a long while, looks around briefly", () => {
    const rest = parkPhase(false, 0.5);
    expect(rest.anim).toBe("rest");
    expect(rest.seconds).toBeGreaterThanOrEqual(PARK_REST_S[0]);
    expect(rest.seconds).toBeLessThanOrEqual(PARK_REST_S[1]);
    const look = parkPhase(true, 0.5);
    expect(look.anim).toBe("idle");
    expect(look.seconds).toBeLessThanOrEqual(PARK_IDLE_S[1]);
  });

  test("faces like characters do", () => {
    expect(faceToward(5, 1)).toBe("right");
    expect(faceToward(-5, 1)).toBe("left");
    expect(faceToward(1, -5)).toBe("up");
    expect(faceToward(1, 5)).toBe("down");
  });
});

describe("hop", () => {
  test("is short, starts on the floor / saddle and ends there, arcs up in between", () => {
    expect(MOUNT_HOP_S).toBeGreaterThanOrEqual(0.3);
    expect(MOUNT_HOP_S).toBeLessThanOrEqual(0.4);
    const out = { k: 0, lift: 0 };
    expect(hopArc(0, out)).toEqual({ k: 0, lift: 0 });
    hopArc(1, out);
    expect(out.k).toBe(1);
    expect(out.lift).toBeCloseTo(0, 6);
    hopArc(0.5, out);
    expect(out.k).toBeCloseTo(0.5, 6);
    expect(out.lift).toBeCloseTo(MOUNT_HOP_H, 6);
    // eased: slow at both ends, monotonic
    let prev = -1;
    for (let u = 0; u <= 1.0001; u += 0.05) {
      hopArc(u, out);
      expect(out.k).toBeGreaterThanOrEqual(prev);
      prev = out.k;
    }
    // clamped
    expect(hopArc(2, out).k).toBe(1);
  });
});

describe("trail", () => {
  /** Walk a character along waypoints in 1 px steps, pushing every step. */
  const walk = (trail: Trail, pts: { x: number; y: number }[]) => {
    const p = { ...pts[0]! };
    trail.reset(p.x, p.y);
    for (const wp of pts.slice(1)) {
      while (stepToward(p, wp.x, wp.y, 1) > 0) trail.push(p.x, p.y);
      trail.push(p.x, p.y);
    }
    return p;
  };

  test("the led animal is LEAD_GAP behind along the way, round the corner", () => {
    const trail = new Trail();
    // east 40 px, then a corner, then north 10 px
    const head = walk(trail, [
      { x: 0, y: 100 },
      { x: 40, y: 100 },
      { x: 40, y: 90 },
    ]);
    const out = { x: 0, y: 0 };
    trail.sample(head.x, head.y, LEAD_GAP.horse, out);
    // 10 px back down the north leg, the rest back along the east leg: it follows the corner
    // (crumbs 3 px apart round it off by about a pixel), it doesn't cut across
    expect(out.y).toBeCloseTo(100, 0);
    expect(Math.abs(out.x - (40 - (LEAD_GAP.horse - 10)))).toBeLessThan(1.5);
  });

  test("a short trail gives its oldest crumb", () => {
    const trail = new Trail();
    trail.reset(10, 10);
    trail.push(14, 10);
    const out = { x: 0, y: 0 };
    trail.sample(14, 10, 50, out);
    expect(out).toEqual({ x: 10, y: 10 });
  });

  test("crumbs are spaced, the ring keeps only the latest ones", () => {
    const trail = new Trail(8, 3);
    trail.reset(0, 0);
    trail.push(1, 0);
    expect(trail.length).toBe(1);
    for (let x = 3; x <= 300; x += 3) trail.push(x, 0);
    expect(trail.length).toBe(8);
    const out = { x: 0, y: 0 };
    // 8 crumbs 3 px apart: at most 21 px of history behind the newest one
    trail.sample(300, 0, 100, out);
    expect(out.x).toBe(279);
  });

  test("stepToward moves at most a step and lands exactly", () => {
    const p = { x: 0, y: 0 };
    expect(stepToward(p, 10, 0, 4)).toBeCloseTo(6);
    expect(p.x).toBeCloseTo(4);
    expect(stepToward(p, 10, 0, 100)).toBe(0);
    expect(p).toEqual({ x: 10, y: 0 });
  });
});

describe("dev ?mounts=", () => {
  test("one kind for all, mixed per person, nothing for junk", () => {
    expect(devMount("horse", 7)?.kind).toBe("horse");
    expect(devMount("shark", -3)?.kind).toBe("shark");
    expect(devMount(null, 1)).toBeNull();
    expect(devMount("unicorn", 1)).toBeNull();
    const kinds = new Set(Array.from({ length: 9 }, (_, i) => devMount("mixed", i)?.kind));
    expect(kinds).toEqual(new Set(["horse", "frog", "shark"]));
    expect(devMount("frog", 5)?.color).toMatch(/^#[0-9a-f]{6}$/);
  });
});
