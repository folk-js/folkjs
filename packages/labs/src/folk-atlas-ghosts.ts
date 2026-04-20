import * as M from '@folkjs/geometry/Matrix2D';
import type { Face } from './atlas.ts';
import { FolkAtlasShape } from './folk-atlas-shape.ts';

/**
 * Ghost rendering for shapes whose containing face is visible at multiple
 * places on screen — the situation that arises in wrapped, looping, or
 * recursive atlases where a single face has more than one image (composite)
 * in the root frame at render time.
 *
 * # Architecture
 *
 * For each (shape, ghostIndex) pair, the renderer maintains a single cloned
 * DOM element that lives in a dedicated layer of the atlas's shadow DOM. The
 * original (light-DOM) shape always renders the *primary* image; ghosts
 * render the additional images.
 *
 * # Performance discipline
 *
 *  - Clones are pooled per shape and reused frame-to-frame. Unused ghosts
 *    are hidden via `display: none`, never removed (reattach is expensive).
 *  - Per-frame work scales with the number of (shape, image) pairs actually
 *    drawn — a no-op when no face has ghosts (the tree-atlas common case).
 *  - All updates go through `style.transform` (compositor-friendly) and
 *    `style.display` toggles; no layout thrashing, no setAttribute storms.
 *  - Ghosts are inert: `pointer-events: none`, `aria-hidden`, `inert`. They
 *    never interfere with the editable original.
 *
 * # Ownership of the original image
 *
 * The renderer is told only about *additional* (non-primary) composites per
 * face — the primary composite is handled by the existing shape render path
 * in `folk-atlas.ts`. The split keeps responsibility for hit-testing, drag,
 * and DOM identity firmly on the original element.
 */
export class ShapeGhostRenderer {
  /** Layer that ghost clones are appended to. */
  readonly #layer: HTMLElement;

  /**
   * Pool of ghost clones per source shape. Index = ghost slot number; cell 0
   * is the first non-primary image.
   */
  readonly #pool = new Map<FolkAtlasShape, HTMLElement[]>();

  constructor(layer: HTMLElement) {
    this.#layer = layer;
  }

  /**
   * Update ghost rendering for one frame.
   *
   * `extras` maps each face to the list of *additional* composites (root-frame
   * matrices) at which the face appears, beyond its primary image. Faces
   * absent from the map have no ghosts and any clones for shapes inside them
   * get hidden.
   *
   * No-op when the map is empty — the cost of "ghost rendering is enabled
   * but never used" is one map iteration.
   */
  update(extras: ReadonlyMap<Face, ReadonlyArray<M.Matrix2D>>): void {
    // First pass: per-shape current ghost count this frame.
    const usedThisFrame = new Map<FolkAtlasShape, number>();

    for (const [face, composites] of extras) {
      if (composites.length === 0) continue;
      for (const shape of face.shapes) {
        if (!(shape instanceof FolkAtlasShape)) continue;
        const startIdx = usedThisFrame.get(shape) ?? 0;
        const needCount = startIdx + composites.length;
        const ghosts = this.#poolFor(shape, needCount);
        for (let i = 0; i < composites.length; i++) {
          const ghost = ghosts[startIdx + i];
          // Compose with the shape's anchor offset, mirroring what
          // folk-atlas.ts does for the primary image.
          const m = M.translate(composites[i], shape.x, shape.y);
          const cssTransform = M.toCSSString(m);
          if (ghost.style.transform !== cssTransform) ghost.style.transform = cssTransform;
          if (ghost.style.display === 'none') ghost.style.display = '';
        }
        usedThisFrame.set(shape, needCount);
      }
    }

    // Second pass: hide any pool slots not used this frame.
    for (const [shape, ghosts] of this.#pool) {
      const used = usedThisFrame.get(shape) ?? 0;
      for (let i = used; i < ghosts.length; i++) {
        if (ghosts[i].style.display !== 'none') ghosts[i].style.display = 'none';
      }
    }
  }

  /** Tear down all ghosts owned for `shape` (e.g. when the shape is removed). */
  removeShape(shape: FolkAtlasShape): void {
    const ghosts = this.#pool.get(shape);
    if (!ghosts) return;
    for (const ghost of ghosts) ghost.remove();
    this.#pool.delete(shape);
  }

  /** Tear down every ghost. */
  clear(): void {
    for (const [, ghosts] of this.#pool) {
      for (const ghost of ghosts) ghost.remove();
    }
    this.#pool.clear();
  }

  /**
   * Mirror a per-shape attribute (e.g. dimensions) onto every existing ghost
   * clone for that shape. Cheaper than re-cloning when the original's size
   * or appearance changes mid-life.
   */
  syncShape(shape: FolkAtlasShape): void {
    const ghosts = this.#pool.get(shape);
    if (!ghosts) return;
    for (const ghost of ghosts) this.#applyShapeProps(shape, ghost);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Get-or-grow the ghost pool for `shape`, ensuring at least `n` slots. */
  #poolFor(shape: FolkAtlasShape, n: number): HTMLElement[] {
    let ghosts = this.#pool.get(shape);
    if (!ghosts) {
      ghosts = [];
      this.#pool.set(shape, ghosts);
    }
    while (ghosts.length < n) {
      ghosts.push(this.#cloneShape(shape));
    }
    return ghosts;
  }

  /**
   * Make a display-only clone of `shape`. The clone is appended to the ghost
   * layer immediately and starts hidden — the next `update()` call will set
   * its transform and reveal it.
   *
   * We deliberately use a plain `<div>` rather than cloning a custom
   * element, to avoid running its lifecycle (and any pointer-handler
   * registration). The visual fidelity comes from copying the shape's
   * computed dimensions and inner HTML.
   */
  #cloneShape(shape: FolkAtlasShape): HTMLElement {
    const ghost = document.createElement('div');
    ghost.dataset.atlasGhost = '';
    ghost.setAttribute('aria-hidden', 'true');
    // `inert` keeps the clone out of the focus order and a11y tree.
    ghost.setAttribute('inert', '');
    ghost.style.position = 'absolute';
    ghost.style.top = '0';
    ghost.style.left = '0';
    ghost.style.transformOrigin = '0 0';
    ghost.style.willChange = 'transform';
    ghost.style.pointerEvents = 'none';
    ghost.style.userSelect = 'none';
    ghost.style.display = 'none';
    this.#applyShapeProps(shape, ghost);
    this.#layer.append(ghost);
    return ghost;
  }

  /**
   * Copy the visual surface of `shape` onto `ghost`: dimensions, then a
   * snapshot of the shape's projected (slotted) content as inner HTML. We
   * read the shape's `width`/`height` properties directly — cheaper and
   * more reliable than reading computed style.
   */
  #applyShapeProps(shape: FolkAtlasShape, ghost: HTMLElement): void {
    ghost.style.width = `${shape.width}px`;
    ghost.style.height = `${shape.height}px`;
    // Match the shape's host styling so ghosts read as faithful copies.
    // Kept in sync with `FolkAtlasShape.styles` — adjust together.
    ghost.style.boxSizing = 'border-box';
    ghost.style.padding = '8px 10px';
    ghost.style.background = 'white';
    ghost.style.border = '1px solid oklch(85% 0.02 277)';
    ghost.style.borderRadius = '6px';
    ghost.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.08)';
    ghost.style.font = '13px/1.3 ui-sans-serif, system-ui, sans-serif';
    ghost.style.color = 'oklch(30% 0.05 277)';
    ghost.style.opacity = '0.7';
    ghost.innerHTML = shape.innerHTML;
  }
}
