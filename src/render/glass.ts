/**
 * GLASS, BY HAND
 *
 * A physically correct glass needs a transmission pass, a render target and a
 * second scene draw, and after all that it still looks like a plastic bubble at
 * this distance. What reads as glass in a photograph is not refraction. It is
 * three things:
 *
 *   - an edge. Glass is almost invisible face-on and bright at the silhouette,
 *     because at grazing angles a lot more of the room reflects off it;
 *   - two highlights, not one. Light reflects off the near face and the far
 *     face, a fraction of a degree apart, which is why a real jar's highlight
 *     looks doubled;
 *   - a green tint where the glass is thick. The wall of a jar is thicker at
 *     the base than at the rim, and old glass is green there.
 *
 * So this is additive, hand-authored, and it cannot blow out to a milky shell
 * the way an env-mapped MeshStandardMaterial does. Its cost is one blended
 * draw per pane.
 */
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  type ShaderMaterial,
  ShaderMaterial as Material,
  type Texture,
  Vector3,
} from '@iwsdk/core';

const VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vW;
  varying float vH;
  void main() {
    // vH runs 0 at the foot of the piece to 1 at its crown, so the shader can
    // know where the glass is thick
    vH = uv.y;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vN;
  varying vec3 vW;
  varying float vH;
  uniform vec3 uRim;
  uniform vec3 uSpec;
  uniform vec3 uTint;
  uniform vec3 uBulb;
  uniform samplerCube uEnv;
  uniform float uEnvOn;

  float hash(vec2 p) {
    p = fract(p * vec2(233.34, 851.73));
    p += dot(p, p + 23.45);
    return fract(p.x * p.y);
  }

  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);

    // Fresnel, and nothing else, is what makes a sheet of glass visible: nearly
    // nothing face-on, almost a mirror at the silhouette. Everything below is
    // weighted by it, so the middle of the pane stays genuinely clear.
    float fres = 0.035 + 0.965 * pow(1.0 - ndv, 5.0);

    // What the glass actually reflects: the room, because it is a real room and
    // a real jar reflects the lamp, the shelves and the dark behind you. The
    // cube is baked once at start-up; this is one texture fetch per fragment.
    vec3 R = reflect(-V, N);
    vec3 refl = uEnvOn > 0.5 ? textureCube(uEnv, R).rgb : vec3(0.0);

    // two highlights: near face and far face. The second is the reflection in
    // the far wall of the jar, which is what makes glass look thick.
    vec3 L = normalize(uBulb - vW);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 190.0);
    float spec2 = pow(max(dot(-N, H), 0.0), 60.0) * 0.16;

    // thick glass, and old glass, is green at the foot
    float thick = smoothstep(0.42, 0.0, vH);
    // a hand has been on this: dust and fingerprints break the rim up
    float smudge = 0.84 + 0.30 * hash(floor(vW.xz * 620.0));

    vec3 col = mix(uRim * 0.9, refl, 0.72) * fres * 1.35 * smudge;
    col += uSpec * (spec + spec2);
    col += uTint * thick * 0.32;

    float a = clamp(fres * 0.92 * smudge + spec * 0.8 + spec2 * 0.55 + thick * 0.10 + 0.004, 0.0, 1.0);
    gl_FragColor = vec4(col, a);
  }
`;

export interface GlassLook {
  /** Colour of the reflected room in the rim. */
  rim?: number;
  /** Colour of the bulb's reflection. */
  spec?: number;
  /** Colour of the thick glass at the foot. */
  tint?: number;
  /** Where the bright thing is that the glass reflects. */
  bulb?: Vector3;
}

/**
 * Point every pane at the room it is standing in. Without a cube the reflection
 * term is zero and the shader falls back to its fresnel rim, which is the
 * offline / headless path and still looks like glass.
 */
export function setGlassEnvironment(material: ShaderMaterial, env: Texture | null): void {
  material.uniforms.uEnv.value = env;
  material.uniforms.uEnvOn.value = env ? 1 : 0;
  material.needsUpdate = true;
}

export function glassMaterial(look: GlassLook = {}): ShaderMaterial {
  return new Material({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uRim: { value: new Color(look.rim ?? 0x9fb6c4) },
      uSpec: { value: new Color(look.spec ?? 0xffe2b4) },
      uTint: { value: new Color(look.tint ?? 0x2f5a44) },
      uBulb: { value: (look.bulb ?? new Vector3(-0.3, 0.35, -0.1)).clone() },
      uEnv: { value: null },
      uEnvOn: { value: 0 },
    },
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
}
