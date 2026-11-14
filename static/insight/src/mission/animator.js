/** Easing curves. */
export const ease = {
  linear: (t) => t,
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outCubic: (t) => 1 - (1 - t) ** 3,
};

/**
 * Minimal frame-driven tweening. Each tween/wait returns a promise, so sequences
 * read as plain async code. cancelAll() drops every running task (their promises
 * never resolve, which halts any sequence awaiting them).
 */
export class Animator {
  constructor() {
    this.tasks = new Set();
  }

  get busy() {
    return this.tasks.size > 0;
  }

  update(dt) {
    for (const task of [...this.tasks]) task(dt);
  }

  tween(duration, onUpdate, easing = ease.inOutCubic) {
    return new Promise((resolve) => {
      let t = 0;
      const task = (dt) => {
        t += dt;
        const k = duration > 0 ? Math.min(1, t / duration) : 1;
        onUpdate(easing(k), k);
        if (k >= 1) {
          this.tasks.delete(task);
          resolve();
        }
      };
      this.tasks.add(task);
      task(0);
    });
  }

  wait(seconds) {
    return this.tween(seconds, () => {}, ease.linear);
  }

  cancelAll() {
    this.tasks.clear();
  }
}
