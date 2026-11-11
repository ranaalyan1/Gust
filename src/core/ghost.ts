/**
 * THE GHOST PLAYER
 *
 * A scripted pair of hands that plays GUST the way a person does: sweep the
 * dandelion to free the seed, cup both palms beneath it to raise an updraft,
 * lean the palms to carry it, wait out the storm's breath, set it down on
 * fertile ground.
 *
 * It exists for two reasons:
 *   1. Proof. The unit tests let the ghost play every stage headlessly, so a
 *      course that cannot be completed never ships.
 *   2. Teaching. The shell can show these hands as a translucent hint when a
 *      new player hesitates — the world teaches by doing, never with text.
 *
 * The ghost is honest: its hands have positions that move at human speeds, and
 * the velocity it reports is exactly how far each hand moved. It only produces
 * HandSamples — the same input a headset or a mouse produces.
 */
import { type Vec3, clamp, vec3 } from './vec3.js';
import { type HandSample, createHandSample } from './hands.js';
import type { Game } from './game.js';
import type { Seed } from './seed.js';
import { islandTop } from './terrain.js';

/** Fastest the ghost moves a hand (simulation m/s). */
const MAX_HAND_SPEED = 10;

class GhostHand {
  readonly sample: HandSample = createHandSample();
  private readonly target: Vec3 = vec3();
  private placed = false;

  aim(x: number, y: number, z: number): void {
    this.target.x = x;
    this.target.y = y;
    this.target.z = z;
  }

  face(x: number, y: number, z: number): void {
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    const n = this.sample.palmNormal;
    n.x = x / l;
    n.y = y / l;
    n.z = z / l;
  }

  /** Move toward the aim point at up to `maxSpeed`; velocity is the true displacement. */
  move(dt: number, maxSpeed = MAX_HAND_SPEED): void {
    const p = this.sample.position;
    const v = this.sample.velocity;
    if (!this.placed) {
      // the first sample has no history: appear at the target, at rest
      p.x = this.target.x;
      p.y = this.target.y;
      p.z = this.target.z;
      v.x = v.y = v.z = 0;
      this.placed = true;
      return;
    }
    let dx = this.target.x - p.x;
    let dy = this.target.y - p.y;
    let dz = this.target.z - p.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const maxStep = maxSpeed * dt;
    if (dist > maxStep) {
      const s = maxStep / dist;
      dx *= s;
      dy *= s;
      dz *= s;
    }
    p.x += dx;
    p.y += dy;
    p.z += dz;
    v.x = dx / dt;
    v.y = dy / dt;
    v.z = dz / dt;
  }
}

export class GhostPlayer {
  private readonly l = new GhostHand();
  private readonly r = new GhostHand();
  private sweepClock = 0;
  private lifting = true;

  get left(): HandSample {
    return this.l.sample;
  }

  get right(): HandSample {
    return this.r.sample;
  }

  /** Decide where the hands go this step. Call before `game.step(dt, ghost.left, ghost.right)`. */
  update(game: Game, dt: number): void {
    const c = game.course;
    const playing = game.phase === 'awaiting' || game.phase === 'flight';
    let anyAttached = false;
    for (let i = 0; i < game.seeds.length; i++) {
      if (game.seeds[i].status === 'attached') {
        anyAttached = true;
        break;
      }
    }

    if (!playing) {
      // rest: hands low and apart, palms down — no wind to speak of
      this.l.aim(game.focus.x - 1.2, game.focus.y - 1.6, 1.4);
      this.r.aim(game.focus.x + 1.2, game.focus.y - 1.6, 1.4);
      this.l.face(0, -1, 0);
      this.r.face(0, -1, 0);
      this.l.move(dt, 3);
      this.r.move(dt, 3);
      return;
    }

    const lead = game.lead;
    if (anyAttached && (lead === null || c.seedCount > 1 && this.sweepClock < 2.5)) {
      // ── the first breath: sweep through the dandelion ──
      this.sweepClock += dt;
      const cycle = this.sweepClock % 0.9;
      const d = c.dandelion;
      const top = d.y + c.headRadius;
      if (cycle < 0.45) {
        this.r.aim(d.x - 1.3, top - 0.45, d.z + 0.1); // wind up behind it
        this.r.face(0.8, 0.6, 0);
        this.r.move(dt, 6);
      } else {
        this.r.aim(d.x - 0.3, top - 0.05, d.z); // and sweep toward it (never past it)
        this.r.face(0.8, 0.6, 0);
        this.r.move(dt, 8);
      }
      this.l.aim(d.x - 1.6, top - 1.3, d.z + 1.2);
      this.l.face(0, -1, 0);
      this.l.move(dt, 3);
      return;
    }
    if (lead === null) {
      this.l.move(dt, 3);
      this.r.move(dt, 3);
      return;
    }
    this.sweepClock = 0;
    this.carry(game, lead, dt);
  }

