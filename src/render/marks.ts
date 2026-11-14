/**
 * THE HUMAN TRACE
 *
 * A specimen table that nobody has ever used is a shop window. What makes it
 * someone's table is the paperwork: an open ledger with yesterday still in it,
 * labels written by hand and propped where they were put down, a name cut into
 * the brass, a pencil that is shorter than it was, a ring where a cup stood.
 *
 * None of it is decoration. The ledger is the save file, drawn in ink. The
 * slips teach the two rules of the game as marginalia. The plaque is the
 * player's name, if they have given one.
 *
 * All of it is generated: paper, ink, letterforms, brass engraving.
 */
import {
  BoxGeometry,
  BufferAttribute,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  DataTexture,
  LinearFilter,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from '@iwsdk/core';
import {
  DEFAULT_KEEPER,
  EMPTY_INSCRIPTION,
  type Journal,
  ledgerLine,
  previousKeepersNote,
  sanitizeKeeper,
} from '../core/journal.js';
import { hash01 } from '../core/random.js';
import { blobTexture } from './blob.js';
import { InkBuffer, paper, ruled } from './ink.js';
import { write } from './pen.js';

const INK: readonly [number, number, number] = [0.15, 0.12, 0.1];

/* ── the slips ───────────────────────────────────────────────────────────── */

interface Slip {
  lines: { text: string; size: number; gap: number; caps?: boolean }[];
  seed: number;
  /** Printed hairline frame, as on a herbarium label. */
  frame?: boolean;
}

const SLIPS: Slip[] = [
  {
    seed: 31,
    frame: true,
    lines: [
      { text: 'Taraxacum officinale', size: 34, gap: 46 },
      { text: 'pappus, four grains taken', size: 25, gap: 36 },
      { text: 'in the south wind, xi.26', size: 25, gap: 36 },
      { text: 'no. 41', size: 24, gap: 34 },
    ],
  },
  {
    seed: 47,
    lines: [
      { text: 'The case is not locked.', size: 30, gap: 42 },
      { text: 'nothing in here can be held.', size: 23, gap: 33 },
      { text: 'only moved.', size: 23, gap: 33 },
    ],
  },
  {
    seed: 53,
    lines: [
      { text: 'Leave the lamp on.', size: 29, gap: 42 },
      { text: 'the seeds go quiet in the dark.', size: 23, gap: 33 },
    ],
  },
];

function slipTexture(slip: Slip, w = 512, h = 300): DataTexture {
  const buf = new InkBuffer(w, h, [0.89, 0.85, 0.74]);
  paper(buf, { seed: slip.seed, foxing: 9, edge: 0.3, fibres: 130 });
  if (slip.frame) {
    const m = 20;
    const a = 0.32;
    buf.segment(m, m, w - m, m, 0.55, a);
    buf.segment(w - m, m, w - m, h - m, 0.55, a);
    buf.segment(w - m, h - m, m, h - m, 0.55, a);
    buf.segment(m, h - m, m, m, 0.55, a);
  }
  let y = slip.lines[0].size * 1.5 + 18;
  for (const line of slip.lines) {
    write(buf, line.text, 34, y, {
      size: line.size,
      seed: slip.seed + Math.round(y),
      caps: line.caps,
      jitter: 0.6,
    });
    y += line.gap;
  }
  return buf.texture(INK, true);
}

/** A slip of paper, made of paper: it bows slightly, because paper does. */
function slipMesh(slip: Slip, width: number): Mesh {
  const geo = new PlaneGeometry(width, width * (300 / 512), 6, 4);
  const pos = geo.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / width;
    const y = pos.getY(i) / (width * (300 / 512));
    pos.setZ(i, (x * x * 0.6 + y * y * 0.4) * width * 0.02);
  }
  geo.computeVertexNormals();
  const mesh = new Mesh(
    geo,
    new MeshStandardMaterial({ map: slipTexture(slip), roughness: 0.94, metalness: 0, side: DoubleSide }),
  );
  mesh.receiveShadow = true;
  return mesh;
}

