import { describe, expect, it } from 'vitest';
import { DEFAULT_GESTURES, FIXED_DT, Game, HandFilter, HandWind, PointerHands, type PointerState, WindField, vec3 } from '../src/core/index.js';

const unit = 7;
const gestures = { ...DEFAULT_GESTURES, unitScale: unit };

/** Drive the recogniser from a scripted pointer, exactly as the shell does. */
function rig() {
  const field = new WindField();
  const wind = new HandWind(field, gestures);
  const pointer = new PointerHands();
  const fl = new HandFilter();
  const fr = new HandFilter();
  const state: PointerState = { x: 0, y: 1, z: 0, present: true, held: false };
  const events: string[] = [];
  const step = () => {
    pointer.step(state, FIXED_DT, unit);
    const l = pointer.left.active ? fl.update(pointer.left.position, pointer.left.palmNormal, FIXED_DT) : (fl.reset(), null);
    const r = pointer.right.active ? fr.update(pointer.right.position, pointer.right.palmNormal, FIXED_DT) : (fr.reset(), null);
    field.advance(FIXED_DT);
    wind.update(l, r, FIXED_DT);
    for (const e of wind.events) events.push(e.type);
  };
  return { field, wind, pointer, state, events, step };
}

describe('mouse-as-hand produces every verb through the same recogniser', () => {
  it('verb 1 — a resting pointer is an open palm: a gentle stream straight up', () => {
    const r = rig();
    for (let i = 0; i < 60; i++) r.step();
    const w = r.field.sample(vec3(0, 1.3, 0), vec3());
    expect(w.y).toBeGreaterThan(0.5);
    expect(w.y).toBeLessThan(1.3);
    expect(Math.abs(w.x)).toBeLessThan(0.1);
    expect(r.events).toEqual([]);
  });

  it('verb 2 — a fast flick is a gust along the motion, far stronger than the resting palm', () => {
    const r = rig();
    for (let i = 0; i < 30; i++) r.step();
    let peak = 0;
    for (let i = 0; i < 20; i++) {
      r.state.x += 0.9 * unit * FIXED_DT; // 0.9 m/s of real mouse-hand travel
      r.step();
      const w = r.field.sample(vec3(r.pointer.right.position.x + 0.45, 1.0, 0), vec3());
      peak = Math.max(peak, w.x);
    }
    expect(peak).toBeGreaterThan(2.5);
    expect(r.events).toContain('gust');
  });

  it('verb 3 — holding the button cups both hands: an updraft that can hold a seed up', () => {
    const r = rig();
    r.state.held = true;
    for (let i = 0; i < 90; i++) r.step();
    expect(r.wind.updraftLevel).toBeGreaterThan(0.9);
    const w = r.field.sample(vec3(0, 2.2, 0), vec3());
    expect(w.y).toBeGreaterThan(2.45); // beats the seed's terminal fall
    expect(r.events).toContain('updraft');
    r.state.held = false;
    for (let i = 0; i < 180; i++) r.step();
    expect(r.wind.updraftLevel).toBeLessThan(0.05);
  });

  it('verb 4 — a clap is a shockwave ring', () => {
    const r = rig();
    for (let i = 0; i < 30; i++) r.step();
    r.pointer.clap();
    for (let i = 0; i < 30; i++) r.step();
    expect(r.events).toContain('clap');
    expect(r.events.filter((e) => e === 'clap').length).toBe(1);
  });

  it('verb 5 — drawing circles raises a whirlwind', () => {
    const r = rig();
    for (let i = 0; i < 20; i++) r.step();
    for (let i = 0; i < 150; i++) {
      const a = i * FIXED_DT * 9;
      r.state.x = Math.cos(a) * 0.12 * unit;
      r.state.y = 1 + Math.sin(a) * 0.12 * unit;
      r.step();
    }
    expect(r.wind.whirlLevel).toBeGreaterThan(0.5);
    expect(r.events).toContain('whirl');
  });

  it('a pointer that leaves the view takes its wind with it', () => {
    const r = rig();
    for (let i = 0; i < 30; i++) r.step();
    r.state.present = false;
    for (let i = 0; i < 60; i++) r.step();
    const w = r.field.sample(vec3(0, 1.6, 0), vec3());
    expect(Math.hypot(w.x, w.y, w.z)).toBeLessThan(0.05);
  });

  it('one flick of the mouse plucks the seed: magic on the first gesture', () => {
    const game = new Game({ gestures, seed: 2 });
    const pointer = new PointerHands();
    const fr = new HandFilter();
    const d = game.course.dandelion;
    const state: PointerState = { x: d.x - 1.6, y: d.y - 0.1, z: d.z, present: true, held: false };
    let plucked = -1;
    for (let i = 0; i < 90 && plucked < 0; i++) {
      if (i > 10 && state.x < d.x + 1.0) state.x += 5 * FIXED_DT; // a casual pass across the dandelion: 0.7 m/s of real hand travel
      pointer.step(state, FIXED_DT, unit);
      game.step(FIXED_DT, null, fr.update(pointer.right.position, pointer.right.palmNormal, FIXED_DT));
      if (game.events.some((e) => e.type === 'pluck')) plucked = i;
      game.events.length = 0;
    }
    expect(plucked).toBeGreaterThan(0);
  });
});
