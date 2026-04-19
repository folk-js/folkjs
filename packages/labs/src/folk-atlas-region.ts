import { ReactiveElement, css } from '@folkjs/dom/ReactiveElement';
import type { Point } from '@folkjs/geometry/Vector2';
import type { FolkAtlas } from './folk-atlas.ts';

declare global {
  interface HTMLElementTagNameMap {
    'folk-atlas-region': FolkAtlasRegion;
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * `<folk-atlas-region>` — a polygonal region inside a `<folk-atlas>`.
 *
 * **Status:** declarative, visual-only. The region renders a translucent
 * polygon at the coordinates supplied by its `points` attribute. There is
 * deliberately no drag interaction yet — the previous implementation depended
 * on a "root-local" coordinate frame that the SIA model has now removed
 * (there is no global Euclidean frame; coordinates are face-relative).
 *
 * For the prototype the polygon's `(x, y)` numbers are interpreted in the
 * atlas's current root face's frame. Because root may change at any time
 * (notably during a `splitFaceAtInterior` that touches the root), this is
 * a temporary visualisation-only convention. When regions become structural
 * (driving an actual operation that mutates the atlas), they will store an
 * `anchorFace` and re-express their polygon vertices in that face's frame
 * via the atlas's `reexpressPoint` API.
 *
 * Attributes
 *   - `points`: space-separated CCW vertex list, e.g. `"40,40 280,40 160,260"`,
 *     interpreted in the atlas root face's local frame.
 */
export class FolkAtlasRegion extends ReactiveElement {
  static override tagName = 'folk-atlas-region';

  static override styles = css`
    :host {
      position: absolute;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      transform-origin: 0 0;
      pointer-events: none;
    }

    svg {
      position: absolute;
      overflow: visible;
      pointer-events: none;
    }

    .body {
      fill: oklch(70% 0.18 145 / 0.18);
      stroke: oklch(58% 0.18 145 / 0.7);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
      pointer-events: none;
    }
  `;

  static override properties = {
    points: { type: String, reflect: true },
  };

  declare points: string;

  /** Parsed polygon (kept in sync with `points`); always either empty or length 3. */
  #polygon: Point[] = [];

  #svg!: SVGSVGElement;
  #poly!: SVGPolygonElement;

  constructor() {
    super();
    this.points = '';
  }

  /** A copy of the current polygon vertices, or `null` if not a triangle. */
  get polygon(): Point[] | null {
    return this.#polygon.length === 3 ? this.#polygon.map((p) => ({ ...p })) : null;
  }

  /** The `<folk-atlas>` ancestor, or `null` if not nested in one. */
  get atlas(): FolkAtlas | null {
    return this.closest('folk-atlas') as FolkAtlas | null;
  }

  override connectedCallback() {
    super.connectedCallback();
    const root = this.shadowRoot!;

    this.#svg = document.createElementNS(SVG_NS, 'svg');
    this.#poly = document.createElementNS(SVG_NS, 'polygon');
    this.#poly.classList.add('body');
    this.#svg.append(this.#poly);
    root.append(this.#svg);

    this.#parsePointsAttr();
    this.#renderVisual();
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>) {
    if (changed.has('points')) {
      this.#parsePointsAttr();
      this.#renderVisual();
    }
  }

  #parsePointsAttr() {
    const raw = (this.points || this.getAttribute('points') || '').trim();
    if (!raw) {
      this.#polygon = [];
      return;
    }
    const tokens = raw.split(/\s+/);
    const out: Point[] = [];
    for (const token of tokens) {
      const [xs, ys] = token.split(',');
      const x = Number(xs);
      const y = Number(ys);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        this.#polygon = [];
        return;
      }
      out.push({ x, y });
    }
    this.#polygon = out.length === 3 ? out : [];
  }

  #renderVisual() {
    if (!this.#poly) return;
    if (this.#polygon.length !== 3) {
      this.#poly.setAttribute('points', '');
      return;
    }
    this.#poly.setAttribute(
      'points',
      this.#polygon.map((p) => `${p.x},${p.y}`).join(' '),
    );
  }
}
