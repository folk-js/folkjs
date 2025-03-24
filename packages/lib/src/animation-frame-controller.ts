import { ReactiveController, ReactiveControllerHost } from '@lit/reactive-element';
import { requestAnimationFrame, cancelAnimationFrame } from './rAF';

export interface AnimationFrameControllerHost extends ReactiveControllerHost {
  tick(): void;
  render(): void;
}

export class AnimationFrameController implements ReactiveController {
  #host;
  #lastTime = 0;
  #dtAccumulator = 0;
  #fixedTimestep = 1 / 60;
  #timeoutMs;
  #timeoutId = -1;

  get fixedTimestep() {
    return this.#fixedTimestep;
  }

  #isRunning = false;
  get isRunning() {
    return this.#isRunning;
  }

  constructor(host: AnimationFrameControllerHost, timeoutMs = 5000) {
    this.#host = host;
    this.#timeoutMs = timeoutMs;
    host.addController(this);
  }

  hostConnected() {
    this.start();
  }

  hostUpdated() {
    this.reset();
  }

  hostDisconnected() {
    this.stop();
  }

  #tick = (timestamp: DOMHighResTimeStamp = performance.now()) => {
    requestAnimationFrame(this.#tick);

    const actualDelta = (timestamp - this.#lastTime) * 0.001;
    this.#lastTime = timestamp;

    // Accumulate delta time, but clamp to avoid spiral of death
    this.#dtAccumulator = Math.min(this.#dtAccumulator + actualDelta, 0.2);

    while (this.#dtAccumulator >= this.#fixedTimestep) {
      this.#host.tick();
      this.#dtAccumulator -= this.#fixedTimestep;
    }

    this.#host.render();
  };

  start() {
    if (this.isRunning) return;

    this.#lastTime = 0;
    this.#isRunning = true;
    this.#tick();
  }

  reset() {
    window.clearTimeout(this.#timeoutId);
    this.#timeoutId = window.setTimeout(this.stop, this.#timeoutMs);
    this.start();
  }

  stop = () => {
    cancelAnimationFrame(this.#tick);
    window.clearTimeout(this.#timeoutId);
    this.#isRunning = false;
  };
}
