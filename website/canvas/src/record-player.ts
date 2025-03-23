// Ported from https://github.com/bitu467/record-player
import { css, html } from '@folkjs/lib/tags';

const styles = css`
  ::slotted(*) {
    display: none;
  }

  :host {
    display: block;
    position: relative;
  }

  .player {
    background-color: #d52831;
    width: 330px;
    height: 190px;
    border-radius: 10px;
    box-shadow: 0 8px 0 0 #be2728;
    margin-top: -4px;
  }

  .record {
    width: 175px;
    height: 175px;
    background-color: #181312;
    position: absolute;
    border-radius: 50%;
    top: 10px;
    left: 20px;
    display: flex;
    justify-content: center;
    align-items: center;
    animation: spin 3s linear infinite;
    animation-play-state: paused;
  }

  .record::before,
  .record::after {
    content: '';
    position: absolute;
    border: 5px solid transparent;
    border-top-color: #2c2424;
    border-bottom-color: #2c2424;
    border-radius: 50%;
  }

  .record::before {
    width: 135px;
    height: 135px;
  }

  .record:after {
    width: 95px;
    height: 95px;
  }

  .label {
    height: 15px;
    width: 15px;
    background-color: #181312;
    border: 20px solid #ff8e00;
    border-radius: 50%;
  }

  .tone-arm {
    height: 90px;
    width: 6px;
    background-color: #ffffff;
    position: absolute;
    top: 25px;
    right: 95px;
    transform-origin: top;

    --move-time: 3s;
    animation-fill-mode: forwards;
    animation-timing-function: linear;
  }

  .control {
    background-color: #181312;
    width: 17px;
    height: 17px;
    border: 10px solid #2c2c2c;
    border-radius: 50%;
    position: absolute;
    top: -16px;
    left: -16px;
  }

  .tone-arm::before {
    content: '';
    position: absolute;
    height: 40px;
    width: 6px;
    background-color: #ffffff;
    transform: rotate(30deg);
    bottom: -36px;
    right: 10px;
  }

  .tone-arm::after {
    content: '';
    position: absolute;
    height: 0px;
    width: 10px;
    border-top: 18px solid #b2aea6;
    border-left: 2px solid transparent;
    border-right: 2px solid transparent;
    top: 108px;
    right: 12.5px;
    transform: rotate(30deg);
  }

  .btn {
    width: 28px;
    height: 28px;
    background-color: #ed5650;
    border-radius: 50%;
    position: absolute;
    bottom: 20px;
    right: 30px;
    border: none;
    border: 3.5px solid rgb(190, 39, 42);
    outline: none;
    cursor: pointer;
  }

  .slider {
    -webkit-appearance: none;
    appearance: none;
    transform: rotate(-90deg);
    width: 90px;
    height: 7px;
    position: absolute;
    left: 233px;
    top: 60px;
    background-color: #be272a;
    outline: none;
    border-radius: 3px;
    border: 6px solid #ed5650;
  }

  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 10px;
    height: 12px;
    background-color: #ffffff;
    cursor: pointer;
  }

  :host(:state(playing)) .tone-arm {
    animation:
      ready-arm var(--move-time),
      move-arm var(--duration) var(--move-time),
      reset-arm var(--move-time) calc(var(--duration) + var(--move-time));
  }

  :host(:state(playing)) .record {
    animation-play-state: running;
  }

  @keyframes ready-arm {
    20% {
      transform: rotateX(20deg);
    }

    70% {
      transform: rotateX(20deg);
      rotate: 14deg;
    }

    100% {
      rotate: 14deg;
    }
  }

  @keyframes move-arm {
    from {
      rotate: 14deg;
    }

    to {
      rotate: 42deg;
    }
  }

  @keyframes reset-arm {
    0% {
      rotate: 42deg;
    }

    20% {
      transform: rotateX(20deg);
      rotate: 42deg;
    }

    80% {
      transform: rotateX(20deg);
    }
  }

  @keyframes spin {
    from {
      rotate: 0deg;
    }

    to {
      rotate: 360deg;
    }
  }
`;

export class RecordPlayer extends HTMLElement {
  static tagName = 'record-player';

  static define() {
    if (customElements.get(this.tagName)) return;
    customElements.define(this.tagName, this);
  }

  #internals = this.attachInternals();
  #audio = this.querySelector('audio')!;
  #volumeInput: HTMLInputElement;

