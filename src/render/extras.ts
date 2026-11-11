/**
 * Supporting cast: palm markers (desktop hands + the ghost teacher), the sea
 * of clouds below the islands, birds, thermal columns, shock rings, sunbeams.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  RingGeometry,
  TorusGeometry,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';
import type { HandSample } from '../core/hands.js';
import { hash01 } from '../core/random.js';

const up = new Vector3(0, 1, 0);
const fwd = new Vector3(0, 0, 1);
const v = new Vector3();
const q = new Quaternion();
const m4 = new Matrix4();
const s3 = new Vector3();

// ── palm markers ────────────────────────────────────────────────────────────

/** A soft disc that shows where a hand is, which way its palm faces, and how hard it blows. */
export class PalmMarker {
  readonly group = new Group();
  private readonly disc: Mesh;
  private readonly ring: Mesh;
  private readonly breath: Mesh;
  private readonly discMat: MeshBasicMaterial;
  private readonly ringMat: MeshBasicMaterial;
  private readonly breathMat: MeshBasicMaterial;
  private level = 0;

  constructor(color: number, private readonly size = 0.26) {
    const mk = (opacity: number) =>
      new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: DoubleSide, fog: false, blending: AdditiveBlending });
    this.discMat = mk(0.22);
    this.ringMat = mk(0.7);
    this.breathMat = mk(0.12);
    this.disc = new Mesh(new CircleGeometry(size, 20), this.discMat);
    this.ring = new Mesh(new RingGeometry(size * 0.93, size * 1.04, 28), this.ringMat);
    // a faint cone of "breath" along the palm normal: this is where the wind goes
    const cone = new ConeGeometry(size * 1.1, size * 3.0, 14, 1, true);
    cone.translate(0, -size * 1.5, 0);
    cone.rotateX(-Math.PI / 2); // apex at the palm, opening along +z
    this.breath = new Mesh(cone, this.breathMat);
    this.group.add(this.disc, this.ring);
    this.group.visible = false;
    this.group.renderOrder = 35;
  }

  /** `strength` = wind speed this hand is making (m/s); `presence` fades the marker in and out. */
  update(hand: HandSample | null, strength: number, dt: number, presence = 1): void {
    const target = hand ? presence : 0;
    this.level += (target - this.level) * (1 - Math.exp(-10 * dt));
    this.group.visible = this.level > 0.02;
    if (!hand || !this.group.visible) return;
    this.group.position.set(hand.position.x, hand.position.y, hand.position.z);
    v.set(hand.palmNormal.x, hand.palmNormal.y, hand.palmNormal.z);
    if (v.lengthSq() < 1e-6) v.copy(up);
    q.setFromUnitVectors(fwd, v.normalize());
    this.group.quaternion.slerp(q, 1 - Math.exp(-18 * dt));
    const e = Math.min(1, strength / 7);
    this.discMat.opacity = (0.1 + 0.22 * e) * this.level;
    this.ringMat.opacity = (0.5 + 0.5 * e) * this.level;
    this.breathMat.opacity = (0.03 + 0.1 * e) * this.level;
    this.breath.scale.set(1, 1, 0.55 + 0.9 * e);
  }
}

// ── the sea of clouds ───────────────────────────────────────────────────────

export class CloudSea {
  readonly mesh: InstancedMesh;
  private readonly n: number;
  private readonly seeds: Float32Array;
  private readonly material: MeshLambertMaterial;
  private readonly span = 26;

  constructor(count = 46) {
    this.n = count;
    this.seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      this.seeds[i * 4] = hash01(i * 7 + 1) * this.span;
      this.seeds[i * 4 + 1] = hash01(i * 7 + 2);
      this.seeds[i * 4 + 2] = hash01(i * 7 + 3);
      this.seeds[i * 4 + 3] = hash01(i * 7 + 4);
    }
    this.material = new MeshLambertMaterial({ color: 0xffffff, flatShading: true, emissive: 0x000000 });
    this.mesh = new InstancedMesh(new IcosahedronGeometry(1, 1), this.material, count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  }

