/**
 * MOUSE-AS-HAND — the first-class desktop (and touch) fallback.
 *
 * A pointer is one point on a plane, so this turns it into the same pair of
 * palm poses a headset would deliver:
 *
 *   move the pointer        one open hand. Still = palm up; moving = palm leans
 *                           into the motion, and the motion itself is the gust.
 *   hold the button         the second hand joins: both palms cupped upward
 *                           under the pointer -> the updraft column.
 *   clap (right-click/Space) both hands swing together at the pointer.
 *   draw circles            the hand is simply moving in circles -> whirlwind.
 *
 * The output is raw poses only. They go through the same HandFilter and the
 * same gesture recogniser as real tracked hands; nothing downstream knows.
 */
import { type Vec3, clamp, damp, vec3 } from './vec3.js';

export interface RawHand {
  position: Vec3;
  palmNormal: Vec3;
  active: boolean;
}

export const createRawHand = (): RawHand => ({ position: vec3(), palmNormal: vec3(0, 1, 0), active: false });

export interface PointerState {
  /** Pointer position on the play plane, in simulation space. */
  x: number;
  y: number;
  z: number;
  /** False when the pointer is outside the view. */
  present: boolean;
  /** Button / finger held: cup both hands. */
  held: boolean;
}

const CLAP_TIME = 0.13;
const CLAP_HOLD = 0.1;

export class PointerHands {
  readonly left = createRawHand();
  readonly right = createRawHand();
  /** Half the gap between cupped palms, in hand metres. */
  cupSpread = 0.05;

  private readonly pos: Vec3 = vec3();
  private readonly vel: Vec3 = vec3();
  private placed = false;
  private clapClock = -1;
  private cup = 0;

  /** Ask for a clap at the pointer. */
  clap(): void {
    if (this.clapClock < 0) this.clapClock = 0;
  }

  get clapping(): boolean {
    return this.clapClock >= 0;
  }

  /** Advance by one fixed step. `unitScale` = simulation metres per hand metre. */
  step(p: PointerState, dt: number, unitScale: number): void {
    const L = this.left;
    const R = this.right;
    if (!p.present) {
      L.active = R.active = false;
      this.placed = false;
      this.clapClock = -1;
      this.cup = 0;
      return;
    }
    // the hand follows the pointer like a hand would: quickly, but with mass
    if (!this.placed) {
      this.pos.x = p.x;
      this.pos.y = p.y;
      this.pos.z = p.z;
      this.vel.x = this.vel.y = this.vel.z = 0;
      this.placed = true;
    } else {
      const k = damp(26, dt);
      const nx = this.pos.x + (p.x - this.pos.x) * k;
      const ny = this.pos.y + (p.y - this.pos.y) * k;
      const nz = this.pos.z + (p.z - this.pos.z) * k;
      const kv = damp(14, dt);
      this.vel.x += ((nx - this.pos.x) / dt - this.vel.x) * kv;
      this.vel.y += ((ny - this.pos.y) / dt - this.vel.y) * kv;
      this.vel.z += ((nz - this.pos.z) / dt - this.vel.z) * kv;
      this.pos.x = nx;
      this.pos.y = ny;
      this.pos.z = nz;
    }
    const { x, y, z } = this.pos;
    // lean of the palm: up at rest, tipping into the direction of travel
    const lean = 1 / (2.2 * unitScale);
    const lx = clamp(this.vel.x * lean, -1.6, 1.6);
    const ly = clamp(this.vel.y * lean, -1.2, 1.6);

    if (this.clapClock >= 0) {
      // ── clap: both palms swing together at the pointer ──
      this.clapClock += dt;
      const t = Math.min(1, this.clapClock / CLAP_TIME);
      const gap = (0.32 * (1 - t) + 0.02) * unitScale * 0.5;
      R.active = L.active = true;
      R.position.x = L.position.x = x;
      R.position.y = L.position.y = y;
      R.position.z = z + gap;
      L.position.z = z - gap;
      R.palmNormal.x = R.palmNormal.y = 0;
      R.palmNormal.z = -1;
      L.palmNormal.x = L.palmNormal.y = 0;
      L.palmNormal.z = 1;
      if (this.clapClock > CLAP_TIME + CLAP_HOLD) this.clapClock = -1;
      return;
    }

    this.cup += ((p.held ? 1 : 0) - this.cup) * damp(18, dt);
    const spread = this.cupSpread * unitScale;

    R.active = true;
    R.position.x = x;
    R.position.y = y;
    R.position.z = z + spread * this.cup;
    if (p.held) {
      // cupped: palms up, tilting a little with the motion so the column can be leaned
      R.palmNormal.x = clamp(lx * 0.6, -0.7, 0.7);
      R.palmNormal.y = 1;
      R.palmNormal.z = 0;
    } else {
      R.palmNormal.x = lx;
      R.palmNormal.y = 1 + Math.max(0, ly) - Math.max(0, -ly) * 0.8;
      R.palmNormal.z = 0;
    }
    normalize(R.palmNormal);

    L.active = p.held;
    if (p.held) {
      L.position.x = x;
      L.position.y = y;
      L.position.z = z - spread * this.cup;
      L.palmNormal.x = R.palmNormal.x;
      L.palmNormal.y = R.palmNormal.y;
      L.palmNormal.z = R.palmNormal.z;
    }
  }
}

function normalize(v: Vec3): void {
  const l = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (l > 1e-6) {
    v.x /= l;
    v.y /= l;
    v.z /= l;
  } else {
    v.x = 0;
    v.y = 1;
    v.z = 0;
  }
}
