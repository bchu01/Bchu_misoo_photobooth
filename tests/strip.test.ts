import { describe, expect, it } from 'vitest';
import { SHOTS_PER_SESSION } from '@bchu/shared';
import {
  computeCoverCrop,
  computeSlotRegions,
  computeStripLayout,
  STRIP_LAYOUT,
} from '../apps/web/src/features/strip/stripLayout';
import {
  buildPairSlots,
  buildSoloSlots,
  orderPairShot,
  type PairShotFrames,
} from '../apps/web/src/features/strip/stripSlots';

/** Stand-in for a captured JPEG; only identity matters for ordering tests. */
function frame(name: string): Blob {
  return new Blob([name], { type: 'image/jpeg' });
}

describe('strip layout', () => {
  it('exports at the required 600 px width', () => {
    expect(computeStripLayout(SHOTS_PER_SESSION).width).toBe(600);
  });

  it('gives every slot the same portrait size', () => {
    const { slots } = computeStripLayout(SHOTS_PER_SESSION);

    expect(slots).toHaveLength(SHOTS_PER_SESSION);
    const [first] = slots;
    expect(first).toBeDefined();
    for (const slot of slots) {
      expect(slot.width).toBe(first!.width);
      expect(slot.height).toBe(first!.height);
      expect(slot.height).toBeGreaterThan(slot.width);
    }
  });

  it('derives height from the slot count with consistent margins', () => {
    const { outerPaddingPx, slotGapPx } = STRIP_LAYOUT;
    const layout = computeStripLayout(SHOTS_PER_SESSION);
    const slotHeight = layout.slots[0]!.height;

    expect(layout.height).toBe(
      outerPaddingPx * 2 + SHOTS_PER_SESSION * slotHeight + (SHOTS_PER_SESSION - 1) * slotGapPx,
    );
  });

  it('stacks slots in order without overlapping', () => {
    const { slots } = computeStripLayout(SHOTS_PER_SESSION);

    for (let index = 1; index < slots.length; index += 1) {
      const previous = slots[index - 1]!;
      const current = slots[index]!;
      expect(current.y).toBe(previous.y + previous.height + STRIP_LAYOUT.slotGapPx);
    }
  });

  it('keeps slots inside the canvas', () => {
    const layout = computeStripLayout(SHOTS_PER_SESSION);

    for (const slot of layout.slots) {
      expect(slot.x).toBeGreaterThanOrEqual(0);
      expect(slot.x + slot.width).toBeLessThanOrEqual(layout.width);
      expect(slot.y + slot.height).toBeLessThanOrEqual(layout.height);
    }
  });

  it('rejects an empty strip', () => {
    expect(() => computeStripLayout(0)).toThrow();
  });
});

describe('slot regions', () => {
  const slot = computeStripLayout(SHOTS_PER_SESSION).slots[0]!;

  it('gives a solo frame the whole slot', () => {
    expect(computeSlotRegions(slot, 1)).toEqual([slot]);
  });

  it('splits a pair frame into two equal halves separated by the inner gap', () => {
    const [left, right] = computeSlotRegions(slot, 2);

    expect(left).toBeDefined();
    expect(right).toBeDefined();
    expect(left!.width).toBe(right!.width);
    expect(left!.height).toBe(slot.height);
    expect(right!.x - (left!.x + left!.width)).toBeGreaterThanOrEqual(STRIP_LAYOUT.innerGapPx);
    expect(right!.x + right!.width).toBe(slot.x + slot.width);
  });

  it('rejects more than two images in one frame', () => {
    expect(() => computeSlotRegions(slot, 3)).toThrow();
  });
});

describe('cover crop', () => {
  it('crops the sides of a wide source to fill a portrait target', () => {
    const crop = computeCoverCrop({ width: 1920, height: 1080 }, { width: 552, height: 736 });

    expect(crop.height).toBe(1080);
    expect(crop.width).toBeLessThan(1920);
    expect(crop.x).toBeGreaterThan(0);
    expect(crop.y).toBe(0);
  });

  it('preserves the target aspect ratio', () => {
    const target = { width: 272, height: 736 };
    const crop = computeCoverCrop({ width: 1280, height: 720 }, target);

    expect(crop.width / crop.height).toBeCloseTo(target.width / target.height, 5);
  });

  it('centres the crop', () => {
    const source = { width: 1000, height: 500 };
    const crop = computeCoverCrop(source, { width: 100, height: 100 });

    expect(crop.x + crop.width / 2).toBeCloseTo(source.width / 2, 5);
    expect(crop.y + crop.height / 2).toBeCloseTo(source.height / 2, 5);
  });
});

describe('pair export ordering', () => {
  it('always puts the host frame first', () => {
    const host = frame('host');
    const guest = frame('guest');

    expect(orderPairShot({ host, guest })).toEqual([host, guest]);
    // Insertion order must not matter: the guest's still often arrives first.
    expect(orderPairShot({ guest, host })).toEqual([host, guest]);
  });

  it('treats a half-received frame as unusable', () => {
    expect(orderPairShot({ host: frame('host') })).toBeNull();
    expect(orderPairShot({ guest: frame('guest') })).toBeNull();
    expect(orderPairShot(undefined)).toBeNull();
  });

  it('builds host-left slots for a complete session', async () => {
    const shots = new Map<number, PairShotFrames>();
    for (let shot = 1; shot <= SHOTS_PER_SESSION; shot += 1) {
      // Deliberately guest-first insertion order.
      shots.set(shot, { guest: frame(`guest-${shot}`), host: frame(`host-${shot}`) });
    }

    const slots = buildPairSlots(shots, SHOTS_PER_SESSION);
    expect(slots).toHaveLength(SHOTS_PER_SESSION);

    for (const [index, slot] of slots!.entries()) {
      expect(slot).toHaveLength(2);
      expect(await slot[0]!.text()).toBe(`host-${index + 1}`);
      expect(await slot[1]!.text()).toBe(`guest-${index + 1}`);
    }
  });

  it('blocks the download when any of the eight stills is missing', () => {
    const shots = new Map<number, PairShotFrames>();
    for (let shot = 1; shot <= SHOTS_PER_SESSION; shot += 1) {
      shots.set(shot, { host: frame(`host-${shot}`), guest: frame(`guest-${shot}`) });
    }
    shots.set(3, { host: frame('host-3') });

    expect(buildPairSlots(shots, SHOTS_PER_SESSION)).toBeNull();
  });

  it('blocks the download when a shot never happened', () => {
    const shots = new Map<number, PairShotFrames>([
      [1, { host: frame('h1'), guest: frame('g1') }],
    ]);

    expect(buildPairSlots(shots, SHOTS_PER_SESSION)).toBeNull();
  });
});

describe('solo slots', () => {
  it('wraps each captured frame in its own slot', () => {
    const frames = Array.from({ length: SHOTS_PER_SESSION }, (_unused, index) => frame(`f${index}`));
    const slots = buildSoloSlots(frames, SHOTS_PER_SESSION);

    expect(slots).toHaveLength(SHOTS_PER_SESSION);
    expect(slots!.every((slot) => slot.length === 1)).toBe(true);
  });

  it('returns null until every frame exists', () => {
    expect(buildSoloSlots([frame('a'), null, frame('c'), frame('d')], SHOTS_PER_SESSION)).toBeNull();
    expect(buildSoloSlots([], SHOTS_PER_SESSION)).toBeNull();
  });
});
