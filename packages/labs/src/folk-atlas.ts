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

    /* Debug canvas sits BELOW the slotted children so the triangulation
       doesn't visually occlude shapes. */
    .debug {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 0;
    }
  `;

  /**
   * "Far enough" finite distance (in face-local units) at which to stub out
   * ideal vertices when projecting a face polygon for clipping. Only used to
   * produce a polygon big enough to robustly clip to the viewport rectangle —
   * the clipped polygon is what's actually drawn.
   */
  static IDEAL_RADIUS = 1e6;

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
  #debug!: HTMLCanvasElement;
  #debugCtx!: CanvasRenderingContext2D;
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

    this.#debug = document.createElement('canvas');
    this.#debug.className = 'debug';
    this.#debugCtx = this.#debug.getContext('2d')!;
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
    // Use fresh composites — `#lastComposites` may be stale (e.g. mid-split,
    // before `#splitAt` writes the new ones back).
    const composites = this.#atlas.computeComposites();
    let foundFace: Face | null = null;
    let faceLocal: Point = rootPoint;
    for (const [face, mf] of composites) {
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
   * it was just split). Each orphan shape's *physical* position must be
   * preserved, but the SIA model has no global frame to round-trip through —
   * the old root may itself have been the destroyed face, and even when it
   * wasn't, "old root frame" and "new root frame" can differ (the new sub-
   * faces of a split are anchored at the inserted point, so the new root's
   * origin is generally not the old root's origin).
   *
   * Algorithm: pick a *surviving* face as a stable physical anchor (any face
   * present both before and after the mutation works — the split primitives
   * touch only one face, so neighbours are always fine). Express each orphan
   * shape's position in the anchor's frame using the *old* composites, then
   * re-express it in each new face's frame using the *new* composites and
   * keep the first one whose `contains` check passes.
   */
  #relocateOrphanedShapes(oldComposites: Map<Face, M.Matrix2D>) {
    const presentFaces = new Set(this.#atlas.faces);
    const orphans: Array<[FolkAtlasShape, Face]> = [];
    for (const [shape, face] of this.#shapeFaces) {
      if (!presentFaces.has(face)) orphans.push([shape, face]);
    }
    if (orphans.length === 0) return;

    const newComposites = this.#atlas.computeComposites();
    const anchor = this.#atlas.faces.find((f) => oldComposites.has(f));
    if (!anchor) {
      // Whole atlas was replaced. Nothing physical to anchor on; drop orphans.
      for (const [shape] of orphans) this.#shapeFaces.delete(shape);
      return;
    }
    const anchorOldRoot = oldComposites.get(anchor)!; // anchor → old root
    const anchorNewRoot = newComposites.get(anchor)!; // anchor → new root

    for (const [shape, oldFace] of orphans) {
      const oldFaceRoot = oldComposites.get(oldFace);
      this.#shapeFaces.delete(shape);
      oldFace.shapes.delete(shape);
      if (!oldFaceRoot) continue; // mystery orphan

      // pAnchor = (anchor ← oldRoot ← oldFace) · shape
      const M_oldFace_to_anchor = M.multiply(M.invert(anchorOldRoot), oldFaceRoot);
      const pAnchor = M.applyToPoint(M_oldFace_to_anchor, { x: shape.x, y: shape.y });

      let placed = false;
      for (const newFace of this.#atlas.faces) {
        const newFaceRoot = newComposites.get(newFace);
        if (!newFaceRoot) continue;
        // pNewFace = inv(newFace → newRoot) · (anchor → newRoot) · pAnchor
        const M_anchor_to_newFace = M.multiply(M.invert(newFaceRoot), anchorNewRoot);
        const pNewFace = M.applyToPoint(M_anchor_to_newFace, pAnchor);
        if (newFace.contains(pNewFace)) {
          this.#assignShape(shape, newFace, pNewFace);
          placed = true;
          break;
        }
      }
      if (!placed) {
        // Numerical edge case (e.g. point landed exactly on a boundary and
        // every contains check returned strictly false). Fall back to the
        // new root — better than dropping the shape.
        this.#assignShape(shape, this.#atlas.root, { x: 0, y: 0 });
      }
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
    this.#maybeSwitchRootToViewportCentre();
    this.#scheduleUpdate();
  }

  /**
   * Move `atlas.root` to whichever face currently sits under the viewport
   * centre, compensating the view transform so on-screen positions don't
   * jump. This keeps the actively-mutated frame near the user's focus, which
   * is the natural anchor for upcoming face-relative gizmo edits.
   *
   * Assumption: every edge transform is a translation (or identity). With
   * that constraint, the view stays of the form `translate(x, y) · scale(s)`
   * after `view *= C` and we can decompose by inspection. When non-translation
   * edge transforms appear, the view should be promoted to a full Matrix2D.
   */
  #maybeSwitchRootToViewportCentre() {
    if (this.#lastComposites.size === 0) return;
    const rect = this.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const rootPoint = { x: (cx - this.#x) / this.#scale, y: (cy - this.#y) / this.#scale };
    let target: Face | null = null;
    for (const [face, mf] of this.#lastComposites) {
      const local = M.applyToPoint(M.invert(mf), rootPoint);
      if (face.contains(local)) {
        target = face;
        break;
      }
    }
    if (!target || target === this.#atlas.root) return;
    const C = this.#atlas.switchRoot(target);
    this.#x += this.#scale * C.e;
    this.#y += this.#scale * C.f;
    this.#lastComposites = this.#atlas.computeComposites();
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

  // ---- Debug visualisation (Canvas 2D) ----

  /**
   * Draw the atlas as a debug underlay:
   *  - Each face is filled as the visible portion of its triangle, clipped to
   *    the viewport rect. Ideal vertices are stubbed at `IDEAL_RADIUS` for the
   *    purposes of producing a polygon to clip; the clipped result is what's
   *    actually drawn, so they appear as polygons whose "infinite" sides are
   *    the viewport edges.
   *  - The root face is drawn with a slightly stronger fill.
   *  - Each non-at-infinity half-edge is stroked individually. At-infinity
   *    half-edges (both endpoints ideal) are *never* stroked: there is no
   *    geometry between two points at infinity to draw.
   *  - Labels are placed at the centroid of the *clipped* face polygon so
   *    they always sit inside the visible portion of their face and never
   *    overlap a neighbour's label.
   *  - Finite junctions (deduplicated via `aroundJunction`) are dotted last.
   */
  #renderDebug(composites: Map<Face, M.Matrix2D>, view: M.Matrix2DReadonly) {
    const ctx = this.#debugCtx;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;
    const pxW = Math.max(1, Math.round(cssW * dpr));
    const pxH = Math.max(1, Math.round(cssH * dpr));
    if (this.#debug.width !== pxW || this.#debug.height !== pxH) {
      this.#debug.width = pxW;
      this.#debug.height = pxH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // Generous margin so polygons crossing the edge still produce non-empty
    // clipped pieces along the viewport boundary.
    const margin = 32;
    const clipRect: ClipRect = {
      minX: -margin,
      minY: -margin,
      maxX: cssW + margin,
      maxY: cssH + margin,
    };

    // Per-face screen-space polygons (with ideal stand-ins) and their clipped
    // counterparts.
    type Entry = {
      face: Face;
      screen: M.Matrix2DReadonly;
      polygon: Point[];
      clipped: Point[];
      index: number;
    };
    const entries: Entry[] = [];
    for (let i = 0; i < this.#atlas.faces.length; i++) {
      const face = this.#atlas.faces[i];
      const mf = composites.get(face);
      if (!mf) continue;
      const screen = M.multiply(view, mf);
      const polygon: Point[] = [];
      for (const j of face.junctions()) {
        const local =
          j.kind === 'finite'
            ? { x: j.x, y: j.y }
            : { x: j.x * FolkAtlas.IDEAL_RADIUS, y: j.y * FolkAtlas.IDEAL_RADIUS };
        polygon.push(M.applyToPoint(screen, local));
      }
      entries.push({
        face,
        screen,
        polygon,
        clipped: clipPolygonToRect(polygon, clipRect),
        index: i,
      });
    }

    const FACE_FILL = 'oklch(58.5% 0.233 277.117 / 0.04)';
    const ROOT_FILL = 'oklch(58.5% 0.233 277.117 / 0.12)';
    const EDGE_STROKE = 'oklch(58.5% 0.233 277.117 / 0.5)';
    const VERTEX_FILL = 'oklch(58.5% 0.233 277.117)';
    const LABEL_FILL = 'oklch(35% 0.1 277)';
    const LABEL_HALO = 'rgba(248, 249, 250, 0.9)';

    // Pass 1: face fills.
    for (const e of entries) {
      if (e.clipped.length < 3) continue;
      ctx.beginPath();
      ctx.moveTo(e.clipped[0].x, e.clipped[0].y);
      for (let k = 1; k < e.clipped.length; k++) ctx.lineTo(e.clipped[k].x, e.clipped[k].y);
      ctx.closePath();
      ctx.fillStyle = e.face === this.#atlas.root ? ROOT_FILL : FACE_FILL;
      ctx.fill();
    }

    // Pass 2: edge strokes — only for half-edges with at least one finite
    // endpoint. Stroke on the unclipped polygon edge, then visually clip via
    // canvas clipping so segments going to infinity fade at the viewport.
    ctx.save();
    ctx.beginPath();
    ctx.rect(clipRect.minX, clipRect.minY, clipRect.maxX - clipRect.minX, clipRect.maxY - clipRect.minY);
    ctx.clip();
    ctx.lineWidth = 1;
    ctx.strokeStyle = EDGE_STROKE;
    for (const e of entries) {
      const hes = [...e.face.halfEdgesCCW()];
      for (let k = 0; k < hes.length; k++) {
        const a = hes[k];
        const b = hes[(k + 1) % hes.length];
        if (a.originKind === 'ideal' && b.originKind === 'ideal') continue;
        const sa = e.polygon[k];
        const sb = e.polygon[(k + 1) % e.polygon.length];
        ctx.beginPath();
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(sb.x, sb.y);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Pass 3: labels at clipped-polygon centroid (always inside the visible
    // portion of the face).
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    for (const e of entries) {
      if (e.clipped.length < 3) continue;
      const c = polygonCentroid(e.clipped);
      if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
      const label = `F${e.index} (${e.face.shapes.size})`;
      ctx.strokeStyle = LABEL_HALO;
      ctx.strokeText(label, c.x, c.y);
      ctx.fillStyle = LABEL_FILL;
      ctx.fillText(label, c.x, c.y);
    }

    // Pass 4: finite junctions, deduplicated via aroundJunction.
    ctx.fillStyle = VERTEX_FILL;
    const visited = new Set<HalfEdge>();
    for (const he of this.#atlas.halfEdges) {
      if (visited.has(he)) continue;
      if (he.originKind !== 'finite') {
        visited.add(he);
        continue;
      }
      const fan = [...aroundJunction(he)];
      for (const f of fan) visited.add(f);
      const rep = fan.find((h) => composites.has(h.face)) ?? fan[0];
      const composite = composites.get(rep.face);
      if (!composite) continue;
      const sp = M.applyToPoint(M.multiply(view, composite), { x: rep.ox, y: rep.oy });
      if (sp.x < clipRect.minX || sp.x > clipRect.maxX) continue;
      if (sp.y < clipRect.minY || sp.y > clipRect.maxY) continue;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ----------------------------------------------------------------------------
// Polygon helpers (Sutherland–Hodgman + area-weighted centroid)
// ----------------------------------------------------------------------------

interface ClipRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Clip a (convex or non-convex) polygon to an axis-aligned rectangle using
 * Sutherland–Hodgman. The output is the intersection polygon's vertices in
 * the same winding order as the input. May be empty if the polygon is fully
 * outside the rect.
 */
function clipPolygonToRect(poly: Point[], rect: ClipRect): Point[] {
  if (poly.length < 3) return [];
  let out: Point[] = poly;
  out = clipAgainstHalfPlane(out, (p) => p.x - rect.minX, (a, b) => intersectX(a, b, rect.minX));
  out = clipAgainstHalfPlane(out, (p) => rect.maxX - p.x, (a, b) => intersectX(a, b, rect.maxX));
  out = clipAgainstHalfPlane(out, (p) => p.y - rect.minY, (a, b) => intersectY(a, b, rect.minY));
  out = clipAgainstHalfPlane(out, (p) => rect.maxY - p.y, (a, b) => intersectY(a, b, rect.maxY));
  return out;
}

function clipAgainstHalfPlane(
  poly: Point[],
  signedDistance: (p: Point) => number,
  intersect: (a: Point, b: Point) => Point,
): Point[] {
  if (poly.length === 0) return poly;
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const aIn = signedDistance(a) >= 0;
    const bIn = signedDistance(b) >= 0;
    if (aIn && bIn) out.push(b);
    else if (aIn && !bIn) out.push(intersect(a, b));
    else if (!aIn && bIn) {
      out.push(intersect(a, b));
      out.push(b);
    }
  }
  return out;
}

function intersectX(a: Point, b: Point, x: number): Point {
  const t = (x - a.x) / (b.x - a.x);
  return { x, y: a.y + t * (b.y - a.y) };
}

function intersectY(a: Point, b: Point, y: number): Point {
  const t = (y - a.y) / (b.y - a.y);
  return { x: a.x + t * (b.x - a.x), y };
}

/**
 * Area-weighted centroid of a simple polygon. Falls back to the vertex average
 * if the polygon is degenerate (area ≈ 0).
 */
function polygonCentroid(poly: Point[]): Point {
  let cx = 0;
  let cy = 0;
  let a2 = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
    a2 += cross;
  }
  if (Math.abs(a2) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / poly.length, y: sy / poly.length };
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}
