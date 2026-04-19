import { ReactiveElement, css } from '@folkjs/dom/ReactiveElement';
import type { Face } from './atlas.ts';
import type { FolkAtlas } from './folk-atlas.ts';

declare global {
  interface HTMLElementTagNameMap {
    'folk-atlas-shape': FolkAtlasShape;
  }
}

/**
 * `<folk-atlas-shape>` — a draggable rectangle that lives inside a `<folk-atlas>`.
 *
 * Authoring model
 *   - `x`, `y`           — face-local coordinates of the shape's top-left corner
 *   - `width`, `height`  — dimensions in face-local units
 *   - the parent `<folk-atlas>` owns which face the shape currently belongs to;
 *     the shape itself is unaware of faces or composite transforms.
 *
 * Render model
 *   - The atlas writes `style.transform` per frame: `matrix(faceComposite ·
 *     translate(x, y))`. Combined with the atlas's view transform on the
 *     content wrapper, the on-screen position is `view · faceComposite ·
 *     translate(x, y)`. The shape itself never sets a `transform`.
 *
 * Drag model (strictly face-relative — no global / root frame is assumed)
 *   - On `pointerdown` we point-locate the pointer's containing face and
 *     capture the drag offset in **that face's local frame**:
 *     `(pointerFace, dx, dy) = (pointerFace, ptrFaceLocal - shapeOriginInPointerFace)`.
 *   - On each `pointermove` we re-locate the pointer's face, re-express the
 *     stored offset in the new pointer face's frame (via composite walk —
 *     a no-op while edge transforms are identity), and place the shape at
 *     `(ptr.face, ptr.x - offset.x, ptr.y - offset.y)`.
 *   - This survives the root face changing mid-drag (e.g. due to a split):
 *     none of the stored state references the root.
 */
export class FolkAtlasShape extends ReactiveElement {
  static override tagName = 'folk-atlas-shape';

  static override styles = css`
    :host {
      position: absolute;
      top: 0;
      left: 0;
      transform-origin: 0 0;
      box-sizing: border-box;
      width: var(--_w, 100px);
      height: var(--_h, 60px);
      padding: 8px 10px;
      background: white;
      border: 1px solid oklch(85% 0.02 277);
      border-radius: 6px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
      font: 13px/1.3 ui-sans-serif, system-ui, sans-serif;
      color: oklch(30% 0.05 277);
      cursor: grab;
      user-select: none;
      touch-action: none;
      will-change: transform;
    }

    :host([dragging]) {
      cursor: grabbing;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
      z-index: 1;
    }
  `;

  static override properties = {
    x: { type: Number },
    y: { type: Number },
    width: { type: Number },
    height: { type: Number },
  };

  declare x: number;
  declare y: number;
  declare width: number;
  declare height: number;

  /**
   * Drag offset in face-local coords of `offsetFace`:
   *   `pointerInOffsetFace - shapeOriginInOffsetFace`
   * Re-expressed in the current pointer face's frame on every pointermove.
   */
  #dragOffset: { offsetFace: Face; dx: number; dy: number } | null = null;
  #activePointerId: number | null = null;

  constructor() {
    super();
    this.x = 0;
    this.y = 0;
    this.width = 100;
    this.height = 60;
  }

  override connectedCallback() {
    super.connectedCallback();
    this.addEventListener('pointerdown', this.#onPointerDown);
    this.addEventListener('pointermove', this.#onPointerMove);
    this.addEventListener('pointerup', this.#onPointerEnd);
    this.addEventListener('pointercancel', this.#onPointerEnd);
    this.addEventListener('lostpointercapture', this.#onPointerEnd);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('pointerdown', this.#onPointerDown);
    this.removeEventListener('pointermove', this.#onPointerMove);
    this.removeEventListener('pointerup', this.#onPointerEnd);
    this.removeEventListener('pointercancel', this.#onPointerEnd);
    this.removeEventListener('lostpointercapture', this.#onPointerEnd);
  }

  protected override willUpdate(): void {
    this.style.setProperty('--_w', `${this.width}px`);
    this.style.setProperty('--_h', `${this.height}px`);
  }

  /** The `<folk-atlas>` ancestor, or `null` if this shape isn't inside one. */
  get atlas(): FolkAtlas | null {
    return this.closest('folk-atlas') as FolkAtlas | null;
  }

  #onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const atlas = this.atlas;
    if (!atlas) return;
    event.preventDefault();
    event.stopPropagation();

    const ptr = atlas.screenToFaceLocal(event.clientX, event.clientY);
    const shapeFace = atlas.shapeFace(this);
    if (!ptr || !shapeFace) return;
    // Express the shape's anchor in the pointer's face frame so the offset is
    // a single face-local delta in `ptr.face`.
    const shapeAnchorInPtrFace = atlas.reexpressPoint(
      { face: shapeFace, x: this.x, y: this.y },
      ptr.face,
    );
    this.#dragOffset = {
      offsetFace: ptr.face,
      dx: ptr.x - shapeAnchorInPtrFace.x,
      dy: ptr.y - shapeAnchorInPtrFace.y,
    };
    this.#activePointerId = event.pointerId;
    this.setPointerCapture(event.pointerId);
    this.toggleAttribute('dragging', true);
  };

  #onPointerMove = (event: PointerEvent) => {
    if (this.#activePointerId !== event.pointerId || !this.#dragOffset) return;
    const atlas = this.atlas;
    if (!atlas) return;
    const ptr = atlas.screenToFaceLocal(event.clientX, event.clientY);
    if (!ptr) return;
    // Re-express the offset (a pure displacement) in the pointer's CURRENT
    // face frame. For identity-everywhere atlases this is a no-op.
    const offsetInCur = atlas.reexpressVector(
      { x: this.#dragOffset.dx, y: this.#dragOffset.dy },
      this.#dragOffset.offsetFace,
      ptr.face,
    );
    atlas.placeShape(this, {
      face: ptr.face,
      x: ptr.x - offsetInCur.x,
      y: ptr.y - offsetInCur.y,
    });
  };

  #onPointerEnd = (event: PointerEvent) => {
    if (this.#activePointerId !== event.pointerId) return;
    this.#dragOffset = null;
    this.#activePointerId = null;
    if (this.hasPointerCapture(event.pointerId)) this.releasePointerCapture(event.pointerId);
    this.toggleAttribute('dragging', false);
  };
}
