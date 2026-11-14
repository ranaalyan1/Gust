/**
 * SEEING THE AIR.
 *
 * Wind is invisible, so GUST draws it three ways, all driven by the same
 * analytic field the seed flies in:
 *
 *   WindStreaks  hundreds of weightless tracers advected by the field. Still
 *                air shows nothing; a sweep of the hand lights up a ribbon.
 *   Particles    a general pool of glowing motes (seed trails, bloom bursts,
 *                petals, fireflies, thermal embers).
 *   Rain         streaks that fall with the storm and slant with the wind.
 */
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  NormalBlending,
  Points,
  ShaderMaterial,
} from '@iwsdk/core';
import type { WindField } from '../core/wind.js';
import { type Vec3, vec3 } from '../core/vec3.js';

const w: Vec3 = vec3();
const wp: Vec3 = vec3();
const probe: Vec3 = vec3();

// ─────────────────────────────────────────────────────────────────────────────

export interface StreakSpawn {
  /** Centre of the visible volume (sim space). */
  cx: number;
  cy: number;
  cz: number;
  /** Up to two hand positions + palm normals to seed tracers near (may be inactive). */
  hands: { x: number; y: number; z: number; nx: number; ny: number; nz: number; active: boolean }[];
  /** Points in the air that are worth looking at (thermals, drafts): x, y, z, radius, height. */
  hotspots: { x: number; y: number; z: number; r: number; h: number }[];
}

export class WindStreaks {
  readonly object: LineSegments;
  private readonly n: number;
  private readonly head: Float32Array;
  private readonly tail: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly geometry = new BufferGeometry();
  /** Tint for player-made wind and for weather. */
  readonly handColor = new Color(0xffffff);
  readonly weatherColor = new Color(0xffd9a0);

