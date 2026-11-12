/**
 * THE LOOK
 *
 * Everything that makes the diorama read as a lit object in a room rather than
 * a flat illustration. Kept in one place so the whole game's "camera" can be
 * re-tuned without hunting through builders.
 *
 * What is here, and why:
 *
 *  - ACES filmic tone mapping. Without it, the brightest sky and the sun disc
 *    clip to flat white and the mid-tones stay muddy; with it, highlights roll
 *    off like film, which is most of the difference between "render" and
 *    "photograph". (Reference: Red Matter 2, Kayak VR — both live on highlight
 *    roll-off.)
 *  - A real shadow map from the sun. Flat-shaded low-poly scenery with no
 *    contact shadows reads as pasted onto the background; a single directional
 *    shadow is what makes an island feel like it is *sitting* in the air.
 *    (Reference: Moss, Astro Bot — every diorama object is anchored by a
 *    shadow.)
 *  - A rim light on every opaque surface, so silhouettes separate from the sky.
 *    In a headset you perceive objects partly by their edge against the void;
 *    a fresnel rim does the work a real lens would. (Reference: Walkabout Mini
 *    Golf's readability at distance.)
 *  - A calmer cloud sea, so the foreground stops competing with the play space.
 *
 * Everything is applied once, at build time, and costs no per-frame CPU.
 */
import {
  ACESFilmicToneMapping,
  Color,
  type DirectionalLight,
  Mesh,
  MeshLambertMaterial,
  type Object3D,
  PCFShadowMap,
  type WebGLRenderer,
} from '@iwsdk/core';

/** Shadow map size. 1024 is deliberate: Quest 3 holds 72 Hz with it. */
const SHADOW_SIZE = 1024;

/** Half-extent of the sun's shadow frustum, in metres of world space. */
const SHADOW_EXTENT = 2.8;

export interface LookOptions {
  quality: number;
}

/** Renderer-level settings. Call once, before the first frame. */
export function configureRenderer(renderer: WebGLRenderer, options: LookOptions): void {
  // Filmic response. Exposure is tuned so the dawn palette keeps its pastels
  // instead of being crushed by the curve.
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;

  // ?quality=0.5 is the "please run on a tired device" path: shadows are the
  // first thing to go, because they are the most expensive thing here.
  renderer.shadowMap.enabled = options.quality >= 1;
  renderer.shadowMap.type = PCFShadowMap;
  // The sun moves but never turns off; shadows only need rebuilding when
  // something in the world changes, which is most frames, so leave it on.
  renderer.shadowMap.autoUpdate = true;


}

/**
 * Set the sun up to cast. The light itself is re-positioned every frame by
 * {@link Sky.update}; the frustum is pushed to the light, so it follows.
 */
export function configureSunShadows(sun: DirectionalLight): void {
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
  sun.shadow.camera.left = -SHADOW_EXTENT;
  sun.shadow.camera.right = SHADOW_EXTENT;
  sun.shadow.camera.top = SHADOW_EXTENT;
  sun.shadow.camera.bottom = -SHADOW_EXTENT;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 26;
  sun.shadow.bias = -0.0007;
  sun.shadow.normalBias = 0.022;
  sun.shadow.radius = 3.0;
  sun.shadow.camera.updateProjectionMatrix();
}

/**
 * Walk the built world once: give every opaque, lit surface shadows and a rim.
 * Additive effects (rings, sunbeams, particles) are deliberately skipped —
 * they are light, not matter, and must never occlude.
 */
export function dressScene(root: Object3D): void {
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
    const material = mesh.material;
    if (Array.isArray(material)) return;
    if (!(material instanceof MeshLambertMaterial)) return;
    if (material.transparent) return; // rings, beams, glow

    mesh.castShadow = true;
    // A few things (the cloud sea) opt out of receiving: air does not hold a
    // hard shadow, and faking one there looked like dirt.
    mesh.receiveShadow = mesh.userData.noShadowReceive !== true;
    addRimLight(material);
  });
}

const RIM_TINT = new Color(0xfff0dc);
const rimmed = new WeakSet<MeshLambertMaterial>();

/**
 * Fresnel rim. Chained onto whatever `onBeforeCompile` the material already
 * has (the islands use theirs for the bloom wave front), so this can be
 * applied to any finished material without clobbering it.
 */
export function addRimLight(
  material: MeshLambertMaterial,
  color: Color = RIM_TINT,
  strength = 0.26,
  power = 3.0,
): void {
  if (rimmed.has(material)) return;
  rimmed.add(material);

  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);

    // A plain uniform object is enough: each compilation reads these values.
    shader.uniforms.uRimColor = { value: color.clone() };
    shader.uniforms.uRimStrength = { value: strength };
    shader.uniforms.uRimPower = { value: power };

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform vec3 uRimColor;',
          'uniform float uRimStrength;',
          'uniform float uRimPower;',
        ].join('\n'),
      )
      // `outgoingLight` exists in every lit three material just before the
      // opaque fragment, which makes this a one-line, low-risk injection.
      .replace(
        '#include <opaque_fragment>',
        [
          '{',
          '  // Flat-shaded geometry has no interpolated normal; take it from the',
          '  // screen-space derivatives, exactly as three does for FLAT_SHADED.',
          '  vec3 rimN = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));',
          '  vec3 rimV = normalize(vViewPosition);',
          '  float rim = pow(1.0 - clamp(dot(rimN, rimV), 0.0, 1.0), uRimPower);',
          '  outgoingLight += uRimColor * rim * uRimStrength;',
          '}',
          '#include <opaque_fragment>',
        ].join('\n'),
      );
  };

  // Force a recompile so the injection takes effect even if the material has
  // already been used by a previous frame.
  material.needsUpdate = true;
}
