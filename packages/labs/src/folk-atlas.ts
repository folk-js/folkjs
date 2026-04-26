import { ReactiveElement, css, type PropertyValues } from '@folkjs/dom/ReactiveElement';
import * as M from '@folkjs/geometry/Matrix2D';
import type { Point } from '@folkjs/geometry/Vector2';
import {
  aroundJunction,
  Atlas,
  createInitialAtlas,
  Face,
  HalfEdge,
  insertStrip,
  linkEdgeToTwin,
  rescaleFaceFrame,
  resizeStrip,
  splitAtlasAlongLine,
  translationToWrap,
  unlinkEdgeFromTwin,
  untwinEdges,
  wrapEdges,
  type AtlasImage,
  type SplitAtlasAlongLineResult,
  type InsertStripResult,
} from './atlas.ts';
import { FolkAtlasRegion } from './folk-atlas-region.ts';
import { FolkAtlasShape } from './folk-atlas-shape.ts';
import { ShapeGhostRenderer } from './folk-atlas-ghosts.ts';
import { SCENES, listSceneNames, type SceneBuilder } from './folk-atlas-scenes.ts';

export {
  aroundJunction,
  Atlas,
  createInitialAtlas,
  Face,
  HalfEdge,
  linkEdgeToTwin,
  rebaseTwinTransform,
  rebaseTwinTransformByTranslation,
  rescaleFaceFrame,
  splitFaceAtInterior,
  splitFaceAlongEdge,
  translationToWrap,
  unlinkEdgeFromTwin,
  untwinEdges,
  validateAtlas,
  wrapEdges,
} from './atlas.ts';

/** Which pair of opposite edges of a region are wrapped. */
export type RegionWrapAxis = 'horizontal' | 'vertical';

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;

declare global {
  interface HTMLElementTagNameMap {
    'folk-atlas': FolkAtlas;
  }
}

/**
 * Available interaction tools. Switched via the `tool` attribute on
 * `<folk-atlas>` (set by the toolbar in the demo HTML).
 *
 *  - `select`     — default. Background pointer events do nothing; shapes
 *                   handle their own drag; pan/zoom is wheel-driven.
 *  - `shape`      — click+drag draws a preview rectangle; on release a new
 *                   `<folk-atlas-shape>` is created at that position.
 *  - `line-cut`   — click+drag draws an infinite line (drawn segment solid,
 *                   infinite extensions dashed). On release a persistent
 *                   gizmo is committed at the drag's midpoint with a
 *                   perpendicular handle. Dragging the handle picks Δ
 *                   (the would-be strip width). No atlas mutation yet —
 *                   the cut/strip primitive lands in a follow-up.
 */
export type AtlasTool = 'select' | 'shape' | 'line-cut' | 'region';

interface ShapeDragState {
  kind: 'shape';
  pointerId: number;
  startClientX: number;
  startClientY: number;
  el: HTMLDivElement;
}

interface RegionDragState {
  kind: 'region';
  pointerId: number;
  startClientX: number;
  startClientY: number;
  el: HTMLDivElement;
}

interface LineDrawDragState {
  kind: 'line-draw';
  pointerId: number;
  startClientX: number;
  startClientY: number;
  svg: SVGSVGElement;
  lineFinite: SVGLineElement;
  lineBefore: SVGLineElement;
  lineAfter: SVGLineElement;
}

interface HandleExpandDragState {
  kind: 'handle-expand';
  pointerId: number;
  startClientX: number;
  startClientY: number;
  /** The Δ already accumulated on the gizmo when the drag started. */
  startDelta: number;
  gizmo: LineCutGizmo;
}

type ToolDragState = ShapeDragState | RegionDragState | LineDrawDragState | HandleExpandDragState;

/**
 * Atlas-owned back-layer SVG state for one region. Holds the canonical
 * outline polygon plus a pool of polygons for the region face's
 * additional BFS images (wrap-tile copies). Pooled rather than recreated
 * each frame to keep the per-frame work to attribute writes only.
 */
interface RegionBackEntry {
  svg: SVGSVGElement;
  primary: SVGPolygonElement;
  ghosts: SVGPolygonElement[];
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Persistent line-cut gizmo created when the user releases a line-draw drag.
 *
 * Geometry is stored in `hostFace`'s local frame (the face containing the
 * seam point at creation time) so the gizmo stays anchored to the atlas
 * across pan/zoom and `switchRoot`. Each render projects the geometry to
 * screen via the host face's composite.
 *
 * The gizmo is a *visual contract* in B1 — the perpendicular handle shows
 * what Δ would be applied; nothing in the atlas is mutated until the
 * cut/strip primitive lands (B2+).
 */
interface LineCutGizmo {
  hostFace: Face;
  /** The seam point — midpoint of the original drag — in `hostFace`'s frame. */
  anchor: Point;
  /** Unit vector along the cut line, in `hostFace`'s frame. */
  direction: Point;
  /** Drag start point (one end of the "drawn" segment), in `hostFace`'s frame. */
  drawStart: Point;
  /** Drag end point (other end of the "drawn" segment), in `hostFace`'s frame. */
  drawEnd: Point;
  /**
   * Signed perpendicular displacement in atlas units (host frame).
   *
   * Sign picks the side: the strip pushes the +n side away by |delta|, where
   * `n = (-dy, dx)` is the 90° CCW perpendicular of `direction`. The
   * unmoved side is anchored: shapes there keep their host-frame coords.
   */
  delta: number;

  /**
   * Set once the line-cut mutation is committed to the atlas:
   * `splitAtlasAlongLine` subdivides every face the line crosses into a
   * left/right pair, and `insertStrip` opens the seam to the current
   * |delta|. The gizmo holds onto the resulting per-step pairs and
   * strip metadata so subsequent handle drags resize the strip in place
   * (via `resizeStrip`) rather than re-cutting.
   *
   * `null` until the first commit; once set, `hostFace` has been
   * re-anchored to `strip.stripFace`.
   */
  committed: {
    split: SplitAtlasAlongLineResult;
    strip: InsertStripResult;
    /** Sign of `delta` at commit time — picks which side the strip pushes. */
    sign: 1 | -1;
    /** Current strip thickness; tracked here because `resizeStrip` requires the prior height. */
    height: number;
  } | null;

  // DOM
  svg: SVGSVGElement;
  lineFinite: SVGLineElement;
  lineBefore: SVGLineElement;
  lineAfter: SVGLineElement;
  perp: SVGLineElement;
  handle: HTMLDivElement;
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
 * **Mutating the atlas.** Switch tools via the `tool` attribute (set by the
 * toolbar UI in the demo HTML). The `shape` tool drag-creates a new
 * `<folk-atlas-shape>`; the `line-cut` tool drops a persistent line gizmo
 * with a perpendicular handle for picking strip width Δ (cut/strip
 * insertion lands in a follow-up). The `select` tool is the default and
 * leaves background pointers alone.
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
      z-index: 2;
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

    /* Region back-layer — green fill + dashed outlines for every region
       face. Painted *behind* shapes so a region reads as the floor of
       the space rather than a sticker on top of it. The matching front
       layer (.regions) carries only the controls. */
    .regions-back {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 1;
    }
    .regions-back svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .regions-back polygon {
      fill: oklch(70% 0.18 145 / 0.06);
      stroke: oklch(48% 0.18 145 / 0.85);
      stroke-width: 1.5;
      stroke-dasharray: 6 4;
      vector-effect: non-scaling-stroke;
    }
    /* Ghost outline (extra BFS images of the same region face). The only
       differentiator vs. the canonical tile is a slightly fainter fill —
       stroke colour and dash size are intentionally identical so wrap
       tiles read as a single continuous surface. */
    .regions-back polygon.ghost {
      fill: oklch(70% 0.18 145 / 0.03);
    }