/* ── the ledger ──────────────────────────────────────────────────────────── */

const PAGE_W = 0.46;
const PAGE_H = 0.62;
const PAGE_PX = 640;
const PAGE_ROW = 62;

function pageTexture(journal: Journal, side: 'left' | 'right', reveal = 1): DataTexture {
  const w = PAGE_PX;
  const h = Math.round(PAGE_PX * (PAGE_H / PAGE_W));
  const buf = new InkBuffer(w, h, [0.9, 0.86, 0.76]);
  paper(buf, { seed: side === 'left' ? 71 : 73, foxing: 22, edge: 0.2, fibres: 240, grain: 1.15 });

  // ruled by hand: the lines wander and do not quite meet the edge
  ruled(buf, { top: 150, bottom: h - 90, left: 34, right: w - 44, spacing: PAGE_ROW, margin: 168, alpha: 0.17 });
  // a hairline under the heading
  buf.segment(34, 112, w - 44, 112, 0.5, 0.22);

  const perPage = side === 'right' ? 5 : 6;
  const offset = side === 'right' ? 0 : 5;
  const entries = journal.entries.slice(offset, offset + perPage);

  if (journal.entries.length === 0 && side === 'right') {
    write(buf, 'Nothing yet.', 40, 174, { size: 30, seed: 91 });
    write(buf, 'Every seed that comes home', 40, 214, { size: 24, seed: 93 });
    write(buf, 'is written here.', 40, 250, { size: 24, seed: 95 });
    void EMPTY_INSCRIPTION;
  } else {
    entries.forEach((entry, i) => {
      const line = ledgerLine(entry);
      // the newest line is still wet: written heavier, with a blot at the stop
      const wet = side === 'right' && i === 0;
      const base = 150 + i * PAGE_ROW + 34;
      write(buf, line.date, 42, base, { size: 21, seed: 100 + i * 7, jitter: wet ? 0.75 : 0.6 });
      write(buf, line.count, 182, base, { size: 22, seed: 200 + i * 7, jitter: wet ? 0.75 : 0.6 });
      write(buf, line.wind, 182, base + 30, { size: 18, seed: 300 + i * 7, jitter: 0.65 });
      // the newest line arrives wet: it is revealed left to right while the pen
      // is still on the page, and only pools its blot when the pen is lifted
      if (wet && reveal < 1) {
        const cut = 42 + (w - 90) * reveal;
        for (let y = Math.max(0, base - 30); y < Math.min(h, base + 46); y++) {
          for (let x = Math.max(0, Math.floor(cut)); x < w; x++) buf.ink[y * w + x] = 0;
        }
      }
      if (wet && reveal >= 1) buf.splat(168, base + 3, 1.8, 0.4);
    });
  }

  // The previous keeper's line: lower left, smaller, in a slightly worse hand.
  // Never announced; it is simply there one day, after a run has been finished.
  if (side === 'left') {
    const note = previousKeepersNote(journal.entries.length);
    if (note) {
      write(buf, note, 46, 624, { size: 17, seed: 1601, jitter: 1.35 });
      buf.splat(46 + 150, 620, 1.2, 0.22);
    }
  }

  // heading and folio
  write(buf, side === 'left' ? 'the keeper\u2019s book' : 'continued', 40, 92, { size: 20, seed: side === 'left' ? 61 : 63, caps: true, jitter: 0.35 });
  const folio = side === 'left' ? 1 + Math.floor(journal.entries.length / 11) * 2 : 2 + Math.floor(journal.entries.length / 11) * 2;
  write(buf, String(folio), w / 2, h - 48, { size: 17, seed: 65, align: 'center', jitter: 0.2 });

  // a page someone has turned: the corner softened, a faint thumbprint of tobacco
  if (side === 'right') buf.tint(w - 60, h - 60, [0.6, 0.5, 0.34], 0.08);
  return buf.texture(INK, true);
}

