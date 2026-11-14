/**
 * GUST — you don't move the seed. You move the air.
 *
 * Entry point: create the IWSDK world and hand it to the one system that
 * adapts the pure game core (src/core) to the headset and the browser.
 *
 * Two rules live here, both about the one click a judge gives this link:
 *   1. Nothing may end in a blank page. World.create failures, window errors
 *      and unhandled rejections during boot all show the same kind sentence.
 *   2. The first rendered frame is measured and logged, so cold start is a
 *      number rather than a feeling (?perf=1 / ?diag=1 show it live).
 */
import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { markOnce } from './boot/diag.js';
import { installStartupGuard, showFallback } from './boot/guard.js';
import { GustSystem } from './systems/gust.js';

markOnce('boot');
installStartupGuard();

const container = document.getElementById('scene-container') as HTMLDivElement;

World.create(container, projectOptions)
  .then((world) => {
    markOnce('world');
    world.registerSystem(GustSystem);
  })
  .catch((error: unknown) => {
    showFallback(error);
  });

// Cold start, in the console, for anyone who opens devtools: navigation start to
// first frame is the number a headset judge actually waits through.
if (typeof window !== 'undefined' && new URLSearchParams(location.search).has('perf')) {
  window.addEventListener('load', () => markOnce('load'));
}
