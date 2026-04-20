import { ReactiveElement, css } from '@folkjs/dom/ReactiveElement';
import type { Point } from '@folkjs/geometry/Vector2';
import type { Face } from './atlas.ts';
import type { FolkAtlas, RegionWrapAxis } from './folk-atlas.ts';

declare global {
  interface HTMLElementTagNameMap {
    'folk-atlas-region': FolkAtlasRegion;
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * `<folk-atlas-region>` — a structural region inside a `<folk-atlas>`.
 *
 * A region is a *binding* to a real Face in the atlas (typically the centre
 * face produced by four axis-aligned line cuts). It owns no positional
 * state of its own — the parent atlas drives placement every frame:
 *
 *  - The atlas reads the bound face's local junctions, projects them to
 *    screen via `(view · faceComposite)`, and pokes the resulting polygon
 *    into our outline SVG via {@link setOutlineScreenPoints}.
 *  - The atlas computes the on-screen centre of the polygon and pokes it
 *    into our controls layer via {@link setControlsScreenPosition}.
 *
 * Living entirely in screen coordinates lets the outline + handles stay
 * crisp at any zoom level (no transform inheritance, no counter-scaling).
 *
 * The region exposes two wrap toggles via buttons that delegate the actual
 * twin/untwin work back to the parent atlas through
 * `FolkAtlas.wrapRegionAxis`. The buttons are always present; the atlas
 * keeps `wrapH` / `wrapV` state in sync with the actual atlas topology.
 */
export class FolkAtlasRegion extends ReactiveElement {
  static override tagName = 'folk-atlas-region';

  static override styles = css`
    :host {
      position: absolute;
      top: 0;
      left: 0;
      pointer-events: none;
      width: 0;
      height: 0;
    }

    .outline {
      position: absolute;
      inset: 0;
      overflow: visible;
      pointer-events: none;
    }

    .outline polygon {
      fill: oklch(70% 0.18 145 / 0.06);
      stroke: oklch(48% 0.18 145 / 0.85);
      stroke-width: 1.5;
      stroke-dasharray: 6 4;
      vector-effect: non-scaling-stroke;
    }

    .controls {
      position: absolute;
      top: 0;
      left: 0;
      display: flex;
      gap: 4px;
      padding: 4px;
      background: rgba(255, 255, 255, 0.95);
      border-radius: 8px;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
      pointer-events: auto;
      transform-origin: 0 0;
    }

    .controls button {
      all: unset;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: 5px;
      cursor: pointer;
      color: oklch(40% 0.05 145);
      transition: background 0.1s;
    }
    .controls button:hover {
      background: oklch(95% 0.04 145);
    }
    .controls button[aria-pressed='true'] {
      background: oklch(58% 0.18 145 / 0.18);
      color: oklch(35% 0.18 145);
    }
    .controls svg {
      width: 16px;
      height: 16px;
      display: block;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
      fill: none;
    }
  `;

  static override properties = {
    wrapH: { type: Boolean, reflect: true, attribute: 'wrap-h' },
    wrapV: { type: Boolean, reflect: true, attribute: 'wrap-v' },
  };

  declare wrapH: boolean;
  declare wrapV: boolean;

  /**
   * The atlas Face this region is bound to. Set by the parent atlas on
   * registration; cleared (`null`) when the face is destroyed by an
   * unrelated mutation.
   */
  face: Face | null = null;

  #svg!: SVGSVGElement;
  #poly!: SVGPolygonElement;
  #controls!: HTMLDivElement;
  #wrapHBtn!: HTMLButtonElement;
  #wrapVBtn!: HTMLButtonElement;

  constructor() {
    super();
    this.wrapH = false;
    this.wrapV = false;
  }

  /** The `<folk-atlas>` ancestor, or `null` if not nested in one. */
  get atlas(): FolkAtlas | null {
    return this.closest('folk-atlas') as FolkAtlas | null;
  }

  override connectedCallback() {
    super.connectedCallback();
    const root = this.shadowRoot!;

    this.#svg = document.createElementNS(SVG_NS, 'svg');
    this.#svg.classList.add('outline');
    this.#poly = document.createElementNS(SVG_NS, 'polygon');
    this.#svg.append(this.#poly);
    root.append(this.#svg);

    this.#controls = document.createElement('div');
    this.#controls.className = 'controls';

    this.#wrapHBtn = this.#makeWrapButton('horizontal', 'Wrap horizontally (left ↔ right)');
    this.#wrapVBtn = this.#makeWrapButton('vertical', 'Wrap vertically (top ↔ bottom)');
    this.#controls.append(this.#wrapHBtn, this.#wrapVBtn);
    root.append(this.#controls);

    this.#syncButtonState();
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>) {
    if (changed.has('wrapH') || changed.has('wrapV')) {
      this.#syncButtonState();
    }
  }

  // -------------------------------------------------------------------------
  // Atlas-driven placement (called per render frame)
  // -------------------------------------------------------------------------

  /**
   * Replace the outline polygon's vertices with the given screen-space
   * points. The atlas computes these from `(view · faceComposite)`
   * applied to the bound face's local junctions.
   */
  setOutlineScreenPoints(points: ReadonlyArray<Point>): void {
    if (points.length === 0) {
      this.#poly.setAttribute('points', '');
      return;
    }
    const s = points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    this.#poly.setAttribute('points', s);
  }

  /**
   * Position the controls panel in screen coordinates. The atlas computes
   * `(x, y)` as a sensible anchor for the bound face (e.g. its on-screen
   * centroid).
   */
  setControlsScreenPosition(x: number, y: number): void {
    this.#controls.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  }

  /** Show / hide the entire region (atlas calls this when the face is gone). */
  setVisible(visible: boolean): void {
    this.style.display = visible ? '' : 'none';
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  #syncButtonState(): void {
    if (!this.#wrapHBtn || !this.#wrapVBtn) return;
    this.#wrapHBtn.setAttribute('aria-pressed', String(!!this.wrapH));
    this.#wrapVBtn.setAttribute('aria-pressed', String(!!this.wrapV));
  }

  #makeWrapButton(axis: RegionWrapAxis, title: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = title;
    btn.dataset.axis = axis;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    if (axis === 'horizontal') {
      // left arrow ←—→ right arrow
      svg.innerHTML =
        '<path d="M3 12h18"/><path d="M7 8l-4 4 4 4"/><path d="M17 8l4 4-4 4"/>';
    } else {
      // up arrow ↑/↓ down arrow
      svg.innerHTML =
        '<path d="M12 3v18"/><path d="M8 7l4-4 4 4"/><path d="M8 17l4 4 4-4"/>';
    }
    btn.append(svg);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const atlas = this.atlas;
      if (!atlas) return;
      atlas.wrapRegionAxis(this, axis);
    });
    // Stop pointerdown so the wheel-pan / tool gestures don't fire when
    // dragging a button.
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    return btn;
  }
}