/* ── the brass ───────────────────────────────────────────────────────────── */

function plaqueTexture(keeper: string): DataTexture {
  const w = 640;
  const h = 160;
  const buf = new InkBuffer(w, h, [0.72, 0.56, 0.28]);
  // hammered brass: warm, worn, a little uneven
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = hash01(x * 31 + y * 97) * 0.5 + hash01(x * 7 + y * 13) * 0.5;
      const wear = 0.9 + 0.14 * Math.sin(x * 0.05 + y * 0.02) + (n - 0.5) * 0.1;
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y) / 18;
      const k = wear * (0.82 + 0.18 * Math.min(1, edge));
      const i = (y * w + x) * 3;
      buf.rgb[i] = Math.min(1, 0.74 * k);
      buf.rgb[i + 1] = Math.min(1, 0.58 * k);
      buf.rgb[i + 2] = Math.min(1, 0.29 * k);
    }
  }
  // a cut border, two hairlines
  const m = 16;
  for (const inset of [0, 7]) {
    buf.segment(m + inset, m + inset, w - m - inset, m + inset, 0.5, 0.3);
    buf.segment(w - m - inset, m + inset, w - m - inset, h - m - inset, 0.5, 0.3);
    buf.segment(w - m - inset, h - m - inset, m + inset, h - m - inset, 0.5, 0.3);
    buf.segment(m + inset, h - m - inset, m + inset, m + inset, 0.5, 0.3);
  }
  // engraving reads as a shadow under a lit edge: cut twice, one pixel apart
  const text = sanitizeKeeper(keeper);
  const size = text.length > 18 ? 30 : text.length > 13 ? 36 : 42;
  const opts = { size, seed: 13, caps: true, slant: 0.12, jitter: 0.22, letterSpacing: 0.05, align: 'center' as const };
  const inkBefore = buf.ink.slice();
  write(buf, text, w / 2 + 1.2, h / 2 + 1.2, { ...opts, alpha: 0.85 });
  const cut = buf.toRGBA(INK);
  // lit lip: lift the pixels just above the cut
  buf.ink.set(inkBefore);
  write(buf, text, w / 2 - 1.0, h / 2 - 1.0, { ...opts, alpha: 0.55 });
  const lip = buf.toRGBA([1.0, 0.9, 0.62]);
  for (let i = 0; i < w * h; i++) {
    const a = buf.ink[i];
    if (a <= 0.02) continue;
    cut[i * 4] = lip[i * 4];
    cut[i * 4 + 1] = lip[i * 4 + 1];
    cut[i * 4 + 2] = lip[i * 4 + 2];
  }
  return finish(cut, w, h, true);
}

