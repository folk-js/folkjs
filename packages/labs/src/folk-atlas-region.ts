import { ReactiveElement, css } from '@folkjs/dom/ReactiveElement';
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
 *  - The atlas draws the region's outline (green fill + dashed border)
 *    into a *back* layer that sits behind shapes, so the region reads
 *    as the floor of the space rather than a sticker on top of it. The
 *    region element itself owns only the controls.
 *  - The atlas computes the on-screen centre of the bound face's
 *    polygon and pokes it into our controls layer via
 *    {@link setControlsScreenPosition}.
 *
 * Living entirely in screen coordinates lets the controls stay crisp at
 * any zoom level (no transform inheritance, no counter-scaling).
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

    .controls .sep {
      width: 1px;
      align-self: stretch;
      margin: 2px 0;
      background: oklch(85% 0.04 145);
    }

    .controls .scale-readout {
      all: unset;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 38px;
      height: 26px;
      padding: 0 4px;
      border-radius: 5px;
      cursor: pointer;
      font: 11px/1 ui-sans-serif, system-ui, sans-serif;
      color: oklch(35% 0.05 145);
      letter-spacing: 0.02em;
    }
    .controls .scale-readout:hover {
      background: oklch(95% 0.04 145);
    }
  `;

  static override properties = {
    wrapH: { type: Boolean, reflect: true, attribute: 'wrap-h' },
    wrapV: { type: Boolean, reflect: true, attribute: 'wrap-v' },
    interiorScale: { type: Number, reflect: true, attribute: 'interior-scale' },
  };

  declare wrapH: boolean;
  declare wrapV: boolean;
  /**
   * Region's interior scale relative to the outside frame. Default 1
   * (no scale change at the boundary). Larger values "zoom in" — the
   * interior is intrinsically bigger, contents inside render at `1/S`
   * from outside, and entering shrinks your stride by the same factor.
   * Smaller values (in `(0, 1)`) "zoom out".
   *
   * Set via {@link FolkAtlas.setRegionScale} so the underlying twin
   * transforms are kept in lockstep with this declarative value.
   */
  declare interiorScale: number;

  /**
   * The atlas Face this region is bound to. Set by the parent atlas on
   * registration; cleared (`null`) when the face is destroyed by an
   * unrelated mutation.
   */
  face: Face | null = null;

  #controls!: HTMLDivElement;
  #wrapHBtn!: HTMLButtonElement;
  #wrapVBtn!: HTMLButtonElement;
  #scaleDownBtn!: HTMLButtonElement;
  #scaleResetBtn!: HTMLButtonElement;
  #scaleUpBtn!: HTMLButtonElement;

  constructor() {
    super();
    this.wrapH = false;
    this.wrapV = false;
    this.interiorScale = 1;
  }

  /**
   * The owning `<folk-atlas>`, or `null` if not registered. Regions live
   * inside the atlas's shadow DOM (the `#regionLayer`), so `closest()`
   * can't see across the boundary — we walk the composed tree via
   * `getRootNode()` and pick up the host. Falls back to a light-DOM
   * lookup so external `<folk-atlas-region>` children still resolve.
   */
  get atlas(): FolkAtlas | null {
    const rootNode = this.getRootNode();
    if (rootNode instanceof ShadowRoot) {
      const host = rootNode.host;
      if (host && host.tagName === 'FOLK-ATLAS') return host as FolkAtlas;
    }
    return this.closest('folk-atlas') as FolkAtlas | null;
  }

  override connectedCallback() {
    super.connectedCallback();
    const root = this.shadowRoot!;

    this.#controls = document.createElement('div');
    this.#controls.className = 'controls';

    this.#wrapHBtn = this.#makeWrapButton('horizontal', 'Wrap horizontally (left ↔ right)');
    this.#wrapVBtn = this.#makeWrapButton('vertical', 'Wrap vertically (top ↔ bottom)');

    const sep = document.createElement('span');
    sep.className = 'sep';
    sep.setAttribute('aria-hidden', 'true');

    this.#scaleDownBtn = this.#makeScaleButton(
      0.5,
      'Halve interior scale (zoom out the inside)',
      '÷2',
    );
    this.#scaleResetBtn = this.#makeScaleResetButton();
    this.#scaleUpBtn = this.#makeScaleButton(
      2,
      'Double interior scale (zoom in the inside)',
      '×2',
    );

    this.#controls.append(
      this.#wrapHBtn,
      this.#wrapVBtn,
      sep,
      this.#scaleDownBtn,
      this.#scaleResetBtn,
      this.#scaleUpBtn,
    );
    root.append(this.#controls);

    this.#syncButtonState();
  }

  protected override willUpdate(changed: Map<PropertyKey, unknown>) {
    if (changed.has('wrapH') || changed.has('wrapV') || changed.has('interiorScale')) {
      this.#syncButtonState();
    }
  }

  // -------------------------------------------------------------------------
  // Atlas-driven placement (called per render frame)
  // -------------------------------------------------------------------------

  /**
   * Position the controls panel in screen coordinates. The atlas computes
   * `(x, y)` as a sensible anchor for the bound face (e.g. its on-screen
   * centroid). The outline itself is rendered separately by the atlas in
   * its back layer.
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
    if (this.#scaleResetBtn) {
      this.#scaleResetBtn.textContent = formatScale(this.interiorScale ?? 1);
    }
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

  /**
   * Build a `[÷2]` / `[×2]` button that multiplies the region's
   * `interiorScale` by `factor`. The actual mutation goes through
   * {@link FolkAtlas.setRegionScale} so twin transforms stay in sync.
   */
  #makeScaleButton(factor: number, title: string, label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = title;
    btn.className = 'scale-step';
    btn.textContent = label;
    btn.style.fontSize = '12px';
    btn.style.fontFamily = 'ui-sans-serif, system-ui, sans-serif';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const atlas = this.atlas;
      if (!atlas) return;
      const next = (this.interiorScale ?? 1) * factor;
      atlas.setRegionScale(this, next);
    });
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    return btn;
  }

  /**
   * Read-out button showing the current `interiorScale` (e.g. `1×`,
   * `2×`, `0.5×`). Click to reset to 1 (so users can recover from
   * runaway zooms quickly).
   */
  #makeScaleResetButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Click to reset interior scale to 1×';
    btn.className = 'scale-readout';
    btn.textContent = formatScale(this.interiorScale ?? 1);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const atlas = this.atlas;
      if (!atlas) return;
      atlas.setRegionScale(this, 1);
    });
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    return btn;
  }
}

/** Format a scale factor for the read-out: `1×`, `2×`, `0.5×`, `0.25×`. */
function formatScale(s: number): string {
  if (Math.abs(s - 1) < 1e-6) return '1×';
  if (Math.abs(s - Math.round(s)) < 1e-6) return `${Math.round(s)}×`;
  // Show up to three decimal places, trimming trailing zeros.
  return `${parseFloat(s.toFixed(3))}×`;
}
