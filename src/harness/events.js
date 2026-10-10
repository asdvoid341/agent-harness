/**
 * EventBus — the harness's observability spine.
 *
 * Every internal step of the agent emits an event here. Both halves of the UI
 * (the chat app and the "behind the scenes" inspector) are just subscribers.
 * That is what keeps the guide honest: it renders what actually happened,
 * not a scripted animation.
 *
 * It also implements "step mode": `pause()` blocks the loop at a checkpoint
 * until someone calls `resume()`, so a viewer can inspect each phase.
 */
export class EventBus {
  constructor() {
    this.listeners = new Set();
    this.log = [];
    this.seq = 0;
    this.stepMode = false;
    this._resume = null;
    this.t0 = performance.now();
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type, data = {}) {
    const evt = { seq: ++this.seq, type, t: Math.round(performance.now() - this.t0), at: new Date().toISOString(), data };
    this.log.push(evt);
    for (const fn of this.listeners) {
      try { fn(evt); } catch (err) { console.error('[event listener]', type, err); }
    }
    return evt;
  }

  get paused() {
    return this._resume !== null;
  }

  /** Checkpoint: in step mode, wait here until resume() (or the run is aborted). */
  async pause(label, signal) {
    if (!this.stepMode) return;
    await new Promise((resolve, reject) => {
      const onAbort = () => {
        this._resume = null;
        reject(new DOMException('Run cancelled', 'AbortError'));
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      this._resume = () => {
        signal?.removeEventListener('abort', onAbort);
        this._resume = null;
        resolve();
      };
      this.emit('step:paused', { label });
    });
  }

  resume() {
    this._resume?.();
  }

  setStepMode(on) {
    this.stepMode = on;
    if (!on) this.resume();
  }
}
