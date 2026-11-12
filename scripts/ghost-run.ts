/**
 * Headless play-through: the scripted ghost plays a whole run with no browser.
 *   npx vite-node scripts/ghost-run.ts [flock] [seed]
 */
import { FIXED_DT, Game, GhostPlayer } from '../src/core/index.js';

const flock = Number(process.argv[2] ?? 20);
const seed = Number(process.argv[3] ?? 3);
const game = new Game({ flockSize: flock, seed });
const ghost = new GhostPlayer();
let maxY = -Infinity;
let done = false;
for (let i = 0; i < 60 * 600 && !done; i++) {
  ghost.update(game, FIXED_DT);
  game.step(FIXED_DT, ghost.left, ghost.right);
  for (const s of game.seeds) if (s.status === 'flying' && s.pos.y > maxY) maxY = s.pos.y;
  for (const e of game.events) {
    const t = game.time.toFixed(1).padStart(6);
    if (e.type === 'stageClear') console.log(`${t}s  stage ${game.stage} (${game.course.kind}) clear  maxY ${maxY.toFixed(2)} ceiling ${game.course.ceiling.toFixed(2)}`);
    if (e.type === 'lost') console.log(`${t}s  seed lost`);
    if (e.type === 'runComplete') {
      console.log(`${t}s  run complete`);
      done = true;
    }
  }
  game.events.length = 0;
}
if (!done) console.log(`stopped at ${game.time.toFixed(1)}s in stage ${game.stage} (${game.phase})`);
