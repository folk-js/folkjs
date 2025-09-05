import {
  ReactiveElement,
  css,
  property,
  type ComplexAttributeConverter,
  type PropertyValues,
} from '@folkjs/dom/ReactiveElement';
import { ResizeManager } from '@folkjs/dom/ResizeManger';
import { average, toDOMPrecision } from '@folkjs/geometry/utilities';
import * as V from '@folkjs/geometry/Vector2';
import { getStroke } from 'perfect-freehand';

export type StrokePoint = V.RelativePoint & { pressure?: number };

// TODO: look into any-pointer media queries to tell if the user has a mouse or touch screen
// https://developer.mozilla.org/en-US/docs/Web/CSS/@media/any-pointer

declare global {
  interface HTMLElementTagNameMap {
    'folk-ink': FolkInk;
  }
}

export function toSVGPath(vertices: V.Point[]): string {
  const len = vertices.length;

  if (len < 4) return '';

  const a = vertices[0];
  const b = vertices[1];
  const c = vertices[2];

  let result = `M${toDOMPrecision(a.x)},${toDOMPrecision(a.y)} Q${toDOMPrecision(b.x)},${toDOMPrecision(b.y)} ${toDOMPrecision(average(b.x, c.x))},${toDOMPrecision(average(b.y, c.y))} T`;

  for (let i = 2, max = len - 1; i < max; i++) {
    const p1 = vertices[i];
    const p2 = vertices[i + 1];
    result += ` ${toDOMPrecision(average(p1.x, p2.x))},${toDOMPrecision(average(p1.y, p2.y))}`;
  }

  result += 'Z';

  return result;
}

const converter: ComplexAttributeConverter<StrokePoint[]> = {
  fromAttribute(value) {
    if (value === null) return [];
    return value.split(' ').map((point) => {
      const [x, y, pressure] = point.split(',').map(Number);
      return {
        x: Number(x),
        y: Number(y),
        pressure: Number.isNaN(pressure) ? undefined : pressure,
      };
    });
  },
  toAttribute(value) {
    return value
      .map((point) => {
        let str = `${toDOMPrecision(point.x)},${toDOMPrecision(point.y)}`;
        if (point.pressure !== undefined) str += `,${toDOMPrecision(point.pressure)}`;
        return str;
      })
      .join(' ');
  },
};

const rm = new ResizeManager();

export class FolkInk extends ReactiveElement {
  static override tagName = 'folk-ink';

  static override styles = css`
    :host {
      display: block;
      height: 100%;
      width: 100%;
      pointer-events: none;
    }

    [part='stroke'],
    [part='stroke-overlay'] {
      position: absolute;
      inset: 0;
      pointer-events: all;
      overflow: hidden;
    }

    [part='stroke'] {
      background-color: black;
    }

    [part='stroke-overlay'] {
      background-color: rgba(0, 0, 0, 0.1);
      opacity: 0;
      transition: opacity 0.1s ease-out;

      &:hover {
        opacity: 1;
      }
    }
  `;

  @property({ type: Number, reflect: true }) size = 8;

  @property({ type: Number, reflect: true }) thinning = 0.5;

  @property({ type: Number, reflect: true }) smoothing = 0;

  @property({ type: String, reflect: true }) color = 'black';

  @property({ type: Array, reflect: true, converter }) points: StrokePoint[] = [];

  #stroke = document.createElement('div');
  #strokeOverlay = document.createElement('div');

  override createRenderRoot() {
    const root = super.createRenderRoot();

    this.#stroke.part.add('stroke');
    this.#strokeOverlay.part.add('stroke-overlay');

    root.append(this.#stroke, this.#strokeOverlay);

    this.addEventListener('transform', this.#onTransform);

    return root;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    rm.observe(this, this.#onTransform);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    rm.unobserve(this, this.#onTransform);
  }

  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);

    if (changedProperties.has('color')) {
      this.#stroke.style.backgroundColor = this.color;
    }

    if (this.points.length === 0) {
      this.#stroke.style.clipPath = this.#strokeOverlay.style.clipPath = '';
      this.#stroke.style.display = this.#strokeOverlay.style.display = 'none';
      return;
    }

    this.#stroke.style.display = this.#strokeOverlay.style.display = '';

    const width = this.offsetWidth;
    const height = this.offsetHeight;
    const vertices = this.points.map((p) => ({
      x: p.x * width,
      y: p.y * height,
    }));

    const stroke = getStroke(vertices, {
      size: this.size,
      thinning: this.thinning,
      smoothing: this.smoothing,
      simulatePressure: true,
      start: {
        cap: true,
      },
      end: {
        cap: true,
      },
    }).map(([x, y]) => ({ x, y }));

    this.#stroke.style.clipPath = 'path("' + toSVGPath(stroke) + '")';

    const strokeOverlay = getStroke(vertices, {
      size: this.size + 5,
      thinning: 0,
      smoothing: this.smoothing,
      simulatePressure: true,
      start: {
        cap: true,
      },
      end: {
        cap: true,
      },
    }).map(([x, y]) => ({ x, y }));

    this.#strokeOverlay.style.clipPath = 'path("' + toSVGPath(strokeOverlay) + '")';
  }

  #onTransform = () => {
    this.requestUpdate();
  };
}
