import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GESTURES,
  FIXED_DT,
  FLOCK_NEED,
  Game,
  type GameEvent,
  GhostPlayer,
  MISSION_TIMEOUT,
  WeatherMind,
  createHandSample,
  emptyGarden,
  fallbackMission,
  parseGarden,
  plantGrowth,
  recordRun,
  serializeGarden,
  MAX_PLANTS,
} from '../src/core/index.js';

/** Simulation metres per real metre — the same miniature scale the shell uses. */
const gestures = { ...DEFAULT_GESTURES, unitScale: 7 };

function play(game: Game, ghost: GhostPlayer | null, seconds: number, until?: (g: Game, e: GameEvent[]) => boolean): GameEvent[] {
  const all: GameEvent[] = [];
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < steps; i++) {
    if (ghost) ghost.update(game, FIXED_DT);
    game.step(FIXED_DT, ghost ? ghost.left : null, ghost ? ghost.right : null);
    for (const e of game.events) all.push(e);
    game.events.length = 0;
    if (until && until(game, all)) break;
  }
  return all;
}

describe('the first ten seconds', () => {
  it('with no hands, nothing happens: the seed waits, forever patient', () => {
    const game = new Game({ gestures, seed: 2 });
    const events = play(game, null, 20);
    expect(game.phase).toBe('awaiting');
    expect(game.seeds.length).toBe(1);
    expect(game.seeds[0].status).toBe('attached');
    expect(events.some((e) => e.type === 'pluck')).toBe(false);
  });

  it('a still open palm is not enough to pluck the seed — it only trembles', () => {
    const game = new Game({ gestures, seed: 2 });
    const hand = createHandSample();
    const d = game.course.dandelion;
    hand.position.x = d.x - 1.2;
    hand.position.y = d.y;
    hand.position.z = d.z;
    hand.palmNormal.x = 1;
    hand.palmNormal.y = 0;
    hand.palmNormal.z = 0;
    for (let i = 0; i < 600; i++) game.step(FIXED_DT, null, hand);
    expect(game.seeds[0].status).toBe('attached');
  });

  it('the very first sweep lifts the seed off the dandelion', () => {
    const game = new Game({ gestures, seed: 2 });
    const ghost = new GhostPlayer();
    const events = play(game, ghost, 3, (g) => g.phase === 'flight');
    expect(game.phase).toBe('flight');
    expect(game.time).toBeLessThan(1.5);
    const pluck = events.find((e) => e.type === 'pluck');
    expect(pluck && pluck.type === 'pluck' && pluck.first).toBe(true);
  });

  it('the seed is only ever moved by wind: its position is continuous for the whole flight', () => {
    const game = new Game({ gestures, seed: 2 });
    const ghost = new GhostPlayer();
    let maxJump = 0;
    let tracked = game.seeds[0];
    let px = tracked.pos.x;
    let py = tracked.pos.y;
    let pz = tracked.pos.z;
    for (let i = 0; i < 60 * 12; i++) {
      ghost.update(game, FIXED_DT);
      game.step(FIXED_DT, ghost.left, ghost.right);
      game.events.length = 0;
      if (game.seeds[0] !== tracked || game.phase === 'travel') break;
      const s = tracked;
      maxJump = Math.max(maxJump, Math.hypot(s.pos.x - px, s.pos.y - py, s.pos.z - pz));
      px = s.pos.x;
      py = s.pos.y;
      pz = s.pos.z;
    }
    // 40 m/s speed cap * dt = 0.67 m is the absolute bound; a real flight stays far below it
    expect(maxJump).toBeLessThan(0.3);
  });
});

describe('losing is gentle', () => {
  it('a lost seed is replaced by a fresh one on the dandelion, and the sky starts to help', () => {
    const game = new Game({ gestures, seed: 2 });
    const hand = createHandSample();
    // one hard sweep, then walk away: the seed drifts and falls into the clouds
    const d = game.course.dandelion;
    hand.palmNormal.x = 1;
    hand.palmNormal.y = 0;
    const events: GameEvent[] = [];
    for (let i = 0; i < 60 * 14; i++) {
      const t = i * FIXED_DT;
      const sweeping = t < 0.35;
      hand.position.x = d.x - 1.2 + (sweeping ? t * 3 : 1.05);
      hand.position.y = d.y;
      hand.position.z = d.z;
      hand.velocity.x = sweeping ? 3 * 7 : 0;
      game.step(FIXED_DT, null, t < 0.5 ? hand : null);
      for (const e of game.events) events.push(e);
      game.events.length = 0;
    }
    const kinds = events.map((e) => e.type);
    expect(kinds).toContain('pluck');
    expect(kinds).toContain('lost');
    expect(kinds).toContain('respawn');
    expect(kinds.indexOf('lost')).toBeLessThan(kinds.indexOf('respawn'));
    expect(game.mind.losses).toBeGreaterThanOrEqual(1);
    expect(game.mind.assist).toBeGreaterThan(0.1);
    expect(game.seeds.some((s) => s.status === 'attached')).toBe(true);
  });
});

