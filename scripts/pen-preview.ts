/**
 * Dev harness: rasterise the pen to PNG so the hand can be looked at.
 *
 *   npx vite-node scripts/pen-preview.ts
 *
 * Not part of the game; it exists because a font must be seen to be judged.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { InkBuffer, paper, ruled } from '../src/render/ink.js';
import { measure, write } from '../src/render/pen.js';

const sharp = (await import('sharp')).default;

const out = '/home/user/shots';
mkdirSync(out, { recursive: true });

const save = async (name: string, buf: InkBuffer): Promise<void> => {
  const data = buf.toRGBA();
  const rgb = Buffer.alloc(buf.w * buf.h * 3);
  for (let i = 0; i < buf.w * buf.h; i++) {
    rgb[i * 3] = data[i * 4];
    rgb[i * 3 + 1] = data[i * 4 + 1];
    rgb[i * 3 + 2] = data[i * 4 + 2];
  }
  await sharp(rgb, { raw: { width: buf.w, height: buf.h, channels: 3 } }).png().toFile(`${out}/${name}.png`);
};

// ── the hand at size ──
{
  const buf = new InkBuffer(1024, 300, [0.9, 0.87, 0.79]);
  paper(buf, { seed: 3, edge: 0.05, foxing: 6 });
  write(buf, 'the quick brown fox jumps over the lazy dog', 40, 70, { size: 46, seed: 5 });
  write(buf, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789', 40, 130, { size: 34, seed: 9, caps: true });
  write(buf, 'Taraxacum officinale, pappus & four grains', 40, 190, { size: 34, seed: 12 });
  write(buf, 'collected at first light, wind S.W., xi.26', 40, 240, { size: 30, seed: 15 });
  write(buf, 'right aligned', 980, 275, { size: 30, seed: 18, align: 'right' });
  await save('pen-alphabet', buf);
}

// ── a specimen card ──
{
  const buf = new InkBuffer(512, 320, [0.88, 0.84, 0.73]);
  paper(buf, { seed: 21, foxing: 10, edge: 0.3 });
  // printed hairline frame, as on a herbarium slip
  const m = 22;
  for (const [x0, y0, x1, y1] of [
    [m, m, 512 - m, m],
    [512 - m, m, 512 - m, 320 - m],
    [512 - m, 320 - m, m, 320 - m],
    [m, 320 - m, m, m],
  ]) {
    buf.segment(x0, y0, x1, y1, 0.6, 0.4);
  }
  write(buf, 'Taraxacum officinale', 44, 82, { size: 30, seed: 31 });
  write(buf, 'pappus, four grains taken', 44, 126, { size: 24, seed: 33 });
  write(buf, 'in the south wind', 44, 162, { size: 24, seed: 35 });
  write(buf, 'xi.26', 44, 232, { size: 26, seed: 37 });
  write(buf, 'no. 41', 512 - 44, 232, { size: 26, seed: 39, align: 'right' });
  console.log('card: line width', Math.round(measure('pappus, four grains taken', { size: 24 })));
  await save('pen-card', buf);
}

// ── a ledger page ──
{
  const buf = new InkBuffer(512, 640, [0.9, 0.86, 0.76]);
  paper(buf, { seed: 41, foxing: 16, edge: 0.18 });
  ruled(buf, { top: 90, bottom: 600, left: 30, right: 482, spacing: 38, margin: 118, alpha: 0.2 });
  write(buf, 'xii.xi.26', 34, 128, { size: 19, seed: 51 });
  write(buf, 'nine came home', 132, 128, { size: 19, seed: 52 });
  write(buf, 'xi.xi.26', 34, 166, { size: 19, seed: 53 });
  write(buf, 'the wind turned late', 132, 166, { size: 19, seed: 54 });
  write(buf, 'Every seed that comes home is written here.', 34, 40, { size: 17, seed: 55 });
  write(buf, '4', 256, 620, { size: 16, seed: 57, align: 'center' });
  await save('pen-ledger', buf);
}

console.log('wrote three previews to', out);
writeFileSync('/tmp/pen-ok', '1');