  /** Cup both palms under the seed and lean them the way it should go. */
  private carry(game: Game, seed: Seed, dt: number): void {
    const c = game.course;
    const p = seed.pos;
    const goalTop = islandTop(c.goal, c.goal.center.x, c.goal.center.z);
    const startTop = c.start.center.y;
    const overGoal = p.x > c.goal.center.x - c.goal.rx * 0.7;

    // ── where should the seed be heading? ──
    let altitude = Math.max(startTop, goalTop) + 1.35;
    let wantX = 1; // +1 onward, 0 hold, -1 back
    let holdX = p.x;

    // a tunnel has a floor and a roof: fly its centre line, and time the breaths
    let tunnelY = NaN;
    let mouthX = NaN;
    let exitX = NaN;
    for (const o of c.terrain.obstacles) {
      if (o.kind === 'box' && o.center.y < 0 && o.half.x > 1) {
        tunnelY = o.center.y + o.half.y + 0.8;
        mouthX = o.center.x - o.half.x;
        exitX = o.center.x + o.half.x;
      }
    }
    if (!Number.isNaN(tunnelY) && p.x < exitX + 0.3) {
      altitude = tunnelY;
      const breathing = game.pulseWarning > 0.05 || game.pulse > 0.05;
      if (p.x < mouthX - 0.15 && breathing) {
        // wait just outside the mouth until the gate has exhaled
        wantX = 0;
        holdX = mouthX - 0.6;
      }
    }
    if (overGoal) altitude = goalTop - 1; // let it settle onto the soil

    // ── altitude: palms up to lift, palms down to let it sink ──
    if (p.y < altitude - 0.12) this.lifting = true;
    else if (p.y > altitude + 0.22) this.lifting = false;
    const lift = this.lifting && !overGoal;

    // ── carry: a seed is drawn to the centre of the column, so lead it ──
    // Cupped hands go slightly AHEAD of where the seed is, toward where it
    // should be; the cushion of air pulls it along.
    let leadX = wantX * 0.42;
    if (wantX === 0) leadX = clamp((holdX - p.x) * 0.9, -0.5, 0.5);
    // sinking fast? centre the cushion under it first, travel second
    const low = clamp((altitude - p.y - 0.25) * 2, 0, 1);
    leadX *= 1 - 0.8 * low;
    const leadZ = clamp(-p.z * 0.8 - seed.vel.z * 0.25, -0.5, 0.5);
    const hx = p.x + leadX;
    const hy = p.y - 0.62;
    const hz = p.z + leadZ;
    const spread = 0.34;

    if (overGoal) {
      // over fertile ground: lower the hands and let it settle
      this.r.aim(p.x, goalTop - 0.9, p.z + spread);
      this.l.aim(p.x, goalTop - 0.9, p.z - spread);
      this.l.face(0, -1, 0);
      this.r.face(0, -1, 0);
    } else {
      this.r.aim(hx, hy, hz + spread);
      this.l.aim(hx, hy, hz - spread);
      if (lift) {
        this.l.face(leadX * 0.5, 1, leadZ * 0.5);
        this.r.face(leadX * 0.5, 1, leadZ * 0.5);
      } else {
        this.l.face(0, -1, 0);
        this.r.face(0, -1, 0);
      }
    }
    this.l.move(dt);
    this.r.move(dt);
  }
}