  constructor(count = 420) {
    this.n = count;
    this.head = new Float32Array(count * 3);
    this.tail = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.positions = new Float32Array(count * 6);
    this.colors = new Float32Array(count * 6);
    const pa = new BufferAttribute(this.positions, 3);
    const ca = new BufferAttribute(this.colors, 3);
    pa.setUsage(DynamicDrawUsage);
    ca.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', pa);
    this.geometry.setAttribute('color', ca);
    const material = new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.object = new LineSegments(this.geometry, material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 20;
  }

  private respawn(i: number, s: StreakSpawn): void {
    const r = Math.random();
    let x: number, y: number, z: number;
    const hands = s.hands;
    const activeHands = (hands[0]?.active ? 1 : 0) + (hands[1]?.active ? 1 : 0);
    if (r < 0.42 && activeHands > 0) {
      // in front of a palm, where its wind is
      let h = hands[Math.random() < 0.5 ? 0 : 1];
      if (!h || !h.active) h = hands[0]?.active ? hands[0] : hands[1];
      const d = Math.random() * 1.7;
      x = h.x + h.nx * d + (Math.random() - 0.5) * 1.9;
      y = h.y + h.ny * d + (Math.random() - 0.5) * 1.0;
      z = h.z + h.nz * d + (Math.random() - 0.5) * 1.9;
    } else if (r < 0.8 && s.hotspots.length > 0) {
      const h = s.hotspots[(Math.random() * s.hotspots.length) | 0];
      const a = Math.random() * 6.283;
      const rr = Math.sqrt(Math.random()) * h.r;
      x = h.x + Math.cos(a) * rr;
      y = h.y + Math.random() * h.h;
      z = h.z + Math.sin(a) * rr;
    } else {
      x = s.cx + (Math.random() - 0.5) * 9;
      y = s.cy + (Math.random() - 0.35) * 4.2;
      z = s.cz + (Math.random() - 0.5) * 3.6;
    }
    const j = i * 3;
    this.head[j] = this.tail[j] = x;
    this.head[j + 1] = this.tail[j + 1] = y;
    this.head[j + 2] = this.tail[j + 2] = z;
    this.maxLife[i] = 0.7 + Math.random() * 1.3;
    this.life[i] = this.maxLife[i];
  }

  /**
   * How many of the streaks are drawn, 0..1. The frame monitor uses this on a
   * headset that is missing frames: fewer tracers in the air, same picture.
   */
  setDensity(fraction: number): void {
    this.density = Math.max(0, Math.min(1, fraction));
    const active = Math.round(this.n * this.density);
    this.geometry.setDrawRange(0, active * 2);
  }

  private density = 1;

  update(field: WindField, dt: number, spawn: StreakSpawn, intensity = 1): void {
    const { head, tail, life, maxLife, positions, colors } = this;
    const hc = this.handColor;
    const wc = this.weatherColor;
    const kTail = 1 - Math.exp(-9 * dt);
    const active = Math.max(0, Math.round(this.n * this.density));
    for (let i = 0; i < active; i++) {
      const j = i * 3;
      life[i] -= dt;
      if (life[i] <= 0) this.respawn(i, spawn);
      probe.x = head[j];
      probe.y = head[j + 1];
      probe.z = head[j + 2];
      field.sample(probe, w);
      field.samplePlayer(probe, wp);
      const speed = Math.sqrt(w.x * w.x + w.y * w.y + w.z * w.z);
      const pSpeed = Math.sqrt(wp.x * wp.x + wp.y * wp.y + wp.z * wp.z);
      head[j] += w.x * dt;
      head[j + 1] += w.y * dt;
      head[j + 2] += w.z * dt;
      tail[j] += (head[j] - tail[j]) * kTail;
      tail[j + 1] += (head[j + 1] - tail[j + 1]) * kTail;
      tail[j + 2] += (head[j + 2] - tail[j + 2]) * kTail;
      // dead air is invisible: brightness follows speed
      const t = life[i] / maxLife[i];
      const fade = Math.min(1, t * 5) * Math.min(1, (1 - t) * 6);
      let a = Math.min(1, Math.max(0, (speed - 0.5) / 3.2)) * fade * intensity;
      const share = speed > 1e-4 ? Math.min(1, pSpeed / speed) : 0;
      a *= (0.42 + 0.58 * share) * 0.5;
      const cr = wc.r + (hc.r - wc.r) * share;
      const cg = wc.g + (hc.g - wc.g) * share;
      const cb = wc.b + (hc.b - wc.b) * share;
      const k = i * 6;
      positions[k] = head[j];
      positions[k + 1] = head[j + 1];
      positions[k + 2] = head[j + 2];
      positions[k + 3] = tail[j];
      positions[k + 4] = tail[j + 1];
      positions[k + 5] = tail[j + 2];
      colors[k] = cr * a;
      colors[k + 1] = cg * a;
      colors[k + 2] = cb * a;
      colors[k + 3] = colors[k + 4] = colors[k + 5] = 0; // tails fade to nothing
      if (speed < 0.25 && t < 0.8) life[i] -= dt * 3; // stale tracers recycle quickly
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export interface ParticleOptions {
  life: number;
  size: number;
  /** 0 = ignores wind, 1 = rides it fully. */
  windFollow?: number;
  gravity?: number;
  drag?: number;
  /** Size at the end of life relative to the start. */
  shrink?: number;
  twinkle?: number;
}

export class Particles {
  readonly object: Points;
  private readonly n: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly color: Float32Array;
  private readonly baseColor: Float32Array;
  private readonly size: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly follow: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private readonly shrink: Float32Array;
  private readonly twinkle: Float32Array;
  private next = 0;
  private readonly geometry = new BufferGeometry();
  readonly material: ShaderMaterial;

  constructor(count: number, additive: boolean) {
    this.n = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.color = new Float32Array(count * 3);
    this.baseColor = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count).fill(1);
    this.baseSize = new Float32Array(count);
    this.follow = new Float32Array(count);
    this.gravity = new Float32Array(count);
    this.drag = new Float32Array(count);
    this.shrink = new Float32Array(count);
    this.twinkle = new Float32Array(count);
    const pa = new BufferAttribute(this.pos, 3);
    const ca = new BufferAttribute(this.color, 3);
    const sa = new BufferAttribute(this.size, 1);
    pa.setUsage(DynamicDrawUsage);
    ca.setUsage(DynamicDrawUsage);
    sa.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', pa);
    this.geometry.setAttribute('color', ca);
    this.geometry.setAttribute('size', sa);
    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
      uniforms: { uScale: { value: 600 }, uSoft: { value: additive ? 1 : 0 } },
      vertexShader: /* glsl */ `
        attribute float size; attribute vec3 color;
        uniform float uScale;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // size is in world metres; projectionMatrix[1][1] makes it correct per eye in XR
          gl_PointSize = size * uScale * projectionMatrix[1][1] / max(0.001, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uSoft;
        varying vec3 vColor;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c) * 2.0;
          if (d > 1.0) discard;
          float soft = pow(1.0 - d, 1.6) + 0.55 * smoothstep(0.28, 0.0, d);
          float hard = smoothstep(1.0, 0.7, d);
          float a = mix(hard, soft, uSoft);
          gl_FragColor = vec4(vColor * mix(1.0, a, uSoft), mix(a, 1.0, uSoft));
          #include <colorspace_fragment>
        }`,
    });
    this.object = new Points(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = additive ? 30 : 10;
  }

  /** `scale` = drawing-buffer height in px / 2 (so sizes are metres), times the world scale. */
  setScale(pixelHeight: number, worldScale: number): void {
    this.material.uniforms.uScale.value = pixelHeight * 0.5 * worldScale;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: Color, o: ParticleOptions): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    const j = i * 3;
    this.pos[j] = x;
    this.pos[j + 1] = y;
    this.pos[j + 2] = z;
    this.vel[j] = vx;
    this.vel[j + 1] = vy;
    this.vel[j + 2] = vz;
    this.baseColor[j] = color.r;
    this.baseColor[j + 1] = color.g;
    this.baseColor[j + 2] = color.b;
    this.life[i] = this.maxLife[i] = o.life;
    this.baseSize[i] = o.size;
    this.follow[i] = o.windFollow ?? 0;
    this.gravity[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 1.5;
    this.shrink[i] = o.shrink ?? 0;
    this.twinkle[i] = o.twinkle ?? 0;
  }

  update(field: WindField | null, dt: number, time: number): void {
    const { pos, vel, color, baseColor, size, life, maxLife } = this;
    for (let i = 0; i < this.n; i++) {
      if (life[i] <= 0) {
        size[i] = 0;
        continue;
      }
      life[i] -= dt;
      const j = i * 3;
      const f = this.follow[i];
      if (f > 0 && field) {
        probe.x = pos[j];
        probe.y = pos[j + 1];
        probe.z = pos[j + 2];
        field.sample(probe, w);
        const k = 1 - Math.exp(-4 * f * dt);
        vel[j] += (w.x - vel[j]) * k;
        vel[j + 1] += (w.y - vel[j + 1]) * k;
        vel[j + 2] += (w.z - vel[j + 2]) * k;
      } else {
        const d = Math.exp(-this.drag[i] * dt);
        vel[j] *= d;
        vel[j + 1] *= d;
        vel[j + 2] *= d;
      }
      vel[j + 1] -= this.gravity[i] * dt;
      pos[j] += vel[j] * dt;
      pos[j + 1] += vel[j + 1] * dt;
      pos[j + 2] += vel[j + 2] * dt;
      const t = Math.max(0, life[i] / maxLife[i]);
      const fade = Math.min(1, t * 2.5) * Math.min(1, (1 - t) * 12);
      const tw = this.twinkle[i] > 0 ? 1 - this.twinkle[i] * (0.5 + 0.5 * Math.sin(time * 9 + i * 1.7)) : 1;
      const b = fade * tw;
      color[j] = baseColor[j] * b;
      color[j + 1] = baseColor[j + 1] * b;
      color[j + 2] = baseColor[j + 2] * b;
      size[i] = this.baseSize[i] * (this.shrink[i] + (1 - this.shrink[i]) * t) * (0.4 + 0.6 * fade);
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.attributes.size.needsUpdate = true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export class Rain {
  readonly object: LineSegments;
  private readonly n: number;
  private readonly p: Float32Array;
  private readonly positions: Float32Array;
  private readonly geometry = new BufferGeometry();
  private readonly material: LineBasicMaterial;

  constructor(count = 260) {
    this.n = count;
    this.p = new Float32Array(count * 3);
    this.positions = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      this.p[i * 3] = (Math.random() - 0.5) * 10;
      this.p[i * 3 + 1] = Math.random() * 6 - 2.5;
      this.p[i * 3 + 2] = (Math.random() - 0.5) * 4.4;
    }
    const pa = new BufferAttribute(this.positions, 3);
    pa.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', pa);
    this.material = new LineBasicMaterial({ color: 0xa9bdd8, transparent: true, opacity: 0, depthWrite: false, fog: true });
    this.object = new LineSegments(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 15;
    this.object.visible = false;
  }

  /**
   * `level` 0..1. Drops live in a box around (cx, cy); positions are stored
   * relative to it so the rain travels with the view. `blocked` hides drops
   * under a roof.
   */
  update(dt: number, level: number, cx: number, cy: number, windX: number, windZ: number, blocked: (x: number, y: number, z: number) => boolean): void {
    this.object.visible = level > 0.01;
    if (!this.object.visible) return;
    // Bright streaks over a dark storm sky read as television static; rain in
    // front of a bright sky reads as rain. Keep it low and let the fog thin it.
    this.material.opacity = 0.10 + 0.20 * level;
    const active = Math.max(8, Math.round(this.n * Math.min(1, 0.25 + level)));
    this.geometry.setDrawRange(0, active * 2);
    const fall = 9.5;
    const len = 0.05;
    for (let i = 0; i < active; i++) {
      const j = i * 3;
      this.p[j] += windX * dt;
      this.p[j + 1] -= fall * dt;
      this.p[j + 2] += windZ * dt;
      if (this.p[j + 1] < -3.4) {
        this.p[j] = (Math.random() - 0.5) * 10;
        this.p[j + 1] = 3.4 + Math.random() * 0.8;
        this.p[j + 2] = (Math.random() - 0.5) * 4.4;
      }
      const x = cx + this.p[j], y = cy + this.p[j + 1], z = this.p[j + 2];
      const k = i * 6;
      if (blocked(x, y, z)) {
        this.positions[k] = this.positions[k + 3] = x;
        this.positions[k + 1] = this.positions[k + 4] = -99;
        this.positions[k + 2] = this.positions[k + 5] = z;
        continue;
      }
      this.positions[k] = x;
      this.positions[k + 1] = y;
      this.positions[k + 2] = z;
      this.positions[k + 3] = x - windX * len;
      this.positions[k + 4] = y + fall * len;
      this.positions[k + 5] = z - windZ * len;
    }
    this.geometry.attributes.position.needsUpdate = true;
  }
}
