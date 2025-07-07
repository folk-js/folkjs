import { ReactiveElement } from '@folkjs/dom/ReactiveElement';

declare global {
  interface HTMLElementTagNameMap {
    'folk-timer': FolkTimer;
  }
}

export class FolkTimer extends ReactiveElement {
  static override tagName = 'folk-timer';

  #timeMs = 0;
  #timeoutId = -1;

  #intervalMs = 100;

  override connectedCallback() {
    super.connectedCallback();
    this.reset();
  }

  start() {
    this.#timeoutId = window.setInterval(this.#updateTime, this.#intervalMs);
  }

  stop() {
    window.clearInterval(this.#timeoutId);
    this.#timeoutId = -1;
  }

  reset() {
    this.stop();
    this.#updateTime(0);
  }

  restart() {
    this.reset();
    this.start();
  }

  #updateTime = (time = this.#timeMs + this.#intervalMs) => {
    this.#timeMs = time;
    this.renderRoot.textContent = (time / 1000).toFixed(1);
  };
}

FolkTimer.define();
