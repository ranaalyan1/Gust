/**
 * THE LENS
 *
 * Everything up to here has been a rendering. A photograph of a desk is not a
 * rendering: it is a lens with a focal plane, a little halation around the
 * brightest thing in frame, grain in the shadows and a corner that goes soft.
 *
 * So this is a small, hand-written post chain — no composer, no addons:
 *
 *   1. the scene renders to a half-float target, in linear light (three skips
 *      tone mapping when the destination is not the canvas, which is exactly
 *      what we want: tone mapping happens once, at the end, here);
 *   2. a half-resolution blur, mixed back in through a tilt-shift band: the
 *      glass stays sharp, the desk in front of it and the room behind it come
 *      apart. A tabletop specimen photographed from a chair is exactly what a
 *      tilt-shift lens is for, and it is stable, because the camera is;
 *   3. a quarter-resolution bright pass, blurred, for halation around the bulb
 *      and the highlights;
 *   4. one composite: defocus, bloom, ACES, a breath of chromatic fringing at
 *      the frame edge, vignette, grain, sRGB.
 *
 * It runs in the browser only. In a headset the renderer draws straight to the
 * XR framebuffer: a focal plane is the one thing you cannot fake when your eye
 * can change focus by itself.
 */
import {
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  type PerspectiveCamera,
  Vector2,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from '@iwsdk/core';

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** 4-tap box downsample; cheaper and calmer than a wide gaussian. */
const DOWN_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  void main() {
    vec4 c = texture2D(tSrc, vUv + uTexel * vec2(-0.5, -0.5));
    c += texture2D(tSrc, vUv + uTexel * vec2(0.5, -0.5));
    c += texture2D(tSrc, vUv + uTexel * vec2(-0.5, 0.5));
    c += texture2D(tSrc, vUv + uTexel * vec2(0.5, 0.5));
    gl_FragColor = c * 0.25;
  }
`;

/** Separable gaussian with a radius in texels, nine taps. */
const BLUR_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tSrc;
  uniform vec2 uDir;
  uniform float uRadius;
  void main() {
    float w[5];
    w[0] = 0.2270270; w[1] = 0.1945946; w[2] = 0.1216216; w[3] = 0.0540540; w[4] = 0.0162162;
    vec4 sum = texture2D(tSrc, vUv) * w[0];
    for (int i = 1; i < 5; i++) {
      vec2 off = uDir * uRadius * float(i);
      sum += texture2D(tSrc, vUv + off) * w[i];
      sum += texture2D(tSrc, vUv - off) * w[i];
    }
    gl_FragColor = sum;
  }
`;

/** Bright pass: keep what a lens would flare, at quarter resolution. */
const BRIGHT_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tSrc;
  uniform float uThreshold;
  void main() {
    vec3 c = texture2D(tSrc, vUv).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float keep = smoothstep(uThreshold, uThreshold * 2.4, l);
    gl_FragColor = vec4(c * keep, 1.0);
  }
`;

const COMPOSITE_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D tScene;
  uniform sampler2D tDof;
  uniform sampler2D tBloom;
  uniform vec2 uRes;
  uniform float uFocusY;
  uniform float uBand;
  uniform float uTilt;
  uniform float uBloom;
  uniform float uExposure;
  uniform float uVignette;
  uniform float uGrain;
  uniform float uTime;
  uniform float uDebug;
  uniform vec3 uLamp;   // the bulb, in screen space (uv + whether it is on screen)
  uniform float uLampOn;

  vec3 aces(vec3 x) {
    const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  vec3 encodeSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(0.41666)) - 0.055, step(0.0031308, c));
  }

  void main() {
    vec2 uv = vUv;

    // Defocus as a tilt-shift lens, not as a depth solve.
    //
    // This is the honest choice for the picture: the subject is a specimen on a
    // desk, photographed from a chair, and a tilt-shift is exactly how such a
    // thing is photographed. A band across the glass stays sharp; the desk in
    // front of it and the room behind it fall away. It also costs nothing to
    // stabilise, because the camera does not move.
    vec2 lens = (uv - vec2(0.5, uFocusY)) * vec2(uTilt, 1.0);
    float coc = pow(smoothstep(uBand, uBand + 0.46, length(lens)), 1.35) * 0.86;

    if (uDebug > 0.5) {
      if (uDebug < 1.5) { gl_FragColor = vec4(encodeSRGB(aces(texture2D(tScene, uv).rgb * uExposure)), 1.0); return; }
      if (uDebug < 3.5) { gl_FragColor = vec4(encodeSRGB(aces(texture2D(tDof, uv).rgb * uExposure)), 1.0); return; }
      if (uDebug < 4.0) { gl_FragColor = vec4(vec3(coc), 1.0); return; }
      if (uDebug < 4.5) { gl_FragColor = vec4(texture2D(tBloom, uv).rgb, 1.0); return; }
      return;
    }
    vec2 fromCentre = uv - 0.5;
    float radius = length(fromCentre * vec2(uRes.x / uRes.y, 1.0));

    // a lens does not agree with itself at the edges: split the red and blue
    // by a fraction of a pixel, scaled by how far out we are
    float fringe = 0.0016 * radius * radius;
    vec3 sharp;
    sharp.r = texture2D(tScene, uv + fromCentre * fringe).r;
    sharp.g = texture2D(tScene, uv).g;
    sharp.b = texture2D(tScene, uv - fromCentre * fringe).b;

    vec3 soft = texture2D(tDof, uv).rgb;
    vec3 colour = mix(sharp, soft, coc);

    // halation
    colour += texture2D(tBloom, uv).rgb * uBloom;

    // exposure, film curve
    colour *= uExposure;
    colour = aces(colour);

    // A colour negative, not a render. Film does three things a linear image
    // does not: it has a base fog, so black sits just above zero; its shadows
    // drift cool while its highlights stay warm; and it rolls the midtones
    // through an S. Twenty lines, and the difference between a screenshot and
    // a photograph on somebody's desk.
    float filmLuma = dot(colour, vec3(0.2126, 0.7152, 0.0722));
    colour = mix(colour, colour * vec3(0.90, 0.97, 1.10), 1.0 - smoothstep(0.0, 0.42, filmLuma));
    colour = colour * colour * (3.0 - 2.0 * colour) * 0.30 + colour * 0.70;
    colour = colour * 0.955 + vec3(0.014, 0.012, 0.011);

    // vignette: a real lens loses light at the corners, and so does a desk
    // seen across its own shadow
    colour *= mix(1.0, smoothstep(1.15, 0.25, radius), uVignette);

    // grain, heavier in the shadows than in the highlights, like film
    float g = hash(uv * uRes + fract(uTime) * 91.7) - 0.5;
    float luma = dot(colour, vec3(0.2126, 0.7152, 0.0722));
    colour += g * uGrain * (1.0 - luma * 0.7);

    // A lens does not stay clean with a bare bulb in frame.
    //
    // This is not decoration. Every photograph anyone has taken of a desk lamp
    // at night carries the same three things: a veiling glare that lifts the
    // whole frame near the source, a horizontal streak off the aperture blades,
    // and a chain of small ghosts marching along the line through the centre of
    // the frame. They are what the eye reads as "a camera was here".
    if (uLampOn > 0.5) {
      vec2 toLamp = uv - uLamp.xy;
      float dl = length(toLamp);

      // veiling glare: a very wide, very weak lift
      colour += vec3(1.0, 0.78, 0.52) * 0.030 / (1.0 + dl * dl * 30.0);

      // the streak: horizontal, narrow, long
      float streak = exp(-abs(toLamp.y) * 300.0) * exp(-abs(toLamp.x) * 9.0);
      colour += vec3(1.0, 0.74, 0.46) * streak * 0.10;

      // ghosts, along the line from the bulb through the centre of the frame
      vec2 axis = vec2(0.5) - uLamp.xy;
      for (int i = 0; i < 4; i++) {
        float t = 0.55 + float(i) * 0.42;
        vec2 g = uLamp.xy + axis * t * 1.35;
        float r = 0.012 + float(i) * 0.011;
        float gd = length((uv - g) * vec2(1.0, 1.0));
        float ring = smoothstep(r, r * 0.55, gd);
        vec3 tint = i == 1 ? vec3(0.35, 0.62, 0.95) : (i == 2 ? vec3(0.95, 0.55, 0.30) : vec3(1.0, 0.86, 0.66));
        colour += tint * ring * (0.028 - float(i) * 0.005);
      }
    }

    gl_FragColor = vec4(encodeSRGB(max(colour, 0.0)), 1.0);
  }
`;

interface Target {
  rt: WebGLRenderTarget;
  w: number;
  h: number;
}

export interface PostOptions {
  /** 0 leans off, 1 is the house look. */
  strength?: number;
  /** Blur radius in texels at half resolution. */
  blurPx?: number;
  /** Show one intermediate stage instead of the print. */
  debug?: number;
}

export class Post {
  private readonly quad: Mesh;
  private readonly quadScene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly sceneRoot: Scene;
  private readonly down: ShaderMaterial;
  private readonly blur: ShaderMaterial;
  private readonly bright: ShaderMaterial;
  private readonly composite: ShaderMaterial;

  private scene_rt: Target;
  private dofA: Target;
  private dofB: Target;
  private bloomA: Target;
  private bloomB: Target;

  private width = 0;
  private height = 0;
  private readonly strength: number;
  private readonly blurPx: number;
  private time = 0;
  /** The bulb, in world space, and whether there is one to flare. */
  readonly lampWorld = new Vector3();
  private readonly lampNdc = new Vector3();
  lampPresent = false;
  /** 1 = sharp scene, 2 = raw depth, 3 = defocused, 4 = bloom, 5 = view depth. */
  private readonly debug: number;

  constructor(
    private readonly renderer: WebGLRenderer,
    scene: Scene,
    private readonly camera3: PerspectiveCamera,
    opts: PostOptions = {},
  ) {
    this.sceneRoot = scene;
    this.strength = opts.strength ?? 1;
    this.blurPx = opts.blurPx ?? 1.25;
    this.debug = opts.debug ?? 0;

    const geo = new PlaneGeometry(2, 2);
    this.down = new ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: DOWN_FRAG,
      uniforms: { tSrc: { value: null }, uTexel: { value: new Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    this.blur = new ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: BLUR_FRAG,
      uniforms: { tSrc: { value: null }, uDir: { value: new Vector2() }, uRadius: { value: 1 } },
      depthTest: false,
      depthWrite: false,
    });
    this.bright = new ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: BRIGHT_FRAG,
      uniforms: { tSrc: { value: null }, uThreshold: { value: 0.85 } },
      depthTest: false,
      depthWrite: false,
    });
    this.composite = new ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: null },
        tDof: { value: null },
        tBloom: { value: null },
        uRes: { value: new Vector2(1, 1) },
        uFocusY: { value: 0.54 },
        uBand: { value: 0.105 },
        uTilt: { value: 0.55 },
        uBloom: { value: 0.42 * this.strength },
        uExposure: { value: 1.06 },
        uVignette: { value: 0.55 * this.strength },
        uGrain: { value: 0.022 * this.strength },
        uTime: { value: 0 },
        uLamp: { value: new Vector3(0, 0, 0) },
        uLampOn: { value: 0 },
        uDebug: { value: 0 },
      },
    });

    this.quad = new Mesh(geo, this.down);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.scene_rt = this.makeTarget(4, 4, true);

    this.dofA = this.makeTarget(2, 2, false);
    this.dofB = this.makeTarget(2, 2, false);
    this.bloomA = this.makeTarget(2, 2, false);
    this.bloomB = this.makeTarget(2, 2, false);
  }

  private makeTarget(w: number, h: number, depth: boolean): Target {
    const rt = new WebGLRenderTarget(w, h, {
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      // MSAA and a depth *texture* attachment cannot share a framebuffer in
      // WebGL2; the cost of that trade is a little aliasing, not the depth pass
      samples: 0,
    });
    rt.texture.wrapS = rt.texture.wrapT = ClampToEdgeWrapping;
    rt.texture.generateMipmaps = false;
    return { rt, w, h };
  }

  /** Match the drawing buffer; called on start and on every resize. */
  setSize(width: number, height: number): void {
    const w = Math.max(2, Math.floor(width));
    const h = Math.max(2, Math.floor(height));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.scene_rt.rt.setSize(w, h);
    const dw = Math.max(2, Math.floor(w / 2));
    const dh = Math.max(2, Math.floor(h / 2));
    this.dofA.rt.setSize(dw, dh);
    this.dofB.rt.setSize(dw, dh);
    const bw = Math.max(2, Math.floor(w / 4));
    const bh = Math.max(2, Math.floor(h / 4));
    this.bloomA.rt.setSize(bw, bh);
    this.bloomB.rt.setSize(bw, bh);
    (this.composite.uniforms.uRes.value as Vector2).set(w, h);
    this.composite.uniforms.uDebug.value = this.debug;

  }

  /** One full frame, straight to the canvas. */
  render(dt: number, focus: number): void {
    // project the bulb once, here, so the shader has a screen position to
    // attach the flare to
    if (this.lampPresent) {
      const p = this.lampNdc.copy(this.lampWorld).project(this.camera3);
      const onScreen = p.z < 1 && Math.abs(p.x) < 1.35 && Math.abs(p.y) < 1.35;
      this.composite.uniforms.uLamp.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, 0);
      this.composite.uniforms.uLampOn.value = onScreen ? 1 : 0;
    } else {
      this.composite.uniforms.uLampOn.value = 0;
    }
    const r = this.renderer;
    this.time += dt;
    this.composite.uniforms.uTime.value = this.time;
    void focus;

    // 1. the world, linear
    r.setRenderTarget(this.scene_rt.rt);
    r.clear();
    r.render(this.sceneRoot, this.camera3);



    // 2. defocus: downsample, then blur along each axis with the blur radius
    //    fixed wide — the *per-pixel* amount of defocus is chosen by depth in
    //    the composite, which is cheaper and does not band
    this.pass(this.down, { tSrc: this.scene_rt.rt.texture, uTexel: this.texel(this.scene_rt.rt) }, this.dofA, null);
    const dw = this.dofA.rt.width;
    const dh = this.dofA.rt.height;
    this.pass(this.blur, { tSrc: this.dofA.rt.texture, uDir: new Vector2(1 / dw, 0), uRadius: this.blurPx }, this.dofB, null);
    this.pass(this.blur, { tSrc: this.dofB.rt.texture, uDir: new Vector2(0, 1 / dh), uRadius: this.blurPx }, this.dofA, null);

    // 3. halation
    this.pass(this.bright, { tSrc: this.dofA.rt.texture }, this.bloomA, null);
    const bw = this.bloomA.rt.width;
    const bh = this.bloomA.rt.height;
    this.pass(this.blur, { tSrc: this.bloomA.rt.texture, uDir: new Vector2(1 / bw, 0), uRadius: 2.6 }, this.bloomB, null);
    this.pass(this.blur, { tSrc: this.bloomB.rt.texture, uDir: new Vector2(0, 1 / bh), uRadius: 2.6 }, this.bloomA, null);

    // 4. the print
    r.setRenderTarget(null);
    this.composite.uniforms.tScene.value = this.scene_rt.rt.texture;
    this.composite.uniforms.tDof.value = this.dofA.rt.texture;
    this.composite.uniforms.tBloom.value = this.bloomA.rt.texture;

    this.quad.material = this.composite;
    r.render(this.quadScene, this.camera);
  }

  /** One texel of a target, in UV. */
  private texel(rt: WebGLRenderTarget): Vector2 {
    return new Vector2(1 / Math.max(1, rt.width), 1 / Math.max(1, rt.height));
  }

  private pass(mat: ShaderMaterial, uniforms: Record<string, TextureLike>, to: Target, _unused: null): void {
    for (const [k, v] of Object.entries(uniforms)) {
      const u = mat.uniforms[k];
      if (!u) continue;
      u.value = v;
    }
    this.quad.material = mat;
    this.renderer.setRenderTarget(to.rt);
    this.renderer.render(this.quadScene, this.camera);
  }

  dispose(): void {
    for (const t of [this.scene_rt, this.dofA, this.dofB, this.bloomA, this.bloomB]) t.rt.dispose();
    this.down.dispose();
    this.blur.dispose();
    this.bright.dispose();
    this.composite.dispose();
  }
}

type TextureLike = unknown;
