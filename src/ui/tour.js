import { esc, storage } from './util.js';

const SEEN_KEY = 'agent-harness:tour-seen';

/**
 * A short guided tour: spotlights one element at a time with a caption.
 * `steps`: [{ target, title, body, before?() }]; `before` can switch panes/tabs.
 */
export function createTour({ steps, onEnd }) {
  const prefs = storage('local');
  let i = 0;
  let layer = null;

  function build() {
    layer = document.createElement('div');
    layer.className = 'tour';
    layer.innerHTML = `
      <div class="tour-spot"></div>
      <div class="tour-pop" role="dialog" aria-modal="true" aria-labelledby="tour-title">
        <div class="tour-step"></div>
        <h4 id="tour-title"></h4>
        <p></p>
        <div class="tour-actions">
          <button class="btn ghost small" data-t="skip">Skip tour</button>
          <span class="spacer"></span>
          <button class="btn small" data-t="back">Back</button>
          <button class="btn primary small" data-t="next">Next</button>
        </div>
      </div>`;
    document.body.append(layer);
    layer.querySelector('[data-t="skip"]').addEventListener('click', end);
    layer.querySelector('[data-t="back"]').addEventListener('click', () => go(i - 1));
    layer.querySelector('[data-t="next"]').addEventListener('click', () => (i === steps.length - 1 ? end() : go(i + 1)));
    window.addEventListener('resize', place);
    document.addEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (!layer) return;
    if (e.key === 'Escape') end();
    if (e.key === 'ArrowRight') layer.querySelector('[data-t="next"]').click();
    if (e.key === 'ArrowLeft' && i > 0) go(i - 1);
  }

  async function go(n) {
    i = Math.max(0, Math.min(steps.length - 1, n));
    const s = steps[i];
    await s.before?.();
    const pop = layer.querySelector('.tour-pop');
    pop.querySelector('.tour-step').textContent = `${i + 1} of ${steps.length}`;
    pop.querySelector('h4').textContent = s.title;
    pop.querySelector('p').innerHTML = esc(s.body).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    layer.querySelector('[data-t="back"]').hidden = i === 0;
    layer.querySelector('[data-t="next"]').textContent = i === steps.length - 1 ? 'Done' : 'Next';
    document.querySelector(s.target)?.scrollIntoView({ block: 'nearest' });
    requestAnimationFrame(() => requestAnimationFrame(place));
    pop.querySelector('[data-t="next"]').focus({ preventScroll: true });
  }

  function place() {
    if (!layer) return;
    const target = document.querySelector(steps[i].target);
    const spot = layer.querySelector('.tour-spot');
    const pop = layer.querySelector('.tour-pop');
    if (!target) return;
    const r = target.getBoundingClientRect();
    const pad = 6;
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const pw = Math.min(340, window.innerWidth - 32);
    pop.style.width = `${pw}px`;
    const ph = pop.offsetHeight;
    let top = r.bottom + 14;
    if (top + ph > window.innerHeight - 12) top = r.top - ph - 14;
    if (top < 12) top = Math.max(12, Math.min(window.innerHeight - ph - 12, r.top + 12));
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(16, Math.min(window.innerWidth - pw - 16, left));
    Object.assign(pop.style, { top: `${top}px`, left: `${left}px` });
  }

  function end() {
    prefs.write(SEEN_KEY, true);
    window.removeEventListener('resize', place);
    document.removeEventListener('keydown', onKey);
    layer?.remove();
    layer = null;
    onEnd?.();
  }

  return {
    start() {
      if (layer) return;
      build();
      go(0);
    },
    startIfNew() {
      if (!prefs.read(SEEN_KEY, false)) this.start();
    },
  };
}
