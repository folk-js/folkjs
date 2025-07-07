import { FolkElement, getSvgPathFromStroke } from '@folkjs/canvas';
import { css, property, type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { getStroke, type StrokeOptions } from 'perfect-freehand';

export type Point = [x: number, y: number, pressure: number];

export type Stroke = number[][];

// TODO: look into any-pointer media queries to tell if the user has a mouse or touch screen
// https://developer.mozilla.org/en-US/docs/Web/CSS/@media/any-pointer

declare global {
  interface HTMLElementTagNameMap {
    'folk-ink': FolkInk;
  }
}

export class FolkInk extends FolkElement {
  static override tagName = 'folk-ink';

  static override styles = css`
    :host,
    svg {
      display: block;
      height: 100%;
      width: 100%;
      touch-action: none;
      pointer-events: none;
    }

    :host(:state(drawing)) {
      position: fixed;
      inset: 0 0 0 0;
      cursor: var(--tracing-cursor, crosshair);
    }
  `;

  @property({ type: Number, reflect: true }) size = 16;

  @property({ type: Number, reflect: true }) thinning = 0.5;

  @property({ type: Number, reflect: true }) smoothing = 0.5;

  @property({ type: Number, reflect: true }) streamline = 0.5;

  @property({ type: Boolean, reflect: true }) simulatePressure = true;

  @property({ type: Array }) points: Point[] = [];

  #internals = this.attachInternals();
  #svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  #path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  #tracingPromise: PromiseWithResolvers<void> | null = null;

  override createRenderRoot() {
    const root = super.createRenderRoot();

    this.#svg.appendChild(this.#path);

    root.appendChild(this.#svg);
    return root;
  }

  getPathBox() {
    return this.#path.getBBox();
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

  addPoint(point: Point) {
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
        this.#internals.states.add('drawing');
        return;
      }
      case 'pointermove': {
        this.addPoint([event.offsetX, event.offsetY, event.pressure]);
        return;
      }
      case 'lostpointercapture': {
        this.removeEventListener('pointerdown', this);
        this.removeEventListener('pointermove', this);
        this.removeEventListener('lostpointercapture', this);
        this.#internals.states.delete('drawing');
        this.#tracingPromise?.resolve();
        this.#tracingPromise = null;
        return;
      }
    }
  }

  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);

    const options: StrokeOptions = {
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
    };
    this.#path.setAttribute('d', getSvgPathFromStroke(getStroke(this.points, options)));
  }
}
