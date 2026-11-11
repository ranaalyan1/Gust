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
}

const a = new Vector3();
const b = new Vector3();
const c = new Vector3();
const q = new Quaternion();
const seen = [false, false];
/** Controller speed (m/s) at which the palm has tipped 45 degrees into the swing. */
const SWING = 0.9;

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

  private readonly prev = [new Vector3(), new Vector3()];
  private readonly vel = [new Vector3(), new Vector3()];
  private readonly tracked = [false, false];

  update(frame: XRFrame | null | undefined, ref: XRReferenceSpace | null | undefined, dt = 1 / 72): void {
    this.left.active = this.right.active = false;
    seen[0] = seen[1] = false;
    if (!frame || !ref) {
      this.tracked[0] = this.tracked[1] = false;
      return;
    }
    const sources = frame.session.inputSources;
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      if (src.handedness !== 'left' && src.handedness !== 'right') continue;
      const palm = src.handedness === 'left' ? this.left : this.right;
      if (palm.active) continue;
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
          // one side they lean it); swung, the palm tips into the swing, so a
          // sweep is a gust the way the arm moved — exactly like the mouse hand.
          // position from the grip (where the hand is); orientation from the
          // target ray, whose +Y is straight up when the controller is held level
          const grip = src.gripSpace ? frame.getPose(src.gripSpace, ref) : null;
          const ray = src.targetRaySpace ? frame.getPose(src.targetRaySpace, ref) : null;
          const pose = grip ?? ray;
          if (pose) {
            const tp = pose.transform.position;
            const o = (ray ?? pose).transform.orientation;
            const k = src.handedness === 'left' ? 0 : 1;
            const prev = this.prev[k];
            const vel = this.vel[k];
            if (this.tracked[k] && dt > 1e-4) {
              const f = 1 - Math.exp(-14 * dt);
              vel.x += ((tp.x - prev.x) / dt - vel.x) * f;
              vel.y += ((tp.y - prev.y) / dt - vel.y) * f;
              vel.z += ((tp.z - prev.z) / dt - vel.z) * f;
            } else {
              vel.set(0, 0, 0);
            }
            prev.set(tp.x, tp.y, tp.z);
            seen[k] = true;
            palm.position.set(tp.x, tp.y, tp.z);
            q.set(o.x, o.y, o.z, o.w);
            palm.normal.set(0, 1, 0).applyQuaternion(q);
            a.copy(vel).multiplyScalar(1 / SWING);
            if (a.lengthSq() > 2.56) a.setLength(1.6);
            palm.normal.add(a);
            if (palm.normal.lengthSq() < 1e-8) palm.normal.set(0, 1, 0);
            palm.normal.normalize();
            palm.active = true;
            palm.isHand = false;
          }
        }
      } catch {
        // a pose that cannot be read this frame is simply a hand that is not there
      }
    }
    this.tracked[0] = seen[0];
    this.tracked[1] = seen[1];
  }
}
