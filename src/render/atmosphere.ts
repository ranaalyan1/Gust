/**
 * AIR, LIGHT AND A SKY IN A JAR
 *
 * Two things were missing from the look, and both of them are air.
 *
 * 1. **Nothing in the room could reflect anything.** Brass, varnish and glass
 *    are metals and dielectrics: they are *only* their reflections. With no
 *    environment they can do nothing but show a highlight, which is why the
 *    case read as fat yellow plastic and the desk as brown paper. So the room
 *    is baked once into a small prefiltered environment (PMREM) built from a
 *    gradient with one warm bulb in it — a real key, a cool window, and dark
 *    wood — and handed to three as `scene.environment`. No HDR file, no
 *    network, one bake at start-up.
 *
 * 2. **The world inside the bell jar was floating in a black box.** A specimen
 *    is interesting because it holds weather; the jar had none. So the case
 *    gets its own sky: a gradient from a warm haze at the velvet to deep
 *    indigo at the dome, with a low sun in it, a scatter of faint stars, a
 *    sea of mist around the roots of the islands, and two lights — one warm
 *    from the lamp's side, one cold from the window's — so the moss, the
 *    stone and the seed are lit as objects in a world rather than as props on
 *    a shelf.
 *
 * Everything here is generated at start-up and costs, per frame, one uniform
 * write per light and a slow drift on forty mist puffs.
 */
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  PointLight,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  type Texture,
  Vector3,
  type WebGLRenderer,
} from '@iwsdk/core';
import { hash01 } from '../core/random.js';
import type { SkyBlend } from '../core/game.js';
import { blobTexture } from './blob.js';

/* ── the room, as something to reflect ───────────────────────────────────── */

/**
 * A tiny scene that is *only* the light in the room: a warm dome, a cool
 * panel where the window is, and one bulb eight times brighter than anything
 * else. Rendered through PMREM this becomes the reflection every metal and
 * every varnished surface has been missing.
 */
export function buildRoomEnvironment(renderer: WebGLRenderer): Texture {
  const env = new Scene();

  const domeMat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new Color(0x0c0f16) },
      uHorizon: { value: new Color(0x6f4a30) },
      uBottom: { value: new Color(0x090705) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = mix(uHorizon, uTop, smoothstep(0.0, 0.75, h));
        c = mix(c, uBottom, smoothstep(0.0, -0.55, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  env.add(new Mesh(new SphereGeometry(14, 32, 20), domeMat));

  // the bulb: small, and much brighter than the room. In a prefiltered
  // environment this is what a brass collar actually picks up.
  const bulb = new Mesh(
    new SphereGeometry(0.62, 18, 12),
    new MeshBasicMaterial({ color: new Color(1.0, 0.72, 0.42).multiplyScalar(9) }),
  );
  bulb.position.set(-5.2, 2.1, 1.4);
  env.add(bulb);

  const halo = new Mesh(
    new SphereGeometry(1.9, 20, 14),
    new MeshBasicMaterial({ color: new Color(0.85, 0.5, 0.24).multiplyScalar(0.55) }),
  );
  halo.position.copy(bulb.position);
  env.add(halo);

  // the window, off frame to the right: a cold, wide panel
  const window = new Mesh(
    new SphereGeometry(1.8, 16, 12),
    new MeshBasicMaterial({ color: new Color(0.32, 0.46, 0.66).multiplyScalar(1.25) }),
  );
  window.position.set(6.5, 1.6, -2.6);
  window.scale.set(0.35, 1.6, 1.9);
  env.add(window);

  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(env, 0.02, 0.1, 40);
  pmrem.dispose();
  domeMat.dispose();
  env.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const m = mesh.material as MeshBasicMaterial | undefined;
    if (m && 'dispose' in m) m.dispose();
  });
  return target.texture;
}

/* ── the sky inside the case ─────────────────────────────────────────────── */