/** Wrap raw RGBA as a texture; the desk's textures are drawn, never sampled. */
function finish(data: Uint8Array, w: number, h: number, flip = false): DataTexture {
  if (flip) {
    const row = w * 4;
    const out = new Uint8Array(data.length);
    for (let y = 0; y < h; y++) out.set(data.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    data = out;
  }
  const tex = new DataTexture(data, w, h, RGBAFormat);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/* ── the desk itself ─────────────────────────────────────────────────────── */

export interface MarksOptions {
  tableY: number;
  caseR: number;
}

export class DeskMarks {
  readonly group = new Group();
  private readonly pageMats: MeshStandardMaterial[] = [];
  private readonly plaqueMat: MeshStandardMaterial;
  private readonly plaqueTex: DataTexture;
  private readonly paper: MeshStandardMaterial;

  constructor(private readonly opts: MarksOptions) {
    const { tableY, caseR } = opts;
    this.paper = new MeshStandardMaterial({ color: 0xa89877, roughness: 0.98, metalness: 0, side: DoubleSide });

    // ── the ledger, open where it was left ──
    const book = new Group();
    book.position.set(caseR + 0.30, tableY + 0.012, caseR * 1.46);
    book.rotation.y = -0.62;
    book.scale.setScalar(0.86);
    this.group.add(book);

    const leather = new MeshStandardMaterial({ color: 0x2b1a15, roughness: 0.72, metalness: 0.02 });
    const cover = new Mesh(new BoxGeometry(PAGE_W * 2 + 0.05, 0.024, PAGE_H + 0.05), leather);
    cover.position.y = 0.012;
    cover.castShadow = true;
    cover.receiveShadow = true;
    book.add(cover);

    // the page block: real thickness, so the book has weight
    for (const s of [-1, 1]) {
      const block = new Mesh(new BoxGeometry(PAGE_W - 0.01, 0.016, PAGE_H - 0.02), this.paper);
      block.position.set((s * (PAGE_W + 0.012)) / 2, 0.032, 0);
      block.receiveShadow = true;
      book.add(block);
    }

    for (const side of ['left', 'right'] as const) {
      const s = side === 'left' ? -1 : 1;
      const geo = new PlaneGeometry(PAGE_W, PAGE_H, 10, 1);
      const pos = geo.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        // pages rise from the gutter like a book actually opened
        const x = Math.abs(pos.getX(i)) / (PAGE_W / 2);
        pos.setZ(i, Math.pow(x, 1.7) * 0.028);
      }
      geo.computeVertexNormals();
      // aged paper, not copy paper: a page under a desk lamp is never white
      const mat = new MeshStandardMaterial({ map: pageTexture(emptyJournalFor(side), side), color: 0xcbbfa4, roughness: 0.96, metalness: 0, side: DoubleSide });
      const page = new Mesh(geo, mat);
      page.position.set((s * (PAGE_W + 0.012)) / 2, 0.043, 0);
      page.receiveShadow = true;
      this.pageMats.push(mat);
      book.add(page);
    }

    // spine + a ribbon left in the middle
    const spine = new Mesh(new CylinderGeometry(0.016, 0.016, PAGE_H + 0.05, 12), leather);
    spine.rotation.x = Math.PI / 2;
    spine.position.set(0, 0.03, 0);
    book.add(spine);
    const ribbon = new Mesh(
      new BoxGeometry(0.03, 0.004, 0.20),
      new MeshStandardMaterial({ color: 0x6e2a24, roughness: 0.85 }),
    );
    ribbon.position.set(0.02, 0.046, PAGE_H * 0.3);
    ribbon.rotation.y = 0.12;
    book.add(ribbon);

    this.shadow(book.position.x, book.position.z, 0.62, tableY + 0.0125, 0.55);

    // ── the pencil, lying across the corner of the page ──
    const pencil = new Group();
    pencil.position.set(book.position.x - 0.30, tableY + 0.048, book.position.z - 0.30);
    pencil.rotation.set(0, 0.72, Math.PI / 2);
    const paint = new MeshStandardMaterial({ color: 0x8a6a1f, roughness: 0.55, metalness: 0.1 });
    const barrel = new Mesh(new CylinderGeometry(0.008, 0.008, 0.30, 6), paint);
    pencil.add(barrel);
    const wood = new Mesh(new CylinderGeometry(0.008, 0.0016, 0.035, 12), new MeshStandardMaterial({ color: 0xc9a878, roughness: 0.9 }));
    wood.position.y = 0.1675;
    pencil.add(wood);
    const lead = new Mesh(new CylinderGeometry(0.0016, 0.0006, 0.012, 8), new MeshStandardMaterial({ color: 0x2b2b2f, roughness: 0.5, metalness: 0.35 }));
    lead.position.y = 0.186;
    pencil.add(lead);
    const eraser = new Mesh(new CylinderGeometry(0.008, 0.008, 0.014, 12), new MeshStandardMaterial({ color: 0x7d4438, roughness: 0.95 }));
    eraser.position.y = -0.157;
    pencil.add(eraser);
    for (const child of pencil.children) {
      child.castShadow = true;
    }
    book.add(pencil);

    // ── the slips, where someone put them down ──
    // the specimen slip, propped against the foot of the jar
    const leaning = slipMesh(SLIPS[0], 0.30);
    leaning.position.set(-caseR * 1.18, tableY + 0.082, caseR * 0.44);
    leaning.rotation.set(-1.22, 0.42, 0.04);
    this.group.add(leaning);

    // two slips laid down where they were finished with
    this.shadow(leaning.position.x, leaning.position.z, 0.22, tableY + 0.0035, 0.4);

    const flat = slipMesh(SLIPS[1], 0.27);
    flat.position.set(-caseR * 1.02, tableY + 0.006, caseR * 1.62);
    flat.rotation.set(-Math.PI / 2, 0, 0.24);
    this.group.add(flat);

    this.shadow(flat.position.x, flat.position.z, 0.19, tableY + 0.0035, 0.35);

    const second = slipMesh(SLIPS[2], 0.24);
    second.position.set(caseR * 0.62, tableY + 0.006, caseR * 2.18);
    second.rotation.set(-Math.PI / 2, 0, -0.34);
    this.group.add(second);

    // ── the plaque, cut with the keeper's name ──
    this.plaqueTex = plaqueTexture(DEFAULT_KEEPER);
    const plate = new Mesh(new BoxGeometry(0.24, 0.005, 0.062), new MeshStandardMaterial({ color: 0x9a7a34, roughness: 0.4, metalness: 0.55 }));
    // The plate is mounted on the front of the base, canted back a little so
    // the light rakes across the cut letters instead of flattening them.
    plate.position.set(-0.02, tableY + 0.034, caseR + 0.05);
    plate.rotation.set(1.24, 0, 0);
    this.group.add(plate);
    // Engraved brass has to catch light, not mirror it: a near-vertical,
    // high-metalness plate in a room lit from above reads as a black rectangle.
    this.plaqueMat = new MeshStandardMaterial({ map: this.plaqueTex, color: 0xffffff, roughness: 0.44, metalness: 0.3 });
    const face = new Mesh(new PlaneGeometry(0.233, 0.0595), this.plaqueMat);
    face.position.set(0, 0.0035, 0);
    face.rotation.x = -Math.PI / 2;
    plate.add(face);

    this.shadow(second.position.x, second.position.z, 0.17, tableY + 0.0035, 0.32);

    // ── a brass loupe, put down mid-use ──
    const loupe = new Group();
    loupe.position.set(-caseR * 1.42, tableY + 0.012, caseR * 0.96);
    loupe.rotation.set(-Math.PI / 2, 0, 0.6);
    loupe.scale.setScalar(0.86);
    const brass = new MeshStandardMaterial({ color: 0xb08a3e, roughness: 0.34, metalness: 0.78 });
    const ring = new Mesh(new TorusGeometry(0.062, 0.008, 8, 40), brass);
    loupe.add(ring);
    const lens = new Mesh(
      new CylinderGeometry(0.06, 0.06, 0.006, 32),
      new MeshStandardMaterial({ color: 0xdfe9e6, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0, side: DoubleSide }),
    );
    lens.rotation.x = Math.PI / 2;
    loupe.add(lens);
    const grip = new Mesh(new CylinderGeometry(0.008, 0.010, 0.13, 10), brass);
    grip.position.y = 0.128;
    loupe.add(grip);
    const knob = new Mesh(new SphereGeometry(0.014, 12, 10), brass);
    knob.position.y = 0.196;
    loupe.add(knob);
    this.group.add(loupe);

    this.shadow(loupe.position.x, loupe.position.z, 0.13, tableY + 0.0035, 0.4);

    // ── the ring a cup left ──
    const stain = new Mesh(new PlaneGeometry(0.30, 0.30), new MeshBasicMaterial({ map: stainTexture(), transparent: true, opacity: 0.5, depthWrite: false }));
    stain.rotation.x = -Math.PI / 2;
    stain.position.set(-caseR * 1.92, tableY + 0.0022, -caseR * 0.42);
    this.group.add(stain);

    // ── husks: the world leaks ──
    for (let i = 0; i < 5; i++) {
      const husk = this.husk();
      const a = hash01(i * 31 + 7) * Math.PI * 2;
      const r = caseR * 1.2 + hash01(i * 17 + 3) * 0.5;
      husk.position.set(Math.cos(a) * r, tableY + 0.004, Math.sin(a) * r * 0.9);
      husk.rotation.set(0, hash01(i * 13 + 5) * 6.283, 0);
      this.group.add(husk);
    }
  }

  /** A soft contact shadow, laid on whatever surface the object stands on. */
  private shadow(x: number, z: number, r: number, y: number, opacity = 0.5): void {
    const mesh = new Mesh(
      new PlaneGeometry(r * 2, r * 2),
      new MeshBasicMaterial({ map: blobTexture(), transparent: true, opacity, depthWrite: false, color: 0x120f0c }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.renderOrder = 2;
    this.group.add(mesh);
  }

  /** An achene that came loose and was never swept up. */
  private husk(): Object3D {
    const g = new Group();
    const body = new Mesh(
      new CylinderGeometry(0.0022, 0.0006, 0.016, 5),
      new MeshStandardMaterial({ color: 0x6a4a2c, roughness: 0.8 }),
    );
    body.rotation.z = Math.PI / 2;
    body.position.y = 0.0024;
    g.add(body);
    const filament = new Mesh(
      new PlaneGeometry(0.028, 0.0012),
      new MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.9, side: DoubleSide }),
    );
    filament.position.set(0.012, 0.0022, 0);
    filament.rotation.set(-Math.PI / 2, 0.3, 0);
    g.add(filament);
    return g;
  }

  /**
   * Rewrite the book: called when a run completes, and on load.
   * `reveal` 0..1 leaves the newest line unwritten past that fraction, which is
   * how the entry is seen to be written rather than to appear.
   */
  setJournal(journal: Journal, reveal = 1): void {
    for (const side of ['left', 'right'] as const) {
      const i = side === 'left' ? 0 : 1;
      const mat = this.pageMats[i];
      mat.map?.dispose();
      mat.map = pageTexture(journal, side, reveal);
      mat.needsUpdate = true;
    }
  }

  /** Cut a name into the brass. */
  setKeeper(name: string): void {
    const tex = plaqueTexture(name);
    this.plaqueMat.map?.dispose();
    this.plaqueMat.map = tex;
    this.plaqueMat.needsUpdate = true;
  }

  /** Where the reader's eye should go when the book is mentioned. */
  get position(): Vector3 {
    return this.group.position;
  }
}

/** A page still blank. */
function emptyJournalFor(side: 'left' | 'right'): Journal {
  void side;
  return { version: 1, keeper: DEFAULT_KEEPER, entries: [] };
}

/** The dried ring of a cup that stood here long enough to leave one. */
function stainTexture(): DataTexture {
  const n = 192;
  const data = new Uint8Array(n * n * 4);
  const c = (n - 1) / 2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = x - c;
      const dy = y - c;
      const r = Math.hypot(dx, dy) / c;
      // two rings: the cup's rim, and the ring the base left
      const ring = Math.exp(-Math.pow((r - 0.93) / 0.035, 2)) * 0.85;
      const inner = Math.exp(-Math.pow((r - 0.78) / 0.02, 2)) * 0.22;
      const a = Math.min(1, ring + inner) * (0.55 + 0.45 * hash01(x * 3 + y * 7));
      const i = (y * n + x) * 4;
      data[i] = 74;
      data[i + 1] = 52;
      data[i + 2] = 34;
      data[i + 3] = Math.max(0, Math.min(255, a * 235));
    }
  }
  return finish(data, n, n);
}
