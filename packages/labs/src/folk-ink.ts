import { ReactiveElement, css, property, type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { toCSSShape } from '@folkjs/geometry/Path2D';
import { type Point } from '@folkjs/geometry/Vector2';
import { getStroke } from 'perfect-freehand';

export type StrokePoint = Point & { pressure?: number };

// TODO: look into any-pointer media queries to tell if the user has a mouse or touch screen
// https://developer.mozilla.org/en-US/docs/Web/CSS/@media/any-pointer

declare global {
  interface HTMLElementTagNameMap {
    'folk-ink': FolkInk;
  }
}

export class FolkInk extends ReactiveElement {
  static override tagName = 'folk-ink';

  static override styles = css`
    :host,
    div {
      display: block;
      height: 100%;
      width: 100%;
      touch-action: none;
      pointer-events: none;
    }

    div {
      background-color: black;
    }
  `;

  @property({ type: Number, reflect: true }) size = 16;

  @property({ type: Number, reflect: true }) thinning = 0.5;

  @property({ type: Number, reflect: true }) smoothing = 0.5;

  @property({ type: Number, reflect: true }) streamline = 0.5;

  @property({ type: Boolean, reflect: true }) simulatePressure = true;

  @property({ type: Array, reflect: true }) points: StrokePoint[] = [];

  #div = document.createElement('div');
  #tracingPromise: PromiseWithResolvers<void> | null = null;

  override createRenderRoot() {
    const root = super.createRenderRoot();

    root.appendChild(this.#div);

    return root;
  }

  // TODO: cancel trace?
  draw(event?: PointerEvent) {
    if (event?.type === 'pointerdown') {
      this.handleEvent(event);
    } else {
      this.addEventListener('pointerdown', this);
    }
    this.#tracingPromise = Promise.withResolvers();
    return this.#tracingPromise.promise;
  }

  addPoint(point: StrokePoint) {
    this.points.push(point);
    this.requestUpdate('points');
  }

  handleEvent(event: PointerEvent) {
    switch (event.type) {
      // for some reason adding a point on pointer down causes a bug
      case 'pointerdown': {
        if (event.button !== 0 || event.ctrlKey) return;

        this.points = [];
        this.addEventListener('lostpointercapture', this);
        this.addEventListener('pointermove', this);
        this.setPointerCapture(event.pointerId);
        return;
      }
      case 'pointermove': {
        this.addPoint({
          x: event.offsetX,
          y: event.offsetY,
          pressure: event.pressure,
        });
        return;
      }
      case 'lostpointercapture': {
        this.removeEventListener('pointerdown', this);
        this.removeEventListener('pointermove', this);
        this.removeEventListener('lostpointercapture', this);
        this.#tracingPromise?.resolve();
        this.#tracingPromise = null;
        return;
      }
    }
  }

  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);

    if (this.points.length < 4) {
      this.#div.style.clipPath = '';
      this.#div.style.display = 'none';
      return;
    }

    this.#div.style.display = '';

    const vertices = getStroke(this.points, {
      size: this.size,
      thinning: this.thinning,
      smoothing: this.smoothing,
      streamline: this.streamline,
      simulatePressure: this.simulatePressure,
      // TODO: figure out how to expose these as attributes
      easing: (t) => t,
      start: {
        taper: 100,
        easing: (t) => t,
        cap: true,
      },
      end: {
        taper: 100,
        easing: (t) => t,
        cap: true,
      },
    }).map(([x, y]) => ({ x, y }));

    const path = { closed: true, vertices };
    console.log(toCSSShape(path));
    this.#div.style.clipPath = toCSSShape(path);
  }
}