const CASE_SKY_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const CASE_SKY_FRAG = /* glsl */ `
  varying vec3 vWorld;
  uniform vec3 uLow;
  uniform vec3 uMid;
  uniform vec3 uHigh;
  uniform vec3 uSunCol;
  uniform vec3 uSunDir;
  uniform float uBase;
  uniform float uTop;
  uniform float uTime;
  uniform vec3 uCentre;

  float hash(vec2 p) {
    p = fract(p * vec2(233.34, 851.73));
    p += dot(p, p + 23.45);
    return fract(p.x * p.y);
  }

  void main() {
    float h = clamp((vWorld.y - uBase) / max(0.0001, uTop - uBase), 0.0, 1.0);
    vec3 col = mix(uLow, uMid, smoothstep(0.0, 0.62, h));
    col = mix(col, uHigh, smoothstep(0.42, 1.0, h));

    vec3 d = normalize(vWorld - uCentre);
    float s = max(dot(d, normalize(uSunDir)), 0.0);
    // the low sun: a broad atmospheric glow, then the disc itself
    col += uSunCol * (pow(s, 8.0) * 0.34 + pow(s, 60.0) * 0.55 + pow(s, 620.0) * 1.4);

    // ── two ranges of far hills ──
    //
    // The one thing a diorama sky needs is something at a distance. Two
    // silhouettes, one behind the other, hazier the further back they are, and
    // the case stops being a dark box with islands in it and becomes a place
    // with a horizon.
    float az = atan(d.z, d.x);
    float far = 0.315 + 0.055 * sin(az * 2.3 + 1.1) + 0.028 * sin(az * 5.1 + 0.4) + 0.015 * sin(az * 11.0);
    float near = 0.255 + 0.045 * sin(az * 3.7 + 2.4) + 0.022 * sin(az * 8.3 + 1.7);
    float farMask = smoothstep(far, far - 0.004, h) * smoothstep(0.06, 0.1, h);
    float nearMask = smoothstep(near, near - 0.004, h) * smoothstep(0.06, 0.1, h);
    float haze = smoothstep(0.0, 0.42, far - h);
    col = mix(col, mix(uMid, uLow, 0.45) * 0.85, farMask * 0.75);
    col = mix(col, mix(uLow, uHigh, 0.35) * 0.9, nearMask * 0.85);
    col += uSunCol * nearMask * 0.06 * (1.0 - haze);

    // a thin veil of high cloud, drawn as slow noise on the dome
    float band = sin(d.y * 14.0 + sin(d.x * 4.0 + uTime * 0.05) * 0.8 + uTime * 0.012) * 0.5 + 0.5;
    band *= smoothstep(0.35, 0.9, h) * smoothstep(1.0, 0.78, h);
    col += uSunCol * band * 0.030;

    // stars. A specimen sky has a few, and they are what makes the top of the
    // jar read as distance rather than as a dark lid.
    vec2 q = floor(vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) * vec2(46.0, 60.0));
    float r = hash(q);
    float star = pow(smoothstep(0.9965, 1.0, r), 2.0);
    float tw = 0.62 + 0.38 * sin(uTime * 1.6 + r * 40.0);
    col += vec3(0.86, 0.92, 1.0) * star * tw * smoothstep(0.35, 0.9, h);

    // the haze thickens toward the velvet, so the roots of the islands sit in
    // air instead of being cut out with scissors
    float a = smoothstep(0.0, 0.20, h) * 0.74;
    gl_FragColor = vec4(col, a);
  }
`;

export interface CaseSkyOptions {
  /** Radius of the jar, in the room's own units. */
  radius: number;
  /** World-y of the velvet the world floats over. */
  baseY: number;
  /** World-y of the brass collar. */
  collarY: number;
  /** How far the dome rises above the collar. */
  domeRise: number;
}

/**
 * The weather inside the bell jar: sky, sun, stars, mist, and the two lights
 * that pick the moss out of the dark.
 */
export class CaseAtmosphere {
  readonly group = new Group();
  /** Warm key, from the lamp's side of the case. */
  readonly key: PointLight;
  /** Cold kicker, from the window's side, to separate the far island. */
  readonly fill: PointLight;
  private readonly shell: Mesh;
  private readonly cap: Mesh;
  private readonly mist: Points;
  private readonly mistPos: Float32Array;
  private readonly mistSeeds: Float32Array;
  private readonly mistCount: number;
  private readonly motes: Points;
  private readonly motePos: Float32Array;
  private readonly moteSeeds: Float32Array;
  private readonly sun: Sprite;
  private readonly material: ShaderMaterial;
  private readonly sunDir = new Vector3(-0.72, 0.26, 0.38).normalize();
  private readonly tmp = new Color();

