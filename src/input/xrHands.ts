/**
 * WebXR adapter: turns tracked hands (or, failing that, controllers) into raw
 * palm poses in the XR reference space. Interpretation — filtering, velocity,
 * gesture recognition — is all in src/core and never sees WebXR.
 */
import { Quaternion, Vector3 } from '@iwsdk/core';

export interface XRPalm {
  active: boolean;
  /** Palm centre and outward palm normal, in XR reference space. */
  position: Vector3;
  normal: Vector3;
  /** True when this pose came from a tracked hand rather than a controller. */
  isHand: boolean;
  /** The live input source, kept so the shell can fire haptics on it. */
  source?: XRInputSource | null;
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
  readonly left: XRPalm = { active: false, position: new Vector3(), normal: new Vector3(0, 1, 0), isHand: false };
  readonly right: XRPalm = { active: false, position: new Vector3(), normal: new Vector3(0, 1, 0), isHand: false };

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
