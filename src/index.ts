/**
 * GUST — you don't move the seed. You move the air.
 *
 * Entry point: create the IWSDK world and hand it to the one system that
 * adapts the pure game core (src/core) to the headset and the browser.
 */
import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { GustSystem } from './systems/gust.js';

const container = document.getElementById('scene-container') as HTMLDivElement;

World.create(container, projectOptions)
  .then((world) => {
    world.registerSystem(GustSystem);
  })
  .catch((error: unknown) => {
    // The link must never show an error page: say something kind instead.
    console.error('[gust] could not start', error);
    const note = document.createElement('p');
    note.textContent = 'GUST needs WebGL 2 to draw its sky. Try a recent Chrome, Edge, Firefox, Safari or the Meta Quest Browser.';
    note.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;margin:0;padding:2rem;text-align:center;font:16px/1.5 system-ui,sans-serif;color:#fff;';
    document.body.appendChild(note);
  });
