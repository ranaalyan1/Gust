import { describe, expect, it, vi } from 'vitest';

// The adapter only needs Vector3 and Quaternion; take them from three so the
// test runs in plain Node, without the browser-only IWSDK bundle.
vi.mock('@iwsdk/core', async () => await import('three'));

import { HAND_JOINTS, XRHands } from '../src/input/xrHands.js';

type Vec = { x: number; y: number; z: number };

/** A fake XRFrame whose joint poses come from a table; missing joints return null. */
function frameWith(sources: unknown[], joints: Record<string, Vec> | null) {
  return {
    session: { inputSources: sources },
    getJointPose: (joint: { name: string }) => {
      if (!joints || !(joint.name in joints)) return null;
      return { transform: { position: joints[joint.name] } };
    },
    getPose: (_space: unknown) => ({
      transform: { position: { x: 0.2, y: 1.1, z: -0.3 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
    }),
  } as unknown as XRFrame;
}

function jointTable(): Record<string, Vec> {
  return {
    wrist: { x: 0, y: 1, z: 0 },
    'index-finger-phalanx-proximal': { x: 0.04, y: 1, z: -0.06 },
    'pinky-finger-phalanx-proximal': { x: -0.04, y: 1, z: -0.06 },
  };
}

const ref = {} as XRReferenceSpace;

describe('XR hands adapter', () => {
  it('turns a tracked right hand into a palm pose with joints', () => {
    const hands = new XRHands();
    const joints = jointTable();
    // a hand exposes .get(name) for each joint; the adapter reads those names
    const hand = { get: (name: string) => ({ name }) };
    const frame = frameWith([{ handedness: 'right', hand, gamepad: undefined }], joints);
    hands.update(frame, ref);
    expect(hands.right.active).toBe(true);
    expect(hands.right.isHand).toBe(true);
    expect(hands.left.active).toBe(false);
    expect(hands.right.joints).toHaveLength(HAND_JOINTS.length);
    expect(hands.right.jointValid?.[0]).toBe(true);
    // the palm is above the wrist (the palm normal points out of the hand)
    expect(Number.isFinite(hands.right.normal.x + hands.right.normal.y + hands.right.normal.z)).toBe(true);
    expect(hands.right.normal.length()).toBeCloseTo(1, 5);
  });

  it('a hand that drops out of tracking is absent, not a controller in disguise', () => {
    const hands = new XRHands();
    const hand = { get: (name: string) => ({ name }) };
    // the hand source is there, but none of the palm joints are readable this frame
    const frame = frameWith([{ handedness: 'left', hand }], null);
    hands.update(frame, ref);
    expect(hands.left.active).toBe(false);
    expect(hands.left.isHand).toBe(false);
  });

  it('falls back to a controller grip when there is no hand', () => {
    const hands = new XRHands();
    const frame = frameWith([{ handedness: 'left', gripSpace: {}, targetRaySpace: {} }], null);
    hands.update(frame, ref);
    expect(hands.left.active).toBe(true);
    expect(hands.left.isHand).toBe(false);
    expect(hands.left.position.x).toBeCloseTo(0.2, 5);
  });

  it('no frame means no hands, and stale state is cleared', () => {
    const hands = new XRHands();
    hands.update(frameWith([{ handedness: 'right', gripSpace: {} }], null), ref);
    expect(hands.right.active).toBe(true);
    hands.update(null, ref);
    expect(hands.right.active).toBe(false);
    expect(hands.left.active).toBe(false);
  });
});