  constructor(private readonly opts: CaseSkyOptions) {
    const { radius, baseY, collarY, domeRise } = opts;
    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: BackSide,
      fog: false,
      uniforms: {
        uLow: { value: new Color(0x5c2f24) },
        uMid: { value: new Color(0x1e2445) },
        uHigh: { value: new Color(0x080b16) },
        uSunCol: { value: new Color(0xffcf92) },
        uSunDir: { value: this.sunDir },
        uBase: { value: baseY },
        uTop: { value: collarY + domeRise },
        uTime: { value: 0 },
        uCentre: { value: new Vector3(0, baseY, 0) },
      },
      vertexShader: CASE_SKY_VERT,
      fragmentShader: CASE_SKY_FRAG,
    });

    const wallH = Math.max(0.02, collarY - baseY);
    this.shell = new Mesh(
      new CylinderGeometry(radius, radius, wallH, 48, 1, true),
      this.material,
    );
    this.shell.position.y = baseY + wallH * 0.5;
    this.shell.renderOrder = 1;

    this.cap = new Mesh(
      new SphereGeometry(radius, 48, 18, 0, Math.PI * 2, 0, Math.PI / 2),
      this.material,
    );
    this.cap.scale.y = domeRise / radius;
    this.cap.position.y = collarY;
    this.cap.renderOrder = 1;

    this.group.add(this.shell, this.cap);

    // the sun itself: a soft disc where the sky glow is brightest. Additive and
    // tiny, so it reads as a light rather than as a ball.
    this.sun = new Sprite(
      new SpriteMaterial({
        map: blobTexture(),
        color: 0xffd9a0,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    const r = radius * 0.9;
    this.sun.position.set(this.sunDir.x * r, collarY + this.sunDir.y * domeRise * 0.82, this.sunDir.z * r);
    this.sun.scale.setScalar(radius * 0.42);
    this.sun.renderOrder = 2;
    this.group.add(this.sun);

    // ── a sea of mist, low in the jar ──
    this.mistCount = 54;
    this.mistPos = new Float32Array(this.mistCount * 3);
    this.mistSeeds = new Float32Array(this.mistCount * 4);
    const geo = new BufferGeometry();
    const attr = new BufferAttribute(this.mistPos, 3);
    attr.setUsage(DynamicDrawUsage);
    geo.setAttribute('position', attr);
    const mistMat = new PointsMaterial({
      map: blobTexture(),
      color: 0xffd9b4,
      size: 0.028,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: AdditiveBlending,
      sizeAttenuation: true,
      fog: false,
    });
    this.mist = new Points(geo, mistMat);
    this.mist.frustumCulled = false;
    this.mist.renderOrder = 3;
    this.group.add(this.mist);
    for (let i = 0; i < this.mistCount; i++) {
      const a = hash01(i * 7 + 1) * Math.PI * 2;
      const rr = Math.sqrt(hash01(i * 7 + 2)) * radius * 0.86;
      this.mistSeeds[i * 4] = a;
      this.mistSeeds[i * 4 + 1] = rr;
      this.mistSeeds[i * 4 + 2] = hash01(i * 7 + 3);
      this.mistSeeds[i * 4 + 3] = hash01(i * 7 + 4);
    }

    // a scatter of brighter motes, high in the jar: the dust that catches the
    // light in the air of a room where one lamp is on
    const moteCount = 34;
    this.motePos = new Float32Array(moteCount * 3);
    this.moteSeeds = new Float32Array(moteCount * 4);
    const mgeo = new BufferGeometry();
    const mattr = new BufferAttribute(this.motePos, 3);
    mattr.setUsage(DynamicDrawUsage);
    mgeo.setAttribute('position', mattr);
    this.motes = new Points(
      mgeo,
      new PointsMaterial({
        map: blobTexture(),
        color: 0xffe7c2,
        size: 0.0075,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: AdditiveBlending,
        sizeAttenuation: true,
        fog: false,
      }),
    );
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 4;
    this.group.add(this.motes);
    for (let i = 0; i < moteCount; i++) {
      this.moteSeeds[i * 4] = hash01(i * 13 + 3) * Math.PI * 2;
      this.moteSeeds[i * 4 + 1] = Math.sqrt(hash01(i * 13 + 5)) * radius * 0.8;
      this.moteSeeds[i * 4 + 2] = hash01(i * 13 + 7);
      this.moteSeeds[i * 4 + 3] = hash01(i * 13 + 9);
    }

    // ── the two lights ──
    // Point lights are in world units; the room is authored small and scaled
    // down as one object, so these distances are already the short ones.
    this.key = new PointLight(0xffd2a0, 0.22, 0.95, 2);
    this.key.position.set(-radius * 0.42, baseY + (collarY - baseY) * 0.72, radius * 0.3);
    this.fill = new PointLight(0x9dc4ff, 0.05, 1.1, 2);
    this.fill.position.set(radius * 0.55, baseY + (collarY - baseY) * 0.55, -radius * 0.35);
    this.group.add(this.key, this.fill);
  }

  /** Blend the case sky toward the act's palette. Called once per frame. */
  update(sky: SkyBlend, time: number): void {
    const u = this.material.uniforms;
    // Three palettes, three moods; the weights always sum to one. Hex, never
    // raw components: a colour written into a shader as 0.12 is *linear*, and
    // treating sRGB fractions as linear is how skies turn to milk.
    const mix = (out: Color, entries: readonly [number, keyof SkyBlend][]) => {
      out.setRGB(0, 0, 0);
      for (const [hex, key] of entries) {
        const w = sky[key];
        if (w <= 0) continue;
        this.tmp.setHex(hex);
        out.r += this.tmp.r * w;
        out.g += this.tmp.g * w;
        out.b += this.tmp.b * w;
      }
      return out;
    };

    // dawn: rose and gold. storm: slate and iron. golden: amber and plum.
    mix(u.uLow.value as Color, [[0xa85a3c, 'dawn'], [0x3a4552, 'storm'], [0xcc6c38, 'golden']]);
    mix(u.uMid.value as Color, [[0x353d66, 'dawn'], [0x232c3c, 'storm'], [0x5a3a52, 'golden']]);
    mix(u.uHigh.value as Color, [[0x0a0d1c, 'dawn'], [0x090c14, 'storm'], [0x140d22, 'golden']]);
    const sun = mix(new Color(), [[0xffd0a0, 'dawn'], [0xa9bbd0, 'storm'], [0xffb066, 'golden']]);
    (u.uSunCol.value as Color).copy(sun);
    u.uTime.value = time;

    (this.sun.material as SpriteMaterial).color.copy(sun);
    this.key.color.copy(sun);
    this.key.intensity = 0.20 + 0.09 * sky.golden + 0.04 * sky.dawn;
    this.fill.intensity = 0.045 + 0.03 * sky.storm;

    // mist drifts around the specimen on the case's own slow time
    const pos = this.mistPos;
    for (let i = 0; i < this.mistCount; i++) {
      const j = i * 4;
      const a = this.mistSeeds[j] + time * (0.016 + this.mistSeeds[j + 2] * 0.02);
      const rr = this.mistSeeds[j + 1] * (1 + 0.04 * Math.sin(time * 0.3 + i));
      const lift = this.mistSeeds[j + 2];
      const h = this.opts.baseY + 0.012 + lift * 0.075 + Math.sin(time * 0.22 + i * 1.7) * 0.008;
      pos[i * 3] = Math.cos(a) * rr;
      pos[i * 3 + 1] = h;
      pos[i * 3 + 2] = Math.sin(a) * rr;
    }
    (this.mist.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;

    // motes wander on a slow, independent drift
    const mp = this.motePos;
    for (let i = 0; i < this.motePos.length / 3; i++) {
      const j = i * 4;
      const a = this.moteSeeds[j] + time * (0.05 + this.moteSeeds[j + 2] * 0.05);
      const rr = this.moteSeeds[j + 1] * (1 + 0.05 * Math.sin(time * 0.4 + i * 2.1));
      const lift = this.moteSeeds[j + 3];
      const top = this.opts.collarY + this.opts.domeRise * 0.8;
      mp[i * 3] = Math.cos(a) * rr;
      mp[i * 3 + 1] = this.opts.baseY + 0.03 + lift * (top - this.opts.baseY) * 0.72 + Math.sin(time * 0.3 + i) * 0.012;
      mp[i * 3 + 2] = Math.sin(a) * rr;
    }
    (this.motes.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }
}
