/**
 * THE PLAYER'S HANDS, IN THE HEADSET.
 *
 * A comment in the shell used to claim that the headset draws the player's real
 * hands for us. It does not: an immersive session gives an app joint poses and
 * nothing else, and the system never composites hands into the app's frame. So
 * the *only* thing a player saw were a few golden axis gizmos from the emulator —
 * in a game whose entire premise is that your hands are the wind.
 *
 * This draws them: the 25 joints WebXR reports as small warm beads, and the
 * bones between them as faint lines. It is not a photoreal hand and should not
 * try to be — the diorama is lit like a museum piece, and a cartoon hand inside
 * it would be the only thing in the room that was not made of glass, brass or
 * paper. Beads read as "this is you, and you are weather".
 *
 * Two draw calls per hand, both additive, both depth-written off: it cannot
 * z-fight with the diorama and it never casts a shadow of its own (the palm
 * shadow on the island is drawn separately, in the island's own space).
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DynamicDrawUsage,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Points,
  PointsMaterial,
  RGBAFormat,
  Vector3,
} from '@iwsdk/core';

const BEAD = 0.011;

/**
 * A soft round bead. A PointsMaterial without a map draws squares, which is what
 * a cloud of white squares in a lit room looks like: a bug. This is a 32-pixel
 * radial falloff, made once and shared by both hands.
 */
function beadTexture(): DataTexture {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  const c = (n - 1) / 2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - c, y - c) / c;
      const a = Math.max(0, 1 - d);
      const i = (y * n + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(255 * Math.pow(a, 2.2));
    }
  }
  const tex = new DataTexture(data, n, n, RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

let sharedBead: DataTexture | null = null;

export class HandView {
  readonly group = new Group();
  private readonly points: Points;
  private readonly lines: LineSegments;
  private readonly bones: number;
  private readonly jointWorld: Vector3[];

  constructor(joints: number, bones: number, color = 0xffe0b0, strength = 0.9) {
    this.bones = bones;
    this.jointWorld = Array.from({ length: joints }, () => new Vector3());

    const jp = new Float32Array(joints * 3);
    const jg = new BufferGeometry();
    const ja = new BufferAttribute(jp, 3);
    ja.setUsage(DynamicDrawUsage);
    jg.setAttribute('position', ja);
    this.points = new Points(
      jg,
      new PointsMaterial({
        color: new Color(color),
        map: (sharedBead ??= beadTexture()),
        size: BEAD * strength,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 30;

    const lp = new Float32Array(bones * 2 * 3);
    const lg = new BufferGeometry();
    const la = new BufferAttribute(lp, 3);
    la.setUsage(DynamicDrawUsage);
    lg.setAttribute('position', la);
    this.lines = new LineSegments(
      lg,
      new LineBasicMaterial({
        color: new Color(color),
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 29;

    this.group.add(this.lines, this.points);
    this.group.visible = false;
    this.group.matrixAutoUpdate = false;
  }

  /**
   * `matrix` maps XR reference space to world. Invalid joints collapse onto the
   * wrist, so a half-tracked hand is a smaller hand rather than a web of lines
   * shooting across the room.
   */
  update(joints: Vector3[], valid: boolean[], matrix: Matrix4, present: boolean): void {
    if (!present || joints.length === 0) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const anchor = joints[0];
    const pa = this.points.geometry.getAttribute('position') as BufferAttribute;
    const la = this.lines.geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < joints.length; i++) {
      const ok = valid[i] !== false;
      const src = ok ? joints[i] : anchor;
      this.jointWorld[i].copy(src).applyMatrix4(matrix);
      pa.setXYZ(i, this.jointWorld[i].x, this.jointWorld[i].y, this.jointWorld[i].z);
    }
    pa.needsUpdate = true;

    // bones: read from the caller's table, drawn as segments
    const table = this.boneTable;
    for (let i = 0; i < this.bones; i++) {
      const [from, to] = table[i] ?? [0, 0];
      const a = this.jointWorld[from] ?? anchor;
      const b = this.jointWorld[to] ?? anchor;
      la.setXYZ(i * 2, a.x, a.y, a.z);
      la.setXYZ(i * 2 + 1, b.x, b.y, b.z);
    }
    la.needsUpdate = true;
  }

  /** Set by the caller once: which joints are joined. */
  boneTable: [number, number][] = [];

  setVisible(v: boolean): void {
    this.group.visible = v;
  }
}
