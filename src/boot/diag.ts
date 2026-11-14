/**
 * ?perf=1 and ?diag=1 — the numbers, on screen, only when asked for.
 *
 * Measured, not claimed: every figure here comes from the renderer that is
 * drawing the frame, or from a performance mark taken in this session. Nothing
 * is estimated, and nothing is shown to a player who did not put the flag in the
 * URL — the headset stays free of text boxes (Law 4).
 */

export type DiagMode = 'off' | 'perf' | 'diag';

export function diagMode(search = typeof location === 'undefined' ? '' : location.search): DiagMode {
  const q = new URLSearchParams(search);
  if (q.get('diag') === '1') return 'diag';
  if (q.get('perf') === '1') return 'perf';
  return 'off';
}

/** Milliseconds from navigation start, for each mark we take. */
export const marks: Record<string, number> = {};

export function markOnce(name: string): number {
  if (marks[name] !== undefined) return marks[name];
  const t = typeof performance === 'undefined' ? 0 : performance.now();
  marks[name] = t;
  return t;
}

export class Overlay {
  private readonly el: HTMLPreElement;
  private last = 0;

  constructor(readonly mode: DiagMode) {
    this.el = document.createElement('pre');
    this.el.id = 'gust-diag';
    this.el.style.cssText =
      'position:fixed;left:10px;top:10px;margin:0;padding:8px 10px;z-index:9998;pointer-events:none;' +
      'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:#d9f2ff;' +
      'background:rgba(6,10,14,.62);border:1px solid rgba(140,200,255,.22);border-radius:6px;' +
      'white-space:pre;text-shadow:0 1px 2px rgba(0,0,0,.8);';
    this.el.textContent = '';
    document.body.appendChild(this.el);
  }

  get active(): boolean {
    return this.mode !== 'off';
  }

  /** Four updates a second: enough to read, few enough not to cost the frame. */
  set(now: number, lines: string[]): void {
    if (now - this.last < 0.25) return;
    this.last = now;
    this.el.textContent = lines.join('\n');
  }

  dispose(): void {
    this.el.remove();
  }
}
