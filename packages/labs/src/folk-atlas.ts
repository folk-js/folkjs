import { ReactiveElement, css } from '@folkjs/dom/ReactiveElement';
import * as M from '@folkjs/geometry/Matrix2D';
import type { Point } from '@folkjs/geometry/Vector2';
import {
  aroundJunction,
  Atlas,
  createInitialAtlas,
  Face,
  type HalfEdge,
  splitFaceAtInterior,
  validateAtlas,
} from './atlas.ts';
import type { FolkAtlasRegion } from './folk-atlas-region.ts';
import { FolkAtlasShape } from './folk-atlas-shape.ts';

export {
  aroundJunction,
  Atlas,
  createInitialAtlas,
  Face,
  HalfEdge,
  splitFaceAtInterior,
  splitFaceAlongEdge,
  validateAtlas,
} from './atlas.ts';

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;

declare global {
  interface HTMLElementTagNameMap {
    'folk-atlas': FolkAtlas;
  }
}

/**
 * A face-relative point: a point expressed in some face's local frame.
 *
 * This is the canonical "atlas coordinate" — the SIA model has no global
 * Euclidean frame, so any positional value passed across the atlas boundary
 * must be tagged with the face it belongs to. The `Atlas` knows how to
 * re-express a `FaceLocalPoint` in another face's frame by composing edge
 * transforms along a walk.
 */
export interface FaceLocalPoint {
  face: Face;
  x: number;
  y: number;
}

/**
 * `<folk-atlas>` — a Sparse Ideal Atlas substrate for spatial canvases.
 *
 * Light-DOM children are slotted into a single content layer that carries the
 * pan/zoom view transform. Children come in two flavours:
 *  - `<folk-atlas-shape>`: a draggable rectangle. The atlas tracks which face
 *    each shape belongs to and writes the shape's `style.transform` per frame
 *    as `matrix(faceComposite · translate(x, y))`.
 *  - `<folk-atlas-region>`: a polygonal marker drawn relative to the atlas.
 *    **Visual only** for now — the atlas structure is not derived from regions.
 *
 * **Mutating the atlas.** Shift+click anywhere inside the canvas to call
 * `splitFaceAtInterior` at that point. This is a temporary debug interaction
 * to exercise the primitive; eventually mutation will be driven by region
 * geometry / explicit operations.
 *
 * **Coordinate model.** All public projection helpers (`screenToFaceLocal`,
 * `placeShape`) traffic in `FaceLocalPoint`s — never in a "root-local" or
 * "world" coordinate. The choice of `atlas.root` is a rendering convention,
 * and root may change at any time (notably during a split) without disturbing
 * any face-local coordinate stored anywhere in the system.
 */
export class FolkAtlas extends ReactiveElement {
  static override tagName = 'folk-atlas';

  static override styles = css`
    :host {
      display: block;
      position: relative;
      overflow: hidden;
      touch-action: none;
      overscroll-behavior: none;
      background: #f8f9fa;
    }

    .content {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      transform-origin: 0 0;
      z-index: 1;
    }

    /* Debug SVG sits BELOW the slotted children so the triangulation
       doesn't visually occlude shapes. */
    .debug {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      overflow: visible;
      z-index: 0;
    }

    .debug .face {
      stroke: oklch(58.5% 0.233 277.117 / 0.5);
      stroke-width: 1;
      fill: oklch(58.5% 0.233 277.117 / 0.04);
      vector-effect: non-scaling-stroke;
    }

    .debug .face.root {
      fill: oklch(58.5% 0.233 277.117 / 0.12);
    }

    .debug .vertex {
      fill: oklch(58.5% 0.233 277.117);
    }

    .debug .label {
      font: 11px/1 ui-monospace, monospace;
      fill: oklch(35% 0.1 277);
      pointer-events: none;
      paint-order: stroke;
      stroke: rgba(248, 249, 250, 0.9);
      stroke-width: 3;
      text-anchor: middle;
      dominant-baseline: middle;
    }
  `;

