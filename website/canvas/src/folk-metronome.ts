import { FolkElement } from '@folkjs/lib';

declare global {
  interface HTMLElementTagNameMap {
    'folk-metronome': FolkMetronome;
  }
}

export class FolkMetronome extends FolkElement {
  static override tagName = 'folk-metronome';

  constructor() {
    super();

    this.addEventListener('click', this);
  }

  #timeoutId: number = -1;

  get isPlaying() {
    return this.#timeoutId !== -1;
  }

  // default to 100ms per beat
  #bpm = Number(this.getAttribute('bpm') || 100);
  get bpm() {
    return this.#bpm;
  }
  set bpm(bpm) {
    this.#bpm = bpm;
  }

  #beat = 0;
  get beat() {
    return this.#beat;
  }

  get #intervalMs() {
    return (60 * 1000) / this.#bpm;
  }

  handleEvent(e: Event) {
    if (e.type === 'click' && e.target === this) {
      this.isPlaying ? this.pause() : this.play();
    }
  }

  play() {
    this.#timeoutId = window.setInterval(() => {
      this.#updateBeat(this.#beat + 1);
      this.dispatchEvent(new Event('beat'));
    }, this.#intervalMs);
  }

  pause() {
    clearInterval(this.#timeoutId);
    this.#timeoutId = -1;
  }

  reset() {
    this.pause();
    this.#updateBeat(0);
  }

  #updateBeat = (nextBeat: number) => {
    this.#beat = ((nextBeat - 1) % 4) + 1;
    this.textContent = this.#beat.toString();
  };
}

FolkMetronome.define();
