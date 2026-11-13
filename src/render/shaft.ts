/**
 * THE SHAFT
 *
 * A lamp in a dark room is not a bright spot on the wall. It is a volume: the
 * air between the bulb and the desk has dust in it, and the dust gives the
 * light an edge you can see. The first version of this was a cone with a flat
 * colour and a hard silhouette, and it read as a triangle of glass hanging in
 * the room — the right idea drawn the wrong way.
 *
 * So: the same cone, shaded like a volume rather than like a surface. Brightest
 * down its middle, gone at its silhouette (you are looking *through* the edge,
 * not at it), fading out at both ends, thickened and thinned by a slow noise so
 * it is never the same twice a second.
 */
import {
  AdditiveBlending,
  BackSide,
  Color,
  ConeGeometry,
  DoubleSide,
  FrontSide,
  Mesh,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';

const VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vW;
  varying float vY;
  void main() {
    vY = uv.y;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vV = cameraPosition - wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vW;
  varying float vY;
  uniform vec3 uColor;
  uniform float uStrength;
  uniform float uTime;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y * p.z);
  }

  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(vV);
    // Brightest through the middle of the cone and gone at its silhouette —
    // you are looking *through* the air, not at a surface. The first version
    // had this the wrong way round and drew a hard outline around the beam,
    // which is exactly the "triangle of glass" the whole exercise was avoiding.
    float core = pow(abs(dot(N, V)), 1.5);
    // gone at the mouth and at the shade
    float fall = smoothstep(0.02, 0.42, vY) * (1.0 - smoothstep(0.62, 1.0, vY));
    // the dust is not evenly mixed — but a per-cell hash makes cubes, so this
    // is two slow waves beating against each other instead
    float grain = 0.78 + 0.22 * sin(vW.y * 7.0 - uTime * 0.55) * sin(vW.x * 5.0 + vW.z * 3.4 + uTime * 0.3);
    float a = core * fall * grain * uStrength;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export interface ShaftOptions {
  color?: number;
  strength?: number;
  /** Radius at the mouth, in the room's units. */
  radius: number;
  height: number;
}

/**
 * A cone of light standing on its point: apex at the bulb, mouth on the desk.
 * Returns the mesh; the caller positions and aims it.
 */
export function lightShaft(opts: ShaftOptions): Mesh {
  const geo = new ConeGeometry(opts.radius, opts.height, 64, 24, true);
  // apex at the origin, mouth hanging below it: a cone built about its centre
  // shifted down by half, NOT rotated — the first version was flipped up into
  // the lamp shade, where nobody could see it
  geo.translate(0, -opts.height * 0.5, 0);
  const mat = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uColor: { value: new Color(opts.color ?? 0xffd2a0) },
      uStrength: { value: opts.strength ?? 0.30 },
      uTime: { value: 0 },
    },
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    // without this a cone's near wall draws over its own far wall
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  void BackSide;
  void FrontSide;
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  return mesh;
}

/** Where the shaft's apex should sit, given a bulb position and a target. */
export function aimShaft(shaft: Mesh, apex: Vector3, target: Vector3): void {
  shaft.position.copy(apex);
  const dir = target.clone().sub(apex);
  const len = dir.length();
  shaft.scale.set(1, len / 1.0, 1);
  shaft.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), dir.normalize());
}