  /** "Far enough" finite distance (in pixels) at which to stub out ideal vertices for SVG drawing. */
  static IDEAL_RADIUS = 100_000;

  // === Atlas state ===
  #atlas = createInitialAtlas();
  /** Map from shape element to its assigned face. */
  #shapeFaces = new Map<FolkAtlasShape, Face>();

  // === Pan / zoom (mirrors folk-space's interaction model) ===
  #x = 0;
  #y = 0;
  #scale = 1;
  #isPanning = false;
  #centeredOnce = false;
  /** Cached composites from the most recent render — used by point-locate helpers. */
  #lastComposites: Map<Face, M.Matrix2D> = new Map();

  // === DOM ===
  #content!: HTMLDivElement;
  #debug!: SVGSVGElement;
  #mutationObserver = new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (n instanceof Element) this.#onChildAdded(n);
      });
      r.removedNodes.forEach((n) => {
        if (n instanceof Element) this.#onChildRemoved(n);
      });
    }
    this.#scheduleUpdate();
  });
  #resizeObserver = new ResizeObserver(() => this.#scheduleUpdate());

  /** Read-only access to the underlying atlas (for debug / experimentation). */
  get atlas(): Atlas {
    return this.#atlas;
  }

  override connectedCallback() {
    super.connectedCallback();
    const root = this.shadowRoot!;

    this.#debug = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.#debug.classList.add('debug');
    root.append(this.#debug);

    this.#content = document.createElement('div');
    this.#content.className = 'content';
    const slot = document.createElement('slot');
    this.#content.append(slot);
    root.append(this.#content);

    this.#lastComposites = this.#atlas.computeComposites();
    for (const child of this.children) {
      if (child instanceof FolkAtlasShape) this.#registerShape(child);
    }

    this.#mutationObserver.observe(this, { childList: true });
    this.#resizeObserver.observe(this);

    this.addEventListener('wheel', this.#onWheel, { passive: false });
    this.addEventListener('mouseup', this.#onMouseUp);
    this.addEventListener('pointerdown', this.#onPointerDown);
    window.addEventListener('blur', this.#onBlur);

    this.#scheduleUpdate();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('wheel', this.#onWheel);
    this.removeEventListener('mouseup', this.#onMouseUp);
    this.removeEventListener('pointerdown', this.#onPointerDown);
    window.removeEventListener('blur', this.#onBlur);
    this.#mutationObserver.disconnect();
    this.#resizeObserver.disconnect();
  }

  // ---- Child wiring ----

  #onChildAdded(el: Element) {
    if (el instanceof FolkAtlasShape) this.#registerShape(el);
  }

  #onChildRemoved(el: Element) {
    if (el instanceof FolkAtlasShape) this.#unregisterShape(el);
  }

  /**
   * Called by a child region when its polygon changes. Currently a no-op
   * structurally — regions are visual decorations only.
   */
  notifyRegionChanged(_region: FolkAtlasRegion) {
    this.#scheduleUpdate();
  }

  // ---- Shape tracking ----

  #registerShape(shape: FolkAtlasShape) {
    // Authored (x, y) is treated as a seed in the root face's frame. (This
    // is the one place we say "use the root frame" — purely an authoring
    // convenience for the demo. Once shapes carry persistent face anchors
    // this seed will go away.)
    this.#placeInRootFrame(shape, { x: shape.x, y: shape.y });
  }

  #unregisterShape(shape: FolkAtlasShape) {
    const face = this.#shapeFaces.get(shape);
    if (face) face.shapes.delete(shape);
    this.#shapeFaces.delete(shape);
  }

  #placeInRootFrame(shape: FolkAtlasShape, rootPoint: Point) {
    let foundFace: Face | null = null;
    let faceLocal: Point = rootPoint;
    for (const [face, mf] of this.#lastComposites) {
      const local = M.applyToPoint(M.invert(mf), rootPoint);
      if (face.contains(local)) {
        foundFace = face;
        faceLocal = local;
        break;
      }
    }
    const newFace = foundFace ?? this.#atlas.root;
    this.#assignShape(shape, newFace, faceLocal);
  }

  #assignShape(shape: FolkAtlasShape, face: Face, faceLocal: Point) {
    const oldFace = this.#shapeFaces.get(shape);
    if (oldFace !== face) {
      oldFace?.shapes.delete(shape);
      face.shapes.add(shape);
      this.#shapeFaces.set(shape, face);
    }
    shape.x = faceLocal.x;
    shape.y = faceLocal.y;
  }

  /**
   * Re-locate every shape whose face is no longer in the atlas (e.g. because
   * it was split). For the prototype we use each shape's last-known root-local
   * position, computed via the OLD composites, before re-placing through the
   * new atlas.
   */
  #relocateOrphanedShapes(oldComposites: Map<Face, M.Matrix2D>) {
    const presentFaces = new Set(this.#atlas.faces);
    for (const [shape, face] of [...this.#shapeFaces]) {
      if (presentFaces.has(face)) continue;
      const oldComposite = oldComposites.get(face);
      const rootPoint = oldComposite
        ? M.applyToPoint(oldComposite, { x: shape.x, y: shape.y })
        : { x: shape.x, y: shape.y };
      this.#shapeFaces.delete(shape);
      this.#placeInRootFrame(shape, rootPoint);
    }
  }

  // ---- Public face-relative projection API ----

  /**
   * Return which face a shape currently lives in, or `null` if untracked.
   */
  shapeFace(shape: FolkAtlasShape): Face | null {
    return this.#shapeFaces.get(shape) ?? null;
  }

  /**
   * Convert client-space (CSS pixel) coordinates into a face-local point on
   * whichever face contains the pointer. Returns `null` if no face contains
   * the point (shouldn't happen for a well-formed atlas covering the plane).
   *
   * This is the canonical screen→atlas projection. There is intentionally no
   * `screenToRoot` companion — root-local is not a stable frame to traffic
   * coordinates in.
   */
  screenToFaceLocal(clientX: number, clientY: number): FaceLocalPoint | null {
    if (this.#lastComposites.size === 0) {
      this.#lastComposites = this.#atlas.computeComposites();
    }
    const rect = this.getBoundingClientRect();
    const rx = (clientX - rect.left - this.#x) / this.#scale;
    const ry = (clientY - rect.top - this.#y) / this.#scale;
    for (const [face, mf] of this.#lastComposites) {
      const local = M.applyToPoint(M.invert(mf), { x: rx, y: ry });
      if (face.contains(local)) return { face, x: local.x, y: local.y };
    }
    return null;
  }

  /**
   * Re-express a face-local point in another face's local frame by composing
   * edge transforms along the walk `p.face → target`.
   *
   * For identity-everywhere atlases this is just a coordinate aliasing — the
   * result has the same numeric `(x, y)` as the input. Once non-identity
   * transforms exist this performs the actual change of frames.
   */
  reexpressPoint(p: FaceLocalPoint, target: Face): Point {
    if (p.face === target) return { x: p.x, y: p.y };
    const composites = this.#lastComposites.size
      ? this.#lastComposites
      : this.#atlas.computeComposites();
    const mFrom = composites.get(p.face);
    const mTo = composites.get(target);
    if (!mFrom || !mTo) {
      throw new Error('reexpressPoint: face not reachable from current root');
    }
    const fromToTo = M.multiply(M.invert(mTo), mFrom);
    return M.applyToPoint(fromToTo, { x: p.x, y: p.y });
  }

  /**
   * Re-express a face-local displacement (delta/vector) in another face's
   * frame. Uses only the linear part of the inter-face transform — for our
   * translation-only edge transforms this is the identity.
   */
  reexpressVector(
    v: Point,
    fromFace: Face,
    targetFace: Face,
  ): Point {
    if (fromFace === targetFace) return { x: v.x, y: v.y };
    const composites = this.#lastComposites.size
      ? this.#lastComposites
      : this.#atlas.computeComposites();
    const mFrom = composites.get(fromFace);
    const mTo = composites.get(targetFace);
    if (!mFrom || !mTo) {
      throw new Error('reexpressVector: face not reachable from current root');
    }
    const fromToTo = M.multiply(M.invert(mTo), mFrom);
    // Strip translation: apply only the 2x2 linear part to the vector.
    return {
      x: fromToTo.a * v.x + fromToTo.c * v.y,
      y: fromToTo.b * v.x + fromToTo.d * v.y,
    };
  }

  /**
   * Place a shape's anchor at the given face-local point.
   *
   * Ownership is transferred to `p.face`; the shape's `(x, y)` becomes
   * `(p.x, p.y)` in that face's frame. Triggers a re-render.
   */
  placeShape(shape: FolkAtlasShape, p: FaceLocalPoint) {
    if (!this.#shapeFaces.has(shape)) return;
    if (!this.#atlas.faces.includes(p.face)) {
      throw new Error('placeShape: target face is not in this atlas');
    }
    this.#assignShape(shape, p.face, { x: p.x, y: p.y });
    this.#scheduleUpdate();
  }

  // ---- Atlas mutation: shift+click to split a face at the click point ----

  #onPointerDown = (event: PointerEvent) => {
    if (!event.shiftKey) return;
    if (event.button !== 0) return;
    if (event.target !== this && !(event.target instanceof HTMLDivElement)) return;
    event.preventDefault();
    event.stopPropagation();

    const ptr = this.screenToFaceLocal(event.clientX, event.clientY);
    if (!ptr) return;
    this.#splitAt(ptr);
  };

  #splitAt(p: FaceLocalPoint) {
    const oldComposites = this.#atlas.computeComposites();
    try {
      splitFaceAtInterior(this.#atlas, p.face, { x: p.x, y: p.y });
    } catch (e) {
      console.warn('[folk-atlas] splitFaceAtInterior failed:', e);
      return;
    }

    try {
      validateAtlas(this.#atlas);
    } catch (e) {
      console.error('[folk-atlas] atlas invariants violated after split:', e);
    }

    this.#relocateOrphanedShapes(oldComposites);
    this.#lastComposites = this.#atlas.computeComposites();
    this.#scheduleUpdate();
  }

  // ---- Pan / zoom ----

  #onWheel = (event: WheelEvent) => {
    event.stopPropagation();
    if (this.#isPanning || this.#shouldStartPanning(event)) {
      this.#isPanning = true;
      event.preventDefault();
      this.#handleWheelEvent(event);
    }
  };

  #handleWheelEvent(event: WheelEvent) {
    const rect = this.getBoundingClientRect();
    const { clientX, clientY } = event;
    let { deltaX, deltaY } = event;
    if (event.deltaMode === 1) {
      deltaX *= 15;
      deltaY *= 15;
    }
    if (event.ctrlKey) {
      this.#applyChange(0, 0, 1 - deltaY / 100, clientX - rect.left, clientY - rect.top);
    } else {
      this.#applyChange(-deltaX, -deltaY, 1, clientX - rect.left, clientY - rect.top);
    }
  }

  #onMouseUp = () => {
    this.#isPanning = false;
  };

  #onBlur = () => {
    this.#isPanning = false;
  };

  #shouldStartPanning(e: WheelEvent): boolean {
    let el = e.target as Element | null;
    while (el) {
      if (el === this) {
        const rect = this.getBoundingClientRect();
        return (
          rect.left < e.clientX && e.clientX < rect.right && rect.top < e.clientY && e.clientY < rect.bottom
        );
      }
      if (el.scrollHeight > el.clientHeight) return false;
      el = el.parentElement;
    }
    return false;
  }

  #applyChange(panX: number, panY: number, scaleDiff: number, originX: number, originY: number) {
    const newScale = this.#scale * scaleDiff;
    if (newScale < MIN_SCALE || newScale > MAX_SCALE) return;
    this.#x = originX - (originX - this.#x) * scaleDiff + panX;
    this.#y = originY - (originY - this.#y) * scaleDiff + panY;
    this.#scale = newScale;
    this.#scheduleUpdate();
  }

  // ---- Render loop ----

  #updateScheduled = false;
  #scheduleUpdate() {
    if (this.#updateScheduled) return;
    this.#updateScheduled = true;
    requestAnimationFrame(() => {
      this.#updateScheduled = false;
      this.#render();
    });
  }

  #render() {
    if (!this.#centeredOnce) {
      const rect = this.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        this.#x = rect.width / 2;
        this.#y = rect.height / 2;
        this.#centeredOnce = true;
      }
    }

    const view = M.scaleSelf(M.fromTranslate(this.#x, this.#y), this.#scale);
    this.#content.style.transform = M.toCSSString(view);

    const composites = this.#atlas.computeComposites();
    this.#lastComposites = composites;
    this.#renderShapes(composites);
    this.#renderDebug(composites, view);
  }

  #renderShapes(composites: Map<Face, M.Matrix2D>) {
    for (const [shape, face] of this.#shapeFaces) {
      const composite = composites.get(face);
      if (!composite) continue;
      const m = M.translate(composite, shape.x, shape.y);
      shape.style.transform = M.toCSSString(m);
    }
  }

  // ---- Debug visualisation ----

  #renderDebug(composites: Map<Face, M.Matrix2D>, view: M.Matrix2DReadonly) {
    const svg = this.#debug;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const ns = 'http://www.w3.org/2000/svg';

    let faceIndex = 0;
    for (const face of this.#atlas.faces) {
      const mf = composites.get(face);
      if (!mf) continue;
      const screen = M.multiply(view, mf);

      const junctions = face.junctions();
      const pts: string[] = [];
      for (const j of junctions) {
        const local =
          j.kind === 'finite'
            ? { x: j.x, y: j.y }
            : { x: j.x * FolkAtlas.IDEAL_RADIUS, y: j.y * FolkAtlas.IDEAL_RADIUS };
        const sp = M.applyToPoint(screen, local);
        pts.push(`${sp.x},${sp.y}`);
      }
      const poly = document.createElementNS(ns, 'polygon');
      poly.setAttribute('points', pts.join(' '));
      poly.classList.add('face');
      if (face === this.#atlas.root) poly.classList.add('root');
      svg.append(poly);

      // Label each face near its anchor (face-local (0, 0)), offset along
      // the centroid of the non-anchor junctions.
      let dx = 0;
      let dy = 0;
      for (let i = 1; i < 3; i++) {
        const j = junctions[i];
        // Both finite and ideal contribute their (x, y) as a direction-ish vector.
        dx += j.x;
        dy += j.y;
      }
      const len = Math.hypot(dx, dy) || 1;
      const labelOffset = 30;
      const labelLocal = { x: (dx / len) * labelOffset, y: (dy / len) * labelOffset };
      const lp = M.applyToPoint(screen, labelLocal);
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', String(lp.x));
      text.setAttribute('y', String(lp.y));
      text.classList.add('label');
      text.textContent = `F${faceIndex} (${face.shapes.size})`;
      svg.append(text);
      faceIndex++;
    }

    // Render finite junctions on top of faces, deduplicated via aroundJunction.
    const visited = new Set<HalfEdge>();
    for (const he of this.#atlas.halfEdges) {
      if (visited.has(he)) continue;
      if (he.originKind !== 'finite') {
        visited.add(he);
        continue;
      }
      const fan = [...aroundJunction(he)];
      for (const f of fan) visited.add(f);
      // Pick the first half-edge whose face has a known composite.
      const rep = fan.find((h) => composites.has(h.face)) ?? fan[0];
      const composite = composites.get(rep.face);
      if (!composite) continue;
      const screen = M.multiply(view, composite);
      const sp = M.applyToPoint(screen, { x: rep.ox, y: rep.oy });
      const dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('cx', String(sp.x));
      dot.setAttribute('cy', String(sp.y));
      dot.setAttribute('r', '4');
      dot.classList.add('vertex');
      svg.append(dot);
    }
  }
}