    /* Tool-driven preview overlay (drag rectangles, line previews, etc.).
       Sits above shapes so it's always visible during a drag; transparent
       to pointer events so shapes underneath stay grabbable when no tool
       is active. */
    .overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 4;
    }

    /* Region front-layer — hosts the wrap-toggle controls only. Above
       shapes so handles are clickable and never get occluded; the
       container is transparent to pointer events so shapes underneath
       stay grabbable, and individual region elements re-enable events
       on their own buttons. */
    .regions {
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 3;
    }

    :host([tool='shape']) .content,
    :host([tool='line-cut']) .content,
    :host([tool='region']) .content {
      cursor: crosshair;
    }

    .preview-rect {
      position: absolute;
      border: 1.5px dashed oklch(45% 0.16 277);
      background: oklch(58.5% 0.233 277.117 / 0.08);
      pointer-events: none;
      box-sizing: border-box;
    }

    /* Line-cut SVG layer — used by both the in-flight line-draw preview and
       the persistent gizmo after release. The "drawn" segment between the
       drag start/end points is solid; the projected infinite extensions
       beyond each end are dashed and faded for visual feedback. */
    .cut-svg {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      overflow: visible;
    }
    .cut-svg .cut-finite {
      stroke: oklch(45% 0.16 277);
      stroke-width: 2;
      stroke-linecap: round;
    }
    .cut-svg .cut-infinite {
      stroke: oklch(45% 0.16 277);
      stroke-width: 1.25;
      stroke-dasharray: 6 4;
      opacity: 0.45;
    }
    .cut-svg .cut-perp {
      stroke: oklch(60% 0.2 30);
      stroke-width: 1.5;
      stroke-dasharray: 4 3;
    }

    /* Persistent perpendicular handle at the centre of the drawn line.
       Drag perpendicular to the line to control the strip's expansion Δ. */
    .cut-handle {
      position: absolute;
      top: 0;
      left: 0;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: oklch(70% 0.18 30);
      border: 2px solid white;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
      cursor: grab;
      pointer-events: auto;
      touch-action: none;
      will-change: transform;
      z-index: 3;
    }
    .cut-handle:hover {
      background: oklch(60% 0.22 30);
    }
    .cut-handle.dragging {
      cursor: grabbing;
      background: oklch(55% 0.25 30);
    }
  `;

  /**
   * "Far enough" finite distance (in face-local units) at which to stub out
   * ideal vertices when projecting a face polygon for clipping. Only used to
   * produce a polygon big enough to robustly clip to the viewport rectangle —
   * the clipped polygon is what's actually drawn.
   */
  static IDEAL_RADIUS = 1e6;

  static override properties = {
    tool: { type: String, reflect: true },
    debug: { type: Boolean, reflect: true },
  };

  declare tool: AtlasTool;
  /**
   * When `true`, renders the atlas's triangulation as a faint underlay
   * (face fills, edge strokes, junction dots, face labels). Defaults to
   * `true`; toggle off via the `debug` attribute or property to hide it.
   */
  declare debug: boolean;

  constructor() {
    super();
    this.tool = 'select';
    this.debug = true;
  }

  // === Atlas state ===
  #atlas = createInitialAtlas();
  /** Map from shape element to its assigned face. */
  #shapeFaces = new Map<FolkAtlasShape, Face>();
  /** Map from region element to its bound (centre) face. */
  #regionFaces = new Map<FolkAtlasRegion, Face>();

  // === Pan / zoom (mirrors folk-space's interaction model) ===
  #x = 0;
  #y = 0;
  #scale = 1;
  #isPanning = false;
  #centeredOnce = false;
  /** Cached composites from the most recent render — used by point-locate helpers. */
  #lastComposites: Map<Face, M.Matrix2D> = new Map();
  /**
   * Cached BFS images from the most recent render. Distinct from
   * `#lastComposites`: includes every wrap-tile image of the (wrapped) root
   * face, not just the canonical one.
   *
   * Used by point-locate helpers (`screenToFaceLocal`,
   * `#maybeSwitchRootToViewportCentre`) so that hit-testing and viewport
   * navigation see the wrap tiling — without it, the pointer or viewport
   * "falls into the gap" once it leaves the canonical region's local bounds,
   * even though visually a wrap tile is sitting right there.
   */
  #lastImages: AtlasImage[] = [];
  /**
   * Cached per-face visibility ∈ [0, 1] from the most recent render.
   *
   * Visibility is the product of independent falloff factors (screen distance,
   * effective scale, …). The threshold for "render this face" is currently
   * `> 0` — anything non-zero renders, nothing is culled. The plumbing exists
   * so that culling can be enabled later by raising the threshold and so that
   * downstream consumers (opacity blending, LOD, throttled event handling)
   * can read the scalar.
   *
   * See `sia.md` § "Per-face visibility (scalar)".
   */
  #lastVisibility: Map<Face, number> = new Map();

  // === DOM ===
  #content!: HTMLDivElement;
  #debug!: HTMLCanvasElement;
  #debugCtx!: CanvasRenderingContext2D;
  /** Overlay layer for tool previews (drag rectangles, line previews, …). */
  #overlay!: HTMLDivElement;
  /**
   * Layer that hosts ghost clones of shapes whose face has multiple images
   * (wrapped / looping / recursive topologies). Sits inside `#content` so it
   * inherits the same view transform as the slotted originals; sits before
   * the slot in source order so ghosts paint *behind* the editable originals.
   */
  #ghostLayer!: HTMLDivElement;
  /** Ghost rendering subsystem — see {@link ShapeGhostRenderer}. */
  #ghosts!: ShapeGhostRenderer;
  /**
   * Front layer that hosts `<folk-atlas-region>` elements (controls only).
   * Sits in *screen coordinates* — not transformed by `#content`'s view —
   * so handles stay crisp at any zoom level. The atlas writes the
   * controls position per render.
   */
  #regionLayer!: HTMLDivElement;
  /**
   * Back layer for region outlines. Holds one `<svg>` per registered
   * region (created lazily) containing a primary polygon plus pooled
   * ghost polygons for wrap-tile copies. Sits *behind* shapes so the
   * region's green tint and dashed border feel like the floor of the
   * space rather than a sticker pasted on top.
   */
  #regionBackLayer!: HTMLDivElement;
  /**
   * Per-region back-layer SVG state, kept in lockstep with `#regionFaces`.
   * Created lazily on first render; torn down when the region is removed
   * (or its bound face is destroyed by an unrelated mutation).
   */
  #regionBackEntries = new Map<FolkAtlasRegion, RegionBackEntry>();

  /** In-flight drag state for tool-driven interactions. */
  #toolDrag: ToolDragState | null = null;
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
    this.#ghostLayer = document.createElement('div');
    this.#ghostLayer.className = 'ghosts';
    this.#ghostLayer.setAttribute('aria-hidden', 'true');
    const slot = document.createElement('slot');
    // Ghosts before slot so editable originals paint on top.
    this.#content.append(this.#ghostLayer, slot);
    root.append(this.#content);
    this.#ghosts = new ShapeGhostRenderer(this.#ghostLayer);

    this.#overlay = document.createElement('div');
    this.#overlay.className = 'overlay';
    root.append(this.#overlay);

    this.#regionBackLayer = document.createElement('div');
    this.#regionBackLayer.className = 'regions-back';
    this.#regionBackLayer.setAttribute('aria-hidden', 'true');
    root.append(this.#regionBackLayer);

    this.#regionLayer = document.createElement('div');
    this.#regionLayer.className = 'regions';
    root.append(this.#regionLayer);

    this.#lastComposites = this.#atlas.computeComposites();
    for (const child of this.children) {
      if (child instanceof FolkAtlasShape) this.#registerShape(child);
    }

    this.#mutationObserver.observe(this, { childList: true });
    this.#resizeObserver.observe(this);

    this.addEventListener('wheel', this.#onWheel, { passive: false });
    this.addEventListener('mouseup', this.#onMouseUp);
    this.addEventListener('pointerdown', this.#onPointerDown);
    this.addEventListener('pointermove', this.#onPointerMove);
    this.addEventListener('pointerup', this.#onPointerUp);
    this.addEventListener('pointercancel', this.#onPointerUp);
    window.addEventListener('blur', this.#onBlur);

    this.#scheduleUpdate();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('wheel', this.#onWheel);
    this.removeEventListener('mouseup', this.#onMouseUp);
    this.removeEventListener('pointerdown', this.#onPointerDown);
    this.removeEventListener('pointermove', this.#onPointerMove);
    this.removeEventListener('pointerup', this.#onPointerUp);
    this.removeEventListener('pointercancel', this.#onPointerUp);
    window.removeEventListener('blur', this.#onBlur);
    this.#mutationObserver.disconnect();
    this.#resizeObserver.disconnect();
    this.#ghosts?.clear();
    for (const region of this.#regionFaces.keys()) region.remove();
    this.#regionFaces.clear();
    for (const region of [...this.#regionBackEntries.keys()]) this.#removeRegionBackEntry(region);
  }

  // ---- Child wiring ----

  #onChildAdded(el: Element) {
    if (el instanceof FolkAtlasShape) this.#registerShape(el);
  }

  #onChildRemoved(el: Element) {
    if (el instanceof FolkAtlasShape) this.#unregisterShape(el);
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
    this.#ghosts?.removeShape(shape);
  }

  #placeInRootFrame(shape: FolkAtlasShape, rootPoint: Point) {
    // Use fresh composites — `#lastComposites` may be stale (e.g. mid-mutation).
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
   * Return the {@link Face} a region is bound to, or `null` if untracked.
   */
  regionFace(region: FolkAtlasRegion): Face | null {
    return this.#regionFaces.get(region) ?? null;
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
    if (this.#lastImages.length === 0) {
      this.#lastImages = this.#atlas.computeImages();
    }
    const rect = this.getBoundingClientRect();
    const rx = (clientX - rect.left - this.#x) / this.#scale;
    const ry = (clientY - rect.top - this.#y) / this.#scale;
    // Iterate every image — including wrap-tile images of the root face —
    // so dragging across a wrap seam hits the correct face. Because the cap
    // for non-root faces is 1, every other (face) appears exactly once in
    // `#lastImages`, but the root face may appear many times (each tile of
    // a wrapped region). Returning the face-local point in *that image's
    // frame* is what gives shape drag its "wrap around" feel: the local
    // coordinate stays inside the canonical face's bounds even when the
    // pointer is visually in a tile far from the canonical position.
    for (const img of this.#lastImages) {
      const local = M.applyToPoint(M.invert(img.composite), { x: rx, y: ry });
      if (img.face.contains(local)) return { face: img.face, x: local.x, y: local.y };
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

  // ---- Tool-driven pointer interactions ----
  //
  // Background pointer events on the atlas dispatch by `this.tool`. Shapes
  // and other in-canvas elements stop propagation in their own handlers, so
  // these only fire when the pointer is on the atlas background itself.

  /**
   * `true` if the given event target is the atlas background — i.e. not a
   * shape or any other slotted child. Used to gate tool gestures so e.g.
   * pointerdown on a shape doesn't double-fire the `shape` tool's
   * "create new shape" gesture.
   */
  #isBackgroundTarget(target: EventTarget | null): boolean {
    return target === this || target instanceof HTMLDivElement;
  }

  #onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (!this.#isBackgroundTarget(event.target)) return;
    if (this.tool === 'select') return;
    event.preventDefault();
    event.stopPropagation();
    this.setPointerCapture(event.pointerId);
    if (this.tool === 'shape') this.#startShapeDrag(event);
    else if (this.tool === 'region') this.#startRegionDrag(event);
    else if (this.tool === 'line-cut') this.#startLineDraw(event);
  };

  #onPointerMove = (event: PointerEvent) => {
    const drag = this.#toolDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // Handle-expand drags are scoped to the handle element and route through
    // its own listeners; the atlas dispatcher only sees the other two.
    if (drag.kind === 'handle-expand') return;
    event.preventDefault();
    if (drag.kind === 'shape') this.#updateShapeDrag(drag, event);
    else if (drag.kind === 'region') this.#updateRegionDrag(drag, event);
    else if (drag.kind === 'line-draw') this.#updateLineDraw(drag, event);
  };

  #onPointerUp = (event: PointerEvent) => {
    const drag = this.#toolDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.kind === 'handle-expand') return;
    event.preventDefault();
    if (this.hasPointerCapture(event.pointerId)) this.releasePointerCapture(event.pointerId);
    if (drag.kind === 'shape') this.#endShapeDrag(drag, event);
    else if (drag.kind === 'region') this.#endRegionDrag(drag, event);
    else if (drag.kind === 'line-draw') this.#endLineDraw(drag, event);
    this.#toolDrag = null;
  };

  // ---- Shape tool: drag a rectangle preview, release creates the shape ----

  #startShapeDrag(event: PointerEvent) {
    const el = document.createElement('div');
    el.className = 'preview-rect';
    this.#overlay.append(el);
    this.#toolDrag = {
      kind: 'shape',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      el,
    };
    this.#updateShapeDrag(this.#toolDrag, event);
  }

  #updateShapeDrag(drag: ShapeDragState, event: PointerEvent) {
    const rect = this.getBoundingClientRect();
    const x0 = drag.startClientX - rect.left;
    const y0 = drag.startClientY - rect.top;
    const x1 = event.clientX - rect.left;
    const y1 = event.clientY - rect.top;
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    drag.el.style.transform = `translate(${left}px, ${top}px)`;
    drag.el.style.width = `${w}px`;
    drag.el.style.height = `${h}px`;
  }

  #endShapeDrag(drag: ShapeDragState, event: PointerEvent) {
    drag.el.remove();
    // Convert the screen-space drag rectangle into root-frame coords and
    // create a new <folk-atlas-shape>. The mutation observer picks it up
    // and `#registerShape` places it in the correct face.
    const rect = this.getBoundingClientRect();
    const sx0 = (drag.startClientX - rect.left - this.#x) / this.#scale;
    const sy0 = (drag.startClientY - rect.top - this.#y) / this.#scale;
    const sx1 = (event.clientX - rect.left - this.#x) / this.#scale;
    const sy1 = (event.clientY - rect.top - this.#y) / this.#scale;
    const left = Math.min(sx0, sx1);
    const top = Math.min(sy0, sy1);
    let w = Math.abs(sx1 - sx0);
    let h = Math.abs(sy1 - sy0);
    // Tiny click-without-drag: create a default-sized shape centred on the
    // click. Threshold in screen pixels so it's stable across zoom levels.
    const screenDx = event.clientX - drag.startClientX;
    const screenDy = event.clientY - drag.startClientY;
    if (screenDx * screenDx + screenDy * screenDy < 16) {
      const dw = 120 / this.#scale;
      const dh = 60 / this.#scale;
      this.#createShape(left - dw / 2, top - dh / 2, dw, dh);
    } else {
      this.#createShape(left, top, w, h);
    }
  }

  #createShape(x: number, y: number, width: number, height: number) {
    const el = new FolkAtlasShape();
    el.x = x;
    el.y = y;
    el.width = width;
    el.height = height;
    el.textContent = 'shape';
    this.append(el);
  }

  // ---- Region tool: drag a rectangle preview, release inserts a region ----

  #startRegionDrag(event: PointerEvent) {
    const el = document.createElement('div');
    el.className = 'preview-rect';
    this.#overlay.append(el);
    this.#toolDrag = {
      kind: 'region',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      el,
    };
    this.#updateRegionDrag(this.#toolDrag, event);
  }

  #updateRegionDrag(drag: RegionDragState, event: PointerEvent) {
    const rect = this.getBoundingClientRect();
    const x0 = drag.startClientX - rect.left;
    const y0 = drag.startClientY - rect.top;
    const x1 = event.clientX - rect.left;
    const y1 = event.clientY - rect.top;
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    drag.el.style.transform = `translate(${left}px, ${top}px)`;
    drag.el.style.width = `${w}px`;
    drag.el.style.height = `${h}px`;
  }

  #endRegionDrag(drag: RegionDragState, event: PointerEvent) {
    drag.el.remove();
    const rect = this.getBoundingClientRect();
    const sx0 = drag.startClientX - rect.left;
    const sy0 = drag.startClientY - rect.top;
    const sx1 = event.clientX - rect.left;
    const sy1 = event.clientY - rect.top;
    let left = Math.min(sx0, sx1);
    let top = Math.min(sy0, sy1);
    let w = Math.abs(sx1 - sx0);
    let h = Math.abs(sy1 - sy0);
    // Tiny click-without-drag: default-sized region centred on the click.
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    if (dx * dx + dy * dy < 16) {
      const dw = 200;
      const dh = 140;
      left = sx0 - dw / 2;
      top = sy0 - dh / 2;
      w = dw;
      h = dh;
    }
    if (w < 8 || h < 8) return;
    this.createRegionAtScreenRect({ x: left, y: top, width: w, height: h });
  }

  // -------------------------------------------------------------------------
  // Scene loading API
  // -------------------------------------------------------------------------

  /**
   * Replace the current atlas, shapes, and regions with a named built-in
   * scene from {@link SCENES}. After tearing down, the atlas is reset to
   * a fresh seed (`createInitialAtlas`), the view recentred on the host's
   * bounding rect, and the scene's builder runs against the empty atlas.
   *
   * If the builder returns a {@link Face}, the atlas root is switched to
   * that face before re-centring — this lets a scene place its
   * "interesting" geometry away from the seed-atlas axes (which avoids
   * the 4-quadrant straddle in `createRegionAtScreenRect`) and still have
   * it appear at screen centre when the scene loads.
   */
  loadScene(name: string): void {
    // Tear down shapes: remove from light DOM and drop bookkeeping +
    // ghosts. The MutationObserver also fires `#unregisterShape` async,
    // which is idempotent.
    for (const shape of [...this.#shapeFaces.keys()]) {
      this.#ghosts?.removeShape(shape);
      shape.remove();
    }
    this.#shapeFaces.clear();

    // Tear down regions: remove the front-layer custom element and the
    // atlas-owned back-layer SVG.
    for (const region of [...this.#regionFaces.keys()]) region.remove();
    this.#regionFaces.clear();
    for (const region of [...this.#regionBackEntries.keys()]) {
      this.#removeRegionBackEntry(region);
    }

    this.#atlas = createInitialAtlas();
    this.#lastComposites = new Map();
    this.#lastImages = [];
    this.#lastVisibility.clear();

    // Recentre the view *before* running the builder so any scene that
    // calls `createRegionAtScreenRect` sees a sane mapping from screen
    // coords to root frame.
    const rect = this.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this.#x = rect.width / 2;
      this.#y = rect.height / 2;
      this.#scale = 1;
      this.#centeredOnce = true;
    }

    const builder: SceneBuilder | undefined = SCENES[name];
    if (!builder) {
      console.warn(`[folk-atlas] unknown scene: ${name}. Known: ${listSceneNames().join(', ')}`);
      this.#scheduleUpdate();
      return;
    }
    const sceneRoot = builder(this);
    if (sceneRoot && this.#atlas.faces.includes(sceneRoot)) {
      this.#atlas.switchRoot(sceneRoot);
    }
    this.#scheduleUpdate();
  }

  /** List of registered scene names (for UI population). */
  static get sceneNames(): string[] {
    return listSceneNames();
  }

  // -------------------------------------------------------------------------
  // Region creation API
  // -------------------------------------------------------------------------

  /**
   * Create a region by carving an axis-aligned rectangle out of the atlas
   * with four line cuts (top, bottom, left, right) and binding the resulting
   * centre face to a fresh `<folk-atlas-region>` element.
   *
   * `screenRect` is in CSS pixels relative to the atlas's bounding rect —
   * the natural output of a tool drag. We convert to face-local coordinates
   * per cut because each `splitAtlasAlongLine` call may reassign
   * `atlas.root` and shift the root frame.
   *
   * Returns the created region element (already appended to the region
   * layer) or `null` if no centre face could be located (e.g. the rect is
   * degenerate or sits entirely outside the atlas).
   */
  createRegionAtScreenRect(screenRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): FolkAtlasRegion | null {
    const x0 = screenRect.x;
    const y0 = screenRect.y;
    const x1 = screenRect.x + screenRect.width;
    const y1 = screenRect.y + screenRect.height;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;

    // Four axis-aligned cuts. Each is described by a *screen* anchor and a
    // direction. Direction is preserved across screen → face-local for
    // translation-only edge transforms (current scope).
    //
    // Seeds are placed at the *midpoint* of each cut line (not at the rect's
    // corners): a corner sits on the boundary of two existing wedge faces in
    // the seed atlas and on the boundary of subsequent cut faces, which makes
    // `splitAtlasAlongLine`'s `face.contains` lookups and walk-line entry
    // computations degenerate. Midpoints are guaranteed strictly interior to
    // their host face after every previous parallel cut.
    //
    // Known limitation: if the requested rect straddles a seed-atlas axis
    // (the X or Y half-axes that bound the default wedges), the four cuts
    // produce up to four sub-faces in the middle (one per quadrant the
    // rect enters) rather than a single rectangle. `locate(centre)` below
    // will pick whichever quadrant the rect's centre falls in. That
    // quadrant *is* still a clean rectangle and `wrapRegionAxis` works on
    // it; visually the region just appears as a sub-rect of the requested
    // area. A future fix would either start from a seed atlas without
    // origin-crossing wedges, or add a "merge faces along shared finite
    // edge" primitive and merge the sub-faces here.
    const cuts: Array<{
      seedClientX: number;
      seedClientY: number;
      direction: Point;
    }> = [
      { seedClientX: cx, seedClientY: y0, direction: { x: 1, y: 0 } }, // top
      { seedClientX: cx, seedClientY: y1, direction: { x: 1, y: 0 } }, // bottom
      { seedClientX: x0, seedClientY: cy, direction: { x: 0, y: 1 } }, // left
      { seedClientX: x1, seedClientY: cy, direction: { x: 0, y: 1 } }, // right
    ];

    for (const cut of cuts) {
      this.#runOneRegionCut(cut.seedClientX, cut.seedClientY, cut.direction);
    }

    // Locate the centre face after all four cuts. Use the rect's screen
    // centre, converted to the post-mutation root frame.
    const rootCentre = this.#screenPointToRoot(cx, cy);
    const centreFace = this.#atlas.locate(rootCentre);
    if (!centreFace) {
      console.warn('[folk-atlas] createRegion: no face found at rect centre');
      return null;
    }

    const region = new FolkAtlasRegion();
    this.#regionLayer.append(region);
    this.#regionFaces.set(region, centreFace);
    this.#scheduleUpdate();
    return region;
  }

  /**
   * Helper: translate a screen point to the atlas's *root* frame using the
   * current view transform. (No face binding; just the affine convert.)
   */
  #screenPointToRoot(clientX: number, clientY: number): Point {
    return {
      x: (clientX - this.#x) / this.#scale,
      y: (clientY - this.#y) / this.#scale,
    };
  }

  /**
   * Run a single line cut sourced from a screen-coord seed. Handles host
   * lookup, frame conversion, view compensation, and orphan relocation —
   * the same machinery `#commitCutGizmo` uses for the line-cut tool, just
   * without a strip insertion (region cuts produce a sharp partition).
   */
  #runOneRegionCut(seedClientX: number, seedClientY: number, direction: Point): void {
    if (this.#lastComposites.size === 0) {
      this.#lastComposites = this.#atlas.computeComposites();
    }
    const seedRoot = this.#screenPointToRoot(seedClientX, seedClientY);
    let host: Face | null = null;
    let seedLocal: Point = seedRoot;
    for (const [face, mf] of this.#lastComposites) {
      const local = M.applyToPoint(M.invert(mf), seedRoot);
      if (face.contains(local)) {
        host = face;
        seedLocal = local;
        break;
      }
    }
    if (!host) {
      console.warn('[folk-atlas] region cut: seed not in any face');
      return;
    }
    const oldComposites = new Map(this.#lastComposites);
    try {
      splitAtlasAlongLine(this.#atlas, host, seedLocal, direction);
    } catch (err) {
      console.warn('[folk-atlas] region cut split failed:', err);
      return;
    }
    const { newComposites } = this.#compensateViewAfterMutation(oldComposites);
    this.#lastComposites = newComposites;
    this.#relocateOrphanedShapes(oldComposites);
    this.#relocateOrphanedRegions(oldComposites);
  }

  // -------------------------------------------------------------------------
  // Region wrap API
  // -------------------------------------------------------------------------

  /**
   * Toggle wrapping of the region across the given axis (asymmetric model).
   *
   * Horizontal wrap re-aims the region's *left* and *right* edges so they
   * point at *each other* (cylinder-cycle on the inside). Crucially the
   * outside neighbours are left alone: their inside-facing twin pointers
   * still reference our left/right edges, so from outside the region
   * still looks like a normal face you can enter from any side. From
   * inside, the wrap loops the interior onto itself indefinitely.
   *
   * Vertical wrap is the same with top/bottom.
   *
   * This relies on the asymmetric-twin model (`he.twin.twin !== he` is
   * allowed). Outside.twin still points at us; our edge points at our
   * opposite edge. The two cycles are decoupled.
   *
   * Toggling a second time restores the original "outside twin" link by
   * re-twinning each region edge to its outside neighbour with identity
   * transform (which is what the original split produced).
   */
  wrapRegionAxis(region: FolkAtlasRegion, axis: RegionWrapAxis): void {
    const face = this.#regionFaces.get(region);
    if (!face || !this.#atlas.faces.includes(face)) return;

    const sides = this.#regionSides(face);
    if (!sides) {
      console.warn('[folk-atlas] wrapRegionAxis: face is not a clean rectangle');
      return;
    }

    const isCurrentlyWrapped = axis === 'horizontal' ? region.wrapH : region.wrapV;
    const heA = axis === 'horizontal' ? sides.right : sides.top;
    const heB = axis === 'horizontal' ? sides.left : sides.bottom;

    if (isCurrentlyWrapped) {
      // Find the outside twins BEFORE mutating anything. We only consider
      // half-edges whose face is *different* from the region face — that
      // skips the wrap partner inside the region (which currently holds
      // the matching `twin === heA/heB` pointer) and finds the original
      // outside neighbour preserved by the asymmetric wrap.
      //
      // The outside half-edge still carries its original transform
      // (`outer.transform` maps outer.face → heA/heB.face), so we recover
      // the inbound transform we need for the region's edge as
      // `inv(outer.transform)`. This restores whatever non-identity
      // transform the original split installed (region cuts can produce
      // translation transforms when the cut crosses other faces).
      const outerA = this.#findExternalIncomingTwin(heA);
      const outerB = this.#findExternalIncomingTwin(heB);
      const tA = outerA ? M.invert(outerA.transform) : M.fromValues();
      const tB = outerB ? M.invert(outerB.transform) : M.fromValues();
      unlinkEdgeFromTwin(heA);
      unlinkEdgeFromTwin(heB);
      try {
        if (outerA) linkEdgeToTwin(this.#atlas, heA, outerA, tA);
        if (outerB) linkEdgeToTwin(this.#atlas, heB, outerB, tB);
      } catch (err) {
        console.warn('[folk-atlas] wrapRegionAxis: unwrap re-link failed:', err);
      }
      if (axis === 'horizontal') region.wrapH = false;
      else region.wrapV = false;
    } else {
      try {
        const T = translationToWrap(heA, heB);
        // Asymmetric: re-aim heA → heB and heB → heA, leaving the outside
        // neighbours' twin pointers (which still reference heA/heB)
        // untouched.
        unlinkEdgeFromTwin(heA);
        unlinkEdgeFromTwin(heB);
        linkEdgeToTwin(this.#atlas, heA, heB, T);
        linkEdgeToTwin(this.#atlas, heB, heA, M.invert(T));
      } catch (err) {
        console.warn('[folk-atlas] wrapRegionAxis: wrap failed:', err);
        return;
      }
      if (axis === 'horizontal') region.wrapH = true;
      else region.wrapV = true;
    }

    this.#scheduleUpdate();
  }

  /**
   * Set a region's *interior scale* relative to the outside frame. Larger
   * values "zoom in" — interior coordinates are intrinsically bigger, so
   * contents render at `1/S` from outside (and entering the region
   * shrinks your stride accordingly).
   *
   * Implementation: the boundary of the region's face is *re-expressed*
   * in a frame that's `R = S_new / S_old` times the previous frame.
   *   1. Multiply every finite half-edge stored coordinate of the
   *      region face by `R`. (Anchor stays at `(0, 0)` since `0·R = 0`.)
   *   2. For every half-edge `h` in the atlas with `h.twin`, conjugate
   *      its transform by the frame change: right-multiply by
   *      `scale(1/R)` if `h.face === regionFace`, left-multiply by
   *      `scale(R)` if `h.twin.face === regionFace`. Wrap partners
   *      (both endpoints inside the region) get *both* multiplications,
   *      which composes to a similarity-preserving conjugation that
   *      keeps the wrap a pure translation (just `R`× longer).
   *
   * Crucially this preserves shape coordinates: shapes inside the
   * region keep their `(x, y, w, h)` exactly. From outside, the
   * composite of the region face acquires a `1/R` linear part, so
   * interior contents appear at `1/R` size — the "infinite zoom"
   * effect. From inside (rooted in the region face), shape positions
   * are identical and only the boundary visually changes.
   *
   * Constraints:
   *   - `S_new` must be `> 0`.
   *   - Region's bound face must still exist in the atlas.
   *
   * View compensation is asymmetric:
   *   - When the user is *outside* the region (root ≠ region face), no
   *     compensation is needed — the region boundary's on-screen position
   *     is invariant (the linear part of the outgoing composite cancels
   *     the boundary stretch), and interior contents naturally appear at
   *     the new `1/R` size.
   *   - When the user is *inside* the region (root === region face),
   *     finite coords on root just got multiplied by `R`. Without
   *     compensation, every shape in the region would visually scale by
   *     `R` on screen. Counter-scale the viewport by `1/R` so the
   *     contents the user is looking at stay in place; the world *outside*
   *     the region (reached via twin transforms) instead appears scaled.
   */
  setRegionScale(region: FolkAtlasRegion, sNew: number): void {
    const face = this.#regionFaces.get(region);
    if (!face || !this.#atlas.faces.includes(face)) return;
    if (!Number.isFinite(sNew) || sNew <= 0) return;
    const sOld = region.interiorScale ?? 1;
    if (Math.abs(sNew - sOld) < 1e-9) return;
    const R = sNew / sOld;
    rescaleFaceFrame(this.#atlas, face, R);
    region.interiorScale = sNew;
    if (face === this.#atlas.root) {
      this.#scale /= R;
    }
    this.#scheduleUpdate();
  }

  /**
   * Find the *outside* half-edge whose `twin === he` — i.e. the half-edge
   * in a different face that points at `he`. Skips the wrap partner that
   * lives inside the same face. Used by unwrap to restore the original
   * reciprocal twin after a wrap is undone.
   */
  #findExternalIncomingTwin(he: HalfEdge): HalfEdge | null {
    for (const candidate of this.#atlas.halfEdges) {
      if (candidate.twin === he && candidate.face !== he.face) return candidate;
    }
    return null;
  }

  /**
   * Identify the four cardinal sides of a rectangular region face by the
   * dominant axis of each edge in the face's local frame. Returns `null`
   * if the face isn't a 4-gon with finite vertices.
   *
   * Tolerant of small tilts (region cuts are made with a tiny angular
   * tilt to avoid coinciding with seed atlas axes), so we classify edges
   * by their *dominant* axis (|dx| vs |dy|) rather than requiring exact
   * axis alignment.
   *
   * Convention: edges are CCW. For a rectangle whose anchor is at one
   * corner with the interior on the +x/+y side, the CCW order is
   * bottom → right → top → left.
   */
  #regionSides(face: Face): {
    bottom: HalfEdge;
    right: HalfEdge;
    top: HalfEdge;
    left: HalfEdge;
  } | null {
    if (face.halfEdges.length !== 4) return null;
    const sides = { bottom: null, right: null, top: null, left: null } as {
      bottom: HalfEdge | null;
      right: HalfEdge | null;
      top: HalfEdge | null;
      left: HalfEdge | null;
    };
    for (const he of face.halfEdges) {
      if (he.originKind !== 'finite' || he.next.originKind !== 'finite') return null;
      const dx = he.next.ox - he.ox;
      const dy = he.next.oy - he.oy;
      if (Math.abs(dx) >= Math.abs(dy)) {
        // Predominantly horizontal.
        if (dx > 0) sides.bottom = he;
        else sides.top = he;
      } else {
        // Predominantly vertical.
        if (dy > 0) sides.right = he;
        else sides.left = he;
      }
    }
    if (!sides.bottom || !sides.right || !sides.top || !sides.left) return null;
    return sides as { bottom: HalfEdge; right: HalfEdge; top: HalfEdge; left: HalfEdge };
  }

  /**
   * After an atlas mutation, walk all regions and try to re-locate their
   * bound face. The strategy mirrors `#relocateOrphanedShapes`: find the
   * region's anchor in the *old* root frame, then locate which surviving
   * face contains it in the *new* root frame.
   *
   * Regions whose face survives need no work. Regions whose face is gone
   * (e.g. another cut sliced through the rectangle) are unbound — the
   * element stays in the DOM but renders empty until manually re-bound or
   * removed.
   */
  #relocateOrphanedRegions(oldComposites: ReadonlyMap<Face, M.Matrix2D>): void {
    if (this.#regionFaces.size === 0) return;
    const newComposites = this.#lastComposites;
    const survivors = new Set(this.#atlas.faces);
    for (const [region, oldFace] of this.#regionFaces) {
      if (survivors.has(oldFace)) continue;
      const oldFaceComp = oldComposites.get(oldFace);
      if (!oldFaceComp) {
        this.#regionFaces.delete(region);
        continue;
      }
      // Use the (old) face's anchor (origin = (0,0)) to pick a new face.
      // For now, pick whichever face contains the anchor in the new root.
      const anchorRoot = M.applyToPoint(oldFaceComp, { x: 0, y: 0 });
      let placed = false;
      for (const newFace of this.#atlas.faces) {
        const newComp = newComposites.get(newFace);
        if (!newComp) continue;
        const local = M.applyToPoint(M.invert(newComp), anchorRoot);
        if (newFace.contains(local)) {
          this.#regionFaces.set(region, newFace);
          placed = true;
          break;
        }
      }
      if (!placed) this.#regionFaces.delete(region);
    }
  }

  // ---- Line-cut tool ----
  //
  // Two-phase gesture:
  //   (1) Drag on the background to draw an infinite line. The drawn segment
  //       (start→end of the drag) is rendered solid; the projected infinite
  //       extensions beyond each end are dashed and faded. Release does NOT
  //       mutate the atlas — it just commits a persistent gizmo.
  //   (2) The persistent gizmo has a perpendicular handle at the seam (the
  //       midpoint of the original drag). Dragging the handle perpendicular
  //       to the line picks Δ — the size of the strip that would be inserted
  //       on that side. Visual only in B1 — when the cut/strip primitive
  //       lands (B2+), this is where the actual atlas mutation will happen.
  //
  // The gizmo persists until the user draws another line or switches tools.

  /** "Far enough" multiplier for projecting infinite line extensions in screen px. */
  static #INFINITE_REACH_MULT = 4;

  /** Persistent line-cut gizmo, or `null` when no line is currently drawn. */
  #cutGizmo: LineCutGizmo | null = null;

  #startLineDraw(event: PointerEvent) {
    // Clear any prior gizmo — drawing a new line replaces it.
    this.#clearCutGizmo();
    const svg = this.#createCutSvg();
    const lineBefore = this.#createCutLine(svg, 'cut-infinite');
    const lineFinite = this.#createCutLine(svg, 'cut-finite');
    const lineAfter = this.#createCutLine(svg, 'cut-infinite');
    this.#overlay.append(svg);
    this.#toolDrag = {
      kind: 'line-draw',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      svg,
      lineBefore,
      lineFinite,
      lineAfter,
    };
    this.#updateLineDraw(this.#toolDrag, event);
  }

  #updateLineDraw(drag: LineDrawDragState, event: PointerEvent) {
    const rect = this.getBoundingClientRect();
    const x0 = drag.startClientX - rect.left;
    const y0 = drag.startClientY - rect.top;
    const x1 = event.clientX - rect.left;
    const y1 = event.clientY - rect.top;
    this.#layoutCutLines(
      drag.lineBefore,
      drag.lineFinite,
      drag.lineAfter,
      { x: x0, y: y0 },
      { x: x1, y: y1 },
      Math.max(rect.width, rect.height) * FolkAtlas.#INFINITE_REACH_MULT,
    );
  }

  #endLineDraw(drag: LineDrawDragState, event: PointerEvent) {
    drag.svg.remove();

    // Cancel: too short to be a meaningful line.
    const dsx = event.clientX - drag.startClientX;
    const dsy = event.clientY - drag.startClientY;
    if (dsx * dsx + dsy * dsy < 16) return;

    const midClientX = (drag.startClientX + event.clientX) / 2;
    const midClientY = (drag.startClientY + event.clientY) / 2;
    const seamLocal = this.screenToFaceLocal(midClientX, midClientY);
    if (!seamLocal) return;
    const startLocal = this.screenToFaceLocal(drag.startClientX, drag.startClientY);
    const endLocal = this.screenToFaceLocal(event.clientX, event.clientY);
    if (!startLocal || !endLocal) return;

    // Express drag start/end in the seam's host face frame.
    const drawStart = this.reexpressPoint(startLocal, seamLocal.face);
    const drawEnd = this.reexpressPoint(endLocal, seamLocal.face);
    const dx = drawEnd.x - drawStart.x;
    const dy = drawEnd.y - drawStart.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;

    this.#createCutGizmo({
      hostFace: seamLocal.face,
      anchor: { x: seamLocal.x, y: seamLocal.y },
      direction: { x: dx / len, y: dy / len },
      drawStart,
      drawEnd,
    });
  }

  // ---- Cut gizmo lifecycle ----

  #createCutSvg(): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'cut-svg');
    return svg;
  }

  #createCutLine(svg: SVGSVGElement, className: string): SVGLineElement {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', className);
    svg.append(line);
    return line;
  }

  #createCutGizmo(spec: {
    hostFace: Face;
    anchor: Point;
    direction: Point;
    drawStart: Point;
    drawEnd: Point;
  }) {
    const svg = this.#createCutSvg();
    const lineBefore = this.#createCutLine(svg, 'cut-infinite');
    const lineFinite = this.#createCutLine(svg, 'cut-finite');
    const lineAfter = this.#createCutLine(svg, 'cut-infinite');
    const perp = this.#createCutLine(svg, 'cut-perp');
    perp.style.display = 'none';
    this.#overlay.append(svg);

    const handle = document.createElement('div');
    handle.className = 'cut-handle';
    handle.addEventListener('pointerdown', this.#onHandlePointerDown);
    handle.addEventListener('pointermove', this.#onHandlePointerMove);
    handle.addEventListener('pointerup', this.#onHandlePointerUp);
    handle.addEventListener('pointercancel', this.#onHandlePointerUp);
    this.#overlay.append(handle);

    this.#cutGizmo = {
      hostFace: spec.hostFace,
      anchor: spec.anchor,
      direction: spec.direction,
      drawStart: spec.drawStart,
      drawEnd: spec.drawEnd,
      delta: 0,
      committed: null,
      svg,
      lineBefore,
      lineFinite,
      lineAfter,
      perp,
      handle,
    };
    this.#scheduleUpdate();
  }

  #clearCutGizmo() {
    if (!this.#cutGizmo) return;
    this.#cutGizmo.svg.remove();
    this.#cutGizmo.handle.remove();
    this.#cutGizmo = null;
    if (this.#toolDrag?.kind === 'handle-expand') this.#toolDrag = null;
  }

  /**
   * Project the cut gizmo's host-frame geometry to screen space and update
   * its DOM. Called once per `#render()`. Pure layout — no atlas reads.
   */
  #renderCutGizmo() {
    const g = this.#cutGizmo;
    if (!g) return;
    const composite = this.#lastComposites.get(g.hostFace);
    if (!composite) {
      // Host face vanished (only possible once mutation lands; harmless to drop).
      this.#clearCutGizmo();
      return;
    }
    const view = M.scaleSelf(M.fromTranslate(this.#x, this.#y), this.#scale);
    const screen = M.multiply(view, composite);
    const sa = M.applyToPoint(screen, g.anchor);
    const ss = M.applyToPoint(screen, g.drawStart);
    const se = M.applyToPoint(screen, g.drawEnd);
    const ddx = se.x - ss.x;
    const ddy = se.y - ss.y;
    const dlen = Math.hypot(ddx, ddy);
    if (dlen < 1e-6) return;
    const ux = ddx / dlen;
    const uy = ddy / dlen;
    const rect = this.getBoundingClientRect();
    const reach = Math.max(rect.width, rect.height) * FolkAtlas.#INFINITE_REACH_MULT;
    this.#layoutCutLines(g.lineBefore, g.lineFinite, g.lineAfter, ss, se, reach);

    // Perpendicular (90° CCW from line direction in screen space).
    const perpX = -uy;
    const perpY = ux;
    const handleScreenDx = g.delta * this.#scale * perpX;
    const handleScreenDy = g.delta * this.#scale * perpY;
    const handleX = sa.x + handleScreenDx;
    const handleY = sa.y + handleScreenDy;
    if (Math.abs(g.delta) > 1e-6) {
      g.perp.style.display = '';
      g.perp.setAttribute('x1', String(sa.x));
      g.perp.setAttribute('y1', String(sa.y));
      g.perp.setAttribute('x2', String(handleX));
      g.perp.setAttribute('y2', String(handleY));
    } else {
      g.perp.style.display = 'none';
    }
    g.handle.style.transform = `translate(${handleX - 7}px, ${handleY - 7}px)`;
  }

  /**
   * Lay out the three line segments (before-infinite, drawn-finite,
   * after-infinite) along the line through `start`→`end`, with the infinite
   * extensions reaching `reach` screen pixels past each endpoint.
   */
  #layoutCutLines(
    before: SVGLineElement,
    finite: SVGLineElement,
    after: SVGLineElement,
    start: Point,
    end: Point,
    reach: number,
  ) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    finite.setAttribute('x1', String(start.x));
    finite.setAttribute('y1', String(start.y));
    finite.setAttribute('x2', String(end.x));
    finite.setAttribute('y2', String(end.y));
    if (len < 1e-3) {
      // Degenerate: collapse extensions onto the click point.
      for (const l of [before, after]) {
        l.setAttribute('x1', String(start.x));
        l.setAttribute('y1', String(start.y));
        l.setAttribute('x2', String(start.x));
        l.setAttribute('y2', String(start.y));
      }
      return;
    }
    const ux = dx / len;
    const uy = dy / len;
    before.setAttribute('x1', String(start.x - ux * reach));
    before.setAttribute('y1', String(start.y - uy * reach));
    before.setAttribute('x2', String(start.x));
    before.setAttribute('y2', String(start.y));
    after.setAttribute('x1', String(end.x));
    after.setAttribute('y1', String(end.y));
    after.setAttribute('x2', String(end.x + ux * reach));
    after.setAttribute('y2', String(end.y + uy * reach));
  }

  // ---- Handle drag (expansion Δ) ----

  #onHandlePointerDown = (event: PointerEvent) => {
    const g = this.#cutGizmo;
    if (!g || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    g.handle.setPointerCapture(event.pointerId);
    g.handle.classList.add('dragging');
    this.#toolDrag = {
      kind: 'handle-expand',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startDelta: g.delta,
      gizmo: g,
    };
  };

  #onHandlePointerMove = (event: PointerEvent) => {
    const drag = this.#toolDrag;
    if (!drag || drag.kind !== 'handle-expand' || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const g = drag.gizmo;
    const composite = this.#lastComposites.get(g.hostFace);
    if (!composite) return;
    const view = M.scaleSelf(M.fromTranslate(this.#x, this.#y), this.#scale);
    const screen = M.multiply(view, composite);
    const ss = M.applyToPoint(screen, g.drawStart);
    const se = M.applyToPoint(screen, g.drawEnd);
    const ddx = se.x - ss.x;
    const ddy = se.y - ss.y;
    const dlen = Math.hypot(ddx, ddy);
    if (dlen < 1e-6) return;
    const ux = ddx / dlen;
    const uy = ddy / dlen;
    // Project the screen-space cursor offset onto the perpendicular axis.
    const dsx = event.clientX - drag.startClientX;
    const dsy = event.clientY - drag.startClientY;
    const screenDelta = dsx * -uy + dsy * ux;
    g.delta = drag.startDelta + screenDelta / this.#scale;
    // Live mutation: commit on first crossing of the threshold, then
    // resize on every subsequent move within the same drag. Both paths
    // schedule a render so the strip + handle stay in sync with the
    // cursor.
    if (!g.committed) {
      this.#commitCutGizmo(g);
    } else {
      this.#resizeCutStrip(g);
    }
    // If neither commit nor resize ran (e.g. |delta| under the eps),
    // still re-render so the preview tracks the cursor.
    if (!g.committed) this.#scheduleUpdate();
  };

  #onHandlePointerUp = (event: PointerEvent) => {
    const drag = this.#toolDrag;
    if (!drag || drag.kind !== 'handle-expand' || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (drag.gizmo.handle.hasPointerCapture(event.pointerId)) {
      drag.gizmo.handle.releasePointerCapture(event.pointerId);
    }
    drag.gizmo.handle.classList.remove('dragging');
    this.#toolDrag = null;
    // Final resize already happened in pointermove; nothing more to do.
  };

  /** Threshold below which `|delta|` is treated as "no cut yet" (host-frame units). */
  static #COMMIT_EPS = 1e-3;

  /**
   * Commit a fresh cut: subdivide every face the line crosses, then
   * open the seam by `|gizmo.delta|`. After this call the gizmo holds
   * `committed` state (split chain + strip handles) and is re-anchored
   * to the new strip face so subsequent {@link #resizeCutStrip} calls
   * can extend / shrink the strip without re-cutting.
   *
   * Sign convention: `insertStrip` always opens toward +n (the 90° CCW
   * perpendicular of the line direction). To make the "pushed side"
   * match the drag direction, we flip the line direction when
   * `delta < 0` — that swaps which side ends up on the +n half. The
   * sign is recorded so resize can mirror the convention.
   *
   * Idempotent: calling on an already-committed gizmo is a no-op.
   */
  #commitCutGizmo(gizmo: LineCutGizmo) {
    if (gizmo.committed) return;
    if (Math.abs(gizmo.delta) < FolkAtlas.#COMMIT_EPS) return;

    const sign: 1 | -1 = gizmo.delta >= 0 ? 1 : -1;
    const direction =
      sign > 0
        ? gizmo.direction
        : { x: -gizmo.direction.x, y: -gizmo.direction.y };

    const oldComposites = new Map(this.#lastComposites);

    let split: SplitAtlasAlongLineResult;
    try {
      split = splitAtlasAlongLine(this.#atlas, gizmo.hostFace, gizmo.anchor, direction);
    } catch (err) {
      console.warn('[folk-atlas] line cut split failed:', err);
      this.#clearCutGizmo();
      return;
    }

    let strip: InsertStripResult;
    const initialHeight = Math.abs(gizmo.delta);
    try {
      strip = insertStrip(this.#atlas, split, initialHeight);
    } catch (err) {
      console.warn('[folk-atlas] line cut strip insertion failed:', err);
      this.#clearCutGizmo();
      return;
    }

    gizmo.committed = { split, strip, sign, height: initialHeight };

    // Compensate the view first so `#x, #y` is correct for the post-
    // mutation root, then relocate any shapes whose face was replaced.
    const { newComposites, K } = this.#compensateViewAfterMutation(oldComposites);
    this.#lastComposites = newComposites;
    this.#relocateOrphanedShapes(oldComposites);

    // Re-anchor the gizmo onto the strip face so it survives the loss
    // of `hostFace`. The strip's frame is global-aligned to `hostFace`'s
    // frame (translation-only edges), so direction is preserved and only
    // points need re-expressing.
    //
    // Math: with K = oldRoot ← newRoot, the old/new screen positions of
    // any point P agree iff
    //     view_old · oldComp(host) · P_host
    //   = view_new · newComp(strip) · P_strip
    //   = (view_old · K) · newComp(strip) · P_strip
    // ⇒ P_strip = inv(newComp(strip)) · inv(K) · oldComp(host) · P_host
    const oldHostComp = oldComposites.get(gizmo.hostFace);
    const newStripComp = newComposites.get(strip.stripFace);
    if (oldHostComp && newStripComp) {
      const M_host_to_strip = M.multiply(
        M.invert(newStripComp),
        M.multiply(M.invert(K), oldHostComp),
      );
      gizmo.anchor = M.applyToPoint(M_host_to_strip, gizmo.anchor);
      gizmo.drawStart = M.applyToPoint(M_host_to_strip, gizmo.drawStart);
      gizmo.drawEnd = M.applyToPoint(M_host_to_strip, gizmo.drawEnd);
      gizmo.hostFace = strip.stripFace;
    } else {
      // Strip composite missing — atlas in an unexpected state. Drop
      // the gizmo defensively rather than render with stale geometry.
      this.#clearCutGizmo();
    }

    this.#scheduleUpdate();
  }

  /**
   * Resize an already-committed cut to a new |delta|.
   *
   * Skips the resize when the new height would fall below the commit
   * epsilon (we don't have a "delete strip" primitive yet — flooring
   * at the epsilon avoids a degenerate strip).
   */
  #resizeCutStrip(gizmo: LineCutGizmo) {
    const c = gizmo.committed;
    if (!c) return;
    // Sign-flip semantics: at commit time we baked `sign` into the
    // line direction, so the strip always opens toward the original
    // side. If the user drags through zero to the other side, the
    // visual asymmetry would invert — for the v1 path we cap at the
    // commit epsilon and keep the strip on its original side.
    const newHeight = Math.max(FolkAtlas.#COMMIT_EPS, Math.abs(gizmo.delta));
    if (newHeight === c.height) return;
    try {
      resizeStrip(c.strip, c.split, c.height, newHeight);
    } catch (err) {
      console.warn('[folk-atlas] line cut resize failed:', err);
      return;
    }
    c.height = newHeight;
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
   * jump. This keeps the actively-mutated frame near the user's focus.
   *
   * Assumption: every edge transform is a translation (or identity). With
   * that constraint, the view stays of the form `translate(x, y) · scale(s)`
   * after `view *= C` and we can decompose by inspection. When non-translation
   * edge transforms appear, the view should be promoted to a full Matrix2D.
   */
  #maybeSwitchRootToViewportCentre() {
    if (this.#lastImages.length === 0) return;
    const rect = this.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const rootPoint = { x: (cx - this.#x) / this.#scale, y: (cy - this.#y) / this.#scale };
    // Iterate full BFS images, not just primary composites: when the viewer
    // is inside a wrapped region the canonical region tile may scroll off
    // and the viewport centre lands in a wrap-tile image. We "snap" the
    // view to that tile by treating it as the new canonical position —
    // for the root face that's a pure view shift (looping around the wrap),
    // for a non-root face it also re-anchors `atlas.root` so composites
    // recompute from the new face.
    let target: AtlasImage | null = null;
    for (const img of this.#lastImages) {
      const local = M.applyToPoint(M.invert(img.composite), rootPoint);
      if (img.face.contains(local)) {
        target = img;
        break;
      }
    }
    if (!target) return;
    const C = target.composite;
    if (target.face === this.#atlas.root) {
      // Already root: shift the view by C so the wrap-tile takes
      // canonical position. No-op when the chosen image *is* the canonical
      // one (composite ≈ identity in both translation and scale).
      const isIdentity =
        Math.abs(C.e) < 1e-9 &&
        Math.abs(C.f) < 1e-9 &&
        Math.abs(C.a - 1) < 1e-9 &&
        Math.abs(C.d - 1) < 1e-9;
      if (isIdentity) return;
    } else {
      this.#atlas.root = target.face;
    }
    // Apply the full similarity K = C to the view: view_new = view_old · K.
    // For our (uniform-scale + translation) view this means
    //   #x_new = #scale_old * K.e + #x_old
    //   #y_new = #scale_old * K.f + #y_old
    //   #scale_new = #scale_old * K.a   (uniform scale is in K.a == K.d)
    // The translation parts keep the on-screen image of every face
    // anchored; the scale part undoes the inherent scale difference
    // between old and new root frames so deeper/scaled regions cause
    // *zero visual jump* at root-switch — the substrate quietly
    // renormalises while the user keeps wheel-zooming.
    this.#x += this.#scale * C.e;
    this.#y += this.#scale * C.f;
    this.#scale *= C.a;
    // Composites + images are stale after either kind of change; refresh so
    // subsequent point-locates and the next render see the new frame.
    this.#lastImages = this.#atlas.computeImages();
    this.#lastComposites = this.#atlas.computeComposites();
  }

  /**
   * Compensate `#x, #y` so on-screen positions stay invariant across an
   * atlas mutation that may have replaced `atlas.root`.
   *
   * Mutation primitives like `splitFaceAlongChord` reassign
   * `atlas.root = sub0` directly when they destroy the current root face
   * (sub0 is a brand-new face whose `(0,0)` anchor sits at some non-zero
   * position in the OLD root's frame). Without compensation, every
   * subsequent render uses `view · newComposite(F)` instead of
   * `view · oldComposite(F)`, and the entire scene jumps by the
   * `oldRoot ← newRoot` translation — sometimes very far, depending on
   * where the new root's anchor landed.
   *
   * The compensation is `oldRoot ← newRoot = oldComposite(F) · inv(newComposite(F))`
   * for any face `F` that exists in both the pre- and post-mutation
   * composite maps. Under the similarity-only edge-transform model this
   * matrix is itself a similarity (uniform scale + translation), so we
   * apply the full `view_new = view_old · K` update — translation parts
   * shift `#x, #y`, scale part multiplies `#scale`. For pure-translation
   * mutations (line cuts, region cuts) the scale part is 1 and this
   * reduces to the original translation-only behaviour.
   *
   * Caller responsibility: snapshot `oldComposites` (e.g. from
   * `#lastComposites`) before the mutation, call this immediately
   * after, and ensure `#scheduleUpdate` runs so `#lastComposites`
   * gets refreshed on the next frame.
   *
   * Returns the freshly-computed new composites and the `K` matrix that
   * was applied (identity when no compensation was needed). `K` is also
   * the matrix any caller needs to re-express points across the
   * `oldRoot → newRoot` change (e.g. to re-anchor a gizmo whose original
   * face was destroyed).
   */
  #compensateViewAfterMutation(
    oldComposites: Map<Face, M.Matrix2D>,
  ): { newComposites: Map<Face, M.Matrix2D>; K: M.Matrix2D } {
    const newComposites = this.#atlas.computeComposites();
    // No compensation needed if the root survived.
    if (oldComposites.has(this.#atlas.root)) {
      return { newComposites, K: M.fromValues() };
    }
    // Find any face that exists in both maps to anchor the shift.
    let oldM: M.Matrix2DReadonly | null = null;
    let newM: M.Matrix2DReadonly | null = null;
    for (const [face, mNew] of newComposites) {
      const mOld = oldComposites.get(face);
      if (mOld) {
        oldM = mOld;
        newM = mNew;
        break;
      }
    }
    if (!oldM || !newM) return { newComposites, K: M.fromValues() }; // whole atlas replaced
    // K = oldRoot ← newRoot, via the surviving anchor face F:
    //   oldRoot ← newRoot = (oldRoot ← F) · (F ← newRoot)
    //                     = oldComposite(F)  · inv(newComposite(F))
    const K = M.multiply(oldM, M.invert(newM));
    this.#x += this.#scale * K.e;
    this.#y += this.#scale * K.f;
    this.#scale *= K.a;
    return { newComposites, K };
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

    const rect = this.getBoundingClientRect();
    const viewport: ClipRect = {
      minX: 0,
      minY: 0,
      maxX: Math.max(0, rect.width),
      maxY: Math.max(0, rect.height),
    };

    // BFS expansion is bounded by *visibility*, not just the depth/image
    // caps in computeImages: from a wrapped face we'd otherwise tile the
    // plane forever, but here we stop fanning out as soon as the current
    // image is fully off-screen or has shrunk below ~1 logical pixel.
    // The cap arguments below are an emergency hatch only — if they get
    // hit, computeImages will log an error.
    const shouldExpand = (img: AtlasImage): boolean => {
      const aabb = projectFaceScreenAABB(img.face, img.composite, view);
      return imageIsVisible(aabb, viewport);
    };

    // One BFS per frame: derive the primary composite per face (first BFS
    // image, identical to computeComposites for tree atlases) and the
    // additional composites per face (the "ghost" images for wrapped /
    // looping topologies). Tree atlases produce an empty extras map at zero
    // cost beyond the BFS itself.
    const images = this.#atlas.computeImages({
      shouldExpand,
      maxDepth: 256,
      maxImagesPerFace: 4096,
    });
    const composites = new Map<Face, M.Matrix2D>();
    const extras = new Map<Face, M.Matrix2D[]>();
    const visibility = new Map<Face, number>();
    for (const img of images) {
      const aabb = projectFaceScreenAABB(img.face, img.composite, view);
      const visible = imageIsVisible(aabb, viewport);
      if (!composites.has(img.face)) {
        composites.set(img.face, img.composite);
        visibility.set(img.face, visible ? 1 : 0);
      } else if (visible) {
        // Off-screen ghost images are recorded by BFS (they sit just past
        // the visible boundary as the "fringe" that lets us learn about
        // their neighbours via shouldExpand) but never make it into the
        // ghost render set — there'd be nothing to see.
        const arr = extras.get(img.face);
        if (arr) arr.push(img.composite);
        else extras.set(img.face, [img.composite]);
      }
    }

    this.#lastComposites = composites;
    this.#lastImages = images;
    this.#lastVisibility = visibility;
    this.#renderShapes(composites);
    this.#ghosts.update(extras);
    this.#renderRegions(composites, extras, view);
    if (this.debug) {
      this.#debug.style.display = '';
      this.#renderDebug(composites, view);
    } else {
      this.#debug.style.display = 'none';
    }
    this.#renderCutGizmo();
  }

  protected override willUpdate(changedProperties: PropertyValues): void {
    // Switching away from line-cut tears down any in-progress gizmo —
    // the gizmo is meaningless outside its tool.
    if (changedProperties.has('tool') && this.tool !== 'line-cut') {
      this.#clearCutGizmo();
    }
    // Toggling debug needs a render to pick up the visibility change.
    if (changedProperties.has('debug')) this.#scheduleUpdate();
  }

  #renderShapes(composites: Map<Face, M.Matrix2D>) {
    for (const [shape, face] of this.#shapeFaces) {
      const composite = composites.get(face);
      // Face not reachable from current root (e.g. you've panned into a
      // wrapped region whose loop has no exit edges back to the rest of the
      // atlas). The shape's last transform is from a stale root, so we must
      // hide it explicitly — leaving `display = ''` would render it on top
      // of the new view at a meaningless position.
      if (!composite) {
        if (shape.style.display !== 'none') shape.style.display = 'none';
        continue;
      }
      const visibility = this.#lastVisibility.get(face) ?? 1;
      if (visibility <= 0) {
        if (shape.style.display !== 'none') shape.style.display = 'none';
        continue;
      }
      if (shape.style.display === 'none') shape.style.display = '';
      const m = M.translate(composite, shape.x, shape.y);
      shape.style.transform = M.toCSSString(m);
    }
  }

  /**
   * Per-frame placement for `<folk-atlas-region>` overlays. Outlines are
   * drawn into atlas-owned back-layer SVGs (one per region) so the green
   * fill + dashed border paint *behind* shapes; the region custom element
   * itself sits in the front layer and only carries the controls. Both
   * are projected from the bound face's local junctions through
   * `(view · faceComposite)`. The controls panel anchors at the polygon's
   * centroid (good enough for the axis-aligned rectangle case).
   *
   * Regions whose face is no longer in the atlas (destroyed by an unrelated
   * mutation, e.g. a line cut through it) are hidden until manually rebound,
   * and any orphan back entries are torn down at the end.
   */
  #renderRegions(
    composites: Map<Face, M.Matrix2D>,
    extras: Map<Face, M.Matrix2D[]>,
    view: M.Matrix2DReadonly,
  ) {
    // Even when no regions are tracked we still want to drop any stale
    // back entries (e.g. last region was removed this frame).
    if (this.#regionFaces.size === 0 && this.#regionBackEntries.size === 0) return;

    const survivors = new Set(this.#atlas.faces);

    const projectRing = (
      face: Face,
      composite: M.Matrix2D,
    ): { ring: Point[]; cx: number; cy: number; n: number } => {
      const screen = M.multiply(view, composite);
      const ring: Point[] = [];
      let cx = 0;
      let cy = 0;
      let n = 0;
      for (const j of face.junctions()) {
        const local =
          j.kind === 'finite'
            ? { x: j.x, y: j.y }
            : { x: j.x * FolkAtlas.IDEAL_RADIUS, y: j.y * FolkAtlas.IDEAL_RADIUS };
        const p = M.applyToPoint(screen, local);
        ring.push(p);
        if (j.kind === 'finite') {
          cx += p.x;
          cy += p.y;
          n++;
        }
      }
      return { ring, cx, cy, n };
    };

    const setPolyPoints = (poly: SVGPolygonElement, ring: ReadonlyArray<Point>) => {
      if (ring.length === 0) {
        poly.setAttribute('points', '');
        return;
      }
      const s = ring.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
      poly.setAttribute('points', s);
    };

    for (const [region, face] of this.#regionFaces) {
      const back = this.#getOrCreateRegionBackEntry(region);
      if (!survivors.has(face)) {
        region.setVisible(false);
        back.svg.style.display = 'none';
        continue;
      }
      const composite = composites.get(face);
      if (!composite) {
        region.setVisible(false);
        back.svg.style.display = 'none';
        continue;
      }
      region.setVisible(true);
      back.svg.style.display = '';
      const primary = projectRing(face, composite);
      setPolyPoints(back.primary, primary.ring);
      if (primary.n > 0) {
        region.setControlsScreenPosition(primary.cx / primary.n, primary.cy / primary.n);
      }
      // Ghost outlines: every additional BFS image of this face. For a
      // wrapped region viewed from outside there are typically zero; from
      // inside the wrap (root === region face) there are many — the
      // repeating cylinder/torus tiles.
      const more = extras.get(face);
      const ghostRings = more && more.length > 0 ? more.map((c) => projectRing(face, c).ring) : [];
      while (back.ghosts.length < ghostRings.length) {
        const g = document.createElementNS(SVG_NS, 'polygon');
        g.classList.add('ghost');
        back.svg.append(g);
        back.ghosts.push(g);
      }
      for (let i = 0; i < back.ghosts.length; i++) {
        const node = back.ghosts[i];
        const ring = ghostRings[i];
        if (!ring) {
          if (node.style.display !== 'none') node.style.display = 'none';
          continue;
        }
        if (node.style.display === 'none') node.style.display = '';
        setPolyPoints(node, ring);
      }
    }

    // Garbage-collect back entries for regions that are no longer tracked
    // (the region element was removed without going through #removeRegion).
    if (this.#regionBackEntries.size > this.#regionFaces.size) {
      for (const region of this.#regionBackEntries.keys()) {
        if (!this.#regionFaces.has(region)) this.#removeRegionBackEntry(region);
      }
    }
  }

  #getOrCreateRegionBackEntry(region: FolkAtlasRegion): RegionBackEntry {
    let entry = this.#regionBackEntries.get(region);
    if (entry) return entry;
    const svg = document.createElementNS(SVG_NS, 'svg');
    const primary = document.createElementNS(SVG_NS, 'polygon');
    svg.append(primary);
    this.#regionBackLayer.append(svg);
    entry = { svg, primary, ghosts: [] };
    this.#regionBackEntries.set(region, entry);
    return entry;
  }

  #removeRegionBackEntry(region: FolkAtlasRegion): void {
    const entry = this.#regionBackEntries.get(region);
    if (!entry) return;
    entry.svg.remove();
    this.#regionBackEntries.delete(region);
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
      const visibility = this.#lastVisibility.get(face) ?? 1;
      if (visibility <= 0) continue;
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
// Visibility falloff stubs
// ----------------------------------------------------------------------------
//
// Per-face visibility ∈ [0, 1] is the product of independent falloff factors.
// Today both factors are stubs that always return 1, so every reachable face
// is fully visible — but the renderer reads the scalar through these helpers,
// so enabling culling, opacity blending, or LOD later is a one-line change
// to the body of each function. See `sia.md` § "Per-face visibility (scalar)".

/**
 * Project a face's junction polygon through `view · composite` and return its
 * axis-aligned screen-space bounding box. Ideal junctions are stubbed at
 * `IDEAL_RADIUS`, so faces with ideal vertices have AABBs that cover most of
 * any plausible viewport — i.e. they're treated as "always visible", which is
 * the correct behaviour for genuinely infinite faces.
 *
 * Returns a degenerate (`Infinity`) AABB only if the face has no junctions,
 * which shouldn't happen for a valid atlas.
 */
function projectFaceScreenAABB(
  face: Face,
  composite: M.Matrix2DReadonly,
  view: M.Matrix2DReadonly,
): ClipRect {
  const screen = M.multiply(view, composite);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const j of face.junctions()) {
    const local =
      j.kind === 'finite'
        ? { x: j.x, y: j.y }
        : { x: j.x * FolkAtlas.IDEAL_RADIUS, y: j.y * FolkAtlas.IDEAL_RADIUS };
    const p = M.applyToPoint(screen, local);
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Visibility test for a face image: the AABB must overlap the viewport AND
 * be at least `MIN_VISIBLE_PX` along *both* axes. The "AND" matters — a
 * 0.3 px-wide bar that is 200 px tall still counts as visible (a thin
 * line you can see), whereas a face that has shrunk to a sub-pixel speck
 * in both dimensions cannot contribute any pixels and is dropped.
 *
 * This is the predicate used both by `shouldExpand` (to bound the BFS so
 * wrapped tiles don't fan out forever) and by the render filter (to skip
 * drawing the off-screen "fringe" that BFS records anyway).
 */
function imageIsVisible(aabb: ClipRect, viewport: ClipRect): boolean {
  if (aabb.maxX < viewport.minX) return false;
  if (aabb.minX > viewport.maxX) return false;
  if (aabb.maxY < viewport.minY) return false;
  if (aabb.minY > viewport.maxY) return false;
  const w = aabb.maxX - aabb.minX;
  const h = aabb.maxY - aabb.minY;
  if (w < MIN_VISIBLE_PX && h < MIN_VISIBLE_PX) return false;
  return true;
}

/**
 * Below this screen size in *both* axes, a face image is considered too
 * small to render (sub-pixel). Set above 1 px to leave a small margin so
 * we don't churn between visible / invisible at exactly 1 px during zoom.
 */
const MIN_VISIBLE_PX = 1;

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
