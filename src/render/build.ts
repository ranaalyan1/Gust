/** Tiny helpers for building flat-shaded, vertex-coloured low-poly geometry. */
import { BufferGeometry, Color, Float32BufferAttribute } from '@iwsdk/core';

const scratch = new Color();

export class FlatBuilder {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  /** Optional second colour set (e.g. the "lush" state of an island). */
  readonly colors2: number[] = [];

  /** Add one triangle with a single flat colour (and optional second colour). */
  tri(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    color: Color,
    color2: Color = color,
  ): void {
    this.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let i = 0; i < 3; i++) {
      this.colors.push(color.r, color.g, color.b);
      this.colors2.push(color2.r, color2.g, color2.b);
    }
  }

  build(withSecond = false): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    if (withSecond) g.setAttribute('lush', new Float32BufferAttribute(this.colors2, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** `base` shifted in lightness by `amount` (-1..1) into `out`. */
export function shade(out: Color, base: Color, amount: number): Color {
  out.copy(base);
  if (amount >= 0) out.lerp(scratch.setRGB(1, 1, 1), amount);
  else out.lerp(scratch.setRGB(0, 0, 0), -amount);
  return out;
}
