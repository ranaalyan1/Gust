/**
 * SOFT BLOB SHADOWS
 *
 * A shadow is not a black disc: it is a gradient that is dense in the middle of
 * whatever casts it and gone at the edges. This is a 64×64 alpha gradient with
 * a cool, very dark tint, drawn with ordinary transparency — which behaves the
 * same on every driver, unlike multiply blending, which needs premultiplied
 * alpha and quietly renders as a bright square when it does not get it.
 *
 * Generated as a DataTexture: no canvas, no files, no DOM, so it also builds in
 * Node.
 */
import {
  DataTexture,
  DoubleSide,
  LinearFilter,
  MeshBasicMaterial,
  RGBAFormat,
} from '@iwsdk/core';

let texture: DataTexture | null = null;

/** Radial alpha falloff, tinted like shadow rather than like black paint. */
export function blobTexture(): DataTexture {
  if (texture) return texture;

  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const mid = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - mid) / mid;
      const dy = (y - mid) / mid;
      const r = Math.min(1, Math.hypot(dx, dy));
      // dense centre, soft shoulder, exactly zero at the rim
      const falloff = Math.pow(1 - r, 1.4);
      const i = (y * size + x) * 4;
      data[i] = 18;
      data[i + 1] = 17;
      data[i + 2] = 28;
      data[i + 3] = Math.round(falloff * 255);
    }
  }

  texture = new DataTexture(data, size, size, RGBAFormat);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** A fresh material per caller, so each shadow can fade on its own. */
export function blobShadowMaterial(opacity = 0.42): MeshBasicMaterial {
  return new MeshBasicMaterial({
    map: blobTexture(),
    color: 0xffffff,
    transparent: true,
    opacity,
    depthWrite: false,
    fog: false,
    side: DoubleSide,
  });
}
