/**
 * WebXR adapter: turns tracked hands (or, failing that, controllers) into raw
 * palm poses in the XR reference space. Interpretation — filtering, velocity,
 * gesture recognition — is all in src/core and never sees WebXR.
 */
import { Quaternion, Vector3 } from '@iwsdk/core';

/**
 * The joints we draw. A hand in the headset has to be drawn: the system does not
 * composite one into the app's frame, and a player who cannot see their own hands
 * cannot tell tracking from a broken gesture. This is the full set WebXR exposes,
 * in the order of XRHand's own joint list.
 */
export const HAND_JOINTS: XRHandJoint[] = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
];

/** Which joint draws a bone to which: the finger chains, then the palm arch. */
export const HAND_BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8], [8, 9],
  [0, 10], [10, 11], [11, 12], [12, 13], [13, 14],
  [0, 15], [15, 16], [16, 17], [17, 18], [18, 19],
  [0, 20], [20, 21], [21, 22], [22, 23], [23, 24],
  [5, 10], [10, 15], [15, 20],
];

export interface XRPalm {
  active: boolean;
  /** Palm centre and outward palm normal, in XR reference space. */
  position: Vector3;
  normal: Vector3;
  /** True when this pose came from a tracked hand rather than a controller. */
  isHand: boolean;
  /** The live input source, kept so the shell can fire haptics on it. */
  source?: XRInputSource | null;
  /** Joint positions in the XR reference space, filled for tracked hands only. */
  joints?: Vector3[];
  /** Whether each joint was readable this frame. */
  jointValid?: boolean[];
}

const a = new Vector3();
const b = new Vector3();
const c = new Vector3();
const q = new Quaternion();

type JointName = 'wrist' | 'index-finger-metacarpal' | 'pinky-finger-metacarpal' | 'middle-finger-phalanx-proximal' | 'index-finger-phalanx-proximal' | 'pinky-finger-phalanx-proximal';

function jointPos(frame: XRFrame, hand: XRHand, name: JointName, ref: XRReferenceSpace, out: Vector3): boolean {
  const joint = hand.get(name as XRHandJoint);
  if (!joint || !frame.getJointPose) return false;
  const pose = frame.getJointPose(joint, ref);
  if (!pose) return false;
  const p = pose.transform.position;
  out.set(p.x, p.y, p.z);
  return true;
}

export class XRHands {
  readonly left: XRPalm = {
    active: false,
    position: new Vector3(),
    normal: new Vector3(0, 1, 0),
    isHand: false,
    joints: HAND_JOINTS.map(() => new Vector3()),
    jointValid: HAND_JOINTS.map(() => false),
  };
  readonly right: XRPalm = {
    active: false,
    position: new Vector3(),
    normal: new Vector3(0, 1, 0),
    isHand: false,
    joints: HAND_JOINTS.map(() => new Vector3()),
    jointValid: HAND_JOINTS.map(() => false),
  };

  private fillJoints(frame: XRFrame, hand: XRHand, ref: XRReferenceSpace, palm: XRPalm): void {
    const joints = palm.joints;
    const valid = palm.jointValid;
    if (!joints || !valid) return;
    for (let i = 0; i < HAND_JOINTS.length; i++) {
      const joint = hand.get(HAND_JOINTS[i]);
      const pose = joint && frame.getJointPose ? frame.getJointPose(joint, ref) : null;
      if (pose) {
        const p = pose.transform.position;
        joints[i].set(p.x, p.y, p.z);
        valid[i] = true;
      } else {
        valid[i] = false;
      }
    }
  }

  /**
   * A short haptic tick. This is how a gesture becomes a *confirmed* gesture:
   * in a headset, the hand that just made the wind should feel it.
   * Tracked hands have no actuator, so this is a no-op there rather than an error.
   */
  pulse(side: 'left' | 'right', intensity = 0.35, durationMs = 18): void {
    const palm = side === 'left' ? this.left : this.right;
    const actuators = palm.source?.gamepad?.hapticActuators;
    if (!actuators) return;
    for (let i = 0; i < actuators.length; i++) {
      try {
        void actuators[i].pulse(intensity, durationMs);
      } catch {
        // an actuator that refuses to pulse must never break the frame
      }
    }
  }

  update(frame: XRFrame | null | undefined, ref: XRReferenceSpace | null | undefined): void {
    this.left.active = this.right.active = false;
    this.left.source = null;
    this.right.source = null;
    if (!frame || !ref) return;
    const sources = frame.session.inputSources;
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      if (src.handedness !== 'left' && src.handedness !== 'right') continue;
      const palm = src.handedness === 'left' ? this.left : this.right;
      if (palm.active) continue;
      palm.source = src as XRInputSource;
      try {
        if (src.hand) {
          // palm frame from three joints: wrist, index knuckle, pinky knuckle
          const hand = src.hand;
          if (
            jointPos(frame, hand, 'wrist', ref, a) &&
            jointPos(frame, hand, 'index-finger-phalanx-proximal', ref, b) &&
            jointPos(frame, hand, 'pinky-finger-phalanx-proximal', ref, c)
          ) {
            palm.position.copy(a).add(b).add(c).multiplyScalar(1 / 3);
            b.sub(a);
            c.sub(a);
            // right hand: (index - wrist) x (pinky - wrist) points out of the palm; mirrored for the left
            palm.normal.crossVectors(b, c);
            if (src.handedness === 'left') palm.normal.negate();
            if (palm.normal.lengthSq() > 1e-10) {
              palm.normal.normalize();
              palm.position.addScaledVector(palm.normal, 0.02);
              palm.active = true;
              palm.isHand = true;
              this.fillJoints(frame, hand, ref, palm);
            }
          }
        } else if (src.gripSpace || src.targetRaySpace) {
          // A controller is a hand holding something: its top face is the palm.
          // Held level the palm is up (two together make the updraft, rolled to
          // one side they lean it, turned over they let go). Swinging it makes a
          // gust the same way a swung hand does: from its speed, in the core.
          // Position comes from the grip (where the hand is); orientation from
          // the target ray, whose +Y is straight up when the controller is level.
          const grip = src.gripSpace ? frame.getPose(src.gripSpace, ref) : null;
          const ray = src.targetRaySpace ? frame.getPose(src.targetRaySpace, ref) : null;
          const pose = grip ?? ray;
          if (pose) {
            const tp = pose.transform.position;
            const o = (ray ?? pose).transform.orientation;
            palm.position.set(tp.x, tp.y, tp.z);
            q.set(o.x, o.y, o.z, o.w);
            palm.normal.set(0, 1, 0).applyQuaternion(q).normalize();
            palm.active = true;
            palm.isHand = false;
          }
        }
      } catch {
        // a pose that cannot be read this frame is simply a hand that is not there
      }
    }
  }
}
