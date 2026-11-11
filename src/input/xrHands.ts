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

  update(frame: XRFrame | null | undefined, ref: XRReferenceSpace | null | undefined): void {
    this.left.active = this.right.active = false;
    if (!frame || !ref) return;
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
          // a controller is a little fan: it blows where it points
          const space = src.targetRaySpace ?? src.gripSpace!;
          const pose = frame.getPose(space, ref);
          if (pose) {
            const p = pose.transform.position;
            const o = pose.transform.orientation;
            palm.position.set(p.x, p.y, p.z);
            q.set(o.x, o.y, o.z, o.w);
            palm.normal.set(0, 0, -1).applyQuaternion(q).normalize();
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