  /** Clouds wrap around the view centre so the sea is endless; they drift with the prevailing wind. */
  update(cx: number, time: number, drift: number, color: Color, shadeColor: Color): void {
    this.material.color.copy(color);
    this.material.emissive.copy(shadeColor).multiplyScalar(0.35);
    const half = this.span / 2;
    for (let i = 0; i < this.n; i++) {
      const j = i * 4;
      let x = this.seeds[j] + time * (0.12 + this.seeds[j + 3] * 0.14) + drift;
      x = ((((x - cx + half) % this.span) + this.span) % this.span) - half + cx;
      const depth = this.seeds[j + 1];
      const z = -7.5 + depth * 11.5;
      const y = -4.6 - this.seeds[j + 2] * 1.6 - Math.abs(z) * 0.06;
      const sz = 1.1 + this.seeds[j + 3] * 1.7;
      s3.set(sz * 1.9, sz * 0.62, sz * 1.3);
      q.setFromAxisAngle(up, this.seeds[j + 2] * 6.283);
      m4.compose(v.set(x, y, z), q, s3);
      this.mesh.setMatrixAt(i, m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ── thermals: warm rising columns you can see ───────────────────────────────

/**
 * A soft volume of light: brightest where the surface faces the eye, dissolving
 * to nothing at its silhouette, so cylinders read as shafts and spheres as orbs
 * with no hard edge anywhere. `vFade` optionally fades it along its height (uv.y).
 */
export function softLightMaterial(color: number, power = 3, heightFade = false): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: AdditiveBlending,
    uniforms: { uColor: { value: new Color(color) }, uOpacity: { value: 0 }, uPower: { value: power }, uFade: { value: heightFade ? 1 : 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying float vH;
      void main() {
        vH = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalMatrix * normal;
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity; uniform float uPower; uniform float uFade;
      varying vec3 vN; varying vec3 vV; varying float vH;
      void main() {
        float facing = abs(dot(normalize(vN), normalize(vV)));
        float ends = mix(1.0, smoothstep(0.0, 0.2, vH) * smoothstep(1.0, 0.75, vH), uFade);
        float a = pow(facing, uPower) * ends * uOpacity;
        gl_FragColor = vec4(uColor * a, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

export class ThermalColumn {
  readonly group = new Group();
  private readonly material: MeshBasicMaterial;
  private readonly shell: ShaderMaterial;
  private readonly rings: Mesh[] = [];
  private readonly height: number;

  constructor(radius: number, height: number, color = 0xffc56e) {
    this.height = height;
    this.material = new MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide, blending: AdditiveBlending, fog: false });
    this.shell = softLightMaterial(color, 2.2, true);
    const shell = new Mesh(new CylinderGeometry(radius * 0.8, radius * 0.55, height, 20, 1, true), this.shell);
    shell.position.y = height / 2;
    this.group.add(shell);
    for (let i = 0; i < 3; i++) {
      const ring = new Mesh(new TorusGeometry(radius * 0.72, 0.012, 4, 20), this.material);
      ring.rotation.x = Math.PI / 2;
      this.rings.push(ring);
      this.group.add(ring);
    }
    this.group.renderOrder = 18;
    this.group.visible = false;
  }

  update(x: number, y: number, z: number, level: number, time: number): void {
    this.group.visible = level > 0.01;
    if (!this.group.visible) return;
    this.group.position.set(x, y, z);
    this.material.opacity = 0.05 * level;
    this.shell.uniforms.uOpacity.value = 0.032 * level;
    for (let i = 0; i < this.rings.length; i++) {
      const t = (time * 0.42 + i / this.rings.length) % 1;
      this.rings[i].position.y = t * this.height;
      const sc = 0.75 + 0.45 * t;
      this.rings[i].scale.set(sc, sc, 1);
    }
  }
}

// ── shock rings (clap) ──────────────────────────────────────────────────────

export class ShockRings {
  readonly group = new Group();
  private readonly rings: { mesh: Mesh; mat: MeshBasicMaterial; age: number; life: number; speed: number }[] = [];

  constructor(count = 4) {
    for (let i = 0; i < count; i++) {
      const mat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide, blending: AdditiveBlending, fog: false });
      const mesh = new Mesh(new IcosahedronGeometry(1, 2), mat);
      mat.wireframe = true;
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ mesh, mat, age: 1, life: 1, speed: 9 });
    }
    this.group.renderOrder = 22;
  }

  fire(x: number, y: number, z: number, speed: number, life: number): void {
    let r = this.rings[0];
    for (const c of this.rings) if (c.age / c.life > r.age / r.life) r = c;
    r.age = 0;
    r.life = life;
    r.speed = speed;
    r.mesh.position.set(x, y, z);
    r.mesh.visible = true;
  }

  update(dt: number): void {
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        r.mesh.visible = false;
        continue;
      }
      const radius = 0.1 + r.speed * r.age;
      r.mesh.scale.setScalar(radius);
      r.mat.opacity = 0.5 * (1 - t) * (1 - t);
    }
  }
}

// ── sunbeam ─────────────────────────────────────────────────────────────────

export class Sunbeam {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private level = 0;
  target = 0;

