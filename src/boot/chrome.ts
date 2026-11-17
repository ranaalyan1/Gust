/**
 * THE FRAME AROUND THE WORLD
 *
 * Everything else in this project is diegetic: the room, the ledger, the voice.
 * The HTML around it is the one place the illusion can break, so it is kept to
 * three things and all three leave the moment the player takes over.
 *
 *   - the title card, which is an intro and not a watermark: it lifts after
 *     seven seconds, or on the first real interaction, whichever comes first;
 *   - the one line of invitation at the bottom, which goes with it;
 *   - the dev server's XR pill, restyled to belong to this room rather than to
 *     a framework demo. In production there is no pill to restyle and this is a
 *     no-op.
 */

const PLAYING = 'gust-playing';

/** Cool, dark brass, the same family as the case. */
const PILL_CSS = `
  button, [role="button"] {
    background: linear-gradient(180deg, rgba(58, 44, 32, 0.94), rgba(22, 17, 13, 0.96)) !important;
    border: 1px solid rgba(216, 176, 120, 0.55) !important;
    border-radius: 999px !important;
    color: #f3e3c6 !important;
    font-family: ui-rounded, "Segoe UI", system-ui, sans-serif !important;
    font-size: 11px !important;
    font-weight: 500 !important;
    letter-spacing: 0.18em !important;
    text-transform: uppercase !important;
    padding: 11px 20px !important;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 227, 180, 0.28) !important;
    transition: transform 160ms ease, box-shadow 160ms ease !important;
    backdrop-filter: blur(6px);
  }
  button:hover, [role="button"]:hover {
    transform: translateY(-1px);
    box-shadow: 0 14px 34px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 227, 180, 0.4) !important;
  }
`;

function restyleDevChrome(): void {
  const attach = (root: ShadowRoot) => {
    if (root.querySelector('style[data-gust-chrome]')) return;
    const style = document.createElement('style');
    style.dataset.gustChrome = '1';
    style.textContent = PILL_CSS;
    root.appendChild(style);
  };
  for (const el of Array.from(document.body.children)) {
    const root = (el as HTMLElement).shadowRoot;
    if (root) attach(root);
  }
}

export function installChrome(): void {
  if (typeof document === 'undefined') return;
  const leave = () => document.body.classList.add(PLAYING);
  // the title is an introduction, so it has a lifetime
  const timer = window.setTimeout(leave, 7000);
  const onFirst = () => {
    window.clearTimeout(timer);
    leave();
    for (const type of ['pointerdown', 'keydown', 'touchstart']) {
      window.removeEventListener(type, onFirst);
    }
  };
  for (const type of ['pointerdown', 'keydown', 'touchstart']) {
    window.addEventListener(type, onFirst, { passive: true });
  }

  // the dev overlay lives in an open shadow root; style it once it appears
  restyleDevChrome();
  const observer = new MutationObserver(() => restyleDevChrome());
  observer.observe(document.body, { childList: true });
  window.setTimeout(() => observer.disconnect(), 12000);
}
