import type { IncomingMessage, ServerResponse } from 'node:http';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { type Plugin, defineConfig, loadEnv } from 'vite';

/**
 * Serves /api/mission from the dev server exactly as Vercel does in
 * production, by running the same resolver (src/server/weatherMind.ts).
 * GEMINI_API_KEY is read server-side from .env.local — it has no VITE_ prefix
 * and is never exposed to client code.
 */
function weatherMindDevApi(): Plugin {
  return {
    name: 'gust-weather-mind-dev-api',
    configureServer(server) {
      const env = { ...process.env, ...loadEnv(server.config.mode, process.cwd(), '') };
      server.middlewares.use('/api/mission', (req: IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          void (async () => {
            let input: unknown = {};
            try {
              if (req.method === 'POST') {
                input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
              } else {
                const q = new URL(req.url ?? '/', 'http://localhost').searchParams;
                const o: Record<string, unknown> = {};
                q.forEach((v, k) => (o[k] = k === 'previous' ? v : Number(v)));
                input = o;
              }
            } catch {
              input = {};
            }
            let body: unknown;
            try {
              const mod = (await server.ssrLoadModule('/src/server/weatherMind.ts')) as typeof import('./src/server/weatherMind');
              body = await mod.resolveMission(input, { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL });
            } catch {
              body = { source: 'error' }; // the client treats anything invalid as "use the offline bank"
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-store');
            res.end(JSON.stringify(body));
          })();
        });
      });
    },
  };
}

// GUST_HTTP=1 serves plain HTTP (for hosted previews that terminate TLS
// themselves). The default is IWSDK's self-signed HTTPS, which a headset on the
// LAN needs for WebXR.
const plainHttp = process.env.GUST_HTTP === '1';

export default defineConfig({
  plugins: [
    // emulator settings live in iwsdk.config.json (the project authority)
    iwsdkDev({ https: plainHttp ? false : true }),
    weatherMindDevApi(),
  ],
  server: { host: '0.0.0.0', port: 8081, open: false, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 8081, allowedHosts: true },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  resolve: {
    dedupe: ['three', '@pmndrs/uikit', '@pmndrs/uikit-horizon', '@pmndrs/uikit-lucide'],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: ['three', '@pmndrs/uikit', '@pmndrs/uikit-horizon', '@pmndrs/uikit-lucide', '@drawcall/uikitml'],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
