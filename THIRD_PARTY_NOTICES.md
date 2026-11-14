# Third-party notices

GUST is MIT licensed (see [`LICENSE`](./LICENSE)). It uses the following
third-party code, all of it under permissive licences. No third-party 3D model,
texture, font, sample or recording is shipped: every surface, sound and line of
music in the game is generated at run time by this repository's own code. The
only recorded audio is the ten voice lines described at the bottom.

| Package | Version | Licence | What it does here |
| --- | --- | --- | --- |
| [`three`](https://github.com/mrdoob/three.js) (via `super-three@0.185.0`) | 0.185.0 | MIT | The renderer, scene graph, materials, post-processing primitives |
| [`@iwsdk/core`](https://www.npmjs.com/package/@iwsdk/core) | 1.1.0-rc.2 | MIT | WebXR world, systems, ECS, the XR session lifecycle |
| [`@iwsdk/vite-plugin-dev`](https://www.npmjs.com/package/@iwsdk/vite-plugin-dev), `@iwsdk/cli` | 1.1.0-rc.2 | MIT | Dev server and the IWER emulator |
| [`iwer`](https://github.com/meta-quest/immersive-web-emulation-runtime) | (transitive) | MIT | The emulated Meta Quest 3 runtime, dev only |
| [`elics`](https://www.npmjs.com/package/elics) | (transitive) | MIT | ECS used by the SDK |
| [`@pmndrs/uikit`](https://github.com/pmndrs/uikit), `@pmndrs/uikit-horizon`, `@pmndrs/uikit-lucide` | 1.0.74 | MIT | Declared by the SDK for spatial UI; this game switches that feature off and substitutes a four-name stub (`src/vendor/uikit-stub.ts`) so the library is not shipped |
| [`@drawcall/uikitml`](https://www.npmjs.com/package/@drawcall/uikitml) | (transitive) | MIT | Same: SDK-only, not used at run time here |
| [`vite`](https://vite.dev) | 7.x | MIT | Build tool |
| [`vitest`](https://vitest.dev) | 3.x | MIT | Test runner |
| [`typescript`](https://www.typescriptlang.org) | 5.x | Apache-2.0 | Types and type checking |

Vite bundles transitive dependencies (esbuild, rollup, postcss, etc.) whose
licences are included in their respective packages under `node_modules`.

## Assets

- **Geometry, materials, textures**: generated in code (`src/render/`), no source
  files.
- **Audio**: the room tone, the score, every impact and every bird are synthesised
  with Web Audio at run time (`src/audio/`), with no samples.
- **Voice**: the ten lines in `public/voice/` are synthetic narration generated
  for this project with a text-to-speech model (see
  [`PRIVACY.md`](./PRIVACY.md#ai-generated-content)). They contain no third-party
  recording and no human performance.