describe('the Weather Mind (realtime half)', () => {
  it('helps more with every loss, and its help is real wind', () => {
    const mind = new WeatherMind();
    mind.beginStage(0.5);
    expect(mind.tailwind).toBe(0);
    mind.onLoss();
    for (let i = 0; i < 300; i++) mind.step(FIXED_DT, { progress: 0, flying: true, handEnergy: 0 });
    const one = mind.assist;
    mind.onLoss();
    mind.onLoss();
    for (let i = 0; i < 300; i++) mind.step(FIXED_DT, { progress: 0, flying: true, handEnergy: 0 });
    expect(one).toBeGreaterThan(0.2);
    expect(mind.assist).toBeGreaterThan(one);
    expect(mind.tailwind).toBeGreaterThan(2);
    expect(mind.reliefThermal).toBeGreaterThan(0);
    expect(mind.hostility).toBeLessThan(0.6);
    expect(mind.intent).toBe('helping');
  });

  it('pushes back against a player who has mastered the air, and never while helping', () => {
    const mind = new WeatherMind();
    mind.mastery = 0.95;
    mind.beginStage(0.8);
    for (let i = 0; i < 600; i++) mind.step(FIXED_DT, { progress: i / 600, flying: true, handEnergy: 3 });
    expect(mind.menace).toBeGreaterThan(0.3);
    expect(mind.roughness).toBeGreaterThan(1.2);
    expect(mind.intent).toBe('testing');
    mind.onLoss();
    mind.onLoss();
    for (let i = 0; i < 600; i++) mind.step(FIXED_DT, { progress: 0, flying: true, handEnergy: 0 });
    expect(mind.menace).toBeLessThan(0.1);
  });

  it('leans in when the player stalls, without a single loss', () => {
    const mind = new WeatherMind();
    mind.beginStage(0.5);
    for (let i = 0; i < 60 * 45; i++) mind.step(FIXED_DT, { progress: 0.2, flying: true, handEnergy: 1 });
    expect(mind.assist).toBeGreaterThan(0.2);
  });

  it('mastery rises on clean fast clears and falls on losses; it always stays in 0..1', () => {
    const mind = new WeatherMind();
    mind.beginStage(0.5);
    mind.stageTime = 10;
    mind.onSuccess(22);
    const up = mind.mastery;
    expect(up).toBeGreaterThan(0.5);
    for (let i = 0; i < 40; i++) mind.onLoss();
    expect(mind.mastery).toBe(0);
    expect(mind.mastery).toBeLessThan(up);
  });

  it('reports the stage to the mission service in a sane shape', () => {
    const mind = new WeatherMind();
    mind.beginStage(0.5);
    mind.onLoss();
    const r = mind.report(2, 1, 12, 'First Breath');
    expect(r).toMatchObject({ stage: 2, run: 1, losses: 1, gardenSize: 12, previous: 'First Breath' });
  });
});

describe('missions arrive between stages — and the game never waits on the network', () => {
  const clearFirstStage = (game: Game) => {
    const ghost = new GhostPlayer();
    const events = play(game, ghost, 120, (_g, e) => e.some((x) => x.type === 'missionRequest'));
    return { ghost, events };
  };

  it('asks for a mission the moment a stage is cleared', () => {
    const game = new Game({ gestures, seed: 3 });
    const { events } = clearFirstStage(game);
    const req = events.find((e) => e.type === 'missionRequest');
    expect(req && req.type === 'missionRequest' && req.request.stage).toBe(1);
    expect(game.phase).toBe('bloom');
    expect(game.awaitingMission).toBe(true);
  });

  it('uses a delivered mission for the next course', () => {
    const game = new Game({ gestures, seed: 3 });
    const { ghost } = clearFirstStage(game);
    const mission = { ...fallbackMission(1, 0), name: 'Sent By The Sky' };
    expect(game.provideMission(mission, 'gemini')).toBe(true);
    expect(game.provideMission(mission, 'gemini')).toBe(false); // only once
    play(game, ghost, 30, (g) => g.stage === 1);
    expect(game.stage).toBe(1);
    expect(game.course.mission.name).toBe('Sent By The Sky');
    expect(game.missionSource).toBe('gemini');
  });

  it('falls back to the hand-written bank if the sky stays silent', () => {
    const game = new Game({ gestures, seed: 3 });
    const { ghost } = clearFirstStage(game);
    const t0 = game.time;
    play(game, ghost, 40, (g) => g.stage === 1);
    expect(game.stage).toBe(1);
    expect(game.missionSource).toBe('offline');
    expect(game.course.mission.name.length).toBeGreaterThan(0);
    // never more than the timeout plus the travel itself
    expect(game.time - t0).toBeLessThan(MISSION_TIMEOUT + 6);
  });

  it('ignores a mission nobody asked for', () => {
    const game = new Game({ gestures, seed: 3 });
    expect(game.provideMission(fallbackMission(1, 0), 'gemini')).toBe(false);
  });
});