  constructor() {
    super();

    this.addEventListener('click', this);

    this.#audio.volume = 0.5;
    this.#audio.addEventListener('ended', this);

    const shadow = this.attachShadow({ mode: 'open' });
    shadow.adoptedStyleSheets.push(styles);

    shadow.setHTMLUnsafe(
      html` <div class="player">
          <div class="record">
            <div class="label"></div>
          </div>
          <div class="tone-arm">
            <div class="control"></div>
          </div>
          <button class="btn"></button>
          <input type="range" class="slider" min="0" max="1" step="0.01" value="1" />
        </div>
        <slot></slot>`,
    );

    this.#volumeInput = shadow.querySelector('input[type="range"]')!;
    this.#volumeInput.addEventListener('input', this);
  }

  get paused() {
    return this.#audio.paused;
  }

  get volume() {
    return this.#audio.volume;
  }

  set volume(volume) {
    this.#audio.volume = volume;
    this.#volumeInput.valueAsNumber = volume;
  }

  #playTimeout: number = -1;

  play() {
    if (!this.paused) return;

    this.#audio.volume = this.#volumeInput.valueAsNumber;
    this.style.setProperty('--duration', `${this.#audio.duration}s`);
    this.#internals.states.add('playing');
    this.#playTimeout = window.setTimeout(() => {
      this.#audio.play();
      this.dispatchEvent(new Event('playing', { bubbles: true }));
    }, 3000);
  }

  stop() {
    if (this.paused) return;

    const arm = this.shadowRoot!.querySelector('.tone-arm') as HTMLElement;

    reverseAnimation(arm);

    clearTimeout(this.#playTimeout);
    this.#internals.states.delete('playing');
    this.#audio.pause();
    this.#audio.currentTime = 0;
    this.dispatchEvent(new Event('stopped', { bubbles: true }));
  }

  handleEvent(event: Event) {
    switch (event.type) {
      case 'click': {
        const target = event.composedPath()[0] as HTMLElement;

        if (target.tagName !== 'BUTTON') return;

        this.paused ? this.play() : this.stop();
        return;
      }

      case 'input': {
        event.stopPropagation();
        this.#audio.volume = this.#volumeInput.valueAsNumber;
        this.dispatchEvent(new Event('volume', { bubbles: true }));
        return;
      }

      case 'ended': {
        this.#internals.states.delete('playing');
        return;
      }
    }
  }
}

function reverseAnimation(el: HTMLElement) {
  const animation = el.getAnimations()[0];

  if (!animation || !(animation.effect instanceof KeyframeEffect)) return;

  const originalStyles = createStyleMap(el.getAttribute('style') || '');

  animation.commitStyles();
  animation.cancel();

  const animationStyles = createStyleMap(el.getAttribute('style') || '');

  const changedProperties = diffStyles(originalStyles, animationStyles);

  // reset styles
  for (const property of changedProperties) {
    el.style.setProperty(property, originalStyles.get(property) || '');
  }

  // reverse current animation
  const { progress = 0 } = animation.effect.getComputedTiming();
  const keyframes = animation.effect.getKeyframes();

  const rotate = animationStyles.get('rotate') || 0;

  // TODO: dont hard code this
  el.animate(
    [
      { offset: 0, rotate },
      { offset: 0.2, rotate, transform: 'rotateX(20deg)' },
      { offset: 0.8, transform: 'rotateX(20deg)' },
    ],
    { duration: 3000 },
  );
}

function createStyleMap(style: string): Map<string, string> {
  const stylesMaps = new Map<string, string>();

  for (const declaration of style.split(';')) {
    if (declaration.length > 0) {
      const [property, value] = declaration.split(':');
      stylesMaps.set(property.trim(), value.trim());
    }
  }

  return stylesMaps;
}

function diffStyles(stylesA: Map<string, string>, stylesB: Map<string, string>): Set<string> {
  const changedProperties = new Set<string>();

  stylesA.forEach((valueA, property) => {
    const valueB = stylesB.get(property);

    if (valueB === undefined || valueA !== valueB) {
      changedProperties.add(property);
    }
  });

  stylesB.forEach((_, property) => {
    if (!changedProperties.has(property)) {
      changedProperties.add(property);
    }
  });

  return changedProperties;
}

RecordPlayer.define();
