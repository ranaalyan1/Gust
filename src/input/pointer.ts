/**
 * DOM adapter for mouse-as-hand: tracks the pointer in normalised device
 * coordinates and buttons. All interpretation lives in core/pointerHands.ts.
 */
export class PointerInput {
  /** Normalised device coordinates (-1..1), y up. */
  x = 0;
  y = 0;
  present = false;
  held = false;
  /** Set when a clap was requested; the consumer clears it. */
  clap = false;
  /** True once the player has touched the pointer at all. */
  used = false;
  /** Fired on the first user gesture (audio must wait for one). */
  onFirstGesture: (() => void) | null = null;
  private gestured = false;
  private touch = false;

  constructor(private readonly dom: HTMLElement) {
    const opts = { passive: false } as const;
    dom.addEventListener('pointermove', this.move, opts);
    dom.addEventListener('pointerdown', this.down, opts);
    window.addEventListener('pointerup', this.up, opts);
    window.addEventListener('pointercancel', this.up, opts);
    dom.addEventListener('pointerleave', this.leave);
    dom.addEventListener('contextmenu', this.block);
    window.addEventListener('keydown', this.key);
    window.addEventListener('keyup', this.keyUp);
    dom.style.touchAction = 'none';
  }

  private gesture(): void {
    if (this.gestured) return;
    this.gestured = true;
    this.onFirstGesture?.();
  }

  private place(e: PointerEvent): void {
    const r = this.dom.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    this.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    this.present = true;
    this.used = true;
  }

  private readonly move = (e: PointerEvent): void => {
    this.touch = e.pointerType === 'touch';
    // touch: the hand is the FIRST finger; a second finger only cups, it never moves the hand
    if (this.touch && !e.isPrimary) return;
    this.place(e);
  };

  private readonly down = (e: PointerEvent): void => {
    this.touch = e.pointerType === 'touch';
    this.gesture();
    if (this.touch && !e.isPrimary) {
      // touch: one finger is an open hand; a second finger cups both
      this.held = true;
      return;
    }
    this.place(e);
    if (e.button === 2) this.clap = true;
    else if (!this.touch) this.held = true;
  };

  private readonly up = (e: PointerEvent): void => {
    if (e.button === 2) return;
    this.held = false;
    if (e.pointerType === 'touch' && e.isPrimary) this.present = false;
  };

  private readonly leave = (): void => {
    if (!this.touch) this.present = false;
  };

  private readonly block = (e: Event): void => e.preventDefault();

  private readonly key = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.code === 'Space') {
      this.gesture();
      this.clap = true;
      e.preventDefault();
    } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this.gesture();
      this.held = true;
    }
  };

  private readonly keyUp = (e: KeyboardEvent): void => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.held = false;
  };

  dispose(): void {
    this.dom.removeEventListener('pointermove', this.move);
    this.dom.removeEventListener('pointerdown', this.down);
    window.removeEventListener('pointerup', this.up);
    window.removeEventListener('pointercancel', this.up);
    this.dom.removeEventListener('pointerleave', this.leave);
    this.dom.removeEventListener('contextmenu', this.block);
    window.removeEventListener('keydown', this.key);
    window.removeEventListener('keyup', this.keyUp);
  }
}
