/**
 * THE ONE CLICK.
 *
 * A judge opens the link once. If anything goes wrong before the first frame —
 * a bad WebGL context, a rejected module, an SDK that throws during start-up —
 * they must see a sentence and a way forward, never a blank page or a stack
 * trace. World.create() failures were already caught; this adds the two paths
 * that were not: window 'error' and 'unhandledrejection' during boot.
 *
 * The guard disarms itself on the first rendered frame: after that a stray
 * rejection is not a failed start, and replacing a running game with an apology
 * would be worse than the bug.
 */

const MESSAGE =
  'GUST needs WebGL 2 to draw its sky. Try a recent Chrome, Edge, Firefox, Safari or the Meta Quest Browser.';

let note: HTMLParagraphElement | null = null;

/** Show the kind note, once. Never removes anything that is already working. */
export function showFallback(detail?: unknown): void {
  if (typeof document === 'undefined') return;
  if (detail !== undefined) console.error('[gust] could not start', detail);
  if (note && note.isConnected) return;
  note = document.createElement('p');
  note.textContent = MESSAGE;
  note.style.cssText =
    'position:fixed;inset:0;display:grid;place-items:center;margin:0;padding:2rem;text-align:center;' +
    'font:16px/1.5 system-ui,sans-serif;color:#fff;background:#0a0806;z-index:9999;';
  document.body.appendChild(note);
}

export interface StartupGuard {
  /** Stop guarding. Call this from the first successfully rendered frame. */
  disarm(): void;
}

let current: (() => void) | null = null;

/**
 * The system calls this from its first rendered frame. Kept as its own export
 * so the entry point owns installation and the renderer owns the release.
 */
export function disarmStartupGuard(): void {
  current?.();
}

export function installStartupGuard(): StartupGuard {
  if (typeof window === 'undefined') return { disarm: () => {} };
  let armed = true;
  const onError = (event: ErrorEvent) => {
    if (!armed) return;
    showFallback(event.error ?? event.message);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    if (!armed) return;
    showFallback(event.reason);
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  const disarm = () => {
    if (!armed) return;
    armed = false;
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
  current = disarm;
  return { disarm };
}