  constructor() {
    // a soft shaft: bright along its heart, dissolving at the edges and toward the ground
    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      uniforms: { uColor: { value: new Color(0xfff0c0) }, uOpacity: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying float vH;
        void main() {
          vH = uv.y;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalMatrix * normal;
          vV = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOpacity;
        varying vec3 vN; varying vec3 vV; varying float vH;
        void main() {
          float facing = abs(dot(normalize(vN), normalize(vV)));
          float a = pow(facing, 3.0) * smoothstep(0.0, 0.2, vH) * (0.35 + 0.65 * vH) * uOpacity;
          gl_FragColor = vec4(uColor * a, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const geo = new CylinderGeometry(0.7, 1.5, 9, 24, 1, true);
    geo.translate(0, 4.5, 0);
    this.mesh = new Mesh(geo, this.material);
    this.mesh.rotation.z = 0.28;
    this.mesh.renderOrder = 17;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  update(x: number, y: number, z: number, dt: number, color: Color): void {
    this.level += (this.target - this.level) * (1 - Math.exp(-1.2 * dt));
    this.mesh.visible = this.level > 0.01;
    this.mesh.position.set(x, y - 0.4, z);
    (this.material.uniforms.uColor.value as Color).copy(color);
    this.material.uniforms.uOpacity.value = 0.085 * this.level;
  }
}

// ── birds ───────────────────────────────────────────────────────────────────

interface Bird {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  phase: number;
  /** Per-bird offset from the flock target. */
  ox: number; oy: number; oz: number;
}

/**
 * A handful of paper birds. They are how the Weather Mind points: they fly the
 * line the seed should take, and they scatter from thunder — and from a clap.
 */
export class Birds {
  readonly mesh: Mesh;
  private readonly birds: Bird[] = [];
  private readonly positions: Float32Array;
  private readonly geometry = new BufferGeometry();
  /** Where the flock is heading. */
  readonly target = new Vector3();
  private path: { x: number; y: number; z: number }[] = [];
  private pathT = 0;
  private pathSpeed = 0.2;
  private scare = 0;
  private readonly scareFrom = new Vector3();
  private readonly home = new Vector3();

  constructor(count = 7) {
    this.positions = new Float32Array(count * 18);
    for (let i = 0; i < count; i++) {
      this.birds.push({
        x: -6 + i, y: 3, z: -4, vx: 0, vy: 0, vz: 0, phase: i * 1.3,
        ox: (hash01(i * 3 + 1) - 0.5) * 1.6, oy: (hash01(i * 3 + 2) - 0.5) * 0.7, oz: (hash01(i * 3 + 3) - 0.5) * 1.4,
      });
    }
    const pa = new BufferAttribute(this.positions, 3);
    pa.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', pa);
    this.mesh = new Mesh(this.geometry, new MeshBasicMaterial({ color: 0x2c2a3a, side: DoubleSide, fog: true }));
    this.mesh.frustumCulled = false;
  }

  /** Circle lazily around a point (the idle behaviour). */
  roost(x: number, y: number, z: number): void {
    this.home.set(x, y, z);
    this.path = [];
  }

  /** Fly a line through the given points, then return to roosting at the last one. */
  guide(points: { x: number; y: number; z: number }[], seconds: number): void {
    this.path = points;
    this.pathT = 0;
    this.pathSpeed = 1 / Math.max(1, seconds);
  }

  scatter(x: number, y: number, z: number, power = 1): void {
    this.scare = Math.max(this.scare, power);
    this.scareFrom.set(x, y, z);
  }

  update(dt: number, time: number): void {
    // where is the flock going?
    if (this.path.length >= 2) {
      this.pathT += dt * this.pathSpeed;
      const f = Math.min(0.9999, this.pathT) * (this.path.length - 1);
      const i = Math.floor(f);
      const u = f - i;
      const a = this.path[i], b = this.path[i + 1];
      this.target.set(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u + Math.sin(u * Math.PI) * 0.5, a.z + (b.z - a.z) * u);
      if (this.pathT >= 1) {
        this.home.set(b.x, b.y + 1.2, b.z - 1.5);
        this.path = [];
      }
    } else {
      const a = time * 0.35;
      this.target.set(this.home.x + Math.cos(a) * 2.2, this.home.y + Math.sin(a * 1.7) * 0.4, this.home.z + Math.sin(a) * 1.4);
    }
    this.scare = Math.max(0, this.scare - dt * 0.55);

    const p = this.positions;
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      let ax = (this.target.x + b.ox - b.x) * 2.2;
      let ay = (this.target.y + b.oy - b.y) * 2.2;
      let az = (this.target.z + b.oz - b.z) * 2.2;
      if (this.scare > 0.01) {
        const dx = b.x - this.scareFrom.x, dy = b.y - this.scareFrom.y + 0.6, dz = b.z - this.scareFrom.z - 0.4;
        const d = Math.max(0.3, Math.hypot(dx, dy, dz));
        const k = (this.scare * 26) / (d * d + 0.5);
        ax += (dx / d) * k;
        ay += (dy / d) * k + this.scare * 3;
        az += (dz / d) * k;
      }
      b.vx += ax * dt;
      b.vy += ay * dt;
      b.vz += az * dt;
      const damp = Math.exp(-1.6 * dt);
      b.vx *= damp;
      b.vy *= damp;
      b.vz *= damp;
      const sp = Math.hypot(b.vx, b.vy, b.vz);
      const maxSp = 3.2 + this.scare * 6;
      if (sp > maxSp) {
        b.vx *= maxSp / sp;
        b.vy *= maxSp / sp;
        b.vz *= maxSp / sp;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      // two triangles: body-to-wingtip, flapping
      const hx = sp > 0.05 ? b.vx / sp : 1, hz = sp > 0.05 ? b.vz / sp : 0;
      const sx = -hz, sz = hx; // sideways
      b.phase += dt * (9 + sp * 2.5);
      const flap = Math.sin(b.phase) * 0.09;
      const L = 0.13, W = 0.16;
      const j = i * 18;
      const nx = b.x + hx * L, nz = b.z + hz * L; // nose
      const tx = b.x - hx * L * 0.7, tz = b.z - hz * L * 0.7; // tail
      p[j] = nx; p[j + 1] = b.y; p[j + 2] = nz;
      p[j + 3] = tx; p[j + 4] = b.y; p[j + 5] = tz;
      p[j + 6] = b.x + sx * W; p[j + 7] = b.y + flap; p[j + 8] = b.z + sz * W;
      p[j + 9] = nx; p[j + 10] = b.y; p[j + 11] = nz;
      p[j + 12] = b.x - sx * W; p[j + 13] = b.y + flap; p[j + 14] = b.z - sz * W;
      p[j + 15] = tx; p[j + 16] = b.y; p[j + 17] = tz;
    }
    this.geometry.attributes.position.needsUpdate = true;
  }
}