describe('the whole of GUST, played start to finish by the ghost', () => {
  it('first breath -> canyon -> tunnel -> crossing -> dandelion burst -> bloom -> garden', () => {
    const game = new Game({ gestures, seed: 3, flockSize: 20 });
    const ghost = new GhostPlayer();
    const events = play(game, ghost, 900, (g) => g.run >= 1 && g.phase === 'awaiting');

    const clears = events.filter((e) => e.type === 'stageClear').map((e) => (e.type === 'stageClear' ? e.stage : -1));
    expect(clears).toEqual([0, 1, 2, 3]);

    const done = events.find((e) => e.type === 'runComplete');
    expect(done).toBeDefined();
    if (done && done.type === 'runComplete') {
      expect(done.flock).toBe(20);
      expect(done.landed).toBeGreaterThanOrEqual(Math.ceil(20 * FLOCK_NEED));
      expect(done.garden.runs).toBe(1);
      expect(done.garden.plants.length).toBe(done.landed);
      expect(done.garden.plants.some((p) => p.kind === 'tree')).toBe(true);
    }
    // the sky changed through all three acts
    const stages = events.filter((e) => e.type === 'stageStart').map((e) => (e.type === 'stageStart' ? e.course.kind : ''));
    expect(stages).toEqual(['canyon', 'tunnel', 'crossing', 'burst', 'canyon']);
    // and the world carried on: a second run begins on the island that just bloomed
    expect(game.run).toBe(1);
    expect(game.stage).toBe(0);
    expect(game.garden.runs).toBe(1);
    // every number in the world is still finite
    for (const s of game.seeds) for (const v of [s.pos.x, s.pos.y, s.pos.z, s.vel.x, s.vel.y, s.vel.z]) expect(Number.isFinite(v)).toBe(true);
  }, 60_000);

  it('is deterministic: the same hands produce the same world', () => {
    const run = () => {
      const game = new Game({ gestures, seed: 5 });
      const ghost = new GhostPlayer();
      play(game, ghost, 25);
      const s = game.seeds[0];
      return [game.time, game.phase, game.stage, s?.pos.x, s?.pos.y, s?.pos.z];
    };
    expect(run()).toEqual(run());
  });
});

describe('the garden persists', () => {
  it('survives a round trip through storage', () => {
    let g = emptyGarden();
    g = recordRun(g, [{ x: 0.2, z: -0.3 }, { x: -0.5, z: 0.4 }, { x: 0.9, z: 0.1 }]);
    const back = parseGarden(serializeGarden(g));
    expect(back.runs).toBe(1);
    expect(back.plants.length).toBe(3);
    expect(back.plants[0].kind).toBe('tree');
    expect(back.plants[0].x).toBeCloseTo(0.2, 3);
    expect(back.seedsPlanted).toBe(3);
    expect(back.bestFlock).toBe(3);
  });

  it('shrugs off corrupt or hostile storage', () => {
    for (const junk of [null, undefined, '', 'not json', '42', '[]', '{"version":999}', '{"version":1,"plants":"lots"}', '{"version":1,"plants":[{"x":"a"},null,{"x":1e9,"z":0}]}']) {
      const g = parseGarden(junk);
      expect(g.plants).toEqual([]);
      expect(g.runs).toBeGreaterThanOrEqual(0);
    }
  });

  it('grows with every visit but never without bound; trees are kept', () => {
    let g = emptyGarden();
    for (let run = 0; run < 12; run++) {
      const spots = Array.from({ length: 20 }, (_, i) => ({ x: Math.cos(i + run) * 1.2, z: Math.sin(i * 2 + run) * 1.0 }));
      g = recordRun(g, spots);
    }
    expect(g.runs).toBe(12);
    expect(g.plants.length).toBe(MAX_PLANTS);
    expect(g.plants.filter((p) => p.kind === 'tree').length).toBeGreaterThanOrEqual(5);
    expect(g.seedsPlanted).toBe(240);
  });

  it('old plants are bigger than new ones', () => {
    let g = recordRun(emptyGarden(), [{ x: 0, z: 0 }]);
    const young = plantGrowth(g, g.plants[0]);
    for (let i = 0; i < 6; i++) g = recordRun(g, [{ x: 1, z: i * 0.2 }]);
    expect(plantGrowth(g, g.plants[0])).toBeGreaterThan(young);
    expect(plantGrowth(g, g.plants[0])).toBeLessThanOrEqual(1);
  });

  it('a returning player starts in the garden they grew', () => {
    const garden = recordRun(emptyGarden(), [{ x: 0.1, z: 0.1 }, { x: 0.4, z: -0.2 }]);
    const game = new Game({ gestures, garden });
    expect(game.run).toBe(1);
    expect(game.garden.plants.length).toBe(2);
  });
});
