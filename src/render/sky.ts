/**
 * THE SKY — the Weather Mind's face.
 *
 * A gradient dome, a sun, fog and two lights, all blended between three hand-
 * tuned palettes (dawn / storm / golden hour) by the game's SkyBlend weights.
 * No textures, no post-processing: one small shader and a handful of uniforms.
 */
import {
  BackSide,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import type { SkyBlend } from '../core/game.js';

interface Palette {
  zenith: number;
  horizon: number;
  abyss: number;
  sun: number;
  sunDir: [number, number, number];
  sunSize: number;
  light: number;
  lightIntensity: number;
  skyLight: number;
  groundLight: number;
  hemiIntensity: number;
  fog: number;
  cloud: number;
  cloudShade: number;
}

const PALETTES: Record<keyof SkyBlend, Palette> = {
  dawn: {
    zenith: 0x27407e,
    horizon: 0xf2a184,
    abyss: 0x7d6594,
    sun: 0xffe9c4,
    sunDir: [-0.55, 0.32, -0.77],
    sunSize: 0.9,
    light: 0xfff0dc,
    lightIntensity: 2.9,
    skyLight: 0xa8c8f2,
    groundLight: 0xd98f6e,
    hemiIntensity: 0.95,
    fog: 0xd99a8e,
    cloud: 0xf6d2cf,
    cloudShade: 0x9a6f9c,
  },
  storm: {
    zenith: 0x1c2533,
    horizon: 0x56657a,
    abyss: 0x2b3442,
    sun: 0x9fb0c8,
    sunDir: [0.1, 0.75, -0.65],
    sunSize: 0.25,
    light: 0xa9bcd6,
    lightIntensity: 1.45,
    skyLight: 0x93a9c6,
    groundLight: 0x40495a,
    hemiIntensity: 1.75,
    fog: 0x4a586b,
    cloud: 0x6d7c90,
    cloudShade: 0x333d4c,
  },
  golden: {
    zenith: 0x2a4690,
    horizon: 0xf29a45,
    abyss: 0x9c4a3c,
    sun: 0xffe2a0,
    sunDir: [0.72, 0.22, -0.66],
    sunSize: 1.25,
    light: 0xffd28a,
    lightIntensity: 2.7,
    skyLight: 0xffd9b0,
    groundLight: 0xd9703a,
    hemiIntensity: 1.2,
    fog: 0xe0935a,
    cloud: 0xffcf9a,
    cloudShade: 0xb5553c,
  },
};

const KEYS = ['dawn', 'storm', 'golden'] as const;
const tmp = new Color();

function blendColor(out: Color, sky: SkyBlend, pick: (p: Palette) => number): Color {
  out.setRGB(0, 0, 0);
  for (const k of KEYS) {
    tmp.setHex(pick(PALETTES[k]));
    out.r += tmp.r * sky[k];
    out.g += tmp.g * sky[k];
    out.b += tmp.b * sky[k];
  }
  return out;
}

const blendNum = (sky: SkyBlend, pick: (p: Palette) => number): number =>
  pick(PALETTES.dawn) * sky.dawn + pick(PALETTES.storm) * sky.storm + pick(PALETTES.golden) * sky.golden;

export class Sky {
  readonly group = new Group();
  readonly sun = new DirectionalLight(0xffffff, 2);
  readonly hemi = new HemisphereLight(0xffffff, 0x888888, 1);
  readonly fog = new Fog(0xffffff, 6, 60);
  /** Colours other views borrow so everything sits in the same light. */
  readonly cloud = new Color();
  readonly cloudShade = new Color();
  readonly horizon = new Color();
  readonly sunColor = new Color();
  readonly sunDir = new Vector3(0, 1, 0);
  /** 0..1 lightning flash; decays by itself. */
  flash = 0;

  private readonly material: ShaderMaterial;
  private readonly dome: Mesh;

  constructor(scene: Scene) {
    this.material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new Color() },
        uHorizon: { value: new Color() },
        uAbyss: { value: new Color() },
        uSun: { value: new Color() },
        uSunDir: { value: new Vector3(0, 1, 0) },
        uSunSize: { value: 1 },
        uFlash: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww; // always at the far plane
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uAbyss; uniform vec3 uSun;
        uniform vec3 uSunDir; uniform float uSunSize; uniform float uFlash;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHorizon, uZenith, pow(clamp(h * 1.25, 0.0, 1.0), 0.5));
          col = mix(col, uAbyss, smoothstep(0.04, -0.4, h));
          float s = max(dot(d, normalize(uSunDir)), 0.0);
          // Three terms: the disc, the tight halo, and the broad sky glow that
          // makes the sun feel like it is lighting the air, not painted on it.
          col += uSun * (pow(s, 900.0 / uSunSize) * 2.6 + pow(s, 26.0) * 0.55 * uSunSize + pow(s, 4.0) * 0.22 * uSunSize);
          col += vec3(0.75, 0.82, 1.0) * uFlash * (0.35 + 0.65 * smoothstep(-0.2, 0.6, h));
          // 8-bit banding in a smooth gradient is the loudest "this is CG" tell
          // there is; a fraction of a code value of noise removes it.
          float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          col += (dither - 0.5) / 255.0;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new Mesh(new SphereGeometry(80, 64, 40), this.material);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.group.add(this.dome);
    this.group.add(this.hemi);
    this.group.add(this.sun);
    this.group.add(this.sun.target);
    scene.fog = this.fog;
    scene.background = null;
  }

  /** The room has its own walls; the sky dome is for the outdoor build. */
  hideDome(): void {
    this.dome.visible = false;
  }

  /** Call when lightning strikes. */
  strike(power = 1): void {
    this.flash = Math.max(this.flash, power);
  }

  update(sky: SkyBlend, dt: number, viewX: number, viewY: number, viewZ: number): void {
    const u = this.material.uniforms;
    blendColor(u.uZenith.value as Color, sky, (p) => p.zenith);
    blendColor(u.uHorizon.value as Color, sky, (p) => p.horizon);
    blendColor(u.uAbyss.value as Color, sky, (p) => p.abyss);
    blendColor(u.uSun.value as Color, sky, (p) => p.sun);
    this.horizon.copy(u.uHorizon.value as Color);
    this.sunColor.copy(u.uSun.value as Color);
    const dir = this.sunDir.set(0, 0, 0);
    for (const k of KEYS) {
      const d = PALETTES[k].sunDir;
      dir.x += d[0] * sky[k];
      dir.y += d[1] * sky[k];
      dir.z += d[2] * sky[k];
    }
    dir.normalize();
    (u.uSunDir.value as Vector3).copy(dir);
    u.uSunSize.value = blendNum(sky, (p) => p.sunSize);

    // lightning: a hard flash with a flicker on the way down
    this.flash = Math.max(0, this.flash - dt * 2.6);
    const f = this.flash * this.flash * (0.75 + 0.25 * Math.sin(this.flash * 40));
    u.uFlash.value = f;

    blendColor(this.sun.color, sky, (p) => p.light);
    this.sun.intensity = blendNum(sky, (p) => p.lightIntensity) + f * 5;
    // the key light comes from the sun's side but from in front of the diorama, so faces toward the player are lit
    const lx = dir.x * 0.8, ly = Math.max(0.55, dir.y + 0.4), lz = 0.62;
    this.sun.position.set(viewX + lx * 10, viewY + ly * 10, viewZ + lz * 10);
    this.sun.target.position.set(viewX, viewY, viewZ);
    blendColor(this.hemi.color, sky, (p) => p.skyLight);
    blendColor(this.hemi.groundColor, sky, (p) => p.groundLight);
    this.hemi.intensity = blendNum(sky, (p) => p.hemiIntensity) + f * 2;

    blendColor(this.fog.color, sky, (p) => p.fog);
    this.fog.near = 1.6 - 0.7 * sky.storm;
    this.fog.far = 9 - 4.2 * sky.storm;
    blendColor(this.cloud, sky, (p) => p.cloud);
    blendColor(this.cloudShade, sky, (p) => p.cloudShade);

    this.dome.position.set(viewX, viewY, viewZ);
  }
}
